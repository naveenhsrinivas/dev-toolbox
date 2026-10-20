// Loads pdf.js (large) only when the PDF editor is first used.
import type * as PdfJs from "pdfjs-dist";

let loading: Promise<typeof PdfJs> | undefined;

export function loadPdfJs(): Promise<typeof PdfJs> {
  loading ??= (async () => {
    const pdfjs = await import("pdfjs-dist");
    const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  })();
  return loading;
}
