import { renderBatch } from "../imagetools/batch";
import type { Tool } from "../ui";

export const tool: Tool = {
  id: "image-convert",
  name: "Image Converter",
  description: "Convert many images at once to JPEG, PNG or WebP, optionally shrinking them, and download them as a ZIP.",
  icon: "M3 5h10v10H3zM11 19h10V9M17 3l3 3-3 3M7 21l-3-3 3-3",
  keywords:
    "image photo picture convert converter batch bulk multiple jpeg jpg png webp gif bmp heic format change zip transparency background",
  render: () => renderBatch(tool),
};
