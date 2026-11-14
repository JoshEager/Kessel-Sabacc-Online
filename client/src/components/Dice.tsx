import { useEffect, useState } from 'react';

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

export function DieFace({ value }: { value: number }) {
  return (
    <svg viewBox="0 0 100 100" className="die-svg" aria-hidden="true">
      <rect x="4" y="4" width="92" height="92" rx="18" className="die-body" />
      {(PIPS[value] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="9" className="die-pip" />
      ))}
    </svg>
  );
}

/** A die that tumbles through random faces for a moment before landing on `value`. */
export function Die({
  value,
  rollKey,
  selected,
  dimmed,
  onClick,
  size = 44,
}: {
  value: number;
  rollKey: string;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  size?: number;
}) {
  const [shown, setShown] = useState(value);
  const [rolling, setRolling] = useState(true);

  useEffect(() => {
    setRolling(true);
    let n = 0;
    const iv = setInterval(() => {
      n++;
      setShown(1 + Math.floor(Math.random() * 6));
      if (n >= 9) {
        clearInterval(iv);
        setShown(value);
        setRolling(false);
      }
    }, 80);
    return () => clearInterval(iv);
    // Only re-roll when a new roll happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey]);

  useEffect(() => {
    if (!rolling) setShown(value);
  }, [value, rolling]);

  const cls = `die ${rolling ? 'rolling' : ''} ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`;
  const style = { width: size, height: size };
  if (onClick) {
    return (
      <button type="button" className={`${cls} clickable`} style={style} onClick={onClick} disabled={rolling} aria-label={`Choose ${value}`}>
        <DieFace value={shown} />
      </button>
    );
  }
  return (
    <span className={cls} style={style} aria-label={`Die showing ${value}`}>
      <DieFace value={shown} />
    </span>
  );
}
