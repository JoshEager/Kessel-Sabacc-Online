import type { Card, Suit } from '../src/cards';
import { createGame, type GameState } from '../src/engine';
import { createRng, type Rng } from '../src/rng';

let uid = 0;
/** Card factory: c('S', 5), c('B', 'I'), c('S', 'S') */
export function c(suit: 'S' | 'B', v: number | 'I' | 'S'): Card {
  const s: Suit = suit === 'S' ? 'sand' : 'blood';
  uid++;
  if (v === 'I') return { id: `t${suit}I${uid}`, suit: s, kind: 'impostor', value: 0 };
  if (v === 'S') return { id: `t${suit}S${uid}`, suit: s, kind: 'sylop', value: 0 };
  return { id: `t${suit}${v}-${uid}`, suit: s, kind: 'number', value: v };
}

/** An RNG that yields the given die faces in order (then falls back to a seeded RNG). */
export function diceRng(faces: number[], fallbackSeed = 1): Rng {
  const queue = faces.slice();
  const fb = createRng(fallbackSeed);
  return () => {
    const f = queue.shift();
    return f === undefined ? fb() : (f - 1) / 6 + 0.01;
  };
}

export function players(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
}

export interface SeatSetup {
  hand: [Card, Card];
  chips?: number;
  invested?: number;
}

/**
 * Creates a game whose players hold the given hands, positioned on the very last turn of the
 * round so that one `stand` by `lastActor(state)` triggers the reveal.
 */
export function atLastTurn(setups: SeatSetup[], startingChips = 8): GameState {
  const state = createGame(players(setups.length), { startingChips }, createRng(42));
  setups.forEach((s, i) => {
    const p = state.players[i];
    p.hand = { sand: s.hand[0], blood: s.hand[1] };
    if (s.chips !== undefined) p.chips = s.chips;
    if (s.invested !== undefined) p.invested = s.invested;
  });
  state.turnIndex = state.turnOrder.length * 3 - 1;
  state.phase = 'turn';
  return state;
}

export function lastActor(state: GameState): string {
  return state.turnOrder[state.turnOrder.length - 1];
}
