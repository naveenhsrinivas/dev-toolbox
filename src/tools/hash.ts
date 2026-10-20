import { type Algorithm, ALGORITHMS, hashBytes } from "../lib/hash";
import { button, checkbox, copyText, debounce, field, h, header, icon, ICONS, message, plural, textarea, type Tool } from "../ui";

const MAX_FILE = 200 * 1024 * 1024;

function render(): HTMLElement {
  let upper = false;
  let source: { kind: "text" } | { kind: "file"; name: string; bytes: Uint8Array } = { kind: "text" };
  let results: [Algorithm, string][] = [];
  let run = 0;

  const input = textarea({ rows: 6, placeholder: "Type or paste text to hash…" });
  const compare = h("input", { type: "text", placeholder: "Paste a hash to check it against these", class: "mono", spellcheck: false });
  const list = h("dl", { class: "kv hashes" });
  const status = h("div");

  function draw() {
    const target = compare.value.trim().toLowerCase();
    list.replaceChildren(
      ...results.flatMap(([alg, hex]) => {
        const value = upper ? hex.toUpperCase() : hex;
        const match = target && target === hex;
        return [
          h("dt", {}, alg, match ? h("span", { class: "badge valid" }, "Match") : null),
          h(
            "dd",
            { class: match ? "match" : "" },
            h("code", {}, value),
            button(icon(ICONS.copy), () => copyText(value, alg), "icon-btn", `Copy ${alg}`),
          ),
        ];
      }),
    );
    if (target && results.length && !results.some(([, hex]) => hex === target))
      status.replaceChildren(message("error", "No match — the hash you pasted is different from all of these."));
    else if (target && results.length) status.replaceChildren(message("ok", "Match found."));
    else if (source.kind === "file")
      status.replaceChildren(message("info", `Hashes of the file ${source.name} (${plural(source.bytes.length, "byte")}).`));
    else status.replaceChildren();
  }

  async function compute() {
    const id = ++run;
    const bytes = source.kind === "file" ? source.bytes : new TextEncoder().encode(input.value);
    if (source.kind === "text" && !input.value) {
      results = [];
      return draw();
    }
    const out = await Promise.all(ALGORITHMS.map(async (a) => [a, await hashBytes(a, bytes)] as [Algorithm, string]));
    if (id === run) {
      results = out;
      draw();
    }
  }
  input.addEventListener(
    "input",
    debounce(() => {
      source = { kind: "text" };
      void compute();
    }, 150),
  );
  compare.addEventListener("input", draw);

  const file = h("input", { type: "file", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    if (f.size > MAX_FILE) return status.replaceChildren(message("error", "Choose a file under 200 MB."));
    status.replaceChildren(message("info", `Reading ${f.name}…`));
    source = { kind: "file", name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
    input.value = "";
    await compute();
  });

  return h(
    "section",
    {},
    header(
      tool,
      button(h("span", {}, icon(ICONS.upload), "Hash a file"), () => file.click(), "btn"),
      file,
    ),
    field("Text", input),
    h(
      "div",
      { class: "options" },
      checkbox("Uppercase", upper, (v) => {
        upper = v;
        draw();
      }),
    ),
    list,
    field("Compare", compare),
    status,
    h(
      "p",
      { class: "footnote" },
      "MD5 and SHA-1 are fine for checksums but are broken for security. Don't use any of these on their own to store passwords.",
    ),
  );
}

export const tool: Tool = {
  id: "hash",
  name: "Hash Generator",
  description: "MD5, SHA-1, SHA-256, SHA-384 and SHA-512 of text or files, with a checksum compare.",
  icon: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
  keywords: "hash md5 sha sha1 sha256 sha512 checksum digest file integrity",
  render,
};
