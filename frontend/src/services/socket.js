import { getSocketUrl } from '../utils/urls.js';

/**
 * Thin client over the browser's native WebSocket.
 *
 * Keeps the small Socket.IO-style API the game already uses:
 *   socket.on(event, handler) / socket.off(event, handler?) / socket.emit(event, data)
 *   socket.id / socket.connected
 *   built-in events: "connect", "disconnect" (reason), "connect_error" (error)
 *
 * Wire format: one JSON text frame per message, {"type": "<event>", "data": <any>}.
 * The server sends {"type": "__connected", "data": {"id"}} first; "connect" fires
 * only after that, so socket.id is always set inside "connect" handlers.
 *
 * Also provides what Socket.IO used to do for us:
 *   - automatic reconnect with exponential backoff (unless disconnect() was called)
 *   - buffering of emits made while not connected, flushed on connect
 */

const CONNECTED_EVENT = '__connected';
const MAX_QUEUE = 100;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;
// A connection attempt can hang in CONNECTING indefinitely (unreachable host,
// refused ports on Windows); give up and retry after this long.
const CONNECT_TIMEOUT_MS = 5000;

class GameSocket {
    constructor(url) {
        this.url = url;
        /** @type {WebSocket|null} */
        this.ws = null;
        this.id = undefined;
        this.connected = false;
        /** @type {Map<string, Function[]>} */
        this.handlers = new Map();
        /** @type {string[]} */
        this.queue = [];
        this.shouldReconnect = false;
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.pendingCloseTimer = null;
        this.connectTimer = null;
    }

    on(event, handler) {
        if (!this.handlers.has(event)) this.handlers.set(event, []);
        this.handlers.get(event).push(handler);
        return this;
    }

    /** Remove one handler, or every handler for the event when none is given. */
    off(event, handler) {
        if (!handler) {
            this.handlers.delete(event);
            return this;
        }
        const list = this.handlers.get(event);
        if (!list) return this;
        const i = list.indexOf(handler);
        if (i !== -1) list.splice(i, 1);
        if (list.length === 0) this.handlers.delete(event);
        return this;
    }

    emit(event, data) {
        const payload = JSON.stringify({ type: event, data });
        if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(payload);
            return this;
        }
        // Not connected yet: buffer (drop the oldest when the buffer is full).
        this.queue.push(payload);
        if (this.queue.length > MAX_QUEUE) this.queue.shift();
        return this;
    }

    connect() {
        // Cancel a close scheduled by disconnect() (e.g. React StrictMode unmount + remount).
        if (this.pendingCloseTimer) {
            clearTimeout(this.pendingCloseTimer);
            this.pendingCloseTimer = null;
        }
        this.shouldReconnect = true;
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return this;
        }
        this._open();
        return this;
    }

    /**
     * @param {number} [delayMs] wait before closing so already-sent frames are flushed
     */
    disconnect(delayMs = 0) {
        this.shouldReconnect = false;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.queue = [];

        const close = () => {
            this.pendingCloseTimer = null;
            if (this.shouldReconnect) return; // connect() was called again meanwhile
            if (!this.ws) return;
            if (this.connected) this.ws.close(1000, 'client disconnect');
            else this._abandon(this.ws); // still CONNECTING: its close event may never come
        };
        clearTimeout(this.pendingCloseTimer);
        if (delayMs > 0) this.pendingCloseTimer = setTimeout(close, delayMs);
        else close();
        return this;
    }

    _open() {
        let ws;
        try {
            ws = new WebSocket(this.url);
        } catch (err) {
            this._dispatch('connect_error', err);
            this._scheduleReconnect();
            return;
        }
        this.ws = ws;

        clearTimeout(this.connectTimer);
        this.connectTimer = setTimeout(() => {
            this.connectTimer = null;
            if (this.ws !== ws || this.connected) return;
            this._abandon(ws);
            this._dispatch('connect_error', new Error(`WebSocket connection to ${this.url} timed out`));
            if (this.shouldReconnect) this._scheduleReconnect();
        }, CONNECT_TIMEOUT_MS);

        ws.onmessage = (event) => {
            if (this.ws !== ws) return;
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                console.warn('Ignoring non-JSON message:', event.data);
                return;
            }
            if (!msg || typeof msg.type !== 'string') return;

            if (msg.type === CONNECTED_EVENT) {
                clearTimeout(this.connectTimer);
                this.connectTimer = null;
                this.id = msg.data?.id;
                this.connected = true;
                this.reconnectAttempts = 0;
                this._flushQueue();
                this._dispatch('connect');
                return;
            }
            this._dispatch(msg.type, msg.data);
        };

        ws.onerror = () => {
            // Browsers give no details here; "close" always follows.
            if (this.ws === ws && !this.connected) {
                this._dispatch('connect_error', new Error(`WebSocket connection to ${this.url} failed`));
            }
        };

        ws.onclose = (event) => {
            if (this.ws !== ws) return;
            clearTimeout(this.connectTimer);
            this.connectTimer = null;
            this.ws = null;
            const wasConnected = this.connected;
            this.connected = false;
            this.id = undefined;
            if (wasConnected) {
                this._dispatch('disconnect', event.reason || (this.shouldReconnect ? 'transport close' : 'io client disconnect'));
            }
            if (this.shouldReconnect) this._scheduleReconnect();
        };
    }

    /** Drop a socket that never finished connecting, without waiting for its close event. */
    _abandon(ws) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
        ws.onmessage = ws.onerror = ws.onclose = null;
        try {
            ws.close();
        } catch {
            // ignore: closing a CONNECTING socket can throw in some environments
        }
        if (this.ws === ws) this.ws = null;
    }

    _scheduleReconnect() {
        clearTimeout(this.reconnectTimer);
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) this._open();
        }, delay);
    }

    _flushQueue() {
        const pending = this.queue;
        this.queue = [];
        for (const payload of pending) this.ws.send(payload);
    }

    _dispatch(event, ...args) {
        const list = this.handlers.get(event);
        if (!list) return;
        for (const handler of [...list]) {
            try {
                handler(...args);
            } catch (err) {
                console.error(`Error in "${event}" handler:`, err);
            }
        }
    }
}

