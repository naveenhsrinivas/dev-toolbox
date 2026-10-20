// Mapping between PDF user space (points, y up) and the on-screen page (CSS px, y down),
// for any scale and page rotation. Matches pdf.js's PageViewport, which renders the pages.

export interface Pt {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
  scale: number;
  /** Total clockwise display rotation: 0, 90, 180 or 270. */
  rotation: number;
  /** PDF → screen affine transform [a, b, c, d, e, f]. */
  transform: number[];
}

export function normalizeRotation(deg: number): number {
  return (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
}

export function makeViewport(viewBox: number[], scale: number, rotation: number): Viewport {
  const [xMin, yMin, xMax, yMax] = viewBox;
  const cx = (xMax + xMin) / 2;
  const cy = (yMax + yMin) / 2;
  const r = normalizeRotation(rotation);
  const [a, b, c, d] = r === 90 ? [0, 1, 1, 0] : r === 180 ? [-1, 0, 0, 1] : r === 270 ? [0, -1, -1, 0] : [1, 0, 0, -1];
  const sideways = a === 0;
  const offsetX = (sideways ? Math.abs(cy - yMin) : Math.abs(cx - xMin)) * scale;
  const offsetY = (sideways ? Math.abs(cx - xMin) : Math.abs(cy - yMin)) * scale;
  return {
    width: (sideways ? yMax - yMin : xMax - xMin) * scale,
    height: (sideways ? xMax - xMin : yMax - yMin) * scale,
    scale,
    rotation: r,
    transform: [
      a * scale,
      b * scale,
      c * scale,
      d * scale,
      offsetX - a * scale * cx - c * scale * cy,
      offsetY - b * scale * cx - d * scale * cy,
    ],
  };
}

export function toScreen(vp: Viewport, p: Pt): Pt {
  const [a, b, c, d, e, f] = vp.transform;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

export function toPdf(vp: Viewport, p: Pt): Pt {
  const [a, b, c, d, e, f] = vp.transform;
  const det = a * d - b * c;
  return { x: (d * (p.x - e) - c * (p.y - f)) / det, y: (a * (p.y - f) - b * (p.x - e)) / det };
}

/** A screen-space movement as a PDF-space movement. */
export function deltaToPdf(vp: Viewport, dx: number, dy: number): Pt {
  const o = toPdf(vp, { x: 0, y: 0 });
  const p = toPdf(vp, { x: dx, y: dy });
  return { x: p.x - o.x, y: p.y - o.y };
}

/** Screen rectangle (any two corners) for a PDF-space rectangle. */
export function rectToScreen(vp: Viewport, x1: number, y1: number, x2: number, y2: number) {
  const p = toScreen(vp, { x: x1, y: y1 });
  const q = toScreen(vp, { x: x2, y: y2 });
  return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(p.x - q.x), h: Math.abs(p.y - q.y) };
}
