// URL helpers for the REST API + WebSocket.
//
// Local dev (default): empty base → browser hits the Vite origin (port 8080),
// and Vite proxies /rooms, /player, /isImposter, /ws to the backend.
// That avoids CORS entirely during development.
//
// Production / direct backend: set VITE_BACKEND_URL (and optionally VITE_SOCKET_URL)
// to the absolute backend origin. API and WebSocket share one server/port.

const SOCKET_PATH = '/ws';

function normalizeUrl(url) {
  return String(url).replace(/\/$/, '');
}

/**
 * Base URL for REST API calls.
 * @returns {string} Absolute origin, or '' for same-origin (Vite proxy).
 */
export function getBackendBase() {
  if (import.meta.env.VITE_BACKEND_URL) {
    return normalizeUrl(import.meta.env.VITE_BACKEND_URL);
  }
  // Same-origin: Vite dev proxy (or reverse proxy in production) handles routing.
  return '';
}

/**
 * Build a full API path URL.
 * @param {string} path e.g. '/rooms' or 'rooms'
 */
export function apiUrl(path) {
  const base = getBackendBase();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

/**
 * WebSocket server URL, e.g. "wss://my-backend.example.com/ws".
 * Accepts http(s):// or ws(s):// in the env vars; http→ws, https→wss.
 * If the configured URL has no path, "/ws" is appended.
 * With nothing configured, uses the page origin (Vite proxies /ws in dev).
 * @returns {string}
 */
export function getSocketUrl() {
  const configured =
    import.meta.env.VITE_SOCKET_URL ||
    // Same process serves HTTP + WebSocket — reuse backend URL when set.
    import.meta.env.VITE_BACKEND_URL ||
    window.location.origin;

  const url = new URL(normalizeUrl(configured), window.location.href);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.pathname === '' || url.pathname === '/') url.pathname = SOCKET_PATH;
  return url.toString();
}

/**
 * GET a former REST endpoint ('/rooms', '/rooms/:id', '/player/room/:id', '/isImposter/?...').
 * Electron client: sent as a message over the game connection (no HTTP at all).
 * Browser build: plain fetch() to the backend.
 * Returns a fetch-like object: { ok, status, json() }.
 * @param {string} path
 */
export async function apiFetch(path) {
  const bridge = typeof window !== 'undefined' ? window.net : undefined;
  if (!bridge) return fetch(apiUrl(path));
  const { status, body } = await bridge.request(path);
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
