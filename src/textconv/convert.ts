// Conversion between JSON, YAML and CSV. Pure functions, no DOM.
//
// Values travel between formats as plain JS data, with one twist: integers too
// big to be exact as a JS number are kept as BigInt, so IDs like
// 12345678901234567890 survive every conversion unchanged.

import Papa from "papaparse";
import YAML from "yaml";
import { locateJsonError, positionToLineColumn } from "../lib/json";

export type Format = "json" | "yaml" | "csv";
export type Delimiter = "auto" | "," | ";" | "\t";

export interface ConvertOptions {
  from: Format | "auto";
  to: Format;
  /** JSON indentation; 0 means minified. */
  indent: 2 | 4 | "tab" | 0;
  delimiter: Delimiter;
  /** CSV has a header row (import) / write one (export). */
  header: boolean;
  /** Nested objects ⇄ dotted column names like `a.b`. */
  flatten: boolean;
  /** Turn CSV cells like 42, 1.5, true and false into numbers and booleans. */
  types: boolean;
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  from: "auto",
  to: "yaml",
  indent: 2,
  delimiter: "auto",
  header: true,
  flatten: true,
  types: true,
};

export type ConvertResult =
  { ok: true; output: string; from: Format; notes: string[] } | { ok: false; error: string; from?: Format; line?: number; column?: number };

export class ConvertError extends Error {
  line?: number;
  column?: number;
  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

export const FORMAT_NAMES: Record<Format, string> = { json: "JSON", yaml: "YAML", csv: "CSV" };

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Guess the format of some text. Returns "json" for anything that looks like it starts as JSON. */
export function detectFormat(text: string): Format {
  const t = stripBom(text).trim();
  if (!t) return "json";
  if (t[0] === "{" || t[0] === "[" || t[0] === '"') return "json";
  if (/^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)$/.test(t)) return "json";
  const lines = t.split(/\r?\n/).filter((l) => l.trim() && !l.trimStart().startsWith("#"));
  if (lines[0] === "---" || lines[0]?.startsWith("- ") || lines[0] === "-") return "yaml";
  // A YAML mapping key: `name:` or `name: value`, not inside quotes.
  const yamlKey = /^\s*("[^"]*"|'[^']*'|[^\s"',;\t][^:,;\t]*?):(\s|$)/;
  if (yamlKey.test(lines[0] ?? "")) return "yaml";
  // CSV: the first lines split into the same number (2+) of fields.
  const sample = lines.slice(0, 10).join("\n");
  const parsed = Papa.parse<string[]>(sample, { skipEmptyLines: true });
  const counts = parsed.data.map((r) => r.length);
  if (counts.length && counts[0] > 1 && counts.every((c) => c === counts[0])) return "csv";
  if (counts.length === 1 && counts[0] > 1) return "csv";
  return "yaml";
}

// ---------- JSON ----------

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text, function (_key: string, value: unknown, context?: { source?: string }) {
      // Big integers would be rounded as numbers, so keep their exact digits.
      if (typeof value === "number" && !Number.isSafeInteger(value) && context?.source && /^-?\d+$/.test(context.source)) {
        return BigInt(context.source);
      }
      return value;
    } as (key: string, value: unknown) => unknown);
  } catch (e) {
    const found = locateJsonError(text);
    if (found) {
      const { line, column } = positionToLineColumn(text, found.position);
      throw new ConvertError(found.message, line, column);
    }
    throw new ConvertError(e instanceof Error ? e.message : "This isn't valid JSON.");
  }
}

