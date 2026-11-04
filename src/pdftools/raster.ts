// Pure helpers for PDF to Images: output sizes and file names.

/**
 * Browsers refuse to draw canvases beyond a certain size (16384 px a side and
 * about 268 million pixels in Chrome, far less on phones), so pages are kept
 * within these limits.
 */
export const MAX_SIDE = 16384;
export const MAX_PIXELS = 50_000_000;
export const MIN_DPI = 36;
export const MAX_DPI = 1200;

export interface RenderSize {
  /** pdf.js scale: 1 is 72 dpi. */
  scale: number;
  width: number;
  height: number;
  /** The resolution actually used. */
  dpi: number;
  /** True when the requested resolution was lowered to fit the limits. */
  limited: boolean;
}

/** Pixel size of a page that is `width` × `height` points, drawn at `dpi`. */
export function renderSize(width: number, height: number, dpi: number): RenderSize {
  let scale = dpi / 72;
  const fit = Math.min(
    1,
    MAX_SIDE / (width * scale),
    MAX_SIDE / (height * scale),
    Math.sqrt(MAX_PIXELS / (width * height * scale * scale)),
  );
  const limited = fit < 1;
  scale *= fit;
  // Round normally (A4 at 300 dpi is 2480 × 3508), but never past a limit.
  const px = limited ? Math.floor : Math.round;
  return {
    scale,
    width: Math.max(1, px(width * scale)),
    height: Math.max(1, px(height * scale)),
    dpi: limited ? Math.floor(scale * 72) : dpi,
    limited,
  };
}

/** Parse a custom resolution, or explain what's wrong with it. */
export function parseDpi(text: string): { ok: true; dpi: number } | { ok: false; error: string } {
  const n = Number(text.trim());
  if (!text.trim() || !Number.isFinite(n)) return { ok: false, error: "Enter a resolution in dpi, like 200" };
  if (n < MIN_DPI || n > MAX_DPI) return { ok: false, error: `Pick a resolution from ${MIN_DPI} to ${MAX_DPI} dpi` };
  return { ok: true, dpi: Math.round(n) };
}

/** Keep the first time each page appears, so no image is made twice. */
export function distinctPages(pages: number[]): number[] {
  return [...new Set(pages)];
}

/** "report-page-007.png": page numbers padded to the page count so files sort in order. */
export function pageFileName(base: string, page: number, pageCount: number, ext: string): string {
  return `${base}-page-${String(page + 1).padStart(String(pageCount).length, "0")}.${ext}`;
}
