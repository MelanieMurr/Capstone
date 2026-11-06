import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { attachDistributedSocket } from "../src/lib/collaboration/distributed-socket.ts";
import type { DistributedStore } from "../src/lib/collaboration/distributed-board.ts";
import type { PresenceStore } from "../src/lib/collaboration/distributed-store.ts";

/** Local/container adapter for the same handlers used by the Vercel route. */
export function startDistributedSyncServer(store: DistributedStore & PresenceStore, port = 1235, origins = ["http://127.0.0.1:3000", "http://localhost:3000"], host = "127.0.0.1", pollMs = 1000) {
  const http = createServer((_request, response) => { response.writeHead(200); response.end("CoCanvas board sync"); });
  const wss = new WebSocketServer({ server: http, maxPayload: 256 * 1024 });
  const connections = new Set<Promise<void>>();
  wss.on("connection", (socket, request) => {
    if (!request.headers.origin || !origins.includes(request.headers.origin)) { socket.close(1008, "Origin rejected"); return; }
    const drained = attachDistributedSocket(socket, store, pollMs);
    connections.add(drained);
    void drained.finally(() => connections.delete(drained));
  });
  http.listen(port, host);
  return { http, wss, close: () => new Promise<void>((resolve) => {
    for (const client of wss.clients) client.terminate();
    wss.close(() => { void Promise.all([...connections]).then(() => http.close(() => resolve())); });
  }) };
}
