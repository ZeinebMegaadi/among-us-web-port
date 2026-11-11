// NetClient: the Electron main process's single network endpoint. Wraps whichever client
// transport the factory returned (same API for TCP and UDP) and adds:
//   - connection status for the window title and the renderer ('net:status')
//   - automatic retry when the server is not up yet, with a readable error
//   - a fresh session if the old one expired (server restarted, gone > reconnect grace)
//   - request/response for the former REST reads ('rpc' -> 'rpc:result')
//   - buffering of messages sent while connecting
import { EventEmitter } from 'node:events';
import { createTransport, explainConnectError } from '../../shared/transportFactory.js';
import { isReliable } from '../../shared/protocol.js';

const RETRY_MS = 3000;
const RPC_TIMEOUT_MS = 5000;
const MAX_PENDING = 200;

export class NetClient extends EventEmitter {
    /** @param {{proto: string, host: string, port: number, loss?: number, seed?: number|null}} cfg */
    constructor(cfg, { logger = console } = {}) {
        super();
        this.cfg = cfg;
        this.logger = logger;
        this.transport = null;
        this.status = { state: 'idle', message: '', sessionId: null };
        this.pending = [];
        this.rpcSeq = 0;
        this.rpcWaiting = new Map();
        this.closed = false;
        this.retryTimer = null;
        this.lastError = null;
    }

    start() {
        this._connect();
    }

    async _connect() {
        if (this.closed) return;
        this._setStatus('connecting', `Connecting to ${this.cfg.host}:${this.cfg.port}...`);
        const transport = await createTransport('client', this.cfg.proto, {
            logger: this.logger,
            lossSim: this.cfg.loss > 0 ? { loss: this.cfg.loss, seed: this.cfg.seed } : null,
        });
        transport.on('message', (msg) => this._onMessage(msg));
        transport.on('lost', (reason) => this._setStatus('reconnecting', `Connection lost (${reason}), reconnecting...`));
        transport.on('reconnect', () => this._setStatus('connected', 'Reconnected'));
        transport.on('disconnect', (reason) => {
            if (this.transport !== transport) return;
            this.transport = null;
            if (this.closed) return;
            const why = reason === 'expired'
                ? 'Session expired on the server (server restarted or you were away too long)'
                : `Disconnected (${reason})`;
            this._setStatus('disconnected', `${why}. Reconnecting...`);
            this._failRpcs('disconnected');
            this._scheduleRetry();
        });

        try {
            const { sessionId } = await transport.connect(this.cfg.host, this.cfg.port);
            if (this.closed) {
                transport.close();
                return;
            }
            this.transport = transport;
            this.lastError = null;
            this._setStatus('connected', 'Connected', sessionId);
            const queued = this.pending;
            this.pending = [];
            for (const msg of queued) this.send(msg);
        } catch (err) {
            const text = explainConnectError(err, this.cfg);
            const first = this.lastError !== err.code;
            this.lastError = err.code;
            this._setStatus('error', text);
            if (first) this.emit('connect-error', text);
            this._scheduleRetry();
        }
    }

    _scheduleRetry() {
        clearTimeout(this.retryTimer);
        if (!this.closed) this.retryTimer = setTimeout(() => this._connect(), RETRY_MS);
    }

    _setStatus(state, message, sessionId = this.status.sessionId) {
        if (state !== 'connected' && state !== 'reconnecting') sessionId = null;
        this.status = { state, message, sessionId, proto: this.cfg.proto, host: this.cfg.host, port: this.cfg.port };
        this.emit('status', this.status);
    }

    /** @param {{t: string, d?: any}} msg */
    send(msg) {
        if (!this.transport) {
            this.pending.push(msg);
            if (this.pending.length > MAX_PENDING) this.pending.shift();
            return true;
        }
        return this.transport.send(msg, { reliable: isReliable(msg.t) });
    }

    /** Former REST GET, now a message round trip. Resolves {status, body}. */
    request(path) {
        const id = ++this.rpcSeq;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.rpcWaiting.delete(id);
                resolve({ status: 504, body: { error: 'no answer from server' } });
            }, RPC_TIMEOUT_MS);
            this.rpcWaiting.set(id, { resolve, timer });
            this.send({ t: 'rpc', d: { id, path: String(path) } });
        });
    }

    _onMessage(msg) {
        if (msg.t === 'rpc:result') {
            const waiting = this.rpcWaiting.get(msg.d?.id);
            if (!waiting) return;
            clearTimeout(waiting.timer);
            this.rpcWaiting.delete(msg.d.id);
            waiting.resolve({ status: msg.d.status, body: msg.d.body });
            return;
        }
        this.emit('message', msg);
    }

    _failRpcs(reason) {
        for (const [id, { resolve, timer }] of this.rpcWaiting) {
            clearTimeout(timer);
            resolve({ status: 503, body: { error: reason } });
            this.rpcWaiting.delete(id);
        }
    }

    stats() {
        return this.transport ? this.transport.stats() : null;
    }

    close() {
        this.closed = true;
        clearTimeout(this.retryTimer);
        this._failRpcs('closed');
        this.transport?.close();
        this.transport = null;
    }
}
