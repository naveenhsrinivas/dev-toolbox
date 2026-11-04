// Image resizing logic that doesn't touch the DOM, so it can be tested.

export const MAX_SIDE = 16384;

export type ResizeBy = { by: "original" } | { by: "percent"; percent: number } | { by: "pixels"; width?: number; height?: number };

/** Output width and height. With only one side given, the other keeps the aspect ratio. */
export function targetDimensions(width: number, height: number, r: ResizeBy): [number, number] {
  const clamp = (n: number) => Math.min(MAX_SIDE, Math.max(1, Math.round(n)));
  if (r.by === "percent") return [clamp((width * r.percent) / 100), clamp((height * r.percent) / 100)];
  if (r.by === "pixels") {
    const w = r.width && r.width > 0 ? r.width : undefined;
    const hh = r.height && r.height > 0 ? r.height : undefined;
    if (w && hh) return [clamp(w), clamp(hh)];
    if (w) return [clamp(w), clamp((height * w) / width)];
    if (hh) return [clamp((width * hh) / height), clamp(hh)];
  }
  return [width, height];
}

export interface FitResult<T> {
  out: T;
  size: number;
  quality: number;
  scale: number;
  /** False when even the smallest attempt was over the target. */
  fits: boolean;
}

export interface FitOptions {
  /** Whether quality can be lowered (JPEG, WebP). */
  lossy: boolean;
  /** Whether the image may be made smaller than asked when quality alone isn't enough. */
  allowShrink: boolean;
  maxQuality?: number;
  minQuality?: number;
}

/**
 * Find the best-looking encoding no bigger than `target` bytes: the highest
 * quality that fits, and only if that isn't enough, smaller dimensions.
 */
export async function fitToSize<T>(
  encode: (quality: number, scale: number) => Promise<{ out: T; size: number }>,
  target: number,
  { lossy, allowShrink, maxQuality = 0.92, minQuality = 0.1 }: FitOptions,
): Promise<FitResult<T>> {
  let scale = 1;
  let smallest: FitResult<T> | undefined;
  for (let round = 0; round < 12; round++) {
    const top = await encode(lossy ? maxQuality : 1, scale);
    if (top.size <= target) return { ...top, quality: lossy ? maxQuality : 1, scale, fits: true };
    let floor = top;
    let floorQ = 1;
    if (lossy) {
      floor = await encode(minQuality, scale);
      floorQ = minQuality;
      if (floor.size <= target) {
        // Binary search for the highest quality that still fits.
        let lo = minQuality;
        let hi = maxQuality;
        let best = { ...floor, quality: lo };
        for (let i = 0; i < 7; i++) {
          const mid = (lo + hi) / 2;
          const r = await encode(mid, scale);
          if (r.size <= target) {
            lo = mid;
            best = { ...r, quality: mid };
          } else hi = mid;
        }
        return { ...best, scale, fits: true };
      }
    }
    if (!smallest || floor.size < smallest.size) smallest = { ...floor, quality: floorQ, scale, fits: false };
    if (!allowShrink) break;
    // File size grows roughly with pixel count, so shrink each side by the square root.
    scale *= Math.min(0.9, Math.max(0.3, Math.sqrt(target / floor.size) * 0.95));
    if (scale < 0.005) break;
  }
  return smallest!;
}

/** Whether padImage can grow files of this type (JPEG and PNG). */
export function canPad(type: string): boolean {
  return type === "image/jpeg" || type === "image/png";
}

/**
 * Grow a JPEG or PNG to exactly `target` bytes with comment data that viewers
 * ignore. The picture is unchanged. Returns the input if it's already that size or bigger.
 */
export function padImage(bytes: Uint8Array, type: string, target: number): Uint8Array {
  const extra = target - bytes.length;
  if (extra <= 0) return bytes;
  if (type === "image/jpeg") return padJpeg(bytes, extra);
  if (type === "image/png") return padPng(bytes, extra);
  return bytes;
}

function padJpeg(bytes: Uint8Array, extra: number): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Not a JPEG");
  // COM segments (FF FE + 2-byte length) right after the start marker. A segment
  // is 4–65537 bytes, so split the padding into evenly sized ones.
  const out = new Uint8Array(bytes.length + extra);
  out.set(bytes.subarray(0, 2), 0);
  let pos = 2;
  if (extra < 4) {
    // Too small for a segment: put it after the end marker, where decoders stop reading.
    out.set(bytes.subarray(2), 2);
    out.fill(0, bytes.length);
    return out;
  }
  const count = Math.ceil(extra / 65537);
  let left = extra;
  for (let i = 0; i < count; i++) {
    const size = Math.ceil(left / (count - i));
    out[pos] = 0xff;
    out[pos + 1] = 0xfe;
    out[pos + 2] = (size - 2) >> 8;
    out[pos + 3] = (size - 2) & 0xff;
    out.fill(0x20, pos + 4, pos + size);
    pos += size;
    left -= size;
  }
  out.set(bytes.subarray(2), pos);
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function padPng(bytes: Uint8Array, extra: number): Uint8Array {
  // A private ancillary chunk ("paDd") just before IEND, which decoders skip.
  // Its 12 bytes of framing mean anything under 12 extra bytes can't be added.
  if (extra < 12) return bytes;
  const iend = bytes.length - 12;
  const tag = String.fromCharCode(...bytes.subarray(iend + 4, iend + 8));
  if (tag !== "IEND") throw new Error("Not a PNG");
  const dataLen = extra - 12;
  const chunk = new Uint8Array(extra);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, dataLen);
  chunk.set([0x70, 0x61, 0x44, 0x64], 4); // "paDd"
  chunk.fill(0x20, 8, 8 + dataLen);
  view.setUint32(8 + dataLen, crc32(chunk.subarray(4, 8 + dataLen)));
  const out = new Uint8Array(bytes.length + extra);
  out.set(bytes.subarray(0, iend), 0);
  out.set(chunk, iend);
  out.set(bytes.subarray(iend), iend + extra);
  return out;
}
