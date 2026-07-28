# Repository Guidelines for AI Agents (`turn-arbiter`)

This workspace uses `.agents/AGENTS.md` to enforce repository invariants, architectural boundaries, and code quality expectations for AI coding assistants.

---

## Core Invariants & Architectural Boundaries

1. **Strict Purity**:
   - Never import or use `Date.now()`, `Math.random()`, `setTimeout`, `setInterval`, `fetch`, `fs`, or `process.env` within `src/`.
   - All timestamps must be passed explicitly via injected arguments (epoch ms `now`).

2. **No Thrown Exceptions in Logic**:
   - `submit()` must **never throw** for domain-level rejections (version mismatch, wrong side, illegal move, malformed payload, or game over).
   - Rejections MUST return `{ ok: false, reason: RejectReason, state: ArbiterState<P> }`.

3. **Validation Sequence (Non-Negotiable)**:
   - Always check `version` match **before** side turn validation. A player whose teammate just submitted a move MUST receive `"superseded"`, never `"not_your_side"`.

4. **Immutability & CAS Versioning**:
   - Never mutate state objects passed into `submit()` or `createArbiter()`.
   - Always increment `version` by exactly `1` on accepted moves.

5. **Zero Dependency Core**:
   - Do NOT add any `dependencies` to `package.json`. Core arbiter logic must remain completely pure and runtime-agnostic.
   - External game rules (like `chess.js`) must live strictly under `./chess` as an optional peer dependency.

6. **Test Isolation**:
   - Core arbiter unit tests in `tests/arbiter.test.ts` MUST use `tests/toy-rules.ts`. Do not introduce chess rules into core arbiter tests.
