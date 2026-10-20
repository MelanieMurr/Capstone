"use client";
import dynamic from "next/dynamic";
const NotesEditor = dynamic(() => import("./notes-editor"), { ssr: false, loading: () => <p>Loading canvas…</p> });
export default function NotesLoader({ shared = false }: { shared?: boolean }) { return <NotesEditor shared={shared} />; }
