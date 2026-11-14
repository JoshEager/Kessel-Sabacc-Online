import { buildDeck, cardLabel, suitName, SUITS, type Card, type Suit } from './cards';
import {
  assignPlaces,
  bestImpostorChoices,
  findWinners,
  penaltyFor,
  resolveHand,
  type DicePair,
  type ImpostorChoiceIndex,
  type ResolvedHand,
} from './evaluate';
import { rollDie, shuffle, type Rng } from './rng';

export const TURNS_PER_ROUND = 3;
export const DRAW_COST = 1;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const STARTING_CHIP_OPTIONS = [4, 6, 8, 10] as const;

export type DrawSource = 'sandDeck' | 'bloodDeck' | 'sandDiscard' | 'bloodDiscard';
export const DRAW_SOURCES: readonly DrawSource[] = ['sandDeck', 'bloodDeck', 'sandDiscard', 'bloodDiscard'];

export function sourceSuit(source: DrawSource): Suit {
  return source.startsWith('sand') ? 'sand' : 'blood';
}
export function sourceIsDeck(source: DrawSource): boolean {
  return source.endsWith('Deck');
}
export function sourceName(source: DrawSource): string {
  return `the ${suitName(sourceSuit(source))} ${sourceIsDeck(source) ? 'deck' : 'discard pile'}`;
}

export type GamePhase = 'turn' | 'discard' | 'impostor' | 'roundEnd' | 'gameOver';

export interface Hand {
  sand: Card;
  blood: Card;
}

export interface PlayerState {
  id: string;
  name: string;
  chips: number;
  invested: number;
  hand: Hand | null;
  eliminated: boolean;
  eliminatedInRound: number | null;
}

export interface PendingDraw {
  playerId: string;
  source: DrawSource;
  card: Card;
}

export interface ImpostorRoll {
  dice: DicePair;
  choice: ImpostorChoiceIndex | null;
}

export type GameAction =
  | { type: 'stand' }
  | { type: 'draw'; source: DrawSource }
  | { type: 'discard'; card: 'drawn' | 'held' }
  | { type: 'chooseImpostor'; suit: Suit; choice: ImpostorChoiceIndex };

export interface LogEntry {
  seq: number;
  round: number;
  kind: 'action' | 'round' | 'reveal' | 'system';
  text: string;
}

export interface HandResult {
  playerId: string;
  name: string;
  sand: Card;
  blood: Card;
  impostors: Partial<Record<Suit, { dice: DicePair; value: number }>>;
  resolved: ResolvedHand;
  place: number;
  winner: boolean;
}

export interface ChipChange {
  playerId: string;
  name: string;
  stackBefore: number;
  invested: number;
  returned: number;
  investedLost: number;
  penaltyDue: number;
  penaltyPaid: number;
  chipsAfter: number;
  eliminated: boolean;
}

export interface RoundResult {
  round: number;
  hands: HandResult[];
  winnerIds: string[];
  chips: ChipChange[];
}

export interface GameConfig {
  startingChips: number;
}

export interface GameState {
  config: GameConfig;
  players: PlayerState[];
  round: number;
  dealerIndex: number;
  /** Player ids in the order they act this round (left of dealer first, dealer last). */
  turnOrder: string[];
  /** Index into the full 3-pass sequence: 0 … turnOrder.length * 3 - 1. */
  turnIndex: number;
  phase: GamePhase;
  /** Top of each deck / pile is the LAST element. */
  decks: Record<Suit, Card[]>;
  discards: Record<Suit, Card[]>;
  pendingDraw: PendingDraw | null;
  impostorRolls: Record<string, Partial<Record<Suit, ImpostorRoll>>>;
  lastResult: RoundResult | null;
  winnerIds: string[];
  log: LogEntry[];
  logSeq: number;
  /** Count of deck rebuilds (diagnostic, public). */
  reshuffles: number;
}

export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalMoveError';
  }
}

const MAX_LOG = 200;

