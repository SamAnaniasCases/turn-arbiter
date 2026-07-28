import { Chess, type Square } from "chess.js";
import type { Outcome, Rules, Side } from "./types.js";

export type ChessMove = string | { from: Square; to: Square; promotion?: string };

export const chessRules: Rules<string, ChessMove> = {
  initial(): { position: string; sideToMove: Side } {
    const chess = new Chess();
    return {
      position: chess.fen(),
      sideToMove: "white",
    };
  },

  applyMove(position: string, move: ChessMove) {
    try {
      const chess = new Chess(position);
      const moveResult = chess.move(move);
      if (!moveResult) {
        return { ok: false };
      }

      const sideToMove: Side = chess.turn() === "w" ? "white" : "black";
      const notation = moveResult.san;
      // Position key includes board layout, active color, castling rights, and en passant square
      const positionKey = chess.fen().split(" ").slice(0, 4).join(" ");

      let outcome: Outcome | null = null;

      if (chess.isCheckmate()) {
        const winner: Side = chess.turn() === "w" ? "black" : "white";
        outcome = { kind: "win", winner, by: "checkmate" };
      } else if (chess.isStalemate()) {
        outcome = { kind: "draw", by: "stalemate" };
      } else if (chess.isThreefoldRepetition()) {
        outcome = { kind: "draw", by: "repetition" };
      } else if (chess.isDrawByFiftyMoves()) {
        outcome = { kind: "draw", by: "fifty-move" };
      } else if (chess.isInsufficientMaterial()) {
        outcome = { kind: "draw", by: "insufficient-material" };
      }

      return {
        ok: true,
        position: chess.fen(),
        sideToMove,
        notation,
        positionKey,
        outcome,
      };
    } catch {
      return { ok: false };
    }
  },
};
