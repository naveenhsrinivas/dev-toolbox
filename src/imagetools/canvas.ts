// Small canvas helpers shared by the image tools.
import { type Format, LABEL } from "./convert";

export function toBlob(canvas: HTMLCanvasElement, type: Format, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => {
        if (!b) reject(new Error("This browser couldn't encode the image. It may be too large."));
        // Browsers that can't write a format quietly fall back to PNG.
        else if (b.type !== type) reject(new Error(`This browser can't save ${LABEL[type]} images. Pick another format.`));
        else resolve(b);
      },
      type,
      quality,
    ),
  );
}

/** Wire a dropzone label + hidden file input to a handler. */
export function wireDropzone(drop: HTMLElement, picker: HTMLInputElement, onFiles: (files: File[]) => void) {
  picker.addEventListener("change", () => {
    if (picker.files?.length) onFiles([...picker.files]);
    picker.value = "";
  });
  drop.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    drop.classList.remove("over");
    onFiles([...e.dataTransfer.files]);
  });
}
