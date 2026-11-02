# Deployment preparation

Status: **not deployed**. Vercel authentication succeeded and a new `cocanvas`
project was created in the existing account on October 31, 2026. It is configured
for Next.js / Node 24 with the existing Supabase URL and publishable key in its
production environment. The WebSocket hosting account is still undecided.
The user explicitly chose Vercel plus cloud WebSocket hosting and **local-only
AI**. Public production AI is intentionally outside this deployment's scope.

Do not mark the deployment ticket complete until the public app, real-time
service, authentication, and persistence have passed two-user production checks.
No public URL has been deployed or verified yet.

## Components

- Vercel: the existing Next.js web application and authenticated HTTP routes.
- A long-running Node/container web service: `scripts/board-sync.ts`. Vercel
  Functions are not the host for this WebSocket server.
- Existing Supabase: Auth and PostgreSQL, including binary Yjs checkpoints.
- AI: currently an installed local Codex CLI using the computer's ChatGPT login.
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
2. Choose an existing WebSocket hosting account, region, and acceptable plan.
3. Keep AI local-only as explicitly selected. The public Assistant explains its
   availability, and the prototype live button is disabled in production. No paid
   provider or subscription-credential bridge is introduced. Production AI is
   intentionally excluded from this deployment scope.
4. Configure actual origin/socket URLs and Supabase production Auth settings.
5. Deploy, then verify two independent account sessions, denied private access,
   editing, collaboration, binary restoration, reconnect, and AI confirmation.
6. Record the real public URLs and test results here; check Trello only afterward.

## References

- [Vercel WebSocket hosting guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- [Render WebSocket support](https://render.com/docs/websocket)
- [Render port binding](https://render.com/docs/web-services#port-binding)

These references establish compatibility, not selection of an account or payment
plan. The deployment configuration is prepared for review; a remote image build
and production deployment have not been verified yet.

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