function addLog(state: GameState, kind: LogEntry['kind'], text: string): void {
  state.logSeq += 1;
  state.log.push({ seq: state.logSeq, round: state.round, kind, text });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

function clone(state: GameState): GameState {
  return structuredClone(state);
}

export function getPlayer(state: GameState, id: string): PlayerState {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new IllegalMoveError('Unknown player');
  return p;
}

export function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.eliminated);
}

/** Next non-eliminated seat strictly after `from`, going clockwise (increasing index). */
export function nextActiveIndex(state: GameState, from: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (((from + i) % n) + n) % n;
    if (!state.players[idx].eliminated) return idx;
  }
  return -1;
}

export function currentPlayerId(state: GameState): string | null {
  if (state.phase !== 'turn' && state.phase !== 'discard') return null;
  return state.turnOrder[state.turnIndex % state.turnOrder.length] ?? null;
}

export function currentTurnNumber(state: GameState): number {
  if (state.turnOrder.length === 0) return 1;
  return Math.min(TURNS_PER_ROUND, Math.floor(state.turnIndex / state.turnOrder.length) + 1);
}

export interface PlayerInit {
  id: string;
  name: string;
}

export function createGame(
  players: PlayerInit[],
  config: GameConfig,
  rng: Rng,
  opts: { firstDealerIndex?: number } = {},
): GameState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new IllegalMoveError(`Kessel Sabacc needs ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  }
  if (!Number.isInteger(config.startingChips) || config.startingChips < 1) {
    throw new IllegalMoveError('Starting chips must be a positive integer');
  }
  const state: GameState = {
    config: { ...config },
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      chips: config.startingChips,
      invested: 0,
      hand: null,
      eliminated: false,
      eliminatedInRound: null,
    })),
    round: 0,
    dealerIndex: opts.firstDealerIndex ?? 0,
    turnOrder: [],
    turnIndex: 0,
    phase: 'roundEnd',
    decks: { sand: [], blood: [] },
    discards: { sand: [], blood: [] },
    pendingDraw: null,
    impostorRolls: {},
    lastResult: null,
    winnerIds: [],
    log: [],
    logSeq: 0,
    reshuffles: 0,
  };
  return startRoundMut(state, rng);
}

function startRoundMut(state: GameState, rng: Rng): GameState {
  state.round += 1;
  if (state.round > 1 || state.players[state.dealerIndex]?.eliminated) {
    // Dealer passes one seat clockwise (skipping eliminated players).
    state.dealerIndex = nextActiveIndex(state, state.dealerIndex);
  }
  // 1. Gather all 44 cards and reshuffle each deck separately.
  state.decks = { sand: shuffle(buildDeck('sand'), rng), blood: shuffle(buildDeck('blood'), rng) };
  state.discards = { sand: [], blood: [] };
  state.pendingDraw = null;
  state.impostorRolls = {};
  state.lastResult = null;

  // Turn order: player to the dealer's left first, dealer last.
  const order: string[] = [];
  let idx = state.dealerIndex;
  for (let i = 0; i < state.players.length; i++) {
    idx = nextActiveIndex(state, idx);
    const id = state.players[idx].id;
    if (order.includes(id)) break;
    order.push(id);
  }
  state.turnOrder = order;
  state.turnIndex = 0;

  for (const p of state.players) {
    p.invested = 0;
    p.hand = null;
  }
  // 2. Deal 1 Sand + 1 Blood to each active player.
  for (const id of order) {
    const p = getPlayer(state, id);
    p.hand = { sand: state.decks.sand.pop() as Card, blood: state.decks.blood.pop() as Card };
  }
  // 3. Flip the top of each deck to start the discard piles.
  for (const suit of SUITS) state.discards[suit].push(state.decks[suit].pop() as Card);

  state.phase = 'turn';
  const dealer = state.players[state.dealerIndex];
  addLog(state, 'round', `Round ${state.round} — ${dealer.name} deals.`);
  return state;
}

/** Starts the next round after a round has been settled. */
export function nextRound(state: GameState, rng: Rng): GameState {
  if (state.phase !== 'roundEnd') throw new IllegalMoveError('The round is not over');
  return startRoundMut(clone(state), rng);
}

/**
 * Makes sure a deck can be drawn from: if it is empty, the discard pile (minus its top card)
 * is shuffled into a new deck. Returns false when there is nothing to rebuild with.
 */
export function ensureDeck(state: GameState, suit: Suit, rng: Rng): boolean {
  if (state.decks[suit].length > 0) return true;
  const pile = state.discards[suit];
  if (pile.length <= 1) return false;
  const top = pile.pop() as Card;
  state.decks[suit] = shuffle(pile, rng);
  state.discards[suit] = [top];
  state.reshuffles += 1;
  addLog(state, 'system', `The ${suitName(suit)} deck ran out — its discard pile was reshuffled into a new deck.`);
  return true;
}

export function canDrawFrom(state: Pick<GameState, 'decks' | 'discards'>, source: DrawSource): boolean {
  const suit = sourceSuit(source);
  if (sourceIsDeck(source)) return state.decks[suit].length > 0 || state.discards[suit].length > 1;
  return state.discards[suit].length > 0;
}

export function legalActions(state: GameState, playerId: string): GameAction[] {
  const acts: GameAction[] = [];
  if (state.phase === 'turn' && currentPlayerId(state) === playerId) {
    acts.push({ type: 'stand' });
    const p = getPlayer(state, playerId);
    if (p.chips >= DRAW_COST) {
      for (const s of DRAW_SOURCES) if (canDrawFrom(state, s)) acts.push({ type: 'draw', source: s });
    }
  } else if (state.phase === 'discard' && state.pendingDraw?.playerId === playerId) {
    acts.push({ type: 'discard', card: 'drawn' }, { type: 'discard', card: 'held' });
  } else if (state.phase === 'impostor') {
    const rolls = state.impostorRolls[playerId] ?? {};
    for (const suit of SUITS) {
      const r = rolls[suit];
      if (r && r.choice === null) acts.push({ type: 'chooseImpostor', suit, choice: 0 }, { type: 'chooseImpostor', suit, choice: 1 });
    }
  }
  return acts;
}

/** Applies a player's action, returning a new state. Throws IllegalMoveError for illegal moves. */
export function applyAction(prev: GameState, playerId: string, action: GameAction, rng: Rng): GameState {
  const state = clone(prev);
  const player = getPlayer(state, playerId);
  if (player.eliminated) throw new IllegalMoveError('You have been eliminated');

  switch (action?.type) {
    case 'stand': {
      if (state.phase !== 'turn' || currentPlayerId(state) !== playerId) throw new IllegalMoveError('It is not your turn');
      addLog(state, 'action', `${player.name} stands.`);
      advanceTurn(state, rng);
      return state;
    }
    case 'draw': {
      if (state.phase !== 'turn' || currentPlayerId(state) !== playerId) throw new IllegalMoveError('It is not your turn');
      if (!DRAW_SOURCES.includes(action.source)) throw new IllegalMoveError('Unknown draw source');
      if (player.chips < DRAW_COST) throw new IllegalMoveError('You have no chips — you must stand');
      const suit = sourceSuit(action.source);
      let card: Card | undefined;
      if (sourceIsDeck(action.source)) {
        if (!ensureDeck(state, suit, rng)) throw new IllegalMoveError(`The ${suitName(suit)} deck is empty`);
        card = state.decks[suit].pop();
      } else {
        card = state.discards[suit].pop();
      }
      if (!card) throw new IllegalMoveError('Nothing to draw there');
      player.chips -= DRAW_COST;
      player.invested += DRAW_COST;
      state.pendingDraw = { playerId, source: action.source, card };
      state.phase = 'discard';
      return state;
    }
    case 'discard': {
      const pending = state.pendingDraw;
      if (state.phase !== 'discard' || !pending || pending.playerId !== playerId) {
        throw new IllegalMoveError('You have nothing to discard');
      }
      if (action.card !== 'drawn' && action.card !== 'held') throw new IllegalMoveError('Choose the drawn or held card');
      const hand = player.hand as Hand;
      const suit = pending.card.suit;
      let discarded: Card;
      if (action.card === 'drawn') {
        discarded = pending.card;
      } else {
        discarded = hand[suit];
        hand[suit] = pending.card;
      }
      state.discards[suit].push(discarded);
      addLog(state, 'action', `${player.name} drew from ${sourceName(pending.source)}, discarded ${cardLabel(discarded)}.`);
      state.pendingDraw = null;
      state.phase = 'turn';
      advanceTurn(state, rng);
      return state;
    }
    case 'chooseImpostor': {
      if (state.phase !== 'impostor') throw new IllegalMoveError('No Impostor choice is pending');
      const roll = state.impostorRolls[playerId]?.[action.suit];
      if (!roll) throw new IllegalMoveError('You have no Impostor in that suit');
      if (roll.choice !== null) throw new IllegalMoveError('That Impostor is already set');
      if (action.choice !== 0 && action.choice !== 1) throw new IllegalMoveError('Choose one of the two dice');
      roll.choice = action.choice;
      addLog(state, 'reveal', `${player.name}'s ${suitName(action.suit)} Impostor becomes ${roll.dice[action.choice]}.`);
      if (pendingImpostorPlayerIds(state).length === 0) resolveRoundMut(state);
      return state;
    }
    default:
      throw new IllegalMoveError('Unknown action');
  }
}

