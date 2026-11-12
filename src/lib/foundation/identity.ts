/** Display-only identity. Never use editable profile metadata for authorization. */
export function accountInitial(account?: { displayName?: string; email?: string }) {
  const label = account?.displayName?.trim() || account?.email?.trim() || "";
  return Array.from(label)[0]?.toLocaleUpperCase() || "?";
}
