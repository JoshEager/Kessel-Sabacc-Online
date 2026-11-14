export type Suit = 'sand' | 'blood';
export type CardKind = 'number' | 'impostor' | 'sylop';

export const SUITS: readonly Suit[] = ['sand', 'blood'];

export interface Card {
  id: string;
  suit: Suit;
  kind: CardKind;
  /** 1–6 for number cards, 0 for Impostor and Sylop. */
  value: number;
}

export const COPIES_PER_VALUE = 3;
export const IMPOSTORS_PER_DECK = 3;
export const DECK_SIZE = 6 * COPIES_PER_VALUE + IMPOSTORS_PER_DECK + 1; // 22

/** Builds one fresh, ordered 22-card deck of the given suit. */
export function buildDeck(suit: Suit): Card[] {
  const p = suit === 'sand' ? 'S' : 'B';
  const letters = 'abcdefgh';
  const cards: Card[] = [];
  for (let v = 1; v <= 6; v++) {
    for (let c = 0; c < COPIES_PER_VALUE; c++) {
      cards.push({ id: `${p}${v}${letters[c]}`, suit, kind: 'number', value: v });
    }
  }
  for (let c = 0; c < IMPOSTORS_PER_DECK; c++) {
    cards.push({ id: `${p}I${letters[c]}`, suit, kind: 'impostor', value: 0 });
  }
  cards.push({ id: `${p}S`, suit, kind: 'sylop', value: 0 });
  return cards;
}

export function suitName(suit: Suit): string {
  return suit === 'sand' ? 'Sand' : 'Blood';
}

export function cardFaceName(card: Pick<Card, 'kind' | 'value'>): string {
  if (card.kind === 'impostor') return 'Impostor';
  if (card.kind === 'sylop') return 'Sylop';
  return String(card.value);
}

/** e.g. "Blood 5", "Sand Impostor", "Blood Sylop" */
export function cardLabel(card: Card): string {
  return `${suitName(card.suit)} ${cardFaceName(card)}`;
}

export function otherSuit(suit: Suit): Suit {
  return suit === 'sand' ? 'blood' : 'sand';
}
