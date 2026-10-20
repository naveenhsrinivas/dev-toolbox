import { parseTimeInput, relativeTime, timeFormats } from "../lib/time";
import { button, copyText, field, h, header, icon, ICONS, kvTable, message, type Tool } from "../ui";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function render(): HTMLElement {
  const nowSec = h("code", { class: "big" });
  const nowMs = h("code");
  const nowIso = h("code");
  function tick() {
    const now = Date.now();
    nowSec.textContent = String(Math.floor(now / 1000));
    nowMs.textContent = String(now);
    nowIso.textContent = new Date(now).toISOString();
  }

  const input = h("input", {
    type: "text",
    placeholder: "e.g. 1700000000, 1700000000000 or 2026-10-20T14:30:00Z",
    class: "mono",
    spellcheck: false,
  });
  const picker = h("input", { type: "datetime-local", step: 1 });
  const out = h("div");

  function show(text: string) {
    if (!text.trim()) return out.replaceChildren();
    const r = parseTimeInput(text);
    if (!r.ok) return out.replaceChildren(message("error", r.error));
    out.replaceChildren(message("info", `Read as: ${r.interpretedAs} · ${relativeTime(r.date)}`), kvTable(timeFormats(r.date)));
  }
  input.addEventListener("input", () => show(input.value));
  picker.addEventListener("input", () => {
    if (!picker.value) return;
    const d = new Date(picker.value);
    input.value = String(Math.floor(d.getTime() / 1000));
    show(input.value);
  });

  const section = h(
    "section",
    {},
    header(tool),
    h(
      "div",
      { class: "panel now" },
      h(
        "div",
        {},
        h("span", { class: "lbl" }, "Current Unix time"),
        nowSec,
        button(icon(ICONS.copy), () => copyText(nowSec.textContent!, "Timestamp"), "icon-btn", "Copy seconds"),
      ),
      h("div", { class: "now-sub" }, h("span", {}, "Milliseconds ", nowMs), h("span", {}, "UTC ", nowIso)),
    ),
    h("div", { class: "two-col narrow" }, field("Timestamp or date", input), field("…or pick a date and time (your time zone)", picker)),
    h(
      "div",
      { class: "options" },
      button(
        "Now",
        () => {
          input.value = String(Math.floor(Date.now() / 1000));
          picker.value = toLocalInput(new Date());
          show(input.value);
        },
        "btn small",
      ),
      button(
        "Start of today",
        () => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          input.value = String(d.getTime() / 1000);
          picker.value = toLocalInput(d);
          show(input.value);
        },
        "btn small",
      ),
    ),
    out,
  );
  tick();
  // The page is kept while other tools are open; only update it while it's shown.
  setInterval(() => section.isConnected && tick(), 1000);
  return section;
}

export const tool: Tool = {
  id: "timestamp",
  name: "Timestamp Converter",
  description: "Convert Unix timestamps to dates and back, in your time zone and UTC.",
  icon: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  keywords: "timestamp unix epoch time date convert iso 8601 utc milliseconds",
  render,
};
