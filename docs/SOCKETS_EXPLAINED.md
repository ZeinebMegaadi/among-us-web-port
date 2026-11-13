# Sockets in Among Us Arena, explained from zero

This document explains **everything about the network sockets in this project**, for both
versions (TCP and UDP). It assumes you know nothing about networking. Each idea is explained
first in plain words, then shown in our code.

**Files this document talks about**

| File | What it is |
|---|---|
| `backend/src/main.js` | Starts the server and picks TCP or UDP |
| `backend/src/transport/tcpServer.js` | The server's TCP socket code |
| `backend/src/transport/udpServer.js` | The server's UDP socket code |
| `frontend/electron/tcpClient.cjs` | The player's TCP socket code |
| `frontend/electron/udpClient.cjs` | The player's UDP socket code |
| `frontend/web/agent.cjs` | The small local program that holds the player's socket |
| `shared/lineFramer.cjs` | Cuts the TCP byte stream into messages |
| `shared/reliableUdp.cjs` | Our home-made reliability on top of UDP |
| `shared/protocol.cjs` | Numbers both sides agree on (ports, timeouts…) |

---

## Part 1 · The basics, from zero

### 1.1 What a network does

A network moves data from one computer to another. The data is cut into small pieces called
**packets**. Each packet travels on its own, like a letter in the post.

Every computer on a network has an **IP address**, for example `192.168.1.20`. It works like a
**building's street address**: it tells the network *which computer* a packet must reach.

### 1.2 Ports: which program?

A computer runs many programs at the same time: a browser, Discord, our game… When a packet
arrives, the computer must know *which program* it is for. That's what a **port** is: a number
from 0 to 65535, like an **apartment number** inside the building.

- Our TCP game server uses port **5000**.
- Our UDP game server uses port **5001**.

So "send to `192.168.1.20:5000`" means: *the computer 192.168.1.20, the program listening on port
5000.*

### 1.3 Layers: who does what

Networking is organised in layers. Each layer does one job and relies on the one below.

| Layer | Job | Analogy | In our project |
|---|---|---|---|
| **Application** (7) | What the messages mean | The letter's content | Our game messages: `room:join`, `player:kill`… |
| **Transport** (4) | Deliver to the right **program** (port) | The apartment number | **TCP** or **UDP**, which is what this project compares |
| **Network** (3) | Deliver to the right **computer** (IP address) | The street address | IP, handled by the operating system |
| Link / physical (1–2) | Move bits over Wi-Fi or a cable | The postman's van | The network card and Wi-Fi |

Our project lives at the **transport layer**. We use TCP and UDP directly, with no library on top.

### 1.4 What is a socket?

A **socket** is the "plug" a program uses to talk to the network. The program asks the **operating
system** (Windows, Linux…) to create a socket, and then reads and writes through it. The operating
system does the real work of sending packets.

A socket is identified by:
- a **protocol** (TCP or UDP),
- a **local** IP address and port (our side),
- for TCP, also a **remote** IP address and port (the other side).

In Node.js, the program language of this project:
- TCP sockets come from the built-in module **`net`**.
- UDP sockets come from the built-in module **`dgram`** ("datagram").

We use **only** these two built-in modules. No Socket.IO, no WebSocket, no networking library.

### 1.5 TCP and UDP in one picture

| | **TCP**: a phone call | **UDP**: postcards |
|---|---|---|
| Before talking | You must **connect** first (a handshake) | No connection. Just send. |
| Delivery | **Guaranteed**: lost data is resent automatically | **Not guaranteed**: a postcard can get lost |
| Order | **Guaranteed**: arrives in the order sent | Can arrive **out of order** |
| Duplicates | Never | Possible |
| Shape of data | A continuous **stream of bytes** (no message edges) | Separate **datagrams**: each one arrives whole or not at all |
| End of conversation | Each side is told when the other hangs up | Nobody is told anything |
| Who does the hard work | The operating system | **You**, if you need it |

The whole project is about this table: what TCP gives for free, what UDP doesn't, and what we built to fill the gap.

### 1.6 A few more words you'll meet

- **Server / client.** The **server** waits for others to contact it (our game server). A **client**
  contacts the server (each player).
- **Listen / bind.** A server **binds** (attaches) its socket to a port and waits there.
- **Connect.** A TCP client **connects** to the server's address and port.
- **`0.0.0.0`.** "All my network interfaces": Wi-Fi, Ethernet, VPN. Our server listens on
  `0.0.0.0` so it can be reached through any of them.
