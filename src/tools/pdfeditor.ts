import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", { class: "wide" }, header(tool), h("p", { class: "empty-hint" }, "Loading the PDF editor…"));
  // The editor and its PDF libraries are large, so they're only downloaded when this tool is opened.
  import("../pdfedit/editor")
    .then((m) => m.mountPdfEditor(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "The PDF editor couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "pdf-editor",
  name: "PDF Editor",
  description: "Add text, drawings, highlights, images and signatures to a PDF, and rotate, reorder or delete pages.",
  icon: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 17l1-3 5-5 2 2-5 5z",
  keywords: "pdf edit editor annotate sign signature fill text highlight whiteout redact rotate pages delete reorder",
  render,
};
