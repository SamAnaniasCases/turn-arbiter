import { describe, expect, it } from "vitest";
import { createArbiter } from "../src/arbiter.js";
import { toyRules } from "./toy-rules.js";

const START_TIME = 1700000000000;
const STALL_MS = 10000;

describe("turn-arbiter core specifications (§6 test plan)", () => {
  // Case 1: New game with no state
  it("Case 1: initializes a new game with white to move, version 0, empty history", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });
    const state = arbiter.serialize();

    expect(state.sideToMove).toBe("white");
    expect(state.version).toBe(0);
    expect(state.history).toEqual([]);
    expect(state.positionKeys).toEqual([]);
    expect(state.contributors).toBe(0);
    expect(state.outcome).toBeNull();
  });

  // Case 2: Assignment with uneven populations
  it("Case 2: assigns the side with fewer active sessions", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    const assignment = arbiter.assign({
      sessionId: "user-1",
      activeCounts: { white: 5, black: 2 },
    });

    expect(assignment.side).toBe("black");
    expect(assignment.canMoveNow).toBe(false); // White is to move initially
  });

  // Case 3: Assignment with equal populations
  it("Case 3: breaks ties on equal populations by choosing side to move", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    const assignment = arbiter.assign({
      sessionId: "user-1",
      activeCounts: { white: 3, black: 3 },
    });

    expect(assignment.side).toBe("white");
    expect(assignment.canMoveNow).toBe(true);
  });

  // Case 4: Two submissions at the same version
  it("Case 4: accepts only one submission when two race at the same version", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    const res1 = arbiter.submit({
      sessionId: "sess-a",
      side: "white",
      move: { action: "inc", value: 1 },
      version: 0,
    });

    const res2 = arbiter.submit({
      sessionId: "sess-b",
      side: "white",
      move: { action: "inc", value: 1 },
      version: 0,
    });

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.reason).toBe("superseded");
    }
  });

  // Case 5: Stale version
  it("Case 5: rejects stale version submissions with superseded", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    // Advance to version 1
    arbiter.submit({
      sessionId: "sess-a",
      side: "white",
      move: { action: "inc", value: 1 },
      version: 0,
    });

    const res = arbiter.submit({
      sessionId: "sess-a",
      side: "black",
      move: { action: "inc", value: 1 },
      version: 0, // stale version
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("superseded");
    }
  });

  // Case 6: Wrong side
  it("Case 6: rejects submission from non-active side with not_your_side", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    const res = arbiter.submit({
      sessionId: "sess-black",
      side: "black", // White is to move
      move: { action: "inc", value: 1 },
      version: 0,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("not_your_side");
    }
  });

  // Case 7: Version checked before side
  it("Case 7: returns superseded instead of not_your_side when both version and side are wrong", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    // Move to version 1 (now black to move)
    arbiter.submit({
      sessionId: "sess-1",
      side: "white",
      move: { action: "inc", value: 1 },
      version: 0,
    });

    // Submit stale version 0 AND wrong side 'white'
    const res = arbiter.submit({
      sessionId: "sess-2",
      side: "white",
      move: { action: "inc", value: 1 },
      version: 0,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("superseded");
    }
  });

  // Case 8: Illegal move per rules
  it("Case 8: rejects move disallowed by rules with illegal_move", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    const res = arbiter.submit({
      sessionId: "sess-1",
      side: "white",
      move: { action: "inc", value: -5 }, // negative step invalid in toyRules
      version: 0,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("illegal_move");
    }
  });

  // Case 9: Accepted move
  it("Case 9: increments version by exactly 1 on accepted move", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    const res = arbiter.submit({
      sessionId: "sess-1",
      side: "white",
      move: { action: "inc", value: 1 },
      version: 0,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.version).toBe(1);
      expect(res.state.position.counter).toBe(1);
      expect(res.state.sideToMove).toBe("black");
    }
  });

  // Case 10: Same session moving twice
  it("Case 10: keeps contributors count unchanged when same session moves again", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    const m1 = arbiter.submit({
      sessionId: "repeat-user",
      side: "white",
      move: { action: "inc", value: 1 },
      version: 0,
    });
    expect(m1.ok && m1.state.contributors).toBe(1);

    const m2 = arbiter.submit({
      sessionId: "repeat-user",
      side: "black",
      move: { action: "inc", value: 1 },
      version: 1,
    });
    expect(m2.ok && m2.state.contributors).toBe(1);
  });

  // Case 11: New session moving
  it("Case 11: increments contributors count when a new session moves", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    arbiter.submit({
      sessionId: "user-alpha",
      side: "white",
      move: { action: "inc", value: 1 },
      version: 0,
    });

    const m2 = arbiter.submit({
      sessionId: "user-beta",
      side: "black",
      move: { action: "inc", value: 1 },
      version: 1,
    });

    expect(m2.ok && m2.state.contributors).toBe(2);
  });

  // Case 12: Repetition via positionKeys
  it("Case 12: reports threefold repetition draw outcome via positionKeys", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    // 1st occurrence of key
    arbiter.submit({
      sessionId: "u1",
      side: "white",
      move: { action: "repeat_key", forcedKey: "same-key" },
      version: 0,
    });

    // 2nd occurrence of key
    arbiter.submit({
      sessionId: "u2",
      side: "black",
      move: { action: "repeat_key", forcedKey: "same-key" },
      version: 1,
    });

    // 3rd occurrence of key -> draw outcome
    const res3 = arbiter.submit({
      sessionId: "u1",
      side: "white",
      move: { action: "repeat_key", forcedKey: "same-key" },
      version: 2,
    });

    expect(res3.ok).toBe(true);
    if (res3.ok) {
      expect(res3.outcome).toEqual({
        kind: "draw",
        by: "repetition",
      });
    }
  });

  // Case 13: Just before stallAfterMs
  it("Case 13: rejects wrong side just before stallAfterMs threshold", () => {
    const initialArbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
      stallAfterMs: STALL_MS,
    });
    const state = initialArbiter.serialize();

    const arbiter = createArbiter({
      rules: toyRules,
      state,
      now: START_TIME + STALL_MS - 1,
      stallAfterMs: STALL_MS,
    });

    const res = arbiter.submit({
      sessionId: "black-player",
      side: "black",
      move: { action: "inc", value: 1 },
      version: 0,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("not_your_side");
    }
  });

  // Case 14: Just after stallAfterMs
  it("Case 14: accepts any side and reports stallOpen: true just after stallAfterMs", () => {
    const initialArbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
      stallAfterMs: STALL_MS,
    });
    const state = initialArbiter.serialize();

    const arbiter = createArbiter({
      rules: toyRules,
      state,
      now: START_TIME + STALL_MS + 10,
      stallAfterMs: STALL_MS,
    });

    const assignRes = arbiter.assign({ sessionId: "anyone" });
    expect(assignRes.stallOpen).toBe(true);
    expect(assignRes.canMoveNow).toBe(true);

    const submitRes = arbiter.submit({
      sessionId: "black-player",
      side: "black", // Allowed despite White's turn due to stall breaker
      move: { action: "inc", value: 1 },
      version: 0,
    });

    expect(submitRes.ok).toBe(true);
  });

  // Case 15: Move after game over
  it("Case 15: rejects moves post game over with game_over", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    // Resign -> Game Over
    const resignRes = arbiter.submit({
      sessionId: "white-player",
      side: "white",
      move: { action: "resign" },
      version: 0,
    });
    expect(resignRes.ok).toBe(true);

    // Subsequent move rejected
    const postMove = arbiter.submit({
      sessionId: "black-player",
      side: "black",
      move: { action: "inc", value: 1 },
      version: 1,
    });

    expect(postMove.ok).toBe(false);
    if (!postMove.ok) {
      expect(postMove.reason).toBe("game_over");
    }
  });

  // Case 16: serialize() then createArbiter
  it("Case 16: round trips state losslessly with serialize() and createArbiter", () => {
    const arbiter1 = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    arbiter1.submit({
      sessionId: "u1",
      side: "white",
      move: { action: "inc", value: 3 },
      version: 0,
    });

    const savedState = arbiter1.serialize();

    const arbiter2 = createArbiter({
      rules: toyRules,
      state: savedState,
      now: START_TIME + 5000,
    });

    expect(arbiter2.serialize()).toEqual(savedState);
  });

  // Case 17: publicView()
  it("Case 17: sanitizes publicView by omitting seenSessions and truncating history", () => {
    const arbiter = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    // Perform 12 moves
    for (let i = 0; i < 12; i++) {
      const side = i % 2 === 0 ? "white" : "black";
      arbiter.submit({
        sessionId: `user-${i}`,
        side,
        move: { action: "inc", value: 1 },
        version: i,
      });
    }

    const pub = arbiter.publicView({ historyLimit: 5 });

    expect(pub.schemaVersion).toBe(1);
    expect(pub.version).toBe(12);
    expect(pub.contributors).toBe(12);
    expect(pub.history.length).toBe(5);
    expect((pub as Record<string, unknown>).seenSessions).toBeUndefined();
    expect((pub as Record<string, unknown>).positionKeys).toBeUndefined();
  });

  // Case 18: Input state object immutability
  it("Case 18: does not mutate the input state object during submit", () => {
    const arbiter1 = createArbiter({
      rules: toyRules,
      now: START_TIME,
    });

    const initialStateSnapshot = arbiter1.serialize();
    const frozenCopy = JSON.parse(JSON.stringify(initialStateSnapshot));

    const arbiter2 = createArbiter({
      rules: toyRules,
      state: initialStateSnapshot,
      now: START_TIME,
    });

    arbiter2.submit({
      sessionId: "user-1",
      side: "white",
      move: { action: "inc", value: 1 },
      version: 0,
    });

    expect(initialStateSnapshot).toEqual(frozenCopy);
  });
});
