// PDF size changes that don't need a browser: recompressing images (through an
// injected codec), dropping unused objects, and padding a file to an exact size.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFRef, PDFStream } from "pdf-lib";

export class PdfReadError extends Error {}

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err instanceof Error && /encrypt/i.test(err.message)) {
      throw new PdfReadError("This PDF is password-protected or encrypted. Remove the protection first.");
    }
    throw new PdfReadError("This file couldn't be read as a PDF. It may be damaged.");
  }
  if (doc.getPageCount() === 0) throw new PdfReadError("This PDF has no pages.");
  return doc;
}

/** An image found in the PDF, in a form a codec can decode. */
export interface SourceImage {
  kind: "jpeg" | "raw";
  /** JPEG file bytes, or decompressed 8-bit samples (`components` per pixel). */
  data: Uint8Array;
  width: number;
  height: number;
  components: 1 | 3;
}

export interface EncodedImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

export interface ImageSettings {
  /** JPEG quality, 0–1. */
  quality: number;
  /** Longest side in pixels; larger images are scaled down. */
  maxSide: number;
}

/** Turns a source image into a smaller JPEG. Returns null when it can't. */
export type ImageCodec = (img: SourceImage, settings: ImageSettings) => Promise<EncodedImage | null>;

/** Undo zlib/deflate compression (FlateDecode). */
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

const N = (s: string) => PDFName.of(s);

function componentsOf(doc: PDFDocument, cs: PDFObject | undefined): 1 | 3 | null {
  const v = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  if (v === N("DeviceRGB")) return 3;
  if (v === N("DeviceGray")) return 1;
  if (v instanceof PDFArray && v.size() === 2 && v.lookup(0) === N("ICCBased")) {
    const profile = v.lookup(1);
    const n = profile instanceof PDFStream ? profile.dict.lookup(N("N")) : undefined;
    if (n instanceof PDFNumber && (n.asNumber() === 1 || n.asNumber() === 3)) return n.asNumber() as 1 | 3;
  }
  // CMYK, indexed, Lab and other colour spaces are left alone.
  return null;
}

/** Images that act as masks for other images must keep their exact format. */
function maskRefs(doc: PDFDocument): Set<string> {
  const refs = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue;
    for (const key of ["SMask", "Mask"]) {
      const v = obj.dict.get(N(key));
      if (v instanceof PDFRef) refs.add(v.toString());
    }
  }
  return refs;
}

export interface ImageStats {
  found: number;
  recompressed: number;
  savedBytes: number;
}

/**
 * Re-encode photos and scans inside the PDF as smaller JPEGs. Text and vector
 * drawings are untouched, so the text stays sharp and selectable.
 */