- **`127.0.0.1` (loopback, "localhost").** "This same computer". Data sent there never leaves the machine.
- **Ephemeral port.** When a client opens a socket without choosing a port, the operating system
  picks a free one for it (like `54321`). The server sees that port as the client's "return address".
- **Byte.** The basic unit of data (8 bits). A letter like `a` is 1 byte. An `é` takes 2 bytes in UTF-8.
- **JSON.** A text format for data: `{"type":"room:join","data":{"roomId":"AB12CD"}}`. All our
  messages are JSON.
- **RTT (round-trip time).** How long a message takes to go to the other side and come back.

---

## Part 2 · How the project is wired

### 2.1 The big picture

```
 ┌──────────── Player's computer ─────────────┐                ┌──── Server computer ────┐
 │                                            │                │                         │
 │  Browser tab (the game: React + Phaser)    │                │  Game rules             │
 │        │  HTTP on 127.0.0.1 (loopback,     │                │  (same code for both)   │
 │        │  never leaves this computer)      │                │        │                │
 │        ▼                                   │                │        ▼                │
 │  Local agent (Node.js, web/agent.cjs)      │   TCP :5000    │  tcpServer.js  (net)    │
 │     tcpClient.cjs → net.Socket  ───────────┼───────────────►│        or               │
 │     udpClient.cjs → dgram.Socket ──────────┼───────────────►│  udpServer.js  (dgram)  │
 │                                            │   UDP :5001    │                         │
 └────────────────────────────────────────────┘                └─────────────────────────┘
```

We have 4 computers: 3 player computers, plus the server computer, which also runs a player.

### 2.2 Why there's a "local agent"

The game runs in a normal browser tab. But **a web page is not allowed to open raw TCP or UDP
sockets**. This is a browser security rule: otherwise any website could talk to any program on your network.
Browsers only offer HTTP, WebSocket and WebRTC, which would hide the transport we must show.

So on each player's computer, a small Node.js program runs next to the browser: the **local
agent** (`frontend/web/agent.cjs`). Node *is* allowed to open sockets. The agent:
1. opens the **real** TCP or UDP socket to the game server,
2. talks to the browser tab over **loopback** (`127.0.0.1`), which never leaves the computer.

Result: **between computers, there is only our own TCP or our own UDP traffic.** In the UDP
version, not a single TCP packet of the game crosses the network. Wireshark shows this.

(There is also a desktop version built with Electron. It uses the very same `tcpClient.cjs` /
`udpClient.cjs` files, so everything below applies to both.)

### 2.3 The server: one game, two swappable transports

The server is started with **one** of the two protocols:

```
node src/main.js --proto tcp --port 5000
node src/main.js --proto udp --port 5001
```

`main.js` is the only file that knows which one is used. Both transport files offer **exactly the
same four operations**:

```js
transport.on('connect',    (sessionId, address) => {})     // a player is now reachable
transport.on('message',    (sessionId, type, data) => {})  // one complete game message arrived
transport.on('disconnect', (sessionId, reason) => {})      // the player left, crashed or timed out
transport.send(sessionId, type, data)                      // send one message to one player
```

The game rules only use these four. That's why the two versions have **identical rules**: only
the transport file underneath changes.

### 2.4 Sessions: "who is this?"

A **session** is the server's idea of one connected player. The server gives it an id it chooses
itself, never the client:

- **TCP:** one session = **one accepted TCP connection** (one socket). Ids: `tcp-1`, `tcp-2`…
- **UDP:** one session = **one address (`ip:port`) that completed our HELLO → WELCOME handshake**,
  plus a secret token. Ids: `udp-1`, `udp-2`…

When a message arrives, the server knows **who sent it from the socket or address it came
from**, never from what the message claims. A message saying `"I am player 7"` is ignored. This
stops cheating.

---

## Part 3 · The TCP version, step by step

### 3.1 The server opens a listening socket

`backend/src/transport/tcpServer.js`

```js
const server = net.createServer((socket) => { /* runs once per new player */ });
server.listen(port, '0.0.0.0');      // port 5000, on every network interface
```

The server now waits on port 5000. This first socket is only used to **accept** new players. It
never carries game messages.

### 3.2 A player connects: the 3-way handshake

`frontend/electron/tcpClient.cjs`

```js
const s = net.createConnection({ host, port });   // e.g. 192.168.1.20 : 5000
```

This makes the two operating systems perform the TCP **3-way handshake**:

