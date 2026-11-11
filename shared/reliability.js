// UDP reliability layer, shared by server/transport/udp.js and client/electron/transport/udp.js.
//
// One UdpConnection = one peer. It owns everything below the "message" level:
//
// Reliable channel (FLAG.RELIABLE): login, rooms, start, kill, vote, round end...
//   - sender: every message gets seq 1, 2, 3...; unacked ones are kept and resent after
//     RTO = max(100 ms, 2 x SRTT), SRTT = EWMA of RTT samples (Karn: never from resent packets)
//   - receiver: delivers strictly in order, buffers gaps, drops duplicates but ACKs them again
//   - acks: every outgoing packet piggybacks {ack = highest seq received, ackBits = the 32 before};
//     a standalone ACK goes out ~5 ms after a reliable packet if nothing else carried it
//   - messages larger than one datagram are split into consecutive reliable seqs
//     (FLAG.MORE_FRAGMENTS on all but the last); in-order delivery makes reassembly trivial
//
// Unreliable channel: player:move (INPUT), player:moved (SNAPSHOT), PING/PONG
//   - numbered by a per-direction sequence ("tick"); anything not newer than the newest
//     already received is dropped; gaps are counted as lost; never retransmitted
//   - must fit in one datagram (no splitting)
import {
    PACKET, FLAG, encodePacket, encodeMessage, decodeMessage, MAX_UDP_PAYLOAD, MAX_MESSAGE_BYTES,
} from './protocol.js';
import { RttTracker, newCounters, statsSnapshot } from './metrics.js';
import { TIMING } from './config.js';

const MIN_RTO_MS = 100;
const INITIAL_RTO_MS = 200;
const ACK_DELAY_MS = 5;
const MAX_GAP = 4096;         // reliable seq this far ahead of what we expect = garbage
const ACK_WINDOW = 32;

export class UdpConnection {
    /**
     * @param {{token: Buffer, sendRaw: (buf: Buffer) => void, onMessage: (msg: object) => void,
     *          timing?: object, logger?: Console}} opts
     */
    constructor({ token, sendRaw, onMessage, timing = TIMING, logger = console }) {
        this.token = Buffer.from(token);
        this.sendRaw = sendRaw;
        this.onMessage = onMessage;
        this.timing = timing;
        this.logger = logger;

        this.suspended = false; // true while the peer is unreachable (lost, reconnecting)
        this.rtt = new RttTracker();
        this.counters = newCounters();
        this.duplicates = 0;
        this.stale = 0;

        // reliable, sending side
        this.nextSeq = 1;
        /** @type {Map<number, {flags: number, payload: Buffer, sentAt: number, tries: number}>} */
        this.unacked = new Map();

        // reliable, receiving side
        this.nextExpected = 1;
        this.highestReceived = 0;
        /** @type {Map<number, {flags: number, payload: Buffer}>} */
        this.recvBuffer = new Map();
        this.fragments = [];
        this.fragmentBytes = 0;
        this.pendingAcks = new Set();
        this.ackTimer = null;

        // unreliable
        this.nextUnreliableSeq = 1;
        this.newestUnreliable = 0;

        this.lastPing = 0;
    }

    get rto() {
        return this.rtt.srtt === null ? INITIAL_RTO_MS : Math.max(MIN_RTO_MS, 2 * this.rtt.srtt);
    }

    // ------------------------------------------------------------------ sending

    /** @returns {boolean} false if the message was rejected (too big, or unreliable while suspended) */
    sendMessage(msg, reliable) {
        let body;
        try {
            body = encodeMessage(msg);
        } catch (err) {
            this.logger.warn(`[udp] cannot encode ${msg?.t}: ${err.message}`);
            return false;
        }
        return this.sendEncoded(body, reliable, msg?.t);
    }

