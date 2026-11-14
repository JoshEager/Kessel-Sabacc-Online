import { buildDeck, SUITS, type Card, type Suit } from './cards';
import { bestImpostorChoices, resolveHand, type DicePair, type ImpostorChoiceIndex, type ResolvedHand } from './evaluate';
import { DRAW_COST, DRAW_SOURCES, sourceIsDeck, sourceSuit, type DrawSource, type GameAction } from './engine';
import type { Rng } from './rng';
import { viewCanDrawFrom, type GameView } from './view';

export type BotLevel = 'easy' | 'normal';

export const BOT_NAMES = [
  'Vexa Dorn',
  'Krell',
  'T3-K9',
  'Oru Saddik',
  'Mags Tellivan',
  'Jarro Vint',
  'Q7-Lux',
  'Ysolde Kael',
  'Brakk Venn',
  'Nima Throsk',
  'Corvo Delassi',
  'R0-Bix',
];

/** A card reduced to what matters for strength: 1–6, Impostor or Sylop. */
type Key = number | 'I' | 'S';

function keyOf(card: Card): Key {
  if (card.kind === 'impostor') return 'I';
  if (card.kind === 'sylop') return 'S';
  return card.value;
}

function fakeCard(suit: Suit, key: Key): Card {
  if (key === 'I') return { id: `x${suit}I`, suit, kind: 'impostor', value: 0 };
  if (key === 'S') return { id: `x${suit}S`, suit, kind: 'sylop', value: 0 };
  return { id: `x${suit}${key}`, suit, kind: 'number', value: key };
}

/** Maps a resolved hand to a 0–100 strength score (roughly: how often it wins, and how cheaply it loses). */
export function scoreResolved(r: ResolvedHand): number {
  if (r.category === 'pure') return 100;
  if (r.isSabacc) return 92 - ((r.pairValue ?? 1) - 1) * 4; // 1s = 92 … 6s = 72
  return 55 - r.difference * 9 - r.sum * 0.4; // diff 1 ≈ 44, diff 5 ≈ 7
}

const ALL_DICE: DicePair[] = [];
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) ALL_DICE.push([a, b]);

const strengthMemo = new Map<string, number>();

/**
 * Expected strength of a hand before the reveal. Impostors are averaged over every dice
 * roll (taking the best die each time), with a small penalty for their uncertainty.
 */
export function handStrength(sandKey: Key, bloodKey: Key): number {
  const memoKey = `${sandKey}|${bloodKey}`;
  const cached = strengthMemo.get(memoKey);
  if (cached !== undefined) return cached;
  const sand = fakeCard('sand', sandKey);
  const blood = fakeCard('blood', bloodKey);
  const sandRolls = sandKey === 'I' ? ALL_DICE : [null];
  const bloodRolls = bloodKey === 'I' ? ALL_DICE : [null];
  let total = 0;
  let n = 0;
  for (const sr of sandRolls) {
    for (const br of bloodRolls) {
      const rolls: Partial<Record<Suit, DicePair>> = {};
      if (sr) rolls.sand = sr;
      if (br) rolls.blood = br;
      const choice = bestImpostorChoices(sand, blood, rolls);
      const imp: Partial<Record<Suit, number>> = {};
      if (sr) imp.sand = sr[choice.sand ?? 0];
      if (br) imp.blood = br[choice.blood ?? 0];
      total += scoreResolved(resolveHand(sand, blood, imp));
      n++;
    }
  }
  let score = total / n;
  const impostorCount = (sandKey === 'I' ? 1 : 0) + (bloodKey === 'I' ? 1 : 0);
  score -= impostorCount * 3; // risk aversion: Impostors are a gamble
  strengthMemo.set(memoKey, score);
  return score;
}

export function strengthOf(hand: { sand: Card; blood: Card }): number {
  return handStrength(keyOf(hand.sand), keyOf(hand.blood));
}

function withCard(hand: { sand: Card; blood: Card }, card: Card): { sand: Card; blood: Card } {
  return card.suit === 'sand' ? { sand: card, blood: hand.blood } : { sand: hand.sand, blood: card };
}

