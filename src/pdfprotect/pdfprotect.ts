// Shares the file card styles with PDF Merge.
import "../pdfmerge/merge.css";
import "./pdfprotect.css";
import {
  button,
  checkbox,
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
import { inspectPdf, type PdfInfo, type Permissions, protectPdf, ProtectError, unlockPdf } from "./core";

const MAX_FILE_BYTES = 300 * 1024 * 1024;

type Mode = "add" | "remove";

/** A password box with a show/hide toggle. */
function passwordInput(label: string, autocomplete: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const input = h("input", { type: "password", autocomplete, spellcheck: false, autocapitalize: "off", "aria-label": label });
  const eye = icon(ICONS.eye);
  const toggle = button(
    eye,
    () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.title = show ? "Hide password" : "Show password";
      toggle.setAttribute("aria-label", toggle.title);
      toggle.replaceChildren(icon(show ? ICONS.eyeOff : ICONS.eye));
    },
    "icon-btn",
    "Show password",
  );
  return { wrap: h("div", { class: "pp-pass" }, input, toggle), input };
}

export function mountPdfProtect(section: HTMLElement, tool: Pick<Tool, "name" | "description">) {
  let file: { name: string; bytes: Uint8Array; info: PdfInfo } | undefined;
  let mode: Mode = "add";
  let busy = false;
  let downloadUrl: string | undefined;
  const perms: Permissions = { printing: true, copying: true, editing: true };

  const picker = h("input", { type: "file", accept: "application/pdf,.pdf", hidden: true });
  const drop = h(
    "label",
    { class: "dropzone" },
    picker,
    icon(ICONS.upload, "i big"),
    h("strong", {}, "Drop a PDF here"),
    h("span", {}, "or click to choose. It's encrypted or unlocked in your browser and never uploaded."),
  );
  const fileInfo = h("div", { class: "pp-file" });
  const status = h("div", { role: "status" });

  // ----- Add password -----
  const user = passwordInput("Password to open", "new-password");
  const confirm = passwordInput("Repeat the password", "new-password");
  const owner = passwordInput("Owner password", "new-password");
  const addBox = h(
    "div",
    { class: "pp-options" },
    h("div", { class: "two-col" }, field("Password to open", user.wrap), field("Repeat it", confirm.wrap)),
    h(
      "fieldset",
      { class: "pp-perms" },
      h("legend", {}, "Allow people who open it to"),
      checkbox("Print", perms.printing, (v) => (perms.printing = v)),
      checkbox("Copy text and images", perms.copying, (v) => (perms.copying = v)),
      checkbox("Edit (change pages, fill forms, add comments)", perms.editing, (v) => (perms.editing = v)),
    ),
    field(
      "Owner password (optional)",
      owner.wrap,
      "Lets you change the permissions later. Leave it blank and a random one is used, so the restrictions can't be lifted.",
    ),
    h(
      "p",
      { class: "hint" },
      "Encrypted with AES-256. Permissions are a request that PDF viewers like Acrobat, Chrome and Preview honour; some other programs ignore them. Only the open password truly keeps people out — make it long.",
    ),
  );

  // ----- Remove password -----
  const current = passwordInput("Current password", "current-password");
  const removeHint = h("p", { class: "hint" }, "The password used to open it, or its owner password.");
  const removeBox = h("div", { class: "pp-options", hidden: true }, field("Current password", current.wrap), removeHint);

  const outName = h("input", { type: "text", maxLength: 120, spellcheck: false, "aria-label": "File name" });
  const goLabel = h("span", {}, "Protect PDF");
  const goBtn = button(h("span", {}, icon(ICONS.download), goLabel), () => void run(), "btn primary");

  const modeSwitch = segmented<Mode>(
    "Mode",
    [
      ["add", "Add password"],
      ["remove", "Remove password"],
    ],
    mode,
    (v) => setMode(v),
  );
  const workspace = h(
    "div",
    { class: "pp-workspace", hidden: true },
    fileInfo,
    modeSwitch,
    addBox,
    removeBox,
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
  // Enter in a password box saves.
  for (const input of [user.input, confirm.input, owner.input, current.input]) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void run();
      }
    });
  }

  section.replaceChildren(header(tool), drop, status, workspace);

  function say(text: string, kind: "info" | "error" | "ok" | "warn" = "info", extra?: Node) {
    status.replaceChildren(...(text ? [message(kind, text)] : []));
    if (extra) status.firstElementChild?.append(" ", extra);
  }

  function setMode(v: Mode) {
    mode = v;
    (modeSwitch.querySelector(`input[value="${v}"]`) as HTMLInputElement).checked = true;
    addBox.hidden = v !== "add";
    removeBox.hidden = v !== "remove";
    outName.value = outName.value.replace(/-(protected|unlocked)$/, v === "add" ? "-protected" : "-unlocked");
    say("");
    updateButton();
  }

  function updateButton() {
    goLabel.textContent = busy ? "Working…" : mode === "add" ? "Protect PDF" : "Remove password";
    goBtn.disabled = busy || !file;
  }

  async function open(f: File) {
    if (busy) return;
    if (!(f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))) return say(`${f.name} isn't a PDF.`, "error");
    if (f.size > MAX_FILE_BYTES) return say(`${f.name} is larger than ${formatBytes(MAX_FILE_BYTES)}.`, "error");
    let info: PdfInfo;
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      info = await inspectPdf(bytes);
    } catch (err) {
      return say(err instanceof ProtectError ? err.message : "This file couldn't be read as a PDF. It may be damaged.", "error");
    }
    file = { name: f.name, bytes, info };
    const base = f.name.replace(/\.pdf$/i, "").replace(/-(protected|unlocked)$/, "");
    outName.value = `${base}-${info.encrypted ? "unlocked" : "protected"}`;
    const lock = info.encrypted
      ? info.opensWithoutPassword
        ? "Opens without a password, but has owner restrictions"
        : "Password-protected"
      : `${plural(info.pages ?? 0, "page")} · not password-protected`;
    fileInfo.replaceChildren(
      h("span", { class: "pm-thumb" }, h("span", { class: "pm-thumb-empty" }, "PDF")),
      h(
        "div",
        { class: "pm-info" },
        h("span", { class: "pm-file", title: f.name }, f.name),
        h("span", { class: "pm-meta" }, `${lock} · ${formatBytes(f.size)}`),
      ),
    );
    removeHint.textContent = info.opensWithoutPassword
      ? "This PDF opens without a password, but its owner restricted what you can do. Enter the owner password to remove the restrictions."
      : "The password used to open it, or its owner password.";
    workspace.hidden = false;
    drop.classList.add("compact");
    for (const p of [user, confirm, owner, current]) p.input.value = "";
    setMode(info.encrypted ? "remove" : "add");
    if (info.encrypted && info.handler !== "Standard") {
      say(
        info.handler
          ? `This PDF is locked with a certificate or a custom security handler (${info.handler}), not a password. This tool can't unlock it.`
          : "This PDF uses a kind of encryption this tool can't handle.",
        "warn",
      );
    }
    (info.encrypted ? current : user).input.focus();
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

  function invalid(input: HTMLInputElement, text: string) {
    input.setAttribute("aria-invalid", "true");
    input.addEventListener("input", () => input.removeAttribute("aria-invalid"), { once: true });
    input.focus();
    say(text, "error");
  }

  async function run() {
    if (!file || busy) return;
    let out: Uint8Array;
    if (mode === "add") {
      if (file.info.encrypted)
        return say("This PDF is already password-protected. Remove the password first, then protect it again.", "error");
      if (!user.input.value) return invalid(user.input, "Enter a password to open the PDF with.");
      if (user.input.value !== confirm.input.value) return invalid(confirm.input, "The two passwords don't match.");
      if (owner.input.value && owner.input.value === user.input.value)
        return invalid(owner.input, "Use a different owner password, or leave it blank.");
    } else {
      if (!file.info.encrypted) return say("This PDF isn't password-protected, so there's nothing to remove.", "error");
      if (!current.input.value) return invalid(current.input, "Enter the PDF's current password.");
    }
    busy = true;
    section.classList.add("pp-busy");
    updateButton();
    say(mode === "add" ? "Encrypting…" : "Unlocking…");
    await new Promise((resolve) => setTimeout(resolve));
    try {
      out =
        mode === "add"
          ? await protectPdf(file.bytes, { userPassword: user.input.value, ownerPassword: owner.input.value, permissions: { ...perms } })
          : await unlockPdf(file.bytes, current.input.value);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      const name = `${safeFileName(outName.value.replace(/\.pdf$/i, ""), "document")}.pdf`;
      downloadUrl = downloadBytes(out, name, "application/pdf");
      const link = h("a", { href: downloadUrl, download: name }, "Download again");
      const restricted = Object.entries(perms)
        .filter(([, v]) => !v)
        .map(([k]) => ({ printing: "printing", copying: "copying", editing: "editing" })[k]);
      say(
        mode === "add"
          ? `${name} is protected (${formatBytes(out.length)}). It asks for the password when opened${
              restricted.length ? `; ${restricted.join(", ")} turned off` : ""
            }. Keep the password safe — it can't be recovered.`
          : `${name} no longer needs a password (${formatBytes(out.length)}).`,
        "ok",
        link,
      );
    } catch (err) {
      if (err instanceof ProtectError) {
        if (mode === "remove" && /isn.t right|needs a password|current password/.test(err.message)) invalid(current.input, err.message);
        else say(err.message, "error");
      } else say("Something went wrong while processing this PDF. It may be damaged or use features this tool can't handle.", "error");
    } finally {
      busy = false;
      section.classList.remove("pp-busy");
      updateButton();
    }
  }

  updateButton();
}
