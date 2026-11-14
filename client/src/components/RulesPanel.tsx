import { useEffect } from 'react';
import { ALL_TOKEN_IDS, SHIFT_TOKENS } from '../../../shared/src/tokens';
import { TokenChip } from './Tokens';

export function RulesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={`drawer-wrap ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer rules" role="dialog" aria-label="Rules">
        <header>
          <h2>Kessel Sabacc rules</h2>
          <button className="btn icon" onClick={onClose} aria-label="Close rules">
            ✕
          </button>
        </header>
        <div className="rules-body">
          <section>
            <h3>Goal</h3>
            <p>
              Hold one <b className="t-sand">Sand</b> and one <b className="t-blood">Blood</b> card whose values are as close as
              possible — ideally a matching pair (a <b>Sabacc</b>). The last player with chips wins.
            </p>
          </section>
          <section>
            <h3>Cards</h3>
            <ul>
              <li>Two 22-card decks, Sand and Blood: three each of 1–6, three Impostors and one Sylop.</li>
              <li>
                <b>Impostor</b>: at the reveal you roll two dice and pick one as its value.
              </li>
              <li>
                <b>Sylop</b>: copies the value of your other card. Two Sylops are <b>Pure Sabacc</b>.
              </li>
            </ul>
          </section>
          <section>
            <h3>A round</h3>
            <ol>
              <li>Each player gets 1 Sand + 1 Blood card face down; one card of each suit starts the discard piles.</li>
              <li>Everyone gets 3 turns, starting left of the dealer. On your turn:</li>
            </ol>
            <ul>
              <li>
                <b>Stand</b> — do nothing, pay nothing; or
              </li>
              <li>
                <b>Draw</b> — pay 1 chip into your invested pile and take a card from either deck or the top of either discard
                pile. Then discard one card of that suit (the new one or the old one).
              </li>
            </ul>
            <p>With 0 chips you must stand. After the third turn, all hands are revealed.</p>
          </section>
          <section>
            <h3>Hand ranking (best first)</h3>
            <ol>
              <li>
                <b>Pure Sabacc</b> — two Sylops.
              </li>
              <li>
                <b>Prime Sabacc</b> — a pair of 1s.
              </li>
              <li>
                <b>Sabacc</b> — any pair; lower pairs beat higher (2s beat 3s … 6s).
              </li>
              <li>
                <b>No Sabacc</b> — the difference between your cards; lower is better. Same difference: lower total wins.
              </li>
            </ol>
            <p>Hands still exactly tied all win.</p>
          </section>
          <section>
            <h3>Chips</h3>
            <ul>
              <li>Winners take back everything they invested this round.</li>
              <li>
                Losers lose their invested chips and pay a penalty: <b>1 chip</b> with a Sabacc, otherwise chips equal to their{' '}
                <b>difference</b> (or whatever they have left).
              </li>
              <li>A player with 0 chips is eliminated. The dealer button moves one seat clockwise each round.</li>
            </ul>
          </section>
          <section>
            <h3>Shift tokens (optional)</h3>
            <p>
              If the host turns them on, each player gets 1–3 random tokens for the whole game. Each token can be used once.
              You may play <b>one token per turn</b>, before you stand or draw. Your tokens are hidden from others; everyone
              sees when one is played. Taxed chips go into the taxed player&apos;s own pot, so they come back if that player
              wins the round. Rule changes and Immunity last until the reveal.
            </p>
            <ul className="token-rules">
              {ALL_TOKEN_IDS.map((id) => (
                <li key={id}>
                  <TokenChip id={id} compact /> <b>{SHIFT_TOKENS[id].name}</b> — {SHIFT_TOKENS[id].text}
                </li>
              ))}
            </ul>
            <p className="small">
              Immunity blocks taxes, Embezzlement, Embargo and targeting by other players, but not rule changes (Major Fraud,
              Cook the Books, Markdown, Prime Sabacc).
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
