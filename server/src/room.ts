import { randomBytes, randomInt } from 'node:crypto';
import {
  applyAction,
  BOT_NAMES,
  createGame,
  createRng,
  currentPlayerId,
  decideBotAction,
  DEFAULT_STARTING_CHIPS,
  DEFAULT_TURN_SECONDS,
  IllegalMoveError,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  nextRound,
  STARTING_CHIP_OPTIONS,
  timeoutActions,
  toGameView,
  TURN_TIMER_OPTIONS,
  type BotLevel,
  type ChatMessage,
  type GameAction,
  type GameState,
  type Rng,
  type RoomSettings,
  type RoomStatus,
  type RoomView,
} from '../../shared/src/index';

export interface Seat {
  id: string;
  name: string;
  token: string | null;
  isBot: boolean;
  botLevel: BotLevel | null;
  connected: boolean;
}

export interface RoomTiming {
  botDelayMinMs: number;
  botDelayMaxMs: number;
  /** How long a disconnected player's turn waits before auto-standing. */
  disconnectedActMs: number;
  /** Seconds a human gets to pick Impostor dice. */
  impostorSeconds: number;
  /** Auto-advance from the round summary after this long. */
  roundSummaryMs: number;
}

export const DEFAULT_TIMING: RoomTiming = {
  botDelayMinMs: 600,
  botDelayMaxMs: 1200,
  disconnectedActMs: 800,
  impostorSeconds: 20,
  roundSummaryMs: 15_000,
};

export class RoomError extends Error {}

const MAX_CHAT = 100;

export function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  if (!name) throw new RoomError('Please enter a display name');
  return name;
}

export class Room {
  readonly code: string;
  seats: Seat[] = [];
  hostId: string | null = null;
  status: RoomStatus = 'lobby';
  settings: RoomSettings = { startingChips: DEFAULT_STARTING_CHIPS, turnSeconds: DEFAULT_TURN_SECONDS };
  game: GameState | null = null;
  chat: ChatMessage[] = [];
  deadline: number | null = null;
  nextRoundAt: number | null = null;
  readyIds = new Set<string>();
  lastActivity = Date.now();

  private rng: Rng;
  private chatSeq = 0;
  private seatSeq = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  /** Identifies the decision point the current deadline belongs to. */
  private deadlineKey = '';
  private closed = false;

  constructor(
    code: string,
    private readonly onChange: (room: Room) => void,
    readonly timing: RoomTiming = DEFAULT_TIMING,
    seed: number = randomInt(0, 2 ** 31),
  ) {
    this.code = code;
    this.rng = createRng(seed);
  }

  // ---------- seats ----------

  private newSeatId(): string {
    this.seatSeq += 1;
    return `s${this.seatSeq}`;
  }

  seat(id: string | null | undefined): Seat | undefined {
    return id ? this.seats.find((s) => s.id === id) : undefined;
  }

  seatByToken(token: string): Seat | undefined {
    return token ? this.seats.find((s) => s.token === token) : undefined;
  }

  addHuman(rawName: string): Seat {
    if (this.status !== 'lobby') throw new RoomError('That game has already started');
    if (this.seats.length >= MAX_PLAYERS) throw new RoomError('That room is full');
    const name = this.uniqueName(cleanName(rawName));
    const seat: Seat = {
      id: this.newSeatId(),
      name,
      token: randomBytes(18).toString('base64url'),
      isBot: false,
      botLevel: null,
      connected: true,
    };
    this.seats.push(seat);
    if (!this.hostId) this.hostId = seat.id;
    this.system(`${name} joined.`);
    this.touch();
    return seat;
  }

