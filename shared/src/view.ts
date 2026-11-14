import { SUITS, type Card, type Suit } from './cards';
import {
  currentPlayerId,
  currentTurnNumber,
  nextTurnPlayerId,
  pendingImpostorPlayerIds,
  TURNS_PER_ROUND,
  type DrawSource,
  type GamePhase,
  type GameState,
  type ImpostorRoll,
  type LogEntry,
  type PendingPrime,
  type RoundResult,
} from './engine';
import type { RoundRules } from './evaluate';
import { SHIFT_TOKENS, type ShiftTokenId } from './tokens';

export interface PlayerView {
  id: string;
  name: string;
  chips: number;
  invested: number;
  eliminated: boolean;
  /** Own cards always; other players' cards only after the reveal. `null` = face down / no card. */
  hand: { sand: Card | null; blood: Card | null } | null;
  hasHand: boolean;
  /** Own unplayed shift tokens; always empty for other players (only the count is public). */
  tokens: ShiftTokenId[];
  tokenCount: number;
  immune: boolean;
  embargoed: boolean;
  lastAction: 'stand' | 'draw' | null;
}

export interface PendingDrawView {
  playerId: string;
  source: DrawSource;
  /** Only visible to the drawer, or to everyone when taken from a (face-up) discard pile. */
  card: Card | null;
}

/** Everything one seat is allowed to know. Never contains deck order, hidden cards or others' tokens. */
export interface GameView {
  round: number;
  turnNumber: number;
  turnsPerRound: number;
  phase: GamePhase;
  dealerId: string;
  currentPlayerId: string | null;
  nextTurnPlayerId: string | null;
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
  shiftTokensEnabled: boolean;
  rules: RoundRules;
  tokenPlayedThisTurn: boolean;
  freeDraw: boolean;
  pendingPrime: PendingPrime | null;
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
      tokens: p.id === viewerId ? p.tokens.slice() : [],
      tokenCount: p.tokens.length,
      immune: p.immune,
      embargoed: p.embargoed,
      lastAction: p.lastAction,
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
    nextTurnPlayerId: state.phase === 'turn' || state.phase === 'primeChoice' ? nextTurnPlayerId(state) : null,
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
    shiftTokensEnabled: (state.config.shiftTokens ?? 0) > 0,
    rules: { ...state.rules },
    tokenPlayedThisTurn: state.tokenPlayedThisTurn,
    freeDraw: state.freeDraw,
    pendingPrime: state.pendingPrime ? structuredClone(state.pendingPrime) : null,
  };
}

/** Draw sources usable according to a view (mirrors engine `canDrawFrom`). */
export function viewCanDrawFrom(view: GameView, source: DrawSource): boolean {
  const suit: Suit = source.startsWith('sand') ? 'sand' : 'blood';
  if (source.endsWith('Deck')) return view.deckCounts[suit] > 0 || view.discards[suit].length > 1;
  return view.discards[suit].length > 0;
}

/** Valid targets for a targeted token, as seen from a view (mirrors engine `tokenTargets`). */
export function viewTokenTargets(view: GameView, myId: string, token: ShiftTokenId): string[] {
  const def = SHIFT_TOKENS[token];
  if (def.target === 'none') return [];
  return view.turnOrder.filter((id) => {
    if (id === myId) return false;
    const p = view.players.find((x) => x.id === id);
    if (!p || p.immune) return false;
    return def.target !== 'standingPlayer' || p.lastAction === 'stand';
  });
}

/** Why a token can't be played now, as seen from a view (mirrors engine `tokenBlockReason`). */
export function viewTokenBlockReason(view: GameView, myId: string, token: ShiftTokenId): string | null {
  const me = view.players.find((p) => p.id === myId);
  if (!me || !me.tokens.includes(token)) return "You don't have that token";
  if (view.phase !== 'turn' || view.currentPlayerId !== myId) return 'Play tokens at the start of your turn';
  if (view.tokenPlayedThisTurn) return 'One token per turn';
  const def = SHIFT_TOKENS[token];
  if (def.target !== 'none' && viewTokenTargets(view, myId, token).length === 0) {
    return def.target === 'standingPlayer' ? 'No player who stood can be targeted' : 'No player can be targeted';
  }
  if ((token === 'refund' || token === 'extraRefund') && me.invested === 0) return 'Your pot is empty';
  if (token === 'freeDraw' && (me.embargoed || view.freeDraw)) return me.embargoed ? 'You must stand (Embargo)' : 'Already active';
  if (token === 'embargo' && !view.nextTurnPlayerId) return 'No next turn this round';
  if (token === 'immunity' && me.immune) return 'Already immune';
  return null;
}
