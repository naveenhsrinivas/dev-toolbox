import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", {}, header(tool), h("p", { class: "empty-hint" }, "Loading…"));
  // The Markdown and sanitizer libraries are only downloaded when this tool is opened.
  import("../textconv/markdown-ui")
    .then((m) => m.mountMarkdown(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "Markdown Preview couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "markdown",
  name: "Markdown Preview",
  description: "Write Markdown with a live preview, then copy or download it as HTML.",
  icon: "M3 6h18v12H3zM6 15V9l2.5 3L11 9v6M15 9v6m0 0-2-2m2 2 2-2",
  keywords: "markdown md preview render html gfm github readme table task list export",
  render,
};
