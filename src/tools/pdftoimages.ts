import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", {}, header(tool), h("p", { class: "empty-hint" }, "Loading…"));
  // The PDF libraries are large, so they're only downloaded when this tool is opened.
  import("../pdftools/pdftoimages")
    .then((m) => m.mountPdfToImages(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "PDF to Images couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "pdf-to-images",
  name: "PDF to Images",
  description: "Save PDF pages as PNG or JPEG images at the resolution you choose. Download one page or all of them as a ZIP.",
  icon: "M8 3h7l4 4v6M15 3v4h4M8 3H5v18h6M13 15h8v6h-8zM13 19l2-2 2 2 1-1 3 3",
  keywords: "pdf to image png jpg jpeg picture export convert pages render dpi zip",
  render,
};
