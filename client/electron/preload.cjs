// Preload (sandboxed, CommonJS): the renderer's only door to the network, as window.net.
// Named .cjs because the root package is ESM ("type": "module") and sandboxed preloads must be CommonJS.
//
//   window.net.send(type, data)          fire-and-forget game message
//   window.net.request(path)             former REST GET -> Promise<{status, body}>
//   window.net.getStatus()               Promise<{state, message, sessionId, proto, host, port}>
//   window.net.onMessage(cb)             cb({t, d});  returns an unsubscribe function
//   window.net.onStatus(cb)              cb(status)
//   window.net.onStats(cb)               cb({proto, sessionId, rttMs, jitterMs, bytesIn, bytesOut, retransmits, lost})
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('net', {
    send: (type, data) => ipcRenderer.send('net:send', { t: type, d: data }),
    request: (path) => ipcRenderer.invoke('net:request', path),
    getStatus: () => ipcRenderer.invoke('net:getStatus'),
    onMessage: (cb) => subscribe('net:message', cb),
    onStatus: (cb) => subscribe('net:status', cb),
    onStats: (cb) => subscribe('net:stats', cb),
});
