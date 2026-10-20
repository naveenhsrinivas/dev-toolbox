import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", { class: "wide" }, header(tool), h("p", { class: "empty-hint" }, "Loading the resume maker…"));
  import("../resume/editor")
    .then((m) => m.mountResume(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "The resume maker couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "resume",
  name: "Resume Maker",
  description: "Build a CV from 5 popular templates and download it as a PDF. Saved only in your browser.",
  icon: "M8 3h8l4 4v14H4V3h4zM9 13h6M9 17h6M10 8a2 2 0 1 0 4 0 2 2 0 0 0-4 0",
  keywords: "resume cv curriculum vitae builder maker template job application pdf ats",
  render,
};
