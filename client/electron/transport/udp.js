// UDP client transport (Electron main process): dgram + the shared reliability layer.
//
// Shared client API (same as client/electron/transport/tcp.js), used by NetClient:
//   connect(host, port) -> Promise<{sessionId}>   rejects with err.code: HELLO_TIMEOUT | ENOTFOUND |
//                                                  proto-mismatch | version-mismatch
//   send(msg, {reliable}) -> boolean               reliable: retransmitted + ordered; unreliable: latest wins
//   close()                                        sends BYE, then closes
//   stats() -> { rttMs, jitterMs, bytesIn, bytesOut, retransmits, lost }
//   events: 'message' (msg) | 'lost' (reason) | 'reconnect' () | 'disconnect' (reason)
//   fields: proto, state ('idle'|'connecting'|'connected'|'reconnecting'|'closed'), sessionId
//
// Keep-alive: UdpConnection.tick() sends a PING every second, so the NAT mapping stays open and
// the server's 5 s timeout never fires on an idle but healthy client.
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
    APP_VERSION, PACKET, ZERO_TOKEN, decodePacket, encodePacket, encodeMessage, HANDSHAKE_ERROR,
} from '../../../shared/protocol.js';
import { UdpConnection } from '../../../shared/reliability.js';
import { createLossySender } from '../../../shared/lossSim.js';
import { RttTracker, newCounters, statsSnapshot } from '../../../shared/metrics.js';
import { TIMING } from '../../../shared/config.js';

const PROTO = 'udp';
const TICK_MS = 20;

const codedError = (code, message) => Object.assign(new Error(message), { code });

export default class UdpClientTransport extends EventEmitter {
    /** @param {{timing?: object, logger?: Console, lossSim?: object|null}} [options] */
    constructor(options = {}) {
        super();
        this.proto = PROTO;
        this.supportsLossSim = true; // built-in --loss simulator
        this.timing = { ...TIMING, ...options.timing };
        this.logger = options.logger ?? console;
        this.lossSimOptions = options.lossSim ?? null;
        this.state = 'idle';
        this.sessionId = null;
        this.token = null;
        this.conn = null;
        this.socket = null;
        this.timer = null;
        this.paused = false;
        this.handshake = null;
        this.handshakeBytes = { in: 0, out: 0 };
        this.nonce = crypto.randomUUID();
        this.lossy = createLossySender((buf) => {
            try {
                (this.socket ?? this.closingSocket)?.send(buf, this.port, this.serverAddress);
            } catch { /* socket closed */ }
        }, this.lossSimOptions ?? {});

        // Test-only hooks used by tools/transport-test.mjs to simulate network failures.
        this.__test = {
            /** Stop sending and receiving, like a pulled cable. */
            pause: () => { this.paused = true; },
            resume: () => { this.paused = false; },
            /** Continue from a new local port, like a NAT rebinding or a Wi-Fi change. */
            rebind: async () => {
                const old = this.socket;
                await this._openSocket();
                old.close();
            },
        };
    }

    async connect(host, port) {
        if (this.state !== 'idle' && this.state !== 'closed') throw new Error(`already ${this.state}`);
        this.state = 'connecting';
        this.host = host;
        this.port = port;
        try {
            ({ address: this.serverAddress } = await dns.lookup(host, { family: 4 }));
        } catch (err) {
            this.state = 'closed';
            throw codedError(err.code || 'ENOTFOUND', `Cannot resolve ${host}: ${err.message}`);
        }
        await this._openSocket();

        try {
            await new Promise((resolve, reject) => {
                const hello = encodePacket({ type: PACKET.HELLO, token: ZERO_TOKEN },
                    encodeMessage({ proto: PROTO, v: APP_VERSION, nonce: this.nonce }));
                const sendHello = () => {
                    this.handshakeBytes.out += hello.length;
                    this.lossy.send(hello);
                };
                const retry = setInterval(sendHello, this.timing.helloRetryMs);
                const timeout = setTimeout(() => done(codedError('HELLO_TIMEOUT',
                    `No HELLO reply from a UDP game server at ${host}:${port} within ${this.timing.helloTimeoutMs} ms`)),
                this.timing.helloTimeoutMs);
                const done = (err) => {
                    clearInterval(retry);
                    clearTimeout(timeout);
                    this.handshake = null;
                    if (err) reject(err); else resolve();
                };
                this.handshake = { done };
                sendHello();
            });
        } catch (err) {
            this._stop();
            throw err;
        }
        this.state = 'connected';
        this.lastRecv = Date.now();
        this.timer = setInterval(() => this._tick(), TICK_MS);
        return { sessionId: this.sessionId };
    }

    send(msg, { reliable = true } = {}) {
        if (!this.conn || this.state === 'closed') return false;
        return this.conn.sendMessage(msg, reliable);
    }

