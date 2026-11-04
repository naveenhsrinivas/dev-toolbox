import { describe, expect, it } from "vitest";
import { distinctPages, MAX_PIXELS, MAX_SIDE, pageFileName, parseDpi, renderSize } from "./raster";

describe("renderSize", () => {
  it("converts points to pixels at the chosen dpi", () => {
    expect(renderSize(612, 792, 72)).toEqual({ scale: 1, width: 612, height: 792, dpi: 72, limited: false });
    expect(renderSize(612, 792, 150)).toMatchObject({ width: 1275, height: 1650, limited: false });
    // A4 at 300 dpi is the familiar 2480 × 3508.
    expect(renderSize(595.28, 841.89, 300)).toMatchObject({ width: 2480, height: 3508, dpi: 300 });
  });

  it("lowers the resolution for pages too big to draw", () => {
    const r = renderSize(595.28, 841.89, 1200);
    expect(r.limited).toBe(true);
    expect(r.width * r.height).toBeLessThanOrEqual(MAX_PIXELS);
    expect(r.dpi).toBeLessThan(1200);
    expect(r.width / r.height).toBeCloseTo(595.28 / 841.89, 2);

    const banner = renderSize(14400, 200, 300);
    expect(banner.width).toBeLessThanOrEqual(MAX_SIDE);
    expect(banner.limited).toBe(true);
  });
});

describe("parseDpi", () => {
  it("accepts whole or decimal values in range", () => {
    expect(parseDpi(" 200 ")).toEqual({ ok: true, dpi: 200 });
    expect(parseDpi("96.4")).toEqual({ ok: true, dpi: 96 });
  });

  it("explains bad values", () => {
    expect(parseDpi("")).toMatchObject({ ok: false });
    expect(parseDpi("abc")).toMatchObject({ ok: false });
    expect(parseDpi("10")).toEqual({ ok: false, error: "Pick a resolution from 36 to 1200 dpi" });
    expect(parseDpi("5000")).toMatchObject({ ok: false });
  });
});

describe("names and pages", () => {
  it("pads page numbers to the page count", () => {
    expect(pageFileName("report", 6, 120, "png")).toBe("report-page-007.png");
    expect(pageFileName("report", 0, 9, "jpg")).toBe("report-page-1.jpg");
  });

  it("drops repeated pages, keeping the order", () => {
    expect(distinctPages([2, 0, 2, 1, 0])).toEqual([2, 0, 1]);
  });
});
