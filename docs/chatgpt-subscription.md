# Local ChatGPT subscription connection

CoCanvas can connect a ChatGPT account and send eligible board analysis requests
through the installed `openai` SDK using that account's OAuth access token. An
`OPENAI_API_KEY`, client secret, and pre-registered commercial client are not used
by this local flow. Access still depends on OpenAI account/workspace eligibility,
granted permissions, available models, and plan/app usage limits.

This implements the **local subscription connection** selected for this project.
The CoCanvas email/password login still controls private boards, sharing, and
Supabase RLS. Connecting ChatGPT authorizes AI; it does not replace your CoCanvas
login or turn a ChatGPT ID token into a Supabase session.

## Try it in WebStorm

1. Run `npm run dev` in the project terminal. The dev script now binds to
   `127.0.0.1`. Open **http://127.0.0.1:3000**, including that exact host. If port
   3000 is occupied and Next chooses another port, use the address Next prints.
   The callback uses the current port automatically.
2. Sign in to your existing CoCanvas account. `npm run dev` now starts the board
   sync service automatically (or reuses one already running), so a second
   terminal is no longer required. `npm run dev:web` starts only Next.js when
   services are managed separately.
3. Open a board and choose **Assistant**. Leave **AI provider** set to
   **ChatGPT subscription**.
4. Click **Continue with ChatGPT**. Sign in on OpenAI's website, name/authorize
   the CoCanvas registration, and approve ChatGPT plan usage when offered. You
   perform this step yourself; the app never asks for your ChatGPT password.
5. OpenAI redirects to `/auth/callback` on the local app. Open Assistant again if
   the workspace inspector returned to its default tab.
6. Dismiss the first-time plan explanation with **Got it**. Choose a model from
   the **ChatGPT model** list. The names come from your account's model catalog;
   CoCanvas does not assume every subscription supports a fixed model.
7. Select 1–20 sticky notes, choose an operation, and click **Run AI request**.
   Review the result, then confirm it to add content to the board.

Use **Refresh connection** after a temporary catalog problem. **Add ChatGPT
account** creates a separate registration; the account selector switches between
saved registrations, including workspaces with the same email. **Disconnect
ChatGPT** revokes the selected renewable session and removes its local tokens.
Its identity/client mapping remains available for reconnecting. The original
local Codex provider remains an explicit choice in the provider selector; it is
never an automatic fallback when a subscription request fails.

## Implementation, step by step

### 1. Keep the integration local and bind it to the signed-in user

`src/lib/ai/chatgpt/access.ts` rejects production requests, non-loopback URL/Host
values, and cross-origin mutations. It then reuses the existing Supabase
`authenticated()` operation, which verifies the CoCanvas user with `getUser()`.
Consequently Alice's requests can only load Alice's local credential records.
The existing saved-board AI route still checks editor permission and validates
the submitted notes against the saved board before invoking an AI provider.

`npm run dev` binds to loopback. The production AI panel remains disabled, and
the new connection endpoints return 404 in production. This does not enable a
subscription gateway on Vercel.

### 2. Create a stable host and a fresh authorization transaction

`src/lib/ai/chatgpt/oauth.ts` discovers OpenAI's OAuth endpoints. It generates
fresh random `state`, `nonce`, and a PKCE verifier for every sign-in attempt.
The PKCE challenge is the base64url SHA-256 hash of that verifier. The verifier
stays in protected server-side storage; a short-lived HttpOnly, SameSite=Lax
cookie binds the callback to the initiating browser.

`src/lib/ai/chatgpt/store.ts` creates a persistent `urn:uuid:...` host ID. First
registration sends `client_id=dynamic_agent_client`, `agent_name_hint=CoCanvas`,
that host ID, the identity/plan scopes, and `resource=https://api.openai.com/v1`.
The redirect URI is always HTTP `127.0.0.1` with `/auth/callback` and the app's
current port. Returning sign-in reuses the issued client ID and host ID, and
retains the original account's identity hint while connected.

### 3. Redeem the callback exactly once and verify identity

`src/app/auth/callback/route.ts` clears the temporary cookie at its original
path, then delegates to `finishConnection`. State, browser binding, user, expiry,
and the exact redirect URI must match. A filesystem rename claims the pending
transaction once, so concurrent/replayed callbacks cannot redeem it twice.

The token exchange uses the **issued** client ID, original verifier and redirect
URI, and resource. It sends no secret. If the first code expires, the issued
client ID is retained for a fresh authorization; it is not treated as verified
identity until ID-token validation succeeds.

Node's built-in crypto verifies the RS256 signature against OpenAI's JWKS. The
code checks issuer, audience, expiration, issued/not-before times, nonce,
authorized party when applicable, and an access-token hash when supplied.
Returning identity must match the selected registration's verified subject.
Email is a display label, not proof that registrations are the same account.

The token response must grant `chatgpt.tokens.use.direct` before inference is
allowed. A valid identity without that permission stays connected but has AI
disabled, with an explicit **Enable ChatGPT plan** action.

### 4. Store and renew credentials without exposing them to the canvas

By default, private files live under `.local/chatgpt/` in this checkout:

- `host.json`: this installation's stable host ID.
- `user-<hash>.json`: a CoCanvas user's separate ChatGPT registrations, selected
  registration/model, tokens, scopes, expiry, and first-time notice status.
