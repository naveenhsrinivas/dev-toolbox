// Shares the file card and save bar styles with PDF Merge.
import "../pdfmerge/merge.css";
import "./pdfsize.css";
import {
  button,
  checkbox,
  downloadBytes,
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
import { jpegCodec, inflate, rasterizePdf } from "./browser";
import { type ImageSettings, loadPdf, padPdfToSize, PdfReadError, recompressImages, removeUnusedObjects, stripExtras } from "./core";
import { parseSize } from "./size";

const MAX_FILE_BYTES = 300 * 1024 * 1024;

type Step = { images: ImageSettings } | { rasterize: { dpi: number; quality: number } };

const PRESETS: { id: string; label: string; detail: string; step: Step }[] = [
  {
    id: "light",
    label: "Light",
    detail: "Barely visible change. Images up to 2400 px, high quality.",
    step: { images: { quality: 0.82, maxSide: 2400 } },
  },
  {
    id: "balanced",
    label: "Balanced",
    detail: "Good for email and sharing. Images up to 1700 px.",
    step: { images: { quality: 0.68, maxSide: 1700 } },
  },
  {
    id: "strong",
    label: "Strong",
    detail: "Smallest file that keeps text selectable. Images up to 1100 px.",
    step: { images: { quality: 0.5, maxSide: 1100 } },
  },
  {
    id: "max",
    label: "Maximum",
    detail: "Turns each page into a picture at 100 dpi. Text can no longer be selected or searched.",
    step: { rasterize: { dpi: 100, quality: 0.55 } },
  },
];

// Tried in order, from gentlest, until the file fits the target.
const TARGET_STEPS: Step[] = [
  { images: { quality: 0.82, maxSide: 2400 } },
  { images: { quality: 0.68, maxSide: 1700 } },
  { images: { quality: 0.5, maxSide: 1100 } },
  { images: { quality: 0.35, maxSide: 800 } },
];
const RASTER_STEPS: Step[] = [
  { rasterize: { dpi: 150, quality: 0.6 } },
  { rasterize: { dpi: 110, quality: 0.5 } },
  { rasterize: { dpi: 85, quality: 0.4 } },
  { rasterize: { dpi: 72, quality: 0.3 } },
];

export function mountPdfSize(section: HTMLElement, tool: Pick<Tool, "name" | "description">) {
  let file: { name: string; bytes: Uint8Array; pages: number } | undefined;
  let mode: "smaller" | "bigger" = "smaller";
  let howSmall: "preset" | "target" = "preset";
  let preset = "balanced";
  let allowRaster = false;
  let busy = false;
  let downloadUrl: string | undefined;

  const picker = h("input", { type: "file", accept: "application/pdf,.pdf", hidden: true });
  const drop = h(
    "label",
    { class: "dropzone" },
    picker,
    icon(ICONS.upload, "i big"),
    h("strong", {}, "Drop a PDF here"),
    h("span", {}, "or click to choose. It's processed in your browser and never uploaded."),
  );
  const fileInfo = h("div", { class: "ps-file" });
  const status = h("div", { role: "status" });

  // ----- Make smaller -----
  const presetList = h(
    "div",
    { class: "ps-presets", role: "radiogroup", "aria-label": "Compression level" },
    ...PRESETS.map((p) => {
      const input = h("input", { type: "radio", name: "ps-preset", value: p.id, checked: p.id === preset });
      input.addEventListener("change", () => input.checked && (preset = p.id));
      return h("label", { class: "ps-preset" }, input, h("span", {}, h("strong", {}, p.label), h("span", {}, p.detail)));
    }),
  );
  const targetInput = h("input", { type: "text", inputMode: "decimal", value: "500", class: "num-input", "aria-label": "Target size" });
  const targetUnit = unitSelect("KB");
  const targetBox = h(
    "div",
    { class: "ps-target", hidden: true },
    h("div", { class: "ps-size-row" }, h("span", {}, "Make it at most"), targetInput, targetUnit),
    checkbox("If needed, turn pages into pictures (text won't be selectable)", allowRaster, (v) => (allowRaster = v)),
    h("p", { class: "hint" }, "Gentler settings are tried first; the first result that fits is kept."),
  );
  const smallerBox = h(
    "div",
    { class: "ps-options" },
    segmented(
      "How to compress",
      [
        ["preset", "Choose a level"],
        ["target", "Target file size"],
      ],
      howSmall,
      (v) => {
        howSmall = v;
        presetList.hidden = v !== "preset";
        targetBox.hidden = v !== "target";
      },
    ),
    presetList,
    targetBox,
  );

  // ----- Make bigger -----
  const growInput = h("input", { type: "text", inputMode: "decimal", value: "2", class: "num-input", "aria-label": "New size" });
  const growUnit = unitSelect("MB");
  const biggerBox = h(
    "div",
    { class: "ps-options", hidden: true },
    h("div", { class: "ps-size-row" }, h("span", {}, "Make it exactly"), growInput, growUnit),
    h(
      "p",
      { class: "hint" },
      "Adds an unused block of blank data so the file meets a minimum upload size. Pages, text and images are unchanged. 1 KB = 1024 bytes.",
    ),
  );

  const outName = h("input", { type: "text", maxLength: 120, spellcheck: false, "aria-label": "File name" });
  const goLabel = h("span", {}, "Compress PDF");
  const goBtn = button(h("span", {}, icon(ICONS.download), goLabel), () => void run(), "btn primary");

  const workspace = h(
    "div",
    { class: "ps-workspace", hidden: true },
    fileInfo,
    segmented(
      "Mode",
      [
        ["smaller", "Reduce size (compress)"],
        ["bigger", "Increase size"],
      ],
      mode,
      (v) => {
        mode = v;
        // Keep the suggested name in step with the mode, unless the user changed it.
        outName.value = outName.value.replace(/-(compressed|enlarged)$/, v === "smaller" ? "-compressed" : "-enlarged");
        smallerBox.hidden = v !== "smaller";
        biggerBox.hidden = v !== "bigger";
        updateButton();
        say("");
      },
    ),
    smallerBox,
    biggerBox,
    h(
      "div",
      { class: "save-bar" },
      h(
        "label",
        { class: "save-name" },
        h("span", {}, "File name"),
        h("span", { class: "save-name-input" }, outName, h("span", {}, ".pdf")),
      ),
      goBtn,
    ),
  );

  section.replaceChildren(header(tool), drop, status, workspace);

  function unitSelect(value: "KB" | "MB") {
    return h(
      "select",
      { class: "unit-select", "aria-label": "Unit" },
      ...["KB", "MB"].map((u) => h("option", { value: u, selected: u === value }, u)),
    );
  }

  function say(text: string, kind: "info" | "error" | "ok" | "warn" = "info", extra?: Node) {
    status.replaceChildren(...(text ? [message(kind, text)] : []));
    if (extra) status.firstElementChild?.append(" ", extra);
  }

  function updateButton() {
    goLabel.textContent = busy ? "Working…" : mode === "smaller" ? "Compress PDF" : "Increase size";
    goBtn.disabled = busy || !file;
  }

  // ----- Loading a file -----
  async function open(f: File) {
    if (busy) return;
    if (!(f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))) return say(`${f.name} isn't a PDF.`, "error");
    if (f.size > MAX_FILE_BYTES) return say(`${f.name} is larger than ${formatBytes(MAX_FILE_BYTES)}.`, "error");
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const doc = await loadPdf(bytes);
      file = { name: f.name, bytes, pages: doc.getPageCount() };
    } catch (err) {
      return say(err instanceof PdfReadError ? err.message : "This file couldn't be read.", "error");
    }
    say("");
    outName.value = `${f.name.replace(/\.pdf$/i, "")}-${mode === "smaller" ? "compressed" : "enlarged"}`;
    fileInfo.replaceChildren(
      h("span", { class: "pm-thumb" }, h("span", { class: "pm-thumb-empty" }, "PDF")),
      h(
        "div",
        { class: "pm-info" },
        h("span", { class: "pm-file", title: f.name }, f.name),
        h("span", { class: "pm-meta" }, `${plural(file.pages, "page")} · ${formatBytes(f.size)} (${f.size.toLocaleString()} bytes)`),
      ),
    );
    workspace.hidden = false;
    drop.classList.add("compact");
    updateButton();
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

  // ----- Running -----
  async function applyStep(bytes: Uint8Array, step: Step, label: string): Promise<Uint8Array> {
    if ("rasterize" in step) {
      const { dpi, quality } = step.rasterize;
      return rasterizePdf(bytes, dpi, quality, (d, t) => say(`${label}: drawing page ${Math.min(d + 1, t)} of ${t}…`));
    }
    const doc = await loadPdf(bytes);
    stripExtras(doc);
    await recompressImages(doc, step.images, jpegCodec, inflate, (d, t) =>
      say(t ? `${label}: image ${Math.min(d + 1, t)} of ${t}…` : `${label}…`),
    );
    removeUnusedObjects(doc);
    doc.setProducer("Dev Toolbox PDF Compress (in-browser)");
    return doc.save({ useObjectStreams: true });
  }

  async function compress(src: Uint8Array): Promise<{ out: Uint8Array; note?: string; warn?: boolean }> {
    if (howSmall === "preset") {
      const p = PRESETS.find((x) => x.id === preset)!;
      return { out: await applyStep(src, p.step, "Compressing") };
    }
    const target = parseSize(targetInput.value, targetUnit.value as "KB" | "MB");
    if (target === null) throw new UserError("Enter a target size, like 500 KB or 1.5 MB.");
    if (src.length <= target) return { out: src, note: "It's already within the target, so nothing was changed." };
    const steps = [...TARGET_STEPS, ...(allowRaster ? RASTER_STEPS : [])];
    let best = src;
    for (const [i, step] of steps.entries()) {
      const out = await applyStep(src, step, `Attempt ${i + 1} of ${steps.length}`);
      if (out.length < best.length) best = out;
      if (out.length <= target) return { out };
    }
    return {
      out: best,
      warn: true,
      note: `Couldn't get it down to ${formatBytes(target)}; this is the smallest result.${
        allowRaster ? "" : " Allowing pages to be turned into pictures may get it smaller."
      }`,
    };
  }

  async function run() {
    if (!file || busy) return;
    busy = true;
    section.classList.add("ps-busy");
    updateButton();
    const src = file.bytes;
    try {
      let out: Uint8Array;
      let note: string | undefined;
      let warn = false;
      if (mode === "smaller") {
        ({ out, note, warn = false } = await compress(src));
        // Never hand back a bigger file than the one we were given.
        if (out.length >= src.length && !note) {
          out = src;
          note = "This PDF is already well compressed — no setting made it smaller, so it's unchanged. Try a stronger level.";
          warn = true;
        }
      } else {
        const target = parseSize(growInput.value, growUnit.value as "KB" | "MB");
        if (target === null) throw new UserError("Enter the size you want, like 2 MB or 800 KB.");
        if (target > 1024 * 1024 * 1024) throw new UserError("Pick a size of 1 GB or less.");
        if (target < src.length)
          throw new UserError(`That's smaller than the file (${formatBytes(src.length)}). Use “Reduce size” to make it smaller.`);
        say("Increasing size…");
        out = await padPdfToSize(src, target);
      }
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      const name = `${safeFileName(outName.value.replace(/\.pdf$/i, ""), "document")}.pdf`;
      downloadUrl = downloadBytes(out, name, "application/pdf");
      const link = h("a", { href: downloadUrl, download: name }, "Download again");
      const change =
        out.length === src.length ? "" : out.length < src.length ? `, ${Math.round((1 - out.length / src.length) * 100)}% smaller` : "";
      say(
        `${name}: ${formatBytes(src.length)} → ${formatBytes(out.length)} (${out.length.toLocaleString()} bytes${change}).${note ? ` ${note}` : ""}`,
        warn ? "warn" : "ok",
        link,
      );
    } catch (err) {
      if (err instanceof UserError || err instanceof PdfReadError || err instanceof RangeError) say(err.message, "error");
      else say("Something went wrong while processing this PDF. It may be damaged or use features this tool can't handle.", "error");
    } finally {
      busy = false;
      section.classList.remove("ps-busy");
      updateButton();
    }
  }

  updateButton();
}

class UserError extends Error {}
