# Among Us Arena: presentation content and pitch

| | |
|---|---|
| Course | CS411 Computer Networks, Project #2 "Multiplayer Game Arena" (team of 4) |
| Demo and presentation | Friday 13 November 2026 |
| Deck | `dashboard/index.html` (13 slides, opens in Edge or Chrome, works offline) |
| Facts checked against | the working tree of branch `israa/local-implementation` on 12 Nov 2026 (code, `README.md`, test run), and `docs/PRODUCT_SPEC.md` where it is still current |

This file is the script for the deck. Each section below matches one slide: what is on screen, how many
build steps it has, who speaks, and a sample pitch. **The pitch text is the same text as the speaker notes
inside the deck** (press `N` during the presentation), so the two cannot drift apart. If you change one,
change the other.

## 1. Before you start

**Open the deck:** double-click `dashboard/index.html`, then press `F` for fullscreen.

| Key | Action |
|---|---|
| `→` or `Space` | next build step, then next slide |
| `←` | back |
| `1` to `9`, `0` | jump to slides 1 to 10; `End` jumps to the last slide, `Home` to the first |
| `N` | show or hide the speaker notes (the pitch) |
| `L` | turn simulated packet loss on or off in the race animations (slides 4 and 6) |
| `P` | pause or resume all motion |
| `F` | fullscreen |

**Fill in the yellow dashed fields** by clicking them in the deck (they are saved in that browser, so do
it on the laptop that will present):

- the four member names (typing a name once updates slides 1, 9 and 13);
- RTT for TCP and for UDP on slide 10, from the `netstats-<proto>-<pid>.csv` files of the rehearsal;
- the four network labels and the status line on slide 12.

## 2. Who says what

"Member 1" to "Member 4" are placeholders: replace them with your names. The seats match slide 9.

| Member | Slides | Seat during the live demo |
|---|---|---|
| Member 1 | 1 Title, 2 Architecture, 3 Simultaneous players, and narrates 9 Live demo | Server PC |
| Member 2 | 4 TCP version, 5 UDP version | Client 1 (creates the room, is the host) |
| Member 3 | 6 Fast lane, 7 Disconnections, 8 Network weaknesses | Client 2 |
| Member 4 | 10 Comparison, 11 Challenges, 12 Bonus, 13 Thank you | Client 3 |

Suggested timing (the brief sets no limit, so adjust to the slot you are given): about 10 minutes of
slides and about 6 minutes of live demo.

| Slide | Suggested time |
|---|---|
| 1 to 3 | 2 min 30 |
| 4 and 5 | 2 min 30 |
| 6 to 8 | 2 min 30 |
| 9 Live demo | 6 min (3 min per version) |
| 10 to 13 | 2 min 30 |

---

## 3. Slide by slide

### Slide 1. AmongUs: one game, two transports

- **Speaker:** Member 1 · **Build steps:** none
- **On screen:** an arcade-cabinet poster. The lit marquee carries the big header "AmongUs"; the
  glowing screen reads "TCP VS UDP", "SOCKET WARS", "CS411 · 13 NOV 2026"; crewmates float in front
  of the cabinet, with two yellow voxel crewmates beside the marquee. The top strip says "ONE GAME ·
  TWO TRANSPORTS". Neon signs "TCP ONLY · net · port 5000" (left) and "UDP ONLY · dgram · port 5001"
  (right); chips "net + dgram only", "0 dependencies", "1 server + 3 clients"; the four names.
- **Colour rule from slide 2 onward:** cyan and a solid pipe always mean TCP; orange and dashed capsules
  always mean UDP. (The title poster uses its own arcade palette.)

**Pitch**

> Good morning. We are four, and this is Among Us Arena: a competitive game for three players, one imposter against two crewmates, where every player has a personal score. We built it twice with the same rules: once on TCP only, once on UDP only, using nothing but Node's net and dgram modules. Everything we show today is either what each protocol gave us for free, or what we had to build ourselves.

### Slide 2. Where the sockets live

- **Speaker:** Member 1 · **Build steps:** 1
- **On screen, step 0:** a client computer (×3) with two layers, "Game UI: React + Phaser, a web page" and
  "Electron main process: a full Node.js program", joined by "IPC · inside the PC, not a socket"; a TCP
  pipe on port 5000; the server with "Game rules: events/*.js, identical in both versions", the four
  transport operations, and `tcpServer.js (net)` plugged in.
