// backend/src/events/gameEvents.js
// In-game messages: start, movement, kill, meeting, vote, and the end of the game.
//
// Every handler has the signature (ctx, sessionId, data):
//   ctx       - helpers from main.js (sendTo, sendToRoom, playerIdOf, ...). No socket access here.
//   sessionId - WHICH CLIENT sent the message, decided by the transport (TCP socket / UDP ip:port).
//   data      - the payload. Untrusted: it came over the network, so every field is checked.
//
// The server is AUTHORITATIVE: a client only sends requests ("I want to kill X"). The server checks
// the rules using its own state (positions, roles, timers) and then tells everyone what happened.
// The player's identity always comes from the session, never from an id inside the payload,
// so a client cannot act on behalf of another player.

import { RoomsManager, SPAWN } from '../managers/rooms.manager.js';
import { PlayersManager } from '../managers/players.manager.js';

export const MIN_PLAYERS_TO_START = 3;     // the brief asks for 3 clients (set to 2 only for quick tests)
const KILL_RANGE_PX = 100;
const KILL_COOLDOWN_MS = 10_000;
const MEETING_DURATION_MS = 30_000;
// Time limit of one game, owned by the server. If the imposter has not won when it runs out, the
// crew wins (they survived). Without it, an imposter who never kills would block the game forever.
// GAME_DURATION_MS in the environment overrides it (the automated test uses a short one).
const GAME_DURATION_MS = Number(process.env.GAME_DURATION_MS) || 180_000;

// Same speeds as the client (BaseGameScene.handleMovement): lobby 350 px/s, game 100 px/s.
const LOBBY_SPEED_PX_S = 350;
const GAME_SPEED_PX_S = 100;
const SPEED_TOLERANCE = 1.15;          // small slack for frame timing, not a second speed
const MOVE_SLACK_PX = 2;               // rounding only
// How much "unspent" movement time a client may save up. Positions produced 50 ms apart can reach
// the server bunched together: TCP delivers everything queued behind a lost segment at once, and a
// Wi-Fi stall does the same in UDP. 1.5 s of savings absorbs such a burst instead of rejecting it
// and snapping the player back ("rubber-banding").
const MOVE_BANK_CAP_MS = 1500;
// But ONE update may never cover more than this much walking time. A burst of delayed packets is
// many small steps (each fits); a single big jump is a teleport, whatever the saved-up time.
// 500 ms still absorbs ~9 lost 20 Hz positions in a row in the UDP version.
const MAX_STEP_MS = 500;
// Tile maps: lobby.json is 154x126 tiles, map.json is 126x70, tiles are 8 px.
const LOBBY_MAP = { maxX: 154 * 8, maxY: 126 * 8 };   // 1232 x 1008
const GAME_MAP = { maxX: 126 * 8, maxY: 70 * 8 };     // 1008 x 560
const MAP_EDGE_PX = 8;                 // one tile: the sprite center can sit on the border

const POINTS = {
    KILL: 1,            // imposter, per kill
    CORRECT_VOTE: 1,    // crewmate who voted for the imposter
    IMPOSTER_WIN: 3,    // to the imposter
    CREW_WIN: 2,        // to every crewmate (alive or dead)
};

/** Private message to one player only (validation errors, "kill on cooldown", ...). */
function notify(ctx, sessionId, message) {
    ctx.sendTo(sessionId, 'game:notif', { message });
}

/** The player behind this session and the room they are in, or null + a notification. */
function playerAndRoom(ctx, sessionId) {
    const player = PlayersManager.getPlayer(ctx.playerIdOf(sessionId));
    if (!player) {
        notify(ctx, sessionId, 'Register first');
        return null;
    }
    const room = player.roomId ? RoomsManager.fetchRoom(player.roomId) : null;
    if (!room || !room.players[player.id]) {
        notify(ctx, sessionId, 'You are not in a room');
        return null;
    }
    return { player, room };
}

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

// ---------------------------------------------------------------------------------------------
// Game end (shared with roomEvents.js: a player leaving can also end the game)
// ---------------------------------------------------------------------------------------------

/** Ends the game if a side has won. @returns {boolean} true if the game ended */
export function checkAndEndGame(ctx, roomId) {
    const imposterWon = RoomsManager.checkWin(roomId);
    if (imposterWon === null) return false;
    const room = RoomsManager.fetchRoom(roomId);
    let reason;
    if (imposterWon) reason = 'crew-eliminated';                       // killed, ejected or left
    else if (!room.players[room.imposter]) reason = 'imposter-left';
    else reason = 'imposter-ejected';
    endGame(ctx, roomId, imposterWon, reason);
    return true;
}

