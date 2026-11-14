import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/src/protocol';

export type KSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const socket: KSocket = io({ transports: ['websocket', 'polling'], autoConnect: true });

export type AckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Emits an event with an ack and resolves with the server's reply (or a timeout error). */
export function request<T = object>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<AckResult<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'The server did not respond' }), 8000);
    (socket.emit as (...a: unknown[]) => void)(event, ...args, (res: AckResult<T>) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

// ---------- local storage (always guarded) ----------

const SESSION_KEY = 'kessel:session';
const NAME_KEY = 'kessel:name';

export interface Session {
  code: string;
  token: string;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function loadSession(): Session | null {
  const raw = safeGet(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    return s && typeof s.code === 'string' && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session | null): void {
  safeSet(SESSION_KEY, s ? JSON.stringify(s) : null);
}
const NAME_WORDS = ['player', 'pilot', 'gambler', 'smuggler', 'drifter', 'rogue', 'ace', 'captain', 'scoundrel', 'dealer'];

/** A generic example name like "pilot67", shown as the name box placeholder. */
export function randomName(): string {
  const word = NAME_WORDS[Math.floor(Math.random() * NAME_WORDS.length)];
  return `${word}${10 + Math.floor(Math.random() * 90)}`;
}

/** The saved display name, or empty if this browser has none yet. */
export function loadName(): string {
  return safeGet(NAME_KEY) ?? '';
}
export function saveName(name: string): void {
  safeSet(NAME_KEY, name);
}
export function loadPref(key: string): string | null {
  return safeGet(`kessel:${key}`);
}
export function savePref(key: string, value: string): void {
  safeSet(`kessel:${key}`, value);
}

export function roomLink(code: string): string {
  return `${window.location.origin}/?r=${encodeURIComponent(code)}`;
}

export function codeFromUrl(): string | null {
  const r = new URLSearchParams(window.location.search).get('r');
  return r ? r.trim().toUpperCase() : null;
}

export function setUrlCode(code: string | null): void {
  const url = code ? `/?r=${encodeURIComponent(code)}` : '/';
  if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, '', url);
}

// ---------- home screen routing (/, /public, /private, /?r=CODE) ----------

export type HomeScreen = 'menu' | 'public' | 'private';

export function homeScreenFromUrl(): HomeScreen {
  const p = window.location.pathname.replace(/\/+$/, '');
  return p === '/public' ? 'public' : p === '/private' ? 'private' : 'menu';
}

/** Switches home screens with a real history entry, so the phone's back button returns to the menu. */
export function goHomeScreen(screen: HomeScreen): void {
  const url = screen === 'menu' ? '/' : `/${screen}`;
  if (window.location.pathname + window.location.search !== url) window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
