# turn-arbiter Specification (Original Source of Truth)

> **Scope:** this document covers only the publishable npm package. The site that consumes it — storage, endpoints, board UI — is specified separately in the Fog Chess feature plan. Keep this file in the `turn-arbiter` repo.

## 1. What this package is

A **turn arbiter for asynchronous, anonymous, two-sided games.** It answers one question: *is this person allowed to act right now, and what is the resulting state?*

It is a pure computation library. It does not run, does not listen on a port, and does not store anything. Installing it starts nothing; it is inert until imported.

### 1.1 In scope

- Assigning an anonymous session to a side

- Deciding whether a submission is permitted

- Detecting and reporting lost races between teammates

- Advancing game state and reporting outcomes

- Opening a stalled position after a threshold

- Serialising state to plain JSON and restoring from it

### 1.2 Explicitly out of scope

These belong to the consuming application and must never appear in this repo:

| Excluded | Why |
| --- | --- |
| Any database access | The package receives state as an argument and returns new state |
| HTTP handlers, routing, CORS | It knows nothing about transport |
| Cookie signing, HMAC, secrets | Requires a secret key; a library has no business holding one |
| Rate limiting | Needs shared, persistent counters |
| Chess rules themselves | Delegated to `chess.js` through an adapter |
| SVG, CSS, fonts, any asset | Nothing in this package renders |
| Reading the clock or environment variables | Time is injected; there is no configuration to discover |

**Test for inclusion:** could this line run with no internet, no database, and no screen? If not, it is out of scope.

## 2. Behavioural specification

### 2.1 Side assignment

A session is bound to exactly one side and keeps it. `assign` is pure, so the caller supplies current population counts rather than the package discovering them.

Preference order:

1. The side with fewer recently-active sessions.
2. On a tie, the side whose turn it is — so a new arrival can act immediately.

Because a session holds one side only, a single visitor cannot legally move for both.

### 2.2 Submission validation

A submission is accepted only if **all** of these hold, checked in this order:

| Order | Check | Rejection reason |
| --- | --- | --- |
| 1 | Game is still in progress | `game_over` |
| 2 | Submitted `version` equals current `version` | `superseded` |
| 3 | Submitted side is the side to move, or the stall window is open | `not_your_side` |
| 4 | Move is well-formed | `malformed_move` |
| 5 | `rules.applyMove` accepts it | `illegal_move` |

Order matters: version is checked before side, so a player whose teammate just moved is told `superseded` rather than the misleading `not_your_side`.

### 2.3 Losing a race is a normal state

Two teammates submitting in the same second is expected traffic. The loser gets `superseded` plus the updated state, never an exception. `submit` must never throw for a rejected move — it returns a discriminated union.

### 2.4 Stall breaker

If `now - lastMoveAt` exceeds `stallAfterMs`, the position opens to any session regardless of assigned side, and `assign` reports `canMoveNow: true` for everyone. This prevents deadlock when nobody holds the side that owes a move.

### 2.5 Contributor counting

`contributors` increments only for a session id not seen before in the current game. Repeat movers do not inflate it.

### 2.6 Version discipline

`version` increments by exactly one per accepted move, never otherwise. This is the value the consuming app uses for its compare-and-swap, so it is load-bearing.

## 3. API surface

### 3.1 Types

```tsx
export type Side = "white" | "black";

export type Outcome =
  | { kind: "win"; winner: Side; by: "checkmate" | "resignation" }
  | { kind: "draw"; by: "stalemate" | "repetition" | "fifty-move" | "insufficient-material" };

export type RejectReason =
  | "superseded"
  | "not_your_side"
  | "illegal_move"
  | "malformed_move"
  | "game_over";

export type ArbiterState<Position = string> = {
  schemaVersion: 1;
  version: number;
  position: Position;
  sideToMove: Side;
  history: string[];        // complete, in order
  positionKeys: string[];   // for repetition detection
  seenSessions: string[];   // for contributor counting
  contributors: number;
  startedAt: string;        // ISO 8601
  lastMoveAt: string;       // ISO 8601
  outcome: Outcome | null;
};
```

### 3.2 Constructor

```tsx
export function createArbiter<P, M>(config: {
  rules: Rules<P, M>;
  state?: ArbiterState<P>;    // omit to begin a new game
  now: number;                // injected epoch ms; never read internally
  stallAfterMs?: number;      // default: 48 hours
}): Arbiter<P, M>;
```

### 3.3 Methods

```tsx
type Arbiter<P, M> = {
  assign(args: {
    sessionId: string;
    activeCounts?: { white: number; black: number };
  }): { side: Side; canMoveNow: boolean; stallOpen: boolean };

  submit(args: {
    sessionId: string;
    side: Side;
    move: M;
    version: number;
  }):
    | { ok: true; state: ArbiterState<P>; notation: string; outcome: Outcome | null }
    | { ok: false; reason: RejectReason; state: ArbiterState<P> };

  serialize(): ArbiterState<P>;

  publicView(opts?: { historyLimit?: number }): PublicView;
};
```

