import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", {}, header(tool), h("p", { class: "empty-hint" }, "Loading…"));
  // The PDF libraries are large, so they're only downloaded when this tool is opened.
  import("../pdfsize/pdfsize")
    .then((m) => m.mountPdfSize(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "PDF Compress couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "pdf-compress",
  name: "PDF Compress / Resize",
  description: "Make a PDF smaller by level or to a target size, or pad it up to an exact size for upload forms.",
  icon: "M8 3h7l4 4v14H5V3h3M15 3v4h4M12 10v7m0 0-3-3m3 3 3-3",
  keywords: "pdf compress reduce shrink smaller size kb mb optimize increase bigger pad enlarge upload",
  render,
};
