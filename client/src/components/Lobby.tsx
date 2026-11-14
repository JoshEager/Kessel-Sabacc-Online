import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, STARTING_CHIP_OPTIONS } from '../../../shared/src/engine';
import { TURN_TIMER_OPTIONS, type RoomView } from '../../../shared/src/protocol';
import { SHIFT_TOKEN_OPTIONS } from '../../../shared/src/tokens';
import { request, roomLink } from '../net';
import { ChatBox } from './SidePanel';
import { RulesPanel } from './RulesPanel';

export function Lobby({ view, onLeave }: { view: RoomView; onLeave: () => void }) {
  const isHost = view.youId === view.hostId;
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  async function run(event: Parameters<typeof request>[0], ...args: unknown[]) {
    setError(null);
    const res = await request(event, ...args);
    if (!res.ok) setError(res.error);
  }

  async function copy() {
    const link = roomLink(view.code);
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Kessel Sabacc', text: `Join my Sabacc table: ${view.code}`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link', link);
    }
  }

  const empty = MAX_PLAYERS - view.seats.length;

  return (
    <div className="lobby">
      <header className="topbar">
        <h1 className="title small">
          Kessel Sabacc <span>Online</span>
        </h1>
        <div className="topbar-actions">
          <button className="btn ghost small" onClick={() => setRulesOpen(true)}>
            Rules
          </button>
          <button className="btn ghost small" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      <div className="lobby-grid">
        <section className="panel">
          <div className="room-code-block">
            <span className="muted small">Room code</span>
            <div className="room-code">{view.code}</div>
            <span className={`badge visibility ${view.settings.isPublic ? 'public' : 'private'}`}>
              {view.settings.isPublic ? 'Public · listed in Public games' : 'Private · code or link only'}
            </span>
            <button className="btn small" onClick={copy}>
              {copied ? 'Link copied!' : 'Copy invite link'}
            </button>
          </div>

          <h2 className="section-title">
            Seats <span className="muted">({view.seats.length}/{MAX_PLAYERS})</span>
          </h2>
          <ul className="seat-list">
            {view.seats.map((s) => (
              <li key={s.id} className={`seat-row ${s.id === view.youId ? 'you' : ''}`}>
                <span className={`presence ${s.connected ? 'on' : 'off'}`} title={s.connected ? 'Connected' : 'Disconnected'} />
                <span className="seat-name">
                  {s.name}
                  {s.id === view.youId && <em> (you)</em>}
                </span>
                {s.isHost && <span className="badge host">Host</span>}
                {s.isBot && <span className={`badge bot ${s.botLevel}`}>{s.botLevel === 'easy' ? 'Easy bot' : 'Normal bot'}</span>}
                {isHost && s.id !== view.youId && (
                  <button className="btn icon small" aria-label={`Remove ${s.name}`} onClick={() => run('room:removeSeat', { seatId: s.id })}>
                    ✕
                  </button>
                )}
              </li>
            ))}
            {Array.from({ length: empty }, (_, i) => (
              <li key={`empty${i}`} className="seat-row empty">
                <span className="presence" />
                <span className="seat-name muted">Open seat</span>
                {isHost && (
                  <span className="add-bot">
                    <button className="btn small" onClick={() => run('room:addBot', { level: 'easy' })}>
                      + Easy bot
                    </button>
                    <button className="btn small" onClick={() => run('room:addBot', { level: 'normal' })}>
                      + Normal bot
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>

          <h2 className="section-title">Table settings</h2>
          <div className="settings">
            <label className="field">
              <span>Visibility</span>
              <select
                value={view.settings.isPublic ? 'public' : 'private'}
                disabled={!isHost}
                onChange={(e) => run('room:settings', { isPublic: e.target.value === 'public' })}
              >
                <option value="private">Private (code or link)</option>
                <option value="public">Public (listed for anyone)</option>
              </select>
            </label>
            <label className="field">
              <span>Starting chips</span>
              <select
                value={view.settings.startingChips}
                disabled={!isHost}
                onChange={(e) => run('room:settings', { startingChips: Number(e.target.value) })}
              >
                {STARTING_CHIP_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Turn timer</span>
              <select
                value={view.settings.turnSeconds}
                disabled={!isHost}
                onChange={(e) => run('room:settings', { turnSeconds: Number(e.target.value) })}
              >
                {TURN_TIMER_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} seconds
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Shift tokens</span>
              <select
                value={view.settings.shiftTokens}
                disabled={!isHost}
                onChange={(e) => run('room:settings', { shiftTokens: Number(e.target.value) })}
              >
                {SHIFT_TOKEN_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'Off' : `${n} random per player`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isHost ? (
            <button className="btn primary big" disabled={view.seats.length < MIN_PLAYERS} onClick={() => run('room:start')}>
              {view.seats.length < MIN_PLAYERS ? 'Invite a friend or add a bot' : 'Start game'}
            </button>
          ) : (
            <p className="muted center">Waiting for the host to start the game…</p>
          )}
          {error && <p className="error">{error}</p>}
        </section>

        <section className="panel chat-panel">
          <h2 className="section-title">Chat</h2>
          <ChatBox chat={view.chat} youId={view.youId} />
        </section>
      </div>
      <RulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}
