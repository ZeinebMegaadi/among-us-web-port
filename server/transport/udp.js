// UDP server transport: one dgram socket on 0.0.0.0, sessions identified by an 8-byte token.
//
// Contract (same as server/transport/tcp.js):
//   start(port)  stop()  send(id, msg, {reliable})  broadcast(ids, msg, {reliable})  stats(id)  sessionIds()
//   events: 'connect' (id) | 'message' (id, msg) | 'disconnect' (id, 'closed'|'timeout')
//           'lost' (id, reason)  no packet for TIMING.timeoutMs, session kept for TIMING.reconnectGraceMs
//           'reconnect' (id)     a valid packet with the token arrived again inside the grace period
//
// Sessions: the peer address ALWAYS comes from rinfo, never from the payload. A packet with a
// valid token from a new ip:port re-binds the session (NAT rebinding, Wi-Fi change...).
// Handshake: client HELLO {proto, v, nonce} with an all-zero token -> server HELLO {sessionId,
// resumed} carrying the new token in the header. Retried HELLOs (same addr + nonce) get the same
// answer, so a lost reply never creates a second session.
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
    APP_VERSION, PACKET, ZERO_TOKEN, decodePacket, encodePacket, encodeMessage, tokenToHex, HANDSHAKE_ERROR,
} from '../../shared/protocol.js';
import { UdpConnection } from '../../shared/reliability.js';
import { createLossySender } from '../../shared/lossSim.js';
import { TIMING } from '../../shared/config.js';

const PROTO = 'udp';
const TICK_MS = 20;
const MAX_SESSIONS = 256;
const HELLO_CACHE_MS = 10000;
const REJECT_RATE_MS = 500; // at most one "unknown session" BYE per address per 500 ms

export default class UdpServerTransport extends EventEmitter {
    /** @param {{timing?: object, logger?: Console, lossSim?: object|null}} [options] */
    constructor(options = {}) {
        super();
        this.proto = PROTO;
        this.supportsLossSim = true; // built-in --loss simulator
        this.timing = { ...TIMING, ...options.timing };
        this.logger = options.logger ?? console;
        this.lossSimOptions = options.lossSim ?? null;
        /** @type {Map<string, object>} */
        this.sessions = new Map();
        /** @type {Map<string, object>} token hex -> session */
        this.byToken = new Map();
        /** @type {Map<string, {session: object, at: number}>} "ip:port:nonce" -> session */
        this.helloCache = new Map();
        this.rejectedAt = new Map();
        this.dropped = {}; // reason -> count, for diagnostics
        this.socket = null;
        this.timer = null;
    }

    // ------------------------------------------------------------------ contract

    start(port, host = '0.0.0.0') {
        return new Promise((resolve, reject) => {
            const socket = dgram.createSocket('udp4');
            this.socket = socket;
            socket.once('error', reject);
            socket.on('message', (buf, rinfo) => {
                try {
                    this._onDatagram(buf, rinfo);
                } catch (err) {
                    // Last line of defence: one bad packet must never crash the server.
                    this.logger.error(`[udp] error handling packet from ${rinfo.address}:${rinfo.port}:`, err);
                }
            });
            socket.bind(port, host, () => {
                socket.off('error', reject);
                socket.on('error', (err) => this.logger.error('[udp] socket error:', err.message));
                const lossy = createLossySender(
                    (b, port, address) => {
                        try {
                            this.socket.send(b, port, address);
                        } catch { /* socket closed (e.g. a delayed simulated packet after stop()) */ }
                    }, this.lossSimOptions ?? {});
                this.lossSim = lossy.counters;
                this._rawSendVia = lossy.send;
                this.timer = setInterval(() => this._tick(), TICK_MS);
                resolve(socket.address());
            });
        });
    }

    async stop() {
        clearInterval(this.timer);
        for (const session of this.sessions.values()) {
            if (session.state === 'active') session.conn.sendControl(PACKET.BYE, { reason: 'server shutdown' });
            clearTimeout(session.graceTimer);
            session.conn.close();
        }
        this.sessions.clear();
        this.byToken.clear();
        await new Promise((resolve) => setTimeout(resolve, 20)); // let the BYEs leave
        await new Promise((resolve) => this.socket ? this.socket.close(() => resolve()) : resolve());
    }

