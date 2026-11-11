// Built-in network impairment for the UDP transports, so reliability can be tested
// without OS tools (clumsy / tc netem). Applied to OUTGOING datagrams only; enable it on
// both ends to impair both directions.
//
//   --loss 20  ->  20 % dropped, 10 % duplicated, 10 % delayed 20-80 ms (reordered)

/** Small seeded PRNG (mulberry32) so a failing run can be replayed with --seed. */
export function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * @param {(buf: Buffer, ...dest: any[]) => void} send  the real send function (extra args, e.g. port/address, are passed through)
 * @param {{loss?: number, duplicate?: number, reorder?: number, seed?: number|null}} [opts]  percentages
 * @returns {{send: (buf: Buffer, ...dest: any[]) => void, counters: {dropped:number, duplicated:number, reordered:number}}}
 */
export function createLossySender(send, opts = {}) {
    const loss = (opts.loss ?? 0) / 100;
    const duplicate = (opts.duplicate ?? (opts.loss ?? 0) / 2) / 100;
    const reorder = (opts.reorder ?? (opts.loss ?? 0) / 2) / 100;
    const random = opts.seed === null || opts.seed === undefined ? Math.random : seededRandom(opts.seed);
    const counters = { dropped: 0, duplicated: 0, reordered: 0 };

    if (loss === 0 && duplicate === 0 && reorder === 0) return { send, counters };

    const later = (buf, dest) => setTimeout(() => send(buf, ...dest), 20 + random() * 60).unref?.();
    return {
        counters,
        send(buf, ...dest) {
            if (random() < loss) {
                counters.dropped++;
                return;
            }
            if (random() < reorder) {
                counters.reordered++;
                later(buf, dest);
            } else {
                send(buf, ...dest);
            }
            if (random() < duplicate) {
                counters.duplicated++;
                later(buf, dest);
            }
        },
    };
}
