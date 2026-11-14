import { describe, expect, it } from 'vitest';
import {
  assignPlaces,
  bestImpostorChoices,
  compareHands,
  findWinners,
  penaltyFor,
  resolveHand,
  type ResolvedHand,
} from '../src/evaluate';
import { buildDeck, DECK_SIZE } from '../src/cards';
import { c } from './helpers';

const better = (a: ResolvedHand, b: ResolvedHand) => expect(compareHands(a, b)).toBeLessThan(0);

describe('decks', () => {
  it('has 22 cards per suit: 3× each of 1–6, 3 Impostors, 1 Sylop', () => {
    for (const suit of ['sand', 'blood'] as const) {
      const d = buildDeck(suit);
      expect(d).toHaveLength(DECK_SIZE);
      expect(d).toHaveLength(22);
      for (let v = 1; v <= 6; v++) expect(d.filter((x) => x.kind === 'number' && x.value === v)).toHaveLength(3);
      expect(d.filter((x) => x.kind === 'impostor')).toHaveLength(3);
      expect(d.filter((x) => x.kind === 'sylop')).toHaveLength(1);
      expect(new Set(d.map((x) => x.id)).size).toBe(22);
      expect(d.every((x) => x.suit === suit)).toBe(true);
    }
  });
});

describe('resolveHand', () => {
  it('two Sylops are Pure Sabacc', () => {
    const r = resolveHand(c('S', 'S'), c('B', 'S'));
    expect(r.category).toBe('pure');
    expect(r.isSabacc).toBe(true);
    expect(r.label).toBe('Pure Sabacc');
  });

  it('a pair of 1s is Prime Sabacc', () => {
    const r = resolveHand(c('S', 1), c('B', 1));
    expect(r.category).toBe('prime');
    expect(r.pairValue).toBe(1);
  });

  it('any other pair is Sabacc', () => {
    const r = resolveHand(c('S', 4), c('B', 4));
    expect(r.category).toBe('sabacc');
    expect(r.pairValue).toBe(4);
    expect(r.difference).toBe(0);
  });

  it('non-pairs score their difference and sum', () => {
    const r = resolveHand(c('S', 2), c('B', 6));
    expect(r.category).toBe('none');
    expect(r.difference).toBe(4);
    expect(r.sum).toBe(8);
  });

  it('Sylop copies the other card (Sylop + 1 = Prime Sabacc)', () => {
    expect(resolveHand(c('S', 'S'), c('B', 1)).category).toBe('prime');
    const r = resolveHand(c('S', 5), c('B', 'S'));
    expect(r.category).toBe('sabacc');
    expect(r.bloodValue).toBe(5);
    expect(r.pairValue).toBe(5);
  });

  it('Impostor uses its chosen value', () => {
    const r = resolveHand(c('S', 'I'), c('B', 3), { sand: 3 });
    expect(r.category).toBe('sabacc');
    expect(r.pairValue).toBe(3);
    const r2 = resolveHand(c('S', 'I'), c('B', 3), { sand: 6 });
    expect(r2.difference).toBe(3);
  });

  it('Sylop + Impostor: Sylop copies the Impostor’s chosen value', () => {
    const r = resolveHand(c('S', 'S'), c('B', 'I'), { blood: 2 });
    expect(r.sandValue).toBe(2);
    expect(r.bloodValue).toBe(2);
    expect(r.category).toBe('sabacc');
    expect(resolveHand(c('S', 'I'), c('B', 'S'), { sand: 1 }).category).toBe('prime');
  });

  it('two Impostors each use their own chosen value', () => {
    expect(resolveHand(c('S', 'I'), c('B', 'I'), { sand: 4, blood: 4 }).category).toBe('sabacc');
    const r = resolveHand(c('S', 'I'), c('B', 'I'), { sand: 1, blood: 3 });
    expect(r.category).toBe('none');
    expect(r.difference).toBe(2);
  });

  it('throws when an Impostor has no value', () => {
    expect(() => resolveHand(c('S', 'I'), c('B', 3))).toThrow();
    expect(() => resolveHand(c('S', 'I'), c('B', 3), { sand: 7 })).toThrow();
  });

  it('rejects hands that are not one Sand + one Blood', () => {
    expect(() => resolveHand(c('B', 3), c('B', 3))).toThrow();
  });
});

