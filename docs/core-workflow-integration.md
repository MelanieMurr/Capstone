# Integrate Core Workflows

Scope: Trello ticket **Integrate Core Workflows**. This is local MVP integration;
public deployment, dependency remediation, and the final proposal-wide acceptance
review remain separate tickets.

## Connected path

1. Email/password sign-in establishes the existing Supabase cookie session.
2. Dashboard loads authorized boards and supports create, rename, open, and delete.
3. Opening a board shows a loading status while the server checks access and
   restores its binary Yjs document. The canvas waits for the authorized room.
4. Owners grant registered collaborators viewer/editor access through Share.
5. Canvas edits enter the existing authenticated WebSocket room, save through its
   single writer, and synchronize to other sessions. Binary Yjs state remains
   authoritative; the JSON projection and revision are saved atomically.
6. On a saved board, Assistant submits selected text and operation to
   `POST /api/boards/[id]/ai`. The route independently verifies the signed-in user,
   board visibility, editor access, and selected content against the saved board.
   Foreign, deleted, or changed note content returns 409 before inference.
7. Authorized requests use the same bounded local Codex handler as the prototype
   lab: local development only, same-origin checks, validated payloads, request and
   concurrency limits, ChatGPT CLI login, and no API-key fallback.
8. The browser validates the response again, displays a temporary preview, and
   changes nothing until confirmation. Confirmed objects enter the same shared
   edit, undo, save, and restore path as manually created objects.
9. Sign-out removes the local session; protected API calls reject the next request.

The public local demo and evaluation lab retain their separate prototype endpoint.
Saved boards no longer use that unscoped endpoint. No database schema or library
changes were required. Route handlers reuse the existing cookie-aware Supabase
client and `getBoard` RLS-protected service rather than introducing an admin key.

## Feedback and recovery

- Dashboard retains its loading, request error, and retry UI.
- A board route now has a loading status in addition to its error/not-found pages.
- Collaboration status distinguishes connecting, saving, saved, view-only, and
  reconnecting states. Existing export protection retains failed drafts.
- Assistant shows loading, denies invalid data, clears unsuccessful previews,
  and requires source freshness at confirmation.
- If a note has not finished saving, the board AI route explains the 409 and asks
  the user to wait for saved status and retry. It does not silently analyze forged
  or outdated content.

## Reproducible verification

Use dedicated accounts stored outside the repository, as described in
`docs/foundation.md`.

```sh
npm run typecheck
npm test -- --maxWorkers=1
COCANVAS_TEST_FIXTURES=/path/to/private-accounts.json npm run test:e2e -- --workers=1
```

The new `tests/e2e/core-workflow.spec.ts` connects normal sign-in, dashboard
create/rename, Share, a second user's board discovery, canvas edits, AI selection,
preview/confirm, second-session synchronization, saved restoration, viewer
restrictions, dashboard delete, and sign-out. It also checks guest/nonmember AI
access and rejects forged note text through the real endpoint. All temporary
boards are cleaned up.

The default successful AI response is mocked for repeatability. To exercise the
actual server-to-CLI step in that same workflow, run locally with Codex logged in:

```sh
COCANVAS_LIVE_AI=1 COCANVAS_TEST_FIXTURES=/path/to/private-accounts.json npm run test:e2e -- tests/e2e/core-workflow.spec.ts --workers=1
```

This opt-in consumes the existing Codex plan's usage. Tests do not log credentials,
introduce API keys, or create personal accounts.

## Integration defects and remaining boundaries

| Finding | Resolution / scope |
| --- | --- |
| Saved boards called the prototype AI route without board authorization | Fixed by the board-scoped route and independent server checks. |
| Submitted IDs/text were not compared with the saved board at the AI HTTP boundary | Fixed: invalid/stale/foreign sources reject before provider execution. |
| Authorized board navigation lacked a route-level loading fallback | Fixed with an accessible board loading status. |
| Local Codex is disabled in a production deployment | Existing deliberate boundary; tracked by **Deploy App & WebSocket Service**, not declared deployed here. |
| Next.js reports an installed-version security advisory | Existing finding for **Fix Critical Defects**; no dependency upgrade in this ticket. |
| Supabase leaked-password protection is disabled | Existing security-advisor warning; account-wide Auth configuration was not changed. [Remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). |
| Room-restart undo history and offline editing limits | Existing behavior documented in `docs/collaboration.md`; board/receipts persist, in-memory undo resets and disconnected editing pauses. |

Relevant sources reviewed for this integration: the installed Next.js route and
loading conventions and the [Supabase cookie-aware SSR client guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

## Recorded result — October 29, 2026

- TypeScript and whitespace/diff checks passed.
- All **132 unit/protocol tests** passed, including seven new board-AI boundary cases.
- The full browser suite passed **34 tests**; the separate opt-in live-signup
  test was skipped. This includes the new complete core workflow and existing
  authorization, concurrency, reconnection, AI failure, canvas, and persistence checks.
- The new core workflow also passed separately with **COCANVAS_LIVE_AI=1**,
  exercising the real authenticated endpoint and local Codex request through
  confirmation, second-user delivery, saved restoration, delete, and sign-out.
- The production build passed. The app is restarted afterward for local use.
- Supabase security advisors reported only the existing leaked-password setting
  above; no new database policy/function findings were reported. No schema changed.
- An initial test used the wrong dashboard delete-confirmation selector. Corrected
  it to `Confirm delete`, added an individual action timeout so broken controls do
  not exhaust the cleanup budget, reran successfully, and removed its temporary board.

This records local integration completion; it does not claim public deployment or
completion of the later final MVP-requirements ticket.
