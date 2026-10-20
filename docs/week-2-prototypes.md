# Week 2 prototype findings

Evaluated October 20, 2026 in the local CoCanvas workspace. These prototypes use
only the already installed React, Next.js, React-Konva/Konva, Effect, Yjs, ws,
Zod, OpenAI SDK, Vitest and Playwright dependencies. Node/browser built-ins provide
HTTP, files and WebSockets. No new packages or services were installed.

## Running the experiments in WebStorm

Open the project folder `/Users/mmurray/Code/public/PRO390/Capstone`.
In one WebStorm Terminal tab run `npm run dev`. In another run
`npm run prototype:sync`. Visit `http://localhost:3000/prototypes`.
The existing homepage is unchanged. Keep both terminals running for the sync demo.
The WebSocket server binds only to 127.0.0.1:1234; if needed configure
`PROTOTYPE_WS_PORT` on the server and `NEXT_PUBLIC_PROTOTYPE_WEBSOCKET_URL` on
Next.js to match, then restart both. This raw-update protocol must not be pointed
at a y-websocket server or the application's separate WEBSOCKET_URL setting.

## Stickynote Manipulation

Page: `/prototypes/sticky-notes`.

1. Select the initial note by clicking it or its button in the Notes list.
2. Drag the note. Its stored x/y values change in board units.
3. Drag a corner resize handle. Width/height are updated; Konva scale resets to 1.
4. Edit text/color or numeric properties in the inspector.
5. Switch to Pan mode, drag the board, then zoom with wheel or buttons.
6. Return to Select mode and drag/edit a note. Navigation must not change stored
   object coordinates; a drag must account for the viewport scale.
7. Add another note, then delete it. Inspect the object-data panel for evidence.

The implementation uses the existing stickyNoteSchema and its inferred type.
Creation generates a UUID exactly once. Patches validate the merged note before
mutating the document. Resize handles enforce positive sizes; the committed size
is limited to 80–2000 wide and 60–2000 high. Numeric inspector values use the
existing model's broader dimension bounds. Text editing uses an HTML textarea,
providing a simple keyboard-accessible alternative to editing text inside canvas.
Selection in the sidebar also works without clicking a canvas pixel.

**Observed results:** Chromium tests passed creation, selection, actual canvas
movement, actual Transformer resizing, text editing, deletion, viewport-only pan/
zoom, and actual dragging after panning and zooming (44 screen pixels at 110%
became 40 board units). The property inspector reflected committed geometry.

**Week 4 decisions:** keep viewport state local; reuse validated domain mutations;
normalize transform scale to dimensions; keep pan/select modes explicit. Full
keyboard spatial manipulation, touch pinch, rich text, undo and performance
benchmarking remain future work. This local page is ephemeral, not database saved.

## Demonstrate Two-User Sync

Page: `/prototypes/sync?room=demo`. Open the same URL in two distinct browser
profiles or a regular and private window. Both should show Connected. Select the
same room identifier; changing it updates the URL, so reload restores that room.

1. Create a note in session A. It appears in B without refresh.
2. Edit its text in A. Move it in B; A sees the new stored position.
3. Create a second note in B. It appears in A.
4. Edit different notes at approximately the same time. Both changes remain.
5. Delete B's second note. A removes it without refreshing.
6. Reload B. It receives the room's current document while A stays connected.

**Representation:** one Y.Doc per room; `objects` is a map of UUID to nested Y.Map.
Each map stores immutable identity/type, scalar text/color and grouped JSON
`position: {x,y}` and `size: {width,height}` fields. Transactions update only the
changed keys. Grouped values are replaced, never mutated in place. Plain board
objects are reconstructed and Zod-validated for rendering.

**Transport:** the installed ws package hosts a small, loopback-only server.
Binary frames carry Yjs document updates. The server sends room state on connect;
clients send their current state when opened; incremental changes are broadcast.
Remote-origin updates are not echoed by the client. Reconnect retries every 1.5s
and exchanges complete state so the local document can merge missed edits.
This deliberately small experiment uses Yjs's public update API over native
WebSocket, not the y-websocket wire protocol. y-websocket remains installed; a
production provider decision is separate from demonstrating convergence.

