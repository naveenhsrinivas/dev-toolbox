import { describe, expect, it } from "vitest";
import {
  convert,
  DEFAULT_OPTIONS,
  detectFormat,
  flattenObject,
  parseCsv,
  parseJson,
  parseYaml,
  stringifyJson,
  toCsv,
  typedCell,
  unflattenObject,
  type ConvertOptions,
} from "./convert";
import { escapeHtml, fileNameFromTitle, markdownTitle, remoteImageCount, standaloneHtml } from "./mdexport";
import { describeSqlError, minifySql } from "./sql";

const opts = (o: Partial<ConvertOptions>): ConvertOptions => ({ ...DEFAULT_OPTIONS, ...o });
function ok(input: string, o: Partial<ConvertOptions>): string {
  const r = convert(input, opts(o));
  if (!r.ok) throw new Error(r.error);
  return r.output;
}

describe("detectFormat", () => {
  it("recognises each format", () => {
    expect(detectFormat('{"a":1}')).toBe("json");
    expect(detectFormat("  [1,2]")).toBe("json");
    expect(detectFormat("﻿{}")).toBe("json");
    expect(detectFormat("a: 1\nb: 2")).toBe("yaml");
    expect(detectFormat("---\na: 1")).toBe("yaml");
    expect(detectFormat("- a\n- b")).toBe("yaml");
    expect(detectFormat("# comment\nname: x")).toBe("yaml");
    expect(detectFormat("name,age\nAda,36\nBob,40")).toBe("csv");
    expect(detectFormat("name;age\nAda;36")).toBe("csv");
    expect(detectFormat("name\tage\nAda\t36")).toBe("csv");
    expect(detectFormat('url,note\n"http://x.com/a:b","hi: there"')).toBe("csv");
  });
});