/** The server's game clock ran out: the crew survived. */
function timeUp(ctx, roomId, gameNumber) {
    const room = RoomsManager.fetchRoom(roomId);
    // A timer from an earlier game must never end the current one.
    if (!room || !room.started || room.gameNumber !== gameNumber) return;
    console.log(`[game] room ${roomId}: time is up`);
    endGame(ctx, roomId, false, 'time-up');
}

/**
 * @param {boolean} imposterWon
 * @param {'crew-eliminated'|'imposter-ejected'|'imposter-left'|'time-up'} reason
 */
function endGame(ctx, roomId, imposterWon, reason) {
    const room = RoomsManager.fetchRoom(roomId);
    if (!room) return;

    const imposterId = room.imposter;
    // The imposter may already have left the room: then their name is in leftPlayers.
    const imposterName = PlayersManager.getPlayer(imposterId)?.name
        || room.leftPlayers[imposterId]?.name || 'unknown';

    for (const p of Object.values(room.players)) {
        const isImposter = p.id === imposterId;
        if (imposterWon && isImposter) room.scores[p.id] += POINTS.IMPOSTER_WIN;
        if (!imposterWon && !isImposter) room.scores[p.id] += POINTS.CREW_WIN;
    }

    // Players still in the room, plus those who left during this game (with what they had scored).
    const ranking = Object.values(room.players)
        .map(p => ({ id: p.id, name: p.name, color: p.color, points: room.scores[p.id] || 0 }))
        .concat(Object.values(room.leftPlayers).filter(p => !room.players[p.id]))
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    console.log(`[game] room ${roomId}: ${imposterWon ? 'IMPOSTER' : 'CREW'} wins (${reason}, imposter = ${imposterName})`);
    ctx.sendToRoom(roomId, 'game:ended', {
        roomId,
        isImposter: imposterWon,   // true = the imposter won (name kept from the original client code)
        reason,
        imposterId,
        imposterName,
        ranking,
    });

    RoomsManager.resetRoom(roomId);  // back to the waiting room, scores kept for the next game
    ctx.sendRoomUpdate(roomId);      // the players see the new totals in the waiting room
    ctx.broadcastRooms();            // the lobby list shows the room as "not started" again
}

/** Closes the active meeting (all voted, or timer expired), announces the result, checks for a win. */
export function finishMeeting(ctx, roomId) {
    const results = RoomsManager.meetings.end(roomId); // null if no meeting is active
    if (!results) return;
    // The clients teleport back to spawn when the meeting ends. Do it here too, or the next
    // position they send (at spawn) looks like a teleport and is rejected.
    const room = RoomsManager.fetchRoom(roomId);
    if (room) {
        for (const p of Object.values(room.players)) placeAtSpawn(p);
    }
    console.log(`[game] room ${roomId}: meeting ended, ejected = ${results.ejectedId || 'nobody'}`);
    ctx.sendToRoom(roomId, 'meeting:ended', { results });
    checkAndEndGame(ctx, roomId);
}

/** Server-driven teleport (spawn, kill). The next client position is compared to THIS spot. */
function placeAtSpawn(player) {
    PlayersManager.updatePlayerState(player.id, { ...(player.spawn || SPAWN), d: 'left', moving: false });
    player._moveAt = null;
    player._moveBankMs = 0;
}

/** Called by roomEvents.js after a player was removed from a started game. */
export function afterPlayerLeftGame(ctx, roomId) {
    if (checkAndEndGame(ctx, roomId)) return;
    // If the player who left was the last one still to vote, the meeting can end now.
    const room = RoomsManager.fetchRoom(roomId);
    const meeting = room?.currentMeeting;
    if (meeting?.isActive) {
        const alive = Object.values(room.players).filter(p => p.isAlive);
        if (alive.every(p => meeting.votes[p.id] !== undefined)) finishMeeting(ctx, roomId);
    }
}

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