export async function recompressImages(
  doc: PDFDocument,
  settings: ImageSettings,
  codec: ImageCodec,
  inflate: Inflate,
  onProgress?: (done: number, total: number) => void,
): Promise<ImageStats> {
  const masks = maskRefs(doc);
  const images = doc.context
    .enumerateIndirectObjects()
    .filter(([, obj]) => obj instanceof PDFRawStream && obj.dict.lookup(N("Subtype")) === N("Image")) as [PDFRef, PDFRawStream][];
  const stats: ImageStats = { found: images.length, recompressed: 0, savedBytes: 0 };

  for (const [i, [ref, stream]] of images.entries()) {
    onProgress?.(i, images.length);
    // Let the page repaint the progress message.
    if (i % 4 === 0) await new Promise((resolve) => setTimeout(resolve));
    const d = stream.dict;
    if (masks.has(ref.toString()) || d.lookup(N("ImageMask"))?.toString() === "true" || d.has(N("Decode"))) continue;
    const width = (d.lookup(N("Width")) as PDFNumber | undefined)?.asNumber() ?? 0;
    const height = (d.lookup(N("Height")) as PDFNumber | undefined)?.asNumber() ?? 0;
    const bpc = (d.lookup(N("BitsPerComponent")) as PDFNumber | undefined)?.asNumber();
    const components = componentsOf(doc, d.get(N("ColorSpace")));
    if (!components || width < 16 || height < 16 || stream.contents.length < 8 * 1024) continue;

    let filter = d.lookup(N("Filter"));
    if (filter instanceof PDFArray && filter.size() === 1) filter = filter.lookup(0);
    let source: SourceImage;
    try {
      if (filter === N("DCTDecode")) {
        source = { kind: "jpeg", data: stream.contents, width, height, components };
      } else if (filter === N("FlateDecode") && bpc === 8) {
        const parms = d.lookup(N("DecodeParms"));
        const predictor = parms instanceof PDFDict ? (parms.lookup(N("Predictor")) as PDFNumber | undefined)?.asNumber() : undefined;
        if (predictor && predictor > 1) continue;
        const data = await inflate(stream.contents);
        if (data.length < width * height * components) continue;
        source = { kind: "raw", data, width, height, components };
      } else {
        continue;
      }
      const out = await codec(source, settings);
      // Keep the original unless the new one is clearly smaller.
      if (!out || out.jpeg.length > stream.contents.length * 0.9) continue;

      const dict = d.clone(doc.context);
      dict.set(N("Filter"), N("DCTDecode"));
      dict.set(N("Width"), PDFNumber.of(out.width));
      dict.set(N("Height"), PDFNumber.of(out.height));
      dict.set(N("BitsPerComponent"), PDFNumber.of(8));
      // The codec always writes colour JPEGs.
      dict.set(N("ColorSpace"), N("DeviceRGB"));
      dict.delete(N("DecodeParms"));
      doc.context.assign(ref, PDFRawStream.of(dict, out.jpeg));
      stats.recompressed++;
      stats.savedBytes += stream.contents.length - out.jpeg.length;
    } catch {
      // An image we can't decode is kept as it was.
    }
  }
  onProgress?.(images.length, images.length);
  return stats;
}

/** Delete objects nothing refers to, such as leftovers from earlier edits. Returns how many were removed. */
export function removeUnusedObjects(doc: PDFDocument): number {
  const { context } = doc;
  const seen = new Set<string>();
  const stack: PDFObject[] = [context.trailerInfo.Root, context.trailerInfo.Info].filter((o): o is PDFObject => !!o);
  while (stack.length) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      const target = context.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFDict) {
      stack.push(...obj.entries().map(([, v]) => v));
    } else if (obj instanceof PDFArray) {
      stack.push(...obj.asArray());
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }
  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) {
      context.delete(ref);
      removed++;
    }
  }
  return removed;
}

/** Remove the XMP metadata stream and page thumbnails, which viewers don't need. */
export function stripExtras(doc: PDFDocument) {
  doc.catalog.delete(N("Metadata"));
  for (const page of doc.getPages()) page.node.delete(N("Thumb"));
}

const PADDING_KEY = N("DevToolboxPadding");

/**
 * Make the PDF exactly `target` bytes by adding an unused block of filler data.
 * The pages and their content are unchanged. Throws if the file is already bigger.
 */
export async function padPdfToSize(bytes: Uint8Array, target: number): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  // The filler is a stream hung off the catalog under a private key, which viewers ignore.
  let size = 0;
  const attempt = async (n: number) => {
    const ref = doc.context.register(PDFRawStream.of(doc.context.obj({}), new Uint8Array(n).fill(0x20)));
    doc.catalog.set(PADDING_KEY, ref);
    const out = await doc.save({ useObjectStreams: false });
    doc.context.delete(ref);
    return out;
  };
  let out = await attempt(0);
  if (out.length > target) throw new RangeError(`The PDF is already ${out.length} bytes, which is more than the target.`);
  // The length of the filler shifts a few numbers in the file (its /Length, the
  // cross-reference offsets), so adjust until the total is exact.
  for (let i = 0; i < 6 && out.length !== target; i++) {
    size = Math.max(0, size + target - out.length);
    out = await attempt(size);
  }
  if (out.length !== target) throw new Error("Couldn't hit the exact size.");
  return out;
}
