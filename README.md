# CoCanvas

Hello! Welcome to my fancy capstone project!

An intelligent collaborative workspace. This repository currently contains the installed technology stack and a minimal Next.js foundation; the proposal's application features are still to be implemented.

## Frontend workspace

The home page now contains an interactive React/Next.js canvas editor. Select or
drag objects, use the floating toolbar to add notes/text/shapes, click two objects
with the connector tool to link them, and edit properties in the Design panel.
Use the hand tool to pan, zoom controls to change scale, and undo/redo to revisit
edits. Keyboard shortcuts: V select, H pan, N note, T text, S shape, C connector,
Delete remove, Escape cancel, and Ctrl/Cmd+Z (Shift to redo).

Effect programs validate edits and handle local storage/export failures. Boards
automatically save in this browser after edits; Export downloads a JSON copy.
Sharing and the assistant explain their pending backend connections. Local saving
is not cloud persistence or multi-user synchronization. Width/height in the
inspector control resizing; drawn selection corners are selection indicators.

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

Playwright downloads Chromium into `.playwright/` inside this project. The tests verify the app can render, concurrent Yjs edits converge, and Zod rejects malformed data; they do not cover the unimplemented MVP workflows.

## Services to configure

- Create a Supabase project for hosted PostgreSQL and authentication, and put its URL and publishable key in `.env.local`. Database tables, row-level security policies, and authentication flows still need implementation. The PostgreSQL client is installed; no local database server has been installed because the proposal specifies hosted PostgreSQL through Supabase.
- Add `DATABASE_URL` for direct server-side PostgreSQL access if needed. Keep database credentials and `OPENAI_API_KEY` on the server; do not prefix them with `NEXT_PUBLIC_`.
- Create an OpenAI API key and configure billing before using the AI assistant. Installing the SDK does not activate an API account.
- Implement and host the authenticated WebSocket service on a compatible platform, then set `NEXT_PUBLIC_WEBSOCKET_URL`. `y-websocket` supplies the client provider; installing packages does not start a collaboration server. The hosting provider is unspecified in the proposal.
- Connect this GitHub repository to Vercel, or run `npx vercel` when ready to deploy. No deployment or external account changes were made during setup.

The installed Vercel CLI dependency tree reports security advisories that remain after compatible `npm audit fix` updates. Review `npm audit` before using the deployment CLI; npm's proposed forced fix changes the CLI's major version.

## Reference documentation

- [Board-object data model](docs/board-object-model.md): types, validation, samples,
  connector behavior, and the proposed Yjs/storage mapping for Week 2 prototypes.

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase Next.js setup](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [Playwright browsers](https://playwright.dev/docs/browsers)