    sendEncoded(body, reliable, typeForLogs = '?') {
        if (body.length > MAX_MESSAGE_BYTES) {
            this.logger.warn(`[udp] ${typeForLogs}: ${body.length} bytes exceeds ${MAX_MESSAGE_BYTES}, dropped`);
            return false;
        }
        if (!reliable) {
            if (body.length > MAX_UDP_PAYLOAD) {
                // Splitting unreliable data makes no sense: losing one part loses all.
                this.logger.warn(`[udp] unreliable ${typeForLogs} is ${body.length} bytes (> ${MAX_UDP_PAYLOAD}), rejected`);
                return false;
            }
            if (this.suspended) return false;
            this._send(PACKET.DATA, 0, this.nextUnreliableSeq++, body);
            return true;
        }
        // Reliable: split into datagram-sized fragments, each with its own seq.
        const now = performance.now();
        for (let offset = 0; offset < body.length || offset === 0; offset += MAX_UDP_PAYLOAD) {
            const chunk = body.subarray(offset, offset + MAX_UDP_PAYLOAD);
            const more = offset + MAX_UDP_PAYLOAD < body.length;
            const flags = FLAG.RELIABLE | (more ? FLAG.MORE_FRAGMENTS : 0);
            const seq = this.nextSeq++;
            this.unacked.set(seq, { flags, payload: chunk, sentAt: now, tries: 1 });
            if (!this.suspended) this._send(PACKET.DATA, flags, seq, chunk);
            if (!more) break;
        }
        return true;
    }

    /** Send a control packet (HELLO, BYE...) with an optional JSON payload. Not sequenced. */
    sendControl(type, payloadObj = null) {
        this._send(type, 0, 0, payloadObj ? encodeMessage(payloadObj) : null);
    }

    _ackFields() {
        const ack = this.highestReceived;
        return { ack, ackBits: this._ackBitsFor(ack) };
    }

    _ackBitsFor(ack) {
        let bits = 0;
        for (let i = 0; i < ACK_WINDOW; i++) {
            const s = ack - 1 - i;
            if (s < 1) break;
            if (s < this.nextExpected || this.recvBuffer.has(s)) bits |= (1 << i);
        }
        return bits >>> 0;
    }

    _send(type, flags, seq, payload) {
        const { ack, ackBits } = this._ackFields();
        const buf = encodePacket({ type, flags, token: this.token, seq, ack, ackBits }, payload);
        // Whatever we just sent carries an ack for everything in [ack-32, ack].
        for (const s of this.pendingAcks) if (s <= ack && ack - s <= ACK_WINDOW) this.pendingAcks.delete(s);
        this.counters.bytesOut += buf.length;
        this.sendRaw(buf);
    }

    // ------------------------------------------------------------------ receiving

    /** Handle DATA / ACK / PING / PONG (HELLO and BYE are handled by the transport). */
    handlePacket(header, payload) {
        // (bytesIn is counted by the transport, for every valid datagram of this session)
        this._processAck(header.ack, header.ackBits);
        switch (header.type) {
            case PACKET.ACK:
                return;
            case PACKET.DATA:
                if (header.flags & FLAG.RELIABLE) return this._onReliable(header.seq, header.flags, payload);
                if (this._acceptUnreliable(header.seq)) this._deliver(payload);
                return;
            case PACKET.PING:
                if (!this._acceptUnreliable(header.seq)) return;
                if (!this.suspended) this._send(PACKET.PONG, 0, this.nextUnreliableSeq++, payload);
                return;
            case PACKET.PONG: {
                if (!this._acceptUnreliable(header.seq)) return;
                try {
                    const { ts } = JSON.parse(payload.toString('utf8'));
                    if (Number.isFinite(ts)) this.rtt.sample(performance.now() - ts);
                } catch { /* malformed PONG: ignore */ }
            }
        }
    }

    _processAck(ack, bits) {
        if (!ack || this.unacked.size === 0) return;
        const now = performance.now();
        for (const [seq, entry] of this.unacked) {
            const d = ack - seq;
            const acked = d === 0 || (d > 0 && d <= ACK_WINDOW && ((bits >>> (d - 1)) & 1));
            if (!acked) continue;
            if (entry.tries === 1) this.rtt.sample(now - entry.sentAt); // Karn's rule
            this.unacked.delete(seq);
        }
    }

