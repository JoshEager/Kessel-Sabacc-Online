import { describe, expect, it } from 'vitest';
import type { Card } from '../src/cards';
import { CHEAT_CATCH_CHANCE, cheatFine } from '../src/cheats';
import {
  applyAction,
  cheatBlockReason,
  createGame,
  currentPlayerId,
  IllegalMoveError,
  MAX_PLAYERS,
  timeoutActions,
  type CheatAction,
  type GameState,
} from '../src/engine';
import { createRng, type Rng } from '../src/rng';
import { toGameView } from '../src/view';
import { atLastTurn, c, lastActor, players } from './helpers';

/** RNG stubs: every catch roll fails (cheat works) or succeeds (cheater caught). */
const clean: Rng = () => 0.99;
const caught: Rng = () => 0;

function setup(n = 3): { s: GameState; me: string; others: string[] } {
  const s = createGame(players(n), { startingChips: 8, cheats: true }, createRng(7), { firstDealerIndex: 0 });
  const me = currentPlayerId(s) as string;
  return { s, me, others: s.turnOrder.filter((id) => id !== me) };
}
const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const cheat = (s: GameState, id: string, a: CheatAction, rng: Rng) => applyAction(s, id, a, rng);

function cardCount(g: GameState): number {
  let n = g.decks.sand.length + g.decks.blood.length + g.discards.sand.length + g.discards.blood.length;
  for (const p of g.players) if (p.hand) n += 2;
  if (g.pendingDraw) n += g.pendingDraw.extra ? 2 : 1;
  return n;
}

describe('cheats setting', () => {
  it('is off unless the game turns it on', () => {
    const s = createGame(players(3), { startingChips: 8 }, createRng(7));
    const me = currentPlayerId(s) as string;
    const other = s.turnOrder.find((id) => id !== me)!;
    expect(() => cheat(s, me, { type: 'cheat', cheat: 'peek', targetId: other }, clean)).toThrow('Cheats are off at this table');
    expect(toGameView(s, me).cheatsEnabled).toBe(false);
  });

  it('escalates the fine and has a sensible catch chance', () => {
    expect([1, 2, 3].map(cheatFine)).toEqual([1, 2, 3]);
    expect(CHEAT_CATCH_CHANCE).toBeGreaterThan(0);
    expect(CHEAT_CATCH_CHANCE).toBeLessThan(1);
  });
});

describe('Peek', () => {
  it('secretly shows a snapshot of one opponent hand to the cheater only', () => {
    const { s, me, others } = setup();
    const [target, bystander] = others;
    const logBefore = s.log.length;
    const t = cheat(s, me, { type: 'cheat', cheat: 'peek', targetId: target }, clean);
    expect(P(t, me).peek).toEqual({ targetId: target, hand: P(s, target).hand });
    expect(t.log.length).toBe(logBefore); // a successful cheat leaves no trace
    expect(t.phase).toBe('turn'); // it doesn't use up the turn
    expect(toGameView(t, me).players.find((p) => p.id === me)!.peek!.hand.sand.id).toBe(P(s, target).hand!.sand.id);
    expect(toGameView(t, target).players.find((p) => p.id === me)!.peek).toBeNull();
    expect(JSON.stringify(toGameView(t, bystander))).not.toContain(P(s, target).hand!.sand.id);
    // One cheat per turn.
    expect(cheatBlockReason(t, me, { type: 'cheat', cheat: 'peek', targetId: bystander })).toBe('One cheat per turn');
  });

  it('getting caught is public, fails the cheat and fines 1, then 2 chips', () => {
    const { s, me, others } = setup();
    const t = cheat(s, me, { type: 'cheat', cheat: 'peek', targetId: others[0] }, caught);
    expect(P(t, me).peek).toBeNull();
    expect(P(t, me).timesCaught).toBe(1);
    expect(P(t, me).chips).toBe(7);
    expect(P(t, me).invested).toBe(1);
    expect(t.log.some((l) => l.kind === 'cheat' && l.text.includes('caught'))).toBe(true);
    expect(toGameView(t, others[0]).players.find((p) => p.id === me)!.timesCaught).toBe(1);
    // Next turn (fast-forward), second catch costs 2.
    const t2 = structuredClone(t);
    t2.cheatUsedThisTurn = false;
    const t3 = cheat(t2, me, { type: 'cheat', cheat: 'peek', targetId: others[0] }, caught);
    expect(P(t3, me).timesCaught).toBe(2);
    expect(P(t3, me).chips).toBe(5);
    expect(P(t3, me).invested).toBe(3);
  });

  it('cannot target yourself, immune players, or be used out of turn', () => {
    const { s, me, others } = setup();
    expect(cheatBlockReason(s, me, { type: 'cheat', cheat: 'peek', targetId: me })).toMatch(/opponent/);
    P(s, others[0]).immune = true;
    expect(cheatBlockReason(s, me, { type: 'cheat', cheat: 'peek', targetId: others[0] })).toMatch(/immune/);
    expect(() => cheat(s, others[1], { type: 'cheat', cheat: 'peek', targetId: me }, clean)).toThrow(IllegalMoveError);
  });
});

