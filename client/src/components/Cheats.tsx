import { useState } from 'react';
import { CHEAT_CATCH_CHANCE, CHEATS, cheatFine, type CheatId } from '../../../shared/src/cheats';
import type { DrawSource, GameAction } from '../../../shared/src/engine';
import { viewCanDrawFrom, type GameView } from '../../../shared/src/view';

const CATCH_PCT = Math.round(CHEAT_CATCH_CHANCE * 100);

/** Opponents a Peek can target, as seen from a view (mirrors the engine's checks). */
function peekTargets(game: GameView, youId: string): string[] {
  return game.turnOrder.filter((id) => {
    if (id === youId) return false;
    const p = game.players.find((x) => x.id === id);
    return !!p && !p.eliminated && p.hasHand && !p.immune;
  });
}

/** Turn-time cheats (Peek, Double Draw). Shown only when the table has cheats on and it's your turn. */
export function CheatTray({
  game,
  youId,
  busy,
  canDraw,
  act,
}: {
  game: GameView;
  youId: string;
  busy: boolean;
  canDraw: boolean;
  act: (a: GameAction) => void;
}) {
  const [selected, setSelected] = useState<CheatId | null>(null);
  const me = game.players.find((p) => p.id === youId);
  if (!me || !game.cheatsEnabled || game.phase !== 'turn' || game.currentPlayerId !== youId) return null;

  const used = game.cheatUsedThisTurn;
  const fine = cheatFine(me.timesCaught + 1);
  const targets = peekTargets(game, youId);
  const sel = used ? null : selected;
  const blocked: Record<'peek' | 'doubleDraw', string | null> = {
    peek: used ? 'Already cheated this turn' : targets.length === 0 ? 'Nobody to peek at' : null,
    doubleDraw: used ? 'Already cheated this turn' : !canDraw ? "You can't draw this turn" : null,
  };
  const run = (a: GameAction) => {
    act(a);
    setSelected(null);
  };

  return (
    <div className="token-tray cheat-tray">
      <div className="token-row">
        <span className="token-label">
          Cheats <span className="muted">· {CATCH_PCT}% chance to get caught · fine {fine} chip{fine === 1 ? '' : 's'}</span>
        </span>
        {(['peek', 'doubleDraw'] as const).map((id) => (
          <button
            key={id}
            className={`btn small cheat-btn ${sel === id ? 'selected' : ''}`}
            disabled={busy || blocked[id] !== null}
            title={`${CHEATS[id].name}: ${CHEATS[id].text}${blocked[id] ? ` (${blocked[id]})` : ''}`}
            onClick={() => setSelected(sel === id ? null : id)}
          >
            {id === 'peek' ? '👁 Peek' : '🂠 Double Draw'}
          </button>
        ))}
      </div>
      {sel && (
        <div className="token-confirm">
          <span className="small">
            <b>{CHEATS[sel].name}:</b> {CHEATS[sel].text}
          </span>
          <span className="target-row">
            {sel === 'peek'
              ? targets.map((id) => (
                  <button key={id} className="btn small primary" disabled={busy} onClick={() => run({ type: 'cheat', cheat: 'peek', targetId: id })}>
                    {game.players.find((p) => p.id === id)?.name}
                  </button>
                ))
              : (['sandDeck', 'bloodDeck'] as DrawSource[]).map((s) => (
                  <button
                    key={s}
                    className={`btn small draw ${s === 'sandDeck' ? 'sand' : 'blood'}`}
                    disabled={busy || !viewCanDrawFrom(game, s)}
                    onClick={() => run({ type: 'cheat', cheat: 'doubleDraw', source: s })}
                  >
                    {s === 'sandDeck' ? 'Sand deck' : 'Blood deck'}
                  </button>
                ))}
          </span>
          <button className="btn small ghost" onClick={() => setSelected(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
