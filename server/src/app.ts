import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '../../shared/src/index';
import { DEFAULT_TIMING, Room, RoomError, type RoomTiming } from './room';

interface SocketData {
  code?: string;
  seatId?: string;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type KSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_IDLE_MS = 30 * 60 * 1000;
const ROOM_EMPTY_MS = 10 * 60 * 1000;

export interface ServerOptions {
  port?: number;
  staticDir?: string | null;
  timing?: Partial<RoomTiming>;
  log?: boolean;
}

export interface KesselServer {
  http: HttpServer;
  io: IO;
  rooms: Map<string, Room>;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(opts: ServerOptions = {}): Promise<KesselServer> {
  const timing: RoomTiming = { ...DEFAULT_TIMING, ...opts.timing };
  const app = express();
  const http = createServer(app);
  const io: IO = new Server(http, { cors: { origin: true }, pingInterval: 10_000, pingTimeout: 8_000 });
  const rooms = new Map<string, Room>();
  const sockets = new Map<string, Set<KSocket>>();
  const emptySince = new Map<string, number>();
  const log = (...a: unknown[]) => opts.log && console.log(...a);

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  function broadcast(room: Room): void {
    const set = sockets.get(room.code);
    if (!set) return;
    for (const s of set) s.emit('room:state', room.viewFor(s.data.seatId ?? null));
  }

  function newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 5; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function attach(socket: KSocket, room: Room, seatId: string): void {
    detach(socket);
    socket.data.code = room.code;
    socket.data.seatId = seatId;
    let set = sockets.get(room.code);
    if (!set) sockets.set(room.code, (set = new Set()));
    set.add(socket);
    socket.join(room.code);
    emptySince.delete(room.code);
  }

  function detach(socket: KSocket): void {
    const { code, seatId } = socket.data;
    if (!code) return;
    const set = sockets.get(code);
    set?.delete(socket);
    socket.leave(code);
    socket.data.code = undefined;
    socket.data.seatId = undefined;
    const room = rooms.get(code);
    if (room && seatId) {
      const stillHere = [...(set ?? [])].some((s) => s.data.seatId === seatId);
      if (!stillHere) room.setConnected(seatId, false);
      if (room.humansConnected() === 0) emptySince.set(code, Date.now());
    }
  }

  function currentRoom(socket: KSocket): { room: Room; seatId: string } {
    const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
    if (!room || !socket.data.seatId) throw new RoomError('You are not in a room');
    return { room, seatId: socket.data.seatId };
  }

  function handle<T extends object>(ack: Ack<T> | undefined, fn: () => T): void {
    try {
      const result = fn();
      if (typeof ack === 'function') ack({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof RoomError ? e.message : 'Something went wrong';
      if (!(e instanceof RoomError)) console.error(e);
      if (typeof ack === 'function') ack({ ok: false, error: msg });
    }
  }

  io.on('connection', (socket) => {
    socket.on('room:create', (p, ack) =>
      handle(ack, () => {
        const code = newCode();
        const room = new Room(code, broadcast, timing);
        rooms.set(code, room);
        const seat = room.addHuman(p?.name);
        attach(socket, room, seat.id);
        broadcast(room);
        log(`room ${code} created`);
        return { code, token: seat.token as string };
      }),
    );

    socket.on('room:join', (p, ack) =>
      handle(ack, () => {
        const code = String(p?.code ?? '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) throw new RoomError('No room with that code');
        const seat = room.addHuman(p?.name);
        attach(socket, room, seat.id);
        broadcast(room);
        return { code, token: seat.token as string };
      }),
    );

    socket.on('room:resume', (p, ack) =>
      handle(ack, () => {
        const code = String(p?.code ?? '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) throw new RoomError('That room no longer exists');
        const seat = room.seatByToken(String(p?.token ?? ''));
        if (!seat) throw new RoomError('Your seat is no longer available');
        attach(socket, room, seat.id);
        room.setConnected(seat.id, true);
        broadcast(room);
        return { code };
      }),
    );

    socket.on('room:leave', (ack) =>
      handle(ack, () => {
        const { room, seatId } = currentRoom(socket);
        detach(socket);
        room.leave(seatId);
        return {};
      }),
    );

    socket.on('room:settings', (p, ack) =>
      handle(ack, () => {
        const { room, seatId } = currentRoom(socket);
        room.updateSettings(seatId, p ?? {});
        return {};
      }),
    );

    socket.on('room:addBot', (p, ack) =>
      handle(ack, () => {
        const { room, seatId } = currentRoom(socket);
        room.addBot(seatId, p?.level);
        return {};
      }),
    );

    socket.on('room:removeSeat', (p, ack) =>
      handle(ack, () => {
        const { room, seatId } = currentRoom(socket);
        const target = String(p?.seatId ?? '');
        room.removeSeat(seatId, target);
        // Disconnect the removed player's sockets from the room.
        for (const s of [...(sockets.get(room.code) ?? [])]) {
          if (s.data.seatId === target) {
            sockets.get(room.code)?.delete(s);
            s.leave(room.code);
            s.data.code = undefined;
            s.data.seatId = undefined;
            s.emit('room:closed', { reason: 'The host removed you from the table.' });
          }
        }
        return {};
      }),
    );

    socket.on('room:start', (ack) =>
      handle(ack, () => {
        const { room, seatId } = currentRoom(socket);
        room.start(seatId);
        return {};
      }),
    );

    socket.on('room:rematch', (ack) =>
      handle(ack, () => {
        const { room, seatId } = currentRoom(socket);
        room.rematch(seatId);
        return {};
      }),
    );

    socket.on('room:lobby', (ack) =>
      handle(ack, () => {
        const { room, seatId } = currentRoom(socket);
        room.backToLobby(seatId);
        return {};
      }),
    );

    socket.on('round:ready', (ack) =>
      handle(ack, () => {
        const { room, seatId } = currentRoom(socket);
        room.markReady(seatId);
        return {};
      }),
    );

    socket.on('game:action', (action, ack) =>
      handle(ack, () => {
        const { room, seatId } = currentRoom(socket);
        room.act(seatId, action);
        return {};
      }),
    );

    socket.on('chat:send', (p, ack) =>
      handle(ack, () => {
        const { room, seatId } = currentRoom(socket);
        room.sendChat(seatId, p?.text);
        return {};
      }),
    );

    socket.on('disconnect', () => detach(socket));
  });

  // Garbage-collect abandoned rooms.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const empty = emptySince.get(code);
      const abandoned = room.humansConnected() === 0 && empty !== undefined && now - empty > ROOM_EMPTY_MS;
      const idle = now - room.lastActivity > ROOM_IDLE_MS && room.humansConnected() === 0;
      if (abandoned || idle) {
        room.close();
        rooms.delete(code);
        sockets.delete(code);
        emptySince.delete(code);
        log(`room ${code} closed`);
      }
    }
  }, 60_000);
  sweeper.unref();

  const port = await new Promise<number>((resolve) => {
    http.listen(opts.port ?? 0, () => {
      const addr = http.address();
      resolve(typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0));
    });
  });

  return {
    http,
    io,
    rooms,
    port,
    close: async () => {
      clearInterval(sweeper);
      for (const r of rooms.values()) r.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
