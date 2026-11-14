import { useEffect, useMemo, useRef, useState } from 'react';
import { cardLabel, SUITS, suitName, type Card, type Suit } from '../../../shared/src/cards';
import { DRAW_COST, type DrawSource, type GameAction } from '../../../shared/src/engine';
import type { RoomView, SeatView } from '../../../shared/src/protocol';
import { viewCanDrawFrom, type GameView, type PlayerView } from '../../../shared/src/view';
import { request } from '../net';
import { isMuted, onMutedChange, play, setMuted } from '../sound';
import { CHEAT_CATCH_CHANCE } from '../../../shared/src/cheats';
import { CheatTray } from './Cheats';
import { CardView } from './Card';
import { CountdownRing, useSecondsLeft } from './Countdown';
import { Die } from './Dice';
import { RoundSummary } from './RoundSummary';
import { RulesPanel } from './RulesPanel';
import { SidePanel } from './SidePanel';
import { PrimeChoicePrompt, RulesBanner, TokenChip, TokenTray } from './Tokens';

type Pos = 'left' | 'top' | 'right' | 'grid';
const POSITIONS: Record<number, Pos[]> = { 0: [], 1: ['top'], 2: ['left', 'right'], 3: ['left', 'top', 'right'] };

const SOURCE_LABEL: Record<DrawSource, string> = {
  sandDeck: 'Sand deck',
  sandDiscard: 'Sand discard',
  bloodDiscard: 'Blood discard',
  bloodDeck: 'Blood deck',
};

