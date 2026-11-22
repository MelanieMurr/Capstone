# Stickers and approved sticky-note comments

Implemented locally November 20, 2026. No application deployment or hosted database
migration was performed. Existing libraries are used; domain validation, requests,
and other fallible feature work run through Effect.

## Stickers

The toolbar's **Stickers (K)** tool opens a searchable picker with Reactions and
Thinking categories. Choose a sticker, then click the canvas to place it. Normal
selection, move, resize, rotation, layering, copy/paste, delete, and undo/redo apply.
Stickers are typed objects with stable `assetId` values inside the existing binary
Yjs document. Unknown future IDs display a neutral diamond and an accessible
Unavailable sticker label rather than fetching an arbitrary image URL.

The catalog uses Unicode emoji rendered by the operating system's fonts. No font
files or third-party sticker artwork are redistributed. FigJam's public
[stamps/emotes interaction](https://www.figma.com/figjam/) informed the small picker
and canvas placement flow; its artwork was not copied. Appearance varies by OS.
Light/dark system preferences were checked for picker usability; this does not
implement the separate personal-themes ticket.

Restart the local sync process after updating the object schema. All collaborators
need the updated client/server before using the new object type. Older application
versions cannot validate sticker objects.

## Comment permissions and authorship

- Only current board members can comment, including viewers. Comment submission
  never grants editor access and never changes the canvas document.
- The server records each newly saved sticky note's creator. An immutable SQL
  authorship record is independent of client-editable JSON/Yjs data. Copying a
  note creates a new ID and therefore new authorship.
- Existing notes are attributed to the board owner by the migration. If an older
  binary-only document needs its missing projection restored, its pre-existing
  notes also fall back to the owner. Deleted note IDs retain authorship so undo or
  reusing an ID cannot transfer approval rights.
- The note's author reviews comments while they remain a board member, including
  if downgraded to Viewer. If they leave or their account is deleted, the board
  owner becomes reviewer.
- Pending/rejected comments are visible only to their writer and current reviewer,
  who must still have board access. Approved comments are visible to board members.
- Text is plain text, limited to 2,000 characters. Browser rendering escapes it.
  New comments start Pending; only the reviewer can approve/reject. A repeated
  identical review is idempotent; a conflicting later review is rejected.
- Deleting a note removes its comments. Undoing the note deletion does not restore
  those comments. Board deletion cascades through both metadata tables.
- The comment writer cannot edit content or moderation state after submission.
  Comments currently support approval/rejection rather than threaded replies.

Comments stay in separate RLS-protected SQL tables, not the shared Yjs payload:
otherwise unapproved content would reach every collaborator. The binary board state
remains authoritative for canvas objects; its saved projection drives note tracking.
The document trigger and comment-insert lock serialize note deletion with new
comments. Approval races are guarded by row locks and a one-way status transition.
No public SECURITY DEFINER function is introduced; narrow private trigger/helpers
check the caller and use an empty search path. Column grants prevent forged
creators, statuses, timestamps, and comment-body updates.

## UI and deployment

Click a note's comment badge or select a note and open the Comments tab. This panel
remains usable for viewers, outside the disabled canvas-editing fieldset. It shows
status, writer, time, and review actions only for the designated reviewer. Visible
counts and selected-note history refresh every two seconds. History pages contain
100 comments. Membership errors clear displayed data; RLS remains the authority.

Before testing with actual accounts, apply the migration
`supabase/migrations/20261121043536_note_comments.sql` to the intended database using
the normal reviewed deployment workflow. Then restart local sync and reload the
app. The migration file is ready for review and has not been applied to the
hosted project during this work.

## Verification

- All 228 unit/protocol tests and the production build passed. Tests cover sticker operations, safe fallback, binary restoration,
  cross-connection synchronization, one-step undo, viewer denial, comment request
  validation, authorization, idempotent creation, review denial, and pagination.
- Real local PostgreSQL tests exercise Owner, Editor, Viewer, and Outsider identities
  using a minimal simulated Supabase auth schema, not actual Supabase sessions.
  They verify pending privacy (including badge counts), immutable authorship,
  viewer canvas denial, approval/rejection, forged fields, revocation, deletion,
  reviewer-account removal, conflicting review races, and deletion/insertion races.
- The migration was applied from scratch in a second isolated database; a third
  fixture verified legacy-note owner attribution.
- Local Chromium checked sticker search/placement/transforms/copy/undo, escaped
  comment text, moderation controls, and viewer commenting with disabled canvas
  controls. HTTP responses were mocked; SQL permissions were tested separately.
- Hosted multi-account browser verification remains outstanding. No production
  rollout or live-user migration result is claimed.

Run unit/protocol tests with `npm test -- --maxWorkers=1`. To run the SQL suite,
bootstrap an isolated local PostgreSQL cluster on a private Unix socket with
`tests/fixtures/comment-auth-bootstrap.sql`, then apply the repository migrations.
Set `COCANVAS_COMMENT_TEST_SOCKET` to that socket directory (must start with
`/private/tmp/cocanvas-comment`), port 55439, database postgres, then run
`npm run test:comments`. The fixture must never be installed in a hosted project.
The SQL suite skips without that explicitly supplied local socket.
