import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { AppError } from "../../foundation/contracts";

const tokensSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), id_token: z.string().min(1),
  expires_at: z.number(), earliest_refresh_at: z.number().optional(), scopes: z.array(z.string()),
});
export const registrationSchema = z.object({
  id: z.string(), issuer: z.literal("https://auth.openai.com"), subject: z.string().min(1), client_id: z.string().min(1),
  email: z.string().optional(), name: z.string().optional(), model: z.string().nullable(), welcomeSeen: z.boolean(),
  tokens: tokensSchema.optional(),
});
export type Registration = z.infer<typeof registrationSchema>;
const storeSchema = z.object({ version: z.literal(1), activeId: z.string().nullable(), accounts: z.array(registrationSchema), pendingState: z.string().optional(), retryClientId: z.string().optional() });
export type AccountStore = z.infer<typeof storeSchema>;
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
// Runtime credentials must never be discovered or copied by Next's file tracer.
export const credentialDirectory = () => resolve(/* turbopackIgnore: true */ process.env.COCANVAS_CHATGPT_DIR || join(process.cwd(), ".local", "chatgpt"));

async function privateDirectory() {
  const folder = credentialDirectory();
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await chmod(folder, 0o700);
  return folder;
}

/** Atomic replace: a crash cannot leave a partially written credential record. */
export async function savePrivate(name: string, value: unknown) {
  const folder = await privateDirectory();
  const temporary = join(folder, `.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, join(/* turbopackIgnore: true */ folder, name));
  } finally { await rm(temporary, { force: true }); }
}

export async function readPrivate(name: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ await privateDirectory(), name), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export const removePrivate = async (name: string) => rm(join(/* turbopackIgnore: true */ await privateDirectory(), name), { force: true });

/** Cross-process lock also serializes rotating refresh tokens across dev workers. */
export async function withLock<A>(key: string, work: () => Promise<A>): Promise<A> {
  const lock = join(await privateDirectory(), `${hash(key)}.lock`);
  const deadline = Date.now() + 5000;
  for (;;) {
    try { await mkdir(lock, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Recover only a dead process's lock, never steal a live refresh.
      try {
        const pid = Number(await readFile(join(lock, "pid"), "utf8"));
        if (Number.isSafeInteger(pid) && pid > 0) {
          try { process.kill(pid, 0); } catch (cause) {
            if ((cause as NodeJS.ErrnoException).code === "ESRCH") { await rm(lock, { recursive: true, force: true }); continue; }
          }
        }
      } catch {
        if (Date.now() - (await stat(lock).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs > 120_000) {
          await rm(lock, { recursive: true, force: true }); continue;
        }
      }
      if (Date.now() > deadline) throw new AppError("A ChatGPT connection request is already running. Try again shortly.", 409);
      await new Promise((done) => setTimeout(done, 50));
    }
  }
  try {
    await writeFile(join(lock, "pid"), String(process.pid), { mode: 0o600 });
    return await work();
  } finally { await rm(lock, { recursive: true, force: true }); }
}

export async function hostId() {
  return withLock("host", async () => {
    const existing = await readPrivate("host.json");
    if (existing !== null) return z.object({ id: z.string().regex(/^urn:uuid:[0-9a-f-]{36}$/) }).parse(existing).id;
    const id = `urn:uuid:${randomUUID()}`;
    await savePrivate("host.json", { id });
    return id;
  });
}
export async function loadAccounts(userId: string): Promise<AccountStore> {
  z.uuid().parse(userId);
  const existing = await readPrivate(`user-${hash(userId)}.json`);
  return existing === null ? { version: 1, activeId: null, accounts: [] } : storeSchema.parse(existing);
}
export const saveAccounts = (userId: string, store: AccountStore) => savePrivate(`user-${hash(z.uuid().parse(userId))}.json`, storeSchema.parse(store));

export async function consumePending(state: string): Promise<unknown> {
  const folder = await privateDirectory();
  const claimed = join(folder, `claimed-${randomUUID()}.json`);
  // Rename is the one-time claim; simultaneous callbacks cannot redeem twice.
  await rename(join(folder, `pending-${hash(state)}.json`), claimed);
  try { return JSON.parse(await readFile(claimed, "utf8")); }
  finally { await rm(claimed, { force: true }); }
}
