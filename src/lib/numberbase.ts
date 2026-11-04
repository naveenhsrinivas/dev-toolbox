// Integer base conversion, two's complement and bitwise maths on BigInt, so size is unlimited.

export type Width = 8 | 16 | 32 | 64;
export type ParseResult = { ok: true; value: bigint } | { ok: false; error: string };

const BASE_NAMES: Record<number, string> = { 2: "binary", 8: "octal", 10: "decimal", 16: "hex" };
const PREFIX: Record<string, number> = { "0b": 2, "0o": 8, "0x": 16 };
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
/** Keeps a typo'd paste of a huge blob from freezing the page. */
export const MAX_DIGITS = 20_000;

export function baseName(base: number): string {
  return BASE_NAMES[base] ?? `base ${base}`;
}

/**
 * Read an integer written in `base`. Spaces, underscores and commas are ignored, a leading - or + is allowed,
 * and a matching 0b/0o/0x prefix is accepted (a decimal field accepts any of them).
 */
export function parseInteger(text: string, base: number): ParseResult {
  if (!Number.isInteger(base) || base < 2 || base > 36) return { ok: false, error: "The base must be between 2 and 36." };
  let s = text.replace(/[\s_,]+/g, "").toLowerCase();
  if (!s) return { ok: false, error: "Enter a number." };
  let negative = false;
  if (s[0] === "-" || s[0] === "+") {
    negative = s[0] === "-";
    s = s.slice(1);
  }
  let b = base;
  const prefix = PREFIX[s.slice(0, 2)];
  if (prefix && (base === 10 || prefix === base)) {
    if (s.length === 2) return { ok: false, error: `Enter some digits after ${s}.` };
    b = prefix;
    s = s.slice(2);
  }
  if (!s) return { ok: false, error: "Enter some digits after the sign." };
  if (s.length > MAX_DIGITS)
    return { ok: false, error: `That's more than ${MAX_DIGITS.toLocaleString()} digits, which is too long to convert here.` };
  for (const ch of s) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= b) {
      const allowed = b <= 10 ? `0–${b - 1}` : `0–9 and a–${DIGITS[b - 1]}`;
      return { ok: false, error: `"${ch}" isn't a valid ${baseName(b)} digit. Use ${allowed}.` };
    }
  }
  let value: bigint;
  if (b in BASE_NAMES) value = BigInt(b === 10 ? s : `0${{ 2: "b", 8: "o", 16: "x" }[b]}${s}`);
  else {
    // Chunked so a long number doesn't need one BigInt multiply per digit.
    value = 0n;
    const big = BigInt(b);
    const chunk = Math.floor(Math.log(Number.MAX_SAFE_INTEGER) / Math.log(b));
    for (let i = 0; i < s.length; i += chunk) {
      const part = s.slice(i, i + chunk);
      value = value * big ** BigInt(part.length) + BigInt(parseInt(part, b));
    }
  }
  return { ok: true, value: negative ? -value : value };
}

/** Read A or B in the bitwise calculator: decimal unless it has a 0b/0o/0x prefix. */
export function parseAuto(text: string): ParseResult {
  return parseInteger(text, 10);
}

export interface FormatOptions {
  /** Pad to this many bits (binary/octal/hex only). */
  width?: number;
  group?: boolean;
  upper?: boolean;
}

const GROUP: Record<number, number> = { 2: 4, 8: 3, 10: 3, 16: 4 };

export function formatInteger(value: bigint, base: number, opts: FormatOptions = {}): string {
  const negative = value < 0n;
  let s = (negative ? -value : value).toString(base);
  if (opts.width && !negative && (base === 2 || base === 8 || base === 16)) {
    s = s.padStart(Math.ceil(opts.width / Math.log2(base)), "0");
  }
  if (opts.upper) s = s.toUpperCase();
  if (opts.group) s = groupDigits(s, GROUP[base] ?? 4, base === 10 ? "," : " ");
  return negative ? `-${s}` : s;
}

/** Group digits from the right: "1101010" → "110 1010". */
export function groupDigits(s: string, size: number, sep = " "): string {
  const out: string[] = [];
  for (let end = s.length; end > 0; end -= size) out.unshift(s.slice(Math.max(0, end - size), end));
  return out.join(sep);
}

export const minSigned = (w: number) => -(1n << BigInt(w - 1));
export const maxUnsigned = (w: number) => (1n << BigInt(w)) - 1n;