/** game:start {} - host only. Each player privately learns whether they are the imposter. */
function gameStart(ctx, sessionId) {
    const found = playerAndRoom(ctx, sessionId);
    if (!found) return;
    const { player, room } = found;

    if (room.host.id !== player.id) return notify(ctx, sessionId, 'Only the host can start the game');
    if (room.started) return notify(ctx, sessionId, 'The game has already started');
    const count = Object.keys(room.players).length;
    if (count < MIN_PLAYERS_TO_START) {
        return notify(ctx, sessionId, `Need at least ${MIN_PLAYERS_TO_START} players to start`);
    }

    RoomsManager.startGame(room.id);
    for (const p of Object.values(room.players)) {
        p._moveAt = null;
        p._moveBankMs = 0;
    }
    console.log(`[game] room ${room.id}: game #${room.gameNumber} started with ${count} players`);

    const gameNumber = room.gameNumber;
    room.endTimer = setTimeout(() => timeUp(ctx, room.id, gameNumber), GAME_DURATION_MS);

    // The role is sent PRIVATELY: each player receives their own message, so nobody can see
    // in their traffic (or in Wireshark) who the imposter is, only whether THEY are.
    // Durations, not clock times: the clients' clocks are not synchronised with the server's, so
    // each client counts down from the moment the message reaches it (off by one-way delay only).
    for (const p of Object.values(room.players)) {
        ctx.sendToPlayer(p.id, 'game:started', {
            roomId: room.id,
            isImposter: p.id === room.imposter,
            durationMs: GAME_DURATION_MS,
            killCooldownMs: KILL_COOLDOWN_MS,
        });
    }
    ctx.sendRoomUpdate(room.id);
    ctx.broadcastRooms();
}

/**
 * player:move {x, y, d, moving} - sent ~20 times per second while moving.
 * The server keeps the position only if it is inside the map and no faster than the
 * client is allowed to walk. Anything else is dropped, and the sender is told the
 * position the server still believes (so a cheated client snaps back).
 */
function playerMove(ctx, sessionId, data) {
    const player = PlayersManager.getPlayer(ctx.playerIdOf(sessionId));
    if (!player || !player.roomId) return; // silently: moves are frequent, no notification spam
    if (!isFiniteNumber(data.x) || !isFiniteNumber(data.y)) return;

    const room = RoomsManager.fetchRoom(player.roomId);
    if (!room) return;

    const bounds = room.started ? GAME_MAP : LOBBY_MAP;
    const maxSpeed = room.started ? GAME_SPEED_PX_S : LOBBY_SPEED_PX_S;
    const x = data.x;
    const y = data.y;
    const outside = x < -MAP_EDGE_PX || y < -MAP_EDGE_PX
        || x > bounds.maxX + MAP_EDGE_PX || y > bounds.maxY + MAP_EDGE_PX;

    const now = Date.now();
    // Right after a spawn or a kill, allow one client tick of movement, not a leap across the map.
    // After that, unspent time accumulates (capped) so a short burst of delayed packets still lands.
    let bank;
    if (player._moveAt == null) bank = 80;
    else bank = Math.min(MOVE_BANK_CAP_MS, (player._moveBankMs || 0) + Math.max(0, now - player._moveAt));
    const dist = Math.hypot(x - player.state.x, y - player.state.y);
    const allowed = maxSpeed * SPEED_TOLERANCE * (Math.min(bank, MAX_STEP_MS) / 1000) + MOVE_SLACK_PX;
    const tooFast = dist > allowed;

    if (outside || tooFast) {
        player._moveAt = now;
        if (dist > 30 || outside) {
            console.log(`[game] rejected move from ${player.name}: (${Math.round(x)}, ${Math.round(y)}) ${outside ? 'outside the map' : 'faster than ' + maxSpeed + ' px/s'}`);
        }
        // Tell the sender where they actually are. Other players never saw the bad position.
        // Its own message type, so the UDP version sends it RELIABLY: positions (player:moved) are
        // unreliable, and a lost correction would leave the client stuck where the server refused it.
        ctx.sendTo(sessionId, 'player:corrected', {
            id: player.id,
            roomId: player.roomId,
            ...player.state,
        });
        return;
    }

    const usedMs = maxSpeed > 0 ? (dist / (maxSpeed * SPEED_TOLERANCE)) * 1000 : 0;
    player._moveAt = now;
    player._moveBankMs = Math.max(0, bank - usedMs);

    const state = {
        x,
        y,
        d: data.d === 'right' ? 'right' : 'left',
        moving: data.moving === true,
    };
    // The room keeps a reference to the same player object, so this updates both.
    PlayersManager.updatePlayerState(player.id, state);

    // A dead player walks around as a ghost that only they can see: nothing to relay.
    if (room.started && !player.isAlive) return;

    // Relay to the OTHER players only: the sender already knows where it is.
    // In the UDP version this goes out as an unreliable FAST packet (see protocol UNRELIABLE_TYPES).
    ctx.sendToRoom(player.roomId, 'player:moved', { id: player.id, roomId: player.roomId, ...state }, player.id);
}

