# Slides guide: Among Us Arena, one game, two transports

How to present each slide of `dashboard/index.html`. For every slide: who presents it, what is on
screen at each click, what to say, the ideas behind it in plain words, and likely questions.

The slides only show keywords. **This file is where the explanations live.** Each slide also has
a short script in its speaker notes (press <kbd>N</kbd>).

---

## 0. Before you start

**Keyboard during the talk**

| Key | Does |
|---|---|
| <kbd>→</kbd> / <kbd>←</kbd> | next / previous click (or slide) |
| <kbd>1</kbd>–<kbd>0</kbd> | jump to a slide |
| <kbd>N</kbd> | show / hide the speaker notes |
| <kbd>L</kbd> | turn packet loss on / off in the animations (TCP and UDP slides) |
| <kbd>P</kbd> | pause animations |
| <kbd>F</kbd> | full screen |

**Fill in before presenting.** Fields with a yellow dashed border are editable: click and type.
They save in the browser.
- Slide 10 (TCP vs UDP): the two RTT values, now `__ ms`. Get them by running `ping <server ip>` on the LAN.
- Slide 12 (Bonus): the network names and the status line (now "planned, not yet demonstrated").
- The names, if they need fixing. Editing one name updates it on every slide.

**Numbering.** The deck has 14 slides. The small label above each title ("3 · The TCP version")
is the *part number* from the outline (1 to 9), not the slide number.

---

## 1. Who presents what

| Part | Presenter | Slides | Time |
|---|---|---|---|
| 1 · Context | **Israa** | 1 Title · 2 Outline · 3 The game · 4 Architecture | ≈ 4.5 min |
| 2 · Two versions | **Zeineb** | 5 TCP version · 6 UDP version | ≈ 6 min |
| 3 · Proof | **Ilyes** | 7 Live demo · 8 Players & disconnections | ≈ 7 min |
| 4 · Analysis | **Nabila** | 9 Edge cases · 10 TCP vs UDP · 11 Challenges · 12 Bonus & close · 13 Thank you | ≈ 6.5 min |
| | | Total | **≈ 24 min** |

**Why this split**
- **Blocks follow each other.** There are only 3 handovers, so the talk flows.
- **One person explains both protocols.** Zeineb presents TCP and then UDP back to back, so the
  contrast ("TCP gives this for free; in UDP we built it") stays in one voice.
- **The demo has one narrator.** Ilyes talks while everyone plays, then explains what the audience
  just saw on the next slide. The demo is the longest block, but the narration is light.
- **Analysis closes the talk.** Nabila brings it home: what could break, the measured numbers,
  the lessons and the closing line.
- The outline slide shows each presenter's name under their part (editable).

**Seats in the demo** (already on slide 7)

| Computer | Player | Job during the demo |
|---|---|---|
| Server PC | Israa | runs the server **and** plays; keeps the server log visible |
| Client 1 | Zeineb | plays; keeps Wireshark open |
| Client 2 | Ilyes | plays **and narrates** |
| Client 3 | Nabila | plays; is the one who **disconnects** at the end |

**Questions:** each presenter answers questions about their own part. The backup slide (14)
is Zeineb's, since it is about protocol weaknesses.

**Handover lines** (one sentence each, so nobody stops dead)
- Israa → Zeineb: "Now that you know the setup, Zeineb shows what each protocol gave us."
- Zeineb → Ilyes: "That's the theory. Ilyes will now prove it live."
- Ilyes → Nabila: "Nabila now looks at what could break, and at the numbers."

---

## 2. Slide by slide

### Slide 1 · Title (Israa, 30 s)

**On screen:** an arcade cabinet with "Among Us Arena, one game, two transports", "TCP vs UDP"
on the marquee, the four names, and the ports: TCP `:5000`, UDP `:5001`.

**Say:** who we are, and the one-sentence idea: *one 4-player game, built twice, once on TCP and once
on UDP, with the same rules and no networking library, only Node's built-in `net` (TCP) and
`dgram` (UDP).*

**Why it matters:** with no library, every network behaviour you see is either something the
protocol gave us, or code we wrote. That is the thread of the whole talk.

**Possible question:** *Why no library?* The assignment is about the transport layer. Libraries
like Socket.IO hide TCP behind WebSockets, so you never see the protocol's real behaviour.

---

### Slide 2 · Outline (Israa, 30 s)

**On screen:** four cards (Context, Two versions, Proof, Analysis), the slide titles in each, and
the presenter's name at the bottom of each card.

