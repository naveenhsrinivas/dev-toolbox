// Builds the edited PDF: copies the pages in their new order and rotation, then draws
// the added text, shapes, drawings and images onto them.
import {
  BlendMode,
  degrees,
  LineCapStyle,
  type PDFFont,
  type PDFImage,
  PDFDocument,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
} from "pdf-lib";
import { normalizeRotation } from "./geometry";
import { type Annotation, type FontName, hexToRgb, LINE_HEIGHT, type PageModel, type StoredImage, unsupportedChars } from "./model";

const FONTS: Record<FontName, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  Times: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
};

const color = (hex: string) => rgb(...hexToRgb(hex));

export class SaveError extends Error {}

/**
 * Isolate the page's existing drawing state, so what we add isn't shifted or scaled by
 * graphics settings the original content left behind.
 */
function isolateContent(doc: PDFDocument, page: PDFPage) {
  const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]));
  const end = doc.context.register(doc.context.contentStream([popGraphicsState()]));
  page.node.wrapContentStreams(start, end);
}

export async function buildPdf(
  pages: PageModel[],
  sources: Map<number, Uint8Array>,
  images: Map<string, StoredImage>,
): Promise<Uint8Array> {
  for (const p of pages)
    for (const a of p.annotations) {
      if (a.type !== "text") continue;
      const bad = unsupportedChars(a.text);
      if (bad.length)
        throw new SaveError(
          `Text can't include ${bad.slice(0, 5).join(" ")} — the built-in PDF fonts only cover Western European characters.`,
        );
    }

  const out = await PDFDocument.create();
  const loaded = new Map<number, PDFDocument>();
  const fonts = new Map<FontName, PDFFont>();
  const embedded = new Map<string, PDFImage>();

  for (const model of pages) {
    let page: PDFPage;
    if ("blank" in model.src) {
      page = out.addPage([model.src.width, model.src.height]);
    } else {
      let src = loaded.get(model.src.source);
      if (!src) {
        src = await PDFDocument.load(sources.get(model.src.source)!, { updateMetadata: false });
        loaded.set(model.src.source, src);
      }
      [page] = await out.copyPages(src, [model.src.index]);
      out.addPage(page);
    }
    page.setRotation(degrees(normalizeRotation(page.getRotation().angle + model.userRotation)));
    if (!model.annotations.length) continue;
    if (!("blank" in model.src)) isolateContent(out, page);
    for (const a of model.annotations) await draw(out, page, a, fonts, embedded, images);
  }
  out.setProducer("Dev Toolbox PDF Editor (in-browser)");
  out.setModificationDate(new Date());
  return out.save();
}

async function draw(
  doc: PDFDocument,
  page: PDFPage,
  a: Annotation,
  fonts: Map<FontName, PDFFont>,
  embedded: Map<string, PDFImage>,
  images: Map<string, StoredImage>,
) {
  switch (a.type) {
    case "text": {
      if (!a.text.trim()) return;
      let font = fonts.get(a.font);
      if (!font) fonts.set(a.font, (font = await doc.embedFont(FONTS[a.font])));
      page.drawText(a.text.replace(/\t/g, "    "), {
        x: a.x,
        y: a.y,
        size: a.size,
        font,
        color: color(a.color),
        lineHeight: a.size * LINE_HEIGHT,
        rotate: degrees(a.rotation),
      });
      return;
    }
    case "rect": {
      const box = { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), width: Math.abs(a.x2 - a.x1), height: Math.abs(a.y2 - a.y1) };
      if (a.style === "whiteout") page.drawRectangle({ ...box, color: rgb(1, 1, 1) });
      else if (a.style === "highlight") page.drawRectangle({ ...box, color: color(a.color), opacity: 0.4, blendMode: BlendMode.Multiply });
      else page.drawRectangle({ ...box, borderColor: color(a.color), borderWidth: 2 });
      return;
    }
    case "ink": {
      const c = color(a.color);
      const pts = a.points.length === 1 ? [a.points[0], { x: a.points[0].x + 0.01, y: a.points[0].y }] : a.points;
      for (let i = 1; i < pts.length; i++) {
        page.drawLine({ start: pts[i - 1], end: pts[i], thickness: a.width, color: c, lineCap: LineCapStyle.Round });
      }
      return;
    }
    case "image": {
      const img = images.get(a.imageId);
      if (!img) return;
      let pdfImage = embedded.get(a.imageId);
      if (!pdfImage) {
        pdfImage = img.kind === "png" ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
        embedded.set(a.imageId, pdfImage);
      }
      page.drawImage(pdfImage, { x: a.x, y: a.y, width: a.w, height: a.h, rotate: degrees(a.rotation) });
      return;
    }
  }
}
