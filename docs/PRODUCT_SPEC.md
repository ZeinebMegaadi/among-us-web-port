# Among Us Arena: product specification and requirements baseline

| | |
|---|---|
| Course | CS411 Computer Networks, Project #2 "Multiplayer Game Arena" (team of 4) |
| Demo and presentation | Friday 13 November 2026 |
| Branch described | `israa/local-implementation` at commit `b49adce` (4 commits ahead of `main`) |
| Source of requirements | `Multiplayer_Game_Arena_Project_2.pdf` (the course brief) |

This file describes the product as it is built on the branch above, defines the project requirements with
IDs, and records how far the branch satisfies each one. Use it as the context to paste into future prompts
and as the checklist to measure progress.

**How the status column was established.** "Tested" means the automated network test
(`tools/smoke-client.cjs`) was run on 12 Nov 2026 and passed: 38 of 38 checks for TCP, for UDP, and for UDP
with 20% simulated loss. That test drives the real server with three headless clients built from the same
client transport modules as the app. "Code" means the behaviour was read in the source but not exercised:
the Electron window, the React screens and the Phaser scenes were **not** launched for this document
(`frontend/node_modules` and `frontend/dist` were absent on the machine used).

---

## 1. Product in one paragraph

Among Us Arena is a social-deduction game for three players: one imposter and two crewmates, in a shared
room on one server. The imposter scores by killing; crewmates score by voting the imposter out. Every
player has an individual point total, and the room keeps a ranking across games, so each player competes
with the other two. The same game ships in two versions that differ only in transport: one uses TCP only
(Node `net`), the other UDP only (Node `dgram`) with a reliability layer written for this project. No
networking library is used: no Socket.IO, Express, HTTP or WebSocket.

---

## 2. Project requirements

Types: **E** = explicit in the brief, **B** = bonus in the brief, **T** = team decision (not asked by the brief).

### 2.1 Architecture requirements

| ID | Type | Requirement | Acceptance criterion |
|---|---|---|---|
| A1 | E | The game is competitive; a purely cooperative game is not acceptable. | Players have opposing goals and individual scores; the end screen ranks them. |
| A2 | E | Client-server architecture with one server and three clients. | One server process serves three clients in one room. |
| A3 | E | The live demo uses four separate computers (one server, three clients). | A full game is played with the four processes on four machines. |
| A4 | E | Communication uses network sockets. In-process communication or a simulated multi-client display does not count. | A packet capture on a client shows the game traffic on the network interface. |
| A5 | E | Two versions of the same game: TCP only and UDP only, with identical rules and features. | Game-rule code is shared; only transport files differ; the same test passes on both. |
| A6 | E | The UDP version meets every requirement without TCP, with the team's own reliability and disconnection detection where needed. | Capture filter `tcp` shows no game traffic in the UDP version; reliable messages survive packet loss; a silent client is detected. |
| A7 | E | The team demonstrates understanding of TCP and UDP, their differences, and how each behaved in the two versions. | Slides and live explanation backed by the team's own measurements. |

### 2.2 Mandatory features (both versions)

| ID | Type | Feature | Acceptance criterion |
|---|---|---|---|
| F1 | E | Player registration and login | A player identifies with a name and password; a second login with a wrong password is refused. |
| F2 | E | Lobby and room creation | A player creates a room; the other clients see it appear in their lobby list. |
| F3 | E | Joining or leaving a room | A player joins an available room and can leave it; the others are told. |
| F4 | E | Game start and end, session status | The game is started and terminated by the server; the room's status (waiting or in game) is visible. |
| F5 | E | Real-time game actions | Movement and actions of one player appear on the other clients during play. |
| F6 | E | Scores and final results | Scores are kept on the server; ranking and winner are sent to all clients at the end. |
| F7 | E | Player disconnection | An unexpected disconnection is detected and handled; neither the server nor the other clients crash. |

### 2.3 Deliverables

| ID | Type | Deliverable | Acceptance criterion |
|---|---|---|---|
| D1 | E | Live demonstration of both versions with the required features and a real competitive session | Rehearsed on the four machines for TCP and for UDP. |
| D2 | E | Technical explanation, 5 to 7 slides | Covers: socket architecture of each version; comparison with team-defined metrics; friction points; where each protocol performed best; technical differences; how simultaneous players and disconnections are handled in each version. |
| D3 | E | Complete source code for both versions and instructions to run each one. No written report. | A person outside the team can run both versions from the README. |
| B1 | B | Cross-network play: at least one version works when server and clients are not all on the same local network, with the setup explained | Real communication shown across different networks. |

