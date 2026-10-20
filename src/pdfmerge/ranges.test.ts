import { describe, expect, it } from "vitest";
import { parsePageRanges } from "./ranges";

const pages = (input: string, count = 10) => {
  const r = parsePageRanges(input, count);
  if (!r.ok) throw new Error(r.error);
  return r.pages.map((i) => i + 1);
};
const error = (input: string, count = 10) => {
  const r = parsePageRanges(input, count);
  if (r.ok) throw new Error(`expected an error for "${input}"`);
  return r.error;
};

describe("parsePageRanges", () => {
  it("selects every page when empty or 'all'", () => {
    expect(pages("", 3)).toEqual([1, 2, 3]);
    expect(pages("  ", 3)).toEqual([1, 2, 3]);
    expect(pages("All", 3)).toEqual([1, 2, 3]);
  });

  it("parses single pages and ranges in the order written", () => {
    expect(pages("1-3, 5, 8")).toEqual([1, 2, 3, 5, 8]);
    expect(pages("9,2")).toEqual([9, 2]);
    expect(pages(" 2 - 4 ")).toEqual([2, 3, 4]);
  });

  it("supports open and reversed ranges", () => {
    expect(pages("8-")).toEqual([8, 9, 10]);
    expect(pages("-3")).toEqual([1, 2, 3]);
    expect(pages("5-3")).toEqual([5, 4, 3]);
  });

  it("keeps repeats and accepts en dashes and stray commas", () => {
    expect(pages("1,1")).toEqual([1, 1]);
    expect(pages("2–4,")).toEqual([2, 3, 4]);
  });

  it("rejects pages out of range", () => {
    expect(error("11")).toBe("Page 11 doesn't exist (this file has 10 pages)");
    expect(error("2-5", 1)).toBe("Page 2 doesn't exist (this file has 1 page)");
    expect(error("0")).toBe("Pages start at 1");
  });

  it("rejects text that isn't a page selection", () => {
    expect(error("abc")).toBe('"abc" isn\'t a page or a range');
    expect(error("1-2-3")).toBe('"1-2-3" isn\'t a page or a range');
    expect(error("-")).toBe('"-" isn\'t a page or a range');
    expect(error(",")).toBe("No pages selected");
  });
});
