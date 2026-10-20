import { CASES, convertCase, textStats } from "../lib/text";
import { button, copyButton, debounce, field, h, header, textarea, type Tool } from "../ui";

const LINE_TOOLS: [label: string, fn: (lines: string[]) => string[]][] = [
  ["Sort A–Z", (l) => [...l].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))],
  ["Sort Z–A", (l) => [...l].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))],
  ["Remove duplicates", (l) => [...new Set(l)]],
  ["Remove empty lines", (l) => l.filter((x) => x.trim())],
  ["Trim spaces", (l) => l.map((x) => x.trim())],
  ["Reverse lines", (l) => [...l].reverse()],
];

function render(): HTMLElement {
  const input = textarea({ rows: 10, placeholder: "Type or paste text…" });
  const output = textarea({ rows: 10, readOnly: true, placeholder: "Pick a conversion above." });
  const stats = h("div", { class: "stats" });

  function updateStats() {
    const s = textStats(input.value);
    const minutes = s.readingMinutes < 1 ? (s.words ? "< 1 min" : "0 min") : `${Math.round(s.readingMinutes)} min`;
    const items: [string, string][] = [
      ["Characters", s.characters.toLocaleString()],
      ["Without spaces", s.charactersNoSpaces.toLocaleString()],
      ["Words", s.words.toLocaleString()],
      ["Lines", s.lines.toLocaleString()],
      ["Sentences", s.sentences.toLocaleString()],
      ["Bytes (UTF-8)", s.bytes.toLocaleString()],
      ["Reading time", minutes],
    ];
    stats.replaceChildren(...items.map(([k, v]) => h("div", { class: "stat-card" }, h("strong", {}, v), h("span", {}, k))));
  }
  input.addEventListener("input", debounce(updateStats, 80));

  const apply = (fn: (t: string) => string) => {
    output.value = fn(input.value);
  };

  updateStats();
  return h(
    "section",
    {},
    header(
      tool,
      button(
        "Clear",
        () => {
          input.value = output.value = "";
          updateStats();
        },
        "btn ghost",
      ),
    ),
    field("Text", input),
    stats,
    h("h2", {}, "Change case"),
    h("div", { class: "chips" }, ...CASES.map((c) => button(c.label, () => apply((t) => convertCase(t, c.id)), "chip"))),
    h("h2", {}, "Lines"),
    h(
      "div",
      { class: "chips" },
      ...LINE_TOOLS.map(([label, fn]) => button(label, () => apply((t) => fn(t.split(/\r?\n/)).join("\n")), "chip")),
    ),
    h(
      "div",
      { class: "field" },
      h(
        "div",
        { class: "label-row" },
        h("label", { htmlFor: (output.id = "text-out") }, "Result"),
        h(
          "span",
          { class: "row-actions" },
          copyButton(() => output.value),
          button(
            "Use as input",
            () => {
              if (!output.value) return;
              input.value = output.value;
              updateStats();
            },
            "btn small",
          ),
        ),
      ),
      output,
    ),
  );
}

export const tool: Tool = {
  id: "text",
  name: "Text Tools",
  description: "Count words and characters, change case (camelCase, snake_case…), and sort or clean up lines.",
  icon: "M4 7V5h16v2M12 5v14M9 19h6",
  keywords: "word count character counter case converter camel snake kebab upper lower title sort lines duplicates",
  render,
};
