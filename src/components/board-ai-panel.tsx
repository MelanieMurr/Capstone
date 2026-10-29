"use client";

import {useRef, useState} from "react";
import {Effect} from "effect";

import type {BoardDocument} from "../lib/board/model";
import type {AIOpertion, AIResult} from "../lib/ai/evaluation";
import {requestBoardAI} from "../lib/ai/board-request";
import type {SubmittedNote} from "../lib/ai/categorization";

type CompletedRequest = {
    operation: AIOpertion;
    notes: { id: string; text: string }[];
    result: AIResult;
};

export default function BoardAIPanel({
                                         board,
                                         onConfirmCategorization,
                                     }: {
    board: BoardDocument;
    onConfirmCategorization: (
        input: unknown,
        submittedNotes: SubmittedNote[],
    ) => Effect.Effect<void, Error>;
}) {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [operation, setOperation] = useState<AIOpertion>("summary");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [failed, setFailed] = useState(false);
    const [completed, setCompleted] = useState<CompletedRequest | null>(null);

    const inFlight = useRef(false);

    const notes = board.objects.filter(
        (object) => object.type === "sticky-note",
    );

    const selectedCount = notes.filter((note) =>
        selectedIds.includes(note.id),
    ).length;

    function toggleNote(id: string) {
        setSelectedIds((current) =>
            current.includes(id) ? current.filter((selectedId) => selectedId !== id)
                : [...current, id],
        );

        setCompleted(null);
        setMessage("");
        setFailed(false);
    }

    async function submit() {
        if (inFlight.current) return;

        inFlight.current = true;
        setBusy(true);
        setCompleted(null);
        setFailed(false);
        setMessage("Sending your selected notes to local AI...");

        const submittedOperation = operation;

        try {
            await Effect.runPromise(
                Effect.match(
                    requestBoardAI(board, selectedIds, submittedOperation),
                    {
                        onFailure: (error) => {
                            setFailed(true);
                            setMessage(error.message);
                        },

                        onSuccess: ({result, notes: submittedNotes}) => {
                            setCompleted({
                                operation: submittedOperation,
                                notes: submittedNotes,
                                result,
                            });

                            setMessage(
                                "Response received and validated. Your board has not been changed!",
                            );
                        },
                    },
                ),
            );
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }

    function confirmCategories() {
        if (
            inFlight.current ||
            !completed ||
            completed.operation !== "categorize"
        ) {
            return;
        }

        const preview = completed;

        inFlight.current = true;

        try {
            Effect.runSync(
                Effect.match(
                    onConfirmCategorization(
                        preview.result,
                        preview.notes,
                    ),
                    {
                        onFailure: (error) => {
                            setFailed(true);
                            setMessage(error.message);
                        },

                        onSuccess: () => {
                            setCompleted(null);
                            setFailed(false);
                            setMessage("Categorized copies were added below your existing objects. Check the board status for saving and synchronization.",
                            );
                        },
                    },
                ),
            );
        } finally {
            inFlight.current = false;
        }
    }

    return (
        <section className="panel-content">
            <span className="eyebrow">YOUR BOARD ASSISTANT</span>
            <h2>Explore your notes</h2>

            <p>
                Choose sticky notes, then select what you want help with.
                Requests use the existing local Codex workflow.
            </p>

            <fieldset disabled={busy}>
                <legend>Select sticky notes</legend>

                {notes.length === 0 ? (
                    <p>Add a sticky note to your board to get started.</p>
                ) : (
                    notes.map((note) => (
                        <label
                            key={note.id}
                            style={{
                                display: "flex",
                                gap: 8,
                                alignItems: "flex-start",
                                marginBottom: 12,
                                overflowWrap: "anywhere",
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={selectedIds.includes(note.id)}
                                onChange={() => toggleNote(note.id)}
                                aria-label={`Include note: ${
                                    note.text.trim() || "Empty note"
                                }`}
                            />

                            <span>
                {note.text.trim() || "Empty note"}
              </span>
                        </label>
                    ))
                )}
                <p>{selectedCount} selected · Maximum 20 notes</p>

                <button
                    type="button"
                    className="button"
                    onClick={() => {
                        setSelectedIds([]);
                        setCompleted(null);
                        setMessage("");
                        setFailed(false);
                    }}
                >
                    Clear selection
                </button>

                <label className="field">
                    AI operation
                    <select
                        value={operation}
                        onChange={(event) => {
                            setOperation(event.target.value as AIOpertion);
                            setCompleted(null);
                            setMessage("");
                            setFailed(false);
                        }}
                    >
                        <option value="categorize">Categorize notes</option>
                        <option value="summary">Generate summary</option>
                        <option value="action-items">
                            Generate action items
                        </option>
                    </select>
                </label>

                <button
                    type="button"
                    className="button primary"
                    onClick={submit}
                >
                    {busy ? "Working…" : "Run AI request"}
                </button>
            </fieldset>
            {message && (
                <p role={failed ? "alert" : "status"}>{message}</p>
            )}

            {completed && (
                <section aria-label="AI response">
                    <h3>AI response</h3>

                    <p>
                        Based on {completed.notes.length} submitted notes.
                        Changes made after submission are not included.
                    </p>

                    {completed.operation === "summary" && (
                        <p>{completed.result.summary}</p>
                    )}

                    {completed.operation === "categorize" && (
                        <div>
                            <p>
                                Review these categories before adding them.
                                Confirmation creates category headings and copies
                                of the selected notes below your existing objects.
                                Your original notes stay unchanged.
                            </p>

                            <ul>
                                {completed.result.categories.map((category, index) => (
                                    <li key={index}>
                                        <strong>{category.name}</strong>

                                        <ul>
                                            {category.noteIds.map((id) => (
                                                <li key={id}>
                                                    {
                                                        completed.notes.find(
                                                            (note) => note.id === id,
                                                        )?.text
                                                    }
                                                </li>
                                            ))}
                                        </ul>
                                    </li>
                                ))}
                            </ul>

                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 8,
                                }}
                            >
                                <button
                                    type="button"
                                    className="button primary"
                                    disabled={busy}
                                    onClick={confirmCategories}
                                >
                                    Confirm categorization
                                </button>

                                <button
                                    type="button"
                                    className="button"
                                    disabled={busy}
                                    onClick={() => {
                                        setCompleted(null);
                                        setFailed(false);
                                        setMessage(
                                            "Categorization cancelled. Your board was not changed.",
                                        );
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )
                    }
                    )
                    {
                        completed.operation === "action-items" &&
                        (completed.result.actionItems.length === 0 ? (
                            <p>No supported action items were found.</p>
                        ) : (
                            <ul>
                                {completed.result.actionItems.map((item, index) => (
                                    <li key={index}>{item.text}</li>
                                ))}
                            </ul>
                        ))
                    }
                </section>
            )}
        </section>
    )
        ;
}