### 2.4 Team-defined requirements

| ID | Type | Requirement | Acceptance criterion |
|---|---|---|---|
| T1 | T | The server is authoritative: clients send requests, the server validates them against its own state. | A forged kill, move, vote or start is refused. |
| T2 | T | Identity comes from the transport session, never from the message payload. | A client cannot act as another player by editing a payload. |
| T3 | T | The wire format is readable JSON. | Messages can be read directly in Wireshark. |
| T4 | T | Network code uses only Node's `net` and `dgram`, and stays simple and commented. | `backend/package.json` has no dependencies. |
| T5 | T | Live network metrics are visible and logged for the comparison. | HUD in the client; one CSV line per second per client. |
| T6 | T | Remote players move smoothly at 20 position updates per second. | No visible teleporting at 0% loss. |

---

## 3. Status against the requirements

| ID | Status | Evidence and remaining work |
|---|---|---|
| A1 | Met (tested) | Individual points and a ranking; test produced three different scores (3, 2, 1). |
| A2 | Met (tested on one PC) | Three clients in one room. |
| A3 | **Not verified** | Needs the four-machine rehearsal, including the Windows firewall rules in the README. |
| A4 | Met (tested) | Real `net.Socket` and `dgram` sockets. The UI reaches them through Electron IPC, which stays inside the PC. |
| A5 | Met (tested) | `backend/src/events/*` and `managers/*` are shared; `main.js` picks the transport from `--proto`. Same 38 checks pass on both. |
| A6 | Met (tested) | UDP passes with 20% loss on both sides (retransmissions, duplicates and reordering all occurred and were handled). |
| A7 | **Partly met** | README section 3 explains both protocols and has a measured-behaviour table. The slides are not in the repo. |
| F1 | Met (tested) | Name + password, scrypt hash in `backend/data/users.json`, server-issued player id. Limitation: the password crosses the network in clear text. |
| F2 | Met (tested) | `room:create`; `rooms:list` pushed to every client on every change. |
| F3 | Met (tested) | `room:join`, `room:leave`, `player:joined`, `player:left`. |
| F4 | Met (tested) | Host-only `game:start`; server ends the game; room list shows "(in game)". |
| F5 | Met (tested) | Positions relayed at 20 Hz; kill, meeting and vote broadcast. |
| F6 | Met (tested), with one gap | Ranking and winning side in `game:ended`. Gap: scores are only shown on the end screen, not during play, and there is no defined match length, so "the winner" is the winning side of each game plus the top of the running ranking. |
| F7 | Met (tested) | Crash, pulled cable and clean quit all detected; the game continues or ends cleanly. |
| D1 | **Not verified** | No rehearsal recorded in the repo. |
| D2 | **Missing from the repo** | No slides found. |
| D3 | Met | README has per-version commands. Check it once on a clean PC. |
| B1 | **Planned, not demonstrated** | README documents Tailscale. See risk 1 in section 12. |
| T1, T2 | Met (tested) | Non-host start, crewmate kill, out-of-range kill, cooldown kill, dead-player vote, off-map and too-fast moves are all refused. |
| T3, T4 | Met | |
| T5 | Met (code) | `NetHud.jsx`, `netstats-<proto>-<pid>.csv`. HUD not seen running for this document. |
| T6 | Met (code) | 30% per-frame glide toward the last received position. Not seen running for this document. |

---

## 4. Technical stack

| Layer | Technology | Notes |
|---|---|---|
| Server runtime | Node.js 20 or newer (tested here with 24.14; README says tested with 22) | ES modules, zero npm dependencies |
| TCP transport | Node `net` | Port 5000 |
| UDP transport | Node `dgram` (`udp4`) | Port 5001 |
| Shared protocol code | CommonJS files in `shared/` | Imported by both the ESM server and the Electron main process |
| Accounts | Node `crypto` (scrypt, 16-byte salt, 32-byte key, `timingSafeEqual`) | Stored in `backend/data/users.json` (git-ignored, written atomically) |
| Game state | In memory | Rooms and players are lost when the server restarts; accounts persist |
| Client shell | Electron 33 | Main process owns the socket; window 1100 × 850 |
| UI | React 19, CSS Modules, Tailwind CSS 4 (preflight + utilities) | |
| Game rendering | Phaser 3.90 (arcade physics, WebGL), `phaser3-rex-plugins` | Canvas 1024 × 768, scale mode FIT |
| Build | Vite 6, terser | Output in `frontend/dist`, loaded through a local `app://` scheme |
| Test | `tools/smoke-client.cjs` | Ports 5200 and 5201, own temporary accounts file |

