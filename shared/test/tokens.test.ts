import { describe, expect, it } from 'vitest';
import {
  applyAction,
  bestPrimeChoice,
  createGame,
  currentPlayerId,
  dealTokens,
  IllegalMoveError,
  legalActions,
  nextRound,
  timeoutActions,
  tokenBlockReason,
  type GameState,
} from '../src/engine';
import { compareHands, resolveHand } from '../src/evaluate';
import { createRng } from '../src/rng';
import { ALL_TOKEN_IDS, SHIFT_TOKENS, type ShiftTokenId } from '../src/tokens';
import { toGameView } from '../src/view';
import { atLastTurn, c, diceRng, lastActor, players } from './helpers';

const rng = () => createRng(11);

/** 3-player game where p1 acts first; p1 holds `tokens`. */
function setup(tokens: ShiftTokenId[], n = 3): { s: GameState; me: string; others: string[] } {
  const s = createGame(players(n), { startingChips: 8 }, rng(), { firstDealerIndex: 0 });
  const me = currentPlayerId(s) as string;
  s.players.find((p) => p.id === me)!.tokens = tokens.slice();
  return { s, me, others: s.turnOrder.filter((id) => id !== me) };
}
const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const play = (s: GameState, id: string, token: ShiftTokenId, targetId?: string, r = rng()) =>
  applyAction(s, id, { type: 'playToken', token, targetId }, r);

describe('dealing tokens', () => {
  it('there are 16 tokens', () => {
    expect(ALL_TOKEN_IDS).toHaveLength(16);
  });

  it('deals N distinct random tokens per player, none when off', () => {
    const s = createGame(players(4), { startingChips: 8, shiftTokens: 3 }, createRng(5));
    for (const p of s.players) {
      expect(p.tokens).toHaveLength(3);
      expect(new Set(p.tokens).size).toBe(3);
    }
    const off = createGame(players(4), { startingChips: 8 }, createRng(5));
    for (const p of off.players) expect(p.tokens).toEqual([]);
    expect(dealTokens(2, createRng(1))).toHaveLength(2);
    expect(() => createGame(players(2), { startingChips: 8, shiftTokens: 4 }, rng())).toThrow(IllegalMoveError);
  });

  it('keeps tokens private in the view', () => {
    const s = createGame(players(3), { startingChips: 8, shiftTokens: 2 }, createRng(5));
    const v = toGameView(s, 'p0');
    expect(v.players[0].tokens).toEqual(s.players[0].tokens);
    expect(v.players[1].tokens).toEqual([]);
    expect(v.players[1].tokenCount).toBe(2);
    expect(v.shiftTokensEnabled).toBe(true);
  });
});