`publicView` strips everything privacy-sensitive — `seenSessions` never leaves the server — and truncates history to `historyLimit`, default 10.

### 3.4 The rules interface

The entire game-specific surface. Implementing this is how the package stays chess-agnostic.

```tsx
export type Rules<P, M> = {
  initial(): { position: P; sideToMove: Side };

  applyMove(position: P, move: M):
    | { ok: false }
    | {
        ok: true;
        position: P;
        sideToMove: Side;
        notation: string;      // e.g. "Nf3"
        positionKey: string;   // stable identity of the position, for repetition
        outcome: Outcome | null;
      };
};
```

### 3.5 The chess adapter

Shipped on the `./chess` subpath, roughly thirty lines wrapping `chess.js`. `chess.js` is an **optional peer dependency**, so the core install stays at zero dependencies and only consumers importing this subpath need it.

```tsx
import { chessRules } from "@samananias/turn-arbiter/chess";
```

## 4. Serialized state is public API

This is the easiest thing to get wrong. The consuming app persists `serialize()` output in a database, which means **the state shape is part of your public contract**, exactly like the function signatures. Changing a field name is a breaking change that can corrupt a live game.

Hence `schemaVersion: 1` from the very first commit. When the shape must change, bump it and accept both forms in `createArbiter` for at least one minor version. Adding this later is far more painful than having it from the start.

## 5. Purity contract

Non-negotiable invariants, each of which should be enforced by a test:

- No `Date.now()`, no `Math.random()`, no timers anywhere in `src/`

- No `fetch`, no `fs`, no `process.env`

- No imports outside the package except the optional peer in the chess adapter

- `submit` never throws for game-logic reasons; it returns `ok: false`

- Given identical inputs, output is byte-identical

- The input state object is never mutated; a new object is returned

The payoff: this runs unchanged on Node, Bun, Deno, Cloudflare Workers, and in the browser — and every concurrency case is testable in milliseconds with no infrastructure.

## 6. Test plan

Write these against a **toy two-player rules object**, not chess. If the suite needs chess knowledge to read, the abstraction has leaked.

| # | Case | Expectation | Status |
| --- | --- | --- | --- |
| 1 | New game with no state | White to move, version 0, empty history | ✅ **PASS** |
| 2 | Assignment with uneven populations | Smaller side chosen | ✅ **PASS** |
| 3 | Assignment with equal populations | Side to move chosen | ✅ **PASS** |
| 4 | Two submissions at the same version | Exactly one returns `ok: true` | ✅ **PASS** |
| 5 | Stale version | `superseded` | ✅ **PASS** |
| 6 | Wrong side | `not_your_side` | ✅ **PASS** |
| 7 | Version checked before side | Stale + wrong side yields `superseded` | ✅ **PASS** |
| 8 | Illegal move per rules | `illegal_move` | ✅ **PASS** |
| 9 | Accepted move | Version increments by exactly 1 | ✅ **PASS** |
| 10 | Same session moving twice | `contributors` unchanged | ✅ **PASS** |
| 11 | New session moving | `contributors` increments | ✅ **PASS** |
| 12 | Repetition via `positionKeys` | Draw outcome reported | ✅ **PASS** |
| 13 | Just before `stallAfterMs` | Wrong side still rejected | ✅ **PASS** |
| 14 | Just after `stallAfterMs` | Any side accepted, `stallOpen: true` | ✅ **PASS** |
| 15 | Move after game over | `game_over` | ✅ **PASS** |
| 16 | `serialize()` then `createArbiter` | Lossless round trip | ✅ **PASS** |
| 17 | `publicView()` | No `seenSessions`; history capped at limit | ✅ **PASS** |
| 18 | Input state object | Unmutated after `submit` | ✅ **PASS** |

Cases 4, 5, and 7 are the ones the whole feature rests on. Write them first.

A separate, smaller suite covers the chess adapter: a full recorded game replays correctly, castling and en passant survive a serialize round trip, and checkmate reports the right winner. (Status: ✅ **PASS**)

## 7. Repository layout

```jsx
turn-arbiter/
  src/
    index.ts        // public exports
    arbiter.ts      // createArbiter
    types.ts
    chess.ts        // adapter, imports chess.js
  tests/
    toy-rules.ts    // minimal two-player game for testing
    arbiter.test.ts
    chess.test.ts
  package.json
  tsconfig.json
  tsdown.config.ts
  README.md
  LICENSE
```

## 8. Manifest

```json
{
  "name": "@samananias/turn-arbiter",
  "version": "0.1.0",
  "type": "module",
  "sideEffects": false,
  "license": "MIT",
  "engines": { "node": ">=22.12.0" },
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./chess": {
      "types": "./dist/chess.d.ts",
      "import": "./dist/chess.js"
    }
  },
  "peerDependencies": { "chess.js": "^1.0.0" },
  "peerDependenciesMeta": { "chess.js": { "optional": true } },
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "lint": "eslint .",
    "check": "tsc --noEmit && publint && attw --pack"
  }
}
```

Notes:

- `files: ["dist"]` is an allowlist — safer than `.npmignore`, which fails by omission.

