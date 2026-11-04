import "../cron/cron.css";
import { type CronSchedule, describeField, nextRuns, neverRunsReason, parseCron, usesDayOr, type Zone } from "../lib/cron";
import { relativeTime } from "../lib/time";
import { copyButton, debounce, field, h, header, message, segmented, type Tool } from "../ui";

const PRESETS: [label: string, expr: string][] = [
  ["Every minute", "* * * * *"],
  ["Every 5 minutes", "*/5 * * * *"],
  ["Every 15 minutes", "*/15 * * * *"],
  ["Every 30 seconds (6 fields)", "*/30 * * * * *"],
  ["Every hour", "0 * * * *"],
  ["Every 2 hours", "0 */2 * * *"],
  ["Every day at midnight", "0 0 * * *"],
  ["Every day at 6:30", "30 6 * * *"],
  ["Weekdays at 9:00", "0 9 * * 1-5"],
  ["Weekends at 10:00", "0 10 * * 6,0"],
  ["Every Monday at 8:00", "0 8 * * MON"],
  ["First of the month at midnight", "0 0 1 * *"],
  ["Last day of the month at 23:00", "0 23 L * *"],
  ["Every quarter (1 Jan, Apr, Jul, Oct)", "0 0 1 */3 *"],
  ["Once a year (1 January)", "0 0 1 1 *"],
];

type Describe = (
  expr: string,
  options: { use24HourTimeFormat: boolean; trimHoursLeadingZero: boolean; throwExceptionOnParseError: boolean },
) => string;
let describe: Describe | undefined;

const uses24h = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle?.startsWith("h2") ?? true;

