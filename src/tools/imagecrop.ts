import { renderCrop } from "../imagetools/crop";
import type { Tool } from "../ui";

export const tool: Tool = {
  id: "image-crop",
  name: "Image Crop & Rotate",
  description: "Crop to any size or a preset ratio like 1:1 or a 35×45 mm passport photo, rotate, flip and straighten.",
  icon: "M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2",
  keywords:
    "image photo picture crop cut trim rotate flip mirror straighten tilt angle aspect ratio square passport 35x45 instagram 16:9 jpeg png webp",
  render: () => renderCrop(tool),
};
