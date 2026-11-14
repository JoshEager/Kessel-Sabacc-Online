import type { Card, Suit } from './cards';

export type HandCategory = 'pure' | 'prime' | 'sabacc' | 'none';

/** Lexicographic rank: lower is better at every position. */
export type RankTuple = [number, number, number];

export interface ResolvedHand {
  /** Final value used for each card after Impostor / Sylop resolution (0 for Pure Sabacc). */
  sandValue: number;
  bloodValue: number;
  category: HandCategory;
  isSabacc: boolean;
  /** Value of the pair for Sabacc hands. */
  pairValue: number | null;
  difference: number;
  sum: number;
  rank: RankTuple;
  label: string;
  /** Human-readable notes on how special cards resolved. */
  notes: string[];
}

/** Values chosen for Impostor cards, by suit. */
export type ImpostorValues = Partial<Record<Suit, number>>;

function baseValue(card: Card, imp: ImpostorValues): number | null {
  if (card.kind === 'number') return card.value;
  if (card.kind === 'impostor') {
    const v = imp[card.suit];
    if (v === undefined || !Number.isInteger(v) || v < 1 || v > 6) {
      throw new Error(`Impostor in ${card.suit} needs a chosen value 1–6`);
    }
    return v;
  }
  return null; // Sylop
}

/**
 * Resolves a 1 Sand + 1 Blood hand into its final values, category and rank.
 * Impostor values must be supplied for every Impostor in the hand.
 */
export function resolveHand(sand: Card, blood: Card, imp: ImpostorValues = {}): ResolvedHand {
  if (sand.suit !== 'sand' || blood.suit !== 'blood') {
    throw new Error('A hand must be exactly one Sand card and one Blood card');
  }
  const notes: string[] = [];
  let s = baseValue(sand, imp);
  let b = baseValue(blood, imp);
  if (sand.kind === 'impostor') notes.push(`Sand Impostor chose ${s}`);
  if (blood.kind === 'impostor') notes.push(`Blood Impostor chose ${b}`);

  if (s === null && b === null) {
    notes.push('Two Sylops');
    return {
      sandValue: 0,
      bloodValue: 0,
      category: 'pure',
      isSabacc: true,
      pairValue: 0,
      difference: 0,
      sum: 0,
      rank: [0, 0, 0],
      label: 'Pure Sabacc',
      notes,
    };
  }
  if (s === null) {
    s = b as number;
    notes.push(`Sand Sylop copies ${s}`);
  }
  if (b === null) {
    b = s;
    notes.push(`Blood Sylop copies ${b}`);
  }

  if (s === b) {
    const prime = s === 1;
    return {
      sandValue: s,
      bloodValue: b,
      category: prime ? 'prime' : 'sabacc',
      isSabacc: true,
      pairValue: s,
      difference: 0,
      sum: s + b,
      rank: [1, s, 0],
      label: prime ? 'Prime Sabacc' : `Sabacc (pair of ${s}s)`,
      notes,
    };
  }

  const difference = Math.abs(s - b);
  const sum = s + b;
  return {
    sandValue: s,
    bloodValue: b,
    category: 'none',
    isSabacc: false,
    pairValue: null,
    difference,
    sum,
    rank: [2, difference, sum],
    label: `No Sabacc (difference ${difference})`,
    notes,
  };
}

/** Negative if `a` is the better hand, positive if `b` is, 0 if exactly tied. */
export function compareRank(a: RankTuple, b: RankTuple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function compareHands(a: ResolvedHand, b: ResolvedHand): number {
  return compareRank(a.rank, b.rank);
}

/** Penalty a losing hand pays: 1 for a Sabacc, otherwise its difference. */
export function penaltyFor(hand: ResolvedHand): number {
  return hand.isSabacc ? 1 : hand.difference;
}

/** Returns the ids of every hand tied for best. */
export function findWinners<T extends { id: string; hand: ResolvedHand }>(entries: T[]): string[] {
  if (entries.length === 0) return [];
  let best = entries[0].hand.rank;
  for (const e of entries) if (compareRank(e.hand.rank, best) < 0) best = e.hand.rank;
  return entries.filter((e) => compareRank(e.hand.rank, best) === 0).map((e) => e.id);
}

/** Assigns 1-based places (ties share a place). */
export function assignPlaces<T extends { id: string; hand: ResolvedHand }>(entries: T[]): Record<string, number> {
  const sorted = entries.slice().sort((x, y) => compareHands(x.hand, y.hand));
  const places: Record<string, number> = {};
  sorted.forEach((e, i) => {
    if (i > 0 && compareHands(e.hand, sorted[i - 1].hand) === 0) {
      places[e.id] = places[sorted[i - 1].id];
    } else {
      places[e.id] = i + 1;
    }
  });
  return places;
}

export type DicePair = [number, number];
export type ImpostorChoiceIndex = 0 | 1;

/**
 * Picks the dice (index 0 or 1 per Impostor suit) that make the best hand.
 * `fixed` holds choices already locked in; they are respected.
 */
export function bestImpostorChoices(
  sand: Card,
  blood: Card,
  rolls: Partial<Record<Suit, DicePair>>,
  fixed: Partial<Record<Suit, ImpostorChoiceIndex>> = {},
): Partial<Record<Suit, ImpostorChoiceIndex>> {
  const options = (suit: Suit, card: Card): (ImpostorChoiceIndex | undefined)[] => {
    if (card.kind !== 'impostor') return [undefined];
    const f = fixed[suit];
    if (f !== undefined) return [f];
    return [0, 1];
  };
  let bestRank: RankTuple | null = null;
  let best: Partial<Record<Suit, ImpostorChoiceIndex>> = {};
  for (const sc of options('sand', sand)) {
    for (const bc of options('blood', blood)) {
      const imp: ImpostorValues = {};
      if (sc !== undefined) imp.sand = (rolls.sand as DicePair)[sc];
      if (bc !== undefined) imp.blood = (rolls.blood as DicePair)[bc];
      const r = resolveHand(sand, blood, imp).rank;
      if (bestRank === null || compareRank(r, bestRank) < 0) {
        bestRank = r;
        best = {};
        if (sc !== undefined) best.sand = sc;
        if (bc !== undefined) best.blood = bc;
      }
    }
  }
  return best;
}