**Say:** "Four parts, one per speaker", and read the card titles. Don't read every line.

---

### Slide 3 · The game (Israa, 1.5 min) · 1 click

**On screen**
- *Left, Rules:* a red imposter with a dashed circle (its kill range) **vs** three crewmates.
  Two banners: *Crew wins: vote the imposter out* and *Imposter wins: kill until 1 vs 1*.
- *Right, Personal score:* Kill +1 · Vote for the imposter +1 · Crew wins +2 · Imposter wins +3.
- *Click 1:* a strip with the 7 required features, "identical in TCP and UDP".

**Explain simply**
- **4 players:** the 3 client computers plus the server computer, which also plays.
- The **server** secretly picks the imposter. Only the imposter is told.
- The imposter can kill a crewmate who is **close** (100 pixels or less), at most **once every 10 s**.
- Any living player can call **one meeting per game**. Everyone has 30 s to vote or skip.
- **Crew wins** if the imposter is voted out (or leaves).
- **Imposter wins** as soon as it is 1 imposter vs 1 crewmate. With 3 crewmates that means
  **2 kills**. (This is the classic "parity" rule: the crew can no longer outvote the imposter.)
- Points add up across games. In the next game the imposter role goes to someone else.

**Why it matters for networking:** the game has two very different kinds of messages:
- **Events** that must arrive exactly once: log in, join, kill, vote, game over.
- **Positions** sent 20 times per second, where only the newest one matters.

This difference drives every design choice later.

**Possible questions**
- *Can it start with fewer players?* The server allows 2 or more to start, which is handy for testing. We demo with 4.
- *What are the 7 features?* Registration and login, lobby and rooms, joining and leaving,
  start and end, real-time actions, scores and results, disconnection handling.

---

### Slide 4 · Architecture (Israa, 2 min) · 1 click

**On screen**
- *Left box, "Client computer ×3":* the game UI (a browser tab), then a **local agent** (a small
  Node.js program) that holds the real socket: `net.Socket` (TCP) or `dgram.Socket` (UDP).
- *Middle:* the wire. TCP `:5000` is a solid pipe, "byte stream". *Click 1:* UDP `:5001`
  appears as dashed capsules, "datagrams, no connection".
- *Right box, "Server computer + player 4":* the game rules, four functions (`connect`,
  `message`, `disconnect`, `send`), and two swappable files: `tcpServer.js` and `udpServer.js`.

**Explain simply**
1. **The browser problem.** A web page is not allowed to open raw TCP or UDP sockets (security
   sandbox). So next to the browser runs a **local agent**, a small Node program that *is* allowed.
   The page talks to the agent inside the same computer (loopback, `127.0.0.1`). Only our
   own TCP or UDP traffic goes between computers.
2. **Same rules, swappable transport.** Both server files offer the same four functions. The game
   rules only call those four. Changing protocol means starting the server with `--proto tcp` or
   `--proto udp`. That's why we can say the two versions have *identical rules*.
3. **The server decides** ("authoritative server"). A client never says "I killed Bob". It
   says "I *want* to kill Bob". The server checks role, distance and cooldown with its own data,
   then tells everyone the result.

**Possible questions**
- *Isn't loopback also TCP?* Yes, page ↔ agent uses loopback, but it never leaves the
  computer. On the real network, between computers, there is only our TCP or our UDP. Wireshark
  confirms this in the demo.
- *Why is the server authoritative?* So one cheating or buggy client can't break the game for
  everyone (see slide 9).

---

### Slide 5 · The TCP version (Zeineb, 2.5 min) · 5 clicks

**On screen**
- *Top line:* the server listens on `:5000`, then gets **one socket per player**. That socket is the player's session.
- *Left, "The OS does it":* 3-way handshake (SYN, SYN-ACK, ACK), sequence numbers, ACKs,
  retransmission, in-order delivery, FIN/RST on close.
- *Right, "We had to build", one tile per click:*
  1. **Framing:** chunks of bytes arrive split anywhere; we cut them at `\n` into whole messages.
  2. **No Nagle delay:** `socket.setNoDelay(true)`.
  3. **Heartbeat:** PING/PONG, 5 s of silence = gone.
  4. **Reconnect:** a dead connection is replaced by a new one.
- *Click 5:* the head-of-line blocking animation.

**Explain simply**
- **What TCP gives for free.** The operating system (the kernel) numbers every byte,
  acknowledges it, resends what was lost and delivers everything in order. Our code never
  sees a lost packet.
