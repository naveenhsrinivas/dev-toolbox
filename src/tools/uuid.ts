import { generateUuids, inspectUuid, type UuidVersion } from "../lib/uuid";
import { button, checkbox, copyButton, field, h, header, icon, ICONS, kvTable, message, segmented, textarea, type Tool } from "../ui";

function render(): HTMLElement {
  let version: UuidVersion = 4;
  let count = 5;
  let upper = false;
  let hyphens = true;

  const output = textarea({ rows: 10, readOnly: true, class: "mono" });
  const countInput = h("input", { type: "number", min: 1, max: 1000, value: count, class: "num-input" });

  function generate() {
    count = Math.min(1000, Math.max(1, Math.round(Number(countInput.value)) || 1));
    countInput.value = String(count);
    output.value = generateUuids(version, count)
      .map((u) => (hyphens ? u : u.replace(/-/g, "")))
      .map((u) => (upper ? u.toUpperCase() : u))
      .join("\n");
  }
  countInput.addEventListener("change", generate);

  const inspect = h("input", { type: "text", placeholder: "Paste a UUID to inspect it", class: "mono", spellcheck: false });
  const info = h("div");
  inspect.addEventListener("input", () => {
    if (!inspect.value.trim()) return info.replaceChildren();
    const r = inspectUuid(inspect.value);
    if (!r) return info.replaceChildren(message("error", "Not a UUID — it should be 32 hex digits, usually written 8-4-4-4-12."));
    const rows: [string, string][] = [
      ["Version", r.version === 0 && /^0+$/.test(inspect.value.replace(/[^0-9a-f]/gi, "")) ? "Nil UUID" : String(r.version)],
      ["Variant", r.variant],
    ];
    if (r.time) rows.push(["Created", `${r.time.toISOString()} (${r.time.toLocaleString()})`]);
    info.replaceChildren(kvTable(rows, false));
  });

  generate();
  return h(
    "section",
    {},
    header(tool, button(h("span", {}, icon(ICONS.refresh), "Generate"), generate, "btn primary")),
    h(
      "div",
      { class: "options" },
      segmented(
        "Version",
        [
          ["4", "v4 — random"],
          ["7", "v7 — time-ordered"],
        ],
        "4",
        (v) => {
          version = Number(v) as UuidVersion;
          generate();
        },
      ),
      h("label", { class: "inline" }, "How many", countInput),
      checkbox("Uppercase", upper, (v) => {
        upper = v;
        generate();
      }),
      checkbox("Hyphens", hyphens, (v) => {
        hyphens = v;
        generate();
      }),
    ),
    h(
      "div",
      { class: "field" },
      h(
        "div",
        { class: "label-row" },
        h("label", { htmlFor: (output.id = "uuid-out") }, "UUIDs"),
        copyButton(() => output.value, "Copy all"),
      ),
      output,
    ),
    h(
      "p",
      { class: "footnote" },
      "v7 UUIDs start with the creation time, so they sort in the order they were made — handy as database keys.",
    ),
    field("Inspect", inspect),
    info,
  );
}

export const tool: Tool = {
  id: "uuid",
  name: "UUID Generator",
  description: "Random v4 and time-ordered v7 UUIDs in bulk, plus a UUID inspector.",
  icon: "M4 6h4M4 12h7M4 18h4M13 6h7M15 12h5M13 18h7",
  keywords: "uuid guid generator random v4 v7 unique id",
  render,
};
