# Network tests: TCP vs UDP

How to show the jury that the two versions differ only in the transport, and how each one behaves
under packet loss. Ports: **TCP 5000**, **UDP 5001** (from `shared/config.js`).

## 0. Setup

| Machine | Command |
|---|---|
| Server laptop | `npm run server:tcp` or `npm run server:udp` (prints `PROTOCOL: TCP/UDP` and its IPs) |
| Each of the 3 clients | `npm run client:tcp -- --server <server-ip>` or `npm run client:udp -- --server <server-ip>` |

The client window title always shows the live version, for example `Among Us Arena: UDP @ 192.168.1.10:5001`.
If a client and the server use different protocols, the client shows a dialog that explains it
(for example "No answer from a UDP game server... If it runs the TCP version (port 5000), start this
client with --proto tcp") and keeps retrying. It never hangs silently.

**Firewall (Windows, server laptop, admin PowerShell):**

```powershell
New-NetFirewallRule -DisplayName "AU Arena TCP" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow
New-NetFirewallRule -DisplayName "AU Arena UDP" -Direction Inbound -Protocol UDP -LocalPort 5001 -Action Allow
```

**Check that UDP gets through before playing** (stop the game server first; it uses the same port):

```bash
node tools/udp-echo.mjs server 5001          # on the server laptop
node tools/udp-echo.mjs <server-ip> 5001     # on a client: prints RTT, loss %, jitter
```

## 1. Automated transport tests (no OS tools needed)

```bash
npm run test:transport                                   # protocol from shared/config.js
npm run test:all                                         # TCP and UDP
node tools/transport-test.mjs --proto udp --loss 20      # 20 % drop + 10 % dup + 10 % reorder, both directions
node tools/transport-test.mjs --proto udp --loss 20 --seed 7   # replay one exact random sequence
node tools/transport-test.mjs --all --real-timings       # use the real 5 s timeout / 10 s grace (slower)
```

The suite checks: 3 clients, framing (partial and coalesced TCP frames), in-order exactly-once delivery
(300 messages in each direction per client), UDP dedupe and re-ACK, gap buffering, the unreliable
channel never going backwards, 40 KB messages (split into datagrams under 1200 bytes on UDP), stats,
malformed input, clean close, timeout detection, reconnect with the same token, UDP token re-bind
from a new port, wrong-protocol errors, and the `shared/config.js` switch.

The built-in loss simulator also works in the real game, for a demo without admin rights (UDP only):
`npm run server:udp -- --loss 20` and `npm run client:udp -- --server <ip> --loss 20`.

## 2. Packet loss runs: 0 / 5 / 10 / 20 %

Run every level on **both** versions, with the same 3 players and the same moves (walk in circles,
one meeting, one kill), for about 2 minutes per level. Metrics are logged automatically, one row per
second per session, to `logs/<proto>-<date>.csv` on the server and on every client (`side` column).
That is the data for the slide-5 chart.

### Windows: clumsy (on one client PC, run as administrator)

Download clumsy from https://jagt.github.io/clumsy/ and use one of these filters:

| Version | clumsy filter |
|---|---|
| TCP | `tcp.DstPort == 5000 or tcp.SrcPort == 5000` |
| UDP | `udp.DstPort == 5001 or udp.SrcPort == 5001` |

Tick **Drop**, set **Chance** to 5, 10, then 20 %, and click Start. Inbound and outbound are both
ticked by default, so loss applies in both directions. Optional: add **Lag** at 50 ms to look like
a WAN.

### Linux: tc netem (on a client or on the server)

```bash
IF=eth0   # or wlan0, or tailscale0 for the cross-network setup
sudo tc qdisc add dev $IF root netem loss 5%     # first level
sudo tc qdisc change dev $IF root netem loss 10%
sudo tc qdisc change dev $IF root netem loss 20%
sudo tc qdisc del dev $IF root                   # back to normal
```

netem only impairs **outgoing** traffic. To impair both directions, run it on the server and on the
client, or add `delay 50ms` to look like a WAN. To impair only the game port and not SSH:

```bash
sudo tc qdisc add dev $IF root handle 1: prio
sudo tc qdisc add dev $IF parent 1:3 handle 30: netem loss 10%
sudo tc filter add dev $IF protocol ip parent 1:0 u32 match ip dport 5001 0xffff flowid 1:3   # 5000 for TCP
```

### What you should see

| Loss | TCP version | UDP version |
|---|---|---|
| 0 % | Smooth. `retransmits` and `lost` stay 0. | Smooth. `retransmits` and `lost` near 0. |
| 5 % | Mostly smooth, short hitches. RTT and jitter rise. | Smooth. A few `lost` (unreliable updates skipped). A few `retransmits` on reliable messages. |
| 10 % | Remote players **freeze, then jump** (head-of-line blocking: one lost segment holds back every later update until TCP resends it). RTT and jitter spikes. | Still fluid: a lost position update is simply replaced by the next one. `lost` grows. `retransmits` only on reliable messages (room, start, kill, vote, rpc). |
| 20 % | Long freezes and big jumps. TCP's retransmission timeout backs off exponentially, so stalls can reach seconds. A stall over 5 s can trigger `lost` → `reconnect`. | Movement visibly choppier but it never freezes. Every reliable message still arrives in order. `retransmits` grows. |

How to read the columns:

- **`retransmits`, `lost` on TCP are always 0 in the CSV.** TCP retransmits inside the OS kernel,
  where Node cannot see it. Show those retransmissions in Wireshark instead (section 4): the
  difference itself is part of the comparison.
- **UDP `lost`** = unreliable datagrams from the peer that never arrived (gaps in the unreliable
  sequence). **UDP `retransmits`** = reliable datagrams this side resent. They only come from reliable
  messages, never from movement.
- **`rttMs`** = smoothed RTT (EWMA 1/8), measured by the 1 s PING/PONG (plus ACKs on UDP).
  **`jitterMs`** = mean deviation between consecutive RTT samples.
- Movement update rate: the current game sends a `player:move` every frame while moving (about 16 ms),
  so a lost update on UDP is replaced within one frame. With a 20 Hz server snapshot tick it would be
  replaced 50 ms later.

## 3. Disconnection tests

Do each one in the lobby, during play and during a meeting, on both versions:

| Action | Expected |
|---|---|
| Close a client window | Server: `disconnected (closed)` immediately (BYE). The game removes the player. |
| Kill a client process (Task Manager) | TCP: `lost (closed)` immediately (the OS resets the connection). UDP: `lost (timeout)` after 5 s. Then `disconnected` 10 s later. |
| Pull the cable or turn off Wi-Fi for 3 s, then restore | `lost (timeout)` at 5 s if the outage lasts that long, then `reconnected`. Same player, same room, the game continues. |
| Pull the cable for 20 s | `lost (timeout)` at 5 s, `disconnected (timeout)` at 15 s. The client window title shows `(disconnected)` and it rejoins as a new session. |
| Stop the server (Ctrl+C) | Clients get BYE: title `(disconnected)`, then they retry every 3 s until the server is back. |

The 10 s reconnect grace is `TIMING.reconnectGraceMs` in `shared/config.js`. Set it to 0 if a player
must be removed right at the 5 s timeout. See `server/transport/README.md` for the full event sequence.

## 4. Wireshark

Capture on the client's physical interface on a LAN. In the Tailscale setup, capture on the
**Tailscale** interface: the physical interface only shows encrypted WireGuard traffic.

| Filter | Shows |
|---|---|
| `tcp.port == 5000` | All game traffic of the TCP version |
| `udp.port == 5001` | All game traffic of the UDP version |
| `tcp and ip.addr == <server-ip>` | **UDP version: must show 0 packets.** The game uses no HTTP, no WebSocket, no TCP at all. |
| `tcp.analysis.retransmission and tcp.port == 5000` | TCP retransmissions under loss (the kernel retransmits the app cannot see) |
| `udp.port == 5001 and udp.payload[0:3] == 41:55:01` | Our datagrams: magic `AU` + version 1 |
| `udp.port == 5001 and udp.payload[3:1] == 02` | DATA (03 = ACK, 04 = PING, 05 = PONG, 01 = HELLO, 06 = BYE) |
| `udp.port == 5001 and udp.payload[4:1] == 01` | Reliable DATA (flag bit 0). `03` = reliable fragment of a bigger message. |

(On an older Wireshark without `udp.payload`, use `data.data[...]` with the same offsets.)

**Reading a UDP datagram** (25-byte header, then JSON):

```
41 55 | 01 | 02 | 01 | xx xx xx xx xx xx xx xx | 00 00 00 2a | 00 00 00 11 | ff ff ff ff | {"t":"player:kill",...}
"AU"   ver  type flags  session token (8 bytes)   seq = 42      ack = 17      ack bits    JSON payload
```

A retransmission shows up as the same `seq` sent again after about 2 × RTT (minimum 100 ms).

**Reading a TCP frame:** 4-byte big-endian length, then JSON (`Follow > TCP Stream` shows the
messages as text, for example `....{"t":"player:move","d":{...}}`).

The renderer is blocked from making any HTTP/HTTPS/WebSocket request (`client/electron/main.js`,
`blockNetworkRequests`), and the UI loads from local files (`app://`). So the capture contains only
the selected game transport.