- **Step 1:** `udpServer.js (dgram)` slides into the slot, the wire becomes dashed UDP on port 5001, and
  the line "The game code never mentions `net` or `dgram`" appears.

**Pitch**

> The game screen is a web page, and a web page cannot open a raw TCP or UDP socket. So each client is an Electron desktop app: its main process is a Node program that owns the real socket, and the page talks to it through IPC, which never leaves the computer. On the server, both transports expose the same four operations: connect, message, disconnect and send. Changing the protocol means changing one file, chosen with --proto. The game rules never mention net or dgram.

### Slide 3. Three players, one server

- **Speaker:** Member 1 · **Build steps:** 3
- **On screen, step 0:** TCP panel: one listening socket plus one socket per client (`tcp-1`, `tcp-2`,
  `tcp-3`), "Session = the accepted connection". UDP panel: three clients converging on one socket on
  port 5001, "Session = remote `ip:port` after HELLO → WELCOME".
- **Step 1:** "Broadcast = one send per player".
- **Step 2:** "One event loop, no locks".
- **Step 3:** "Identity comes from the session", never from the payload; a forged kill is refused.

**Pitch**

> How do three players act at the same time? In TCP the operating system gives us one dedicated socket per client, so the connection itself is the session. In UDP there is one socket for everybody, and a datagram only tells us the sender's address and port, so we create sessions ourselves with a HELLO, WELCOME handshake. A room broadcast is simply one send per player. Node handles all clients on a single event loop, so three simultaneous actions are three events in a row, with no locks. And the server decides who you are from your session, never from what your message claims: a forged kill is refused.

### Slide 4. TCP: a reliable stream… of bytes

- **Speaker:** Member 2 · **Build steps:** 5
- **On screen, step 0:** "The OS does it": 3-way handshake, sequence numbers, ACKs, retransmission,
  in-order delivery, FIN / RST.
- **Steps 1 to 4, "We had to build":**
  1. Framing: one JSON object per line (`\n`), shown with chunks that cut a message in half.
  2. No Nagle delay: `socket.setNoDelay(true)`.
  3. Heartbeat: PING / PONG every 1 s, 5 s of silence = disconnected.
  4. Reconnect: `ECONNREFUSED → retry in 2 s`, a new connection and a new session.
- **Step 5:** the head-of-line blocking animation. Positions `p1, p2, …` walk through the pipe; one is
  ejected, the ones behind it queue at the door, and "player 2's screen" freezes until the retransmission
  arrives. Press `L` to turn the loss off and on.

**Pitch**

> TCP already gives us the handshake, sequence numbers, ACKs, retransmission and ordering, inside the kernel. What it does not give us is messages: it is a stream of bytes, so one read can contain half a message or two glued together. Our rule is one JSON object per line. We also disable Nagle so small messages leave immediately, we add our own heartbeat because a pulled cable sends nothing, and we reconnect with a brand-new connection every two seconds. Then the weakness: every byte must arrive in order, so one lost position holds back all the newer ones behind it. That is head-of-line blocking.

### Slide 5. UDP: nothing is promised. So we built it.

- **Speaker:** Member 2 · **Build steps:** 7
- **On screen, step 0:** three cards, Lost, Duplicated, Reordered, and the line "No connection. No
  delivery guarantee. No order. No goodbye."
- **Steps 1 to 6**, one tile each:
  1. Handshake: `{"t":"HELLO"}` every 1 s until `{"t":"WELCOME","sessionId":"udp-1"}`.
  2. Seq + ACK: `{"t":"MSG","seq":7,…}` answered by `{"t":"ACK","seq":7}`.
  3. Retransmit: RTO = 2 × SRTT, between 100 and 1000 ms; each resend waits twice as long (RTO, 2·RTO,
     4·RTO… at most 1 s); RTT measured with Karn's rule.
  4. Dedupe: a sequence number already delivered is acknowledged again and ignored.
  5. Order: `seq 8` waits for `seq 7`.
  6. Give up: `MAX_RETRIES = 25`; the 5 s heartbeat usually fires first.
- **Step 7:** an animated sequence diagram: `MSG seq 1` is delivered, its ACK is ejected, the RTO runs
  out, `MSG seq 1` is resent, the server ignores the duplicate and ACKs again. The counters on the right
  end at `reliableSent 1, retransmits 1, duplicatesIgnored 1, acksReceived 1`.

