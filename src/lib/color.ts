// Colour parsing, conversion and WCAG contrast. Colours are kept as sRGB floats (0–1)
// plus alpha, so converting back and forth doesn't pile up rounding errors.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  a: number;
}

export interface Hsl {
  /** degrees, 0–360 */
  h: number;
  /** 0–100 */
  s: number;
  /** 0–100 */
  l: number;
}

export interface Hwb {
  h: number;
  /** 0–100 */
  w: number;
  /** 0–100 */
  b: number;
}

export interface Oklch {
  /** 0–1 */
  l: number;
  c: number;
  /** degrees */
  h: number;
}

export type ParseResult = { ok: true; color: Rgba; outOfGamut: boolean } | { ok: false; error: string };

/** The 148 CSS named colours (CSS Color Level 4). */
export const NAMED_COLORS: Record<string, string> = {
  aliceblue: "f0f8ff",
  antiquewhite: "faebd7",
  aqua: "00ffff",
  aquamarine: "7fffd4",
  azure: "f0ffff",
  beige: "f5f5dc",
  bisque: "ffe4c4",
  black: "000000",
  blanchedalmond: "ffebcd",
  blue: "0000ff",
  blueviolet: "8a2be2",
  brown: "a52a2a",
  burlywood: "deb887",
  cadetblue: "5f9ea0",
  chartreuse: "7fff00",
  chocolate: "d2691e",
  coral: "ff7f50",
  cornflowerblue: "6495ed",
  cornsilk: "fff8dc",
  crimson: "dc143c",
  cyan: "00ffff",
  darkblue: "00008b",
  darkcyan: "008b8b",
  darkgoldenrod: "b8860b",
  darkgray: "a9a9a9",
  darkgreen: "006400",
  darkgrey: "a9a9a9",
  darkkhaki: "bdb76b",
  darkmagenta: "8b008b",
  darkolivegreen: "556b2f",
  darkorange: "ff8c00",
  darkorchid: "9932cc",
  darkred: "8b0000",
  darksalmon: "e9967a",
  darkseagreen: "8fbc8f",
  darkslateblue: "483d8b",
  darkslategray: "2f4f4f",
  darkslategrey: "2f4f4f",
  darkturquoise: "00ced1",
  darkviolet: "9400d3",
  deeppink: "ff1493",
  deepskyblue: "00bfff",
  dimgray: "696969",
  dimgrey: "696969",
  dodgerblue: "1e90ff",
  firebrick: "b22222",
  floralwhite: "fffaf0",
  forestgreen: "228b22",
  fuchsia: "ff00ff",
  gainsboro: "dcdcdc",
  ghostwhite: "f8f8ff",
  gold: "ffd700",
  goldenrod: "daa520",
  gray: "808080",
  green: "008000",
  greenyellow: "adff2f",
  grey: "808080",
  honeydew: "f0fff0",
  hotpink: "ff69b4",
  indianred: "cd5c5c",
  indigo: "4b0082",
  ivory: "fffff0",
  khaki: "f0e68c",
  lavender: "e6e6fa",
  lavenderblush: "fff0f5",
  lawngreen: "7cfc00",
  lemonchiffon: "fffacd",
  lightblue: "add8e6",
  lightcoral: "f08080",
  lightcyan: "e0ffff",
  lightgoldenrodyellow: "fafad2",
  lightgray: "d3d3d3",
  lightgreen: "90ee90",
  lightgrey: "d3d3d3",
  lightpink: "ffb6c1",
  lightsalmon: "ffa07a",
  lightseagreen: "20b2aa",
  lightskyblue: "87cefa",
  lightslategray: "778899",
  lightslategrey: "778899",
  lightsteelblue: "b0c4de",
  lightyellow: "ffffe0",
  lime: "00ff00",
  limegreen: "32cd32",
  linen: "faf0e6",
  magenta: "ff00ff",
  maroon: "800000",
  mediumaquamarine: "66cdaa",
  mediumblue: "0000cd",
  mediumorchid: "ba55d3",
  mediumpurple: "9370db",
  mediumseagreen: "3cb371",
  mediumslateblue: "7b68ee",
  mediumspringgreen: "00fa9a",
  mediumturquoise: "48d1cc",
  mediumvioletred: "c71585",
  midnightblue: "191970",
  mintcream: "f5fffa",
  mistyrose: "ffe4e1",
  moccasin: "ffe4b5",
  navajowhite: "ffdead",
  navy: "000080",
  oldlace: "fdf5e6",
  olive: "808000",
  olivedrab: "6b8e23",
  orange: "ffa500",
  orangered: "ff4500",
  orchid: "da70d6",
  palegoldenrod: "eee8aa",
  palegreen: "98fb98",
  paleturquoise: "afeeee",
  palevioletred: "db7093",
  papayawhip: "ffefd5",
  peachpuff: "ffdab9",
  peru: "cd853f",
  pink: "ffc0cb",
  plum: "dda0dd",
  powderblue: "b0e0e6",
  purple: "800080",
  rebeccapurple: "663399",
  red: "ff0000",
  rosybrown: "bc8f8f",
  royalblue: "4169e1",
  saddlebrown: "8b4513",
  salmon: "fa8072",
  sandybrown: "f4a460",
  seagreen: "2e8b57",
  seashell: "fff5ee",
  sienna: "a0522d",
  silver: "c0c0c0",
  skyblue: "87ceeb",
  slateblue: "6a5acd",
  slategray: "708090",
  slategrey: "708090",
  snow: "fffafa",
  springgreen: "00ff7f",
  steelblue: "4682b4",
  tan: "d2b48c",
  teal: "008080",
  thistle: "d8bfd8",
  tomato: "ff6347",
  turquoise: "40e0d0",
  violet: "ee82ee",
  wheat: "f5deb3",
  white: "ffffff",
  whitesmoke: "f5f5f5",
  yellow: "ffff00",
  yellowgreen: "9acd32",
};

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const mod360 = (h: number) => ((h % 360) + 360) % 360;

