import type { BotLevel } from './bot';
import type { GameAction } from './engine';
import type { GameView } from './view';

export const TURN_TIMER_OPTIONS = [15, 30, 45, 60, 90] as const;
export const DEFAULT_TURN_SECONDS = 30;
export const DEFAULT_STARTING_CHIPS = 8;
export const DEFAULT_SHIFT_TOKENS = 0;
export const MAX_NAME_LENGTH = 20;
export const MAX_CHAT_LENGTH = 300;

export interface RoomSettings {
  startingChips: number;
  turnSeconds: number;
  /** Random shift tokens dealt to each player (0 = off). */
  shiftTokens: number;
}

export interface SeatView {
  id: string;
  name: string;
  isBot: boolean;
  botLevel: BotLevel | null;
  connected: boolean;
  isHost: boolean;
}

export interface ChatMessage {
  id: number;
  seatId: string | null;
  name: string;
  text: string;
  at: number;
}

export type RoomStatus = 'lobby' | 'playing' | 'finished';

export interface RoomView {
  code: string;
  youId: string | null;
  hostId: string | null;
  status: RoomStatus;
  settings: RoomSettings;
  seats: SeatView[];
  chat: ChatMessage[];
  game: GameView | null;
  /** Epoch ms when the current timer (turn or Impostor choice) runs out. */
  deadline: number | null;
  /** Epoch ms when the next round starts automatically (round summary). */
  nextRoundAt: number | null;
  readyIds: string[];
  serverNow: number;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  'room:create': (p: { name: string }, ack: Ack<{ code: string; token: string }>) => void;
  'room:join': (p: { code: string; name: string }, ack: Ack<{ code: string; token: string }>) => void;
  'room:resume': (p: { code: string; token: string }, ack: Ack<{ code: string }>) => void;
  'room:leave': (ack?: Ack) => void;
  'room:settings': (p: Partial<RoomSettings>, ack?: Ack) => void;
  'room:addBot': (p: { level: BotLevel }, ack?: Ack) => void;
  'room:removeSeat': (p: { seatId: string }, ack?: Ack) => void;
  'room:start': (ack?: Ack) => void;
  'room:rematch': (ack?: Ack) => void;
  'room:lobby': (ack?: Ack) => void;
  'round:ready': (ack?: Ack) => void;
  'game:action': (p: GameAction, ack?: Ack) => void;
  'chat:send': (p: { text: string }, ack?: Ack) => void;
}

export interface ServerToClientEvents {
  'room:state': (view: RoomView) => void;
  'room:closed': (p: { reason: string }) => void;
}
