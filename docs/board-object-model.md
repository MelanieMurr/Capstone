# Board-object model (version 1)

## What this ticket means

A data model is the saved description of each thing on the canvas. For example,
a sticky note needs an identity, location, size, text and color. The drawing code,
collaboration code and saving code must agree on those descriptions. This ticket
establishes that agreement before the Week 2 prototypes.

The executable contract is `src/lib/board/model.ts`; its TypeScript types are
inferred from Zod so the types and validation cannot drift apart. Sample data in
`src/lib/board/samples.ts` covers sticky notes, text, both proposed shapes, and
attached and free connectors. The board envelope has `schemaVersion: 1`, a UUID
`boardId`, and an `objects` array.

## Checklist explained and decisions

| Checklist item | Plain meaning and initial decision |
| --- | --- |
| Shared properties | Every object has `id`, `type`, `x`, `y`, `width`, `height`, `rotation`, `zIndex`. These say what it is, where it is, how big it is and which item draws on top. |
| Sticky notes | Save `text` and `backgroundColor`. |
| Text | Save `content`, `fontSize`, `textColor`. |
| Shapes | Save `shapeType`, `fill`, `borderColor`, `borderWidth`. Start with rectangle and ellipse; these are a prototype scope choice, not a verified exhaustive proposal requirement. |
| Connectors | Save `start`, `end`, `arrowStyle`, `strokeColor`, `strokeWidth`. An endpoint is either a free board coordinate or an attached object ID plus normalized anchor coordinates. |
| Moving/deleting targets | Attached endpoints follow target movement, resizing and rotation. Delete connectors attached to a deleted object in the same local Yjs transaction. Concurrently created dangling connectors are hidden and removed by an authorized reconciliation step after sync. |
| Yjs representation | One shared document per board, an objects map keyed by stable IDs, and a nested shared map per object. Update the relevant field instead of replacing the entire object. |
| Validation/defaults | Reject unknown object types/fields, invalid values, duplicate IDs and broken references in complete snapshots. Supply appearance/geometry defaults, but require identities, types and connector endpoints. |
| Schema version | Version 1 is required. Future versions need explicit migrations; never silently reinterpret old board data. |
| Examples/decisions | This document and `samples.ts` record the design for evaluation. |

## Geometry, identity and rendering

Coordinates are in board units, independent of pan/zoom. `x,y` are the top-left
origin; positive rotation is clockwise in degrees, rotating about that origin.
Width and height are positive bounding-box dimensions. The renderer must use
this origin consistently, including ellipses (offset their center appropriately).
Konva resize transforms should be converted into width/height, with scale reset
to 1. Render lower zIndex first; break ties by ID for deterministic ordering.

Create IDs once with `crypto.randomUUID()`. Editing, moving, syncing, exporting
and reopening preserve IDs. Duplicating creates a new ID; remap connector
references if duplicating a connected group. Objects belong to the board envelope,
so do not duplicate boardId in every object.

An attached endpoint uses anchorX/anchorY between 0 and 1 within the target's
unrotated bounding box. `resolveEndpoint` computes the rotated board position;
anchor (0.5,0.5) is the center. For ellipses, edge-anchor placement is a future
interaction concern: normalized bounding-box anchors are not automatically
snapped to the curved perimeter. Connectors cannot attach to other connectors.
Free endpoints use absolute board coordinates. Their endpoints determine rendered
geometry; the connector's shared x/y/width/height/rotation fields are reserved
metadata and must not also transform the endpoints. Keep those defaults until
the prototype determines whether connector bounding metadata is useful.

## Validation and defaults

IDs must be UUIDs. All coordinates/numbers must be finite. Dimensions are
greater than 0 and at most 100,000; rotation is [0,360); zIndex is a nonnegative
safe integer. Colors use six-digit hex strings. Text has at most 10,000 characters;
font size is 8–256. Border width is 0–32; connector stroke width is >0–32.
Boards allow at most 10,000 objects as an initial safety limit, not a measured
performance guarantee. Empty text and self-loops on non-connector targets are allowed.

Defaults: position (0,0), size 200×160, rotation/zIndex 0; empty text; sticky
background #fff59d; font size 24; text/border/stroke #222222; shape fill #ffffff;
rectangle; border/stroke width 2; end arrow; attached anchor (0.5,0.5).

Validate imported/restored complete snapshots with `boardDocumentSchema.parse`.
Use object validation before local creation/edits. Defaults normalize missing
fields on creation/import; do not regenerate defaults into a partially loaded
live document. Remote updates and AI input are untrusted. Full-document reference
validation may temporarily fail during synchronization: render only valid objects,
hide unresolved attachments, and reconcile after sync. Validation is not
authorization; a future server must enforce board access and validate edits.

## Proposed Yjs mapping and storage

`doc.getMap("board")` contains boardId and schemaVersion.
`doc.getMap<Y.Map<unknown>>("objects")` maps object UUIDs to nested maps.
Store immutable id/type and scalar appearance fields in each nested map.
Group x/y as one JSON `position` field, width/height as one `size` field, and
each connector endpoint as one JSON field. Replace these small groups atomically
to avoid mixed coordinate pairs; flatten position/size when producing validated
BoardObject snapshots. Do not mutate JSON values in place.

Example: `note.set("position", { x: 120, y: 80 })` moves a note;
`note.set("backgroundColor", "#aabbcc")` changes only its color. Different keys
merge independently; concurrent edits to the same key converge to Yjs's selected
value, not a guarantee that both intentions survive. Treat text/content as plain
strings for the first prototype (same-field edits can overwrite); evaluate
`Y.Text` if simultaneous character-level editing is needed. Position vs size is
also a cross-field concurrency decision to evaluate during resizing.

The synchronization test verifies nested maps preserve concurrent position and
color edits and survive binary restoration. This is an in-memory feasibility
check; browser/WebSocket prototypes and deletion reconciliation remain later work.

Proposed persistent storage associates each boardId with a full binary Yjs state
encoded by `Y.encodeStateAsUpdate(doc)` and later restores it using
`Y.applyUpdate(newDoc, savedState)`. Persist the schema version alongside it.
Optional validated JSON snapshots support inspection/export; preserve all IDs and
references. JSON alone does not preserve CRDT history for offline merging.
Future storage must merge accepted updates into the authoritative document before
saving, serialize writes or use revision checks to avoid stale snapshots overwriting
newer state, and enforce access to both WebSocket rooms and stored boards.
Database schema, persistence service, migrations and live synchronization are
separate tickets; this ticket only proposes their data contract.

## Verification and sources

Run `npm test` and `npm run typecheck`. Model tests cover JSON restoration,
invalid inputs, references/IDs/version, attachment geometry and nested-map merging.

- [Yjs Y.Map documentation](https://docs.yjs.dev/api/shared-types/y.map)
- [Yjs document updates](https://docs.yjs.dev/api/document-updates)
- [Zod schemas](https://zod.dev/api)

The prototype should evaluate shape scope, connector interaction/bounds, same-field
text edits, concurrent delete/attach behavior, and geometry under pan/zoom before
treating these initial decisions as final production behavior.

### Shape labels

Rectangles and ellipses also store `text` (up to 10,000 characters), `fontSize`
(8–256; default 20) and six-digit `textColor` (default `#222222`). These fields
belong to the shape object, so labels move, resize and rotate with it. Old shape
snapshots receive empty text and the typography defaults during validation; the
document stays at schema version 1. No additional text object or ID is created.