/** Round to `d` decimals and drop trailing zeros ("-0" becomes "0"). */
export function fmt(n: number, d: number): string {
  const s = n.toFixed(d);
  const t = s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  return t === "-0" ? "0" : t;
}

// ---------- Parsing ----------

const HINT = "Try #ff8800, rgb(255 136 0), hsl(32 100% 50%), oklch(75% 0.18 55) or a name like tomato.";

function parseHex(hex: string): Rgba | null {
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) : 1 };
}

type Token = { value: number; unit: "" | "%" | "deg" | "rad" | "grad" | "turn" };

function parseToken(t: string): Token | null {
  if (t === "none") return { value: 0, unit: "" };
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/.exec(t);
  return m ? { value: Number(m[1]), unit: (m[2] ?? "") as Token["unit"] } : null;
}

function hueDegrees(t: Token): number | null {
  switch (t.unit) {
    case "":
    case "deg":
      return t.value;
    case "rad":
      return (t.value * 180) / Math.PI;
    case "grad":
      return t.value * 0.9;
    case "turn":
      return t.value * 360;
    default:
      return null;
  }
}

function alphaOf(t: Token | undefined): number | null {
  if (!t) return 1;
  if (t.unit === "%") return clamp(t.value / 100);
  if (t.unit === "") return clamp(t.value);
  return null;
}

/** Split "a b c / d" or "a, b, c, d" into tokens. Returns the raw strings. */
function splitArgs(body: string): { parts: string[]; alpha?: string } | null {
  const s = body.trim();
  if (s.includes(",")) {
    const parts = s.split(",").map((p) => p.trim());
    if (parts.some((p) => p === "" || /\s/.test(p))) return null;
    return parts.length === 4 ? { parts: parts.slice(0, 3), alpha: parts[3] } : { parts };
  }
  const [main, alpha, extra] = s.split("/");
  if (extra !== undefined) return null;
  const parts = main.trim().split(/\s+/).filter(Boolean);
  const a = alpha?.trim();
  if (alpha !== undefined && !a) return null;
  return { parts, alpha: a };
}

