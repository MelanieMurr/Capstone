# Shared board collaboration

The production `/boards/[id]` canvas now synchronizes object creation, property
edits, movement, resizing, connectors, and deletion through authenticated Yjs
board rooms. Public `/` remains a browser-local demo. No new packages or database
schema changes were needed.

## Run locally

Use the existing Supabase URL and publishable key in `.env.local`, plus:

```dotenv
NEXT_PUBLIC_BOARD_SYNC_URL=ws://127.0.0.1:1235
```

Use the installed Node 25.2.1 (native TypeScript execution) and two terminals:

```sh
npm run dev -- --hostname 127.0.0.1
npm run board:sync
```

The main socket server uses port 1235. The earlier unauthenticated lab at
`/prototypes/sync` continues to use `npm run prototype:sync` on port 1234.
Restart Next after changing a public environment variable. Exact permitted local
origins are `http://127.0.0.1:3000` and `http://localhost:3000`.

Sign in and open a board from the dashboard. Editing waits for the room's initial
state and verified permission. On a failed connection or save, editing pauses,
the status explains the failure, and Export remains available. Export unsaved
changes before reloading. Automatic reconnection is a separate backlog ticket.

## Architecture

- `src/lib/collaboration/shared-board.ts` adapts the existing validated
  `BoardDocument` to a Y.Map of nested object maps. Effect programs derive and
  validate create/patch/delete commands and their resulting documents.
- `src/app/api/boards/[id]/sync-session/route.ts` uses the existing signed-in
  cookie session and board service to authorize a no-store token response.
- `scripts/board-sync.ts` verifies the token with Supabase Auth, checks ownership
  or collaborator permission under RLS, and assigns the connection to that board.
  A room is never authorization by itself. No service-role key is used.
- The first authorized join seeds the server's Y.Doc from the stored snapshot.
  Later joins receive that same shared document. The server serializes room
  commands, changes only affected fields, saves the next snapshot with the
  existing revision condition, then broadcasts an incremental Yjs update.
- `use-shared-board.ts` maintains an accepted browser Y.Doc plus queued optimistic
  edits. It acknowledges one request at a time and reapplies remaining local
  edits over incoming accepted state, so remote messages do not discard typing.
- `SavedBoard` replaces the former per-browser snapshot autosave. Shared boards
  have one room writer, preventing independent full-snapshot saves from racing.
- `Workspace` submits local operations through the adapter and renders incoming
  documents with `setBoard`, avoiding publication echoes. Pointer gestures
  preview locally and commit their changed geometry once at release.
- Selective Yjs undo tracks each connection's origin, rather than restoring old
  whole-board React snapshots containing other users' work. A capture boundary
  makes a completed drag/resize its own undo step. Undo history is per connection.

The wire protocol is explicit JSON commands and base64-encoded Yjs updates. It is
not the stock `y-websocket` provider protocol. Credentials travel in the initial
join message, not in URL query strings. Do not log or share join frames.

## Presence and cursors

Each authorized connection gets a server-assigned presence ID, a stable color
based on its verified user ID, and a bounded display name. Display metadata is
used only for labels, never permission decisions. Multiple tabs are distinct
active connections, including tabs belonging to the same account.

Presence stays in room memory; it is not stored as board objects and never
increments a document revision. The header lists other connected sessions. The
canvas overlays their labeled cursors with pointer events disabled.

The sender converts canvas-local screen pixels to board units:

```text
boardX = (screenX - panX) / zoom
boardY = (screenY - panY) / zoom
```

Each receiver uses its own viewport:

```text
screenX = panX + boardX * zoom
screenY = panY + boardY * zoom
```

Thus collaborators can pan/zoom independently. Cursor labels remain a readable
screen size. The client coalesces cursor movement to at most ten packets per
second; the server additionally limits accepted movements. Leaving the canvas
or blurring the window hides the cursor. Closing the socket removes the presence
entry; ping/pong heartbeat detection also removes half-open connections.

