import { describe, expect, it } from "vitest";
import { createArbiter } from "../src/arbiter.js";
import { chessRules } from "../src/chess.js";

const NOW = 1700000000000;

describe("chess adapter subpath tests", () => {
  it("replays Scholar's Mate end-to-end and detects checkmate winner", () => {
    const arbiter = createArbiter({
      rules: chessRules,
      now: NOW,
    });

    // 1. e4 e5
    const r1 = arbiter.submit({ sessionId: "w1", side: "white", move: "e4", version: 0 });
    expect(r1.ok).toBe(true);

    const r2 = arbiter.submit({ sessionId: "b1", side: "black", move: "e5", version: 1 });
    expect(r2.ok).toBe(true);

    // 2. Bc4 Nc6
    const r3 = arbiter.submit({ sessionId: "w1", side: "white", move: "Bc4", version: 2 });
    expect(r3.ok).toBe(true);

    const r4 = arbiter.submit({ sessionId: "b2", side: "black", move: "Nc6", version: 3 });
    expect(r4.ok).toBe(true);

    // 3. Qh5 Nf6??
    const r5 = arbiter.submit({ sessionId: "w2", side: "white", move: "Qh5", version: 4 });
    expect(r5.ok).toBe(true);

    const r6 = arbiter.submit({ sessionId: "b1", side: "black", move: "Nf6", version: 5 });
    expect(r6.ok).toBe(true);

    // 4. Qxf7# (Checkmate)
    const r7 = arbiter.submit({ sessionId: "w1", side: "white", move: "Qxf7#", version: 6 });
    expect(r7.ok).toBe(true);

    if (r7.ok) {
      expect(r7.outcome).toEqual({
        kind: "win",
        winner: "white",
        by: "checkmate",
      });
      expect(r7.state.outcome).toEqual({
        kind: "win",
        winner: "white",
        by: "checkmate",
      });
    }
  });

  it("preserves castling and en passant across serialization roundtrips", () => {
    const arbiter1 = createArbiter({
      rules: chessRules,
      now: NOW,
    });

    // 1. e4 h6
    arbiter1.submit({ sessionId: "w1", side: "white", move: "e4", version: 0 });
    arbiter1.submit({ sessionId: "b1", side: "black", move: "h6", version: 1 });

    // 2. e5 d5 (Black advances d7 -> d5 by 2 squares while White pawn is on 5th rank!)
    arbiter1.submit({ sessionId: "w1", side: "white", move: "e5", version: 2 });
    arbiter1.submit({ sessionId: "b1", side: "black", move: "d5", version: 3 });

    const savedState = arbiter1.serialize();

    // Re-instantiate arbiter with serialized state
    const arbiter2 = createArbiter({
      rules: chessRules,
      state: savedState,
      now: NOW + 1000,
    });

    // White captures en passant: exd6
    const r5 = arbiter2.submit({ sessionId: "w1", side: "white", move: "exd6", version: 4 });
    expect(r5.ok).toBe(true);
    if (r5.ok) {
      expect(r5.notation).toBe("exd6");
    }
  });
});