export function parseColor(input: string): ParseResult {
  const text = input.trim().toLowerCase();
  if (!text) return { ok: false, error: "Enter a colour." };

  if (text === "transparent") return { ok: true, color: { r: 0, g: 0, b: 0, a: 0 }, outOfGamut: false };
  if (text.startsWith("#")) {
    const c = parseHex(text.slice(1));
    return c
      ? { ok: true, color: c, outOfGamut: false }
      : { ok: false, error: "A hex colour needs 3, 4, 6 or 8 hex digits after the #, like #f80 or #ff8800." };
  }
  if (NAMED_COLORS[text]) return { ok: true, color: parseHex(NAMED_COLORS[text])!, outOfGamut: false };

  const fn = /^([a-z]+)\((.*)\)$/s.exec(text);
  if (!fn) {
    // Bare hex without the # is common when pasting from design tools.
    const c = parseHex(text);
    if (c) return { ok: true, color: c, outOfGamut: false };
    if (/^[a-z]+$/.test(text)) return { ok: false, error: `"${input.trim()}" isn't a CSS colour name. ${HINT}` };
    return { ok: false, error: `Couldn't read that colour. ${HINT}` };
  }

  const name = fn[1].replace(/a$/, "") as string;
  if (!["rgb", "hsl", "hwb", "oklch", "oklab"].includes(name)) {
    return { ok: false, error: `${fn[1]}() isn't supported here. Use rgb(), hsl(), hwb(), oklch() or oklab().` };
  }
  const args = splitArgs(fn[2]);
  const tokens = args?.parts.map(parseToken);
  const alphaTok = args?.alpha !== undefined ? parseToken(args.alpha) : undefined;
  if (!args || args.parts.length !== 3 || !tokens || tokens.some((t) => !t) || alphaTok === null) {
    return { ok: false, error: `${name}() needs three values and an optional alpha, like ${example(name)}.` };
  }
  const [t1, t2, t3] = tokens as Token[];
  const a = alphaOf(alphaTok ?? undefined);
  if (a === null) return { ok: false, error: "Alpha must be a number from 0 to 1 or a percentage." };
  const bad = { ok: false as const, error: `Some values in ${name}() have the wrong unit. Example: ${example(name)}.` };

  if (name === "rgb") {
    const ch = (t: Token) => (t.unit === "%" ? t.value / 100 : t.unit === "" ? t.value / 255 : NaN);
    const [r, g, b] = [ch(t1), ch(t2), ch(t3)];
    if ([r, g, b].some(Number.isNaN)) return bad;
    return { ok: true, color: { r: clamp(r), g: clamp(g), b: clamp(b), a }, outOfGamut: false };
  }
  if (name === "hsl" || name === "hwb") {
    const h = hueDegrees(t1);
    // Modern syntax allows plain numbers for the percentages.
    const pct = (t: Token) => (t.unit === "%" || t.unit === "" ? t.value : NaN);
    const [x, y] = [pct(t2), pct(t3)];
    if (h === null || Number.isNaN(x) || Number.isNaN(y)) return bad;
    const rgb =
      name === "hsl"
        ? hslToRgb({ h, s: clamp(x, 0, 100), l: clamp(y, 0, 100) })
        : hwbToRgb({ h, w: clamp(x, 0, 100), b: clamp(y, 0, 100) });
    return { ok: true, color: { ...rgb, a }, outOfGamut: false };
  }
  // oklch / oklab: L is 0–1 or a percentage; C/a/b percentages are relative to 0.4.
  const l = t1.unit === "%" ? t1.value / 100 : t1.unit === "" ? t1.value : NaN;
  const rel = (t: Token) => (t.unit === "%" ? (t.value / 100) * 0.4 : t.unit === "" ? t.value : NaN);
  if (Number.isNaN(l)) return bad;
  let lch: Oklch;
  if (name === "oklch") {
    const c = rel(t2);
    const h = hueDegrees(t3);
    if (Number.isNaN(c) || h === null) return bad;
    lch = { l: clamp(l), c: Math.max(0, c), h };
  } else {
    const [aa, bb] = [rel(t2), rel(t3)];
    if (Number.isNaN(aa) || Number.isNaN(bb)) return bad;
    lch = { l: clamp(l), c: Math.hypot(aa, bb), h: mod360((Math.atan2(bb, aa) * 180) / Math.PI) };
  }
  const outOfGamut = visiblyOutOfGamut(lch);
  return { ok: true, color: { ...oklchToRgb(lch), a }, outOfGamut };
}