**Observed results:** Playwright used two independent browser contexts (separate
storage and JS environments) communicating over the actual WebSocket server.
Creation, text editing, position changes, bidirectional updates, simultaneous
edits to different objects, deletion and room reload passed. Unit tests also
verified concurrent edits to different fields of one object (position vs text),
atomic geometry groups, and delete-vs-late-edit convergence without resurrection.

**Limitations:** same-key edits converge but may discard one user's intent; text
is a string, not Y.Text. Room state exists only in RAM and expires after the last
peer has been gone for at least 60 seconds; restarting the server loses it. There
is no Auth, board authorization, TLS, durable storage, awareness/cursors, optimized
state-vector protocol or production abuse protection. Origin checks and payload/
room limits are only local demo safeguards. Public deployment is inappropriate.
Automatic reconnect is implemented; a full prolonged network-partition scenario
is not claimed as tested. Do not share private content in this prototype.

## Evaluate Structured AI Responses

Page: `/prototypes/ai`. Schemas, selected sample notes, two prompts and fixture
responses live in `src/lib/ai/evaluation.ts`.

The single response envelope defines all three proposed features:

- `categories`: named groups with referenced source-note IDs.
- `summary`: nonempty bounded text.
- `actionItems`: suggested task text with source-note IDs; an empty list is allowed.

Zod rejects extra fields, missing fields, malformed values, invalid UUIDs and
oversized text/lists. Additional semantic checks reject references outside the
selected notes and require every selected note to appear exactly once in
categories. A structurally valid response may still be inaccurate; human review
is required. Validate again on confirmation. Input JSON is never evaluated as code.

**Local evaluation results (fixtures, not model-generated):** a hand-authored
response for three sample notes passed as both object and JSON. Invalid JSON,
truncated JSON, wrong/missing types, empty summary, unknown fields, unknown IDs,
missing categories and duplicated categorization were rejected. Automated browser
checks proved invalid output offers no confirmation, cancellation leaves the tray
unchanged, and only explicit confirmation inserts the validated summary/actions
into the separate local evaluation tray. Nothing is inserted into the shared board.
Editing the raw response invalidates the preview, preventing stale confirmation.

**Live prompt comparison: PASSED with local Codex CLI.** Real outputs and CLI
usage metadata are saved in `docs/ai-live-results.json`, evaluated October 20,
2026. Both runs required a successful completed CLI turn, parsed its output file,
and passed the same Zod and source-reference checks as fixtures. The recorded
model label is “Codex CLI default”: the exact backend model ID was not reported
by the JSON event stream, so the evaluation does not claim GPT-5.4 mini results.
The prior API-key attempt was blocked by HTTP 429; it was replaced, not retried
through a paid API fallback.

| Prompt | End-to-end time | Input tokens | Output tokens | Semantic review |
| --- | --- | --- | --- | --- |
| Concise | 5688 ms | 10087 | 209 | Grouped discovery/search together and disconnected status separately; faithful summary; two source-grounded tasks; no invented owner/date. |
| Grounded | 5323 ms | 10132 | 201 | Same coverage, concise actionable wording, no invented owner/date; recognizes search testing as proposed work. |

Both results covered all three note IDs exactly once in categories and referenced
only known IDs in actions. Neither run inserted content automatically. This is a
two-run feasibility evaluation, not proof that one prompt is statistically better.
Prefer the grounded prompt because its explicit constraints make the intended
behavior easier to audit. Real notes with ambiguity, malicious instructions,
contradictions, sensitive content and larger selections need additional evaluation.
CLI token counts include its harness overhead; they do not translate to an API
invoice or establish remaining subscription limits.

### Local Codex setup