  addBot(actorId: string | null, level: BotLevel): Seat {
    this.requireHost(actorId);
    if (this.status !== 'lobby') throw new RoomError('Bots can only be added in the lobby');
    if (this.seats.length >= MAX_PLAYERS) throw new RoomError('All seats are taken');
    if (level !== 'easy' && level !== 'normal') throw new RoomError('Unknown bot difficulty');
    const used = new Set(this.seats.map((s) => s.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    const name = free.length ? free[Math.floor(this.rng() * free.length)] : this.uniqueName('Droid');
    const seat: Seat = { id: this.newSeatId(), name, token: null, isBot: true, botLevel: level, connected: true };
    this.seats.push(seat);
    this.system(`${name} (${level} bot) took a seat.`);
    this.touch();
    return seat;
  }

  removeSeat(actorId: string | null, seatId: string): void {
    this.requireHost(actorId);
    if (this.status !== 'lobby') throw new RoomError('Seats can only be changed in the lobby');
    const seat = this.seat(seatId);
    if (!seat) throw new RoomError('No such seat');
    if (seat.id === this.hostId) throw new RoomError('The host cannot remove themselves');
    this.seats = this.seats.filter((s) => s.id !== seatId);
    this.system(`${seat.name} was removed from the table.`);
    this.touch();
  }

  /** A human leaves voluntarily. In the lobby the seat is freed; mid-game it stays and auto-stands. */
  leave(seatId: string): void {
    const seat = this.seat(seatId);
    if (!seat || seat.isBot) return;
    if (this.status === 'lobby') {
      this.seats = this.seats.filter((s) => s.id !== seatId);
      this.system(`${seat.name} left.`);
    } else {
      seat.connected = false;
      seat.token = null; // cannot reclaim after an explicit leave
      this.system(`${seat.name} left the table.`);
    }
    if (this.hostId === seatId) this.reassignHost();
    this.touch();
  }

  setConnected(seatId: string, connected: boolean): void {
    const seat = this.seat(seatId);
    if (!seat || seat.isBot || seat.connected === connected) return;
    seat.connected = connected;
    this.system(connected ? `${seat.name} reconnected.` : `${seat.name} disconnected.`);
    if (!connected && this.hostId === seatId) this.reassignHost();
    if (connected && !this.hostConnected()) this.hostId = seatId;
    this.touch();
  }

  humansConnected(): number {
    return this.seats.filter((s) => !s.isBot && s.connected).length;
  }

  private hostConnected(): boolean {
    const h = this.seat(this.hostId);
    return !!h && h.connected && !h.isBot;
  }

  private reassignHost(): void {
    const next = this.seats.find((s) => !s.isBot && s.connected && s.id !== this.hostId);
    if (next) {
      this.hostId = next.id;
      this.system(`${next.name} is now the host.`);
    }
  }

  private uniqueName(name: string): string {
    const used = new Set(this.seats.map((s) => s.name.toLowerCase()));
    if (!used.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) {
      const candidate = `${name.slice(0, MAX_NAME_LENGTH - 3)} ${i}`;
      if (!used.has(candidate.toLowerCase())) return candidate;
    }
  }

  private requireHost(actorId: string | null): void {
    // actorId === null is an internal/system call (tests, server).
    if (actorId !== null && actorId !== this.hostId) throw new RoomError('Only the host can do that');
  }

  updateSettings(actorId: string | null, patch: Partial<RoomSettings>): void {
    this.requireHost(actorId);
    if (this.status !== 'lobby') throw new RoomError('Settings can only be changed in the lobby');
    if (patch.startingChips !== undefined) {
      if (!(STARTING_CHIP_OPTIONS as readonly number[]).includes(patch.startingChips)) throw new RoomError('Invalid starting chips');
      this.settings.startingChips = patch.startingChips;
    }
    if (patch.turnSeconds !== undefined) {
      if (!(TURN_TIMER_OPTIONS as readonly number[]).includes(patch.turnSeconds)) throw new RoomError('Invalid turn timer');
      this.settings.turnSeconds = patch.turnSeconds;
    }
    this.touch();
  }

  // ---------- chat ----------

  sendChat(seatId: string, raw: string): void {
    const seat = this.seat(seatId);
    if (!seat) throw new RoomError('You are not in this room');
    const text = String(raw ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, MAX_CHAT_LENGTH);
    if (!text) return;
    this.pushChat({ seatId, name: seat.name, text });
    this.touch();
  }

  private system(text: string): void {
    this.pushChat({ seatId: null, name: '', text });
  }

  private pushChat(m: Omit<ChatMessage, 'id' | 'at'>): void {
    this.chatSeq += 1;
    this.chat.push({ ...m, id: this.chatSeq, at: Date.now() });
    if (this.chat.length > MAX_CHAT) this.chat.splice(0, this.chat.length - MAX_CHAT);
  }

  // ---------- game flow ----------

  start(actorId: string | null): void {
    this.requireHost(actorId);
    if (this.status === 'playing') throw new RoomError('The game is already running');
    if (this.seats.length < MIN_PLAYERS) throw new RoomError(`At least ${MIN_PLAYERS} players are needed`);
    this.game = createGame(
      this.seats.map((s) => ({ id: s.id, name: s.name })),
      { startingChips: this.settings.startingChips },
      this.rng,
      { firstDealerIndex: Math.floor(this.rng() * this.seats.length) },
    );
    this.status = 'playing';
    this.readyIds.clear();
    this.nextRoundAt = null;
    this.system('The game begins!');
    this.touch();
  }

  rematch(actorId: string | null): void {
    this.requireHost(actorId);
    if (this.status !== 'finished') throw new RoomError('The game is not over yet');
    // Players who left for good make room for nobody new mid-rematch; drop them.
    this.seats = this.seats.filter((s) => s.isBot || s.token !== null);
    if (this.seats.length < MIN_PLAYERS) throw new RoomError('Not enough players for a rematch — add a bot');
    this.start(actorId);
  }

  backToLobby(actorId: string | null): void {
    this.requireHost(actorId);
    if (this.status !== 'finished') throw new RoomError('The game is not over yet');
    this.seats = this.seats.filter((s) => s.isBot || s.token !== null);
    this.status = 'lobby';
    this.game = null;
    this.clearTimers();
    this.deadline = null;
    this.nextRoundAt = null;
    this.touch();
  }

  act(seatId: string, action: GameAction): void {
    if (!this.game || this.status !== 'playing') throw new RoomError('No game in progress');
    const seat = this.seat(seatId);
    if (!seat) throw new RoomError('You are not in this room');
    this.applyGameAction(seatId, action);
  }

  markReady(seatId: string): void {
    if (!this.game || this.game.phase !== 'roundEnd') return;
    this.readyIds.add(seatId);
    if (this.allHumansReady()) this.advanceRound();
    else this.touch();
  }

  private allHumansReady(): boolean {
    if (!this.game) return false;
    const alive = new Set(this.game.players.filter((p) => !p.eliminated).map((p) => p.id));
    return this.seats.filter((s) => !s.isBot && s.connected && alive.has(s.id)).every((s) => this.readyIds.has(s.id));
  }

  private applyGameAction(seatId: string, action: GameAction): void {
    if (!this.game) return;
    try {
      this.game = applyAction(this.game, seatId, action, this.rng);
    } catch (e) {
      if (e instanceof IllegalMoveError) throw new RoomError(e.message);
      throw e;
    }
    if (this.game.phase === 'gameOver') {
      this.status = 'finished';
      const names = this.game.winnerIds.map((id) => this.seat(id)?.name ?? '?').join(' & ');
      this.system(`${names} wins the game!`);
    }
    if (this.game.phase === 'roundEnd') this.readyIds.clear();
    this.touch();
  }

  private advanceRound(): void {
    if (!this.game || this.game.phase !== 'roundEnd') return;
    this.game = nextRound(this.game, this.rng);
    this.readyIds.clear();
    this.touch();
  }

  // ---------- scheduling ----------

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.closed) return;
      try {
        fn();
      } catch (e) {
        if (!(e instanceof RoomError)) console.error(`[room ${this.code}]`, e);
        this.touch();
      }
    }, ms);
    this.timers.add(t);
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private botDelay(): number {
    const { botDelayMinMs: a, botDelayMaxMs: b } = this.timing;
    return a + Math.floor(this.rng() * (b - a + 1));
  }

  /** Re-plans every timer from the current state. Called after any change. */
  private schedule(): void {
    this.clearTimers();
    const g = this.game;
    if (!g || this.status !== 'playing') {
      this.deadline = null;
      this.nextRoundAt = null;
      return;
    }

    if (g.phase === 'turn' || g.phase === 'discard') {
      this.nextRoundAt = null;
      const pid = currentPlayerId(g) as string;
      const seat = this.seat(pid);
      const key = `turn:${g.round}:${g.turnIndex}`;
      if (key !== this.deadlineKey) {
        this.deadlineKey = key;
        this.deadline = Date.now() + this.settings.turnSeconds * 1000;
      }
      if (seat?.isBot) {
        this.later(this.botDelay(), () => this.runBot(seat));
      } else if (!seat?.connected) {
        this.later(this.timing.disconnectedActMs, () => this.runTimeout(pid));
      } else {
        this.later(Math.max(0, (this.deadline ?? 0) - Date.now()), () => this.runTimeout(pid));
      }
      return;
    }

    if (g.phase === 'impostor') {
      this.nextRoundAt = null;
      const key = `imp:${g.round}`;
      if (key !== this.deadlineKey) {
        this.deadlineKey = key;
        this.deadline = Date.now() + this.timing.impostorSeconds * 1000;
      }
      const pending = Object.keys(g.impostorRolls).filter((id) =>
        Object.values(g.impostorRolls[id]).some((r) => r && r.choice === null),
      );
      for (const id of pending) {
        const seat = this.seat(id);
        if (seat?.isBot) this.later(this.botDelay(), () => this.runBot(seat));
        else if (!seat?.connected) this.later(this.timing.disconnectedActMs, () => this.runTimeout(id));
      }
      this.later(Math.max(0, (this.deadline ?? 0) - Date.now()), () => {
        for (const id of pending) this.runTimeout(id, false);
        this.touch();
      });
      return;
    }

    if (g.phase === 'roundEnd') {
      this.deadline = null;
      const key = `end:${g.round}`;
      if (key !== this.deadlineKey) {
        this.deadlineKey = key;
        this.nextRoundAt = Date.now() + this.timing.roundSummaryMs;
      }
      if (this.allHumansReady()) {
        this.later(this.timing.botDelayMinMs, () => this.advanceRound());
      } else {
        this.later(Math.max(0, (this.nextRoundAt ?? 0) - Date.now()), () => this.advanceRound());
      }
    }
  }

  private runBot(seat: Seat): void {
    if (!this.game || this.status !== 'playing') return;
    const view = toGameView(this.game, seat.id); // bots see only their own seat's view
    const action = decideBotAction(view, seat.id, seat.botLevel ?? 'normal', this.rng);
    if (!action) return;
    try {
      this.applyGameAction(seat.id, action);
    } catch {
      // Should never happen; fall back to the safe automatic move.
      this.runTimeout(seat.id);
    }
  }

  private runTimeout(playerId: string, notify = true): void {
    if (!this.game || this.status !== 'playing') return;
    for (const a of timeoutActions(this.game, playerId)) {
      try {
        this.game = applyAction(this.game, playerId, a, this.rng);
      } catch {
        break;
      }
    }
    if (this.game.phase === 'gameOver') {
      this.status = 'finished';
      const names = this.game.winnerIds.map((id) => this.seat(id)?.name ?? '?').join(' & ');
      this.system(`${names} wins the game!`);
    }
    if (notify) this.touch();
  }

  // ---------- views ----------

  touch(): void {
    if (this.closed) return;
    this.lastActivity = Date.now();
    this.schedule();
    this.onChange(this);
  }

  viewFor(seatId: string | null): RoomView {
    return {
      code: this.code,
      youId: seatId,
      hostId: this.hostId,
      status: this.status,
      settings: { ...this.settings },
      seats: this.seats.map((s) => ({
        id: s.id,
        name: s.name,
        isBot: s.isBot,
        botLevel: s.botLevel,
        connected: s.connected,
        isHost: s.id === this.hostId,
      })),
      chat: this.chat.slice(-60),
      game: this.game ? toGameView(this.game, seatId) : null,
      deadline: this.deadline,
      nextRoundAt: this.nextRoundAt,
      readyIds: [...this.readyIds],
      serverNow: Date.now(),
    };
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
  }
}
