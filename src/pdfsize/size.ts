/** Parse a size like "500" or "1.5" in the given unit into bytes (1 KB = 1024 bytes). Null if invalid. */
export function parseSize(text: string, unit: "KB" | "MB"): number | null {
  const n = Number(text.trim().replace(",", "."));
  if (!text.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * (unit === "KB" ? 1024 : 1024 * 1024));
}