function example(name: string): string {
  return {
    rgb: "rgb(255 136 0) or rgb(255, 136, 0, 0.5)",
    hsl: "hsl(32 100% 50%)",
    hwb: "hwb(32 0% 0%)",
    oklch: "oklch(75% 0.18 55)",
    oklab: "oklab(75% 0.1 0.15)",
  }[name]!;
}

// ---------- Conversions ----------

export function rgbToHsl({ r, g, b }: Rgba): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  return { h: hueOf(r, g, b, max, d), s: s * 100, l: l * 100 };
}

function hueOf(r: number, g: number, b: number, max: number, d: number): number {
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return mod360(h * 60);
}

export function hslToRgb({ h, s, l }: Hsl): Rgba {
  const sat = s / 100;
  const light = l / 100;
  const f = (n: number) => {
    const k = (n + mod360(h) / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4), a: 1 };
}

export function rgbToHwb(c: Rgba): Hwb {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  return { h: d === 0 ? 0 : hueOf(c.r, c.g, c.b, max, d), w: min * 100, b: (1 - max) * 100 };
}

export function hwbToRgb({ h, w, b }: Hwb): Rgba {
  const white = w / 100;
  const black = b / 100;
  if (white + black >= 1) {
    const grey = white / (white + black);
    return { r: grey, g: grey, b: grey, a: 1 };
  }
  const base = hslToRgb({ h, s: 100, l: 50 });
  const f = (x: number) => x * (1 - white - black) + white;
  return { r: f(base.r), g: f(base.g), b: f(base.b), a: 1 };
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
// Mirrored for negatives so out-of-gamut values stay out of range instead of turning into NaN.
const fromLinear = (c: number): number => (c < 0 ? -fromLinear(-c) : c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklch(c: Rgba): Oklch {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  // Greys have no meaningful hue; tiny float noise would otherwise give a random one.
  return { l: L, c: C < 1e-6 ? 0 : C, h: C < 1e-6 ? 0 : mod360((Math.atan2(B, A) * 180) / Math.PI) };
}

function oklchToRgbUnclamped({ l: L, c: C, h }: Oklch): { r: number; g: number; b: number } {
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

type Rgb = { r: number; g: number; b: number };
const EPS = 1e-6;
const inGamut = (c: Rgb) => [c.r, c.g, c.b].every((x) => x >= -EPS && x <= 1 + EPS);
const clip = (c: Rgb): Rgb => ({ r: clamp(c.r), g: clamp(c.g), b: clamp(c.b) });

/** Distance in OKLab; 0.02 is about the smallest difference people notice. */
function deltaEOK(x: Oklch, y: Oklch): number {
  const ab = (c: Oklch) => [c.c * Math.cos((c.h * Math.PI) / 180), c.c * Math.sin((c.h * Math.PI) / 180)];
  const [a1, b1] = ab(x);
  const [a2, b2] = ab(y);
  return Math.hypot(x.l - y.l, a1 - a2, b1 - b2);
}

/** Whether an OKLCH colour falls visibly outside sRGB (more than half an 8-bit step). */
function visiblyOutOfGamut(lch: Oklch): boolean {
  const c = oklchToRgbUnclamped(lch);
  return [c.r, c.g, c.b].some((x) => x < -0.5 / 255 || x > 1 + 0.5 / 255);
}

/**
 * OKLCH to sRGB using the CSS Color 4 gamut mapping: out-of-range colours keep their lightness
 * and hue and lose chroma until simply clipping them is no longer noticeable.
 */
export function oklchToRgb(lch: Oklch): Rgba {
  const JND = 0.02;
  if (lch.l >= 1) return { r: 1, g: 1, b: 1, a: 1 };
  if (lch.l <= 0) return { r: 0, g: 0, b: 0, a: 1 };
  const origin = oklchToRgbUnclamped(lch);
  let result = clip(origin);
  if (!inGamut(origin) && deltaEOK(rgbToOklch({ ...result, a: 1 }), lch) >= JND) {
    let lo = 0;
    let hi = lch.c;
    let loInGamut = true;
    while (hi - lo > 1e-4) {
      const current = { ...lch, c: (lo + hi) / 2 };
      const raw = oklchToRgbUnclamped(current);
      if (loInGamut && inGamut(raw)) {
        lo = current.c;
        continue;
      }
      result = clip(raw);
      const e = deltaEOK(rgbToOklch({ ...result, a: 1 }), current);
      if (e < JND) {
        if (JND - e < 1e-4) break;
        loInGamut = false;
        lo = current.c;
      } else hi = current.c;
    }
  }
  return { ...result, a: 1 };
}

// ---------- Formatting ----------

const byte = (x: number) => Math.round(clamp(x) * 255);
const hex2 = (x: number) => byte(x).toString(16).padStart(2, "0");
const alphaPart = (a: number) => (a < 1 ? ` / ${fmt(a * 100, 1)}%` : "");

export function toHex(c: Rgba): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? hex2(c.a) : ""}`;
}

/** Always six digits, for <input type="color">. */
export function toHex6(c: Rgba): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

export function toRgbString(c: Rgba): string {
  return `rgb(${byte(c.r)} ${byte(c.g)} ${byte(c.b)}${alphaPart(c.a)})`;
}

export function toHslString(c: Rgba): string {
  const { h, s, l } = rgbToHsl(c);
  return `hsl(${fmt(h, 1)} ${fmt(s, 1)}% ${fmt(l, 1)}%${alphaPart(c.a)})`;
}

export function toHwbString(c: Rgba): string {
  const { h, w, b } = rgbToHwb(c);
  return `hwb(${fmt(h, 1)} ${fmt(w, 1)}% ${fmt(b, 1)}%${alphaPart(c.a)})`;
}

export function toOklchString(c: Rgba): string {
  const { l, c: ch, h } = rgbToOklch(c);
  return `oklch(${fmt(l * 100, 2)}% ${fmt(ch, 4)} ${fmt(h, 2)}${alphaPart(c.a)})`;
}

/** Names whose value is exactly this colour (e.g. aqua and cyan). */
export function namesFor(c: Rgba): string[] {
  if (c.a < 1) return [];
  const hex = toHex6(c).slice(1);
  return Object.keys(NAMED_COLORS).filter((n) => NAMED_COLORS[n] === hex);
}

export function allFormats(c: Rgba): [string, string][] {
  const ints = [byte(c.r), byte(c.g), byte(c.b)];
  const floats = [c.r, c.g, c.b].map((x) => x.toFixed(3));
  if (c.a < 1) {
    ints.push(byte(c.a));
    floats.push(c.a.toFixed(3));
  }
  const rows: [string, string][] = [
    ["HEX", toHex(c)],
    ["RGB", toRgbString(c)],
    ["HSL", toHslString(c)],
    ["HWB", toHwbString(c)],
    ["OKLCH", toOklchString(c)],
    [c.a < 1 ? "RGBA 0–255" : "RGB 0–255", ints.join(", ")],
    [c.a < 1 ? "RGBA 0–1" : "RGB 0–1", floats.join(", ")],
  ];
  const names = namesFor(c);
  if (names.length) rows.push(["Name", names.join(" / ")]);
  return rows;
}

// ---------- Contrast (WCAG 2.x) ----------

export function relativeLuminance(c: Rgba): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** Paint `top` over `bottom` (simple alpha compositing in sRGB, as browsers do). */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };

/** WCAG 2.x contrast ratio, 1–21. A see-through background is assumed to sit on white. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const back = composite(bg, WHITE);
  const front = composite(fg, back);
  const l1 = relativeLuminance(front);
  const l2 = relativeLuminance(back);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Shown ratio, rounded down so a failing 4.499 never displays as "4.50". */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2)}:1`;
}

export interface ContrastCheck {
  id: string;
  label: string;
  detail: string;
  min: number;
  pass: boolean;
}

export function contrastChecks(ratio: number): ContrastCheck[] {
  const checks: Omit<ContrastCheck, "pass">[] = [
    { id: "aa", label: "AA normal text", detail: "4.5:1 or more", min: 4.5 },
    { id: "aa-large", label: "AA large text", detail: "3:1 or more · 24px, or 18.66px bold", min: 3 },
    { id: "aaa", label: "AAA normal text", detail: "7:1 or more", min: 7 },
    { id: "aaa-large", label: "AAA large text", detail: "4.5:1 or more", min: 4.5 },
    { id: "ui", label: "UI components & graphics", detail: "3:1 or more · borders, icons, focus rings", min: 3 },
  ];
  return checks.map((c) => ({ ...c, pass: ratio >= c.min }));
}

/**
 * The colour closest to `fg` (by OKLCH lightness, same hue and chroma where possible) that reaches
 * `target` against `bg`. Checked after rounding to 8-bit so the hex it gives really passes.
 */
export function suggestForeground(fg: Rgba, bg: Rgba, target = 4.5): Rgba | null {
  const lch = rgbToOklch(fg);
  const tryL = (l: number): Rgba | null => {
    const c = oklchToRgb({ ...lch, l });
    const rounded = { r: byte(c.r) / 255, g: byte(c.g) / 255, b: byte(c.b) / 255, a: 1 };
    return contrastRatio(rounded, bg) >= target ? rounded : null;
  };
  // Stepping outwards in both directions handles the case where the nearest pass is on the far side.
  for (let step = 0; step <= 1000; step++) {
    const d = step / 1000;
    for (const l of [lch.l - d, lch.l + d]) {
      if (l < 0 || l > 1) continue;
      const hit = tryL(l);
      if (hit) return hit;
    }
  }
  return null;
}

/** Mix two colours in sRGB; `amount` is how much of `b` (0–1). */
export function mix(a: Rgba, b: Rgba, amount: number): Rgba {
  const f = (x: number, y: number) => x + (y - x) * amount;
  return { r: f(a.r, b.r), g: f(a.g, b.g), b: f(a.b, b.b), a: f(a.a, b.a) };
}

/** Tints (mixed with white) then the colour itself then shades (mixed with black). */
export function tintsAndShades(c: Rgba, steps = 4): { label: string; color: Rgba }[] {
  const solid = { ...c, a: 1 };
  const out: { label: string; color: Rgba }[] = [];
  for (let i = steps; i >= 1; i--) {
    const p = i / (steps + 1);
    out.push({ label: `${Math.round(p * 100)}% white`, color: mix(solid, WHITE, p) });
  }
  out.push({ label: "Base", color: solid });
  for (let i = 1; i <= steps; i++) {
    const p = i / (steps + 1);
    out.push({ label: `${Math.round(p * 100)}% black`, color: mix(solid, { r: 0, g: 0, b: 0, a: 1 }, p) });
  }
  return out;
}
