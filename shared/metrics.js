// Per-connection metrics shared by all four transports, plus the CSV logger.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_LOGS_DIR = fileURLToPath(new URL('../logs/', import.meta.url));

/**
 * Smoothed RTT (EWMA, alpha = 1/8 as in TCP) and jitter (RFC 3550 style:
 * mean deviation between consecutive RTT samples, gain 1/16).
 */
export class RttTracker {
    constructor() {
        this.srtt = null;
        this.jitter = 0;
        this.prev = null;
    }

    sample(ms) {
        if (!Number.isFinite(ms) || ms < 0) return;
        this.srtt = this.srtt === null ? ms : this.srtt + (ms - this.srtt) / 8;
        if (this.prev !== null) this.jitter += (Math.abs(ms - this.prev) - this.jitter) / 16;
        this.prev = ms;
    }
}

export const newCounters = () => ({ bytesIn: 0, bytesOut: 0, retransmits: 0, lost: 0 });

const round1 = (v) => Math.round(v * 10) / 10;

/** The stats() shape every transport returns. */
export function statsSnapshot(rtt, counters) {
    return {
        rttMs: rtt.srtt === null ? null : round1(rtt.srtt),
        jitterMs: round1(rtt.jitter),
        bytesIn: counters.bytesIn,
        bytesOut: counters.bytesOut,
        retransmits: counters.retransmits,
        lost: counters.lost,
    };
}

const pad = (n) => String(n).padStart(2, '0');
export function localDate(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const CSV_HEADER = 'time,unix_ms,proto,side,session,rtt_ms,jitter_ms,bytes_in,bytes_out,retransmits,lost\n';

/**
 * Appends one row per call to logs/<proto>-<YYYY-MM-DD>.csv.
 * Server and clients can share the file: the "side" and "session" columns tell rows apart.
 */
export class CsvStatsLogger {
    /** @param {{proto: string, side: string, dir?: string}} opts */
    constructor({ proto, side, dir = DEFAULT_LOGS_DIR }) {
        this.proto = proto;
        this.side = side;
        this.dir = dir;
        this.file = null;
        this.disabled = false;
    }

    _ensureFile() {
        const file = path.join(this.dir, `${this.proto}-${localDate()}.csv`);
        if (file === this.file) return file;
        fs.mkdirSync(this.dir, { recursive: true });
        let needsHeader = true;
        try {
            needsHeader = fs.statSync(file).size === 0;
        } catch {
            // file does not exist yet
        }
        if (needsHeader) fs.appendFileSync(file, CSV_HEADER);
        this.file = file;
        return file;
    }

    log(sessionId, s) {
        if (this.disabled) return;
        const now = new Date();
        const row = [
            now.toISOString(), now.getTime(), this.proto, this.side, sessionId,
            s.rttMs ?? '', s.jitterMs, s.bytesIn, s.bytesOut, s.retransmits, s.lost,
        ].join(',') + '\n';
        try {
            fs.appendFileSync(this._ensureFile(), row);
        } catch (err) {
            // Metrics must never take the game down (read-only folder, disk full...).
            console.warn(`[metrics] CSV logging disabled: ${err.message}`);
            this.disabled = true;
        }
    }
}