- Temporary pending records: the current OAuth state, nonce, and verifier.

The directory has Unix permissions `0700`, and records have `0600`. Writes use a
temporary file, flush, and atomic rename. `.gitignore` and `.dockerignore`
exclude `.local`. Tokens are protected by filesystem permissions; they are not
encrypted at rest. Keep this folder private and do not copy it to hosting or
another installation. `COCANVAS_CHATGPT_DIR` can point to another private local
directory if needed; do not prefix it with `NEXT_PUBLIC_`.

`service.ts` renews access near expiry. A per-user filesystem lock serializes
refreshes across local processes, and saves the rotating refresh token with the
replacement access token/scopes/expiry. Terminal refresh failures clear unusable
tokens while retaining the registration. Temporary failures preserve credentials.
Disconnect attempts revocation with a bounded retry and always clears local
tokens. If remote revocation cannot be confirmed, the UI tells the user to also
disconnect CoCanvas in ChatGPT settings.

No access, refresh, or ID token is put in localStorage, board data, Supabase
tables, or public connection-status responses. An ID-token hint is sent only
as part of the OpenAI authorization URL; do not log/share that URL. Next's
development request logging excludes the callback route to keep authorization
codes out of logs. SDK logging is explicitly disabled.

If you opened the app at `localhost`, the connection panel offers a link to the
same board at `127.0.0.1`. Sign in there once, because browser cookies are scoped
to each host. Connection controls remain accessible while board sync is offline;
generation and board editing stay paused until the editor connection recovers.

### 5. Load the actual account's models and call the OpenAI SDK

`src/app/api/chatgpt/route.ts` exposes authenticated connection actions and
sanitized status. `GET ?models=1` fetches `/v1/models` with the selected account's
OAuth token. Only models marked `visibility: "list"` enter the picker, preserving
server order. Selecting a model validates it against that account's catalog.

`src/lib/ai/chatgpt/inference.ts` constructs the SDK explicitly:

```ts
const client = new OpenAI({
  apiKey: token, // OAuth access token, sent as a Bearer credential
  baseURL: "https://api.openai.com/v1",
  maxRetries: 0,
  timeout: 90_000,
  organization: null,
  project: null,
  logLevel: "off",
});
```

The SDK parameter is named `apiKey`, but its value here is the OAuth access
token, not an API billing key. The app does not read `OPENAI_API_KEY` or switch
to it after a failure.

The request uses the selected model, `store: false`, `stream: true`, an input
array, developer instructions, and the existing analysis JSON schema. It omits
the preview's unsupported generation/storage parameters. Account and model IDs
must still match the user's selection; stale tabs are rejected before inference.
The server consumes the event stream and requires `response.completed`. Failed,
incomplete, oversized, interrupted, or timed-out output never becomes a preview.
Subscription-limit errors direct users to ChatGPT usage settings. HTTP status,
provider code/parameter, and request ID are retained when supplied; no billing
fallback is attempted.

### 6. Keep the existing board workflow

`src/components/chatgpt-connection.tsx` manages account/model/consent controls.
`board-ai-panel.tsx` adds the explicit provider choice. `board-request.ts` sends
the chosen registration ID and model, never credentials. Changing account/model
invalidates the old preview. Effect handles network/domain/storage failures;
React manages rendering, loading, selections, and preview state.

Both server and browser validate the generated JSON and source references.
Confirming still goes through the existing workspace insertion, undo, shared
Yjs updates, and binary persistence. No database migration was introduced.

## Verification and remaining manual check

Run:

```sh
npm run typecheck
npm test -- --maxWorkers=1
npm run test:e2e -- tests/e2e/chatgpt-connection.spec.ts tests/e2e/ai-workflow.spec.ts --workers=1
npm run build
```

OAuth/SDK tests use locally signed mock identity tokens, mock OpenAI responses,
and temporary private credential folders. They cover state/nonce/PKCE, invalid
signatures/claims, returning clients, account isolation, missing permission,
rotation, disconnection, catalog filtering, SDK request shape, and failed streams.
Browser tests exercise the subscription controls and confirm-before-insertion
workflow. Live CoCanvas tests require disposable Supabase fixtures as described
in `docs/foundation.md`.

Verified November 2, 2026: TypeScript passed, 183 unit/protocol tests passed,
and seven browser checks passed across the mocked subscription/AI workflows and
real disposable-account authentication/shared-board workflows. The production
build passed. Its existing duplicate-Yjs warning remains; the earlier build logs
already contained it. New filesystem-tracing warnings were resolved, and all 25
build trace manifests were checked: none included `.local` or `.env` files.

**You must complete the real OpenAI consent flow yourself to verify your
account's eligibility and actual inference.** Automated tests do not establish
that your subscription/workspace has access to this preview. No personal
ChatGPT credentials were reused from Codex, and no subscription request was
made during automated verification.

## References

- [OpenAI registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts, renewal, and revocation](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview requirements](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Usage and consent UI](https://developers.openai.com/siwc/ui-ux-guidelines)
- [Reference demo supplied by the project owner](https://github.com/adrianord/openai-subscription-demo)

The demo's PKCE, callback-cookie, model-catalog, and SDK streaming patterns were
reviewed as a reference. CoCanvas uses its existing Next.js routes and Effect
programs; Express, Vite, and additional authentication libraries were not added.
