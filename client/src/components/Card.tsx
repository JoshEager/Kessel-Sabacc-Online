import { useState, type CSSProperties } from 'react';
import type { Card, Suit } from '../../../shared/src/cards';
import { cardLabel, suitName } from '../../../shared/src/cards';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

export function SuitGlyph({ suit, className }: { suit: Suit; className?: string }) {
  return suit === 'sand' ? (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path d="M10 2 L18 17 H2 Z" fill="currentColor" />
      <path d="M10 8 L13.5 14.5 H6.5 Z" fill="var(--glyph-cut)" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="currentColor" />
      <path d="M10 4 L14 10 L10 16 L6 10 Z" fill="var(--glyph-cut)" />
    </svg>
  );
}

export function ImpostorSymbol() {
  // A two-faced mask: one half solid, one half hollow, mismatched eyes.
  return (
    <svg viewBox="0 0 60 60" className="sym" aria-hidden="true">
      <circle cx="30" cy="30" r="22" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path d="M30 8 A22 22 0 0 0 30 52 Z" fill="currentColor" />
      <path d="M17 25 Q22 21 26 25 Q22 28 17 25 Z" fill="var(--sym-cut)" />
      <path d="M34 26 Q39 20 44 26" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 38 Q25 41 30 38" fill="none" stroke="var(--sym-cut)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M30 38 Q35 35 40 38" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M30 4 V56" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" />
    </svg>
  );
}

export function SylopSymbol() {
  // An eight-pointed star inside a ring: the shape-shifter.
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? 20 : 8;
    const a = (Math.PI / 8) * i - Math.PI / 2;
    pts.push(`${30 + r * Math.cos(a)},${30 + r * Math.sin(a)}`);
  }
  return (
    <svg viewBox="0 0 60 60" className="sym" aria-hidden="true">
      <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
      <polygon points={pts.join(' ')} fill="currentColor" />
      <circle cx="30" cy="30" r="5" fill="var(--sym-cut)" />
    </svg>
  );
}

export function CardFace({ card }: { card: Card }) {
  return (
    <div className={`card-face ${card.suit} ${card.kind}`} title={cardLabel(card)}>
      <div className="corner tl">
        <span>{card.kind === 'number' ? card.value : card.kind === 'impostor' ? 'I' : 'S'}</span>
        <SuitGlyph suit={card.suit} className="corner-glyph" />
      </div>
      <div className="face-center">
        {card.kind === 'number' && (
          <>
            <span className="big-num">{card.value}</span>
            <div className="pips">
              {Array.from({ length: card.value }, (_, i) => (
                <SuitGlyph key={i} suit={card.suit} className="pip" />
              ))}
            </div>
          </>
        )}
        {card.kind === 'impostor' && (
          <>
            <ImpostorSymbol />
            <span className="face-name">Impostor</span>
          </>
        )}
        {card.kind === 'sylop' && (
          <>
            <SylopSymbol />
            <span className="face-name">Sylop</span>
          </>
        )}
      </div>
      <div className="corner br">
        <span>{card.kind === 'number' ? card.value : card.kind === 'impostor' ? 'I' : 'S'}</span>
        <SuitGlyph suit={card.suit} className="corner-glyph" />
      </div>
    </div>
  );
}

export function CardBack({ suit }: { suit: Suit }) {
  return (
    <div className={`card-back ${suit}`} title={`${suitName(suit)} card (face down)`}>
      <div className="back-ring">
        <SuitGlyph suit={suit} className="back-glyph" />
      </div>
    </div>
  );
}

/**
 * A card that flips between back and face. When `card` goes from null to a card, it flips over.
 */
export function CardView({
  card,
  suit,
  size = 'md',
  className = '',
  onClick,
  disabled,
  label,
  style,
}: {
  card: Card | null;
  suit: Suit;
  size?: CardSize;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  label?: string;
  style?: CSSProperties;
}) {
  // Entry-animation classes and delays apply only to the mount, so later prop changes never replay them.
  const [mountClass] = useState(className);
  const [mountStyle] = useState(style);
  className = mountClass;
  style = mountStyle;
  const content = (
    <div className={`flipper ${card ? 'up' : 'down'}`}>
      <div className="side front">{card ? <CardFace card={card} /> : <CardBack suit={suit} />}</div>
      <div className="side back">
        <CardBack suit={suit} />
      </div>
    </div>
  );
  const cls = `card card-${size} ${className}`;
  if (onClick) {
    return (
      <button
        type="button"
        className={`${cls} clickable`}
        onClick={onClick}
        disabled={disabled}
        aria-label={label ?? (card ? cardLabel(card) : `${suitName(suit)} card`)}
        style={style}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={cls} style={style} aria-label={label ?? (card ? cardLabel(card) : `${suitName(suit)} card, face down`)}>
      {content}
    </div>
  );
}