export function Table({ view, now, onLeave }: { view: RoomView; now: () => number; onLeave: () => void }) {
  const game = view.game as GameView;
  const youId = view.youId as string;
  const me = game.players.find((p) => p.id === youId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  useEffect(() => onMutedChange(setMutedState), []);

  useGameSounds(game, youId, view);

  const seatInfo = useMemo(() => Object.fromEntries(view.seats.map((s) => [s.id, s])), [view.seats]);

  // Opponents clockwise from me: left, top, right.
  const myIdx = Math.max(0, game.players.findIndex((p) => p.id === youId));
  const others = [...game.players.slice(myIdx + 1), ...game.players.slice(0, myIdx)];
  const positions = POSITIONS[others.length] ?? [];
  // More than 3 opponents: lay them out in a grid across the top instead of around the table.
  const many = others.length > 3;

  const myTurn = game.currentPlayerId === youId;
  const iDrew = game.phase === 'discard' && game.pendingDraw?.playerId === youId;
  const canDraw = myTurn && game.phase === 'turn' && !!me && !me.embargoed && (game.freeDraw || me.chips >= DRAW_COST);


  // On small screens with many players, your own seat can be scrolled out of view: bring it back
  // into view whenever your turn starts.
  const feltRef = useRef<HTMLElement>(null);
  const myTurnNow = myTurn && game.phase === 'turn';
  useEffect(() => {
    if (!myTurnNow) return;
    // Wait a moment: the turn controls appear at the same time and shrink the table area.
    const t = setTimeout(() => {
      const felt = feltRef.current;
      const mine = felt?.querySelector<HTMLElement>('.seat.you');
      if (!felt || !mine || felt.scrollHeight <= felt.clientHeight + 4) return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      mine.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }, 250);
    return () => clearTimeout(t);
  }, [myTurnNow, game.round, game.turnNumber]);
  async function act(action: GameAction) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await request('game:action', action);
    setBusy(false);
    if (!res.ok) setError(res.error);
  }

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(t);
  }, [error]);


  // Tell the player when they get caught cheating (the log may be tucked away on phones).
  const caughtRef = useRef(me?.timesCaught ?? 0);
  useEffect(() => {
    const n = me?.timesCaught ?? 0;
    if (n > caughtRef.current) setError(`You were caught cheating! Fined ${n} chip${n === 1 ? '' : 's'} into your pot.`);
    caughtRef.current = n;
  }, [me?.timesCaught]);
  const current = game.players.find((p) => p.id === game.currentPlayerId);

  return (
    <div className={`game ${sideOpen ? 'side-open' : ''}`}>
      <header className="topbar">
        <div className="round-info">
          <span className="pill">Round {game.round}</span>
          <span className="pill turn-pill">
            Turn {game.turnNumber}/{game.turnsPerRound}
          </span>
          <span className="pill muted code-pill" title="Room code">
            {view.code}
          </span>
        </div>
        <div className="topbar-actions">
          <button className="btn ghost small" onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}>
            {muted ? '🔇' : '🔊'}
          </button>
          <button className="btn ghost small" onClick={() => setRulesOpen(true)}>
            Rules
          </button>
          <button className="btn ghost small side-toggle" onClick={() => setSideOpen((o) => !o)}>
            Log & chat
          </button>
          <button
            className="btn ghost small"
            onClick={() => {
              if (window.confirm('Leave this table? You will auto-stand for the rest of the game.')) onLeave();
            }}
          >
            Leave
          </button>
        </div>
      </header>

      <div className="game-body">
        <main ref={feltRef} className={`felt seats-${others.length} ${many ? 'many' : ''}`}>
          {(() => {
            const seats = others.map((p, i) => (
              <Seat
                key={p.id}
                p={p}
                pos={many ? 'grid' : positions[i]}
                game={game}
                seat={seatInfo[p.id]}
                deadline={view.deadline}
                turnSeconds={view.settings.turnSeconds}
                now={now}
                dealIndex={i + 1}
                compact={many}
                peekHand={me?.peek?.targetId === p.id && !game.revealed ? me.peek.hand : null}
              />
            ));
            return many ? <div className="opp-grid">{seats}</div> : seats;
          })()}

          <Center game={game} canDraw={canDraw && !busy} onDraw={(s) => act({ type: 'draw', source: s })} />

          {me && (
            <Seat
              p={me}
              pos="bottom"
              game={game}
              seat={seatInfo[me.id]}
              deadline={view.deadline}
              turnSeconds={view.settings.turnSeconds}
              now={now}
              isYou
              dealIndex={0}
            />
          )}
        </main>

        <SidePanel log={game.log} chat={view.chat} youId={youId} open={sideOpen} onClose={() => setSideOpen(false)} />
      </div>

      <footer className="controls">
        {error && <div className="toast error">{error}</div>}
        {me?.eliminated ? (
          <p className="status">You are out of chips — watching the rest of the game.</p>
        ) : iDrew && me?.hand ? (
          <DiscardChooser
            game={game}
            me={me}
            busy={busy}
            onPick={(card) => act({ type: 'discard', card })}
            onKeepExtra={() => act({ type: 'keepExtra' })}
          />
        ) : myTurn && game.phase === 'turn' && me ? (
          <div className="turn-controls">
            <div className="turn-head">
              <CountdownRing deadline={view.deadline} total={view.settings.turnSeconds} now={now} />
              <b>Your turn</b>
              <span className="muted small">
                Turn {game.turnNumber} of {game.turnsPerRound}
              </span>
            </div>
            <TokenTray game={game} youId={youId} busy={busy} act={act} />
            <CheatTray game={game} youId={youId} busy={busy} canDraw={canDraw} act={act} />
            <div className="turn-buttons">
              <button className="btn stand" disabled={busy} onClick={() => act({ type: 'stand' })}>
                Stand
              </button>
              <span className="or">{game.freeDraw ? 'or draw for free:' : 'or draw for 1 chip:'}</span>
              <div className="draw-buttons">
                {(['sandDeck', 'sandDiscard', 'bloodDiscard', 'bloodDeck'] as DrawSource[]).map((s) => (
                  <button
                    key={s}
                    className={`btn draw ${s.startsWith('sand') ? 'sand' : 'blood'}`}
                    disabled={!canDraw || busy || !viewCanDrawFrom(game, s)}
                    onClick={() => act({ type: 'draw', source: s })}
                  >
                    {SOURCE_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            {me.embargoed ? (
              <p className="muted small">You are under Embargo — you must stand this turn.</p>
            ) : (
              me.chips < DRAW_COST &&
              !game.freeDraw && <p className="muted small">You have no chips left to draw — you must stand.</p>
            )}
          </div>
        ) : game.phase === 'primeChoice' && game.pendingPrime?.playerId === youId ? (
          <p className="status">Choose your Prime Sabacc die…</p>
        ) : game.phase === 'turn' || game.phase === 'discard' || game.phase === 'primeChoice' ? (
          <p className="status">
            {current ? (
              <>
                Waiting for <b>{current.name}</b>
                {game.phase === 'discard' && game.pendingDraw && <> — drew from the {SOURCE_LABEL[game.pendingDraw.source]}</>}
                {game.phase === 'primeChoice' && <> — choosing a Prime Sabacc value</>}…
              </>
            ) : (
              'Waiting…'
            )}
          </p>
        ) : game.phase === 'impostor' ? (
          <p className="status">Impostors are rolling…</p>
        ) : null}
      </footer>

      {game.phase === 'impostor' && <ImpostorPrompt game={game} youId={youId} deadline={view.deadline} now={now} />}
      <PrimeChoicePrompt game={game} youId={youId} deadline={view.deadline} now={now} />
      {(game.phase === 'roundEnd' || game.phase === 'gameOver') && game.lastResult && (
        <RoundSummary view={view} now={now} onLeave={onLeave} />
      )}
      <RulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}

function Chips({ chips, invested }: { chips: number; invested: number }) {
  return (
    <div className="chips" aria-label={`${chips} chips, ${invested} invested`}>
      <span className="chip-stack" title="Chips">
        <span className="chip-ico" />
        <b>{chips}</b>
      </span>
      <span className={`chip-stack invested ${invested > 0 ? 'has' : ''}`} title="Invested this round">
        <span className="invested-pile">
          {Array.from({ length: Math.min(invested, 6) }, (_, i) => (
            <span key={i} className="chip-ico mini" style={{ transform: `translateY(${-i * 3}px)` }} />
          ))}
        </span>
        <span className="small">{invested} in</span>
      </span>
    </div>
  );
}

function Seat({
  p,
  pos,
  game,
  seat,
  deadline,
  turnSeconds,
  now,
  isYou,
  dealIndex,
  compact,
  peekHand,
}: {
  p: PlayerView;
  pos: Pos | 'bottom';
  game: GameView;
  seat: SeatView | undefined;
  deadline: number | null;
  turnSeconds: number;
  now: () => number;
  isYou?: boolean;
  dealIndex: number;
  /** Smaller cards for crowded tables (5+ players). */
  compact?: boolean;
  /** Your Peek snapshot of this opponent's hand (shown face up only to you). */
  peekHand?: { sand: Card; blood: Card } | null;
}) {
  const isCurrent = game.currentPlayerId === p.id;
  const isDealer = game.dealerId === p.id;
  const rolls = game.impostorRolls[p.id];
  const result = game.lastResult?.round === game.round ? game.lastResult.hands.find((h) => h.playerId === p.id) : undefined;
  const pending = game.pendingDraw?.playerId === p.id ? game.pendingDraw : null;
  const winner = result?.winner;
  // Until the first action of a round, the last log line is the "Round N — X deals." entry.
  const freshDeal = game.phase === 'turn' && game.log.at(-1)?.kind === 'round';

  return (
    <section
      className={`seat pos-${pos} ${isCurrent ? 'current' : ''} ${p.eliminated ? 'eliminated' : ''} ${isYou ? 'you' : ''} ${
        winner ? 'winner' : ''
      }`}
      aria-label={`${p.name}${isYou ? ' (you)' : ''}`}
      title={seat?.isBot ? `${p.name} (${seat.botLevel} bot)` : undefined}
    >
      <div className="seat-head">
        {isCurrent && <CountdownRing deadline={deadline} total={turnSeconds} now={now} size={26} />}
        <span className="seat-name">
          {p.name}
          {isYou && <em> (you)</em>}
        </span>
        {isDealer && (
          <span className="dealer-btn" title="Dealer">
            D
          </span>
        )}
        {seat?.isBot && <span className={`badge bot ${seat.botLevel}`}>{seat.botLevel}</span>}
        {seat && !seat.isBot && !seat.connected && <span className="badge off">offline</span>}
        {p.timesCaught > 0 && (
          <span className="badge caught" title={`Caught cheating ${p.timesCaught} time${p.timesCaught === 1 ? '' : 's'}`}>
            Caught ×{p.timesCaught}
          </span>
        )}
      </div>

      {game.shiftTokensEnabled && !p.eliminated && (
        <div className="seat-status">
          {isYou ? (
            p.tokens.map((t) => <TokenChip key={t} id={t} compact />)
          ) : (
            <span className="token-count" title={`${p.tokenCount} shift token${p.tokenCount === 1 ? '' : 's'} left`}>
              <span className="hex-mini" />×{p.tokenCount}
            </span>
          )}
          {p.immune && (
            <span className="badge immune" title="Immune to other players' tokens until the reveal">
              Immune
            </span>
          )}
          {p.embargoed && (
            <span className="badge embargo" title="Must stand on their next turn">
              Embargo
            </span>
          )}
          {p.lastAction === 'stand' && !game.revealed && (
            <span className="badge stood" title="Stood on their last turn (can be audited)">
              Stood
            </span>
          )}
        </div>
      )}

      <div className="seat-cards">
        {p.eliminated && !p.hasHand ? (
          <span className="out-tag">Eliminated</span>
        ) : (
          p.hand &&
          SUITS.map((suit, si) => {
            const peeked = !p.hand?.[suit] && peekHand ? peekHand[suit] : null;
            const card = p.hand?.[suit] ?? peeked ?? null;
            const roll = rolls?.[suit];
            return (
              <div key={suit} className={`card-slot ${peeked ? 'peeked' : ''}`} title={peeked ? 'Peeked (as of your peek)' : undefined}>
                <CardView
                  key={isYou && card ? `${game.round}-${card.id}` : `${game.round}-${suit}`}
                  card={card}
                  suit={suit}
                  size={isYou ? 'lg' : compact ? 'sm' : 'md'}
                  className={freshDeal || !isYou ? 'deal' : 'draw-in'}
                  style={freshDeal ? { ['--deal-delay' as string]: `${dealIndex * 0.12 + si * 0.5}s` } : undefined}
                />
                {roll && (
                  <div className="roll">
                    {roll.dice.map((d, i) => (
                      <Die
                        key={i}
                        value={d}
                        rollKey={`${game.round}-${p.id}-${suit}-${i}`}
                        size={22}
                        selected={roll.choice === i}
                        dimmed={roll.choice !== null && roll.choice !== i}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
        {pending && (
          <div className="pending-draw" title={`Drew from the ${SOURCE_LABEL[pending.source]}`}>
            <CardView card={pending.card} suit={pending.source.startsWith('sand') ? 'sand' : 'blood'} size="sm" className="draw-in" />
            <span className="pending-label">{SOURCE_LABEL[pending.source]}</span>
          </div>
        )}
      </div>

      <Chips chips={p.chips} invested={p.invested} />
      {result && (
        <div className={`result-tag ${result.winner ? 'win' : ''}`}>
          {result.winner ? '★ ' : ''}
          {result.resolved.label}
        </div>
      )}
    </section>
  );
}

function Center({ game, canDraw, onDraw }: { game: GameView; canDraw: boolean; onDraw: (s: DrawSource) => void }) {
  return (
    <div className="table-center-wrap">
      <RulesBanner rules={game.rules} freeDraw={game.freeDraw} />
      <CenterPiles game={game} canDraw={canDraw} onDraw={onDraw} />
    </div>
  );
}

function CenterPiles({ game, canDraw, onDraw }: { game: GameView; canDraw: boolean; onDraw: (s: DrawSource) => void }) {
  return (
    <div className="table-center">
      {SUITS.map((suit) => {
        const deckSource: DrawSource = suit === 'sand' ? 'sandDeck' : 'bloodDeck';
        const discSource: DrawSource = suit === 'sand' ? 'sandDiscard' : 'bloodDiscard';
        const pile = game.discards[suit];
        const top = pile[pile.length - 1] ?? null;
        const deckOk = canDraw && viewCanDrawFrom(game, deckSource);
        const discOk = canDraw && viewCanDrawFrom(game, discSource);
        return (
          <div key={suit} className={`pile-group ${suit}`}>
            <div className="pile">
              <div className={`deck-stack ${deckOk ? 'drawable' : ''}`}>
                <span className="stack-shadow" />
                <span className="stack-shadow s2" />
                <CardView
                  card={null}
                  suit={suit}
                  size="md"
                  onClick={deckOk ? () => onDraw(deckSource) : undefined}
                  label={`Draw from the ${suitName(suit)} deck`}
                />
              </div>
              <span className="pile-label">
                {suitName(suit)} deck · <b>{game.deckCounts[suit]}</b>
              </span>
            </div>
            <div className="pile">
              <div className={`discard-stack ${discOk ? 'drawable' : ''}`}>
                {top ? (
                  <CardView
                    key={top.id}
                    card={top}
                    suit={suit}
                    size="md"
                    className="drop-in"
                    onClick={discOk ? () => onDraw(discSource) : undefined}
                    label={`Take ${cardLabel(top)} from the discard pile`}
                  />
                ) : (
                  <div className="card card-md empty-slot" />
                )}
              </div>
              <span className="pile-label">
                {suitName(suit)} discard · {pile.length}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DiscardChooser({
  game,
  me,
  busy,
  onPick,
  onKeepExtra,
}: {
  game: GameView;
  me: PlayerView;
  busy: boolean;
  onPick: (c: 'drawn' | 'held') => void;
  onKeepExtra: () => void;
}) {
  const drawn = game.pendingDraw?.card;
  const extra = game.pendingDraw?.extra ?? null;
  if (!drawn || !me.hand) return null;
  const suit: Suit = drawn.suit;
  const held = me.hand[suit];

  if (extra) {
    // Double Draw: keep one of three. One of the others is discarded face up, the spare goes back into the deck.
    const options: { key: string; card: typeof drawn; label: string; keep: () => void }[] = [
      { key: 'held', card: held as typeof drawn, label: 'Your card', keep: () => onPick('drawn') },
      { key: 'drawn', card: drawn, label: 'Drawn', keep: () => onPick('held') },
      { key: 'extra', card: extra, label: 'Drawn (cheat)', keep: onKeepExtra },
    ];
    return (
      <div className="discard-chooser">
        <p>
          <b>Double Draw worked — keep one {suitName(suit)} card.</b>{' '}
          <span className="muted small">Everyone sees a normal draw; the spare slips back into the deck.</span>
        </p>
        <div className="choice-cards">
          {options.map((o) => (
            <div key={o.key} className="choice">
              <CardView card={o.card} suit={suit} size="lg" className={o.key === 'held' ? '' : 'draw-in'} onClick={o.keep} disabled={busy} label={`Keep ${o.label}`} />
              <span className="choice-label">{o.label}</span>
              <button className="btn small primary" disabled={busy} onClick={o.keep}>
                Keep this
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="discard-chooser">
      <p>
        <b>Choose a {suitName(suit)} card to discard.</b> <span className="muted small">You keep the other one.</span>
      </p>
      <div className="choice-cards">
        <div className="choice">
          <CardView card={held} suit={suit} size="lg" onClick={() => onPick('held')} disabled={busy} label="Discard your held card" />
          <span className="choice-label">Your card</span>
          <button className="btn small" disabled={busy} onClick={() => onPick('held')}>
            Discard this
          </button>
        </div>
        <div className="choice">
          <CardView card={drawn} suit={suit} size="lg" className="draw-in" onClick={() => onPick('drawn')} disabled={busy} label="Discard the drawn card" />
          <span className="choice-label">Just drawn</span>
          <button className="btn small" disabled={busy} onClick={() => onPick('drawn')}>
            Discard this
          </button>
        </div>
      </div>
    </div>
  );
}

function ImpostorPrompt({
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
  const rolls = game.impostorRolls[youId];
  const me = game.players.find((p) => p.id === youId);
  const left = useSecondsLeft(deadline, now);
  const [busy, setBusy] = useState(false);
  const [cheatMsg, setCheatMsg] = useState<string | null>(null);
  const pendingSuits = SUITS.filter((s) => rolls?.[s] && rolls[s]!.choice === null);
  if (!rolls || !me?.hand || pendingSuits.length === 0) return null;

  const canNudge = (r: { choice: 0 | 1 | null; nudged?: boolean }) => game.cheatsEnabled && r.choice === null && !r.nudged;
  async function nudge(suit: Suit, die: 0 | 1, delta: 1 | -1) {
    setBusy(true);
    const res = await request('game:action', { type: 'cheat', cheat: 'magneticDice', suit, die, delta });
    setBusy(false);
    if (!res.ok) setCheatMsg(res.error);
    else setCheatMsg(null);
  }
  async function choose(suit: Suit, choice: 0 | 1) {
    setBusy(true);
    await request('game:action', { type: 'chooseImpostor', suit, choice });
    setBusy(false);
  }

  return (
    <div className="modal-wrap">
      <div className="modal impostor-modal" role="dialog" aria-label="Choose Impostor values">
        <h2>Your Impostor{SUITS.filter((s) => rolls[s]).length > 1 ? 's' : ''} rolled!</h2>
        <p className="muted small">
          Pick one die for each Impostor. {left !== null && <>Best value is chosen for you in {left}s.</>}
        </p>
        {game.cheatsEnabled && SUITS.some((s) => rolls[s] && canNudge(rolls[s]!)) && (
          <p className="small cheat-hint">
            <b>Magnetic Dice</b> (cheat): nudge one die up or down by 1, once per Impostor. {Math.round(CHEAT_CATCH_CHANCE * 100)}% chance
            to get caught.
          </p>
        )}
        {cheatMsg && <p className="error small">{cheatMsg}</p>}
        {SUITS.filter((s) => rolls[s]).map((suit) => {
          const r = rolls[suit]!;
          const other = me.hand![suit === 'sand' ? 'blood' : 'sand'];
          return (
            <div key={suit} className="impostor-row">
              <CardView card={me.hand![suit]} suit={suit} size="sm" />
              <div className="dice-choice">
                {r.dice.map((d, i) => (
                  <div key={i} className="die-col">
                    <Die
                      value={d}
                      rollKey={`${game.round}-${suit}-${i}`}
                      size={56}
                      selected={r.choice === i}
                      dimmed={r.choice !== null && r.choice !== i}
                      onClick={r.choice === null && !busy ? () => choose(suit, i as 0 | 1) : undefined}
                    />
                    {canNudge(r) && (
                      <span className="nudge">
                        <button className="btn icon small" disabled={busy || d >= 6} aria-label={`Nudge die to ${d + 1}`} onClick={() => nudge(suit, i as 0 | 1, 1)}>
                          ▲
                        </button>
                        <button className="btn icon small" disabled={busy || d <= 1} aria-label={`Nudge die to ${d - 1}`} onClick={() => nudge(suit, i as 0 | 1, -1)}>
                          ▼
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <span className="muted small">
                other card: {other ? cardLabel(other) : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Plays sound effects by comparing consecutive game views. */
function useGameSounds(game: GameView, youId: string, view: RoomView) {
  const prev = useRef<{ game: GameView; chatId: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    const chatId = view.chat.at(-1)?.id ?? 0;
    prev.current = { game, chatId };
    if (!p) return;
    const g0 = p.game;
    if (game.round !== g0.round) play('deal');
    else {
      if (game.pendingDraw && !g0.pendingDraw) play('draw');
      for (const s of SUITS) {
        if (game.discards[s].at(-1)?.id !== g0.discards[s].at(-1)?.id && game.discards[s].length >= g0.discards[s].length) {
          play('discard');
          break;
        }
      }
    }
    if (game.phase === 'impostor' && g0.phase !== 'impostor') play('dice');
    if (game.phase === 'primeChoice' && g0.phase !== 'primeChoice') play('dice');
    const lastSeq = g0.log.at(-1)?.seq ?? 0;
    if (game.log.some((l) => l.seq > lastSeq && l.kind === 'token' && / plays /.test(l.text))) play('token');
    if (game.log.some((l) => l.seq > lastSeq && l.kind === 'cheat')) play('lose');
    if (game.currentPlayerId === youId && game.phase === 'turn' && (g0.currentPlayerId !== youId || g0.phase !== 'turn')) play('turn');
    if ((game.phase === 'roundEnd' || game.phase === 'gameOver') && g0.phase !== game.phase && game.lastResult) {
      const mine = game.lastResult.hands.find((h) => h.playerId === youId);
      if (mine) play(mine.winner ? 'win' : 'lose');
    }
    const lastChat = view.chat.at(-1);
    if (lastChat && lastChat.id !== p.chatId && lastChat.seatId && lastChat.seatId !== youId) play('chat');
  }, [game, youId, view.chat]);
}
