import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", {}, header(tool), h("p", { class: "empty-hint" }, "Loading…"));
  // The PDF libraries are large, so they're only downloaded when this tool is opened.
  import("../pdftools/pdfsplit")
    .then((m) => m.mountPdfSplit(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "PDF Split couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "pdf-split",
  name: "PDF Split",
  description: "Split a PDF by page ranges, every N pages, or one file per page, or extract the pages you need.",
  icon: "M8 3h7l4 4v14H5V3h3M15 3v4h4M5 13h3m3 0h2m3 0h3",
  keywords: "pdf split separate divide extract pages ranges burst chunk",
  render,
};
