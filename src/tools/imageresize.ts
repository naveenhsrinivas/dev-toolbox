import { canPad, fitToSize, MAX_SIDE, padImage, type ResizeBy, targetDimensions } from "../lib/image";
import { parseSize } from "../pdfsize/size";
import {
  button,
  checkbox,
  downloadBytes,
  field,
  formatBytes,
  h,
  header,
  icon,
  ICONS,
  message,
  safeFileName,
  segmented,
  type Tool,
} from "../ui";

const MAX_FILE = 100 * 1024 * 1024;
type Format = "image/jpeg" | "image/png" | "image/webp";
const EXT: Record<Format, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const LABEL: Record<Format, string> = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" };

/** Draw `src` at w×h, halving in steps first so big reductions stay smooth. */
function drawResized(src: CanvasImageSource & { width: number; height: number }, w: number, h: number, fill?: string): HTMLCanvasElement {
  let current: CanvasImageSource = src;
  let cw = src.width;
  let ch = src.height;
  while (cw / 2 >= w && ch / 2 >= h) {
    const step = document.createElement("canvas");
    step.width = cw = Math.round(cw / 2);
    step.height = ch = Math.round(ch / 2);
    const ctx = step.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, cw, ch);
    current = step;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, w, h);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: Format, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This browser couldn't encode the image."))), type, quality),
  );
}

