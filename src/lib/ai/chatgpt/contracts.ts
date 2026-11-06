import { z } from "zod";

export const modelSchema = z.object({ slug: z.string().min(1).max(200), display_name: z.string().min(1).max(200) });
export const connectionSchema = z.object({
  activeId: z.string().nullable(),
  accounts: z.array(z.object({
    id: z.string(), label: z.string(), connected: z.boolean(), planEnabled: z.boolean(),
    model: z.string().nullable(), welcomeSeen: z.boolean(),
  })),
});
export type ChatGPTConnection = z.infer<typeof connectionSchema>;
export type ChatGPTModel = z.infer<typeof modelSchema>;
export const connectionActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("connect"), accountId: z.string().max(64).optional(), returnTo: z.string().max(300), enablePlan: z.boolean().optional() }),
  z.strictObject({ action: z.literal("disconnect"), accountId: z.string().max(64) }),
  z.strictObject({ action: z.literal("select"), accountId: z.string().max(64) }),
  z.strictObject({ action: z.literal("model"), model: z.string().min(1).max(200) }),
  z.strictObject({ action: z.literal("welcome") }),
]);
