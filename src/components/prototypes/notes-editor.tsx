"use client";

import { useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import * as Y from "yjs";
import { Group, Layer, Rect, Stage, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { StickyNote } from "../../lib/board/model";
import { deleteNote, patchNote, readNotes, writeNote } from "../../lib/prototypes/notes";
import { INITIAL_VIEWPORT, panTo, zoomAt } from "../../lib/board/viewport";

function Note({ note, selected, panMode, select, update }: {
  note: StickyNote; selected: boolean; panMode: boolean;
  select: () => void; update: (patch: Partial<StickyNote>) => void;
}) {
  const group = useRef<Konva.Group>(null);
  const transformer = useRef<Konva.Transformer>(null);
  useEffect(() => { if (selected && group.current) transformer.current?.nodes([group.current]); }, [selected]);
  return <>
    <Group ref={group} x={note.x} y={note.y} width={note.width} height={note.height} draggable={!panMode} onClick={select} onTap={select}
      onDragStart={select} onDragEnd={(event) => update({ x: event.target.x(), y: event.target.y() })}
      onTransformEnd={() => {
        const node = group.current!;
        const width = Math.max(80, Math.min(2000, note.width * node.scaleX()));
        const height = Math.max(60, Math.min(2000, note.height * node.scaleY()));
        node.scale({ x: 1, y: 1 });
        update({ x: node.x(), y: node.y(), width, height });
      }}>
      <Rect width={note.width} height={note.height} fill={note.backgroundColor} cornerRadius={3} stroke={selected ? "#28785f" : "#d8d9bf"} strokeWidth={selected ? 2 : 1} />
      <Text text={note.text} width={note.width} height={note.height} padding={18} fontSize={18} lineHeight={1.4} fill="#293e36" />
    </Group>
    {selected && !panMode && <Transformer ref={transformer} rotateEnabled={false} flipEnabled={false} keepRatio={false} enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]} boundBoxFunc={(oldBox, box) => box.width < 40 || box.height < 30 ? oldBox : box} />}
  </>;
}

