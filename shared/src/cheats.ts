/**
 * Optional cheats, modelled on the three cheats in the Star Wars Outlaws version: Nix Peek,
 * Double Draw and Magnetic Dice. Every attempt risks being caught; getting caught is public and
 * costs an escalating fine.
 */
export type CheatId = 'peek' | 'doubleDraw' | 'magneticDice';

export interface CheatDef {
  id: CheatId;
  name: string;
  /** One-line rules text shown in the UI. */
  text: string;
  /** When it can be used. */
  when: string;
}

export const CHEATS: Record<CheatId, CheatDef> = {
  peek: {
    id: 'peek',
    name: 'Peek',
    text: "Secretly look at one opponent's hand. You see it as it is right now, for the rest of the round.",
    when: 'Your turn, before you stand or draw',
  },
  doubleDraw: {
    id: 'doubleDraw',
    name: 'Double Draw',
    text: 'Draw two cards from a deck instead of one, keep the best of the three, and slip the spare back into the deck.',
    when: 'Your turn, instead of a normal deck draw (costs the usual chip)',
  },
  magneticDice: {
    id: 'magneticDice',
    name: 'Magnetic Dice',
    text: 'Nudge one of your Impostor dice up or down by 1 before you choose.',
    when: 'At the reveal, once per Impostor',
  },
};

export const ALL_CHEAT_IDS: readonly CheatId[] = ['peek', 'doubleDraw', 'magneticDice'];

/** Chance that any single cheat attempt is caught. */
export const CHEAT_CATCH_CHANCE = 0.25;

/** Fine for being caught: 1 chip the first time, 2 the second, and so on (paid into your own pot). */
export function cheatFine(timesCaughtIncludingThisOne: number): number {
  return Math.max(1, timesCaughtIncludingThisOne);
}

export function isCheatId(v: unknown): v is CheatId {
  return v === 'peek' || v === 'doubleDraw' || v === 'magneticDice';
}
