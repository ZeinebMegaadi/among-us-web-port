import {PlayersManager} from "./players.manager.js";

export const SPAWN = {x: 560, y: 150};
// Players stand side by side around SPAWN instead of on the same pixel (where they hid each other).
const SPAWN_OFFSETS = [{x: 0, y: 0}, {x: -1, y: 0}, {x: 1, y: 0}, {x: 0, y: 1}];
// The waiting lobby draws sprites 3 times bigger than the game map, so they need more room there.
export const GAME_SPACING_PX = 25;
export const LOBBY_SPACING_PX = 60;

/** Spawn point of one player, from their place in the room's join order. */
export function spawnFor(room, playerId, spacing = GAME_SPACING_PX) {
    const i = Math.max(0, Object.keys(room.players).indexOf(playerId));
    const o = SPAWN_OFFSETS[i % SPAWN_OFFSETS.length];
    return {x: SPAWN.x + o.x * spacing, y: SPAWN.y + o.y * spacing};
}

/**
 * @type {{[key: string]: import('../types/room.type.js').GameRoom}}
 */
const rooms = {};

export const RoomsManager = {
    players: {
        /**
         * @param {string} roomId
         * @param {import('../types/room.type.js').Player} player
         */
        add(roomId, player) {
            const room = rooms[roomId];
            if (!room) return;
            player = PlayersManager.setRoomId(player.id, roomId);
            room.players[player.id] = player;
            if (room.scores[player.id] === undefined) room.scores[player.id] = 0;
            PlayersManager.updatePlayerState(player.id, {...spawnFor(room, player.id, LOBBY_SPACING_PX), d: 'left', moving: false});
            player._moveAt = null;   // server-side teleport: restart the movement budget
            return player;
        },
        /**
         * @returns {{deleted: boolean, hostChanged: boolean}}
         */
        remove(roomId, player) {
            const room = rooms[roomId];
            if (!room) return {deleted: false, hostChanged: false};
            // Leaving (or crashing) during a game does not erase what you scored in it: the final
            // ranking of this game still lists you, marked as "left".
            if (room.started) {
                room.leftPlayers[player.id] = {
                    id: player.id, name: player.name, color: player.color,
                    points: room.scores[player.id] || 0, left: true,
                };
            }
            delete room.players[player.id];
            delete room.scores[player.id];
            const remaining = Object.values(room.players);
            if (remaining.length < 1) {
                if (room.currentMeeting?.timer) clearTimeout(room.currentMeeting.timer);
                if (room.endTimer) clearTimeout(room.endTimer);
                delete rooms[roomId];
                return {deleted: true, hostChanged: false};
            }
            if (room.host.id === player.id) {
                room.host = remaining[0];
                return {deleted: false, hostChanged: true};
            }
            return {deleted: false, hostChanged: false};
        },
        updateState(roomId, playerId, state) {
            const room = rooms[roomId];
            if (!room || !room.players[playerId]) return;
            room.players[playerId].state = {...room.players[playerId].state, ...state};
        },
    },

    meetings: {
        /** One meeting (and one timer) per room. */
        create(roomId, callerId, durationMs, onTimeout) {
            const room = rooms[roomId];
            room.currentMeeting = {
                isActive: true,
                callerId,
                votes: {},
                endTime: Date.now() + durationMs,
                timer: setTimeout(onTimeout, durationMs),
            };
        },
        /** @returns {boolean} true if every alive player has voted */
        vote(roomId, voterId, votedForId) {
            const room = rooms[roomId];
            if (!room?.currentMeeting?.isActive) return false;
            room.currentMeeting.votes[voterId] = votedForId;
            const alive = Object.values(room.players).filter(p => p.isAlive);
            return alive.every(p => room.currentMeeting.votes[p.id] !== undefined);
        },
        end(roomId) {
            const room = rooms[roomId];
            const meeting = room?.currentMeeting;
            if (!meeting || !meeting.isActive) return null;
            clearTimeout(meeting.timer);
            meeting.isActive = false;

            // Count votes ("skip" counts as a vote for nobody)
            const counts = {};
            for (const votedForId of Object.values(meeting.votes)) {
                if (!votedForId || votedForId === 'skip') continue;
                counts[votedForId] = (counts[votedForId] || 0) + 1;
            }
            let max = 0;
            let leaders = [];
            for (const [id, count] of Object.entries(counts)) {
                if (count > max) { max = count; leaders = [id]; }
                else if (count === max) leaders.push(id);
            }
            const tie = leaders.length !== 1;
            const ejectedId = tie ? null : leaders[0];
            if (ejectedId && room.players[ejectedId]) room.players[ejectedId].isAlive = false;

            meeting.results = {ejectedId, tie, counts, votes: {...meeting.votes}};
            return meeting.results;
        },
    },

    createRoom(roomId, host) {
        if (rooms[roomId]) return;
        rooms[roomId] = {
            id: roomId,
            started: false,
            imposter: null,
            host,
            players: {},
            currentMeeting: null,
            scores: {},            // playerId -> points, kept across the games played in this room
            imposterHistory: [],   // who has already been imposter (to rotate the role fairly)
            lastKillAt: 0,
            emergencyUsed: {},     // playerId -> true once they pressed the meeting button this game
            gameNumber: 0,
            scoresAtStart: {},     // what clients may see during a game (live scores would reveal roles)
            leftPlayers: {},       // playerId -> final line for players who left during the current game
            endTimer: null,        // server-side game time limit
        };
        return rooms[roomId];
    },

    fetchRooms() {
        return Object.values(rooms);
    },

    fetchRoom(roomId) {
        return rooms[roomId];
    },

    startGame(roomId) {
        const room = rooms[roomId];
        if (!room) return;
        const players = Object.values(room.players);
        if (players.length === 0) return;

        room.started = true;
        room.gameNumber++;
        room.lastKillAt = Date.now(); // the imposter has to wait one cooldown before the first kill
        room.emergencyUsed = {};
        room.scoresAtStart = {...room.scores};
        room.leftPlayers = {};
        players.forEach(p => {
            p.isAlive = true;
            // Kept for the whole game: players return here after each meeting, even if someone left.
            p.spawn = spawnFor(room, p.id);
            PlayersManager.updatePlayerState(p.id, {...p.spawn, d: 'left', moving: false});
        });

        // Rotate the imposter role: pick among players who have not been imposter yet.
        let candidates = players.filter(p => !room.imposterHistory.includes(p.id));
        if (candidates.length === 0) {
            room.imposterHistory = [];
            candidates = players;
        }
        const imposter = candidates[Math.floor(Math.random() * candidates.length)];
        room.imposter = imposter.id;
        room.imposterHistory.push(imposter.id);
        return room;
    },

    /** Back to the waiting room after a game, ready for the next one. Scores are kept. */
    resetRoom(roomId) {
        const room = rooms[roomId];
        if (!room) return;
        if (room.currentMeeting?.timer) clearTimeout(room.currentMeeting.timer);
        if (room.endTimer) clearTimeout(room.endTimer);
        room.endTimer = null;
        room.started = false;
        room.imposter = null;
        room.currentMeeting = null;
        room.leftPlayers = {};
        Object.values(room.players).forEach(p => {
            p.isAlive = true;
            p._moveAt = null;
            PlayersManager.updatePlayerState(p.id, {...spawnFor(room, p.id, LOBBY_SPACING_PX), d: 'left', moving: false});
        });
    },

    /**
     * @returns {boolean|null} true = imposter wins, false = crew wins, null = game continues
     */
    checkWin(roomId) {
        const room = rooms[roomId];
        if (!room || !room.started || !room.imposter) return null;

        const players = Object.values(room.players);
        const alive = players.filter(p => p.isAlive);
        const aliveImposters = alive.filter(p => p.id === room.imposter).length;
        const aliveCrew = alive.length - aliveImposters;

        if (aliveImposters === 0) return false;   // imposter ejected or left
        if (aliveCrew === 0) return true;         // every crewmate is dead
        // Classic Among Us parity rule, only with 4+ players. With 3 players it would end the game
        // after the very first kill, so with 3 players the imposter must kill both crewmates.
        if (players.length >= 4 && aliveImposters >= aliveCrew) return true;
        return null;
    },
};

/**
 * What the players IN a room may see about it. NEVER includes who the imposter is
 * (the original project sent the imposter's id to everybody).
 * During a game the scores are frozen at their value when the game started: a live total would
 * reveal roles (the imposter gains a point per kill, a crewmate a point for voting the imposter).
 */
export function publicRoom(room) {
    const players = {};
    for (const p of Object.values(room.players)) {
        players[p.id] = {id: p.id, name: p.name, color: p.color, isAlive: p.isAlive, state: p.state};
    }
    const source = room.started ? room.scoresAtStart : room.scores;
    const scores = {};
    for (const id of Object.keys(players)) scores[id] = source[id] || 0;
    return {
        id: room.id,
        started: room.started,
        host: {id: room.host.id, name: room.host.name},
        players,
        scores,
    };
}

/**
 * What EVERY connected client sees in the lobby list: only what the list displays.
 * The list is pushed to everyone on every change, so in the UDP version it must stay one small
 * datagram whatever the number of players (full player objects made it grow past the MTU).
 */
export function lobbyRoom(room) {
    return {
        id: room.id,
        started: room.started,
        host: {id: room.host.id, name: room.host.name},
        playerCount: Object.keys(room.players).length,
    };
}
