// The document being edited: pages (from opened PDFs or blank) and what was added to them.
// All positions are in PDF user space (points), so they survive zooming and rotating.
import type { Pt } from "./geometry";

export type FontName = "Helvetica" | "Times" | "Courier";

export interface TextAnn {
  id: string;
  type: "text";
  /** Start of the first line's baseline. */
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  font: FontName;
  /** The page rotation the text was written at; it's drawn upright at that rotation. */
  rotation: number;
}

export interface RectAnn {
  id: string;
  type: "rect";
  style: "whiteout" | "highlight" | "box";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export interface InkAnn {
  id: string;
  type: "ink";
  points: Pt[];
  color: string;
  width: number;
}

export interface ImageAnn {
  id: string;
  type: "image";
  /** Bottom-left corner as seen when placed, plus size in points. */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  imageId: string;
}

export type Annotation = TextAnn | RectAnn | InkAnn | ImageAnn;

export interface PageModel {
  key: string;
  /** Page `index` of opened file `source`, or a blank page of the given size. */
  src: { source: number; index: number } | { blank: true; width: number; height: number };
  /** Rotation added in the editor, on top of the page's own. */
  userRotation: number;
  annotations: Annotation[];
}

export interface StoredImage {
  bytes: Uint8Array;
  kind: "png" | "jpg";
  url: string;
  width: number;
  height: number;
}

let counter = 0;
export const newId = (prefix = "a") => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export const LINE_HEIGHT = 1.2;

// Characters the standard PDF fonts can show (Windows-1252).
const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** Characters in `text` that the built-in PDF fonts can't draw. */
export function unsupportedChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const ok = ch === "\n" || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.includes(ch);
    if (!ok) bad.add(ch);
  }
  return [...bad];
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.type) {
    case "text":
    case "image":
      return { ...a, x: a.x + dx, y: a.y + dy };
    case "rect":
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case "ink":
      return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
}
