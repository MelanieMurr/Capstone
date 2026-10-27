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
state and verified permission. On a failed connection, editing pauses and the status shows automatic retries.
Each retry requests a fresh Supabase token and joins with the same tab session ID.
Export remains available. Fatal permission, validation or storage failures keep
unsent drafts visible for export rather than silently dropping them.

## Architecture

- `src/lib/collaboration/shared-board.ts` adapts the existing validated
  `BoardDocument` to a Y.Map of nested object maps. Effect programs derive and
  validate create/patch/delete commands and their resulting documents.
- `src/app/api/boards/[id]/sync-session/route.ts` uses the existing signed-in
  cookie session and board service to authorize a no-store token response.
- `scripts/board-sync.ts` verifies the token with Supabase Auth, checks ownership
  or collaborator permission under RLS, and assigns the connection to that board.
  A room is never authorization by itself. No service-role key is used.
- The first authorized join restores the server's Y.Doc from `yjs_state bytea`
  with `Y.applyUpdate`. Only legacy rows with NULL binary state are seeded from
  their JSON snapshot. Later joins receive that same shared document. The server
  serializes room commands, changes only affected fields, and saves the full
  `Y.encodeStateAsUpdate` checkpoint and validated snapshot together in one
  revision-checked UPDATE before broadcasting an incremental Yjs update.
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
  makes a completed drag/resize its own undo step. Undo history is per tab session and survives a transport reconnect while the room server remains running.

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

One loopback server owns the in-memory rooms. Binary Yjs checkpoints preserve
shared struct identities, deleted state and the document state vector across
restarts. Durable documents use `gc: false` to retain deleted struct contents.
Presence and per-connection UndoManager stacks are not persisted. Rooms
remain in memory until shutdown. Multi-instance room coordination, idle eviction,
presence across server processes, character-level Y.Text editing, and email
invitation workflows remain separate milestones. Registered-user access grants
and automatic transport recovery are implemented below.
Incoming command payloads are capped at 256 KiB; large imported batches need
chunking. Authorization rechecks favor clarity over high-volume optimization.

For deployment, host the socket process on a platform supporting long-lived
WebSockets, configure an exact allowed app origin, and use HTTPS/WSS. A localhost
URL or a standard serverless Next route is not a deployed WebSocket host.

## Binary persistence verification

`src/lib/collaboration/persistence.ts` validates PostgreSQL's bytea hex transport,
encodes full Yjs checkpoints, binds each document to its board ID/schema version,
and restores binary before looking at JSON. The database stores bytes; the Data
API's `\x...` string is its transport representation. The existing `yjs_state`
column and RLS/grants already support this; no schema migration is needed.

Binary is authoritative. The companion snapshot remains useful for inspection
and export, but stale/absent JSON does not replace valid binary. Invalid,
truncated, wrong-board, unsupported-version or incomplete Yjs checkpoints fail
loading instead of silently reseeding from JSON. Failed saves stop the room
before its edit is acknowledged. Existing snapshot-only rows upgrade on their
next successful save. The snapshot PUT endpoint also updates the existing Y.Doc
and writes both representations atomically, preserving prior struct identities.
Binary checkpoints remain subject to the existing 10 MiB database limit. Saving
binary does not itself add an offline editor, persistent undo stacks, or a
version-history UI. Transport reconnection is implemented separately below.

Run the focused real-database restart check with dedicated account fixtures:

```sh
COCANVAS_TEST_FIXTURES=/absolute/private/accounts.json npm run test:persistence
```

It starts a room server on an OS-assigned port, edits a board containing notes,
text, both shape variants and a connector, reads/decode-checks the actual
Supabase bytea value, shuts the server down, removes only the test board's JSON
snapshot, and starts a fresh server. It asserts identical board content and
Yjs state vectors, then verifies a second account can continue editing. Finally
it deletes the temporary board/membership. No service-role key is used.

The unit/protocol suite additionally covers corrupted checkpoints, size limits,
legacy conversion, repeated restoration, deletion history against an old replica,
atomic document-API writes, server restart, and save/load failures. The live
Supabase restart test passed on October 26, 2026; all 93 unit/protocol checks
and all five focused authenticated browser regressions passed after this change.
The production Turbopack build passed as well.

## Registered-user access grants

