import {useEffect, useState} from 'react';
import net from '../services/net.js';

// Small live network overlay for the demo (toggle with F3).
// The numbers come from the transport in Electron's main process, once per second:
//   UDP → 100.x.y.z:5001 · connected · RTT 14 ms · ↑23 ↓41 msg/s · retrans 3 · dup 1 · out-of-order 0
// For TCP, retransmissions / duplicates / reordering are handled invisibly by the OS's TCP stack,
// so the HUD says so instead of showing counters we cannot see.

const style = {
  position: 'fixed',
  bottom: 8,          // bottom-right: the corners above hold the Back/Leave button and the scoreboard
  right: 10,
  zIndex: 20000,
  padding: '4px 8px',
  background: 'rgba(0, 0, 0, 0.65)',
  color: '#7CFC9A',
  font: '12px/1.4 Consolas, "Courier New", monospace',
  borderRadius: 4,
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  textAlign: 'right',
};

export default function NetHud() {
  const [visible, setVisible] = useState(true);
  const [status, setStatus] = useState(net.info);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F3') {
        e.preventDefault();
        setVisible(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    net.on('status', setStatus);
    net.on('stats', setStats);
    net.ready.then(() => setStatus(net.info));
    return () => {
      window.removeEventListener('keydown', onKey);
      net.off('status', setStatus);
      net.off('stats', setStats);
    };
  }, []);

  if (!visible || !status) return null;

  // Two short lines (connection, then traffic) so the HUD stays clear of the centred buttons.
  const line1 = [
    `${status.proto.toUpperCase()} → ${status.server}:${status.port}`,
    status.state,
  ];
  const line2 = [];
  if (stats) {
    line1.push(`RTT ${stats.rttMs ?? '–'} ms`);
    line2.push(`↑${stats.perSecond.msgsOut} ↓${stats.perSecond.msgsIn} msg/s`);
    if (stats.proto === 'udp') {
      line2.push(`retrans ${stats.retransmits}`);
      line2.push(`dup ${stats.duplicatesIgnored}`);
      line2.push(`out-of-order ${stats.outOfOrderBuffered}`);
      if (stats.simulatedLoss) line2.push(`sim. loss ${stats.simulatedLoss}`);
    } else {
      line2.push('reliability: OS TCP stack');
    }
  }
  const color = status.state === 'connected' ? style.color : '#ff7070';
  return (
    <div style={{...style, color}} title="Network HUD (F3)">
      <div>{line1.join(' · ')}</div>
      {line2.length > 0 && <div>{line2.join(' · ')}</div>}
    </div>
  );
}
