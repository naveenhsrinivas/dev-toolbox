import { describe, expect, it } from "vitest";
import { bulletLines, dateRange, emptyResume, isEmpty, linkHref, normalizeResume, sampleResume, splitItems } from "./data";

describe("resume data", () => {
  it("keeps valid data through a save/load round trip", () => {
    const r = sampleResume();
    expect(normalizeResume(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("repairs or drops anything invalid in imported files", () => {
    const r = normalizeResume({
      template: "fancy",
      accent: "red",
      font: "comic",
      pageSize: "legal",
      basics: { name: 42, email: "a@b.co", photo: "javascript:alert(1)" },
      experience: [{ role: "Dev", current: "yes", bullets: ["not", "a string"] }, "junk"],
      skills: "nope",
    });
    expect(r.template).toBe("classic");
    expect(r.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect([r.font, r.pageSize]).toEqual(["default", "a4"]);
    expect(r.basics).toMatchObject({ name: "", email: "a@b.co", photo: "" });
    expect(r.experience[0]).toMatchObject({ role: "Dev", current: false, bullets: "" });
    expect(r.experience[1]).toMatchObject({ role: "" });
    expect(r.skills).toEqual([]);
    expect(normalizeResume(null)).toEqual({ ...emptyResume() });
  });

  it("accepts real photos only", () => {
    expect(normalizeResume({ basics: { photo: "data:image/jpeg;base64,/9j/4AAQ" } }).basics.photo).toBe("data:image/jpeg;base64,/9j/4AAQ");
    expect(normalizeResume({ basics: { photo: "data:text/html;base64,PGI+" } }).basics.photo).toBe("");
  });

  it("formats dates, bullets and skills", () => {
    expect(dateRange("Jan 2020", "Mar 2022", false)).toBe("Jan 2020 – Mar 2022");
    expect(dateRange("Jan 2020", "", true)).toBe("Jan 2020 – Present");
    expect(dateRange("", "2019", false)).toBe("2019");
    expect(bulletLines("- one\n• two\n\n  * three  ")).toEqual(["one", "two", "three"]);
    expect(splitItems("Go, SQL,\nRust, ")).toEqual(["Go", "SQL", "Rust"]);
  });

  it("only makes safe links", () => {
    expect(linkHref("example.com/me", "web")).toBe("https://example.com/me");
    expect(linkHref("javascript:alert(1)", "web")).toBeUndefined();
    expect(linkHref("ftp://files.example.com", "web")).toBeUndefined();
    expect(linkHref("mysite.com:8080/cv", "web")).toBe("https://mysite.com:8080/cv");
    expect(linkHref("me@example.com", "email")).toBe("mailto:me@example.com");
    expect(linkHref("not an email", "email")).toBeUndefined();
    expect(linkHref("+1 (555) 010-0", "phone")).toBe("tel:+15550100");
  });

  it("knows when a resume is empty", () => {
    expect(isEmpty(emptyResume())).toBe(true);
    expect(isEmpty(sampleResume())).toBe(false);
  });
});