- **1. Framing.** TCP is a *stream of bytes*, like water in a pipe. It has no idea where one
  message ends. One read might give half a message, or two messages stuck together. Our rule:
  **one JSON message per line**. The receiver collects bytes until it sees a newline.
- **2. Nagle's algorithm.** By default TCP holds small writes back a little, to send them in one
  packet. Good for big transfers, bad for a game. `setNoDelay(true)` sends every message at once.
- **3. Heartbeat.** If a cable is pulled, *nothing* is sent, so TCP doesn't notice. Its own
  keep-alive takes about 2 hours by default. So every second each side sends PING and expects
  PONG. After 5 s of silence, the player is considered gone.
- **4. Reconnect.** A broken TCP connection can't be repaired. The client retries every 2 s with a
  brand-new connection (new handshake), and the server creates a new session.
- **Head-of-line blocking (click 5).** Because TCP must deliver *in order*, one lost packet holds
  back every newer packet behind it until it's resent. For positions this is absurd: the old
  position is already outdated, but the screen freezes waiting for it. Press <kbd>L</kbd> to
  toggle loss and show it.

**Possible questions**
- *What's FIN vs RST?* FIN is a polite "I'm done" (normal close). RST is an abrupt "this
  connection is dead" (for example the process crashed and the OS cleans up).
- *Why not just turn on TCP keep-alive?* Its default timing is about 2 hours, and tuning it
  depends on the OS. An application heartbeat works the same everywhere and also works for UDP.

---

### Slide 6 · The UDP version (Zeineb, 3.5 min) · 8 clicks

**On screen**
- *Top line:* one socket on `:5001` **for everyone**. A player = an address that said HELLO, plus a secret token.
- *Start:* three cards show UDP's problems: **Lost**, **Duplicated**, **Reordered**. "No connection. No
  delivery guarantee. No order. No goodbye."
- *Clicks 1–6:* six tiles, the parts we built ourselves:
  1. **Handshake + token:** HELLO → WELCOME with a token.
  2. **Seq + ACK:** numbered messages, each one confirmed.
  3. **Retransmit:** wait = 2 × round trip (100–1000 ms), then resend.
  4. **Dedupe:** already seen → confirm again, but don't use it twice.
  5. **Order:** early messages wait for the missing one.
  6. **Give up:** 25 resends (≈ 2.6 s) or 5 s of silence → player gone.
- *Click 7:* an animated exchange. A message is delivered, its ACK is lost, the client resends,
  and the server recognises the copy, confirms it again and ignores it. The counters on the right
  count up.
- *Click 8:* the **two lanes**. The reliable lane (`MSG`) carries login, join, start, kill, vote and end.
  The fast lane (`FAST`) carries positions only, 20 per second, never resent. Below, the same
  loss is shown for TCP (freezes) and UDP (just continues).

**Explain simply**
- **UDP = postcards.** Each datagram travels alone. It may be lost, arrive twice, or arrive out of
  order, and nobody tells you. There is no "connection", so nobody tells you a player left either.
- **1. Sessions.** With one socket for everyone, the server only knows the sender's IP and port.
  The client sends HELLO every second until the server answers WELCOME with a **random token**.
  Every later datagram carries that token. Faking someone's address isn't enough without it.
- **2. Seq + ACK.** Each important message gets a number (`seq`). The receiver answers
  `ACK seq`. That's how the sender knows it arrived.
