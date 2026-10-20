// All PDF work happens here, in the browser. Nothing is uploaded.
import { PDFDocument } from "pdf-lib";
import { loadPdfJs } from "../pdfedit/pdfjs";

export class PdfReadError extends Error {}

/** Check a file is a readable, unencrypted PDF and count its pages. */
export async function inspectPdf(bytes: Uint8Array): Promise<{ pageCount: number }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err instanceof Error && /encrypt/i.test(err.message)) {
      throw new PdfReadError("This PDF is password-protected or encrypted, so it can't be merged. Remove the protection first.");
    }
    throw new PdfReadError("This file couldn't be read as a PDF. It may be damaged.");
  }
  const pageCount = doc.getPageCount();
  if (pageCount === 0) throw new PdfReadError("This PDF has no pages.");
  return { pageCount };
}

/** Draw the first page into a canvas, about `width` CSS pixels wide. */
export async function renderThumbnail(bytes: Uint8Array, width: number): Promise<HTMLCanvasElement> {
  const pdfjs = await loadPdfJs();

  // pdf.js takes ownership of the buffer it's given, so give it a copy.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const scale = (width * devicePixelRatio) / page.getViewport({ scale: 1 }).width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas;
  } finally {
    void task.destroy();
  }
}

export interface MergePart {
  bytes: Uint8Array;
  /** Zero-based page indices to take, in order. */
  pages: number[];
}

/** Copy the chosen pages of each part, in order, into one new PDF. */
export async function mergePdfs(parts: MergePart[], onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const [i, part] of parts.entries()) {
    onProgress?.(i, parts.length);
    // Let the page repaint the progress message between files.
    await new Promise((resolve) => setTimeout(resolve));
    const src = await PDFDocument.load(part.bytes, { updateMetadata: false });
    const pages = await out.copyPages(src, part.pages);
    for (const page of pages) out.addPage(page);
  }
  onProgress?.(parts.length, parts.length);
  out.setProducer("Dev Toolbox PDF Merge (in-browser)");
  out.setCreationDate(new Date());
  return out.save();
}