**Pitch**

> UDP promises nothing: a datagram can be lost, duplicated or reordered, and nobody tells us when the other side is gone. So we rebuilt the parts of TCP we needed in one file, reliableUdp.cjs. A handshake. A sequence number and an ACK for every reliable message. Retransmission after a timeout of twice the measured round-trip time, measured with Karn's rule, and doubled on every resend like TCP's exponential backoff. Duplicate detection. In-order delivery. And a limit of 25 resends before we declare the peer dead. In this example the ACK is lost: the client resends, the server recognises the duplicate, acknowledges it again, and does not deliver it twice. We also keep datagrams under 1200 bytes so IP does not have to fragment them.

### Slide 6. Not everything deserves reliability

- **Speaker:** Member 3 · **Build steps:** 1
- **On screen, step 0:** "Reliable lane `MSG`": register, join, kill, vote, game end; must arrive, once,
  in order. "Fast lane `FAST`": positions, 20 per second; no seq, no ACK, never resent; an older `n` than
  the last one seen is dropped.
- **Step 1:** the same stream of positions on a TCP lane and on a UDP lane, with the same loss. The TCP
  screen shows "frozen · waiting for p…"; the UDP screen keeps moving. Press `L` to toggle the loss.

**Pitch**

> This is the one place where we chose not to be reliable. Game events such as register, join, kill and vote use the reliable lane. Positions use the fast lane: twenty per second, no sequence number, no ACK, never resent, and an older one than the last received is dropped. Here both lanes suffer the same loss. On TCP, player two's screen freezes until the old position is recovered. On UDP the lost position is simply gone and the next one arrives 50 milliseconds later.

### Slide 7. Who left? How each protocol finds out

- **Speaker:** Member 3 · **Build steps:** 2
- **On screen, step 0:** the detection-time table (bars fill in real time):

  | Situation | TCP | UDP |
  |---|---|---|
  | Window closed normally | ~0.1 s (FIN) | ~0.1 s (BYE); 5 s if the BYE is lost |
  | Client process killed | ~0 s (the OS sends RST) | 5 s (only silence reveals it) |
  | Server killed, seen by clients | 0.2 s | 5.1 s |
  | Cable pulled (silent drop) | ~5 s (our heartbeat) | 5 s (our heartbeat) |
  | Network back | ≤ 2 s (new connection) | ~1 s (new HELLO → WELCOME) |

  Source line: measured by the automated test on one PC, `tools/smoke-client.cjs`, 45 of 45 checks pass
  on TCP and on UDP.
- **Step 1:** what the server then does in both versions: remove from room, tell the others
  (`player:left`), pass the host role, finish the meeting, end the game if a side won.
- **Step 2:** "TCP knows when the OS can tell it. For a pulled cable, both need our heartbeat."

**Pitch**

> How does each version notice that someone left? When a client process is killed, TCP knows at once, because the operating system resets the connection. UDP has no connection, so only silence reveals it, after five seconds. For a pulled cable nobody sends anything, so both versions depend on the same heartbeat: a PING every second, and 5 seconds of silence means gone. Whatever the cause, the same game code runs: remove the player, tell the others, pass the host role, finish the meeting, end the game if a side has won. Nothing crashes. The disconnected client reconnects by itself, returns to the menu, and the player logs in again.

### Slide 8. Network weaknesses: each protocol hurt us differently

- **Speaker:** Member 3 · **Build steps:** 2
- **On screen, step 0:** two columns, each listing four weaknesses in red with what they did to the game.
- **Step 1:** the TCP-only fixes appear (green bars). **Step 2:** the UDP-only fixes appear.

  | TCP only: weakness | What we did |
  |---|---|
  | No message boundaries: one read can hold half a message, or two glued together | Newline framing: one JSON object per line, safe for split UTF-8 |
  | Nagle delays small writes | `setNoDelay(true)`: every message leaves at once |
  | Head-of-line blocking: one lost segment freezes every newer position behind it | Cannot be removed, so we shrink it: 20 Hz instead of every frame, and the receiver glides |
  | A dead peer is silent: a pulled cable sends nothing; keep-alive needs about 2 hours | PING / PONG every 1 s, 5 s timeout, reconnect every 2 s |

  | UDP only: weakness | What we did |
  |---|---|
  | Datagrams get lost: a kill or a vote may never arrive | seq + ACK + resend; the timeout adapts: RTO = 2 × measured RTT |
  | Duplicates and reordering | Dedupe by seq, and a buffer that delivers in order |
  | No connection, no goodbye | HELLO → WELCOME sessions by `ip:port`, BYE, 5 s heartbeat |
  | Resends can make it worse; big datagrams get fragmented | Exponential backoff, positions never resent, datagrams under 1200 bytes |