describe('Double Draw', () => {
  it('draws a hidden second card; keeping it returns the first to the deck', () => {
    const { s, me, others } = setup();
    const held = P(s, me).hand!.sand;
    const deckBefore = s.decks.sand.length;
    const t = cheat(s, me, { type: 'cheat', cheat: 'doubleDraw', source: 'sandDeck' }, clean);
    expect(t.phase).toBe('discard');
    expect(t.pendingDraw!.extra).toBeDefined();
    expect(P(t, me).chips).toBe(7); // the normal draw cost, once
    expect(cardCount(t)).toBe(44);
    expect(toGameView(t, me).pendingDraw!.extra!.id).toBe(t.pendingDraw!.extra!.id);
    expect(toGameView(t, others[0]).pendingDraw!.extra).toBeNull();
    expect(toGameView(t, others[0]).pendingDraw!.card).toBeNull();

    const first = t.pendingDraw!.card;
    const second = t.pendingDraw!.extra as Card;
    const u = applyAction(t, me, { type: 'keepExtra' }, clean);
    expect(P(u, me).hand!.sand.id).toBe(second.id);
    expect(u.discards.sand.at(-1)!.id).toBe(held.id); // looks like a normal draw + discard
    expect(u.decks.sand.some((x) => x.id === first.id)).toBe(true); // the spare went back in the deck
    expect(u.decks.sand.length).toBe(deckBefore - 1);
    expect(cardCount(u)).toBe(44);
    expect(u.pendingDraw).toBeNull();
    expect(currentPlayerId(u)).not.toBe(me);
  });

  it('discarding as usual puts the unchosen drawn card back in the deck', () => {
    const { s, me } = setup();
    const t = cheat(s, me, { type: 'cheat', cheat: 'doubleDraw', source: 'bloodDeck' }, clean);
    const extra = t.pendingDraw!.extra as Card;
    const drawn = t.pendingDraw!.card;
    const u = applyAction(t, me, { type: 'discard', card: 'held' }, clean); // keep the first drawn card
    expect(P(u, me).hand!.blood.id).toBe(drawn.id);
    expect(u.decks.blood.some((x) => x.id === extra.id)).toBe(true);
    expect(cardCount(u)).toBe(44);
    // Timeouts still work while a Double Draw is pending.
    const t2 = cheat(s, me, { type: 'cheat', cheat: 'doubleDraw', source: 'bloodDeck' }, clean);
    let v = t2;
    for (const a of timeoutActions(t2, me)) v = applyAction(v, me, a, clean);
    expect(v.pendingDraw).toBeNull();
    expect(cardCount(v)).toBe(44);
  });

  it('caught: a normal single draw plus the fine', () => {
    const { s, me } = setup();
    const t = cheat(s, me, { type: 'cheat', cheat: 'doubleDraw', source: 'sandDeck' }, caught);
    expect(t.phase).toBe('discard');
    expect(t.pendingDraw!.extra).toBeUndefined();
    expect(P(t, me).chips).toBe(6); // 1 draw + 1 fine
    expect(P(t, me).invested).toBe(2);
    expect(() => applyAction(t, me, { type: 'keepExtra' }, clean)).toThrow('You have no second card to keep');
  });

  it('only works on a deck, on your turn, when you could draw', () => {
    const { s, me } = setup();
    expect(cheatBlockReason(s, me, { type: 'cheat', cheat: 'doubleDraw', source: 'sandDiscard' })).toMatch(/deck/);
    P(s, me).embargoed = true;
    expect(cheatBlockReason(s, me, { type: 'cheat', cheat: 'doubleDraw', source: 'sandDeck' })).toMatch(/Embargo/);
    P(s, me).embargoed = false;
    P(s, me).chips = 0;
    expect(cheatBlockReason(s, me, { type: 'cheat', cheat: 'doubleDraw', source: 'sandDeck' })).toMatch(/no chips/);
  });
});

