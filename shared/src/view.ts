import { SUITS, type Card, type Suit } from './cards';
import {
  currentPlayerId,
  currentTurnNumber,
  pendingImpostorPlayerIds,
  TURNS_PER_ROUND,
  type DrawSource,
  type GamePhase,
  type GameState,
  type ImpostorRoll,
  type LogEntry,
  type RoundResult,
} from './engine';

export interface PlayerView {
  id: string;
  name: string;
  chips: number;
  invested: number;
  eliminated: boolean;
  /** Own cards always; other players' cards only after the reveal. `null` = face down / no card. */
  hand: { sand: Card | null; blood: Card | null } | null;
  hasHand: boolean;
}

export interface PendingDrawView {
  playerId: string;
  source: DrawSource;
  /** Only visible to the drawer, or to everyone when taken from a (face-up) discard pile. */
  card: Card | null;
}

/** Everything one seat is allowed to know. Never contains deck order or hidden cards. */
export interface GameView {
  round: number;
  turnNumber: number;
  turnsPerRound: number;
  phase: GamePhase;
  dealerId: string;
  currentPlayerId: string | null;
  turnOrder: string[];
  players: PlayerView[];
  deckCounts: Record<Suit, number>;
  /** Discard piles are face up and every discard is public, so the full piles are visible. */
  discards: Record<Suit, Card[]>;
  pendingDraw: PendingDrawView | null;
  impostorRolls: Record<string, Partial<Record<Suit, ImpostorRoll>>>;
  pendingImpostorIds: string[];
  revealed: boolean;
  lastResult: RoundResult | null;
  winnerIds: string[];
  log: LogEntry[];
}

export function isRevealPhase(phase: GamePhase): boolean {
  return phase === 'impostor' || phase === 'roundEnd' || phase === 'gameOver';
}

export function toGameView(state: GameState, viewerId: string | null): GameView {
  const revealed = isRevealPhase(state.phase);
  const players: PlayerView[] = state.players.map((p) => {
    const showAll = revealed || p.id === viewerId;
    return {
      id: p.id,
      name: p.name,
      chips: p.chips,
      invested: p.invested,
      eliminated: p.eliminated,
      hasHand: p.hand !== null,
      hand: p.hand
        ? { sand: showAll ? { ...p.hand.sand } : null, blood: showAll ? { ...p.hand.blood } : null }
        : null,
    };
  });
  const pd = state.pendingDraw;
  const pendingDraw: PendingDrawView | null = pd
    ? {
        playerId: pd.playerId,
        source: pd.source,
        card: pd.playerId === viewerId || pd.source.endsWith('Discard') ? { ...pd.card } : null,
      }
    : null;
  const discards = {} as Record<Suit, Card[]>;
  const deckCounts = {} as Record<Suit, number>;
  for (const s of SUITS) {
    discards[s] = state.discards[s].map((c) => ({ ...c }));
    deckCounts[s] = state.decks[s].length;
  }
  return {
    round: state.round,
    turnNumber: currentTurnNumber(state),
    turnsPerRound: TURNS_PER_ROUND,
    phase: state.phase,
    dealerId: state.players[state.dealerIndex]?.id ?? '',
    currentPlayerId: currentPlayerId(state),
    turnOrder: state.turnOrder.slice(),
    players,
    deckCounts,
    discards,
    pendingDraw,
    impostorRolls: structuredClone(state.impostorRolls),
    pendingImpostorIds: pendingImpostorPlayerIds(state),
    revealed,
    lastResult: state.lastResult ? structuredClone(state.lastResult) : null,
    winnerIds: state.winnerIds.slice(),
    log: state.log.slice(-80),
  };
}

/** Draw sources usable according to a view (mirrors engine `canDrawFrom`). */
export function viewCanDrawFrom(view: GameView, source: DrawSource): boolean {
  const suit: Suit = source.startsWith('sand') ? 'sand' : 'blood';
  if (source.endsWith('Deck')) return view.deckCounts[suit] > 0 || view.discards[suit].length > 1;
  return view.discards[suit].length > 0;
}
