import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  currentPlayerId,
  currentTurnNumber,
  IllegalMoveError,
  legalActions,
  nextRound,
  settleChips,
  timeoutActions,
  type GameState,
} from '../src/engine';
import { resolveHand } from '../src/evaluate';
import { createRng } from '../src/rng';
import { toGameView } from '../src/view';
import { atLastTurn, c, diceRng, lastActor, players } from './helpers';

const rng = () => createRng(7);

function allCardIds(s: GameState): string[] {
  const ids: string[] = [];
  for (const suit of ['sand', 'blood'] as const) {
    ids.push(...s.decks[suit].map((x) => x.id), ...s.discards[suit].map((x) => x.id));
  }
  for (const p of s.players) if (p.hand) ids.push(p.hand.sand.id, p.hand.blood.id);
  if (s.pendingDraw) ids.push(s.pendingDraw.card.id);
  return ids;
}

describe('setup', () => {
  it('deals 1 Sand + 1 Blood each and flips one card to each discard pile', () => {
    const s = createGame(players(4), { startingChips: 8 }, rng());
    for (const p of s.players) {
      expect(p.hand?.sand.suit).toBe('sand');
      expect(p.hand?.blood.suit).toBe('blood');
      expect(p.chips).toBe(8);
      expect(p.invested).toBe(0);
    }
    expect(s.discards.sand).toHaveLength(1);
    expect(s.discards.blood).toHaveLength(1);
    expect(s.decks.sand).toHaveLength(22 - 4 - 1);
    expect(s.decks.blood).toHaveLength(22 - 4 - 1);
    const ids = allCardIds(s);
    expect(ids).toHaveLength(44);
    expect(new Set(ids).size).toBe(44);
  });

  it('is deterministic for the same seed', () => {
    const a = createGame(players(3), { startingChips: 8 }, createRng(99));
    const b = createGame(players(3), { startingChips: 8 }, createRng(99));
    expect(a).toEqual(b);
  });

  it('rejects bad player counts', () => {
    expect(() => createGame(players(1), { startingChips: 8 }, rng())).toThrow(IllegalMoveError);
    expect(() => createGame(players(5), { startingChips: 8 }, rng())).toThrow(IllegalMoveError);
  });
});

describe('turn order and dealer rotation', () => {
  it('player left of the dealer acts first; dealer acts last', () => {
    const s = createGame(players(4), { startingChips: 8 }, rng(), { firstDealerIndex: 0 });
    expect(s.turnOrder).toEqual(['p1', 'p2', 'p3', 'p0']);
    expect(currentPlayerId(s)).toBe('p1');
  });

  it('dealer moves one seat clockwise each round, skipping eliminated players', () => {
    let s = createGame(players(4), { startingChips: 8 }, rng());
    expect(s.dealerIndex).toBe(0);
    s.phase = 'roundEnd';
    s = nextRound(s, rng());
    expect(s.dealerIndex).toBe(1);
    expect(s.turnOrder).toEqual(['p2', 'p3', 'p0', 'p1']);
    s.phase = 'roundEnd';
    s.players[2].eliminated = true;
    s = nextRound(s, rng());
    expect(s.dealerIndex).toBe(3);
    expect(s.turnOrder).toEqual(['p0', 'p1', 'p3']);
    expect(s.players[2].hand).toBeNull();
    s.phase = 'roundEnd';
    s = nextRound(s, rng());
    expect(s.dealerIndex).toBe(0);
  });

  it('each player gets exactly 3 turns, then hands are revealed', () => {
    let s = createGame(players(3), { startingChips: 8 }, createRng(1));
    const seen: string[] = [];
    for (let i = 0; i < 9; i++) {
      expect(currentTurnNumber(s)).toBe(Math.floor(i / 3) + 1);
      const id = currentPlayerId(s) as string;
      seen.push(id);
      s = applyAction(s, id, { type: 'stand' }, createRng(i));
    }
    expect(seen).toEqual(['p1', 'p2', 'p0', 'p1', 'p2', 'p0', 'p1', 'p2', 'p0']);
    expect(['impostor', 'roundEnd', 'gameOver']).toContain(s.phase);
  });
});

