import "./textconv.css";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { button, copyButton, debounce, h, header, icon, ICONS, message, textarea, type Tool } from "../ui";
import { downloadText } from "./common";
import { fileNameFromTitle, markdownTitle, remoteImageCount, standaloneHtml } from "./mdexport";

const SAMPLE = `# Release notes

A **live preview** of _GitHub-flavoured_ Markdown, rendered on your device.

## What's new

- [x] Tables and task lists
- [x] Fenced code blocks
- [ ] Coffee ☕

| Feature | Status | Notes |
| --- | :---: | --- |
| Export HTML | ✅ | Standalone file with basic styles |
| Download .md | ✅ | Exactly what you typed |

> Tip: links open in a new tab, and any HTML is cleaned before it's shown.

\`\`\`ts
function greet(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`

Inline \`code\`, ~~strikethrough~~ and a [link](https://example.com).

---

1. First
2. Second
`;

const marked = new Marked({ gfm: true, breaks: false });
// A private instance, so these settings don't affect DOMPurify used elsewhere.
const purify = DOMPurify(window);
const PURIFY_OPTIONS = { FORBID_TAGS: ["style", "form"], FORBID_ATTR: ["style"] };

function toSafeHtml(md: string): string {
  return purify.sanitize(marked.parse(md, { async: false }), PURIFY_OPTIONS);
}

export function mountMarkdown(section: HTMLElement, tool: Tool) {
  const editor = textarea({ placeholder: "Write or paste Markdown here…", rows: 22, class: "mono md-editor" });
  const preview = h("div", { class: "md-preview", id: "md-preview", tabIndex: 0, "aria-label": "Preview" });
  const imageNote = h("div", { class: "status-line", "aria-live": "polite" });

  function render() {
    const md = editor.value;
    if (!md.trim()) {
      preview.replaceChildren(h("p", { class: "md-empty" }, "The preview appears here as you type."));
      imageNote.replaceChildren();
      return;
    }
    // Sanitize into a fragment and insert nodes directly, so unsanitized HTML never reaches innerHTML.
    const fragment = purify.sanitize(marked.parse(md, { async: false }), { ...PURIFY_OPTIONS, RETURN_DOM_FRAGMENT: true });
    for (const a of fragment.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (a.getAttribute("href")!.startsWith("#")) continue;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    preview.replaceChildren(fragment);
    const remote = remoteImageCount(md);
    imageNote.replaceChildren(
      ...(remote
        ? [
            message(
              "warn",
              `${remote === 1 ? "1 image links" : `${remote} images link`} to another website and won't show: this site can't load anything from the internet. Images embedded as data: URLs work, and remote images will work in the exported HTML.`,
            ),
          ]
        : []),
    );
  }
  const update = debounce(render, 120);
  editor.addEventListener("input", update);

  // In-page links (#section) would otherwise change the tool page in the address bar.
  preview.addEventListener("click", (e) => {
    const a = (e.target as Element).closest("a");
    if (a?.getAttribute("href")?.startsWith("#")) e.preventDefault();
  });

  const title = () => markdownTitle(editor.value);
  const html = () => (editor.value.trim() ? toSafeHtml(editor.value) : "");

  section.replaceChildren(
    header(
      tool,
      button(
        "Load sample",
        () => {
          editor.value = SAMPLE;
          render();
        },
        "btn ghost",
      ),
      button(
        "Clear",
        () => {
          editor.value = "";
          render();
          editor.focus();
        },
        "btn ghost",
      ),
    ),
    h(
      "div",
      { class: "options" },
      copyButton(html, "Copy HTML", "HTML"),
      button(
        h("span", {}, icon(ICONS.download), "Download .html"),
        () => editor.value.trim() && downloadText(standaloneHtml(title(), html()), `${fileNameFromTitle(title())}.html`, "text/html"),
        "btn small",
      ),
      button(
        h("span", {}, icon(ICONS.download), "Download .md"),
        () => editor.value && downloadText(editor.value, `${fileNameFromTitle(title())}.md`, "text/markdown"),
        "btn small",
      ),
    ),
    imageNote,
    h(
      "div",
      { class: "two-col md-cols" },
      h("div", { class: "field" }, h("div", { class: "label-row" }, h("label", { htmlFor: (editor.id = "md-in") }, "Markdown")), editor),
      h("div", { class: "field" }, h("div", { class: "label-row" }, h("span", { class: "label" }, "Preview")), preview),
    ),
    h(
      "p",
      { class: "footnote" },
      "Supports GitHub-flavoured Markdown: tables, task lists, strikethrough and autolinks. Scripts and unsafe HTML are removed. Images from other websites can't load here.",
    ),
  );
  render();
}
