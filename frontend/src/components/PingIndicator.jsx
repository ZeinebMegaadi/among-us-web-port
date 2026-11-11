import { useEffect, useState } from 'react';
import styles from './PingIndicator.module.css';

// Round-trip time to the game server, top right. Desktop (Electron) only: the value comes from
// the main process every second through window.net.onStats (TCP or UDP PING/PONG, smoothed RTT).
export default function PingIndicator({ className = '' }) {
  const [rtt, setRtt] = useState(null);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const net = window.net;
    if (!net) return undefined;
    const offStats = net.onStats((s) => {
      setRtt(Number.isFinite(s?.rttMs) ? s.rttMs : null);
      setConnected(s?.state === 'connected');
    });
    const offStatus = net.onStatus((s) => {
      setConnected(s?.state === 'connected');
      if (s?.state !== 'connected') setRtt(null);
    });
    return () => {
      offStats();
      offStatus();
    };
  }, []);

  if (!window.net) return null;

  const ms = connected && rtt !== null ? Math.round(rtt) : null;
  const level = ms === null ? styles.none : ms < 80 ? styles.good : ms < 150 ? styles.ok : styles.bad;

  return (
    <div className={`${styles.ping} ${level} ${className}`} title="Round-trip time to the server">
      {ms === null ? '-- ms' : `${ms} ms`}
    </div>
  );
}
