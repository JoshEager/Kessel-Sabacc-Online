import { useState } from 'react';
import type { GameAction } from '../../../shared/src/engine';
import type { RoundRules } from '../../../shared/src/evaluate';
import { SHIFT_TOKENS, type ShiftTokenId } from '../../../shared/src/tokens';
import { viewTokenBlockReason, viewTokenTargets, type GameView } from '../../../shared/src/view';
import { request } from '../net';
import { useSecondsLeft } from './Countdown';
import { Die } from './Dice';

const GROUP_GLYPH: Record<string, string> = {
  chips: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zm0 3a5 5 0 1 1 0 10a5 5 0 1 1 0-10z',
  tax: 'M6 5h12v3H13.5v11h-3V8H6z',
  rules: 'M12 3l2.6 5.6 6 .6-4.5 4 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.5-4 6-.6z',
  hands: 'M4 7h11l-3-3h3l4.5 4.5L15 13h-3l3-3H4zm16 10H9l3 3H9l-4.5-4.5L9 11h3l-3 3h11z',
  control: 'M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z',
};

/** A hexagonal shift-token chip. */
export function TokenChip({
  id,
  onClick,
  disabled,
  selected,
  title,
  compact,
}: {
  id: ShiftTokenId;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  title?: string;
  compact?: boolean;
}) {
  const def = SHIFT_TOKENS[id];
  const inner = (
    <>
      <svg viewBox="0 0 24 24" className="token-glyph" aria-hidden="true">
        <path d={GROUP_GLYPH[def.group]} fill="currentColor" fillRule="evenodd" />
      </svg>
      {!compact && <span className="token-name">{def.name}</span>}
    </>
  );
  const cls = `token-chip g-${def.group} ${selected ? 'selected' : ''} ${compact ? 'compact' : ''}`;
  const tip = title ?? `${def.name}: ${def.text}`;
  if (!onClick) {
    return (
      <span className={cls} title={tip}>
        {inner}
      </span>
    );
  }
  return (
    <button type="button" className={`${cls} clickable`} onClick={onClick} disabled={disabled} title={tip} aria-label={tip}>
      {inner}
    </button>
  );
}

/** The player's own tokens, with targeting when needed. Playable only at the start of their turn. */
export function TokenTray({
  game,
  youId,
  busy,
  act,
}: {
  game: GameView;
  youId: string;
  busy: boolean;
  act: (a: GameAction) => void;
}) {
  const me = game.players.find((p) => p.id === youId);
  const [selected, setSelected] = useState<ShiftTokenId | null>(null);
  if (!me || !game.shiftTokensEnabled) return null;
  if (me.tokens.length === 0) return <div className="token-tray empty muted small">No shift tokens left</div>;

  const myTurn = game.phase === 'turn' && game.currentPlayerId === youId;
  const sel = selected && me.tokens.includes(selected) && myTurn ? selected : null;
  const selDef = sel ? SHIFT_TOKENS[sel] : null;
  const targets = sel ? viewTokenTargets(game, youId, sel) : [];

  const choose = (t: ShiftTokenId) => setSelected(t === selected ? null : t);

  return (
    <div className="token-tray">
      <div className="token-row">
        <span className="token-label">Your shift tokens{myTurn && !game.tokenPlayedThisTurn ? ' — play one before you act:' : ''}</span>
        {me.tokens.map((t) => {
          const reason = viewTokenBlockReason(game, youId, t);
          return (
            <TokenChip
              key={t}
              id={t}
              selected={sel === t}
              disabled={busy || reason !== null}
              title={`${SHIFT_TOKENS[t].name}: ${SHIFT_TOKENS[t].text}${reason && myTurn ? ` (${reason})` : ''}`}
              onClick={() => choose(t)}
            />
          );
        })}
      </div>
      {sel && selDef && (
        <div className="token-confirm">
          <span className="small">
            <b>{selDef.name}:</b> {selDef.text}
          </span>
          {selDef.target === 'none' ? (
            <button
              className="btn small primary"
              disabled={busy}
              onClick={() => {
                act({ type: 'playToken', token: sel });
                setSelected(null);
              }}
            >
              Play
            </button>
          ) : (
            <span className="target-row">
              {targets.map((id) => (
                <button
                  key={id}
                  className="btn small primary"
                  disabled={busy}
                  onClick={() => {
                    act({ type: 'playToken', token: sel, targetId: id });
                    setSelected(null);
                  }}
                >
                  {game.players.find((p) => p.id === id)?.name}
                </button>
              ))}
            </span>
          )}
          <button className="btn small ghost" onClick={() => setSelected(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Dice picker shown to the player who just played Prime Sabacc. */
export function PrimeChoicePrompt({
  game,
  youId,
  deadline,
  now,
}: {
  game: GameView;
  youId: string;
  deadline: number | null;
  now: () => number;
}) {
  const left = useSecondsLeft(deadline, now);
  const [busy, setBusy] = useState(false);
  const pp = game.pendingPrime;
  if (game.phase !== 'primeChoice' || !pp || pp.playerId !== youId) return null;

  async function choose(choice: 0 | 1) {
    setBusy(true);
    await request('game:action', { type: 'choosePrime', choice });
    setBusy(false);
  }

  return (
    <div className="modal-wrap">
      <div className="modal impostor-modal" role="dialog" aria-label="Choose the Prime Sabacc value">
        <h2>Prime Sabacc</h2>
        <p className="muted small">
          Pick one die. A pair of that value becomes the best Sabacc (after Pure Sabacc) until the reveal.
          {left !== null && <> Chosen for you in {left}s.</>}
        </p>
        <div className="dice-choice center-row">
          {pp.dice.map((d, i) => (
            <Die
              key={i}
              value={d}
              rollKey={`prime-${game.round}-${game.turnNumber}-${i}`}
              size={64}
              onClick={busy ? undefined : () => choose(i as 0 | 1)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function activeRuleLabels(rules: RoundRules): string[] {
  const out: string[] = [];
  if (rules.primeValue) out.push(`Prime Sabacc: pair of ${rules.primeValue}s is best`);
  if (rules.cookTheBooks) out.push('Cook the Books: Sabacc ranks inverted');
  if (rules.markdown) out.push('Markdown: Sylops worth 0');
  if (rules.majorFraud) out.push('Major Fraud: Impostors worth 6');
  return out;
}

/** Banner over the table listing rule changes active until the reveal. */
export function RulesBanner({ rules, freeDraw }: { rules: RoundRules; freeDraw: boolean }) {
  const labels = activeRuleLabels(rules);
  if (freeDraw) labels.push('Free Draw active');
  if (labels.length === 0) return null;
  return (
    <div className="rules-banner" role="status">
      {labels.map((l) => (
        <span key={l} className="rule-pill">
          {l}
        </span>
      ))}
    </div>
  );
}
