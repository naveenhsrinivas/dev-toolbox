// Pure helpers for Image to PDF: recognising image files, reading JPEG headers,
// and placing an image on a page. No DOM, so it's tested in node.

export type ImageKind = "jpeg" | "png" | "webp" | "gif" | "bmp";
export type PageSize = "fit" | "a4" | "letter";
export type Orientation = "auto" | "portrait" | "landscape";
export type Margin = "none" | "small" | "large";
export type Quality = "original" | "high" | "medium" | "small";

/** Page sizes in PDF points (1/72 inch), portrait. */
export const PAGE_SIZES: Record<Exclude<PageSize, "fit">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** Margins in points: none, about 6 mm, about 19 mm. */
export const MARGINS: Record<Margin, number> = { none: 0, small: 18, large: 54 };

/** Re-encoding settings. "original" keeps JPEG bytes and stores other images losslessly. */
export const QUALITY: Record<Exclude<Quality, "original">, { quality: number; maxSide: number }> = {
  high: { quality: 0.9, maxSide: 4000 },
  medium: { quality: 0.75, maxSide: 2400 },
  small: { quality: 0.6, maxSide: 1600 },
};

/** Images are assumed to be 96 pixels per inch when the page is fitted to the image. */
export const POINTS_PER_PIXEL = 0.75;
/** The largest page side PDF viewers are required to support (200 inches). */
export const MAX_PAGE_SIDE = 14400;

/** Recognise a supported image from its first bytes; the file name and type can't be trusted. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const at = (i: number, ...sig: number[]) => sig.every((b, k) => bytes[i + k] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (at(0, 0x42, 0x4d)) return "bmp";
  return null;
}

export interface JpegInfo {
  width: number;
  height: number;
  components: number;
  /** Sample precision: almost always 8. */
  bits: number;
  /** The start-of-frame marker: 0xc0 baseline, 0xc1 extended, 0xc2 progressive, others are rare. */
  sof: number;
  /** EXIF orientation, 1–8 (1 when missing). */
  orientation: number;
}

/** Read a JPEG's frame header and EXIF orientation without decoding it. */
export function readJpeg(bytes: Uint8Array): JpegInfo | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let orientation = 1;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1];
    if (marker === 0xff) {
      p++; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      p += 2;
      continue;
    }
    const len = v.getUint16(p + 2);
    if (len < 2 || p + 2 + len > bytes.length) return null;
    const seg = p + 4;
    if (marker === 0xe1 && len >= 8 && String.fromCharCode(...bytes.subarray(seg, seg + 6)) === "Exif\0\0") {
      orientation = exifOrientation(v, seg + 6, len - 8) ?? orientation;
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && len >= 8) {
      return {
        bits: bytes[seg],
        height: v.getUint16(seg + 1),
        width: v.getUint16(seg + 3),
        components: bytes[seg + 5],
        sof: marker,
        orientation,
      };
    }
    if (marker === 0xda) return null; // image data before any frame header
    p += 2 + len;
  }
  return null;
}

