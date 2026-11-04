// Shares the file card and save bar styles with PDF Merge.
import "../pdfmerge/merge.css";
import "./pdftools.css";
import { button, formatBytes, h, header, icon, ICONS, message, plural, safeFileName, segmented, type Tool } from "../ui";
import { type ImageKind, type Margin, type Orientation, type PageSize, type Quality, sniffImage } from "./imagelayout";
import { ImageError, imagesToPdf, probeImage, type SourceImage } from "./imagepdf";

interface Item extends SourceImage {
  id: number;
  size: number;
  url: string;
}

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const KIND_LABEL: Record<ImageKind, string> = { jpeg: "JPEG", png: "PNG", webp: "WebP", gif: "GIF", bmp: "BMP" };
const ROTATE_CW = "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5";
const ROTATE_CCW = "M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5";

const QUALITY_HINT: Record<Quality, string> = {
  original: "JPEGs are added unchanged; other images are stored without any loss. Gives the largest file.",
  high: "Re-encoded as JPEG at 90% quality, at most 4000 px on the longest side. Transparent areas become white.",
  medium: "Re-encoded as JPEG at 75% quality, at most 2400 px. Good for email. Transparent areas become white.",
  small: "Re-encoded as JPEG at 60% quality, at most 1600 px. Smallest file. Transparent areas become white.",
};

