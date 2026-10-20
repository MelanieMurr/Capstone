import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { Effect } from 'effect';
import { createServer } from 'node:http';

// Loopback-only, ephemeral evaluation server. This is a raw Yjs-update protocol,
// not the y-websocket wire protocol. No deployment or authentication is implied.
const port = Number(process.env.PROTOTYPE_WS_PORT || 1234);
const rooms = new Map();
const http = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('CoCanvas prototype sync'); });
const server = new WebSocketServer({ server: http, maxPayload: 256 * 1024 });
const run = (work, failure) => Effect.runSync(Effect.match(Effect.try({ try: work, catch: () => new Error('Invalid sync update') }), { onSuccess: () => {}, onFailure: failure }));
server.on('connection', (socket, request) => {
  const origin = request.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return socket.close(1008, 'Local origins only');
  const name = new URL(request.url, 'http://localhost').pathname.slice(1);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return socket.close(1008, 'Invalid room');
  if (!rooms.has(name)) {
    if (rooms.size >= 50) return socket.close(1013, 'Room limit');
    const doc = new Y.Doc();
    const peers = new Set();
    doc.on('update', (update) => {
      for (const peer of peers) if (peer.readyState === WebSocket.OPEN) peer.send(update);
    });
    rooms.set(name, { doc, peers });
  }
  const room = rooms.get(name);
  room.peers.add(socket);
  socket.send(Y.encodeStateAsUpdate(room.doc));
  socket.on('message', (data, binary) => {
    if (!binary) return socket.close(1003, 'Binary Yjs updates only');
    run(() => Y.applyUpdate(room.doc, new Uint8Array(data)), () => socket.close(1007, 'Invalid update'));
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    room.peers.delete(socket);
    if (!room.peers.size) {
      // Retain rooms for brief reconnects, then release memory.
      setTimeout(() => {
        if (!room.peers.size && rooms.get(name) === room) { rooms.delete(name); room.doc.destroy(); }
      }, 60_000).unref();
    }
  });
});
http.listen(port, '127.0.0.1', () => console.log(`Prototype sync listening on ws://127.0.0.1:${port}`));
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  for (const socket of server.clients) socket.terminate();
  server.close(); http.close();
  for (const room of rooms.values()) room.doc.destroy();
  process.exit(0);
});