function advanceTurn(state: GameState, rng: Rng): void {
  state.turnIndex += 1;
  if (state.turnIndex >= state.turnOrder.length * TURNS_PER_ROUND) beginReveal(state, rng);
}

function beginReveal(state: GameState, rng: Rng): void {
  addLog(state, 'reveal', 'All hands are revealed.');
  let anyImpostor = false;
  for (const id of state.turnOrder) {
    const p = getPlayer(state, id);
    const hand = p.hand as Hand;
    const rolls: Partial<Record<Suit, ImpostorRoll>> = {};
    for (const suit of SUITS) {
      if (hand[suit].kind === 'impostor') {
        const dice: DicePair = [rollDie(rng), rollDie(rng)];
        rolls[suit] = { dice, choice: null };
        anyImpostor = true;
        addLog(state, 'reveal', `${p.name} rolls ${dice[0]} and ${dice[1]} for their ${suitName(suit)} Impostor.`);
      }
    }
    if (Object.keys(rolls).length) state.impostorRolls[id] = rolls;
  }
  if (anyImpostor) state.phase = 'impostor';
  else resolveRoundMut(state);
}

export function pendingImpostorPlayerIds(state: GameState): string[] {
  if (state.phase !== 'impostor') return [];
  return Object.entries(state.impostorRolls)
    .filter(([, rolls]) => SUITS.some((s) => rolls[s] && rolls[s]!.choice === null))
    .map(([id]) => id);
}

