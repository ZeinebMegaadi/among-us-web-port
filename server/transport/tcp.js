// TCP server transport: net.Server + length-prefix framing + 1 s PING / 5 s timeout.
//
// Contract (same as server/transport/udp.js):
//   start(port)  stop()  send(id, msg, {reliable})  broadcast(ids, msg, {reliable})  stats(id)  sessionIds()
//   events: 'connect' (id) | 'message' (id, msg) | 'disconnect' (id, 'closed'|'timeout')
//           'lost' (id, reason)  connection dropped, session kept for TIMING.reconnectGraceMs
//           'reconnect' (id)     same client came back with its token inside the grace period
// {reliable} is ignored: everything on a TCP stream is reliable and ordered.
import net from 'node:net';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
    APP_VERSION, FrameDecoder, encodeFrame, decodeMessage, TCP_CONTROL as C, HANDSHAKE_ERROR,
} from '../../shared/protocol.js';
import { RttTracker, newCounters, statsSnapshot } from '../../shared/metrics.js';
import { TIMING } from '../../shared/config.js';

const PROTO = 'tcp';
const MAX_OUTBOX = 500;              // messages kept for a lost session (flushed on reconnect)
const MAX_WRITE_BUFFER = 1024 * 1024; // a peer that stops reading this long is dropped
const CHECK_INTERVAL_MS = 250;

export default class TcpServerTransport extends EventEmitter {
    /** @param {{timing?: object, logger?: Console}} [options] */
    constructor(options = {}) {
        super();
        this.proto = PROTO;
        this.supportsLossSim = false; // built-in --loss simulator (TCP: use clumsy / tc netem instead)
        this.timing = { ...TIMING, ...options.timing };
        this.logger = options.logger ?? console;
        /** @type {Map<string, object>} sessionId -> session */
        this.sessions = new Map();
        /** @type {Map<string, object>} token -> session */
        this.byToken = new Map();
        /** @type {Set<object>} live connections (with or without a session) */
        this.conns = new Set();
        this.server = null;
        this.timer = null;
        this.lastPing = 0;
    }

    // ------------------------------------------------------------------ contract

