import "./pdfedit.css";
import { PDFDocument } from "pdf-lib";
import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import { button, h, header, icon, ICONS, message, type Tool, toast } from "../ui";
import { makeViewport, normalizeRotation, type Pt, rectToScreen, toPdf, toScreen, type Viewport } from "./geometry";
import {
  type Annotation,
  type FontName,
  type ImageAnn,
  LINE_HEIGHT,
  moveAnnotation,
  newId,
  type PageModel,
  type StoredImage,
  type TextAnn,
  unsupportedChars,
} from "./model";
import { loadPdfJs } from "./pdfjs";
import { buildPdf, SaveError } from "./save";
import { openSignaturePad } from "./signature";

type ToolName = "select" | "text" | "draw" | "highlight" | "whiteout" | "box";

interface PageInfo {
  view: number[];
  rotate: number;
  proxy?: PDFPageProxy;
}

interface PageView {
  key: string;
  wrap: HTMLDivElement;
  canvas: HTMLCanvasElement;
  svg: SVGSVGElement;
  vp: Viewport;
  rendered: string;
  task?: RenderTask;
}

const SVGNS = "http://www.w3.org/2000/svg";
const MAX_FILE = 200 * 1024 * 1024;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const INK_COLORS = ["#1f2937", "#e03131", "#1971c2", "#2f9e44", "#f08c00"];
const HIGHLIGHTS = ["#ffe066", "#8ce99a", "#fcc2d7", "#a5d8ff"];
const FAMILY: Record<FontName, string> = {
  Helvetica: "Helvetica, Arial, sans-serif",
  Times: "'Times New Roman', Times, serif",
  Courier: "'Courier New', Courier, monospace",
};
/** Where the first baseline sits in a 1.2-line-height box, in ems (for the text editor box). */
const BASELINE: Record<FontName, number> = { Helvetica: 0.947, Times: 0.938, Courier: 0.867 };

const TOOLS: [ToolName, string, string, string][] = [
  [
    "select",
    "Select",
    "M5 3l14 8-6 2-2 6z",
    "Click something you added to select it, drag to move it, press Delete to remove it. Double-click text to edit.",
  ],
  ["text", "Text", "M4 7V5h16v2M12 5v14M9 19h6", "Click where the text should go, then type."],
  ["draw", "Draw", "M3 21c3-1 5-3 7-6l8-8a2 2 0 0 0-3-3l-8 8c-3 2-5 4-6 7z", "Drag on the page to draw."],
  ["highlight", "Highlight", "M4 20h16M7 16l9-9 3 3-9 9H7z", "Drag over text to highlight it."],
  ["whiteout", "White-out", "M4 6h16v12H4z", "Drag to cover something with white. To replace words, white them out and add Text on top."],
  ["box", "Box", "M4 6h16v12H4z", "Drag to draw a box outline."],
];

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

