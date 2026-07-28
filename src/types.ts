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
  history: string[];
  positionKeys: string[];
  seenSessions: string[];
  contributors: number;
  startedAt: string;
  lastMoveAt: string;
  outcome: Outcome | null;
};

export type Rules<P, M> = {
  initial(): { position: P; sideToMove: Side };

  applyMove(position: P, move: M):
    | { ok: false }
    | {
        ok: true;
        position: P;
        sideToMove: Side;
        notation: string;
        positionKey: string;
        outcome: Outcome | null;
      };
};

export type PublicView = {
  schemaVersion: 1;
  version: number;
  position: unknown;
  sideToMove: Side;
  history: string[];
  contributors: number;
  startedAt: string;
  lastMoveAt: string;
  outcome: Outcome | null;
};

export type ArbiterConfig<P, M> = {
  rules: Rules<P, M>;
  state?: ArbiterState<P>;
  now: number;
  stallAfterMs?: number;
};

export type Arbiter<P, M> = {
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