### Repository layout

```
shared/
  protocol.cjs        ports, heartbeat, timeout, RTO bounds, unreliable message types
  lineFramer.cjs      TCP framing: one JSON object per line
  reliableUdp.cjs     ReliableChannel: seq, ACK, retransmit, dedupe, ordering, FAST
backend/src/
  main.js             args, transport choice, session <-> player maps, send helpers, stats log
  transport/          tcpServer.js, udpServer.js (same interface)
  events/             roomEvents.js (login, lobby, rooms, disconnections), gameEvents.js (game rules)
  managers/           accounts, players, rooms (state, meetings, win check, public room view)
frontend/electron/
  main.cjs            window, args, app:// scheme, IPC, CSV statistics
  preload.cjs         exposes window.gameNet (the page's only network access)
  tcpClient.cjs, udpClient.cjs   same interface: send, close, status, stats
frontend/src/
  services/net.js     on / off / once / emit / request over window.gameNet
  App.jsx             page state machine, meeting overlay, toasts
  pages/Menu.jsx      login and lobby
  components/         Meeting, MeetingTile, EndGame, RoleIndicator, NetHud, Toast, Button
  game/               Phaser: scenes (WaitingLobby, Game), shaders, vision, imposter helpers
tools/smoke-client.cjs
```

### Commands

| Where | Command |
|---|---|
| Server | `cd backend` then `npm run tcp` or `npm run udp` (add `-- --port <n>`, `-- --loss 0.1` for UDP) |
| Client, first time | `cd frontend`, `npm install`, `npm run build` |
| Client | `npm run tcp -- --server <ip>` or `npm run udp -- --server <ip>` |
| Client options | `--proto tcp\|udp`, `--server <ip>`, `--port <n>`, `--loss <0..0.9>` (UDP only), `--dev` (load from Vite on port 8080) |
| Test | `node tools/smoke-client.cjs --proto tcp`, `--proto udp`, `--proto udp --loss 0.2` |

---

## 5. Architecture

```
Client PC (x3)                                         Server PC
React + Phaser page                                    main.js
   | window.gameNet (Electron IPC, inside the PC)        events/*.js + managers/*.js  (shared by both versions)
Electron main process                                       |
   tcpClient.cjs -> net.Socket   ====== TCP 5000 ======> transport/tcpServer.js
or udpClient.cjs -> dgram socket ====== UDP 5001 ======> transport/udpServer.js
```

- **Why Electron.** A browser page cannot open raw TCP or UDP sockets. Electron's main process is a Node
  program and can. The page runs sandboxed with context isolation and has no network access of its own.
- **Transport contract** (identical for both server transports):
  `on('connect', (sessionId, address))`, `on('message', (sessionId, type, data))`,
  `on('disconnect', (sessionId, reason))`, `send(sessionId, type, data)`, `sessionStats()`.
- **Session.** TCP: one accepted connection (`tcp-1`, `tcp-2`, ...). UDP: one remote `ip:port` that
  completed `HELLO` → `WELCOME` (`udp-1`, ...). The server assigns it.
- **Identity.** `player:register` binds a player id to the session. Later messages carry no player id.
- **Broadcast.** A room broadcast is one send per player. The lobby list goes to every connected session.
- **Fault isolation.** Each handler call is wrapped in `try/catch`; unknown message types are logged and
  ignored; a non-object payload becomes `{}`.
- **Client IPC channels.** Renderer to main: `net:send`, `net:info` (invoke). Main to renderer:
  `net:message`, `net:status`, `net:stats` (every second).
- **Several clients on one PC.** Each Electron instance uses its own `userData` folder
  (`<temp>/among-us-client-<pid>`).

---

## 6. Network protocol

### 6.1 Constants (`shared/protocol.cjs`)

