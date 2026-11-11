# Among Us
A multiplayer web based clone of game among us built with Phaser 3, React, and Node.js.



https://github.com/user-attachments/assets/bdd8ef37-4397-46ca-a9a9-42f1fd0e4a7d



## Desktop versions: TCP and UDP (Among Us Arena)

One authoritative Node server and Electron clients. Only the transport differs between the two
versions. The Electron main process opens a raw `net` (TCP) or `dgram` (UDP) socket, and the
React + Phaser UI talks to it over IPC. There is no Socket.IO, no HTTP and no WebSocket.

**Switch the version by changing one word** in [`shared/config.js`](shared/config.js):

```js
export const TRANSPORT = 'tcp';   // 'tcp' | 'udp'
```

```bash
npm install && npm --prefix backend install && npm --prefix frontend install
npm run build:ui                      # once, and after every UI change

npm run start:server                  # uses shared/config.js
npm run start:client                  # (window title shows e.g. "Among Us Arena: TCP @ 127.0.0.1:5000")
npm run server:udp                    # or force a version: server:tcp, client:tcp, client:udp
npm run client:udp -- --server 192.168.1.10
```

Overrides, highest priority first: CLI flags `--proto tcp|udp --server <host> --port <n>`, then env vars
`TRANSPORT`, `SERVER_HOST`, `TRANSPORT_PORT`, then `shared/config.js`. Any protocol other than
`tcp`/`udp` is refused.

| Path | What it is |
|---|---|
| `shared/config.js` | The switch, ports, host, timings |
| `shared/transportFactory.js` | The only place that maps a protocol to a module; parses overrides |
| `shared/protocol.js` | Message envelope + validation, TCP framing, binary UDP header |
| `shared/reliability.js` | UDP reliable/unreliable channels (used by the server and the client) |
| `shared/metrics.js` | RTT/jitter, CSV logger (`logs/<proto>-<date>.csv`) |
| `server/main.js`, `server/transport/` | Server entry point and the two transports ([contract and reconnect](server/transport/README.md)) |
| `server/gameAdapter.js` | Runs the existing `backend/src/events` game logic on either transport |
| `client/electron/` | Electron main process, `preload.cjs` (`window.net`), `netClient.js`, transports |
| `tools/transport-test.mjs` | `npm run test:all`; UDP loss simulation: `--proto udp --loss 20` |
| `tools/udp-echo.mjs`, [`NETWORK_TESTS.md`](NETWORK_TESTS.md) | Network checks, loss runs, Wireshark filters |

The browser build below (Express + WebSocket in `backend/src/server.js`) still works for web development.

## Project Structure
```
among-us/
├── frontend/                 # React + Phaser 3 frontend application
│   ├── src/                  # React components and game code
│   │   ├── game/             # Phaser 3 game logic
│   │   ├── components/       # React components
│   │   ├── assets/           # Game assets
│   │   └── main.tsx          # Frontend entry point
│   ├── vite/                 # Vite configuration files
│   ├── package.json          # Frontend dependencies
│   ├── tailwind.config.cjs   # Tailwind CSS configuration
│   ├── postcss.config.cjs    # PostCSS configuration
│   ├── .eslintrc.cjs         # ESLint configuration
│   └── index.html            # HTML entry point
├── backend/                  # Node.js + Express backend server
│   ├── src/                  # Backend source code
│   ├── package.json          # Backend dependencies
│   └── tsconfig.json         # TypeScript configuration
└── misc/                     # Miscellaneous files
```
## Important Files
### Frontend
```
/frontend/src/pages/Menu.jsx
Manages the initial player registeration and room select events.
```
```
/frontend/src/App.jsx
Manages the Game UI components visibility.
```
```
frontend/src/game/Game.js
Main phaser file, manages the whole game logic and connection with backend
```
### Backend
```
/backend/src/events/
Contains the real-time event handlers (plain WebSocket, see `src/socket/wsServer.js`)
```
```
backend/src/managers
Contains files to manage the game state, like player updates and game room updates
```

## Technology Stack
### Frontend
- **React** 19.0.0 - UI library
- **Phaser** 3.90.0 - Game framework
- **Vite** 6.3.1 - Build tool
- **Tailwind CSS** 4.1.18 - Styling
- **Native WebSocket** (browser API) - Real-time communication

### Backend
- **Node.js** - JavaScript runtime
- **Express** 5.2.1 - Web framework
- **ws** 8 - WebSocket server for real-time communication

## Features
- Real-time multiplayer gameplay
- Multiplayer room management
- WebSockets for live player communication
- React for UI components like meeting screens

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn

### Installation
1. Clone the repository:
```bash
git clone https://github.com/i250882-os/among-us.git
cd among-us
```

2. Install frontend dependencies:
```bash
cd frontend
npm install
cd ..
```

3. Install backend dependencies:
```bash
cd backend
npm install
cd ..
```

## Development
### Frontend Development

```bash
cd frontend
npm run dev
```

This starts the Vite development server with hot module replacement.

### Backend Development

```bash
cd backend
npm run dev
```

This starts the Express + WebSocket server

### Production Build

#### Frontend:
```bash
cd frontend
npm run build
```

#### Backend:
```bash
cd backend
npm start
```
## Configuration

The backend serves **both** the REST API and the WebSocket endpoint (`/ws`) on a **single port** (default `3000`).

### Local development (recommended)

Leave `VITE_BACKEND_URL` / `VITE_SOCKET_URL` **unset**. The browser talks to the Vite origin (`http://localhost:8080`), and Vite proxies the API and `/ws` to the backend — no CORS setup needed.

`frontend/.env`:
```
VITE_PROXY_TARGET=http://localhost:3000
```

`backend/.env`:
```
PORT=3000
ALLOWED_ORIGIN=http://localhost:8080
```

### Production / direct backend

Set absolute URLs at **frontend build time** (API and sockets share one origin):
```
VITE_BACKEND_URL=https://your-backend.example.com
# optional override if the WebSocket is on a different host (http(s):// or ws(s)://; "/ws" is added when no path is given):
# VITE_SOCKET_URL=https://your-backend.example.com
```

Backend allowed origins (full URLs, comma-separated):
```
ALLOWED_ORIGIN=https://your-frontend.example.com,http://localhost:8080
```

### TODO
- [ ] Improve lobby area UX
- [ ] Add tasks system
- [ ] Fix voting system bugs

## License
This project is licensed under the MIT License - see the LICENSE file for details.
