# Vercel Function WebSocket assessment

Assessed November 5, 2026. Decision: transport is feasible; the current board-room
implementation is not ready for multiple function instances. No hosting resources,
dependencies, application code, or database configuration changed in this assessment.
Render creation remains paused.

## Platform findings

[Vercel WebSockets](https://vercel.com/docs/functions/websockets) support `ws` and
require Fluid compute. A connection stays on one instance, but other connections
and reconnects can reach different instances. Deployments can overlap. External
coordination is required for shared rooms; module-level maps are insufficient.

[Function limits](https://vercel.com/docs/functions/limitations) currently cap
Hobby duration at 300 seconds. Clients must recover from connection termination.
WebSocket connections consume Function and transfer usage; free hosting is not
an unlimited connection allowance. The linked project's plan, Fluid setting, and
actual upgrade behavior have not been verified in this assessment.

[Next.js integration](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#upgradewebsocket)
uses `upgradeWebSocket` from `@vercel/functions` >=3.10.0 and `ws`. Local testing
requires Vercel CLI >=54.14.2 with `vercel dev`, rather than `next dev`.
Our CLI is 65.10.0 and `ws` is installed; `@vercel/functions` is not installed.
Adding the helper would be a new dependency, outside the earlier existing-library
preference. A native Node HTTP-server function is another documented entry point,
but combining it with this Next.js project's build/routing still needs a proof.

## Code findings

| Area | Current implementation | Consequence on Vercel |
| --- | --- | --- |
| Room ownership | `scripts/board-sync.ts` creates a process-local `rooms` map and a local promise queue per board. | Two instances can independently load and mutate the same board. |
| Saving | `supabaseBackend.save` conditionally advances the document revision. | Prevents a stale overwrite, but a competing writer currently fails its room rather than reloading/retrying. |
| Delivery | `broadcast` iterates only that room's local peers. | A successful save does not notify peers connected to another instance. |
| Presence | Peer sets and cursor values live in the room. | Online counts and cursors are incomplete across instances. |
| Undo | Each session's `Y.UndoManager` lives in process memory. | Reconnecting to another instance loses undo history, even without a deployment. |
| Recovery | `use-shared-board.ts` retains pending commands, retries transport failures, and processes persisted receipts. | Useful foundation, but a server error calls `fatal` and stops retries. A write conflict therefore needs deliberate recovery changes. |
| Durable document | Binary Yjs state, projection, revision, and request receipts are saved together. | Keep this format. Do not replace binary persistence with JSON-only storage. |
| Server lifecycle | `startSyncServer` owns an HTTP listener and process shutdown. | Extract socket/session handlers from listener ownership for a function adapter. |

## Isolated two-instance experiment

Executed the existing server twice on random loopback ports, using a shared fake
backend with the same revision check as the production adapter. No actual user,
database, or board was accessed. Both users joined revision 0 before either edit.

1. Instance A saved a note: stored revision became 1.
2. Instance B received **zero** remote state messages.
3. Instance B attempted its own edit with stale revision 0. Its room emitted
   `Shared saving stopped. Export a copy and reload.`
4. Storage retained A's single note at revision 1; B's edit was not persisted.

This is a local reproduction of the current multi-instance limitation, not a
Vercel-hosted test. The temporary runner was outside the repository at
`/private/tmp/cocanvas-vercel-room-assessment.mjs`.

## Paths forward

**Keep the current service design:** a single hosted process preserves the current
room/undo behavior with the smallest change. This is why the Render configuration
specifies one instance. Server restarts still reset undo history.

**Use Vercel Functions:** move coordination outside process memory. With the
existing PostgreSQL infrastructure, investigate a durable command log and atomic
per-board revision/receipt commits. Each instance needs a reliable catch-up path
to apply missing updates and distribute committed changes to its own sockets.
Notifications alone cannot substitute for reading missed committed updates.
Presence needs expiring shared records. Define undo continuity explicitly; a
serialized Yjs document alone does not restore a `Y.UndoManager`'s stack.

This is a proposed design, not a validated implementation. It requires migration,
authorization, concurrency, failure, and load testing. Avoid holding a database
transaction open for the lifetime of a WebSocket. Avoid assuming a single region,
low traffic, sticky connections, or a concurrency limit guarantees room ownership.

## Recommended next experiment

Use an isolated branch/prototype to prove a protected Vercel WebSocket endpoint,
then prove **two independent instances** exchange committed board updates before
moving the production protocol. Preserve React/Next.js, Effect domain operations,
existing access checks, and binary Yjs persistence.

Acceptance gates:

- Confirm project plan/Fluid settings, upgrade routing, origin validation, join
  authentication, payload limits, and unauthenticated connection limits.
- Two instances editing one board converge without fatal revision errors;
  duplicate commands and lost acknowledgements do not apply edits twice.
- A timeout, reconnect to another instance, and overlapping deployment recover
  persisted state and pending edits correctly.
- View-only users cannot write; revoked users receive no further private content.
- Presence expires after instance failure; cross-user undo preserves others' edits
  under the agreed history policy.
- Measure connection churn, database operations, latency, and hosting usage before
  selecting this for the capstone deployment.

Recommendation: do not lift-and-shift the current room server into a Function.
Vercel remains a viable candidate, but external coordination is a prerequisite.
ChatGPT hosted-app authorization is a separate decision and is not changed here.

## Implementation update — November 5, 2026

The distributed path is implemented:

- `distributed-board.ts` treats PostgreSQL as the authority. Every mutation loads
  current state, validates access, constructs a candidate Yjs document, and saves
  binary state, JSON projection, revision and receipt together with CAS. A stale
  revision retries up to eight times instead of failing a shared in-memory room.
- `distributed-socket.ts` serializes a connection's work, bounds its queue and
  payload, and checks for committed updates once per second without overlapping
  polls. Authorization is checked before delivering board content. Presence uses
  an independent shared table, not the document revision.
- `/api/boards/sync` authenticates same-origin upgrades before allocating sockets.
  It uses the approved, pinned `@vercel/functions` 3.11.0 helper. Hosted clients
  default to this same-origin route. Explicit socket URL overrides remain supported.
- `scripts/distributed-sync.ts` serves the same handlers locally; the executable
  `board-sync.ts` now selects this adapter. Restart an existing local sync process
  after updating. The old exported factory remains for its original protocol tests.
- Presence has a server-written timestamp, 45-second visibility expiry, ownership
  policies, and a user/expiry index. Its RPCs are invoker functions with empty
  search paths. Viewer presence is permitted; document writes still require edit
  access. Clean shutdown removes presence; a returning user's expired records are
  removed opportunistically. Abruptly abandoned records can remain physically
  stored after becoming invisible, so ongoing production use needs retention
  maintenance in addition to this visibility TTL.

Undo is scoped to the current connection. Remote updates do not enter its tracked
origin, so undo preserves another user's changes. Reconnecting starts a new undo
history, including a reconnect to the same instance. The existing recovery notice
explains that reset and drops unsafely replayable pending undo/redo. Saved request
receipts settle acknowledged or ambiguous edits across instances. Pending edits
survive transport retries while the page remains open; a full page close does not
promise offline command recovery.

Connections renew after four minutes, before the configured 300-second function
limit. The distributed polling path intentionally favors correctness and existing
infrastructure over maximum throughput. It can add about one second of remote
update latency and currently performs authenticated board/document reads plus a
presence read per connected user per second; cursor writes are capped at four per
second. This is suitable for evaluation, not a measured large-scale capacity claim.
Before expanding beyond the demonstration, measure database/API usage and reduce
polling costs or introduce reliable shared notifications with durable catch-up.

Verification:

- TypeScript and the production build passed. After the final socket lifecycle
  changes, all 19 distributed board/socket/route regressions passed again.
- 204 unit/protocol tests passed, including six concurrent writers, duplicate
  receipts, ambiguous saves, remote and concurrent undo, legacy binary seeding,
  origin/authentication boundaries, two independent socket servers, cross-server
  presence, reconnect, and revoked/view-only access.
- Both presence migrations were applied to the linked Supabase project. RPCs were
  confirmed to be invoker functions. Security advisors reported no new issue;
  the pre-existing leaked-password-protection warning remains. The two SELECT
  presence policies remain separate; their performance advisory is not an access
  vulnerability. Newly created indexes can show as unused until actual traffic.
- The protected Vercel candidate built to READY at
  https://cocanvas-f9eykoz63-melanies-projects-6a846645.vercel.app . The linked
  project uses Node 24 and has Fluid compute enabled. An anonymous request to the
  new route returned 401. No public domain promotion occurred.
- The hosted two-account test has **not run**: creation and cleanup of disposable
  accounts awaits the owner's response. No real hosted upgrade, actual function
  timeout recovery, browser interaction, or production load result is claimed.
- A transactional permission-test request expired before execution. That test is
  not recorded as passed; the local protocol tests use fake storage/access.

### Run the hosted integration test

Use two authorized disposable accounts in a private JSON fixture with `alice` and
`bob`, each containing `id`, `email`, and `password`. Keep it outside the repository.
For a protected candidate, supply a private Netscape cookie jar obtained through
Vercel's authorized protection bypass. Never commit or print either file.

```sh
COCANVAS_TEST_FIXTURES=/private/tmp/cocanvas-test-accounts.json \
COCANVAS_VERCEL_TEST_URL=https://your-candidate.vercel.app \
COCANVAS_VERCEL_COOKIE_JAR=/private/tmp/cocanvas-protection.cookies \
npm run test:vercel
```

The test signs in through CoCanvas, creates only a temporary board, shares it with
its second account, checks denied private access, exercises the real hosted socket,
checks edits/presence/reconnect/restoration, and deletes its board in `finally`.
Account creation/deletion is intentionally outside the runner and needs explicit
cleanup authorization. Without fixture and URL settings, it reports **skipped**.

Render remains unprovisioned. Hosted ChatGPT subscription AI remains a separate
OpenAI approval/storage task; this change does not lift its production guard.
