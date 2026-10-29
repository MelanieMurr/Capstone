"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { Effect } from "effect";
import { resolveEndpoint } from "../lib/board/model";
import type { BoardDocument, BoardObject } from "../lib/board/model";
import { exportBoard, initialBoard, loadBoard, saveBoard, validateBoard } from "../lib/board/frontend";

import { connectObjects, connectorLabel, createObject, deleteObject, objectLabel, patchObject, resizeObject } from "../lib/board/operations";
import type { ResizeCorner } from "../lib/board/operations";
import { cursorToBoard } from "../lib/collaboration/presence";
import { panTo } from "../lib/board/viewport";
import BoardAIPanel from "./board-ai-panel";
import { insertAIResult } from "../lib/ai/insertion";
import type { AIOperation } from "../lib/ai/evaluation";
import type { SubmittedNote } from "../lib/ai/categorization";
import type { LiveBoard } from "../lib/collaboration/use-shared-board";
const BoardCanvas = dynamic(() => import("./board-canvas"), { ssr: false });

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

export default function Workspace({ initialDocument, identity, onDocumentChange, readOnly = false, remoteStatus, live, sharePanel }: {
  initialDocument?: BoardDocument;
  identity?: { id: string; title: string };
  onDocumentChange?: (document: BoardDocument) => void;
  readOnly?: boolean;
  remoteStatus?: string;
  live?: LiveBoard;
  sharePanel?: ReactNode;
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
  const drag = useRef<{ id: string | null; clientX: number; clientY: number; x: number; y: number; before: BoardDocument; corner?: ResizeCorner } | null>(null);
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
    if (!ready || readOnly || live) return;
    const timer = setTimeout(() => { if (onDocumentChange) onDocumentChange(board); else run(saveBoard(board), () => setStatus("Saved on this device")); }, 400);
    return () => clearTimeout(timer);
  }, [board, ready, readOnly, onDocumentChange, live]);
  useEffect(() => {
    if (live?.document && !drag.current) setBoard(live.document);
  }, [live?.document]);

  function commit(next: BoardDocument) {
    if (readOnly) return;
    run(validateBoard(next), (valid) => {
      if (live) run(live.edit(board, valid), setBoard);
      else { setPast((items) => [...items.slice(-49), board]); setFuture([]); setBoard(valid); }
    });
  }

  function confirmAIResult(
      operation: AIOperation,
      input: unknown,
      submittedNotes: SubmittedNote[],
  ) : Effect.Effect<void,  Error> {
    return Effect.gen(function* (){
      if (readOnly) {
        return yield* Effect.fail(
            new Error("Editing is unavailable. Reconnect or check your board access.",),
        );
      }

      const next = yield* insertAIResult(
          board,
          operation,
          input,
          submittedNotes,
      );

      if (live) {
        live.capture();

        const updated = yield* live.edit(board, next);

        live.capture();
        setBoard(updated);
      } else {
        setPast((items) => [...items.slice(-49), board]);
        setFuture([]);
        setBoard(next);
      }
    });
  }

  function update(patch: Record<string, unknown>) {
    if (!object) return;
    run(patchObject(board, object.id, patch), commit);
  }
  function remove() {
    if (!selected || readOnly) return;
    drag.current = null;
    run(deleteObject(board, selected), (next) => { commit(next); setSelected(null); setConnectFrom(null); });
  }
  useEffect(() => {
    setSelected((id) => board.objects.some((item) => item.id === id) ? id : null);
    setConnectFrom((id) => board.objects.some((item) => item.id === id && item.type !== "connector") ? id : null);
  }, [board]);
  function choose(item: BoardObject) {
    if (!readOnly && tool === "connector") {
      if (item.type === "connector") { setStatus("Choose a note, text element or shape to connect."); return; }
      if (!connectFrom) { setConnectFrom(item.id); setSelected(item.id); setPanel("properties"); setStatus("Select another object to connect"); return; }
      run(connectObjects(board, connectFrom, item.id), (next) => {
        commit(next); setSelected(next.objects.at(-1)!.id); setPanel("properties"); setConnectFrom(null); setTool("select"); setStatus("Connector created");
      });
      return;
    }
    setSelected(item.id); setPanel("properties");
  }
  function undo() {
    if (readOnly) return;
    if (live) { live.undo(); return; }
    const previous = past.at(-1); if (!previous) return;
    setFuture((items) => [...items, board]); setPast((items) => items.slice(0, -1)); setBoard(previous); setSelected((id) => previous.objects.some((item) => item.id === id) ? id : null);
  }
  function redo() {
    if (readOnly) return;
    if (live) { live.redo(); return; }
    const next = future.at(-1); if (!next) return;
    setPast((items) => [...items, board]); setFuture((items) => items.slice(0, -1)); setBoard(next);
  }
  function add(type: "sticky-note" | "text" | "shape", x: number, y: number) {
    if (readOnly) return;
    run(createObject(board, type, { x, y }), (created) => {
      commit({ ...board, objects: [...board.objects, created] }); setSelected(created.id); setPanel("properties"); setTool("select");
    });
  }
  function down(event: ReactPointerEvent, item?: BoardObject) {
    if ((event.target as HTMLElement).closest("input,textarea,button")) return;
    if (readOnly && item && tool !== "hand") { event.stopPropagation(); setSelected(item.id); setPanel("properties"); return; }
    if (!readOnly && item && tool === "connector") { event.stopPropagation(); choose(item); return; }
    if (item && tool !== "hand") {
      event.stopPropagation(); setSelected(item.id); setPanel("properties");
      if (item.type === "connector") return;
    } else if (tool !== "hand") {
      setSelected(null);
      const rect = area.current!.getBoundingClientRect();
      if (["sticky-note", "text", "shape"].includes(tool)) { add(tool as "sticky-note" | "text" | "shape", (event.clientX - rect.left - pan.x) / zoom, (event.clientY - rect.top - pan.y) / zoom); return; }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool !== "hand") live?.capture();
    drag.current = { id: tool === "hand" ? null : item?.id ?? null, clientX: event.clientX, clientY: event.clientY, x: tool === "hand" ? pan.x : item!.x, y: tool === "hand" ? pan.y : item!.y, before: board };
  }
  function startResize(event: ReactPointerEvent, item: BoardObject, corner: ResizeCorner) {
    event.stopPropagation(); event.preventDefault();
    if (readOnly || item.type === "connector" || tool === "hand") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    live?.capture();
    drag.current = { id: item.id, clientX: event.clientX, clientY: event.clientY, x: item.x, y: item.y, before: board, corner };
  }
  function move(event: ReactPointerEvent) {
    if (live && area.current) {
      const rect = area.current.getBoundingClientRect();
      run(cursorToBoard({ x: event.clientX - rect.left, y: event.clientY - rect.top }, pan, zoom), live.cursor);
    }
    const current = drag.current; if (!current) return;
    const dx = event.clientX - current.clientX, dy = event.clientY - current.clientY;
    if (!current.id) run(panTo({ ...pan, scale: zoom }, { x: current.x + dx, y: current.y + dy }), (value) => setPan({ x: value.x, y: value.y }));
    else if (current.corner) run(resizeObject(current.before, current.id, current.corner, { x: dx / zoom, y: dy / zoom }), setBoard);
    else run(patchObject(current.before, current.id, { x: current.x + dx / zoom, y: current.y + dy / zoom }), setBoard);
  }
  function up() {
    const current = drag.current;
    drag.current = null;
    if (current?.id) {
      if (JSON.stringify(current.before) !== JSON.stringify(board)) {
        if (live) run(live.edit(current.before, board), setBoard);
        else { setPast((items) => [...items.slice(-49), current.before]); setFuture([]); }
      } else if (live?.document) setBoard(live.document);
      live?.capture();
    } else if (live?.document) setBoard(live.document);
  }
  function cancelGesture() {
    if (drag.current?.id) setBoard(live?.document ?? drag.current.before);
    drag.current = null;
    live?.capture();
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(); }
      else if (event.key === "Escape") { cancelGesture(); setSelected(null); setConnectFrom(null); setTool("select"); setDialog(false); }
      else { const found = tools.find((entry) => entry.key.toLowerCase() === event.key); if (found && (!readOnly || found.id === "select" || found.id === "hand")) { setTool(found.id); setConnectFrom(null); } }
    }
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });

  return <main className="workspace">
    <header className="topbar">
      <div className="brand"><span className="logo">c<span>•</span></span><h1>CoCanvas</h1></div>
      <span className="header-divider" />
      <div className="board-title"><strong>{identity?.title ?? "First things first"}</strong><span>Personal workspace <span className="private">· Private board</span></span></div>
      <div className="header-actions">{live && <div className="collaborators" role="list" aria-label="Active collaborators">
        {live.collaborators.map((person) => <span role="listitem" className="collaborator-avatar" key={person.id} title={person.name} aria-label={person.name} style={{ background: person.color }}>{person.name.slice(0, 1).toUpperCase()}</span>)}
        <span className="collaborator-count">{live.connected ? live.collaborators.length + 1 : 0} online</span>
      </div>}<a className="local-status" href="/dashboard">My boards ↗</a><a className="avatar" aria-label="Your account and boards" href="/dashboard">M</a><button className="button" onClick={() => run(exportBoard(board), () => setStatus("Board exported"))}>↗ <span>Export</span></button><button className="button primary" onClick={() => setDialog(true)}>Share board</button></div>
    </header>
    <aside className="sidebar">
      <div className="workspace-label">YOUR WORKSPACE</div>
      <button className="nav-item active" onClick={() => { setPan({ x: 35, y: 25 }); setZoom(0.85); }}>▦ <span>{identity?.title ?? "First things first"}</span><span className="small">↗</span></button>
      <div className="sidebar-section"><div className="section-title">ON THIS BOARD <span>{board.objects.length}</span></div><input aria-label="Search objects" className="search" placeholder="⌕  Find an idea…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="object-list">{board.objects.filter((item) => `${JSON.stringify(item)} ${item.type === "connector" ? connectorLabel(item, board.objects) : ""}`.toLowerCase().includes(search.toLowerCase())).map((item) => <button key={item.id} className={`object-row ${selected === item.id ? "chosen" : ""}`} onClick={() => { setSelected(item.id); setPanel("properties"); const start = item.type === "connector" ? resolveEndpoint(item.start, board.objects) : null;
          const end = item.type === "connector" ? resolveEndpoint(item.end, board.objects) : null;
          const point = start && end ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : item;
          setPan({ x: 80 - point.x * zoom, y: 90 - point.y * zoom }); }}><span className="object-dot" style={{ background: item.type === "sticky-note" ? item.backgroundColor : "#e8ece9" }}>{item.type === "text" ? "T" : ""}</span><span>{item.type === "sticky-note" ? item.text.split("\n")[0] || "Untitled note" : item.type === "text" ? item.content.split("\n")[0] : item.type === "shape" ? item.text.split("\n")[0] || "Untitled shape" : connectorLabel(item, board.objects)}</span></button>)}</div>
      </div>
      <div className="sidebar-bottom"><div className="tip-icon">✦</div><strong>A little room for possibility</strong><p>Start with a thought.<br />Make something of it.</p><button className="text-button" onClick={() => setPanel("ai")}>Explore your ideas <span>→</span></button></div>
      <div className="sidebar-footer"><span className="avatar tiny">M</span><div>My workspace<small>{identity ? readOnly ? "View-only access" : "Cloud saved" : "Local mode"}</small></div></div>
    </aside>
    <section className="canvas-area" ref={area} aria-label="Board canvas" onPointerDown={(event) => down(event)} onPointerMove={move} onPointerLeave={() => live?.cursor(null)} onPointerUp={up} onPointerCancel={cancelGesture} style={{ cursor: tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair" }}>
      <div className="canvas-breadcrumb">WORKSPACE <span>/</span> <strong>{identity?.title ?? "First things first"}</strong></div>
      <BoardCanvas board={board} pan={pan} zoom={zoom} selected={selected} onError={setStatus} />
      {live && <div className="collaborator-cursors" aria-label="Collaborator cursors">{live.collaborators.filter((person) => person.cursor).map((person) => <div key={person.id}
        className="collaborator-cursor" data-testid="collaborator-cursor" data-peer-id={person.id} aria-label={`${person.name}'s cursor`}
        style={{ left: pan.x + person.cursor!.x * zoom, top: pan.y + person.cursor!.y * zoom, color: person.color }}>
        <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M1 1L16 13L9 14L6 21Z" fill="currentColor" stroke="white" strokeWidth="1.5" /></svg>
        <span style={{ background: person.color }}>{person.name}</span>
      </div>)}</div>}
      <div className="canvas-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="connections" width="1" height="1" overflow="visible" aria-label="Board connectors">{board.objects.filter((item) => item.type === "connector").map((item) => {
          const start = resolveEndpoint(item.start, board.objects), end = resolveEndpoint(item.end, board.objects); if (!start || !end) return null;
          return <g key={item.id} role="button" tabIndex={0} data-object-id={item.id} aria-label={connectorLabel(item, board.objects)} aria-pressed={selected === item.id}
            onPointerDown={(event) => down(event, item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(item); } }}>
            <path d={`M${start.x},${start.y} L${end.x},${end.y}`} stroke="transparent" strokeWidth={Math.max(item.strokeWidth, 16 / zoom)} pointerEvents="stroke" />
          </g>;
        })}</svg>
        {[...board.objects].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)).filter((item) => item.type !== "connector").map((item) => <div key={item.id} role="button" tabIndex={0} data-object-id={item.id} aria-label={objectLabel(item)} aria-pressed={selected === item.id} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(item); } }} onPointerDown={(event) => down(event, item)} className={`canvas-object ${item.type} ${selected === item.id || connectFrom === item.id ? "selected" : ""}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height, transform: `rotate(${item.rotation}deg)`, zIndex: item.zIndex + 1, background: item.type === "sticky-note" ? item.backgroundColor : item.type === "shape" ? item.fill : "transparent", color: item.type === "text" ? item.textColor : undefined, fontSize: item.type === "text" ? item.fontSize : undefined, border: item.type === "shape" ? `${item.borderWidth}px solid ${item.borderColor}` : undefined, borderRadius: item.type === "shape" && item.shapeType === "ellipse" ? "50%" : undefined }}>
          {selected === item.id && !readOnly && tool === "select" && (["top-left", "bottom-right"] as const).map((corner) => <button key={corner} className={`handle ${corner}`} aria-label={`Resize ${corner}`} title="Drag to resize, or use arrow keys" onPointerDown={(event) => startResize(event, item, corner)} onKeyDown={(event) => {
            const delta = { ArrowLeft: { x: -10, y: 0 }, ArrowRight: { x: 10, y: 0 }, ArrowUp: { x: 0, y: -10 }, ArrowDown: { x: 0, y: 10 } }[event.key];
            if (delta) { event.preventDefault(); event.stopPropagation(); run(resizeObject(board, item.id, corner, delta), commit); }
          }} />)}
        </div>)}
      </div>
      <div className="canvas-hint">{tool === "connector" ? "Click two objects to connect them" : tool === "hand" ? "Drag anywhere to explore your board" : tool === "select" ? "Select an object to make it yours" : "Click anywhere to add your idea"}</div>
      <div className="toolbar" onPointerDown={(event) => event.stopPropagation()}>{tools.map((entry) => <button key={entry.id} className={tool === entry.id ? "tool active" : "tool"} disabled={readOnly && entry.id !== "select" && entry.id !== "hand"} aria-label={entry.name} aria-pressed={tool === entry.id} title={`${entry.name} (${entry.key})`} onClick={() => { setTool(entry.id); setConnectFrom(null); }}><span>{entry.icon}</span><small>{entry.key}</small></button>)}<span className="toolbar-divider" /><button className="tool" aria-label="Undo" disabled={readOnly || (live ? !live.canUndo : !past.length)} onClick={undo}>↶</button><button className="tool" aria-label="Redo" disabled={readOnly || (live ? !live.canRedo : !future.length)} onClick={redo}>↷</button></div>
      <div className="zoom-controls" onPointerDown={(event) => event.stopPropagation()}><button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.25, value - 0.1))}>−</button><button aria-label="Reset zoom" onClick={() => { setZoom(0.85); setPan({ x: 35, y: 25 }); }}>{Math.round(zoom * 100)}%</button><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, value + 0.1))}>+</button></div>
    </section>
    <aside className="inspector"><fieldset className="readonly-fields" disabled={readOnly}><div className="panel-tabs"><button className={panel === "properties" ? "active" : ""} onClick={() => setPanel("properties")}>Design</button><button className={panel === "ai" ? "active" : ""} onClick={() => setPanel("ai")}>✦ Assistant</button></div>
      {panel === "ai" ? (
          <BoardAIPanel
              board={board}
              onConfirmResult={confirmAIResult}
          />
      ) : object ? <div className="panel-content"><span className="eyebrow">SELECTED OBJECT</span><h2>{object.type === "sticky-note" ? "Sticky note" : object.type === "text" ? "Text" : object.type === "shape" ? "Shape" : "Connector"}</h2>
        {(object.type === "sticky-note" || object.type === "text" || object.type === "shape") && <label className="field">Content<textarea aria-label="Object content" value={object.type === "text" ? object.content : object.text} onChange={(event) => update({ [object.type === "text" ? "content" : "text"]: event.target.value })} /></label>}
        {object.type !== "connector" && <div className="field-grid">{(["x", "y", "width", "height", "rotation", "zIndex"] as const).map((key) => <label className="field" key={key}>{key}<input type="number" aria-label={key} value={object[key]} onChange={(event) => { if (event.target.value !== "") update({ [key]: Number(event.target.value) }); }} /></label>)}</div>}
        {(object.type === "sticky-note" || object.type === "shape") && <><label className="field">{object.type === "sticky-note" ? "Note color" : "Fill"}</label><div className="swatches">{colors.map((color) => <button key={color} aria-label={`Set color ${color}`} className={(object.type === "sticky-note" ? object.backgroundColor : object.fill) === color ? "picked" : ""} style={{ background: color }} onClick={() => update({ [object.type === "sticky-note" ? "backgroundColor" : "fill"]: color })} />)}</div></>}
        {object.type === "shape" && <><label className="field">Shape type<select aria-label="Shape type" value={object.shapeType} onChange={(event) => update({ shapeType: event.target.value })}><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option></select></label><label className="field">Border width<input aria-label="Border width" type="number" min={0} max={32} value={object.borderWidth} onChange={(event) => update({ borderWidth: Number(event.target.value) })} /></label><label className="field">Border color<input type="color" value={object.borderColor} onChange={(event) => update({ borderColor: event.target.value })} /></label></>}
        {(object.type === "text" || object.type === "shape") && <><label className="field">Font size<input aria-label="Font size" type="number" value={object.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label><label className="field">Text color<input type="color" value={object.textColor} onChange={(event) => update({ textColor: event.target.value })} /></label></>}
        {object.type === "connector" && <><p>{connectorLabel(object, board.objects)}</p><label className="field">Line color<input aria-label="Line color" type="color" value={object.strokeColor} onChange={(event) => update({ strokeColor: event.target.value })} /></label><label className="field">Line width<input aria-label="Line width" type="number" min={0.1} max={32} step={0.5} value={object.strokeWidth} onChange={(event) => update({ strokeWidth: Number(event.target.value) })} /></label><label className="field">Arrow style<select aria-label="Arrow style" value={object.arrowStyle} onChange={(event) => update({ arrowStyle: event.target.value })}><option value="none">No arrows</option><option value="end">End arrow</option><option value="both">Both ends</option></select></label></>}
        <button className="button danger" onClick={remove}>Delete object</button>
      </div> : <div className="panel-content empty-inspector"><div className="selection-illustration"><span /><span /><i>↖</i></div><h2>A space for<br />your next big idea.</h2><p>Select anything on your board to edit its details.</p><div className="quick-start"><span className="eyebrow">MAKE YOUR FIRST MOVE</span><button onClick={() => { setTool("sticky-note"); }}>▧ Add a sticky note <span>N</span></button><button onClick={() => setTool("text")}>T Write something <span>T</span></button><button onClick={() => setTool("shape")}>□ Give it some shape <span>S</span></button></div><div className="quiet-note">A blank canvas.<br />Endless possibilities.</div></div>}</fieldset>
    </aside>
    <footer className="statusbar"><span role="status"><i />{[remoteStatus, status].filter(Boolean).join(" · ")}</span><span>{board.objects.length} objects <span className="footer-dot">·</span> Made for thinking together</span></footer>
    {dialog && <div className="modal-backdrop" onClick={() => setDialog(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close sharing dialog" autoFocus onClick={() => setDialog(false)}>×</button><span className="eyebrow">THINKING TOGETHER</span><h2 id="share-title">Your ideas deserve company.</h2><p>{identity ? "Share this board with someone who already has a CoCanvas account." : "This demo is saved on this device. Sign in through My boards to create private cloud-saved boards."}</p>{sharePanel}<button className="button" onClick={() => run(exportBoard(board), () => { setStatus("Board exported"); setDialog(false); })}>Export a board copy</button></section></div>}
  </main>;
}