function render(): HTMLElement {
  let zone: Zone = "local";
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "your time zone";

  const input = h("input", {
    type: "text",
    class: "mono cron-input",
    value: "*/15 9-17 * * 1-5",
    placeholder: "e.g. */5 * * * *",
    spellcheck: false,
    autocapitalize: "off",
    autocomplete: "off",
    "aria-describedby": "cron-help",
  });
  const presets = h(
    "select",
    { "aria-label": "Common schedules" },
    h("option", { value: "" }, "Pick a common schedule…"),
    ...PRESETS.map(([label, expr]) => h("option", { value: expr }, `${label}  —  ${expr}`)),
  );
  presets.addEventListener("change", () => {
    if (!presets.value) return;
    input.value = presets.value;
    presets.value = "";
    update();
    input.focus();
  });

  const summary = h("div", { class: "cron-summary", "aria-live": "polite" });
  const breakdown = h("div");
  const runs = h("div");

  function fieldGrid(rows: { label: string; raw: string; meaning: string; error?: string }[]): HTMLElement {
    return h(
      "div",
      { class: "cron-fields", role: "table", "aria-label": "Fields" },
      ...rows.map((r) =>
        h(
          "div",
          { class: r.error ? "cron-field bad" : "cron-field", role: "row" },
          h("span", { class: "cron-field-label", role: "rowheader" }, r.label),
          h("code", { role: "cell" }, r.raw),
          h("span", { class: "cron-field-meaning", role: "cell" }, r.error ?? r.meaning),
        ),
      ),
    );
  }

  function formatRun(d: Date): string {
    return d.toLocaleString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: zone === "utc" ? "UTC" : undefined,
      timeZoneName: "short",
    });
  }

  function showRuns(cron: CronSchedule) {
    const now = new Date();
    const list = nextRuns(cron, now, 10, zone);
    const title = h(
      "h2",
      { class: "cron-h" },
      `Next ${list.length === 10 ? 10 : list.length} runs`,
      h("span", { class: "hint" }, zone === "utc" ? " (UTC)" : ` (${localZone})`),
    );
    if (!list.length) {
      runs.replaceChildren(
        message("warn", neverRunsReason(cron) ?? "This schedule doesn't run in the next 60 years. Check the day and month fields."),
      );
      return;
    }
    const iso = list.map((d) => (zone === "utc" ? d.toISOString() : d.toString())).join("\n");
    runs.replaceChildren(
      h(
        "div",
        { class: "label-row" },
        title,
        copyButton(() => iso, "Copy list", "Run times"),
      ),
      h(
        "ol",
        { class: "cron-runs" },
        ...list.map((d) =>
          h("li", {}, h("span", { class: "mono" }, formatRun(d)), h("span", { class: "hint" }, relativeTime(d, now.getTime()))),
        ),
      ),
      list.length < 10 ? h("p", { class: "hint" }, "No more runs found in the next 60 years.") : "",
    );
  }

  function update() {
    const r = parseCron(input.value);
    input.setAttribute("aria-invalid", String(!r.ok && !!input.value.trim()));
    if (!r.ok) {
      summary.replaceChildren(message("error", r.error));
      breakdown.replaceChildren(
        r.fields.length
          ? fieldGrid(r.fields.map((f) => ({ label: f.label, raw: f.raw, meaning: f.error ? "" : "OK", error: f.error })))
          : "",
      );
      runs.replaceChildren();
      return;
    }
    const cron = r.cron;
    if (cron.kind === "reboot") {
      summary.replaceChildren(h("p", { class: "cron-text" }, "Once, when the cron daemon starts (usually at boot)."));
      breakdown.replaceChildren();
      runs.replaceChildren(message("info", "@reboot has no clock schedule, so there are no upcoming run times to show."));
      return;
    }
    let text = "";
    if (describe) {
      try {
        text = describe(cron.expression, {
          use24HourTimeFormat: uses24h,
          trimHoursLeadingZero: !uses24h,
          throwExceptionOnParseError: true,
        });
      } catch {
        text = "";
      }
    }
    summary.replaceChildren(
      h("p", { class: "cron-text" }, text || (describe ? "Valid expression — see the breakdown below." : "…")),
      cron.expression !== cron.source ? h("p", { class: "hint" }, `${cron.source} is short for `, h("code", {}, cron.expression)) : "",
      usesDayOr(cron)
        ? message(
            "info",
            "Both day of month and day of week are set, so cron runs on days that match either one (not only days that match both).",
          )
        : "",
    );
    breakdown.replaceChildren(fieldGrid(cron.fields.map((f) => ({ label: f.label, raw: f.raw, meaning: describeField(f) }))));
    showRuns(cron);
  }

  input.addEventListener("input", debounce(update, 80));

  const zoneToggle = segmented<Zone>(
    "Time zone",
    [
      ["local", `Local (${localZone})`],
      ["utc", "UTC"],
    ],
    zone,
    (z) => {
      zone = z;
      update();
    },
  );

  const section = h(
    "section",
    {},
    header(tool),
    h("div", { class: "two-col cron-top" }, field("Cron expression", input), field("Presets", presets)),
    h(
      "p",
      { class: "hint", id: "cron-help" },
      "minute hour day-of-month month day-of-week — or 6 fields with seconds first, or @hourly, @daily, @weekly, @monthly, @yearly, @reboot.",
    ),
    h("div", { class: "options" }, h("span", { class: "lbl" }, "Show times in"), zoneToggle),
    h("div", { class: "panel" }, summary, breakdown),
    runs,
  );

  // segmented() gives each radio its own name, so the browser doesn't uncheck the previous choice; do it here.
  zoneToggle.addEventListener("change", (e) => {
    for (const r of zoneToggle.querySelectorAll("input")) r.checked = r === e.target;
  });

  update();
  // cronstrue is only needed here, so it's fetched when the tool opens.
  import("cronstrue")
    .then((m) => {
      describe = m.default.toString as Describe;
      update();
    })
    .catch(() => {
      describe = () => "";
      update();
    });
  // Keep "next runs" current while the page is open.
  setInterval(() => section.isConnected && document.visibilityState === "visible" && update(), 30000);
  return section;
}

export const tool: Tool = {
  id: "cron",
  name: "Cron Explainer",
  description: "Read a cron expression in plain English and see when it will run next.",
  icon: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM3 4l3-2M21 4l-3-2",
  keywords: "cron crontab schedule expression explain next run job timer quartz every minute",
  render,
};