/** Cards of a suit whose location this seat can't see (deck + other players' hidden hands). */
export function unseenCards(view: GameView, myId: string, suit: Suit): Card[] {
  const me = view.players.find((p) => p.id === myId);
  const known = new Set<string>();
  for (const c of view.discards[suit]) known.add(c.id);
  const mine = me?.hand?.[suit];
  if (mine) known.add(mine.id);
  for (const p of view.players) {
    const c = p.hand?.[suit];
    if (c) known.add(c.id);
  }
  if (view.pendingDraw?.card) known.add(view.pendingDraw.card.id);
  return buildDeck(suit).filter((c) => !known.has(c.id));
}

/** Expected strength after drawing from `source` and keeping the better card. */
export function expectedStrengthAfterDraw(view: GameView, myId: string, source: DrawSource): number {
  const me = view.players.find((p) => p.id === myId);
  const hand = me?.hand;
  if (!hand?.sand || !hand.blood) return 0;
  const h = { sand: hand.sand, blood: hand.blood };
  const current = strengthOf(h);
  const suit = sourceSuit(source);
  let candidates: Card[];
  if (sourceIsDeck(source)) {
    candidates = unseenCards(view, myId, suit);
  } else {
    const pile = view.discards[suit];
    candidates = pile.length ? [pile[pile.length - 1]] : [];
  }
  if (candidates.length === 0) return current;
  let total = 0;
  for (const c of candidates) total += Math.max(current, strengthOf(withCard(h, c)));
  return total / candidates.length;
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(rng() * items.length)];
}

/**
 * Decides a bot's next action using only the information in its own seat's view.
 * Returns null when the bot has nothing to do.
 */
export function decideBotAction(view: GameView, myId: string, level: BotLevel, rng: Rng): GameAction | null {
  const me = view.players.find((p) => p.id === myId);
  if (!me || me.eliminated || !me.hand?.sand || !me.hand.blood) return null;
  const hand = { sand: me.hand.sand, blood: me.hand.blood };

  // Impostor dice: always take the best value.
  if (view.phase === 'impostor') {
    const rolls = view.impostorRolls[myId];
    if (!rolls) return null;
    const dice: Partial<Record<Suit, DicePair>> = {};
    const fixed: Partial<Record<Suit, ImpostorChoiceIndex>> = {};
    for (const s of SUITS) {
      const r = rolls[s];
      if (!r) continue;
      dice[s] = r.dice;
      if (r.choice !== null) fixed[s] = r.choice;
    }
    const best = bestImpostorChoices(hand.sand, hand.blood, dice, fixed);
    for (const s of SUITS) {
      const r = rolls[s];
      if (r && r.choice === null) return { type: 'chooseImpostor', suit: s, choice: best[s] ?? 0 };
    }
    return null;
  }

  if (view.phase === 'discard' && view.pendingDraw?.playerId === myId && view.pendingDraw.card) {
    const drawn = view.pendingDraw.card;
    const keepDrawn = strengthOf(withCard(hand, drawn));
    const keepHeld = strengthOf(hand);
    if (level === 'easy' && rng() < 0.5) return { type: 'discard', card: rng() < 0.5 ? 'drawn' : 'held' };
    return { type: 'discard', card: keepDrawn > keepHeld ? 'held' : 'drawn' };
  }

  if (view.phase !== 'turn' || view.currentPlayerId !== myId) return null;
  const sources = DRAW_SOURCES.filter((s) => viewCanDrawFrom(view, s));
  if (me.chips < DRAW_COST || sources.length === 0) return { type: 'stand' };

  if (level === 'easy') {
    if (rng() < 0.35) return { type: 'stand' };
    return { type: 'draw', source: pick(sources, rng) };
  }

  // Normal: expected value.
  const current = strengthOf(hand);
  if (current >= 76) return { type: 'stand' }; // a pair of 5s or better is worth keeping
  // A draw costs a chip (lost if we lose). Be more careful when the stack is short.
  let cost = 3;
  if (me.chips <= 1) cost += 20;
  else if (me.chips <= 2) cost += 10;
  else if (me.chips <= 4) cost += 4;
  // Weak hands on the last turn have nothing left to lose by trying.
  if (view.turnNumber === view.turnsPerRound && current < 30) cost -= 2;

  let bestSource: DrawSource | null = null;
  let bestGain = -Infinity;
  for (const s of sources) {
    const gain = expectedStrengthAfterDraw(view, myId, s) - current + rng() * 0.5;
    if (gain > bestGain) {
      bestGain = gain;
      bestSource = s;
    }
  }
  if (bestSource && bestGain > cost) return { type: 'draw', source: bestSource };
  return { type: 'stand' };
}
