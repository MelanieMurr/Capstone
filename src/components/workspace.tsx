"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { Effect } from "effect";
import { resolveEndpoint } from "../lib/board/model";
import type { BoardDocument, BoardObject } from "../lib/board/model";
import { exportBoard, initialBoard, loadBoard, saveBoard, validateBoard } from "../lib/board/frontend";

import { connectObjects, connectorLabel, createObject, objectLabel, patchObject, resizeObject } from "../lib/board/operations";
import type { ResizeCorner } from "../lib/board/operations";
import { cursorToBoard } from "../lib/collaboration/presence";
import { panTo, wheelViewport, zoomAt } from "../lib/board/viewport";
import type { Point } from "../lib/board/viewport";
import { deleteSelection, encodeSelection, isCanvasClipboard, moveSelection, pasteSelection, selectInRect } from "../lib/board/interaction";
import NoteComments, { useNoteComments } from "./note-comments";
import BoardAIPanel from "./board-ai-panel";
import { stickers, stickerAsset } from "../lib/board/stickers";
import { accountInitial } from "../lib/foundation/identity";
import { insertAIResult } from "../lib/ai/insertion";
import type { AIOperation } from "../lib/ai/evaluation";
import type { SubmittedNote } from "../lib/ai/categorization";
import type { LiveBoard } from "../lib/collaboration/use-shared-board";
const BoardCanvas = dynamic(() => import("./board-canvas"), { ssr: false });

type Tool = "select" | "hand" | "sticky-note" | "text" | "shape" | "connector" | "sticker";
const tools: { id: Tool; icon: string; name: string; key: string }[] = [
  { id: "select", icon: "↖", name: "Select", key: "V" },
  { id: "hand", icon: "✋", name: "Pan", key: "H" },
  { id: "sticky-note", icon: "▧", name: "Sticky note", key: "N" },
  { id: "text", icon: "T", name: "Text", key: "T" },
  { id: "shape", icon: "□", name: "Shape", key: "S" },
  { id: "sticker", icon: "☺", name: "Stickers", key: "K" },
  { id: "connector", icon: "↗", name: "Connector", key: "C" },
];
const colors = ["#fff0b5", "#d9ede5", "#eadff3", "#f7d6c7", "#d5e7f5", "#ffffff"];

