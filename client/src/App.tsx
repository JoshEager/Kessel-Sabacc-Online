import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomView } from '../../shared/src/protocol';
import { codeFromUrl, loadSession, request, saveSession, setUrlCode, socket } from './net';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Table } from './components/Table';

/** How long the socket may be disconnected before the "connection lost" banner appears. Opening
 *  the app, waking a phone or a brief network blip usually reconnects well within this. */
const CONN_BANNER_DELAY_MS = 4000;

/** True once `connected` has been false for `delayMs`; false again as soon as it reconnects. */
function useDelayedDisconnect(connected: boolean, delayMs: number): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (connected) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [connected, delayMs]);
  return show;
}

export function App() {
  const [view, setView] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [resuming, setResuming] = useState(() => !!loadSession());
  const [notice, setNotice] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const showConnBanner = useDelayedDisconnect(connected, CONN_BANNER_DELAY_MS);

  const tryResume = useCallback(async () => {
    const session = loadSession();
    const urlCode = codeFromUrl();
    if (!session || (urlCode && urlCode !== session.code)) {
      setResuming(false);
      return;
    }
    const res = await request<{ code: string }>('room:resume', session);
    if (!res.ok) {
      saveSession(null);
      setView(null);
      if (urlCode) setNotice(`${res.error}.`);
    }
    setResuming(false);
  }, []);

  useEffect(() => {
    const onState = (v: RoomView) => {
      offsetRef.current = v.serverNow - Date.now();
      setView(v);
      setUrlCode(v.code);
    };
    const onConnect = () => {
      setConnected(true);
      void tryResume();
    };
    const onDisconnect = () => setConnected(false);
    const onClosed = ({ reason }: { reason: string }) => {
      saveSession(null);
      setView(null);
      setUrlCode(null);
      setNotice(reason);
    };
    socket.on('room:state', onState);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:closed', onClosed);
    if (socket.connected) void tryResume();
    return () => {
      socket.off('room:state', onState);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:closed', onClosed);
    };
  }, [tryResume]);

  const leave = useCallback(async () => {
    await request('room:leave');
    saveSession(null);
    setView(null);
    setUrlCode(null);
  }, []);

  const now = useCallback(() => Date.now() + offsetRef.current, []);

  let body;
  if (view && view.youId) {
    body =
      view.status === 'lobby' ? (
        <Lobby view={view} onLeave={leave} />
      ) : (
        <Table view={view} now={now} onLeave={leave} />
      );
  } else if (resuming) {
    body = <div className="splash">Reconnecting to your table…</div>;
  } else {
    body = <Home notice={notice} clearNotice={() => setNotice(null)} />;
  }

  return (
    <>
      {showConnBanner && <div className="conn-banner">Connection lost — reconnecting…</div>}
      {body}
    </>
  );
}