**Pitch**

> Before the demo, here is the summary of the network weaknesses we ran into, and what we did about each one. In the TCP-only version, the stream has no message boundaries, so we frame every message with a newline. Nagle's algorithm delays small writes, so we turn it off. Head-of-line blocking cannot be removed from TCP, so we reduce its cost: positions go out 20 times per second instead of every frame, and the receiver glides toward the last position so a short stall is hidden. And a dead peer is silent, so we added a heartbeat and automatic reconnection. In the UDP-only version, datagrams get lost, so events are numbered, acknowledged and resent after a timeout that adapts to the measured round-trip time. Duplicates and reordering are handled by the sequence numbers. There is no connection, so we built sessions, a goodbye message and the same heartbeat. And to avoid making a bad network worse, each resend waits twice as long, positions are never resent, and datagrams stay under 1200 bytes so IP does not fragment them.

### Slide 9. Live demo: same script, played twice

- **Narrator:** Member 1 (at the server PC) · **Build steps:** 1
- **On screen, step 0:** the seven-step script (it is the list of mandatory features in the brief), the
  "Run 1 · TCP :5000" commands, the four seats with your names, and the reminder to watch the HUD (`F3`)
  and Wireshark (`tcp.port == 5000`, `udp.port == 5001`).
- **Step 1:** the "Run 2 · UDP :5001" commands appear. Press `→` when you switch to UDP.
- Leave this slide on the projector, or switch the projector to a client screen, during the demo. The
  full runbook is in section 4.

**Pitch**

> Now the live part. One computer runs the server and each of the other three runs a client. We play the same script twice. First on TCP: we register, including a wrong password, create a room, join it, start the game, move, kill, call a meeting and vote, and read the ranking at the end. Then we end one client's process to show the disconnection. After that we stop the server, start it again in UDP mode, and repeat exactly the same steps. Keep an eye on the HUD in the corner of each client: in the UDP run it shows our own retransmissions and duplicates, and in the TCP run it says the operating system handles them.

### Slide 10. Same game. Different behaviour.

- **Speaker:** Member 4 · **Build steps:** 3
- **On screen, step 0:** the comparison board:

  | | TCP | UDP |
  |---|---|---|
  | Connection | 3-way handshake by the OS | our HELLO → WELCOME |
  | Boundaries | none: we add `\n` framing | built in: one message per datagram |
  | Reliability | OS TCP stack, invisible to us | ours: seq, ACK, RTO, dedupe, reorder |
  | Positions | reliable: head-of-line blocking | unreliable on purpose: newest wins |
  | Under loss | stalls behind the lost segment (by design, not measured) | completes a game at 20% simulated loss per side |
  | Crash seen | instantly (RST) | 5 s (silence) |
  | Code we wrote | framing + heartbeat | a whole reliability layer |

- **Step 1:** "Counters under loss": UDP per client in one test run, retransmits 14–21, duplicates 23–35,
  out-of-order 17 (20% simulated loss on each side, run of 12 Nov 2026); TCP has nothing to count;
  the two RTT fields to fill in.
- **Step 2:** "TCP wins at: login, lobby, rooms, votes, scores. Simple code, instant crash detection."
  "UDP wins at: movement. No head-of-line blocking: loss costs one frame, not a freeze."
- **Step 3:** "Reliable for events. Unreliable for state that expires."

**Pitch**

> Here is the comparison with the metrics we chose: how each version connects, where message boundaries come from, who does the reliability, how positions behave, what happens under loss, how fast a crash is seen, and how much code we had to write. With 20 percent simulated loss on each side, a full UDP game completed in our test, and each client counted between 14 and 21 retransmissions and 23 to 35 duplicates. In TCP those counters do not exist for us, because the repairs happen inside the operating system. We did not measure TCP under loss; the stall is what its design implies. Our conclusion: TCP is the better fit for everything that must arrive, UDP for movement.

### Slide 11. Challenges faced: what broke, and how we fixed it

