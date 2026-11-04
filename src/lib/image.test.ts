import { describe, expect, it } from "vitest";
import { crc32, fitToSize, padImage, targetDimensions } from "./image";

describe("targetDimensions", () => {
  it("keeps, scales by percent, or uses pixels", () => {
    expect(targetDimensions(4000, 3000, { by: "original" })).toEqual([4000, 3000]);
    expect(targetDimensions(4000, 3000, { by: "percent", percent: 25 })).toEqual([1000, 750]);
    expect(targetDimensions(4000, 3000, { by: "pixels", width: 800, height: 800 })).toEqual([800, 800]);
  });

  it("keeps the aspect ratio when only one side is given", () => {
    expect(targetDimensions(4000, 3000, { by: "pixels", width: 1000 })).toEqual([1000, 750]);
    expect(targetDimensions(4000, 3000, { by: "pixels", height: 300 })).toEqual([400, 300]);
  });

  it("never goes below 1 px", () => {
    expect(targetDimensions(100, 10, { by: "percent", percent: 1 })).toEqual([1, 1]);
  });
});

// A fake encoder: size grows with quality and with pixel count.
const fake = (base: number) => async (q: number, scale: number) => {
  const size = Math.round(base * (0.2 + q) * scale * scale);
  return { out: { q, scale }, size };
};

describe("fitToSize", () => {
  it("uses the top quality when it already fits", async () => {
    const r = await fitToSize(fake(1000), 5000, { lossy: true, allowShrink: true });
    expect(r).toMatchObject({ fits: true, quality: 0.92, scale: 1 });
  });

  it("finds the highest quality under the target", async () => {
    const r = await fitToSize(fake(100_000), 60_000, { lossy: true, allowShrink: true });
    expect(r.fits).toBe(true);
    expect(r.size).toBeLessThanOrEqual(60_000);
    expect(r.quality).toBeGreaterThan(0.35);
    expect(r.scale).toBe(1);
  });

  it("shrinks the image when quality alone isn't enough", async () => {
    const r = await fitToSize(fake(100_000), 5_000, { lossy: true, allowShrink: true });
    expect(r.fits).toBe(true);
    expect(r.size).toBeLessThanOrEqual(5_000);
    expect(r.scale).toBeLessThan(1);
  });

  it("reports when it can't fit and shrinking isn't allowed", async () => {
    const r = await fitToSize(fake(100_000), 5_000, { lossy: true, allowShrink: false });
    expect(r.fits).toBe(false);
    expect(r.scale).toBe(1);
  });

  it("shrinks lossless images", async () => {
    const r = await fitToSize(fake(100_000), 20_000, { lossy: false, allowShrink: true });
    expect(r.fits).toBe(true);
    expect(r.size).toBeLessThanOrEqual(20_000);
  });
});

describe("padImage", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);

  it("pads JPEGs to the exact size with comment segments", () => {
    for (const target of [11, 13, 14, 100, 65_547, 65_548, 200_000]) {
      const out = padImage(jpeg, "image/jpeg", target);
      expect(out.length).toBe(target);
      expect([...out.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      const extra = target - jpeg.length;
      if (extra < 4) expect([...out.subarray(jpeg.length)]).toEqual(Array(extra).fill(0));
      else expect([...out.subarray(-2)]).toEqual([0xff, 0xd9]);
    }
    // Walk the segments to check they're well formed.
    const out = padImage(jpeg, "image/jpeg", 200_000);
    let pos = 2;
    while (out[pos] === 0xff && out[pos + 1] === 0xfe) pos += 2 + ((out[pos + 2] << 8) | out[pos + 3]);
    expect([...out.subarray(pos, pos + 4)]).toEqual([0xff, 0xe0, 0x00, 0x04]);
  });

  it("pads PNGs with a valid chunk before IEND", () => {
    const iend = new Uint8Array([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...iend]);
    const out = padImage(png, "image/png", 100);
    expect(out.length).toBe(100);
    expect([...out.subarray(-12)]).toEqual([...iend]);
    const chunk = out.subarray(8, 100 - 12);
    const len = new DataView(chunk.buffer, chunk.byteOffset).getUint32(0);
    expect(len).toBe(chunk.length - 12);
    expect(String.fromCharCode(...chunk.subarray(4, 8))).toBe("paDd");
    expect(new DataView(chunk.buffer, chunk.byteOffset).getUint32(8 + len)).toBe(crc32(chunk.subarray(4, 8 + len)));
    // Too little room for a chunk: unchanged.
    expect(padImage(png, "image/png", png.length + 5)).toBe(png);
  });

  it("matches the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
  });
});