    send(sessionId, msg, { reliable = true } = {}) {
        const session = this.sessions.get(sessionId);
        return session ? session.conn.sendMessage(msg, reliable) : false;
    }

    broadcast(sessionIds, msg, { reliable = true } = {}) {
        let body;
        try {
            body = encodeMessage(msg); // encode once for everybody
        } catch (err) {
            this.logger.warn(`[udp] not broadcasting ${msg?.t}: ${err.message}`);
            return 0;
        }
        let sent = 0;
        for (const id of sessionIds) {
            const session = this.sessions.get(id);
            if (session && session.conn.sendEncoded(body, reliable, msg.t)) sent++;
        }
        return sent;
    }

    stats(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? session.conn.stats() : null;
    }

    sessionIds() {
        return [...this.sessions.keys()];
    }

    // ------------------------------------------------------------------ packets

    _sendTo(address, buf) {
        // All outgoing datagrams go through the (optional) loss simulator.
        this._rawSendVia(buf, address.port, address.address);
    }

    _drop(reason) {
        this.dropped[reason] = (this.dropped[reason] ?? 0) + 1;
    }

    _onDatagram(buf, rinfo) {
        const packet = decodePacket(buf);
        if (!packet.ok) return this._drop(packet.reason); // bad magic / version / size: silently ignored
        const { header, payload } = packet;

        if (header.type === PACKET.HELLO) return this._onHello(header, payload, rinfo, buf.length);

        const session = this.byToken.get(tokenToHex(header.token));
        if (!session) {
            this._drop('unknown token');
            if (header.type !== PACKET.BYE) this._reject(rinfo, HANDSHAKE_ERROR.UNKNOWN_SESSION, 'Session expired or unknown');
            return;
        }
        this._touch(session, rinfo, buf.length);
        if (header.type === PACKET.BYE) return this._finish(session, 'closed');
        session.conn.handlePacket(header, payload);
    }

    /** A valid packet for this session: refresh liveness, re-bind the address, resume if lost. */
    _touch(session, rinfo, bytes) {
        session.lastRecv = Date.now();
        session.conn.counters.bytesIn += bytes;
        if (session.address.address !== rinfo.address || session.address.port !== rinfo.port) {
            this.logger.log(`[udp] session ${session.id} re-bound ${session.address.address}:${session.address.port} -> ${rinfo.address}:${rinfo.port}`);
            session.address = { address: rinfo.address, port: rinfo.port };
        }
        if (session.state === 'lost') {
            clearTimeout(session.graceTimer);
            session.graceTimer = null;
            session.state = 'active';
            session.conn.resume();
            this.logger.log(`[udp] session ${session.id} reconnected from ${rinfo.address}:${rinfo.port}`);
            this._emitSafe('reconnect', session.id);
        }
    }

