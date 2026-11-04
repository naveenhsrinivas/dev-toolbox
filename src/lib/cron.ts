// Cron expression parsing and next-run computation (Vixie cron semantics).

export type FieldName = "second" | "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek";

interface FieldSpec {
  name: FieldName;
  label: string;
  min: number;
  max: number;
  names?: string[];
}

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SPECS: Record<FieldName, FieldSpec> = {
  second: { name: "second", label: "Second", min: 0, max: 59 },
  minute: { name: "minute", label: "Minute", min: 0, max: 59 },
  hour: { name: "hour", label: "Hour", min: 0, max: 23 },
  dayOfMonth: { name: "dayOfMonth", label: "Day of month", min: 1, max: 31 },
  month: { name: "month", label: "Month", min: 1, max: 12, names: MONTH_NAMES },
  // 7 is accepted as another way to write Sunday.
  dayOfWeek: { name: "dayOfWeek", label: "Day of week", min: 0, max: 7, names: DAY_NAMES },
};

export const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

export interface ParsedField {
  name: FieldName;
  label: string;
  raw: string;
  /** Matching values, sorted. Day of week uses 0–6 (Sunday = 0). */
  values: number[];
  /** The field starts with `*` or `?`; Vixie cron uses this to decide how the two day fields combine. */
  star: boolean;
  /** Day of month `L`: the last day of the month. */
  lastDay: boolean;
  /** Day of week `5L`: the last such weekday of the month. */
  lastWeekdays: number[];
  /** Day of week `1#2`: [weekday, n] — the nth such weekday of the month. */
  nthWeekdays: [number, number][];
}

export interface CronSchedule {
  kind: "schedule";
  source: string;
  /** The expression the schedule was read from (aliases expanded). */
  expression: string;
  hasSeconds: boolean;
  fields: ParsedField[];
  second: ParsedField;
  minute: ParsedField;
  hour: ParsedField;
  dayOfMonth: ParsedField;
  month: ParsedField;
  dayOfWeek: ParsedField;
}

export interface CronReboot {
  kind: "reboot";
  source: string;
}

export interface FieldReport {
  name: FieldName;
  label: string;
  raw: string;
  error?: string;
}

export type ParseResult =
  { ok: true; cron: CronSchedule | CronReboot } | { ok: false; error: string; fields: FieldReport[]; badField?: FieldName };

class FieldError extends Error {}

function parseNumber(token: string, spec: FieldSpec): number {
  const upper = token.toUpperCase();
  if (spec.names) {
    const i = spec.names.indexOf(upper);
    if (i >= 0) return spec.name === "month" ? i + 1 : i;
  }
  if (!/^\d+$/.test(token)) {
    if (/^[a-z]+$/i.test(token)) {
      const valid = spec.names ? ` Use ${spec.names[0]}–${spec.names[spec.names.length - 1]} or numbers.` : "";
      throw new FieldError(`"${token}" isn't a valid ${spec.label.toLowerCase()}.${valid}`);
    }
    throw new FieldError(`"${token}" isn't a number.`);
  }
  const n = Number(token);
  if (n < spec.min || n > spec.max)
    throw new FieldError(`${n} is out of range — ${spec.label.toLowerCase()} must be ${spec.min}–${spec.max}.`);
  return n;
}

function parseField(raw: string, spec: FieldSpec): ParsedField {
  const field: ParsedField = {
    name: spec.name,
    label: spec.label,
    raw,
    values: [],
    star: raw.startsWith("*") || raw === "?",
    lastDay: false,
    lastWeekdays: [],
    nthWeekdays: [],
  };
  const values = new Set<number>();
  const isDay = spec.name === "dayOfMonth" || spec.name === "dayOfWeek";
  if (raw === "?") {
    if (!isDay) throw new FieldError(`"?" is only allowed in the day-of-month and day-of-week fields.`);
    field.star = true;
  }
  // `*` for day of week means 0–6, so Sunday isn't counted twice by steps.
  const starMax = spec.name === "dayOfWeek" ? 6 : spec.max;

  for (const part of raw === "?" ? ["*"] : raw.split(",")) {
    if (part === "") throw new FieldError("There's an empty item in the list (check for a stray comma).");
    const up = part.toUpperCase();

    if (spec.name === "dayOfMonth" && up === "L") {
      field.lastDay = true;
      continue;
    }
    if (spec.name === "dayOfMonth" && /^(L-\d+|\d+W|LW)$/.test(up)) {
      throw new FieldError(`"${part}" (Quartz-style) isn't supported. Plain "L" (last day of the month) is.`);
    }
    if (spec.name === "dayOfWeek") {
      const last = /^(\w+)L$/i.exec(part);
      if (last) {
        field.lastWeekdays.push(parseNumber(last[1], spec) % 7);
        continue;
      }
      const nth = /^(\w+)#(\d+)$/.exec(part);
      if (nth) {
        const n = Number(nth[2]);
        if (n < 1 || n > 5) throw new FieldError(`"${part}": the number after # must be 1–5 (which week of the month).`);
        field.nthWeekdays.push([parseNumber(nth[1], spec) % 7, n]);
        continue;
      }
      if (up === "L") throw new FieldError(`"L" on its own isn't valid here. Use e.g. "5L" for the last Friday of the month.`);
    }

    const [rangePart, stepPart, extra] = part.split("/");
    if (extra !== undefined) throw new FieldError(`"${part}" has more than one "/".`);
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) === 0)
        throw new FieldError(`"/${stepPart}" isn't a valid step — use a whole number above 0.`);
      step = Number(stepPart);
    }
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = spec.min;
      hi = starMax;
    } else if (rangePart.includes("-")) {
      const bits = rangePart.split("-");
      if (bits.length !== 2 || !bits[0] || !bits[1]) throw new FieldError(`"${rangePart}" isn't a valid range. Write ranges like 1-5.`);
      lo = parseNumber(bits[0], spec);
      hi = parseNumber(bits[1], spec);
      if (hi < lo)
        throw new FieldError(
          `The range ${rangePart} goes backwards. Write it low-high, or split it into two items like ${bits[0]}-${spec.names ? spec.names[spec.names.length - 1] : spec.max},${spec.names ? spec.names[0] : spec.min}-${bits[1]}.`,
        );
    } else {
      lo = parseNumber(rangePart, spec);
      // "5/15" means "from 5, every 15" (as in cronie and most other crons).
      hi = stepPart !== undefined ? starMax : lo;
    }
    for (let v = lo; v <= hi; v += step) values.add(spec.name === "dayOfWeek" ? v % 7 : v);
  }
  field.values = [...values].sort((a, b) => a - b);
  return field;
}

