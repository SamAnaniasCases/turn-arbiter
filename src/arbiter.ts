import type {
  Arbiter,
  ArbiterConfig,
  ArbiterState,
  Outcome,
  PublicView,
  Side,
} from "./types.js";

const DEFAULT_STALL_AFTER_MS = 48 * 60 * 60 * 1000; // 48 hours

function cloneState<P>(state: ArbiterState<P>): ArbiterState<P> {
  return {
    ...state,
    history: [...state.history],
    positionKeys: [...state.positionKeys],
    seenSessions: [...state.seenSessions],
    outcome: state.outcome ? { ...state.outcome } : null,
  };
}

export function createArbiter<P, M>(config: ArbiterConfig<P, M>): Arbiter<P, M> {
  const stallAfterMs = config.stallAfterMs ?? DEFAULT_STALL_AFTER_MS;

  let currentState: ArbiterState<P>;

  if (config.state) {
    currentState = cloneState(config.state);
  } else {
    const initial = config.rules.initial();
    const isoNow = new Date(config.now).toISOString();
    currentState = {
      schemaVersion: 1,
      version: 0,
      position: initial.position,
      sideToMove: initial.sideToMove,
      history: [],
      positionKeys: [],
      seenSessions: [],
      contributors: 0,
      startedAt: isoNow,
      lastMoveAt: isoNow,
      outcome: null,
    };
  }

  return {
    assign(args: {
      sessionId: string;
      activeCounts?: { white: number; black: number };
    }) {
      const elapsed = config.now - Date.parse(currentState.lastMoveAt);
      const stallOpen = elapsed > stallAfterMs;

      const counts = args.activeCounts ?? { white: 0, black: 0 };
      let side: Side;

      if (counts.white < counts.black) {
        side = "white";
      } else if (counts.black < counts.white) {
        side = "black";
      } else {
        side = currentState.sideToMove;
      }

      const canMoveNow = stallOpen || side === currentState.sideToMove;

      return { side, canMoveNow, stallOpen };
    },

    submit(args: {
      sessionId: string;
      side: Side;
      move: M;
      version: number;
    }) {
      const elapsed = config.now - Date.parse(currentState.lastMoveAt);
      const stallOpen = elapsed > stallAfterMs;

      // 1. Game in progress check
      if (currentState.outcome !== null) {
        return {
          ok: false,
          reason: "game_over",
          state: cloneState(currentState),
        };
      }

      // 2. Version check (MUST be before side check!)
      if (args.version !== currentState.version) {
        return {
          ok: false,
          reason: "superseded",
          state: cloneState(currentState),
        };
      }

      // 3. Side to move check
      if (args.side !== currentState.sideToMove && !stallOpen) {
        return {
          ok: false,
          reason: "not_your_side",
          state: cloneState(currentState),
        };
      }

      // 4. Well-formed move check
      if (args.move === undefined || args.move === null) {
        return {
          ok: false,
          reason: "malformed_move",
          state: cloneState(currentState),
        };
      }

      // 5. Rules check
      const result = config.rules.applyMove(currentState.position, args.move);
      if (!result.ok) {
        return {
          ok: false,
          reason: "illegal_move",
          state: cloneState(currentState),
        };
      }

      // Accepted move state calculation
      const newHistory = [...currentState.history, result.notation];
      const newPositionKeys = [...currentState.positionKeys, result.positionKey];

      const sessionSeen = currentState.seenSessions.includes(args.sessionId);
      const newSeenSessions = sessionSeen
        ? currentState.seenSessions
        : [...currentState.seenSessions, args.sessionId];

      // Repetition detection (3 occurrences of positionKey)
      let finalOutcome: Outcome | null = result.outcome;
      if (!finalOutcome) {
        const occurrences = newPositionKeys.filter(
          (k) => k === result.positionKey
        ).length;
        if (occurrences >= 3) {
          finalOutcome = { kind: "draw", by: "repetition" };
        }
      }

      const isoNow = new Date(config.now).toISOString();

      const newState: ArbiterState<P> = {
        schemaVersion: 1,
        version: currentState.version + 1,
        position: result.position,
        sideToMove: result.sideToMove,
        history: newHistory,
        positionKeys: newPositionKeys,
        seenSessions: newSeenSessions,
        contributors: newSeenSessions.length,
        startedAt: currentState.startedAt,
        lastMoveAt: isoNow,
        outcome: finalOutcome,
      };

      currentState = newState;

      return {
        ok: true,
        state: cloneState(newState),
        notation: result.notation,
        outcome: finalOutcome,
      };
    },

    serialize(): ArbiterState<P> {
      return cloneState(currentState);
    },

    publicView(opts?: { historyLimit?: number }): PublicView {
      const limit = opts?.historyLimit ?? 10;
      const slicedHistory = currentState.history.slice(-limit);

      return {
        schemaVersion: 1,
        version: currentState.version,
        position: currentState.position,
        sideToMove: currentState.sideToMove,
        history: slicedHistory,
        contributors: currentState.contributors,
        startedAt: currentState.startedAt,
        lastMoveAt: currentState.lastMoveAt,
        outcome: currentState.outcome ? { ...currentState.outcome } : null,
      };
    },
  };
}
