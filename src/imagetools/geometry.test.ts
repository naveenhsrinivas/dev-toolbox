import { describe, expect, it } from "vitest";
import {
  canvasSize,
  clampRect,
  flip,
  IDENTITY,
  inscribedRect,
  mirrorRect,
  moveRect,
  type Orientation,
  parseAspect,
  type Rect,
  resizeAroundCenter,
  resizeRect,
  rotate90,
  rotatedBounds,
  totalAngle,
} from "./geometry";

const B = { width: 1000, height: 800 };
const inside = (r: Rect, b = B) => r.x >= 0 && r.y >= 0 && r.x + r.width <= b.width && r.y + r.height <= b.height;

/** Apply an orientation to a point of a w×h source (mirror, then rotate about the centre). */
function mapPoint(o: Orientation, w: number, h: number, x: number, y: number): [number, number] {
  let px = x - w / 2;
  const py = y - h / 2;
  if (o.mirror) px = -px;
  const r = (totalAngle(o) * Math.PI) / 180;
  return [Math.round(px * Math.cos(r) - py * Math.sin(r)), Math.round(px * Math.sin(r) + py * Math.cos(r))];
}

describe("orientation", () => {
  it("rotates in quarter turns and wraps around", () => {
    expect(rotate90(IDENTITY, 1).quarter).toBe(1);
    expect(rotate90(IDENTITY, -1).quarter).toBe(3);
    expect(rotate90(rotate90(rotate90(rotate90(IDENTITY, 1), 1), 1), 1)).toEqual(IDENTITY);
  });

  it("flips what's on screen, whatever the current rotation", () => {
    // Track the top-left corner of a 40×20 image through a mix of operations and compare with mirroring
    // the previous on-screen position directly.
    let o: Orientation = { quarter: 1, mirror: false, angle: 10 };
    const corner = () => mapPoint(o, 40, 20, 0, 0);
    for (const axis of ["horizontal", "vertical", "horizontal"] as const) {
      const [x, y] = corner();
      o = flip(o, axis);
      expect(corner()).toEqual(axis === "horizontal" ? [-x, y] : [x, -y]);
    }
    // Flipping twice on the same axis gets back where we started.
    expect(flip(flip(o, "vertical"), "vertical")).toEqual(o);
  });
});

describe("rotatedBounds / canvasSize", () => {
  it("swaps sides on quarter turns without rounding up", () => {
    expect(rotatedBounds({ width: 1000, height: 600 }, 90)).toEqual({ width: 600, height: 1000 });
    expect(canvasSize({ width: 1000, height: 600 }, { quarter: 3, mirror: true, angle: 0 })).toEqual({ width: 600, height: 1000 });
    expect(rotatedBounds({ width: 1000, height: 600 }, 0)).toEqual({ width: 1000, height: 600 });
  });

  it("grows to fit a tilted image", () => {
    // A 100×100 square at 45° needs a 141.4… box.
    expect(rotatedBounds({ width: 100, height: 100 }, 45)).toEqual({ width: 142, height: 142 });
    expect(rotatedBounds({ width: 100, height: 100 }, -45)).toEqual({ width: 142, height: 142 });
  });
});