/**
 * Electron desktop client: the real socket (raw TCP or UDP, chosen by shared/config.js) lives in
 * the Electron main process. This object talks to it over IPC through window.net
 * (client/electron/preload.cjs) and exposes the same API as GameSocket, so React and Phaser
 * code does not know which transport is in use.
 *
 * Extra: 'net:status' event ({state, message, sessionId, proto, host, port}) and socket.netState.
 * 'reconnecting' keeps socket.connected = true: the transport resumes the same session.
 */
class IpcSocket {
    constructor(bridge) {
        this.bridge = bridge;
        this.handlers = new Map();
        this.id = undefined;
        this.connected = false;
        this.netState = 'idle';
        bridge.onMessage((msg) => this._dispatch(msg.t, msg.d));
        bridge.onStatus((status) => this._onStatus(status));
    }

    emit(event, data) {
        this.bridge.send(event, data);
        return this;
    }

    /** The connection belongs to the main process; this (re)announces its current state. */
    connect() {
        this.bridge.getStatus().then((status) => this._onStatus(status, true));
        return this;
    }

    disconnect() {
        return this; // closing the window closes the connection (BYE)
    }

    _onStatus(status, announce = false) {
        this.netState = status.state;
        const live = status.state === 'connected' || status.state === 'reconnecting';
        if (live) {
            const newSession = this.connected && status.sessionId !== this.id;
            if (newSession) this._dispatch('disconnect', 'new session');
            if (!this.connected || newSession || announce) {
                this.id = status.sessionId;
                this.connected = true;
                this._dispatch('connect');
            }
        } else if (this.connected) {
            this.connected = false;
            this.id = undefined;
            this._dispatch('disconnect', status.message);
        } else if (status.state === 'error') {
            this._dispatch('connect_error', new Error(status.message));
        }
        this._dispatch('net:status', status);
    }
}
IpcSocket.prototype.on = GameSocket.prototype.on;
IpcSocket.prototype.off = GameSocket.prototype.off;
IpcSocket.prototype._dispatch = GameSocket.prototype._dispatch;

const bridge = typeof window !== 'undefined' ? window.net : undefined;
const SOCKET_URL = bridge ? 'Electron IPC' : getSocketUrl();
const socket = bridge ? new IpcSocket(bridge) : new GameSocket(SOCKET_URL);

socket.on('connect', () => {
    console.log('Connected to server with id:', socket.id, 'via:', SOCKET_URL);
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected from server. Reason:', reason);
    // Cleanup is handled by the backend 'disconnect' handler via socketToPlayerId.
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message || error);
});

export const socketService = {
    connect: () => {
        socket.connect();
    },

    disconnect: (playerId) => {
        if (socket.connected) {
            const id = playerId || sessionStorage.getItem('playerId');
            if (id) {
                socket.emit('player:disconnect', { playerId: id });
                console.log('Emitted player:disconnect for:', id);
            }
            // Brief delay so the disconnect event is flushed before close
            socket.disconnect(100);
        } else {
            socket.disconnect();
        }
    },

    getSocket: () => socket,

    /** True inside the Electron client (raw TCP/UDP via IPC), false in the browser build. */
    isDesktop: () => Boolean(bridge),
};

export default socketService;
