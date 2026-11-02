import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { syncServerConfig } from "./server-config";
const config = (environment: Record<string, string | undefined>) => Effect.runSync(syncServerConfig(environment));
describe("hosted board sync configuration", () => {
  it("retains local development defaults", () => {
    expect(config({})).toEqual({ port: 1235, host: "127.0.0.1", origins: ["http://127.0.0.1:3000", "http://localhost:3000"] });
  });
  it("uses the hosting port and public bind address with an explicit origin", () => {
    expect(config({ NODE_ENV: "production", PORT: "10000", BOARD_SYNC_ORIGINS: "https://cocanvas.example, https://preview.example" })).toEqual({ port: 10000, host: "0.0.0.0", origins: ["https://cocanvas.example", "https://preview.example"] });
  });
  it.each(["", "*", "https://*.example.com", "https://example.com/path", "https://example.com/", "http://example.com", "https://user:password@example.com"])("rejects unsafe production origin %s", (origin) => {
    expect(() => config({ NODE_ENV: "production", BOARD_SYNC_ORIGINS: origin })).toThrow();
  });
  it.each(["", "0", "65536", "-1", "1.5", "invalid"])("rejects invalid hosting port %s", (port) => expect(() => config({ PORT: port })).toThrow());
  it("does not start production with implicit localhost origins", () => expect(() => config({ NODE_ENV: "production" })).toThrow());
});
