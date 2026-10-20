// JSON formatting that keeps numbers exactly as written (no rounding of big or
// precise numbers), with error positions reported as line and column.

export type JsonResult = { ok: true; output: string; stats: JsonStats } | { ok: false; error: string; line?: number; column?: number };

export interface JsonStats {
  keys: number;
  depth: number;
}

export interface FormatOptions {
  /** Spaces per level, or "tab". 0 means minified. */
  indent: number | "tab";
  sortKeys?: boolean;
}

type RawJson = { readonly rawJSON: string };
const { rawJSON, isRawJSON } = JSON as unknown as { rawJSON?: (text: string) => RawJson; isRawJSON?: (value: unknown) => boolean };

function parseExact(text: string): unknown {
  if (!rawJSON) return JSON.parse(text);
  // Keep each number's original text, so 12345678901234567890 and 1.10 survive unchanged.
  return JSON.parse(text, function (this: unknown, _key: string, value: unknown, context?: { source?: string }) {
    return typeof value === "number" && context?.source !== undefined ? rawJSON(context.source) : value;
  } as (key: string, value: unknown) => unknown);
}

function isRaw(value: unknown): value is RawJson {
  return isRawJSON?.(value) ?? false;
}

function walk(value: unknown, sortKeys: boolean, depth: number, stats: JsonStats): unknown {
  stats.depth = Math.max(stats.depth, depth);
  if (Array.isArray(value)) return value.map((v) => walk(v, sortKeys, depth + 1, stats));
  if (value && typeof value === "object" && !isRaw(value)) {
    const keys = Object.keys(value);
    stats.keys += keys.length;
    if (sortKeys) keys.sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = walk((value as Record<string, unknown>)[k], sortKeys, depth + 1, stats);
    return out;
  }
  return value;
}

/** Line and column (1-based) of a character offset. */
export function positionToLineColumn(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, position);
  const line = before.split("\n").length;
  const column = position - before.lastIndexOf("\n");
  return { line, column };
}

/**
 * Find the first syntax error in invalid JSON. Browsers' own messages differ and
 * often leave out the position, so scan the text with a small JSON grammar.
 */
export function locateJsonError(text: string): { position: number; message: string } | undefined {
  let i = 0;
  const fail = (message: string, at = i): never => {
    throw { position: at, message };
  };
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const describe = () => (i >= text.length ? "the end of the input" : `"${text[i]}"`);
  const literal = (word: string) => {
    if (text.startsWith(word, i)) i += word.length;
    else fail(`Unexpected ${describe()}; expected a value`);
  };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') return void i++;
      if (c === "\\") {
        const e = text[i + 1];
        if (e === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail("Invalid \\u escape; it needs 4 hex digits");
          i += 6;
        } else if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
        else fail(`Invalid escape "\\${e ?? ""}" in string`);
      } else if (c < " ") fail(c === "\n" ? "Line break inside a string; use \\n" : "Control character inside a string");
      else i++;
    }
    fail("Unterminated string", start);
  };
  const number = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) fail(`Invalid number`);
    i += m![0].length;
    if (/[\d.eE]/.test(text[i] ?? "")) fail("Invalid number (leading zeros, or a dot without digits?)");
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return string();
    if (c === "-" || (c >= "0" && c <= "9")) return number();
    if (c === "t") return literal("true");
    if (c === "f") return literal("false");
    if (c === "n") return literal("null");
    if (c === "'") fail("Strings must use double quotes");
    fail(`Unexpected ${describe()}; expected a value`);
  };
  const object = () => {
    i++;
    ws();
    if (text[i] === "}") return void i++;
    for (;;) {
      ws();
      if (text[i] === "}") fail("Trailing comma before }");
      if (text[i] !== '"') fail(text[i] === "'" ? "Keys must use double quotes" : `Unexpected ${describe()}; expected a "key"`);
      string();
      ws();
      if (text[i] !== ":") fail(`Unexpected ${describe()}; expected ":"`);
      i++;
      value();
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") return void i++;
      fail(`Unexpected ${describe()}; expected "," or "}"`);
    }
  };
  const array = () => {
    i++;
    ws();
    if (text[i] === "]") return void i++;
    for (;;) {
      ws();
      if (text[i] === "]") fail("Trailing comma before ]");
      value();
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") return void i++;
      fail(`Unexpected ${describe()}; expected "," or "]"`);
    }
  };
  try {
    value();
    ws();
    if (i < text.length) fail(`Unexpected ${describe()} after the end of the JSON`);
    return undefined;
  } catch (err) {
    if (err && typeof err === "object" && "position" in err) return err as { position: number; message: string };
    throw err;
  }
}

function describeError(text: string, err: unknown): JsonResult {
  let found: ReturnType<typeof locateJsonError>;
  try {
    found = locateJsonError(text);
  } catch {
    // Nested too deeply for the scanner; fall back to the browser's message.
  }
  if (found) return { ok: false, error: found.message, ...positionToLineColumn(text, found.position) };
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

export function formatJson(text: string, options: FormatOptions): JsonResult {
  if (!text.trim()) return { ok: false, error: "Paste some JSON to format." };
  let parsed: unknown;
  try {
    parsed = parseExact(text);
  } catch (err) {
    return describeError(text, err);
  }
  const stats: JsonStats = { keys: 0, depth: 0 };
  const value = walk(parsed, !!options.sortKeys, 0, stats);
  const indent = options.indent === "tab" ? "\t" : options.indent;
  return { ok: true, output: JSON.stringify(value, null, indent), stats };
}
