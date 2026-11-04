// Browser-only parts of PDF compression: decoding and re-encoding images with a
// canvas, and turning whole pages into pictures for the strongest setting.
import { PDFDocument } from "pdf-lib";
import { loadPdfJs } from "../pdfedit/pdfjs";
import type { EncodedImage, ImageSettings, Inflate, SourceImage } from "./core";

export const inflate: Inflate = async (data) => {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error("Encoding failed"))),
      "image/jpeg",
      quality,
    ),
  );
}

function scaled(width: number, height: number, maxSide: number): [number, number] {
  const k = Math.min(1, maxSide / Math.max(width, height));
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

export async function jpegCodec(img: SourceImage, { quality, maxSide }: ImageSettings): Promise<EncodedImage | null> {
  let source: CanvasImageSource;
  if (img.kind === "jpeg") {
    source = await createImageBitmap(new Blob([img.data as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }));
  } else {
    const rgba = new Uint8ClampedArray(img.width * img.height * 4);
    for (let p = 0, s = 0; p < rgba.length; p += 4, s += img.components) {
      const r = img.data[s];
      rgba[p] = r;
      rgba[p + 1] = img.components === 3 ? img.data[s + 1] : r;
      rgba[p + 2] = img.components === 3 ? img.data[s + 2] : r;
      rgba[p + 3] = 255;
    }
    source = await createImageBitmap(new ImageData(rgba, img.width, img.height));
  }
  const [w, h] = scaled(img.width, img.height, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  if ("close" in source) source.close();
  const jpeg = await canvasToJpeg(canvas, quality);
  return { jpeg, width: w, height: h };
}

/**
 * Draw every page as a JPEG at `dpi` and build a new PDF from them. Pages keep
 * their size, but text can no longer be selected or searched.
 */
export async function rasterizePdf(
  bytes: Uint8Array,
  dpi: number,
  quality: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const src = await task.promise;
    const out = await PDFDocument.create();
    for (let i = 1; i <= src.numPages; i++) {
      onProgress?.(i - 1, src.numPages);
      const page = await src.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;
      const jpg = await out.embedJpg(await canvasToJpeg(canvas, quality));
      out.addPage([base.width, base.height]).drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    onProgress?.(src.numPages, src.numPages);
    out.setProducer("Dev Toolbox PDF Compress (in-browser)");
    return await out.save();
  } finally {
    void task.destroy();
  }
}