1. The existing Codex CLI must be installed and on PATH. Run `codex login status`
   in WebStorm. If needed, run `codex login` and choose ChatGPT sign-in.
2. Set `CODEX_CLI_PATH` in ignored `.env.local` only if the Next.js process cannot
   find the executable, for example `/opt/homebrew/bin/codex`. Restart Next.js.
   `OPENAI_API_KEY` and `OPENAI_MODEL` are not used by this prototype.
3. Run `npm run dev`. Open `/prototypes/ai`, review the sample inputs and choose
   either prompt. Click **Run with local Codex**.
4. Review validated results, then confirm insertion into the local evaluation tray,
   or cancel. Raw-output edits invalidate the preview. Shared boards are unchanged.
5. For repeatable evidence, run `npm run prototype:ai` while the dev server is
   running. It sends two requests to the local Next.js route and saves real outputs
   to `docs/ai-live-results.json`; it never substitutes a fixture.

### Execution and authentication

The Next.js route delegates to `evaluateWithLocalCodex`, an Effect program. It
checks `codex login status` for ChatGPT sign-in and explicitly forces that login
method. API-key login is rejected. Child processes receive only an allowlisted
OS/CLI environment: API keys, provider URL overrides, access-token overrides,
database secrets and app-server connection settings are excluded. The provider
never imports or calls the OpenAI SDK. No API-key fallback exists.

Each request uses a new temporary working directory, an ephemeral read-only
`codex exec` session, stdin input, Zod-generated JSON Schema with `--output-schema`,
and a separate output file. It ignores user config to avoid custom providers and
MCP configurations, disables shell/exec, apps/plugins, multi-agent, browser and
computer-use features, and disables web search. Inputs are process arguments only
for fixed switches and paths; note text is sent on stdin without shell execution.
The subprocess is given no project working directory. The temporary directory is
removed after success/failure. Authentication stays in the CLI's existing OS/store;
we do not copy credentials into this repo or expose them to the browser.

Only a completed CLI turn plus a locally validated output counts as success. A
missing CLI, wrong login, subscription limit, timeout, cancellation, failed command
or invalid output returns an actionable error; it never inserts content. Raw CLI
logs are not returned to the client. The 90-second inference timeout, 10-second
login timeout and bounded process output prevent indefinitely waiting on failures.
Cancellation terminates the child process, with a force-kill fallback.

### Privacy and usage limits

This is a localhost-only development integration. The route is disabled in
production and rejects non-loopback hosts and cross-origin browser requests. It
allows one in-flight evaluation and four requests per minute per process, with
bounded input and output. It is not suitable for a publicly deployed application.
No shared remote service should run against the developer's personal login.

Inference still sends sample notes to OpenAI through Codex; “local CLI” does not
mean an offline model. The evaluation uses synthetic sample notes only. Check the
current account's privacy/data controls before sending sensitive notes. Do not
log or commit private note content or credentials. Review the CLI environment and
operating-system permissions for any future non-prototype integration.

Requests consume the signed-in user's ChatGPT/Codex plan allowance and remain
subject to plan limits. We do not purchase credits, switch providers on failure,
or estimate included usage from API token prices. Existing API environment
variables may remain in `.env.local` for future work but are not passed to Codex.
The future hosted MVP needs its own supported authentication/provider design.

## Verification evidence

- `npm test`: 42 tests passed across seven files, including provider authentication, key exclusion, temporary-file cleanup, failure handling and route boundaries.
- `npm run typecheck`: passed.
- `npm run build`: passed, including all prototype routes and the AI route.
- `npm run test:e2e`: six Chromium tests passed, including the existing frontend
  regressions and the three new prototype workflow tests.

## Primary references reviewed

- [React-Konva Transformer](https://konvajs.org/docs/react/Transformer.html)
- [Yjs shared maps](https://docs.yjs.dev/api/shared-types/y.map)
- [Yjs document updates](https://docs.yjs.dev/api/document-updates)
- [Codex non-interactive mode and structured output](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
