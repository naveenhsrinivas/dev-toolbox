// Planning and splitting for PDF Split. No DOM here, so it runs (and is tested) in node.
import { PDFDocument } from "pdf-lib";
import { parsePageRanges } from "../pdfmerge/ranges";

export type SplitMode = "ranges" | "every" | "extract" | "each";

export interface SplitPart {
  /** Zero-based page indices, in output order. */
  pages: number[];
}

export type PlanResult = { ok: true; parts: SplitPart[] } | { ok: false; error: string };

export class PdfReadError extends Error {}

/**
 * Work out which output files a split produces.
 *
 * - ranges: every comma-separated group ("1-3, 4-6, 7-") becomes its own file.
 * - every: consecutive chunks of `n` pages; the last one may be shorter.
 * - extract: the selected pages, in the order written, as a single file.
 * - each: one file per page.
 */
export function planSplit(mode: SplitMode, input: { ranges?: string; n?: number }, pageCount: number): PlanResult {
  switch (mode) {
    case "ranges": {
      const groups = (input.ranges ?? "").split(",").map((g) => g.trim());
      if (groups.every((g) => !g)) return { ok: false, error: "Enter the page ranges, like 1-3, 4-6, 7-" };
      const parts: SplitPart[] = [];
      for (const group of groups) {
        if (!group) continue;
        // "all" means something else here (the whole document as one file), which is fine.
        const r = parsePageRanges(group, pageCount);
        if (!r.ok) return r;
        parts.push({ pages: r.pages });
      }
      return { ok: true, parts };
    }
    case "every": {
      const n = input.n ?? NaN;
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: "Enter how many pages each file should have (1 or more)" };
      const parts: SplitPart[] = [];
      for (let start = 0; start < pageCount; start += n) {
        parts.push({ pages: Array.from({ length: Math.min(n, pageCount - start) }, (_, i) => start + i) });
      }
      return { ok: true, parts };
    }
    case "extract": {
      if (!(input.ranges ?? "").trim()) return { ok: false, error: "Enter the pages to extract, like 1, 3, 5-7" };
      const r = parsePageRanges(input.ranges ?? "", pageCount);
      return r.ok ? { ok: true, parts: [{ pages: r.pages }] } : r;
    }
    case "each":
      return { ok: true, parts: Array.from({ length: pageCount }, (_, i) => ({ pages: [i] })) };
  }
}

/** Zero-based pages that no part includes. */
export function uncoveredPages(parts: SplitPart[], pageCount: number): number[] {
  const used = new Set(parts.flatMap((p) => p.pages));
  return Array.from({ length: pageCount }, (_, i) => i).filter((i) => !used.has(i));
}

/** Group zero-based pages into runs, as one-based [first, last] pairs: [0,1,2,4] → [[1,3],[5,5]]. */
export function pageRuns(pages: number[]): [number, number][] {
  const runs: [number, number][] = [];
  for (const p of pages) {
    const last = runs[runs.length - 1];
    // Only ascending runs are merged, so a reversed selection ("3-1") lists each page.
    if (last && p + 1 === last[1] + 1) last[1] = p + 1;
    else runs.push([p + 1, p + 1]);
  }
  return runs;
}

/** "1–3, 5, 8–10" for showing a page list to people. */
export function describePages(pages: number[]): string {
  return pageRuns(pages)
    .map(([a, b]) => (a === b ? String(a) : `${a}–${b}`))
    .join(", ");
}

/**
 * File name (without extension) for one part, such as "report-p01-03" or
 * "report-p04_07". Page numbers are zero-padded to the document's page count so
 * files sort in order; very scattered selections fall back to "report-part-2".
 */
export function partName(base: string, part: SplitPart, index: number, pageCount: number): string {
  const width = String(pageCount).length;
  const pad = (n: number) => String(n).padStart(width, "0");
  const label = pageRuns(part.pages)
    .map(([a, b]) => (a === b ? pad(a) : `${pad(a)}-${pad(b)}`))
    .join("_");
  return label.length <= 40 ? `${base}-p${label}` : `${base}-part-${index + 1}`;
}

/** Load a PDF with pdf-lib, turning its errors into messages people can act on. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err instanceof Error && /encrypt/i.test(err.message)) {
      throw new PdfReadError("This PDF is password-protected or encrypted, so it can't be split. Remove the protection first.");
    }
    throw new PdfReadError("This file couldn't be read as a PDF. It may be damaged.");
  }
  if (doc.getPageCount() === 0) throw new PdfReadError("This PDF has no pages.");
  return doc;
}

/** Copy each part's pages into its own new PDF. */
export async function splitPdf(
  source: PDFDocument,
  parts: SplitPart[],
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const title = source.getTitle();
  for (const [i, part] of parts.entries()) {
    await onProgress?.(i, parts.length);
    const doc = await PDFDocument.create();
    for (const page of await doc.copyPages(source, part.pages)) doc.addPage(page);
    if (title) doc.setTitle(title);
    doc.setProducer("Dev Toolbox PDF Split (in-browser)");
    doc.setCreationDate(new Date());
    out.push(await doc.save({ useObjectStreams: true }));
  }
  await onProgress?.(parts.length, parts.length);
  return out;
}
