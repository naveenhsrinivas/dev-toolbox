import "./batch.css";
import { button, checkbox, downloadBytes, field, formatBytes, h, header, icon, ICONS, message, plural, segmented, type Tool } from "../ui";
import { toBlob, wireDropzone } from "./canvas";
import { EXT, fitWithin, type Format, isHeic, LABEL, outputNames, sizeChange } from "./convert";
import { createZip as zipStore } from "../lib/zip";

const MAX_FILE = 100 * 1024 * 1024;

interface Item {
  file: File;
  thumb: string;
  row: HTMLElement;
  meta: HTMLElement;
  result?: { blob: Blob; width: number; height: number; url: string };
  srcSize?: [number, number];
  error?: string;
  /** The file itself can't be used (unreadable, too big), as opposed to failing with these settings. */
  fatal?: boolean;
}

/** Draw at w×h, halving in steps first so big reductions stay smooth. */
function drawScaled(src: ImageBitmap, w: number, hh: number, fill?: string): HTMLCanvasElement {
  let current: CanvasImageSource = src;
  let cw = src.width;
  let ch = src.height;
  while (cw / 2 >= w && ch / 2 >= hh) {
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
  canvas.height = hh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This image is too large for the browser to draw.");
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, hh);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, w, hh);
  return canvas;
}

