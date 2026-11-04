// Browser side of Image to PDF: decoding images, re-encoding them with a canvas
// when needed, and writing the PDF with pdf-lib.
import { concatTransformationMatrix, drawObject, type PDFImage, PDFDocument, popGraphicsState, pushGraphicsState } from "pdf-lib";
import {
  canKeepJpeg,
  type ImageKind,
  type JpegInfo,
  layoutPage,
  type Margin,
  type Orientation,
  type PageSize,
  placementMatrix,
  type Quality,
  QUALITY,
  readJpeg,
  scaleToMax,
  shownSize,
} from "./imagelayout";

export interface SourceImage {
  name: string;
  bytes: Uint8Array;
  kind: ImageKind;
  /** Upright size in pixels, as the browser shows it. */
  width: number;
  height: number;
  /** Header of a JPEG, used to embed its bytes unchanged. */
  jpeg?: JpegInfo;
  /** Clockwise quarter turns chosen by the user. */
  turns: number;
}

export interface BuildOptions {
  pageSize: PageSize;
  orientation: Orientation;
  margin: Margin;
  quality: Quality;
}

export class ImageError extends Error {}

const MIME: Record<ImageKind, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
};

function decode(img: Pick<SourceImage, "bytes" | "kind">): Promise<ImageBitmap> {
  // EXIF orientation is applied here, so canvas output is already upright.
  return createImageBitmap(new Blob([img.bytes as Uint8Array<ArrayBuffer>], { type: MIME[img.kind] }), { imageOrientation: "from-image" });
}

/** Read the size of an image (and check the browser can decode it). */
export async function probeImage(bytes: Uint8Array, kind: ImageKind): Promise<{ width: number; height: number; jpeg?: JpegInfo }> {
  const bitmap = await decode({ bytes, kind });
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  const jpeg = kind === "jpeg" ? (readJpeg(bytes) ?? undefined) : undefined;
  return { ...size, jpeg };
}

function encode(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject)
          : reject(new ImageError("The image is too large to convert.")),
      type,
      quality,
    ),
  );
}

async function redraw(img: SourceImage, maxSide: number, type: "image/png" | "image/jpeg", quality?: number) {
  const bitmap = await decode(img);
  const [w, h] = scaleToMax(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("The image is too large to convert.");
  if (type === "image/jpeg") {
    // JPEG has no transparency; show see-through areas as white rather than black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  try {
    return { data: await encode(canvas, type, quality), resized: w !== img.width || h !== img.height };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** Embed one image and say how it must be turned (its EXIF orientation, if the bytes are kept as-is). */
async function embed(pdf: PDFDocument, img: SourceImage, quality: Quality): Promise<{ image: PDFImage; orientation: number }> {
  const keepJpeg = img.kind === "jpeg" && img.jpeg && canKeepJpeg(img.jpeg);
  if (quality === "original") {
    if (keepJpeg) return { image: await pdf.embedJpg(img.bytes), orientation: img.jpeg!.orientation };
    if (img.kind === "png") {
      try {
        return { image: await pdf.embedPng(img.bytes), orientation: 1 };
      } catch {
        // Fall through to a canvas round trip for PNGs pdf-lib can't parse.
      }
    }
    // Lossless for everything else, except photos that were already JPEG (CMYK and the like).
    const { data } = img.kind === "jpeg" ? await redraw(img, Infinity, "image/jpeg", 0.92) : await redraw(img, Infinity, "image/png");
    return { image: img.kind === "jpeg" ? await pdf.embedJpg(data) : await pdf.embedPng(data), orientation: 1 };
  }
  const { quality: q, maxSide } = QUALITY[quality];
  const { data, resized } = await redraw(img, maxSide, "image/jpeg", q);
  // Re-encoding a JPEG at full size can make it bigger; keep the original then.
  if (keepJpeg && !resized && data.length >= img.bytes.length) {
    return { image: await pdf.embedJpg(img.bytes), orientation: img.jpeg!.orientation };
  }
  return { image: await pdf.embedJpg(data), orientation: 1 };
}

/** One page per image, in order. */
export async function imagesToPdf(
  images: SourceImage[],
  options: BuildOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (const [i, img] of images.entries()) {
    onProgress?.(i, images.length);
    // Let the page repaint the progress message between images.
    await new Promise((resolve) => setTimeout(resolve));
    let embedded;
    try {
      embedded = await embed(pdf, img, options.quality);
    } catch (err) {
      throw new ImageError(`${img.name} couldn't be added${err instanceof ImageError ? `: ${err.message}` : ". It may be damaged."}`);
    }
    const { image, orientation } = embedded;
    // Size the page from the upright source, so "Fit to image" pages don't shrink when the image is downscaled.
    const [w, h] = shownSize(img.width, img.height, 1, img.turns);
    const layout = layoutPage(w, h, options);
    const page = pdf.addPage([layout.pageWidth, layout.pageHeight]);
    const name = page.node.newXObject("Image", image.ref);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...placementMatrix(orientation, img.turns, layout)),
      drawObject(name),
      popGraphicsState(),
    );
  }
  onProgress?.(images.length, images.length);
  pdf.setProducer("Dev Toolbox Image to PDF (in-browser)");
  pdf.setCreator("Dev Toolbox");
  pdf.setCreationDate(new Date());
  return pdf.save({ useObjectStreams: true });
}
