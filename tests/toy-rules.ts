import type { Rules, Side } from "../src/types.js";

export type ToyPosition = {
  counter: number;
};

export type ToyMove = {
  action: "inc" | "repeat_key" | "resign";
  value?: number;
  forcedKey?: string;
};

export const toyRules: Rules<ToyPosition, ToyMove> = {
  initial() {
    return {
      position: { counter: 0 },
      sideToMove: "white",
    };
  },

  applyMove(position, move) {
    if (!move || !move.action) {
      return { ok: false };
    }

    const nextSide: Side = position.counter % 2 === 0 ? "black" : "white";

    if (move.action === "resign") {
      const winner: Side = position.counter % 2 === 0 ? "black" : "white";
      return {
        ok: true,
        position: { counter: position.counter },
        sideToMove: nextSide,
        notation: "Resign",
        positionKey: `key-${position.counter}`,
        outcome: { kind: "win", winner, by: "resignation" },
      };
    }

    if (move.action === "repeat_key") {
      const key = move.forcedKey ?? "static-key";
      return {
        ok: true,
        position: { counter: position.counter + 1 },
        sideToMove: nextSide,
        notation: "RepeatKey",
        positionKey: key,
        outcome: null,
      };
    }

    if (move.action === "inc") {
      const step = move.value ?? 1;
      if (step <= 0) {
        return { ok: false };
      }
      const newCounter = position.counter + step;
      return {
        ok: true,
        position: { counter: newCounter },
        sideToMove: nextSide,
        notation: `+${step}`,
        positionKey: `pos-${newCounter}`,
        outcome: null,
      };
    }

    return { ok: false };
  },
};
