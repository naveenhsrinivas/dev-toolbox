// Crop and rotate math, free of the DOM so it can be tested. All rectangles are in output-image pixels, in the
// space of the rotated image's bounding box (origin at its top-left).

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Orientation from the 90° buttons and the flips: the source is mirrored horizontally first (when `mirror`),
 * then turned clockwise by `quarter` × 90°, then by the fine `angle` in degrees (clockwise is positive).
 */
export interface Orientation {
  quarter: 0 | 1 | 2 | 3;
  mirror: boolean;
  angle: number;
}

export const IDENTITY: Orientation = { quarter: 0, mirror: false, angle: 0 };

const mod4 = (n: number) => (((n % 4) + 4) % 4) as Orientation["quarter"];

export function rotate90(o: Orientation, dir: 1 | -1): Orientation {
  return { ...o, quarter: mod4(o.quarter + dir) };
}

/** Mirror what's on screen. The fine angle changes sign so the picture stays straightened, just mirrored. */
export function flip(o: Orientation, axis: "horizontal" | "vertical"): Orientation {
  // FlipH · Rot(q) = Rot(-q) · FlipH, and FlipV = Rot(180°) · FlipH.
  const quarter = axis === "horizontal" ? mod4(-o.quarter) : mod4(2 - o.quarter);
  return { quarter, mirror: !o.mirror, angle: o.angle === 0 ? 0 : -o.angle };
}

/** Total clockwise rotation in degrees. */
export function totalAngle(o: Orientation): number {
  return o.quarter * 90 + o.angle;
}

/** Size of the source once its quarter turns are applied (before the fine angle). */
export function orientedSize(src: Size, o: Orientation): Size {
  return o.quarter % 2 ? { width: src.height, height: src.width } : { width: src.width, height: src.height };
}

/** Bounding box of a w×h rectangle rotated by `deg`. Rounded up to whole pixels. */
export function rotatedBounds(size: Size, deg: number): Size {
  const r = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  // Tiny epsilon so 90° turns don't round 1000.0000000001 up to 1001.
  const ceil = (n: number) => Math.ceil(n - 1e-6);
  return { width: ceil(size.width * c + size.height * s), height: ceil(size.width * s + size.height * c) };
}

/** Bounding box of the whole transformed source. */
export function canvasSize(src: Size, o: Orientation): Size {
  return rotatedBounds(orientedSize(src, o), o.angle);
}

/**
 * The largest rectangle with the given aspect ratio (width / height) that is centred in the bounding box and
 * lies entirely inside the image after rotating it by `angle` — so the crop has no empty corners.
 * Without an aspect, the image's own aspect is used.
 */
export function inscribedRect(image: Size, angle: number, aspect?: number): Rect {
  const bounds = rotatedBounds(image, angle);
  const k = aspect ?? image.width / image.height;
  const r = (angle * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  // Half-sizes (a, b) with a = k·b must satisfy a·c + b·s ≤ W/2 and a·s + b·c ≤ H/2 at the worst corner.
  const b = Math.min(image.width / 2 / (k * c + s), image.height / 2 / (k * s + c));
  let height = Math.max(1, Math.floor(2 * b + 1e-6));
  let width = Math.max(1, Math.floor(height * k + 1e-6));
  if (width > bounds.width) {
    width = bounds.width;
    height = Math.max(1, Math.round(width / k));
  }
  return { x: Math.floor((bounds.width - width) / 2), y: Math.floor((bounds.height - height) / 2), width, height };
}

/** Keep a rectangle inside the bounds: shrink it if it's too big, then slide it in. Rounds to whole pixels. */
export function clampRect(rect: Rect, bounds: Size, aspect?: number): Rect {
  let width = Math.max(1, Math.round(rect.width));
  let height = Math.max(1, Math.round(rect.height));
  if (aspect) {
    const w = Math.min(width, bounds.width, bounds.height * aspect);
    if (w < width) {
      width = Math.max(1, Math.round(w));
      height = Math.max(1, Math.round(width / aspect));
    }
  }
  width = Math.min(width, bounds.width);
  height = Math.min(height, bounds.height);
  const x = Math.min(Math.max(0, Math.round(rect.x)), bounds.width - width);
  const y = Math.min(Math.max(0, Math.round(rect.y)), bounds.height - height);
  return { x, y, width, height };
}

export function moveRect(start: Rect, dx: number, dy: number, bounds: Size): Rect {
  return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, bounds);
}

