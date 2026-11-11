// Among Us Arena: Electron client (main process).
//
//   npm run start:client                 protocol from shared/config.js
//   npm run client:tcp | client:udp      force a protocol
//   npm run client:udp -- --server 192.168.1.10 [--port 5001] [--loss 20]
//
// Only this process opens sockets (through NetClient + the transport from the factory).
// The renderer (existing React + Phaser UI, loaded from local files) talks to it over IPC:
//   renderer -> main   'net:send' {t, d}       ipcRenderer.invoke('net:request', path)  'net:getStatus'
//   main -> renderer   'net:message' {t, d}    'net:status' {state, message, sessionId, ...}
//                      'net:stats' {proto, sessionId, rttMs, jitterMs, bytesIn, bytesOut, retransmits, lost}
import { app, BrowserWindow, ipcMain, protocol, dialog, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNetConfig } from '../../shared/transportFactory.js';
import { validateClientMessage } from '../../shared/protocol.js';
import { CsvStatsLogger } from '../../shared/metrics.js';
import { TIMING } from '../../shared/config.js';
import { NetClient } from './netClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(here, '../../frontend/dist');
const APP_ORIGIN = 'app://bundle';

// UI is served from disk through a private scheme (not file://, so absolute /assets/... paths
// work; not HTTP, so nothing leaves the PC).
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let cfg;
let configError = null;
try {
    cfg = resolveNetConfig({ argv: process.argv.slice(1) });
} catch (err) {
    configError = err.message;
}
const smokeSeconds = (() => {
    const i = process.argv.indexOf('--smoke');
    return i === -1 ? 0 : Number(process.argv[i + 1]) || 8;
})();

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff',
    '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
};

function serveUi() {
    protocol.handle('app', async (request) => {
        const { pathname } = new URL(request.url);
        const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
        const file = path.normalize(path.join(UI_DIR, rel));
        if (!file.startsWith(UI_DIR + path.sep)) return new Response('forbidden', { status: 403 });
        try {
            const data = await fs.promises.readFile(file);
            return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
        } catch {
            return new Response('not found', { status: 404 });
        }
    });
}

/** No HTTP/WebSocket from the renderer: the game must only use the selected raw transport. */
function blockNetworkRequests() {
    session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (details, callback) => {
            console.warn(`[client] blocked renderer request to ${details.url} (only ${cfg?.proto ?? 'the game'} transport allowed)`);
            callback({ cancel: true });
        });
}

function baseTitle() {
    return `Among Us Arena: ${cfg.proto.toUpperCase()} @ ${cfg.host}:${cfg.port}`;
}

function titleFor(status) {
    switch (status.state) {
        case 'connected': return baseTitle();
        case 'reconnecting': return `${baseTitle()} (reconnecting...)`;
        case 'error': return `${baseTitle()} (cannot connect)`;
        case 'disconnected': return `${baseTitle()} (disconnected)`;
        default: return `${baseTitle()} (connecting...)`;
    }
}