The board's Share dialog accepts an existing user's email and a viewer/editor
permission. Only the owner sees the grant form. The Next.js endpoint at
`POST /api/boards/[id]/collaborators` validates the request with Zod inside Effect,
verifies the signed-in user and checks board ownership before calling the RPC.

Migration `20261026225424_grant_registered_board_access.sql` adds a public invoker
RPC wrapping a narrowly scoped private definer. The private helper checks
`auth.uid()` against the board owner before an exact normalized-email lookup in
`auth.users`. It grants or updates only that board's membership. The definer is
needed to access Auth's private user directory; it is not used to bypass an
application permission error. Both functions revoke PUBLIC/anon execution and
use an empty search_path. Direct calls by a non-owner are rejected too. No admin
key, user-directory listing, or email delivery is required.

The owner receives feedback for missing accounts, invalid requests and failures.
Granting again changes an existing member's permission. A recipient can navigate
to or refresh their dashboard, see the shared board under existing RLS policies,
and open it. Editors can change contents; viewers remain read-only. A current
viewer who is upgraded can reopen/reload the board to refresh page permissions.

## Automatic connection recovery

`use-shared-board.ts` uses bounded exponential backoff (0.5s up to 15s), connection
and authorization timeouts, and the browser online event. Edits pause while the
connection is unavailable; this is recovery of already queued edits, not an
offline editor. Every retry obtains a fresh cookie-aware authorization response,
so an expired socket token is not reused. Terminal HTTP 401/403/404 or invalid
messages stop retries and explain the failure without discarding the draft.

A reconnect joins with the tab's stable session ID and pending request UUIDs.
After serializing earlier room operations, the server sends a full authoritative
checkpoint and the IDs already committed for that verified user. The browser
removes those acknowledged requests before projecting its remaining field-level
edits over the fresh document, then sends the remainder in order. Remote changes
to other objects or fields are preserved. Same-field conflicts keep the existing
last-accepted-command rule.

The room writes each edit/undo/redo receipt into a separate `receipts` Y.Map and
persists it in the same binary checkpoint as the change. If a saved creation's
acknowledgement is lost, reconnect or retry does not create it twice or advance
the revision again. Receipt ownership comes from the verified user, never from a
client-supplied user ID. Receipt lookup and mutation run in the same room queue
as object operations. The durable receipt ledger contributes to the existing
10 MiB state limit; compaction/retention is future scaling work.

UndoManager origins are stable for a verified user's tab session, so a network
reconnect retains its selective undo while the process is running. Server restart
restores the binary board and receipts but resets in-memory undo stacks. The UI
explains that reset; uncommitted undo/redo commands are not silently replayed
against an empty history. Accepted undo/redo requests are settled by their receipts.
Transient capture markers are discarded at rejoin and a new capture boundary
separates the recovered edit from earlier history. Presence leaves and rejoins
with the socket; cursor coordinates remain viewer-relative as before.

## Access/recovery verification

The unit/protocol suite covers owner-only service calls, normalized registered
emails, invalid/missing recipients, recovery queue reconciliation, retry bounds,
idempotent requests after binary restart, and selective undo after reconnect.

`tests/e2e/access-recovery.spec.ts` uses separate real Supabase account contexts
and controlled WebSocket interruptions to verify:

- Owner Share form succeeds for a registered recipient and reports unknown email.
- The recipient sees the board in their dashboard and can collaborate.
- Non-owners cannot grant through the UI, Next endpoint, or direct database RPC.
- Regranting viewer access yields a read-only board.
- The disconnected browser receives edits made by the other user, resumes editing,
  and retains a JavaScript marker proving no page refresh occurred.
- An edit interrupted before sending is replayed without losing remote fields.
- A persisted creation whose acknowledgement is dropped appears exactly once;
  reconnect does not increment its saved revision again.

All test boards and memberships are removed afterward. The real Supabase binary
restart test also passed after durable receipts were added. The security advisor
reported no new function/RLS issues; its existing [leaked-password protection
warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
remains unchanged. No account-wide Auth preferences were altered.

The final access/recovery verification run on October 26, 2026 passed all 101
unit/protocol tests and 29 browser tests (the separate opt-in live-signup case
was skipped). The real Supabase binary restart test passed too. No packages
were added. The remote migration version matches the committed migration filename.
The final production Turbopack build and TypeScript checks passed.