function render(): HTMLElement {
  let img: { name: string; type: string; size: number; bitmap: ImageBitmap; url: string } | undefined;
  let resize: ResizeBy["by"] = "original";
  let format: "same" | Format = "same";
  let sizeMode: "none" | "max" | "exact" = "none";
  let keepAspect = true;
  let busy = false;
  let resultUrl: string | undefined;

  const picker = h("input", { type: "file", accept: "image/*", hidden: true });
  const drop = h(
    "label",
    { class: "dropzone" },
    picker,
    icon(ICONS.upload, "i big"),
    h("strong", {}, "Drop an image here"),
    h("span", {}, "JPEG, PNG, WebP, GIF or BMP. It's resized in your browser and never uploaded."),
  );
  const status = h("div", { role: "status" });
  const original = h("figure", { class: "ir-figure" });

  // Resolution
  const percent = h("input", { type: "number", min: 1, max: 1000, value: 50, class: "num-input", "aria-label": "Percentage" });
  const widthIn = h("input", { type: "number", min: 1, max: MAX_SIDE, class: "num-input", "aria-label": "Width in pixels" });
  const heightIn = h("input", { type: "number", min: 1, max: MAX_SIDE, class: "num-input", "aria-label": "Height in pixels" });
  const percentRow = h("div", { class: "ir-row", hidden: true }, percent, h("span", {}, "% of the original"));
  const pixelRow = h(
    "div",
    { class: "ir-row", hidden: true },
    widthIn,
    h("span", {}, "×"),
    heightIn,
    h("span", {}, "px"),
    checkbox("Keep aspect ratio", keepAspect, (v) => {
      keepAspect = v;
      syncFrom("width");
    }),
  );
  const syncFrom = (side: "width" | "height") => {
    if (!img || !keepAspect) return updatePreview();
    const { width, height } = img.bitmap;
    if (side === "width" && Number(widthIn.value) > 0)
      heightIn.value = String(Math.max(1, Math.round((height * Number(widthIn.value)) / width)));
    if (side === "height" && Number(heightIn.value) > 0)
      widthIn.value = String(Math.max(1, Math.round((width * Number(heightIn.value)) / height)));
    updatePreview();
  };
  widthIn.addEventListener("input", () => syncFrom("width"));
  heightIn.addEventListener("input", () => syncFrom("height"));
  percent.addEventListener("input", () => updatePreview());

  // Format and quality
  const formatSelect = h(
    "select",
    { "aria-label": "Format" },
    h("option", { value: "same" }, "Same as original"),
    ...(Object.keys(LABEL) as Format[]).map((f) => h("option", { value: f }, LABEL[f])),
  );
  const quality = h("input", { type: "range", min: 10, max: 100, value: 85, "aria-label": "Quality" });
  const qualityOut = h("output", {}, "85%");
  const qualityField = field("Quality", h("div", { class: "ir-row" }, quality, qualityOut), "Lower quality makes a smaller file.");
  quality.addEventListener("input", () => (qualityOut.textContent = `${quality.value}%`));
  formatSelect.addEventListener("change", () => {
    format = formatSelect.value as typeof format;
    updatePreview();
  });

  // File size
  const sizeIn = h("input", { type: "text", inputMode: "decimal", value: "100", class: "num-input", "aria-label": "File size" });
  const unit = h(
    "select",
    { class: "unit-select", "aria-label": "Unit" },
    h("option", { value: "KB" }, "KB"),
    h("option", { value: "MB" }, "MB"),
  );
  const sizeRow = h("div", { class: "ir-row", hidden: true }, sizeIn, unit);
  const sizeHint = h("p", { class: "hint" });

  const planned = h("p", { class: "ir-planned" });
  const outName = h("input", { type: "text", maxLength: 120, spellcheck: false, "aria-label": "File name" });
  const extLabel = h("span", {}, ".jpg");
  const goLabel = h("span", {}, "Resize image");
  const goBtn = button(h("span", {}, icon(ICONS.download), goLabel), () => void run(), "btn primary");
  const result = h("figure", { class: "ir-figure", hidden: true });

  const workspace = h(
    "div",
    { class: "ir-workspace", hidden: true },
    h("div", { class: "ir-previews" }, original, result),
    h(
      "div",
      { class: "ir-controls" },
      field(
        "Resolution",
        h(
          "div",
          { class: "ir-stack" },
          segmented(
            "Resolution",
            [
              ["original", "Keep"],
              ["percent", "Percentage"],
              ["pixels", "Pixels"],
            ],
            resize,
            (v) => {
              resize = v;
              percentRow.hidden = v !== "percent";
              pixelRow.hidden = v !== "pixels";
              updatePreview();
            },
          ),
          percentRow,
          pixelRow,
        ),
      ),
      field("Format", formatSelect),
      qualityField,
      field(
        "File size",
        h(
          "div",
          { class: "ir-stack" },
          segmented(
            "File size",
            [
              ["none", "Any"],
              ["max", "At most"],
              ["exact", "Exactly"],
            ],
            sizeMode,
            (v) => {
              sizeMode = v;
              updatePreview();
            },
          ),
          sizeRow,
          sizeHint,
        ),
      ),
      planned,
      h(
        "div",
        { class: "save-bar" },
        h("label", { class: "save-name" }, h("span", {}, "File name"), h("span", { class: "save-name-input" }, outName, extLabel)),
        goBtn,
      ),
    ),
  );

  function outFormat(): Format {
    if (format !== "same") return format;
    return img && img.type in LABEL ? (img.type as Format) : "image/png";
  }

  function dims(): [number, number] {
    if (!img) return [0, 0];
    const r: ResizeBy =
      resize === "percent"
        ? { by: "percent", percent: Number(percent.value) || 100 }
        : resize === "pixels"
          ? { by: "pixels", width: Number(widthIn.value) || undefined, height: Number(heightIn.value) || undefined }
          : { by: "original" };
    return targetDimensions(img.bitmap.width, img.bitmap.height, r);
  }

  function updatePreview() {
    const f = outFormat();
    const lossy = f !== "image/png";
    extLabel.textContent = `.${EXT[f]}`;
    sizeRow.hidden = sizeMode === "none";
    // With a size target, quality is chosen automatically.
    qualityField.hidden = !lossy || sizeMode !== "none";
    sizeHint.textContent =
      sizeMode === "none"
        ? ""
        : sizeMode === "max"
          ? lossy
            ? "The highest quality that fits is picked automatically." +
              (resize === "pixels" ? "" : " If that isn't enough, the image is made smaller too.")
            : "PNG has no quality setting, so the image is made smaller until it fits. Choose JPEG for photos."
          : canPad(f)
            ? "Fits the image under the size, then pads it with blank data to the exact byte count. Useful for upload forms with a minimum size."
            : "Exact size works with JPEG and PNG. WebP will be kept at or under the size.";
    const [w, hh] = dims();
    planned.textContent = img ? `Output: ${w.toLocaleString()} × ${hh.toLocaleString()} px, ${LABEL[f]}` : "";
    goBtn.disabled = busy || !img;
    goLabel.textContent = busy ? "Working…" : "Resize image";
  }

  function say(text: string, kind: "info" | "error" | "ok" | "warn" = "info", extra?: Node) {
    status.replaceChildren(...(text ? [message(kind, text)] : []));
    if (extra) status.firstElementChild?.append(" ", extra);
  }

  function figure(el: HTMLElement, url: string, caption: string) {
    el.replaceChildren(h("img", { src: url, alt: "" }), h("figcaption", {}, caption));
    el.hidden = false;
  }

  async function open(file: File) {
    if (busy) return;
    if (file.size > MAX_FILE) return say(`${file.name} is larger than ${formatBytes(MAX_FILE)}.`, "error");
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return say(
        `${file.name} couldn't be opened as an image. HEIC and RAW photos aren't supported by browsers — convert them to JPEG first.`,
        "error",
      );
    }
    if (img) {
      img.bitmap.close();
      URL.revokeObjectURL(img.url);
    }
    img = { name: file.name, type: file.type, size: file.size, bitmap, url: URL.createObjectURL(file) };
    say("");
    figure(original, img.url, `Original · ${bitmap.width} × ${bitmap.height} px · ${formatBytes(file.size)}`);
    result.hidden = true;
    widthIn.value = String(bitmap.width);
    heightIn.value = String(bitmap.height);
    outName.value = `${file.name.replace(/\.[^.]+$/, "")}-resized`;
    workspace.hidden = false;
    drop.classList.add("compact");
    updatePreview();
  }

  async function run() {
    if (!img || busy) return;
    const f = outFormat();
    const lossy = f !== "image/png";
    const [w, hh] = dims();
    const target = sizeMode === "none" ? null : parseSize(sizeIn.value, unit.value as "KB" | "MB");
    if (sizeMode !== "none" && target === null) return say("Enter a file size, like 100 KB or 1.5 MB.", "error");
    busy = true;
    updatePreview();
    say("Resizing…");
    await new Promise((resolve) => setTimeout(resolve));
    try {
      // JPEG has no transparency, so transparent areas become white instead of black.
      const fill = f === "image/jpeg" ? "#ffffff" : undefined;
      const full = drawResized(img.bitmap, w, hh, fill);
      const encode = async (q: number, scale: number) => {
        const canvas =
          scale === 1 ? full : drawResized(full, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(hh * scale)), fill);
        const out = await toBlob(canvas, f, q);
        return { out: { blob: out, width: canvas.width, height: canvas.height }, size: out.size };
      };

      let blob: Blob;
      let width = w;
      let height = hh;
      let note = "";
      let warn = false;
      if (target === null) {
        ({ blob, width, height } = (await encode(Number(quality.value) / 100, 1)).out);
      } else {
        const r = await fitToSize(encode, target, { lossy, allowShrink: resize !== "pixels" });
        ({ blob, width, height } = r.out);
        if (!r.fits) {
          warn = true;
          note = ` Couldn't get under ${formatBytes(target)}; this is the smallest result.${
            resize === "pixels" ? " Lower the pixel size to go smaller." : ""
          }${lossy ? "" : " JPEG usually gets much smaller."}`;
        } else {
          if (lossy) note = ` Quality ${Math.round(r.quality * 100)}%.`;
          if (r.scale < 1) note += " The image was made smaller to fit.";
        }
        if (sizeMode === "exact" && r.fits && canPad(f) && blob.size < target) {
          const padded = padImage(new Uint8Array(await blob.arrayBuffer()), f, target);
          blob = new Blob([padded as Uint8Array<ArrayBuffer>], { type: f });
          if (blob.size !== target) note += ` Padded to within ${target - blob.size} bytes of the target.`;
        }
      }

      if (resultUrl) URL.revokeObjectURL(resultUrl);
      const name = `${safeFileName(outName.value.replace(/\.(jpe?g|png|webp)$/i, ""), "image")}.${EXT[f]}`;
      resultUrl = downloadBytes(blob, name, f);
      figure(result, resultUrl, `Result · ${width} × ${height} px · ${formatBytes(blob.size)}`);
      const link = h("a", { href: resultUrl, download: name }, "Download again");
      say(
        `${name}: ${width} × ${height} px, ${formatBytes(blob.size)} (${blob.size.toLocaleString()} bytes).${note}`,
        warn ? "warn" : "ok",
        link,
      );
    } catch (err) {
      say(err instanceof Error ? err.message : "Something went wrong while resizing.", "error");
    } finally {
      busy = false;
      updatePreview();
    }
  }

  picker.addEventListener("change", () => {
    if (picker.files?.[0]) void open(picker.files[0]);
    picker.value = "";
  });
  drop.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    drop.classList.remove("over");
    void open(e.dataTransfer.files[0]);
  });

  updatePreview();
  return h("section", {}, header(tool), drop, status, workspace);
}

export const tool: Tool = {
  id: "image-resize",
  name: "Image Resizer",
  description: "Change an image's resolution and file size: scale by percent or pixels, convert format, hit a target KB.",
  icon: "M4 4h16v16H4zM4 15l4-4 5 5M14 14l2-2 4 4M15 8h.01",
  keywords: "image photo picture resize scale resolution pixels compress kb mb size jpeg jpg png webp convert shrink enlarge",
  render,
};
