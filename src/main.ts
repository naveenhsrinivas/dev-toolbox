import "./style.css";
import { tool as base64 } from "./tools/base64";
import { tool as diff } from "./tools/diff";
import { tool as hash } from "./tools/hash";
import { tool as json } from "./tools/json";
import { tool as jwt } from "./tools/jwt";
import { tool as password } from "./tools/password";
import { tool as pdfEditor } from "./tools/pdfeditor";
import { tool as pdfMerge } from "./tools/pdfmerge";
import { tool as regex } from "./tools/regex";
import { tool as resume } from "./tools/resume";
import { tool as text } from "./tools/text";
import { tool as time } from "./tools/time";
import { tool as url } from "./tools/url";
import { tool as uuid } from "./tools/uuid";
import { h, icon, type Tool } from "./ui";

const TOOLS: Tool[] = [diff, json, jwt, password, pdfEditor, pdfMerge, resume, base64, url, hash, uuid, time, regex, text];

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
  const shown = TOOLS.filter((t) => !q || matches(t, q));
  nav.replaceChildren(
    ...shown.map((t) =>
      h(
        "a",
        { href: `#/${t.id}`, class: t.id === current ? "active" : "", "aria-current": t.id === current ? "page" : undefined },
        icon(t.icon),
        h("span", {}, t.name),
      ),
    ),
    ...(shown.length ? [] : [h("p", { class: "nav-empty" }, "No tools match.")]),
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
      "Format JSON, compare text, decode JWTs, generate passwords and more. Everything runs in your browser — nothing you paste is uploaded.",
    ),
    h(
      "div",
      { class: "cards" },
      ...TOOLS.map((t) =>
        h(
          "a",
          { href: `#/${t.id}`, class: "tool-card" },
          h("span", { class: "card-icon" }, icon(t.icon)),
          h("strong", {}, t.name),
          h("span", {}, t.description),
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
