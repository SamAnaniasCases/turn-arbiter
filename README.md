# turn-arbiter

A pure computation turn arbiter for asynchronous, anonymous, two-sided games (e.g. crowd chess, race-condition turn games).

It answers one single question: ***Is this session permitted to act right now, and what is the resulting game state?***

- ⚡ **Zero Runtime Dependencies** in core.
- 🌐 **Edge-Runtime Ready:** Runs on Node.js, Bun, Deno, Cloudflare Workers, or in the Browser.
- 🔒 **Storage Agnostic:** Storage and persistence are owned entirely by your host application database via Compare-And-Swap (CAS) versioning.
- ⏱️ **Purity Guaranteed:** Time is injected; no system calls, side-effects, or state mutation.

---

## Installation

```bash
npm install turn-arbiter
```

Or for local development:
```json
"dependencies": {
  "turn-arbiter": "file:../turn-arbiter"
}
```

---

## Quickstart (Chess Example)

```typescript
import { createArbiter } from "turn-arbiter";
import { chessRules } from "turn-arbiter/chess";

// Initialize arbiter (new game or restored from DB)
const arbiter = createArbiter({
  rules: chessRules,
  now: Date.now(),
});

// 1. Assign side for an incoming session
const assignment = arbiter.assign({
  sessionId: "session-abc-123",
  activeCounts: { white: 4, black: 2 },
});
console.log(assignment); 
// { side: "black", canMoveNow: false, stallOpen: false }

// 2. Submit a move
const result = arbiter.submit({
  sessionId: "session-abc-123",
  side: "white",
  move: "e4",
  version: 0,
});

if (result.ok) {
  console.log("Move accepted!", result.state.version); // version: 1
  // Save result.state to your database (PostgreSQL, Redis, etc.)
} else {
  console.log("Move rejected:", result.reason); // "superseded" | "not_your_side" | "illegal_move" | "game_over"
}
```

---

## API Summary

### `createArbiter(config)`
Creates an arbiter instance.
- `rules`: Game rules adapter (e.g., `chessRules` or custom implementation of `Rules<P, M>`).
- `now`: Injected epoch millisecond timestamp.
- `state` *(optional)*: Existing `ArbiterState<P>` restored from database.
- `stallAfterMs` *(optional)*: Inactivity threshold before stall breaker opens positions to any side (default: 48h).

### Methods
- **`assign({ sessionId, activeCounts })`**: Determines side assignment preference and whether session can act immediately.
- **`submit({ sessionId, side, move, version })`**: Evaluates move against 5-stage validation hierarchy (`game_over` -> `superseded` -> `not_your_side` -> `malformed_move` -> `illegal_move`). Returns fresh state union.
- **`serialize()`**: Returns full, unmutated plain JSON `ArbiterState<P>` for DB persistence.
- **`publicView({ historyLimit })`**: Returns sanitized public state snapshot with privacy redaction (`seenSessions` excluded).

---

## Custom Game Engines (`Rules<P, M>`)

To use `turn-arbiter` with custom games (e.g. Checkers, Connect Four, Go), implement the `Rules` interface:

```typescript
import type { Rules } from "turn-arbiter";

export const customRules: Rules<MyPosition, MyMove> = {
  initial() {
    return { position: { ... }, sideToMove: "white" };
  },
  applyMove(position, move) {
    // Validate move logic and return new position, notation, positionKey, and optional outcome
  }
};
```

---

## Full Documentation & Architecture

- **[docs/SPECIFICATION.md](file:///c:/Users/Sam/Sam%20Folder/Repository/turn-arbiter/docs/SPECIFICATION.md)**: Original source-of-truth specification document (product vision, behavioral spec, prior art analysis, and 18-case test matrix).
- **[docs/DEVELOPER_GUIDE.md](file:///c:/Users/Sam/Sam%20Folder/Repository/turn-arbiter/docs/DEVELOPER_GUIDE.md)**: Developer architecture guide, compare-and-swap database contracts, state schema invariants, and AI agent guidelines.

---

## License

[MIT](LICENSE)