describe('drawing and discarding', () => {
  it('draw costs 1 chip into invested and requires a same-suit discard', () => {
    let s = createGame(players(2), { startingChips: 8 }, rng());
    const id = currentPlayerId(s) as string;
    const deckTop = s.decks.blood[s.decks.blood.length - 1];
    s = applyAction(s, id, { type: 'draw', source: 'bloodDeck' }, rng());
    const p = s.players.find((x) => x.id === id)!;
    expect(p.chips).toBe(7);
    expect(p.invested).toBe(1);
    expect(s.phase).toBe('discard');
    expect(s.pendingDraw?.card).toEqual(deckTop);
    expect(legalActions(s, id)).toEqual([
      { type: 'discard', card: 'drawn' },
      { type: 'discard', card: 'held' },
    ]);
    const held = p.hand!.blood;
    s = applyAction(s, id, { type: 'discard', card: 'held' }, rng());
    const p2 = s.players.find((x) => x.id === id)!;
    expect(p2.hand!.blood).toEqual(deckTop);
    expect(s.discards.blood[s.discards.blood.length - 1]).toEqual(held);
    expect(s.phase).toBe('turn');
    expect(currentPlayerId(s)).not.toBe(id);
    expect(allCardIds(s)).toHaveLength(44);
    expect(s.log.at(-1)?.text).toMatch(/drew from the Blood deck, discarded Blood/);
  });

  it('drawing from a discard pile takes its top card', () => {
    let s = createGame(players(2), { startingChips: 8 }, rng());
    const id = currentPlayerId(s) as string;
    const top = s.discards.sand[0];
    s = applyAction(s, id, { type: 'draw', source: 'sandDiscard' }, rng());
    expect(s.pendingDraw?.card).toEqual(top);
    expect(s.discards.sand).toHaveLength(0);
    s = applyAction(s, id, { type: 'discard', card: 'drawn' }, rng());
    expect(s.discards.sand).toEqual([top]);
  });

  it('rejects illegal moves', () => {
    const s = createGame(players(3), { startingChips: 8 }, rng());
    const cur = currentPlayerId(s) as string;
    const other = s.players.find((p) => p.id !== cur)!.id;
    expect(() => applyAction(s, other, { type: 'stand' }, rng())).toThrow(IllegalMoveError);
    expect(() => applyAction(s, cur, { type: 'discard', card: 'drawn' }, rng())).toThrow(IllegalMoveError);
    expect(() => applyAction(s, cur, { type: 'draw', source: 'nowhere' as never }, rng())).toThrow(IllegalMoveError);
    expect(() => applyAction(s, cur, { type: 'chooseImpostor', suit: 'sand', choice: 0 }, rng())).toThrow(IllegalMoveError);
    expect(() => applyAction(s, cur, { type: 'bogus' } as never, rng())).toThrow(IllegalMoveError);
    expect(() => applyAction(s, 'ghost', { type: 'stand' }, rng())).toThrow(IllegalMoveError);
    const drawn = applyAction(s, cur, { type: 'draw', source: 'sandDeck' }, rng());
    expect(() => applyAction(drawn, cur, { type: 'stand' }, rng())).toThrow(IllegalMoveError);
    expect(() => applyAction(drawn, cur, { type: 'draw', source: 'sandDeck' }, rng())).toThrow(IllegalMoveError);
  });

  it('a player with 0 chips cannot draw and must stand', () => {
    const s = createGame(players(2), { startingChips: 8 }, rng());
    const cur = currentPlayerId(s) as string;
    s.players.find((p) => p.id === cur)!.chips = 0;
    expect(() => applyAction(s, cur, { type: 'draw', source: 'sandDeck' }, rng())).toThrow(/stand/);
    expect(legalActions(s, cur)).toEqual([{ type: 'stand' }]);
  });

  it('does not mutate the previous state', () => {
    const s = createGame(players(2), { startingChips: 8 }, rng());
    const snapshot = structuredClone(s);
    applyAction(s, currentPlayerId(s) as string, { type: 'draw', source: 'sandDeck' }, rng());
    expect(s).toEqual(snapshot);
  });
});

describe('deck rebuilding', () => {
  it('reshuffles the discard pile (keeping its top card) into a new deck when a deck runs out', () => {
    let s = createGame(players(2), { startingChips: 8 }, rng());
    const pile = [...s.decks.sand.splice(0, s.decks.sand.length - 0)];
    s.decks.sand = [];
    s.discards.sand = [...s.discards.sand, ...pile.slice(0, 4)];
    const extra = pile.slice(4); // keep card count honest for the check below
    const top = s.discards.sand[s.discards.sand.length - 1];
    const pileSize = s.discards.sand.length;
    const id = currentPlayerId(s) as string;
    s = applyAction(s, id, { type: 'draw', source: 'sandDeck' }, rng());
    expect(s.discards.sand).toEqual([top]);
    expect(s.decks.sand).toHaveLength(pileSize - 1 - 1);
    expect(s.reshuffles).toBe(1);
    expect(s.log.some((l) => /reshuffled/.test(l.text))).toBe(true);
    expect(allCardIds(s).length + extra.length).toBe(44);
  });

  it('refuses to draw from an empty deck when there is nothing to rebuild with', () => {
    const s = createGame(players(2), { startingChips: 8 }, rng());
    s.decks.blood = [];
    expect(() => applyAction(s, currentPlayerId(s) as string, { type: 'draw', source: 'bloodDeck' }, rng())).toThrow(
      IllegalMoveError,
    );
    expect(legalActions(s, currentPlayerId(s) as string)).not.toContainEqual({ type: 'draw', source: 'bloodDeck' });
  });
});

