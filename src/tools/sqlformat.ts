import { h, header, type Tool } from "../ui";

function render(): HTMLElement {
  const section = h("section", {}, header(tool), h("p", { class: "empty-hint" }, "Loading…"));
  // sql-formatter is large, so it's only downloaded when this tool is opened.
  import("../textconv/sqlformat-ui")
    .then((m) => m.mountSqlFormat(section, tool))
    .catch(() =>
      section.replaceChildren(
        header(tool),
        h("p", { class: "msg error" }, "The SQL formatter couldn't load. Check your connection and reload the page."),
      ),
    );
  return section;
}

export const tool: Tool = {
  id: "sql-format",
  name: "SQL Formatter",
  description: "Format or minify SQL for PostgreSQL, MySQL, SQLite, SQL Server, BigQuery, Oracle and Snowflake.",
  icon: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  keywords:
    "sql format beautify pretty print minify query postgres postgresql mysql sqlite tsql sql server bigquery oracle plsql snowflake",
  render,
};