/** The best remaining Impostor choices for a player (used for timeouts and bots). */
export function autoImpostorActions(state: GameState, playerId: string): GameAction[] {
  const rolls = state.impostorRolls[playerId];
  const p = getPlayer(state, playerId);
  if (!rolls || !p.hand) return [];
  const fixed: Partial<Record<Suit, ImpostorChoiceIndex>> = {};
  const dice: Partial<Record<Suit, DicePair>> = {};
  for (const s of SUITS) {
    const r = rolls[s];
    if (!r) continue;
    dice[s] = r.dice;
    if (r.choice !== null) fixed[s] = r.choice;
  }
  const best = bestImpostorChoices(p.hand.sand, p.hand.blood, dice, fixed);
  const acts: GameAction[] = [];
  for (const s of SUITS) {
    const r = rolls[s];
    if (r && r.choice === null) acts.push({ type: 'chooseImpostor', suit: s, choice: best[s] ?? 0 });
  }
  return acts;
}

/** The actions taken automatically when a player times out or is disconnected. */
export function timeoutActions(state: GameState, playerId: string): GameAction[] {
  if (state.phase === 'turn' && currentPlayerId(state) === playerId) return [{ type: 'stand' }];
  if (state.phase === 'discard' && state.pendingDraw?.playerId === playerId) return [{ type: 'discard', card: 'drawn' }];
  if (state.phase === 'impostor') return autoImpostorActions(state, playerId);
  return [];
}