| Constant | Value |
|---|---|
| TCP port / UDP port | 5000 / 5001 |
| Heartbeat interval | 1000 ms (client sends `PING {ts}`, server answers `PONG {ts}`; RTT = now − ts) |
| Silence timeout | 5000 ms, on both sides, in both versions |
| UDP RTO | 2 × smoothed RTT, clamped to 100–1000 ms; 200 ms before the first sample |
| UDP max retries | 25 resends without ACK, then the peer is considered dead |
| Max datagram size | 1200 bytes (a larger one is sent anyway with a warning) |
| Unreliable types (UDP) | `player:move`, `player:moved` |
| TCP client reconnect delay | 2000 ms |
| UDP retransmission tick | 50 ms |

### 6.2 TCP version

- Framing: `{"type":"...","data":{...}}\n`. `LineFramer` buffers until a newline, uses a `StringDecoder`
  for split UTF-8 characters, and discards a line longer than 64 KB.
- `setNoDelay(true)` on both sides (no Nagle delay).
- The client counts as connected after the server's `welcome {sessionId}`, not after the handshake.
- Dead peer: `close`/`error` for a clean exit or crash (immediate); heartbeat timeout for a pulled cable.
- A dead connection is replaced by a new one (new session id).
- Handshake, sequence numbers, ACKs, retransmission and ordering are done by the operating system.

### 6.3 UDP version

One JSON object per datagram, field `t`:

| `t` | Direction | Purpose |
|---|---|---|
| `HELLO` | client → server | Ask for a session; resent every second until answered |
| `WELCOME {sessionId}` | server → client | Session created |
| `PING {ts}` / `PONG {ts}` | client → server / back | Heartbeat and RTT |
| `MSG {seq, type, data}` | both | Reliable game message |
| `ACK {seq}` | both | Acknowledges one `MSG` |
| `FAST {n, type, data}` | both | Unreliable message (positions) |
| `BYE {reason}` | both | Leaving, or "unknown session, send HELLO" |

`ReliableChannel` (one per client on the server, one in each client):

