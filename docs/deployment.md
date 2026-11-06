# Deployment preparation

November 5 update: Render creation is paused. The distributed Vercel Function
WebSocket path is implemented and has a protected candidate; hosted two-user
verification is pending. Earlier claims that Vercel cannot host WebSockets are outdated.
See [the feasibility assessment](vercel-websocket-assessment.md) for verified
platform support, a reproduced multi-instance room failure, and migration gates.
The Render configuration below remains an alternative, not a provisioned service.

Status: **protected Vercel candidate deployed; public deployment incomplete**.
The existing `cocanvas` project uses Next.js / Node 24 with the existing Supabase
URL and publishable key in its production environment. A production candidate
built successfully on November 5, 2026. Render is connected but unprovisioned;
the distributed Vercel candidate awaits authenticated verification; the candidate has not been promoted to the public application domain.
The user explicitly chose Vercel plus cloud WebSocket hosting and **local-only
AI**. Public production AI is intentionally outside this deployment's scope.

Do not mark the deployment ticket complete until the public app, real-time
service, authentication, and persistence have passed two-user production checks.
No completed public application URL has been verified yet.

## Agreed scope — November 5, 2026

The project owner confirmed the following implementation and demonstration scope:

| Environment | Required workflows |
| --- | --- |
| Public website | CoCanvas accounts, board management, canvas editing, sharing, authorized real-time collaboration, and binary Yjs persistence/restoration. |
| Local application | User-authorized ChatGPT subscription connection, model selection, categorization, summaries, action items, preview/confirmation, and persistence/restoration of confirmed content. |

Production authentication, database persistence, and real-time collaboration must
work in the deployed application. Public AI generation is excluded from this
deployment; the public interface must clearly explain its local availability.
Local AI credentials remain in protected local storage, and hosted environments
receive no ChatGPT subscription credentials or API-key fallback.

The deployment ticket is complete only after the public workflows pass two-user
production checks, the local-only AI boundary is verified, and actual access URLs
and setup instructions are recorded. Real local ChatGPT authorization/inference
remains a separate open verification task; mocked SDK responses do not prove it.
See [MVP verification scope and evidence](mvp-verification.md).

This records the project owner's implementation decision. Verification must
still map the original approved capstone proposal and identify any requirement
that needs a formal scope amendment; this document does not claim instructor
approval or mark an unmet proposal requirement as passed.

## Components

- Vercel: the existing Next.js web application and authenticated HTTP routes.
- Board synchronization: `scripts/board-sync.ts` currently requires one long-running
  process. The executable now uses the distributed handlers shared by Vercel Functions;
  the original in-memory factory remains only for its legacy protocol tests.
- Existing Supabase: Auth and PostgreSQL, including binary Yjs checkpoints.
- AI: local ChatGPT subscription OAuth through the installed OpenAI SDK, with
  the local Codex CLI retained as an explicit alternative. See
  [local connection setup](chatgpt-subscription.md).
  Production AI requests deliberately return 404. No API-key billing, credential
  copying to a cloud host, or public tunnel has been configured automatically.

## WebSocket hosting configuration

`Dockerfile.sync` prepares the existing service for a Node 24 container. It copies
only required runtime sources and installs the existing production dependencies.
The container runs as the non-root `node` user. No .env file or account credential
belongs in an image; `.dockerignore` excludes them from the build context.

Configure these values in the host's private environment settings:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | The TCP port supplied by the hosting platform; defaults to 1235 |
| `BOARD_SYNC_HOST` | `0.0.0.0` for a container/web-service host |
| `BOARD_SYNC_ORIGINS` | Exact HTTPS application origins, comma separated |
| `NEXT_PUBLIC_SUPABASE_URL` | Existing Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Existing publishable key; no service-role key |

The entry point validates settings with Effect before opening its listener.
Production has no implicit local origins; wildcards, paths, credentials, non-HTTPS
origins, and invalid ports are rejected. Development keeps loopback-only binding
and the two existing localhost origins. Each socket still verifies its actual
Supabase user and board permissions; an allowed Origin alone never grants access.

Use **one running instance** with the current room implementation. Per-room queues,
accepted-request tracking, and undo managers live in that instance; do not enable
horizontal autoscaling without a distributed room-ownership design. PostgreSQL
persists board state across restarts. The host should forward SIGTERM for the
existing graceful shutdown handler. Its HTTP root supplies a minimal health check.

