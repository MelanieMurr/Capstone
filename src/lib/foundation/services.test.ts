import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticate, authenticated, createBoard, modifyBoard, saveDocument } from "./services";
import { mutationOrigin } from "./http";
import { safeNext } from "./contracts";
const owner = "50000000-0000-4000-8000-000000000001";
const other = "50000000-0000-4000-8000-000000000002";
const boardId = "50000000-0000-4000-8000-000000000003";
function client() {
  const auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: owner } }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  const db = { auth, from: vi.fn(), rpc: vi.fn() };
  return { db, supabase: db as unknown as SupabaseClient };
}
const result = <A,>(program: Effect.Effect<A, Error>) => Effect.runPromise(program);
describe("authentication and dashboard domain", () => {
  it("requires an authenticated remote user", async () => {
    const { db, supabase } = client();
    db.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(result(authenticated(supabase))).rejects.toThrow("Please sign in");
    await expect(result(createBoard(supabase, { title: "Private" }))).rejects.toThrow("Please sign in");
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("validates signup before contacting Supabase", async () => {
    const { db, supabase } = client();
    await expect(result(authenticate(supabase, "signup", { email: "bad", password: "short" }, "http://localhost/auth/callback"))).rejects.toThrow("12–128");
    expect(db.auth.signUp).not.toHaveBeenCalled();
  });
  it("uses confirmation flow when signup has no session", async () => {
    const { db, supabase } = client();
    const value = await result(authenticate(supabase, "signup", { email: "Person@Example.test", password: "long-test-password-123" }, "http://localhost/auth/callback"));
    expect(value.signedIn).toBe(false); expect(value.message).toContain("Check your email");
    expect(db.auth.signUp).toHaveBeenCalledWith({ email: "person@example.test", password: "long-test-password-123", options: { emailRedirectTo: "http://localhost/auth/callback" } });
  });
  it("does not expose provider details on failed login", async () => {
    const { db, supabase } = client(); db.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Sensitive provider detail" } });
    await expect(result(authenticate(supabase, "signin", { email: "person@example.test", password: "wrong" }, "http://localhost/auth/callback"))).rejects.toThrow("Sign-in failed");
  });
  it("signs out the current session", async () => {
    const { db, supabase } = client();
    expect((await result(authenticate(supabase, "signout", {}, ""))).signedIn).toBe(false);
    expect(db.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("does not mutate boards for a non-owner", async () => {
    const { db, supabase } = client();
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { owner_id: other }, error: null }), update: vi.fn(), delete: vi.fn() };
    db.from.mockReturnValue(query);
    await expect(result(modifyBoard(supabase, boardId, "rename", { title: "Stolen" }))).rejects.toThrow("Only the board owner");
    await expect(result(modifyBoard(supabase, boardId, "delete"))).rejects.toThrow("Only the board owner");
    expect(query.update).not.toHaveBeenCalled(); expect(query.delete).not.toHaveBeenCalled();
  });
  it("rejects blank board titles before mutation", async () => {
    const { db, supabase } = client();
    await expect(result(createBoard(supabase, { title: "   " }))).rejects.toThrow("board title");
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("rejects documents with a different board identity", async () => {
    const { db, supabase } = client();
    await expect(result(saveDocument(supabase, boardId, { revision: 0, document: { boardId: other, schemaVersion: 1, objects: [] } }))).rejects.toThrow("Invalid board document");
    expect(db.from).not.toHaveBeenCalled();
  });
});
describe("HTTP boundaries", () => {
  it("handles Next's internal localhost URL while checking the actual request host", () => {
    expect(mutationOrigin(new Request("http://localhost:3000/api/boards", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } }))).toBe(true);
    expect(mutationOrigin(new Request("http://localhost:3000/api/boards", { headers: { host: "127.0.0.1:3000", origin: "https://evil.example" } }))).toBe(false);
    expect(mutationOrigin(new Request("http://localhost/api/boards", { headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
  });
  it("rejects external login redirects", () => {
    expect(safeNext("//evil.example")).toBe("/dashboard");
    expect(safeNext("https://evil.example")).toBe("/dashboard");
    expect(safeNext(`/boards/${boardId}`)).toBe(`/boards/${boardId}`);
  });
});
