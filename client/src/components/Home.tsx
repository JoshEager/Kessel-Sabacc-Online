import { useEffect, useState, type ReactNode } from 'react';
import { MAX_NAME_LENGTH, type RoomSummary } from '../../../shared/src/protocol';
import {
  codeFromUrl,
  goHomeScreen,
  homeScreenFromUrl,
  loadName,
  randomName,
  request,
  saveName,
  saveSession,
  setUrlCode,
  socket,
  type HomeScreen,
} from '../net';
import { NO_AUTOFILL } from '../noAutofill';
import { useInstall } from '../pwa';
import { CardFace } from './Card';
import { RulesPanel } from './RulesPanel';

type Joined = { code: string; token: string };

export function Home({ notice, clearNotice }: { notice: string | null; clearNotice: () => void }) {
  const [inviteCode, setInviteCode] = useState(codeFromUrl);
  const [screen, setScreen] = useState<HomeScreen>(homeScreenFromUrl);
  const [name, setName] = useState(loadName);
  const [namePlaceholder] = useState(randomName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const { mode: installMode, install } = useInstall();

  useEffect(() => {
    const onPop = () => {
      setScreen(homeScreenFromUrl());
      setInviteCode(codeFromUrl());
      setError(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function go(next: HomeScreen) {
    clearNotice();
    goHomeScreen(next);
  }

  /** Validates the name, runs the create/join request and stores the session on success. */
  async function enter(event: 'room:create' | 'room:join', payload: Record<string, unknown>) {
    clearNotice();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a display name first.');
      return;
    }
    setBusy(true);
    setError(null);
    saveName(trimmed);
    const res = await request<Joined>(event, { ...payload, name: trimmed });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    saveSession({ code: res.code, token: res.token });
  }

  const host = (isPublic: boolean) => enter('room:create', { isPublic });
  const join = (code: string) => enter('room:join', { code: code.trim().toUpperCase() });

  let body: ReactNode;
  if (inviteCode) {
    body = (
      <InviteScreen
        code={inviteCode}
        busy={busy}
        onJoin={() => join(inviteCode)}
        onBack={() => {
          setUrlCode(null);
          setInviteCode(null);
          go('menu');
        }}
      />
    );
  } else if (screen === 'public') {
    body = <PublicScreen busy={busy} onHost={() => host(true)} onJoin={join} onBack={() => go('menu')} />;
  } else if (screen === 'private') {
    body = <PrivateScreen busy={busy} onHost={() => host(false)} onJoin={join} onBack={() => go('menu')} />;
  } else {
    body = (
      <div className="mode-choices">
        <button type="button" className="mode-btn" onClick={() => go('public')}>
          <span className="mode-title">Public game</span>
          <span className="mode-sub">Browse open tables or host one anyone can join</span>
        </button>
        <button type="button" className="mode-btn" onClick={() => go('private')}>
          <span className="mode-title">Private game</span>
          <span className="mode-sub">Play with friends using a room code or link</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`home ${screen === 'public' && !inviteCode ? 'wide' : ''}`}>
      <div className="home-hero" aria-hidden="true">
        <div className="hero-card hero-left">
          <CardFace card={{ id: 'h1', suit: 'sand', kind: 'sylop', value: 0 }} />
        </div>
        <div className="hero-card hero-right">
          <CardFace card={{ id: 'h2', suit: 'blood', kind: 'sylop', value: 0 }} />
        </div>
      </div>
      <h1 className="title">
        Kessel Sabacc <span>Online</span>
      </h1>
      <p className="tagline">Two suits. Three turns. Lowest difference wins — unless someone pairs up.</p>

      <div className="panel home-form">
        <label className="field">
          <span>Display name</span>
          <input
            {...NO_AUTOFILL}
            value={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder={namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {body}
        {(error || notice) && <p className="error">{error ?? notice}</p>}
      </div>

      <button className="btn ghost" onClick={() => setRulesOpen(true)}>
        How to play
      </button>
      {installMode === 'prompt' && (
        <button className="btn install-btn" onClick={() => void install()}>
          Install app
        </button>
      )}
      {installMode === 'ios' && (
        <p className="install-hint">
          Install on iPhone: tap <b>Share</b>, then <b>Add to Home Screen</b>.
        </p>
      )}
      <RulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <p className="footnote">A fan-made, unofficial game. All art is original.</p>
    </div>
  );
}

function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="screen-head">
      <button type="button" className="btn ghost small" onClick={onBack} aria-label="Back to menu">
        ← Back
      </button>
      <h2>{title}</h2>
    </div>
  );
}

function settingsText(r: RoomSummary): string {
  const s = r.settings;
  return [`${s.startingChips} chips`, `${s.turnSeconds}s turns`, s.shiftTokens ? `${s.shiftTokens} tokens` : null]
    .filter(Boolean)
    .join(' · ');
}

function seatsText(r: RoomSummary): string {
  const bots = r.bots ? ` · ${r.bots} bot${r.bots > 1 ? 's' : ''}` : '';
  return `${r.seatsTaken}/${r.maxSeats} seats${bots}`;
}

/** Live list of public rooms: subscribes on mount (and after reconnects), unsubscribes on unmount. */
function usePublicRooms(): RoomSummary[] | null {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  useEffect(() => {
    let active = true;
    const watch = async () => {
      const res = await request<{ rooms: RoomSummary[] }>('lobby:watch');
      if (active && res.ok) setRooms(res.rooms);
    };
    const onRooms = (list: RoomSummary[]) => setRooms(list);
    socket.on('lobby:rooms', onRooms);
    socket.on('connect', watch);
    if (socket.connected) void watch();
    return () => {
      active = false;
      socket.off('lobby:rooms', onRooms);
      socket.off('connect', watch);
      if (socket.connected) socket.emit('lobby:unwatch');
    };
  }, []);
  return rooms;
}

function PublicScreen(props: { busy: boolean; onHost: () => void; onJoin: (code: string) => void; onBack: () => void }) {
  const rooms = usePublicRooms();
  return (
    <>
      <ScreenHeader title="Public tables" onBack={props.onBack} />
      <button type="button" className="btn primary big" disabled={props.busy} onClick={props.onHost}>
        Host a public table
      </button>
      {rooms === null ? (
        <p className="muted small center">Loading tables…</p>
      ) : rooms.length === 0 ? (
        <p className="room-empty">No public tables right now. Host one and other players can join it from here.</p>
      ) : (
        <ul className="room-list">
          {rooms.map((r) => (
            <li key={r.code} className={`room-row ${r.joinable ? '' : 'closed'}`}>
              <div className="room-info">
                <b>{r.hostName}&apos;s table</b>
                <span className="muted small">
                  {seatsText(r)} · {settingsText(r)}
                </span>
              </div>
              {r.joinable ? (
                <button type="button" className="btn" disabled={props.busy} onClick={() => props.onJoin(r.code)}>
                  Join
                </button>
              ) : (
                <span className="badge">{r.status === 'lobby' ? 'Full' : 'In game'}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PrivateScreen(props: { busy: boolean; onHost: () => void; onJoin: (code: string) => void; onBack: () => void }) {
  const [code, setCode] = useState('');
  return (
    <>
      <ScreenHeader title="Private game" onBack={props.onBack} />
      <button type="button" className="btn primary big" disabled={props.busy} onClick={props.onHost}>
        Host a private table
      </button>
      <form
        className="join-row"
        autoComplete="off"
        data-bwignore="true"
        onSubmit={(e) => {
          e.preventDefault();
          props.onJoin(code);
        }}
      >
        <label className="field grow">
          <span>Or join with a code</span>
          <input
            {...NO_AUTOFILL}
            value={code}
            maxLength={8}
            placeholder="ABCDE"
            className="code-input"
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <button type="submit" className="btn" disabled={props.busy || !code.trim()}>
          Join
        </button>
      </form>
    </>
  );
}

function InviteScreen(props: { code: string; busy: boolean; onJoin: () => void; onBack: () => void }) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const peek = async () => {
      const res = await request<{ room: RoomSummary }>('room:peek', { code: props.code });
      if (!active) return;
      if (res.ok) setRoom(res.room);
      else setMissing(res.error);
    };
    socket.on('connect', peek);
    if (socket.connected) void peek();
    return () => {
      active = false;
      socket.off('connect', peek);
    };
  }, [props.code]);

  return (
    <>
      <div className="invite-card">
        <span className="muted small">You were invited to {room?.isPublic ? 'a public table' : 'a table'}</span>
        <div className="room-code">{props.code}</div>
        {room && (
          <span className="muted small">
            {room.hostName}&apos;s table · {seatsText(room)} · {settingsText(room)}
          </span>
        )}
        {missing && <span className="error">{missing}.</span>}
      </div>
      <button
        type="button"
        className="btn primary big"
        disabled={props.busy || !!missing || (room !== null && !room.joinable)}
        onClick={props.onJoin}
      >
        {room && !room.joinable ? (room.status === 'lobby' ? 'Table is full' : 'Game already started') : 'Join table'}
      </button>
      <button type="button" className="btn ghost small" onClick={props.onBack}>
        Back to menu
      </button>
    </>
  );
}