export function stringifyJson(value: unknown, indent: ConvertOptions["indent"]): string {
  const unit = indent === "tab" ? "\t" : " ".repeat(indent);
  const nl = indent === 0 ? "" : "\n";
  const colon = indent === 0 ? ":" : ": ";
  const write = (v: unknown, pad: string): string => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
    if (typeof v === "boolean") return String(v);
    if (typeof v === "string") return JSON.stringify(v);
    if (v instanceof Date) return JSON.stringify(v.toISOString());
    const inner = pad + unit;
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      return `[${nl}${v.map((x) => inner + write(x, inner)).join(`,${nl}`)}${nl}${pad}]`;
    }
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
      if (!entries.length) return "{}";
      return `{${nl}${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}${colon}${write(x, inner)}`).join(`,${nl}`)}${nl}${pad}}`;
    }
    return "null";
  };
  return write(value, "");
}

// ---------- YAML ----------

/** Turn BigInts that fit exactly into a JS number back into numbers. */
function shrinkInts(v: unknown): unknown {
  if (typeof v === "bigint") return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  if (Array.isArray(v)) return v.map(shrinkInts);
  if (v instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of v) out[String(k)] = shrinkInts(x);
    return out;
  }
  if (isPlainObject(v) && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = shrinkInts(x);
    return out;
  }
  return v;
}

export function parseYaml(text: string): { value: unknown; documents: number } {
  const docs = YAML.parseAllDocuments(text, { intAsBigInt: true, prettyErrors: true });
  if (!Array.isArray(docs)) return { value: null, documents: 0 };
  for (const doc of docs) {
    const err = doc.errors[0];
    if (err) {
      // The message repeats the position and a code excerpt after a colon; keep the first sentence.
      const message = err.message.split(/ at line \d+, column \d+/)[0].replace(/:\s*$/, "");
      const pos = err.linePos?.[0];
      throw new ConvertError(message, pos?.line, pos?.col);
    }
  }
  const values = docs.map((d) => shrinkInts(d.toJS({ maxAliasCount: 1000 })));
  return { value: values.length > 1 ? values : (values[0] ?? null), documents: values.length };
}

export function stringifyYaml(value: unknown): string {
  // lineWidth 0 stops long strings being folded over several lines.
  return YAML.stringify(value, { lineWidth: 0, aliasDuplicateObjects: false });
}

// ---------- CSV ----------

/** { a: { b: 1 }, c: [x, y] } → { "a.b": 1, "c.0": x, "c.1": y } */
export function flattenObject(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const visit = (v: unknown, path: string) => {
    if (Array.isArray(v) || (isPlainObject(v) && !(v instanceof Date))) {
      const entries = Object.entries(v);
      if (!entries.length) {
        // Keep empty containers visible rather than dropping the column.
        out[path] = Array.isArray(v) ? "[]" : "{}";
        return;
      }
      for (const [k, x] of entries) visit(x, path ? `${path}.${k}` : k);
    } else {
      out[path] = v;
    }
  };
  for (const [k, v] of Object.entries(value)) visit(v, k);
  return out;
}

/** The reverse of flattenObject. Objects whose keys are exactly 0..n-1 become arrays. */
export function unflattenObject(flat: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    if (parts.some((p) => p === "")) {
      root[key] = value;
      continue;
    }
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = node[parts[i]];
      if (!isPlainObject(next)) node[parts[i]] = {};
      node = node[parts[i]] as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = value;
  }
  const arrayify = (v: unknown): unknown => {
    if (!isPlainObject(v)) return v;
    const keys = Object.keys(v);
    const fixed = Object.fromEntries(keys.map((k) => [k, arrayify(v[k])]));
    if (keys.length && keys.every((k, i) => k === String(i))) return keys.map((k) => fixed[k]);
    return fixed;
  };
  return arrayify(root) as Record<string, unknown>;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "bigint" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  return stringifyJson(v, 0);
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "object") return "an object";
  if (typeof v === "string") return "a single string";
  return `a single ${typeof v}`;
}

export function toCsv(value: unknown, opts: Pick<ConvertOptions, "delimiter" | "header" | "flatten">): string {
  const delimiter = opts.delimiter === "auto" ? "," : opts.delimiter;
  // A single object is a one-row table.
  const rows = isPlainObject(value) ? [value] : value;
  if (!Array.isArray(rows)) {
    throw new ConvertError(`CSV needs a table: a list of objects (one per row). This data is ${describe(value)}.`);
  }
  if (!rows.length) return "";
  if (rows.every(Array.isArray)) {
    const data = (rows as unknown[][]).map((r) => r.map(cellText));
    return Papa.unparse(data, { delimiter, newline: "\n" });
  }
  const bad = rows.findIndex((r) => !isPlainObject(r));
  if (bad !== -1) {
    throw new ConvertError(
      `CSV needs a list where every item is an object (one per row) or every item is a list of cells. Item ${bad + 1} is ${describe(rows[bad])}.`,
    );
  }
  const records = (rows as Record<string, unknown>[]).map((r) => (opts.flatten ? flattenObject(r) : r));
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const r of records)
    for (const k of Object.keys(r))
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
  const data = records.map((r) => columns.map((c) => cellText(r[c])));
  return Papa.unparse({ fields: opts.header ? columns : [], data }, { delimiter, newline: "\n", header: opts.header });
}

const INTEGER = /^-?(0|[1-9]\d*)$/;
const DECIMAL = /^-?(0|[1-9]\d*)\.\d+$/;

/** Only convert cells whose text would come back unchanged, so "007" and "1.10" stay strings. */
export function typedCell(s: string): unknown {
  if (s === "true") return true;
  if (s === "false") return false;
  if (INTEGER.test(s)) {
    if (s === "-0") return s;
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : BigInt(s);
  }
  if (DECIMAL.test(s) && String(Number(s)) === s) return Number(s);
  return s;
}

export function parseCsv(
  text: string,
  opts: Pick<ConvertOptions, "delimiter" | "header" | "flatten" | "types">,
): { value: unknown[]; delimiter: string; notes: string[] } {
  const notes: string[] = [];
  const result = Papa.parse<string[]>(text, {
    delimiter: opts.delimiter === "auto" ? "" : opts.delimiter,
    skipEmptyLines: true,
    delimitersToGuess: [",", ";", "\t", "|"],
  });
  const fatal = result.errors.find((e) => e.type === "Quotes");
  if (fatal) {
    const row = (fatal.row ?? 0) + 1;
    throw new ConvertError(`A quoted cell is never closed (starting in row ${row}). Check for a missing " character.`);
  }
  const cell = (s: string): unknown => (opts.types ? typedCell(s) : s);
  const rows = result.data;
  if (!opts.header) return { value: rows.map((r) => r.map(cell)), delimiter: result.meta.delimiter, notes };
  const [head = [], ...body] = rows;
  // Make blank or repeated column names unique so no cells are lost.
  const used = new Map<string, number>();
  const columns = head.map((name, i) => {
    let key = name.trim() === "" ? `column${i + 1}` : name;
    const count = used.get(key) ?? 0;
    used.set(key, count + 1);
    if (count) key = `${key}_${count + 1}`;
    return key;
  });
  let ragged = 0;
  const value = body.map((r) => {
    if (r.length !== columns.length) ragged++;
    const obj: Record<string, unknown> = {};
    columns.forEach((c, i) => (obj[c] = i < r.length ? cell(r[i]) : null));
    for (let i = columns.length; i < r.length; i++) obj[`column${i + 1}`] = cell(r[i]);
    return opts.flatten ? unflattenObject(obj) : obj;
  });
  if (ragged) notes.push(`${ragged} ${ragged === 1 ? "row has" : "rows have"} a different number of cells than the header.`);
  return { value, delimiter: result.meta.delimiter, notes };
}