```
Client                          Server
  │ ── SYN ─────────────────────► │   "I'd like to talk. My numbers start at X."
  │ ◄──────────────── SYN-ACK ─── │   "OK. Mine start at Y. I got yours."
  │ ── ACK ─────────────────────► │   "Got yours too."
```

**Our code doesn't do this. The operating system does.** We just call `createConnection`, and the
client gets a `'connect'` event when it's done. The OS also picks the client's local
**ephemeral port** (for example `54321`).

On the server, once the handshake is done, the callback of `createServer` runs and receives a
**brand-new socket dedicated to this one player**:

```js
const session = { id: `tcp-${nextId++}`, socket, address: `${socket.remoteAddress}:${socket.remotePort}`, … };
```

So with 4 players, the server has **5 sockets**: 1 listening + 4 player sockets.

Then the server sends a first message, **`welcome`**, with the session id. The client only
considers itself **connected** after receiving it. This proves the server really accepted us
and is running our game, not just "some program on port 5000".

### 3.3 Turning off Nagle's algorithm

Both sides call:

```js
socket.setNoDelay(true);
```

By default TCP uses **Nagle's algorithm**: when a program writes small pieces of data, TCP waits a
little to group them into one bigger packet. That saves bandwidth for file transfers, but adds
**delay** to a game that sends small messages 20 times per second. `setNoDelay(true)` turns it
off, so every message leaves immediately.

### 3.4 Sending a message

```js
socket.write(JSON.stringify({ type, data }) + '\n');
```

Two things to know:
1. `write()` doesn't send anything by itself. It **copies the bytes into the operating system's
   send buffer**. The OS sends them, and resends them if they are lost.
2. Every message ends with a **newline `\n`**. That's our **framing rule**, explained next.

Example of what really travels on the wire:

```
{"type":"room:join","data":{"roomId":"AB12CD"}}\n{"type":"PING","data":{"ts":1731270000000}}\n
```

### 3.5 Receiving: the framing problem

This is the most important thing to understand about TCP.

**TCP is a stream of bytes, not a stream of messages.** It's like water in a pipe: it doesn't know
where one message ends and the next begins. When the receiver reads, it gets a **chunk** of
whatever bytes have arrived so far. One chunk might contain:
- **half** a message: `{"type":"ro`
- **exactly** one message,
- or **two and a half** messages glued together: `oms:get"}\n{"type":"PING"}\n{"ty`

The sender's `write()` calls are **not** preserved on the other side.

**Our solution: one JSON message per line** (`shared/lineFramer.cjs`).

```js
socket.on('data', (chunk) => framer.push(chunk));
```

The `LineFramer`:
1. adds each new chunk to a **buffer**,
2. looks for `\n` in the buffer,
3. everything before a `\n` is one complete message, which it parses as JSON and hands to the game,
4. anything after the last `\n` stays in the buffer until the next chunk completes it.

