import { decodeUrl, encodeUrl, parseUrl } from "../lib/encoding";
import { button, checkbox, copyButton, debounce, h, header, kvTable, message, segmented, textarea, type Tool } from "../ui";

function render(): HTMLElement {
  let mode: "encode" | "decode" = "decode";
  let scope: "component" | "full" = "component";
  let plusAsSpace = true;

  const input = textarea({ rows: 6, placeholder: "Paste a URL or text…", class: "mono" });
  const output = textarea({ rows: 6, readOnly: true, class: "mono" });
  const status = h("div");
  const parsed = h("div");

  function run() {
    status.replaceChildren();
    if (!input.value) {
      output.value = "";
      parsed.replaceChildren();
      return;
    }
    if (mode === "encode") output.value = encodeUrl(input.value, scope);
    else {
      const r = decodeUrl(input.value, plusAsSpace);
      output.value = r.ok ? r.value : "";
      if (!r.ok) status.replaceChildren(message("error", r.error));
    }
    const url = parseUrl(input.value);
    parsed.replaceChildren(
      ...(url
        ? [
            h("h2", {}, "URL parts"),
            kvTable(url.parts),
            url.params.length ? h("h2", {}, `Query parameters (${url.params.length})`) : null,
            url.params.length ? kvTable(url.params) : null,
          ].filter((n): n is HTMLElement => !!n)
        : []),
    );
  }
  input.addEventListener("input", debounce(run, 120));

  const scopeRow = h(
    "div",
    { class: "options" },
    segmented(
      "What to encode",
      [
        ["component", "Encode everything (for a query value)"],
        ["full", "Keep URL structure (: / ? & #)"],
      ],
      scope,
      (v) => {
        scope = v;
        run();
      },
    ),
  );
  const plusRow = h(
    "div",
    { class: "options" },
    checkbox("Treat + as a space (form encoding)", plusAsSpace, (v) => {
      plusAsSpace = v;
      run();
    }),
  );
  const syncRows = () => {
    scopeRow.hidden = mode !== "encode";
    plusRow.hidden = mode !== "decode";
  };
  syncRows();

  return h(
    "section",
    {},
    header(
      tool,
      button(
        "Clear",
        () => {
          input.value = "";
          run();
        },
        "btn ghost",
      ),
    ),
    h(
      "div",
      { class: "options" },
      segmented(
        "Mode",
        [
          ["decode", "Decode"],
          ["encode", "Encode"],
        ],
        mode,
        (v) => {
          mode = v;
          syncRows();
          run();
        },
      ),
    ),
    scopeRow,
    plusRow,
    status,
    h(
      "div",
      { class: "two-col" },
      h("div", { class: "field" }, h("label", { htmlFor: (input.id = "url-in") }, "Input"), input),
      h(
        "div",
        { class: "field" },
        h(
          "div",
          { class: "label-row" },
          h("label", { htmlFor: (output.id = "url-out") }, "Result"),
          copyButton(() => output.value),
        ),
        output,
      ),
    ),
    parsed,
  );
}

export const tool: Tool = {
  id: "url",
  name: "URL Encode / Decode",
  description: "Percent-encode or decode text, and break a URL into its parts and query parameters.",
  icon: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  keywords: "url uri encode decode percent escape query string parameters parse",
  render,
};
