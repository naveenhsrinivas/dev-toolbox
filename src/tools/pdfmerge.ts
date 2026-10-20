import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", {}, header(tool), h("p", { class: "empty-hint" }, "Loading…"));
  // The PDF libraries are large, so they're only downloaded when this tool is opened.
  import("../pdfmerge/merge")
    .then((m) => m.mountPdfMerge(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "PDF Merge couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "pdf-merge",
  name: "PDF Merge",
  description: "Combine PDF files into one, in any order, choosing which pages to keep from each.",
  icon: "M8 3h7l4 4v10H8zM15 3v4h4M5 7v14h11",
  keywords: "pdf merge combine join append concatenate pages",
  render,
};