describe('playing tokens: timing and use', () => {
  it('only on your own turn, before acting, once per turn, single use', () => {
    const { s, me, others } = setup(['generalTariff', 'refund', 'immunity']);
    expect(() => play(s, others[0], 'generalTariff')).toThrow(IllegalMoveError);
    const s2 = play(s, me, 'generalTariff');
    expect(P(s2, me).tokens).toEqual(['refund', 'immunity']);
    expect(() => play(s2, me, 'immunity')).toThrow(/already played/);
    expect(() => play(s2, me, 'generalTariff')).toThrow(/don't have/);
    // The turn continues: the player still stands or draws.
    expect(currentPlayerId(s2)).toBe(me);
    const drawn = applyAction(s2, me, { type: 'draw', source: 'sandDeck' }, rng());
    expect(() => play(drawn, me, 'immunity')).toThrow(IllegalMoveError);
  });

  it('rejects unknown tokens', () => {
    const { s, me } = setup(['refund']);
    expect(() => applyAction(s, me, { type: 'playToken', token: 'bogus' as never }, rng())).toThrow(IllegalMoveError);
  });

  it('every token text is defined', () => {
    for (const id of ALL_TOKEN_IDS) expect(SHIFT_TOKENS[id].text.length).toBeGreaterThan(5);
  });
});

describe('chip tokens', () => {
  it('Free Draw skips the draw fee and works with 0 chips', () => {
    const { s, me } = setup(['freeDraw']);
    P(s, me).chips = 0;
    expect(legalActions(s, me).some((a) => a.type === 'draw')).toBe(false);
    let t = play(s, me, 'freeDraw');
    t = applyAction(t, me, { type: 'draw', source: 'bloodDeck' }, rng());
    expect(P(t, me).chips).toBe(0);
    expect(P(t, me).invested).toBe(0);
    t = applyAction(t, me, { type: 'discard', card: 'drawn' }, rng());
    expect(t.freeDraw).toBe(false);
  });

  it('Refund / Extra Refund retrieve 2 / 3 chips from your pot (capped by the pot)', () => {
    const { s, me } = setup(['refund']);
    expect(tokenBlockReason(s, me, 'refund')).toMatch(/empty/);
    P(s, me).chips = 5;
    P(s, me).invested = 3;
    const t = play(s, me, 'refund');
    expect(P(t, me)).toMatchObject({ chips: 7, invested: 1 });
    const { s: s2, me: me2 } = setup(['extraRefund']);
    P(s2, me2).chips = 5;
    P(s2, me2).invested = 2;
    expect(P(play(s2, me2, 'extraRefund'), me2)).toMatchObject({ chips: 7, invested: 0 });
  });

  it('Embezzlement moves 1 chip from each other pot into yours', () => {
    const { s, me, others } = setup(['embezzlement']);
    P(s, others[0]).invested = 2;
    P(s, others[1]).invested = 0;
    const t = play(s, me, 'embezzlement');
    expect(P(t, others[0]).invested).toBe(1);
    expect(P(t, others[1]).invested).toBe(0);
    expect(P(t, me).invested).toBe(1);
  });
});

describe('tax tokens (chips go into the taxed player’s own pot)', () => {
  it('General Tariff taxes every other player 1 chip', () => {
    const { s, me, others } = setup(['generalTariff']);
    const t = play(s, me, 'generalTariff');
    for (const o of others) expect(P(t, o)).toMatchObject({ chips: 7, invested: 1 });
    expect(P(t, me)).toMatchObject({ chips: 8, invested: 0 });
  });

  it('Target Tariff taxes one player 2 chips; a short stack pays what it has', () => {
    const { s, me, others } = setup(['targetTariff']);
    expect(() => play(s, me, 'targetTariff')).toThrow(/target/);
    expect(() => play(s, me, 'targetTariff', me)).toThrow(/target/);
    P(s, others[0]).chips = 1;
    const t = play(s, me, 'targetTariff', others[0]);
    expect(P(t, others[0])).toMatchObject({ chips: 0, invested: 1 });
  });

  it('Audits only hit players whose last action was to stand', () => {
    const { s, me, others } = setup(['generalAudit']);
    P(s, others[0]).lastAction = 'stand';
    P(s, others[1]).lastAction = 'draw';
    const t = play(s, me, 'generalAudit');
    expect(P(t, others[0])).toMatchObject({ chips: 6, invested: 2 });
    expect(P(t, others[1])).toMatchObject({ chips: 8, invested: 0 });

    const { s: s2, me: me2, others: o2 } = setup(['targetAudit']);
    expect(tokenBlockReason(s2, me2, 'targetAudit')).toMatch(/stood/);
    P(s2, o2[1]).lastAction = 'stand';
    expect(() => play(s2, me2, 'targetAudit', o2[0])).toThrow(/target/);
    const t2 = play(s2, me2, 'targetAudit', o2[1]);
    expect(P(t2, o2[1])).toMatchObject({ chips: 5, invested: 3 });
  });

  it('tracks lastAction from real stands and draws', () => {
    let { s, me } = setup([]);
    s = applyAction(s, me, { type: 'stand' }, rng());
    expect(P(s, me).lastAction).toBe('stand');
    const next = currentPlayerId(s) as string;
    s = applyAction(s, next, { type: 'draw', source: 'sandDeck' }, rng());
    s = applyAction(s, next, { type: 'discard', card: 'drawn' }, rng());
    expect(P(s, next).lastAction).toBe('draw');
  });
});

describe('control tokens', () => {
  it('Embargo forces the next player to stand on their next turn only', () => {
    const { s, me, others } = setup(['embargo']);
    let t = play(s, me, 'embargo');
    t = applyAction(t, me, { type: 'stand' }, rng());
    const next = others[0];
    expect(currentPlayerId(t)).toBe(next);
    expect(P(t, next).embargoed).toBe(true);
    expect(legalActions(t, next)).toEqual([{ type: 'stand' }]);
    expect(() => applyAction(t, next, { type: 'draw', source: 'sandDeck' }, rng())).toThrow(/Embargo/);
    t = applyAction(t, next, { type: 'stand' }, rng());
    expect(P(t, next).embargoed).toBe(false);
  });

  it('Embargo cannot be played on the last turn of the round', () => {
    const s = atLastTurn([{ hand: [c('S', 1), c('B', 2)] }, { hand: [c('S', 3), c('B', 4)] }]);
    const last = lastActor(s);
    P(s, last).tokens = ['embargo'];
    expect(tokenBlockReason(s, last, 'embargo')).toMatch(/no next turn/);
  });

  it('Immunity blocks other players’ tokens until the reveal, but not rule changes', () => {
    const { s, me, others } = setup(['immunity']);
    let t = play(s, me, 'immunity');
    expect(P(t, me).immune).toBe(true);
    t = applyAction(t, me, { type: 'stand' }, rng());
    const attacker = currentPlayerId(t) as string;
    P(t, attacker).tokens = ['generalTariff', 'targetTariff', 'markdown'];
    expect(tokenBlockReason(t, attacker, 'targetTariff')).toBeNull(); // the third player is still a target
    const t2 = play(t, attacker, 'generalTariff');
    expect(P(t2, me)).toMatchObject({ chips: 8, invested: 0 });
    const third = others.find((o) => o !== attacker)!;
    expect(P(t2, third).invested).toBe(1);
    expect(t2.log.some((l) => /immune/.test(l.text))).toBe(true);
    // Immune players can't be targeted.
    const s3 = structuredClone(t);
    expect(() => play(s3, attacker, 'targetTariff', me)).toThrow(/target/);
  });

  it('Immunity resets at the next round', () => {
    const s = atLastTurn([{ hand: [c('S', 3), c('B', 3)] }, { hand: [c('S', 1), c('B', 4)] }]);
    s.players[0].immune = true;
    s.players[1].embargoed = true;
    const t = applyAction(s, lastActor(s), { type: 'stand' }, rng());
    expect(t.phase).toBe('roundEnd');
    const next = nextRound(t, rng());
    expect(next.players[0].immune).toBe(false);
    expect(next.players[1].embargoed).toBe(false);
    expect(next.players.every((p) => p.lastAction === null)).toBe(true);
  });
});

describe('hand tokens', () => {
  it('Exhaustion makes the target discard their hand and draw a new one', () => {
    const { s, me, others } = setup(['exhaustion']);
    const target = others[0];
    const old = structuredClone(P(s, target).hand!);
    const t = play(s, me, 'exhaustion', target);
    const fresh = P(t, target).hand!;
    expect(fresh.sand.suit).toBe('sand');
    expect(fresh.blood.suit).toBe('blood');
    expect(fresh.sand.id).not.toBe(old.sand.id);
    expect(t.discards.sand.at(-1)).toEqual(old.sand);
    expect(t.discards.blood.at(-1)).toEqual(old.blood);
    // card conservation
    let n = t.decks.sand.length + t.decks.blood.length + t.discards.sand.length + t.discards.blood.length;
    for (const p of t.players) if (p.hand) n += 2;
    expect(n).toBe(44);
  });

  it('Direct Transaction swaps hands with the target', () => {
    const { s, me, others } = setup(['directTransaction']);
    const mine = structuredClone(P(s, me).hand);
    const theirs = structuredClone(P(s, others[1]).hand);
    const t = play(s, me, 'directTransaction', others[1]);
    expect(P(t, me).hand).toEqual(theirs);
    expect(P(t, others[1]).hand).toEqual(mine);
  });
});

describe('rule-changing tokens', () => {
  it('Major Fraud: Impostors are worth 6 and no dice are rolled', () => {
    const s0 = atLastTurn([{ hand: [c('S', 'I'), c('B', 6)] }, { hand: [c('S', 2), c('B', 2)] }]);
    s0.rules.majorFraud = true;
    const t = applyAction(s0, lastActor(s0), { type: 'stand' }, rng());
    expect(t.phase).toBe('roundEnd');
    const h = t.lastResult!.hands.find((x) => x.playerId === 'p0')!;
    expect(h.impostors.sand).toEqual({ dice: null, value: 6 });
    expect(h.resolved.label).toBe('Sabacc (pair of 6s)');
    expect(t.lastResult!.rules.majorFraud).toBe(true);
  });

  it('Major Fraud + Sylop: the Sylop copies 6', () => {
    const r = resolveHand(c('S', 'S'), c('B', 'I'), {}, { majorFraud: true });
    expect(r.pairValue).toBe(6);
  });

  it('Cook the Books inverts Sabacc ranks (6s best, 1s worst) but Pure Sabacc stays on top', () => {
    const rules = { cookTheBooks: true };
    const sixes = resolveHand(c('S', 6), c('B', 6), {}, rules);
    const ones = resolveHand(c('S', 1), c('B', 1), {}, rules);
    const pure = resolveHand(c('S', 'S'), c('B', 'S'), {}, rules);
    const diff1 = resolveHand(c('S', 1), c('B', 2), {}, rules);
    expect(compareHands(sixes, ones)).toBeLessThan(0);
    expect(compareHands(pure, sixes)).toBeLessThan(0);
    expect(compareHands(ones, diff1)).toBeLessThan(0);
    expect(sixes.category).toBe('prime');
    expect(ones.category).toBe('sabacc');
  });

  it('Cook the Books played twice flips back', () => {
    const { s, me } = setup(['cookTheBooks']);
    let t = play(s, me, 'cookTheBooks');
    expect(t.rules.cookTheBooks).toBe(true);
    t = applyAction(t, me, { type: 'stand' }, rng());
    const nxt = currentPlayerId(t) as string;
    P(t, nxt).tokens = ['cookTheBooks'];
    expect(play(t, nxt, 'cookTheBooks').rules.cookTheBooks).toBe(false);
  });

  it('Markdown: a lone Sylop is worth 0; two Sylops are still Pure Sabacc', () => {
    const r = resolveHand(c('S', 'S'), c('B', 4), {}, { markdown: true });
    expect(r.sandValue).toBe(0);
    expect(r.difference).toBe(4);
    expect(r.isSabacc).toBe(false);
    expect(resolveHand(c('S', 'S'), c('B', 'S'), {}, { markdown: true }).category).toBe('pure');
  });

  it('Prime Sabacc: roll two dice, choose one, that pair becomes the best Sabacc', () => {
    const { s, me } = setup(['primeSabacc']);
    let t = play(s, me, 'primeSabacc', undefined, diceRng([4, 2]));
    expect(t.phase).toBe('primeChoice');
    expect(t.pendingPrime).toEqual({ playerId: me, dice: [4, 2] });
    expect(currentPlayerId(t)).toBe(me);
    expect(legalActions(t, me)).toEqual([
      { type: 'choosePrime', choice: 0 },
      { type: 'choosePrime', choice: 1 },
    ]);
    expect(() => applyAction(t, me, { type: 'stand' }, rng())).toThrow(IllegalMoveError);
    t = applyAction(t, me, { type: 'choosePrime', choice: 0 }, rng());
    expect(t.rules.primeValue).toBe(4);
    expect(t.phase).toBe('turn');
    const rules = t.rules;
    const fours = resolveHand(c('S', 4), c('B', 4), {}, rules);
    const ones = resolveHand(c('S', 1), c('B', 1), {}, rules);
    expect(compareHands(fours, ones)).toBeLessThan(0);
    expect(fours.label).toBe('Prime Sabacc (pair of 4s)');
    expect(compareHands(resolveHand(c('S', 'S'), c('B', 'S'), {}, rules), fours)).toBeLessThan(0);
  });

  it('Prime Sabacc timeout picks the die matching your pair and then stands', () => {
    const { s, me } = setup(['primeSabacc']);
    P(s, me).hand = { sand: c('S', 2), blood: c('B', 2) };
    const t = play(s, me, 'primeSabacc', undefined, diceRng([5, 2]));
    const acts = timeoutActions(t, me);
    expect(acts).toEqual([{ type: 'choosePrime', choice: 1 }, { type: 'stand' }]);
    expect(bestPrimeChoice({ sand: c('S', 'S'), blood: c('B', 3) }, [3, 6])).toBe(0);
  });

  it('rule changes reset every round', () => {
    const s0 = atLastTurn([{ hand: [c('S', 3), c('B', 3)] }, { hand: [c('S', 1), c('B', 4)] }]);
    s0.rules = { cookTheBooks: true, markdown: true, majorFraud: true, primeValue: 5 };
    const t = applyAction(s0, lastActor(s0), { type: 'stand' }, rng());
    expect(t.lastResult!.rules.primeValue).toBe(5);
    expect(nextRound(t, rng()).rules).toEqual({});
  });
});
