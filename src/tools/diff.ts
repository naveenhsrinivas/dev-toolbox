import { compareTexts, type DiffResult, type Row, type Segment, type Side } from "../lib/diff";
import { button, checkbox, debounce, field, h, header, icon, ICONS, message, plural, segmented, textarea, type Tool } from "../ui";

const CONTEXT = 3;

function lineContent(side: Side): Node[] {
  if (!side.segments) return [document.createTextNode(side.text || " ")];
  const nodes = side.segments.map((s: Segment) => (s.changed ? h("mark", {}, s.text) : document.createTextNode(s.text)));
  return nodes.length ? nodes : [document.createTextNode(" ")];
}

/** Indices of "same" rows to hide when only changes (plus context) are shown. */
function hiddenRows(rows: Row[]): Set<number> {
  const keep = new Set<number>();
  rows.forEach((r, i) => {
    if (r.kind !== "same") for (let k = i - CONTEXT; k <= i + CONTEXT; k++) keep.add(k);
  });
  const hidden = new Set<number>();
  rows.forEach((r, i) => r.kind === "same" && !keep.has(i) && hidden.add(i));
  return hidden;
}

function render(): HTMLElement {
  let view: "split" | "unified" = matchMedia("(max-width: 760px)").matches ? "unified" : "split";
  let ignoreWhitespace = false;
  let ignoreCase = false;
  let onlyChanges = false;
  let result: DiffResult | undefined;
  const expanded = new Set<number>();

  const left = textarea({ placeholder: "Paste the original text…", rows: 12 });
  const right = textarea({ placeholder: "Paste the changed text…", rows: 12 });
  const status = h("div", { class: "diff-status" });
  const out = h("div", { class: "diff-out" });

  function table(): HTMLElement {
    const rows = result!.rows;
    const hidden = onlyChanges ? hiddenRows(rows) : new Set<number>();
    const body = h("tbody");
    const cell = (cls: string, ...c: (Node | string)[]) => h("td", { class: cls }, ...c);
    for (let i = 0; i < rows.length; i++) {
      if (hidden.has(i) && !expanded.has(i)) {
        let end = i;
        while (hidden.has(end + 1) && !expanded.has(end + 1)) end++;
        const start = i;
        const count = end - start + 1;
        body.append(
          h(
            "tr",
            { class: "fold" },
            h(
              "td",
              { colSpan: view === "split" ? 4 : 3 },
              button(
                `⋯ Show ${plural(count, "unchanged line")}`,
                () => {
                  for (let k = start; k <= end; k++) expanded.add(k);
                  draw();
                },
                "link",
              ),
            ),
          ),
        );
        i = end;
        continue;
      }
      const r = rows[i];
      if (view === "split") {
        const l = "left" in r ? r.left : undefined;
        const rt = "right" in r ? r.right : undefined;
        const lcls = r.kind === "removed" || r.kind === "change" ? "del" : r.kind === "added" ? "empty" : "";
        const rcls = r.kind === "added" || r.kind === "change" ? "ins" : r.kind === "removed" ? "empty" : "";
        body.append(
          h(
            "tr",
            {},
            cell(`num ${lcls}`, l ? String(l.line) : ""),
            cell(`code ${lcls}`, ...(l ? lineContent(l) : [])),
            cell(`num ${rcls}`, rt ? String(rt.line) : ""),
            cell(`code ${rcls}`, ...(rt ? lineContent(rt) : [])),
          ),
        );
      } else {
        const line = (cls: string, ln: string, rn: string, sign: string, side: Side) =>
          h(
            "tr",
            {},
            cell(`num ${cls}`, ln),
            cell(`num ${cls}`, rn),
            cell(`code ${cls}`, h("span", { class: "sign" }, sign), ...lineContent(side)),
          );
        if (r.kind === "same") body.append(line("", String(r.left.line), String(r.right.line), " ", r.right));
        if (r.kind === "removed" || r.kind === "change") body.append(line("del", String(r.left.line), "", "−", r.left));
        if (r.kind === "added" || r.kind === "change") body.append(line("ins", "", String(r.right.line), "+", r.right));
      }
    }
    return h("div", { class: "diff-scroll" }, h("table", { class: `diff ${view}` }, body));
  }

  function draw() {
    if (!result) return;
    out.replaceChildren(result.identical ? message("ok", "The two texts are identical.") : table());
  }

  const compute = () => {
    expanded.clear();
    if (!left.value && !right.value) {
      result = undefined;
      status.replaceChildren();
      out.replaceChildren(h("p", { class: "empty-hint" }, "Paste text into both boxes to see the differences."));
      return;
    }
    result = compareTexts(left.value, right.value, { ignoreWhitespace, ignoreCase });
    if (!result) {
      status.replaceChildren();
      out.replaceChildren(message("error", "These texts are too large and too different to compare quickly."));
      return;
    }
    status.replaceChildren(
      h("span", { class: "stat ins" }, `+${result.added.toLocaleString()} added`),
      h("span", { class: "stat del" }, `−${result.removed.toLocaleString()} removed`),
      h("span", { class: "stat chg" }, `~${result.changed.toLocaleString()} changed`),
    );
    draw();
  };
  const update = debounce(compute, 200);
  left.addEventListener("input", update);
  right.addEventListener("input", update);

  const swap = () => {
    [left.value, right.value] = [right.value, left.value];
    compute();
  };
  const clear = () => {
    left.value = right.value = "";
    compute();
    left.focus();
  };

  compute();
  return h(
    "section",
    {},
    header(tool, button(h("span", {}, icon(ICONS.swap), "Swap"), swap, "btn"), button("Clear", clear, "btn ghost")),
    h("div", { class: "two-col" }, field("Original", left), field("Changed", right)),
    h(
      "div",
      { class: "options" },
      segmented(
        "View",
        [
          ["split", "Side by side"],
          ["unified", "Unified"],
        ],
        view,
        (v) => {
          view = v;
          draw();
        },
      ),
      checkbox("Ignore whitespace", ignoreWhitespace, (v) => {
        ignoreWhitespace = v;
        compute();
      }),
      checkbox("Ignore case", ignoreCase, (v) => {
        ignoreCase = v;
        compute();
      }),
      checkbox("Only show changes", onlyChanges, (v) => {
        onlyChanges = v;
        expanded.clear();
        draw();
      }),
      status,
    ),
    out,
  );
}

export const tool: Tool = {
  id: "diff",
  name: "Text Compare",
  description: "Find the differences between two texts, line by line and word by word.",
  icon: "M8 4v16M16 4v16M4 8h4M4 12h4M16 12h4M16 16h4",
  keywords: "diff compare difference changes text merge",
  render,
};
