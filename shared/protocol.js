// Wire protocol shared by the server and the Electron client, for both versions.
//
// Application messages (identical in TCP and UDP):
//   { t: "<type>", d: <JSON value> }      e.g. { t: "player:move", d: { id, roomId, x, y } }
// Types starting with "__" are reserved for the transports (hello, ping, bye...).
//
// TCP framing:  [uint32 BE length][UTF-8 JSON]                          (see encodeFrame/FrameDecoder)
// UDP datagram: [25-byte binary header][UTF-8 JSON payload], < 1200 B   (see encodePacket/decodePacket)

export const APP_VERSION = 1;

// ---------------------------------------------------------------------------
// Message catalogue + channels
// ---------------------------------------------------------------------------

// Sent on the UDP unreliable channel (dropped if stale, never retransmitted).
// Everything else is reliable + ordered. The TCP version ignores this (TCP is always reliable).
// player:move = INPUT, player:moved = SNAPSHOT in the plan's message catalogue.
export const UNRELIABLE_TYPES = new Set(['player:move', 'player:moved', 'player:animation']);

export const isReliable = (type) => !UNRELIABLE_TYPES.has(type);

const str = (max = 256) => (v) => typeof v === 'string' && v.length <= max;
const id = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 64) || (Number.isInteger(v) && v >= 0);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const bool = (v) => typeof v === 'boolean';
const optional = (check) => (v) => v === undefined || v === null || check(v);

// Client -> server messages and the fields the game handlers rely on.
// Extra fields are allowed (they are passed through to the game as before).
export const CLIENT_MESSAGES = {
    'player:register': { id, name: str(32), color: str(32) },
    'player:unregister': { playerId: id },
    'player:disconnect': { playerId: id },
    'room:create': { hostId: id, roomId: id },
    'room:join': { playerId: id, roomId: id },
    'room:leave': { playerId: id },
    'game:start': { roomId: id },
    'room:send:message': { roomId: id, playerId: id, message: str(500) },
    'player:move': { id, roomId: id, x: num, y: num, d: optional(str(16)), moving: optional(bool) },
    'player:animation': { roomId: id },
    'player:kill': { roomId: id, playerId: id },
    'meeting:start': { roomId: id, callerId: id },
    'meeting:end': { roomId: id },
    'meeting:vote': { roomId: id, callerId: id, votedForId: optional(id) },
    'log': null, // free-form debug text
    // Replaces the old REST GET endpoints: { id, path } -> 'rpc:result' { id, status, body }
    'rpc': { id: num, path: str(200) },
};

const MAX_TYPE_LENGTH = 64;

/** Basic shape check for any message, in either direction. */
export function validateEnvelope(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return 'message is not an object';
    if (typeof msg.t !== 'string' || msg.t.length === 0 || msg.t.length > MAX_TYPE_LENGTH) return 'bad message type';
    return null;
}

/**
 * Validate a message coming from a client. Returns null when valid, or a reason string.
 * Never throws.
 */
export function validateClientMessage(msg) {
    const envelopeError = validateEnvelope(msg);
    if (envelopeError) return envelopeError;
    if (msg.t.startsWith('__')) return `reserved type ${msg.t}`;
    if (!Object.hasOwn(CLIENT_MESSAGES, msg.t)) return `unknown type ${msg.t}`;
    const schema = CLIENT_MESSAGES[msg.t];
    if (schema === null) return null;
    const d = msg.d;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return `${msg.t}: data must be an object`;
    for (const [field, check] of Object.entries(schema)) {
        if (!check(d[field])) return `${msg.t}: invalid field "${field}"`;
    }
    return null;
}

// ---------------------------------------------------------------------------
// JSON encoding
// ---------------------------------------------------------------------------

export const MAX_MESSAGE_BYTES = 64 * 1024;

export function encodeMessage(msg) {
    return Buffer.from(JSON.stringify(msg), 'utf8');
}

/** Parse a UTF-8 JSON message. Throws on invalid JSON or envelope. */
export function decodeMessage(buf) {
    const msg = JSON.parse(buf.toString('utf8'));
    const err = validateEnvelope(msg);
    if (err) throw new Error(err);
    return msg;
}

// ---------------------------------------------------------------------------
// TCP framing: 4-byte big-endian length + UTF-8 JSON
// ---------------------------------------------------------------------------

export const FRAME_HEADER_BYTES = 4;

// Transport control messages on the TCP stream (same envelope as game messages).
//   client -> server  __hello {proto, v, token?}      first frame on every connection
//   server -> client  __welcome {sessionId, token, resumed} | __error {code, message}
//   both ways         __ping {ts} -> __pong {ts}        every second (RTT + liveness)
//   both ways         __bye {}                          clean leave
export const TCP_CONTROL = Object.freeze({
    HELLO: '__hello', WELCOME: '__welcome', ERROR: '__error',
    PING: '__ping', PONG: '__pong', BYE: '__bye',
});

// Handshake error codes (both protocols).
export const HANDSHAKE_ERROR = Object.freeze({
    PROTO_MISMATCH: 'proto-mismatch',
    VERSION_MISMATCH: 'version-mismatch',
    UNKNOWN_SESSION: 'unknown-session',
});

export function encodeFrame(msg) {
    const body = encodeMessage(msg);
    if (body.length > MAX_MESSAGE_BYTES) throw new Error(`frame too large (${body.length} bytes)`);
    const frame = Buffer.allocUnsafe(FRAME_HEADER_BYTES + body.length);
    frame.writeUInt32BE(body.length, 0);
    body.copy(frame, FRAME_HEADER_BYTES);
    return frame;
}

