import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CronSchedule, describeField, nextRuns, neverRunsReason, parseCron, usesDayOr } from "./cron";

function sched(expr: string): CronSchedule {
  const r = parseCron(expr);
  if (!r.ok) throw new Error(r.error);
  if (r.cron.kind !== "schedule") throw new Error("not a schedule");
  return r.cron;
}

function runsUtc(expr: string, from: string, count = 5): string[] {
  return nextRuns(sched(expr), new Date(from), count, "utc").map((d) => d.toISOString().replace(".000Z", "Z"));
}

describe("parseCron", () => {
  it("expands lists, ranges and steps", () => {
    expect(sched("*/15 * * * *").minute.values).toEqual([0, 15, 30, 45]);
    expect(sched("0 0 1-5/2 * *").dayOfMonth.values).toEqual([1, 3, 5]);
    expect(sched("1,2,10-12 * * * *").minute.values).toEqual([1, 2, 10, 11, 12]);
    expect(sched("5/20 * * * *").minute.values).toEqual([5, 25, 45]);
    expect(sched("0 */6 * * *").hour.values).toEqual([0, 6, 12, 18]);
  });

  it("accepts month and weekday names in any case", () => {
    expect(sched("0 0 * jan,Mar-MAY *").month.values).toEqual([1, 3, 4, 5]);
    expect(sched("0 9 * * mon-fri").dayOfWeek.values).toEqual([1, 2, 3, 4, 5]);
  });

  it("treats 0 and 7 as Sunday", () => {
    expect(sched("0 0 * * 7").dayOfWeek.values).toEqual([0]);
    expect(sched("0 0 * * 0,7").dayOfWeek.values).toEqual([0]);
    expect(sched("0 0 * * 5-7").dayOfWeek.values).toEqual([0, 5, 6]);
    expect(sched("0 0 * * */2").dayOfWeek.values).toEqual([0, 2, 4, 6]);
  });

  it("reads 6 fields as seconds first", () => {
    const c = sched("*/10 0 12 * * *");
    expect(c.hasSeconds).toBe(true);
    expect(c.second.values).toEqual([0, 10, 20, 30, 40, 50]);
    expect(c.minute.values).toEqual([0]);
    expect(c.hour.values).toEqual([12]);
  });

  it("expands aliases", () => {
    expect(sched("@daily").expression).toBe("0 0 * * *");
    expect(sched("@HOURLY").expression).toBe("0 * * * *");
    expect(sched("@weekly").expression).toBe("0 0 * * 0");
    expect(sched("@monthly").expression).toBe("0 0 1 * *");
    expect(sched("@yearly").expression).toBe("0 0 1 1 *");
    expect(sched("@annually").expression).toBe("0 0 1 1 *");
    const r = parseCron("@reboot");
    expect(r.ok && r.cron.kind).toBe("reboot");
  });

  it("points errors at the bad field", () => {
    const r = parseCron("0 25 * * *");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.badField).toBe("hour");
    expect(r.error).toMatch(/Hour \(25\).*0–23/);
    expect(r.fields.map((f) => !!f.error)).toEqual([false, true, false, false, false]);
  });

  it("reports every bad field", () => {
    const r = parseCron("61 * 0 13 *");
    expect(!r.ok && r.fields.filter((f) => f.error).map((f) => f.name)).toEqual(["minute", "dayOfMonth", "month"]);
  });

  it("rejects malformed input with clear messages", () => {
    const err = (e: string) => {
      const r = parseCron(e);
      return r.ok ? "" : r.error;
    };
    expect(err("")).toMatch(/Enter a cron/);
    expect(err("* * * *")).toMatch(/found 4/);
    expect(err("* * * * * * *")).toMatch(/found 7/);
    expect(err("*/0 * * * *")).toMatch(/step/);
    expect(err("5-1 * * * *")).toMatch(/backwards/);
    expect(err("1,,2 * * * *")).toMatch(/empty item/);
    expect(err("0 0 * FOO *")).toMatch(/isn't a valid month/);
    expect(err("0 0 15W * *")).toMatch(/isn't supported/);
    expect(err("? * * * *")).toMatch(/only allowed/);
    expect(err("@sometimes")).toMatch(/Unknown shortcut/);
    expect(err("0 0 * * 1#6")).toMatch(/1–5/);
    expect(err("1-2-3 * * * *")).toMatch(/isn't a valid range/);
  });

  it("supports L, nL and n#k", () => {
    expect(sched("0 0 L * *").dayOfMonth.lastDay).toBe(true);
    expect(sched("0 0 * * 5L").dayOfWeek.lastWeekdays).toEqual([5]);
    expect(sched("0 0 * * MON#2").dayOfWeek.nthWeekdays).toEqual([[1, 2]]);
  });
});

describe("nextRuns (UTC)", () => {
  it("steps every 15 minutes, strictly after the start", () => {
    expect(runsUtc("*/15 * * * *", "2026-01-01T10:15:00Z", 3)).toEqual([
      "2026-01-01T10:30:00Z",
      "2026-01-01T10:45:00Z",
      "2026-01-01T11:00:00Z",
    ]);
    expect(runsUtc("*/15 * * * *", "2026-01-01T10:14:59.500Z", 1)).toEqual(["2026-01-01T10:15:00Z"]);
  });

  it("rolls over month and year ends", () => {
    expect(runsUtc("0 0 * * *", "2026-12-31T00:00:00Z", 2)).toEqual(["2027-01-01T00:00:00Z", "2027-01-02T00:00:00Z"]);
    expect(runsUtc("0 0 31 * *", "2026-01-31T12:00:00Z", 3)).toEqual([
      "2026-03-31T00:00:00Z",
      "2026-05-31T00:00:00Z",
      "2026-07-31T00:00:00Z",
    ]);
  });

  it("finds Feb 29 only in leap years", () => {
    expect(runsUtc("0 12 29 2 *", "2026-01-01T00:00:00Z", 3)).toEqual([
      "2028-02-29T12:00:00Z",
      "2032-02-29T12:00:00Z",
      "2036-02-29T12:00:00Z",
    ]);
  });

  it("handles the last day of the month", () => {
    expect(runsUtc("0 0 L * *", "2027-01-15T00:00:00Z", 3)).toEqual([
      "2027-01-31T00:00:00Z",
      "2027-02-28T00:00:00Z",
      "2027-03-31T00:00:00Z",
    ]);
    expect(runsUtc("0 0 L 2 *", "2028-01-01T00:00:00Z", 1)).toEqual(["2028-02-29T00:00:00Z"]);
  });

  it("handles the last and nth weekday of the month", () => {
    // Last Friday: Jan 30 2026, Feb 27 2026. Second Monday: Jan 12 2026, Feb 9 2026.
    expect(runsUtc("0 0 * * 5L", "2026-01-01T00:00:00Z", 2)).toEqual(["2026-01-30T00:00:00Z", "2026-02-27T00:00:00Z"]);
    expect(runsUtc("0 0 * * 1#2", "2026-01-01T00:00:00Z", 2)).toEqual(["2026-01-12T00:00:00Z", "2026-02-09T00:00:00Z"]);
  });

  it("runs weekdays at 9:00 (Sunday as 0 and 7 alike)", () => {
    // 2026-01-02 is a Friday.
    expect(runsUtc("0 9 * * 1-5", "2026-01-02T09:00:00Z", 2)).toEqual(["2026-01-05T09:00:00Z", "2026-01-06T09:00:00Z"]);
    expect(runsUtc("0 9 * * 0", "2026-01-01T00:00:00Z", 2)).toEqual(runsUtc("0 9 * * 7", "2026-01-01T00:00:00Z", 2));
    expect(runsUtc("0 9 * * SUN", "2026-01-01T00:00:00Z", 1)).toEqual(["2026-01-04T09:00:00Z"]);
  });

  it("uses OR when both day fields are restricted", () => {
    const c = sched("0 0 13 * 5");
    expect(usesDayOr(c)).toBe(true);
    // The 13th or any Friday: Fri Feb 6, Fri Feb 13 (both), Fri Feb 20, Fri Feb 27, Fri Mar 6, Fri Mar 13...
    expect(runsUtc("0 0 13 * 5", "2026-02-01T00:00:00Z", 5)).toEqual([
      "2026-02-06T00:00:00Z",
      "2026-02-13T00:00:00Z",
      "2026-02-20T00:00:00Z",
      "2026-02-27T00:00:00Z",
      "2026-03-06T00:00:00Z",
    ]);
    expect(runsUtc("0 0 1 * 1", "2026-06-01T00:00:00Z", 3)).toEqual([
      "2026-06-08T00:00:00Z",
      "2026-06-15T00:00:00Z",
      "2026-06-22T00:00:00Z",
    ]);
  });

  it("uses AND when a day field starts with * (Vixie quirk)", () => {
    const c = sched("0 0 */2 * 1");
    expect(usesDayOr(c)).toBe(false);
    // Odd days that are also Mondays: Jan 5 2026 is Monday (odd), Jan 19 (odd).
    expect(runsUtc("0 0 */2 * 1", "2026-01-01T00:00:00Z", 2)).toEqual(["2026-01-05T00:00:00Z", "2026-01-19T00:00:00Z"]);
  });

  it("supports seconds", () => {
    expect(runsUtc("*/20 * * * * *", "2026-01-01T00:00:05Z", 3)).toEqual([
      "2026-01-01T00:00:20Z",
      "2026-01-01T00:00:40Z",
      "2026-01-01T00:01:00Z",
    ]);
  });

  it("returns nothing for impossible dates, with a reason", () => {
    const c = sched("0 0 30 2 *");
    expect(nextRuns(c, new Date("2026-01-01T00:00:00Z"), 5, "utc")).toEqual([]);
    expect(neverRunsReason(c)).toMatch(/February/);
    expect(neverRunsReason(sched("0 0 31 4,6 *"))).toMatch(/April, June/);
    expect(neverRunsReason(sched("0 0 29 2 *"))).toBeUndefined();
  });

  it("is fast for sparse schedules", () => {
    const t = performance.now();
    runsUtc("0 0 29 2 1", "2026-01-01T00:00:00Z", 10);
    runsUtc("59 23 31 12 *", "2026-01-01T00:00:00Z", 10);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("nextRuns (local time across DST)", () => {
  const saved = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    process.env.TZ = saved;
  });

  it("uses the local zone", () => {
    // 09:00 New York in January is 14:00 UTC.
    const runs = nextRuns(sched("0 9 * * *"), new Date("2026-01-10T00:00:00Z"), 1, "local");
    expect(runs[0].toISOString()).toBe("2026-01-10T14:00:00.000Z");
  });

  it("skips times inside the spring-forward gap", () => {
    // 2026-03-08: clocks jump from 02:00 to 03:00 in New York.
    const runs = nextRuns(sched("30 2 * * *"), new Date("2026-03-07T12:00:00Z"), 2, "local");
    expect(runs.map((d) => d.toISOString())).toEqual(["2026-03-09T06:30:00.000Z", "2026-03-10T06:30:00.000Z"]);
    const hourly = nextRuns(sched("0 * * * *"), new Date("2026-03-08T06:30:00Z"), 2, "local");
    // 01:00 EST (06:00Z) -> next is 03:00 EDT (07:00Z).
    expect(hourly.map((d) => d.toISOString())).toEqual(["2026-03-08T07:00:00.000Z", "2026-03-08T08:00:00.000Z"]);
  });

  it("runs the repeated fall-back hour once and keeps times increasing", () => {
    // 2026-11-01: 01:00–02:00 happens twice in New York.
    const runs = nextRuns(sched("30 * * * *"), new Date("2026-11-01T04:00:00Z"), 3, "local");
    expect(runs.map((d) => d.toISOString())).toEqual(["2026-11-01T04:30:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-01T07:30:00.000Z"]);
    // Starting inside the second 01:xx, the next run is after it, not back in the first one.
    const later = nextRuns(sched("45 * * * *"), new Date("2026-11-01T06:30:00Z"), 1, "local");
    expect(later[0].toISOString()).toBe("2026-11-01T07:45:00.000Z");
  });
});

describe("describeField", () => {
  it("summarises values", () => {
    expect(describeField(sched("*/15 * * * *").minute)).toBe("0, 15, 30, 45");
    expect(describeField(sched("0 9 * * 1-5").dayOfWeek)).toBe("Monday–Friday");
    expect(describeField(sched("0 0 * * *").dayOfMonth)).toBe("any");
    expect(describeField(sched("0 0 * 1,2 *").month)).toBe("January, February");
    expect(describeField(sched("0 0 L * *").dayOfMonth)).toBe("last day of the month");
    expect(describeField(sched("0 0 * * 5L").dayOfWeek)).toBe("last Friday of the month");
  });
});
