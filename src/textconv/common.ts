import { downloadBytes, h } from "../ui";

/** Select the character at a 1-based line and column and scroll it into view. */
export function selectLineColumn(input: HTMLTextAreaElement, line: number, column = 1) {
  const lines = input.value.split("\n");
  let pos = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  pos = Math.min(pos + column - 1, input.value.length);
  input.focus();
  input.setSelectionRange(pos, Math.min(pos + 1, input.value.length));
  const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 20;
  input.scrollTop = Math.max(0, (line - 3) * lineHeight);
}

export function downloadText(text: string, name: string, type: string) {
  const url = downloadBytes(new Blob([text], { type: `${type};charset=utf-8` }), name, type);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function select<T extends string>(options: [T, string][], value: T, onchange: (v: T) => void): HTMLSelectElement {
  const el = h("select", {}, ...options.map(([v, label]) => h("option", { value: v, selected: v === value }, label)));
  el.addEventListener("change", () => onchange(el.value as T));
  return el;
}

/** A label with its control on one line, for option rows. */
export function inlineField(label: string, control: HTMLElement): HTMLElement {
  return h("label", { class: "inline tc-inline" }, h("span", {}, label), control);
}

/** Read a text file picked by the user, without a byte order mark. */
export function pickTextFile(accept: string, onload: (text: string, name: string) => void): HTMLInputElement {
  const input = h("input", { type: "file", accept, hidden: true });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    onload((await file.text()).replace(/^﻿/, ""), file.name);
    input.value = "";
  });
  return input;
}