    _onHello(header, payload, rinfo, bytes) {
        let d;
        try {
            d = JSON.parse(payload.toString('utf8'));
        } catch {
            return this._drop('bad hello');
        }
        if (!d || typeof d !== 'object') return this._drop('bad hello');
        if (d.proto !== PROTO) {
            return this._reject(rinfo, HANDSHAKE_ERROR.PROTO_MISMATCH, `This server speaks ${PROTO}, client said ${d.proto}`, true);
        }
        if (d.v !== APP_VERSION) {
            return this._reject(rinfo, HANDSHAKE_ERROR.VERSION_MISMATCH, `Server protocol v${APP_VERSION}, client v${d.v}`, true);
        }

        // Resume: HELLO carrying an existing token (client reconnecting after a timeout).
        if (!header.token.equals(ZERO_TOKEN)) {
            const session = this.byToken.get(tokenToHex(header.token));
            if (!session) return this._reject(rinfo, HANDSHAKE_ERROR.UNKNOWN_SESSION, 'Session expired or unknown', true);
            this._touch(session, rinfo, bytes);
            this._welcome(session, true);
            return;
        }

        // New session (or a retried HELLO whose answer was lost).
        const key = `${rinfo.address}:${rinfo.port}:${d.nonce}`;
        const cached = this.helloCache.get(key);
        if (cached && this.sessions.has(cached.session.id)) {
            this._touch(cached.session, rinfo, bytes);
            this._welcome(cached.session, false);
            return;
        }
        if (this.sessions.size >= MAX_SESSIONS) return this._drop('server full');

        let token;
        do token = crypto.randomBytes(8); while (token.equals(ZERO_TOKEN) || this.byToken.has(tokenToHex(token)));
        const session = {
            id: crypto.randomUUID(),
            token,
            tokenHex: tokenToHex(token),
            address: { address: rinfo.address, port: rinfo.port },
            state: 'active',
            lastRecv: Date.now(),
            graceTimer: null,
        };
        session.conn = new UdpConnection({
            token,
            timing: this.timing,
            logger: this.logger,
            sendRaw: (buf) => this._sendTo(session.address, buf),
            onMessage: (msg) => this._emitSafe('message', session.id, msg),
        });
        session.conn.counters.bytesIn += bytes;
        this.sessions.set(session.id, session);
        this.byToken.set(session.tokenHex, session);
        this.helloCache.set(key, { session, at: Date.now() });
        this.logger.log(`[udp] session ${session.id} connected from ${rinfo.address}:${rinfo.port}`);
        this._welcome(session, false);
        this._emitSafe('connect', session.id);
    }

    _welcome(session, resumed) {
        session.conn.sendControl(PACKET.HELLO, { sessionId: session.id, resumed, proto: PROTO, v: APP_VERSION });
    }

    /** Tell a peer we won't talk to it (BYE with a reason code), rate-limited per address. */
    _reject(rinfo, code, message, force = false) {
        const key = `${rinfo.address}:${rinfo.port}`;
        const now = Date.now();
        if (!force && now - (this.rejectedAt.get(key) ?? 0) < REJECT_RATE_MS) return;
        this.rejectedAt.set(key, now);
        const buf = encodePacket({ type: PACKET.BYE, token: ZERO_TOKEN }, encodeMessage({ code, message }));
        this._sendTo({ address: rinfo.address, port: rinfo.port }, buf);
    }

    // ------------------------------------------------------------------ lifecycle

    _tick() {
        const now = Date.now();
        const perf = performance.now();
        for (const session of this.sessions.values()) {
            if (session.state !== 'active') continue;
            if (now - session.lastRecv > this.timing.timeoutMs) {
                this._markLost(session, 'timeout');
                continue;
            }
            session.conn.tick(perf);
        }
        if (this.helloCache.size) {
            for (const [key, entry] of this.helloCache) if (now - entry.at > HELLO_CACHE_MS) this.helloCache.delete(key);
        }
        if (this.rejectedAt.size > 1000) this.rejectedAt.clear();
    }

    _markLost(session, reason) {
        session.state = 'lost';
        session.conn.suspend(); // keep reliable messages queued; they are resent on reconnect
        this.logger.log(`[udp] session ${session.id} lost (${reason}), waiting ${this.timing.reconnectGraceMs} ms for a reconnect`);
        this._emitSafe('lost', session.id, reason);
        if (this.timing.reconnectGraceMs <= 0) return this._finish(session, reason);
        session.graceTimer = setTimeout(() => this._finish(session, reason), this.timing.reconnectGraceMs);
    }

    _finish(session, reason) {
        if (!this.sessions.has(session.id)) return;
        clearTimeout(session.graceTimer);
        session.conn.close();
        this.sessions.delete(session.id);
        this.byToken.delete(session.tokenHex);
        this.logger.log(`[udp] session ${session.id} disconnected (${reason})`);
        this._emitSafe('disconnect', session.id, reason);
    }

    _emitSafe(event, ...args) {
        try {
            this.emit(event, ...args);
        } catch (err) {
            this.logger.error(`[udp] '${event}' handler threw:`, err);
        }
    }
}
