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
      for (let seed = 0; seed < 30; seed++) {
        let s = createGame(players(4), { startingChips: 4 }, createRng(seed));
        const rng = createRng(seed + 1000);
        for (let step = 0; step < 40 && (s.phase === 'turn' || s.phase === 'discard' || s.phase === 'impostor'); step++) {
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
