# Fix Critical Defects

Scope: **Fix Critical Defects**, after the core-integration ticket. No deployment
is performed here. The existing libraries and application architecture are kept.

## Prioritized findings and fixes

### P0 — vulnerable application framework / validation dependencies

Reproduction: on the previous lockfile run `npm audit --json` and `npm run dev` or
`npm run build`. The audit reports critical Next.js advisories and a high Zod
collection-validation advisory; Next also interrupts the first command to display
its advisory. The original complete audit had 36 findings: 2 critical, 20 high,
and 14 moderate (including tooling).

Fix: compatible updates within the existing manifest ranges: Next.js 16.4.0 →
16.4.3, React/React DOM 19.3.0 → 19.3.1, Zod 4.6.5 → 4.6.7, and Vitest 4.1.11 →
4.1.12. The framework patch follows the [official Next.js security update](https://nextjs.org/blog/nextjs-security-update-october-14-2026).
Zod advisory: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
No exploit was executed against application or user data.

### P1 — request limits enforced after fully buffering the request

Reproduction: call the previous `readJSON` with a streamed body that has no
Content-Length and is larger than the allowed size. The old implementation calls
`request.text()` before checking its length. Thus the limit does not bound the
memory used while accepting an arbitrarily large body. The AI routes additionally
used character counts rather than UTF-8 byte counts; saved-board AI cloned a body
that the local provider handler would read again.

Fix: the common Effect JSON reader counts incoming bytes before decoding or JSON
parsing, rejects oversized declared lengths immediately, cancels an oversized
stream with HTTP 413, decodes split UTF-8 sequences correctly, and maps invalid
JSON/UTF-8 to HTTP 400. The existing general 10,500,000-byte ceiling and stricter
60,000-byte AI ceiling remain. AI routes share this reader. Saved-board AI passes
its already parsed, authorized payload to the provider handler for schema
validation without cloning/rereading the body. Origin, authentication, board
permission, note freshness, rate/concurrency, and confirmation boundaries remain.

Regression coverage: `src/lib/foundation/http.test.ts` exercises declared and
chunked limits, cancellation, byte-versus-character limits, split UTF-8, and
malformed JSON. Saved-board and prototype route tests assert oversized bodies
return 413 without invoking Codex. These tests exercise small bounded fixtures;
they do not allocate a denial-of-service-sized payload.

### P1 — pinned tooling archive and HTTP dependencies

Reproduction: `npm explain tar` identifies @vercel/container's exact 7.5.11 pin;
`npm explain undici` identifies Vercel's exact 5.29.0 pin. A regular compatible
update cannot replace those exact transitive pins. The old HTTP package also
satisfied the optional OpenAI SDK peer at the root, appearing in the runtime audit.

Fix: narrow overrides for existing dependencies: tar 7.5.22, and Vercel's undici
6.29.1. Vercel remains 62.7.0 and starts successfully. React/Next, Zod, Effect,
Supabase, Yjs, and the CLI provider remain the same technologies. `package.json`
is now visible to Git (only its ignore entry was removed), so the override policy
can be committed together with its lockfile. Existing direct dependency ranges
are unchanged. A dry-run `npm ci --ignore-scripts --no-audit` verifies manifest/lock
consistency without replacing the running environment.

## Access, data integrity, collaboration, and usability review

The existing integration defects were reviewed in
`docs/core-workflow-integration.md`: board-scoped AI authorization and source
binding, review-before-insertion, board-loading feedback, binary persistence,
selective undo, membership enforcement, and reconnect receipts remain connected.
The full unit/protocol and browser suites verify those paths after the fixes,
including private access rejection, concurrent unrelated edits, interrupted
connections, invalid AI output, cancellation, and confirmed-content restoration.

## Remaining issues and impact

- The final runtime-only audit has **0 findings**. The complete audit has **31
  development/deployment-tool findings: 24 high, 7 moderate, 0 critical**. These
  remain in transitive Vercel tooling, including older schema/parser/HTTP packages;
  this does not mean the entire repository is vulnerability-free. Do not feed
  untrusted archives/configuration to deployment tooling. Reassess the tooling
  dependency tree during the separate deployment ticket rather than applying
  npm's proposed forced major downgrade or incompatible global Zod overrides.
- The local Codex provider deliberately rejects production-mode requests. Public
  AI deployment requires a provider/hosting decision in **Deploy App & WebSocket
  Service**; this ticket does not claim that public AI works.
- Supabase's previously recorded leaked-password-protection warning remains; no
  account-wide Auth setting changed. See the integration report for its source.
- Disconnected editing remains paused; in-memory undo history resets on room
  server restart. Durable binary state and accepted-request receipts persist.
  These are documented limits rather than newly introduced data-loss defects.
- No additional critical blocker was identified in the tested local MVP flows.
  This is scoped verification, not a claim that unknown defects cannot exist.

## Repeatable verification

```sh
npm run typecheck
npm test -- --maxWorkers=1
COCANVAS_TEST_FIXTURES=/path/to/private-accounts.json npm run test:e2e -- --workers=1
npm audit --omit=dev
npm audit
npm ci --dry-run --ignore-scripts --no-audit
npm run build
```

Run the build with the dev server stopped, then restart local development. The
full audit intentionally returns nonzero for the documented remaining tooling
findings. Never commit the dedicated test account fixture or environment secrets.

## Recorded result — October 29, 2026

- TypeScript and diff checks passed.
- All **141 unit/protocol tests** passed, including the new bounded-reader and
  oversized AI-request regressions.
- The full browser suite passed **34 tests**; the independent opt-in live-signup
  test was skipped. No regression in tested access, shared editing, recovery,
  canvas, confirmation, or restoration paths was found.
- The complete core workflow separately passed with **COCANVAS_LIVE_AI=1**:
  real cookie authentication, a real local Codex request, confirmation, delivery
  to the second user, saved restoration, deletion, and sign-out.
- Production build passed on Next.js 16.4.3 without the old advisory interruption.
- Runtime audit: **0 vulnerabilities**. Full audit: **31 tooling findings**, with
  no critical findings; remaining impact and limits are recorded above.
- Clean-install dry-run passed; Vercel CLI version check passed (62.7.0).
- The local development server is restarted after the build.
