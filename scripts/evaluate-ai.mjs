import { writeFile } from 'node:fs/promises';
import { Effect } from 'effect';
const notes = [
  { id: '20000000-0000-4000-8000-000000000001', text: 'Users need a quick way to find their boards.' },
  { id: '20000000-0000-4000-8000-000000000002', text: 'Prototype search and test it with classmates.' },
  { id: '20000000-0000-4000-8000-000000000003', text: 'Make collaboration status clear when disconnected.' },
];
const results = [];
for (const prompt of ['concise', 'grounded']) {
  const start = Date.now();
  const result = await Effect.runPromise(Effect.tryPromise({ try: async () => {
    const response = await fetch('http://127.0.0.1:3000/api/prototypes/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes, prompt }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return { prompt, elapsedMs: Date.now() - start, ...body };
  }, catch: (cause) => new Error(String(cause)) }));
  results.push(result);
}
await writeFile('docs/ai-live-results.json', JSON.stringify({ provider: "local-codex-cli", authentication: "chatgpt", evaluatedAt: new Date().toISOString(), notes, results }, null, 2) + '\n');
console.log('Saved live Codex CLI results to docs/ai-live-results.json. Review semantic quality as well as validation.');