// ---------- Entry point ----------

const DELIMITER_NAMES: Record<string, string> = { ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" };

export function convert(input: string, opts: ConvertOptions): ConvertResult {
  const text = stripBom(input);
  const from = opts.from === "auto" ? detectFormat(text) : opts.from;
  if (!text.trim()) return { ok: true, output: "", from, notes: [] };
  const notes: string[] = [];
  try {
    let value: unknown;
    if (from === "json") value = parseJson(text);
    else if (from === "yaml") {
      const r = parseYaml(text);
      value = r.value;
      if (r.documents > 1) notes.push(`Found ${r.documents} YAML documents; they're combined into one list.`);
    } else {
      const r = parseCsv(text, opts);
      value = r.value;
      notes.push(...r.notes);
      if (opts.delimiter === "auto") notes.unshift(`CSV separated by ${DELIMITER_NAMES[r.delimiter] ?? JSON.stringify(r.delimiter)}.`);
    }
    let output: string;
    if (opts.to === "json") output = stringifyJson(value, opts.indent);
    else if (opts.to === "yaml") output = stringifyYaml(value);
    else output = toCsv(value, opts);
    return { ok: true, output, from, notes };
  } catch (e) {
    if (e instanceof ConvertError) return { ok: false, error: e.message, from, line: e.line, column: e.column };
    return { ok: false, error: e instanceof Error ? e.message : String(e), from };
  }
}
