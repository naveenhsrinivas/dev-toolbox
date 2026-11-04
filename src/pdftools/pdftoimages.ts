// Shares the file card styles with PDF Merge.
import "../pdfmerge/merge.css";
import "./pdftools.css";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { zipBlob } from "../lib/zip";
import { loadPdfJs } from "../pdfedit/pdfjs";
import { parsePageRanges } from "../pdfmerge/ranges";
import {
  button,
  debounce,
  downloadBytes,
  field,
  formatBytes,
  h,
  header,
  icon,
  ICONS,
  message,
  plural,
  safeFileName,
  segmented,
  type Tool,
} from "../ui";
import { distinctPages, pageFileName, parseDpi, renderSize } from "./raster";

const MAX_FILE_BYTES = 300 * 1024 * 1024;
const THUMB_WIDTH = 150;

type Format = "png" | "jpeg";
type DpiChoice = "72" | "150" | "300" | "custom";

class UserError extends Error {}

export function mountPdfToImages(section: HTMLElement, tool: Pick<Tool, "name" | "description">) {
  let doc: PDFDocumentProxy | undefined;
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let format: Format = "png";
  let dpiChoice: DpiChoice = "150";
  let busy = false;
  let cancelled = false;
  let downloadUrl: string | undefined;
  /** Page sizes in points, filled in as pages are loaded. */
  let sizes = new Map<number, [number, number]>();
  let cards = new Map<number, HTMLElement>();
  let selected: number[] = [];
  let thumbQueue: Promise<void> = Promise.resolve();

  const picker = h("input", { type: "file", accept: "application/pdf,.pdf", hidden: true });
  const drop = h(
    "label",
    { class: "dropzone" },
    picker,
    icon(ICONS.upload, "i big"),
    h("strong", {}, "Drop a PDF here"),
    h("span", {}, "or click to choose. Pages are drawn in your browser and never uploaded."),
  );
  const fileInfo = h("div", { class: "pt-file" });
  const status = h("div", { role: "status" });

  const rangeInput = h("input", {
    type: "text",
    spellcheck: false,
    autocomplete: "off",
    placeholder: "all, or e.g. 1-3, 5",
  });
  const rangeNote = h("p", { class: "hint" });
  const pagesField = field("Pages", rangeInput);
  pagesField.append(rangeNote);
  const quality = h("input", { type: "range", min: 30, max: 100, step: 1, value: 85, "aria-label": "JPEG quality" });
  const qualityValue = h("output", {}, "85%");
  const qualityRow = h("div", { class: "pt-quality", hidden: true }, h("span", {}, "Quality"), quality, qualityValue);
  const customDpi = h("input", {
    type: "text",
    inputMode: "numeric",
    value: "200",
    class: "num-input",
    "aria-label": "Custom resolution in dpi",
    hidden: true,
  });
  const dpiNote = h("p", { class: "hint" });
  const grid = h("ol", { class: "pt-grid" });
  const outName = h("input", { type: "text", maxLength: 120, spellcheck: false, "aria-label": "File name" });
  const goLabel = h("span", {}, "Download all");
  const goBtn = button(h("span", {}, icon(ICONS.download), goLabel), () => void downloadAll(), "btn primary");
  const cancelBtn = button("Cancel", () => (cancelled = true), "btn ghost");
  cancelBtn.hidden = true;

  const workspace = h(
    "div",
    { class: "pt-workspace", hidden: true },
    fileInfo,
    h(
      "div",
      { class: "pt-options" },
      pagesField,
      h(
        "div",
        { class: "field" },
        h("span", { class: "label" }, "Format"),
        segmented(
          "Format",
          [
            ["png", "PNG"],
            ["jpeg", "JPEG"],
          ],
          format,
          (v) => {
            format = v;
            qualityRow.hidden = v !== "jpeg";
            updateLabels();
          },
        ),
        qualityRow,
        h("p", { class: "hint" }, "PNG is sharp and lossless; JPEG files are much smaller."),
      ),
      h(
        "div",
        { class: "field" },
        h("span", { class: "label" }, "Resolution"),
        h(
          "div",
          { class: "pt-dpi" },
          segmented(
            "Resolution",
            [
              ["72", "72 dpi"],
              ["150", "150 dpi"],
              ["300", "300 dpi"],
              ["custom", "Custom"],
            ],
            dpiChoice,
            (v) => {
              dpiChoice = v;
              customDpi.hidden = v !== "custom";
              if (v === "custom") customDpi.focus();
              updateLabels();
            },
          ),
          customDpi,
        ),
        dpiNote,
      ),
    ),
    grid,
    h(
      "div",
      { class: "save-bar" },
      h(
        "label",
        { class: "save-name" },
        h("span", {}, "File name"),
        h("span", { class: "save-name-input" }, outName, h("span", { class: "pt-ext" }, ".zip")),
      ),
      cancelBtn,
      goBtn,
    ),
  );

  section.replaceChildren(header(tool), drop, status, workspace);

  function say(text: string, kind: "info" | "error" | "ok" | "warn" = "info", extra?: Node) {
    status.replaceChildren(...(text ? [message(kind, text)] : []));
    if (extra) status.firstElementChild?.append(" ", extra);
  }

  const ext = () => (format === "png" ? "png" : "jpg");
  const baseName = () => safeFileName(outName.value.replace(/\.(zip|png|jpe?g)$/i, ""), "page");

  function dpi(): number {
    if (dpiChoice !== "custom") return Number(dpiChoice);
    const r = parseDpi(customDpi.value);
    if (!r.ok) throw new UserError(r.error);
    return r.dpi;
  }

  // ---------- Loading ----------
  async function open(f: File) {
    if (busy) return;
    if (!(f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))) return say(`${f.name} isn't a PDF.`, "error");
    if (f.size > MAX_FILE_BYTES) return say(`${f.name} is larger than ${formatBytes(MAX_FILE_BYTES)}.`, "error");
    say("Opening…");
    let next: PDFDocumentProxy;
    let task: PDFDocumentLoadingTask | undefined;
    try {
      const pdfjs = await loadPdfJs();
      task = pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) });
      next = await task.promise;
    } catch (err) {
      void task?.destroy();
      const name = err instanceof Error ? err.name : "";
      return say(
        name === "PasswordException"
          ? "This PDF is password-protected. Remove the protection first, then try again."
          : "This file couldn't be read as a PDF. It may be damaged.",
        "error",
      );
    }
    void loadingTask?.destroy();
    loadingTask = task;
    doc = next;
    observer.disconnect();
    sizes = new Map();
    cards = new Map();
    thumbQueue = Promise.resolve();
    rangeInput.value = "";
    outName.value = f.name.replace(/\.pdf$/i, "");
    fileInfo.replaceChildren(
      h(
        "div",
        { class: "pm-info" },
        h("span", { class: "pm-file", title: f.name }, f.name),
        h("span", { class: "pm-meta" }, `${plural(doc.numPages, "page")} · ${formatBytes(f.size)}`),
      ),
    );
    say("");
    workspace.hidden = false;
    drop.classList.add("compact");
    updatePages();
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

  // ---------- Page grid ----------
  // Thumbnails are drawn only once their card scrolls into view.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const page = Number((entry.target as HTMLElement).dataset.page);
        const current = doc;
        thumbQueue = thumbQueue.then(() => (current && current === doc ? drawThumb(current, page) : undefined));
      }
    },
    { rootMargin: "200px" },
  );

  async function drawThumb(d: PDFDocumentProxy, index: number) {
    const holder = cards.get(index)?.querySelector(".pt-page-thumb");
    if (!holder) return;
    try {
      const page = await d.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      sizes.set(index, [base.width, base.height]);
      updateLabel(index);
      const viewport = page.getViewport({ scale: (THUMB_WIDTH * Math.min(2, devicePixelRatio)) / base.width });
      const canvas = h("canvas", { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) });
      await page.render({ canvas, viewport }).promise;
      holder.replaceChildren(canvas);
    } catch {
      holder.replaceChildren(h("span", { class: "pm-thumb-empty" }, "No preview"));
    }
  }

  function card(index: number): HTMLElement {
    let el = cards.get(index);
    if (el) return el;
    const download = button(icon(ICONS.download), () => void downloadOne(index), "icon-btn", `Download page ${index + 1}`);
    el = h(
      "li",
      { class: "pt-page", dataset: { page: String(index) } },
      h("span", { class: "pt-page-thumb" }, h("span", { class: "pm-thumb-empty" }, "…")),
      h(
        "div",
        { class: "pt-page-foot" },
        h("div", {}, h("strong", {}, `Page ${index + 1}`), h("span", { class: "pt-page-size" })),
        download,
      ),
    );
    cards.set(index, el);
    observer.observe(el);
    return el;
  }

  function updatePages() {
    if (!doc) return;
    const r = parsePageRanges(rangeInput.value, doc.numPages);
    rangeInput.setAttribute("aria-invalid", String(!r.ok));
    if (!r.ok) {
      rangeNote.textContent = r.error;
      rangeNote.classList.add("pt-error");
      selected = [];
    } else {
      selected = distinctPages(r.pages);
      rangeNote.classList.remove("pt-error");
      rangeNote.textContent =
        selected.length === doc.numPages ? `All ${plural(doc.numPages, "page")}` : `${plural(selected.length, "page")} selected`;
    }
    grid.replaceChildren(...selected.map(card));
    updateLabels();
  }
  rangeInput.addEventListener("input", debounce(updatePages, 250));

  function updateLabel(index: number) {
    const label = cards.get(index)?.querySelector(".pt-page-size");
    const size = sizes.get(index);
    if (!label || !size) return;
    let d: number;
    try {
      d = dpi();
    } catch {
      label.textContent = "";
      return;
    }
    const r = renderSize(size[0], size[1], d);
    label.textContent = `${r.width} × ${r.height} px`;
  }

  function updateLabels() {
    qualityValue.textContent = `${quality.value}%`;
    const one = selected.length === 1;
    goLabel.textContent = busy ? "Working…" : one ? `Download ${ext().toUpperCase()}` : `Download all (ZIP)`;
    const extLabel = workspace.querySelector(".pt-ext");
    if (extLabel) extLabel.textContent = one && doc ? pageFileName("", selected[0], doc.numPages, ext()) : ".zip";
    goBtn.disabled = busy || !selected.length;
    cancelBtn.hidden = !busy;

    customDpi.setAttribute("aria-invalid", "false");
    try {
      const d = dpi();
      dpiNote.textContent =
        d >= 300 ? `${d} dpi: print quality. Large pages make big files.` : d <= 96 ? `${d} dpi: screen size, small files.` : `${d} dpi.`;
      dpiNote.classList.remove("pt-error");
    } catch (err) {
      customDpi.setAttribute("aria-invalid", "true");
      dpiNote.textContent = (err as Error).message;
      dpiNote.classList.add("pt-error");
    }
    for (const index of selected) updateLabel(index);
  }
  quality.addEventListener("input", updateLabels);
  customDpi.addEventListener("input", updateLabels);

  // ---------- Exporting ----------
  async function renderPage(
    d: PDFDocumentProxy,
    index: number,
    dpiValue: number,
  ): Promise<{ data: Uint8Array; limited: boolean; dpi: number }> {
    const page = await d.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const size = renderSize(base.width, base.height, dpiValue);
    const viewport = page.getViewport({ scale: size.scale });
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new UserError(`Page ${index + 1} is too large to draw at ${dpiValue} dpi. Try a lower resolution.`);
    try {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size.width, size.height);
      await page.render({ canvas, viewport }).promise;
      const type = format === "png" ? "image/png" : "image/jpeg";
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, Number(quality.value) / 100));
      if (!blob) throw new UserError(`Page ${index + 1} is too large to save at ${dpiValue} dpi. Try a lower resolution.`);
      return { data: new Uint8Array(await blob.arrayBuffer()), limited: size.limited, dpi: size.dpi };
    } finally {
      // Free the pixels now rather than whenever garbage collection runs.
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  }

  async function run(job: (d: PDFDocumentProxy, dpiValue: number) => Promise<void>) {
    if (!doc || busy) return;
    let dpiValue: number;
    try {
      dpiValue = dpi();
    } catch (err) {
      return say((err as Error).message, "error");
    }
    busy = true;
    cancelled = false;
    section.classList.add("pt-busy");
    updateLabels();
    try {
      await job(doc, dpiValue);
    } catch (err) {
      say(
        err instanceof UserError || err instanceof RangeError
          ? err.message
          : "Something went wrong while drawing the pages. The PDF may be damaged, or the resolution too high for this device.",
        "error",
      );
    } finally {
      busy = false;
      section.classList.remove("pt-busy");
      updateLabels();
    }
  }

  function finish(bytes: Uint8Array | Blob, name: string, type: string, detail: string, limited: number | false) {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = downloadBytes(bytes, name, type);
    const link = h("a", { href: downloadUrl, download: name }, "Download again");
    const size = bytes instanceof Blob ? bytes.size : bytes.length;
    const note = limited ? ` Some pages were too large for this resolution and were saved at ${limited} dpi instead.` : "";
    say(`Done — ${name} (${detail}${formatBytes(size)}) was downloaded.${note}`, limited ? "warn" : "ok", link);
  }

  function downloadOne(index: number) {
    return run(async (d, dpiValue) => {
      say(`Drawing page ${index + 1}…`);
      const { data, limited, dpi: used } = await renderPage(d, index, dpiValue);
      const name = pageFileName(baseName(), index, d.numPages, ext());
      finish(data, name, format === "png" ? "image/png" : "image/jpeg", "", limited && used);
    });
  }

  function downloadAll() {
    if (selected.length === 1) return downloadOne(selected[0]);
    const pages = [...selected];
    return run(async (d, dpiValue) => {
      const entries = [];
      let limited: number | false = false;
      for (const [i, index] of pages.entries()) {
        if (cancelled) return say("Cancelled. Nothing was downloaded.");
        say(`Drawing page ${index + 1} (${i + 1} of ${pages.length})…`);
        const r = await renderPage(d, index, dpiValue);
        if (r.limited) limited = limited === false ? r.dpi : Math.min(limited, r.dpi);
        entries.push({ name: pageFileName(baseName(), index, d.numPages, ext()), data: r.data });
      }
      finish(zipBlob(entries), `${baseName()}.zip`, "application/zip", `${plural(entries.length, "image")}, `, limited);
    });
  }

  updateLabels();
}
