import { describe, expect, it } from "vitest";
import {
  allFormats,
  composite,
  contrastChecks,
  contrastRatio,
  formatRatio,
  hslToRgb,
  NAMED_COLORS,
  namesFor,
  parseColor,
  rgbToHsl,
  rgbToOklch,
  suggestForeground,
  tintsAndShades,
  toHex,
  toHslString,
  toHwbString,
  toOklchString,
  toRgbString,
  type Rgba,
} from "./color";

function parse(s: string): Rgba {
  const r = parseColor(s);
  if (!r.ok) throw new Error(`${s}: ${r.error}`);
  return r.color;
}
const hex = (s: string) => toHex(parse(s));

describe("parseColor", () => {
  it("reads all hex lengths, with or without #", () => {
    expect(hex("#f80")).toBe("#ff8800");
    expect(hex("#f808")).toBe("#ff880088");
    expect(hex("#FF8800")).toBe("#ff8800");
    expect(hex("#ff880080")).toBe("#ff880080");
    expect(hex("ff8800")).toBe("#ff8800");
    expect(hex("  #abc  ")).toBe("#aabbcc");
  });

  it("rejects bad hex with a helpful message", () => {
    const r = parseColor("#ff88");
    expect(r.ok).toBe(true); // 4 digits is #rgba
    const bad = parseColor("#ff8");
    expect(bad.ok).toBe(true);
    for (const s of ["#ff88000", "#gg0000", "#"]) {
      const x = parseColor(s);
      expect(x.ok, s).toBe(false);
      if (!x.ok) expect(x.error).toMatch(/hex/);
    }
  });

  it("reads rgb() in legacy and modern syntax", () => {
    expect(hex("rgb(255, 136, 0)")).toBe("#ff8800");
    expect(hex("rgba(255,136,0,0.5)")).toBe("#ff880080");
    expect(hex("rgb(255 136 0)")).toBe("#ff8800");
    expect(hex("rgb(255 136 0 / 50%)")).toBe("#ff880080");
    expect(hex("rgb(100% 0% 50%)")).toBe("#ff0080");
    expect(hex("RGB(300 -5 0)")).toBe("#ff0000"); // clamped
    expect(hex("rgb(none 0 0)")).toBe("#000000");
    expect(hex("rgb(.5e3 0 0)")).toBe("#ff0000");
  });

  it("reads hsl(), hwb() with hue units", () => {
    expect(hex("hsl(0 100% 50%)")).toBe("#ff0000");
    expect(hex("hsl(120, 100%, 25%)")).toBe("#008000");
    expect(hex("hsla(240 100% 50% / 0.5)")).toBe("#0000ff80");
    expect(hex("hsl(0.5turn 100% 50%)")).toBe("#00ffff");
    expect(hex("hsl(3.14159265rad 100% 50%)")).toBe("#00ffff");
    expect(hex("hsl(200grad 100 50)")).toBe("#00ffff");
    expect(hex("hsl(-120 100% 50%)")).toBe("#0000ff");
    expect(hex("hwb(0 0% 0%)")).toBe("#ff0000");
    expect(hex("hwb(120 20% 30%)")).toBe("#33b333");
    expect(hex("hwb(0 60% 60%)")).toBe("#808080"); // w + b > 100% normalises to grey
  });

  it("reads oklch() and oklab()", () => {
    expect(hex("oklch(62.8% 0.2577 29.23)")).toBe("#ff0000");
    expect(hex("oklch(0.628 0.2577 29.23)")).toBe("#ff0000");
    expect(hex("oklch(100% 0 0)")).toBe("#ffffff");
    expect(hex("oklch(0% 0 0)")).toBe("#000000");
    expect(hex("oklch(51.98% 0.1769 142.5)")).toBe("#008000");
    expect(hex("oklch(100% 0.3 30)")).toBe("#ffffff");
    expect(hex("oklab(62.8% 0.2249 0.1258)")).toBe("#ff0000");
  });

  it("brings out-of-gamut oklch into sRGB and says so", () => {
    const r = parseColor("oklch(70% 0.4 150)");
    expect(r.ok && r.outOfGamut).toBe(true);
    if (r.ok) for (const v of [r.color.r, r.color.g, r.color.b]) expect(v).toBeGreaterThanOrEqual(0);
    const inside = parseColor("oklch(70% 0.1 150)");
    expect(inside.ok && inside.outOfGamut).toBe(false);
  });

  it("knows all 148 named colours plus transparent", () => {
    expect(Object.keys(NAMED_COLORS)).toHaveLength(148);
    expect(hex("rebeccapurple")).toBe("#663399");
    expect(hex("Tomato")).toBe("#ff6347");
    expect(hex("transparent")).toBe("#00000000");
    for (const [name, value] of Object.entries(NAMED_COLORS)) expect(value, name).toMatch(/^[0-9a-f]{6}$/);
  });

  it("explains what went wrong", () => {
    const cases: [string, RegExp][] = [
      ["", /Enter a colour/],
      ["blu", /isn't a CSS colour name/],
      ["rgb(1 2)", /three values/],
      ["rgb(1, 2 3)", /three values/],
      ["rgb(1 2 3 / )", /three values/],
      ["hsl(10% 50% 50%)", /wrong unit/],
      ["lab(50 0 0)", /isn't supported/],
      ["rgb(1 2 3 / 50deg)", /Alpha/],
      ["12 34", /Couldn't read/],
    ];
    for (const [input, re] of cases) {
      const r = parseColor(input);
      expect(r.ok, input).toBe(false);
      if (!r.ok) expect(r.error, input).toMatch(re);
    }
  });
});

describe("formatting", () => {
  it("formats known colours", () => {
    const red = parse("red");
    expect(toRgbString(red)).toBe("rgb(255 0 0)");
    expect(toHslString(red)).toBe("hsl(0 100% 50%)");
    expect(toHwbString(red)).toBe("hwb(0 0% 0%)");
    expect(toOklchString(red)).toBe("oklch(62.8% 0.2577 29.23)");
    expect(toOklchString(parse("white"))).toBe("oklch(100% 0 0)");
    expect(toOklchString(parse("#777"))).toBe("oklch(56.93% 0 0)");
    expect(toHslString(parse("#3366cc80"))).toBe("hsl(220 60% 50% / 50.2%)");
  });

  it("lists every format, with names when they match exactly", () => {
    const rows = Object.fromEntries(allFormats(parse("aqua")));
    expect(rows.HEX).toBe("#00ffff");
    expect(rows["RGB 0–255"]).toBe("0, 255, 255");
    expect(rows["RGB 0–1"]).toBe("0.000, 1.000, 1.000");
    expect(rows.Name).toBe("aqua / cyan");
    const half = Object.fromEntries(allFormats(parse("rgb(0 0 0 / 0.5)")));
    expect(half["RGBA 0–255"]).toBe("0, 0, 0, 128");
    expect(half.Name).toBeUndefined();
    expect(namesFor(parse("#123456"))).toEqual([]);
  });

  it("round-trips every format back to the same 8-bit colour", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const samples = ["#000000", "#ffffff", "#777777", "#ff0000", "#00ff00", "#0000ff", "#010203", "#fefdfc"];
    for (let i = 0; i < 2000; i++) samples.push(toHex({ r: rand(), g: rand(), b: rand(), a: 1 }));
    samples.push(...Object.values(NAMED_COLORS).map((v) => `#${v}`));
    const bytes = (c: Rgba) => [c.r, c.g, c.b].map((x) => Math.round(x * 255));
    let worst = 0;
    for (const s of samples) {
      const c = parse(s);
      for (const f of [toRgbString, toHslString, toHwbString]) expect(hex(f(c)), `${s} via ${f(c)}`).toBe(s);
      // OKLCH is shown at the usual precision (2 decimals of %, 4 of chroma), which can be one 8-bit step off.
      const back = bytes(parse(toOklchString(c)));
      bytes(c).forEach((v, i) => (worst = Math.max(worst, Math.abs(v - back[i]))));
    }
    expect(worst).toBeLessThanOrEqual(1);
    expect(hex(toOklchString(parse("#3366cc")))).toBe("#3366cc");
  });

  it("converts hsl both ways", () => {
    const hsl = rgbToHsl(parse("#3366cc"));
    expect(hsl.h).toBeCloseTo(220, 6);
    expect(hsl.s).toBeCloseTo(60, 6);
    expect(hsl.l).toBeCloseTo(50, 6);
    expect(toHex(hslToRgb(hsl))).toBe("#3366cc");
  });

  it("gives greys no hue in oklch", () => {
    const g = rgbToOklch(parse("#808080"));
    expect(g.c).toBe(0);
    expect(g.h).toBe(0);
  });
});

describe("contrast", () => {
  const ratio = (a: string, b: string) => contrastRatio(parse(a), parse(b));

  it("matches known WCAG values", () => {
    expect(ratio("black", "white")).toBeCloseTo(21, 6);
    expect(ratio("white", "black")).toBeCloseTo(21, 6);
    expect(ratio("#777", "#fff")).toBeCloseTo(4.48, 2);
    expect(ratio("#767676", "#fff")).toBeCloseTo(4.54, 2);
    expect(ratio("#fff", "#fff")).toBe(1);
    expect(ratio("#0000ff", "#fff")).toBeCloseTo(8.59, 2);
  });

  it("rounds the shown ratio down", () => {
    expect(formatRatio(ratio("#777", "#fff"))).toBe("4.47:1");
    expect(formatRatio(21)).toBe("21.00:1");
    expect(formatRatio(4.4999)).toBe("4.49:1");
  });

  it("composites see-through colours before measuring", () => {
    // Half-transparent black on white looks like #808080 (well, #7f7f7f).
    expect(ratio("rgb(0 0 0 / 50%)", "white")).toBeCloseTo(ratio("#7f7f7f", "white"), 1);
    // A fully transparent background counts as white.
    expect(ratio("black", "transparent")).toBeCloseTo(21, 6);
    expect(composite(parse("transparent"), parse("transparent")).a).toBe(0);
  });

  it("grades each WCAG level", () => {
    const pass = (r: number) => Object.fromEntries(contrastChecks(r).map((c) => [c.id, c.pass]));
    expect(pass(4.48)).toEqual({ aa: false, "aa-large": true, aaa: false, "aaa-large": false, ui: true });
    expect(pass(4.5)).toEqual({ aa: true, "aa-large": true, aaa: false, "aaa-large": true, ui: true });
    expect(pass(7)).toEqual({ aa: true, "aa-large": true, aaa: true, "aaa-large": true, ui: true });
    expect(pass(2.9)).toEqual({ aa: false, "aa-large": false, aaa: false, "aaa-large": false, ui: false });
  });

  it("suggests a nearby colour that passes", () => {
    const bg = parse("white");
    const s = suggestForeground(parse("#777"), bg)!;
    expect(contrastRatio(s, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(s, bg)).toBeLessThan(4.7); // only as dark as needed
    expect(toHex(s)).toMatch(/^#(76|75|74)7[456]7[456]$/);

    const orange = parse("#ff8800");
    const fix = suggestForeground(orange, bg, 4.5)!;
    expect(contrastRatio(fix, bg)).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(rgbToOklch(fix).h - rgbToOklch(orange).h)).toBeLessThan(10); // still orange-ish

    // On a dark background it goes lighter.
    const dark = parse("#202020");
    const light = suggestForeground(parse("#444"), dark)!;
    expect(contrastRatio(light, dark)).toBeGreaterThanOrEqual(4.5);
    expect(rgbToOklch(light).l).toBeGreaterThan(rgbToOklch(parse("#444")).l);

    // Already passing: unchanged.
    expect(toHex(suggestForeground(parse("black"), bg)!)).toBe("#000000");
    // Mid grey can't reach 7:1 with anything.
    expect(suggestForeground(parse("#777"), parse("#777"), 7)).toBeNull();
  });
});

describe("tints and shades", () => {
  it("goes from light to dark around the base colour", () => {
    const scale = tintsAndShades(parse("#3366cc"));
    expect(scale).toHaveLength(9);
    expect(scale[4]).toMatchObject({ label: "Base" });
    expect(toHex(scale[4].color)).toBe("#3366cc");
    expect(scale[0].label).toBe("80% white");
    expect(toHex(scale[0].color)).toBe("#d6e0f5");
    expect(scale[8].label).toBe("80% black");
    expect(toHex(scale[8].color)).toBe("#0a1429");
  });
});
