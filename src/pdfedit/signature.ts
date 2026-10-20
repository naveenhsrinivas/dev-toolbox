// A dialog for drawing a signature; resolves to a transparent PNG trimmed to the ink, or null.
import { button, h } from "../ui";

const COLORS: [string, string][] = [
  ["#111827", "Black"],
  ["#1d4ed8", "Blue"],
];

function trim(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = h("canvas", { width: x1 - x0 + 1, height: y1 - y0 + 1 });
  out.getContext("2d")!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export function openSignaturePad(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = Math.min(560, window.innerWidth - 64);
    const cssH = 200;
    const canvas = h("canvas", {
      class: "sig-canvas",
      width: Math.round(cssW * dpr),
      height: Math.round(cssH * dpr),
      "aria-label": "Draw your signature here",
    });
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = 2.6;
    let color = COLORS[0][0];
    let drawn = false;
    let last: { x: number; y: number } | null = null;

    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      last = pos(e);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      drawn = true;
      useBtn.disabled = false;
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!last) return;
      const p = pos(e);
      // Smooth the stroke through the midpoint between samples.
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    const stop = () => (last = null);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);

    const clear = () => {
      ctx.clearRect(0, 0, cssW, cssH);
      drawn = false;
      useBtn.disabled = true;
    };

    const finish = (result: Blob | null) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };

    const useBtn = button(
      "Add signature",
      () => {
        if (!drawn) return;
        const t = trim(canvas);
        if (!t) return finish(null);
        t.toBlob((b) => finish(b), "image/png");
      },
      "btn primary",
    );
    useBtn.disabled = true;

    const colorRow = h(
      "div",
      { class: "sig-colors" },
      ...COLORS.map(([c, name]) => {
        const b = button(
          name,
          () => {
            color = c;
            for (const x of colorRow.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
          },
          "chip",
        );
        b.setAttribute("aria-pressed", String(c === color));
        return b;
      }),
    );

    const dialog = h(
      "dialog",
      { class: "sig-dialog", "aria-label": "Draw signature" },
      h("h2", {}, "Draw your signature"),
      h("p", { class: "hint" }, "Use your mouse, trackpad or finger. It's added as an image you can move and resize."),
      canvas,
      h(
        "div",
        { class: "sig-actions" },
        colorRow,
        button("Clear", clear, "btn ghost"),
        button("Cancel", () => finish(null), "btn"),
        useBtn,
      ),
    );
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
