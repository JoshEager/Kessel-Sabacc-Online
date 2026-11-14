import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, GameState, RoomView, ServerToClientEvents } from '../../shared/src/index';
import { Room, type RoomTiming } from '../src/room';
import { startServer, type KesselServer } from '../src/app';

const FAST: RoomTiming = {
  botDelayMinMs: 0,
  botDelayMaxMs: 0,
  disconnectedActMs: 0,
  impostorSeconds: 5,
  roundSummaryMs: 0,
};

function cardCount(g: GameState): number {
  let n = g.decks.sand.length + g.decks.blood.length + g.discards.sand.length + g.discards.blood.length;
  for (const p of g.players) if (p.hand) n += 2;
  if (g.pendingDraw) n += 1;
  return n;
}

function playBotGame(seed: number): Promise<{ room: Room; rounds: number; checks: number }> {
  return new Promise((resolve, reject) => {
    let checks = 0;
    let lastTotal = Infinity;
    const timeout = setTimeout(() => reject(new Error(`game ${seed} did not finish`)), 50_000);
    const room = new Room(
      `T${seed}`,
      (r) => {
        const g = r.game;
        if (!g) return;
        try {
          checks++;
          expect(cardCount(g)).toBe(44);
          const total = g.players.reduce((s, p) => s + p.chips + p.invested, 0);
          expect(total).toBeLessThanOrEqual(lastTotal); // chips only ever leave the game
          lastTotal = total;
          for (const p of g.players) {
            expect(p.chips).toBeGreaterThanOrEqual(0);
            if (p.hand) {
              expect(p.hand.sand.suit).toBe('sand');
              expect(p.hand.blood.suit).toBe('blood');
            }
          }
        } catch (e) {
          clearTimeout(timeout);
          r.close();
          reject(e);
          return;
        }
        if (r.status === 'finished') {
          clearTimeout(timeout);
          r.close();
          resolve({ room: r, rounds: g.round, checks });
        }
      },
      FAST,
      seed,
    );
    room.addBot(null, 'normal');
    room.addBot(null, 'normal');
    room.addBot(null, 'easy');
    room.addBot(null, 'easy');
    room.start(null);
  });
}

describe('full game with 4 bots on the server', () => {
  it('plays until exactly one player has chips', async () => {
    const { room, rounds, checks } = await playBotGame(12345);
    const g = room.game!;
    expect(room.status).toBe('finished');
    expect(g.phase).toBe('gameOver');
    expect(rounds).toBeGreaterThan(0);
    expect(checks).toBeGreaterThan(rounds * 4);
    const alive = g.players.filter((p) => !p.eliminated);
    expect(alive).toHaveLength(1);
    expect(g.winnerIds).toEqual([alive[0].id]);
    expect(alive[0].chips).toBeGreaterThan(0);
    for (const p of g.players.filter((x) => x.eliminated)) expect(p.chips).toBe(0);
    expect(room.chat.some((m) => /wins the game/.test(m.text))).toBe(true);
  });

  it('finishes reliably across several seeds', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { room } = await playBotGame(seed);
      expect(room.game!.winnerIds).toHaveLength(1);
    }
  });
});

describe('socket server', () => {
  let server: KesselServer;
  const clients: Socket<ServerToClientEvents, ClientToServerEvents>[] = [];

  beforeAll(async () => {
    server = await startServer({ port: 0, staticDir: null, timing: { ...FAST, botDelayMinMs: 5, botDelayMaxMs: 5 } });
  });
  afterAll(async () => {
    for (const c of clients) c.disconnect();
    await server.close();
  });

  function client() {
    const c = connect(`http://localhost:${server.port}`, { transports: ['websocket'], forceNew: true });
    clients.push(c);
    return c;
  }
  const call = <T>(c: Socket, ev: string, ...args: unknown[]) =>
    new Promise<T>((resolve) => (c.emit as (...a: unknown[]) => void)(ev, ...args, resolve));
  const nextState = (c: Socket, pred: (v: RoomView) => boolean) =>
    new Promise<RoomView>((resolve) => {
      const h = (v: RoomView) => {
        if (pred(v)) {
          c.off('room:state', h);
          resolve(v);
        }
      };
      c.on('room:state', h);
    });

  it('creates, joins, hides opponents’ cards, rejects illegal moves and supports resume', async () => {
    const a = client();
    const b = client();
    const created = await call<{ ok: true; code: string; token: string }>(a, 'room:create', { name: 'Ana' });
    expect(created.ok).toBe(true);
    expect(created.code).toMatch(/^[A-Z2-9]{5}$/);

    const joined = await call<{ ok: boolean; token: string }>(b, 'room:join', { code: created.code.toLowerCase(), name: 'Ben' });
    expect(joined.ok).toBe(true);

    const notHost = await call<{ ok: boolean; error: string }>(b, 'room:start');
    expect(notHost).toEqual({ ok: false, error: 'Only the host can do that' });

    const aPlaying = nextState(a, (v) => v.status === 'playing');
    const bPlaying = nextState(b, (v) => v.status === 'playing');
    expect((await call<{ ok: boolean }>(a, 'room:start')).ok).toBe(true);
    const va = await aPlaying;
    const vb = await bPlaying;

    const room = server.rooms.get(created.code)!;
    const g = room.game!;
    const ana = g.players.find((p) => p.name === 'Ana')!;
    const ben = g.players.find((p) => p.name === 'Ben')!;
    // Each client sees only its own hand; deck order is never sent.
    expect(va.game!.players.find((p) => p.id === ana.id)!.hand!.sand!.id).toBe(ana.hand!.sand.id);
    expect(va.game!.players.find((p) => p.id === ben.id)!.hand).toEqual({ sand: null, blood: null });
    const rawA = JSON.stringify(va);
    expect(rawA).not.toContain(`"${ben.hand!.sand.id}"`);
    expect(rawA).not.toContain(`"${ben.hand!.blood.id}"`);
    for (const c of g.decks.sand.concat(g.decks.blood)) expect(rawA).not.toContain(`"${c.id}"`);
    expect(JSON.stringify(vb)).not.toContain(`"${ana.hand!.sand.id}"`);

    // Whoever is not on turn cannot act.
    const cur = g.turnOrder[0];
    const waiting = cur === ana.id ? b : a;
    const acting = cur === ana.id ? a : b;
    const illegal = await call<{ ok: boolean; error: string }>(waiting, 'game:action', { type: 'stand' });
    expect(illegal.ok).toBe(false);
    const ok = await call<{ ok: boolean }>(acting, 'game:action', { type: 'stand' });
    expect(ok.ok).toBe(true);

    // Chat works and is broadcast.
    const chatSeen = nextState(b, (v) => v.chat.some((m) => m.text === 'hello table'));
    await call(a, 'chat:send', { text: 'hello table' });
    await chatSeen;

    // Refresh: a new socket resumes Ben's seat with his token.
    b.disconnect();
    const b2 = client();
    const resumed = await call<{ ok: boolean }>(b2, 'room:resume', { code: created.code, token: joined.token });
    expect(resumed.ok).toBe(true);
    expect(room.seat(ben.id)!.connected).toBe(true);
    const bad = await call<{ ok: boolean }>(client(), 'room:resume', { code: created.code, token: 'nope' });
    expect(bad.ok).toBe(false);
  });
});
