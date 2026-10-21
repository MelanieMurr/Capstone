# Canvas editing implementation

These changes complete the In Progress canvas tickets: Create & Edit Sticky Notes,
Add Text & Shape Options, and Implement Selection & Resizing. They use the existing
React, Next.js, React-Konva, Konva, Zod and Effect packages; no dependencies were added.

## Try the editor

Open `/` for the local demo, or open a board from `/dashboard` to save to your
account. Select Sticky note (N), Text (T), or Shape (S), then click an empty canvas
location. Creation returns to Select mode. The Design panel opens for the object.

- Sticky notes: edit Content and note color. Text changes retain the object's ID,
  position, dimensions and relationships. New notes use the model's defaults.
- Text: edit Content, font size (8–256), and text color.
- Shapes: edit Content, font size (8–256) and text color directly on the shape.
  Labels wrap and remain centered when the shape moves or resizes; ellipse labels
  fit inside its curved edge. Select Rectangle or Ellipse, fill, border color and
  border width (0–32).
  These are the two basic shape types supported by the approved object schema.
- Every non-connector object has editable position, dimensions, rotation and layer
  order. Invalid values are rejected visibly rather than stored.
- Select an object and drag it to move. Drag either square corner handle to resize.
  Handles also accept arrow keys in 10-board-unit steps. Pointer resizing clamps
  dimensions to 24–100,000 units and prevents negative-size flips. The inspector
  follows the underlying model's positive dimension rule.
- Use H/Pan to move the view and the zoom controls to change scale. Navigation does
  not change stored object data. Use V/Select to resume object editing.
- Undo/redo treats a complete move or resize as one operation. Escape cancels an
  active gesture and deselects. Pointer cancellation restores the original object.
  Delete removes the selection and any attached connectors.

Object selection is available by pointer, the object list or keyboard focus plus
Enter/Space. Selection outlines and `aria-pressed` describe the current object.
Read-only boards allow navigation and selection but disable editing and handles.
Connectors follow their targets' geometry and are not independently resized.

## How it is connected

`src/components/board-canvas.tsx` renders actual pixels through React-Konva Stage,
Layer, Group, Rect, Ellipse, Text and Arrow components. It is imported with
`next/dynamic` and `ssr: false` from the client workspace, avoiding server-side
canvas dependencies. ResizeObserver keeps its Stage aligned with the canvas area;
font readiness triggers a redraw using the loaded application fonts.

Transparent DOM object controls are positioned above that canvas. They provide
screen-reader labels, keyboard access, pointer capture and accessible resize
buttons. They do not draw duplicate objects or own a second copy of object state.
The React-Konva scene and DOM controls both consume the same BoardDocument and
viewport. The surrounding canvas application layout remains unchanged.

`src/lib/board/operations.ts` contains Effect programs for object creation, validated
patches and resizing. New objects receive a UUID once, schema defaults and a layer
order above existing objects. Patches cannot change an object's ID or type.
Movement divides screen deltas by the viewport scale. Resizing also rotates those
board-coordinate deltas into local object coordinates; resizing from the top left
keeps the opposite corner fixed, including for rotated objects and at size limits.

`src/components/workspace.tsx` owns rendering state, selection and undo history.
Editing and gestures call Effect programs before accepting their results. The
existing local-storage saving, export and authenticated SavedBoard adapter use the
same validated BoardDocument. Saved boards retain all IDs and geometry on reload.
No synchronization or invitation behavior was added in this canvas milestone.

## Verification

```sh
npm run typecheck
npm test
npm run test:e2e -- tests/e2e/canvas.spec.ts tests/e2e/home.spec.ts
npm run test:e2e
npm run build
```

Stop the development server before a production build, then restart it. The new
unit checks cover schema defaults, identity preservation, rejected edits, resizing
limits and the fixed opposite corner of rotated objects. Production browser checks
cover actual Konva canvas mounting, multiline sticky-note editing and restoration,
text and shape styling, both shape variants, unchanged data during navigation,
movement/resizing at 95% zoom after panning, keyboard resizing and undo/redo.

The opt-in live foundation test additionally creates a private board, saves a
sticky note, standalone text and a resized ellipse, then reloads and compares the
entire restored document. It uses separate disposable Supabase accounts and
validates ownership isolation; see `docs/foundation.md` for fixture setup. Existing
prototype sync and AI validation tests remain part of the regression suite.

Verified on October 21: 59 unit/integration tests passed, 13 browser tests passed
(including the live private-board workflow), and the production build passed. The
separate opt-in live-signup test was skipped because it is unrelated to these
canvas changes. Desktop/mobile screenshots were inspected. Disposable test
accounts were signed out globally and removed after verification.
