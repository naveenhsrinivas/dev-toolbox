import { formatJson, type FormatOptions } from "../lib/json";
import {
  button,
  checkbox,
  copyButton,
  debounce,
  field,
  h,
  header,
  icon,
  ICONS,
  message,
  plural,
  segmented,
  textarea,
  type Tool,
} from "../ui";

const SAMPLE = `{"name":"Dev Toolbox","version":"1.0.0","private":true,"tools":["diff","json","jwt"],"limits":{"maxBytes":10485760,"id":12345678901234567890},"author":{"name":"Ada","email":"ada@example.com"}}`;

function render(): HTMLElement {
  const options: FormatOptions = { indent: 2, sortKeys: false };
  let lastError: { line?: number; column?: number } | undefined;

  const input = textarea({ placeholder: "Paste JSON here…", rows: 16, class: "mono" });
  const output = textarea({ rows: 16, readOnly: true, class: "mono", placeholder: "Formatted JSON appears here." });
  const status = h("div", { class: "status-line" });

  function run() {
    lastError = undefined;
    if (!input.value.trim()) {
      output.value = "";
      status.replaceChildren();
      return;
    }
    const r = formatJson(input.value, options);
    if (r.ok) {
      output.value = r.output;
      status.replaceChildren(
        message(
          "ok",
          `Valid JSON · ${plural(r.stats.keys, "key")} · nested ${r.stats.depth} ${r.stats.depth === 1 ? "level" : "levels"} deep`,
        ),
      );
    } else {
      output.value = "";
      lastError = r;
      const where = r.line ? ` (line ${r.line}, column ${r.column})` : "";
      status.replaceChildren(message("error", `${r.error}${where}`), ...(r.line ? [button("Show me", goToError, "btn small")] : []));
    }
  }
  const update = debounce(run, 200);
  input.addEventListener("input", update);

  function goToError() {
    if (!lastError?.line) return;
    const lines = input.value.split("\n");
    let pos = 0;
    for (let i = 0; i < lastError.line - 1; i++) pos += lines[i].length + 1;
    pos += (lastError.column ?? 1) - 1;
    input.focus();
    input.setSelectionRange(pos, Math.min(pos + 1, input.value.length));
    // Scroll the error line into view.
    const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 20;
    input.scrollTop = Math.max(0, (lastError.line - 3) * lineHeight);
  }

  function download() {
    if (!output.value) return;
    const url = URL.createObjectURL(new Blob([output.value], { type: "application/json" }));
    h("a", { href: url, download: "formatted.json" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return h(
    "section",
    {},
    header(
      tool,
      button(
        "Load sample",
        () => {
          input.value = SAMPLE;
          run();
        },
        "btn ghost",
      ),
      button(
        "Clear",
        () => {
          input.value = "";
          run();
          input.focus();
        },
        "btn ghost",
      ),
    ),
    h(
      "div",
      { class: "options" },
      segmented(
        "Indentation",
        [
          ["2", "2 spaces"],
          ["4", "4 spaces"],
          ["tab", "Tabs"],
          ["0", "Minify"],
        ],
        "2",
        (v) => {
          options.indent = v === "tab" ? "tab" : Number(v);
          run();
        },
      ),
      checkbox("Sort keys A–Z", false, (v) => {
        options.sortKeys = v;
        run();
      }),
    ),
    status,
    h(
      "div",
      { class: "two-col" },
      field("Input", input),
      h(
        "div",
        { class: "field" },
        h(
          "div",
          { class: "label-row" },
          h("label", { htmlFor: (output.id = "json-out") }, "Output"),
          h(
            "span",
            { class: "row-actions" },
            copyButton(() => output.value),
            button(h("span", {}, icon(ICONS.download), "Download"), download, "btn small"),
          ),
        ),
        output,
      ),
    ),
    h("p", { class: "footnote" }, "Numbers are kept exactly as written, so large IDs like 12345678901234567890 aren't rounded."),
  );
}

export const tool: Tool = {
  id: "json",
  name: "JSON Formatter",
  description: "Format, validate and minify JSON, with exact error locations.",
  icon: "M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1",
  keywords: "json format pretty print beautify validate lint minify",
  render,
};