/** Whether `value` can be stored in `w` bits, either as signed or as unsigned. */
export function fitsWidth(value: bigint, w: number): boolean {
  return value >= minSigned(w) && value <= maxUnsigned(w);
}

/** The w-bit pattern for `value` (negative numbers become two's complement). */
export function toBits(value: bigint, w: number): bigint {
  return BigInt.asUintN(w, value);
}

/** Read a w-bit pattern as a signed number. */
export function toSigned(bits: bigint, w: number): bigint {
  return BigInt.asIntN(w, bits);
}

export function widthError(value: bigint, w: number): string {
  return `${value} doesn't fit in ${w} bits. ${w}-bit values run from ${minSigned(w)} (signed) to ${maxUnsigned(w)} (unsigned).`;
}

/**
 * Read a field in two's complement mode. Decimal is the number itself; other bases are a bit pattern
 * that is read as signed, so 0xFF at 8 bits is -1. An explicit minus sign is always taken literally.
 */
export function parseWithWidth(text: string, base: number, w: Width): ParseResult {
  const r = parseInteger(text, base);
  if (!r.ok) return r;
  const literalNegative = /^\s*-/.test(text);
  if (base === 10 || literalNegative) return fitsWidth(r.value, w) ? r : { ok: false, error: widthError(r.value, w) };
  if (r.value > maxUnsigned(w)) return { ok: false, error: `That's more than ${w} bits. Pick a wider size or remove some digits.` };
  return { ok: true, value: toSigned(r.value, w) };
}

/** Bits needed to write |value| in binary (0 needs 1). */
export function bitLength(value: bigint): number {
  const v = value < 0n ? -value : value;
  return v === 0n ? 1 : v.toString(2).length;
}

/** Smallest of 8/16/32/64 bits that holds a non-negative value, or null if it needs more. */
export function autoWidth(value: bigint): Width | null {
  if (value < 0n) return null;
  for (const w of [8, 16, 32, 64] as const) if (value <= maxUnsigned(w)) return w;
  return null;
}

export type BitOp = "and" | "or" | "xor" | "not" | "shl" | "shr" | "ushr";

export const OPS: [BitOp, string][] = [
  ["and", "AND  &"],
  ["or", "OR  |"],
  ["xor", "XOR  ^"],
  ["not", "NOT  ~"],
  ["shl", "<<"],
  ["shr", ">>"],
  ["ushr", ">>>"],
];

/** Shifting by more than this would make an absurdly large number. */
const MAX_SHIFT = 65_536n;

/**
 * A op B. With a width the result wraps to that many bits and is read as signed (as in C or Java);
 * without one, BigInt's unlimited two's complement is used, so ~5 is -6.
 */
export function bitwise(op: BitOp, a: bigint, b: bigint, w?: Width): ParseResult {
  if (w && !fitsWidth(a, w)) return { ok: false, error: `A: ${widthError(a, w)}` };
  if (w && (op === "and" || op === "or" || op === "xor") && !fitsWidth(b, w)) return { ok: false, error: `B: ${widthError(b, w)}` };
  if ((op === "shl" || op === "shr" || op === "ushr") && (b < 0n || b > MAX_SHIFT)) {
    return { ok: false, error: `The shift amount (B) must be between 0 and ${MAX_SHIFT}.` };
  }
  let r: bigint;
  switch (op) {
    case "and":
      r = a & b;
      break;
    case "or":
      r = a | b;
      break;
    case "xor":
      r = a ^ b;
      break;
    case "not":
      r = ~a;
      break;
    case "shl":
      r = a << b;
      break;
    case "shr":
      // Arithmetic shift: keeps the sign, so read the pattern as signed first.
      r = (w ? toSigned(a, w) : a) >> b;
      break;
    case "ushr":
      if (!w) return { ok: false, error: "A logical shift (>>>) needs a bit size. Pick 8, 16, 32 or 64 bits above." };
      r = toBits(a, w) >> b;
      break;
  }
  return { ok: true, value: w ? toSigned(r, w) : r };
}

/** UTF-8 bytes of some text, written out several ways. */
export function textBytes(text: string): { bytes: Uint8Array; hex: string; binary: string; decimal: string; ascii: boolean } {
  const bytes = new TextEncoder().encode(text);
  const list = [...bytes];
  return {
    bytes,
    hex: list.map((b) => b.toString(16).padStart(2, "0")).join(" "),
    binary: list.map((b) => b.toString(2).padStart(8, "0")).join(" "),
    decimal: list.join(" "),
    ascii: list.every((b) => b < 128),
  };
}