- **Speaker:** Member 4 · **Build steps:** 6 (one per card; a crewmate walks along as you advance)

  | Challenge | Before | After |
  |---|---|---|
  | Libraries hid the sockets | Socket.IO + Express + fetch: all TCP underneath | Removed all of it. Only Node `net` and `dgram` |
  | The browser sandbox | The game was a web page; pages cannot open raw sockets | Electron's main process owns the socket; the UI uses local IPC |
  | Trusting the client | Player id inside the payload; role fetched over HTTP | Identity from the session; role sent privately by the server |
  | Flooding the wire | A position sent on every rendered frame | 20 Hz moving, 2 Hz idle; remote players glide, snap beyond 200 px |
  | Silent peers | Connected meant the socket opened; a silent peer stayed forever | welcome + PING/PONG, 5 s timeout, automatic reconnect |
  | Bytes are not messages | TCP chunks split and merged our JSON | Newline framing with a split-UTF-8-safe decoder |

**Pitch**

> These are the challenges we faced. The project we started from used Socket.IO, Express and fetch, so everything ran over HTTP and WebSocket: TCP underneath, with the sockets hidden. We removed all of it. A browser page cannot open raw sockets, so we moved the networking into Electron. The old code trusted the player id written in each message, so we bound identity to the session. Positions were sent on every frame, so we limited them to 20 per second and smoothed the movement. A silent peer used to stay connected forever, so we added a heartbeat. And TCP cut our JSON in pieces, so we added framing. The hardest part was not writing sockets: it was discovering what the libraries had been doing for us.

### Slide 12. Bonus: four laptops, different networks

- **Speaker:** Member 4 · **Build steps:** 1
- **On screen, step 0:** Server and Clients 1 to 3, each with its network label, joined by "Tailscale
  overlay VPN · one private network on top of four real ones"; three facts: Tailscale on all 4 laptops
  (each gets a `100.x.y.z` address), server bound to `0.0.0.0`, datagrams kept under 1200 bytes (below
  the 1280-byte tunnel MTU); and the status line (default text: "planned, not yet demonstrated").
- **Step 1:** the closing line "TCP gives you a promise. UDP gives you a choice." with all the crewmates
  walking past.

**Pitch**

> For the bonus, cross-network play, our setup is Tailscale on all four laptops. It builds one private network on top of the four real ones and gives each laptop an address the others can reach. The server already listens on every interface, and our datagrams are small enough for the tunnel. One caution we are aware of: when Tailscale cannot find a direct path it relays the traffic, and that relay runs over TCP, so we present the bonus with the TCP version unless a direct path is confirmed. To close: TCP gives you a promise, and you pay for it with head-of-line blocking. UDP gives you a choice, and you pay for it with code.

### Slide 13. Thank you

- **Speaker:** Member 4, then everyone for questions · **Build steps:** none
- **On screen:** "Thank you. Questions?", the four members as crewmates with their names, and
  "TCP :5000 · UDP :5001 · Node net + dgram only".

**Pitch**

> Thank you for listening. We are happy to take your questions, and we can reopen any slide, the code or a Wireshark capture to answer them.

---

## 4. Live demo runbook

### Before the session

1. All four laptops on the same network (bring a router or a phone hotspot: campus Wi-Fi often blocks
   traffic between devices).
2. On the server PC, allow inbound TCP 5000 and UDP 5001 in Windows Firewall (README section 7).
3. On each client: `cd frontend`, `npm install`, `npm run build` (once).
4. Note the server's IP address. Open Wireshark on one machine if you want to show packets.
5. Use throwaway passwords: the login message is readable JSON on the wire.
6. Have the backup video ready in case the network fails.

### Run 1: TCP (about 3 minutes)

