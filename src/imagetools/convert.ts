// Batch image conversion helpers that don't touch the DOM.

export type Format = "image/jpeg" | "image/png" | "image/webp";
export const EXT: Record<Format, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const LABEL: Record<Format, string> = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };

/** Scale down to fit within the limits, keeping the aspect ratio. Never scales up. Blank limits are ignored. */
export function fitWithin(width: number, height: number, maxWidth?: number, maxHeight?: number): [number, number] {
  const scale = Math.min(1, maxWidth && maxWidth > 0 ? maxWidth / width : 1, maxHeight && maxHeight > 0 ? maxHeight / height : 1);
  if (scale >= 1) return [width, height];
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** HEIC/HEIF photos (iPhone default) — only Safari can decode them without extra code. */
export function isHeic(name: string, type: string): boolean {
  return /\.(heic|heif)$/i.test(name) || /^image\/hei[cf]/i.test(type);
}

/** Give each output a unique file name, with the new extension: "a.png" → "a.jpg", a second "a.png" → "a (2).jpg". */
export function outputNames(names: string[], ext: string): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const base = (n.replace(/\.[^./\\]+$/, "") || "image").replace(/[\\/:*?"<>|]+/g, "-");
    let name = `${base}.${ext}`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i}).${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** "−63%" / "+12%" / "same" for showing the change in size. */
export function sizeChange(before: number, after: number): string {
  if (!before) return "";
  const pct = Math.round((after / before - 1) * 100);
  return pct === 0 ? "same size" : pct < 0 ? `${-pct}% smaller` : `${pct}% bigger`;
}