export function mountImageToPdf(section: HTMLElement, tool: Pick<Tool, "name" | "description">) {
  let items: Item[] = [];
  let nextId = 1;
  let busy = false;
  let downloadUrl: string | undefined;
  let dragId: number | undefined;
  const opts: { pageSize: PageSize; orientation: Orientation; margin: Margin; quality: Quality } = {
    pageSize: "a4",
    orientation: "auto",
    margin: "small",
    quality: "original",
  };

  const picker = h("input", {
    type: "file",
    accept: "image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.bmp",
    multiple: true,
    hidden: true,
  });
  const drop = h(
    "label",
    { class: "dropzone" },
    picker,
    icon(ICONS.upload, "i big"),
    h("strong", {}, "Drop images here"),
    h("span", {}, "JPEG, PNG, WebP, GIF or BMP — or click to choose. They're turned into a PDF in your browser and never uploaded."),
  );
  const list = h("ol", { class: "pm-list" });
  const summary = h("strong", { class: "pm-summary", "aria-live": "polite" });
  const status = h("div", { role: "status" });

  const orientationField = h(
    "div",
    { class: "field" },
    h("span", { class: "label" }, "Orientation"),
    segmented(
      "Orientation",
      [
        ["auto", "Auto"],
        ["portrait", "Portrait"],
        ["landscape", "Landscape"],
      ],
      opts.orientation,
      (v) => (opts.orientation = v),
    ),
    h("p", { class: "hint" }, "Auto turns the page sideways for wide images."),
  );
  orientationField.hidden = opts.pageSize === "fit";
  const qualityHint = h("p", { class: "hint" }, QUALITY_HINT[opts.quality]);
  const options = h(
    "div",
    { class: "pt-options" },
    h(
      "div",
      { class: "field" },
      h("span", { class: "label" }, "Page size"),
      segmented(
        "Page size",
        [
          ["fit", "Fit to image"],
          ["a4", "A4"],
          ["letter", "Letter"],
        ],
        opts.pageSize,
        (v) => {
          opts.pageSize = v;
          orientationField.hidden = v === "fit";
        },
      ),
    ),
    orientationField,
    h(
      "div",
      { class: "field" },
      h("span", { class: "label" }, "Margin"),
      segmented(
        "Margin",
        [
          ["none", "None"],
          ["small", "Small"],
          ["large", "Large"],
        ],
        opts.margin,
        (v) => (opts.margin = v),
      ),
    ),
    h(
      "div",
      { class: "field" },
      h("span", { class: "label" }, "Image quality"),
      segmented(
        "Image quality",
        [
          ["original", "Original"],
          ["high", "High"],
          ["medium", "Medium"],
          ["small", "Small file"],
        ],
        opts.quality,
        (v) => {
          opts.quality = v;
          qualityHint.textContent = QUALITY_HINT[v];
        },
      ),
      qualityHint,
    ),
  );

  const outName = h("input", { type: "text", value: "images", maxLength: 120, spellcheck: false, "aria-label": "File name" });
  const goLabel = h("span", {}, "Create PDF");
  const goBtn = button(h("span", {}, icon(ICONS.download), goLabel), () => void build(), "btn primary");
  const workspace = h(
    "div",
    { class: "pm-workspace", hidden: true },
    h(
      "div",
      { class: "pm-toolbar" },
      summary,
      h(
        "div",
        { class: "head-actions" },
        button(
          "Sort A–Z",
          () => {
            if (busy) return;
            items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
            render();
          },
          "btn small ghost",
        ),
        button(
          "Clear all",
          () => {
            if (busy) return;
            for (const item of items) URL.revokeObjectURL(item.url);
            items = [];
            say("");
            render();
          },
          "btn small ghost",
        ),
      ),
    ),
    h("p", { class: "hint" }, "Each image becomes one page. Drag the cards, or use the arrows, to set the order."),
    list,
    options,
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

  function say(text: string, kind: "info" | "error" | "ok" = "info", extra?: Node) {
    status.replaceChildren(...(text ? [message(kind, text)] : []));
    if (extra) status.firstElementChild?.append(" ", extra);
  }

  // ---------- Adding images ----------
  async function addFiles(fileList: Iterable<File>) {
    // Copy before the first await: the browser empties a picker's or drop's FileList afterwards.
    const files = [...fileList];
    const skipped: string[] = [];
    const added: Item[] = [];
    if (files.length) say(`Reading ${plural(files.length, "file")}…`);
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        skipped.push(`${file.name}: larger than ${formatBytes(MAX_FILE_BYTES)}`);
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = sniffImage(bytes);
      if (!kind) {
        const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/.test(file.type);
        skipped.push(
          `${file.name}: ${heic ? "HEIC photos aren't supported — export them as JPEG first" : "not a JPEG, PNG, WebP, GIF or BMP image"}`,
        );
        continue;
      }
      try {
        const { width, height, jpeg } = await probeImage(bytes, kind);
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: file.type || `image/${kind}` }));
        added.push({ id: nextId++, name: file.name, size: file.size, bytes, kind, width, height, jpeg, turns: 0, url });
      } catch {
        skipped.push(`${file.name}: couldn't be read — it may be damaged`);
      }
    }
    items = [...items, ...added];
    render();
    if (skipped.length) say(`Skipped ${skipped.join(" · ")}`, "error");
    else say("");
  }

  picker.addEventListener("change", () => {
    if (picker.files) void addFiles(picker.files);
    picker.value = "";
  });
  for (const target of [drop, list] as HTMLElement[]) {
    target.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      drop.classList.add("over");
    });
    target.addEventListener("dragleave", () => drop.classList.remove("over"));
    target.addEventListener("drop", (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      drop.classList.remove("over");
      void addFiles(e.dataTransfer.files);
    });
  }

  // ---------- List ----------
  function move(id: number, to: number) {
    const from = items.findIndex((i) => i.id === id);
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    render();
  }

  function rotate(item: Item, by: number) {
    item.turns = (((item.turns + by) % 4) + 4) % 4;
    render();
  }

  function card(item: Item, index: number): HTMLLIElement {
    const act = (path: string, title: string, fn: () => void, disabled = false) => {
      const b = button(icon(path), fn, "icon-btn", `${title}: ${item.name}`);
      b.disabled = disabled;
      return b;
    };
    const sideways = item.turns % 2 === 1;
    const [w, hgt] = sideways ? [item.height, item.width] : [item.width, item.height];
    return h(
      "li",
      { class: "pm-card", draggable: true, dataset: { id: String(item.id) } },
      h("span", { class: "pm-grip", "aria-hidden": "true" }, icon("M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01")),
      h("span", { class: "pm-order" }, String(index + 1)),
      h(
        "span",
        { class: "pm-thumb pt-img-thumb" },
        h("img", {
          src: item.url,
          alt: "",
          draggable: false,
          // A class rather than an inline style: the site's CSP blocks style attributes.
          class: `pt-turn-${item.turns}`,
        }),
      ),
      h(
        "div",
        { class: "pm-info" },
        h("span", { class: "pm-file", title: item.name }, item.name),
        h("span", { class: "pm-meta" }, `${w} × ${hgt} px · ${KIND_LABEL[item.kind]} · ${formatBytes(item.size)}`),
        item.turns ? h("span", { class: "pm-meta" }, `Turned ${item.turns * 90}° clockwise`) : null,
      ),
      h(
        "div",
        { class: "pm-actions" },
        act(ROTATE_CCW, "Rotate left", () => rotate(item, -1)),
        act(ROTATE_CW, "Rotate right", () => rotate(item, 1)),
        act("m18 15-6-6-6 6", "Move up", () => move(item.id, index - 1), index === 0),
        act("m6 9 6 6 6-6", "Move down", () => move(item.id, index + 1), index === items.length - 1),
        act(ICONS.x, "Remove", () => {
          URL.revokeObjectURL(item.url);
          items = items.filter((i) => i.id !== item.id);
          render();
        }),
      ),
    );
  }

  function update() {
    const bytes = items.reduce((n, i) => n + i.size, 0);
    summary.textContent = `${plural(items.length, "image")} · ${formatBytes(bytes)}`;
    goBtn.disabled = busy || !items.length;
    goLabel.textContent = busy ? "Creating…" : "Create PDF";
  }

  function render() {
    workspace.hidden = !items.length;
    drop.classList.toggle("compact", items.length > 0);
    list.replaceChildren(...items.map(card));
    update();
  }

  // Reorder by dragging cards.
  list.addEventListener("dragstart", (e) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>(".pm-card");
    if (!c || busy) return;
    dragId = Number(c.dataset.id);
    c.classList.add("dragging");
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", c.dataset.id!);
  });
  list.addEventListener("dragover", (e) => {
    if (dragId === undefined) return;
    e.preventDefault();
    const c = (e.target as HTMLElement).closest<HTMLElement>(".pm-card");
    if (!c || Number(c.dataset.id) === dragId) return;
    const r = c.getBoundingClientRect();
    c[e.clientY > r.top + r.height / 2 ? "after" : "before"](list.querySelector(`[data-id="${dragId}"]`)!);
  });
  list.addEventListener("dragend", () => {
    if (dragId === undefined) return;
    // The DOM already shows the new order; copy it into the list.
    const order = [...list.children].map((li) => Number((li as HTMLElement).dataset.id));
    items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    dragId = undefined;
    render();
  });

  // ---------- Building ----------
  async function build() {
    if (busy || !items.length) return;
    busy = true;
    section.classList.add("pm-busy", "pt-busy");
    update();
    try {
      const bytes = await imagesToPdf(items, opts, (done, total) => say(`Adding image ${Math.min(done + 1, total)} of ${total}…`));
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
      const name = `${safeFileName(outName.value.replace(/\.pdf$/i, ""), "images")}.pdf`;
      const link = h("a", { href: downloadUrl, download: name }, "Download again");
      link.click();
      say(`Done — ${name} (${plural(items.length, "page")}, ${formatBytes(bytes.byteLength)}) was downloaded.`, "ok", link);
    } catch (err) {
      say(
        err instanceof ImageError
          ? err.message
          : "Something went wrong while creating the PDF. Try removing images one at a time to find the problem.",
        "error",
      );
    } finally {
      busy = false;
      section.classList.remove("pm-busy", "pt-busy");
      update();
    }
  }

  render();
}
