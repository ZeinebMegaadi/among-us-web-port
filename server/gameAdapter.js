// Bridge between a transport (TCP or UDP, same contract) and the existing game logic in
// backend/src/events + backend/src/managers, which is written against a Socket.IO-style API.
// The game files are used unchanged; this adapter gives them the io/socket objects they expect:
//
//   io.emit(e, d)              -> every session
//   io.to(room).emit(e, d)     -> every session in the room
//   socket.emit(e, d)          -> this session
//   socket.to(room).emit(e, d) -> the room except this session
//   socket.join/leave(room), socket.id (= transport sessionId), socket.on(e, fn), 'disconnect'
//
// It also answers the former REST GET endpoints as messages ('rpc' -> 'rpc:result'), using the
// existing Express router in-process (no HTTP server is started).
//
// Session lifecycle mapping (transport -> game):
//   connect     -> new socket object, handlers registered
//   lost        -> nothing yet (the player is kept; the transport waits for a reconnect)
//   reconnect   -> nothing to do: same socket object, same rooms, same player
//   disconnect  -> socket leaves its rooms, then the game's 'disconnect' handler runs (player cleanup)
import { registerRoomEvents } from '../backend/src/events/roomEvents.js';
import { registerGameEvents } from '../backend/src/events/gameEvents.js';
import apiRouter from '../backend/src/routes/api.js';
import { validateClientMessage, isReliable } from '../shared/protocol.js';

const envelope = (t, d) => ({ t, d });

export function attachGame(transport, { logger = console } = {}) {
    /** @type {Map<string, SessionSocket>} */
    const sockets = new Map();
    /** @type {Map<string, Set<string>>} room -> sessionIds */
    const rooms = new Map();
    const rejected = new Map(); // sessionId -> count, to rate-limit warnings

    const sendTo = (ids, event, data) => {
        if (ids.length) transport.broadcast(ids, envelope(event, data), { reliable: isReliable(event) });
    };
    const roomMembers = (room, exceptId) => [...(rooms.get(String(room)) ?? [])].filter((id) => id !== exceptId);

    const io = {
        emit: (event, data) => sendTo([...sockets.keys()], event, data),
        to: (room) => ({ emit: (event, data) => sendTo(roomMembers(room), event, data) }),
    };

    class SessionSocket {
        constructor(id) {
            this.id = id;
            this.handlers = new Map();
            this.rooms = new Set();
        }

        on(event, fn) {
            if (!this.handlers.has(event)) this.handlers.set(event, []);
            this.handlers.get(event).push(fn);
            return this;
        }

        emit(event, data) {
            transport.send(this.id, envelope(event, data), { reliable: isReliable(event) });
        }

        join(room) {
            room = String(room);
            this.rooms.add(room);
            if (!rooms.has(room)) rooms.set(room, new Set());
            rooms.get(room).add(this.id);
        }

        leave(room) {
            room = String(room);
            this.rooms.delete(room);
            const members = rooms.get(room);
            if (!members) return;
            members.delete(this.id);
            if (members.size === 0) rooms.delete(room);
        }

        to(room) {
            return { emit: (event, data) => sendTo(roomMembers(room, this.id), event, data) };
        }

        dispatch(event, ...args) {
            for (const fn of [...(this.handlers.get(event) ?? [])]) {
                try {
                    fn(...args);
                } catch (err) {
                    logger.error(`[game] handler for "${event}" threw:`, err);
                }
            }
        }
    }

    function handleRpc(socket, { id, path }) {
        const url = new URL(path.startsWith('/') ? path : `/${path}`, 'rpc://local');
        let answered = false;
        const reply = (status, body) => {
            if (answered) return;
            answered = true;
            socket.emit('rpc:result', { id, status, body: body ?? null });
        };
        const req = {
            method: 'GET',
            url: url.pathname + url.search,
            originalUrl: url.pathname + url.search,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            params: {},
            headers: {},
            get: () => undefined,
        };
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(body) { reply(this.statusCode, body); return this; },
            send(body) { reply(this.statusCode, body); return this; },
            end(body) { reply(this.statusCode, body); return this; },
            setHeader() {}, getHeader() {}, set() { return this; },
        };
        try {
            apiRouter(req, res, (err) => reply(err ? 500 : 404, { error: err ? 'internal error' : 'not found' }));
        } catch (err) {
            logger.error('[game] rpc failed:', err);
            reply(500, { error: 'internal error' });
        }
    }

    transport.on('connect', (id) => {
        const socket = new SessionSocket(id);
        sockets.set(id, socket);
        registerRoomEvents(io, socket);
        registerGameEvents(io, socket);
    });

    transport.on('message', (id, msg) => {
        const socket = sockets.get(id);
        if (!socket) return;
        const error = validateClientMessage(msg);
        if (error) {
            const n = (rejected.get(id) ?? 0) + 1;
            rejected.set(id, n);
            if (n <= 5 || n % 100 === 0) logger.warn(`[game] rejected message from ${id.slice(0, 8)} (#${n}): ${error}`);
            return;
        }
        if (msg.t === 'rpc') return handleRpc(socket, msg.d);
        socket.dispatch(msg.t, msg.d);
    });

    transport.on('lost', (id, reason) => {
        logger.log(`[game] session ${id.slice(0, 8)} lost (${reason}); player kept until reconnect grace ends`);
    });

    transport.on('reconnect', (id) => {
        // Same socket object, same rooms, same player: nothing to restore at this level.
        logger.log(`[game] session ${id.slice(0, 8)} reconnected; player restored`);
    });

    transport.on('disconnect', (id, reason) => {
        const socket = sockets.get(id);
        if (!socket) return;
        for (const room of [...socket.rooms]) socket.leave(room);
        sockets.delete(id);
        rejected.delete(id);
        socket.dispatch('disconnect', reason);
    });

    return { io, sockets, rooms };
}
