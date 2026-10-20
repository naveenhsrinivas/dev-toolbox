import type { RegexRequest, RegexResponse } from "../lib/regex";
import { button, checkbox, copyButton, debounce, field, h, header, message, plural, textarea, type Tool } from "../ui";

const TIMEOUT_MS = 1500;

const FLAGS: [flag: string, label: string][] = [
  ["g", "Global (all matches)"],
  ["i", "Ignore case"],
  ["m", "Multiline (^ $ per line)"],
  ["s", "Dot matches newline"],
  ["u", "Unicode"],
  ["y", "Sticky"],
];

const PRESETS: [string, string][] = [
  ["Email", "[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+"],
  ["URL", "https?:\\/\\/[^\\s/$.?#].[^\\s]*"],
  ["IPv4", "\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b"],
  ["Date (YYYY-MM-DD)", "(?<year>\\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\\d|3[01])"],
  ["Hex colour", "#(?:[0-9a-fA-F]{3}){1,2}\\b"],
];

const SAMPLE_TEXT = `Contact ada@example.com or grace.hopper@navy.mil
Server 192.168.1.20 went down on 2026-10-20 at 14:30.
Docs: https://developer.mozilla.org/docs/Web/JavaScript/Guide/Regular_expressions
Brand colours: #e2453c and #2f6fed.`;

/** Runs regexes in a worker that is replaced if a pattern takes too long. */
class RegexRunner {
  private worker?: Worker;
  private nextId = 0;

  run(request: RegexRequest): Promise<RegexResponse> {
    this.worker ??= new Worker(new URL("../regex.worker.ts", import.meta.url), { type: "module" });
    const worker = this.worker;
    const id = ++this.nextId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        worker.terminate();
        if (this.worker === worker) this.worker = undefined;
        resolve({
          ok: false,
          error: `Stopped after ${TIMEOUT_MS / 1000} s — the pattern is probably backtracking catastrophically (e.g. nested quantifiers like (a+)+).`,
        });
      }, TIMEOUT_MS);
      const onMessage = (e: MessageEvent<{ id: number; response: RegexResponse }>) => {
        if (e.data.id !== id) return;
        clearTimeout(timer);
        worker.removeEventListener("message", onMessage);
        resolve(e.data.response);
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ id, request });
    });
  }
}

function render(): HTMLElement {
  const runner = new RegexRunner();
  const flags = new Set(["g"]);
  let latest = 0;

  const pattern = h("input", {
    type: "text",
    placeholder: "Regular expression, e.g. \\d+",
    class: "mono",
    spellcheck: false,
    autocomplete: "off",
  });
  const text = textarea({ rows: 8, placeholder: "Text to search…" });
  const replace = h("input", {
    type: "text",
    placeholder: "Replacement, e.g. [$1] or $<name> (optional)",
    class: "mono",
    spellcheck: false,
  });
  const preview = h("pre", { class: "highlight" });
  const status = h("div");
  const matchList = h("div", { class: "matches" });
  const replaced = textarea({ rows: 6, readOnly: true });
  const replacedBox = h(
    "div",
    { class: "field", hidden: true },
    h(
      "div",
      { class: "label-row" },
      h("label", { htmlFor: (replaced.id = "re-out") }, "After replacing"),
      copyButton(() => replaced.value),
    ),
    replaced,
  );

  async function run() {
    const id = ++latest;
    if (!pattern.value) {
      status.replaceChildren();
      matchList.replaceChildren();
      preview.textContent = text.value;
      replacedBox.hidden = true;
      return;
    }
    const res = await runner.run({
      pattern: pattern.value,
      flags: [...flags].join(""),
      text: text.value,
      replacement: replace.value || undefined,
    });
    if (id !== latest) return;
    pattern.setAttribute("aria-invalid", String(!res.ok));
    if (!res.ok) {
      status.replaceChildren(message("error", res.error));
      matchList.replaceChildren();
      preview.textContent = text.value;
      replacedBox.hidden = true;
      return;
    }
    status.replaceChildren(
      message(
        res.matches.length ? "ok" : "info",
        res.matches.length
          ? `${plural(res.matches.length, "match", "matches")}${res.truncated ? " (showing the first 1,000)" : ""}`
          : "No matches",
      ),
    );

    // Highlighted preview of the text.
    const nodes: (Node | string)[] = [];
    let pos = 0;
    res.matches.forEach((m, n) => {
      if (m.index < pos) return;
      nodes.push(text.value.slice(pos, m.index));
      nodes.push(h("mark", { class: n % 2 ? "alt" : "", title: `Match ${n + 1}` }, m.text || "​"));
      pos = m.index + m.text.length;
    });
    nodes.push(text.value.slice(pos));
    preview.replaceChildren(...nodes);

    matchList.replaceChildren(
      ...res.matches
        .slice(0, 200)
        .map((m, n) =>
          h(
            "div",
            { class: "match" },
            h("span", { class: "idx" }, `#${n + 1}`),
            h("code", {}, m.text || "(empty)"),
            h("span", { class: "pos" }, `at ${m.index}`),
            ...m.groups.map((g, gi) => h("span", { class: "group" }, `$${gi + 1}: `, h("code", {}, g ?? "—"))),
            ...Object.entries(m.named ?? {}).map(([k, v]) => h("span", { class: "group" }, `${k}: `, h("code", {}, v ?? "—"))),
          ),
        ),
    );
    replacedBox.hidden = res.replaced === undefined;
    replaced.value = res.replaced ?? "";
  }
  const update = debounce(run, 150);
  for (const el of [pattern, text, replace]) el.addEventListener("input", update);

  const presets = h(
    "div",
    { class: "chips" },
    h("span", { class: "lbl" }, "Try:"),
    ...PRESETS.map(([name, p]) =>
      button(
        name,
        () => {
          pattern.value = p;
          if (!text.value) text.value = SAMPLE_TEXT;
          void run();
        },
        "chip",
      ),
    ),
  );

  void run();
  return h(
    "section",
    {},
    header(
      tool,
      button(
        "Load sample",
        () => {
          text.value = SAMPLE_TEXT;
          if (!pattern.value) pattern.value = PRESETS[0][1];
          void run();
        },
        "btn ghost",
      ),
    ),
    h("div", { class: "regex-input" }, h("span", { class: "slash" }, "/"), pattern, h("span", { class: "slash" }, "/")),
    presets,
    h(
      "div",
      { class: "options" },
      ...FLAGS.map(([f, label]) =>
        checkbox(`${f} · ${label}`, flags.has(f), (on) => {
          if (on) flags.add(f);
          else flags.delete(f);
          void run();
        }),
      ),
    ),
    status,
    h(
      "div",
      { class: "two-col" },
      field("Test text", text),
      h("div", { class: "field" }, h("span", { class: "label" }, "Matches highlighted"), preview),
    ),
    matchList,
    field("Replace with", replace),
    replacedBox,
  );
}

export const tool: Tool = {
  id: "regex",
  name: "Regex Tester",
  description: "Test JavaScript regular expressions live, with match highlighting, groups and replace.",
  icon: "M17 3v10M12.7 5.5l8.6 5M12.7 10.5l8.6-5M5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  keywords: "regex regexp regular expression test match replace pattern",
  render,
};
