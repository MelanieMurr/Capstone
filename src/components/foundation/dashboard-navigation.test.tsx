import { isValidElement } from "react";
import type { ReactNode, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ index: 0, title: "New shared ideas", push: vi.fn(), setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useEffect: () => undefined,
  useState: (initial: unknown) => {
    const index = state.index++, setter = vi.fn(); state.setters[index] = setter;
    return [index === 4 ? state.title : initial, setter];
  },
}));
import Dashboard from "./dashboard";
const id = "20000000-0000-4000-8000-000000000001";
const created = { id, owner_id: id, title: "New shared ideas", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
type Element = ReactElement<{ children?: ReactNode; className?: string; onSubmit?: (event: { preventDefault: () => void }) => void }>;
function findForm(node: ReactNode): Element | undefined {
  if (Array.isArray(node)) { for (const child of node) { const found = findForm(child); if (found) return found; } return; }
  if (!isValidElement(node)) return;
  const element = node as Element;
  if (element.type === "form" && element.props.className === "new-board-form") return element;
  return findForm(element.props.children);
}
function submit() {
  const form = findForm(Dashboard({ userId: id, email: "alice@example.com" }));
  expect(form).toBeDefined(); form!.props.onSubmit!({ preventDefault: vi.fn() });
}
beforeEach(() => { state.index = 0; state.title = "New shared ideas"; state.setters = []; state.push.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
describe("new-board navigation", () => {
  it("opens the validated board returned by creation without another dashboard click", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(created)); vi.stubGlobal("fetch", fetch);
    submit(); await vi.waitFor(() => expect(state.push).toHaveBeenCalledWith(`/boards/${id}`));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "POST", body: JSON.stringify({ title: state.title }) });
  });
  it.each([Response.json({ error: "Unable to create board" }, { status: 503 }), Response.json({ id: "invalid" })])("stays on the dashboard when creation fails or returns an invalid identity", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response)); submit();
    await vi.waitFor(() => expect(state.setters[2]).toHaveBeenCalledWith(expect.any(String)));
    // The first error reset is empty; wait for the request's failure to be surfaced.
    await vi.waitFor(() => expect(state.setters[2]!.mock.calls.some(([message]) => !!message)).toBe(true));
    expect(state.push).not.toHaveBeenCalled();
  });
});
