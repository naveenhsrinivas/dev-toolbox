import "./textconv.css";
import { button, checkbox, copyButton, debounce, h, header, icon, ICONS, message, segmented, textarea, type Tool } from "../ui";
import { inlineField, downloadText, pickTextFile, select, selectLineColumn } from "./common";
import { convert, DEFAULT_OPTIONS, detectFormat, FORMAT_NAMES, type ConvertOptions, type Delimiter, type Format } from "./convert";

const SAMPLE = `[
  { "id": 1, "name": "Ada Lovelace", "email": "ada@example.com", "address": { "city": "London", "zip": "N1 9GU" }, "active": true },
  { "id": 2, "name": "Grace \\"Amazing\\" Hopper", "email": "grace@example.com", "address": { "city": "New York", "zip": "10001" }, "active": false },
  { "id": 12345678901234567890, "name": "Zoë, Ltd.", "email": "zoe@example.com", "address": { "city": "Zürich", "zip": "8001" }, "active": true }
]`;

const FILE_INFO: Record<Format, { ext: string; type: string }> = {
  json: { ext: "json", type: "application/json" },
  yaml: { ext: "yaml", type: "application/yaml" },
  csv: { ext: "csv", type: "text/csv" },
};

export function mountDataConvert(section: HTMLElement, tool: Tool) {
  const opts: ConvertOptions = { ...DEFAULT_OPTIONS, to: "yaml" };
  let lastError: { line?: number; column?: number } | undefined;
  let detected: Format = "json";

  const input = textarea({ placeholder: "Paste JSON, YAML or CSV here…", rows: 18, class: "mono" });
  const output = textarea({ rows: 18, readOnly: true, class: "mono", placeholder: "The converted data appears here." });
  const status = h("div", { class: "status-line", "aria-live": "polite" });

  const formats: [Format, string][] = [
    ["json", "JSON"],
    ["yaml", "YAML"],
    ["csv", "CSV"],
  ];
  const fromSelect = select<Format | "auto">([["auto", "Auto-detect"], ...formats], opts.from, (v) => {
    opts.from = v;
    run();
  });
  const toHolder = h("span", {});
  function renderTo() {
    toHolder.replaceChildren(
      segmented("Output format", formats, opts.to, (v) => {
        opts.to = v;
        run();
      }),
    );
  }
  renderTo();

  const jsonOptions = h(
    "div",
    { class: "options" },
    inlineField(
      "JSON indent",
      segmented(
        "JSON indent",
        [
          ["2", "2 spaces"],
          ["4", "4 spaces"],
          ["tab", "Tabs"],
          ["0", "Minify"],
        ],
        "2",
        (v) => {
          opts.indent = v === "tab" ? "tab" : (Number(v) as 0 | 2 | 4);
          run();
        },
      ),
    ),
  );
  const typesCheck = checkbox("Read numbers and true/false as values", opts.types, (v) => {
    opts.types = v;
    run();
  });
  const csvOptions = h(
    "div",
    { class: "options" },
    inlineField(
      "CSV separator",
      select<Delimiter>(
        [
          ["auto", "Auto (comma on export)"],
          [",", "Comma ,"],
          [";", "Semicolon ;"],
          ["\t", "Tab"],
        ],
        opts.delimiter,
        (v) => {
          opts.delimiter = v;
          run();
        },
      ),
    ),
    checkbox("First row is a header", opts.header, (v) => {
      opts.header = v;
      run();
    }),
    checkbox("Nested objects as dotted columns (a.b)", opts.flatten, (v) => {
      opts.flatten = v;
      run();
    }),
    typesCheck,
  );

  function run() {
    lastError = undefined;
    const r = convert(input.value, opts);
    detected = r.from ?? detected;
    const from = opts.from === "auto" ? detected : opts.from;
    jsonOptions.hidden = opts.to !== "json";
    csvOptions.hidden = from !== "csv" && opts.to !== "csv";
    typesCheck.hidden = from !== "csv";
    input.removeAttribute("aria-invalid");
    if (!input.value.trim()) {
      output.value = "";
      status.replaceChildren();
      return;
    }
    const source = opts.from === "auto" ? `Detected ${FORMAT_NAMES[detected]}` : FORMAT_NAMES[from];
    if (r.ok) {
      output.value = r.output;
      status.replaceChildren(message("ok", `${source} → ${FORMAT_NAMES[opts.to]}`), ...r.notes.map((n) => message("info", n)));
    } else {
      output.value = "";
      lastError = r;
      input.setAttribute("aria-invalid", "true");
      const where = r.line ? ` (line ${r.line}, column ${r.column})` : "";
      status.replaceChildren(
        message("error", `${source}: ${r.error}${where}`),
        ...(r.line
          ? [button("Show me", () => lastError?.line && selectLineColumn(input, lastError.line, lastError.column), "btn small")]
          : []),
      );
    }
  }
  const update = debounce(run, 250);
  input.addEventListener("input", update);

  function swap() {
    const from = opts.from === "auto" ? detected : opts.from;
    const to = opts.to;
    if (output.value) input.value = output.value;
    // Stay on auto-detect when it recognises the new input, so pasting something else later still works.
    opts.from = opts.from === "auto" && detectFormat(input.value) === to ? "auto" : to;
    opts.to = from === to ? (to === "json" ? "yaml" : "json") : from;
    fromSelect.value = opts.from;
    renderTo();
    run();
  }

  function download() {
    if (!output.value) return;
    const { ext, type } = FILE_INFO[opts.to];
    downloadText(output.value, `converted.${ext}`, type);
  }

  const fileInput = pickTextFile(".json,.yaml,.yml,.csv,.tsv,.txt,application/json,text/csv,text/yaml", (text) => {
    input.value = text;
    run();
  });

  section.replaceChildren(
    header(
      tool,
      button(h("span", {}, icon(ICONS.upload), "Open file"), () => fileInput.click(), "btn ghost"),
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
      fileInput,
    ),
    h(
      "div",
      { class: "options" },
      inlineField("From", fromSelect),
      button(icon(ICONS.swap), swap, "icon-btn tc-swap", "Swap input and output"),
      inlineField("To", toHolder),
    ),
    jsonOptions,
    csvOptions,
    status,
    h(
      "div",
      { class: "two-col" },
      h("div", { class: "field" }, h("div", { class: "label-row" }, h("label", { htmlFor: (input.id = "dc-in") }, "Input")), input),
      h(
        "div",
        { class: "field" },
        h(
          "div",
          { class: "label-row" },
          h("label", { htmlFor: (output.id = "dc-out") }, "Output"),
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
    h(
      "p",
      { class: "footnote" },
      "Big whole numbers like 12345678901234567890 are kept exactly. CSV cells such as 007 or 1.10 stay text so nothing is lost.",
    ),
  );
  run();
}
