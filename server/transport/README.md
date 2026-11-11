# Server transports (TCP and UDP)

`tcp.js` and `udp.js` implement the same contract. `server/main.js` gets one of them from
`shared/transportFactory.js`, according to `TRANSPORT` in `shared/config.js` (or `--proto` / `TRANSPORT=`).
Game code never imports a transport directly. It gets session ids and plain `{ t, d }` messages.

## Contract

```js
await transport.start(port)                    // binds 0.0.0.0; resolves the bound address
transport.send(sessionId, msg, { reliable })   // msg = { t: 'type', d: data }; returns false if rejected
transport.broadcast(sessionIds, msg, { reliable })
transport.stats(sessionId)                     // { rttMs, jitterMs, bytesIn, bytesOut, retransmits, lost }
transport.sessionIds()                         // all sessions, including ones waiting for a reconnect
await transport.stop()                         // BYE to everybody, then close

transport.on('connect',    (sessionId) => {})
transport.on('message',    (sessionId, msg) => {})
transport.on('lost',       (sessionId, reason) => {})  // 'timeout' | 'closed'   (connection dropped)
transport.on('reconnect',  (sessionId) => {})          // same client back with its token
transport.on('disconnect', (sessionId, reason) => {})  // 'closed' | 'timeout'   (session is gone)
```

`{ reliable }` is ignored by TCP, where everything is reliable and ordered. On UDP, `false` means
"latest wins": the message is never retransmitted, anything older than the newest one received is
dropped, and it must fit in one datagram. `shared/protocol.js` (`UNRELIABLE_TYPES`) decides which
message types are unreliable. Today those are `player:move`, `player:moved` and `player:animation`.

## Session lifecycle and reconnect (for the game-logic owner)

```
connect ──► message* ──► lost(reason) ──┬─► reconnect ──► message* ...   (back within 10 s)
                                        └─► disconnect(reason)          (10 s grace expired)
connect ──► message* ──► disconnect('closed')                            (clean leave: BYE)
```

| Situation | Detected | Events |
|---|---|---|
| Player quits (window closed) | immediately (BYE) | `disconnect(id, 'closed')` |
| Pulled cable, Wi-Fi drop, frozen client | 5 s without a packet (`TIMING.timeoutMs`) | `lost(id, 'timeout')` |
| TCP connection reset or closed without BYE | immediately | `lost(id, 'closed')` |
| Same client back with its token within 10 s (`TIMING.reconnectGraceMs`) | first valid packet or HELLO | `reconnect(id)` |
| Not back within 10 s | 5 s + 10 s | `disconnect(id, reason)` |
| UDP client changes ip:port (NAT, network switch) with a live session | next packet | none: the session is re-bound silently |

Notes:

- **The session id never changes across a reconnect.** A reconnect is never reported as
  `disconnect` + `connect`. The game should not delete a player on `lost`. Delete on `disconnect` only.
- **Restoring the player:** with the current game code there is nothing to restore, because the player
  object and its room membership survive a reconnect. `server/gameAdapter.js` only logs `lost` and
  `reconnect`. If the new core (`server/core/`) wants a resync (for example to send a fresh `ROOM_STATE`
  or snapshot), do it in the `reconnect` handler.
- **Messages sent while a session is lost:** UDP keeps every reliable message and resends it after the
  reconnect, with nothing lost. TCP queues messages written after the drop was detected (up to 500).
  Bytes already handed to the dead socket before the drop was detected can be lost. Resync on
  `reconnect` if that matters.
- A spurious `lost` → `reconnect` can happen on a very lossy UDP link (about 30 %): 5 pings in a row
  lost is about 0.24 % per 5 s window. It is invisible to players, because nothing is deleted.
- Setting `TIMING.reconnectGraceMs = 0` in `shared/config.js` turns reconnect off: `lost` is then
  followed by `disconnect` immediately.

## Safety

- Every packet or frame is parsed inside try/catch. A bad one is dropped and the server keeps running.
  Messages are validated against `shared/protocol.js` (`validateClientMessage`) in `gameAdapter.js`.
- TCP: frames above 64 KB close that connection, because the stream cannot be resynchronised. A
  connection that sends no HELLO within 5 s is closed. A peer that stops reading (more than 1 MB
  buffered) is dropped.
- UDP: a bad magic, version, size or type is dropped silently. An unknown token gets a rate-limited
  BYE `unknown-session`. There is a 256-session cap. The address always comes from `rinfo`, never
  from the payload.
