import { bytesToBase64, decodeBase64, encodeBase64 } from "../lib/encoding";
import { button, checkbox, copyButton, debounce, h, header, icon, ICONS, message, plural, segmented, textarea, type Tool } from "../ui";

const MAX_FILE = 10 * 1024 * 1024;

function render(): HTMLElement {
  let mode: "encode" | "decode" = "encode";
  let urlSafe = false;

  const input = textarea({ rows: 10, placeholder: "Text to encode…" });
  const output = textarea({ rows: 10, readOnly: true, class: "mono" });
  const status = h("div");
  const inputLabel = h("label", { htmlFor: (input.id = "b64-in") }, "Text");
  const outputLabel = h("label", { htmlFor: (output.id = "b64-out") }, "Base64");

  function run() {
    status.replaceChildren();
    inputLabel.textContent = mode === "encode" ? "Text" : "Base64";
    outputLabel.textContent = mode === "encode" ? "Base64" : "Text";
    input.placeholder = mode === "encode" ? "Text to encode…" : "Base64 to decode (standard or URL-safe)…";
    input.classList.toggle("mono", mode === "decode");
    output.classList.toggle("mono", mode === "encode");
    if (!input.value) return void (output.value = "");
    if (mode === "encode") {
      output.value = encodeBase64(input.value, urlSafe);
      return;
    }
    const r = decodeBase64(input.value);
    output.value = r.ok ? r.value : "";
    if (!r.ok) status.replaceChildren(message("error", r.error));
  }
  input.addEventListener("input", debounce(run, 100));

  const file = h("input", { type: "file", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    if (f.size > MAX_FILE) return status.replaceChildren(message("error", "Choose a file under 10 MB."));
    const b64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()), urlSafe);
    mode = "encode";
    modeControl.querySelector<HTMLInputElement>('input[value="encode"]')!.checked = true;
    input.value = "";
    run();
    output.value = `data:${f.type || "application/octet-stream"};base64,${b64}`;
    status.replaceChildren(message("ok", `Encoded ${f.name} (${plural(f.size, "byte")}) as a data URL.`));
  });

  const modeControl = segmented(
    "Mode",
    [
      ["encode", "Encode"],
      ["decode", "Decode"],
    ],
    mode,
    (v) => {
      mode = v;
      // Switching direction: carry the result over, so encode → decode round-trips.
      if (output.value && !output.value.startsWith("data:")) input.value = output.value;
      run();
    },
  );

  run();
  return h(
    "section",
    {},
    header(
      tool,
      button(h("span", {}, icon(ICONS.upload), "Encode a file"), () => file.click(), "btn"),
      button(
        "Clear",
        () => {
          input.value = "";
          run();
        },
        "btn ghost",
      ),
      file,
    ),
    h(
      "div",
      { class: "options" },
      modeControl,
      checkbox("URL-safe (- and _, no padding)", urlSafe, (v) => {
        urlSafe = v;
        run();
      }),
    ),
    status,
    h(
      "div",
      { class: "two-col" },
      h("div", { class: "field" }, inputLabel, input),
      h(
        "div",
        { class: "field" },
        h(
          "div",
          { class: "label-row" },
          outputLabel,
          copyButton(() => output.value),
        ),
        output,
      ),
    ),
  );
}

export const tool: Tool = {
  id: "base64",
  name: "Base64",
  description: "Encode and decode Base64 text (full Unicode), or turn a file into a data URL.",
  icon: "M6 4h2v6M6 10h4M16 4a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0V6a2 2 0 0 1 2-2zM8 14a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0v-2a2 2 0 0 1 2-2zM16 14v6M14 20h4",
  keywords: "base64 encode decode atob btoa data url binary",
  render,
};
