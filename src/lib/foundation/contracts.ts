import { z } from "zod";
export const emailSchema = z.string().trim().pipe(z.email().max(254)).transform((value) => value.toLowerCase());
export const loginSchema = z.strictObject({ email: emailSchema, password: z.string().min(1).max(128) });
export const signupSchema = z.strictObject({ email: emailSchema, password: z.string().min(12).max(128) });
export const titleSchema = z.string().trim().min(1).max(120);
export const accessInputSchema = z.strictObject({ email: emailSchema, permission: z.enum(["viewer", "editor"]) });
export const boardInputSchema = z.strictObject({ title: titleSchema });
export const idSchema = z.uuid();
export const boardRowSchema = z.object({ id: z.uuid(), owner_id: z.uuid(), title: titleSchema, created_at: z.string(), updated_at: z.string() });
export type BoardRow = z.infer<typeof boardRowSchema>;
export class AppError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}
export function safeNext(value: string | null) {
  return value && (value === "/dashboard" || /^\/boards\/[0-9a-f-]{36}$/i.test(value)) ? value : "/dashboard";
}
