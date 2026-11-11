import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";

/**
 * Minimal real-time layer on top of plain WebSockets (the `ws` package).
 *
 * It exposes the small subset of the Socket.IO API this project uses, so the
 * event handlers in src/events/ did not need to change:
 *   io.on("connection", socket => ...)
 *   io.emit(event, data)              -> every connected client
 *   io.to(room).emit(event, data)     -> every client in the room
 *   socket.on(event, handler)
 *   socket.emit(event, data)          -> this client only
 *   socket.to(room).emit(event, data) -> the room, except this client
 *   socket.join(room) / socket.leave(room)
 *   socket.id
 *   socket.on("disconnect", reason => ...)
 *
 * Wire format (both directions): one JSON text frame per message
 *   {"type": "<event name>", "data": <any JSON value>}
 *
 * Right after the connection opens, the server sends
 *   {"type": "__connected", "data": {"id": "<socket id>"}}
 * so the client knows its id (the equivalent of Socket.IO's handshake).
 */

const CONNECTED_EVENT = "__connected";
// Events a client must never be able to trigger on the server by name.
const RESERVED_EVENTS = new Set(["connect", "connection", "disconnect", "error"]);

const encode = (type, data) => JSON.stringify({ type, data });

class BroadcastOperator {
    /**
     * @param {SocketServer} server
     * @param {string} room
     * @param {ServerSocket|null} except
     */
    constructor(server, room, except = null) {
        this.server = server;
        this.room = room;
        this.except = except;
    }

    emit(event, data) {
        this.server._broadcast(this.server._roomMembers(this.room), encode(event, data), this.except);
    }
}

class ServerSocket {
    /**
     * @param {SocketServer} server
     * @param {WebSocket} ws
     */
    constructor(server, ws) {
        this.server = server;
        this.ws = ws;
        this.id = randomUUID();
        /** @type {Set<string>} */
        this.rooms = new Set();
        /** @type {Map<string, Function[]>} */
        this.handlers = new Map();
        this.isAlive = true;
    }

    on(event, handler) {
        if (!this.handlers.has(event)) this.handlers.set(event, []);
        this.handlers.get(event).push(handler);
        return this;
    }

    emit(event, data) {
        this.server._send(this.ws, encode(event, data));
    }

    join(room) {
        room = String(room);
        this.rooms.add(room);
        this.server._roomMembers(room, true).add(this);
    }

    leave(room) {
        room = String(room);
        this.rooms.delete(room);
        const members = this.server.rooms.get(room);
        if (!members) return;
        members.delete(this);
        if (members.size === 0) this.server.rooms.delete(room);
    }

    to(room) {
        return new BroadcastOperator(this.server, String(room), this);
    }

    _dispatch(event, ...args) {
        const handlers = this.handlers.get(event);
        if (!handlers) return;
        for (const handler of [...handlers]) {
            try {
                handler(...args);
            } catch (err) {
                console.error(`Error in handler for "${event}":`, err);
            }
        }
    }
}

export class SocketServer {
    /**
     * @param {import('http').Server} httpServer
     * @param {{
     *   path?: string,
     *   isOriginAllowed?: (origin: string|undefined) => boolean,
     *   heartbeatIntervalMs?: number,
     *   maxPayload?: number,
     * }} [options]
     */
    constructor(httpServer, options = {}) {
        this.path = options.path ?? "/ws";
        this.isOriginAllowed = options.isOriginAllowed ?? (() => true);

        /** @type {Set<ServerSocket>} */
        this.sockets = new Set();
        /** @type {Map<string, Set<ServerSocket>>} */
        this.rooms = new Map();
        /** @type {Function[]} */
        this.connectionHandlers = [];

        this.wss = new WebSocketServer({
            noServer: true,
            maxPayload: options.maxPayload ?? 64 * 1024,
        });

        httpServer.on("upgrade", (req, socket, head) => this._handleUpgrade(req, socket, head));

        // Detect dead connections (closed tab, lost network) that never send a close frame.
        // Browsers answer protocol-level pings automatically.
        const heartbeatMs = options.heartbeatIntervalMs ?? 25000;
        this.heartbeat = setInterval(() => {
            for (const socket of this.sockets) {
                if (!socket.isAlive) {
                    socket.ws.terminate(); // triggers "close" -> cleanup + "disconnect"
                    continue;
                }
                socket.isAlive = false;
                socket.ws.ping();
            }
        }, heartbeatMs);
        this.heartbeat.unref?.();
        httpServer.on("close", () => clearInterval(this.heartbeat));
    }

    on(event, handler) {
        if (event === "connection") this.connectionHandlers.push(handler);
        return this;
    }

    emit(event, data) {
        this._broadcast(this.sockets, encode(event, data));
    }

    to(room) {
        return new BroadcastOperator(this, String(room));
    }

    _handleUpgrade(req, socket, head) {
        const { pathname } = new URL(req.url, "http://localhost");
        if (pathname !== this.path) {
            socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
        }
        // Browsers do not apply CORS to WebSockets, so the origin is checked here.
        const origin = req.headers.origin;
        if (!this.isOriginAllowed(origin)) {
            console.warn("WebSocket origin blocked:", origin);
            socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
        }
        this.wss.handleUpgrade(req, socket, head, (ws) => this._onConnection(ws));
    }

    _onConnection(ws) {
        const socket = new ServerSocket(this, ws);
        this.sockets.add(socket);

        ws.on("pong", () => {
            socket.isAlive = true;
        });

        ws.on("message", (raw, isBinary) => {
            socket.isAlive = true;
            if (isBinary) return;

            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                console.warn("Ignoring non-JSON message from", socket.id);
                return;
            }
            if (!msg || typeof msg.type !== "string" || RESERVED_EVENTS.has(msg.type) || msg.type.startsWith("__")) {
                return;
            }
            socket._dispatch(msg.type, msg.data);
        });

        ws.on("close", (code, reasonBuf) => {
            for (const room of [...socket.rooms]) socket.leave(room);
            this.sockets.delete(socket);
            const reason = reasonBuf?.toString() || `code ${code}`;
            socket._dispatch("disconnect", reason);
        });

        ws.on("error", (err) => {
            console.error("WebSocket error for", socket.id, err.message);
        });

        this._send(ws, encode(CONNECTED_EVENT, { id: socket.id }));

        for (const handler of this.connectionHandlers) {
            try {
                handler(socket);
            } catch (err) {
                console.error("Error in connection handler:", err);
            }
        }
    }

    _roomMembers(room, create = false) {
        let members = this.rooms.get(room);
        if (!members) {
            members = new Set();
            if (create) this.rooms.set(room, members);
        }
        return members;
    }

    _send(ws, payload) {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }

    _broadcast(targets, payload, except = null) {
        for (const socket of targets) {
            if (socket !== except) this._send(socket.ws, payload);
        }
    }
}