    close() {
        if (this.state === 'closed') return;
        if (this.conn && this.state !== 'connecting') {
            // BYE is unreliable: send it 5 times over 60 ms so a lossy link doesn't turn a clean
            // leave into a 'timeout' (all 5 lost at 20 % loss: 0.03 %).
            const conn = this.conn;
            conn.sendControl(PACKET.BYE, {});
            conn.sendControl(PACKET.BYE, {});
            conn.sendControl(PACKET.BYE, {});
            for (const delay of [30, 60]) setTimeout(() => conn.sendControl(PACKET.BYE, {}), delay).unref?.();
        }
        this._stop();
        this.emit('disconnect', 'closed');
    }

    stats() {
        return this.conn ? this.conn.stats() : statsSnapshot(new RttTracker(), newCounters());
    }

    // ------------------------------------------------------------------ internals

    async _openSocket() {
        const socket = dgram.createSocket('udp4');
        socket.on('message', (buf, rinfo) => {
            if (socket !== this.socket) return; // old socket after a rebind
            try {
                this._onDatagram(buf, rinfo);
            } catch (err) {
                this.logger.error('[udp] error handling packet:', err);
            }
        });
        socket.on('error', (err) => this.logger.warn(`[udp] socket error: ${err.code || err.message}`));
        await new Promise((resolve) => socket.bind(0, resolve));
        this.socket = socket;
    }

    _onDatagram(buf, rinfo) {
        if (this.paused) return;
        // Only the server we talk to; everything else is noise or spoofing.
        if (rinfo.address !== this.serverAddress || rinfo.port !== this.port) return;
        const packet = decodePacket(buf);
        if (!packet.ok) return;
        const { header, payload } = packet;

        if (header.type === PACKET.BYE) {
            let d = {};
            try { d = JSON.parse(payload.toString('utf8')); } catch { /* empty BYE */ }
            if (this.handshake) return this.handshake.done(codedError(d.code || 'HANDSHAKE', d.message || 'Refused'));
            if (!header.token.equals(ZERO_TOKEN) && this.token && !header.token.equals(this.token)) return;
            return this._finish(d.code === HANDSHAKE_ERROR.UNKNOWN_SESSION ? 'expired' : 'closed');
        }

        if (this.handshake) {
            if (header.type !== PACKET.HELLO) return;
            let d;
            try { d = JSON.parse(payload.toString('utf8')); } catch { return; }
            if (!d?.sessionId) return;
            this.token = Buffer.from(header.token);
            this.sessionId = d.sessionId;
            this.conn = new UdpConnection({
                token: this.token,
                timing: this.timing,
                logger: this.logger,
                sendRaw: (b) => this.lossy.send(b),
                onMessage: (msg) => this.emit('message', msg),
            });
            this.handshakeBytes.in += buf.length;
            this.conn.counters.bytesIn += this.handshakeBytes.in;
            this.conn.counters.bytesOut += this.handshakeBytes.out;
            return this.handshake.done();
        }

        if (!this.conn || !header.token.equals(this.token)) return;
        this.lastRecv = Date.now();
        this.conn.counters.bytesIn += buf.length;
        if (this.state === 'reconnecting') {
            // Any packet with our token (the HELLO reply, or data) means the server kept our session.
            this.state = 'connected';
            this.conn.resume();
            this.logger.log('[udp] reconnected, session resumed');
            this.emit('reconnect');
        }
        if (header.type === PACKET.HELLO) return; // reply to a resume HELLO
        this.conn.handlePacket(header, payload);
    }

    _tick() {
        if (this.paused || !this.conn) return;
        const now = Date.now();
        if (this.state === 'connected') {
            if (now - this.lastRecv > this.timing.timeoutMs) {
                this.state = 'reconnecting';
                this.conn.suspend();
                this.reconnectDeadline = now + this.timing.reconnectGraceMs;
                this.lastHello = 0;
                this.logger.warn(`[udp] no packet for ${this.timing.timeoutMs} ms; reconnecting for ${this.timing.reconnectGraceMs} ms`);
                this.emit('lost', 'timeout');
            } else {
                this.conn.tick(performance.now());
                return;
            }
        }
        if (this.state === 'reconnecting') {
            if (now > this.reconnectDeadline) return this._finish('timeout');
            if (now - this.lastHello >= this.timing.helloRetryMs) {
                this.lastHello = now;
                this.conn.sendControl(PACKET.HELLO, { proto: PROTO, v: APP_VERSION, nonce: this.nonce });
            }
        }
    }

    _finish(reason) {
        if (this.state === 'closed') return;
        this._stop();
        this.emit('disconnect', reason);
    }

    _stop() {
        this.state = 'closed';
        clearInterval(this.timer);
        this.timer = null;
        this.conn?.close();
        const socket = this.socket;
        this.socket = null;
        if (socket) {
            // Keep the socket open briefly so the BYEs (and simulated-delay packets) can leave.
            this.closingSocket = socket;
            setTimeout(() => socket.close(), 120).unref?.();
        }
    }
}