export default function NotesEditor({ shared = false }: { shared?: boolean }) {
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT);
  const [panMode, setPanMode] = useState(false);
  const [connection, setConnection] = useState(shared ? "Connecting" : "Local prototype");
  const [error, setError] = useState("");
  const [room, setRoom] = useState(() => {
    const value = new URLSearchParams(window.location.search).get("room") || "demo";
    return /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : "demo";
  });
  const [size, setSize] = useState({ width: 900, height: 500 });
  const doc = useRef<Y.Doc | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const note = notes.find((item) => item.id === selected);
  const run = <A,>(program: Effect.Effect<A, Error>, success: (result: A) => void = () => {}) => {
    Effect.runSync(Effect.match(program, { onFailure: (cause) => setError(cause.message), onSuccess: (result) => { setError(""); success(result); } }));
  };
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }); });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const document = new Y.Doc();
    doc.current = document;
    const map = document.getMap<Y.Map<unknown>>("objects");
    const refresh = () => setNotes(readNotes(document));
    map.observeDeep(refresh);
    let stopped = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    if (!shared) {
      run(writeNote(document, { id: crypto.randomUUID(), type: "sticky-note", x: 80, y: 80, text: "Select me, drag me, and resize me." }));
    }
    const transmit = (update: Uint8Array, origin: unknown) => {
      if (origin !== "remote" && socket?.readyState === WebSocket.OPEN) socket.send(new Uint8Array(update));
    };
    document.on("update", transmit);
    function connect() {
      if (stopped) return;
      setConnection("Connecting");
      run(Effect.try({
        try: () => new WebSocket(`${process.env.NEXT_PUBLIC_PROTOTYPE_WEBSOCKET_URL || "ws://127.0.0.1:1234"}/${encodeURIComponent(room)}`),
        catch: () => new Error("Could not open the local sync connection."),
      }), (opened) => {
        socket = opened;
        opened.binaryType = "arraybuffer";
        opened.onopen = () => opened.send(new Uint8Array(Y.encodeStateAsUpdate(document)));
        opened.onmessage = (message) => { if (stopped) return; run(Effect.try({
          try: () => { Y.applyUpdate(document, new Uint8Array(message.data), "remote"); setConnection("Connected"); },
          catch: () => new Error("The sync server sent an invalid update."),
        })); };
        opened.onerror = () => setError("Start npm run prototype:sync in another terminal.");
        opened.onclose = () => { if (!stopped) { setConnection("Disconnected; retrying"); retry = setTimeout(connect, 1500); } };
      });
    }
    if (shared) connect();
    refresh();
    return () => { stopped = true; clearTimeout(retry); socket?.close(); document.off("update", transmit); map.unobserveDeep(refresh); document.destroy(); doc.current = null; };
  }, [shared, room]);

  function update(patch: Partial<StickyNote>) { if (doc.current && selected) run(patchNote(doc.current, selected, patch)); }
  function create() {
    if (!doc.current) return;
    const id = crypto.randomUUID();
    run(writeNote(doc.current, { id, type: "sticky-note", x: (120 - viewport.x) / viewport.scale, y: (100 - viewport.y) / viewport.scale, text: "New idea", zIndex: notes.length }), () => setSelected(id));
  }
  return <main className="prototype-page">
    <nav className="prototype-nav"><a href="/">← Workspace</a><a href="/prototypes">All prototypes</a></nav>
    <h1>{shared ? "Two-user synchronization" : "Sticky-note manipulation"}</h1>
    <p>{shared ? "Open this URL in two separate browser sessions. Use the same room to share notes." : "Create, select, drag, resize, edit and delete notes on a React-Konva canvas."}</p>
    <div className="prototype-controls">
      <button className="button primary" onClick={create}>Add note</button>
      <button className="button" aria-pressed={panMode} onClick={() => setPanMode(!panMode)}>{panMode ? "Pan mode" : "Select mode"}</button>
      <button className="button" onClick={() => run(zoomAt(viewport, { x: size.width / 2, y: size.height / 2 }, 1 / 1.1), setViewport)}>Zoom out</button>
      <output aria-label="Zoom percentage">{Math.round(viewport.scale * 100)}%</output>
      <button className="button" onClick={() => run(zoomAt(viewport, { x: size.width / 2, y: size.height / 2 }, 1.1), setViewport)}>Zoom in</button>
      <button className="button" onClick={() => setViewport(INITIAL_VIEWPORT)}>Reset view</button>
      <span role="status">{connection}</span>
      {shared && <label>Room <input aria-label="Room" value={room} maxLength={64} onChange={(event) => { const value = event.target.value; if (/^[a-zA-Z0-9_-]{1,64}$/.test(value)) { run(Effect.try({ try: () => { const url = new URL(window.location.href); url.searchParams.set("room", value); window.history.replaceState(null, "", url); }, catch: () => new Error("Could not update the room URL.") })); setRoom(value); setSelected(null); } }} /></label>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="prototype-editor">
      <div ref={container} className="prototype-stage" role="region" aria-label="Sticky note canvas">
        <Stage width={size.width} height={size.height} x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale} draggable={panMode}
          onMouseDown={(event) => { if (event.target === event.target.getStage()) setSelected(null); }}
          onDragEnd={(event) => { if (event.target === event.target.getStage()) run(panTo(viewport, { x: event.target.x(), y: event.target.y() }), setViewport); }}
          onWheel={(event) => { event.evt.preventDefault(); const pointer = event.target.getStage()?.getPointerPosition(); if (pointer) run(zoomAt(viewport, pointer, event.evt.deltaY < 0 ? 1.1 : 1 / 1.1), setViewport); }}>
          <Layer>{notes.map((item) => <Note key={item.id} note={item} selected={selected === item.id} panMode={panMode} select={() => setSelected(item.id)} update={(patch) => { if (doc.current) run(patchNote(doc.current, item.id, patch)); }} />)}</Layer>
        </Stage>
      </div>
      <aside className="prototype-inspector"><h2>Notes</h2>
        {notes.map((item, index) => <button className="button" key={item.id} aria-label={`Select note ${index + 1}`} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{item.text.slice(0, 30) || "Empty note"}</button>)}
        {note ? <>
          <label className="field">Text<textarea aria-label="Note text" maxLength={10000} value={note.text} onChange={(event) => update({ text: event.target.value })} /></label>
          <div className="field-grid">{(["x", "y", "width", "height"] as const).map((key) => <label className="field" key={key}>{key}<input aria-label={`Note ${key}`} type="number" value={Math.round(note[key] * 100) / 100} onChange={(event) => { if (event.target.value !== "") update({ [key]: Number(event.target.value) }); }} /></label>)}</div>
          <label className="field">Color<input type="color" aria-label="Note color" value={note.backgroundColor} onChange={(event) => update({ backgroundColor: event.target.value })} /></label>
          <button className="button danger" onClick={() => { if (doc.current) run(deleteNote(doc.current, note.id), () => setSelected(null)); }}>Delete note</button>
        </> : <p>Select a note on the canvas or in this list.</p>}
      </aside>
    </div>
    <details><summary>Inspect object data ({notes.length} notes)</summary><pre data-testid="viewport-state">{JSON.stringify(viewport)}</pre><pre data-testid="note-data">{JSON.stringify(notes, null, 2)}</pre></details>
    <p className="muted">Prototype only: room data is temporary, unauthenticated and local. Plain-string text uses same-field conflict resolution; character-level coediting is not implemented.</p>
  </main>;
}