describe('ranking', () => {
  const pure = resolveHand(c('S', 'S'), c('B', 'S'));
  const prime = resolveHand(c('S', 1), c('B', 1));
  const primeSylop = resolveHand(c('S', 'S'), c('B', 1));
  const twos = resolveHand(c('S', 2), c('B', 2));
  const threes = resolveHand(c('S', 3), c('B', 3));
  const sixes = resolveHand(c('S', 6), c('B', 6));
  const diff1 = resolveHand(c('S', 1), c('B', 2));
  const diff5 = resolveHand(c('S', 1), c('B', 6));

  it('Pure > Prime > other Sabacc > No Sabacc', () => {
    better(pure, prime);
    better(pure, primeSylop);
    better(prime, twos);
    better(twos, diff1);
  });

  it('lower pairs beat higher pairs', () => {
    better(twos, threes);
    better(threes, sixes);
  });

  it('any Sabacc beats any non-Sabacc', () => {
    better(sixes, diff1);
  });

  it('lower difference wins', () => {
    better(diff1, diff5);
  });

  it('Prime with a Sylop ties a natural Prime', () => {
    expect(compareHands(prime, primeSylop)).toBe(0);
  });

  it('equal difference: lower sum wins', () => {
    const low = resolveHand(c('S', 1), c('B', 3)); // diff 2, sum 4
    const high = resolveHand(c('S', 4), c('B', 6)); // diff 2, sum 10
    better(low, high);
  });

  it('exact ties share the win', () => {
    const a = resolveHand(c('S', 2), c('B', 5));
    const b = resolveHand(c('S', 5), c('B', 2));
    const d = resolveHand(c('S', 1), c('B', 6));
    expect(compareHands(a, b)).toBe(0);
    expect(findWinners([{ id: 'a', hand: a }, { id: 'b', hand: b }, { id: 'd', hand: d }])).toEqual(['a', 'b']);
    expect(assignPlaces([{ id: 'a', hand: a }, { id: 'b', hand: b }, { id: 'd', hand: d }])).toEqual({ a: 1, b: 1, d: 3 });
  });
});

describe('penalties', () => {
  it('a losing Sabacc pays 1, others pay their difference', () => {
    expect(penaltyFor(resolveHand(c('S', 6), c('B', 6)))).toBe(1);
    expect(penaltyFor(resolveHand(c('S', 'S'), c('B', 'S')))).toBe(1);
    expect(penaltyFor(resolveHand(c('S', 2), c('B', 6)))).toBe(4);
  });
});

describe('bestImpostorChoices', () => {
  it('picks the die that makes a pair', () => {
    expect(bestImpostorChoices(c('S', 'I'), c('B', 4), { sand: [2, 4] })).toEqual({ sand: 1 });
    expect(bestImpostorChoices(c('S', 5), c('B', 'I'), { blood: [5, 6] })).toEqual({ blood: 0 });
  });

  it('with a Sylop, picks the lowest die (lowest pair)', () => {
    expect(bestImpostorChoices(c('S', 'S'), c('B', 'I'), { blood: [6, 1] })).toEqual({ blood: 1 });
  });

  it('picks jointly for two Impostors', () => {
    expect(bestImpostorChoices(c('S', 'I'), c('B', 'I'), { sand: [3, 5], blood: [6, 5] })).toEqual({ sand: 1, blood: 1 });
    // No pair possible: smallest difference, then smallest sum
    expect(bestImpostorChoices(c('S', 'I'), c('B', 'I'), { sand: [1, 6], blood: [2, 5] })).toEqual({ sand: 0, blood: 0 });
  });

  it('respects choices already fixed', () => {
    expect(bestImpostorChoices(c('S', 'I'), c('B', 'I'), { sand: [3, 5], blood: [3, 4] }, { sand: 1 })).toEqual({ sand: 1, blood: 1 });
  });
});
