import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { padPdfToSize, recompressImages, removeUnusedObjects } from "./core";
import { parseSize } from "./size";

async function samplePdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([300, 400]).drawText(`Page ${i + 1}`, { x: 20, y: 350 });
  return doc.save();
}

describe("padPdfToSize", () => {
  it("makes the file exactly the requested size and keeps it readable", async () => {
    const src = await samplePdf();
    for (const target of [src.length + 1000, 50_000, 1_234_567]) {
      const out = await padPdfToSize(src, target);
      expect(out.length).toBe(target);
      const doc = await PDFDocument.load(out);
      expect(doc.getPageCount()).toBe(2);
    }
  });

  it("refuses a target smaller than the file", async () => {
    await expect(padPdfToSize(await samplePdf(), 100)).rejects.toThrow(RangeError);
  });
});

describe("removeUnusedObjects", () => {
  it("drops orphaned objects and keeps the pages", async () => {
    const doc = await PDFDocument.load(await samplePdf());
    doc.context.register(PDFRawStream.of(doc.context.obj({}), new Uint8Array(50_000)));
    expect(removeUnusedObjects(doc)).toBe(1);
    const out = await PDFDocument.load(await doc.save());
    expect(out.getPageCount()).toBe(2);
  });
});

describe("recompressImages", () => {
  it("replaces a large raw image with the codec's JPEG and fixes its dictionary", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const data = new Uint8Array(100 * 100 * 3).fill(128);
    // Stored with FlateDecode; the test's inflate passes the bytes through unchanged.
    const ref = doc.context.register(
      doc.context.stream(data, {
        Type: "XObject",
        Subtype: "Image",
        Width: 100,
        Height: 100,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        Filter: "FlateDecode",
      }),
    );
    page.node.setXObject(PDFName.of("Im1"), ref);
    const jpeg = new Uint8Array(1000);
    const stats = await recompressImages(
      doc,
      { quality: 0.5, maxSide: 50 },
      async (img) => {
        expect(img).toMatchObject({ kind: "raw", width: 100, height: 100, components: 3 });
        return { jpeg, width: 50, height: 50 };
      },
      async (d) => d,
    );
    expect(stats).toMatchObject({ found: 1, recompressed: 1, savedBytes: data.length - jpeg.length });
    const img = doc.context.lookup(ref) as PDFRawStream;
    expect(img.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("DCTDecode"));
    expect(img.dict.get(PDFName.of("Width"))?.toString()).toBe("50");
    expect(img.contents.length).toBe(1000);
  });
});

describe("parseSize", () => {
  it("converts KB and MB to bytes", () => {
    expect(parseSize("500", "KB")).toBe(512_000);
    expect(parseSize("1,5", "MB")).toBe(1_572_864);
    expect(parseSize("", "KB")).toBeNull();
    expect(parseSize("-3", "KB")).toBeNull();
    expect(parseSize("abc", "MB")).toBeNull();
  });
});
