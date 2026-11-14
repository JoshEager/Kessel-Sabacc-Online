import { buildDeck, SUITS, type Card, type Suit } from './cards';
import { bestImpostorChoices, resolveHand, type DicePair, type ImpostorChoiceIndex, type ResolvedHand } from './evaluate';
import { bestPrimeChoice, DRAW_COST, DRAW_SOURCES, sourceIsDeck, sourceSuit, type DrawSource, type GameAction } from './engine';
import type { Rng } from './rng';
import { SHIFT_TOKENS, type ShiftTokenId } from './tokens';
import { viewCanDrawFrom, viewTokenBlockReason, viewTokenTargets, type GameView, type PlayerView } from './view';

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
    const best = bestImpostorChoices(hand.sand, hand.blood, dice, fixed, view.rules);
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

  if (view.phase === 'primeChoice' && view.pendingPrime?.playerId === myId) {
    return { type: 'choosePrime', choice: bestPrimeChoice(hand, view.pendingPrime.dice, view.rules) };
  }

  if (view.phase !== 'turn' || view.currentPlayerId !== myId) return null;
  const plan = planDraw(view, me, hand, rng);

  if (!view.tokenPlayedThisTurn && me.tokens.length > 0) {
    const t = level === 'easy' ? easyToken(view, myId, rng) : chooseToken(view, me, hand, plan, rng);
    if (t) return t;
  }

  const canPay = view.freeDraw || me.chips >= DRAW_COST;
  if (me.embargoed || !canPay || plan.sources.length === 0) return { type: 'stand' };

  if (level === 'easy') {
    if (rng() < 0.35) return { type: 'stand' };
    return { type: 'draw', source: pick(plan.sources, rng) };
  }

  if (plan.source && (plan.gain > plan.cost || (view.freeDraw && plan.gain > 0.5))) {
    return { type: 'draw', source: plan.source };
  }
  return { type: 'stand' };
}

interface DrawPlan {
  sources: DrawSource[];
  current: number;
  source: DrawSource | null;
  gain: number;
  cost: number;
}

/** Normal bot's expected-value draw analysis. */
function planDraw(view: GameView, me: PlayerView, hand: { sand: Card; blood: Card }, rng: Rng): DrawPlan {
  const sources = DRAW_SOURCES.filter((s) => viewCanDrawFrom(view, s));
  const current = strengthOf(hand);
  // A draw costs a chip (lost if we lose). Be more careful when the stack is short.
  let cost = 3;
  if (me.chips <= 1) cost += 20;
  else if (me.chips <= 2) cost += 10;
  else if (me.chips <= 4) cost += 4;
  // Weak hands on the last turn have nothing left to lose by trying.
  if (view.turnNumber === view.turnsPerRound && current < 30) cost -= 2;
  // A pair of 5s or better is worth keeping.
  if (current >= 76) return { sources, current, source: null, gain: 0, cost };

  let source: DrawSource | null = null;
  let gain = -Infinity;
  for (const s of sources) {
    const g = expectedStrengthAfterDraw(view, me.id, s) - current + rng() * 0.5;
    if (g > gain) {
      gain = g;
      source = s;
    }
  }
  return { sources, current, source, gain, cost };
}

function opponents(view: GameView, myId: string): PlayerView[] {
  return view.turnOrder
    .filter((id) => id !== myId)
    .map((id) => view.players.find((p) => p.id === id) as PlayerView)
    .filter((p) => p && !p.eliminated);
}

function richest(ids: string[], view: GameView): string | null {
  let best: PlayerView | null = null;
  for (const id of ids) {
    const p = view.players.find((x) => x.id === id);
    if (p && (!best || p.chips > best.chips)) best = p;
  }
  return best?.id ?? null;
}

/** Easy bots fire off a random playable token now and then. */
function easyToken(view: GameView, myId: string, rng: Rng): GameAction | null {
  if (rng() > 0.25) return null;
  const me = view.players.find((p) => p.id === myId) as PlayerView;
  const playable = me.tokens.filter((t) => viewTokenBlockReason(view, myId, t) === null);
  if (playable.length === 0) return null;
  const token = pick(playable, rng);
  if (SHIFT_TOKENS[token].target === 'none') return { type: 'playToken', token };
  return { type: 'playToken', token, targetId: pick(viewTokenTargets(view, myId, token), rng) };
}