describe('reveal and Impostors', () => {
  it('rolls two dice per Impostor on the server and waits for choices', () => {
    const s0 = atLastTurn([{ hand: [c('S', 'I'), c('B', 4)] }, { hand: [c('S', 2), c('B', 5)] }]);
    const s = applyAction(s0, lastActor(s0), { type: 'stand' }, diceRng([2, 4]));
    expect(s.phase).toBe('impostor');
    expect(s.impostorRolls.p0.sand).toEqual({ dice: [2, 4], choice: null });
    expect(s.impostorRolls.p1).toBeUndefined();
    const s2 = applyAction(s, 'p0', { type: 'chooseImpostor', suit: 'sand', choice: 1 }, rng());
    expect(s2.phase).toBe('roundEnd');
    expect(s2.lastResult?.winnerIds).toEqual(['p0']);
    expect(s2.lastResult?.hands[0].impostors.sand).toEqual({ dice: [2, 4], value: 4 });
    expect(() => applyAction(s2, 'p0', { type: 'chooseImpostor', suit: 'sand', choice: 0 }, rng())).toThrow();
  });

  it('two Impostors roll two dice each; timeout picks the best joint values', () => {
    const s0 = atLastTurn([{ hand: [c('S', 'I'), c('B', 'I')] }, { hand: [c('S', 1), c('B', 2)] }]);
    const s = applyAction(s0, lastActor(s0), { type: 'stand' }, diceRng([3, 6, 5, 6]));
    expect(s.impostorRolls.p0.sand?.dice).toEqual([3, 6]);
    expect(s.impostorRolls.p0.blood?.dice).toEqual([5, 6]);
    const acts = timeoutActions(s, 'p0');
    expect(acts).toEqual([
      { type: 'chooseImpostor', suit: 'sand', choice: 1 },
      { type: 'chooseImpostor', suit: 'blood', choice: 1 },
    ]);
    let t = s;
    for (const a of acts) t = applyAction(t, 'p0', a, rng());
    expect(t.lastResult?.hands.find((h) => h.playerId === 'p0')?.resolved.label).toBe('Sabacc (pair of 6s)');
    expect(t.lastResult?.winnerIds).toEqual(['p0']);
  });

  it('Sylop + Impostor: the Sylop copies the chosen Impostor value', () => {
    const s0 = atLastTurn([{ hand: [c('S', 'S'), c('B', 'I')] }, { hand: [c('S', 2), c('B', 2)] }]);
    let s = applyAction(s0, lastActor(s0), { type: 'stand' }, diceRng([1, 5]));
    s = applyAction(s, 'p0', { type: 'chooseImpostor', suit: 'blood', choice: 0 }, rng());
    const h = s.lastResult!.hands.find((x) => x.playerId === 'p0')!;
    expect(h.resolved.sandValue).toBe(1);
    expect(h.resolved.category).toBe('prime');
    expect(s.lastResult!.winnerIds).toEqual(['p0']);
  });

  it('hands with no Impostors resolve immediately', () => {
    const s0 = atLastTurn([{ hand: [c('S', 3), c('B', 3)] }, { hand: [c('S', 'S'), c('B', 'S')] }]);
    const s = applyAction(s0, lastActor(s0), { type: 'stand' }, rng());
    expect(s.phase).toBe('roundEnd');
    expect(s.lastResult!.winnerIds).toEqual(['p1']);
    expect(s.lastResult!.hands[0].resolved.category).toBe('pure');
  });
});

