# Dependency install repair — November 2, 2026

## What happened

`npm install openai` installed the SDK successfully but printed audit findings
from the existing Vercel JavaScript CLI's transitive dependency tree. npm reports
affected parent packages as well as the vulnerable underlying dependencies, so
the list included many Vercel framework adapters that CoCanvas does not use.
`npm audit fix --force` changed Vercel's requested version without resolving all
of its upstream pins. Forcing a Zod 3 consumer to Zod 4, or downgrading Vercel to
npm's suggested old major version, would not be a safe general compatibility fix.

A clean-install check also exposed a missing optional @emnapi/runtime lock entry.
The lockfile was repaired with no existing node_modules directory present, then
verified by a real `npm ci` and a repeated `npm install openai` / clean-install
check. Existing application dependency versions were retained.

## Changes

- Keep the user's updated OpenAI SDK (`openai` 7.47.0) installed.
- Replace the `vercel` JavaScript CLI dev dependency with Vercel's official
  `@vercel/vc-native` 65.10.0. It exposes the same `vercel` and `vc` commands and
  removes the unused Node.js framework-builder dependency tree from this project.
- Remove the obsolete tar / Vercel-undici overrides; those dependency paths are
  no longer installed. This removes the vulnerable packages rather than
  suppressing audit reports or moving them to another project directory.
- Repair and commit the lockfile together with package.json.

[Vercel's native CLI announcement](https://vercel.com/changelog/experimental-native-binaries-for-vercel-cli)
and [repository installation guidance](https://github.com/vercel/vercel#native-cli-binaries)
describe the official alternative. It remains upstream's native CLI distribution;
no application library, backend provider, or hosting platform was changed.

## Verified

- `npm install openai`: succeeds, zero audit vulnerabilities.
- `npm ci`: succeeds from an empty dependency directory.
- Repeating the OpenAI install preserves a valid clean-installable lockfile.
- `npm audit`: zero vulnerabilities across runtime and development dependencies.
- OpenAI SDK imports successfully without making an API request.
- Native Vercel CLI starts at 65.10.0 and can inspect the existing CoCanvas project.
- TypeScript, all 159 unit/protocol tests, and the production build pass.

The previous development-tool findings in `docs/critical-defects.md` describe the
October 29 state; they are resolved in the current project dependency graph by
this replacement. npm's audit is not an assessment of the remote hosting platform
or a guarantee against unknown vulnerabilities.

## Commands to use

```sh
npm ci                   # install exactly the committed lockfile
npm install openai       # deliberately update/install the SDK
npm audit                # inspect actual dependency advisories
npm run typecheck
npm test -- --maxWorkers=1
./node_modules/.bin/vercel --version
```

Avoid routinely running `npm audit fix --force`: inspect its proposed version and
API changes first. Never place API keys, .env files, or CLI login credentials in
package.json or a commit. The application still uses the existing local Codex
provider; this repair does not add API-backed generation or make paid API calls.