1. Sequence numbers start at 1 for each channel.
2. Every `MSG` is acknowledged, including duplicates.
3. Unacknowledged messages are resent after the RTO. RTT is smoothed as
   `srtt = 0.875·srtt + 0.125·sample` and sampled only on messages sent once (Karn's rule).
4. A sequence number already delivered is acknowledged again and not delivered twice.
5. Out-of-order messages wait until the gap is filled, then are delivered in order.
6. `FAST` packets carry a counter `n`; one older than the last received for the same type and player is dropped.

Session rules: `BYE` removes the session at once; silence for 5 s or the retry limit removes it otherwise;
a packet from an unknown address gets `BYE`, and the client restarts with `HELLO`; a `HELLO` from a known
address starts a fresh session. `--loss p` drops a fraction `p` of datagrams sent and received on the side
where it is set.

### 6.4 Send rates

| Message | Rate |
|---|---|
| `PING` | 1 per second |
| `player:move` while moving | every 50 ms (20 per second) |
| `player:move` while idle | every 500 ms |
| `player:move` on start or stop | immediately |
| Everything else | on events |

### 6.5 Message catalogue (same names in both versions)

Client → server:

| Message | Payload | Result |
|---|---|---|
| `player:register` | `{name, password, color}` | `player:registered {playerId, name, color}` then `rooms:list`; or `player:register:error {message}` |
| `player:unregister` | `{}` | `player:unregistered` |
| `rooms:get` | `{}` | `rooms:list {rooms}` |
| `room:create` | `{roomId}` | `room:joined`, or `room:join:error {message}` |
| `room:join` | `{roomId}` | `room:joined {roomId, room, player}`; others get `player:joined`; or `room:join:error` |
| `room:leave` | `{}` | others get `player:left {playerId, reason}` |
| `room:get` | `{}` | `room:state {room, player}` |
| `game:start` | `{}` | each player privately gets `game:started {roomId, isImposter}` |
| `player:move` | `{x, y, d, moving}` | others get `player:moved {id, roomId, x, y, d, moving}`; a rejected move returns `player:moved {..., corrected: true}` to the sender only |
| `player:kill` | `{playerId}` (the victim) | all get `player:killed {playerId, killerId, x, y, color}` |
| `meeting:start` | `{}` | all get `meeting:started {callerId, durationMs, players}` |
| `meeting:vote` | `{votedForId}` (a player id or `'skip'`) | all get `meeting:voted {callerId}`, later `meeting:ended {results}` |
| `meeting:end` | any | Ignored on purpose |

Server → client, unprompted: `rooms:list`, `player:joined`, `player:left`, `room:host {hostId}`,
`game:ended {roomId, isImposter, imposterId, imposterName, ranking}`, `game:notif {message}` (private refusal).

- `meeting:ended.results` = `{ejectedId, tie, counts, votes}`.
- `ranking` = `[{id, name, color, points}]`, sorted by points, then by name.
- In `game:ended`, `isImposter: true` means the imposter won.
- The public room view is `{id, started, host: {id, name}, players, scores}` and never contains the imposter.

---

## 7. Game rules and server logic

### 7.1 Account and lobby

- Name: trimmed, at most 16 characters, case-insensitive as an account key. Password: 4 to 64 characters.
- A new name creates an account and a player id (`p-` + 16 hex characters). A known name must give the same password.
- An account already bound to another live session is refused.
- Registering again from a session that is in a room removes the player from that room.
- Room code: 1 to 12 letters or digits. The client generates 6 characters from an alphabet without `0 O 1 I`.
- The creator becomes host and joins automatically.
- Join is refused if the room does not exist, has started, is full, or already has that name. If the
  player's color is taken, the server assigns the first free one.
- When the last player leaves, the room is deleted. When the host leaves, the next player becomes host
  and the room is told with `room:host`.

### 7.2 Constants

| Constant | Value | File |
|---|---|---|
| Minimum players to start | 2 | `gameEvents.js` (`MIN_PLAYERS_TO_START`) |
| Maximum players per room | 10 | `roomEvents.js` |
| Kill range | 100 px, measured on the server's positions | `gameEvents.js` |
| Kill cooldown | 10 s, also applied at game start | `gameEvents.js` |
| Meeting duration | 30 s | `gameEvents.js` |
| Emergency meetings | One per player per game | `gameEvents.js` |
| Speed limit | 350 px/s in the lobby, 100 px/s in a game, × 1.15 tolerance + 2 px | `gameEvents.js` |
| Movement time bank | 80 ms after a spawn or kill, capped at 400 ms | `gameEvents.js` |
| Map bounds | Lobby 1232 × 1008, game 1008 × 560, plus an 8 px edge | `gameEvents.js` |
| Spawn | (560, 150) for every player | `rooms.manager.js` |

### 7.3 Game flow

1. **Start.** Host only, room not started, enough players. All players are set alive and placed at spawn.
   The imposter is drawn at random among players who have not yet been imposter in this room; when all
   have been, the history resets. Each player receives their own role privately.
2. **Movement.** The server keeps a position only if its numbers are finite, it lies inside the map, and
   the distance from the last kept position fits the speed limit. Otherwise it is dropped and the sender
   is sent back the position the server holds.
3. **Kill.** Refused unless: game started, sender is the imposter and alive, target is another living
   player, no meeting is active, the cooldown has passed, and the distance is within range. On success the
   victim is marked dead, the killer is moved onto the body, the killer gets 1 point, and all are told.
4. **Meeting.** Refused unless: game started, caller alive, no meeting active, caller has not used their
   meeting this game. The server sends the living players and the duration, and owns the timer.
5. **Vote.** Refused unless: meeting active, voter alive, has not voted, target is alive or `'skip'`.
   The others learn that the player voted, not for whom. The meeting ends when every living player has
   voted or when the timer expires. The single most-voted player is ejected; a tie or all skips ejects
   nobody. All players are placed back at spawn.
6. **Win check**, after each kill, meeting end and departure:
   - no living imposter in the room: the crew wins;
   - no living crewmate: the imposter wins;
   - with 4 or more players only: living imposters ≥ living crewmates means the imposter wins.
7. **End.** Points are awarded, `game:ended` is sent, and the room returns to the waiting state with
   scores kept. A player who leaves the room loses their score in that room.

### 7.4 Scoring

| Event | Points |
|---|---|
| Kill | 1 to the imposter |
| Vote for the imposter | 1 to that crewmate, awarded when the vote is cast |
| Crew wins | 2 to every crewmate still in the room, alive or dead |
| Imposter wins | 3 to the imposter |

### 7.5 Disconnection handling

The same routine runs for a clean quit, a crash and a timeout: unbind the session, remove the player from
the room, discard their vote if a meeting is running, tell the others, move the host role if needed, run
the win check, finish the meeting if the leaver was the last one still to vote, push the room list, and
delete the player. On the client, a lost connection shows a persistent error toast; the transport
reconnects by itself and the page reloads to the menu. The player has to log in again and does not return
to the game in progress.

---

## 8. Client behaviour

### 8.1 Screens

| Page state | What is shown |
|---|---|
| Menu, not logged in | Card with name, password, 12-color picker (optional; random if none), "Register / Log in" |
| Menu, logged in | "Welcome, name!", pushed room list (code, host, player count, "(in game)"), "Create Room", "Back" |
| Waiting | Phaser `WaitingLobby` scene, "Start Game" (host) or "Waiting for Host to Start", "Leave", room code tag |
| Game | Phaser `Game` scene, role banner at start, KILL button (imposter), USE button (near the table), meeting overlay |
| Game end | "Victory" or "Defeat", winning side, imposter's name, ranking table with own row highlighted, "Play again", "Leave" |

A page opened in a normal browser, without Electron, shows a notice to start with `npm run tcp` or `npm run udp`.

### 8.2 Controls

| Input | Action |
|---|---|
| `Z` `Q` `S` `D` | Move up, left, down, right (AZERTY layout) |
| KILL button | Request a kill on the nearest player within 60 px on screen |
| USE button | Request an emergency meeting; visible inside a 50 px zone around (530, 100) |
| Click a tile, then confirm | Vote; "Skip" votes for nobody |
| `F3` | Show or hide the network HUD |

### 8.3 Rendering logic

- The local player moves with arcade physics against the tilemap's `collisions` layer. Diagonal speed is normalised.
- Remote players glide 30% of the remaining distance per frame and snap if more than 200 px away.
- Camera zoom is 1 in the lobby and 3 in the game. Sprites are scaled 0.3 in the lobby and 0.1 in the game.
- In the game, a fog-of-war shader limits vision to a 100 px radius; players and bodies outside it are hidden.
- On a kill: the victim's sprite is destroyed, a 43-frame death animation plays in the victim's color,
  and a body sprite remains.
- During a meeting: physics pause, vision is disabled, movement is blocked.
- A player ejected by vote stays on their own screen at 40% opacity and is removed from the others' screens.
- Phaser and React communicate through `EventBus` (`current-scene-ready`, `start-game`,
  `meeting:started`, `meeting:ended`, `game:ended`).
- Server refusals (`game:notif`) appear as toasts.

### 8.4 Network HUD and statistics

```
UDP → 192.168.1.20:5001 · connected · RTT 3 ms · ↑23 ↓41 msg/s · retrans 3 · dup 1 · out-of-order 0
TCP → 192.168.1.20:5000 · connected · RTT 2 ms · ↑22 ↓40 msg/s · reliability: OS TCP stack
```

The window title shows `Among Us Arena — <PROTO> → <server>:<port> — <state>`. CSV columns: `time, proto,
state, rttMs, msgsOut, msgsIn, bytesOut, bytesIn, retransmits, duplicatesIgnored, outOfOrderBuffered,
staleDropped, simulatedLoss` (the last five are empty for TCP). The server prints per-session statistics
every 10 s.

---

## 9. Visual identity

The look comes from the open-source Among Us web clone this project started from. The sprites, map art
and font reproduce the original game's style, which is acceptable for coursework but would need
replacing before any public release.

### 9.1 Color

| Role | Value |
|---|---|
| Page background | `#000000` |
| Body text | `rgba(255, 255, 255, 0.87)` |
| Primary accent (menu buttons, input borders and focus, room code, welcome text, selected color swatch) | `#4ecca3` |
| Danger accent (Leave button, "Clear Selection" button) | `#e94560` |
| Highlight (victory title, meeting timer, own ranking row) | `#ffd700` |
| Legacy button hover | `#0ec3c9` |
| Room tag background | `#16213e` |
| Status green / red | `#4caf50` / `#f44336` |
| Victory screen | Radial gradient, turquoise `rgba(64, 224, 208, 0.9)` to teal `rgb(0, 128, 128)` |
| Defeat screen | Radial gradient, orange-red `rgba(255, 69, 0, 0.9)` to dark red `rgb(139, 0, 0)` |
| HUD | `#7CFC9A` on `rgba(0, 0, 0, 0.65)`; `#ff7070` when not connected |
| Panels | Translucent white (6% to 18%) over the background image, 10 to 20 px radius |

Player colors (same list on server and client):

| Name | Hex | Name | Hex |
|---|---|---|---|
| Red | `#c51111` | Black | `#3f474e` |
| Blue | `#132ed1` | White | `#d6e0f0` |
| Green | `#117f2d` | Purple | `#6b2fbc` |
| Pink | `#ed54ba` | Brown | `#71491e` |
| Orange | `#ef7d0d` | Cyan | `#38fedc` |
| Yellow | `#f5f557` | Lime | `#50ef39` |

A player's color is applied to the grey base sprite by a color-swap shader.

### 9.2 Typography

| Use | Font |
|---|---|
| Buttons | `amongus` (bundled, `public/assets/fonts/amongus.ttf`), fallback Arial |
| Menu card | Segoe UI, Arial |
| End screen title | Arial Black, 6rem |
| Meeting title, role banner | "CaskaydiaMono NF Light", which is not bundled, so it falls back to the system monospace font |
| HUD | Consolas, Courier New, 12 px |
| Default | Arial, Helvetica |

### 9.3 Assets (`frontend/public/assets`)

| Asset | Files |
|---|---|
| Menu background | `background.jpg` |
| Maps | `map/Lobby.png` + `lobby.json` (154 × 126 tiles of 8 px), `map/skled.png` + `map.json` (126 × 70 tiles), tileset `red.png` |
| Character | `walk/texture.png` + `.json` (12 frames at 12 fps), `sprites/Base/idle.png` |
| Death | `death/texture.png` + `.json` (frames 0 to 42 at 20 fps), `sprites/Base/Dead0042.png` |
| Buttons | `icons/kill_icon.png`, `icons/useIcon.png` |
| Meeting | `meeting/screen.png` (tablet frame), `pfp.png`, `ivoted.png`, `confirm.png`, `cancel.png` |
| Present but unused | `icons/reportBtn.png`, `startBtn.png`, `quitbtn.png`, `meeting/bodyReported.png`, `meetingCalled.png`, `chat*.png`, `sh/*`, `sprites/Base/ghost`, `hats`, `imposterkills`, `walk.zip` |

### 9.4 Motion

Role banner at game start; end-screen title slides down, a crewmate SVG jumps on victory and floats on
defeat, the ranking fades in after about 1.2 s; toasts slide in at the bottom-left.

---

## 10. Testing

`tools/smoke-client.cjs` starts the real server and covers, in order: a client started before the server;
registration, wrong password, login with the same id; room creation, color reassignment, join, pushed room
list, room state; a full game (non-host start refused, private roles, 20 Hz relay, invalid moves dropped,
kill refused by cooldown, role and range, kill accepted, body color, dead-player restrictions, hidden
votes, early meeting end, ejection, crew win, ranking); play again with role rotation; a killed client
process; a pulled cable through a relay that drops everything; automatic reconnection; a clean quit.

| Run on 12 Nov 2026 | Result | Notes from the run |
|---|---|---|
| `--proto tcp` | 38 of 38 | Crash seen in 0.0 s (connection reset); pulled cable seen in 5.2 s; reconnected in 1.9 s |
| `--proto udp` | 38 of 38 | Reconnected in under 1 s; clean quit by `BYE` |
| `--proto udp --loss 0.2` | 38 of 38 | Per client: 6 to 10 retransmits, 18 to 29 duplicates ignored, 4 to 8 out-of-order; the `BYE` was lost and the quit was detected in 3.2 s by the retry limit |

The README still says "ALL 34 CHECKS PASSED"; the test now has 38.

Not covered by any automated test: the Electron shell, the React screens, the Phaser scenes, four separate
machines, and any network other than loopback.

---

## 11. Work remaining before the demo

Ordered by how much each affects the grade.

| # | Task | Requirement |
|---|---|---|
| 1 | Rehearse both versions on the four real machines, with the firewall rules, and record a backup video. | A3, D1 |
| 2 | Write the 5 to 7 slides. Material exists in README section 3 and in the CSV files produced during the rehearsal. | A7, D2 |
| 3 | Collect comparison numbers on the real network: RTT, messages per second, bytes, UDP retransmits, detection times for crash, pulled cable and clean quit. Run UDP once with `--loss 0.1`. | A7, D2 |
| 4 | Decide and rehearse the cross-network setup. | B1 |
| 5 | Launch the built client once and walk every screen, since the UI was not exercised for this document. | D1 |
| 6 | Push the branch (one commit is not on `origin`), and decide what to do with the uncommitted blank-line change in `HANDOFF.md`. | D3 |
| 7 | Update "34 checks" to 38 in the README. | D3 |

---

## 12. Known gaps, risks and inconsistencies

### Risks for the demo

1. **Tailscale and the UDP-only claim.** When two devices cannot connect directly, Tailscale relays
   through its DERP servers, which carries the traffic over TCP. The game still sends UDP datagrams into
   the tunnel, but the path on the wire would not be UDP. The bonus only asks for one version, so the
   safe choice is to present the cross-network bonus with the TCP version, or to confirm a direct path
   with `tailscale ping` before showing UDP. A server with a public IP avoids the question.
2. **Campus Wi-Fi** often blocks traffic between devices. Bring a router or a hotspot.
3. **Password in clear text.** T3 makes every message readable in a capture, including
   `player:register`. Use throwaway passwords in the demo and be ready to explain the trade-off.

### Functional gaps (from reading the code)

4. `MIN_PLAYERS_TO_START` is 2. The demo should use 3; the comment in the code says so. The room limit is 10, not 3.
5. No live scoreboard during play; scores appear only on the end screen.
6. No fixed match length. "Play again" repeats indefinitely and the ranking is a running total.
7. The kill button lights up within 60 px, while the server accepts up to 100 px.
8. No on-screen kill cooldown and no indication that a player's emergency meeting is used up; the player learns by a refusal toast.
9. A killed player's own sprite is destroyed, so they cannot move or spectate as a ghost. The ghost sprites exist but are unused. Only a player ejected by vote keeps a faded sprite.
10. The detailed vote results sent in `meeting:ended` are not displayed; only the ejection toast is.
11. No rejoining a game in progress after a connection loss.
12. No tasks and no body reporting. These were optional ideas from the earlier plan, not brief requirements.
13. A UDP session is tied to `ip:port`. If a NAT changes the client's port, the server sees an unknown address and the client starts a new session.
14. A datagram above 1200 bytes is only warned about. `rooms:list` grows with the number of rooms and players, so many rooms could exceed it. Not a concern with one room of three.

### Inconsistencies and leftovers

15. Naming: the README and window title say "Among Us Arena", the menu card says "Among Us", `index.html` says "Among US", `frontend/package.json` is still named `template-react`.
16. The role banner reads "Youre the Imposter" / "Youre a Crewmate" (missing apostrophe).
17. `HANDOFF.md` lists backend, client and test work as "still to do"; all of it is done on this branch. `Among_Us_Arena_Requirements_Repo_Audit_7-Day_Plan.md` and `misc/*.mermaid` describe the old Socket.IO design. The audit plan recommended a cloud server for the bonus, while the README documents Tailscale.
18. Unused code and files: `scenes/Boot.js`, `scenes/MainMenu.js`, the `M` key binding, `frontend/public/kill`, `walk.zip`, duplicate Tailwind and PostCSS config files (`.js` and `.cjs`), `backend/tsconfig.json`.
19. A new color-swap shader pipeline is created for every sprite, including each death animation.
20. Node version: the README says tested with 22; the run for this document used 24.14.

---

## 13. Context block for future prompts

Paste this when asking for changes.

```
Project: Among Us Arena, CS411 Project 2. Branch israa/local-implementation.
One server + three clients on four PCs. Two versions of the same game: TCP only (Node net, port 5000)
and UDP only (Node dgram, port 5001). No networking libraries, no HTTP, no WebSocket.

Rules that must hold after any change:
- Game rules live only in backend/src/events and backend/src/managers and are shared by both versions.
  A feature added for one transport must work on the other with no transport-specific game code.
- Only backend/src/transport/* and frontend/electron/{tcp,udp}Client.cjs touch sockets. Both server
  transports keep the same interface: on(connect|message|disconnect), send(sessionId, type, data).
- The server is authoritative. Clients send requests; the server validates against its own state.
- Identity comes from the session. Never read a player id from a payload to decide who is acting.
- Never send the imposter's identity to anyone but privately in game:started and to all in game:ended.
- Wire format is JSON: TCP one object per line; UDP one object per datagram, under 1200 bytes.
- In UDP, only player:move and player:moved are unreliable (FAST). Everything else is reliable (MSG/ACK).
- The page has no network access; it uses services/net.js (on/off/once/emit/request) over window.gameNet.
- Constants shared by both sides go in shared/protocol.cjs.
- Phaser scenes clean up network listeners in cleanup(), registered on the 'shutdown' and 'destroy' events.
- After any change run: node tools/smoke-client.cjs --proto tcp, then --proto udp, then --proto udp --loss 0.2.
  All three must report every check passed. Add a check for each new server rule.
- After any change in frontend/src, run npm run build in frontend before launching the client.
```