/** player:kill {playerId} - playerId is the VICTIM. The killer is whoever owns this session. */
function playerKill(ctx, sessionId, data) {
    const found = playerAndRoom(ctx, sessionId);
    if (!found) return;
    const { player: killer, room } = found;
    const victim = room.players[data.playerId];

    if (!room.started) return notify(ctx, sessionId, 'The game has not started');
    if (room.imposter !== killer.id) return notify(ctx, sessionId, 'Only the imposter can kill');
    if (!killer.isAlive) return notify(ctx, sessionId, 'You are dead');
    if (!victim || victim.id === killer.id || !victim.isAlive) return notify(ctx, sessionId, 'Invalid target');
    if (room.currentMeeting?.isActive) return notify(ctx, sessionId, 'No kills during a meeting');

    const waitMs = KILL_COOLDOWN_MS - (Date.now() - room.lastKillAt);
    if (waitMs > 0) return notify(ctx, sessionId, `Kill on cooldown (${Math.ceil(waitMs / 1000)} s)`);

    // Distance is computed from the SERVER's copy of the positions, not from coordinates the
    // killer could invent in the payload.
    const dist = Math.hypot(killer.state.x - victim.state.x, killer.state.y - victim.state.y);
    if (dist > KILL_RANGE_PX) return notify(ctx, sessionId, 'Too far away');

    victim.isAlive = false;
    room.lastKillAt = Date.now();
    room.scores[killer.id] += POINTS.KILL;
    // The killer jumps onto the body (the client does the same on screen).
    // Reset the movement budget so the next update is measured from the body, not from
    // wherever the killer was standing before the kill.
    PlayersManager.updatePlayerState(killer.id, { x: victim.state.x, y: victim.state.y });
    killer._moveAt = null;
    killer._moveBankMs = 0;

    console.log(`[game] room ${room.id}: ${killer.name} killed ${victim.name}`);
    ctx.sendToRoom(room.id, 'player:killed', {
        playerId: victim.id,
        killerId: killer.id,
        x: victim.state.x,
        y: victim.state.y,
        color: victim.color,   // the dead body has the VICTIM's color
    });
    checkAndEndGame(ctx, room.id);
}

/** meeting:start {} - emergency meeting, once per player per game. */
function meetingStart(ctx, sessionId) {
    const found = playerAndRoom(ctx, sessionId);
    if (!found) return;
    const { player, room } = found;

    if (!room.started) return notify(ctx, sessionId, 'The game has not started');
    if (!player.isAlive) return notify(ctx, sessionId, 'Dead players cannot call a meeting');
    if (room.currentMeeting?.isActive) return notify(ctx, sessionId, 'A meeting is already running');
    if (room.emergencyUsed[player.id]) return notify(ctx, sessionId, 'You already called a meeting this game');

    room.emergencyUsed[player.id] = true;
    // The server owns the timer: the meeting ends when everyone voted or after 30 s, whatever
    // the clients say (a client's "meeting:end" is ignored).
    RoomsManager.meetings.create(room.id, player.id, MEETING_DURATION_MS, () => finishMeeting(ctx, room.id));

    const players = {};
    for (const p of Object.values(room.players)) {
        if (p.isAlive) players[p.id] = { id: p.id, name: p.name, color: p.color, isAlive: true };
    }
    console.log(`[game] room ${room.id}: meeting called by ${player.name}`);
    ctx.sendToRoom(room.id, 'meeting:started', { callerId: player.id, durationMs: MEETING_DURATION_MS, players });
}

/** meeting:vote {votedForId} - a player id, or 'skip'. */
function meetingVote(ctx, sessionId, data) {
    const found = playerAndRoom(ctx, sessionId);
    if (!found) return;
    const { player, room } = found;
    const meeting = room.currentMeeting;
    const target = data.votedForId;

    if (!meeting?.isActive) return notify(ctx, sessionId, 'No meeting is running');
    if (!player.isAlive) return notify(ctx, sessionId, 'Dead players cannot vote');
    if (meeting.votes[player.id] !== undefined) return notify(ctx, sessionId, 'You already voted');
    if (target !== 'skip' && !room.players[target]?.isAlive) return notify(ctx, sessionId, 'Invalid vote');

    const allVoted = RoomsManager.meetings.vote(room.id, player.id, target);
    if (target === room.imposter && player.id !== room.imposter) room.scores[player.id] += POINTS.CORRECT_VOTE;

    // Tell everyone THAT this player voted, not WHO they voted for (revealed in meeting:ended).
    ctx.sendToRoom(room.id, 'meeting:voted', { callerId: player.id });
    if (allVoted) finishMeeting(ctx, room.id);
}

/** meeting:end - ignored on purpose: only the server decides when a meeting ends. */
function meetingEndIgnored() {}

export const gameHandlers = {
    'game:start': gameStart,
    'player:move': playerMove,
    'player:kill': playerKill,
    'meeting:start': meetingStart,
    'meeting:vote': meetingVote,
    'meeting:end': meetingEndIgnored,
};
