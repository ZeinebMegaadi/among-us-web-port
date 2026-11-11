// The ONLY place that maps a protocol name to a transport module.
// server/main.js and client/electron/main.js go through here; nothing else imports
// a specific transport or hard-codes the protocol.
import { TRANSPORT, PORTS, SERVER_HOST } from './config.js';

const MODULES = {
    server: {
        tcp: new URL('../server/transport/tcp.js', import.meta.url),
        udp: new URL('../server/transport/udp.js', import.meta.url),
    },
    client: {
        tcp: new URL('../client/electron/transport/tcp.js', import.meta.url),
        udp: new URL('../client/electron/transport/udp.js', import.meta.url),
    },
};

export const PROTOCOLS = Object.freeze(Object.keys(MODULES.server));

export class ConfigError extends Error {}

/** Parse "--name value" and "--name=value" flags. Unknown flags are ignored (Electron adds its own). */
export function parseFlags(argv) {
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (typeof arg !== 'string' || !arg.startsWith('--')) continue;
        const eq = arg.indexOf('=');
        if (eq !== -1) {
            flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        } else if (i + 1 < argv.length && !String(argv[i + 1]).startsWith('--')) {
            flags[arg.slice(2)] = argv[++i];
        } else {
            flags[arg.slice(2)] = true;
        }
    }
    return flags;
}

function pick(flagValue, envValue, configValue) {
    if (flagValue !== undefined && flagValue !== true) return { value: flagValue, source: 'CLI flag' };
    if (envValue !== undefined && envValue !== '') return { value: envValue, source: 'env var' };
    return { value: configValue, source: 'shared/config.js' };
}

/**
 * Resolve the active network settings. Priority: CLI flag > env var > shared/config.js.
 * Throws ConfigError on an invalid protocol, port or loss value.
 *
 * @returns {{proto: string, host: string, port: number, loss: number, seed: number|null,
 *            source: {proto: string, host: string, port: string}}}
 */
export function resolveNetConfig({ argv = process.argv.slice(2), env = process.env } = {}) {
    const flags = parseFlags(argv);

    const protoPick = pick(flags.proto, env.TRANSPORT, TRANSPORT);
    const proto = String(protoPick.value).trim().toLowerCase();
    if (!PROTOCOLS.includes(proto)) {
        throw new ConfigError(
            `Invalid transport "${protoPick.value}" (from ${protoPick.source}). Use one of: ${PROTOCOLS.join(', ')}.`);
    }

    const hostPick = pick(flags.server, env.SERVER_HOST, SERVER_HOST);
    const host = String(hostPick.value).trim();
    if (!host) throw new ConfigError(`Invalid server host (from ${hostPick.source}).`);

    const portPick = pick(flags.port, env.TRANSPORT_PORT, PORTS[proto]);
    const port = Number(portPick.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ConfigError(`Invalid port "${portPick.value}" (from ${portPick.source}). Use 1-65535.`);
    }

    // Built-in packet loss simulator (UDP only): --loss <percent> [--seed <n>]
    const lossRaw = flags.loss === undefined ? env.NET_LOSS : flags.loss;
    const loss = lossRaw === undefined || lossRaw === '' ? 0 : Number(lossRaw);
    if (!Number.isFinite(loss) || loss < 0 || loss > 90) {
        throw new ConfigError(`Invalid --loss "${lossRaw}". Use a percentage from 0 to 90.`);
    }
    const seed = flags.seed === undefined ? null : Number(flags.seed);

    return {
        proto, host, port, loss, seed,
        source: { proto: protoPick.source, host: hostPick.source, port: portPick.source },
    };
}

/**
 * Turn a client connect() failure into a sentence a player (or the jury) can act on.
 * Typical cause: client and server started with different protocols.
 * @param {Error & {code?: string}} err
 * @param {{proto: string, host: string, port: number}} cfg
 */
export function explainConnectError(err, { proto, host, port }) {
    const P = proto.toUpperCase();
    const other = PROTOCOLS.find((p) => p !== proto);
    const hint = `Check that the server runs the ${P} version (--proto ${proto}) on port ${port}. ` +
        `If it runs the ${other.toUpperCase()} version (port ${PORTS[other]}), start this client with --proto ${other}, ` +
        `or set the same TRANSPORT in shared/config.js on both machines.`;
    switch (err?.code) {
        case 'ECONNREFUSED':
            return `No ${P} game server at ${host}:${port} (connection refused). ${hint}`;
        case 'HELLO_TIMEOUT':
            return `No answer from a ${P} game server at ${host}:${port}: the handshake timed out. ${hint}`;
        case 'proto-mismatch':
            return `The server at ${host}:${port} speaks a different protocol (${err.message}). ${hint}`;
        case 'version-mismatch':
            return `Client and server builds are incompatible (${err.message}). Update both to the same version.`;
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
            return `Unknown server host "${host}". Check --server / SERVER_HOST.`;
        case 'ETIMEDOUT':
        case 'EHOSTUNREACH':
        case 'ENETUNREACH':
            return `Cannot reach ${host}:${port} (${err.code}). Check the IP address, the network and the firewall.`;
        default:
            return `Could not connect to the ${P} server at ${host}:${port}: ${err?.message ?? err}`;
    }
}

/**
 * Load and instantiate the transport for one side.
 * @param {'server'|'client'} side
 * @param {string} proto
 * @param {object} [options] passed to the transport constructor
 */
export async function createTransport(side, proto, options = {}) {
    const url = MODULES[side]?.[proto];
    if (!url) throw new ConfigError(`No ${side} transport for protocol "${proto}".`);
    const { default: Transport } = await import(url.href);
    return new Transport(options);
}