Use `wss://` for the public socket URL. Configure the Next.js build environment:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=<existing project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<existing publishable key>
NEXT_PUBLIC_BOARD_SYNC_URL=wss://<your real-time service hostname>
```

These NEXT_PUBLIC settings are build-time browser configuration. Redeploy the web
app when the public socket URL changes. Explicitly allow the stable application
origin in `BOARD_SYNC_ORIGINS`; do not wildcard every Vercel preview. Local Codex
login files and private database/admin keys are not public environment variables.

## Remaining account/provider decisions

1. Vercel sign-in, project creation, framework/runtime setup, and Supabase public
   production variables are complete. The linked project is `cocanvas`; no other
   Vercel project was modified.
2. Connect Render and deploy the WebSocket service. `render.yaml` prepares a
   single free Docker instance with automatic deployment disabled and privately
   supplied origin/Supabase settings. No paid service has been provisioned.
3. Keep AI local-only as explicitly selected. The public Assistant explains its
   availability, and the prototype live button is disabled in production. No paid
   provider or subscription-credential bridge is introduced. Production AI is
   intentionally excluded from this deployment scope.
4. Configure actual origin/socket URLs and Supabase production Auth settings.
5. Deploy, then verify two independent account sessions, denied private access,
   editing, collaboration, binary restoration, reconnect, and the public
   local-only AI explanation. Verify real AI generation/confirmation in the local
   application separately, as recorded in the MVP evidence matrix.
6. Record the real public URLs and test results here; check Trello only afterward.

## References

- [Vercel WebSocket hosting guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- [Render WebSocket support](https://render.com/docs/websocket)
- [Render port binding](https://render.com/docs/web-services#port-binding)

These references establish compatibility, not selection of an account or payment
plan. A remote WebSocket image build and complete public deployment have not been
verified yet.

## Candidate verification — November 5, 2026

Candidate: https://cocanvas-f6pyyjtp5-melanies-projects-6a846645.vercel.app

The Vercel production build reached READY using Node 24. This candidate retains
Vercel authentication protection; CLI requests used its protection bypass and do
not establish public access. The sign-in page returned 200, signed-out board API
requests returned 401, and the production ChatGPT endpoint returned 404. No
production socket URL is configured yet, so these checks do not establish working
collaboration or persistence.

`.vercelignore` excludes local credentials, environment files, browser binaries,
IDE files, generated output, dependencies, and tests from CLI uploads. The checked
upload contains about 0.5 MB of source/configuration and no private credential
files. Vercel CLI uploads require this exclusion file independently of Git staging.

A temporary production-configured service running under Node 24 returned the
expected HTTP health response and closed an unlisted-origin WebSocket with code
1008 (`Origin rejected`). It was shut down after the checks. The Docker daemon is
unavailable locally, so this does not establish a successful Docker image build.

The prepared Render free service is intended for the capstone demonstration.
[Render free instances](https://render.com/docs/free) can sleep after 15 minutes
without inbound traffic, take about a minute to wake, and suspend when free quotas
are exhausted. Existing sockets can disconnect during restarts; binary board
state remains in Supabase. Free hosting does not establish continuous availability.
Do not enable a paid plan or autoscaling as part of this configuration.

## Preparation checks — October 31, 2026

TypeScript and all **157 unit/protocol tests** passed. A temporary production-mode
entry-point process on the installed local Node runtime accepted its supplied
port, served its HTTP health response, and rejected an unlisted WebSocket origin.
It was shut down cleanly afterward; no board data or AI request was sent.

The Docker CLI is installed, but its engine socket is unavailable, so the Node 24
container image has **not** been built or executed. The smoke test above does not
substitute for that container/runtime check. The WebSocket hosting account and actual socket URL remain prerequisites for
actual deployment and two-user public verification. The AI decision is now
explicit: local-only, with public generation controls unavailable. No deployment checklist item has been marked complete.

After the local-only AI decision, TypeScript and the production build passed, and
all **159 unit/protocol tests** passed. A local production-browser smoke check
confirmed the Assistant's local-only explanation, absence of a generation action,
the disabled prototype live button, and HTTP 404 for production CLI execution.
This is local production-mode verification, not a remote deployment claim.
