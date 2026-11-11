#!/usr/bin/env node
// Among Us Arena: authoritative game server.
//
//   npm run start:server                  protocol from shared/config.js
//   npm run server:tcp | server:udp       force a protocol
//   node server/main.js --proto udp --port 5001 [--loss 20 --seed 1]
//   TRANSPORT=udp node server/main.js
//
// The protocol is resolved in shared/transportFactory.js (CLI flag > env var > shared/config.js);
// this file never names a protocol itself.
import os from 'node:os';
import { resolveNetConfig, createTransport } from '../shared/transportFactory.js';
import { CsvStatsLogger } from '../shared/metrics.js';
import { TIMING } from '../shared/config.js';
import { attachGame } from './gameAdapter.js';

// A bug or a hostile client must never take the server down.
process.on('uncaughtException', (err) => console.error('[server] uncaught exception (server keeps running):', err));
process.on('unhandledRejection', (err) => console.error('[server] unhandled rejection (server keeps running):', err));

let cfg;
try {
    cfg = resolveNetConfig();
} catch (err) {
    console.error(`[server] ${err.message}`);
    process.exit(1);
}

const transport = await createTransport('server', cfg.proto, {
    lossSim: cfg.loss > 0 ? { loss: cfg.loss, seed: cfg.seed } : null,
});
attachGame(transport);

try {
    await transport.start(cfg.port);
} catch (err) {
    const why = err.code === 'EADDRINUSE' ? `port ${cfg.port} is already in use (another server running?)` : err.message;
    console.error(`[server] cannot start: ${why}`);
    process.exit(1);
}

function lanAddresses() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
        for (const a of list ?? []) {
            if (a.family !== 'IPv4' || a.internal) continue;
            const tailscale = a.address.startsWith('100.') ? ' (Tailscale?)' : '';
            out.push(`${a.address}${tailscale} [${name}]`);
        }
    }
    return out;
}

const P = cfg.proto.toUpperCase();
const line = '='.repeat(64);
console.log(line);
console.log(`  Among Us Arena server   PROTOCOL: ${P}   (chosen by ${cfg.source.proto})`);
console.log(`  listening on 0.0.0.0:${cfg.port} (${P})`);
for (const a of lanAddresses()) console.log(`  reachable at ${a}`);
console.log(`  clients: npm run client:${cfg.proto} -- --server <one of the IPs above>`);
console.log(`  heartbeat ${TIMING.pingIntervalMs} ms, timeout ${TIMING.timeoutMs} ms, reconnect grace ${TIMING.reconnectGraceMs} ms`);
if (cfg.loss > 0) {
    console.log(transport.supportsLossSim
        ? `  SIMULATED LOSS: ${cfg.loss}% drop + ${cfg.loss / 2}% duplicate + ${cfg.loss / 2}% reorder on outgoing datagrams`
        : `  --loss ignored: the ${P} transport has no built-in simulator (use clumsy / tc netem, see NETWORK_TESTS.md)`);
}
console.log(line);

// One CSV row per session per second: logs/<proto>-<date>.csv
const csv = new CsvStatsLogger({ proto: cfg.proto, side: 'server' });
let lastSummary = 0;
setInterval(() => {
    const ids = transport.sessionIds();
    for (const id of ids) {
        const s = transport.stats(id);
        if (s) csv.log(id, s);
    }
    if (Date.now() - lastSummary >= 10000 && ids.length) {
        lastSummary = Date.now();
        const parts = ids.map((id) => {
            const s = transport.stats(id);
            return `${id.slice(0, 8)} rtt=${s.rttMs ?? '-'}ms jit=${s.jitterMs}ms rtx=${s.retransmits} lost=${s.lost}`;
        });
        console.log(`[server] ${ids.length} session(s): ${parts.join(' | ')}`);
    }
}, TIMING.statsIntervalMs).unref();

const shutdown = async () => {
    console.log('\n[server] shutting down, saying BYE to clients...');
    await transport.stop();
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