export function mountPdfEditor(section: HTMLElement, tool: Pick<Tool, "name" | "description">) {
  // ---------- State ----------
  const sources = new Map<number, Uint8Array>();
  const infos = new Map<string, PageInfo>();
  const images = new Map<string, StoredImage>();
  let pages: PageModel[] = [];
  let nextSource = 1;
  let fileName = "document";
  let current: ToolName = "select";
  const style = { color: INK_COLORS[0], highlight: HIGHLIGHTS[0], font: "Helvetica" as FontName, size: 14, width: 2 };
  let selected: { key: string; id: string } | null = null;
  let editing: { key: string; id: string; isNew: boolean; box: HTMLTextAreaElement } | null = null;
  let zoom = 1;
  let scale = 1;
  const undoStack: PageModel[][] = [];
  const redoStack: PageModel[][] = [];
  const views = new Map<string, PageView>();
  const thumbs = new Map<string, { el: HTMLElement; canvas: HTMLCanvasElement; rendered: string }>();
  const visible = new Set<string>();
  let dirty = false;

  // ---------- Elements ----------
  const picker = h("input", { type: "file", accept: "application/pdf,.pdf", hidden: true });
  const addPicker = h("input", { type: "file", accept: "application/pdf,.pdf", multiple: true, hidden: true });
  const imagePicker = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true });
  const status = h("div", { class: "pe-status", role: "status" });
  const pagesEl = h("div", { class: "pe-pages" });
  const thumbList = h("ol", { class: "pe-thumbs" });
  const styleBar = h("div", { class: "pe-style" });
  const toolButtons = new Map<ToolName, HTMLButtonElement>();
  const undoBtn = button(h("span", {}, icon("M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3")), () => undo(), "icon-btn", "Undo (Ctrl+Z)");
  const redoBtn = button(h("span", {}, icon("m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3")), () => redo(), "icon-btn", "Redo (Ctrl+Shift+Z)");
  const zoomLabel = h("span", { class: "pe-zoom" }, "100%");
  const downloadBtn = button(h("span", {}, icon(ICONS.download), "Download PDF"), () => void download(), "btn primary");

  const empty = h(
    "div",
    { class: "pe-empty" },
    h(
      "label",
      { class: "pe-drop" },
      icon(ICONS.upload, "i big"),
      h("strong", {}, "Open a PDF"),
      h("span", {}, "Drop it here or click to choose. It's edited in your browser and never uploaded."),
      picker,
    ),
    button("Start with a blank page", () => startBlank(), "btn"),
  );

  const toolbar = h(
    "div",
    { class: "pe-toolbar", role: "toolbar", "aria-label": "Editing tools" },
    h(
      "div",
      { class: "pe-tools" },
      ...TOOLS.map(([id, label, path]) => {
        const b = button(h("span", {}, icon(path), h("span", { class: "pe-tool-label" }, label)), () => setTool(id), "pe-tool", label);
        b.setAttribute("aria-pressed", String(id === current));
        toolButtons.set(id, b);
        return b;
      }),
      button(
        h("span", {}, icon("M4 16l4-4 3 3 5-6 4 5M4 4h16v16H4z"), h("span", { class: "pe-tool-label" }, "Image")),
        () => imagePicker.click(),
        "pe-tool",
        "Image",
      ),
      button(
        h("span", {}, icon("M3 17c2-4 4-9 6-9s1 8 3 8 2-5 4-5 1 3 5 3M3 21h18"), h("span", { class: "pe-tool-label" }, "Signature")),
        () => void addSignature(),
        "pe-tool",
        "Signature",
      ),
    ),
    styleBar,
    h(
      "div",
      { class: "pe-right" },
      undoBtn,
      redoBtn,
      button("−", () => setZoom(-1), "icon-btn", "Zoom out"),
      zoomLabel,
      button("+", () => setZoom(1), "icon-btn", "Zoom in"),
    ),
  );

  const workspace = h(
    "div",
    { class: "pe-workspace", hidden: true },
    toolbar,
    status,
    h(
      "div",
      { class: "pe-body" },
      h(
        "aside",
        { class: "pe-side", "aria-label": "Pages" },
        thumbList,
        h(
          "div",
          { class: "pe-side-actions" },
          button(h("span", {}, icon("M12 5v14M5 12h14"), "Add PDF pages"), () => addPicker.click(), "btn small"),
          button(h("span", {}, icon("M12 5v14M5 12h14"), "Blank page"), () => insertBlank(pages.at(-1)?.key), "btn small"),
        ),
      ),
      pagesEl,
    ),
    addPicker,
    imagePicker,
  );

  section.replaceChildren(
    header(
      tool,
      button(h("span", {}, icon(ICONS.upload), "Open PDF"), () => picker.click(), "btn"),
      downloadBtn,
    ),
    empty,
    workspace,
  );
  downloadBtn.hidden = true;

  // ---------- Helpers ----------
  const info = (m: PageModel): PageInfo =>
    "blank" in m.src ? { view: [0, 0, m.src.width, m.src.height], rotate: 0 } : infos.get(`${m.src.source}:${m.src.index}`)!;
  const viewportFor = (m: PageModel, s = scale) => {
    const i = info(m);
    return makeViewport(i.view, s, i.rotate + m.userRotation);
  };
  const findPage = (key: string) => pages.find((p) => p.key === key);
  const findAnn = (key: string, id: string) => findPage(key)?.annotations.find((a) => a.id === id);

  function say(text: string, kind: "info" | "error" | "ok" | "warn" = "info") {
    status.replaceChildren(text ? message(kind, text) : "");
  }
  function hint() {
    say(TOOLS.find((t) => t[0] === current)?.[3] ?? "");
  }

  function snapshot() {
    undoStack.push(structuredClone(pages));
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    dirty = true;
    syncUndo();
  }
  function syncUndo() {
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
  }
  function undo() {
    if (editing) finishEditing();
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(structuredClone(pages));
    pages = prev;
    selected = null;
    syncUndo();
    layout();
  }
  function redo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(structuredClone(pages));
    pages = next;
    selected = null;
    syncUndo();
    layout();
  }

  // ---------- Opening files ----------
  async function readPdf(file: File): Promise<{ id: number; count: number } | undefined> {
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      say(`${file.name} isn't a PDF.`, "error");
      return;
    }
    if (file.size > MAX_FILE) {
      say(`${file.name} is larger than 200 MB.`, "error");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      const encrypted = err instanceof Error && /encrypt/i.test(err.message);
      say(
        encrypted
          ? `${file.name} is password-protected, so it can't be edited. Remove the protection first.`
          : `${file.name} couldn't be read as a PDF.`,
        "error",
      );
      return;
    }
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const id = nextSource++;
    sources.set(id, bytes);
    for (let i = 0; i < doc.numPages; i++) {
      const proxy = await doc.getPage(i + 1);
      infos.set(`${id}:${i}`, { view: proxy.view, rotate: proxy.rotate, proxy });
    }
    return { id, count: doc.numPages };
  }

  async function open(file: File) {
    if (pages.length && dirty && !confirm("Open a different PDF? Changes you haven't downloaded will be lost.")) return;
    say(`Opening ${file.name}…`);
    const r = await readPdf(file);
    if (!r) return;
    reset();
    fileName = file.name.replace(/\.pdf$/i, "") || "document";
    pages = Array.from({ length: r.count }, (_, index) => ({
      key: newId("p"),
      src: { source: r.id, index },
      userRotation: 0,
      annotations: [],
    }));
    showWorkspace();
    hint();
  }

  async function append(files: File[]) {
    const before = pages.length;
    for (const f of files) {
      const r = await readPdf(f);
      if (!r) continue;
      if (!before && pages.length === 0) fileName = f.name.replace(/\.pdf$/i, "") || "document";
      snapshot();
      for (let index = 0; index < r.count; index++)
        pages.push({ key: newId("p"), src: { source: r.id, index }, userRotation: 0, annotations: [] });
    }
    if (pages.length !== before) {
      showWorkspace();
      say(`Added ${pages.length - before} page${pages.length - before === 1 ? "" : "s"}.`, "ok");
    }
  }

  function reset() {
    for (const v of views.values()) v.task?.cancel();
    views.clear();
    thumbs.clear();
    visible.clear();
    for (const img of images.values()) URL.revokeObjectURL(img.url);
    images.clear();
    undoStack.length = redoStack.length = 0;
    selected = editing = null;
    dirty = false;
    syncUndo();
  }

  function startBlank() {
    reset();
    fileName = "document";
    pages = [{ key: newId("p"), src: { blank: true, width: 595.28, height: 841.89 }, userRotation: 0, annotations: [] }];
    showWorkspace();
    setTool("text");
  }

  function showWorkspace() {
    empty.hidden = true;
    workspace.hidden = false;
    downloadBtn.hidden = false;
    layout();
  }

  picker.addEventListener("change", () => {
    const f = picker.files?.[0];
    picker.value = "";
    if (f) void open(f);
  });
  addPicker.addEventListener("change", () => {
    const files = [...(addPicker.files ?? [])];
    addPicker.value = "";
    void append(files);
  });
  for (const target of [empty, pagesEl]) {
    target.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        target.classList.add("over");
      }
    });
    target.addEventListener("dragleave", () => target.classList.remove("over"));
    target.addEventListener("drop", (e) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      target.classList.remove("over");
      if (target === empty) void open(files[0]);
      else void append(files);
    });
  }

  // ---------- Layout & rendering ----------
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const key = (e.target as HTMLElement).dataset.key!;
        if (e.isIntersecting) visible.add(key);
        else visible.delete(key);
        if (e.isIntersecting) {
          if (e.target.classList.contains("pe-page")) void renderCanvas(key);
          else void renderThumb(key);
        }
      }
    },
    { rootMargin: "600px" },
  );

  function computeScale() {
    const avail = Math.max(260, pagesEl.clientWidth - 48);
    const widest = Math.max(...pages.map((p) => viewportFor(p, 1).width), 1);
    return Math.min(avail / widest, 1.75) * zoom;
  }

  function layout() {
    if (!pages.length) {
      empty.hidden = false;
      workspace.hidden = true;
      downloadBtn.hidden = true;
      return;
    }
    scale = computeScale();
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    const keys = new Set(pages.map((p) => p.key));
    for (const [key, v] of views) {
      if (!keys.has(key)) {
        v.task?.cancel();
        observer.unobserve(v.wrap);
        views.delete(key);
      }
    }
    for (const [key, t] of thumbs) {
      if (!keys.has(key)) {
        observer.unobserve(t.el);
        thumbs.delete(key);
      }
    }
    pagesEl.replaceChildren(...pages.map((p) => pageView(p).wrap));
    thumbList.replaceChildren(...pages.map((p, i) => thumbItem(p, i)));
    for (const p of pages) {
      drawOverlay(p.key);
      if (visible.has(p.key)) void renderCanvas(p.key);
    }
    for (const p of pages) if (visible.has(p.key)) void renderThumb(p.key);
    renderStyleBar();
  }

  function pageView(m: PageModel): PageView {
    let v = views.get(m.key);
    if (!v) {
      const canvas = h("canvas", { class: "pe-canvas" });
      const overlay = svg("svg", { class: "pe-overlay" });
      const wrap = h("div", { class: "pe-page", dataset: { key: m.key } }, canvas, overlay as unknown as Node);
      v = { key: m.key, wrap, canvas, svg: overlay, vp: viewportFor(m), rendered: "" };
      views.set(m.key, v);
      attachPointer(v);
      observer.observe(wrap);
    }
    v.vp = viewportFor(m);
    v.wrap.style.width = `${v.vp.width}px`;
    v.wrap.style.height = `${v.vp.height}px`;
    v.wrap.classList.toggle(`tool-${current}`, true);
    v.wrap.className = `pe-page tool-${current}`;
    return v;
  }

  async function renderCanvas(key: string) {
    const v = views.get(key);
    const m = findPage(key);
    if (!v || !m) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sig = `${v.vp.scale.toFixed(4)}:${v.vp.rotation}:${dpr}`;
    if (v.rendered === sig) return;
    v.rendered = sig;
    v.task?.cancel();
    const { canvas } = v;
    canvas.style.width = `${v.vp.width}px`;
    canvas.style.height = `${v.vp.height}px`;
    const i = info(m);
    if (!i.proxy) {
      canvas.width = Math.ceil(v.vp.width * dpr);
      canvas.height = Math.ceil(v.vp.height * dpr);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const viewport = i.proxy.getViewport({ scale: v.vp.scale * dpr, rotation: v.vp.rotation });
    const next = h("canvas", { class: "pe-canvas" });
    next.width = Math.ceil(viewport.width);
    next.height = Math.ceil(viewport.height);
    next.style.width = canvas.style.width;
    next.style.height = canvas.style.height;
    const task = i.proxy.render({ canvas: next, viewport });
    v.task = task;
    try {
      await task.promise;
      // Swap in the finished render, so zooming never shows a blank page.
      v.canvas.replaceWith(next);
      v.canvas = next;
    } catch {
      if (v.rendered === sig) v.rendered = "";
    }
  }

  async function renderThumb(key: string) {
    const t = thumbs.get(key);
    const m = findPage(key);
    if (!t || !m) return;
    const vp1 = viewportFor(m, 1);
    const s = 96 / Math.max(vp1.width, vp1.height);
    const sig = `${vp1.rotation}`;
    if (t.rendered === sig) return;
    t.rendered = sig;
    const i = info(m);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = viewportFor(m, s);
    t.canvas.width = Math.ceil(vp.width * dpr);
    t.canvas.height = Math.ceil(vp.height * dpr);
    t.canvas.style.width = `${vp.width}px`;
    t.canvas.style.height = `${vp.height}px`;
    if (!i.proxy) {
      const ctx = t.canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, t.canvas.width, t.canvas.height);
      return;
    }
    try {
      await i.proxy.render({ canvas: t.canvas, viewport: i.proxy.getViewport({ scale: s * dpr, rotation: vp.rotation }) }).promise;
    } catch {
      t.rendered = "";
    }
  }

  function thumbItem(m: PageModel, index: number): HTMLElement {
    let t = thumbs.get(m.key);
    if (!t) {
      const canvas = h("canvas", { class: "pe-thumb-canvas" });
      const el = h("li", { class: "pe-thumb", dataset: { key: m.key } });
      t = { el, canvas, rendered: "" };
      thumbs.set(m.key, t);
      observer.observe(el);
    }
    const last = pages.length - 1;
    const act = (path: string, title: string, fn: () => void, disabled = false) => {
      const b = button(icon(path), fn, "icon-btn", `${title} (page ${index + 1})`);
      b.disabled = disabled;
      return b;
    };
    t.el.replaceChildren(
      button(
        h("span", { class: "pe-thumb-img" }, t.canvas),
        () => views.get(m.key)?.wrap.scrollIntoView({ behavior: "smooth", block: "start" }),
        "pe-thumb-btn",
        `Go to page ${index + 1}`,
      ),
      h("span", { class: "pe-thumb-num" }, String(index + 1)),
      h(
        "div",
        { class: "pe-thumb-actions" },
        act("M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5", "Rotate left", () => rotate(m.key, -90)),
        act("M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5", "Rotate right", () => rotate(m.key, 90)),
        act("m18 15-6-6-6 6", "Move up", () => movePage(m.key, -1), index === 0),
        act("m6 9 6 6 6-6", "Move down", () => movePage(m.key, 1), index === last),
        act("M12 5v14M5 12h14", "Insert blank page after", () => insertBlank(m.key)),
        act("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3", "Delete", () => deletePage(m.key), pages.length === 1),
      ),
    );
    return t.el;
  }

  // ---------- Page operations ----------
  function rotate(key: string, by: number) {
    const m = findPage(key);
    if (!m) return;
    snapshot();
    m.userRotation = normalizeRotation(m.userRotation + by);
    layout();
  }
  function movePage(key: string, dir: number) {
    const i = pages.findIndex((p) => p.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= pages.length) return;
    snapshot();
    [pages[i], pages[j]] = [pages[j], pages[i]];
    layout();
  }
  function deletePage(key: string) {
    if (pages.length === 1) return;
    snapshot();
    pages = pages.filter((p) => p.key !== key);
    if (selected?.key === key) selected = null;
    layout();
    say("Page deleted. Undo brings it back.", "info");
  }
  function insertBlank(afterKey?: string) {
    const i = afterKey ? pages.findIndex((p) => p.key === afterKey) : pages.length - 1;
    const ref = pages[i] ?? pages[0];
    const [x0, y0, x1, y1] = ref ? info(ref).view : [0, 0, 595.28, 841.89];
    snapshot();
    const page: PageModel = { key: newId("p"), src: { blank: true, width: x1 - x0, height: y1 - y0 }, userRotation: 0, annotations: [] };
    pages.splice(i + 1, 0, page);
    layout();
    views.get(page.key)?.wrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setZoom(dir: number) {
    const i = ZOOMS.indexOf(zoom);
    zoom = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))];
    layout();
  }

  // ---------- Overlay ----------
  function drawOverlay(key: string) {
    const v = views.get(key);
    const m = findPage(key);
    if (!v || !m) return;
    const { vp } = v;
    v.svg.setAttribute("width", String(vp.width));
    v.svg.setAttribute("height", String(vp.height));
    v.svg.setAttribute("viewBox", `0 0 ${vp.width} ${vp.height}`);
    v.svg.replaceChildren();
    for (const a of m.annotations) {
      if (editing?.id === a.id) continue;
      const g = annotationNode(a, vp);
      g.dataset.id = a.id;
      v.svg.append(g);
      if (selected?.key === key && selected.id === a.id) addSelection(g, a);
    }
  }

  function annotationNode(a: Annotation, vp: Viewport): SVGGElement {
    const g = svg("g", { class: `ann ann-${a.type}${a.type === "rect" ? ` ann-${a.style}` : ""}` });
    switch (a.type) {
      case "text": {
        const s = toScreen(vp, a);
        g.setAttribute("transform", `rotate(${vp.rotation - a.rotation} ${s.x} ${s.y})`);
        const size = a.size * vp.scale;
        const t = svg("text", { x: s.x, y: s.y, "font-family": FAMILY[a.font], "font-size": size, fill: a.color });
        a.text.split("\n").forEach((line, i) => {
          const span = svg("tspan", { x: s.x, dy: i ? size * LINE_HEIGHT : 0 });
          span.textContent = line || " ";
          t.append(span);
        });
        g.append(t);
        break;
      }
      case "rect": {
        const r = rectToScreen(vp, a.x1, a.y1, a.x2, a.y2);
        const attrs: Record<string, string | number> = { x: r.x, y: r.y, width: r.w, height: r.h };
        if (a.style === "whiteout") Object.assign(attrs, { fill: "#ffffff" });
        else if (a.style === "highlight") Object.assign(attrs, { fill: a.color, "fill-opacity": 0.4 });
        else Object.assign(attrs, { fill: "transparent", stroke: a.color, "stroke-width": 2 * vp.scale });
        g.append(svg("rect", attrs));
        break;
      }
      case "ink": {
        const pts = a.points.map((p) => toScreen(vp, p));
        const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") + (pts.length === 1 ? " l0.01 0" : "");
        g.append(
          svg("path", { d, fill: "none", stroke: "transparent", "stroke-width": Math.max(12, a.width * vp.scale + 8), class: "hit" }),
        );
        g.append(
          svg("path", {
            d,
            fill: "none",
            stroke: a.color,
            "stroke-width": a.width * vp.scale,
            "stroke-linecap": "round",
            "stroke-linejoin": "round",
          }),
        );
        break;
      }
      case "image": {
        const s = toScreen(vp, a);
        const w = a.w * vp.scale;
        const hgt = a.h * vp.scale;
        g.setAttribute("transform", `rotate(${vp.rotation - a.rotation} ${s.x} ${s.y})`);
        const img = svg("image", { x: s.x, y: s.y - hgt, width: w, height: hgt, preserveAspectRatio: "none" });
        img.setAttribute("href", images.get(a.imageId)?.url ?? "");
        g.append(img);
        break;
      }
    }
    return g;
  }

  function addSelection(g: SVGGElement, a: Annotation) {
    const shape = g.lastElementChild as SVGGraphicsElement;
    const bb = shape.getBBox();
    const pad = 4;
    g.append(svg("rect", { x: bb.x - pad, y: bb.y - pad, width: bb.width + pad * 2, height: bb.height + pad * 2, class: "sel" }));
    if (a.type === "rect" || a.type === "image") {
      const hx = bb.x + bb.width;
      const hy = a.type === "rect" ? bb.y + bb.height : bb.y;
      g.append(svg("rect", { x: hx - 6, y: hy - 6, width: 12, height: 12, class: "handle" }));
    }
  }

  // ---------- Pointer interaction ----------
  function attachPointer(v: PageView) {
    let action:
      | { kind: "move"; start: Pt; before: PageModel[]; original: Annotation; moved: boolean }
      | { kind: "resize"; start: Pt; before: PageModel[]; original: Annotation; anchor: Pt }
      | { kind: "ink"; ann: Annotation & { type: "ink" }; last: Pt }
      | { kind: "rect"; start: Pt; ann: Annotation & { type: "rect" } }
      | null = null;

    const local = (e: PointerEvent): Pt => {
      const r = v.svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const model = () => findPage(v.key)!;

    v.svg.addEventListener("dblclick", (e) => {
      const id = (e.target as Element).closest<SVGGElement>(".ann")?.dataset.id;
      const a = id ? findAnn(v.key, id) : undefined;
      if (a?.type === "text") startEditing(v.key, a, false);
    });

    v.svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (editing) finishEditing();
      const p = local(e);
      const target = e.target as Element;
      const id = target.closest<SVGGElement>(".ann")?.dataset.id;
      const m = model();

      if (current === "select" || (current === "text" && id && findAnn(v.key, id)?.type === "text")) {
        if (!id) {
          select(null);
          return;
        }
        const a = findAnn(v.key, id)!;
        if (current === "text" && a.type === "text") {
          startEditing(v.key, a, false);
          e.preventDefault();
          return;
        }
        select({ key: v.key, id });
        const before = structuredClone(pages);
        if (target.classList.contains("handle")) {
          const anchor = a.type === "image" ? toScreen(v.vp, a) : { x: 0, y: 0 };
          action = { kind: "resize", start: p, before, original: structuredClone(a), anchor };
        } else action = { kind: "move", start: p, before, original: structuredClone(a), moved: false };
        v.svg.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      if (current === "text") {
        e.preventDefault();
        snapshot();
        const size = style.size;
        const anchor = toPdf(v.vp, { x: p.x, y: p.y + size * v.vp.scale * 0.8 });
        const a: TextAnn = {
          id: newId(),
          type: "text",
          ...anchor,
          text: "",
          size,
          color: style.color,
          font: style.font,
          rotation: v.vp.rotation,
        };
        m.annotations.push(a);
        startEditing(v.key, a, true);
        return;
      }

      e.preventDefault();
      v.svg.setPointerCapture(e.pointerId);
      const pdf = toPdf(v.vp, p);
      if (current === "draw") {
        snapshot();
        const ann = { id: newId(), type: "ink" as const, points: [pdf], color: style.color, width: style.width };
        m.annotations.push(ann);
        action = { kind: "ink", ann, last: p };
      } else {
        snapshot();
        const ann = {
          id: newId(),
          type: "rect" as const,
          style: current as "highlight" | "whiteout" | "box",
          x1: pdf.x,
          y1: pdf.y,
          x2: pdf.x,
          y2: pdf.y,
          color: current === "highlight" ? style.highlight : style.color,
        };
        m.annotations.push(ann);
        action = { kind: "rect", start: p, ann };
      }
      drawOverlay(v.key);
    });

    v.svg.addEventListener("pointermove", (e) => {
      if (!action) return;
      const p = local(e);
      const m = model();
      if (action.kind === "ink") {
        if (Math.hypot(p.x - action.last.x, p.y - action.last.y) < 1.5) return;
        action.ann.points.push(toPdf(v.vp, p));
        action.last = p;
      } else if (action.kind === "rect") {
        const q = toPdf(v.vp, p);
        action.ann.x2 = q.x;
        action.ann.y2 = q.y;
      } else if (action.kind === "move") {
        const a0 = toPdf(v.vp, action.start);
        const a1 = toPdf(v.vp, p);
        const moved = moveAnnotation(action.original, a1.x - a0.x, a1.y - a0.y);
        action.moved ||= Math.hypot(p.x - action.start.x, p.y - action.start.y) > 2;
        m.annotations = m.annotations.map((a) => (a.id === moved.id ? moved : a));
      } else if (action.kind === "resize") {
        const o = action.original;
        if (o.type === "rect") {
          const r = rectToScreen(v.vp, o.x1, o.y1, o.x2, o.y2);
          const fixed = toPdf(v.vp, { x: r.x, y: r.y });
          const q = toPdf(v.vp, { x: Math.max(p.x, r.x + 4), y: Math.max(p.y, r.y + 4) });
          m.annotations = m.annotations.map((a) => (a.id === o.id ? { ...o, x1: fixed.x, y1: fixed.y, x2: q.x, y2: q.y } : a));
        } else if (o.type === "image") {
          const d0 = Math.hypot(action.start.x - action.anchor.x, action.start.y - action.anchor.y) || 1;
          const d1 = Math.hypot(p.x - action.anchor.x, p.y - action.anchor.y);
          const f = Math.max(0.05, d1 / d0);
          m.annotations = m.annotations.map((a) => (a.id === o.id ? { ...o, w: o.w * f, h: o.h * f } : a));
        }
      }
      drawOverlay(v.key);
    });

    const end = () => {
      if (!action) return;
      const m = model();
      if (action.kind === "rect") {
        const r = rectToScreen(v.vp, action.ann.x1, action.ann.y1, action.ann.x2, action.ann.y2);
        // A click without a drag: don't leave a zero-size box behind.
        if (r.w < 4 || r.h < 4) {
          m.annotations = m.annotations.filter((a) => a.id !== (action as { ann: Annotation }).ann.id);
          undoStack.pop();
          syncUndo();
        }
      } else if ((action.kind === "move" && action.moved) || action.kind === "resize") {
        undoStack.push(action.before);
        redoStack.length = 0;
        dirty = true;
        syncUndo();
      }
      action = null;
      drawOverlay(v.key);
    };
    v.svg.addEventListener("pointerup", end);
    v.svg.addEventListener("pointercancel", end);
  }

  function select(sel: { key: string; id: string } | null) {
    const prev = selected?.key;
    selected = sel;
    if (prev && prev !== sel?.key) drawOverlay(prev);
    if (sel) drawOverlay(sel.key);
    renderStyleBar();
  }

  function deleteSelected() {
    if (!selected) return;
    const m = findPage(selected.key);
    if (!m) return;
    snapshot();
    m.annotations = m.annotations.filter((a) => a.id !== selected!.id);
    const key = selected.key;
    selected = null;
    drawOverlay(key);
    renderStyleBar();
  }

  // ---------- Text editing ----------
  function startEditing(key: string, a: TextAnn, isNew: boolean) {
    const v = views.get(key);
    if (!v) return;
    if (!isNew) snapshot();
    const box = h("textarea", { class: "pe-text-editor", spellcheck: false, rows: 1, "aria-label": "Text" });
    box.value = a.text;
    const size = a.size * v.vp.scale;
    const s = toScreen(v.vp, a);
    const base = BASELINE[a.font] * size;
    Object.assign(box.style, {
      left: `${s.x}px`,
      top: `${s.y - base}px`,
      fontSize: `${size}px`,
      fontFamily: FAMILY[a.font],
      color: a.color,
      transformOrigin: `0 ${base}px`,
      transform: `rotate(${v.vp.rotation - a.rotation}deg)`,
    });
    const fit = () => {
      box.style.height = "auto";
      box.style.width = "auto";
      box.style.height = `${box.scrollHeight}px`;
      box.style.width = `${Math.max(size * 2, box.scrollWidth + 4)}px`;
    };
    box.addEventListener("input", () => {
      a.text = box.value;
      fit();
      const bad = unsupportedChars(a.text);
      if (bad.length) say(`${bad.join(" ")} can't be saved with the built-in PDF fonts (Western European characters only).`, "warn");
      else hint();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape") box.blur();
      e.stopPropagation();
    });
    box.addEventListener("blur", () => finishEditing());
    editing = { key, id: a.id, isNew, box };
    selected = { key, id: a.id };
    v.wrap.append(box);
    drawOverlay(key);
    renderStyleBar();
    fit();
    // Focus right away, so typing straight after the click isn't lost.
    box.focus({ preventScroll: true });
  }

  function finishEditing() {
    if (!editing) return;
    const { key, id, isNew, box } = editing;
    editing = null;
    box.remove();
    const m = findPage(key);
    const a = m?.annotations.find((x) => x.id === id);
    if (m && a?.type === "text" && !a.text.trim()) {
      m.annotations = m.annotations.filter((x) => x.id !== id);
      selected = null;
      if (isNew) {
        // Nothing was added after all.
        undoStack.pop();
        syncUndo();
      }
    }
    drawOverlay(key);
    renderStyleBar();
  }

  // ---------- Images & signatures ----------
  function placeImage(img: StoredImage) {
    // Put it in the middle of the page that's most in view.
    const box = pagesEl.getBoundingClientRect();
    let best: PageView | undefined;
    let bestArea = -1;
    for (const p of pages) {
      const v = views.get(p.key)!;
      const r = v.wrap.getBoundingClientRect();
      const area = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top)) * r.width;
      if (area > bestArea) [best, bestArea] = [v, area];
    }
    if (!best) return;
    const r = best.wrap.getBoundingClientRect();
    const cx = (Math.max(r.top, box.top) + Math.min(r.bottom, box.bottom)) / 2 - r.top;
    const pageW = best.vp.width / best.vp.scale;
    const w = Math.min(img.width * 0.75, pageW * 0.4);
    const hgt = w * (img.height / img.width);
    const sw = w * best.vp.scale;
    const sh = hgt * best.vp.scale;
    const bottomLeft = toPdf(best.vp, { x: best.vp.width / 2 - sw / 2, y: Math.min(best.vp.height - 8, cx + sh / 2) });
    snapshot();
    const id = newId("img");
    images.set(id, img);
    const ann: ImageAnn = { id: newId(), type: "image", ...bottomLeft, w, h: hgt, rotation: best.vp.rotation, imageId: id };
    findPage(best.key)!.annotations.push(ann);
    setTool("select");
    select({ key: best.key, id: ann.id });
    say("Drag the image to move it, or the corner handle to resize it.", "info");
  }

  async function toStoredImage(blob: Blob): Promise<StoredImage> {
    const bitmap = await createImageBitmap(blob);
    let bytes: Uint8Array;
    let kind: "png" | "jpg";
    if (blob.type === "image/png" || blob.type === "image/jpeg") {
      bytes = new Uint8Array(await blob.arrayBuffer());
      kind = blob.type === "image/png" ? "png" : "jpg";
    } else {
      // Other formats (WebP, GIF): convert to PNG, which PDFs can hold.
      const c = h("canvas", { width: bitmap.width, height: bitmap.height });
      c.getContext("2d")!.drawImage(bitmap, 0, 0);
      const png = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("convert"))), "image/png"));
      bytes = new Uint8Array(await png.arrayBuffer());
      kind = "png";
    }
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: kind === "png" ? "image/png" : "image/jpeg" }));
    return { bytes, kind, url, width: bitmap.width, height: bitmap.height };
  }

  imagePicker.addEventListener("change", async () => {
    const f = imagePicker.files?.[0];
    imagePicker.value = "";
    if (!f) return;
    try {
      placeImage(await toStoredImage(f));
    } catch {
      say("That image couldn't be read.", "error");
    }
  });

  async function addSignature() {
    const blob = await openSignaturePad();
    if (blob) placeImage(await toStoredImage(blob));
  }

  // ---------- Tools & style ----------
  function setTool(t: ToolName) {
    if (editing) finishEditing();
    current = t;
    for (const [id, b] of toolButtons) b.setAttribute("aria-pressed", String(id === t));
    for (const v of views.values()) v.wrap.className = `pe-page tool-${t}`;
    if (t !== "select") select(null);
    renderStyleBar();
    hint();
  }

  /** What the style controls apply to: the selected item, or else the current tool. */
  function styleTarget(): { kind: "text" | "ink" | "highlight" | "box" | "none"; ann?: Annotation } {
    const a = selected ? findAnn(selected.key, selected.id) : undefined;
    if (a?.type === "text") return { kind: "text", ann: a };
    if (a?.type === "ink") return { kind: "ink", ann: a };
    if (a?.type === "rect") return { kind: a.style === "highlight" ? "highlight" : a.style === "box" ? "box" : "none", ann: a };
    if (a) return { kind: "none", ann: a };
    return {
      kind:
        current === "text"
          ? "text"
          : current === "draw"
            ? "ink"
            : current === "highlight"
              ? "highlight"
              : current === "box"
                ? "box"
                : "none",
    };
  }

  function applyToSelected(patch: Partial<Annotation>) {
    if (!selected) return;
    const m = findPage(selected.key);
    if (!m) return;
    snapshot();
    m.annotations = m.annotations.map((a) => (a.id === selected!.id ? ({ ...a, ...patch } as Annotation) : a));
    if (editing && editing.id === selected.id) {
      const a = findAnn(selected.key, selected.id) as TextAnn;
      const { key } = editing;
      finishEditing();
      startEditing(key, a, false);
      undoStack.pop();
      syncUndo();
    }
    drawOverlay(selected.key);
  }

  function swatches(colors: string[], value: string, onPick: (c: string) => void, label: string) {
    const input = h("input", { type: "color", value, "aria-label": `Custom ${label}` });
    input.addEventListener("change", () => onPick(input.value));
    return h(
      "div",
      { class: "pe-swatches", role: "group", "aria-label": label },
      ...colors.map((c) => {
        const b = button("", () => onPick(c), `pe-swatch${c === value ? " on" : ""}`, `${label} ${c}`);
        b.style.background = c;
        return b;
      }),
      input,
    );
  }

  function renderStyleBar() {
    const t = styleTarget();
    const kids: Node[] = [];
    if (t.kind === "text") {
      const a = t.ann as TextAnn | undefined;
      const font = h(
        "select",
        { "aria-label": "Font" },
        ...(["Helvetica", "Times", "Courier"] as FontName[]).map((f) =>
          h("option", { value: f, selected: (a?.font ?? style.font) === f }, f),
        ),
      );
      font.addEventListener("change", () => {
        style.font = font.value as FontName;
        if (a) applyToSelected({ font: style.font });
      });
      const size = h(
        "select",
        { "aria-label": "Text size" },
        ...[8, 10, 11, 12, 14, 16, 18, 24, 32, 48, 72].map((n) =>
          h("option", { value: n, selected: (a?.size ?? style.size) === n }, `${n} pt`),
        ),
      );
      size.addEventListener("change", () => {
        style.size = Number(size.value);
        if (a) applyToSelected({ size: style.size });
      });
      kids.push(font, size);
    }
    if (t.kind === "ink") {
      const a = t.ann as (Annotation & { type: "ink" }) | undefined;
      const width = h(
        "select",
        { "aria-label": "Line width" },
        ...[1, 2, 3, 5, 8].map((n) => h("option", { value: n, selected: (a?.width ?? style.width) === n }, `${n} pt`)),
      );
      width.addEventListener("change", () => {
        style.width = Number(width.value);
        if (a) applyToSelected({ width: style.width });
      });
      kids.push(width);
    }
    if (t.kind === "text" || t.kind === "ink" || t.kind === "box") {
      const value = (t.ann && "color" in t.ann ? t.ann.color : style.color) ?? style.color;
      kids.push(
        swatches(
          INK_COLORS,
          value,
          (c) => {
            style.color = c;
            if (t.ann) applyToSelected({ color: c });
            renderStyleBar();
          },
          "Colour",
        ),
      );
    }
    if (t.kind === "highlight") {
      const value = (t.ann && "color" in t.ann ? t.ann.color : style.highlight) ?? style.highlight;
      kids.push(
        swatches(
          HIGHLIGHTS,
          value,
          (c) => {
            style.highlight = c;
            if (t.ann) applyToSelected({ color: c });
            renderStyleBar();
          },
          "Highlight colour",
        ),
      );
    }
    if (selected)
      kids.push(
        button(
          h("span", {}, icon("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"), "Delete"),
          () => deleteSelected(),
          "btn small danger",
        ),
      );
    styleBar.replaceChildren(...kids);
  }

  // ---------- Download ----------
  async function download() {
    if (editing) finishEditing();
    if (!pages.length) return;
    downloadBtn.disabled = true;
    say("Building your PDF…");
    try {
      const bytes = await buildPdf(pages, sources, images);
      const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
      const name = `${fileName}-edited.pdf`;
      h("a", { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      dirty = false;
      say(`Downloaded ${name} (${pages.length} page${pages.length === 1 ? "" : "s"}).`, "ok");
      toast("PDF downloaded");
    } catch (err) {
      say(err instanceof SaveError ? err.message : "Something went wrong while building the PDF.", "error");
    } finally {
      downloadBtn.disabled = false;
    }
  }

  // ---------- Keyboard & resize ----------
  window.addEventListener("keydown", (e) => {
    if (!section.isConnected || workspace.hidden) return;
    const target = e.target as HTMLElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z" && !typing) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === "y" && !typing) {
      e.preventDefault();
      redo();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected && !typing) {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === "Escape" && selected && !typing) {
      select(null);
    }
  });

  let lastWidth = 0;
  new ResizeObserver(() => {
    const w = pagesEl.clientWidth;
    if (!pages.length || !w || Math.abs(w - lastWidth) < 8) return;
    lastWidth = w;
    if (editing) finishEditing();
    layout();
  }).observe(pagesEl);

  window.addEventListener("beforeunload", (e) => {
    if (dirty && pages.length) e.preventDefault();
  });

  syncUndo();
}