function exifOrientation(v: DataView, tiff: number, length: number): number | null {
  const end = tiff + length;
  if (tiff + 8 > end) return null;
  const order = v.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const le = order === 0x4949;
  const ifd = tiff + v.getUint32(tiff + 4, le);
  if (ifd + 2 > end) return null;
  const count = v.getUint16(ifd, le);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (v.getUint16(entry, le) === 0x0112) {
      const value = v.getUint16(entry + 8, le);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/**
 * Whether pdf-lib can embed these JPEG bytes as they are and every PDF viewer
 * will show them correctly. CMYK, 12-bit and arithmetic-coded JPEGs are re-encoded.
 */
export function canKeepJpeg(info: JpegInfo): boolean {
  return info.bits === 8 && (info.components === 1 || info.components === 3) && [0xc0, 0xc1, 0xc2].includes(info.sof);
}

// ---------- Placement ----------

/** A PDF transformation matrix [a b c d e f]: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export type Matrix = [number, number, number, number, number, number];

/** Apply `first`, then `second`. */
export function compose(second: Matrix, first: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [a2 * a1 + c2 * b1, b2 * a1 + d2 * b1, a2 * c1 + c2 * d1, b2 * c1 + d2 * d1, a2 * e1 + c2 * f1 + e2, b2 * e1 + d2 * f1 + f2];
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// Transforms of the unit square, where the image's top row is at y = 1.
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const ROTATE_CW: Matrix = [0, -1, 1, 0, 0, 1];
const FLIP_H: Matrix = [-1, 0, 0, 1, 1, 0];
const FLIP_V: Matrix = [1, 0, 0, -1, 0, 1];

function rotations(quarterTurns: number): Matrix {
  let m = IDENTITY;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) m = compose(ROTATE_CW, m);
  return m;
}

/** What EXIF orientation 1–8 asks a viewer to do to the stored pixels. */
function exifMatrix(orientation: number): Matrix {
  switch (orientation) {
    case 2:
      return FLIP_H;
    case 3:
      return rotations(2);
    case 4:
      return FLIP_V;
    case 5:
      return compose(FLIP_H, ROTATE_CW);
    case 6:
      return ROTATE_CW;
    case 7:
      return compose(FLIP_V, ROTATE_CW);
    case 8:
      return rotations(3);
    default:
      return IDENTITY;
  }
}

/** Whether the image's width and height trade places once it's shown upright. */
export function swapsSides(orientation: number, quarterTurns: number): boolean {
  return (orientation >= 5 && orientation <= 8) !== (((quarterTurns % 2) + 2) % 2 === 1);
}

/** Size of the image as it will appear: after EXIF orientation and the user's clockwise quarter turns. */
export function shownSize(width: number, height: number, orientation: number, quarterTurns: number): [number, number] {
  return swapsSides(orientation, quarterTurns) ? [height, width] : [width, height];
}

/**
 * The matrix that draws an image XObject (which fills the unit square) upright
 * into `rect`, after applying its EXIF orientation and then the user's clockwise
 * quarter turns.
 */
export function placementMatrix(orientation: number, quarterTurns: number, rect: { x: number; y: number; w: number; h: number }): Matrix {
  const turn = compose(rotations(quarterTurns), exifMatrix(orientation));
  return compose([rect.w, 0, 0, rect.h, rect.x, rect.y], turn);
}

export interface PageLayout {
  pageWidth: number;
  pageHeight: number;
  /** Where the upright image goes on the page, in points from the bottom-left. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Size the page and centre the image on it, scaled to fit inside the margins. */
export function layoutPage(
  imageWidth: number,
  imageHeight: number,
  options: { pageSize: PageSize; orientation: Orientation; margin: Margin },
): PageLayout {
  const m = MARGINS[options.margin];
  if (options.pageSize === "fit") {
    let w = imageWidth * POINTS_PER_PIXEL;
    let h = imageHeight * POINTS_PER_PIXEL;
    const k = Math.min(1, (MAX_PAGE_SIDE - 2 * m) / Math.max(w, h));
    w *= k;
    h *= k;
    return { pageWidth: w + 2 * m, pageHeight: h + 2 * m, x: m, y: m, w, h };
  }
  const [short, long] = PAGE_SIZES[options.pageSize];
  const landscape = options.orientation === "landscape" || (options.orientation === "auto" && imageWidth > imageHeight);
  const [pageWidth, pageHeight] = landscape ? [long, short] : [short, long];
  const k = Math.min((pageWidth - 2 * m) / imageWidth, (pageHeight - 2 * m) / imageHeight);
  const w = imageWidth * k;
  const h = imageHeight * k;
  return { pageWidth, pageHeight, x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, w, h };
}

/** Pixel size to re-encode at: the longest side is capped at `maxSide`, never enlarged. */
export function scaleToMax(width: number, height: number, maxSide: number): [number, number] {
  const k = Math.min(1, maxSide / Math.max(width, height));
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}
