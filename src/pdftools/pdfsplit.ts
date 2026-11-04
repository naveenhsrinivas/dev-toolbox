// Shares the file card and save bar styles with PDF Merge.
import "../pdfmerge/merge.css";
import "./pdftools.css";
import type { PDFDocument } from "pdf-lib";
import { uniqueNames, zipBlob } from "../lib/zip";
import { renderThumbnail } from "../pdfmerge/pdf";
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
import { describePages, loadPdf, partName, PdfReadError, planSplit, type SplitMode, splitPdf, uncoveredPages } from "./split";

const MAX_FILE_BYTES = 300 * 1024 * 1024;
/** Longer plans are summarised rather than listed in full. */
const MAX_ROWS = 200;

const MODE_HINT: Record<SplitMode, string> = {
  ranges: "Each comma-separated range becomes its own file. “7-” runs to the last page.",
  every: "Cuts the document into equal parts; the last file may be shorter.",
  extract: "The chosen pages go into one new file, in the order you list them.",
  each: "Every page becomes its own PDF.",
};

export function mountPdfSplit(section: HTMLElement, tool: Pick<Tool, "name" | "description">) {
  let source: { name: string; size: number; doc: PDFDocument; pages: number } | undefined;
  let mode: SplitMode = "ranges";
  let busy = false;
  let downloadUrl: string | undefined;

  const picker = h("input", { type: "file", accept: "application/pdf,.pdf", hidden: true });
  const drop = h(
    "label",
    { class: "dropzone" },
    picker,
    icon(ICONS.upload, "i big"),
    h("strong", {}, "Drop a PDF here"),
    h("span", {}, "or click to choose. It's split in your browser and never uploaded."),
  );
  const fileInfo = h("div", { class: "pt-file" });
  const status = h("div", { role: "status" });

  const rangesInput = h("input", { type: "text", spellcheck: false, autocomplete: "off", placeholder: "e.g. 1-3, 4-6, 7-" });
  const everyInput = h("input", { type: "text", inputMode: "numeric", value: "2", class: "num-input" });
  const extractInput = h("input", { type: "text", spellcheck: false, autocomplete: "off", placeholder: "e.g. 1, 3, 5-7" });
  const rangesField = field("Page ranges (one file each)", rangesInput);
  const everyField = field("Pages per file", everyInput);
  const extractField = field("Pages to extract", extractInput);
  const modeHint = h("p", { class: "hint" }, MODE_HINT[mode]);

  const planHead = h("strong", { class: "pm-summary", "aria-live": "polite" });
  const planNote = h("p", { class: "hint" });
  const planList = h("ol", { class: "pt-plan" });
  const outName = h("input", { type: "text", maxLength: 120, spellcheck: false, "aria-label": "File name" });
  const ext = h("span", {}, ".zip");
  const goLabel = h("span", {}, "Split PDF");
  const goBtn = button(h("span", {}, icon(ICONS.download), goLabel), () => void downloadAll(), "btn primary");

  const workspace = h(
    "div",
    { class: "pt-workspace", hidden: true },
    fileInfo,
    h(
      "div",
      { class: "pt-options" },
      h(
        "div",
        { class: "field" },
        h("span", { class: "label" }, "How to split"),
        segmented(
          "How to split",
          [
            ["ranges", "By ranges"],
            ["every", "Every N pages"],
            ["extract", "Extract pages"],
            ["each", "One file per page"],
          ],
          mode,
          (v) => {
            mode = v;
            showMode();
            update();
          },
        ),
        modeHint,
      ),
      rangesField,
      everyField,
      extractField,
    ),
    h("div", { class: "pt-plan-box" }, planHead, planNote, planList),
    h(
      "div",
      { class: "save-bar" },
      h("label", { class: "save-name" }, h("span", {}, "File name"), h("span", { class: "save-name-input" }, outName, ext)),
      goBtn,
    ),
  );

  section.replaceChildren(header(tool), drop, status, workspace);

  function say(text: string, kind: "info" | "error" | "ok" = "info", extra?: Node) {
    status.replaceChildren(...(text ? [message(kind, text)] : []));
    if (extra) status.firstElementChild?.append(" ", extra);
  }

  function showMode() {
    rangesField.hidden = mode !== "ranges";
    everyField.hidden = mode !== "every";
    extractField.hidden = mode !== "extract";
    modeHint.textContent = MODE_HINT[mode];
  }

  const baseName = () => safeFileName(outName.value.replace(/\.(pdf|zip)$/i, ""), "document");

  function plan() {
    if (!source) return { ok: false as const, error: "" };
    const input = mode === "ranges" ? rangesInput : mode === "extract" ? extractInput : undefined;
    const r = planSplit(mode, { ranges: input?.value, n: Number(everyInput.value.trim() || NaN) }, source.pages);
    for (const el of [rangesInput, everyInput, extractInput]) el.setAttribute("aria-invalid", "false");
    if (!r.ok) (input ?? everyInput).setAttribute("aria-invalid", "true");
    return r;
  }

  function names(parts: { pages: number[] }[]): string[] {
    const base = baseName();
    if (!source) return [];
    return uniqueNames(parts.map((p, i) => `${partName(base, p, i, source!.pages)}.pdf`));
  }

  // ---------- Plan ----------
  function update() {
    if (!source) return;
    const r = plan();
    if (!r.ok) {
      planHead.textContent = "";
      planNote.textContent = r.error;
      planNote.classList.add("pt-error");
      planList.replaceChildren();
      goBtn.disabled = true;
      goLabel.textContent = "Split PDF";
      return;
    }
    planNote.classList.remove("pt-error");
    const parts = r.parts;
    const fileNames = names(parts);
    planHead.textContent = `${plural(parts.length, "file")} will be created`;
    const missing = mode === "ranges" ? uncoveredPages(parts, source.pages) : [];
    planNote.textContent = missing.length ? `Not in any file: ${missing.length === 1 ? "page" : "pages"} ${describePages(missing)}.` : "";
    planList.replaceChildren(
      ...parts.slice(0, MAX_ROWS).map((part, i) =>
        h(
          "li",
          { class: "pt-plan-row" },
          h("span", { class: "pm-order" }, String(i + 1)),
          h(
            "div",
            { class: "pm-info" },
            h("span", { class: "pm-file", title: fileNames[i] }, fileNames[i]),
            h(
              "span",
              { class: "pm-meta" },
              `${part.pages.length === 1 ? "Page" : "Pages"} ${describePages(part.pages)} · ${plural(part.pages.length, "page")}`,
            ),
          ),
          button(icon(ICONS.download), () => void downloadPart(i), "icon-btn", `Download ${fileNames[i]}`),
        ),
      ),
      ...(parts.length > MAX_ROWS ? [h("li", { class: "pt-plan-more" }, `…and ${plural(parts.length - MAX_ROWS, "more file")}`)] : []),
    );
    ext.textContent = parts.length === 1 ? ".pdf" : ".zip";
    goLabel.textContent = busy ? "Splitting…" : parts.length === 1 ? "Download PDF" : `Download ${parts.length} files (ZIP)`;
    goBtn.disabled = busy;
  }
  const updateSoon = debounce(update, 200);
  for (const el of [rangesInput, everyInput, extractInput]) el.addEventListener("input", updateSoon);
  outName.addEventListener("input", updateSoon);

  // ---------- Loading ----------
  async function open(f: File) {
    if (busy) return;
    if (!(f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))) return say(`${f.name} isn't a PDF.`, "error");
    if (f.size > MAX_FILE_BYTES) return say(`${f.name} is larger than ${formatBytes(MAX_FILE_BYTES)}.`, "error");
    say("Opening…");
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await f.arrayBuffer());
      const doc = await loadPdf(bytes);
      source = { name: f.name, size: f.size, doc, pages: doc.getPageCount() };
    } catch (err) {
      return say(err instanceof PdfReadError ? err.message : "This file couldn't be read.", "error");
    }
    say("");
    outName.value = f.name.replace(/\.pdf$/i, "");
    // Suggest a sensible starting split: halves.
    const half = Math.ceil(source.pages / 2);
    rangesInput.value = source.pages > 1 ? `1-${half}, ${half + 1}-` : "1";
    extractInput.value = "";
    const thumb = h("span", { class: "pm-thumb" }, h("span", { class: "pm-thumb-empty" }, "PDF"));
    fileInfo.replaceChildren(
      thumb,
      h(
        "div",
        { class: "pm-info" },
        h("span", { class: "pm-file", title: f.name }, f.name),
        h("span", { class: "pm-meta" }, `${plural(source.pages, "page")} · ${formatBytes(f.size)}`),
      ),
    );
    renderThumbnail(bytes, 56)
      .then((canvas) => {
        canvas.className = "pm-thumb-canvas";
        thumb.replaceChildren(canvas);
      })
      .catch(() => {
        // The preview is optional; the placeholder stays.
      });
    workspace.hidden = false;
    drop.classList.add("compact");
    showMode();
    update();
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

  // ---------- Splitting ----------
  async function run(only?: number) {
    if (!source || busy) return;
    const r = plan();
    if (!r.ok) return say(r.error, "error");
    const all = names(r.parts);
    const indices = only === undefined ? r.parts.map((_, i) => i) : [only];
    busy = true;
    section.classList.add("pt-busy");
    update();
    try {
      const files = await splitPdf(
        source.doc,
        indices.map((i) => r.parts[i]),
        async (done, total) => {
          if (total > 1) say(`Writing file ${Math.min(done + 1, total)} of ${total}…`);
          // Let the page repaint the progress message.
          await new Promise((resolve) => setTimeout(resolve));
        },
      );
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      let name: string;
      let size: number;
      if (files.length === 1) {
        name = all[indices[0]];
        size = files[0].length;
        downloadUrl = downloadBytes(files[0], name, "application/pdf");
      } else {
        name = `${baseName()}.zip`;
        const zip = zipBlob(files.map((data, k) => ({ name: all[indices[k]], data })));
        size = zip.size;
        downloadUrl = downloadBytes(zip, name, "application/zip");
      }
      const link = h("a", { href: downloadUrl, download: name }, "Download again");
      const what = files.length === 1 ? plural(r.parts[indices[0]].pages.length, "page") : plural(files.length, "PDF");
      say(`Done — ${name} (${what}, ${formatBytes(size)}) was downloaded.`, "ok", link);
    } catch (err) {
      say(
        err instanceof RangeError
          ? err.message
          : "Something went wrong while splitting. The PDF may be damaged or use features this tool can't handle.",
        "error",
      );
    } finally {
      busy = false;
      section.classList.remove("pt-busy");
      update();
    }
  }

  const downloadAll = () => run();
  const downloadPart = (i: number) => run(i);
}
