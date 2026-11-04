import "./crop.css";
import { button, downloadBytes, field, formatBytes, h, header, icon, ICONS, message, safeFileName, type Tool } from "../ui";
import { toBlob, wireDropzone } from "./canvas";
import { EXT, type Format, isHeic, LABEL } from "./convert";
import {
  canvasSize,
  clampRect,
  flip,
  type Handle,
  IDENTITY,
  inscribedRect,
  mirrorRect,
  moveRect,
  type Orientation,
  orientedSize,
  parseAspect,
  type Rect,
  resizeAroundCenter,
  resizeRect,
  rotate90,
  type Size,
  totalAngle,
} from "./geometry";

const MAX_FILE = 100 * 1024 * 1024;
/** Longest side of the on-screen preview; the download always uses the full-resolution image. */
const PREVIEW_SIDE = 1600;
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const ASPECTS: [string, string, number | "original" | "custom" | undefined][] = [
  ["free", "Free", undefined],
  ["original", "Original", "original"],
  ["1:1", "1:1 (square)", 1],
  ["4:3", "4:3", 4 / 3],
  ["3:2", "3:2", 3 / 2],
  ["16:9", "16:9", 16 / 9],
  ["passport", "Passport photo 35×45 mm", 35 / 45],
  ["custom", "Custom…", "custom"],
];

const ROTATE_LEFT = "M4 4v5h5M4.6 9A8 8 0 1 1 4 13";
const ROTATE_RIGHT = "M20 4v5h-5M19.4 9A8 8 0 1 0 20 13";
const FLIP_H = "M12 3v18M8 7l-5 5 5 5V7zM16 7l5 5-5 5V7z";
const FLIP_V = "M3 12h18M7 8l5-5 5 5H7zM7 16l5 5 5-5H7z";

/** Draw the source with the orientation into a canvas covering `area` of the transformed image, at `scale`. */
function drawOriented(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  srcSize: Size,
  o: Orientation,
  bounds: Size,
  area: Rect,
  scale: number,
) {
  ctx.save();
  ctx.imageSmoothingQuality = "high";
  ctx.scale(scale, scale);
  ctx.translate(-area.x + bounds.width / 2, -area.y + bounds.height / 2);
  ctx.rotate((totalAngle(o) * Math.PI) / 180);
  if (o.mirror) ctx.scale(-1, 1);
  ctx.drawImage(src, -srcSize.width / 2, -srcSize.height / 2, srcSize.width, srcSize.height);
  ctx.restore();
}