| Step | Who | Action | What to say or point at |
|---|---|---|---|
| 0 | Member 1 | Server: `cd backend`, `npm run tcp` | "The server listens on TCP port 5000." |
| 0 | Members 2, 3, 4 | Clients: `cd frontend`, `npm run tcp -- --server <ip>` | Window title shows `TCP → <ip>:5000 — connected`; the HUD (bottom-right) says "reliability: OS TCP stack". |
| 1 | Member 2 | Register with a name and a password. Member 3 tries Member 2's name with a wrong password. | "Wrong password" is refused by the server. |
| 2 | Member 2 | "Create Room" | The room code appears in the lobby list of the other two clients without refreshing. |
| 3 | Members 3, 4 | Join the room; Member 4 leaves and joins again | The others see the player leave and come back. |
| 4 | Member 2 (host) | "Start Game" (needs all 3 players) | Each screen shows its own role; only the imposter sees KILL. A 3-minute clock starts; the scoreboard is in the top-right corner. |
| 5 | All | Move with `Z` `Q` `S` `D`; the imposter kills one crewmate; a living player presses USE at the central table; everyone alive votes | Movement is relayed 20 times per second. The KILL button shows the 10 s cooldown. The killed player becomes a ghost who can watch but not vote. Votes are revealed when the meeting ends. |
| 6 | All | Read the end screen, then "Play again" | Winning side, why the game ended, imposter's name, ranking with points. The imposter role rotates. |
| 7 | One crewmate | End the client process in Task Manager during the second game | TCP: the server reports it immediately (the OS resets the connection). The others keep playing; the leaver stays in the final ranking, marked "left". |

Then close the remaining clients and stop the server with `Ctrl+C`.

### Run 2: UDP (about 3 minutes)

Press `→` on slide 9 so the UDP commands show.

| Step | Who | Action | What to say or point at |
|---|---|---|---|
| 0 | Member 1 | Server: `npm run udp` | "Same server, same game code, now UDP port 5001. Nothing listens on TCP." |
| 0 | Members 2, 3, 4 | Clients: `npm run udp -- --server <ip>` | Title shows `UDP → <ip>:5001 — connected`; HUD shows `retrans`, `dup`, `out-of-order`. |
| 1 to 6 | All | Repeat exactly the same steps as in run 1 | "Identical rules and screens; only the transport changed." |
| 7 | One crewmate | End the client process in Task Manager | UDP: nothing is sent, so the server needs 5 s of silence before it removes the player. |

Optional, if time allows: restart one UDP client with `--loss 0.1` and show the `retrans` and `dup`
counters climbing in its HUD while the game stays playable. Do not use `--loss 0.2` on both sides live:
that is about 36% loss per round trip, and the automated test passed only 1 of 3 runs at that level on
12 Nov 2026.

### If something goes wrong

| Symptom | What to do |
|---|---|
| TCP client says `ECONNREFUSED` | Server not started, wrong IP, or the server is running the UDP version. |
| UDP client title stays on `connecting` | Same causes, or the firewall blocks UDP 5001. |
| Works on the server PC only | Firewall rule missing, or the network isolates devices: switch to the hotspot. |
| Nothing works | Play the backup video and continue with slide 10. |

---

## 5. Questions to be ready for

Answers that match the current code:

- **"Is the UDP version really UDP only?"** Yes. The client's only socket is a `dgram` socket; the page
  has no network access and talks to Electron's main process over IPC inside the computer. The backend
  has no dependencies.
- **"Why not send everything reliably over UDP?"** Then positions would suffer the same head-of-line
  blocking as TCP. Only `player:move` and `player:moved` are unreliable.
- **"How do you know a UDP client is gone?"** A `BYE` on a clean quit; otherwise 5 s without any packet.
  The limit of 25 resends without an ACK (about 20 s with the backoff) is a second safety net.
- **"Can a client cheat?"** The server validates every request against its own state: role, range,
  cooldown, speed, map bounds. Identity comes from the session.
- **"Is the password protected?"** It is stored as a scrypt hash, but it crosses the network in clear
  text, because the wire format is readable JSON on purpose. That is a known trade-off.
- **"What happens to the disconnected player?"** The client reconnects by itself and returns to the menu.
  The player logs in again and does not rejoin the game in progress.
- **"Who is the winner?"** The winning side of each game (the crew also wins if the 3-minute clock runs
  out), plus a ranking by points that adds up across games in the room. A scoreboard is visible during
  play; it shows the scores from the start of the game, because live totals would reveal the roles.
- **"Did you test TCP under loss?"** No. `--loss` exists only for UDP; TCP losses are repaired by the OS
  below our code. The head-of-line stall on slides 4, 6, 8 and 10 is what TCP's ordering implies, shown as an
  animation, not a measurement.
- **"How many players?"** A game needs 3 players. A room holds at most 4 and the server at most 8 rooms,
  which keeps every datagram under 1200 bytes.
- **"Does the bonus work over UDP?"** Through Tailscale the game still sends UDP datagrams, but if
  Tailscale has to relay, the relay runs over TCP. Present the bonus with the TCP version, or confirm a
  direct path with `tailscale ping` first.
