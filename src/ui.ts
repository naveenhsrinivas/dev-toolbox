// Small DOM helpers shared by the tools.

export interface Tool {
  id: string;
  name: string;
  description: string;
  /** SVG path data for a 24×24 stroked icon. */
  icon: string;
  keywords: string;
  render(): HTMLElement;
}

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; dataset?: Record<string, string> };

/** Create an element: h("button", { class: "btn", onclick }, "Copy"). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value as EventListener);
    else if (key in el && key !== "list" && key !== "form") (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return el;
}

export function icon(path: string, cls = "i"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", cls);
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

export const ICONS = {
  copy: "M8 8h11v11H8zM5 16H4V5h11v1",
  check: "m5 12 5 5L20 7",
  x: "M18 6 6 18M6 6l12 12",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  swap: "M7 7h13l-4-4M17 17H4l4 4",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  download: "M12 4v12m0 0-4-4m4 4 4-4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff:
    "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string) {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", class: "toast", role: "status" });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

export async function copyText(text: string, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(what === "Copied" ? "Copied to clipboard" : `${what} copied`);
  } catch {
    toast("Couldn't copy — select the text and copy it manually");
  }
}

/** A "Copy" button that copies whatever `get` returns at click time. */
export function copyButton(get: () => string, label = "Copy", what?: string): HTMLButtonElement {
  return h("button", { type: "button", class: "btn small", onclick: () => get() && copyText(get(), what) }, icon(ICONS.copy), label);
}

export function button(label: string | Node, onclick: () => void, cls = "btn", title?: string): HTMLButtonElement {
  // The title names icon-only buttons; buttons with visible text keep that text as their name.
  const hasText = (typeof label === "string" ? label : (label.textContent ?? "")).trim() !== "";
  return h("button", { type: "button", class: cls, onclick, title, "aria-label": hasText ? undefined : title }, label);
}

let fieldId = 0;
/** A labelled control. Returns the wrapper; the control gets a generated id. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  control.id ||= `f${++fieldId}`;
  return h("div", { class: "field" }, h("label", { htmlFor: control.id }, label), control, hint ? h("p", { class: "hint" }, hint) : null);
}

export function textarea(props: Props = {}): HTMLTextAreaElement {
  return h("textarea", { spellcheck: false, autocapitalize: "off", autocomplete: "off", ...props });
}

export function checkbox(label: string, checked: boolean, onchange: (checked: boolean) => void): HTMLLabelElement {
  const input = h("input", { type: "checkbox", checked });
  input.addEventListener("change", () => onchange(input.checked));
  return h("label", { class: "check" }, input, label);
}

/** A row of mutually exclusive options. */
export function segmented<T extends string>(name: string, options: [T, string][], value: T, onchange: (v: T) => void): HTMLElement {
  return h(
    "div",
    { class: "segmented", role: "radiogroup", "aria-label": name },
    ...options.map(([v, label]) => {
      const input = h("input", { type: "radio", name: `${name}-${fieldId++}`, value: v, checked: v === value });
      input.addEventListener("change", () => input.checked && onchange(v));
      return h("label", {}, input, h("span", {}, label));
    }),
  );
}

export function message(kind: "error" | "ok" | "info" | "warn", text: string): HTMLElement {
  return h("p", { class: `msg ${kind}`, role: kind === "error" ? "alert" : undefined }, text);
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms = 150): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Tool page header. */
export function header(tool: Pick<Tool, "name" | "description">, ...actions: Child[]): HTMLElement {
  return h(
    "header",
    { class: "tool-head" },
    h("div", {}, h("h1", {}, tool.name), h("p", {}, tool.description)),
    h("div", { class: "head-actions" }, ...actions),
  );
}

/** A key/value table with a copy button per row. */
export function kvTable(rows: [string, string][], copyable = true): HTMLElement {
  return h(
    "dl",
    { class: "kv" },
    ...rows.flatMap(([k, v]) => [
      h("dt", {}, k),
      h("dd", {}, h("code", {}, v), copyable ? button(icon(ICONS.copy), () => copyText(v, k), "icon-btn", `Copy ${k}`) : null),
    ]),
  );
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}
