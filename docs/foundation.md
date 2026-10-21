# Application foundation

The five This Week tickets cover Next.js/TypeScript setup, authentication,
PostgreSQL schema, the dashboard, and automated tests. No packages were added.
React renders the UI; Effect handles validation, authentication, network requests,
and persistence. The existing public canvas and prototype routes remain usable.

## Run in WebStorm

1. Open the repository root (the folder containing `package.json`).
2. Run `npm ci` if dependencies are absent. Use a supported Node LTS release.
3. Copy `.env.example` to `.env.local` only if your local file does not exist.
   Fill in `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from Supabase → Project Settings → API.
   This project already has those two values configured locally. Never put a
   service-role key in a `NEXT_PUBLIC_` variable.
4. Run `npm run dev`. Visit `/signup` to create an account and open your dashboard immediately.
   Existing users can visit `/login`.
   The dashboard is `/dashboard`; opening a board goes to `/boards/<uuid>`.
   `/` is still the public browser-local demo. Cloud boards save to Supabase.
5. For the existing sync lab, run `npm run prototype:sync` in another terminal.
   `NEXT_PUBLIC_PROTOTYPE_WEBSOCKET_URL` points to that local raw-update server.
   `NEXT_PUBLIC_WEBSOCKET_URL` is reserved for a future y-websocket service.
6. For the AI lab, use the installed Codex CLI and `codex login`. Optional
   `CODEX_CLI_PATH` identifies the executable. `OPENAI_API_KEY` and `OPENAI_MODEL`
   are ignored by the local Codex prototype. `DATABASE_URL` is optional and is
   not used by the application: Supabase's authenticated Data API handles SQL.

Authentication is intentionally limited to email/password signup, sign-in and
sign-out. In Supabase → Authentication → Sign In / Providers, turn **Confirm email**
off and save. Keep the Email provider and new-user signup enabled. This setting
must be changed in Supabase itself; removing frontend messages does not disable
server-side confirmation. The app fails visibly if signup returns no session.

There are no verification callbacks, reset-password pages or password-reset API
operations. Existing confirmed users retain their passwords. New users are not
asked to follow email links. Keep your password: self-service email recovery is
not implemented in this simplified prototype.

## Source map

| Location | Responsibility |
| --- | --- |
| `src/app/login`, `signup` | Account signup and sign-in forms |
| `src/proxy.ts` | Refresh session cookies and protect dashboard/board routes |
| `src/app/dashboard`, `src/components/foundation/dashboard.tsx` | Board listing, search, creation, rename, delete confirmation |
| `src/app/boards/[id]`, `src/components/foundation/saved-board.tsx` | Authorized canvas loading and serialized autosave |
| `src/app/api/auth`, `src/app/api/boards` | Server HTTP endpoints with Effect error handling |
| `src/lib/foundation` | Input contracts, domain operations and HTTP boundaries |
| `src/lib/supabase` | Validated environment configuration and cookie-aware client |
| `supabase/migrations` | Versioned database schema and access policies |
| `tests/helpers`, `tests/e2e/foundation.spec.ts` | Isolated sessions and browser workflows |

The Next.js 16.4 convention is `proxy.ts`; `cookies()` and route `params` are
asynchronous. Server pages validate users again, and domain operations do not
trust Proxy alone. Requests use the caller's publishable-key client and session,
so database RLS applies even if someone calls the Data API directly. Mutations
check request origin. Owner IDs cannot be changed by authenticated users.

## Database and approved object model

| Entity | Relationships and constraints |
| --- | --- |
| `auth.users` | Supabase owns account identities and passwords |
| `profiles` | Optional one-to-one user display name; self-access only |
| `boards` | UUID identity, owner → user, trimmed title 1–120 characters, timestamps |
| `board_collaborators` | One membership per board/user; `viewer` or `editor` |
| `board_invitations` | Board, creator, normalized email, permission, expiry, state and unique SHA-256 token hash |
| `board_documents` | One row per board, JSON snapshot, optional binary Yjs state, schema version, revision |

All five public tables enable RLS. Owners control board metadata, membership and
invitations. Members can read the board; editors can update its document; viewers
cannot. Foreign keys cascade when an account/board is deleted, and FK lookup paths
are indexed. Private security-definer boolean helpers check the verified
`auth.uid()` with an empty search path and avoid circular policies. The board
SELECT policy also compares owner_id directly so INSERT RETURNING sees a new row.

`create_board(text)` is an invoker RPC that atomically inserts a board and an empty
valid document. The API validates full snapshots with the existing Zod board
schema: object identities, types, geometry and connector references remain as
specified in `docs/board-object-model.md`. SQL checks snapshot identity/version,
array shape and a 10 MiB limit. Revision updates must advance by exactly one.
The client sends its current revision; concurrent stale writes return 409 instead
of overwriting another save. An autosave failure remains visible and asks the
user to export a copy before reloading.

Yjs remains the planned multi-user document format: one Y.Doc per board, an objects
map keyed by object UUID, and nested maps for per-field merges. `yjs_state bytea`
will hold `Y.encodeStateAsUpdate(doc)`; `snapshot jsonb` is the validated inspection,
export and recovery view. The current authenticated canvas persists JSON snapshots
with revision checks. It does not write Yjs bytes or connect private boards to the
unauthenticated prototype WebSocket. An authenticated collaboration server must
later authorize room access, load Yjs state, merge updates and serialize durable
writes. Invitations have schema/access rules; sending/accepting invitation UI is
future work. Do not treat the prototype sync server as production sharing.

The migrations were applied to CoCanvas (`ybgcdvkzwkgwrhgzcwvn`) and their local
versions match remote migration history. On a different project, use the installed
Supabase CLI, link that project, review `supabase db push --dry-run`, then apply
with `supabase db push`. Do not rerun CREATE TABLE statements manually on this
already-migrated project. Future changes belong in a new migration.

## Tests and fixtures

```sh
npm run typecheck
npm test
npm run test:e2e:install  # only if local Chromium is absent
npm run test:e2e
npm run build
```

Vitest runs the Node unit/integration suites under `src`. Playwright starts the
Next development server plus the sync server, or reuses already-running servers
outside CI. Stop the development server before running a production build, then
restart it afterward; avoid sharing its generated route manifests with a build.

The default browser run tests the demo, navigation, manipulation, independent sync
sessions, AI validation, unauthorized routes and signup UI validation and immediate dashboard navigation. Signup success is mocked in the default UI test to avoid creating accounts. One live
Supabase test is explicitly skipped unless a fixture file is supplied.

For the live test, create two dedicated, confirmed test accounts in the Supabase
Authentication dashboard. Use disposable accounts, not personal accounts. Copy
`tests/fixtures/accounts.example.json` to a private file outside the repository and
replace both IDs, emails and passwords with those accounts' actual values. Then:

```sh
COCANVAS_TEST_FIXTURES=/absolute/path/private-accounts.json npm run test:e2e
```

Separate browser contexts sign in normally with Supabase. The test checks failed
login, creation, rename, opening, persisted canvas reload, denied access from the
other user, stale-write rejection, cancel/confirm deletion, signout, session
isolation and database error UI. Created boards are deleted in test cleanup;
remove the disposable users in Supabase when finished. Never commit real fixture
credentials. The implementation was verified with two temporary confirmed users;
those temporary accounts were removed after verification.

Schema verification also exercised PostgreSQL as an authenticated nonmember,
viewer and editor inside a rolled-back transaction: nonmembers could not read,
viewers could read but not write, and editors could update documents but not delete
boards. It checks RLS on all five public tables and runs Supabase's
security advisor. The remaining project-level advisor warning is that leaked
password protection is disabled; see [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## October 21 simplification

The initial real signup hit Supabase's email rate limit. After the project owner
turned Confirm email off, the public Auth settings reported
`mailer_autoconfirm: true`. A fresh Gmail alias of the supplied junk inbox then
passed the complete live browser test: immediate signup, protected dashboard,
reload, signout, unauthorized access rejection, wrong-password rejection and
correct-password sign-in in a separate empty browser context. Removed email-reset
endpoints and the old callback returned 404. The disposable account was signed out
and removed; the original junk-email account was left unchanged.

The repeatable opt-in test is `tests/e2e/signup.spec.ts`. Run it with a fresh
address (signup creates a real user):

```sh
COCANVAS_LIVE_SIGNUP_EMAIL=your-fresh-test-address@example.com npm run test:e2e -- tests/e2e/signup.spec.ts
```

Delete that dedicated test user in Supabase after verification. Without the
variable, the live-signup test is skipped. No test password is logged or committed.
