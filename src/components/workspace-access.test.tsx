import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import Workspace from "./workspace";
import BoardAIPanel from "./board-ai-panel";
import { initialBoard } from "../lib/board/frontend";

describe("paused board controls", () => {
  it("keeps inspector navigation outside the disabled editing fieldset", () => {
    const html = renderToStaticMarkup(<Workspace initialDocument={initialBoard} readOnly />);
    const tab = html.indexOf("✦ Assistant");
    const controls = html.indexOf('class="readonly-fields" disabled=""');
    expect(tab).toBeGreaterThan(0); expect(controls).toBeGreaterThan(tab);
    expect(html).toContain('aria-label="Sticky note"');
    expect(html).toMatch(/disabled="" aria-label="Sticky note"/);
  });
  it("keeps ChatGPT connection controls available while generation and insertion are paused", () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      const html = renderToStaticMarkup(createElement(BoardAIPanel, { board: initialBoard, editingDisabled: true, onConfirmResult: () => Effect.void }));
      const connection = html.indexOf("Continue with ChatGPT");
      const noteControls = html.indexOf('<fieldset disabled=""><legend>Select sticky notes');
      expect(connection).toBeGreaterThan(0); expect(noteControls).toBeGreaterThan(connection);
      expect(html).toContain("You can connect ChatGPT now");
      expect(html).toContain('disabled="">Run AI request');
    } finally { vi.unstubAllEnvs(); }
  });
});
