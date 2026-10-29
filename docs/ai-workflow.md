# Selected-note AI workflow

Open Assistant on a board, select 1–20 sticky notes (up to 2,000 characters each),
and choose categorization, summary, or action items. Requests send only selected
UUIDs, text, the operation, and the grounded prompt choice. Effect handles request
preparation, network failures, output validation, and confirmed board operations.
React manages selection, loading, feedback, and the temporary review state.

## Provider and contracts

The existing development-only, localhost-restricted `POST /api/prototypes/ai`
endpoint runs the installed local Codex CLI with its ChatGPT login. No API-key
fallback or new library was added. This is not a publicly deployed AI backend.
The existing server request size/origin checks, concurrency limit, request rate
limit, CLI timeout, temporary-directory cleanup, and tool restrictions remain.

`evaluation.ts` exports separate Zod categorization, summary, and action-item
contracts composed into the provider's existing strict response envelope. All
three fields remain required for compatibility with the evaluation lab. The
operation controls the prompt emphasis and displayed/inserted content. Validation
checks types, lengths, nonblank text, unknown fields, known source references,
unique action source IDs, and exactly one category membership for every selected
note. The server provider validates output and the browser independently validates
it against the submitted source snapshot. Structural validation cannot prove that
an AI conclusion is factually grounded; the user must review the content.

## Review and explicit confirmation

A response is a local preview, never an automatic board edit. Cancel, invalid
output, request failures, or changing the selected operation/notes do not insert
anything. Empty action lists are valid previews with confirmation disabled.

Confirm revalidates the result and rejects changed or deleted source notes.
Categorization adds headings and colored copies of the source notes. Summary adds
one text object. Action items add one sticky note per item; source references are
shown in review. Originals remain unchanged, generated objects receive fresh IDs,
and the complete next document passes the existing board schema/size limits.
Generated content is placed below the existing objects and can be found through
the object list. Category columns are a layout, not persistent group containers.

Workspace routes this single edit through its existing local undo/autosave path or
`live.edit` with separate capture boundaries for selective shared undo. Shared
objects are saved using the existing binary Yjs checkpoint and JSON projection;
no migration or alternative persistence format was introduced. Insertion feedback
distinguishes adding the edit locally from its eventual saved acknowledgement.
Read-only/disconnected boards keep the existing disabled inspector behavior.

## Verification

- `npm run typecheck`
- `npm test -- --maxWorkers=1`
- `COCANVAS_TEST_FIXTURES=/path/to/private-accounts.json npm run test:e2e -- tests/e2e/ai-workflow.spec.ts --workers=1`
- `npm run build` (stop the dev server before building, restart afterward)

Unit tests cover each response contract, invalid/unknown references, stale and
deleted sources, unique generated IDs, preservation of originals, empty actions,
request failures, and operation instructions delivered to the server-side CLI.
Browser tests mock AI responses for deterministic preview/cancel/confirm,
loading/failure, local persistence, and undo/redo checks. The opt-in shared test
uses dedicated real Supabase accounts and a temporary board, verifies all three
operations reach the second session and survive reload/API restoration, then
removes the board. A separate live sample request checks the actual local CLI
provider without adding content to a board.

Verified October 29, 2026: TypeScript passed; all 125 unit/protocol tests passed;
33 browser tests passed with the separate opt-in live signup case skipped; the
production build passed. One real sample request returned a validated summary
from `local-codex-cli`; deterministic browser tests used mocked provider output.
