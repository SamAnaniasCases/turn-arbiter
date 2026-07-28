# Turn Arbiter — Developer & Architecture Guide

This document is the primary technical specification, architectural reference, and context guide for `@samananias/turn-arbiter`. It is intended for project maintainers, downstream integration engineers, and AI coding assistants.

---

## 1. Quick Context & Mandatory Invariants for AI Agents

> [!IMPORTANT]
> **AI Coding Assistants & Contributors:** Before modifying or extending code in this repository, read and follow these non-negotiable invariants:

### 1.1 Reading Order
1. **[.agents/AGENTS.md](file:///c:/Users/Sam/Sam%20Folder/Repository/turn-arbiter/.agents/AGENTS.md)** — Workspace invariants for AI agents.
2. **[README.md](file:///c:/Users/Sam/Sam%20Folder/Repository/turn-arbiter/README.md)** — Package overview, installation, and quickstart usage.
3. **[docs/SPECIFICATION.md](file:///c:/Users/Sam/Sam%20Folder/Repository/turn-arbiter/docs/SPECIFICATION.md)** — Original source-of-truth specification & prior art design document.
4. **[docs/DEVELOPER_GUIDE.md](file:///c:/Users/Sam/Sam%20Folder/Repository/turn-arbiter/docs/DEVELOPER_GUIDE.md)** — Technical architecture and state contract reference.

### 1.2 Non-Negotiable Rules
- **Absolute Purity:** Never import or use `Date.now()`, `Math.random()`, `setTimeout`, `setInterval`, `fetch`, `fs`, or `process.env` within `src/`. Timestamps are injected via `now: number`.
- **Discriminated Union Outcomes:** `submit()` **must never throw exceptions** for game logic rejections. Always return `{ ok: false, reason }`.
- **Strict Validation Sequence:** Check `version` match **BEFORE** side turn validation. Teammate race losers must receive `"superseded"`, never `"not_your_side"`.
- **Immutability & CAS:** Never mutate state objects in place. Increment `version` by exactly `1` on accepted moves.
- **Zero Runtime Dependencies:** Core logic must remain 100% zero-dependency. `chess.js` is isolated under `./chess` as an optional peer dependency.
- **Test Isolation:** Core arbiter tests in `tests/arbiter.test.ts` MUST use `tests/toy-rules.ts`.

---

## 2. Technology Stack & Infrastructure

### 2.1 Core Engine
* **Language & Runtime:** TypeScript (Strict Mode), targeting ESM outputs.
* **Engine Minimum:** Node.js `>=22.12.0` (also compatible with Bun, Deno, Cloudflare Workers, and browser environments).
* **Dependencies:** **Zero runtime dependencies** in core package.
* **Optional Peer Dependency:** `chess.js` (`^1.0.0`) required *only* when importing the `./chess` subpath adapter.

### 2.2 Development & Tooling
* **Build System:** `tsc` (TypeScript compiler generating `.js`, `.d.ts`, and `.map` files).
* **Test Runner:** `vitest` (Fast, ESM-native unit testing).
* **Linting & Quality:** `eslint` (configured with `@typescript-eslint/no-explicit-any: "error"` flat config in `eslint.config.js`).
* **Strict Type Checking:** `tsconfig.json` enforcing `strict: true`, `noImplicitAny: true`, and `noUncheckedIndexedAccess: true`.
* **Packaging Verification:** `publint` (export map & package checks).

---

## 3. Single Source of Truth & State Contract

### 3.1 Storage Decoupling
`turn-arbiter` does **not** store state, connect to databases, read environment variables, or maintain persistent in-memory sessions. It operates strictly as a **pure computation function**:
```
(Current State, Action Submission, Injected Context) -> New State | Rejection
```
The consuming application (e.g., Fog Chess site, web application backend, API service) owns storage (PostgreSQL, Redis, DynamoDB, SQLite, etc.) and is the sole **Single Source of Truth (SSOT)**.

### 3.2 Compare-and-Swap (CAS) & Versioning
To handle asynchronous, concurrent submissions safely without locks:
1. `version` increments by **exactly 1** per accepted move.
2. The consuming database uses `version` to execute optimistic concurrency control (e.g., `UPDATE games SET state = :newState WHERE id = :id AND version = :submittedVersion`).
3. If two submissions arrive concurrently, the first database transaction succeeds; the second submission yields a `superseded` response when evaluated against the updated version.

### 3.3 Serialized State Contract (`ArbiterState`)
```typescript
export type Side = "white" | "black";

export type Outcome =
  | { kind: "win"; winner: Side; by: "checkmate" | "resignation" }
  | { kind: "draw"; by: "stalemate" | "repetition" | "fifty-move" | "insufficient-material" };

export type ArbiterState<Position = string> = {
  schemaVersion: 1;         // Explicit version bump required for breaking shape changes
  version: number;          // Monotonically increasing CAS lock
  position: Position;       // Domain position representation (e.g. FEN or custom object)
  sideToMove: Side;         // Active side
  history: string[];        // Array of move notations in chronological order
  positionKeys: string[];   // History of position keys for threefold repetition detection
  seenSessions: string[];   // Unique session IDs observed in this game instance
  contributors: number;     // Count of distinct active sessions
  startedAt: string;        // ISO 8601 creation timestamp
  lastMoveAt: string;       // ISO 8601 timestamp of last move
  outcome: Outcome | null;  // Terminal state outcome if game is over
};
```

---

## 4. Core Arbitration Rules & Validation Order

### 4.1 Submission Validation Pipeline
Submissions undergo validation in strict hierarchical order:

| Step | Check Condition | Rejection Reason | Rationale |
| :--- | :--- | :--- | :--- |
| **1. Game Status** | Game is ongoing (`outcome === null`) | `"game_over"` | Completed games reject all moves immediately. |
| **2. Version Match** | `submittedVersion === state.version` | `"superseded"` | **Checked before side!** Ensures a player whose teammate just moved receives `superseded` rather than `not_your_side`. |
| **3. Turn Authorization** | Submitted side matches `sideToMove` OR stall window is open | `"not_your_side"` | Only active side may move unless `stallAfterMs` threshold expired. |
| **4. Structural Check** | Move payload is valid type/shape | `"malformed_move"` | Protects rules adapter from invalid payload types. |
| **5. Rules Engine** | `rules.applyMove(position, move)` succeeds | `"illegal_move"` | Domain-specific logic rejection (e.g. moving into check). |

### 4.2 Side Assignment Algorithm (`assign`)
Session side assignment is pure and calculated on demand:
1. Prefers side with **fewer recently active sessions** (`activeCounts`).
2. On a tie, assigns **side to move**, allowing a new arrival to act immediately.
3. If stall window is open (`now - lastMoveAt > stallAfterMs`), `canMoveNow` returns `true` for all sessions.

---

## 5. Testing Architecture & Verification Commands

### 5.1 Test Suites
- **`tests/toy-rules.ts` / `tests/arbiter.test.ts`:** 18-case unit test matrix covering state arbitration independently of chess domain rules.
- **`tests/chess.test.ts`:** Integration suite for `./chess` subpath (Scholar's mate replay, castling, en-passant serialization).

### 5.2 Verification Commands
Run before declaring work complete:
```bash
# 1. Run unit test suite (20 tests)
npm test

# 2. Run ESLint strict no-explicit-any check
npm run lint

# 3. Build ESM distribution files to dist/
npm run build

# 4. Check TypeScript compilation & package export maps
npm run check
```

---

## 6. Local Integration & Publishing Workflow

### 6.1 Local Development (`file:` Protocol)
Point the consuming application to the local repository directory in `package.json`:
```json
"dependencies": {
  "@samananias/turn-arbiter": "file:../turn-arbiter"
}
```
Build the consuming application against local changes before publishing to npm.

### 6.2 Publishing Checklist
1. Verify package contents with `npm pack --dry-run` (only `dist`, `README.md`, `LICENSE`, `package.json` ship).
2. Run `publint` and `npx tsc --noEmit` to verify type resolution and export maps.
3. Publish from GitHub Actions using npm Trusted Publishing (OIDC) with `--provenance`.

---

## 7. Prior Art & Category Positioning

| Project | What it is | How `@samananias/turn-arbiter` Differs |
| :--- | :--- | :--- |
| **boardgame.io** | Turn-based engine with state, lobby, bots, and logs | Assumes fixed player IDs, bundles persistence & transport. Opposite of storage-agnostic. |
| **Community Chess** | Host vs voting crowd | Product, not a library. Uses voting windows, not first-valid-submit-wins racing. |
| **sambdavidson/community-chess** | Framework for move casting | Go server application, not an unopinionated computation library. |
| **Twitch-plays-chess bots** | Chat voting scripts | Coupled to DOM/API. No reusable arbitration layer. |

### Key Differentiators:
1. Anonymous fluid side membership (no accounts or lobbies).
2. First-valid-submit-wins between teammates with `superseded` resolution.
3. Version compare-and-swap (CAS) contract so host application owns storage.
4. Pure zero-dependency edge-runtime compatible library.