type Anchor = "start" | "end" | "center";

/**
 * Resize by dragging a handle by (dx, dy) from where the drag started. The opposite edge or corner stays put;
 * an edge handle with a fixed aspect grows the other side evenly about the centre. The result stays inside
 * `bounds` and keeps `aspect` when given.
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, bounds: Size, aspect?: number, minSize = 1): Rect {
  const driveX = handle.includes("e") || handle.includes("w");
  const driveY = handle.includes("n") || handle.includes("s");
  // Which side of the box stays fixed on each axis.
  const ax: Anchor = handle.includes("e") ? "start" : handle.includes("w") ? "end" : "center";
  const ay: Anchor = handle.includes("s") ? "start" : handle.includes("n") ? "end" : "center";

  let w = driveX ? start.width + (handle.includes("e") ? dx : -dx) : start.width;
  let h = driveY ? start.height + (handle.includes("s") ? dy : -dy) : start.height;

  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const cx = start.x + start.width / 2;
  const cy = start.y + start.height / 2;
  const room = (anchor: Anchor, lo: number, hi: number, center: number, extent: number) =>
    anchor === "start" ? extent - lo : anchor === "end" ? hi : 2 * Math.min(center, extent - center);
  const roomW = room(ax, start.x, right, cx, bounds.width);
  const roomH = room(ay, start.y, bottom, cy, bounds.height);

  if (aspect) {
    // Follow whichever axis the pointer pulled further; edge handles only pull one.
    if (driveX && driveY) w = Math.max(w, h * aspect);
    else if (driveY) w = h * aspect;
    w = Math.max(w, minSize, minSize * aspect);
    w = Math.min(w, roomW, roomH * aspect);
    h = w / aspect;
  } else {
    w = Math.min(Math.max(w, minSize), roomW);
    h = Math.min(Math.max(h, minSize), roomH);
  }
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));

  const place = (anchor: Anchor, lo: number, hi: number, center: number, size: number) =>
    anchor === "start" ? lo : anchor === "end" ? hi - size : center - size / 2;
  return clampRect({ x: place(ax, start.x, right, cx, w), y: place(ay, start.y, bottom, cy, h), width: w, height: h }, bounds);
}

/** Change the size from the number inputs, keeping the centre where possible. */
export function resizeAroundCenter(rect: Rect, width: number, height: number, bounds: Size, aspect?: number): Rect {
  let w = Math.max(1, width);
  let h = Math.max(1, height);
  if (aspect) h = w / aspect;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return clampRect({ x: cx - w / 2, y: cy - h / 2, width: w, height: h }, bounds, aspect);
}

/** Mirror a rectangle within the bounds, for keeping the crop on the same content after a flip. */
export function mirrorRect(rect: Rect, bounds: Size, axis: "horizontal" | "vertical"): Rect {
  return axis === "horizontal" ? { ...rect, x: bounds.width - rect.x - rect.width } : { ...rect, y: bounds.height - rect.y - rect.height };
}

/** Parse "16:9", "4/3", "1.5" or "35x45" into width / height. */
export function parseAspect(text: string): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[:/x×]\s*(\d+(?:\.\d+)?))?\s*$/i.exec(text);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = m[2] === undefined ? 1 : Number(m[2]);
  return a > 0 && b > 0 ? a / b : undefined;
}