    _onReliable(seq, flags, payload) {
        if (seq === 0) return;
        if (seq < this.nextExpected || this.recvBuffer.has(seq)) {
            this.duplicates++;
            this._queueAck(seq); // the sender missed our ACK: send it again
            return;
        }
        if (seq - this.nextExpected > MAX_GAP) return; // nonsense, don't buffer
        this.recvBuffer.set(seq, { flags, payload: Buffer.from(payload) });
        if (seq > this.highestReceived) this.highestReceived = seq;
        this._queueAck(seq);
        // Deliver everything that is now contiguous.
        while (this.recvBuffer.has(this.nextExpected)) {
            const entry = this.recvBuffer.get(this.nextExpected);
            this.recvBuffer.delete(this.nextExpected);
            this.nextExpected++;
            this._onReliablePayload(entry);
        }
    }

    _onReliablePayload({ flags, payload }) {
        if (flags & FLAG.MORE_FRAGMENTS) {
            this.fragments.push(payload);
            this.fragmentBytes += payload.length;
            if (this.fragmentBytes > MAX_MESSAGE_BYTES) {
                this.logger.warn('[udp] fragmented message too large, discarded');
                this.fragments = [];
                this.fragmentBytes = 0;
            }
            return;
        }
        const whole = this.fragments.length ? Buffer.concat([...this.fragments, payload]) : payload;
        this.fragments = [];
        this.fragmentBytes = 0;
        this._deliver(whole);
    }

    _acceptUnreliable(seq) {
        if (seq <= this.newestUnreliable) {
            this.stale++; // older than what we already have: useless now
            return false;
        }
        if (this.newestUnreliable > 0 && seq > this.newestUnreliable + 1) {
            this.counters.lost += seq - this.newestUnreliable - 1;
        }
        this.newestUnreliable = seq;
        return true;
    }

    _deliver(body) {
        let msg;
        try {
            msg = decodeMessage(body);
        } catch (err) {
            this.logger.warn(`[udp] bad payload: ${err.message}`);
            return;
        }
        try {
            this.onMessage(msg);
        } catch (err) {
            this.logger.error('[udp] message handler threw:', err);
        }
    }

    _queueAck(seq) {
        this.pendingAcks.add(seq);
        if (this.ackTimer) return;
        this.ackTimer = setTimeout(() => this._flushAcks(), ACK_DELAY_MS);
        this.ackTimer.unref?.();
    }

    _flushAcks() {
        this.ackTimer = null;
        if (this.pendingAcks.size === 0 || this.suspended) return;
        // One ACK for the newest seq covers the 32 before it; older stragglers get their own.
        const pending = [...this.pendingAcks];
        this.pendingAcks.clear();
        const top = this.highestReceived;
        this._send(PACKET.ACK, 0, 0, null);
        for (const s of pending) {
            if (s <= top && top - s <= ACK_WINDOW) continue;
            const buf = encodePacket({ type: PACKET.ACK, token: this.token, ack: s, ackBits: this._ackBitsFor(s) });
            this.counters.bytesOut += buf.length;
            this.sendRaw(buf);
        }
    }

    // ------------------------------------------------------------------ timers

    /** Call every ~20 ms: retransmits due reliable packets and sends the 1 s PING. */
    tick(nowMs = performance.now()) {
        if (this.suspended) return;
        const rto = this.rto;
        for (const [seq, entry] of this.unacked) {
            if (nowMs - entry.sentAt < rto) continue;
            entry.sentAt = nowMs;
            entry.tries++;
            this.counters.retransmits++;
            this._send(PACKET.DATA, entry.flags, seq, entry.payload);
        }
        if (nowMs - this.lastPing >= this.timing.pingIntervalMs) {
            this.lastPing = nowMs;
            this._send(PACKET.PING, 0, this.nextUnreliableSeq++, encodeMessage({ ts: nowMs }));
        }
    }

    suspend() {
        this.suspended = true;
    }

    /** Peer is reachable again: resend everything still unacked right away. */
    resume() {
        this.suspended = false;
        for (const entry of this.unacked.values()) entry.sentAt = -Infinity;
        this.lastPing = 0;
    }

    close() {
        clearTimeout(this.ackTimer);
        this.ackTimer = null;
        this.unacked.clear();
        this.recvBuffer.clear();
    }

    stats() {
        return statsSnapshot(this.rtt, this.counters);
    }
}