describe('Magnetic Dice', () => {
  /** Reveal with the last actor holding a Sand Impostor; dice roll 2 and 5. */
  function reveal() {
    const s = atLastTurn([
      { hand: [c('S', 3), c('B', 3)] },
      { hand: [c('S', 'I'), c('B', 4)] },
    ]);
    s.config.cheats = true;
    const actor = lastActor(s);
    const imp = s.players.find((p) => p.hand!.sand.kind === 'impostor')!.id;
    const faces = (f: number[]) => {
      const q = f.slice();
      return () => (q.length ? (q.shift()! - 1) / 6 + 0.01 : 0.5);
    };
    const t = applyAction(s, actor, { type: 'stand' }, faces([2, 5]));
    return { t, imp };
  }

  it('nudges one die by 1, once per Impostor, within 1–6', () => {
    const { t, imp } = reveal();
    expect(t.phase).toBe('impostor');
    expect(t.impostorRolls[imp].sand!.dice).toEqual([2, 5]);
    expect(cheatBlockReason(t, imp, { type: 'cheat', cheat: 'magneticDice', suit: 'sand', die: 1, delta: 1 })).toBeNull();
    const u = cheat(t, imp, { type: 'cheat', cheat: 'magneticDice', suit: 'sand', die: 0, delta: 1 }, clean);
    expect(u.impostorRolls[imp].sand!.dice).toEqual([3, 5]);
    expect(cheatBlockReason(u, imp, { type: 'cheat', cheat: 'magneticDice', suit: 'sand', die: 1, delta: 1 })).toMatch(/already/);
    // Choosing still works afterwards, with the nudged value.
    const v = applyAction(u, imp, { type: 'chooseImpostor', suit: 'sand', choice: 0 }, clean);
    expect(v.lastResult!.hands.find((h) => h.playerId === imp)!.resolved.sandValue).toBe(3);
  });

  it('rejects out-of-range nudges and fines a caught attempt without changing the dice', () => {
    const { t, imp } = reveal();
    const r = t.impostorRolls[imp].sand!;
    r.dice = [6, 1];
    expect(cheatBlockReason(t, imp, { type: 'cheat', cheat: 'magneticDice', suit: 'sand', die: 0, delta: 1 })).toMatch(/1 to 6/);
    expect(cheatBlockReason(t, imp, { type: 'cheat', cheat: 'magneticDice', suit: 'sand', die: 1, delta: -1 })).toMatch(/1 to 6/);
    expect(cheatBlockReason(t, imp, { type: 'cheat', cheat: 'magneticDice', suit: 'blood', die: 0, delta: 1 })).toMatch(/no Impostor/);
    const u = cheat(t, imp, { type: 'cheat', cheat: 'magneticDice', suit: 'sand', die: 0, delta: -1 }, caught);
    expect(u.impostorRolls[imp].sand!.dice).toEqual([6, 1]);
    expect(u.impostorRolls[imp].sand!.nudged).toBe(true);
    expect(P(u, imp).timesCaught).toBe(1);
  });
});

describe('table size', () => {
  it('allows up to 8 players', () => {
    expect(MAX_PLAYERS).toBe(8);
    const s = createGame(players(8), { startingChips: 4 }, createRng(3));
    expect(s.turnOrder).toHaveLength(8);
    expect(cardCount(s)).toBe(44);
    expect(() => createGame(players(9), { startingChips: 4 }, createRng(3))).toThrow(IllegalMoveError);
  });
});