describe('chip settlement', () => {
  it('winners get their investment back; losers lose it and pay penalties', () => {
    const s0 = atLastTurn([
      { hand: [c('S', 2), c('B', 2)], chips: 5, invested: 3 }, // winner
      { hand: [c('S', 4), c('B', 4)], chips: 6, invested: 2 }, // losing Sabacc → 1
      { hand: [c('S', 1), c('B', 5)], chips: 7, invested: 1 }, // diff 4 → 4
    ]);
    const s = applyAction(s0, lastActor(s0), { type: 'stand' }, rng());
    const by = Object.fromEntries(s.players.map((p) => [p.id, p]));
    expect(by.p0.chips).toBe(8);
    expect(by.p1.chips).toBe(5);
    expect(by.p2.chips).toBe(3);
    for (const p of s.players) expect(p.invested).toBe(0);
    const ch = Object.fromEntries(s.lastResult!.chips.map((x) => [x.playerId, x]));
    expect(ch.p0).toMatchObject({ returned: 3, penaltyPaid: 0, chipsAfter: 8 });
    expect(ch.p1).toMatchObject({ investedLost: 2, penaltyDue: 1, penaltyPaid: 1, chipsAfter: 5 });
    expect(ch.p2).toMatchObject({ investedLost: 1, penaltyDue: 4, penaltyPaid: 4, chipsAfter: 3 });
  });

  it('a player who cannot pay pays what they have and is eliminated', () => {
    const s0 = atLastTurn([
      { hand: [c('S', 1), c('B', 1)], chips: 4 },
      { hand: [c('S', 1), c('B', 6)], chips: 2, invested: 1 },
      { hand: [c('S', 3), c('B', 4)], chips: 5 },
    ]);
    const s = applyAction(s0, lastActor(s0), { type: 'stand' }, rng());
    const p1 = s.players[1];
    expect(p1.chips).toBe(0);
    expect(p1.eliminated).toBe(true);
    expect(p1.eliminatedInRound).toBe(1);
    expect(s.lastResult!.chips.find((x) => x.playerId === 'p1')).toMatchObject({ penaltyDue: 5, penaltyPaid: 2 });
    expect(s.phase).toBe('roundEnd');
    const next = nextRound(s, rng());
    expect(next.turnOrder).not.toContain('p1');
    expect(next.players[1].hand).toBeNull();
  });

  it('tied winners all win and pay nothing', () => {
    const s0 = atLastTurn([
      { hand: [c('S', 2), c('B', 5)], invested: 2 },
      { hand: [c('S', 5), c('B', 2)], invested: 1 },
      { hand: [c('S', 1), c('B', 6)], invested: 0 },
    ]);
    const s = applyAction(s0, lastActor(s0), { type: 'stand' }, rng());
    expect(s.lastResult!.winnerIds.sort()).toEqual(['p0', 'p1']);
    expect(s.players[0].chips).toBe(8 + 2);
    expect(s.players[1].chips).toBe(8 + 1);
    expect(s.players[2].chips).toBe(8 - 5);
  });

  it('the last player with chips wins the game', () => {
    const s0 = atLastTurn([
      { hand: [c('S', 3), c('B', 3)], chips: 1 },
      { hand: [c('S', 1), c('B', 4)], chips: 2 },
    ]);
    const s = applyAction(s0, lastActor(s0), { type: 'stand' }, rng());
    expect(s.phase).toBe('gameOver');
    expect(s.winnerIds).toEqual(['p0']);
    expect(() => nextRound(s, rng())).toThrow();
  });

  it('settleChips is pure and handles partial payment', () => {
    const { winnerIds, changes } = settleChips([
      { id: 'a', name: 'A', chips: 3, invested: 2, hand: resolveHand(c('S', 'S'), c('B', 3)) },
      { id: 'b', name: 'B', chips: 1, invested: 0, hand: resolveHand(c('S', 6), c('B', 1)) },
    ]);
    expect(winnerIds).toEqual(['a']);
    expect(changes[0]).toMatchObject({ chipsAfter: 5, eliminated: false });
    expect(changes[1]).toMatchObject({ penaltyDue: 5, penaltyPaid: 1, chipsAfter: 0, eliminated: true });
  });
});

describe('views hide private information', () => {
  it('shows own cards only; others are face down until the reveal', () => {
    const s = createGame(players(3), { startingChips: 8 }, rng());
    const v = toGameView(s, 'p0');
    expect(v.players[0].hand?.sand).not.toBeNull();
    expect(v.players[1].hand).toEqual({ sand: null, blood: null });
    expect(JSON.stringify(v)).not.toContain(s.players[1].hand!.sand.id);
    expect(v.deckCounts).toEqual({ sand: 18, blood: 18 });
    expect('decks' in v).toBe(false);
  });

  it('hides a card drawn from a deck from everyone but the drawer', () => {
    let s = createGame(players(2), { startingChips: 8 }, rng());
    const cur = currentPlayerId(s) as string;
    const other = s.players.find((p) => p.id !== cur)!.id;
    s = applyAction(s, cur, { type: 'draw', source: 'sandDeck' }, rng());
    expect(toGameView(s, cur).pendingDraw?.card).toEqual(s.pendingDraw!.card);
    expect(toGameView(s, other).pendingDraw).toEqual({ playerId: cur, source: 'sandDeck', card: null });
    expect(JSON.stringify(toGameView(s, other))).not.toContain(`"${s.pendingDraw!.card.id}"`);
  });

  it('shows every hand after the reveal', () => {
    const s0 = atLastTurn([{ hand: [c('S', 3), c('B', 3)] }, { hand: [c('S', 1), c('B', 4)] }]);
    const s = applyAction(s0, lastActor(s0), { type: 'stand' }, rng());
    const v = toGameView(s, 'p0');
    expect(v.revealed).toBe(true);
    expect(v.players[1].hand?.sand?.value).toBe(1);
  });
});
