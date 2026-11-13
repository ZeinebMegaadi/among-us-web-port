# Among Us Arena: slide-by-slide walkthrough

A guide to the deck in [`dashboard/index.html`](../dashboard/index.html), for the four presenters.
For every slide it covers: what is on screen, what each key press reveals, which grading requirement
the slide answers, a sample pitch you can say out loud, the facts behind it (with the file in the code),
and the questions the jury is likely to ask.

The pitches are written to be spoken at a normal pace (about 140 words per minute). Learn the ideas,
not the words. Every number in this guide was checked against the code and the 13 Nov smoke test.

**Contents**

- [0. Running the deck](#0-running-the-deck)
- [Speakers and timing](#speakers-and-timing)
- [Slide 1: Title (arcade cabinet)](#slide-1-title-arcade-cabinet)
- [Slide 2: Agenda](#slide-2-agenda)
- [Slide 3: The game, "Competitive by design"](#slide-3-the-game-competitive-by-design)
- [Slide 4: Socket architecture](#slide-4-socket-architecture)
- [Slide 5: The TCP version](#slide-5-the-tcp-version)
- [Slide 6: The UDP version](#slide-6-the-udp-version)
- [Slide 7: Live demonstration](#slide-7-live-demonstration)
- [Slide 8: Simultaneous players and disconnections](#slide-8-simultaneous-players-and-disconnections)
- [Slide 9: Edge cases and inconsistencies](#slide-9-edge-cases-and-inconsistencies)
- [Slide 10: TCP vs UDP, measured](#slide-10-tcp-vs-udp-measured)
- [Slide 11: Challenges and optimizations](#slide-11-challenges-and-optimizations)
- [Slide 12: Backup, network weaknesses](#slide-12-backup-network-weaknesses-qa-only)
- [Slide 13: Bonus (Tailscale) and closing line](#slide-13-bonus-tailscale-and-closing-line)
- [Slide 14: Thank you](#slide-14-thank-you)
- [Things to fix or know before presenting](#things-to-fix-or-know-before-presenting)
- [Numbers cheat sheet](#numbers-cheat-sheet)

---

## 0. Running the deck

Open `dashboard/index.html` in a browser (Chrome or Edge), press **F** for full screen. The deck is
designed at 1920×1080 and scales to any screen. It works offline: no CDN, fonts are in `dashboard/fonts/`.

| Key | Action |
|---|---|
| `→` `Space` `Enter` `PageDown` | Next build step, then next slide |
| `←` `Backspace` `PageUp` | Previous step / slide |
| `1`…`9`, `0` | Jump to slide 1…9, `0` = slide 10 |
| `Home` / `End` | First / last slide |
| `N` | Show or hide the speaker notes (the short script stored in each slide) |
| `L` | Turn simulated packet loss on/off in the TCP/UDP race animations |
| `P` | Pause every animation (also a button in the bottom bar) |
| `F` | Full screen |

Useful details:

- **Build steps.** Most slides reveal content step by step. The bottom bar (HUD) shows
  `slide n/14 · topic · step s/total`, so you always know how many presses are left.
- **Deep links.** The URL keeps the position as `#slide.step`, e.g. `index.html#6.7` opens the UDP slide
  on its race step. Handy to jump back during Q&A.
- **Editable fields.** Team names, the RTT boxes, the bonus status and the network labels are
  click-to-edit. Changes are saved in the browser (localStorage) and copied to every slide that shows the
  same field. Press `Enter` or `Esc` to finish editing.
- **`?still`** (`index.html?still`) freezes every animation on its final frame: use it for screenshots
  or printing. Reduced-motion settings in Windows have the same effect.

---

## Speakers and timing

The agenda slide splits the talk into 4 parts. A suggested split (swap names freely, but keep one
speaker per slide so each person owns a topic and can answer deep questions on it):

| # | Slide | Speaker (suggested) | Time |
|---|---|---|---|
| 1 | Title | Israa | 0:30 |
| 2 | Agenda | Israa | 0:20 |
| 3 | The game | Israa | 1:15 |
| 4 | Socket architecture | Israa | 1:30 |
| 5 | TCP version | Zeineb | 2:00 |
| 6 | UDP version | Ilyes | 2:15 |
| 7 | Live demo | Nabila narrates, everyone plays | 6:00 |
| 8 | Simultaneous players and disconnections | Zeineb | 1:45 |
| 9 | Edge cases | Nabila | 1:15 |
| 10 | TCP vs UDP, measured | Ilyes | 2:00 |
| 11 | Challenges and optimizations | Israa | 1:30 |
| 12 | Backup: network weaknesses | (skip, Q&A only) | 0:00 |
| 13 | Bonus + closing line | Israa | 1:15 |
| 14 | Thank you | Israa | 0:15 |
| | **Total** | | **≈ 21:50**, or ≈ 17 min with a 4-minute demo |

**Hand-off lines** (say them out loud; they make the talk feel like one story):

- Israa → "Zeineb will show what TCP gave us for free, and what it didn't."
- Zeineb → "Ilyes, UDP gives us none of that."
- Ilyes → "Enough theory. Nabila will drive the live game."
- Nabila → "Zeineb, what exactly happened when we stopped that player?"
- Zeineb → "Nabila, what else could have gone wrong?"
- Nabila → "Ilyes, so which protocol is better?"
- Ilyes → "Israa, what did it cost us to get here?"

---

## Slide 1: Title (arcade cabinet)

**HUD:** `TCP :5000 · UDP :5001 · Node net + dgram only` · **Steps:** none · **Speaker:** Israa · **0:30**

### On screen

A 3D arcade cabinet. The marquee reads **TCP VS UDP** in dot-matrix letters, TCP in the TCP color and
UDP in the UDP color (these two colors are used for the two protocols on every slide that follows). The
screen reads **AMONG US ARENA · ONE GAME · TWO TRANSPORTS**. Under it: *"Raw sockets · 0 networking
libraries · 4 players"*. The control panel has one joystick per protocol, the apron shows
`P1 · TCP :5000` and `UDP :5001 · P2`, and the four player slots hold the team names. Crewmates float
around the cabinet; the course name is in the top strip.

### What it establishes

- The thesis of the whole talk: **one game, two transports**.
- The constraint the jury cares about most: real sockets, **only Node's `net` (TCP) and `dgram` (UDP)**,
  no networking library.
- The ports to remember: TCP on **5000**, UDP on **5001**.

### Sample pitch

> Good morning. We are Israa, Zeineb, Ilyes and Nabila, and this is Among Us Arena.
>
> It's a competitive game for four players, and we built it twice: once where every byte travels over
> TCP, and once where every byte travels over UDP. The rules, the screens and the messages are
> identical; only the transport changes. We used no networking library: no Socket.IO, no WebSocket,
> no HTTP between computers. Only Node's two built-in socket modules: `net` for TCP and `dgram` for UDP.
>
> Today we'll show you what each protocol gave us for free, what we had to build ourselves, and we'll
> prove it with a live game and with numbers we measured.

### Tips

- Don't explain the cabinet. Let it be the hook for three seconds, then talk.
- If names are wrong on the slots, click them and retype; they update on slides 7 and 14 too.

---

## Slide 2: Agenda

**HUD:** `outline · 4 parts · 4 speakers` · **Steps:** none · **Speaker:** Israa · **0:20**

### On screen

Four glass cards:

| Part 1 · Context | Part 2 · Two versions | Part 3 · Proof | Part 4 · Analysis |
|---|---|---|---|
| 1 The game | 3 TCP version | 5 Live demo | 7 Edge cases |
| 2 Architecture | 4 UDP version | 6 Players & disconnections | 8 TCP vs UDP |
| | | | 9 Challenges |

The numbers 1–9 match the small kicker label at the top of each following slide ("3 · The TCP version").

### What it establishes

The logic of the talk: **explain → show → measure → reflect**. The jury learns enough to read the demo,
watches it, and then gets the analysis while the demo is still fresh.

### Sample pitch

> Four parts. First, the context: the game, and how the computers are connected. Second, the two
> versions: what TCP did for us, and what we had to rebuild on top of UDP. Third, the proof: a live game
> on four computers, then a close look at what happens when many players act at once and when one
> disappears. Last, the analysis: the edge cases we handle, a measured comparison of the two protocols,
> and what was hard.

### Tips

Keep it under 20 seconds. Don't read the cards.

---

## Slide 3: The game, "Competitive by design"

**HUD:** `4 players · 1 imposter vs 3 crewmates · personal scores` · **Steps:** 1 · **Speaker:** Israa · **1:15**

### On screen

- **Rules card.** The cast: one red **Imposter** ("picked secretly by the server") **vs** three
  **Crewmates**. Two win conditions: *Crew wins: vote the imposter out* and *Imposter wins: kill until
  1 vs 1*.
- **Personal score card.** Kill **+1** · Vote for the imposter **+1** · Crew wins **+2** · Imposter wins
  **+3**. Footer: *End screen: winner + ranking*.
- **Step 1:** a strip with the **7 required features, identical in TCP and UDP**: Login · Rooms ·
  Join & leave · Start & end · Real-time actions · Scores · Disconnection.

### What it answers in the brief

"A competitive game, not cooperative" and "scores, ranking, winner". The jury must understand *why there
is a winner* before seeing the demo. The feature strip is a checklist the jury can tick.

### The facts behind it (from the code)

- The imposter is chosen by the server and sent **only to that player** (private message). The public
  room data never contains the imposter's id ([rooms.manager.js](../backend/src/managers/rooms.manager.js)).
- Win check, [`checkWin()`](../backend/src/managers/rooms.manager.js): imposter gone (voted out or left) →
  crew wins; all crewmates dead → imposter wins; with **4 or more players**, imposter wins as soon as
  alive imposters ≥ alive crewmates, i.e. **1 vs 1**. With 3 players that parity rule is off (it would end
  the game after the first kill), so the imposter must kill both.
- Kill: range **100 px**, cooldown **10 s**. Meeting: **30 s**, each player can call one per game.
- Points ([gameEvents.js](../backend/src/events/gameEvents.js), `POINTS`): `KILL 1`, `CORRECT_VOTE 1`
  (a crewmate who voted for the imposter), `CREW_WIN 2` to every crewmate alive or dead,
  `IMPOSTER_WIN 3`.
- "Play again" returns to the waiting room **with scores kept**, so the ranking builds over several games.
- Minimum to start is **2** players in the code (`MIN_PLAYERS_TO_START = 2`, handy for testing);
  the demo plays with 4.

### Sample pitch

> First, the game, because it decides what the network has to carry.
>
> Four players. When the game starts, the server secretly picks one imposter; the other three are
> crewmates. Only the imposter is told, in a private message. The imposter can kill a crewmate who is
> close enough, once every ten seconds. Anyone can call an emergency meeting to vote someone out.
> The crew wins by voting the imposter out; the imposter wins by killing until it's one against one.
>
> It's competitive, not cooperative: each player earns personal points. A kill is one point, voting for
> the actual imposter is one point, and the winning side gets a bonus: two for each crewmate, three for
> the imposter. The end screen shows the winner and a ranking, and if you play again, the scores carry
> over.
>
> *[step]* And here are the seven features the brief requires. Both versions have all seven, with
> exactly the same rules and the same messages.

### Likely questions

- *"Why is the imposter win 3 and not 2?"* One player against three: harder role, bigger reward.
- *"Can a dead player vote?"* No: dead players can't vote and can't call meetings.

---

## Slide 4: Socket architecture

**HUD:** `one game · transport swapped with --proto tcp|udp` · **Steps:** 1 · **Speaker:** Israa · **1:30**

### On screen

Three columns:

1. **Client computer ×4.** Top layer: *Game UI, browser tab · React + Phaser*. A dashed link labelled
   *loopback · stays on this PC*. Bottom layer: *Local agent, Node.js · `web/agent.cjs`*, which holds two
   socket chips: `net.Socket` (TCP color) and `dgram.Socket` (UDP color).
2. **The wire.** At step 0: *TCP :5000*, a solid pipe with a crewmate carrying
   `{"type":"room:join"}\n`, "byte stream · one connection per client". **Step 1** swaps it for
   *UDP :5001*, a dashed pipe carrying `{"t":"MSG","seq":7}`, "datagrams · no connection".
3. **Server computer + client 4.** *Game rules: same code for TCP and UDP · the server decides*, the
   4-function interface, and two "cartridges": `tcpServer.js` (net) and `udpServer.js` (dgram).

```
transport.on('connect')
transport.on('message')
transport.on('disconnect')
transport.send(sessionId, type, data)
```

Bottom callouts: *"Browsers can't open raw sockets, so a small local Node agent does it."* then
(step 1) *"The game rules never mention net or dgram. Clients ask; the server decides."*

### What it answers in the brief

"Client-server, 1 server + clients", "real network sockets", "two versions, same game, only the
transport changes", "socket architecture of each version".

### The facts behind it

- `npm run tcp` / `npm run udp` start the **web version**: the browser tab plus a local Node agent
  ([frontend/web/agent.cjs](../frontend/web/agent.cjs)) that owns the real socket. The tab talks to the
  agent over **127.0.0.1** only: that hop never touches the network.
- An Electron desktop build exists too (`npm run desktop:tcp` / `desktop:udp`), where Electron's main
  process owns the socket (`frontend/electron/tcpClient.cjs`, `udpClient.cjs`). Same idea, no browser.
- Server: `--proto tcp|udp` picks [tcpServer.js](../backend/src/transport/tcpServer.js) or
  [udpServer.js](../backend/src/transport/udpServer.js). Everything in `backend/src/events/` and
  `managers/` is shared and only uses the four functions.
- **Client 4 runs on the server computer**: 4 players on 4 computers, one of which also hosts the server.
- The server is **authoritative**: the client sends a request (`player:kill`), the server checks it
  against its own state and broadcasts the result (`player:killed`).

### Sample pitch

> Now, how the computers are connected.
>
> The game runs in a browser tab, with React for the menus and Phaser for the map. But a web page is not
> allowed to open a raw TCP or UDP socket: the browser forbids it. So on each computer we run a small
> Node program, the local agent, and that is what owns the real socket. The tab talks to its agent over
> loopback, inside the same computer, so it never appears on the network. Between computers, there is
> only our own TCP, or our own UDP.
>
> *[pointing at the wire]* In the TCP version, each client opens one connection to port 5000 and sends a
> stream of bytes: one JSON message per line. *[step]* In the UDP version, there is no connection:
> each message is a separate datagram to port 5001, and we add our own header, like this sequence
> number.
>
> On the server, the TCP file and the UDP file offer exactly the same four functions: connect, message,
> disconnect and send. The game rules only use those four, and never mention `net` or `dgram`. So
> switching protocol means plugging in the other cartridge, and that's how we guarantee the two
> versions have identical rules.
>
> Last point: the server decides everything. A client never says "I killed Bob"; it asks "I want to
> kill Bob", and the server checks the role, the distance and the cooldown with its own data.
>
> Zeineb will show what TCP gave us for free, and what it didn't.

### Likely questions

- *"The browser talks HTTP to the agent. Isn't that TCP in your UDP version?"* That hop is loopback
  inside one computer, the same role as Electron's internal messaging. It never touches the network;
  Wireshark on the Wi-Fi shows no TCP from the game. The Electron build has no HTTP at all.
- *"Why not WebSocket or WebRTC?"* WebSocket runs on TCP and would hide it; WebRTC adds DTLS and SCTP.
  The point was raw `net` and `dgram`.

---

## Slide 5: The TCP version

**HUD:** `TCP → :5000 · connected · reliability: OS TCP stack` · **Steps:** 5 · **Speaker:** Zeineb · **2:00**

### On screen

Title: **"TCP: a reliable stream… of bytes"**. Lead line: *Server: one socket listens on `:5000`, then
one socket per player. That socket is the player's session.*

- **Left card, "The OS does it"** (inside the kernel, invisible to our code): 3-way handshake
  `SYN · SYN-ACK · ACK`, sequence numbers, ACKs, retransmission, in-order delivery, `FIN` / `RST` on close.
- **Right, "We had to build"**, four tiles, one per step:

| Step | Tile | What it shows |
|---|---|---|
| 1 | **Framing** | Three raw chunks `{"type":"ro` · `oms:get"}\n{"ty` · `pe":"PING"}\n` turn into two clean messages. "TCP sends bytes, not messages. Our rule: one message per line." |
| 2 | **No Nagle delay** | `socket.setNoDelay(true)`. Default: `m1 m2 m3` wait and leave as one segment. Ours: each leaves at once. |
| 3 | **Heartbeat** | `PING` ↔ `PONG`, a 1 s … 5 s timeline → *disconnected*. "A pulled cable sends nothing. 5 s of silence = player gone." |
| 4 | **Reconnect** | `ECONNREFUSED → retry in 2 s`; `tcp-3` (dead) → new SYN → welcome → `tcp-4`. "A dead connection can't be reused: open a new one." |

- **Step 5** replaces the whole layout with the **head-of-line blocking race**: an animated track where
  positions `p1, p2, …` travel to "player 2's screen". One packet is "ejected" (lost); every newer packet
  queues at the door until the retransmission arrives; the status turns red: *"frozen · waiting for pN ·
  stalled x s"*. Footer: *"TCP must deliver the old position first, even if it's already outdated."*
  Press **L** to turn the loss off and show the smooth case.

### What it answers in the brief

"Socket architecture of the TCP version", "understanding of TCP", "differences between the protocols".

### The facts behind it

- Server: `net.createServer` on `0.0.0.0:5000`. Each accepted connection is a session (`tcp-1`,
  `tcp-2`, …). The first thing the server sends is `{"type":"welcome","data":{"sessionId":"tcp-3"}}`.
- Framing: [shared/lineFramer.cjs](../shared/lineFramer.cjs): newline-delimited JSON, a `StringDecoder`
  so a UTF-8 character split across two chunks is not corrupted, and a size guard against a line that
  never ends.
- Heartbeat (both versions, [shared/protocol.cjs](../shared/protocol.cjs)): `HEARTBEAT_INTERVAL_MS 1000`,
  `TIMEOUT_MS 5000`. TCP keep-alive would take about 2 hours by default.
- Reconnect: the client retries every 2 s; each new connection gets a **new** session id.

### Sample pitch

> In the TCP version, the server opens one listening socket on port 5000. Each client that completes the
> three-way handshake gets its own dedicated socket, and that socket *is* the player's session.
>
> The operating system does the hard work for us: the handshake, sequence numbers, acknowledgements,
> retransmission, putting bytes back in order, and FIN or RST when a connection closes. All of that
> happens in the kernel. Our code never sees a lost packet.
>
> But four things were still our job.
>
> *[step 1]* One: framing. TCP is a stream of bytes, not of messages. One read can give you half a
> message, or two glued together, like here. So our rule is one JSON message per line, and we cut the
> stream at each newline.
>
> *[step 2]* Two: Nagle's algorithm. By default TCP holds small writes back to group them into one
> segment. For a game sending small messages twenty times a second, that's added delay, so we turn it
> off with `setNoDelay`.
>
> *[step 3]* Three: liveness. Reliable doesn't mean you know the other side is still there. If a cable
> is pulled, nothing at all arrives, and TCP's own keep-alive would take about two hours to notice. So
> both sides send a ping every second, and five seconds of silence means the player is gone.
>
> *[step 4]* Four: a dead TCP connection can't be revived. The client opens a brand-new connection every
> two seconds until it works, and gets a new session.
>
> *[step 5]* And here's the price of reliability. Positions stream to player 2's screen. When one packet
> is lost, TCP must deliver it before anything newer, so every newer position waits behind it until the
> retransmission arrives, and the player freezes. That's head-of-line blocking. The irony is that the
> newer position already made the lost one useless, but TCP doesn't know that.
>
> Ilyes, UDP gives us none of this.

### Likely questions

- *"Why a heartbeat if TCP is reliable?"* Reliable delivery is not liveness. A pulled cable sends no FIN
  and no RST; only silence.
- *"Why JSON and not binary?"* Readable in Wireshark for the demo and grading. Cost: bigger messages,
  shown on slide 10.
- *"Can you avoid head-of-line blocking in TCP?"* Not inside one connection. We reduced its impact
  (20 Hz updates, receivers glide), but only UDP removes it.

---

## Slide 6: The UDP version

**HUD:** `UDP → :5001 · connected · seq + ACK + RTO are ours` · **Steps:** 7 · **Speaker:** Ilyes · **2:15**

### On screen

Title: **"UDP: nothing is promised. So we built it."** Lead: *Server: one socket on `:5001` for everyone.
A player = an address that said HELLO, plus a secret token.*

- **Step 0: raw UDP.** Three animated cards: **Lost** (1, 2, 3 → one vanishes), **Duplicated**
  (1, 2, 2), **Reordered** (2, 1, 3). Line: *"No connection. No delivery guarantee. No order. No goodbye."*
- **Steps 1–6: six tiles, our reliability layer**, one per step:

| Step | Tile | Wire example / rule |
|---|---|---|
| 1 | **Handshake + token** | `{"t":"HELLO"}` → `{"t":"WELCOME","tok":"9f2c…"}`. Say HELLO until the server answers; the token proves who you are. |
| 2 | **Seq + ACK** | `{"t":"MSG","seq":7,"type":…}` → `{"t":"ACK","seq":7}`. Each important message is numbered and confirmed. |
| 3 | **Retransmit** | `wait = 2 × round trip · 100–1000 ms`. No confirmation in time → send it again. |
| 4 | **Dedupe** | `seen it already → confirm, ignore`. A message is never used twice. |
| 5 | **Order** | `seq 8 waits for seq 7`. Early messages wait for the missing one. |
| 6 | **Give up** | `25 resends (≈ 2.6 s) or 5 s of silence`. Then the player is gone. |

- **Step 7: two lanes + two races.** *Reliable lane `MSG`*: login · join · start · kill · vote · end,
  "must arrive, once, in order". *Fast lane `FAST`*: positions only, 20 per second,
  `{"t":"FAST","n":345,"type":"player:move",…}`, "never resent; an old position is just dropped".
  Below, the TCP race and the UDP race run **side by side with the same loss**: TCP freezes, UDP keeps
  moving and only counts "N lost". Footer: *"Same loss on both. TCP freezes; UDP shows the next position
  50 ms later."* **L** toggles loss.

### What it answers in the brief

"The UDP version uses no TCP at all and implements its own reliability and disconnection detection."
This is the slide that proves you understand what TCP actually does.

### The facts behind it

- All of it lives in **one class used by both server and client**:
  [`ReliableChannel` in shared/reliableUdp.cjs](../shared/reliableUdp.cjs).
- **Sessions:** a datagram only says who sent it (`rinfo.address:rinfo.port`). A session is an `ip:port`
  that completed HELLO → WELCOME. The client resends HELLO every second until WELCOME arrives. Every later
  datagram carries the random token; a datagram with the wrong token is dropped and **does not count as a
  heartbeat**.
- **RTO:** `rto() = clamp(2 × SRTT, 100 ms, 1000 ms)`, 200 ms before the first measurement. RTT is only
  measured on messages sent once (**Karn's rule**: an ACK for a resent message is ambiguous).
  **There is no exponential backoff**: each resend waits the same RTO. Say "fixed, adaptive RTO", never
  "doubles each time".
- **ACK a duplicate again:** if the receiver sees an old seq, its ACK was probably lost, so it ACKs again
  but does not deliver the message a second time.
- **Give up:** `MAX_RETRIES 25`. On a LAN the RTO sits at its 100 ms floor, so 25 resends take about
  2.6 s: that detector usually fires **before** the 5 s silence timeout when a reliable message is pending.
- **FAST lane:** each position has a counter `n`; anything with `n` ≤ the last one seen from that player
  is dropped as stale. Datagrams are kept under **1200 bytes** (`MAX_DATAGRAM_BYTES`) so IP never
  fragments them.

### Sample pitch

> *[step 0]* UDP promises nothing. Each send is an independent datagram: it can be lost, duplicated or
> arrive out of order, there is no connection, and when a player disappears, nobody tells you.
>
> *[step 1]* So first we built sessions. The server has one single socket for all players, and a datagram
> only tells us the sender's IP and port. The client says HELLO every second until the server answers
> WELCOME with a session id and a random token. Every later datagram must carry that token, so faking
> someone's address isn't enough to play as them.
>
> *[step 2]* Then reliability, in one file shared by both sides. Every important message gets a sequence
> number, and the receiver confirms it with an ACK.
>
> *[step 3]* If the ACK doesn't come back in time, we resend. How long is "in time"? It adapts: twice the
> measured round-trip time, between 100 milliseconds and one second. And like TCP, we only measure the
> round trip on messages sent once. That's Karn's rule: if you resent it, you can't tell which copy the
> ACK is for.
>
> *[step 4]* If a message arrives twice, it means our ACK got lost, so we ACK it again, but never deliver
> it twice. *[step 5]* If message 8 arrives before 7, it waits in a buffer until 7 shows up. So the game
> sees every event exactly once and in order, just like TCP.
>
> *[step 6]* And we need our own disconnection detection: 25 resends without an answer, about 2.6 seconds
> on a LAN, or 5 seconds of total silence, whichever comes first, and the player is gone.
>
> *[step 7]* Now the deliberate choice. Positions don't go through any of that. They travel on a separate
> fast lane, twenty times per second, and are never resent. If one is lost, the next one replaces it 50
> milliseconds later, so resending it would only deliver the past. Look at the two races, same loss on
> both: TCP freezes waiting for the old packet; UDP just shows the next position. Events are reliable,
> positions are fast.
>
> Enough theory: Nabila will drive the live game.

### Likely questions

- *"What if an ACK is lost?"* The sender resends after the RTO; the receiver sees an old seq, ACKs again,
  doesn't deliver twice.
- *"Why 2 × SRTT and not TCP's SRTT + 4·RTTVAR?"* Simpler, and enough on a LAN with the 100–1000 ms clamp.
  TCP's formula and exponential backoff are the next improvement.
- *"Is there head-of-line blocking in your UDP version?"* Only inside the reliable lane (events wait for a
  missing event). Positions bypass it.
- *"Congestion control?"* None beyond low fixed send rates (20 Hz, about 1 KB/s per client) and the RTO
  floor. A big game would need it.
- *"Two players behind the same NAT?"* The NAT gives each one a different source port, so the `ip:port`
  keys differ, and the token must match too.

---

## Slide 7: Live demonstration

**HUD:** `live demo · 4 computers · 4 clients (client 4 runs on the server PC)` · **Steps:** 1 ·
**Speaker:** Nabila narrates · **4:00–6:00**

### On screen

- **Left, the 7-step script:** Log in (a wrong password is refused) · Create a room (everyone sees it at
  once) · Join and leave (the others are told) · Start (each player secretly gets a role) · Play (move,
  kill, meeting, vote) · End (winner and ranking) · Disconnect (TCP sees it at once, UDP after ~5 s).
- **Right:** *Run 1 · TCP :5000* with `server> npm run tcp` / `client> npm run tcp -- --server <ip>`;
  **step 1** reveals *Run 2 · UDP :5001* with the `udp` commands.
- **Seats:** Client 4 · server PC (Israa), Client 1 (Zeineb), Client 2 (Ilyes), Client 3 (Nabila).
- Callout: *Watch the server log, the in-game HUD (F3) and Wireshark: `tcp.port == 5000` ·
  `udp.port == 5001`.*

### What it answers in the brief

All seven features live, on 4 separate computers, in both versions, plus real sockets visible in
Wireshark. This is the "clear technical demonstration".

### Sample pitch (opening)

> Now the real thing: four computers, four players. The server computer also runs the fourth client, so
> it plays too. We'll play the same script twice: first on TCP, then on UDP.
>
> Watch three things. The server log, which shows every session and every message type. The HUD in the
> corner of each game window, press F3, which shows the protocol, the round-trip time, and in UDP our own
> retransmissions and duplicates. And Wireshark, which shows what really crosses the network.

### Narration lines, step by step

| # | Action | Who | Say |
|---|---|---|---|
| 1 | Log in with a wrong password, then the right one | Client 1 | "Wrong password: refused by the server. The player id is created by the server, not by the client." |
| 2 | Create a room | Client 1 | "The room appears on the other three screens right away: the server pushes the list, nobody polls." |
| 3 | Client 2 joins, leaves, joins again; others join | Clients 2–4 | "Every join and every leave is announced to the others." |
| 4 | Host presses Start | Client 1 | "Each player just received a private message with their role. Only the imposter knows." |
| 5 | Move, kill, call a meeting, vote | all | "Positions twenty times a second. The kill and the votes are checked by the server." |
| 6 | End screen | all | "Winner, points, ranking. Play again keeps the scores." |
| 7 | **Ctrl+C one client's agent** | Client 3 | TCP: "The server log says `connection reset` immediately: the operating system told it. The others keep playing." |
| W | Wireshark `tcp.port == 5000`, Follow TCP Stream | Israa | "The handshake, one JSON message per line, a PING every second, then the reset." |

**[step 1 on the slide] Run 2, UDP.** Same steps 1–6, faster (the jury knows the flow). Then:

| # | Action | Say |
|---|---|---|
| 7 | Ctrl+C one client's agent | "No connection to reset. The server only notices silence. Count with me… gone after about five seconds." |
| 8 | Wireshark `udp.port == 5001` | "One JSON message per datagram: HELLO, WELCOME, MSG with a sequence number, ACK, FAST positions." |
| 9 | Wireshark filter `tcp` | "Nothing from the game. The UDP version uses no TCP at all." |
| 10 *(optional)* | Restart one agent with `--loss 0.1` and move | "Ten percent of datagrams dropped on purpose. The HUD counters go up; the game keeps working." |

### Fallbacks

- A client won't connect: the HUD shows the reason. `ECONNREFUSED` = wrong IP or server down; UDP stuck
  on "connecting" = firewall on UDP 5001.
- Room network isolates devices: phone hotspot, or Tailscale (slide 13).
- Total failure: play the recorded video, then run `node tools/smoke-client.cjs --proto udp --loss 0.2`
  live on one PC: 38 checks with real sockets on loopback in about 35 s.
- Short on time: skip steps 3 and 5 in the UDP run; keep the disconnection and Wireshark.

### Hand-off

> Zeineb, what exactly happened when we stopped that player?

---

## Slide 8: Simultaneous players and disconnections

**HUD:** `4 players at once · heartbeat 1 s · timeout 5 s · both versions` · **Steps:** 6 ·
**Speaker:** Zeineb · **1:45**

### On screen

Title: **"Four at once. Then one leaves."** The slide has two halves; step 4 swaps the first for the second.

**Steps 0–3: simultaneous players**

- **TCP card:** *one listening socket + one socket per client*: four crewmates, each with its own line
  to `socket · tcp-1` … `tcp-4`. "Session = the accepted connection."
- **UDP card:** *one socket for everyone*: four crewmates whose lines converge into `one socket :5001`.
  "Session = sender address + token."
- Fact cards: (1) **Broadcast = one send per player**, 4 players = 4 sends. (2) **One at a time**: two
  actions at the same instant are handled one after the other. (3) **Identity from the session**, not
  from the message: a fake player id is ignored.

**Steps 4–6: disconnections**, a bar-chart table (bar length = detection time):

| What happened | TCP | UDP |
|---|---|---|
| Player quits normally | ~0 s · FIN | ~0 s · BYE (5 s if the BYE is lost) |
| Client process crashes | ~0 s · the OS sends RST | **5.0 s** · only silence |
| Server killed, seen by clients | 0.2 s · connection reset | 5.1 s · silence |
| Cable pulled (silent drop) | 5.4 s · our heartbeat | 5.1 s · our detectors |
| Network back | 1.7 s · new connection, new session | 1.0 s · new HELLO → WELCOME |

Source line: *Measured on 13 Nov 2026 · all 38 checks pass on TCP, UDP, and UDP with 20% loss.*
Step 5: the cleanup chain, *"Then, in both versions: remove the player → tell the others → pick a new
host → end the game if a side won → client reconnects."* Step 6, takeaway: **"TCP sees a crash at once.
A pulled cable: both need our heartbeat."**

### What it answers in the brief

Exactly the brief's question: "how simultaneous players and disconnections are handled in each version".

### The facts behind it

- Node runs the server on **one event loop**: two actions arriving "at the same time" are two events
  processed one after the other. No threads, no locks, no race conditions. The second action is checked
  against the state left by the first (e.g. a kill arriving after a meeting started is refused).
- Identity: the server takes the player from the session (`sessionId` → player), never from an id inside
  the payload.
- Numbers come from the automated test `tools/smoke-client.cjs` (3 scripted clients, one PC). At 20% loss
  the UDP crash detection drops to **3.1 s**, because the 25-resend limit fires first.
- Cleanup ([roomEvents.js](../backend/src/events/roomEvents.js)): leaver removed, `player:left` sent
  with a reason, host role passed on, meeting closed if the leaver was the last voter, `checkWin()` run
  (imposter left = crew wins; last crewmate left = imposter wins).

### Sample pitch

> What you just saw, explained.
>
> Four players at once. In TCP, the server has one listening socket and one dedicated socket per player.
> In UDP, there's one single socket for everybody, and the server tells players apart by their address
> plus their token.
>
> *[step 1]* Sending to a room isn't magic in either version: four players means four separate sends.
> *[step 2]* Node handles one event at a time, so two actions at the same instant never collide: if a
> vote and a kill arrive together, the first one is applied and the second one is checked against the
> new state. No locks, no race conditions. *[step 3]* And the server knows who you are from your session,
> never from what your message claims. Put someone else's id in a message, and it's ignored.
>
> *[step 4]* Now disconnections, where the two protocols really differ. If a player quits normally,
> both know at once: TCP gets a FIN, UDP gets our BYE message. If the game process crashes, TCP still
> knows instantly, because the operating system resets the connection for us. UDP has no connection to
> reset, so only silence reveals it: five seconds. But if a cable is pulled, nobody sends anything, not
> even TCP, so both versions rely on our heartbeat, and both take about five seconds.
>
> *[step 5]* Whatever the cause, the same game code runs in both versions: the player is removed, the
> others are told why, a new host is picked, and if the imposter was the one who left, the crew wins.
> The client reconnects by itself and returns to the menu.
>
> *[step 6]* So: TCP sees a crash at once. A pulled cable: both need our heartbeat.
>
> Nabila, what else could have gone wrong?

### Likely questions

- *"Why 5 seconds?"* Trade-off: five missed heartbeats avoids false alarms on Wi-Fi and is still fast
  enough for a game.
- *"Can a disconnected player rejoin the game?"* They reconnect and log in automatically but return to
  the menu; resuming a running game is a known limit (slide 9).

---

## Slide 9: Edge cases and inconsistencies

**HUD:** `server-authoritative · every rule checked on the server` · **Steps:** 3 · **Speaker:** Nabila · **1:15**

### On screen

Title: **"What could break, and why it doesn't"**. Three columns, one per step:

1. **Game rules:** roles sent **privately** · the server checks every kill: role, 10 s cooldown,
   distance · too-fast or off-map moves are corrected.
2. **Players leaving:** host leaves → a new host is picked · imposter leaves → the crew wins · bad or
   unknown messages are ignored, the server never crashes.
3. **Known limits:** a reconnecting player can't rejoin a running game · restarting the server ends all
   games · UDP may drop a player after a short Wi-Fi hiccup (≈ 2.6 s).

Takeaway: **"The server checks every rule, so one bad client can't break the game."**

### What it answers in the brief

"Reliable multiplayer operation". Showing known limits honestly builds trust with the jury.

### More cases you can cite if asked (all in the code)

- **Kill:** both players alive, no meeting running, 10 s cooldown, distance ≤ 100 px computed from the
  **server's** positions, not the client's.
- **Moves:** clamped to the map; a move faster than walking speed is rejected and corrected
  (`corrected: true`), with a small time "bank" so normal network jitter doesn't punish honest players.
- **Meetings:** one per player per game, dead players can't vote, votes hidden until the end, a tie
  ejects nobody, only the server timer (30 s) or "everyone voted" ends it. If the last voter leaves, the
  meeting ends at once.
- **Joining:** refused if the game started, the room is full, or the name is taken; a taken color is
  replaced by a free one. The same account can't be logged in on two clients.
- **Login:** password hashing (scrypt) runs off the main thread; if the client vanished meanwhile, the
  reply is dropped.
- **UDP sessions:** a HELLO from a known address means the client restarted → fresh session; a datagram
  with a wrong token is dropped and doesn't count as a heartbeat.
- **Robustness:** malformed JSON, unknown message types, or an exception in a handler are logged and
  ignored.
- **Other limits:** a player who leaves disappears from the final ranking; the UDP layer doesn't split
  messages over 1200 bytes (ours stay far below).

### Sample pitch

> The project we started from trusted the players completely. Our first test with scripted clients found
> sixteen bugs: the imposter's identity was in the public room list, a crewmate could kill, and a
> position of x equals ninety-nine thousand was accepted.
>
> *[step 1]* Today the server checks every rule with its own data. Roles are sent privately, so nobody
> else can learn who the imposter is. Every kill is checked: is this player the imposter, is the cooldown
> over, and are they really close enough, using the server's positions, not the client's. A move that's
> off the map or too fast is corrected, with a little tolerance for normal network jitter.
>
> *[step 2]* When a player leaves, the game adapts instead of breaking: if it was the host, a new host is
> picked; if it was the imposter, the crew wins; if they were the last person who still had to vote, the
> meeting ends immediately. And a broken or unknown message is just logged and ignored: the server never
> crashes.
>
> *[step 3]* And what's not perfect yet. A player who reconnects goes back to the menu; they can't resume
> a running game. Restarting the server ends all games; accounts are saved on disk, rooms aren't. And in
> UDP, because our retry timer doesn't back off, a Wi-Fi hiccup of about 2.6 seconds can drop a player
> a bit earlier than TCP would. We know exactly why, and the fix is exponential backoff.
>
> Ilyes, so which protocol is better?

---

## Slide 10: TCP vs UDP, measured

**HUD:** `metrics: detection time · loss · counters · bytes · code size` · **Steps:** 4 ·
**Speaker:** Ilyes · **2:00**

### On screen

Title: **"Same game. Different behaviour."**

**Steps 0–1: the scoreboard and the counters**

| | TCP | UDP |
|---|---|---|
| Connection | done by the OS | built by us (HELLO) |
| Reliability | done by the OS | built by us |
| Positions | can freeze | newest wins |
| Crash seen | ~0 s | 5 s |
| 20% loss | movement stalls | still playable |
| Traffic, one player | ≈ 94 KB | ≈ 155 KB |
| Code we wrote | ≈ 400 lines | ≈ 640 lines |

Step 1, **Counters at 20% loss** (UDP, 2 clients, same scripted game): retransmits **14 · 6**,
duplicates **16 · 20**, out-of-order **9 · 12**, positions lost **41% · 37%**. *"Theory: 1 − 0.8² = 36%
lost. Measured: close."* TCP: *"nothing to count, reliability: OS TCP stack"*. Two editable boxes:
**LAN RTT avg · TCP 15.1 ms** (p95 49 ms) and **LAN RTT avg · UDP 14.8 ms** (p95 43 ms).

**Steps 2–4: advantages and drawbacks, verdict**

| | TCP | UDP |
|---|---|---|
| Advantages | Reliable and ordered for free · crash seen at once · less code | One message = one packet · reliable only where needed · no freeze on lost positions |
| Drawbacks | We must split messages · one loss blocks everything after it · needs a heartbeat for pulled cables | We built sessions, confirmations, order · crash seen only by silence · bigger messages |

Step 3: **TCP is best for** login, rooms, kills, votes, scores: things that must arrive. **UDP is best
for** movement: a lost position costs 50 ms, not a freeze. Step 4, takeaway: **"Reliable for events.
Unreliable for state that expires."**

### What it answers in the brief

"Comparison with team-defined metrics", "where each protocol performed best", "technical differences".

### Where the numbers come from

- `node tools/smoke-client.cjs --proto tcp|udp [--loss 0.2]`, run on 13 Nov on one PC (loopback): 38/38
  checks on TCP, UDP, and UDP with 20% loss on every side.
- **Why 36%:** a position goes client → server → other client, two hops, each with 20% loss. It
  survives with probability 0.8 × 0.8 = 0.64, so 36% are lost. We measured 37–41%.
- **Traffic:** app-level bytes for one client over the same script. TCP 20.7 KB out + 72.8 KB in ≈ 94 KB.
  UDP 43.7 KB out + 111.6 KB in ≈ 155 KB. UDP is bigger because every datagram carries the token and our
  envelope (`t`, `seq`/`n`), plus separate ACK datagrams.
- **Code:** TCP ≈ 400 lines (line framer + TCP server + TCP client); UDP ≈ 640 lines (reliable channel +
  UDP server + UDP client), comments included. The ≈ 950 lines of game logic are shared.
- "20% loss → movement stalls" for TCP is **by design**, not measured: the test's `--loss` option can only
  drop UDP datagrams; you can't drop bytes inside a TCP stream from the application.
- **RTT boxes:** real LAN runs recorded on 13 Nov against the same server (`192.168.1.136`), summarized
  with `node tools/summarize-netstats.mjs frontend/netstats-tcp-29108.csv frontend/netstats-udp-8396.csv`:
  TCP over 629 s: avg **15.1 ms**, p95 49 ms, max 268 ms, jitter 16.4 ms.
  UDP over 1527 s: avg **14.8 ms**, p95 43 ms, max 339 ms, jitter 14.6 ms, positions lost **0.66%**
  (21), **2** retransmits, 0 duplicates, 0 reordered.
  The point to make: **on a healthy LAN the two protocols look identical**. The differences only appear
  under loss and on disconnection, which is why we measured those.
  (If someone retyped the boxes before, the browser keeps their value: click the box and retype.)

### Sample pitch

> We compared the two versions on metrics we chose ourselves.
>
> The structural difference first: in TCP, connection and reliability are done by the operating system;
> in UDP, we built both. That shows up everywhere else. A crashed client is seen instantly in TCP, after
> five seconds in UDP.
>
> *[step 1]* Then behaviour under loss. We dropped twenty percent of datagrams on every side, and the UDP
> version still finished a complete game and passed all 38 checks. Look at what our layer did: each
> client resent a handful of events, ignored around twenty duplicates and re-ordered about ten messages.
> Meanwhile 37 to 41 percent of positions were simply lost, which matches the theory: two hops, each
> losing twenty percent, is 36 percent. And the game stayed playable, because the next position always
> comes 50 milliseconds later. In TCP, the same loss would be repaired by the kernel, so nothing is lost,
> but movement stalls while it waits.
>
> And on our real LAN, without loss? The round trip was about 15 milliseconds for both. Over 25 minutes
> of UDP play, less than one percent of positions were lost and only two events had to be resent. On a
> healthy network, the two protocols look the same; the differences appear when things go wrong.
>
> UDP also cost us something: our messages are bigger, about 155 kilobytes against 94 for the same game,
> because every datagram carries the token, our header and separate ACKs. And we wrote about sixty percent
> more transport code.
>
> *[step 2]* So, advantages and drawbacks. TCP: reliable and ordered for free, instant crash detection,
> less code; but no message boundaries, head-of-line blocking, and it still needs a heartbeat. UDP: one
> message is one packet, we choose what's reliable, no freezes; but we had to build everything, a crash
> is only visible as silence, and messages are bigger.
>
> *[step 3]* Where did each one win? TCP for everything that must arrive: login, rooms, kills, votes,
> scores. UDP for movement: on a lossy network, a lost position costs 50 milliseconds instead of a freeze.
>
> *[step 4]* Our conclusion: reliable for events, unreliable for state that expires.
>
> Israa, what did it cost us to get here?

### Likely questions

- *"How did you measure?"* Automated test with 3 real socket clients (38 checks), a per-second CSV of
  network stats on every client, a summary script, and Wireshark.
- *"Did you measure TCP under loss?"* Not with our test tool; the stall follows from the design. With a
  network impairment tool (clumsy on Windows) we could, and read `tcp.analysis.retransmission` in
  Wireshark. (Change this answer if you did run clumsy.)

---

## Slide 11: Challenges and optimizations

**HUD:** `challenges → fixes → optimizations` · **Steps:** 7 · **Speaker:** Israa · **1:30**

### On screen

Title: **"What broke, and how we fixed it"**. Six cards; each step flips one from "before" (problem) to
"after" (fix) while a crewmate walks along the bottom:

| Step | Challenge | Before | After |
|---|---|---|---|
| 1 | Libraries hid the sockets | Socket.IO and Express: TCP hidden underneath | Removed. Only `net` and `dgram` |
| 2 | The browser | Web pages can't open raw sockets | A local Node agent does it |
| 3 | Trusting players | Players could cheat. 16 bugs found | The server checks everything |
| 4 | Too many messages | Up to 144 positions per second | 20 per second, 2 when standing still |
| 5 | Silent players | A dead player stayed "connected" forever | Heartbeat: 5 s of silence = gone |
| 6 | UDP promised nothing | Lost, duplicated, reordered packets | Numbers, confirmations, resends, token |

**Step 7** replaces the cards with eight optimization tiles: **144 → 20** positions per second ·
**−⅓** traffic, no echo to the sender · **smooth**, other players glide between updates · **push**, room
list sent on change, never polled · **no Nagle** (TCP) · **2 × RTT**, resend timer adapts (UDP) ·
**< 1200 B**, packets never split (UDP) · **off-thread**, login never freezes the game.

### What it answers in the brief

"Friction points encountered", "technical differences", and shows engineering judgement.

### The facts behind it

- Positions used to be sent once per rendered frame (60–144 per second depending on the monitor). Now:
  20/s while moving, 2/s idle, and immediately on start/stop of movement.
- No echo: a position is relayed only to the *other* players. With 3 receivers instead of 4 per position,
  that's a third less position traffic.
- Remote players move 30% of the remaining distance each frame and snap if more than 200 px away, so 20
  updates per second still look smooth.

### Sample pitch

> What was hard. The project we started from used Socket.IO, Express and HTTP: everything ran over TCP
> and the sockets were hidden. *[step 1]* We removed all of it, and then discovered how much it had been
> doing for us.
>
> *[step 2]* A browser can't open a socket, so we wrote the local agent. *[step 3]* Players could cheat,
> sixteen bugs, so the server now checks everything. *[step 4]* Positions went out on every frame, up to
> 144 times a second; now twenty, and two when you stand still. *[step 5]* A dead player stayed connected
> forever, so we added the heartbeat. *[step 6]* And UDP promised nothing, so we built sequence numbers,
> ACKs, resends and a token.
>
> *[step 7]* Then we optimized, each with a number: from 144 to 20 positions per second; a third less
> traffic because you never receive your own position back; other players glide between updates so it
> still looks smooth; the room list is pushed when it changes, never polled. TCP sends without Nagle's
> delay. UDP's resend timer follows the measured round trip, and every datagram stays under 1200 bytes so
> it's never fragmented. And password hashing runs off the main thread, so a login never freezes the game.
>
> The hardest part wasn't writing sockets. It was discovering what the libraries had been doing for us.

---

## Slide 12: Backup, network weaknesses (Q&A only)

**HUD:** `backup · weakness → what we did · TCP only / UDP only` · **Steps:** 2

**Skip this slide in the talk** (press `→` past it, or jump with `End` / number keys). Use it when the jury
asks "what problems did each protocol cause?".

### On screen

Two columns, each weakness with its "why"; step 1 reveals the TCP fixes, step 2 the UDP fixes.

| TCP only (`net`) | Fix |
|---|---|
| No message boundaries: one read = half a message or two glued | Newline framing, one JSON per line, safe for split UTF-8 |
| Nagle delays small writes | `setNoDelay(true)` |
| Head-of-line blocking | Can't be removed; shrunk: 20 Hz instead of every frame, receiver glides |
| A dead peer is silent (keep-alive ≈ 2 h) | PING/PONG every 1 s, 5 s timeout, reconnect every 2 s |

| UDP only (`dgram`) | Fix |
|---|---|
| Datagrams get lost: a kill or vote may never arrive | seq + ACK + resend, RTO = 2 × measured RTT |
| Duplicates and reordering | Dedupe by seq, in-order buffer |
| No connection, no goodbye | HELLO → WELCOME sessions by `ip:port` + token, BYE, 5 s heartbeat |
| Resends can make it worse; big datagrams fragment | RTO floor 100 ms, positions never resent, datagrams < 1200 bytes |

### Sample answer (if asked)

> Each protocol hurt us differently. TCP is reliable but rigid: it has no message boundaries, it delays
> small writes, one lost segment blocks everything behind it, and a dead peer is silent. UDP is free but
> guarantees nothing: loss, duplicates, reordering, no connection and no goodbye. And our own fixes can
> make things worse, so we set a floor on the resend timer, never resend positions, and keep every
> datagram small enough not to be fragmented.

---

## Slide 13: Bonus (Tailscale) and closing line

**HUD:** `bonus: TCP game across networks over Tailscale · relayed via Amsterdam · ~120 ms` · **Steps:** 2 ·
**Speaker:** Israa · **1:15**

### On screen

**Step 0, "Four laptops, different networks".** Four nodes (Client 4 + server, Clients 1–3), each with an
editable network label (network A–D), joined by a *"Tailscale VPN · one private network on top of four
real ones"* tunnel. Three facts: **A full TCP game** (one player on 4G, no code change, nothing lost,
no reset) · **Relayed, not direct** (4G blocked a direct path, so Tailscale relayed it via Amsterdam) ·
**≈ 120 ms round trip** (vs ≈ 10 ms on the LAN, still fully playable). Editable status: *"TCP version
played across networks · UDP version not captured yet"*.

**Step 1, "What crossed the Internet".** A Wireshark-style view of the real capture
(`tailscale-game-wireshark.pcap`, 4300 packets, 108.8 s), filter `tcp.port == 5000`, `100.x` Tailscale
addresses:

- Packets 1159–1177: the player sends `player:move`; **packet 1176 is the server's `player:killed`**
  (132 bytes), acknowledged 41 ms later by packet 1177 (ACK only).
- 75 s later, packets 4288–4291: the server sends a `PONG`, the player ACKs it, but the ACK is still
  crossing the relay when the server's retransmission timer fires, so **4290 is a `TCP Spurious
  Retransmission`** of the same PONG, and **4291 a `Dup ACK` with a SACK block** (SLE/SRE) saying "I
  already have those bytes".
- Follow TCP Stream: the real wire format, one JSON message per line (`PING`, `PONG`, `meeting:vote`,
  `player:move`, `player:moved`, `player:killed`), player messages in one color and server messages in
  the other.
- Four stats: **118 ms** median round trip (LAN ≈ 10 ms) · **0** segments lost, reordered or reset ·
  **1** retransmission, spurious: only the ACK was late · **DERP**, relayed via Amsterdam.

**Step 2, closing.** **"TCP gives you a promise. UDP gives you a choice."** with a parade of crewmates.

### What it answers in the brief

The cross-network bonus, demonstrated for the **TCP version**. Be precise: the UDP version over the
internet was **not captured**, and the status line says so.

### The facts to have ready

- No code change was needed: the server listens on `0.0.0.0`, so it accepts connections on the Tailscale
  interface too; clients just use the server's `100.x` address. See [TAILSCALE.md](TAILSCALE.md).
- **DERP** is Tailscale's relay. When a direct path is blocked (here by the 4G operator), traffic goes
  through a relay server, which carries it **over TCP/HTTPS**. So through a relay, our UDP version's
  datagrams would travel inside TCP. On a direct path, Tailscale uses WireGuard over UDP, so UDP stays UDP.
  Check with `tailscale ping`.
- The capture was taken **inside** the tunnel (on the Tailscale interface), which is why the JSON is
  readable; on the physical interface it would be encrypted WireGuard.

### Sample pitch

> A bonus: playing across different networks. Tailscale is a VPN that puts the laptops on one private
> network on top of their real ones. Our server already listens on every interface, so we changed no code.
>
> We played a full game on the TCP version with one player on 4G. The 4G network blocked a direct
> connection, so Tailscale relayed the traffic through its server in Amsterdam. The round trip went from
> about 10 milliseconds on the LAN to about 120, and the game stayed fully playable.
>
> *[step 1]* Here's the real capture, taken inside the tunnel so our messages are readable. At the top,
> the first kill: the player keeps sending moves, and packet 1176 is the server announcing the kill,
> acknowledged 41 milliseconds later.
>
> Further down, the only retransmission of the whole game. The server sent a PONG, the player acknowledged
> it, but that acknowledgement was still crossing the relay when the server's timer fired, so the server
> sent the PONG again. Wireshark marks it as spurious, and the player answers with a duplicate ACK whose
> SACK block says: I already have those bytes. That is TCP's retransmission, live, on the internet.
>
> At the bottom, Follow TCP Stream: our protocol as it really travels, one JSON message per line.
>
> One caution for UDP: Tailscale's relay carries traffic over TCP, so through a relay our UDP would
> really travel inside TCP. That's why we only claim this bonus for the TCP version.
>
> *[step 2]* To close: TCP gives you a promise, and you pay for it with freezes. UDP gives you a choice,
> and you pay for it with code.

---

## Slide 14: Thank you

**HUD:** `thank you · questions welcome` · **Steps:** none · **Speaker:** Israa · **0:15**

### On screen

*"Among Us Arena · one game, two transports"*, **Thank you.**, *Questions?*, the four team members as
walking crewmates, and the footer *TCP :5000 · UDP :5001 · Node net + dgram only · run instructions:
README §5 (TCP) and §6 (UDP)*.

### Sample pitch

> Thank you for listening. The source code and the instructions to run both versions are in the README,
> sections 5 and 6. We're happy to take your questions, and we can open any slide, any file, the server
> log or a Wireshark capture to answer them.

### During Q&A

- Jump with number keys (`5` TCP, `6` UDP, `8` disconnections, `0` comparison) or deep links
  (`#6.3` = the retransmit tile).
- Slide 12 holds the weaknesses table; slide 13 step 1 holds the real capture.
- Answer in one or two sentences, then offer to show the code or the log. Say "we didn't measure that"
  when it's true.

---

## Things to fix or know before presenting

| # | Item | Where | What to do |
|---|---|---|---|
| 1 | ~~RTT boxes showed `__ ms`~~ **Fixed** | Slide 10, step 1 | Filled with the 13 Nov LAN runs: TCP 15.1 ms, UDP 14.8 ms (p95 49 / 43). If a box still shows an old value, it was typed earlier and saved in that browser: click it and retype. |
| 2 | ~~Slide 2 note said "one per speaker"~~ **Fixed** | Slide 2 notes | Now just "Four parts." |
| 2b | "LAN ≈ 10 ms" on slide 13 vs "15 ms" on slide 10 | Slides 10 and 13 | Not a contradiction: slide 10 shows the **average** (15.1 / 14.8 ms, pulled up by Wi-Fi spikes), slide 13 compares **medians** (Tailscale 118 ms vs LAN median 7 ms TCP / 5 ms UDP, rounded up). If asked: "the average includes a few Wi-Fi spikes; the typical round trip is 5 to 7 ms." |
| 3 | Minimum players | Code vs demo | Code allows a start with 2 players; you play with 4. If asked: "minimum 2, we play with 4". |
| 4 | Smoke test used 3 clients, demo uses 4 | Slides 8 and 10 | The measured numbers come from the 3-client automated test. Say "automated test" when citing them. |
| 5 | No exponential backoff | Slides 6, 9 | Never say the resend timer "doubles". It is a fixed, adaptive RTO (2 × SRTT, clamped 100–1000 ms). Backoff is the next improvement. |
| 6 | Bonus only for TCP | Slide 13 | Don't claim the UDP version was played across networks. |
| 7 | TCP under loss | Slide 10 | "Movement stalls" is by design, not measured, unless you run clumsy before the talk. |

---

## Numbers cheat sheet

**Smoke test, 13 Nov 2026, one PC, `node tools/smoke-client.cjs --proto …`** (3 scripted clients)

| | TCP | UDP 0% | UDP 20% loss |
|---|---|---|---|
| Checks | 38/38 | 38/38 | 38/38 |
| Scripted game finished at | 18.1 s | 18.1 s | 23.6 s |
| Clean quit seen | 0.0 s (FIN) | 0.0 s (BYE) | 0.1 s |
| Crash seen | 0.0 s (reset) | 5.0 s (timeout) | 3.1 s (25-resend limit) |
| Pulled cable seen | 5.4 s | 5.1 s | 3.2 s |
| Reconnect, new session | 1.7 s | 1.0 s | 1.7 s |
| Retransmits (2 clients) | kernel | 0 / 0 | 14 / 6 |
| Duplicates ignored | kernel | 0 / 0 | 16 / 20 |
| Out-of-order buffered | kernel | 0 / 0 | 9 / 12 |
| Positions lost | 0 | 0 | 41% / 37% |
| App bytes out / in, one client | 20.7 / 72.8 KB | 43.7 / 111.6 KB | 37.3 / 58.7 KB |

**Real LAN runs, 13 Nov 2026, same server `192.168.1.136`** (`tools/summarize-netstats.mjs`)

| | TCP (629 s) | UDP (1527 s) |
|---|---|---|
| RTT median / avg / p95 / max | 7 / 15.1 / 49 / 268 ms | 5 / 14.8 / 43 / 339 ms |
| Jitter | 16.4 ms | 14.6 ms |
| Positions lost | 0 (kernel repairs) | 0.66% (21) |
| Retransmits / duplicates / reordered | kernel | 2 / 0 / 0 |

**Protocol constants** ([shared/protocol.cjs](../shared/protocol.cjs)): heartbeat 1 s · timeout 5 s ·
RTO = 2 × SRTT clamped to [100, 1000] ms, 200 ms before the first sample · 25 retries · datagram
≤ 1200 bytes · TCP reconnect every 2 s · UDP HELLO every 1 s.

**Game constants** ([backend/src/events/gameEvents.js](../backend/src/events/gameEvents.js)): kill range
100 px · kill cooldown 10 s · meeting 30 s · positions 20 Hz moving, 2 Hz idle · minimum 2 players to
start · up to 10 per room · points: kill +1, correct vote +1, crew win +2, imposter win +3.

**Bonus capture:** 4300 packets, 108.8 s, median RTT 118 ms via DERP Amsterdam, 0 lost, 1 spurious
retransmission.
