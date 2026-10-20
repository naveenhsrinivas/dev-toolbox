import { concatTransformationMatrix, degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { deltaToPdf, makeViewport, normalizeRotation, toPdf, toScreen } from "./geometry";
import { moveAnnotation, type PageModel, unsupportedChars } from "./model";
import { buildPdf, SaveError } from "./save";

async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const a = doc.addPage([600, 800]);
  a.drawText("Page one", { x: 50, y: 700, size: 24, font });
  const b = doc.addPage([600, 800]);
  b.setRotation(degrees(90));
  b.drawText("Page two", { x: 50, y: 700, size: 24, font });
  // A page whose content leaves the graphics state scaled, to check additions aren't affected.
  const c = doc.addPage([300, 300]);
  c.pushOperators(concatTransformationMatrix(2, 0, 0, 2, 0, 0));
  c.drawRectangle({ x: 0, y: 0, width: 10, height: 10, color: rgb(1, 0, 0) });
  return doc.save();
}

describe("viewport geometry", () => {
  it("matches pdf.js for every rotation and an offset crop box", async () => {
    const bytes = await samplePdf();
    const pdf = await getDocument({ data: bytes.slice() }).promise;
    const page = await pdf.getPage(1);
    for (const rotation of [0, 90, 180, 270]) {
      const ours = makeViewport(page.view, 1.5, rotation);
      const theirs = page.getViewport({ scale: 1.5, rotation });
      expect(ours.transform.map((n) => +n.toFixed(6))).toEqual(theirs.transform.map((n: number) => +n.toFixed(6)));
      expect([ours.width, ours.height]).toEqual([theirs.width, theirs.height]);
    }
    const shifted = makeViewport([100, 50, 400, 450], 2, 90);
    for (const p of [
      { x: 120, y: 60 },
      { x: 399, y: 449 },
    ]) {
      const back = toPdf(shifted, toScreen(shifted, p));
      expect(back.x).toBeCloseTo(p.x);
      expect(back.y).toBeCloseTo(p.y);
    }
  });

  it("puts the top-left of an unrotated page at the screen origin, and moves the right way", () => {
    const vp = makeViewport([0, 0, 600, 800], 1, 0);
    expect(toScreen(vp, { x: 0, y: 800 })).toEqual({ x: 0, y: 0 });
    expect(deltaToPdf(vp, 10, 10)).toEqual({ x: 10, y: -10 });
    const r90 = makeViewport([0, 0, 600, 800], 1, 90);
    expect([r90.width, r90.height]).toEqual([800, 600]);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
  });
});

describe("model helpers", () => {
  it("finds characters the standard fonts can't draw", () => {
    expect(unsupportedChars("Café – “ok” €5\nline")).toEqual([]);
    expect(unsupportedChars("Hello 世界 👋")).toEqual(["世", "界", "👋"]);
  });

  it("moves every kind of annotation", () => {
    expect(moveAnnotation({ id: "1", type: "ink", points: [{ x: 1, y: 2 }], color: "#000", width: 2 }, 3, 4)).toMatchObject({
      points: [{ x: 4, y: 6 }],
    });
    expect(moveAnnotation({ id: "2", type: "rect", style: "box", x1: 0, y1: 0, x2: 5, y2: 5, color: "#000" }, 1, 1)).toMatchObject({
      x1: 1,
      y2: 6,
    });
  });
});

describe("saving", () => {
  it("reorders, rotates, adds blank pages and draws additions", async () => {
    const bytes = await samplePdf();
    const pages: PageModel[] = [
      { key: "b", src: { source: 1, index: 1 }, userRotation: 90, annotations: [] },
      {
        key: "a",
        src: { source: 1, index: 0 },
        userRotation: 0,
        annotations: [
          { id: "t", type: "text", x: 50, y: 600, text: "Added text\nSecond line", size: 18, color: "#2244aa", font: "Times", rotation: 0 },
          { id: "w", type: "rect", style: "whiteout", x1: 40, y1: 690, x2: 200, y2: 730, color: "#ffffff" },
          { id: "h", type: "rect", style: "highlight", x1: 40, y1: 590, x2: 200, y2: 620, color: "#ffe066" },
          {
            id: "i",
            type: "ink",
            points: [
              { x: 100, y: 100 },
              { x: 150, y: 150 },
              { x: 200, y: 120 },
            ],
            color: "#ff0000",
            width: 3,
          },
        ],
      },
      {
        key: "n",
        src: { blank: true, width: 612, height: 792 },
        userRotation: 0,
        annotations: [
          { id: "t2", type: "text", x: 72, y: 700, text: "On a blank page", size: 12, color: "#000000", font: "Courier", rotation: 0 },
        ],
      },
      {
        key: "c",
        src: { source: 1, index: 2 },
        userRotation: 0,
        annotations: [
          { id: "t3", type: "text", x: 20, y: 250, text: "Unscaled", size: 12, color: "#000000", font: "Helvetica", rotation: 0 },
        ],
      },
    ];
    const out = await buildPdf(pages, new Map([[1, bytes]]), new Map());
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([180, 0, 0, 0]);
    expect(doc.getPage(2).getSize()).toEqual({ width: 612, height: 792 });

    const pdf = await getDocument({ data: out.slice() }).promise;
    const textOf = async (n: number) =>
      (await (await pdf.getPage(n)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join("");
    expect(await textOf(1)).toContain("Page two");
    expect(await textOf(2)).toContain("Added text");
    expect(await textOf(2)).toContain("Second line");
    expect(await textOf(3)).toContain("On a blank page");

    // The text added to the page with a leftover "2x scale" lands where it was put, not twice as far.
    const items = (await (await pdf.getPage(4)).getTextContent()).items.filter((i) => "str" in i && i.str === "Unscaled");
    expect(items).toHaveLength(1);
    const t = (items[0] as { transform: number[] }).transform;
    expect([Math.round(t[4]), Math.round(t[5])]).toEqual([20, 250]);
  });

  it("refuses text the PDF fonts can't show, with a clear message", async () => {
    const pages: PageModel[] = [
      {
        key: "n",
        src: { blank: true, width: 100, height: 100 },
        userRotation: 0,
        annotations: [{ id: "t", type: "text", x: 1, y: 1, text: "你好", size: 12, color: "#000000", font: "Helvetica", rotation: 0 }],
      },
    ];
    await expect(buildPdf(pages, new Map(), new Map())).rejects.toBeInstanceOf(SaveError);
  });
});
