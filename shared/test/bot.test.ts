import { describe, expect, it } from 'vitest';
import { decideBotAction, handStrength, unseenCards } from '../src/bot';
import { applyAction, createGame, currentPlayerId, legalActions, type GameAction } from '../src/engine';
import { createRng } from '../src/rng';
import { toGameView } from '../src/view';
import { c, players } from './helpers';

describe('bot strength model', () => {
  it('orders hands sensibly', () => {
    expect(handStrength('S', 'S')).toBeGreaterThan(handStrength(1, 1));
    expect(handStrength(1, 1)).toBeGreaterThan(handStrength(6, 6));
    expect(handStrength(6, 6)).toBeGreaterThan(handStrength(1, 2));
    expect(handStrength(1, 2)).toBeGreaterThan(handStrength(1, 6));
    expect(handStrength('S', 3)).toBe(handStrength(3, 3));
  });
});

describe('normal bot', () => {
  it('stands on a strong hand and keeps its Sylop', () => {
    const s = createGame(players(2), { startingChips: 8 }, createRng(3));
    const me = currentPlayerId(s) as string;
    const p = s.players.find((x) => x.id === me)!;
    p.hand = { sand: c('S', 'S'), blood: c('B', 2) };
    expect(decideBotAction(toGameView(s, me), me, 'normal', createRng(1))).toEqual({ type: 'stand' });

    p.hand = { sand: c('S', 'S'), blood: c('B', 6) };
    s.phase = 'discard';
    s.pendingDraw = { playerId: me, source: 'sandDeck', card: c('S', 4) };
    expect(decideBotAction(toGameView(s, me), me, 'normal', createRng(1))).toEqual({ type: 'discard', card: 'drawn' });
  });

  it('takes a discard that completes a low pair', () => {
    const s = createGame(players(2), { startingChips: 8 }, createRng(3));
    const me = currentPlayerId(s) as string;
    s.players.find((x) => x.id === me)!.hand = { sand: c('S', 2), blood: c('B', 6) };
    s.discards.blood = [c('B', 2)];
    expect(decideBotAction(toGameView(s, me), me, 'normal', createRng(1))).toEqual({ type: 'draw', source: 'bloodDiscard' });
  });

  it('counts only cards it cannot see', () => {
    const s = createGame(players(2), { startingChips: 8 }, createRng(3));
    const me = s.players[0].id;
    const unseen = unseenCards(toGameView(s, me), me, 'sand');
    expect(unseen).toHaveLength(22 - 1 - 1); // own card and the face-up discard are known
  });

  it('only ever chooses legal moves (both levels, many seeds)', () => {
    for (const level of ['easy', 'normal'] as const) {
      for (let seed = 0; seed < 60; seed++) {
        let s = createGame(players(4), { startingChips: 4, shiftTokens: seed % 4 }, createRng(seed));
        const rng = createRng(seed + 1000);
        for (let step = 0; step < 80 && ['turn', 'discard', 'primeChoice', 'impostor'].includes(s.phase); step++) {
          const actor =
            s.phase === 'impostor'
              ? Object.keys(s.impostorRolls).find((id) => legalActions(s, id).length > 0)!
              : (currentPlayerId(s) as string);
          const action = decideBotAction(toGameView(s, actor), actor, level, rng) as GameAction;
          expect(legalActions(s, actor)).toContainEqual(action);
          s = applyAction(s, actor, action, rng);
        }
      }
    }
  });
});

describe('bots and shift tokens', () => {
  function myTurn(tokens: import('../src/tokens').ShiftTokenId[]) {
    const s = createGame(players(3), { startingChips: 8, shiftTokens: 0 }, createRng(9));
    const me = currentPlayerId(s) as string;
    const p = s.players.find((x) => x.id === me)!;
    p.tokens = tokens;
    return { s, me, p };
  }

  it('cashes in a Refund once two chips are in the pot', () => {
    const { s, me, p } = myTurn(['refund']);
    p.invested = 2;
    p.chips = 6;
    expect(decideBotAction(toGameView(s, me), me, 'normal', createRng(1))).toEqual({ type: 'playToken', token: 'refund' });
  });

  it('plays Major Fraud holding an Impostor and a 6', () => {
    const { s, me, p } = myTurn(['majorFraud']);
    p.hand = { sand: c('S', 'I'), blood: c('B', 6) };
    expect(decideBotAction(toGameView(s, me), me, 'normal', createRng(1))).toEqual({ type: 'playToken', token: 'majorFraud' });
  });

  it('plays Cook the Books holding a high pair', () => {
    const { s, me, p } = myTurn(['cookTheBooks']);
    p.hand = { sand: c('S', 5), blood: c('B', 5) };
    expect(decideBotAction(toGameView(s, me), me, 'normal', createRng(1))).toEqual({ type: 'playToken', token: 'cookTheBooks' });
  });

  it('must stand under Embargo and still never plays a token twice in a turn', () => {
    const { s, me, p } = myTurn(['generalTariff']);
    p.embargoed = true;
    s.tokenPlayedThisTurn = true;
    expect(decideBotAction(toGameView(s, me), me, 'normal', createRng(1))).toEqual({ type: 'stand' });
  });

  it('picks the Prime Sabacc die matching its pair', () => {
    const { s, me, p } = myTurn([]);
    p.hand = { sand: c('S', 3), blood: c('B', 3) };
    s.phase = 'primeChoice';
    s.pendingPrime = { playerId: me, dice: [6, 3] };
    expect(decideBotAction(toGameView(s, me), me, 'normal', createRng(1))).toEqual({ type: 'choosePrime', choice: 1 });
  });

  it('actually uses tokens over many games', () => {
    let played = 0;
    for (let seed = 0; seed < 20; seed++) {
      let s = createGame(players(4), { startingChips: 8, shiftTokens: 3 }, createRng(seed));
      const rng = createRng(seed + 7);
      for (let step = 0; step < 60 && ['turn', 'discard', 'primeChoice', 'impostor'].includes(s.phase); step++) {
        const actor =
          s.phase === 'impostor'
            ? Object.keys(s.impostorRolls).find((id) => legalActions(s, id).length > 0)!
            : (currentPlayerId(s) as string);
        const action = decideBotAction(toGameView(s, actor), actor, 'normal', rng) as GameAction;
        if (action.type === 'playToken') played++;
        s = applyAction(s, actor, action, rng);
      }
    }
    expect(played).toBeGreaterThan(20);
  });
});