describe("JSON", () => {
  it("keeps big integers exact", () => {
    const v = parseJson('{"id":12345678901234567890,"n":-98765432109876543210,"f":1.5,"s":9007199254740991}');
    expect(v).toEqual({ id: 12345678901234567890n, n: -98765432109876543210n, f: 1.5, s: 9007199254740991 });
    expect(stringifyJson(v, 0)).toBe('{"id":12345678901234567890,"n":-98765432109876543210,"f":1.5,"s":9007199254740991}');
  });

  it("indents with spaces, tabs or not at all", () => {
    const v = { a: [1, { b: null }], c: {}, d: [] };
    expect(stringifyJson(v, 2)).toBe(JSON.stringify(v, null, 2));
    expect(stringifyJson(v, 4)).toBe(JSON.stringify(v, null, 4));
    expect(stringifyJson(v, "tab")).toBe(JSON.stringify(v, null, "\t"));
    expect(stringifyJson(v, 0)).toBe(JSON.stringify(v));
    expect(stringifyJson("é   \n", 0)).toBe(JSON.stringify("é   \n"));
  });

  it("reports errors with line and column", () => {
    const r = convert('{\n  "a": 1,\n  "b": }', opts({ from: "json", to: "yaml" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.line).toBe(3);
      expect(r.column).toBe(8);
    }
  });
});

describe("YAML", () => {
  it("keeps big integers exact and small ones as numbers", () => {
    const { value } = parseYaml("id: 12345678901234567890\nn: 42\nhex: 0x1F\nf: 1.5\n");
    expect(value).toEqual({ id: 12345678901234567890n, n: 42, hex: 31, f: 1.5 });
    expect(ok("id: 12345678901234567890", { to: "json", indent: 0 })).toBe('{"id":12345678901234567890}');
    expect(ok('{"id":12345678901234567890}', { to: "yaml" })).toBe("id: 12345678901234567890\n");
  });

  it("reports errors with line and column", () => {
    const r = convert("a: 1\nb: [1, 2\nc: 3", opts({ from: "yaml", to: "json" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.line).toBeGreaterThan(1);
      expect(r.column).toBeGreaterThan(0);
      expect(r.error).not.toMatch(/\n/);
    }
    const dup = convert("a: 1\na: 2", opts({ from: "yaml", to: "json" }));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.line).toBe(2);
  });

  it("combines multiple documents into a list", () => {
    const r = convert("a: 1\n---\na: 2\n", opts({ from: "yaml", to: "json", indent: 0 }));
    expect(r.ok && r.output).toBe('[{"a":1},{"a":2}]');
    expect(r.ok && r.notes[0]).toMatch(/2 YAML documents/);
  });

  it("round-trips JSON ⇄ YAML with tricky strings", () => {
    const v = {
      yes: "yes",
      no: "no",
      num: "123",
      empty: "",
      multi: "line 1\nline 2\n",
      colon: "a: b",
      hash: "# not a comment",
      unicode: "naïve 日本語 🎉",
      nested: { list: [1, "two", null, true, { deep: [] }] },
    };
    const json = JSON.stringify(v);
    const yaml = ok(json, { to: "yaml" });
    expect(JSON.parse(ok(yaml, { from: "yaml", to: "json" }))).toEqual(v);
  });
});

describe("flatten / unflatten", () => {
  it("round-trips nested objects and arrays", () => {
    const v = { a: { b: 1, c: { d: "x" } }, tags: ["p", "q"], items: [{ id: 1 }, { id: 2 }], e: [], f: {} };
    const flat = flattenObject(v);
    expect(flat).toEqual({ "a.b": 1, "a.c.d": "x", "tags.0": "p", "tags.1": "q", "items.0.id": 1, "items.1.id": 2, e: "[]", f: "{}" });
    const back = unflattenObject(flat);
    expect(back).toEqual({ ...v, e: "[]", f: "{}" });
  });

  it("only makes arrays of 0..n-1 keys", () => {
    expect(unflattenObject({ "a.0": 1, "a.2": 2 })).toEqual({ a: { 0: 1, 2: 2 } });
    expect(unflattenObject({ "a..b": 1, ".x": 2 })).toEqual({ "a..b": 1, ".x": 2 });
  });
});

describe("CSV", () => {
  it("converts arrays of objects to rows, with a union of columns", () => {
    const csv = toCsv(
      [
        { a: 1, b: "x" },
        { b: "y", c: true },
      ],
      { delimiter: ",", header: true, flatten: true },
    );
    expect(csv).toBe("a,b,c\n1,x,\n,y,true");
  });

  it("quotes cells with delimiters, quotes and newlines and reads them back", () => {
    const v = [
      { text: 'He said "hi", then left', multi: "line 1\nline 2", semi: "a;b", uni: "Zoë – 東京 🎉" },
      { text: " padded ", multi: "", semi: "plain", uni: "é" },
    ];
    for (const delimiter of [",", ";", "\t"] as const) {
      const csv = toCsv(v, { delimiter, header: true, flatten: true });
      const back = parseCsv(csv, { delimiter: "auto", header: true, flatten: true, types: true });
      expect(back.value).toEqual(v);
      expect(back.delimiter).toBe(delimiter);
    }
  });

  it("round-trips nested JSON through CSV", () => {
    const json =
      '[{"id":1,"user":{"name":"Ada","langs":["en","fr"]},"ok":true},{"id":2,"user":{"name":"Bob","langs":["de","es"]},"ok":false}]';
    const csv = ok(json, { to: "csv" });
    expect(csv.split("\n")[0]).toBe("id,user.name,user.langs.0,user.langs.1,ok");
    expect(JSON.parse(ok(csv, { from: "csv", to: "json" }))).toEqual(JSON.parse(json));
  });

  it("keeps nested values as JSON text when not flattening", () => {
    const csv = ok('[{"a":{"b":1},"c":[1,2]}]', { to: "csv", flatten: false });
    expect(csv).toBe('a,c\n"{""b"":1}","[1,2]"');
  });

  it("only types cells that round-trip exactly", () => {
    expect(typedCell("42")).toBe(42);
    expect(typedCell("-3.25")).toBe(-3.25);
    expect(typedCell("true")).toBe(true);
    expect(typedCell("007")).toBe("007");
    expect(typedCell("1.10")).toBe("1.10");
    expect(typedCell("1e5")).toBe("1e5");
    expect(typedCell("12345678901234567890")).toBe(12345678901234567890n);
    expect(typedCell("")).toBe("");
    expect(typedCell("TRUE")).toBe("TRUE");
    const r = convert("zip,n\n01234,12345678901234567890", opts({ from: "csv", to: "json", indent: 0 }));
    expect(r.ok && r.output).toBe('[{"zip":"01234","n":12345678901234567890}]');
    expect(ok("a\n42", { from: "csv", to: "json", indent: 0, types: false })).toBe('[{"a":"42"}]');
  });

  it("handles no header row", () => {
    expect(ok("1,2\n3,4", { from: "csv", to: "json", indent: 0, header: false })).toBe("[[1,2],[3,4]]");
    expect(ok("[[1,2],[3,4]]", { to: "csv" })).toBe("1,2\n3,4");
    expect(ok('[{"a":1,"b":2}]', { to: "csv", header: false })).toBe("1,2");
  });

  it("strips a byte order mark", () => {
    expect(ok("﻿name,age\nAda,36", { to: "json", indent: 0 })).toBe('[{"name":"Ada","age":36}]');
    expect(ok('﻿{"a":1}', { to: "yaml" })).toBe("a: 1\n");
  });

  it("names blank and repeated headers and notes ragged rows", () => {
    const r = parseCsv("a,,a\n1,2,3\n4,5", { delimiter: "auto", header: true, flatten: true, types: true });
    expect(r.value).toEqual([
      { a: 1, column2: 2, a_2: 3 },
      { a: 4, column2: 5, a_2: null },
    ]);
    expect(r.notes[0]).toMatch(/1 row has/);
  });

  it("explains non-tabular data", () => {
    for (const [input, word] of [
      ["42", "a single number"],
      ['"hi"', "a single string"],
      ["[1,2]", "Item 1 is a single number"],
      ['[{"a":1},"x"]', "Item 2 is a single string"],
    ]) {
      const r = convert(input, opts({ from: "json", to: "csv" }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain(word);
    }
    expect(ok('{"a":1,"b":{"c":2}}', { to: "csv" })).toBe("a,b.c\n1,2");
  });

  it("reports an unclosed quote", () => {
    const r = convert('a,b\n1,"oops\n2,3', opts({ from: "csv", to: "json" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/quoted cell/);
  });

  it("uses the chosen delimiter on export", () => {
    expect(ok('[{"a":1,"b":2}]', { to: "csv", delimiter: ";" })).toBe("a;b\n1;2");
    expect(ok('[{"a":1,"b":2}]', { to: "csv", delimiter: "\t" })).toBe("a\tb\n1\t2");
  });
});

describe("convert", () => {
  it("returns empty output for empty input", () => {
    for (const to of ["json", "yaml", "csv"] as const) {
      const r = convert("   \n", opts({ to }));
      expect(r.ok && r.output).toBe("");
    }
    expect(ok("[]", { to: "csv" })).toBe("");
  });
});

describe("minifySql", () => {
  it("collapses whitespace and keeps strings intact", () => {
    expect(minifySql("SELECT  a ,\n  b\nFROM   t\nWHERE  x = 'two  spaces\n here'  ;")).toBe(
      "SELECT a,b FROM t WHERE x = 'two  spaces\n here';",
    );
    expect(minifySql(`SELECT "my  col", \`x  y\`, [z  w] FROM t`)).toBe('SELECT "my  col",`x  y`,[z  w] FROM t');
    expect(minifySql("SELECT 'it''s   ok' ,  1")).toBe("SELECT 'it''s   ok',1");
  });

  it("keeps line comments on their own line end", () => {
    expect(minifySql("SELECT a, -- the a\n  b\nFROM t -- end")).toBe("SELECT a, -- the a\nb FROM t -- end");
    expect(minifySql("SELECT /* keep  this */  1")).toBe("SELECT /* keep  this */ 1");
  });

  it("handles MySQL hash comments and backslash escapes only when asked", () => {
    expect(minifySql("SELECT 1 # note\n , 2", { hashComments: true })).toBe("SELECT 1 # note\n,2");
    expect(minifySql("SELECT a  #  b")).toBe("SELECT a # b");
    expect(minifySql("SELECT 'a\\'  b'  ,  1", { hashComments: true })).toBe("SELECT 'a\\'  b',1");
  });

  it("keeps PostgreSQL dollar-quoted bodies", () => {
    const body = "$$\nBEGIN\n  RETURN  1;\nEND;\n$$";
    expect(minifySql(`CREATE FUNCTION f() RETURNS int AS ${body}  LANGUAGE plpgsql;`)).toBe(
      `CREATE FUNCTION f() RETURNS int AS ${body} LANGUAGE plpgsql;`,
    );
    expect(minifySql("SELECT $1  ,  $2")).toBe("SELECT $1,$2");
  });
});

describe("markdown export helpers", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("finds a title", () => {
    expect(markdownTitle("intro\n\n## **Hello** [world](http://x)  \ntext")).toBe("Hello world");
    expect(markdownTitle("no heading", "Doc")).toBe("Doc");
    expect(markdownTitle("# Hi <b>there</b>")).toBe("Hi there");
    expect(fileNameFromTitle("Hello, World! 日本")).toBe("hello-world-日本");
    expect(fileNameFromTitle("***")).toBe("document");
  });

  it("counts remote images", () => {
    expect(remoteImageCount("![a](https://x.com/a.png) ![b](//cdn/b.png) ![c](data:image/png;base64,AA)")).toBe(2);
    expect(remoteImageCount('<img src="http://x/y.png"> [link](https://x.com)')).toBe(1);
    expect(remoteImageCount("![a][logo]\n\n[logo]: https://x.com/l.png")).toBe(1);
  });

  it("builds a standalone page with an escaped title", () => {
    const html = standaloneHtml("<Notes>", "<p>Hi</p>");
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<title>&lt;Notes&gt;</title>");
    expect(html).toContain("<p>Hi</p>");
  });
});

describe("describeSqlError", () => {
  it("shortens parser errors and keeps the position", () => {
    const eof = describeSqlError("Parse error at token: «EOF» at line 1 column 26\nUnexpected EOF token: {...}. Instead…", false);
    expect(eof).toEqual({ message: "Couldn't parse the SQL: the query ended too soon at line 1, column 26.", line: 1, column: 26 });
    const tok = describeSqlError('Parse error: Unexpected "@@x # hi\n " at line 1 column 8.\nThis likely happens…', true);
    expect(tok.message).toMatch(/didn't expect “@@x # hi” at line 1, column 8\. If this query/);
    expect(describeSqlError("Something else\nmore", false)).toEqual({ message: "Something else" });
  });
});