Why `\n` is safe as a separator: `JSON.stringify` never puts a real newline inside its output (a
newline inside a string becomes the two characters `\` `n`). So `\n` can only mean "end of message".

Two extra protections inside the framer:
- **Split characters.** A character like `é` or an emoji takes several bytes, and a chunk can end in
  the middle of one. A `StringDecoder` keeps the incomplete bytes until the rest arrives.
- **Garbage guard.** If 64 KB pile up without any `\n`, the data is garbage or an attack, so the
  buffer is cleared.

### 3.6 The heartbeat: noticing a silent player

**Why we need it.** If a player's program closes normally, or crashes, the operating system tells
the other side (see 3.7). But if a **cable is pulled**, Wi-Fi dies, or a laptop lid is closed,
**nothing at all is sent**. The other side has no way to know. TCP's own "keep-alive" feature only
checks after about **2 hours** by default.

**Our heartbeat** (numbers in `shared/protocol.cjs`):
- The client sends **`PING`** every **1 second**, containing the current time: `{"type":"PING","data":{"ts":1731270000000}}`.
- The server answers **`PONG`** with the same time. The client computes **RTT = now − ts**.
- Each side remembers `lastHeardAt`, the last time *any* byte arrived from the other.
- Every 0.5 s each side checks: **nothing heard for 5 seconds → the other side is gone.** The
  server closes the session; the client destroys its socket and reconnects.

### 3.7 How a TCP connection ends

| What happens | What TCP sends | What our code sees | Time to notice |
|---|---|---|---|
| Player quits normally | **FIN** ("I'm done"), sent by `socket.end()` | `'close'` event | ~0 s |
| Player's program crashes | The OS sends **RST** ("this connection is dead") | `'error'` (`ECONNRESET`) then `'close'` | ~0 s |
| Cable pulled / Wi-Fi gone | **Nothing** | nothing… until our heartbeat timeout | ~5 s |

In every case the server's `closeSession()` runs once: it removes the session and emits
`'disconnect'` to the game, which removes the player, tells the others, and so on.

Errors the client can show (translated in `describeError`):
- `ECONNREFUSED`: nothing is listening on that port (the server isn't running).
- `ECONNRESET`: the server's connection was reset (for example it was killed).
- `ETIMEDOUT`, `EHOSTUNREACH`, `ENETUNREACH`: the network can't reach the server.
- `ENOTFOUND`: unknown host name.

### 3.8 Reconnecting

**A closed TCP connection can never be reused.** So after any disconnection, the client waits
**2 seconds** and opens a **brand-new** connection: new handshake, new local port, new session on
the server (`tcp-5`, for example). This repeats every 2 s until it works.

### 3.9 What the operating system did for us (and its price)

Inside the OS, invisible to our code, TCP:
- numbers every byte (**sequence numbers**),
- confirms what it received (**ACKs**),
- **resends** what was lost,
- delivers everything **in order**, with **no duplicates**,
- slows down if the receiver or the network can't keep up (**flow control** and **congestion control**).

Our code **never sees a lost packet**. That's the "promise" of TCP.

**The price: head-of-line blocking.** Because TCP *must* deliver in order, if one packet is lost,
every packet behind it waits until the lost one is resent and arrives. For a position update,
that's absurd: by the time the old position arrives, it's already out of date, but the newer
positions were stuck behind it. On a lossy network, other players **freeze, then jump**.

### 3.10 A TCP life story

```
Client                                                    Server
  createConnection(server:5000)
  ── SYN / SYN-ACK / ACK (done by the OS) ───────────────── accepted → socket for "tcp-3"
                                         ◄── {"type":"welcome","data":{"sessionId":"tcp-3"}}\n
  state = connected
  ── {"type":"player:register",…}\n ───────────────────────►  framer → game
  ── {"type":"PING","data":{"ts":…}}\n (every 1 s) ─────────►
                                         ◄── {"type":"PONG","data":{"ts":…}}\n   (RTT measured)
  ── {"type":"player:move",…}\n (20 per second) ───────────►  relayed to the other players
  socket.end()  ── FIN ─────────────────────────────────────►  'close' → disconnect "tcp-3"
```

---

## Part 4 · The UDP version, step by step

### 4.1 One socket for everyone

`backend/src/transport/udpServer.js`

```js
const socket = dgram.createSocket('udp4');   // 'udp4' = UDP over IPv4
socket.bind(port, '0.0.0.0');                 // port 5001, every interface
```

That's the **only** socket the server uses, for **all** players. There's no "accept" and no
per-player socket, because UDP has no connections.

Receiving:

```js
socket.on('message', (buffer, rinfo) => { … });
```

Each call gives **one whole datagram** (`buffer`) and **who sent it** (`rinfo.address`,
`rinfo.port`). The sender's address comes from the packet's IP/UDP headers, filled in by the
network, not from our message.

Sending:

```js
socket.send(bytes, port, address);   // one datagram to one address
```

On the client (`udpClient.cjs`):

```js
const socket = dgram.createSocket('udp4');
socket.bind(0);   // 0 = "OS, pick any free port for me"
```

The client also has **one socket for its whole life**, even across reconnections.

**Good news compared to TCP:** UDP **keeps message boundaries**. One `send()` = one datagram = one
`'message'` event on the other side. So **no framing is needed**: each datagram contains exactly one
JSON object.

**Bad news:** UDP promises nothing else. A datagram can be **lost**, **duplicated**, or arrive **out of
order**, and nobody is told when a player disappears. Everything TCP did in the kernel, we had to
build in our own code, **only where the game needs it**.

### 4.2 Our packet kinds

Every datagram is one JSON object with a field **`t`** (the packet kind):

| `t` | Direction | Meaning |
|---|---|---|
| `HELLO` | client → server | "I want to join" (our handshake) |
| `WELCOME` | server → client | "You're in. Here's your session id and your secret token" |
| `PING` / `PONG` | client → server / back | Heartbeat + RTT measurement |
| `BYE` | either | "I'm leaving", or "I don't know you, say HELLO again" |
| `MSG` | either | A **reliable** game message (numbered, must be confirmed) |
| `ACK` | either | "I received message number N" |
| `FAST` | either | An **unreliable** game message (positions only) |

### 4.3 Our own handshake and the session token

UDP has no connection, so we invented a small handshake:

```
Client                                              Server
  ── {"t":"HELLO"} (every 1 s until answered) ──────►  creates session "udp-2" for 192.168.1.31:54321
                                                       token = 8 random bytes → "9f2c41d07ab3e815"
       ◄── {"t":"WELCOME","sessionId":"udp-2","proto":"udp","tok":"9f2c41d07ab3e815"}
  state = connected
  ── every later datagram carries "tok":"9f2c41d07ab3e815" (both directions) ──►
```

- The server stores sessions in a map **"ip:port" → session**. That's how it tells players apart on its single socket.
- The client sends HELLO **every second** until a WELCOME comes back, because a HELLO or a WELCOME can be lost.

**Why a token?** In UDP it's easy to *fake* a sender address: anyone can write a packet that
claims to come from your `ip:port`. The token is a **secret** (64 random bits) that only the
server and that player know, because it was sent once in WELCOME. Every later datagram must carry it.
- Right address but **wrong or missing token** → the packet is **dropped silently**. It also doesn't
  count as "heard from this player", so it can't keep a dead session alive.
- The client also ignores server packets without its token.

**Special cases the server handles:**
- **A HELLO from an address it already knows** means the client restarted, so its message
  numbers start again from 1. The server throws away the old session and creates a fresh one.
- **A packet from an unknown address** (for example the server restarted, or already timed the player
  out) gets a reply of `{"t":"BYE","reason":"unknown session, send HELLO"}`, without a token since the server
  has none for it. The client goes back to its HELLO loop.

### 4.4 Reliability we built ourselves (`shared/reliableUdp.cjs`)

Both sides use a `ReliableChannel`: the server has one per player, and the client has one to the server.
It adds five things, **only for important messages**: log in, join, start, kill, vote, game end…

**1. Sequence numbers.** Each reliable message gets the next number:

```json
{"t":"MSG","seq":7,"type":"player:kill","data":{…},"tok":"…"}
```

The sender keeps it in an **"unacked" list** (waiting for confirmation).

**2. Acknowledgements (ACK).** The receiver **always** answers:

```json
{"t":"ACK","seq":7,"tok":"…"}
```

When the sender gets the ACK, it removes message 7 from the unacked list.

**3. Retransmission.** Every **50 ms**, `tick()` looks at the unacked list. Any message waiting
longer than the **retransmission timeout (RTO)** is sent again.

**4. Duplicate removal.** The receiver remembers `expectedSeq`, the next number it's allowed to
deliver. If a message with a smaller number arrives, it was **already delivered**. The receiver
**ACKs it again** but **doesn't deliver it twice**. Why ACK again? A duplicate usually means *our
ACK was lost*, so the sender is still waiting. Without a new ACK it would keep resending forever.
A vote must never count twice.

**5. In-order delivery.** If message 8 arrives while the receiver is still waiting for 7, message 8
is **kept in a waiting buffer**. When 7 finally arrives, the receiver delivers 7, then 8, in order.

**A worked example (the ACK gets lost):**

```
Client                                         Server
  MSG seq=1 "player:register"  ───────────────►  delivered to the game ✔, expectedSeq = 2
                               ◄── ACK seq=1 ✖ (lost on the way)
  (no ACK after the RTO…)
  MSG seq=1 (retransmission)  ───────────────►  seq 1 < expectedSeq 2 → duplicate:
                                                 ACK again, do NOT deliver again
                               ◄── ACK seq=1 ✔
  seq 1 removed from the unacked list
```

The game saw `player:register` **exactly once**, even though the network lost a packet.

### 4.5 How long to wait before resending (RTO)

If we resend **too early**, we flood the network with useless copies. If we resend **too late**,
the game feels slow. So the waiting time **adapts to the network**, like TCP does:

1. When an ACK arrives for a message sent **only once**, we measure the round trip: `sample = now − sentAt`.
2. We smooth it so one slow packet doesn't change everything: **SRTT = 0.875 × SRTT + 0.125 × sample**.
   (SRTT = "smoothed RTT", mostly the old value plus a little of the new one.)
3. **RTO = 2 × SRTT**, kept between **100 ms** and **1000 ms**. Before any measurement, RTO = **200 ms**.

**Karn's rule:** we only measure on messages sent once. If a message was resent, we can't know
whether the ACK answers the first copy or the second, so the measurement would be wrong. TCP uses the same rule.

**Giving up:** if one message is resent **25 times** without an ACK, the other side is considered
dead. On a LAN the RTO stays at its 100 ms floor, so that's about **2.6 seconds**.

### 4.6 The fast lane: positions skip reliability on purpose

Positions (`player:move` from a client, `player:moved` relayed by the server) are sent **20 times
per second** while moving (every 50 ms), and 2 per second when standing still. They're listed in
`UNRELIABLE_TYPES` in `shared/protocol.cjs` and travel as **`FAST`** packets:

```json
{"t":"FAST","n":345,"type":"player:move","data":{"x":512,"y":300,…},"tok":"…"}
```

- **No ACK, never resent.** If one is lost, a newer one arrives 50 ms later anyway. Resending the
  old one would deliver **the past**.
- **`n` is a counter** (1, 2, 3…). The receiver remembers the highest `n` seen **per player**. If an
  older one arrives late, it's **dropped** ("stale"), so an old position never overwrites a newer one.
- **Loss is counted**: a jump from `n=10` to `n=13` means 11 and 12 were lost. That's how the HUD and
  our measurements show "positions lost: 37–41%" at 20% packet loss.

This is the key design choice of the UDP version: **reliable for events, unreliable for state that
expires**. And it's why, under packet loss, **TCP freezes but UDP keeps moving**: there's no
head-of-line blocking on the fast lane.

### 4.7 Heartbeat and disconnections in UDP

UDP never tells you that the other side left. We have **three detectors**:

| Detector | How | Typical time |
|---|---|---|
| **BYE** | When a player quits, the client sends `{"t":"BYE"}`. The server closes the session at once. | ~0 s |
| **Silence** | PING every 1 s (answered by PONG). Nothing heard for **5 s** → gone. | 5 s |
| **Too many resends** | A reliable message resent 25 times with no ACK → gone. | ≈ 2.6 s (only when messages are waiting) |

BYE is just a datagram, so **it can be lost too**. That's exactly why the silence timeout also exists.

On the server, every **50 ms** a timer checks each session: silence → close; `tick()` returned
"too many retries" → close.

On the client, after any disconnection it **forgets its reliability channel** (and any messages
still waiting for an ACK) and goes back to the **HELLO loop**. On reconnecting, both sides start a
fresh channel with numbers starting at 1 again.

### 4.8 Keeping datagrams small (MTU)

Every network link has a maximum packet size, the **MTU**: about 1500 bytes on Ethernet and Wi-Fi,
1280 inside the Tailscale VPN. A bigger datagram would be **split by IP into fragments**, and if
any fragment is lost, the whole datagram is lost. So we keep every datagram under **1200 bytes**
(`MAX_DATAGRAM_BYTES`). Both sides print a warning if one is ever bigger. Ours are much smaller.

### 4.9 Simulating a bad network

To test our reliability, both the UDP server and the UDP client accept `--loss 0.2`, which drops
20% of datagrams **on purpose**, before they're handed to the OS or right after they're received. The HUD
then shows our counters going up: retransmits, duplicates ignored, out-of-order, positions lost.

TCP ignores `--loss`. Its losses are repaired by the operating system **below** our code, and we
can't drop "a message" from the middle of a byte stream without corrupting it. To test TCP under
loss, you have to damage the real network with a tool like *clumsy* (Windows) or *tc netem* (Linux).

### 4.10 A Windows quirk

When a UDP client sends to a port where no server is listening, Windows may report an ICMP "port
unreachable" message as an `ECONNRESET` **error on the UDP socket**. That's surprising, since UDP has no
connection. The client just logs it and keeps sending HELLO every second, so it doesn't crash.

### 4.11 A UDP life story

```
Client (one dgram socket, bound to a random port)        Server (one dgram socket on :5001)
  ── {"t":"HELLO"} ──────────────────────────────────►  new session "udp-2" + token
                    ◄── {"t":"WELCOME","sessionId":"udp-2","tok":"9f2c…"}
  ── {"t":"MSG","seq":1,"type":"player:register",…,"tok":…} ─►  ACK + delivered to the game
                    ◄── {"t":"ACK","seq":1,"tok":…}
  ── {"t":"PING","ts":…,"tok":…} (every 1 s) ────────►
                    ◄── {"t":"PONG","ts":…,"tok":…}    (RTT measured)
  ── {"t":"FAST","n":1,"type":"player:move",…} (20/s) ─►  relayed as FAST to the other players
  ── {"t":"BYE","reason":"client quit","tok":…} ─────►  session "udp-2" closed at once
```

---

## Part 5 · Things that work the same in both versions

### 5.1 Sending to a whole room

Neither TCP nor UDP has "rooms" or "send to a group". To tell 4 players something, the server
simply **sends it 4 times**, once per player (`sendToRoom` in `main.js`):
- TCP: 4 `write()` calls on 4 different sockets.
- UDP: 4 datagrams from the same socket, to 4 different addresses.

A player's position is relayed **only to the other players**, never echoed back to the sender. That
saves about a third of the position traffic.

The lobby's room list is **pushed** to everyone whenever a room changes. Clients never have to ask repeatedly.

### 5.2 One thing at a time (the event loop)

Node.js runs our code on **one thread**, handling **one event at a time**. If a kill and a vote
arrive at the same instant, one is fully handled before the other starts, and the second sees the
updated game. So two pieces of code never change the game at the same moment: **no locks, no race
conditions**, with any number of players.

### 5.3 What happens after any disconnection

Whatever the cause (FIN, RST, BYE, heartbeat timeout, too many resends), the transport emits **one**
`'disconnect'` event, and the same game code runs in both versions: remove the player from the room
→ tell the others why → pick a new host if needed → close a meeting if they were the last voter → end
the game if a side has now won. The disconnected client reconnects by itself.

---

## Part 6 · TCP and UDP side by side in this project

| | **TCP version** | **UDP version** |
|---|---|---|
| Node module | `net` | `dgram` |
| Server port | 5000 | 5001 |
| Server sockets | 1 listening + **1 per player** | **1 for everyone** |
| Client socket | a new one for each connection | one for the client's whole life |
| Connection setup | 3-way handshake, **done by the OS** | our **HELLO → WELCOME**, done by us |
| "Who is this?" | the socket itself | sender `ip:port` **+ secret token** |
| Message boundaries | **none**: we add `\n` framing | built in: 1 datagram = 1 message |
| Lost data | resent by the OS | resent by us (seq + ACK + RTO), **events only** |
| Duplicates | never | removed by us (seq) |
| Order | guaranteed by the OS | restored by us (waiting buffer), events only |
| Positions | reliable → can **freeze** (head-of-line blocking) | `FAST`: never resent, newest wins |
| Normal quit | FIN → seen at once | BYE → seen at once (if not lost) |
| Crash | RST → seen at once | only silence → 5 s |
| Pulled cable | our heartbeat → ~5 s | our heartbeat → ~5 s |
| Reconnect | new connection every 2 s | back to HELLO every 1 s |
| Packet size limit | none for us (TCP splits the stream) | we keep datagrams under 1200 B |
| Congestion control | yes, built into TCP | none (we never resend faster than 100 ms) |
| Transport code we wrote | ≈ 400 lines | ≈ 640 lines |

**In one sentence:** TCP gives you a promise (everything arrives, in order) and you pay with
freezes; UDP gives you a choice (what to make reliable) and you pay with code.

---

## Part 7 · The browser ↔ agent link (loopback)

This link isn't part of the TCP/UDP comparison, but you should know how it works.

- The agent runs a tiny web server with Node's built-in `http` module, **only on `127.0.0.1`**
  (port 8080, or 8081, 8082… if busy). Other computers can't reach it.
- `GET /` serves the game files.
- `GET /net/events` is a **Server-Sent Events** stream: the agent **pushes** each game message
  from the server to the page as it arrives, plus status and stats every second.
- `POST /net/send` is how the page sends game messages to the agent, which then sends them on the real socket.
- It checks the `Host` and `Origin` headers, so another website open in the same browser can't
  control the game.
- **Closing the game tab = leaving the game.** After 5 s with no tab open, the agent calls
  `client.close()`, which sends **FIN** (TCP) or **BYE** (UDP), and exits.

Loopback traffic never leaves the computer. Wireshark capturing on the Wi-Fi or Ethernet card
doesn't see it.

---

## Part 8 · Seeing the sockets for yourself

**Run it** (details in the README):

```
server>  npm run tcp                          (or: npm run udp)
client>  npm run tcp -- --server <server ip>  (or: npm run udp -- --server <server ip>)
```

**Server log:** each session opening and closing, with the reason:

```
[TCP] + tcp-3 connected from 192.168.1.31:54321
[TCP] - tcp-3 disconnected (connection reset)
[UDP] - udp-2 disconnected (timeout: nothing received for 5 s)
```

**In-game HUD (<kbd>F3</kbd>):** RTT, messages and bytes per second, and in UDP our own counters
(retransmits, duplicates ignored, out-of-order, positions lost). The same numbers are saved every second in
a CSV file.

**Wireshark filters**

| Filter | Shows |
|---|---|
| `tcp.port == 5000` | the TCP version: you'll see SYN / SYN-ACK / ACK, then our JSON lines, then FIN or RST |
| `udp.port == 5001` | the UDP version: one datagram per message; open one to read the JSON (`"t":"MSG"`, `"seq"`…) |
| `tcp` during a UDP game | nothing from the game, proof that the UDP version uses no TCP |

---

## Part 9 · Questions you might be asked

**Why not just use WebSockets or Socket.IO?** They run on top of TCP and hide it. We must show the
transport layer itself, and the UDP version must use no TCP at all.

**Is the token encryption?** No. It's an identity check. It stops someone from faking a player's
address, but the traffic isn't encrypted. Someone who can *read* the traffic on the network could
see the token. Encryption would be the next step.

**Why does TCP see a crash instantly but UDP doesn't?** When a process dies, its operating system
closes its TCP sockets and sends RST, so the other side is told. A UDP socket has no connection to
close, so nothing is sent, and only silence reveals it.

**Why do positions skip reliability?** A position is replaced 50 ms later. Resending a lost one
would deliver an outdated position *and* delay newer ones.

**Why 2 × RTT for the timeout?** The ACK should normally arrive after one RTT. Doubling it leaves
room for normal variation, so we don't resend messages that were only slightly late.

**Why does the server listen on `0.0.0.0`?** So it works on any network interface (Wi-Fi, Ethernet,
or a VPN like Tailscale) without knowing its own IP address.

**What's the difference between FIN and RST?** FIN is a polite goodbye after all data is sent
(`socket.end()`). RST is an abrupt "this connection no longer exists", for example when the process
was killed or a packet arrives for a connection the OS doesn't know.

**Can two players be on the same computer?** Yes. Each client gets its own ephemeral port from the
OS, so the server sees two different `ip:port` pairs (UDP) or two different connections (TCP).

**What's the weakest point of our UDP version?** After 25 resends (≈ 2.6 s on a LAN) a player is
declared dead, which is sooner than the 5 s heartbeat. A short Wi-Fi hiccup can drop someone.
The fix would be **exponential backoff**: wait longer after each failed resend.

---

## Glossary

| Term | Meaning |
|---|---|
| **ACK** | "I received message number N." |
| **Buffer** | A memory area where data waits (for example bytes waiting for a `\n`, or messages waiting for a gap to fill). |
| **Datagram** | One UDP packet; it arrives whole or not at all. |
| **Ephemeral port** | A temporary port the OS picks for a client. |
| **Event loop** | Node runs one event at a time, on one thread. |
| **FIN / RST** | TCP's polite close / abrupt reset. |
| **Framing** | Rules to find where each message starts and ends in a byte stream. Ours: one JSON per line. |
| **Handshake** | The opening exchange before talking. TCP: SYN, SYN-ACK, ACK. Ours for UDP: HELLO → WELCOME. |
| **Head-of-line blocking** | In TCP, one lost packet delays everything behind it. |
| **Heartbeat** | Regular "I'm alive" messages (PING/PONG) to detect silent failures. |
| **IP address** | Which computer. |
| **Karn's rule** | Only measure RTT on messages that were sent once. |
| **Loopback (127.0.0.1)** | This same computer; the data never leaves it. |
| **MTU / fragmentation** | Maximum packet size on a link; bigger packets get split, which is fragile. |
| **Nagle's algorithm** | TCP's habit of delaying small writes to group them. We turn it off. |
| **Port** | Which program on a computer. |
| **RTO** | Retransmission timeout: how long to wait for an ACK before resending. |
| **RTT / SRTT** | Round-trip time / its smoothed average. |
| **Seq (sequence number)** | The number given to each reliable message. |
| **Session** | The server's record of one connected player (`tcp-3`, `udp-2`). |
| **Socket** | A program's plug into the network (protocol + address + port). |
| **Token** | A random secret given in WELCOME that proves a UDP datagram really comes from that player. |
