# MVP verification scope and evidence

Scope recorded November 5, 2026, following the project owner's confirmation:
deploy the collaborative workspace publicly and demonstrate AI assistance in
the local application using the user's authorized ChatGPT subscription.

Related Trello tickets:

- [Deploy App & WebSocket Service](https://trello.com/c/S0H3Hk9H)
- [Verify MVP Requirements](https://trello.com/c/JiyK11G2)
- [Get API to work, so AI integration can work as expected](https://trello.com/c/FaUuyZfN)

## Environment and evidence matrix

This is a verification plan, not a claim that the remaining checks passed.
Retain the exact original proposal requirement alongside each final evidence row.

| Workflow | Required environment | Evidence needed before final acceptance |
| --- | --- | --- |
| Account creation, sign-in, sign-out, protected access | Public website | Actual deployment URL, test date, expected/actual results, and relevant checks. |
| Board creation, opening, renaming, and deletion | Public website | Recorded authorized-user workflow and isolation from another account. |
| Canvas objects, editing, pan/zoom, and undo/redo | Public website | Representative supported object operations and interaction results. |
| Sharing, permissions, and unauthorized-access rejection | Public website and deployed real-time service | Owner/editor/viewer/nonmember checks across HTTP, storage, and WebSockets. |
| Simultaneous edits, presence, reconnection, and failure handling | Public website and deployed real-time service | Two independent users, convergence, preservation of unrelated changes, and recovery results. |
| Binary Yjs saving and restoration | Public website and deployed real-time service | Reopened shared content retains object identities, content, geometry, and relationships. |
| ChatGPT authorization, account/model selection, and real inference | Local application at 127.0.0.1 | User-completed OpenAI consent and successful requests for the selected account/model. Account-specific eligibility remains unverified until then. |
| Categorization, summaries, action items, and invalid/failed AI requests | Local application | Real valid output, schema/reference validation, useful failure feedback, and no automatic billing fallback. |
| AI preview, cancel, confirm, shared saving, and restoration | Local application with authorized board sync | No board change before confirmation; confirmed content synchronizes, saves in binary Yjs state, and restores. |
| Public AI availability boundary | Public website | Clear local-only explanation, unavailable generation controls, and denied local-provider execution on production routes. |
| Setup and usage documentation | Both | Public URLs, hosting/environment instructions, local startup/sign-in instructions, limitations, and credential-storage guidance. |

## Record results without conflating environments

For each approved proposal requirement, record its identifier and original text,
acceptance criteria, environment, date/version, expected/actual result, evidence
link, pass/fail/pending status, and any linked defect or scope deviation.

Local browser tests, a local production build, and mocked AI responses are useful
regression evidence. They do not substitute for a public two-user deployment test
or real ChatGPT subscription authorization/inference. All rows above remain
pending final requirement-level verification until that evidence is recorded.

If the original proposal explicitly requires publicly hosted AI, record that as
a scope deviation requiring the applicable approval. The owner's local-only
implementation decision does not itself establish instructor approval. Keep the
requirement unresolved until an amendment is approved or the requirement is met.

## Remaining work

1. Finish hosting and public deployment, then record two-user production results.
2. Complete real ChatGPT consent and local AI verification; retain no tokens,
   passwords, authorization URLs, or selected private note content in evidence.
3. Map every original approved requirement to the evidence matrix, track gaps,
   retest failures, and reconcile any required scope approvals.
4. Check the deployment and verification tickets only after their actual checks
   pass. Updating their scope wording does not complete their checklists.
