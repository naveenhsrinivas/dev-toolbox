import jsQR from "jsqr";
import QRCode from "qrcode";
import {
  button,
  checkbox,
  copyButton,
  debounce,
  downloadBytes,
  field,
  h,
  header,
  icon,
  ICONS,
  kvTable,
  message,
  segmented,
  textarea,
  toast,
  type Tool,
} from "../ui";
import {
  colourWarning,
  type Contact,
  EMPTY_CONTACT,
  type Email,
  mailtoPayload,
  recognise,
  smsPayload,
  telPayload,
  vcardPayload,
  type Wifi,
  wifiPayload,
} from "./payload";
import "./qr.css";

type Mode = "create" | "read";
type Kind = "text" | "wifi" | "email" | "phone" | "sms" | "contact";
type Level = "L" | "M" | "Q" | "H";

function textInput(value: string, oninput: (v: string) => void, props: Record<string, unknown> = {}): HTMLInputElement {
  const el = h("input", { type: "text", value, spellcheck: false, autocomplete: "off", ...props });
  el.addEventListener("input", () => oninput(el.value));
  return el;
}

// ---------- Reading ----------

const MAX_DECODE_SIDE = 1600;

/** Draw `src` onto a white canvas (so transparent PNGs read as dark-on-light), optionally with a white border. */
function pixels(src: CanvasImageSource, w: number, hgt: number, maxSide: number, pad: number): ImageData {
  const scale = Math.min(1, maxSide / Math.max(w, hgt));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(hgt * scale));
  const p = Math.round(Math.max(sw, sh) * pad);
  const canvas = document.createElement("canvas");
  canvas.width = sw + 2 * p;
  canvas.height = sh + 2 * p;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, p, p, sw, sh);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Try a few scales and paddings; codes with no quiet zone or very large photos need them. */
function decodeImage(src: CanvasImageSource, w: number, hgt: number): string | undefined {
  for (const [maxSide, pad] of [
    [MAX_DECODE_SIDE, 0],
    [MAX_DECODE_SIDE, 0.1],
    [800, 0.05],
    [400, 0.05],
  ]) {
    const img = pixels(src, w, hgt, maxSide, pad);
    const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (found) return found.data;
  }
  return undefined;
}

/** Open an image for drawing. SVG files can't go through createImageBitmap, so they fall back to an <img>. */
async function openImage(file: Blob, url: string): Promise<{ source: CanvasImageSource; width: number; height: number } | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      return undefined;
    }
    // SVGs without a size report 0; draw them at a size the decoder handles well.
    const w = img.naturalWidth || 1000;
    const hgt = img.naturalHeight || 1000;
    const scale = Math.max(1, 1000 / Math.max(w, hgt));
    return { source: img, width: Math.round(w * scale), height: Math.round(hgt * scale) };
  }
}

/** segmented() gives each radio its own name, so the browser doesn't uncheck the previous choice; do it here. */
function exclusiveRadios(e: Event) {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.type !== "radio" || !t.checked) return;
  for (const r of t.closest(".segmented")?.querySelectorAll("input") ?? []) if (r !== t) r.checked = false;
}

