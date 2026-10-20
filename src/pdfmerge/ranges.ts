// Parsing of page selections such as "1-3, 5, 8-" into zero-based page indices.

export type RangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

/**
 * Turn a page selection into zero-based page indices, in the order written.
 *
 * Accepts single pages ("4"), ranges ("2-6"), open ranges ("8-" to the end,
 * "-3" from the start) and reversed ranges ("5-3" gives 5, 4, 3), separated by
 * commas. Empty or "all" selects every page. Repeats are kept on purpose: a
 * page listed twice appears twice in the output.
 */
export function parsePageRanges(input: string, pageCount: number): RangeResult {
  const text = input.trim().toLowerCase();
  if (text === "" || text === "all") return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i) };

  const pages: number[] = [];
  for (const raw of text.split(",")) {
    const part = raw.trim().replace(/[–—]/g, "-");
    if (!part) continue;
    const match = /^(\d*)\s*(-)?\s*(\d*)$/.exec(part);
    if (!match || (!match[1] && !match[3])) return { ok: false, error: `"${raw.trim()}" isn't a page or a range` };

    const [, startText, dash, endText] = match;
    const start = startText ? Number(startText) : 1;
    const end = dash ? (endText ? Number(endText) : pageCount) : start;
    for (const n of [start, end]) {
      if (n < 1) return { ok: false, error: "Pages start at 1" };
      if (n > pageCount)
        return { ok: false, error: `Page ${n} doesn't exist (this file has ${pageCount} ${pageCount === 1 ? "page" : "pages"})` };
    }
    const step = end >= start ? 1 : -1;
    for (let n = start; n !== end + step; n += step) pages.push(n - 1);
  }
  if (!pages.length) return { ok: false, error: "No pages selected" };
  return { ok: true, pages };
}
