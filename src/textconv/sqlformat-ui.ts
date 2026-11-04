import "./textconv.css";
import { bigquery, formatDialect, mysql, plsql, postgresql, snowflake, sql, sqlite, transactsql, type DialectOptions } from "sql-formatter";
import { button, checkbox, copyButton, debounce, h, header, icon, ICONS, message, segmented, textarea, type Tool } from "../ui";
import { downloadText, inlineField, select, selectLineColumn } from "./common";
import { describeSqlError, minifySql } from "./sql";

type DialectId = "sql" | "postgresql" | "mysql" | "sqlite" | "transactsql" | "bigquery" | "plsql" | "snowflake";

// Only these dialects are imported, which keeps the download much smaller than all of sql-formatter.
const DIALECTS: Record<DialectId, { label: string; dialect: DialectOptions }> = {
  sql: { label: "Standard SQL", dialect: sql },
  postgresql: { label: "PostgreSQL", dialect: postgresql },
  mysql: { label: "MySQL / MariaDB", dialect: mysql },
  sqlite: { label: "SQLite", dialect: sqlite },
  transactsql: { label: "SQL Server (T-SQL)", dialect: transactsql },
  bigquery: { label: "BigQuery", dialect: bigquery },
  plsql: { label: "Oracle PL/SQL", dialect: plsql },
  snowflake: { label: "Snowflake", dialect: snowflake },
};

const SAMPLE = `select u.id, u.name, count(o.id) as orders, sum(o.total) as spent -- lifetime value
from users u left join orders o on o.user_id = u.id and o.status <> 'cancelled'
where u.created_at >= '2024-01-01' and u.email like '%@example.com'
group by u.id, u.name having count(o.id) > 2 order by spent desc limit 20;`;

export function mountSqlFormat(section: HTMLElement, tool: Tool) {
  let dialect: DialectId = "sql";
  let keywordCase: "preserve" | "upper" | "lower" = "upper";
  let indent: "2" | "4" | "tab" = "2";
  let minify = false;
  let lastError: { line?: number; column?: number } | undefined;

  const input = textarea({ placeholder: "Paste SQL here…", rows: 18, class: "mono" });
  const output = textarea({ rows: 18, readOnly: true, class: "mono", placeholder: "Formatted SQL appears here." });
  const status = h("div", { class: "status-line", "aria-live": "polite" });

  function format(text: string): string {
    return formatDialect(text, {
      dialect: DIALECTS[dialect].dialect,
      keywordCase,
      tabWidth: indent === "4" ? 4 : 2,
      useTabs: indent === "tab",
    });
  }

  function showError(raw: unknown) {
    const err = describeSqlError(raw instanceof Error ? raw.message : String(raw), dialect === "sql");
    lastError = err;
    input.setAttribute("aria-invalid", "true");
    status.replaceChildren(
      message("error", err.message),
      ...(err.line
        ? [button("Show me", () => lastError?.line && selectLineColumn(input, lastError.line, lastError.column), "btn small")]
        : []),
    );
  }

  function run() {
    lastError = undefined;
    input.removeAttribute("aria-invalid");
    status.replaceChildren();
    indentControl.classList.toggle("tc-disabled", minify);
    if (!input.value.trim()) {
      output.value = "";
      return;
    }
    const hashComments = dialect === "mysql";
    if (minify) {
      // Format first so the keyword case applies; if the parser can't read it, still collapse the whitespace.
      try {
        output.value = minifySql(format(input.value), { hashComments });
      } catch {
        output.value = minifySql(input.value, { hashComments });
        if (keywordCase !== "preserve")
          status.replaceChildren(
            message("warn", "Minified, but the keyword case wasn't changed because the SQL couldn't be parsed. Try another dialect."),
          );
      }
      return;
    }
    try {
      output.value = format(input.value);
    } catch (e) {
      output.value = "";
      showError(e);
    }
  }
  const update = debounce(run, 250);
  input.addEventListener("input", update);
  input.addEventListener("paste", () => setTimeout(run, 0));

  const indentControl = h(
    "span",
    {},
    segmented(
      "Indent",
      [
        ["2", "2 spaces"],
        ["4", "4 spaces"],
        ["tab", "Tabs"],
      ],
      indent,
      (v) => {
        indent = v;
        run();
      },
    ),
  );

  section.replaceChildren(
    header(
      tool,
      button(
        "Load sample",
        () => {
          input.value = SAMPLE;
          run();
        },
        "btn ghost",
      ),
      button(
        "Clear",
        () => {
          input.value = "";
          run();
          input.focus();
        },
        "btn ghost",
      ),
    ),
    h(
      "div",
      { class: "options" },
      inlineField(
        "Dialect",
        select(
          Object.entries(DIALECTS).map(([id, d]) => [id as DialectId, d.label]),
          dialect,
          (v) => {
            dialect = v;
            run();
          },
        ),
      ),
      inlineField(
        "Keywords",
        segmented(
          "Keyword case",
          [
            ["preserve", "Keep"],
            ["upper", "UPPER"],
            ["lower", "lower"],
          ],
          keywordCase,
          (v) => {
            keywordCase = v;
            run();
          },
        ),
      ),
      inlineField("Indent", indentControl),
      checkbox("Minify (one line)", minify, (v) => {
        minify = v;
        run();
      }),
    ),
    status,
    h(
      "div",
      { class: "two-col" },
      h("div", { class: "field" }, h("div", { class: "label-row" }, h("label", { htmlFor: (input.id = "sql-in") }, "SQL")), input),
      h(
        "div",
        { class: "field" },
        h(
          "div",
          { class: "label-row" },
          h("label", { htmlFor: (output.id = "sql-out") }, "Output"),
          h(
            "span",
            { class: "row-actions" },
            copyButton(() => output.value),
            button(
              h("span", {}, icon(ICONS.download), "Download"),
              () => output.value && downloadText(output.value, "query.sql", "application/sql"),
              "btn small",
            ),
          ),
        ),
        output,
      ),
    ),
    h(
      "p",
      { class: "footnote" },
      "Strings, quoted names and comments are never changed. Minify keeps a line break after -- comments so they don't swallow the rest of the query.",
    ),
  );
}
