import { describe, expect, it } from "vitest";
import { apply, canKeepJpeg, layoutPage, MAX_PAGE_SIDE, placementMatrix, readJpeg, scaleToMax, shownSize, sniffImage } from "./imagelayout";

describe("sniffImage", () => {
  it("recognises formats by their signature", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a"))).toBe("gif");
    expect(sniffImage(new TextEncoder().encode("BM...."))).toBe("bmp");
    expect(sniffImage(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
  });
});

/** A JPEG header: SOI, optional EXIF APP1 with an orientation tag, then a frame header. No image data is needed. */
function jpegHeader(opts: { orientation?: number; littleEndian?: boolean; sof?: number; components?: number; w?: number; h?: number }) {
  const bytes: number[] = [0xff, 0xd8];
  if (opts.orientation) {
    const le = opts.littleEndian ?? false;
    const u16 = (n: number) => (le ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
    const u32 = (n: number) =>
      le ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24] : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    const tiff = [
      ...(le ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...u16(42),
      ...u32(8),
      ...u16(2), // two entries; orientation is the second
      ...u16(0x010f),
      ...u16(2),
      ...u32(1),
      0x41,
      0,
      0,
      0,
      ...u16(0x0112),
      ...u16(3),
      ...u32(1),
      ...u16(opts.orientation),
      0,
      0,
      ...u32(0),
    ];
    const payload = [...new TextEncoder().encode("Exif\0\0"), ...tiff];
    bytes.push(0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload);
  }
  const w = opts.w ?? 640;
  const h = opts.h ?? 480;
  const comps = opts.components ?? 3;
  bytes.push(0xff, 0xdb, 0, 3, 0); // a (truncated) quantisation table to skip over
  bytes.push(0xff, opts.sof ?? 0xc0, 0, 8 + comps * 3, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, comps);
  for (let i = 0; i < comps; i++) bytes.push(i + 1, 0x11, 0);
  return new Uint8Array(bytes);
}

describe("readJpeg", () => {
  it("reads the frame size and components", () => {
    expect(readJpeg(jpegHeader({ w: 1234, h: 567 }))).toEqual({
      width: 1234,
      height: 567,
      components: 3,
      bits: 8,
      sof: 0xc0,
      orientation: 1,
    });
  });

  it("reads the EXIF orientation in both byte orders", () => {
    expect(readJpeg(jpegHeader({ orientation: 6 }))?.orientation).toBe(6);
    expect(readJpeg(jpegHeader({ orientation: 8, littleEndian: true }))?.orientation).toBe(8);
  });

  it("rejects data that isn't a JPEG", () => {
    expect(readJpeg(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
  });

  it("keeps ordinary JPEGs and re-encodes unusual ones", () => {
    expect(canKeepJpeg(readJpeg(jpegHeader({}))!)).toBe(true);
    expect(canKeepJpeg(readJpeg(jpegHeader({ sof: 0xc2, components: 1 }))!)).toBe(true);
    expect(canKeepJpeg(readJpeg(jpegHeader({ components: 4 }))!)).toBe(false);
    expect(canKeepJpeg(readJpeg(jpegHeader({ sof: 0xc9 }))!)).toBe(false);
  });
});

describe("placementMatrix", () => {
  // The stored image's top-left corner is (0, 1) in image space. Where does it land in a 10×20 box?
  const rect = { x: 0, y: 0, w: 10, h: 20 };
  const topLeft = (orientation: number, turns: number) => apply(placementMatrix(orientation, turns, rect), 0, 1);
  const topRight = (orientation: number, turns: number) => apply(placementMatrix(orientation, turns, rect), 1, 1);

  it("draws an upright image as-is", () => {
    expect(placementMatrix(1, 0, { x: 5, y: 7, w: 10, h: 20 })).toEqual([10, 0, 0, 20, 5, 7]);
  });

  it("follows each EXIF orientation", () => {
    expect(topLeft(1, 0)).toEqual([0, 20]);
    expect(topLeft(2, 0)).toEqual([10, 20]); // mirrored
    expect(topLeft(3, 0)).toEqual([10, 0]); // upside down
    expect(topLeft(4, 0)).toEqual([0, 0]); // flipped vertically
    expect(topLeft(5, 0)).toEqual([0, 20]); // transposed
    expect(topRight(5, 0)).toEqual([0, 0]);
    expect(topLeft(6, 0)).toEqual([10, 20]); // turned clockwise
    expect(topLeft(7, 0)).toEqual([10, 0]);
    expect(topLeft(8, 0)).toEqual([0, 0]); // turned anticlockwise
  });

  it("adds the user's clockwise turns after the EXIF orientation", () => {
    expect(topLeft(1, 1)).toEqual([10, 20]);
    expect(topLeft(1, 2)).toEqual([10, 0]);
    expect(topLeft(1, 3)).toEqual([0, 0]);
    expect(topLeft(6, 3)).toEqual([0, 20]); // a quarter turn back undoes orientation 6
    expect(topLeft(1, -1)).toEqual([0, 0]);
  });

  it("swaps width and height for quarter turns", () => {
    expect(shownSize(400, 300, 1, 0)).toEqual([400, 300]);
    expect(shownSize(400, 300, 6, 0)).toEqual([300, 400]);
    expect(shownSize(400, 300, 6, 1)).toEqual([400, 300]);
    expect(shownSize(400, 300, 1, 3)).toEqual([300, 400]);
  });
});

describe("layoutPage", () => {
  it("fits the page to the image at 96 dpi, plus margins", () => {
    expect(layoutPage(800, 600, { pageSize: "fit", orientation: "auto", margin: "none" })).toEqual({
      pageWidth: 600,
      pageHeight: 450,
      x: 0,
      y: 0,
      w: 600,
      h: 450,
    });
    expect(layoutPage(800, 600, { pageSize: "fit", orientation: "portrait", margin: "small" })).toMatchObject({
      pageWidth: 636,
      pageHeight: 486,
      x: 18,
      y: 18,
    });
  });

  it("keeps huge images within the largest PDF page", () => {
    const l = layoutPage(40000, 20000, { pageSize: "fit", orientation: "auto", margin: "large" });
    expect(l.pageWidth).toBeCloseTo(MAX_PAGE_SIDE);
    expect(l.w / l.h).toBeCloseTo(2);
  });

  it("centres the image on a fixed page, turning the page for wide images", () => {
    const l = layoutPage(4000, 3000, { pageSize: "a4", orientation: "auto", margin: "none" });
    expect([l.pageWidth, l.pageHeight]).toEqual([841.89, 595.28]);
    expect(l.h).toBeCloseTo(595.28);
    expect(l.w).toBeCloseTo(793.71);
    expect(l.x).toBeCloseTo((841.89 - 793.71) / 2);
    expect(l.y).toBeCloseTo(0);
  });

  it("honours a fixed orientation and the margin", () => {
    const l = layoutPage(4000, 3000, { pageSize: "letter", orientation: "portrait", margin: "large" });
    expect([l.pageWidth, l.pageHeight]).toEqual([612, 792]);
    expect(l.w).toBeCloseTo(612 - 108);
    expect(l.x).toBeCloseTo(54);
    expect(l.y).toBeCloseTo((792 - l.h) / 2);
  });

  it("scales small images up to fill the page", () => {
    const l = layoutPage(10, 10, { pageSize: "a4", orientation: "auto", margin: "none" });
    expect(l.w).toBeCloseTo(595.28);
  });
});

describe("scaleToMax", () => {
  it("caps the longest side and never enlarges", () => {
    expect(scaleToMax(4000, 3000, 2000)).toEqual([2000, 1500]);
    expect(scaleToMax(800, 600, 2000)).toEqual([800, 600]);
  });
});
