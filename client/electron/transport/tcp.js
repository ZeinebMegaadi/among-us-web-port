// TCP client transport (Electron main process): net.Socket + length-prefix framing.
//
// Shared client API (same as client/electron/transport/udp.js), used by NetClient:
//   connect(host, port) -> Promise<{sessionId}>   rejects with err.code: ECONNREFUSED | HELLO_TIMEOUT |
//                                                  proto-mismatch | version-mismatch | ...
//   send(msg, {reliable}) -> boolean               {reliable} ignored: TCP is always reliable
//   close()                                        sends BYE, then closes
//   stats() -> { rttMs, jitterMs, bytesIn, bytesOut, retransmits, lost }
//   events: 'message' (msg) | 'lost' (reason) | 'reconnect' () | 'disconnect' (reason)
//   fields: proto, state ('idle'|'connecting'|'connected'|'reconnecting'|'closed'), sessionId
import net from 'node:net';
import { EventEmitter } from 'node:events';
import {
    APP_VERSION, FrameDecoder, encodeFrame, decodeMessage, TCP_CONTROL as C, HANDSHAKE_ERROR,
} from '../../../shared/protocol.js';
import { RttTracker, newCounters, statsSnapshot } from '../../../shared/metrics.js';
import { TIMING } from '../../../shared/config.js';

const PROTO = 'tcp';
const MAX_OUTBOX = 500;
const CHECK_INTERVAL_MS = 250;
const RECONNECT_RETRY_MS = 1000;

const codedError = (code, message) => Object.assign(new Error(message), { code });

export default class TcpClientTransport extends EventEmitter {
    /** @param {{timing?: object, logger?: Console}} [options] */
    constructor(options = {}) {
        super();
        this.proto = PROTO;
        this.supportsLossSim = false; // built-in --loss simulator (TCP: use clumsy / tc netem instead)
        this.timing = { ...TIMING, ...options.timing };
        this.logger = options.logger ?? console;
        this.state = 'idle';
        this.sessionId = null;
        this.token = null;
        this.socket = null;
        this.lastSeen = 0;
        this.lastPing = 0;
        this.timer = null;
        this.outbox = [];
        this.rtt = new RttTracker();
        this.counters = newCounters();

        // Test-only hooks used by tools/transport-test.mjs to simulate network failures.
        this.__test = {
            /** Stop sending and reading, like a pulled cable. */
            pause: () => {
                clearInterval(this.timer);
                this.timer = null;
                this.socket?.pause();
            },
            resume: () => {
                this.lastSeen = Date.now();
                this.socket?.resume();
                if (!this.timer && this.state !== 'closed') this.timer = setInterval(() => this._tick(), CHECK_INTERVAL_MS);
            },
            /** Kill the socket abruptly (no BYE), like a crashed router. */
            dropConnection: () => this.socket?.destroy(),
        };
    }

    async connect(host, port) {
        if (this.state !== 'idle' && this.state !== 'closed') throw new Error(`already ${this.state}`);
        this.host = host;
        this.port = port;
        this.state = 'connecting';
        let rest;
        try {
            const dialed = await this._dial(null);
            this.sessionId = dialed.welcome.sessionId;
            this.token = dialed.welcome.token;
            this._attach(dialed.socket, dialed.decoder);
            rest = dialed.rest;
        } catch (err) {
            this.state = 'closed';
            throw err;
        }
        this.state = 'connected';
        this.timer = setInterval(() => this._tick(), CHECK_INTERVAL_MS);
        // Frames that arrived in the same chunk as the WELCOME
        if (rest.length) queueMicrotask(() => this._replay(rest));
        return { sessionId: this.sessionId };
    }

    send(msg, _opts = {}) {
        if (this.state === 'closed' || this.state === 'idle') return false;
        let frame;
        try {
            frame = encodeFrame(msg);
        } catch (err) {
            this.logger.warn(`[tcp] not sending ${msg?.t}: ${err.message}`);
            return false;
        }
        if (this.state !== 'connected' || !this.socket) {
            this.outbox.push(frame);
            if (this.outbox.length > MAX_OUTBOX) this.outbox.shift();
            return true;
        }
        this._writeFrame(frame);
        return true;
    }

    close() {
        if (this.state === 'closed') return;
        const socket = this.socket;
        if (socket && !socket.destroyed && socket.writable) {
            this._writeFrame(encodeFrame({ t: C.BYE, d: {} })); // BYE first, then FIN
        }
        this._stop(); // ends the socket
        if (socket) setTimeout(() => socket.destroy(), 200).unref?.();
        this.emit('disconnect', 'closed');
    }

    stats() {
        return statsSnapshot(this.rtt, this.counters);
    }

    // ------------------------------------------------------------------ internals