export function renderCrop(tool: Pick<Tool, "name" | "description">): HTMLElement {
  let img: { name: string; size: number; bitmap: ImageBitmap; preview: ImageBitmap; type: string } | undefined;
  let o: Orientation = IDENTITY;
  let crop: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let aspectKey = "free";
  let portrait = false;
  let format: Format = "image/jpeg";
  let busy = false;
  let resultUrl: string | undefined;

  const picker = h("input", { type: "file", accept: "image/*", hidden: true });
  const drop = h(
    "label",
    { class: "dropzone" },
    picker,
    icon(ICONS.upload, "i big"),
    h("strong", {}, "Drop an image here"),
    h("span", {}, "JPEG, PNG, WebP, GIF or BMP. It's cropped in your browser and never uploaded."),
  );
  const status = h("div", { role: "status" });

  // ----- Stage -----
  const canvas = h("canvas", { class: "ic-canvas" });
  const box = h(
    "div",
    {
      class: "ic-box",
      tabIndex: 0,
      role: "group",
      "aria-label": "Crop area. Arrow keys move it; hold Shift to move faster, Alt to resize.",
    },
    h("span", { class: "ic-grid" }),
    ...HANDLES.map((hd) => h("span", { class: `ic-handle ic-${hd}`, dataset: { handle: hd } })),
  );
  const stage = h("div", { class: "ic-stage" }, canvas, box);
  // The frame leaves room around the image so handles on its edges stay easy to grab.
  const frame = h("div", { class: "ic-frame" }, stage);

  const angleIn = h("input", { type: "range", min: -45, max: 45, step: 0.1, value: 0, "aria-label": "Straighten angle" });
  const angleOut = h("output", { class: "ic-angle" }, "0°");
  const toolbar = h(
    "div",
    { class: "ic-toolbar" },
    button(icon(ROTATE_LEFT), () => turn(-1), "btn small", "Rotate left"),
    button(icon(ROTATE_RIGHT), () => turn(1), "btn small", "Rotate right"),
    button(icon(FLIP_H), () => mirror("horizontal"), "btn small", "Flip horizontally"),
    button(icon(FLIP_V), () => mirror("vertical"), "btn small", "Flip vertically"),
    button("Reset", () => reset(), "btn small ghost"),
  );
  const straighten = h(
    "div",
    { class: "ic-straighten" },
    h("label", { htmlFor: "ic-angle" }, "Straighten"),
    angleIn,
    angleOut,
    button(icon(ICONS.refresh), () => setAngle(0), "icon-btn", "Straighten back to 0°"),
  );
  angleIn.id = "ic-angle";

  // ----- Controls -----
  const aspectSelect = h(
    "select",
    { class: "ic-aspect", "aria-label": "Aspect ratio" },
    ...ASPECTS.map(([key, label]) => h("option", { value: key }, label)),
  );
  const customIn = h("input", {
    type: "text",
    value: "5:7",
    class: "num-input",
    "aria-label": "Custom ratio, width:height",
    spellcheck: false,
  });
  const swapBtn = button(
    icon(ICONS.swap),
    () => {
      portrait = !portrait;
      applyAspect();
    },
    "btn small",
    "Swap portrait and landscape",
  );
  const aspectRow = h("div", { class: "ir-row" }, aspectSelect, swapBtn);
  const customRow = h("div", { class: "ir-row", hidden: true }, customIn, h("span", { class: "hint" }, "width : height, like 5:7"));

  const num = (label: string) => h("input", { type: "number", min: 0, step: 1, "aria-label": label });
  const xIn = num("Left");
  const yIn = num("Top");
  const wIn = num("Width");
  const hIn = num("Height");
  const sizeOut = h("p", { class: "ic-size" });
  const cropFields = h(
    "div",
    { class: "ic-nums" },
    h("label", {}, h("span", {}, "W"), wIn),
    h("label", {}, h("span", {}, "H"), hIn),
    h("label", {}, h("span", {}, "X"), xIn),
    h("label", {}, h("span", {}, "Y"), yIn),
  );

  const formatSelect = h(
    "select",
    { "aria-label": "Format" },
    ...(Object.keys(LABEL) as Format[]).map((f) => h("option", { value: f }, LABEL[f])),
  );
  const quality = h("input", { type: "range", min: 10, max: 100, value: 90, "aria-label": "Quality" });
  const qualityOut = h("output", {}, "90%");
  const qualityField = field("Quality", h("div", { class: "ir-row" }, quality, qualityOut));
  const fillHint = h("p", { class: "hint" });

  const outName = h("input", { type: "text", maxLength: 120, spellcheck: false, "aria-label": "File name" });
  const extLabel = h("span", {}, ".jpg");
  const goLabel = h("span", {}, "Crop & download");
  const goBtn = button(h("span", {}, icon(ICONS.download), goLabel), () => void run(), "btn primary");

  const workspace = h(
    "div",
    { class: "ic-workspace", hidden: true },
    h("div", { class: "ic-main" }, frame, toolbar, straighten),
    h(
      "div",
      { class: "ir-controls" },
      field("Aspect ratio", h("div", { class: "ir-stack" }, aspectRow, customRow)),
      field("Crop area (pixels)", h("div", { class: "ir-stack" }, cropFields, sizeOut)),
      field("Format", formatSelect),
      qualityField,
      fillHint,
      h(
        "div",
        { class: "save-bar" },
        h("label", { class: "save-name" }, h("span", {}, "File name"), h("span", { class: "save-name-input" }, outName, extLabel)),
        goBtn,
      ),
    ),
  );

  // ----- State helpers -----
  const bounds = (): Size => (img ? canvasSize(img.bitmap, o) : { width: 1, height: 1 });

  function aspect(): number | undefined {
    const entry = ASPECTS.find(([k]) => k === aspectKey)![2];
    let a: number | undefined;
    if (entry === "original") a = img ? img.bitmap.width / img.bitmap.height : undefined;
    else if (entry === "custom") a = parseAspect(customIn.value);
    else a = entry;
    if (a && portrait) a = 1 / a;
    return a;
  }

  function defaultCrop(): Rect {
    if (!img) return crop;
    return inscribedRect(orientedSize(img.bitmap, o), o.angle, aspect());
  }

  /** Smallest crop side in image pixels: about 24 px on screen. */
  function minSide(): number {
    const shown = canvas.getBoundingClientRect().width || 1;
    return Math.max(1, Math.round((24 * bounds().width) / shown));
  }

  function say(text: string, kind: "info" | "error" | "ok" | "warn" = "info", extra?: Node) {
    status.replaceChildren(...(text ? [message(kind, text)] : []));
    if (extra) status.firstElementChild?.append(" ", extra);
  }

  // ----- Drawing -----
  function drawPreview() {
    if (!img) return;
    const b = bounds();
    const scale = Math.min(1, PREVIEW_SIDE / Math.max(b.width, b.height));
    canvas.width = Math.max(1, Math.round(b.width * scale));
    canvas.height = Math.max(1, Math.round(b.height * scale));
    const ctx = canvas.getContext("2d")!;
    if (format === "image/jpeg") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else ctx.clearRect(0, 0, canvas.width, canvas.height);
    // The preview bitmap is already downscaled; stretch it back to the source size in drawOriented's units.
    drawOriented(ctx, img.preview, img.bitmap, o, b, { x: 0, y: 0, ...b }, scale);
    drawBox();
  }

  function drawBox() {
    const b = bounds();
    box.style.left = `${(crop.x / b.width) * 100}%`;
    box.style.top = `${(crop.y / b.height) * 100}%`;
    box.style.width = `${(crop.width / b.width) * 100}%`;
    box.style.height = `${(crop.height / b.height) * 100}%`;
    for (const [input, v] of [
      [xIn, crop.x],
      [yIn, crop.y],
      [wIn, crop.width],
      [hIn, crop.height],
    ] as const) {
      if (document.activeElement !== input) input.value = String(v);
    }
    xIn.max = String(b.width - crop.width);
    yIn.max = String(b.height - crop.height);
    wIn.max = String(b.width);
    hIn.max = String(b.height);
    const a = aspect();
    sizeOut.textContent = `${crop.width.toLocaleString()} × ${crop.height.toLocaleString()} px${
      a && aspectKey === "passport" ? " · prints at 35 × 45 mm" : ""
    }`;
  }

  function setCrop(r: Rect) {
    crop = r;
    drawBox();
  }

  function updateFormat() {
    extLabel.textContent = `.${EXT[format]}`;
    qualityField.hidden = format === "image/png";
    fillHint.textContent =
      o.angle !== 0
        ? format === "image/jpeg"
          ? "Corners outside the tilted photo are filled white (JPEG has no transparency)."
          : "Corners outside the tilted photo stay transparent."
        : "";
    goBtn.disabled = busy || !img;
    goLabel.textContent = busy ? "Working…" : "Crop & download";
  }

  // ----- Actions -----
  function turn(dir: 1 | -1) {
    if (!img) return;
    o = rotate90(o, dir);
    crop = defaultCrop();
    drawPreview();
  }

  function mirror(axis: "horizontal" | "vertical") {
    if (!img) return;
    const b = bounds();
    o = flip(o, axis);
    angleIn.value = String(o.angle);
    angleOut.textContent = `${o.angle.toFixed(1).replace(/\.0$/, "")}°`;
    crop = clampRect(mirrorRect(crop, b, axis), bounds());
    drawPreview();
  }

  function setAngle(deg: number) {
    if (!img) return;
    o = { ...o, angle: Math.max(-45, Math.min(45, deg)) };
    angleIn.value = String(o.angle);
    angleOut.textContent = `${o.angle.toFixed(1).replace(/\.0$/, "")}°`;
    crop = defaultCrop();
    drawPreview();
    updateFormat();
  }

  function reset() {
    o = IDENTITY;
    angleIn.value = "0";
    angleOut.textContent = "0°";
    crop = defaultCrop();
    drawPreview();
    updateFormat();
  }

  function applyAspect() {
    aspectKey = aspectSelect.value;
    customRow.hidden = aspectKey !== "custom";
    swapBtn.disabled = aspectKey === "free" || aspectKey === "1:1";
    if (aspectKey === "custom" && !parseAspect(customIn.value)) {
      customIn.setAttribute("aria-invalid", "true");
      return;
    }
    customIn.removeAttribute("aria-invalid");
    crop = defaultCrop();
    drawBox();
  }
  aspectSelect.addEventListener("change", () => {
    // Each preset starts the way it's written: passport portrait, the others landscape.
    portrait = false;
    applyAspect();
  });
  customIn.addEventListener("input", applyAspect);
  angleIn.addEventListener("input", () => setAngle(Number(angleIn.value)));
  formatSelect.addEventListener("change", () => {
    format = formatSelect.value as Format;
    updateFormat();
    drawPreview();
  });
  quality.addEventListener("input", () => (qualityOut.textContent = `${quality.value}%`));

  // Number inputs
  wIn.addEventListener("change", () => {
    const a = aspect();
    setCrop(resizeAroundCenter(crop, Number(wIn.value) || 1, a ? Number(wIn.value) / a : crop.height, bounds(), a));
  });
  hIn.addEventListener("change", () => {
    const a = aspect();
    const hh = Number(hIn.value) || 1;
    setCrop(resizeAroundCenter(crop, a ? hh * a : crop.width, hh, bounds(), a));
  });
  xIn.addEventListener("change", () => setCrop(moveRect(crop, (Number(xIn.value) || 0) - crop.x, 0, bounds())));
  yIn.addEventListener("change", () => setCrop(moveRect(crop, 0, (Number(yIn.value) || 0) - crop.y, bounds())));
  for (const input of [xIn, yIn, wIn, hIn]) input.addEventListener("blur", drawBox);

  // ----- Dragging -----
  let drag: { id: number; handle: Handle | "move"; start: Rect; x: number; y: number; scale: number } | undefined;
  box.addEventListener("pointerdown", (e) => {
    if (!img || e.button !== 0) return;
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    const shown = canvas.getBoundingClientRect();
    drag = { id: e.pointerId, handle: handle ?? "move", start: crop, x: e.clientX, y: e.clientY, scale: bounds().width / shown.width };
    box.setPointerCapture(e.pointerId);
    box.classList.add("dragging");
    e.preventDefault();
    box.focus({ preventScroll: true });
  });
  box.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = (e.clientX - drag.x) * drag.scale;
    const dy = (e.clientY - drag.y) * drag.scale;
    setCrop(
      drag.handle === "move"
        ? moveRect(drag.start, dx, dy, bounds())
        : resizeRect(drag.start, drag.handle, dx, dy, bounds(), aspect(), minSide()),
    );
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = undefined;
    box.classList.remove("dragging");
  };
  box.addEventListener("pointerup", endDrag);
  box.addEventListener("pointercancel", endDrag);
  box.addEventListener("keydown", (e) => {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir || !img) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const [dx, dy] = [dir[0] * step, dir[1] * step];
    setCrop(e.altKey ? resizeRect(crop, "se", dx, dy, bounds(), aspect(), 1) : moveRect(crop, dx, dy, bounds()));
  });

  // ----- Loading and saving -----
  async function open(file: File) {
    if (busy) return;
    if (file.size > MAX_FILE) return say(`${file.name} is larger than ${formatBytes(MAX_FILE)}.`, "error");
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return say(
        isHeic(file.name, file.type)
          ? `${file.name} is a HEIC photo, which this browser can't open. On an iPhone, share it as JPEG (or set Settings › Camera › Formats to “Most Compatible”), then try again.`
          : `${file.name} couldn't be opened as an image. RAW photos and some unusual formats aren't supported by browsers — convert them to JPEG or PNG first.`,
        "error",
      );
    }
    const s = Math.min(1, PREVIEW_SIDE / Math.max(bitmap.width, bitmap.height));
    const preview =
      s < 1
        ? await createImageBitmap(bitmap, {
            resizeWidth: Math.max(1, Math.round(bitmap.width * s)),
            resizeHeight: Math.max(1, Math.round(bitmap.height * s)),
            resizeQuality: "high",
          })
        : bitmap;
    if (img) {
      if (img.preview !== img.bitmap) img.preview.close();
      img.bitmap.close();
    }
    img = { name: file.name, size: file.size, bitmap, preview, type: file.type };
    format = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
    formatSelect.value = format;
    outName.value = `${file.name.replace(/\.[^.]+$/, "")}-cropped`;
    say("");
    workspace.hidden = false;
    drop.classList.add("compact");
    reset();
  }

  async function run() {
    if (!img || busy) return;
    busy = true;
    updateFormat();
    say("Cropping…");
    await new Promise((resolve) => setTimeout(resolve));
    try {
      const out = document.createElement("canvas");
      out.width = crop.width;
      out.height = crop.height;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("This crop is too large for the browser to draw. Try a smaller area.");
      if (format === "image/jpeg") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, out.width, out.height);
      }
      drawOriented(ctx, img.bitmap, img.bitmap, o, bounds(), crop, 1);
      const blob = await toBlob(out, format, Number(quality.value) / 100);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      const name = `${safeFileName(outName.value.replace(/\.(jpe?g|png|webp)$/i, ""), "image")}.${EXT[format]}`;
      resultUrl = downloadBytes(blob, name, format);
      say(
        `${name}: ${crop.width} × ${crop.height} px, ${formatBytes(blob.size)}.`,
        "ok",
        h("a", { href: resultUrl, download: name }, "Download again"),
      );
    } catch (err) {
      say(err instanceof Error ? err.message : "Something went wrong while cropping.", "error");
    } finally {
      busy = false;
      updateFormat();
    }
  }

  wireDropzone(drop, picker, (files) => void open(files[0]));
  updateFormat();
  return h("section", {}, header(tool), drop, status, workspace);
}