export function mountQr(section: HTMLElement, tool: Tool) {
  let mode: Mode = "create";
  let kind: Kind = "text";
  let text = "https://example.com";
  const wifi: Wifi = { ssid: "", password: "", security: "WPA", hidden: false };
  const email: Email = { to: "", subject: "", body: "" };
  const phone = { number: "" };
  const sms = { number: "", message: "" };
  const contact: Contact = { ...EMPTY_CONTACT };
  let level: Level = "M";
  let size = 512;
  let margin = 4;
  let fg = "#000000";
  let bg = "#ffffff";

  // ---------- Create ----------

  const form = h("div", { class: "qr-form" });
  const canvas = h("canvas", { class: "qr-canvas", "aria-label": "QR code preview", role: "img" });
  const stage = h("div", { class: "qr-stage", hidden: true }, canvas);
  const info = h("p", { class: "hint qr-info" });
  const status = h("div");
  const colourMsg = h("div");
  const payloadView = h("pre", { class: "qr-payload" });
  let payload = "";

  function payloadFor(): string {
    switch (kind) {
      case "text":
        return text;
      case "wifi":
        return wifi.ssid ? wifiPayload(wifi) : "";
      case "email":
        return email.to.trim() ? mailtoPayload(email) : "";
      case "phone":
        return phone.number.trim() ? telPayload(phone.number) : "";
      case "sms":
        return sms.number.trim() ? smsPayload(sms.number, sms.message) : "";
      case "contact":
        return [contact.firstName, contact.lastName, contact.org].some((s) => s.trim()) ? vcardPayload(contact) : "";
    }
  }

  const EMPTY_HINT: Record<Kind, string> = {
    text: "Type some text or a link to make a QR code.",
    wifi: "Enter the network name to make a Wi-Fi QR code.",
    email: "Enter an email address.",
    phone: "Enter a phone number.",
    sms: "Enter the phone number to text.",
    contact: "Enter a name or organisation.",
  };

  const options = () => ({
    errorCorrectionLevel: level,
    margin,
    width: size,
    color: { dark: fg, light: bg },
  });

  const draw = debounce(async () => {
    payload = payloadFor();
    payloadView.textContent = payload;
    const warn = colourWarning(fg, bg);
    colourMsg.replaceChildren(warn ? message("warn", warn) : "");
    if (!payload) {
      stage.hidden = true;
      info.textContent = "";
      status.replaceChildren(message("info", EMPTY_HINT[kind]));
      setDownloads(false);
      return;
    }
    try {
      const qr = QRCode.create(payload, { errorCorrectionLevel: level });
      await QRCode.toCanvas(canvas, payload, options());
      stage.hidden = false;
      const modules = qr.modules.size;
      info.textContent = `Version ${qr.version} · ${modules}×${modules} modules · ${canvas.width}×${canvas.height} px · ${[...payload].length} characters`;
      status.replaceChildren(
        size < (modules + 2 * margin) * 2
          ? message("warn", `At ${size} px each module is under 2 pixels wide. Make the image bigger so it prints and scans cleanly.`)
          : "",
      );
      setDownloads(true);
    } catch (e) {
      stage.hidden = true;
      info.textContent = "";
      const tooBig = /too big/i.test(String(e));
      status.replaceChildren(
        message(
          "error",
          tooBig
            ? `That's too much data for a QR code at error-correction level ${level}. Shorten it or choose a lower level (L holds the most).`
            : `Couldn't make the QR code: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
      setDownloads(false);
    }
  }, 60);

  function buildForm() {
    const redraw = () => draw();
    switch (kind) {
      case "text": {
        const ta = textarea({ rows: 4, value: text, placeholder: "https://example.com or any text" });
        ta.addEventListener("input", () => {
          text = ta.value;
          redraw();
        });
        form.replaceChildren(field("Text or link", ta));
        break;
      }
      case "wifi": {
        const pw = textInput(wifi.password, (v) => ((wifi.password = v), redraw()), { type: "password", autocomplete: "new-password" });
        const pwField = field("Password", pw);
        pwField.hidden = wifi.security === "nopass";
        form.replaceChildren(
          h(
            "div",
            { class: "qr-grid" },
            field(
              "Network name (SSID)",
              textInput(wifi.ssid, (v) => ((wifi.ssid = v), redraw())),
            ),
            pwField,
          ),
          h(
            "div",
            { class: "options" },
            h("span", { class: "lbl" }, "Security"),
            segmented<Wifi["security"]>(
              "Security",
              [
                ["WPA", "WPA/WPA2/WPA3"],
                ["WEP", "WEP"],
                ["nopass", "None"],
              ],
              wifi.security,
              (v) => {
                wifi.security = v;
                pwField.hidden = v === "nopass";
                redraw();
              },
            ),
            checkbox("Show password", false, (on) => (pw.type = on ? "text" : "password")),
            checkbox("Hidden network", wifi.hidden, (on) => ((wifi.hidden = on), redraw())),
          ),
        );
        break;
      }
      case "email": {
        const body = textarea({ rows: 3, value: email.body });
        body.addEventListener("input", () => ((email.body = body.value), redraw()));
        form.replaceChildren(
          h(
            "div",
            { class: "qr-grid" },
            field(
              "To",
              textInput(email.to, (v) => ((email.to = v), redraw()), { inputMode: "email", placeholder: "name@example.com" }),
              "Separate several addresses with commas.",
            ),
            field(
              "Subject",
              textInput(email.subject, (v) => ((email.subject = v), redraw())),
            ),
          ),
          field("Message", body),
        );
        break;
      }
      case "phone":
        form.replaceChildren(
          field(
            "Phone number",
            textInput(phone.number, (v) => ((phone.number = v), redraw()), { inputMode: "tel", placeholder: "+1 555 123 4567" }),
            "Include the country code so it works from anywhere.",
          ),
        );
        break;
      case "sms": {
        const msg = textarea({ rows: 3, value: sms.message });
        msg.addEventListener("input", () => ((sms.message = msg.value), redraw()));
        form.replaceChildren(
          field(
            "Phone number",
            textInput(sms.number, (v) => ((sms.number = v), redraw()), { inputMode: "tel", placeholder: "+1 555 123 4567" }),
          ),
          field("Message (optional)", msg),
        );
        break;
      }
      case "contact": {
        const f = (label: string, key: keyof Contact, props: Record<string, unknown> = {}) =>
          field(
            label,
            textInput(contact[key], (v) => ((contact[key] = v), redraw()), props),
          );
        const note = textarea({ rows: 2, value: contact.note });
        note.addEventListener("input", () => ((contact.note = note.value), redraw()));
        form.replaceChildren(
          h(
            "div",
            { class: "qr-grid" },
            f("First name", "firstName"),
            f("Last name", "lastName"),
            f("Organisation", "org"),
            f("Job title", "title"),
            f("Mobile phone", "phone", { inputMode: "tel" }),
            f("Work phone", "workPhone", { inputMode: "tel" }),
            f("Email", "email", { inputMode: "email" }),
            f("Website", "url", { inputMode: "url" }),
            f("Street", "street"),
            f("City", "city"),
            f("State / region", "region"),
            f("Postcode", "postcode"),
            f("Country", "country"),
          ),
          field("Note", note),
        );
        break;
      }
    }
    draw();
  }

  const levelSelect = h(
    "select",
    {},
    ...(
      [
        ["L", "Low (7% can be damaged)"],
        ["M", "Medium (15%)"],
        ["Q", "Quartile (25%)"],
        ["H", "High (30%)"],
      ] as [Level, string][]
    ).map(([v, label]) => h("option", { value: v, selected: v === level }, label)),
  );
  levelSelect.addEventListener("change", () => {
    level = levelSelect.value as Level;
    draw();
  });

  const sizeIn = h("input", { type: "number", min: 64, max: 4096, step: 16, value: size, class: "num-input" });
  sizeIn.addEventListener("input", () => {
    const n = Math.round(Number(sizeIn.value));
    if (n >= 64 && n <= 4096) {
      size = n;
      sizeIn.removeAttribute("aria-invalid");
      draw();
    } else sizeIn.setAttribute("aria-invalid", "true");
  });
  const marginIn = h("input", { type: "number", min: 0, max: 20, value: margin, class: "num-input" });
  marginIn.addEventListener("input", () => {
    const n = Math.round(Number(marginIn.value));
    if (marginIn.value !== "" && n >= 0 && n <= 20) {
      margin = n;
      marginIn.removeAttribute("aria-invalid");
      draw();
    } else marginIn.setAttribute("aria-invalid", "true");
  });
  const fgIn = h("input", { type: "color", value: fg, class: "qr-colour" });
  const bgIn = h("input", { type: "color", value: bg, class: "qr-colour" });
  fgIn.addEventListener("input", () => ((fg = fgIn.value), draw()));
  bgIn.addEventListener("input", () => ((bg = bgIn.value), draw()));
  const swap = button(
    icon(ICONS.swap),
    () => {
      [fg, bg] = [bg, fg];
      fgIn.value = fg;
      bgIn.value = bg;
      draw();
    },
    "icon-btn",
    "Swap colours",
  );
  const reset = button(
    "Black on white",
    () => {
      fg = fgIn.value = "#000000";
      bg = bgIn.value = "#ffffff";
      draw();
    },
    "btn small",
  );

  const pngBtn = button(h("span", {}, "PNG"), () => savePng(), "btn primary");
  pngBtn.prepend(icon(ICONS.download));
  const svgBtn = button(h("span", {}, "SVG"), () => saveSvg(), "btn");
  svgBtn.prepend(icon(ICONS.download));
  const copyImg = button(h("span", {}, "Copy image"), () => copyImage(), "btn");
  copyImg.prepend(icon(ICONS.copy));
  const copyPayload = copyButton(() => payload, "Copy text", "Encoded text");
  function setDownloads(on: boolean) {
    for (const b of [pngBtn, svgBtn, copyImg, copyPayload]) b.disabled = !on;
  }

  function pngBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), "image/png"));
  }
  async function savePng() {
    downloadBytes(await pngBlob(), "qr-code.png", "image/png");
  }
  async function saveSvg() {
    const svg = await QRCode.toString(payload, { ...options(), type: "svg" });
    downloadBytes(new Blob([svg], { type: "image/svg+xml" }), "qr-code.svg", "image/svg+xml");
  }
  async function copyImage() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob() })]);
      toast("Image copied to clipboard");
    } catch {
      toast("This browser couldn't copy the image — download it instead");
    }
  }

  const kindToggle = segmented<Kind>(
    "Content",
    [
      ["text", "Text / link"],
      ["wifi", "Wi-Fi"],
      ["email", "Email"],
      ["phone", "Phone"],
      ["sms", "SMS"],
      ["contact", "Contact"],
    ],
    kind,
    (k) => {
      kind = k;
      buildForm();
    },
  );

  const createPane = h(
    "div",
    { class: "qr-create" },
    h(
      "div",
      { class: "qr-inputs" },
      kindToggle,
      form,
      h(
        "div",
        { class: "qr-options" },
        field("Error correction", levelSelect, "Higher levels survive damage or a logo on top, but make denser codes."),
        h("div", { class: "qr-row" }, field("Size (px)", sizeIn), field("Margin (modules)", marginIn)),
        h(
          "div",
          { class: "qr-row qr-colours" },
          h("label", { class: "inline" }, fgIn, "Foreground"),
          h("label", { class: "inline" }, bgIn, "Background"),
          swap,
          reset,
        ),
      ),
      colourMsg,
    ),
    h(
      "div",
      { class: "qr-preview panel" },
      stage,
      info,
      status,
      h("div", { class: "row-actions" }, pngBtn, svgBtn, copyImg, copyPayload),
      h("details", { class: "qr-details" }, h("summary", {}, "Encoded text"), payloadView),
    ),
  );

  // ---------- Read ----------

  const picker = h("input", { type: "file", accept: "image/*", hidden: true });
  const drop = h(
    "label",
    { class: "dropzone" },
    picker,
    icon(ICONS.upload, "i big"),
    h("strong", {}, "Drop an image with a QR code"),
    h("span", {}, "Or choose a file, or paste a screenshot with Ctrl+V / ⌘V. It's read in your browser and never uploaded."),
  );
  const readOut = h("div", { class: "qr-read-out", "aria-live": "polite" });
  const thumb = h("img", { class: "qr-thumb", alt: "The image being read", hidden: true });
  let thumbUrl: string | undefined;

  function showResult(found: string | undefined, source: string) {
    if (found === undefined) {
      readOut.replaceChildren(
        message(
          "error",
          `No QR code found in ${source}. Try a sharper or closer image with the whole code visible, including a little space around it.`,
        ),
      );
      return;
    }
    const r = recognise(found);
    const out = textarea({ rows: Math.min(8, Math.max(2, found.split("\n").length)), readOnly: true, value: found, class: "mono" });
    const url = r.kind === "url" ? r.details[0][1] : undefined;
    readOut.replaceChildren(
      message("ok", `Found a QR code (${r.label}).`),
      h(
        "div",
        { class: "label-row" },
        h("label", { htmlFor: (out.id ||= "qr-decoded") }, "Decoded text"),
        copyButton(() => found, "Copy", "Text"),
      ),
      out,
      r.details.length ? kvTable(r.details) : "",
      url
        ? h(
            "p",
            { class: "hint" },
            h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "Open link"),
            " — check the address above before you open it.",
          )
        : "",
    );
  }

  async function readFile(file: File | Blob, source = "that image") {
    if (!file.type.startsWith("image/")) {
      readOut.replaceChildren(message("error", "That isn't an image. Use a PNG, JPEG, WebP, GIF or BMP."));
      return;
    }
    stopCamera();
    readOut.replaceChildren(message("info", "Reading…"));
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = URL.createObjectURL(file);
    thumb.src = thumbUrl;
    thumb.hidden = false;
    const image = await openImage(file, thumbUrl);
    if (!image) {
      readOut.replaceChildren(message("error", "Couldn't open that image. It may be damaged or in a format this browser can't read."));
      return;
    }
    // Let "Reading…" paint before the (synchronous) decode.
    await new Promise((r) => setTimeout(r, 0));
    const found = decodeImage(image.source, image.width, image.height);
    if (image.source instanceof ImageBitmap) image.source.close();
    showResult(found, source);
  }

  picker.addEventListener("change", () => {
    const f = picker.files?.[0];
    if (f) readFile(f);
    picker.value = "";
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files[0];
    if (f) readFile(f);
  });

  // Camera
  const video = h("video", { class: "qr-video", muted: true, playsInline: true, hidden: true });
  let stream: MediaStream | undefined;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  const camBtn = button("Scan with camera", () => (stream ? stopCamera() : startCamera()), "btn");
  camBtn.prepend(icon("M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"));
  const hasCamera = !!navigator.mediaDevices?.getUserMedia;

  function stopCamera() {
    clearTimeout(scanTimer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = undefined;
    video.srcObject = null;
    video.hidden = true;
    camBtn.lastChild!.textContent = "Scan with camera";
  }

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch (e) {
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      readOut.replaceChildren(
        message(
          "error",
          denied
            ? "Camera access was blocked. Allow it in your browser's site settings, or use an image instead."
            : "No camera is available.",
        ),
      );
      return;
    }
    video.srcObject = stream;
    video.hidden = false;
    camBtn.lastChild!.textContent = "Stop camera";
    readOut.replaceChildren(message("info", "Point the camera at a QR code…"));
    await video.play().catch(() => {});
    const scan = () => {
      if (!stream) return;
      if (!section.isConnected || mode !== "read") return stopCamera();
      if (video.videoWidth) {
        const img = pixels(video, video.videoWidth, video.videoHeight, 720, 0);
        const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
        if (found) {
          stopCamera();
          showResult(found.data, "the camera");
          return;
        }
      }
      scanTimer = setTimeout(scan, 200);
    };
    scan();
  }

  const readPane = h(
    "div",
    { class: "qr-read", hidden: true },
    drop,
    hasCamera ? h("div", { class: "options" }, camBtn, h("span", { class: "hint" }, "The video stays on this device.")) : null,
    video,
    h("div", { class: "qr-read-grid" }, readOut, thumb),
  );

  // Pasting an image anywhere on the page reads it.
  document.addEventListener("paste", (e) => {
    if (!section.isConnected) return;
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    setMode("read");
    readFile(file, "the pasted image");
  });

  // ---------- Mode ----------

  const modeToggle = segmented<Mode>(
    "Mode",
    [
      ["create", "Create"],
      ["read", "Read / scan"],
    ],
    mode,
    (m) => setMode(m),
  );
  function setMode(m: Mode) {
    mode = m;
    for (const r of modeToggle.querySelectorAll("input")) r.checked = r.value === m;
    createPane.hidden = m !== "create";
    readPane.hidden = m !== "read";
    if (m !== "read") stopCamera();
  }

  section.replaceChildren(header(tool, modeToggle), createPane, readPane);
  section.addEventListener("change", exclusiveRadios);
  buildForm();
}
