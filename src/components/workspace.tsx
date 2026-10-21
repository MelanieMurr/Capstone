"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Effect } from "effect";
import { boardObjectSchema, resolveEndpoint } from "../lib/board/model";
import type { BoardDocument, BoardObject } from "../lib/board/model";
import { exportBoard, initialBoard, loadBoard, saveBoard, validateBoard } from "../lib/board/frontend";

type Tool = "select" | "hand" | "sticky-note" | "text" | "shape" | "connector";
const tools: { id: Tool; icon: string; name: string; key: string }[] = [
  { id: "select", icon: "↖", name: "Select", key: "V" },
  { id: "hand", icon: "✋", name: "Pan", key: "H" },
  { id: "sticky-note", icon: "▧", name: "Sticky note", key: "N" },
  { id: "text", icon: "T", name: "Text", key: "T" },
  { id: "shape", icon: "□", name: "Shape", key: "S" },
  { id: "connector", icon: "↗", name: "Connector", key: "C" },
];
const colors = ["#fff0b5", "#d9ede5", "#eadff3", "#f7d6c7", "#d5e7f5", "#ffffff"];

export default function Workspace({ initialDocument, identity, onDocumentChange, readOnly = false, remoteStatus }: {
  initialDocument?: BoardDocument;
  identity?: { id: string; title: string };
  onDocumentChange?: (document: BoardDocument) => void;
  readOnly?: boolean;
  remoteStatus?: string;
} = {}) {
  const [board, setBoard] = useState<BoardDocument>(initialDocument ?? initialBoard);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 35, y: 25 });
  const [past, setPast] = useState<BoardDocument[]>([]);
  const [future, setFuture] = useState<BoardDocument[]>([]);
  const [status, setStatus] = useState(identity ? "" : "Saved on this device");
  const [panel, setPanel] = useState<"properties" | "ai">("properties");
  const [dialog, setDialog] = useState(false);
  const [search, setSearch] = useState("");
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string | null; clientX: number; clientY: number; x: number; y: number; before: BoardDocument } | null>(null);
  const object = board.objects.find((item) => item.id === selected);
  const run = <A,>(program: Effect.Effect<A, Error>, success: (value: A) => void) => {
    Effect.runSync(Effect.match(program, { onFailure: (error) => setStatus(error.message), onSuccess: success }));
  };
  useEffect(() => {
    if (initialDocument) { setReady(true); return; }
    run(loadBoard(), (saved) => { if (saved) setBoard(saved); });
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready || readOnly) return;
    const timer = setTimeout(() => { if (onDocumentChange) onDocumentChange(board); else run(saveBoard(board), () => setStatus("Saved on this device")); }, 400);
    return () => clearTimeout(timer);
  }, [board, ready, readOnly, onDocumentChange]);

  function commit(next: BoardDocument) {
    if (readOnly) return;
    run(validateBoard(next), (valid) => {
      setPast((items) => [...items.slice(-49), board]); setFuture([]); setBoard(valid);
    });
  }
  function update(patch: Record<string, unknown>) {
    if (!object) return;
    commit({ ...board, objects: board.objects.map((item) => item.id === object.id ? { ...item, ...patch } as BoardObject : item) });
  }
  function remove() {
    if (!selected || readOnly) return;
    commit({ ...board, objects: board.objects.filter((item) => item.id !== selected && !(item.type === "connector" && [item.start, item.end].some((end) => end.kind === "attached" && end.objectId === selected))) });
    setSelected(null);
  }
  function undo() {
    if (readOnly) return;
    const previous = past.at(-1); if (!previous) return;
    setFuture((items) => [...items, board]); setPast((items) => items.slice(0, -1)); setBoard(previous); setSelected(null);
  }
  function redo() {
    if (readOnly) return;
    const next = future.at(-1); if (!next) return;
    setPast((items) => [...items, board]); setFuture((items) => items.slice(0, -1)); setBoard(next);
  }
  function add(type: "sticky-note" | "text" | "shape", x: number, y: number) {
    if (readOnly) return;
    run(Effect.try({ try: () => boardObjectSchema.parse({ id: crypto.randomUUID(), type, x, y, zIndex: Math.max(0, ...board.objects.map((item) => item.zIndex)) + 1, ...(type === "sticky-note" ? { text: "Your next great idea", backgroundColor: "#fff0b5" } : type === "text" ? { content: "Add your text", height: 60 } : {}) }), catch: () => new Error("Could not create this object.") }), (created) => {
      commit({ ...board, objects: [...board.objects, created] }); setSelected(created.id); setTool("select");
    });
  }
  function down(event: ReactPointerEvent, item?: BoardObject) {
    if ((event.target as HTMLElement).closest("input,textarea,button")) return;
    if (readOnly && item && tool !== "hand") { event.stopPropagation(); setSelected(item.id); return; }
    if (item && tool === "connector") {
      event.stopPropagation();
      if (item.type === "connector") return;
      if (!connectFrom) { setConnectFrom(item.id); setStatus("Select another object to connect"); return; }
      if (connectFrom === item.id) return;
      const connector = boardObjectSchema.parse({ id: crypto.randomUUID(), type: "connector", start: { kind: "attached", objectId: connectFrom, anchorX: 1, anchorY: 0.5 }, end: { kind: "attached", objectId: item.id, anchorX: 0, anchorY: 0.5 } });
      commit({ ...board, objects: [...board.objects, connector] }); setConnectFrom(null); setTool("select"); return;
    }
    if (item && tool !== "hand") {
      event.stopPropagation(); setSelected(item.id);
      if (item.type === "connector") return;
    } else if (tool !== "hand") {
      setSelected(null);
      const rect = area.current!.getBoundingClientRect();
      if (["sticky-note", "text", "shape"].includes(tool)) { add(tool as "sticky-note" | "text" | "shape", (event.clientX - rect.left - pan.x) / zoom, (event.clientY - rect.top - pan.y) / zoom); return; }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: tool === "hand" ? null : item?.id ?? null, clientX: event.clientX, clientY: event.clientY, x: tool === "hand" ? pan.x : item!.x, y: tool === "hand" ? pan.y : item!.y, before: board };
  }
  function move(event: ReactPointerEvent) {
    const current = drag.current; if (!current) return;
    const dx = event.clientX - current.clientX, dy = event.clientY - current.clientY;
    if (!current.id) setPan({ x: current.x + dx, y: current.y + dy });
    else setBoard((value) => ({ ...value, objects: value.objects.map((item) => item.id === current.id ? { ...item, x: current.x + dx / zoom, y: current.y + dy / zoom } : item) }));
  }
  function up() {
    const before = drag.current?.before;
    if (drag.current?.id && before && before !== board) { setPast((items) => [...items.slice(-49), before]); setFuture([]); }
    drag.current = null;
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest("input,textarea,[contenteditable]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(); }
      else if (event.key === "Escape") { setSelected(null); setConnectFrom(null); setTool("select"); setDialog(false); }
      else { const found = tools.find((entry) => entry.key.toLowerCase() === event.key); if (found) { setTool(found.id); setConnectFrom(null); } }
    }
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });

  return <main className="workspace">
    <header className="topbar">
      <div className="brand"><span className="logo">c<span>•</span></span><h1>CoCanvas</h1></div>
      <span className="header-divider" />
      <div className="board-title"><strong>{identity?.title ?? "First things first"}</strong><span>Personal workspace <span className="private">· Private board</span></span></div>
      <div className="header-actions"><a className="local-status" href="/dashboard">My boards ↗</a><a className="avatar" aria-label="Your account and boards" href="/dashboard">M</a><button className="button" onClick={() => run(exportBoard(board), () => setStatus("Board exported"))}>↗ <span>Export</span></button><button className="button primary" onClick={() => setDialog(true)}>Share board</button></div>
    </header>
    <aside className="sidebar">
      <div className="workspace-label">YOUR WORKSPACE</div>
      <button className="nav-item active" onClick={() => { setPan({ x: 35, y: 25 }); setZoom(0.85); }}>▦ <span>{identity?.title ?? "First things first"}</span><span className="small">↗</span></button>
      <div className="sidebar-section"><div className="section-title">ON THIS BOARD <span>{board.objects.length}</span></div><input aria-label="Search objects" className="search" placeholder="⌕  Find an idea…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="object-list">{board.objects.filter((item) => item.type !== "connector" && item.type !== "shape").filter((item) => JSON.stringify(item).toLowerCase().includes(search.toLowerCase())).map((item) => <button key={item.id} className={`object-row ${selected === item.id ? "chosen" : ""}`} onClick={() => { setSelected(item.id); setPanel("properties"); setPan({ x: 80 - item.x * zoom, y: 90 - item.y * zoom }); }}><span className="object-dot" style={{ background: item.type === "sticky-note" ? item.backgroundColor : "#e8ece9" }}>{item.type === "text" ? "T" : ""}</span><span>{item.type === "sticky-note" ? item.text.split("\n")[0] || "Untitled note" : item.type === "text" ? item.content.split("\n")[0] : "Object"}</span></button>)}</div>
      </div>
      <div className="sidebar-bottom"><div className="tip-icon">✦</div><strong>A little room for possibility</strong><p>Start with a thought.<br />Make something of it.</p><button className="text-button" onClick={() => setPanel("ai")}>Explore your ideas <span>→</span></button></div>
      <div className="sidebar-footer"><span className="avatar tiny">M</span><div>My workspace<small>{identity ? readOnly ? "View-only access" : "Cloud saved" : "Local mode"}</small></div></div>
    </aside>
    <section className="canvas-area" ref={area} aria-label="Board canvas" onPointerDown={(event) => down(event)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ cursor: tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair" }}>
      <div className="canvas-breadcrumb">WORKSPACE <span>/</span> <strong>{identity?.title ?? "First things first"}</strong></div>
      <div className="canvas-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="connections" width="1" height="1" overflow="visible"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8" fill="none" stroke="context-stroke" /></marker></defs>{board.objects.filter((item) => item.type === "connector").map((item) => {
          const start = resolveEndpoint(item.start, board.objects), end = resolveEndpoint(item.end, board.objects); if (!start || !end) return null;
          return <g key={item.id} onPointerDown={(event) => down(event, item)}><path d={`M${start.x},${start.y} L${end.x},${end.y}`} stroke="transparent" strokeWidth="16" pointerEvents="stroke" /><path d={`M${start.x},${start.y} L${end.x},${end.y}`} stroke={selected === item.id ? "#277d67" : item.strokeColor} strokeWidth={item.strokeWidth} markerEnd={item.arrowStyle !== "none" ? "url(#arrow)" : undefined} markerStart={item.arrowStyle === "both" ? "url(#arrow)" : undefined} /></g>;
        })}</svg>
        {[...board.objects].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)).filter((item) => item.type !== "connector").map((item) => <div key={item.id} role="button" tabIndex={0} aria-label={`${item.type}: ${item.type === "sticky-note" ? item.text : item.type === "text" ? item.content : item.shapeType}`} onKeyDown={(event) => { if (event.key === "Enter") setSelected(item.id); }} onPointerDown={(event) => down(event, item)} className={`canvas-object ${item.type} ${selected === item.id || connectFrom === item.id ? "selected" : ""}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height, transform: `rotate(${item.rotation}deg)`, zIndex: item.zIndex + 1, background: item.type === "sticky-note" ? item.backgroundColor : item.type === "shape" ? item.fill : "transparent", color: item.type === "text" ? item.textColor : undefined, fontSize: item.type === "text" ? item.fontSize : undefined, border: item.type === "shape" ? `${item.borderWidth}px solid ${item.borderColor}` : undefined, borderRadius: item.type === "shape" && item.shapeType === "ellipse" ? "50%" : undefined }}>
          {item.type === "sticky-note" ? <><span className="note-pin" />{item.text}</> : item.type === "text" ? item.content : null}
          {selected === item.id && <><i className="handle top-left" /><i className="handle bottom-right" /></>}
        </div>)}
      </div>
      <div className="canvas-hint">{tool === "connector" ? "Click two objects to connect them" : tool === "hand" ? "Drag anywhere to explore your board" : tool === "select" ? "Select an object to make it yours" : "Click anywhere to add your idea"}</div>
      <div className="toolbar" onPointerDown={(event) => event.stopPropagation()}>{tools.map((entry) => <button key={entry.id} className={tool === entry.id ? "tool active" : "tool"} disabled={readOnly && entry.id !== "select" && entry.id !== "hand"} aria-label={entry.name} aria-pressed={tool === entry.id} title={`${entry.name} (${entry.key})`} onClick={() => { setTool(entry.id); setConnectFrom(null); }}><span>{entry.icon}</span><small>{entry.key}</small></button>)}<span className="toolbar-divider" /><button className="tool" aria-label="Undo" disabled={readOnly || !past.length} onClick={undo}>↶</button><button className="tool" aria-label="Redo" disabled={readOnly || !future.length} onClick={redo}>↷</button></div>
      <div className="zoom-controls" onPointerDown={(event) => event.stopPropagation()}><button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.25, value - 0.1))}>−</button><button aria-label="Reset zoom" onClick={() => { setZoom(0.85); setPan({ x: 35, y: 25 }); }}>{Math.round(zoom * 100)}%</button><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, value + 0.1))}>+</button></div>
    </section>
    <aside className="inspector"><fieldset className="readonly-fields" disabled={readOnly}><div className="panel-tabs"><button className={panel === "properties" ? "active" : ""} onClick={() => setPanel("properties")}>Design</button><button className={panel === "ai" ? "active" : ""} onClick={() => setPanel("ai")}>✦ Assistant</button></div>
      {panel === "ai" ? <div className="panel-content"><span className="eyebrow">A FRESH PERSPECTIVE</span><h2>From ideas<br />to a little clarity.</h2><p>Summarize a brainstorm, spot themes, or find your next step.</p><div className="coming-soon">AI connection pending</div><p className="muted">Your assistant will be available once the AI service is connected. For now, keep exploring on your canvas.</p></div> : object ? <div className="panel-content"><span className="eyebrow">SELECTED OBJECT</span><h2>{object.type === "sticky-note" ? "Sticky note" : object.type === "text" ? "Text" : object.type === "shape" ? "Shape" : "Connector"}</h2>
        {(object.type === "sticky-note" || object.type === "text") && <label className="field">Content<textarea aria-label="Object content" value={object.type === "sticky-note" ? object.text : object.content} onChange={(event) => update({ [object.type === "sticky-note" ? "text" : "content"]: event.target.value })} /></label>}
        {object.type !== "connector" && <div className="field-grid">{(["x", "y", "width", "height", "rotation", "zIndex"] as const).map((key) => <label className="field" key={key}>{key}<input type="number" aria-label={key} value={object[key]} onChange={(event) => { if (event.target.value !== "") update({ [key]: Number(event.target.value) }); }} /></label>)}</div>}
        {(object.type === "sticky-note" || object.type === "shape") && <><label className="field">{object.type === "sticky-note" ? "Note color" : "Fill"}</label><div className="swatches">{colors.map((color) => <button key={color} aria-label={`Set color ${color}`} className={(object.type === "sticky-note" ? object.backgroundColor : object.fill) === color ? "picked" : ""} style={{ background: color }} onClick={() => update({ [object.type === "sticky-note" ? "backgroundColor" : "fill"]: color })} />)}</div></>}
        {object.type === "shape" && <><label className="field">Shape<select value={object.shapeType} onChange={(event) => update({ shapeType: event.target.value })}><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option></select></label><label className="field">Border color<input type="color" value={object.borderColor} onChange={(event) => update({ borderColor: event.target.value })} /></label></>}
        {object.type === "text" && <><label className="field">Font size<input aria-label="Font size" type="number" value={object.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label><label className="field">Text color<input type="color" value={object.textColor} onChange={(event) => update({ textColor: event.target.value })} /></label></>}
        {object.type === "connector" && <label className="field">Arrow style<select value={object.arrowStyle} onChange={(event) => update({ arrowStyle: event.target.value })}><option value="none">No arrows</option><option value="end">End arrow</option><option value="both">Both ends</option></select></label>}
        <button className="button danger" onClick={remove}>Delete object</button>
      </div> : <div className="panel-content empty-inspector"><div className="selection-illustration"><span /><span /><i>↖</i></div><h2>A space for<br />your next big idea.</h2><p>Select anything on your board to edit its details.</p><div className="quick-start"><span className="eyebrow">MAKE YOUR FIRST MOVE</span><button onClick={() => { setTool("sticky-note"); }}>▧ Add a sticky note <span>N</span></button><button onClick={() => setTool("text")}>T Write something <span>T</span></button><button onClick={() => setTool("shape")}>□ Give it some shape <span>S</span></button></div><div className="quiet-note">A blank canvas.<br />Endless possibilities.</div></div>}</fieldset>
    </aside>
    <footer className="statusbar"><span role="status"><i />{[remoteStatus, status].filter(Boolean).join(" · ")}</span><span>{board.objects.length} objects <span className="footer-dot">·</span> Made for thinking together</span></footer>
    {dialog && <div className="modal-backdrop" onClick={() => setDialog(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close sharing dialog" autoFocus onClick={() => setDialog(false)}>×</button><span className="eyebrow">THINKING TOGETHER</span><h2 id="share-title">Your ideas deserve company.</h2><p>{identity ? "This board is saved to your account. Invitation management and live collaboration will be connected in a later milestone." : "This demo is saved on this device. Sign in through My boards to create private cloud-saved boards."}</p><button className="button primary" onClick={() => run(exportBoard(board), () => { setStatus("Board exported"); setDialog(false); })}>Export a board copy</button></section></div>}
  </main>;
}