    /** Open a TCP connection and complete the HELLO/WELCOME handshake. */
    _dial(token) {
        return new Promise((resolve, reject) => {
            const socket = net.connect({ host: this.host, port: this.port });
            socket.setNoDelay(true);
            const decoder = new FrameDecoder();
            let settled = false;
            const fail = (err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                socket.destroy();
                reject(err);
            };
            const timeout = setTimeout(() => fail(codedError('HELLO_TIMEOUT',
                `No answer from a TCP game server at ${this.host}:${this.port} within ${this.timing.helloTimeoutMs} ms`)),
            this.timing.helloTimeoutMs);

            socket.once('connect', () => {
                socket.write(encodeFrame({ t: C.HELLO, d: { proto: PROTO, v: APP_VERSION, token } }));
            });
            socket.on('error', (err) => fail(codedError(err.code || 'ESOCKET', `${err.code || 'error'}: ${err.message}`)));
            socket.on('close', () => fail(codedError('ECONNRESET', 'Server closed the connection during the handshake')));
            socket.on('data', (chunk) => {
                this.counters.bytesIn += chunk.length;
                let frames;
                try {
                    frames = decoder.push(chunk);
                } catch (err) {
                    return fail(codedError('BAD_FRAME', `Not a game server: ${err.message}`));
                }
                for (let i = 0; i < frames.length; i++) {
                    let msg;
                    try {
                        msg = decodeMessage(frames[i]);
                    } catch (err) {
                        return fail(codedError('BAD_FRAME', `Not a game server: ${err.message}`));
                    }
                    if (msg.t === C.ERROR) return fail(codedError(msg.d?.code || 'HANDSHAKE', msg.d?.message || 'Handshake refused'));
                    if (msg.t !== C.WELCOME) continue;
                    settled = true;
                    clearTimeout(timeout);
                    socket.removeAllListeners();
                    socket.on('error', () => {}); // until _attach() installs the real handlers
                    // Frames coalesced with the WELCOME are replayed once handlers are attached.
                    const rest = frames.slice(i + 1);
                    resolve({ socket, decoder, welcome: msg.d, rest });
                    return;
                }
            });
        });
    }

    _attach(socket, decoder) {
        this.socket = socket;
        this.decoder = decoder;
        this.lastSeen = Date.now();
        socket.on('data', (chunk) => this._onData(chunk));
        socket.on('error', (err) => this.logger.warn(`[tcp] socket error: ${err.code || err.message}`));
        socket.on('close', () => {
            if (this.socket !== socket) return;
            this.socket = null;
            if (this.state === 'connected') this._onLost(this.closeReason || 'closed');
        });
        this.closeReason = null;
        // Bytes sent during the handshake
        this.counters.bytesOut += socket.bytesWritten;
    }

    _onData(chunk) {
        this.lastSeen = Date.now();
        this.counters.bytesIn += chunk.length;
        let frames;
        try {
            frames = this.decoder.push(chunk);
        } catch (err) {
            this.logger.warn(`[tcp] ${err.message}; dropping connection`);
            this.socket?.destroy();
            return;
        }
        for (const frame of frames) {
            let msg;
            try {
                msg = decodeMessage(frame);
            } catch (err) {
                this.logger.warn(`[tcp] bad frame: ${err.message}`);
                continue;
            }
            this._onMessage(msg);
        }
    }

    _replay(frames) {
        for (const frame of frames) {
            try {
                this._onMessage(decodeMessage(frame));
            } catch (err) {
                this.logger.warn(`[tcp] bad frame: ${err.message}`);
            }
        }
    }

    _onMessage(msg) {
        switch (msg.t) {
            case C.PING:
                this._writeFrame(encodeFrame({ t: C.PONG, d: { ts: msg.d?.ts } }));
                return;
            case C.PONG:
                if (Number.isFinite(msg.d?.ts)) this.rtt.sample(performance.now() - msg.d.ts);
                return;
            case C.BYE:
                // Server is shutting down or kicked us: no reconnect.
                this._stop();
                this.emit('disconnect', 'closed');
                return;
            default:
                if (msg.t.startsWith('__')) return;
                try {
                    this.emit('message', msg);
                } catch (err) {
                    this.logger.error('[tcp] message handler threw:', err);
                }
        }
    }

    _onLost(reason) {
        this.state = 'reconnecting';
        this.logger.warn(`[tcp] connection lost (${reason}); reconnecting for ${this.timing.reconnectGraceMs} ms`);
        this.emit('lost', reason);
        const deadline = Date.now() + this.timing.reconnectGraceMs;

        const attempt = async () => {
            if (this.state !== 'reconnecting') return;
            try {
                const { socket, decoder, rest } = await this._dial(this.token);
                if (this.state !== 'reconnecting') {
                    socket.destroy();
                    return;
                }
                this._attach(socket, decoder);
                this.state = 'connected';
                const pending = this.outbox;
                this.outbox = [];
                for (const frame of pending) this._writeFrame(frame);
                this.logger.log('[tcp] reconnected, session resumed');
                this.emit('reconnect');
                this._replay(rest);
            } catch (err) {
                if (this.state !== 'reconnecting') return;
                if (err.code === HANDSHAKE_ERROR.UNKNOWN_SESSION) {
                    this._stop();
                    this.emit('disconnect', 'expired');
                    return;
                }
                if (Date.now() + RECONNECT_RETRY_MS > deadline) {
                    this._stop();
                    this.emit('disconnect', reason);
                    return;
                }
                this.reconnectTimer = setTimeout(attempt, RECONNECT_RETRY_MS);
            }
        };
        attempt();
    }

    _writeFrame(frame) {
        if (!this.socket || this.socket.destroyed) return;
        this.socket.write(frame);
        this.counters.bytesOut += frame.length;
    }

    _tick() {
        if (this.state !== 'connected' || !this.socket) return;
        const now = Date.now();
        if (now - this.lastSeen > this.timing.timeoutMs) {
            this.closeReason = 'timeout';
            this.socket.destroy(); // -> 'close' -> _onLost('timeout')
            return;
        }
        if (now - this.lastPing >= this.timing.pingIntervalMs) {
            this.lastPing = now;
            this._writeFrame(encodeFrame({ t: C.PING, d: { ts: performance.now() } }));
        }
    }

    _stop() {
        this.state = 'closed';
        clearInterval(this.timer);
        clearTimeout(this.reconnectTimer);
        this.timer = null;
        if (this.socket) {
            const s = this.socket;
            this.socket = null;
            s.removeAllListeners('close');
            s.on('error', () => {});
            if (!s.destroyed) s.end();
        }
    }
}
