import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { describePages, loadPdf, pageRuns, partName, PdfReadError, planSplit, splitPdf, uncoveredPages } from "./split";

const pagesOf = (r: ReturnType<typeof planSplit>) => (r.ok ? r.parts.map((p) => p.pages) : r.error);

describe("planSplit", () => {
  it("makes one file per comma group in range mode", () => {
    expect(pagesOf(planSplit("ranges", { ranges: "1-3, 4-6, 7-" }, 8))).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7],
    ]);
    expect(pagesOf(planSplit("ranges", { ranges: "2, , 5-4" }, 5))).toEqual([[1], [4, 3]]);
  });

  it("reports the problem group in range mode", () => {
    expect(planSplit("ranges", { ranges: "1-3, 9" }, 5)).toEqual({ ok: false, error: "Page 9 doesn't exist (this file has 5 pages)" });
    expect(planSplit("ranges", { ranges: "1-3, x" }, 5)).toMatchObject({ ok: false, error: expect.stringContaining('"x"') });
    expect(planSplit("ranges", { ranges: " , " }, 5)).toMatchObject({ ok: false });
  });

  it("chunks every N pages, with a shorter last file", () => {
    expect(pagesOf(planSplit("every", { n: 3 }, 7))).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
    expect(pagesOf(planSplit("every", { n: 10 }, 4))).toEqual([[0, 1, 2, 3]]);
    expect(planSplit("every", { n: 0 }, 4)).toMatchObject({ ok: false });
    expect(planSplit("every", { n: 1.5 }, 4)).toMatchObject({ ok: false });
  });

  it("extracts the selected pages into one file, in the order written", () => {
    expect(pagesOf(planSplit("extract", { ranges: "5, 1-2" }, 6))).toEqual([[4, 0, 1]]);
    expect(planSplit("extract", { ranges: "" }, 6)).toMatchObject({ ok: false });
  });

  it("makes one file per page", () => {
    expect(pagesOf(planSplit("each", {}, 3))).toEqual([[0], [1], [2]]);
  });
});

describe("page labels", () => {
  it("groups ascending runs only", () => {
    expect(pageRuns([0, 1, 2, 4, 7, 8])).toEqual([
      [1, 3],
      [5, 5],
      [8, 9],
    ]);
    expect(pageRuns([2, 1, 0])).toEqual([
      [3, 3],
      [2, 2],
      [1, 1],
    ]);
    expect(describePages([0, 1, 2, 4])).toBe("1–3, 5");
  });

  it("names parts with padded page numbers", () => {
    expect(partName("report", { pages: [0, 1, 2] }, 0, 12)).toBe("report-p01-03");
    expect(partName("report", { pages: [3] }, 1, 12)).toBe("report-p04");
    expect(partName("report", { pages: [3, 6] }, 1, 9)).toBe("report-p4_7");
    const scattered = { pages: Array.from({ length: 30 }, (_, i) => i * 2) };
    expect(partName("report", scattered, 2, 100)).toBe("report-part-3");
  });

  it("lists pages left out of every part", () => {
    expect(uncoveredPages([{ pages: [0, 1] }, { pages: [4] }], 6)).toEqual([2, 3, 5]);
  });
});

// A document whose pages can be told apart by their width.
async function makePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Test document");
  for (let i = 0; i < pageCount; i++) doc.addPage([100 + i, 200]).drawText(`Page ${i + 1}`, { x: 10, y: 100, size: 12 });
  return doc.save();
}

const widths = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

describe("splitPdf", () => {
  it("writes each part as its own PDF with the right pages", async () => {
    const source = await loadPdf(await makePdf(7));
    const plan = planSplit("ranges", { ranges: "1-3, 6-4, 7" }, 7);
    if (!plan.ok) throw new Error(plan.error);
    const progress: number[] = [];
    const files = await splitPdf(source, plan.parts, (done) => void progress.push(done));
    expect(files).toHaveLength(3);
    expect(await widths(files[0])).toEqual([100, 101, 102]);
    expect(await widths(files[1])).toEqual([105, 104, 103]);
    expect(await widths(files[2])).toEqual([106]);
    expect(progress).toEqual([0, 1, 2, 3]);
    expect((await PDFDocument.load(files[0])).getTitle()).toBe("Test document");
  });

  it("splits every page of a document", async () => {
    const source = await loadPdf(await makePdf(4));
    const plan = planSplit("each", {}, 4);
    if (!plan.ok) throw new Error(plan.error);
    const files = await splitPdf(source, plan.parts);
    expect(await Promise.all(files.map(widths))).toEqual([[100], [101], [102], [103]]);
  });
});

describe("loadPdf", () => {
  it("explains files that aren't PDFs", async () => {
    await expect(loadPdf(new TextEncoder().encode("not a pdf"))).rejects.toThrow(PdfReadError);
  });
});