export function renderBatch(tool: Pick<Tool, "name" | "description">): HTMLElement {
  const items: Item[] = [];
  let format: Format = "image/jpeg";
  let limit = false;
  let busy = false;
  let zipUrl: string | undefined;
  let skippedNote = "";

  const picker = h("input", { type: "file", accept: "image/*,.heic,.heif", multiple: true, hidden: true });
  const drop = h(
    "label",
    { class: "dropzone" },
    picker,
    icon(ICONS.upload, "i big"),
    h("strong", {}, "Drop images here"),
    h("span", {}, "As many as you like: JPEG, PNG, WebP, GIF, BMP. They're converted in your browser and never uploaded."),
  );
  const status = h("div", { role: "status" });
  const list = h("ul", { class: "bc-list" });
  const summary = h("p", { class: "bc-summary" });

  // ----- Settings -----
  const quality = h("input", { type: "range", min: 10, max: 100, value: 85, "aria-label": "Quality" });
  const qualityOut = h("output", {}, "85%");
  const qualityField = field("Quality", h("div", { class: "ir-row" }, quality, qualityOut), "Lower quality makes smaller files.");
  const maxW = h("input", { type: "number", min: 1, max: 16384, value: 1920, class: "num-input", "aria-label": "Maximum width" });
  const maxH = h("input", { type: "number", min: 1, max: 16384, value: 1920, class: "num-input", "aria-label": "Maximum height" });
  const limitRow = h("div", { class: "ir-row", hidden: true }, maxW, h("span", {}, "×"), maxH, h("span", {}, "px at most"));
  const bg = h("input", { type: "color", value: "#ffffff", class: "bc-color", "aria-label": "Background colour" });
  const bgField = field(
    "Background",
    h("div", { class: "ir-row" }, bg, h("span", { class: "hint" }, "JPEG can't be transparent, so see-through areas get this colour.")),
  );

  const convertLabel = h("span", {}, "Convert all");
  const convertBtn = button(h("span", {}, icon(ICONS.refresh), convertLabel), () => void convertAll(), "btn primary");
  const zipBtn = button(h("span", {}, icon(ICONS.download), "Download all (.zip)"), () => downloadZip(), "btn");
  const clearBtn = button("Clear list", () => clear(), "btn ghost");

  const workspace = h(
    "div",
    { class: "bc-workspace", hidden: true },
    h("div", { class: "bc-files" }, summary, list),
    h(
      "div",
      { class: "ir-controls" },
      field(
        "Convert to",
        segmented<Format>(
          "Convert to",
          (Object.keys(LABEL) as Format[]).map((f) => [f, LABEL[f]]),
          format,
          (v) => {
            format = v;
            settingsChanged();
          },
        ),
      ),
      qualityField,
      field(
        "Size",
        h(
          "div",
          { class: "ir-stack" },
          checkbox("Shrink large images to fit", limit, (v) => {
            limit = v;
            limitRow.hidden = !v;
            settingsChanged();
          }),
          limitRow,
          h("p", { class: "hint" }, "Keeps the aspect ratio. Smaller images are never enlarged."),
        ),
      ),
      bgField,
      h("div", { class: "bc-actions" }, convertBtn, zipBtn, clearBtn),
    ),
  );

  quality.addEventListener("input", () => (qualityOut.textContent = `${quality.value}%`));
  quality.addEventListener("change", settingsChanged);
  for (const el of [maxW, maxH, bg]) el.addEventListener("change", settingsChanged);

  function say(text: string, kind: "info" | "error" | "ok" | "warn" = "info", extra?: Node) {
    status.replaceChildren(...(text ? [message(kind, text)] : []));
    if (extra) status.firstElementChild?.append(" ", extra);
  }

  /** Results no longer match the settings, so drop them. */
  function settingsChanged() {
    const had = items.some((it) => it.result || (it.error && !it.fatal));
    for (const it of items) {
      dropResult(it);
      if (!it.fatal) it.error = undefined;
    }
    if (had) say("Settings changed. Press “Convert all” to apply them.");
    refresh();
  }

  function dropResult(it: Item) {
    if (it.result) URL.revokeObjectURL(it.result.url);
    it.result = undefined;
  }

  function refresh() {
    qualityField.hidden = format === "image/png";
    bgField.hidden = format !== "image/jpeg";
    const names = outputNames(
      items.map((it) => it.file.name),
      EXT[format],
    );
    items.forEach((it, i) => renderMeta(it, names[i]));
    const done = items.filter((it) => it.result);
    const pending = items.filter((it) => !it.result && !it.error);
    const before = done.reduce((n, it) => n + it.file.size, 0);
    const after = done.reduce((n, it) => n + it.result!.blob.size, 0);
    summary.textContent = items.length
      ? `${plural(items.length, "image")}` +
        (done.length ? ` · ${done.length} converted: ${formatBytes(before)} → ${formatBytes(after)} (${sizeChange(before, after)})` : "")
      : "";
    convertBtn.disabled = busy || pending.length === 0;
    convertLabel.textContent = busy ? "Converting…" : pending.length && done.length ? `Convert ${pending.length} more` : "Convert all";
    zipBtn.disabled = busy || done.length === 0;
    clearBtn.disabled = busy;
    workspace.hidden = items.length === 0;
    drop.classList.toggle("compact", items.length > 0);
  }

  function renderMeta(it: Item, outName: string) {
    const dims = it.srcSize ? `${it.srcSize[0]} × ${it.srcSize[1]} px · ` : "";
    const parts: (Node | string)[] = [];
    if (it.error) parts.push(h("span", { class: "bc-error" }, it.error));
    else if (it.result) {
      const r = it.result;
      parts.push(
        `${dims}${formatBytes(it.file.size)} → `,
        h("strong", {}, `${r.width} × ${r.height} px · ${formatBytes(r.blob.size)}`),
        ` (${sizeChange(it.file.size, r.blob.size)})`,
      );
      const dl = it.row.querySelector<HTMLAnchorElement>(".bc-dl")!;
      dl.href = r.url;
      dl.download = outName;
      dl.hidden = false;
    } else parts.push(`${dims}${formatBytes(it.file.size)} → ${outName}`);
    if (!it.result) it.row.querySelector<HTMLAnchorElement>(".bc-dl")!.hidden = true;
    it.meta.replaceChildren(...parts);
    it.row.classList.toggle("error", !!it.error);
  }

  function add(files: File[]) {
    if (busy) return;
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|bmp|avif|tiff?)$/i.test(f.name));
    const skipped = files.length - images.length;
    for (const file of images) {
      const thumb = URL.createObjectURL(file);
      const meta = h("span", { class: "bc-meta" });
      const img = h("img", { src: thumb, alt: "", loading: "lazy" });
      img.addEventListener("error", () =>
        img.replaceWith(h("span", { class: "bc-noimg" }, file.name.split(".").pop()?.toUpperCase() ?? "?")),
      );
      const item: Item = { file, thumb, meta, row: h("li", { class: "bc-row" }) };
      item.row.append(
        h("span", { class: "bc-thumb" }, img),
        h("span", { class: "bc-info" }, h("span", { class: "bc-name", title: file.name }, file.name), meta),
        h(
          "span",
          { class: "bc-row-actions" },
          h("a", { class: "btn small bc-dl", hidden: true }, icon(ICONS.download), "Save"),
          button(icon(ICONS.x), () => remove(item), "icon-btn", `Remove ${file.name}`),
        ),
      );
      if (file.size > MAX_FILE) {
        item.error = `Larger than ${formatBytes(MAX_FILE)}, skipped.`;
        item.fatal = true;
      }
      items.push(item);
      list.append(item.row);
    }
    skippedNote = skipped
      ? ` ${plural(skipped, "file")} skipped because ${skipped === 1 ? "it isn't an image" : "they aren't images"}.`
      : "";
    if (skippedNote) say(skippedNote.trim(), "warn");
    refresh();
    if (images.length) void convertAll();
  }

  function remove(it: Item) {
    if (busy) return;
    dropResult(it);
    URL.revokeObjectURL(it.thumb);
    it.row.remove();
    items.splice(items.indexOf(it), 1);
    refresh();
  }

  function clear() {
    for (const it of [...items]) remove(it);
    say("");
  }

  async function convertOne(it: Item) {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(it.file);
    } catch {
      it.error = isHeic(it.file.name, it.file.type)
        ? "HEIC photos can't be opened in this browser. On an iPhone, share it as JPEG or set Settings › Camera › Formats to “Most Compatible”."
        : "Couldn't open this as an image. It may be damaged, or in a format browsers can't read (like RAW).";
      it.fatal = true;
      return;
    }
    try {
      it.srcSize = [bitmap.width, bitmap.height];
      const [w, hh] = limit
        ? fitWithin(bitmap.width, bitmap.height, Number(maxW.value) || undefined, Number(maxH.value) || undefined)
        : [bitmap.width, bitmap.height];
      const canvas = drawScaled(bitmap, w, hh, format === "image/jpeg" ? bg.value : undefined);
      const blob = await toBlob(canvas, format, Number(quality.value) / 100);
      it.result = { blob, width: w, height: hh, url: URL.createObjectURL(blob) };
    } catch (err) {
      it.error = err instanceof Error ? err.message : "Couldn't convert this image.";
    } finally {
      bitmap.close();
    }
  }

  async function convertAll() {
    if (busy) return;
    const todo = items.filter((it) => !it.result && !it.error);
    if (!todo.length) return;
    busy = true;
    refresh();
    try {
      for (const [i, it] of todo.entries()) {
        say(`Converting ${i + 1} of ${todo.length}…`);
        it.row.classList.add("working");
        await convertOne(it);
        it.row.classList.remove("working");
        refresh();
      }
      const failed = todo.filter((it) => it.error).length;
      const ok = todo.length - failed;
      say(
        failed
          ? `Converted ${plural(ok, "image")}; ${failed} couldn't be converted (see the list).${skippedNote}`
          : `Converted ${plural(ok, "image")} to ${LABEL[format]}. Save them one by one, or all at once as a ZIP.${skippedNote}`,
        failed || skippedNote ? "warn" : "ok",
      );
      skippedNote = "";
    } finally {
      busy = false;
      refresh();
    }
  }

  function downloadZip() {
    const names = outputNames(
      items.map((it) => it.file.name),
      EXT[format],
    );
    void (async () => {
      try {
        const entries = [];
        for (const [i, it] of items.entries()) {
          if (it.result) entries.push({ name: names[i], data: new Uint8Array(await it.result.blob.arrayBuffer()) });
        }
        const zip = zipStore(entries);
        if (zipUrl) URL.revokeObjectURL(zipUrl);
        zipUrl = downloadBytes(zip, "converted-images.zip", "application/zip");
        say(
          `converted-images.zip: ${plural(entries.length, "image")}, ${formatBytes(zip.length)}.`,
          "ok",
          h("a", { href: zipUrl, download: "converted-images.zip" }, "Download again"),
        );
      } catch (err) {
        say(err instanceof Error ? err.message : "Couldn't make the ZIP file.", "error");
      }
    })();
  }

  wireDropzone(drop, picker, add);
  refresh();
  return h("section", {}, header(tool), drop, status, workspace);
}