/** Normal bots play a token when its situation is clearly favourable. */
function chooseToken(
  view: GameView,
  me: PlayerView,
  hand: { sand: Card; blood: Card },
  plan: DrawPlan,
  rng: Rng,
): GameAction | null {
  const myId = me.id;
  const ok = (t: ShiftTokenId) => me.tokens.includes(t) && viewTokenBlockReason(view, myId, t) === null;
  const play = (token: ShiftTokenId, targetId?: string): GameAction =>
    targetId ? { type: 'playToken', token, targetId } : { type: 'playToken', token };
  const opps = opponents(view, myId);
  const vulnerable = opps.filter((o) => !o.immune);
  const turn = view.turnNumber;
  const kinds = [hand.sand.kind, hand.blood.kind];
  const nums = [hand.sand, hand.blood].filter((c) => c.kind === 'number').map((c) => c.value);
  const naturalPair = nums.length === 2 && nums[0] === nums[1] ? nums[0] : null;
  const sylopPair = kinds.includes('sylop') && nums.length === 1 && !view.rules.markdown ? nums[0] : null;
  const pairValue = naturalPair ?? sylopPair;
  const chipsOf = (id: string) => view.players.find((p) => p.id === id)?.chips ?? 0;

  // Chips back / chips saved.
  if (ok('extraRefund') && (me.invested >= 3 || (turn === 3 && me.invested >= 2))) return play('extraRefund');
  if (ok('refund') && (me.invested >= 2 || (turn === 3 && me.invested >= 1))) return play('refund');
  if (ok('freeDraw') && plan.source && plan.gain > 0.5 && plan.gain <= plan.cost + 6) return play('freeDraw');

  // Rule changes that favour our hand.
  if (ok('majorFraud') && !view.rules.majorFraud && kinds.includes('impostor')) {
    const other = hand.sand.kind === 'impostor' ? hand.blood : hand.sand;
    if (other.kind !== 'number' || other.value === 6) return play('majorFraud');
  }
  if (ok('cookTheBooks') && pairValue !== null) {
    if (!view.rules.cookTheBooks && pairValue >= 4 && view.rules.primeValue !== pairValue) return play('cookTheBooks');
    if (view.rules.cookTheBooks && pairValue <= 3) return play('cookTheBooks');
  }
  if (ok('primeSabacc') && pairValue !== null && turn >= 2 && view.rules.primeValue !== pairValue) return play('primeSabacc');
  if (ok('markdown') && !view.rules.markdown && !kinds.includes('sylop') && turn === 3 && rng() < 0.6) {
    const sylopsGone = view.discards.sand.concat(view.discards.blood).filter((c) => c.kind === 'sylop').length;
    if (sylopsGone < 2) return play('markdown');
  }

  // Swap away a bad hand for one an opponent kept.
  const stoodTargets = (t: ShiftTokenId) =>
    viewTokenTargets(view, myId, t).filter((id) => view.players.find((p) => p.id === id)?.lastAction === 'stand');
  if (ok('directTransaction') && turn === 3 && plan.current < 30) {
    const t = stoodTargets('directTransaction');
    if (t.length) return play('directTransaction', pick(t, rng));
  }
  if (ok('exhaustion') && turn >= 2 && plan.current < 70) {
    const t = stoodTargets('exhaustion');
    if (t.length) return play('exhaustion', richest(t, view) as string);
  }

  // Taxes and pot raids.
  if (ok('targetAudit')) {
    const t = viewTokenTargets(view, myId, 'targetAudit').filter((id) => chipsOf(id) > 0);
    if (t.length) return play('targetAudit', richest(t, view) as string);
  }
  const standingVictims = vulnerable.filter((o) => o.lastAction === 'stand' && o.chips > 0).length;
  if (ok('generalAudit') && standingVictims >= (opps.length > 1 ? 2 : 1)) return play('generalAudit');
  if (ok('embezzlement') && vulnerable.filter((o) => o.invested > 0).length >= 2) return play('embezzlement');
  if (ok('generalTariff') && vulnerable.some((o) => o.chips > 0) && rng() < 0.6) return play('generalTariff');
  if (ok('targetTariff') && rng() < 0.6) {
    const t = viewTokenTargets(view, myId, 'targetTariff').filter((id) => chipsOf(id) > 0);
    if (t.length) return play('targetTariff', richest(t, view) as string);
  }

  // Defence and tempo.
  if (ok('embargo') && view.nextTurnPlayerId && view.nextTurnPlayerId !== myId && (turn <= 2 || rng() < 0.4)) {
    const next = view.players.find((p) => p.id === view.nextTurnPlayerId);
    if (next && !next.immune) return play('embargo');
  }
  if (ok('immunity') && (me.chips <= 4 || (turn === 1 && rng() < 0.3))) return play('immunity');
  return null;
}
