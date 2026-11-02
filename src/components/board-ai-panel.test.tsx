import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Effect } from "effect";
import BoardAIPanel from "./board-ai-panel";
import { initialBoard } from "../lib/board/frontend";
afterEach(() => vi.unstubAllEnvs());
const render = () => renderToStaticMarkup(createElement(BoardAIPanel, { board: initialBoard, onConfirmResult: () => Effect.void }));
describe("public deployment AI availability", () => {
  it("explains local-only AI and offers no failing generation action in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const output = render();
    expect(output).toContain("AI runs locally");
    expect(output).not.toContain("Run AI request");
    expect(output).not.toContain('type="checkbox"');
  });
  it("retains selected-note AI in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const output = render();
    expect(output).toContain("Run AI request"); expect(output).toContain('type="checkbox"');
  });
});
