import {useEffect, useState} from 'react';
import net from '../services/net.js';

// Top-right panel in the waiting room and during a game: the game clock and the room's scoreboard.
//
// The scoreboard comes from the server: room:update is sent to the players of a room whenever its
// players, host or scores change, and room:state answers the scenes' room:get. During a game the
// server sends the scores as they were when the game STARTED: live totals would reveal roles (the
// imposter gains a point per kill, a crewmate a point for voting the imposter). New totals arrive
// with game:ended.
//
// The clock: the server sends a DURATION in game:started, not an end time, because the clients'
// clocks are not synchronised with the server's. We count down from the moment the message
// arrived, so we are off by the one-way network delay only. The server's own timer decides.

const panel = {
  position: 'fixed',
  top: 10,
  right: 10,
  zIndex: 15000,
  minWidth: 170,
  padding: '8px 12px',
  background: 'rgba(0, 0, 0, 0.65)',
  color: 'rgba(255, 255, 255, 0.9)',
  font: '13px/1.5 "Segoe UI", Arial, sans-serif',
  borderRadius: 6,
  pointerEvents: 'none',
};

function formatClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function RoomPanel({endsAt, localPlayerId}) {
  const [room, setRoom] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const onRoom = (data) => { if (data?.room) setRoom(data.room); };
    net.on('room:update', onRoom);
    net.on('room:state', onRoom);
    return () => {
      net.off('room:update', onRoom);
      net.off('room:state', onRoom);
    };
  }, []);

  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [endsAt]);

  const players = room ? Object.values(room.players) : [];
  const rows = players
    .map(p => ({...p, points: room.scores?.[p.id] ?? 0}))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const left = endsAt ? endsAt - now : null;

  return (
    <div style={panel}>
      {left !== null && (
        <div style={{fontSize: 20, fontWeight: 700, color: left <= 30000 ? '#e94560' : '#ffd700', textAlign: 'center'}}>
          {formatClock(left)}
        </div>
      )}
      <div style={{fontWeight: 700, color: '#4ecca3', marginTop: left !== null ? 4 : 0}}>
        {room?.started ? 'Scores before this game' : 'Scores'}
      </div>
      {rows.length === 0 && <div>…</div>}
      {rows.map(p => (
        <div key={p.id} style={{display: 'flex', alignItems: 'center', gap: 6, fontWeight: p.id === localPlayerId ? 700 : 400}}>
          <span style={{width: 10, height: 10, borderRadius: '50%', background: p.color, display: 'inline-block'}}/>
          <span style={{flex: 1}}>{p.name}{room.host?.id === p.id ? ' ★' : ''}</span>
          <span>{p.points}</span>
        </div>
      ))}
    </div>
  );
}
