import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", {}, header(tool), h("p", { class: "empty-hint" }, "Loading…"));
  // The YAML and CSV libraries are only downloaded when this tool is opened.
  import("../textconv/dataconvert-ui")
    .then((m) => m.mountDataConvert(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "The converter couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "data-convert",
  name: "YAML / JSON / CSV Converter",
  description: "Convert between JSON, YAML and CSV, with nested objects flattened to columns and exact big numbers.",
  icon: "M4 7h12l-3-3M20 17H8l3 3M4 12h4m4 0h8",
  keywords: "yaml json csv tsv convert converter transform spreadsheet table flatten excel yml",
  render,
};
