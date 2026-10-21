# CoCanvas

Hello! Welcome to my fancy capstone project!

An intelligent collaborative workspace. This repository includes an interactive canvas, authenticated Supabase accounts, a private board dashboard, cloud snapshot saving, and collaboration/AI prototypes.

## Frontend workspace

The home page now contains an interactive React/Next.js canvas editor. Select or
drag objects, use the floating toolbar to add notes/text/shapes, click two objects
with the connector tool to link them, and edit properties in the Design panel.
Use the hand tool to pan, zoom controls to change scale, and undo/redo to revisit
edits. Keyboard shortcuts: V select, H pan, N note, T text, S shape, C connector,
Delete remove, Escape cancel, and Ctrl/Cmd+Z (Shift to redo).

Effect programs validate edits and handle local storage/export failures. The public demo automatically saves in this browser after edits; Export downloads a JSON copy.
Use My boards to sign in and manage boards saved to your account.
Sharing and the assistant explain their pending backend connections. Local saving
is not cloud persistence or multi-user synchronization. Drag either selection
corner to resize notes, text and shapes; width/height controls in the inspector
also resize objects. React-Konva renders the board,
with accessible DOM controls for selection and gestures. See
[canvas editing](docs/canvas-editing.md) for controls and verification.

## Development

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Use an actively supported Node.js LTS release (Node 24 recommended). The current local Node 25 installation builds the app, but a Vercel CLI dependency reports an engine warning for that version.

## Installed technologies

| Proposal technology | Project package/tool |
| --- | --- |
| TypeScript and Effect (existing) | `typescript`, `effect` |
| React / Next.js | `react`, `react-dom`, `next` |
| Konva / React-Konva | `konva`, `react-konva` |
| Yjs and WebSockets | `yjs`, `y-websocket`, `ws` |
| PostgreSQL | `pg` PostgreSQL client |
| Supabase | `@supabase/supabase-js`, `@supabase/ssr` |
| AI API | `openai` SDK |
| Validation | `zod` |
| Unit / integration testing | `vitest` |
| Browser testing | `@playwright/test`, local Chromium |
| Vercel | `vercel` CLI |
| Source control | Existing Git repository and GitHub remote |

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e:install
npm run test:e2e
```

Playwright downloads Chromium into `.playwright/` inside this project. Tests cover canvas workflows, Yjs convergence, validation, authentication and board management. The live two-account Supabase test needs opt-in private fixtures; see [foundation setup and tests](docs/foundation.md). Stop the dev server before a production build and restart it afterward.

## Services to configure

- The CoCanvas Supabase project is configured locally, with versioned schema migrations, row-level security and authentication implemented. For another environment, set its URL and publishable key in `.env.local` and follow [foundation setup](docs/foundation.md), including auth redirect URLs. No local PostgreSQL server is required.
- Add `DATABASE_URL` for direct server-side PostgreSQL access if needed. Keep database credentials and `OPENAI_API_KEY` on the server; do not prefix them with `NEXT_PUBLIC_`.
- The AI evaluation prototype uses the installed Codex CLI with ChatGPT sign-in. Run `codex login status` in WebStorm; no API key or separate API billing is required for this local provider. A hosted production AI integration remains separate work.
- Implement and host the authenticated WebSocket service on a compatible platform, then set `NEXT_PUBLIC_WEBSOCKET_URL`. `y-websocket` supplies the client provider; installing packages does not start a collaboration server. The hosting provider is unspecified in the proposal.
- Connect this GitHub repository to Vercel, or run `npx vercel` when ready to deploy. No deployment or external account changes were made during setup.

The installed Vercel CLI dependency tree reports security advisories that remain after compatible `npm audit fix` updates. Review `npm audit` before using the deployment CLI; npm's proposed forced fix changes the CLI's major version.

## Reference documentation

- [Application foundation](docs/foundation.md): accounts, dashboard, schema, environment setup and isolated tests.

- [Board-object data model](docs/board-object-model.md): types, validation, samples,
  connector behavior, and the proposed Yjs/storage mapping for Week 2 prototypes.

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase Next.js setup](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [Playwright browsers](https://playwright.dev/docs/browsers)

## Week 2 prototype lab

Open `/prototypes` for sticky-note manipulation, two-user sync and structured AI
evaluation. Run `npm run prototype:sync` in a second WebStorm terminal for sync.
See [prototype findings and verification](docs/week-2-prototypes.md) for exact
demo steps, implementation decisions, limitations and live AI setup. No additional
packages are required. Both live prompts have been evaluated through local Codex
using ChatGPT sign-in; outputs are saved in `docs/ai-live-results.json`. The
prototype ignores `OPENAI_API_KEY` and `OPENAI_MODEL` and has no API-key fallback.