Board edits and board-data broadcasts always recheck authorization. Ephemeral
presence traffic caches permission checks for at most five seconds to avoid an
Auth/Data API call on every pointer event. Revoked presence membership may take
that long to disappear during cursor-only activity. Edit permission and RLS
checks still apply to every accepted board mutation.

## Concurrent-edit rules

These rules apply to this server-authoritative, online implementation:

| Scenario | Result |
| --- | --- |
| Simultaneous creation of different UUIDs | Both objects remain |
| Edits to different objects | Both edits remain |
| Different fields on the same object | Changed fields are merged independently |
| Move/resize while another user edits text | Geometry and text both remain |
| Same field changed by both sessions | The last command accepted in the room queue wins; sessions converge |
| Late patch after deletion | Ignored; a stale edit cannot recreate the deleted object |
| Object deletion with attached connectors | Dangling connectors are removed |
| Undo one user's move after another edits text | The unrelated text remains |
| Independent full-snapshot writer changes the DB revision | Room saving stops with feedback instead of overwriting the outside writer |

Text is an ordinary field, so same-field text replacements are not character-level
collaborative editing. There is no offline edit merge. These are documented
choices rather than claims that Yjs alone resolves every domain-level conflict.

## Verification

Run fast checks:

```sh
npm run typecheck
npm test -- --maxWorkers=1
```

`shared-board.test.ts` covers field changes, validation, nested maps, incremental
updates, connector cleanup, late patches, and selective undo.
`board-sync.test.ts` opens real localhost WebSockets against a deterministic test
backend to cover two-way synchronization, room isolation, rejected access,
viewer protection, simultaneous writes, conflicts, presence, and absence of
presence writes to persistent snapshots. `presence.test.ts` checks coordinate
conversion and malformed input.

Real Supabase browser tests use two dedicated accounts through the existing
private fixture mechanism described in `foundation.md`:

```sh
COCANVAS_TEST_FIXTURES=/absolute/private/accounts.json npm run test:e2e -- --workers=1
```

The Playwright configuration starts/reuses the Next app, old prototype server,
and authenticated room server. `collaboration.spec.ts` creates fresh test boards,
grants account B editor access using account A's normal RLS-protected Data API,
and deletes the test boards (including their memberships) afterward. Credentials
are outside the repository, and no admin key or RLS bypass is used.

Verified on October 26, 2026, with two real Supabase accounts and separate Chromium
browser contexts:

- Creation, content edits, pointer movement/resizing, standalone text, labeled
  shapes, connector creation and cascade deletion appear without refresh.
- Changes flow from A to B and B to A; separate board rooms remain isolated.
  A non-member cannot fetch that board or obtain a sync session for it.
- Reloading both sessions retains accepted contents and geometry.
- Presence updates on join, navigation away, and rejoin; cursors hide on leaving
  the canvas and align after the receiver independently pans and zooms.
- Simultaneous edits to different objects retain both values.
- Different-field edits to the same object preserve both values.
- Text arriving during another session's active pointer drag survives release.
- Conflicting replacements of the same text field converge to an accepted value.

All three collaboration browser scenarios passed. The full browser suite passed
25 tests, with its separate opt-in live-signup test skipped. Real authentication
and cloud restoration ran with the two dedicated accounts. All 84 unit/protocol
tests and TypeScript checking passed. The production `npm run build` (Turbopack)
passed as well. Next.js reported its existing security advisory during validation;
package versions were not changed for these tickets.

## Remaining scope

One loopback server owns the in-memory rooms. JSON snapshots persist current
contents, while CRDT history, room state and undo stacks are not durable. Rooms
remain in memory until shutdown. Multi-instance room coordination, idle eviction,
automatic reconnection/token refresh, presence across server processes,
character-level Y.Text editing, and an invitation UI remain separate milestones.
Incoming command payloads are capped at 256 KiB; large imported batches need
chunking. Authorization rechecks favor clarity over high-volume optimization.

For deployment, host the socket process on a platform supporting long-lived
WebSockets, configure an exact allowed app origin, and use HTTPS/WSS. A localhost
URL or a standard serverless Next route is not a deployed WebSocket host.
