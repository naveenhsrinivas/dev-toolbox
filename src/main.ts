import "./style.css";
import { tool as base64 } from "./tools/base64";
import { tool as dataConvert } from "./tools/dataconvert";
import { tool as color } from "./tools/color";
import { tool as cron } from "./tools/cron";
import { tool as diff } from "./tools/diff";
import { tool as hash } from "./tools/hash";
import { tool as json } from "./tools/json";
import { tool as jwt } from "./tools/jwt";
import { tool as markdown } from "./tools/markdown";
import { tool as imageConvert } from "./tools/imageconvert";
import { tool as imageCrop } from "./tools/imagecrop";
import { tool as imageResize } from "./tools/imageresize";
import { tool as imageToPdf } from "./tools/imagetopdf";
import { tool as numberBase } from "./tools/numberbase";
import { tool as password } from "./tools/password";
import { tool as pdfEditor } from "./tools/pdfeditor";
import { tool as qrcode } from "./tools/qrcode";
import { tool as pdfCompress } from "./tools/pdfsize";
import { tool as pdfMerge } from "./tools/pdfmerge";
import { tool as pdfProtect } from "./tools/pdfprotect";
import { tool as pdfSplit } from "./tools/pdfsplit";
import { tool as pdfToImages } from "./tools/pdftoimages";
import { tool as regex } from "./tools/regex";
import { tool as resume } from "./tools/resume";
import { tool as sqlFormat } from "./tools/sqlformat";
import { tool as text } from "./tools/text";
import { tool as time } from "./tools/time";
import { tool as url } from "./tools/url";
import { tool as uuid } from "./tools/uuid";
import { h, icon, type Tool } from "./ui";

// Tools by category, in the order they appear in the sidebar and on the home page.
const GROUPS: { name: string; tools: Tool[] }[] = [
  { name: "Text & data", tools: [diff, json, dataConvert, sqlFormat, markdown, regex, text] },
  { name: "Encoding & security", tools: [jwt, password, base64, url, hash] },
  { name: "Generators & converters", tools: [uuid, time, cron, qrcode, color, numberBase] },
  { name: "PDF", tools: [pdfEditor, pdfMerge, pdfSplit, pdfCompress, pdfProtect, imageToPdf, pdfToImages] },
  { name: "Images", tools: [imageResize, imageCrop, imageConvert] },
  { name: "Documents", tools: [resume] },
];
const TOOLS: Tool[] = GROUPS.flatMap((g) => g.tools);

const nav = document.getElementById("nav")!;
const main = document.getElementById("main")!;
const search = document.getElementById("search") as HTMLInputElement;
const sidebar = document.getElementById("sidebar")!;
const menuButton = document.getElementById("menu")!;
const themeButton = document.getElementById("theme")!;

// Each tool's page is built once and kept, so switching tools keeps what you typed.
const pages = new Map<string, HTMLElement>();

function matches(tool: Tool, q: string): boolean {
  const hay = `${tool.name} ${tool.keywords} ${tool.description}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

function renderNav() {
  const q = search.value.trim();
  const current = location.hash.slice(2);
  const link = (t: Tool) =>
    h(
      "a",
      { href: `#/${t.id}`, class: t.id === current ? "active" : "", "aria-current": t.id === current ? "page" : undefined },
      icon(t.icon),
      h("span", {}, t.name),
    );
  const groups = GROUPS.map((g) => ({ ...g, tools: g.tools.filter((t) => !q || matches(t, q)) })).filter((g) => g.tools.length);
  nav.replaceChildren(
    ...groups.map((g) => h("div", { class: "nav-group" }, h("h2", { class: "nav-heading" }, g.name), ...g.tools.map(link))),
    ...(groups.length ? [] : [h("p", { class: "nav-empty" }, "No tools match.")]),
  );
}

function home(): HTMLElement {
  return h(
    "section",
    { class: "home" },
    h("h1", {}, "Developer tools that stay on your device"),
    h(
      "p",
      { class: "lede" },
      "Format JSON, compare text, work with PDFs and images, generate passwords and more. Everything runs in your browser — nothing you paste is uploaded.",
    ),
    ...GROUPS.map((g) =>
      h(
        "div",
        { class: "card-group" },
        h("h2", {}, g.name),
        h(
          "div",
          { class: "cards" },
          ...g.tools.map((t) =>
            h(
              "a",
              { href: `#/${t.id}`, class: "tool-card" },
              h("span", { class: "card-icon" }, icon(t.icon)),
              h("strong", {}, t.name),
              h("span", {}, t.description),
            ),
          ),
        ),
      ),
    ),
  );
}

function route() {
  const id = location.hash.replace(/^#\/?/, "");
  const tool = TOOLS.find((t) => t.id === id);
  let page = pages.get(tool?.id ?? "");
  if (!page) {
    page = tool ? tool.render() : home();
    if (tool) pages.set(tool.id, page);
  }
  main.replaceChildren(page);
  document.title = tool ? `${tool.name} · Dev Toolbox` : "Dev Toolbox";
  document.body.classList.remove("nav-open");
  menuButton.setAttribute("aria-expanded", "false");
  renderNav();
  window.scrollTo(0, 0);
  // Put the cursor in the tool's first input, except on touch screens where it pops up the keyboard.
  if (tool && matchMedia("(pointer: fine)").matches)
    page.querySelector<HTMLElement>("textarea:not([readonly]), input[type=text]")?.focus({ preventScroll: true });
}

search.addEventListener("input", renderNav);
search.addEventListener("keydown", (e) => {
  if (e.key === "Enter") nav.querySelector("a")?.click();
});
window.addEventListener("hashchange", route);
// "/" jumps to search, like many developer sites.
window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && !target.isContentEditable) {
    e.preventDefault();
    document.body.classList.add("nav-open");
    search.focus();
  }
});

menuButton.addEventListener("click", () => {
  const open = document.body.classList.toggle("nav-open");
  menuButton.setAttribute("aria-expanded", String(open));
  if (open) search.focus();
});
sidebar.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.body.classList.remove("nav-open");
    menuButton.focus();
  }
});
document.getElementById("scrim")!.addEventListener("click", () => document.body.classList.remove("nav-open"));

// Theme: follows the system unless the visitor picks one.
type Theme = "light" | "dark";
function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}
function applyTheme(theme: Theme | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const dark = theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  themeButton.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  themeButton.title = themeButton.getAttribute("aria-label")!;
}
themeButton.addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next: Theme = dark ? "light" : "dark";
  try {
    localStorage.setItem("theme", next);
  } catch {
    // Not saved; it still applies for this visit.
  }
  applyTheme(next);
});
applyTheme(storedTheme());

route();
