// Collapse SQL onto as few lines as possible without touching strings,
// quoted names or comments. Pure, no DOM.

export interface MinifyOptions {
  /** MySQL treats `#` as the start of a line comment; elsewhere it's an operator. */
  hashComments?: boolean;
}

type Token = { kind: "space" | "line-comment" | "other"; text: string };

function tokenize(sql: string, opts: MinifyOptions): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let plain = "";
  const flush = () => {
    if (plain) tokens.push({ kind: "other", text: plain });
    plain = "";
  };
  const readQuoted = (close: string, doubled: boolean, backslash: boolean) => {
    let j = i + 1;
    while (j < sql.length) {
      if (backslash && sql[j] === "\\") j += 2;
      else if (sql[j] === close) {
        if (doubled && sql[j + 1] === close) j += 2;
        else return j + 1;
      } else j++;
    }
    return sql.length;
  };
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    let end = -1;
    if (/\s/.test(c)) {
      flush();
      let j = i;
      while (j < sql.length && /\s/.test(sql[j])) j++;
      tokens.push({ kind: "space", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if ((c === "-" && next === "-") || (c === "#" && opts.hashComments)) {
      flush();
      let j = sql.indexOf("\n", i);
      if (j === -1) j = sql.length;
      tokens.push({ kind: "line-comment", text: sql.slice(i, j).trimEnd() });
      i = j;
      continue;
    }
    if (c === "/" && next === "*") {
      const j = sql.indexOf("*/", i + 2);
      end = j === -1 ? sql.length : j + 2;
    } else if (c === "'") {
      // E'...' strings in PostgreSQL and MySQL strings allow backslash escapes.
      const prev = sql[i - 1];
      end = readQuoted("'", true, prev === "E" || prev === "e" || !!opts.hashComments);
    } else if (c === '"') end = readQuoted('"', true, false);
    else if (c === "`") end = readQuoted("`", true, false);
    else if (c === "[" && !/[\w\])]/.test(plain.slice(-1))) end = readQuoted("]", true, false);
    else if (c === "$") {
      // PostgreSQL dollar quoting: $$...$$ or $tag$...$tag$.
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (m && !/\w/.test(plain.slice(-1))) {
        const j = sql.indexOf(m[0], i + m[0].length);
        end = j === -1 ? sql.length : j + m[0].length;
      }
    }
    if (end !== -1) {
      plain += sql.slice(i, end);
      i = end;
    } else {
      plain += c;
      i++;
    }
  }
  flush();
  return tokens;
}

// No space is needed after these, or before the closing ones (a space stays after ")" for readability).
const TIGHT_AFTER = /[,;(]/;
const TIGHT_BEFORE = /[,;()]/;

export function minifySql(sql: string, opts: MinifyOptions = {}): string {
  const tokens = tokenize(sql, opts);
  let out = "";
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind === "space") {
      const prev = out.slice(-1);
      const next = tokens[k + 1]?.text[0] ?? "";
      if (!out || !next) continue;
      if (prev === "\n") continue;
      if (TIGHT_AFTER.test(prev) || TIGHT_BEFORE.test(next)) continue;
      out += " ";
    } else if (t.kind === "line-comment") {
      // A line comment must end with a line break, or it would swallow the rest of the query.
      out = out.replace(/ $/, "");
      out += (out && !out.endsWith("\n") ? " " : "") + t.text + "\n";
    } else {
      out += t.text;
    }
  }
  return out.trim();
}

/**
 * sql-formatter's parse errors include a long grammar dump. Keep the useful part:
 * what was unexpected and where.
 */
export function describeSqlError(raw: string, genericDialect: boolean): { message: string; line?: number; column?: number } {
  const short = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > 30 ? `${t.slice(0, 30)}…` : t;
  };
  let m = /^Parse error at token: ([\s\S]*?) at line (\d+) column (\d+)/.exec(raw);
  if (!m) m = /^Parse error: Unexpected "([\s\S]*?)" at line (\d+) column (\d+)/.exec(raw);
  if (m) {
    const what = m[1] === "«EOF»" ? "the query ended too soon" : `didn't expect “${short(m[1])}”`;
    const tip = genericDialect ? " If this query uses database-specific syntax, pick its dialect." : "";
    return { message: `Couldn't parse the SQL: ${what} at line ${m[2]}, column ${m[3]}.${tip}`, line: Number(m[2]), column: Number(m[3]) };
  }
  return { message: raw.split("\n")[0] || "Couldn't parse the SQL." };
}