    start(port, host = '0.0.0.0') {
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => this._onSocket(socket));
            this.server.once('error', reject);
            this.server.listen(port, host, () => {
                this.server.off('error', reject);
                this.server.on('error', (err) => this.logger.error('[tcp] server error:', err.message));
                this.timer = setInterval(() => this._tick(), CHECK_INTERVAL_MS);
                resolve(this.server.address());
            });
        });
    }

    async stop() {
        clearInterval(this.timer);
        for (const session of this.sessions.values()) {
            if (session.conn) this._write(session.conn, { t: C.BYE, d: { reason: 'server shutdown' } });
            clearTimeout(session.graceTimer);
        }
        for (const conn of this.conns) conn.socket.end();
        await new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
        for (const conn of this.conns) conn.socket.destroy();
        this.sessions.clear();
        this.byToken.clear();
    }

    send(sessionId, msg, _opts = {}) {
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        let frame;
        try {
            frame = encodeFrame(msg);
        } catch (err) {
            this.logger.warn(`[tcp] not sending ${msg?.t}: ${err.message}`);
            return false;
        }
        return this._sendFrame(session, frame);
    }

    broadcast(sessionIds, msg, _opts = {}) {
        let frame;
        try {
            frame = encodeFrame(msg); // encode once for everybody
        } catch (err) {
            this.logger.warn(`[tcp] not broadcasting ${msg?.t}: ${err.message}`);
            return 0;
        }
        let sent = 0;
        for (const id of sessionIds) {
            const session = this.sessions.get(id);
            if (session && this._sendFrame(session, frame)) sent++;
        }
        return sent;
    }

    stats(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? statsSnapshot(session.rtt, session.counters) : null;
    }

    sessionIds() {
        return [...this.sessions.keys()];
    }

    // ------------------------------------------------------------------ connections

    _onSocket(socket) {
        socket.setNoDelay(true); // no Nagle: small game messages go out immediately
        const conn = {
            socket,
            decoder: new FrameDecoder(),
            session: null,
            openedAt: Date.now(),
            lastSeen: Date.now(),
            closeReason: 'closed',
            remote: `${socket.remoteAddress}:${socket.remotePort}`,
        };
        this.conns.add(conn);

        socket.on('data', (chunk) => this._onData(conn, chunk));
        socket.on('error', (err) => {
            // ECONNRESET etc.: 'close' always follows, cleanup happens there.
            this.logger.warn(`[tcp] socket error ${conn.remote}: ${err.code || err.message}`);
        });
        socket.on('close', () => this._onClose(conn));
    }

    _onData(conn, chunk) {
        conn.lastSeen = Date.now();
        if (conn.session) conn.session.counters.bytesIn += chunk.length;
        let frames;
        try {
            frames = conn.decoder.push(chunk);
        } catch (err) {
            // Oversize length prefix: the stream can't be resynchronised, drop the connection.
            this.logger.warn(`[tcp] dropping ${conn.remote}: ${err.message}`);
            conn.socket.destroy();
            return;
        }
        for (const frame of frames) {
            let msg;
            try {
                msg = decodeMessage(frame);
            } catch (err) {
                this.logger.warn(`[tcp] bad frame from ${conn.remote}: ${err.message}`);
                continue; // framing is still aligned, skip just this frame
            }
            this._onMessage(conn, msg);
            if (conn.socket.destroyed) return;
        }
    }

    _onMessage(conn, msg) {
        const session = conn.session;
        switch (msg.t) {
            case C.HELLO:
                return this._onHello(conn, msg.d);
            case C.PING:
                return this._write(conn, { t: C.PONG, d: { ts: msg.d?.ts } });
            case C.PONG:
                if (session && Number.isFinite(msg.d?.ts)) session.rtt.sample(performance.now() - msg.d.ts);
                return;
            case C.BYE:
                if (session) {
                    session.byeReceived = true;
                    conn.socket.end();
                }
                return;
            default:
                if (!session) return; // no game traffic before the handshake
                this._emitSafe('message', session.id, msg);
        }
    }

    _onHello(conn, d) {
        if (conn.session) return; // duplicate HELLO on the same connection
        const reject = (code, message) => {
            this._write(conn, { t: C.ERROR, d: { code, message } });
            conn.socket.end();
        };
        if (d?.proto !== PROTO) {
            return reject(HANDSHAKE_ERROR.PROTO_MISMATCH, `This server speaks ${PROTO}, client said ${d?.proto}`);
        }
        if (d?.v !== APP_VERSION) {
            return reject(HANDSHAKE_ERROR.VERSION_MISMATCH, `Server protocol v${APP_VERSION}, client v${d?.v}`);
        }

        if (d.token) {
            const session = this.byToken.get(String(d.token));
            if (!session) return reject(HANDSHAKE_ERROR.UNKNOWN_SESSION, 'Session expired or unknown');
            return this._resume(conn, session);
        }

        const session = {
            id: crypto.randomUUID(),
            token: crypto.randomBytes(8).toString('hex'),
            conn: null,
            state: 'active',
            rtt: new RttTracker(),
            counters: newCounters(),
            outbox: [],
            graceTimer: null,
            byeReceived: false,
        };
        this.sessions.set(session.id, session);
        this.byToken.set(session.token, session);
        this._attach(conn, session);
        this._write(conn, { t: C.WELCOME, d: { sessionId: session.id, token: session.token, resumed: false, proto: PROTO } });
        this.logger.log(`[tcp] session ${session.id} connected from ${conn.remote}`);
        this._emitSafe('connect', session.id);
    }

    _resume(conn, session) {
        const wasLost = session.state === 'lost';
        if (session.conn && session.conn !== conn) {
            // Client noticed the drop before we did: retire the old connection silently.
            const old = session.conn;
            old.session = null;
            old.socket.destroy();
        }
        clearTimeout(session.graceTimer);
        session.graceTimer = null;
        session.state = 'active';
        this._attach(conn, session);
        this._write(conn, { t: C.WELCOME, d: { sessionId: session.id, token: session.token, resumed: true, proto: PROTO } });
        const pending = session.outbox;
        session.outbox = [];
        for (const frame of pending) this._sendFrame(session, frame);
        this.logger.log(`[tcp] session ${session.id} reconnected from ${conn.remote}${wasLost ? '' : ' (replaced live connection)'}`);
        this._emitSafe('reconnect', session.id);
    }

    _attach(conn, session) {
        conn.session = session;
        session.conn = conn;
        session.counters.bytesIn += conn.socket.bytesRead; // bytes of the handshake
    }

    _onClose(conn) {
        this.conns.delete(conn);
        const session = conn.session;
        if (!session || session.conn !== conn) return;
        session.conn = null;
        if (session.byeReceived) return this._finish(session, 'closed');
        this._markLost(session, conn.closeReason);
    }

    _markLost(session, reason) {
        if (session.state === 'lost') return;
        session.state = 'lost';
        this.logger.log(`[tcp] session ${session.id} lost (${reason}), waiting ${this.timing.reconnectGraceMs} ms for a reconnect`);
        this._emitSafe('lost', session.id, reason);
        if (this.timing.reconnectGraceMs <= 0) return this._finish(session, reason);
        session.graceTimer = setTimeout(() => this._finish(session, reason), this.timing.reconnectGraceMs);
    }

    _finish(session, reason) {
        if (!this.sessions.has(session.id)) return;
        clearTimeout(session.graceTimer);
        this.sessions.delete(session.id);
        this.byToken.delete(session.token);
        this.logger.log(`[tcp] session ${session.id} disconnected (${reason})`);
        this._emitSafe('disconnect', session.id, reason);
    }

    // ------------------------------------------------------------------ io helpers

    _sendFrame(session, frame) {
        if (!session.conn) {
            if (session.state !== 'lost') return false;
            session.outbox.push(frame); // keep it for the reconnect
            if (session.outbox.length > MAX_OUTBOX) session.outbox.shift();
            return true;
        }
        const socket = session.conn.socket;
        if (socket.writableLength > MAX_WRITE_BUFFER) {
            this.logger.warn(`[tcp] session ${session.id} is not reading, dropping the connection`);
            session.conn.closeReason = 'timeout';
            socket.destroy();
            return false;
        }
        socket.write(frame);
        session.counters.bytesOut += frame.length;
        return true;
    }

    _write(conn, msg) {
        if (conn.socket.destroyed || !conn.socket.writable) return;
        const frame = encodeFrame(msg);
        conn.socket.write(frame);
        if (conn.session) conn.session.counters.bytesOut += frame.length;
    }

    _tick() {
        const now = Date.now();
        const sendPing = now - this.lastPing >= this.timing.pingIntervalMs;
        if (sendPing) this.lastPing = now;
        for (const conn of this.conns) {
            const idle = now - conn.lastSeen;
            if (!conn.session) {
                // Must say HELLO within the timeout, or the slot is freed.
                if (now - conn.openedAt > this.timing.timeoutMs) conn.socket.destroy();
                continue;
            }
            if (idle > this.timing.timeoutMs) {
                conn.closeReason = 'timeout';
                conn.socket.destroy(); // -> 'close' -> _markLost(session, 'timeout')
                continue;
            }
            if (sendPing) this._write(conn, { t: C.PING, d: { ts: performance.now() } });
        }
    }

    _emitSafe(event, ...args) {
        try {
            this.emit(event, ...args);
        } catch (err) {
            // A bug in a game handler must not take the network layer down.
            this.logger.error(`[tcp] '${event}' handler threw:`, err);
        }
    }
}
