import { useEffect, useState } from 'react';

/** Re-renders on an interval and returns seconds left until `deadline` (server clock). */
export function useSecondsLeft(deadline: number | null, now: () => number): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const iv = setInterval(() => tick((t) => t + 1), 250);
    return () => clearInterval(iv);
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - now()) / 1000));
}

export function CountdownRing({
  deadline,
  total,
  now,
  size = 34,
}: {
  deadline: number | null;
  total: number;
  now: () => number;
  size?: number;
}) {
  const left = useSecondsLeft(deadline, now);
  if (left === null) return null;
  const frac = Math.max(0, Math.min(1, left / total));
  const r = 15;
  const circ = 2 * Math.PI * r;
  return (
    <span className={`countdown ${left <= 5 ? 'urgent' : ''}`} style={{ width: size, height: size }} aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 36 36">
        <circle cx="18" cy="18" r={r} className="cd-track" />
        <circle
          cx="18"
          cy="18"
          r={r}
          className="cd-bar"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <b>{left}</b>
    </span>
  );
}
