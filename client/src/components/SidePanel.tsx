import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LogEntry } from '../../../shared/src/engine';
import { MAX_CHAT_LENGTH, type ChatMessage } from '../../../shared/src/protocol';
import { request } from '../net';

export function ChatBox({ chat, youId }: { chat: ChatMessage[]; youId: string | null }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    await request('chat:send', { text: t });
  }

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {chat.length === 0 && <p className="muted small">No messages yet.</p>}
        {chat.map((m) =>
          m.seatId === null ? (
            <p key={m.id} className="chat-sys">
              {m.text}
            </p>
          ) : (
            <p key={m.id} className={`chat-msg ${m.seatId === youId ? 'mine' : ''}`}>
              <b>{m.name}</b> {m.text}
            </p>
          ),
        )}
      </div>
      <form className="chat-form" onSubmit={send}>
        <input
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Say something…"
          aria-label="Chat message"
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn small" type="submit">
          Send
        </button>
      </form>
    </div>
  );
}

export function GameLog({ log }: { log: LogEntry[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const last = log.at(-1)?.seq;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);
  return (
    <div className="log" ref={listRef}>
      {log.map((l) => (
        <p key={l.seq} className={`log-${l.kind}`}>
          {l.text}
        </p>
      ))}
    </div>
  );
}

export function SidePanel({
  log,
  chat,
  youId,
  open,
  onClose,
}: {
  log: LogEntry[];
  chat: ChatMessage[];
  youId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'log' | 'chat'>('log');
  const [seenChat, setSeenChat] = useState(chat.at(-1)?.id ?? 0);
  const lastChat = chat.filter((m) => m.seatId !== null).at(-1)?.id ?? 0;
  const unread = tab !== 'chat' && lastChat > seenChat;
  useEffect(() => {
    if (tab === 'chat') setSeenChat(lastChat);
  }, [tab, lastChat]);

  return (
    <aside className={`side-panel ${open ? 'open' : ''}`}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
          Game log
        </button>
        <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
          Chat {unread && <span className="dot" aria-label="unread" />}
        </button>
        <button className="btn icon side-close" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>
      {tab === 'log' ? <GameLog log={log} /> : <ChatBox chat={chat} youId={youId} />}
    </aside>
  );
}