- **3. Retransmission.** If no ACK comes back in time, send again. "In time" adapts to the
  network: twice the measured round-trip time, kept between 100 ms and 1 s. Like TCP, we only
  measure the round trip on messages sent once (Karn's rule): with a resent message you can't
  tell which copy the ACK answers.
- **4. Duplicates.** A duplicate usually means *our ACK* was lost, so the sender resent. We ACK
  again (so it stops resending) but never act twice. A vote must not count twice.
- **5. Order.** If message 8 arrives before 7, it waits in a buffer. When 7 arrives, both are
  delivered, 7 then 8.
- **6. Giving up.** Two detectors, whichever fires first: 25 resends without an ACK (≈ 2.6 s on a
  LAN), or 5 s of total silence (the heartbeat).
- **Two lanes: the key design choice.** Events go on the reliable lane. Positions **skip
  reliability on purpose**: a lost position is replaced by a newer one 50 ms later, so resending
  it would deliver the past. Each position carries a counter `n`. If an older one arrives late, it's
  dropped. Result: under loss, TCP freezes, while UDP just shows the next position.

**Possible questions**
- *Why not use TCP for events and UDP for positions in the same game?* We could. That's actually
  the conclusion of slide 10. The assignment asked for one version per protocol so they can be compared.
- *Isn't this just rebuilding TCP?* Partly: same ideas (seq, ACK, timeout). The difference is
  that **we choose per message**. TCP makes everything reliable, positions included.
- *What's RTT?* Round-trip time: how long a message takes to go and come back.

---

### Slide 7 · Live demo (Ilyes narrates, everyone plays, ≈ 5 min) · 1 click

**On screen:** the 7-step script, the commands for Run 1 (TCP) and, after the click, Run 2 (UDP),
the four seats, and what to watch: the server log, the in-game HUD (<kbd>F3</kbd>), and Wireshark with
`tcp.port == 5000` / `udp.port == 5001`.

**Run the script twice: first TCP, then UDP**
1. **Log in**, and show one wrong password being refused.
2. **Create a room.** It appears on every screen at once, because the list is *pushed*, not polled.
3. **Join and leave.** The others are told.
4. **Start** (host only). Each player privately learns their role.
5. **Play:** move, kill, call a meeting, vote.
6. **End:** winner, points, ranking.
7. **Disconnect:** Nabila stops her client. On TCP the server log shows it **at once**. On UDP
   it shows **after about 5 s**.

**Point at, while it runs**
- **Server log:** every session opening and closing, and every message.
- **HUD (<kbd>F3</kbd>) in UDP:** our own counters for resends and duplicates.
- **Wireshark during the UDP run:** the `tcp` filter shows **nothing** from the game, proof that
  only UDP crosses the network.

**If something goes wrong:** stay calm, say what you expected to see, and move to slide 8, which
explains the same behaviour with measured numbers.

---

### Slide 8 · Players & disconnections (Ilyes, 2 min) · 6 clicks

**On screen**
- *Start:* two diagrams. **TCP**: 4 players → 4 separate sockets (`tcp-1`…`tcp-4`).
  **UDP**: 4 players → **one** socket, players told apart by address + token.
- *Clicks 1–3:* three facts.
  1. **Broadcast = one send per player:** 4 players = 4 sends.
  2. **One at a time:** two simultaneous actions are handled one after the other.
  3. **Identity from the session:** not from the message, so a fake player id is ignored.
- *Click 4:* a timing table (bars) for each kind of disconnection, TCP vs UDP.
- *Click 5:* what happens next, in both versions: remove the player → tell the others → new host →
  end the game if a side won → client reconnects.
- *Click 6:* "TCP sees a crash at once. A pulled cable: both need our heartbeat."

**Explain simply**
- **Broadcast.** Neither TCP nor UDP has "rooms". To tell 4 players something, the server sends it 4 times.
- **One event loop.** Node runs our code one event at a time. If a kill and a vote arrive at the
  same instant, one is fully handled before the other starts. No two pieces of code ever change
  the game at once, so no locks are needed.
- **Identity.** The server ignores any "I am player X" written inside a message. It knows who
  you are from your socket (TCP) or your address + token (UDP).

**The table (measured on 13 Nov 2026)**

| What happened | TCP | UDP | Why |
|---|---|---|---|
| Player quits normally | ~0 s | ~0 s | TCP sends FIN; UDP sends our BYE message |
| Client crashes | ~0 s | 5.0 s | the OS sends RST for TCP; UDP has nothing to send, so only silence |
| Server killed (seen by clients) | 0.2 s | 5.1 s | same reason |
| Cable pulled | 5.4 s | 5.1 s | nothing at all is sent → **both** rely on our heartbeat |
| Network back | 1.7 s | 1.0 s | TCP needs a new connection; UDP just a new HELLO |

All 38 automated checks pass on TCP, on UDP, and on UDP with 20% packet loss.

**Possible question:** *Why is a crash instant in TCP?* When a process dies, its operating
system closes its sockets and sends RST, so the other side is told. With UDP there's no
connection to close, so nothing is sent.

---

### Slide 9 · Edge cases (Nabila, 1.5 min) · 3 clicks

**On screen:** three columns, one per click, then the takeaway.
- **Game rules:** roles are sent privately · every kill is checked (role, 10 s cooldown,
  distance) · moves that are too fast or off the map are corrected.
- **Players leaving:** host leaves → new host · imposter leaves → crew wins · bad or
  unknown messages are ignored, so the server never crashes.
- **Known limits:** a reconnecting player can't rejoin a running game · restarting the server ends
  all games · UDP may drop a player after a short Wi-Fi hiccup (≈ 2.6 s).
- **Takeaway:** "The server checks every rule, so one bad client can't break the game."

**Explain simply**
- The project we started from **trusted the players**. Our first test found **16 bugs**. For
  example, the imposter's identity was in the public room list, a crewmate could kill, and a
  position of x = 99 000 was accepted.
- Now the server checks everything **with its own data**, such as its own copy of the positions.
  Move checks allow a small tolerance so normal network jitter doesn't punish honest players.
- **Known limits.** Being honest about these shows we understand the system:
  - The UDP "give up after 25 resends" can trigger after ≈ 2.6 s, which is shorter than the 5 s
    heartbeat. The fix would be exponential backoff (waiting longer after each resend).
  - Rooms live in memory, so restarting the server ends games. Accounts are saved on disk.

**Other cases handled (if asked):** the same account can't play twice at once · if the last
voter leaves, the meeting ends now · a taken color is swapped for a free one · the password check
runs outside the main thread, and if the client vanished meanwhile, the reply is dropped · in UDP,
a HELLO from an address we already know means "client restarted", so it gets a fresh session.

---

### Slide 10 · TCP vs UDP, measured (Nabila, 2.5 min) · 4 clicks

**On screen**
- *Start:* a comparison table.

  | | TCP | UDP |
  |---|---|---|
  | Connection | done by the OS | built by us (HELLO) |
  | Reliability | done by the OS | built by us |
  | Positions | can freeze | newest wins |
  | Crash seen | ~0 s | 5 s |
  | 20% loss | movement stalls | still playable |
  | Traffic, one player | ≈ 94 KB | ≈ 155 KB |
  | Code we wrote | ≈ 400 lines | ≈ 640 lines |

- *Click 1:* the counters at 20% loss (UDP, 2 clients): resends 14 · 6, duplicates 16 · 20,
  out of order 9 · 12, positions lost 41% · 37%. Theory: 1 − 0.8² = 36%. Plus the measured LAN RTT
  (fill it in).
- *Click 2:* advantages and drawbacks, 3 each per protocol.
- *Click 3:* the verdicts. TCP is best for things that must arrive. UDP is best for movement.
- *Click 4:* "Reliable for events. **Unreliable for state that expires.**"

**Explain simply**
- **20% loss test.** We dropped 20% of packets on purpose. The UDP game still finished and
  passed all 38 checks. Events were repaired by our resends. About 40% of positions were lost, but
  you barely notice, because a new one comes every 50 ms.
- **Why 36%?** A position is relayed: client → server → other client. Each hop loses 20%, so
  it survives with probability 0.8 × 0.8 = 64% and is lost 36% of the time. We measured 37–41%, close to theory.
- **TCP under the same loss:** the OS repairs everything, so nothing is lost, but positions
  arrive late and in bursts (head-of-line blocking).
- **Costs of UDP:** about 65% more traffic, because every datagram carries the token, its own
  small header and separate ACKs. And about 60% more transport code.
- **Verdict:** use reliability for events (they matter forever) and skip it for positions
  (they expire in 50 ms).

**Possible question:** *Is TCP slower?* Not on a clean LAN: the RTTs are close. The difference
shows **under loss**, where TCP stalls and UDP keeps going.

---

### Slide 11 · Challenges & optimizations (Nabila, 2 min) · 7 clicks

**On screen:** six problem cards. Each click flips one from "before" to "after", and a crewmate walks
across. Click 7 shows eight optimizations, each with a number.

| Problem | Before | After |
|---|---|---|
| Libraries hid the sockets | Socket.IO and Express: TCP hidden underneath | removed; only `net` and `dgram` |
| The browser | web pages can't open raw sockets | a local Node agent does it |
| Trusting players | players could cheat; 16 bugs | the server checks everything |
| Too many messages | up to 144 positions per second (one per frame) | 20 per second, 2 when standing still |
| Silent players | a dead player stayed "connected" forever | heartbeat: 5 s of silence = gone |
| UDP promised nothing | lost, duplicated, reordered packets | numbers, confirmations, resends, token |

**The optimizations (click 7)**
- **144 → 20** positions per second while moving, 2 when idle, and one sent at once on start/stop.
- **−⅓ traffic:** the server relays your position only to the *other* players, never back to you.
- **Smooth:** other players glide toward their latest position (30% of the way per frame) instead of jumping.
- **Push:** the room list is sent when it changes. Clients never ask repeatedly.
- **No Nagle (TCP):** small messages leave at once.
- **2 × RTT (UDP):** the resend timer adapts to the network.
- **< 1200 B (UDP):** every datagram is small enough to never be split by IP (fragmentation).
- **Off-thread:** password hashing (scrypt) runs outside the main loop, so logging in never freezes the game.

**Closing sentence of the part:** "The hardest part was not writing sockets: it was discovering
what the libraries had been doing for us."

---

### Slide 12 · Bonus & closing (Nabila, 1 min) · 1 click

**On screen:** four laptops on four different networks, joined by a Tailscale tunnel, three
facts, and a status line (edit it). *Click 1:* the closing line, "TCP gives you a promise. UDP gives you
a choice."

**Explain simply**
- The bonus challenge is playing across different networks, not only one LAN.
- **Tailscale** is a VPN that puts the four laptops on one private network. Each gets an
  address (`100.x.y.z`) the others can reach.
- **No code change:** the server already listens on every network interface (`0.0.0.0`).
- **Direct path:** if Tailscale can't connect two laptops directly, it relays through its own
  servers *over TCP*, which would hide our UDP. We check with `tailscale ping` that the path is direct.
- **Closing:** TCP gives you a promise (everything arrives, in order), and you pay with freezes.
  UDP gives you a choice (what to make reliable), and you pay with code.

**Update the status line** to what actually happened before the presentation (for example "tested on
4 networks on …" or "planned").

---

### Slide 13 · Thank you (Nabila, then everyone)

Thank the audience, invite questions, and say you can reopen any slide, file, the server log or
a Wireshark capture. Run instructions: README §5 (TCP) and §6 (UDP).

---

### Slide 14 · Backup: network weaknesses (Zeineb, only if asked) · 2 clicks

Use this slide if someone asks "what was hard in each protocol?". Click 1 reveals the TCP fixes;
click 2 reveals the UDP fixes.

| TCP problem | Our fix |
|---|---|
| No message boundaries | one JSON message per line |
| Nagle delays small writes | `setNoDelay(true)` |
| Head-of-line blocking | can't be removed; reduced with 20 Hz sends and smooth gliding |
| A dead peer is silent | PING/PONG every 1 s, 5 s timeout, reconnect every 2 s |

| UDP problem | Our fix |
|---|---|
| Datagrams get lost | seq + ACK + resend, adaptive timeout |
| Duplicates and reordering | dedupe by seq + an ordering buffer |
| No connection, no goodbye | HELLO/WELCOME sessions + token, BYE, heartbeat |
| Resends can make things worse | 100 ms minimum timeout, positions never resent, datagrams < 1200 B |

---

## 3. Glossary (plain words)

| Term | Meaning |
|---|---|
| **Transport layer** | Layer 4. Gets data to the right *program* on a computer (via ports). TCP and UDP live here. IP (layer 3) gets it to the right *computer*. |
| **Socket** | The program's "plug" into the network: an IP address + a port. |
| **Port** | A number that picks the program on a computer: our TCP server uses 5000, UDP 5001. |
| **Datagram** | One UDP packet; it arrives whole or not at all. |
| **Handshake** | The opening exchange before talking. TCP: SYN, SYN-ACK, ACK (done by the OS). Ours for UDP: HELLO → WELCOME. |
| **ACK** | "I got message number N." |
| **Seq (sequence number)** | The number given to each message, used for ACKs, duplicates and order. |
| **RTT** | Round-trip time: there and back. |
| **RTO** | Retransmission timeout: how long we wait for an ACK before resending. Ours = 2 × RTT, between 100 ms and 1 s. |
| **Head-of-line blocking** | In TCP, one lost packet delays everything behind it, because order must be kept. |
| **Nagle's algorithm** | TCP's habit of holding small writes back to group them. We turn it off. |
| **Heartbeat** | A small "I'm alive" message (PING/PONG) every second; silence for 5 s = gone. |
| **FIN / RST** | TCP's polite close / abrupt reset. |
| **Authoritative server** | The server decides everything; clients only ask. |
| **Event loop** | Node handles events one at a time, so two actions never run at the same moment. |
| **MTU / fragmentation** | The largest packet a link carries (~1500 B). Bigger packets get split by IP, which is fragile. We stay under 1200 B. |
