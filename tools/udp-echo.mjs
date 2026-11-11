#!/usr/bin/env node
// Plain UDP reachability check between two machines (no game protocol involved).
//
//   server:  node tools/udp-echo.mjs server 5001
//   client:  node tools/udp-echo.mjs <server-ip> 5001 [count=20] [interval-ms=200]
//
// The server echoes every datagram back. The client prints the RTT of each one, then loss %,
// min/avg/max RTT and jitter. Use it to check the firewall, Tailscale or a clumsy/netem setup
// before running the game. Stop the game server first: the port must be free.
import dgram from 'node:dgram';

const [mode, portArg, countArg, intervalArg] = process.argv.slice(2);
const port = Number(portArg);
if (!mode || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('usage: node tools/udp-echo.mjs server <port>\n       node tools/udp-echo.mjs <server-ip> <port> [count] [interval-ms]');
    process.exit(2);
}

if (mode === 'server') {
    const sock = dgram.createSocket('udp4');
    let n = 0;
    sock.on('message', (buf, rinfo) => {
        n++;
        sock.send(buf, rinfo.port, rinfo.address);
        if (n <= 5 || n % 50 === 0) console.log(`echo #${n} ${buf.length} B from ${rinfo.address}:${rinfo.port}`);
    });
    sock.on('error', (err) => {
        console.error(`UDP error: ${err.message}${err.code === 'EADDRINUSE' ? ' (is the game server running on this port?)' : ''}`);
        process.exit(1);
    });
    sock.bind(port, '0.0.0.0', () => console.log(`UDP echo server on 0.0.0.0:${port}. Ctrl+C to stop.`));
} else {
    const host = mode;
    const count = Number(countArg ?? 20);
    const interval = Number(intervalArg ?? 200);
    const sock = dgram.createSocket('udp4');
    const sentAt = new Map();
    const rtts = [];
    sock.on('message', (buf) => {
        const seq = buf.readUInt32BE(0);
        const t = sentAt.get(seq);
        if (t === undefined) return; // duplicate or junk
        sentAt.delete(seq);
        const rtt = performance.now() - t;
        rtts.push(rtt);
        console.log(`reply seq=${seq} rtt=${rtt.toFixed(1)} ms`);
    });
    sock.on('error', (err) => console.error(`UDP error: ${err.code || err.message}`));
    sock.bind(0, () => {
        console.log(`sending ${count} datagrams to ${host}:${port} every ${interval} ms`);
        let seq = 0;
        const timer = setInterval(() => {
            const buf = Buffer.alloc(64);
            buf.writeUInt32BE(seq, 0);
            buf.write('AU-ECHO', 4);
            sentAt.set(seq, performance.now());
            sock.send(buf, port, host);
            if (++seq >= count) {
                clearInterval(timer);
                setTimeout(report, 1500); // wait for late replies
            }
        }, interval);
    });
    const report = () => {
        const got = rtts.length;
        const loss = (100 * (count - got)) / count;
        console.log(`\n${got}/${count} replies, loss ${loss.toFixed(1)} %`);
        if (got) {
            const min = Math.min(...rtts);
            const max = Math.max(...rtts);
            const avg = rtts.reduce((a, b) => a + b, 0) / got;
            let jitter = 0;
            for (let i = 1; i < got; i++) jitter += Math.abs(rtts[i] - rtts[i - 1]);
            jitter = got > 1 ? jitter / (got - 1) : 0;
            console.log(`rtt min/avg/max ${min.toFixed(1)}/${avg.toFixed(1)}/${max.toFixed(1)} ms, jitter ${jitter.toFixed(1)} ms`);
        } else {
            console.log('No reply: wrong IP, server not running, or a firewall is blocking UDP on this port.');
        }
        sock.close();
        process.exit(got ? 0 : 1);
    };
}
