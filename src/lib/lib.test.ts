import { describe, expect, it } from "vitest";
import { compareTexts, splitLines } from "./diff";
import { decodeBase64, decodeUrl, encodeBase64, parseUrl } from "./encoding";
import { hashText, md5, toHex } from "./hash";
import { formatJson, positionToLineColumn } from "./json";
import { decodeJwt, tokenStatus, verifyHmac } from "./jwt";
import { AMBIGUOUS, CHARSETS, generatePassword, passwordEntropy, randomInt } from "./password";
import { runRegex } from "./regex";
import { convertCase, splitWords, textStats } from "./text";
import { parseTimeInput, relativeTime } from "./time";
import { generateUuids, inspectUuid, uuidV7 } from "./uuid";

describe("text compare", () => {
  it("splits lines without a phantom last line", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
  });

  it("pairs changed lines and highlights changed words", () => {
    const r = compareTexts("one\ntwo apples\nthree\n", "one\ntwo pears\nthree\nfour\n")!;
    expect(r.rows.map((x) => x.kind)).toEqual(["same", "change", "same", "added"]);
    expect([r.added, r.removed, r.changed, r.identical]).toEqual([1, 0, 1, false]);
    const change = r.rows[1];
    if (change.kind !== "change") throw new Error();
    expect(change.left.segments!.filter((s) => s.changed).map((s) => s.text)).toEqual(["apples"]);
    expect(change.right.segments!.filter((s) => s.changed).map((s) => s.text)).toEqual(["pears"]);
  });

  it("keeps line numbers for each side", () => {
    const r = compareTexts("a\nx\nb", "a\nb\nc")!;
    expect(r.rows.map((x) => [x.kind, "left" in x ? x.left.line : null, "right" in x ? x.right.line : null])).toEqual([
      ["same", 1, 1],
      ["removed", 2, null],
      ["same", 3, 2],
      ["added", null, 3],
    ]);
  });

  it("can ignore whitespace and case, but still shows each side's own text", () => {
    expect(compareTexts("a  b\nHELLO", "a b\nhello", { ignoreWhitespace: true, ignoreCase: true })!.identical).toBe(true);
    const r = compareTexts("Hello World", "hello there", { ignoreCase: true })!;
    const row = r.rows[0];
    if (row.kind !== "change") throw new Error();
    expect(row.left.segments!.map((s) => s.text).join("")).toBe("Hello World");
    expect(row.right.segments!.map((s) => s.text).join("")).toBe("hello there");
  });
});