const FIVE: FieldName[] = ["minute", "hour", "dayOfMonth", "month", "dayOfWeek"];
const SIX: FieldName[] = ["second", ...FIVE];

/** Parse a cron expression: 5 fields, 6 fields (leading seconds), or an @alias. */
export function parseCron(input: string): ParseResult {
  const source = input.trim();
  if (!source) return { ok: false, error: "Enter a cron expression, e.g. */5 * * * *", fields: [] };
  let expression = source;
  if (source.startsWith("@")) {
    const alias = source.toLowerCase();
    if (alias === "@reboot") return { ok: true, cron: { kind: "reboot", source } };
    if (!ALIASES[alias]) {
      return {
        ok: false,
        error: `Unknown shortcut "${source}". Try @hourly, @daily, @weekly, @monthly, @yearly or @reboot.`,
        fields: [],
      };
    }
    expression = ALIASES[alias];
  }
  const parts = expression.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    return {
      ok: false,
      error: `Expected 5 fields (minute hour day-of-month month day-of-week) or 6 with seconds first, but found ${parts.length}.`,
      fields: [],
    };
  }
  const names = parts.length === 6 ? SIX : FIVE;
  const reports: FieldReport[] = [];
  const parsed: Partial<Record<FieldName, ParsedField>> = {};
  let firstBad: FieldReport | undefined;
  names.forEach((name, i) => {
    const spec = SPECS[name];
    const report: FieldReport = { name, label: spec.label, raw: parts[i] };
    try {
      parsed[name] = parseField(parts[i], spec);
    } catch (e) {
      if (!(e instanceof FieldError)) throw e;
      report.error = e.message;
      firstBad ??= report;
    }
    reports.push(report);
  });
  if (firstBad)
    return { ok: false, error: `${firstBad.label} (${firstBad.raw}): ${firstBad.error}`, fields: reports, badField: firstBad.name };

  const second = parsed.second ?? parseField("0", SPECS.second);
  const cron: CronSchedule = {
    kind: "schedule",
    source,
    expression,
    hasSeconds: parts.length === 6,
    fields: names.map((n) => parsed[n]!),
    second,
    minute: parsed.minute!,
    hour: parsed.hour!,
    dayOfMonth: parsed.dayOfMonth!,
    month: parsed.month!,
    dayOfWeek: parsed.dayOfWeek!,
  };
  return { ok: true, cron };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function domMatches(f: ParsedField, day: number, dim: number): boolean {
  return f.values.includes(day) || (f.lastDay && day === dim);
}

function dowMatches(f: ParsedField, weekday: number, day: number, dim: number): boolean {
  return (
    f.values.includes(weekday) ||
    (f.lastWeekdays.includes(weekday) && day + 7 > dim) ||
    f.nthWeekdays.some(([w, n]) => w === weekday && Math.ceil(day / 7) === n)
  );
}

/**
 * Vixie cron: if either day field starts with `*`, both must match (the starred one always does);
 * if both are restricted, the day runs when either matches.
 */
export function dayMatches(cron: CronSchedule, year: number, month: number, day: number): boolean {
  const dim = daysInMonth(year, month);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const dom = domMatches(cron.dayOfMonth, day, dim);
  const dow = dowMatches(cron.dayOfWeek, weekday, day, dim);
  if (cron.dayOfMonth.star || cron.dayOfWeek.star) return dom && dow;
  return dom || dow;
}

/** Both day fields restricted, so they combine with OR. */
export function usesDayOr(cron: CronSchedule): boolean {
  return !cron.dayOfMonth.star && !cron.dayOfWeek.star;
}

