"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Effect } from "effect";
import type { BoardObject } from "../lib/board/model";

/** A screen-sized discussion anchored to the note, outside the zoomed world. */
export default function CommentPopover({ note, pan, zoom, onClose, children }: {
  note: BoardObject; pan: { x: number; y: number }; zoom: number;
  onClose: () => void; children: ReactNode;
}) {
  const element = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const host = element.current?.parentElement;
    if (!host) return;
    const measure = () => Effect.runSync(Effect.sync(() => setSize({ width: host.clientWidth, height: host.clientHeight })));
    measure();
    const observer = new ResizeObserver(measure); observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const trigger = document.activeElement;
    return () => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true }); };
  }, [note.id]);
  // Account for rotation about the same top-left origin as the rendered note.
  const radians = note.rotation * Math.PI / 180;
  const corners = [[0, 0], [note.width, 0], [0, note.height], [note.width, note.height]]
    .map(([x, y]) => ({ x: pan.x + (note.x + x! * Math.cos(radians) - y! * Math.sin(radians)) * zoom,
      y: pan.y + (note.y + x! * Math.sin(radians) + y! * Math.cos(radians)) * zoom }));
  const left = Math.min(...corners.map((p) => p.x)), right = Math.max(...corners.map((p) => p.x));
  const width = Math.min(340, Math.max(0, size.width - 16));
  const preferred = right + 12 + width <= size.width - 8 ? right + 12 : left - width - 12;
  const x = Math.max(8, Math.min(preferred, size.width - width - 8));
  const y = Math.max(8, Math.min(Math.min(...corners.map((p) => p.y)), size.height - Math.min(480, size.height - 16) - 8));
  return <section ref={element} className="comment-popover" role="dialog" aria-label="Sticky note discussion"
    style={{ left: x, top: y }} onPointerDown={(event) => event.stopPropagation()}
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <header><h2>Comments</h2><button className="button" aria-label="Close comments" onClick={onClose}>×</button></header>
    {children}
  </section>;
}
