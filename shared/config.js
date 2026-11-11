// Single source of truth for the network version.
//
// To switch the whole game between the TCP and the UDP version, change ONE word:
export const TRANSPORT = 'tcp'; // 'tcp' | 'udp'

export const PORTS = { tcp: 5000, udp: 5001 };
export const SERVER_HOST = '127.0.0.1';

// Overrides (highest priority first), resolved in shared/transportFactory.js:
//   CLI flags   --proto tcp|udp   --server <host>   --port <n>   (--loss <pct> for UDP tests)
//   env vars    TRANSPORT=udp     SERVER_HOST=...   TRANSPORT_PORT=...
//   this file

// Timings shared by both transports (milliseconds).
export const TIMING = {
    pingIntervalMs: 1000,     // app-level PING, both directions
    timeoutMs: 5000,          // no packet for this long = connection lost ('timeout')
    reconnectGraceMs: 10000,  // a lost session can come back with its token for this long
    helloTimeoutMs: 3000,     // client gives up on the handshake after this long
    helloRetryMs: 500,        // UDP: resend HELLO this often until answered
    statsIntervalMs: 1000,    // CSV row + 'net:stats' push
};