/**
 * Receive buffer for a TCP byte stream. One 'data' chunk can hold half a frame,
 * exactly one, or several (coalesced); push() returns every complete frame body.
 */
export class FrameDecoder {
    constructor(maxFrameBytes = MAX_MESSAGE_BYTES) {
        this.maxFrameBytes = maxFrameBytes;
        this.chunks = [];
        this.buffered = 0;
    }

    /** @returns {Buffer[]} complete frame bodies. Throws if a frame header announces an oversize frame. */
    push(chunk) {
        this.chunks.push(chunk);
        this.buffered += chunk.length;
        const frames = [];
        while (this.buffered >= FRAME_HEADER_BYTES) {
            const head = this._peek(FRAME_HEADER_BYTES);
            const length = head.readUInt32BE(0);
            if (length > this.maxFrameBytes) {
                throw new Error(`frame of ${length} bytes exceeds the ${this.maxFrameBytes}-byte limit`);
            }
            if (this.buffered < FRAME_HEADER_BYTES + length) break; // partial frame: wait for more
            this._consume(FRAME_HEADER_BYTES);
            frames.push(this._consume(length));
        }
        return frames;
    }

    _peek(n) {
        if (this.chunks[0].length >= n) return this.chunks[0].subarray(0, n);
        return Buffer.concat(this.chunks).subarray(0, n);
    }

    _consume(n) {
        const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
        const out = Buffer.from(all.subarray(0, n)); // copy: don't keep the big buffer alive
        const rest = all.subarray(n);
        this.chunks = rest.length ? [rest] : [];
        this.buffered = rest.length;
        return out;
    }
}

// ---------------------------------------------------------------------------
// UDP datagram header (binary, big-endian)
// ---------------------------------------------------------------------------
//  offset size field
//   0     2    magic "AU"
//   2     1    version
//   3     1    type        (PACKET.*)
//   4     1    flags       (FLAG.*)
//   5     8    session token (all zero before the server assigned one)
//  13     4    seq         reliable seq (FLAG.RELIABLE) or unreliable seq ("tick") otherwise
//  17     4    ack         latest reliable seq received from the peer (0 = none yet)
//  21     4    ack bits    bit i set = (ack - 1 - i) also received
//  25          JSON payload (UTF-8)

export const UDP_MAGIC = 0x4155; // "AU"
export const UDP_VERSION = 1;
export const UDP_HEADER_BYTES = 25;
export const MAX_DATAGRAM_BYTES = 1199; // must stay < 1200 (fits a 1280-byte MTU, e.g. Tailscale)
export const MAX_UDP_PAYLOAD = MAX_DATAGRAM_BYTES - UDP_HEADER_BYTES;
export const TOKEN_BYTES = 8;
export const ZERO_TOKEN = Buffer.alloc(TOKEN_BYTES);

export const PACKET = Object.freeze({ HELLO: 1, DATA: 2, ACK: 3, PING: 4, PONG: 5, BYE: 6 });
export const PACKET_NAMES = Object.freeze(Object.fromEntries(Object.entries(PACKET).map(([k, v]) => [v, k])));
export const FLAG = Object.freeze({
    RELIABLE: 0x01,
    MORE_FRAGMENTS: 0x02, // reliable message continues in the next reliable seq
});

/**
 * @param {{type:number, flags?:number, token:Buffer, seq?:number, ack?:number, ackBits?:number}} h
 * @param {Buffer} [payload]
 */
export function encodePacket(h, payload = null) {
    const payloadLength = payload ? payload.length : 0;
    if (UDP_HEADER_BYTES + payloadLength > MAX_DATAGRAM_BYTES) {
        throw new Error(`datagram of ${UDP_HEADER_BYTES + payloadLength} bytes exceeds ${MAX_DATAGRAM_BYTES}`);
    }
    const buf = Buffer.allocUnsafe(UDP_HEADER_BYTES + payloadLength);
    buf.writeUInt16BE(UDP_MAGIC, 0);
    buf.writeUInt8(UDP_VERSION, 2);
    buf.writeUInt8(h.type, 3);
    buf.writeUInt8(h.flags ?? 0, 4);
    h.token.copy(buf, 5, 0, TOKEN_BYTES);
    buf.writeUInt32BE((h.seq ?? 0) >>> 0, 13);
    buf.writeUInt32BE((h.ack ?? 0) >>> 0, 17);
    buf.writeUInt32BE((h.ackBits ?? 0) >>> 0, 21);
    if (payload) payload.copy(buf, UDP_HEADER_BYTES);
    return buf;
}

/**
 * Parse a datagram. Never throws.
 * @returns {{ok: true, header: object, payload: Buffer} | {ok: false, reason: string}}
 */
export function decodePacket(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < UDP_HEADER_BYTES) return { ok: false, reason: 'short packet' };
    if (buf.length > MAX_DATAGRAM_BYTES) return { ok: false, reason: 'oversize packet' };
    if (buf.readUInt16BE(0) !== UDP_MAGIC) return { ok: false, reason: 'bad magic' };
    if (buf.readUInt8(2) !== UDP_VERSION) return { ok: false, reason: 'bad version' };
    const type = buf.readUInt8(3);
    if (!PACKET_NAMES[type]) return { ok: false, reason: 'bad type' };
    return {
        ok: true,
        header: {
            type,
            flags: buf.readUInt8(4),
            token: buf.subarray(5, 5 + TOKEN_BYTES),
            seq: buf.readUInt32BE(13),
            ack: buf.readUInt32BE(17),
            ackBits: buf.readUInt32BE(21),
        },
        payload: buf.subarray(UDP_HEADER_BYTES),
    };
}

export const tokenToHex = (token) => Buffer.from(token).toString('hex');