describe("inscribedRect", () => {
  it("is the whole image when not tilted", () => {
    expect(inscribedRect({ width: 1000, height: 800 }, 0)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    expect(inscribedRect({ width: 1000, height: 800 }, 0, 1)).toEqual({ x: 100, y: 0, width: 800, height: 800 });
  });

  it("stays inside the tilted image, so no empty corners", () => {
    for (const angle of [-45, -30, -7.5, 3, 20, 45]) {
      for (const aspect of [undefined, 1, 16 / 9, 35 / 45]) {
        const img = { width: 1200, height: 900 };
        const r = inscribedRect(img, angle, aspect);
        const bounds = rotatedBounds(img, angle);
        expect(inside(r, bounds)).toBe(true);
        // Every corner maps back inside the unrotated image.
        const rad = (-angle * Math.PI) / 180;
        for (const [x, y] of [
          [r.x, r.y],
          [r.x + r.width, r.y],
          [r.x, r.y + r.height],
          [r.x + r.width, r.y + r.height],
        ]) {
          const px = x - bounds.width / 2;
          const py = y - bounds.height / 2;
          const ux = px * Math.cos(rad) - py * Math.sin(rad);
          const uy = px * Math.sin(rad) + py * Math.cos(rad);
          expect(Math.abs(ux)).toBeLessThanOrEqual(img.width / 2 + 0.5);
          expect(Math.abs(uy)).toBeLessThanOrEqual(img.height / 2 + 0.5);
        }
        if (aspect) expect(Math.abs(r.width / r.height - aspect)).toBeLessThan(0.02);
      }
    }
  });

  it("is as big as it can be: one size larger would poke out", () => {
    const r = inscribedRect({ width: 1000, height: 1000 }, 45, 1);
    // A square inside a square rotated 45° has half the side: 707.
    expect(r.width).toBeGreaterThanOrEqual(706);
    expect(r.width).toBeLessThanOrEqual(708);
  });
});

describe("clampRect / moveRect", () => {
  it("slides a box back inside and shrinks one that is too big", () => {
    expect(clampRect({ x: -50, y: 790, width: 100, height: 100 }, B)).toEqual({ x: 0, y: 700, width: 100, height: 100 });
    expect(clampRect({ x: 10, y: 10, width: 5000, height: 50 }, B)).toEqual({ x: 0, y: 10, width: 1000, height: 50 });
  });

  it("keeps the aspect when shrinking", () => {
    expect(clampRect({ x: 0, y: 0, width: 1600, height: 900 }, B, 16 / 9)).toEqual({ x: 0, y: 0, width: 1000, height: 563 });
  });

  it("moves without leaving the bounds", () => {
    const start = { x: 100, y: 100, width: 200, height: 100 };
    expect(moveRect(start, 30, -20, B)).toEqual({ x: 130, y: 80, width: 200, height: 100 });
    expect(moveRect(start, 5000, 5000, B)).toEqual({ x: 800, y: 700, width: 200, height: 100 });
  });
});

describe("resizeRect", () => {
  const start = { x: 200, y: 200, width: 400, height: 300 };

  it("keeps the opposite corner fixed", () => {
    expect(resizeRect(start, "se", 50, 20, B)).toEqual({ x: 200, y: 200, width: 450, height: 320 });
    expect(resizeRect(start, "nw", -50, -20, B)).toEqual({ x: 150, y: 180, width: 450, height: 320 });
    expect(resizeRect(start, "e", 100, 999, B)).toEqual({ x: 200, y: 200, width: 500, height: 300 });
    expect(resizeRect(start, "n", 999, 50, B)).toEqual({ x: 200, y: 250, width: 400, height: 250 });
  });

  it("stops at the image edge", () => {
    expect(resizeRect(start, "se", 5000, 5000, B)).toEqual({ x: 200, y: 200, width: 800, height: 600 });
    expect(resizeRect(start, "w", -5000, 0, B)).toEqual({ x: 0, y: 200, width: 600, height: 300 });
  });

  it("doesn't turn inside out and respects the minimum size", () => {
    expect(resizeRect(start, "se", -1000, -1000, B, undefined, 10)).toEqual({ x: 200, y: 200, width: 10, height: 10 });
    expect(resizeRect(start, "nw", 1000, 1000, B, undefined, 10)).toEqual({ x: 590, y: 490, width: 10, height: 10 });
  });

  it("keeps a fixed aspect on corners and edges", () => {
    const sq = { x: 100, y: 100, width: 200, height: 200 };
    expect(resizeRect(sq, "se", 100, 10, B, 1)).toEqual({ x: 100, y: 100, width: 300, height: 300 });
    // An edge handle grows the other side evenly about the centre.
    expect(resizeRect(sq, "e", 100, 0, B, 1)).toEqual({ x: 100, y: 50, width: 300, height: 300 });
    expect(resizeRect(sq, "s", 0, 50, B, 1)).toEqual({ x: 75, y: 100, width: 250, height: 250 });
  });

  it("limits an aspect-locked box by whichever side runs out of room first", () => {
    const r = resizeRect({ x: 0, y: 0, width: 160, height: 90 }, "se", 5000, 5000, B, 16 / 9);
    expect(r).toEqual({ x: 0, y: 0, width: 1000, height: 563 });
    const passport = resizeRect({ x: 400, y: 300, width: 70, height: 90 }, "ne", 1000, -1000, B, 35 / 45);
    expect(inside(passport)).toBe(true);
    expect(passport.y + passport.height).toBe(390); // bottom edge stayed put
    expect(passport.x).toBe(400);
    expect(Math.abs(passport.width / passport.height - 35 / 45)).toBeLessThan(0.01);
  });
});

describe("resizeAroundCenter / mirrorRect", () => {
  it("keeps the centre when typing a size, then clamps", () => {
    expect(resizeAroundCenter({ x: 400, y: 300, width: 200, height: 200 }, 100, 50, B)).toEqual({ x: 450, y: 375, width: 100, height: 50 });
    expect(resizeAroundCenter({ x: 0, y: 0, width: 200, height: 200 }, 400, 999, B, 2)).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });

  it("mirrors within the bounds", () => {
    const r = { x: 100, y: 50, width: 200, height: 100 };
    expect(mirrorRect(r, B, "horizontal")).toEqual({ x: 700, y: 50, width: 200, height: 100 });
    expect(mirrorRect(r, B, "vertical")).toEqual({ x: 100, y: 650, width: 200, height: 100 });
  });
});

describe("parseAspect", () => {
  it("reads common ways of writing a ratio", () => {
    expect(parseAspect("16:9")).toBeCloseTo(16 / 9);
    expect(parseAspect("4/3")).toBeCloseTo(4 / 3);
    expect(parseAspect("35 x 45")).toBeCloseTo(35 / 45);
    expect(parseAspect("1.5")).toBe(1.5);
    expect(parseAspect("0:3")).toBeUndefined();
    expect(parseAspect("wide")).toBeUndefined();
  });
});
