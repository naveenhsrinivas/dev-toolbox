import "./merge.css";
import { button, h, header, icon, ICONS, message, plural, type Tool } from "../ui";
import { inspectPdf, mergePdfs, PdfReadError, renderThumbnail } from "./pdf";
import { parsePageRanges } from "./ranges";

interface Item {
  id: number;
  name: string;
  size: number;
  bytes: Uint8Array;
  pageCount: number;
  range: string;
  thumb?: HTMLCanvasElement;
}

const MAX_FILE_BYTES = 200 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function mountPdfMerge(section: HTMLElement, tool: Pick<Tool, "name" | "description">) {
  let items: Item[] = [];
  let nextId = 1;
  let busy = false;
  let downloadUrl: string | undefined;
  let dragId: number | undefined;

  const picker = h("input", { type: "file", accept: "application/pdf,.pdf", multiple: true, hidden: true });
  const drop = h(
    "label",
    { class: "pm-drop" },
    picker,
    icon(ICONS.upload, "i big"),
    h("strong", {}, "Drop PDF files here"),
    h("span", {}, "or click to choose. They're combined in your browser and never uploaded."),
  );
  const list = h("ol", { class: "pm-list" });
  const summary = h("strong", { class: "pm-summary", "aria-live": "polite" });
  const status = h("div", { role: "status" });
  const outName = h("input", { type: "text", value: "merged", maxLength: 120, spellcheck: false, "aria-label": "File name" });
  const mergeLabel = h("span", {}, "Merge PDFs");
  const mergeBtn = button(h("span", {}, icon(ICONS.download), mergeLabel), () => void merge(), "btn primary");
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
            items = [];
            say("");
            render();
          },
          "btn small ghost",
        ),
      ),
    ),
    h("p", { class: "hint" }, "Drag the cards, or use the arrows, to set the order. Leave “Pages” empty to include every page."),
    list,
    h(
      "div",
      { class: "pm-merge" },
      h("label", { class: "pm-name" }, h("span", {}, "File name"), h("span", { class: "pm-name-input" }, outName, h("span", {}, ".pdf"))),
      mergeBtn,
    ),
  );

  section.replaceChildren(header(tool), drop, status, workspace);

  function say(text: string, kind: "info" | "error" | "ok" = "info", extra?: Node) {
    status.replaceChildren(...(text ? [message(kind, text)] : []));
    if (extra) status.firstElementChild?.append(" ", extra);
  }

  const pagesOf = (item: Item) => parsePageRanges(item.range, item.pageCount);

  // ---------- Adding files ----------
  async function addFiles(fileList: Iterable<File>) {
    // Copy before the first await: the browser empties a picker's or drop's FileList afterwards.
    const files = [...fileList];
    const skipped: string[] = [];
    const added: Item[] = [];
    for (const file of files) {
      if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
        skipped.push(`${file.name}: not a PDF`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        skipped.push(`${file.name}: larger than ${formatBytes(MAX_FILE_BYTES)}`);
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { pageCount } = await inspectPdf(bytes);
        added.push({ id: nextId++, name: file.name, size: file.size, bytes, pageCount, range: "" });
      } catch (err) {
        skipped.push(`${file.name}: ${err instanceof PdfReadError ? err.message : "couldn't be read"}`);
      }
    }
    items = [...items, ...added];
    render();
    if (skipped.length) say(`Skipped ${skipped.join(" · ")}`, "error");
    else if (added.length) say("");
    for (const item of added) void loadThumb(item);
  }

  async function loadThumb(item: Item) {
    try {
      item.thumb = await renderThumbnail(item.bytes, 56);
      item.thumb.className = "pm-thumb-canvas";
      list.querySelector(`[data-id="${item.id}"] .pm-thumb`)?.replaceChildren(item.thumb);
    } catch {
      // The preview is optional; the placeholder stays.
    }
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

  function card(item: Item, index: number): HTMLLIElement {
    const input = h("input", {
      type: "text",
      spellcheck: false,
      autocomplete: "off",
      placeholder: "all, or e.g. 1-3, 5",
      "aria-label": `Pages to include from ${item.name}`,
    });
    input.value = item.range;
    const note = h("span", { class: "pm-note" });
    const updateNote = () => {
      const r = pagesOf(item);
      const custom = item.range.trim() !== "" && item.range.trim().toLowerCase() !== "all";
      input.setAttribute("aria-invalid", String(!r.ok));
      note.classList.toggle("error", !r.ok);
      note.textContent = !r.ok ? r.error : custom ? `${plural(r.pages.length, "page")} selected` : "";
    };
    input.addEventListener("input", () => {
      item.range = input.value;
      updateNote();
      updateSummary();
    });
    updateNote();

    const act = (path: string, title: string, fn: () => void, disabled = false) => {
      const b = button(icon(path), fn, "icon-btn", `${title}: ${item.name}`);
      b.disabled = disabled;
      return b;
    };
    return h(
      "li",
      { class: "pm-card", draggable: true, dataset: { id: String(item.id) } },
      h("span", { class: "pm-grip", "aria-hidden": "true" }, icon("M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01")),
      h("span", { class: "pm-order" }, String(index + 1)),
      h("span", { class: "pm-thumb" }, item.thumb ?? h("span", { class: "pm-thumb-empty" }, "PDF")),
      h(
        "div",
        { class: "pm-info" },
        h("span", { class: "pm-file", title: item.name }, item.name),
        h("span", { class: "pm-meta" }, `${plural(item.pageCount, "page")} · ${formatBytes(item.size)}`),
        h("label", { class: "pm-range" }, h("span", {}, "Pages"), input),
        note,
      ),
      h(
        "div",
        { class: "pm-actions" },
        act("m18 15-6-6-6 6", "Move up", () => move(item.id, index - 1), index === 0),
        act("m6 9 6 6 6-6", "Move down", () => move(item.id, index + 1), index === items.length - 1),
        act(ICONS.x, "Remove", () => {
          items = items.filter((i) => i.id !== item.id);
          render();
        }),
      ),
    );
  }

  function updateSummary() {
    const results = items.map(pagesOf);
    const invalid = results.filter((r) => !r.ok).length;
    const pages = results.reduce((n, r) => n + (r.ok ? r.pages.length : 0), 0);
    summary.textContent = `${plural(items.length, "file")} · ${plural(pages, "page")} in total`;
    mergeBtn.disabled = busy || !items.length || invalid > 0;
    mergeLabel.textContent = busy ? "Merging…" : items.length === 1 ? "Save PDF" : "Merge PDFs";
    mergeBtn.title = invalid ? "Fix the page selections marked in red first" : "";
  }

  function render() {
    workspace.hidden = !items.length;
    drop.classList.toggle("compact", items.length > 0);
    list.replaceChildren(...items.map(card));
    updateSummary();
  }

  // Reorder by dragging cards.
  list.addEventListener("dragstart", (e) => {
    const target = e.target as HTMLElement;
    const c = target.closest<HTMLElement>(".pm-card");
    if (!c || busy || target.closest("input")) return;
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

  // ---------- Merge ----------
  async function merge() {
    if (busy || !items.length) return;
    const parts = [];
    for (const item of items) {
      const r = pagesOf(item);
      if (!r.ok) return say(`${item.name}: ${r.error}`, "error");
      parts.push({ bytes: item.bytes, pages: r.pages });
    }
    busy = true;
    section.classList.add("pm-busy");
    updateSummary();
    try {
      const bytes = await mergePdfs(parts, (done, total) => say(`Merging file ${Math.min(done + 1, total)} of ${total}…`));
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
      const base =
        outName.value
          .trim()
          .replace(/\.pdf$/i, "")
          .replace(/[\\/:*?"<>|]+/g, "-") || "merged";
      const name = `${base}.pdf`;
      const link = h("a", { href: downloadUrl, download: name }, "Download again");
      link.click();
      const pages = parts.reduce((n, p) => n + p.pages.length, 0);
      say(`Done — ${name} (${plural(pages, "page")}, ${formatBytes(bytes.byteLength)}) was downloaded.`, "ok", link);
    } catch {
      say("Something went wrong while merging. One of the files may be damaged — try removing files one at a time to find it.", "error");
    } finally {
      busy = false;
      section.classList.remove("pm-busy");
      updateSummary();
    }
  }

  render();
}
