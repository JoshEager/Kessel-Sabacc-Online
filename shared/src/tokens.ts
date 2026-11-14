export type ShiftTokenId =
  | 'freeDraw'
  | 'refund'
  | 'extraRefund'
  | 'embezzlement'
  | 'majorFraud'
  | 'cookTheBooks'
  | 'markdown'
  | 'primeSabacc'
  | 'generalTariff'
  | 'targetTariff'
  | 'generalAudit'
  | 'targetAudit'
  | 'embargo'
  | 'immunity'
  | 'exhaustion'
  | 'directTransaction';

export type TokenTarget = 'none' | 'player' | 'standingPlayer';

export interface ShiftTokenDef {
  id: ShiftTokenId;
  name: string;
  /** Short effect text shown on the token. */
  text: string;
  target: TokenTarget;
  /** Rule-changing tokens affect everyone and cannot be blocked by Immunity. */
  ruleChange: boolean;
  /** Visual group for the UI. */
  group: 'chips' | 'tax' | 'rules' | 'hands' | 'control';
}

export const SHIFT_TOKENS: Record<ShiftTokenId, ShiftTokenDef> = {
  freeDraw: { id: 'freeDraw', name: 'Free Draw', text: 'Avoid the draw fee this turn.', target: 'none', ruleChange: false, group: 'chips' },
  refund: { id: 'refund', name: 'Refund', text: 'Retrieve 2 chips from your pot.', target: 'none', ruleChange: false, group: 'chips' },
  extraRefund: { id: 'extraRefund', name: 'Extra Refund', text: 'Retrieve 3 chips from your pot.', target: 'none', ruleChange: false, group: 'chips' },
  embezzlement: {
    id: 'embezzlement',
    name: 'Embezzlement',
    text: "Take 1 chip from each player's pot into your pot.",
    target: 'none',
    ruleChange: false,
    group: 'chips',
  },
  majorFraud: { id: 'majorFraud', name: 'Major Fraud', text: 'Impostors are worth 6 until the reveal.', target: 'none', ruleChange: true, group: 'rules' },
  cookTheBooks: {
    id: 'cookTheBooks',
    name: 'Cook the Books',
    text: 'Invert Sabacc ranks until the reveal (6s best, 1s worst).',
    target: 'none',
    ruleChange: true,
    group: 'rules',
  },
  markdown: { id: 'markdown', name: 'Markdown', text: 'Sylops are worth 0 until the reveal.', target: 'none', ruleChange: true, group: 'rules' },
  primeSabacc: {
    id: 'primeSabacc',
    name: 'Prime Sabacc',
    text: 'Roll 2 dice; pick one. That pair becomes the best Sabacc.',
    target: 'none',
    ruleChange: true,
    group: 'rules',
  },
  generalTariff: { id: 'generalTariff', name: 'General Tariff', text: 'Other players are taxed 1 chip.', target: 'none', ruleChange: false, group: 'tax' },
  targetTariff: { id: 'targetTariff', name: 'Target Tariff', text: 'Choose a player. They are taxed 2 chips.', target: 'player', ruleChange: false, group: 'tax' },
  generalAudit: {
    id: 'generalAudit',
    name: 'General Audit',
    text: 'Other players who last stood are taxed 2 chips.',
    target: 'none',
    ruleChange: false,
    group: 'tax',
  },
  targetAudit: {
    id: 'targetAudit',
    name: 'Target Audit',
    text: 'Choose a player who last stood. They are taxed 3 chips.',
    target: 'standingPlayer',
    ruleChange: false,
    group: 'tax',
  },
  embargo: { id: 'embargo', name: 'Embargo', text: 'The next player must stand.', target: 'none', ruleChange: false, group: 'control' },
  immunity: {
    id: 'immunity',
    name: 'Immunity',
    text: "Other players' tokens can't affect you until the reveal.",
    target: 'none',
    ruleChange: false,
    group: 'control',
  },
  exhaustion: {
    id: 'exhaustion',
    name: 'Exhaustion',
    text: 'Choose a player. They discard their hand and draw a new one.',
    target: 'player',
    ruleChange: false,
    group: 'hands',
  },
  directTransaction: {
    id: 'directTransaction',
    name: 'Direct Transaction',
    text: 'Choose a player. Trade hands with them.',
    target: 'player',
    ruleChange: false,
    group: 'hands',
  },
};

export const ALL_TOKEN_IDS = Object.keys(SHIFT_TOKENS) as ShiftTokenId[];
export const MAX_TOKENS_PER_PLAYER = 3;
export const SHIFT_TOKEN_OPTIONS = [0, 1, 2, 3] as const;

export function isShiftTokenId(x: unknown): x is ShiftTokenId {
  return typeof x === 'string' && x in SHIFT_TOKENS;
}
