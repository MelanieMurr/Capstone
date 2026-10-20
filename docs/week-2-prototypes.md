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

**Live prompt comparison: PENDING.** No OPENAI_API_KEY or OPENAI_MODEL is configured
in the project/environment at evaluation time. No model call, model quality result,
usage charge or token measurement is claimed. This is the one Trello checklist
item that cannot honestly be checked yet. The concise and grounded prompts are
prepared, but fixtures do not evaluate actual model behavior.

To finish the live comparison:

1. Add OPENAI_API_KEY and OPENAI_MODEL (a model your account can use that supports
   Responses structured output) to ignored `.env.local`. Never paste the key into
   chat, commit it, or prefix it NEXT_PUBLIC_. Restart `npm run dev`.
2. Read the three sample notes and privacy/cost notice on the evaluation page.
3. Run both prompt variants with the live button, or run `npm run prototype:ai`
   while the local dev server is running. The script sends two bounded API calls
   and saves real outputs, model, prompt, usage and latency to
   `docs/ai-live-results.json`. It fails explicitly if configuration/API validation
   fails; it never substitutes a fixture.
4. Inspect categorization coverage, summary faithfulness, actionability, invented
   facts/owners/dates and source references. Record findings here and commit the
   resulting evidence before checking the live-evaluation item.

**API design and review:** the installed OpenAI SDK's Responses parse helper uses
`zodTextFormat` for strict structured output and then local semantic validation.
JSON mode alone does not enforce this schema. Refusals, incomplete output, timeouts,
rate limits/quota and schema failures produce an error with no insertion. The
endpoint is disabled in production. It limits local evaluations to one in-flight
request, four requests/minute per process, 20 notes, bounded content, 2000 output
tokens, a 30-second timeout and no automatic retries. These are prototype controls,
not production authentication or distributed rate limits.

**Privacy:** send only explicitly selected/specified note text and IDs. This page
uses synthetic sample notes only. Show a review of the input before live requests;
use user confirmation before inserting generated content. `store: false` is set,
but does not imply zero provider retention. Check the account's current data
controls before sending sensitive content. Do not log credentials or private board
text. Future real-board integration needs authorization and workspace consent.

**Costs/rate limits:** the UI warns that live calls may incur charges. Use your
chosen model's current published prices and returned input/output usage to estimate
cost; no price is hardcoded. Review account budgets and billing before evaluation.
Do not retry quota failures blindly; present retry guidance, cancel/discard stale
results, and add per-user quotas, request cancellation and input revision checks
before production integration. The local limit is not a billing cap.

## Verification evidence

- `npm test`: 31 tests passed across five files.
- `npm run typecheck`: passed.
- `npm run build`: passed, including all prototype routes and the AI route.
- `npm run test:e2e`: six Chromium tests passed, including the existing frontend
  regressions and the three new prototype workflow tests.

## Primary references reviewed

- [React-Konva Transformer](https://konvajs.org/docs/react/Transformer.html)
- [Yjs shared maps](https://docs.yjs.dev/api/shared-types/y.map)
- [Yjs document updates](https://docs.yjs.dev/api/document-updates)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
