// Converting between Unix timestamps and dates.

export type TimeInput = { ok: true; date: Date; interpretedAs: string } | { ok: false; error: string };

/**
 * Read a Unix timestamp (seconds, milliseconds, microseconds or nanoseconds —
 * chosen by size) or a date string such as ISO 8601.
 */
export function parseTimeInput(text: string): TimeInput {
  const t = text.trim();
  if (!t) return { ok: false, error: "Enter a timestamp or a date." };
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    const abs = Math.abs(n);
    // Around today: seconds ≈ 1.7e9, ms ≈ 1.7e12, µs ≈ 1.7e15, ns ≈ 1.7e18.
    const [ms, unit] =
      abs < 1e11
        ? [n * 1000, "seconds"]
        : abs < 1e14
          ? [n, "milliseconds"]
          : abs < 1e17
            ? [n / 1e3, "microseconds"]
            : [n / 1e6, "nanoseconds"];
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return { ok: false, error: "That timestamp is out of range." };
    return { ok: true, date, interpretedAs: `Unix time in ${unit}` };
  }
  const date = new Date(t);
  if (Number.isNaN(date.getTime()))
    return { ok: false, error: "Not a recognised date. Try a Unix timestamp or a format like 2026-10-20T14:30:00Z." };
  return { ok: true, date, interpretedAs: "Date text" };
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600 * 1000],
  ["month", 30 * 24 * 3600 * 1000],
  ["week", 7 * 24 * 3600 * 1000],
  ["day", 24 * 3600 * 1000],
  ["hour", 3600 * 1000],
  ["minute", 60 * 1000],
  ["second", 1000],
];

export function relativeTime(date: Date, now = Date.now(), locale?: string): string {
  const diff = date.getTime() - now;
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size || unit === "second") return fmt.format(Math.round(diff / size), unit);
  }
  return "";
}

export function timeFormats(date: Date): [label: string, value: string][] {
  const ms = date.getTime();
  return [
    ["Unix seconds", String(Math.floor(ms / 1000))],
    ["Unix milliseconds", String(ms)],
    ["ISO 8601 (UTC)", date.toISOString()],
    ["Your time zone", date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })],
    ["UTC", date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long", timeZone: "UTC" })],
    ["RFC 2822 / HTTP", date.toUTCString()],
  ];
}