export interface SettlementInput {
  id: string;
  name: string;
  chips: number;
  invested: number;
  hand: ResolvedHand;
}

/** Pure chip settlement for a set of revealed hands. */
export function settleChips(entries: SettlementInput[]): { winnerIds: string[]; changes: ChipChange[] } {
  const winnerIds = findWinners(entries);
  const changes = entries.map((e): ChipChange => {
    const winner = winnerIds.includes(e.id);
    const stackBefore = e.chips + e.invested;
    if (winner) {
      return {
        playerId: e.id,
        name: e.name,
        stackBefore,
        invested: e.invested,
        returned: e.invested,
        investedLost: 0,
        penaltyDue: 0,
        penaltyPaid: 0,
        chipsAfter: e.chips + e.invested,
        eliminated: e.chips + e.invested <= 0,
      };
    }
    const penaltyDue = penaltyFor(e.hand);
    const penaltyPaid = Math.min(penaltyDue, e.chips);
    const chipsAfter = e.chips - penaltyPaid;
    return {
      playerId: e.id,
      name: e.name,
      stackBefore,
      invested: e.invested,
      returned: 0,
      investedLost: e.invested,
      penaltyDue,
      penaltyPaid,
      chipsAfter,
      eliminated: chipsAfter <= 0,
    };
  });
  return { winnerIds, changes };
}

function resolveRoundMut(state: GameState): void {
  const hands: HandResult[] = [];
  for (const id of state.turnOrder) {
    const p = getPlayer(state, id);
    const hand = p.hand as Hand;
    const rolls = state.impostorRolls[id] ?? {};
    const impostors: HandResult['impostors'] = {};
    const values: Partial<Record<Suit, number>> = {};
    for (const s of SUITS) {
      const r = rolls[s];
      if (r) {
        const v = r.dice[r.choice ?? 0];
        impostors[s] = { dice: r.dice, value: v };
        values[s] = v;
      }
    }
    hands.push({
      playerId: id,
      name: p.name,
      sand: hand.sand,
      blood: hand.blood,
      impostors,
      resolved: resolveHand(hand.sand, hand.blood, values),
      place: 0,
      winner: false,
    });
  }
  const entries = hands.map((h) => {
    const p = getPlayer(state, h.playerId);
    return { id: h.playerId, name: h.name, chips: p.chips, invested: p.invested, hand: h.resolved };
  });
  const places = assignPlaces(entries);
  const { winnerIds, changes } = settleChips(entries);
  for (const h of hands) {
    h.place = places[h.playerId];
    h.winner = winnerIds.includes(h.playerId);
  }
  hands.sort((a, b) => a.place - b.place);

  for (const c of changes) {
    const p = getPlayer(state, c.playerId);
    p.chips = c.chipsAfter;
    p.invested = 0;
    if (c.eliminated) {
      p.eliminated = true;
      p.eliminatedInRound = state.round;
    }
  }
  state.lastResult = { round: state.round, hands, winnerIds, chips: changes };

  const winNames = winnerIds.map((id) => getPlayer(state, id).name).join(' & ');
  const best = hands[0]?.resolved.label ?? '';
  addLog(state, 'round', `${winNames} ${winnerIds.length > 1 ? 'tie and win' : 'wins'} round ${state.round} with ${best}.`);
  for (const c of changes) {
    if (c.eliminated) addLog(state, 'round', `${c.name} is out of chips and eliminated.`);
  }

  const remaining = activePlayers(state);
  if (remaining.length <= 1) {
    state.phase = 'gameOver';
    // Defensive: if everyone somehow busted, the round's winners take the game.
    state.winnerIds = remaining.length === 1 ? [remaining[0].id] : winnerIds;
    const names = state.winnerIds.map((id) => getPlayer(state, id).name).join(' & ');
    addLog(state, 'round', `${names} wins the game!`);
  } else {
    state.phase = 'roundEnd';
  }
}
