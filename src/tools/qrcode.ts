import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", {}, header(tool), h("p", { class: "empty-hint" }, "Loading…"));
  // The QR encoder and decoder are only downloaded when this tool is opened.
  import("../qr/qr")
    .then((m) => m.mountQr(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "The QR code tool couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "qr-code",
  name: "QR Code",
  description: "Make QR codes for links, Wi-Fi, email, phone, SMS and contacts — or read one from an image or your camera.",
  icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2h-2z",
  keywords: "qr code qrcode generate create make scan read decode barcode wifi wi-fi vcard contact link url png svg camera",
  render,
};
