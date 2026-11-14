import { useState, type ReactNode } from 'react';
import { suitName } from '../../../shared/src/cards';
import type { ChipChange, HandResult } from '../../../shared/src/engine';
import type { RoomView } from '../../../shared/src/protocol';
import { request } from '../net';
import { CardView } from './Card';
import { useSecondsLeft } from './Countdown';
import { DieFace } from './Dice';

function chipText(c: ChipChange): string {
  const parts: string[] = [];
  if (c.returned > 0) parts.push(`+${c.returned} invested back`);
  if (c.investedLost > 0) parts.push(`−${c.investedLost} invested lost`);
  if (c.penaltyDue > 0) {
    parts.push(
      c.penaltyPaid < c.penaltyDue ? `−${c.penaltyPaid} penalty (owed ${c.penaltyDue})` : `−${c.penaltyPaid} penalty`,
    );
  }
  if (parts.length === 0) parts.push('no change');
  return parts.join(', ');
}

function Resolution({ h }: { h: HandResult }) {
  const bits: ReactNode[] = [];
  for (const suit of ['sand', 'blood'] as const) {
    const imp = h.impostors[suit];
    if (imp) {
      bits.push(
        <span key={`i${suit}`} className="res-bit">
          {suitName(suit)} Impostor rolled
          <span className="mini-dice">
            {imp.dice.map((d, i) => (
              <span key={i} className={`mini-die ${d === imp.value && imp.dice.indexOf(d) === i ? 'picked' : ''}`}>
                <DieFace value={d} />
              </span>
            ))}
          </span>
          → {imp.value}
        </span>,
      );
    }
  }
  const sylops = (['sand', 'blood'] as const).filter((s) => h[s].kind === 'sylop');
  if (sylops.length === 2) {
    bits.push(
      <span key="ss" className="res-bit">
        Two Sylops
      </span>,
    );
  } else if (sylops.length === 1) {
    const s = sylops[0];
    const v = s === 'sand' ? h.resolved.sandValue : h.resolved.bloodValue;
    bits.push(
      <span key="s" className="res-bit">
        {suitName(s)} Sylop copies {v}
      </span>,
    );
  }
  const values = h.resolved.category === 'pure' ? null : `${h.resolved.sandValue} & ${h.resolved.bloodValue}`;
  return (
    <div className="resolution">
      {bits}
      {values && <span className="res-bit values">Values {values}</span>}
    </div>
  );
}

export function RoundSummary({ view, now, onLeave }: { view: RoomView; now: () => number; onLeave: () => void }) {
  const game = view.game!;
  const result = game.lastResult!;
  const [hidden, setHidden] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const left = useSecondsLeft(view.nextRoundAt, now);
  const isHost = view.youId === view.hostId;
  const over = game.phase === 'gameOver';
  const ready = view.youId ? view.readyIds.includes(view.youId) : false;
  const me = game.players.find((p) => p.id === view.youId);

  if (hidden === result.round && !over) {
    return (
      <button className="btn primary summary-reopen" onClick={() => setHidden(null)}>
        Round summary
      </button>
    );
  }

  const winners = result.winnerIds.map((id) => result.hands.find((h) => h.playerId === id)?.name ?? '?');
  const best = result.hands.find((h) => h.winner)?.resolved.label ?? '';
  const gameWinners = game.winnerIds.map((id) => game.players.find((p) => p.id === id)?.name ?? '?');

  async function run(event: 'room:rematch' | 'room:lobby' | 'round:ready') {
    setError(null);
    const res = await request(event);
    if (!res.ok) setError(res.error);
  }

  return (
    <div className="modal-wrap">
      <div className={`modal summary ${over ? 'game-over' : ''}`} role="dialog" aria-label="Round summary">
        {over ? (
          <div className="trophy">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <path d="M18 8h28v10a14 14 0 0 1-28 0z" fill="currentColor" />
              <path d="M18 12H8a10 10 0 0 0 12 12M46 12h10a10 10 0 0 1-12 12" fill="none" stroke="currentColor" strokeWidth="4" />
              <rect x="28" y="32" width="8" height="12" fill="currentColor" />
              <rect x="18" y="46" width="28" height="8" rx="2" fill="currentColor" />
            </svg>
            <h2>{gameWinners.join(' & ')} wins the game!</h2>
          </div>
        ) : (
          <h2>Round {result.round} results</h2>
        )}
        <p className="summary-lead">
          {winners.join(' & ')} {winners.length > 1 ? 'tie with' : 'wins with'} <b>{best}</b>.
        </p>

        <div className="summary-table">
          {result.hands.map((h) => {
            const c = result.chips.find((x) => x.playerId === h.playerId)!;
            return (
              <div key={h.playerId} className={`summary-row ${h.winner ? 'win' : ''} ${h.playerId === view.youId ? 'you' : ''}`}>
                <span className="place">#{h.place}</span>
                <div className="summary-who">
                  <b>{h.name}</b>
                  <span className={`hand-label ${h.resolved.category}`}>{h.resolved.label}</span>
                </div>
                <div className="summary-cards">
                  <CardView card={h.sand} suit="sand" size="xs" />
                  <CardView card={h.blood} suit="blood" size="xs" />
                </div>
                <Resolution h={h} />
                <div className="summary-chips">
                  <span className="small">{chipText(c)}</span>
                  <b>
                    {c.stackBefore} → {c.chipsAfter}
                  </b>
                  {c.eliminated && <span className="badge off">eliminated</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="summary-actions">
          {over ? (
            isHost ? (
              <>
                <button className="btn primary" onClick={() => run('room:rematch')}>
                  Rematch
                </button>
                <button className="btn" onClick={() => run('room:lobby')}>
                  Back to lobby
                </button>
                <button className="btn ghost" onClick={onLeave}>
                  Leave
                </button>
              </>
            ) : (
              <>
                <span className="muted small">Waiting for the host to start a rematch…</span>
                <button className="btn ghost" onClick={onLeave}>
                  Leave
                </button>
              </>
            )
          ) : (
            <>
              <button className="btn ghost" onClick={() => setHidden(result.round)}>
                View table
              </button>
              {me && !me.eliminated ? (
                <button className="btn primary" disabled={ready} onClick={() => run('round:ready')}>
                  {ready ? 'Waiting for others…' : 'Next round'}
                  {left !== null && <span className="muted small"> ({left}s)</span>}
                </button>
              ) : (
                <span className="muted small">Next round in {left ?? 0}s</span>
              )}
            </>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