export type Zone = "local" | "utc";

/** How far ahead to look before deciding a schedule never runs (covers the 28-year weekday/leap cycle). */
const SEARCH_YEARS = 60;

/**
 * The next `count` run times strictly after `from`.
 * In local time, wall-clock times skipped by a daylight-saving jump don't run, and times in a repeated hour run once.
 */
export function nextRuns(cron: CronSchedule, from: Date, count: number, zone: Zone = "local"): Date[] {
  const utc = zone === "utc";
  const step = cron.hasSeconds ? 1000 : 60000;
  // "Wall" times are calendar fields stored as if they were UTC, so stepping them is pure arithmetic.
  const fromWall = utc
    ? from.getTime()
    : Date.UTC(
        from.getFullYear(),
        from.getMonth(),
        from.getDate(),
        from.getHours(),
        from.getMinutes(),
        from.getSeconds(),
        from.getMilliseconds(),
      );
  let w = Math.floor(fromWall / step) * step + step;
  const lastYear = new Date(w).getUTCFullYear() + SEARCH_YEARS;
  const months = new Set(cron.month.values);
  const hours = new Set(cron.hour.values);
  const minutes = new Set(cron.minute.values);
  const seconds = new Set(cron.second.values);
  const out: Date[] = [];
  let dayOk: { key: number; ok: boolean } | undefined;

  while (out.length < count) {
    const t = new Date(w);
    const y = t.getUTCFullYear();
    if (y > lastYear) break;
    const mo = t.getUTCMonth() + 1;
    const d = t.getUTCDate();
    const hh = t.getUTCHours();
    const mi = t.getUTCMinutes();
    const ss = t.getUTCSeconds();
    if (!months.has(mo)) {
      w = Date.UTC(y, mo, 1);
      continue;
    }
    const key = y * 10000 + mo * 100 + d;
    if (dayOk?.key !== key) dayOk = { key, ok: dayMatches(cron, y, mo, d) };
    if (!dayOk.ok) {
      w = Date.UTC(y, mo - 1, d + 1);
      continue;
    }
    if (!hours.has(hh)) {
      w = Date.UTC(y, mo - 1, d, hh + 1);
      continue;
    }
    if (!minutes.has(mi)) {
      w = Date.UTC(y, mo - 1, d, hh, mi + 1);
      continue;
    }
    if (!seconds.has(ss)) {
      w = Date.UTC(y, mo - 1, d, hh, mi, ss + 1);
      continue;
    }
    w += step;
    let instant: Date;
    if (utc) instant = t;
    else {
      instant = new Date(y, mo - 1, d, hh, mi, ss);
      // Not a real local time (inside a DST gap): the Date rolled forward to a different wall time.
      if (instant.getHours() !== hh || instant.getMinutes() !== mi || instant.getDate() !== d) continue;
    }
    if (instant.getTime() <= from.getTime()) continue;
    if (out.length && instant.getTime() <= out[out.length - 1].getTime()) continue;
    out.push(instant);
  }
  return out;
}

/** A specific reason a schedule can never run, e.g. "0 0 30 2 *". */
export function neverRunsReason(cron: CronSchedule): string | undefined {
  const dom = cron.dayOfMonth;
  if (dom.star || !cron.dayOfWeek.star || dom.lastDay) return undefined;
  const maxDays = Math.max(...cron.month.values.map((m) => (m === 2 ? 29 : daysInMonth(2001, m))));
  if (dom.values.every((d) => d > maxDays)) {
    const months = cron.month.values.map((m) => MONTH_LONG[m - 1]).join(", ");
    return `None of the chosen days exist in ${months} (at most ${maxDays} days), so this never runs.`;
  }
  return undefined;
}

function compress(values: number[], fmt: (n: number) => string): string {
  const out: string[] = [];
  for (let i = 0; i < values.length;) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
    if (j - i >= 2) out.push(`${fmt(values[i])}–${fmt(values[j])}`);
    else for (let k = i; k <= j; k++) out.push(fmt(values[k]));
    i = j + 1;
  }
  return out.join(", ");
}

/** A short plain-English summary of one field's matching values. */
export function describeField(f: ParsedField): string {
  const spec = SPECS[f.name];
  const full = f.values.length === (f.name === "dayOfWeek" ? 7 : spec.max - spec.min + 1);
  const extras: string[] = [];
  if (f.lastDay) extras.push("last day of the month");
  for (const w of f.lastWeekdays) extras.push(`last ${DAY_LONG[w]} of the month`);
  for (const [w, n] of f.nthWeekdays) extras.push(`${["1st", "2nd", "3rd", "4th", "5th"][n - 1]} ${DAY_LONG[w]} of the month`);
  if (full && !extras.length) return f.raw === "?" || f.raw === "*" ? "any" : "every value";
  const fmt = f.name === "month" ? (n: number) => MONTH_LONG[n - 1] : f.name === "dayOfWeek" ? (n: number) => DAY_LONG[n] : String;
  return [f.values.length ? compress(f.values, fmt) : "", ...extras].filter(Boolean).join("; ");
}