export default function Workspace({ initialDocument, identity, onDocumentChange, readOnly = false, remoteStatus, live, sharePanel, account }: {
  account?: { displayName: string; email: string } | undefined;
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{ start: Point; end: Point } | null>(null);
  const selectionGesture = useRef<{ pointerId: number; start: Point; base: string[] } | null>(null);
  const selected = selectedIds.length === 1 ? selectedIds[0] : null;
  const setSelected = (id: string | null) => setSelectedIds(id ? [id] : []);
  const selectedSet = new Set(selectedIds);
  const [tool, setTool] = useState<Tool>("select");
  const [viewport, setViewport] = useState({ x: 35, y: 25, scale: 0.85 });
  const pan = viewport, zoom = viewport.scale;
  const setPan = (point: Point) => setViewport((previous) => ({ ...previous, ...point }));
  const setZoom = (scale: number | ((previous: number) => number)) =>
    setViewport((previous) => ({ ...previous, scale: typeof scale === "function" ? scale(previous.scale) : scale }));
  const [past, setPast] = useState<BoardDocument[]>([]);
  const [future, setFuture] = useState<BoardDocument[]>([]);
  const [status, setStatus] = useState(identity ? "" : "Saved on this device");
  const [panel, setPanel] = useState<"properties" | "ai" | "comments">("properties");
  const [dialog, setDialog] = useState(false);
  const [search, setSearch] = useState("");
  const [stickerId, setStickerId] = useState("celebrate");
  const [stickerSearch, setStickerSearch] = useState("");
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string | null; clientX: number; clientY: number; x: number; y: number; before: BoardDocument; pointerId: number; ids?: string[]; corner?: ResizeCorner } | null>(null);
  const clipboard = useRef<string | null>(null);
  const pasteLatest = useRef<(text: string) => void>(() => {});
  const object = board.objects.find((item) => item.id === selected);
  const comments = useNoteComments(identity?.id, object?.type === "sticky-note" ? object.id : undefined);
  const run = <A,>(program: Effect.Effect<A, Error>, success: (value: A) => void, recover?: () => void) => {
    Effect.runSync(Effect.match(program, { onFailure: (error) => { setStatus(error.message); recover?.(); }, onSuccess: success }));
  };
  useEffect(() => {
    if (initialDocument) { setReady(true); return; }
    run(loadBoard(), (saved) => { if (saved) setBoard(saved); });
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready || readOnly || live) return;
    const timer = setTimeout(() => { if (drag.current?.id) return; if (onDocumentChange) onDocumentChange(board); else run(saveBoard(board), () => setStatus("Saved on this device")); }, 400);
    return () => clearTimeout(timer);
  }, [board, ready, readOnly, onDocumentChange, live]);
  useEffect(() => {
    if (live?.document && !drag.current) setBoard(live.document);
  }, [live?.document]);

  function commit(next: BoardDocument, success?: () => void, isolated = false) {
    if (readOnly) return;
    run(validateBoard(next), (valid) => {
      if (live) {
        if (isolated) live.capture();
        run(live.edit(board, valid), (updated) => { setBoard(updated); success?.(); });
        if (isolated) live.capture();
      } else { setPast((items) => [...items.slice(-49), board]); setFuture([]); setBoard(valid); success?.(); }
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
    if (!selectedIds.length || readOnly || drag.current || selectionGesture.current) return;
    run(deleteSelection(board, selectedIds), (next) => commit(next, () => { setSelected(null); setConnectFrom(null); }, true));
  }
  useEffect(() => {
    const ids = new Set(board.objects.map((item) => item.id));
    setSelectedIds((previous) => {
      const remaining = previous.filter((id) => ids.has(id));
      return remaining.length === previous.length ? previous : remaining;
    });
    setConnectFrom((id) => board.objects.some((item) => item.id === id && item.type !== "connector") ? id : null);
  }, [board]);
  function copyObjects() {
    run(encodeSelection(board, selectedIds), (text) => {
      clipboard.current = text;
      void Effect.runPromise(Effect.match(Effect.tryPromise(() => navigator.clipboard.writeText(text)), {
        onSuccess: () => setStatus("Objects copied"),
        onFailure: () => setStatus("System clipboard unavailable. Use Paste on this board to paste your copied objects."),
      }));
    });
  }
  function pasteObjects(text: string) {
    if (readOnly || drag.current || selectionGesture.current || dialog) return;
    const bounds = area.current?.getBoundingClientRect();
    const target = { x: ((bounds?.width ?? 120) * 0.2 - pan.x) / zoom, y: ((bounds?.height ?? 120) * 0.2 - pan.y) / zoom };
    run(pasteSelection(board, text, target), (result) => commit(result.board, () => {
      setSelectedIds(result.ids); setConnectFrom(null); setTool("select"); setPanel("properties"); setStatus("Objects pasted");
    }, true));
  }
  useLayoutEffect(() => {
    pasteLatest.current = pasteObjects;
    return () => { pasteLatest.current = () => {}; };
  });
  function readClipboard() {
    if (readOnly) return;
    void Effect.runPromise(Effect.match(Effect.tryPromise(() => navigator.clipboard.readText()), {
      onSuccess: (text) => pasteLatest.current(text),
      onFailure: () => { if (clipboard.current) pasteLatest.current(clipboard.current); else setStatus("Clipboard unavailable. Try the system Paste shortcut or copy objects on this board first."); },
    }));
  }
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
    if (readOnly || drag.current || selectionGesture.current) return;
    if (live) { live.undo(); return; }
    const previous = past.at(-1); if (!previous) return;
    setFuture((items) => [...items, board]); setPast((items) => items.slice(0, -1)); setBoard(previous);
  }
  function redo() {
    if (readOnly || drag.current || selectionGesture.current) return;
    if (live) { live.redo(); return; }
    const next = future.at(-1); if (!next) return;
    setPast((items) => [...items, board]); setFuture((items) => items.slice(0, -1)); setBoard(next);
  }
  function add(type: "sticky-note" | "text" | "shape" | "sticker", x: number, y: number) {
    if (readOnly) return;
    run(createObject(board, type, { x, y }), (created) => {
      commit({ ...board, objects: [...board.objects, created.type === "sticker" ? { ...created, assetId: stickerId } : created] }); setSelected(created.id); setPanel("properties"); setTool("select");
    });
  }
  function canvasPoint(event: { clientX: number; clientY: number }) {
    const rect = area.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function toggleSelection(id: string) {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
    setPanel("properties");
  }
  function down(event: ReactPointerEvent, item?: BoardObject) {
    if (event.button !== 0 || drag.current || selectionGesture.current || (event.target as Element).closest("input,textarea,button")) return;
    if (item && tool !== "hand") {
      event.stopPropagation();
      if (tool === "select" && event.shiftKey) { toggleSelection(item.id); return; }
      if (!readOnly && tool === "connector") { choose(item); return; }
      const ids = tool === "select" && selectedSet.has(item.id) ? selectedIds : [item.id];
      setSelectedIds(ids); setPanel("properties");
      if (readOnly) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: item.id, ids, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: item.x, y: item.y, before: board };
      return;
    }
    if (tool === "hand") {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: null, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: pan.x, y: pan.y, before: board };
      return;
    }
    const point = canvasPoint(event);
    if (tool === "select") {
      if (!event.shiftKey) setSelected(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      selectionGesture.current = { pointerId: event.pointerId, start: point, base: event.shiftKey ? selectedIds : [] };
    } else {
      setSelected(null);
      if (tool === "sticky-note" || tool === "text" || tool === "shape" || tool === "sticker") add(tool, (point.x - pan.x) / zoom, (point.y - pan.y) / zoom);
    }
  }
  function startResize(event: ReactPointerEvent, item: BoardObject, corner: ResizeCorner) {
    event.stopPropagation(); event.preventDefault();
    if (event.button !== 0 || readOnly || drag.current || selectionGesture.current || item.type === "connector" || tool === "hand") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: item.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: item.x, y: item.y, before: board, corner };
  }
  function objectDrag(current: NonNullable<typeof drag.current>, dx: number, dy: number) {
    return current.corner
      ? resizeObject(current.before, current.id!, current.corner, { x: dx / zoom, y: dy / zoom })
      : moveSelection(current.before, current.ids ?? [current.id!], { x: dx / zoom, y: dy / zoom });
  }
  function move(event: ReactPointerEvent) {
    if (live && area.current) {
      const rect = area.current.getBoundingClientRect();
      run(cursorToBoard({ x: event.clientX - rect.left, y: event.clientY - rect.top }, pan, zoom), live.cursor);
    }
    const selecting = selectionGesture.current;
    if (selecting?.pointerId === event.pointerId) {
      const end = canvasPoint(event);
      if (Math.hypot(end.x - selecting.start.x, end.y - selecting.start.y) >= 4) setMarquee({ start: selecting.start, end });
      else setMarquee(null);
      return;
    }
    const current = drag.current; if (!current || current.pointerId !== event.pointerId || (current.id && readOnly)) return;
    const dx = event.clientX - current.clientX, dy = event.clientY - current.clientY;
    if (!current.id) run(panTo({ ...pan, scale: zoom }, { x: current.x + dx, y: current.y + dy }), (value) => setPan({ x: value.x, y: value.y }));
    else run(objectDrag(current, dx, dy), setBoard);
  }
  function up(event: ReactPointerEvent) {
    const selecting = selectionGesture.current;
    if (selecting?.pointerId === event.pointerId) {
      selectionGesture.current = null;
      setMarquee(null);
      const end = canvasPoint(event);
      if (Math.hypot(end.x - selecting.start.x, end.y - selecting.start.y) >= 4) {
        const toBoard = (p: Point) => ({ x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom });
        const ids = new Set(board.objects.map((item) => item.id));
        setSelectedIds([...new Set([...selecting.base.filter((id) => ids.has(id)), ...selectInRect(board, toBoard(selecting.start), toBoard(end))])]);
        setPanel("properties");
      }
      return;
    }
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!current.id) { if (live?.document) setBoard(live.document); return; }
    const dx = event.clientX - current.clientX, dy = event.clientY - current.clientY;
    if (readOnly || (dx === 0 && dy === 0)) { setBoard(live?.document ?? current.before); return; }
    const restore = () => setBoard(live?.document ?? current.before);
    run(objectDrag(current, dx, dy), (next) => {
      if (JSON.stringify(current.before) === JSON.stringify(next)) {
        setBoard(live?.document ?? current.before);
      } else if (live) {
        live.capture();
        run(live.edit(current.before, next), setBoard, restore);
        live.capture();
      } else {
        setPast((items) => [...items.slice(-49), current.before]); setFuture([]); setBoard(next);
      }
    }, restore);
  }
  function cancelGesture(event?: ReactPointerEvent) {
    if (!event || selectionGesture.current?.pointerId === event.pointerId) {
      selectionGesture.current = null; setMarquee(null);
    }
    if (event && drag.current?.pointerId !== event.pointerId) return;
    if (drag.current?.id) setBoard(live?.document ?? drag.current.before);
    drag.current = null;
  }
  useEffect(() => {
    if (readOnly && drag.current?.id) cancelGesture();
  }, [readOnly]);
  useEffect(() => {
    const host = area.current;
    if (!host) return;
    const layout = (event: MouseEvent) => {
      const rect = host.getBoundingClientRect();
      return { point: { x: event.clientX - rect.left, y: event.clientY - rect.top }, page: { x: rect.width, y: rect.height } };
    };
    const apply = (update: (previous: typeof viewport) => Effect.Effect<typeof viewport, Error>) =>
      setViewport((previous) => Effect.runSync(Effect.match(update(previous), { onSuccess: (value) => value, onFailure: () => previous })));
    // Safari uses proprietary gesture events for some trackpads; Chromium and Firefox use ctrl+wheel.
    let gestureScale: number | null = null;
    function wheel(event: WheelEvent) {
      if ((event.target as Element).closest("input,textarea,select,[contenteditable]")) return;
      event.preventDefault();
      if (drag.current || selectionGesture.current || gestureScale !== null) return;
      const { point, page } = layout(event);
      const delta = { x: event.deltaX, y: event.deltaY }, mode = event.deltaMode, pinch = event.ctrlKey;
      apply((previous) => wheelViewport(previous, point, delta, mode, pinch, page));
    }
    function gesture(event: Event) {
      event.preventDefault();
      if (event.type === "gestureend") { gestureScale = null; return; }
      if (drag.current || selectionGesture.current) return;
      const current = event as MouseEvent & { scale: number };
      if (!Number.isFinite(current.scale) || current.scale <= 0) return;
      const previousScale = gestureScale ?? current.scale;
      gestureScale = current.scale;
      const { point } = layout(current);
      apply((previous) => zoomAt(previous, point, current.scale / previousScale));
    }
    host.addEventListener("wheel", wheel, { passive: false });
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) host.addEventListener(type, gesture, { passive: false });
    return () => {
      host.removeEventListener("wheel", wheel);
      for (const type of ["gesturestart", "gesturechange", "gestureend"]) host.removeEventListener(type, gesture);
    };
  }, []);
  useEffect(() => {
    const typing = (event: Event) => event.target instanceof Element && !!event.target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])");
    const clipboardActive = (event: Event) => !dialog && !typing(event) && !window.getSelection()?.toString() &&
      (!document.activeElement || document.activeElement === document.body || !!document.activeElement.closest(".workspace"));
    function copy(event: ClipboardEvent) {
      if (!clipboardActive(event) || !selectedIds.length || !event.clipboardData) return;
      event.preventDefault();
      run(encodeSelection(board, selectedIds), (text) => {
        run(Effect.try({ try: () => event.clipboardData!.setData("text/plain", text), catch: () => new Error("Could not write to the clipboard.") }),
          () => { clipboard.current = text; setStatus("Objects copied"); });
      });
    }
    function paste(event: ClipboardEvent) {
      if (!clipboardActive(event) || readOnly || !event.clipboardData) return;
      const text = event.clipboardData.getData("text/plain");
      if (isCanvasClipboard(text)) { event.preventDefault(); pasteObjects(text); }
    }
    function key(event: KeyboardEvent) {
      if (typing(event) || (dialog && event.key !== "Escape")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (event.ctrlKey || event.metaKey || event.altKey) return;
      else if (event.key === "Delete" || event.key === "Backspace") { if (selectedIds.length && !readOnly) { event.preventDefault(); remove(); } }
      else if (event.key === "Escape") { cancelGesture(); setSelected(null); setConnectFrom(null); setTool("select"); setDialog(false); }
      else {
        const delta = { ArrowLeft: { x: 40, y: 0 }, ArrowRight: { x: -40, y: 0 }, ArrowUp: { x: 0, y: 40 }, ArrowDown: { x: 0, y: -40 } }[event.key];
        if (delta && event.target instanceof Element && area.current?.contains(event.target) && !drag.current && !selectionGesture.current) {
          event.preventDefault(); run(panTo(viewport, { x: pan.x + delta.x, y: pan.y + delta.y }), setPan);
        }
        const found = tools.find((entry) => entry.key.toLowerCase() === event.key.toLowerCase());
        if (found && (!readOnly || found.id === "select" || found.id === "hand")) { cancelGesture(); setTool(found.id); setConnectFrom(null); }
      }
    }
    window.addEventListener("keydown", key); window.addEventListener("copy", copy); window.addEventListener("paste", paste);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("copy", copy); window.removeEventListener("paste", paste); };
  });

  const avatar = accountInitial(account);
  const accountName = account?.displayName.trim() || account?.email || "Your account";
  const sidebarObjects = board.objects.filter((item) => item.type === "sticky-note" || item.type === "text");

  return <main className="workspace">
    <header className="topbar">
      <div className="brand"><span className="logo">c<span>•</span></span><h1>CoCanvas</h1></div>
      <span className="header-divider" />
      <div className="board-title"><strong>{identity?.title ?? "First things first"}</strong><span>Personal workspace <span className="private">· Private board</span></span></div>
      <div className="header-actions">{live && <div className="collaborators" role="list" aria-label="Active collaborators">
        {live.collaborators.map((person) => <span role="listitem" className="collaborator-avatar" key={person.id} title={person.name} aria-label={person.name} style={{ background: person.color }}>{person.name.slice(0, 1).toUpperCase()}</span>)}
        <span className="collaborator-count">{live.connected ? live.collaborators.length + 1 : 0} online</span>
      </div>}<a className="local-status" href="/dashboard">My boards ↗</a><a className="avatar" aria-label="Your account and boards" title={accountName} href="/dashboard">{avatar}</a><button className="button" onClick={() => run(exportBoard(board), () => setStatus("Board exported"))}>↗ <span>Export</span></button><button className="button primary" onClick={() => setDialog(true)}>Share board</button></div>
    </header>
    <aside className="sidebar">
      <div className="workspace-label">YOUR WORKSPACE</div>
      <button className="nav-item active" onClick={() => { setPan({ x: 35, y: 25 }); setZoom(0.85); }}>▦ <span>{identity?.title ?? "First things first"}</span><span className="small">↗</span></button>
      <div className="sidebar-section"><div className="section-title">ON THIS BOARD <span>{sidebarObjects.length}</span></div><input aria-label="Search objects" className="search" placeholder="⌕  Find an idea…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="object-list">{sidebarObjects.filter((item) => JSON.stringify(item).toLowerCase().includes(search.toLowerCase())).map((item) => <button key={item.id} className={`object-row ${selectedSet.has(item.id) ? "chosen" : ""}`} onClick={() => { setSelected(item.id); setPanel("properties");
          setPan({ x: 80 - item.x * zoom, y: 90 - item.y * zoom }); }}><span className="object-dot" style={{ background: item.type === "sticky-note" ? item.backgroundColor : "#e8ece9" }}>{item.type === "text" ? "T" : ""}</span><span>{item.type === "sticky-note" ? item.text.split("\n")[0] || "Untitled note" : item.content.split("\n")[0]}</span></button>)}</div>
      </div>
      <div className="sidebar-bottom"><div className="tip-icon">✦</div><strong>A little room for possibility</strong><p>Start with a thought.<br />Make something of it.</p><button className="text-button" onClick={() => setPanel("ai")}>Explore your ideas <span>→</span></button></div>
      <div className="sidebar-footer"><span className="avatar tiny" title={accountName}>{avatar}</span><div>My workspace<small>{identity ? live && !live.connected ? "Connecting to board" : readOnly ? "View-only access" : "Cloud saved" : "Local mode"}</small></div></div>
    </aside>
    <section className="canvas-area" ref={area} aria-label="Board canvas" tabIndex={0} onPointerDown={(event) => down(event)} onPointerMove={move} onPointerLeave={() => live?.cursor(null)} onPointerUp={up} onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture} style={{ cursor: tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair" }}>
      <div className="canvas-breadcrumb">WORKSPACE <span>/</span> <strong>{identity?.title ?? "First things first"}</strong></div>
      <BoardCanvas board={board} pan={pan} zoom={zoom} selected={selectedIds} onError={setStatus} />
      {live && <div className="collaborator-cursors" aria-label="Collaborator cursors">{live.collaborators.filter((person) => person.cursor).map((person) => <div key={person.id}
        className="collaborator-cursor" data-testid="collaborator-cursor" data-peer-id={person.id} aria-label={`${person.name}'s cursor`}
        style={{ left: pan.x + person.cursor!.x * zoom, top: pan.y + person.cursor!.y * zoom, color: person.color }}>
        <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M1 1L16 13L9 14L6 21Z" fill="currentColor" stroke="white" strokeWidth="1.5" /></svg>
        <span style={{ background: person.color }}>{person.name}</span>
      </div>)}</div>}
      <div className="canvas-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="connections" width="1" height="1" overflow="visible" aria-label="Board connectors">{board.objects.filter((item) => item.type === "connector").map((item) => {
          const start = resolveEndpoint(item.start, board.objects), end = resolveEndpoint(item.end, board.objects); if (!start || !end) return null;
          return <g key={item.id} role="button" tabIndex={0} data-object-id={item.id} aria-label={connectorLabel(item, board.objects)} aria-pressed={selectedSet.has(item.id)}
            onPointerDown={(event) => down(event, item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (event.shiftKey && tool === "select") toggleSelection(item.id); else choose(item); } }}>
            <path d={`M${start.x},${start.y} L${end.x},${end.y}`} stroke="transparent" strokeWidth={Math.max(item.strokeWidth, 16 / zoom)} pointerEvents="stroke" />
          </g>;
        })}</svg>
        {[...board.objects].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)).filter((item) => item.type !== "connector").map((item) => <div key={item.id} role="button" tabIndex={0} data-object-id={item.id} aria-label={objectLabel(item)} aria-pressed={selectedSet.has(item.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (event.shiftKey && tool === "select") toggleSelection(item.id); else choose(item); } }} onPointerDown={(event) => down(event, item)} className={`canvas-object ${item.type} ${selectedSet.has(item.id) || connectFrom === item.id ? "selected" : ""}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height, transform: `rotate(${item.rotation}deg)`, zIndex: item.zIndex + 1, background: item.type === "sticky-note" ? item.backgroundColor : item.type === "shape" ? item.fill : "transparent", color: item.type === "text" ? item.textColor : undefined, fontSize: item.type === "text" ? item.fontSize : undefined, border: item.type === "shape" ? `${item.borderWidth}px solid ${item.borderColor}` : undefined, borderRadius: item.type === "shape" && item.shapeType === "ellipse" ? "50%" : undefined }}>
          {identity && item.type === "sticky-note" && <button className="note-comment-badge" aria-label={`Comments on this note (${comments.counts[item.id] ?? 0})`} onClick={() => { setSelected(item.id); setTool("select"); setPanel("comments"); }}>💬 {comments.counts[item.id] ?? 0}</button>}
          {selected === item.id && !readOnly && tool === "select" && (["top-left", "bottom-right"] as const).map((corner) => <button key={corner} className={`handle ${corner}`} aria-label={`Resize ${corner}`} title="Drag to resize, or use arrow keys" onPointerDown={(event) => startResize(event, item, corner)} onKeyDown={(event) => {
            const delta = { ArrowLeft: { x: -10, y: 0 }, ArrowRight: { x: 10, y: 0 }, ArrowUp: { x: 0, y: -10 }, ArrowDown: { x: 0, y: 10 } }[event.key];
            if (delta) { event.preventDefault(); event.stopPropagation(); run(resizeObject(board, item.id, corner, delta), commit); }
          }} />)}
        </div>)}
      </div>
      {marquee && <div className="canvas-marquee" aria-hidden="true" style={{ left: Math.min(marquee.start.x, marquee.end.x), top: Math.min(marquee.start.y, marquee.end.y), width: Math.abs(marquee.start.x - marquee.end.x), height: Math.abs(marquee.start.y - marquee.end.y) }} />}
      <div className="canvas-hint">{tool === "connector" ? "Click two objects to connect them" : tool === "hand" ? "Drag anywhere to explore your board" : tool === "select" ? "Drag empty space to select objects" : "Click anywhere to add your idea"}</div>
      <div className="toolbar" onPointerDown={(event) => event.stopPropagation()}>{tools.map((entry) => <button key={entry.id} className={tool === entry.id ? "tool active" : "tool"} disabled={readOnly && entry.id !== "select" && entry.id !== "hand"} aria-label={entry.name} aria-pressed={tool === entry.id} title={`${entry.name} (${entry.key})`} onClick={() => { cancelGesture(); setTool(entry.id); setConnectFrom(null); }}><span>{entry.icon}</span><small>{entry.key}</small></button>)}<span className="toolbar-divider" /><button className="tool" aria-label="Undo" disabled={readOnly || (live ? !live.canUndo : !past.length)} onClick={undo}>↶</button><button className="tool" aria-label="Redo" disabled={readOnly || (live ? !live.canRedo : !future.length)} onClick={redo}>↷</button></div>
      {tool === "sticker" && <section className="sticker-picker" aria-label="Sticker picker" onPointerDown={(event) => event.stopPropagation()}>
        <label>Find a sticker<input aria-label="Search stickers" value={stickerSearch} onChange={(event) => setStickerSearch(event.target.value)} /></label>
        <p>Choose a sticker, then click the canvas to place it.</p>
        {["Reactions", "Thinking"].map((category) => <div key={category}><strong>{category}</strong><div className="sticker-grid">{stickers.filter((item) => item.category === category && item.label.toLowerCase().includes(stickerSearch.toLowerCase())).map((item) => <button key={item.id} aria-label={`Choose ${item.label} sticker`} aria-pressed={item.id === stickerId} disabled={readOnly} onClick={() => setStickerId(item.id)}><span aria-hidden="true">{item.glyph}</span><small>{item.label}</small></button>)}</div></div>)}
        {!stickers.some((item) => item.label.toLowerCase().includes(stickerSearch.toLowerCase())) && <p>No stickers match.</p>}
        <button className="button" onClick={() => setTool("select")}>Close sticker picker</button>
      </section>}
      <div className="canvas-clipboard" onPointerDown={(event) => event.stopPropagation()}>
        <button className="button" onClick={copyObjects} disabled={!selectedIds.length}>Copy</button>
        <button className="button" onClick={readClipboard} disabled={readOnly}>Paste</button>
      </div>
      <div className="zoom-controls" onPointerDown={(event) => event.stopPropagation()}><button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.25, value - 0.1))}>−</button><button aria-label="Reset zoom" onClick={() => { setZoom(0.85); setPan({ x: 35, y: 25 }); }}>{Math.round(zoom * 100)}%</button><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, value + 0.1))}>+</button></div>
    </section>
    <aside className="inspector"><div className="panel-tabs"><button className={panel === "properties" ? "active" : ""} onClick={() => setPanel("properties")}>Design</button><button className={panel === "ai" ? "active" : ""} onClick={() => setPanel("ai")}>✦ Assistant</button><button className={panel === "comments" ? "active" : ""} onClick={() => setPanel("comments")}>Comments</button></div>
      {readOnly && <p className="panel-content">{live && !live.connected ? "Editing is paused while the board sync service reconnects. For local development, run npm run dev to start both services." : "This board is view-only. You can still manage your ChatGPT connection in Assistant."}</p>}
      {panel === "comments" ? identity && object?.type === "sticky-note" ? <NoteComments key={object.id} noteId={object.id} model={comments} /> : <div className="panel-content"><h2>Comments</h2><p>{identity ? "Select a sticky note to read or leave comments." : "Open a saved board to leave comments."}</p></div> : panel === "ai" ? (
          <BoardAIPanel
              board={board}
              savedBoardId={identity?.id}
              onConfirmResult={confirmAIResult}
              editingDisabled={readOnly}
          />
      ) : <fieldset className="readonly-fields" disabled={readOnly}>{selectedIds.length > 1 ? <div className="panel-content"><h2>{selectedIds.length} objects selected</h2><p>Drag a selected object to move the selection together.</p><button className="button danger" onClick={remove}>Delete selected objects</button></div> : object ? <div className="panel-content"><span className="eyebrow">SELECTED OBJECT</span><h2>{object.type === "sticky-note" ? "Sticky note" : object.type === "text" ? "Text" : object.type === "shape" ? "Shape" : object.type === "sticker" ? "Sticker" : "Connector"}</h2>
        {(object.type === "sticky-note" || object.type === "text" || object.type === "shape") && <label className="field">Content<textarea aria-label="Object content" value={object.type === "text" ? object.content : object.text} onChange={(event) => update({ [object.type === "text" ? "content" : "text"]: event.target.value })} /></label>}
        {object.type === "sticker" && <p>{stickerAsset(object.assetId).label}</p>}
        {object.type !== "connector" && <div className="field-grid">{(["x", "y", "width", "height", "rotation", "zIndex"] as const).map((key) => <label className="field" key={key}>{key}<input type="number" aria-label={key} value={object[key]} onChange={(event) => { if (event.target.value !== "") update({ [key]: Number(event.target.value) }); }} /></label>)}</div>}
        {(object.type === "sticky-note" || object.type === "shape") && <><label className="field">{object.type === "sticky-note" ? "Note color" : "Fill"}</label><div className="swatches">{colors.map((color) => <button key={color} aria-label={`Set color ${color}`} className={(object.type === "sticky-note" ? object.backgroundColor : object.fill) === color ? "picked" : ""} style={{ background: color }} onClick={() => update({ [object.type === "sticky-note" ? "backgroundColor" : "fill"]: color })} />)}</div></>}
        {object.type === "shape" && <><label className="field">Shape type<select aria-label="Shape type" value={object.shapeType} onChange={(event) => update({ shapeType: event.target.value })}><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option></select></label><label className="field">Border width<input aria-label="Border width" type="number" min={0} max={32} value={object.borderWidth} onChange={(event) => update({ borderWidth: Number(event.target.value) })} /></label><label className="field">Border color<input type="color" value={object.borderColor} onChange={(event) => update({ borderColor: event.target.value })} /></label></>}
        {(object.type === "text" || object.type === "shape") && <><label className="field">Font size<input aria-label="Font size" type="number" value={object.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label><label className="field">Text color<input type="color" value={object.textColor} onChange={(event) => update({ textColor: event.target.value })} /></label></>}
        {object.type === "connector" && <><p>{connectorLabel(object, board.objects)}</p><label className="field">Line color<input aria-label="Line color" type="color" value={object.strokeColor} onChange={(event) => update({ strokeColor: event.target.value })} /></label><label className="field">Line width<input aria-label="Line width" type="number" min={0.1} max={32} step={0.5} value={object.strokeWidth} onChange={(event) => update({ strokeWidth: Number(event.target.value) })} /></label><label className="field">Arrow style<select aria-label="Arrow style" value={object.arrowStyle} onChange={(event) => update({ arrowStyle: event.target.value })}><option value="none">No arrows</option><option value="end">End arrow</option><option value="both">Both ends</option></select></label></>}
        <button className="button danger" onClick={remove}>Delete object</button>
      </div> : <div className="panel-content empty-inspector"><div className="selection-illustration"><span /><span /><i>↖</i></div><h2>A space for<br />your next big idea.</h2><p>Select anything on your board to edit its details.</p><div className="quick-start"><span className="eyebrow">MAKE YOUR FIRST MOVE</span><button onClick={() => { setTool("sticky-note"); }}>▧ Add a sticky note <span>N</span></button><button onClick={() => setTool("text")}>T Write something <span>T</span></button><button onClick={() => setTool("shape")}>□ Give it some shape <span>S</span></button></div><div className="quiet-note">A blank canvas.<br />Endless possibilities.</div></div>}</fieldset>
    }</aside>
    <footer className="statusbar"><span role="status"><i />{[remoteStatus, status].filter(Boolean).join(" · ")}</span><span>{board.objects.length} objects <span className="footer-dot">·</span> Made for thinking together</span></footer>
    {dialog && <div className="modal-backdrop" onClick={() => setDialog(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close sharing dialog" autoFocus onClick={() => setDialog(false)}>×</button><span className="eyebrow">THINKING TOGETHER</span><h2 id="share-title">Your ideas deserve company.</h2><p>{identity ? "Share this board with someone who already has a CoCanvas account." : "This demo is saved on this device. Sign in through My boards to create private cloud-saved boards."}</p>{sharePanel}<button className="button" onClick={() => run(exportBoard(board), () => { setStatus("Board exported"); setDialog(false); })}>Export a board copy</button></section></div>}
  </main>;
}