async function main() {
    await app.whenReady();

    if (configError) {
        dialog.showErrorBox('Among Us Arena: invalid network settings', configError);
        app.exit(1);
        return;
    }
    serveUi();
    blockNetworkRequests();

    const uiBuilt = fs.existsSync(path.join(UI_DIR, 'index.html'));
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        title: baseTitle(),
        webPreferences: {
            preload: path.join(here, 'preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false, // the spellchecker can download dictionaries over HTTPS
        },
    });
    win.on('page-title-updated', (e) => e.preventDefault()); // keep the protocol in the title

    const net = new NetClient(cfg);
    const send = (channel, payload) => {
        if (!win.isDestroyed()) win.webContents.send(channel, payload);
    };

    net.on('status', (status) => {
        if (!win.isDestroyed()) win.setTitle(titleFor(status));
        send('net:status', status);
        console.log(`[client] ${cfg.proto.toUpperCase()} ${status.state}: ${status.message}`);
    });
    net.on('message', (msg) => send('net:message', msg));
    net.on('connect-error', (text) => {
        // Readable error instead of a silent hang (typical cause: client and server use different protocols).
        dialog.showMessageBox(win, {
            type: 'warning',
            title: 'Among Us Arena: cannot reach the server',
            message: `Cannot connect using ${cfg.proto.toUpperCase()} to ${cfg.host}:${cfg.port}`,
            detail: `${text}\n\nThe client keeps retrying every few seconds.`,
        }).catch(() => {});
    });

    ipcMain.on('net:send', (_e, msg) => {
        const error = validateClientMessage(msg);
        if (error) {
            console.warn(`[client] not sending invalid message: ${error}`);
            return;
        }
        net.send(msg);
    });
    ipcMain.handle('net:request', (_e, reqPath) => net.request(String(reqPath)));
    ipcMain.handle('net:getStatus', () => net.status);

    // Metrics: push to the renderer (HUD) and log one CSV row per second.
    const csv = new CsvStatsLogger({ proto: cfg.proto, side: 'client' });
    const statsTimer = setInterval(() => {
        const s = net.stats();
        if (!s || !net.status.sessionId) return;
        send('net:stats', { proto: cfg.proto, host: cfg.host, port: cfg.port, sessionId: net.status.sessionId, state: net.status.state, ...s });
        csv.log(net.status.sessionId, s);
    }, TIMING.statsIntervalMs);

    win.on('closed', () => {
        clearInterval(statsTimer);
        net.close(); // BYE to the server
    });
    app.on('window-all-closed', () => app.quit());

    console.log(`[client] protocol ${cfg.proto.toUpperCase()} (chosen by ${cfg.source.proto}), server ${cfg.host}:${cfg.port}`);
    net.start();

    if (!uiBuilt) {
        await win.loadURL(`data:text/html,<h2 style="font-family:sans-serif">UI not built.</h2><p style="font-family:sans-serif">Run <code>npm run build:ui</code> first.</p>`);
    } else {
        await win.loadURL(`${APP_ORIGIN}/index.html`);
    }

    if (smokeSeconds) runSmoke(win, net, smokeSeconds);
}

/** --smoke N: print what the jury would see after N seconds, then quit (used for automated checks). */
function runSmoke(win, net, seconds) {
    const consoleErrors = [];
    win.webContents.on('console-message', (event) => {
        const level = event.level ?? event.params?.level;
        const message = event.message ?? event.params?.message;
        if (level === 'error' || level === 3) consoleErrors.push(String(message).slice(0, 200));
    });
    setTimeout(async () => {
        let renderer = null;
        try {
            renderer = await win.webContents.executeJavaScript(`({
                hasNetBridge: typeof window.net === 'object',
                root: document.getElementById('root')?.children.length ?? 0,
                canvas: document.querySelectorAll('canvas').length,
                text: document.body.innerText.slice(0, 120),
            })`);
        } catch (err) {
            renderer = { error: err.message };
        }
        // Round trip through preload -> main -> server -> main -> renderer, from inside the page.
        let ipc = null;
        try {
            ipc = await win.webContents.executeJavaScript(`new Promise((resolve) => {
                window.net.onStats((s) => { window.__stats = s; });
                const off = window.net.onMessage((m) => {
                    if (m.t === 'player:registered') { off(); resolve({ registered: m.d.playerId }); }
                });
                window.net.request('/rooms').then((r) => {
                    window.__rooms = r.status + ':' + r.body.length;
                    window.net.send('player:register', { id: 'smoke-' + Date.now(), name: 'Smoke', color: 'red' });
                });
                setTimeout(() => resolve({ registered: null }), 3000);
            }).then((r) => new Promise((done) => setTimeout(() => done(r), 1200)))
              .then((r) => ({ ...r, rooms: window.__rooms, netStats: window.__stats ?? null }))`);
        } catch (err) {
            ipc = { error: err.message };
        }
        console.log(`SMOKE ${JSON.stringify({ title: win.getTitle(), status: net.status, stats: net.stats(), renderer, ipc, consoleErrors })}`);
        app.quit();
    }, seconds * 1000);
}

main().catch((err) => {
    console.error('[client] fatal:', err);
    app.exit(1);
});