describe("JSON", () => {
  it("formats, minifies and sorts keys", () => {
    expect(formatJson('{"b":1,"a":[1,2]}', { indent: 2 })).toMatchObject({
      ok: true,
      output: '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}',
    });
    expect(formatJson('{ "b": 1, "a": 2 }', { indent: 0, sortKeys: true })).toMatchObject({ ok: true, output: '{"a":2,"b":1}' });
    expect(formatJson('{"a":{"b":1}}', { indent: "tab" })).toMatchObject({ ok: true, output: '{\n\t"a": {\n\t\t"b": 1\n\t}\n}' });
  });

  it("keeps numbers exactly as written", () => {
    const r = formatJson('{"id": 12345678901234567890, "price": 1.10, "e": 1E3}', { indent: 0 });
    expect(r).toMatchObject({ ok: true, output: '{"id":12345678901234567890,"price":1.10,"e":1E3}' });
  });

  it("reports where the error is", () => {
    const r = formatJson('{\n  "a": 1,\n  "b": }', { indent: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect([r.line, r.column]).toEqual([3, 8]);
    expect(positionToLineColumn("ab\ncd", 4)).toEqual({ line: 2, column: 2 });
  });

  it("explains common mistakes", () => {
    const err = (t: string) => {
      const r = formatJson(t, { indent: 2 });
      return r.ok ? "ok" : `${r.error} @${r.line}:${r.column}`;
    };
    expect(err(`{"a": 1,}`)).toBe("Trailing comma before } @1:9");
    expect(err(`[1, 2,\n]`)).toBe("Trailing comma before ] @2:1");
    expect(err(`{'a': 1}`)).toBe("Keys must use double quotes @1:2");
    expect(err(`{"a": "x}`)).toBe("Unterminated string @1:7");
    expect(err(`{"a": 01}`)).toBe("Invalid number (leading zeros, or a dot without digits?) @1:8");
    expect(err(`{"a": 1} x`)).toBe('Unexpected "x" after the end of the JSON @1:10');
    expect(err(`{"a" 1}`)).toBe('Unexpected "1"; expected ":" @1:6');
    expect(err(`{"a": tru}`)).toBe('Unexpected "t"; expected a value @1:7');
    expect(err("[".repeat(20000))).not.toBe("ok");
  });

  it("counts keys and depth", () => {
    expect(formatJson('{"a":{"b":[{"c":1}]}}', { indent: 2 })).toMatchObject({ ok: true, stats: { keys: 3, depth: 4 } });
  });
});

describe("encoding", () => {
  it("round-trips Unicode through Base64", () => {
    expect(encodeBase64("héllo 👋")).toBe("aMOpbGxvIPCfkYs=");
    expect(encodeBase64("héllo 👋", true)).toBe("aMOpbGxvIPCfkYs");
    expect(decodeBase64("aMOpbGxvIPCfkYs")).toEqual({ ok: true, value: "héllo 👋" });
    expect(decodeBase64(" aGk= \n")).toEqual({ ok: true, value: "hi" });
  });

  it("explains bad Base64", () => {
    expect(decodeBase64("ab$c")).toMatchObject({ ok: false });
    expect(decodeBase64("abcde")).toMatchObject({ ok: false });
    expect(decodeBase64("/w==")).toMatchObject({ ok: false, error: expect.stringContaining("aren't UTF-8") });
  });

  it("decodes URLs and parses their parts", () => {
    expect(decodeUrl("a%20b+c", true)).toEqual({ ok: true, value: "a b c" });
    expect(decodeUrl("100%", false)).toMatchObject({ ok: false });
    const p = parseUrl("https://user:secret@example.com:8080/a%20b?x=1&y=two#top")!;
    expect(Object.fromEntries(p.parts)).toMatchObject({ Host: "example.com", Port: "8080", Path: "/a b", Password: "••••••" });
    expect(p.params).toEqual([
      ["x", "1"],
      ["y", "two"],
    ]);
    expect(parseUrl("not a url")).toBeUndefined();
  });
});

describe("hashes", () => {
  it("matches known MD5 and SHA values", async () => {
    expect(toHex(md5(new Uint8Array()))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(await hashText("MD5", "The quick brown fox jumps over the lazy dog")).toBe("9e107d9d372bb6826bd81d3542a419d6");
    expect(await hashText("MD5", "a".repeat(1000))).toBe("cabe45dcc9ae5b66ba86600cca6b8ba8");
    expect(await hashText("SHA-1", "abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(await hashText("SHA-256", "")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("JWT", () => {
  // Signed with HS256 and the secret "your-256-bit-secret" (the jwt.io example).
  const token =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  it("decodes header and payload", () => {
    const r = decodeJwt(`Bearer ${token}`);
    expect(r).toMatchObject({ ok: true, jwt: { header: { alg: "HS256", typ: "JWT" }, payload: { sub: "1234567890", name: "John Doe" } } });
  });

  it("verifies HMAC signatures", async () => {
    const r = decodeJwt(token);
    if (!r.ok) throw new Error(r.error);
    expect(await verifyHmac(r.jwt, "your-256-bit-secret")).toBe(true);
    expect(await verifyHmac(r.jwt, "wrong")).toBe(false);
  });

  it("explains invalid tokens", () => {
    expect(decodeJwt("abc")).toMatchObject({ ok: false, error: expect.stringContaining("3 parts") });
    expect(decodeJwt("a.b.c.d.e")).toMatchObject({ ok: false, error: expect.stringContaining("encrypted") });
    expect(decodeJwt("e30.!!!.x")).toMatchObject({ ok: false, error: "The payload isn't valid Base64URL." });
  });

  it("reports expiry", () => {
    const now = 2_000_000_000_000;
    expect(tokenStatus({ exp: 1 }, now).state).toBe("expired");
    expect(tokenStatus({ exp: now / 1000 + 60 }, now).state).toBe("valid");
    expect(tokenStatus({ nbf: now / 1000 + 60 }, now).state).toBe("not-yet-valid");
    expect(tokenStatus({}, now).state).toBe("no-expiry");
  });
});

describe("passwords", () => {
  it("uses only chosen characters and includes every chosen type", () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword({ length: 12, sets: ["lower", "digits", "symbols"], excludeAmbiguous: true });
      expect(p).toHaveLength(12);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/\d/);
      expect([...p].some((c) => CHARSETS.symbols.includes(c))).toBe(true);
      expect(p).not.toMatch(/[A-Z]/);
      expect([...p].some((c) => AMBIGUOUS.includes(c))).toBe(false);
    }
  });

  it("rejects impossible options", () => {
    expect(() => generatePassword({ length: 10, sets: [] })).toThrow();
    expect(() => generatePassword({ length: 2, sets: ["lower", "upper", "digits"] })).toThrow();
  });

  it("is roughly uniform", () => {
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60000; i++) counts[randomInt(6)]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(600);
  });

  it("estimates entropy", () => {
    expect(passwordEntropy({ length: 16, sets: ["lower", "upper", "digits"] })).toBeCloseTo(16 * Math.log2(62));
  });
});

describe("UUIDs", () => {
  it("makes valid v4 and sorted v7 values", () => {
    const v4 = generateUuids(4, 50);
    expect(new Set(v4).size).toBe(50);
    for (const u of v4) expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const v7 = generateUuids(7, 50);
    expect([...v7].sort()).toEqual(v7);
    for (const u of v7) expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("reads the time back out of v7 and v1", () => {
    const t = Date.UTC(2026, 9, 20, 12, 0, 0);
    expect(inspectUuid(uuidV7(t))).toMatchObject({ version: 7, variant: "RFC 9562", time: new Date(t) });
    // The v1 example from RFC 9562, made on 2022-02-22 at 14:22:22 (UTC-5).
    expect(inspectUuid("C232AB00-9414-11EC-B3C8-9F6BDECED846")!.time!.toISOString()).toBe("2022-02-22T19:22:22.000Z");
    expect(inspectUuid("nope")).toBeUndefined();
  });
});

describe("timestamps", () => {
  it("detects seconds, milliseconds and dates", () => {
    expect(parseTimeInput("1700000000")).toMatchObject({ ok: true, interpretedAs: "Unix time in seconds" });
    expect(parseTimeInput("1700000000000")).toMatchObject({ ok: true, interpretedAs: "Unix time in milliseconds" });
    const r = parseTimeInput("1700000000000000");
    expect(r.ok && r.date.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(parseTimeInput("2026-10-20T10:00:00Z")).toMatchObject({ ok: true, interpretedAs: "Date text" });
    expect(parseTimeInput("yesterday-ish")).toMatchObject({ ok: false });
  });

  it("describes relative times", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(relativeTime(new Date(now - 3 * 3600_000), now, "en")).toBe("3 hours ago");
    expect(relativeTime(new Date(now + 2 * 86400_000), now, "en")).toBe("in 2 days");
  });
});

describe("regex", () => {
  it("finds all matches with groups", () => {
    const r = runRegex({ pattern: "(?<user>\\w+)@(\\w+)\\.com", flags: "g", text: "a@x.com, bob@y.com", replacement: "$<user> at $2" });
    expect(r).toMatchObject({ ok: true, truncated: false, replaced: "a at x, bob at y" });
    if (r.ok)
      expect(r.matches.map((m) => [m.index, m.text, m.named?.user])).toEqual([
        [0, "a@x.com", "a"],
        [9, "bob@y.com", "bob"],
      ]);
  });

  it("returns only the first match without the g flag, and handles empty matches", () => {
    expect(runRegex({ pattern: "\\d", flags: "", text: "1 2 3" })).toMatchObject({ ok: true, matches: [{ text: "1" }] });
    const r = runRegex({ pattern: "x*", flags: "g", text: "abc" });
    expect(r.ok && r.matches.length).toBe(4);
  });

  it("reports invalid patterns", () => {
    expect(runRegex({ pattern: "(", flags: "g", text: "" })).toMatchObject({ ok: false });
  });
});

describe("text tools", () => {
  it("counts characters, words, lines and bytes", () => {
    expect(textStats("Hi there 👋🏽\nBye.")).toMatchObject({ characters: 15, charactersNoSpaces: 12, words: 3, lines: 2, bytes: 22 });
  });

  it("converts between cases", () => {
    expect(splitWords("parseHTTPResponse2xx_codes")).toEqual(["parse", "HTTP", "Response2xx", "codes"]);
    expect(convertCase("hello world-wide web", "camel")).toBe("helloWorldWideWeb");
    expect(convertCase("userId\nfirstName", "snake")).toBe("user_id\nfirst_name");
    expect(convertCase("the quick fox", "title")).toBe("The Quick Fox");
    expect(convertCase("HELLO. how ARE you", "sentence")).toBe("Hello. How are you");
    expect(convertCase("api key", "constant")).toBe("API_KEY");
  });
});
