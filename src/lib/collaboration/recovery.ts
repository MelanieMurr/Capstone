import { Effect } from "effect";
import type { Change } from "./shared-board";
export type Command = { type: "edit"; requestId: string; changes: Change[] } | { type: "undo" | "redo" | "capture"; requestId: string };
export const reconnectDelay = (attempt: number) => Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
export const recoverCommands = (commands: Command[], settled: string[], historyReset: boolean, canEdit: boolean) => Effect.try({
  try: () => {
    const acknowledged = new Set(settled);
    const remaining = commands.filter((command) => !acknowledged.has(command.requestId));
    if (!canEdit && remaining.some((command) => command.type === "edit")) throw new Error("Your edit access changed. Unsent changes are retained for export; reload after exporting.");
    const cannotReplayHistory = historyReset || !canEdit;
    const skippedHistory = cannotReplayHistory && remaining.some((command) => command.type === "undo" || command.type === "redo");
    return {
      pending: remaining.filter((command) => command.type !== "capture" && !(cannotReplayHistory && (command.type === "undo" || command.type === "redo"))),
      notice: skippedHistory ? `Pending undo/redo was not replayed because ${!canEdit ? "edit access changed" : "server undo history reset"}.` : historyReset ? "Undo history reset after the server restarted." : "",
    };
  }, catch: (cause) => cause instanceof Error ? cause : new Error("Could not reconcile pending edits."),
});
