import { useState, type FormEvent } from 'react';
import { MAX_NAME_LENGTH } from '../../../shared/src/protocol';
import { codeFromUrl, loadName, randomName, request, saveName, saveSession } from '../net';
import { CardFace } from './Card';
import { RulesPanel } from './RulesPanel';
import { useInstall } from '../pwa';

export function Home({ notice, clearNotice }: { notice: string | null; clearNotice: () => void }) {
  const urlCode = codeFromUrl();
  const [name, setName] = useState(loadName);
  const [namePlaceholder] = useState(randomName);
  const [code, setCode] = useState(urlCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const { mode: installMode, install } = useInstall();

  async function go(kind: 'create' | 'join', e?: FormEvent) {
    e?.preventDefault();
    clearNotice();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a display name first.');
      return;
    }
    if (kind === 'join' && !code.trim()) {
      setError('Enter a room code to join.');
      return;
    }
    setBusy(true);
    setError(null);
    saveName(trimmed);
    const res =
      kind === 'create'
        ? await request<{ code: string; token: string }>('room:create', { name: trimmed })
        : await request<{ code: string; token: string }>('room:join', { code: code.trim().toUpperCase(), name: trimmed });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    saveSession({ code: res.code, token: res.token });
  }

  return (
    <div className="home">
      <div className="home-hero" aria-hidden="true">
        <div className="hero-card hero-left">
          <CardFace card={{ id: 'h1', suit: 'sand', kind: 'sylop', value: 0 }} />
        </div>
        <div className="hero-card hero-right">
          <CardFace card={{ id: 'h2', suit: 'blood', kind: 'sylop', value: 0 }} />
        </div>
      </div>
      <h1 className="title">
        Kessel Sabacc <span>Online</span>
      </h1>
      <p className="tagline">Two suits. Three turns. Lowest difference wins — unless someone pairs up.</p>

      <form className="panel home-form" onSubmit={(e) => go(urlCode ? 'join' : 'create', e)}>
        <label className="field">
          <span>Display name</span>
          <input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="nickname"
            placeholder={namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {!urlCode && (
          <button type="button" className="btn primary big" disabled={busy} onClick={() => go('create')}>
            Create a private room
          </button>
        )}

        <div className="join-row">
          <label className="field grow">
            <span>{urlCode ? 'You were invited to room' : 'Or join with a code'}</span>
            <input
              value={code}
              maxLength={8}
              placeholder="ABCDE"
              className="code-input"
              autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <button type="button" className={`btn ${urlCode ? 'primary big' : ''}`} disabled={busy} onClick={() => go('join')}>
            Join
          </button>
        </div>
        {urlCode && (
          <button type="button" className="btn ghost small" disabled={busy} onClick={() => go('create')}>
            Create my own room instead
          </button>
        )}
        {(error || notice) && <p className="error">{error ?? notice}</p>}
      </form>

      <button className="btn ghost" onClick={() => setRulesOpen(true)}>
        How to play
      </button>
      {installMode === 'prompt' && (
        <button className="btn install-btn" onClick={() => void install()}>
          Install app
        </button>
      )}
      {installMode === 'ios' && (
        <p className="install-hint">
          Install on iPhone: tap <b>Share</b>, then <b>Add to Home Screen</b>.
        </p>
      )}
      <RulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <p className="footnote">A fan-made, unofficial game. All art is original.</p>
    </div>
  );
}
