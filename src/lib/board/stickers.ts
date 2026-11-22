/** Unicode text only; OS emoji fonts render the glyphs. No FigJam artwork is copied or bundled. */
export const stickers = [
  { id: "celebrate", glyph: "🎉", label: "Celebrate", category: "Reactions" },
  { id: "approve", glyph: "👍", label: "Thumbs up", category: "Reactions" },
  { id: "love", glyph: "❤️", label: "Love it", category: "Reactions" },
  { id: "sparkle", glyph: "✨", label: "Sparkles", category: "Reactions" },
  { id: "idea", glyph: "💡", label: "Bright idea", category: "Thinking" },
  { id: "target", glyph: "🎯", label: "On target", category: "Thinking" },
  { id: "question", glyph: "❓", label: "Question", category: "Thinking" },
  { id: "break", glyph: "☕", label: "Take a break", category: "Thinking" },
] as const;
export function stickerAsset(id: string) {
  return stickers.find((item) => item.id === id) ?? { id, glyph: "◇", label: "Unavailable sticker", category: "Other" };
}