- `sideEffects: false` lets consumers tree-shake.

- No `dependencies` at all. That is the point.

- ESM only. Add CJS only if a real consumer asks.

## 9. Local development without publishing

You do not need an npm account to use this. Point the portfolio at the folder on disk:

```json
"dependencies": {
  "@samananias/turn-arbiter": "file:../turn-arbiter"
}
```

Imports then behave exactly as they would from the registry. Build the whole feature this way; publishing later is a one-line change from `file:../turn-arbiter` to `^0.1.0`, with no code change.

## 10. Publishing

1. Verify contents with `npm pack --dry-run` — confirm only `dist` and the metadata ship.
2. Run `publint` and `attw --pack` to catch export-map and type-resolution errors that silently break consumers.
3. Publish from GitHub Actions using npm Trusted Publishing (OIDC) with `--provenance`, so no long-lived token sits in secrets.
4. Add `changesets` once past `0.1.0`.
5. README should link to the live board. That link is the entire pitch.

**Stay on `0.x` until the game has been running publicly for a while.** Under semver, `0.x` signals an unstable API and lets you break things while you learn what the shape should have been. Every published version is permanent and immutable.

## 11. Build order

| Phase | Deliverable | Status |
| --- | --- | --- |
| 0 | Repo, TypeScript, vitest, lint, CI | ✅ **Completed** (`npm test`, `npm run lint`, `npm run build` pass) |
| 1 | Toy rules + core arbiter | ✅ **Completed** (All 18 cases in §6 pass) |
| 2 | Chess adapter on `./chess` | ✅ **Completed** (Recorded game & serialization tests pass) |
| 3 | Consumed by the portfolio via `file:` | ⏳ Ready for local link |
| 4 | Publish `0.1.0` | ⏳ Ready for npm release |

Phases 0 through 2 need no database, no hosting account, and no npm account.

## 12. Open question

**Name.** Settled as `turn-arbiter` (`@samananias/turn-arbiter`). This describes the core honestly and leaves room for non-chess adapters.

## 13. Prior art

Checked before committing to build. Conclusion: **the product category exists, the package does not.**

### 13.1 Closest relatives

| Project | What it is | How it differs |
| --- | --- | --- |
| **boardgame.io** | The dominant turn-based engine on npm. Turn orders, phases, lobby, bots, logs | Assumes a match with fixed, known `playerID`s. Bundles networking and storage — explicitly advertises that you write no storage code. Opposite of storage-agnostic |
| **Community Chess** (community-chess.com) | One host versus a voting crowd | Product, not a library. Voting with a window, not first-submit-wins. One community against one person, not two anonymous crowds |
| **sambdavidson/community-chess** | Chess on a generic framework for asynchronous move casting | Closest conceptual relative, but Go, vote-based, and a server rather than a library |
| **CrowdChess** (Saarland, 2017) | Academic system for shared game control in livestreams | Research prototype. Multiple viewers versus an AI, by voting |
| **Twitch-plays-chess bots** | Chat votes, bot relays to Lichess or Chess.com | Scripts coupled to a specific site's DOM or API. No reusable arbitration layer |
| **One Million Chessboards** | 1000×1000 shared boards, moves apply globally | **No turns at all** — the opposite design. Genuinely novel, and open source, but solves a different problem |
| **MultiTurn** | TypeScript turn-based multiplayer framework | Requires named users and rooms. Largely dormant |

### 13.2 The pattern in the prior art

Every crowd-chess implementation found uses **voting inside a time window**, and almost all pit **one crowd against one host or an AI**. Not one of them uses fluid anonymous membership on both sides with no reservation and first-valid-submission-wins.

That matters because the voting model and the racing model need completely different arbitration. Voting needs ballots, windows, and tie-breaks. Racing needs version compare-and-swap and a `superseded` result. The mechanic in this package has no equivalent in the surveyed work.

### 13.3 Evidence of a genuine gap

Developers repeatedly report that no suitable library exists for turn-state arbitration specifically — a Babylon.js forum thread from 2021 concluded "I have searched and searched but I see no open framework for turn-based multiplayer games," and similar Node.js discussions find no widely used solution for server-side turn state. `boardgame.io` fills the *engine* niche but is unusable when you want to own your own storage and transport, which is exactly the constraint here.

### 13.4 What is actually unclaimed

1. Anonymous fluid side membership, with no accounts and no matchmaking
2. First-valid-submit-wins between teammates, with `superseded` as a designed result rather than an error
3. Version-based compare-and-swap as the public contract, so the host application owns storage
4. A stall breaker for a game that may sit idle for days
5. Pure, zero-dependency, edge-runtime-compatible, with no bundled transport

Point 3 is the real differentiator. Every existing library wants to own persistence; this one refuses to, which is what makes it usable on free-tier serverless infrastructure.

### 13.5 Honest caveat

The audience for this package is small. Its value is primarily as a demonstration of API design, purity, and concurrency reasoning — not as widely adopted infrastructure. That is a perfectly good reason to build it, but it should not be mistaken for a gap in the market with users waiting in it.
