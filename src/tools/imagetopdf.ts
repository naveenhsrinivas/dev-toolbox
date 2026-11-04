import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", {}, header(tool), h("p", { class: "empty-hint" }, "Loading…"));
  // The PDF libraries are large, so they're only downloaded when this tool is opened.
  import("../pdftools/imagetopdf")
    .then((m) => m.mountImageToPdf(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "Image to PDF couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "image-to-pdf",
  name: "Image to PDF",
  description: "Turn JPEG, PNG, WebP, GIF or BMP images into one PDF, one image per page. Reorder, rotate, and pick the page size.",
  icon: "M4 5h11v9H4zM4 12l3-3 3 3 2-2 3 3M15 9h1l4 4v8H9v-4M16 9v4h4",
  keywords: "image picture photo jpg jpeg png webp gif bmp to pdf convert combine scan pages",
  render,
};
