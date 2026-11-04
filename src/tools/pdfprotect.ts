import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", {}, header(tool), h("p", { class: "empty-hint" }, "Loading…"));
  // The PDF encryption library is large, so it's only downloaded when this tool is opened.
  import("../pdfprotect/pdfprotect")
    .then((m) => m.mountPdfProtect(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "PDF Protect couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "pdf-protect",
  name: "PDF Protect / Unlock",
  description: "Add a password to a PDF with AES-256 and choose what readers may do, or remove a password you know.",
  icon: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4M12 15v2",
  keywords: "pdf password protect encrypt lock unlock decrypt remove password secure aes permissions print copy",
  render,
};
