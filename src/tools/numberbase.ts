import "../devtools-extra/numberbase.css";
import {
  autoWidth,
  bitLength,
  type BitOp,
  bitwise,
  fitsWidth,
  formatInteger,
  OPS,
  parseInteger,
  parseWithWidth,
  textBytes,
  toBits,
  toSigned,
  widthError,
  type Width,
} from "../lib/numberbase";
import { checkbox, copyButton, debounce, h, header, kvTable, message, plural, segmented, textarea, type Tool } from "../ui";

interface BaseField {
  key: string;
  base: () => number;
  input: HTMLInputElement;
  el: HTMLElement;
}

function render(): HTMLElement {
  let value: bigint | null = 42n;
  let width: Width | null = null;
  let group = false;
  let upper = true;
  let customBase = 36;
  // Set when the bit grid is clicked so the grid doesn't shrink as high bits are switched off.
  let gridWidth: Width | null = null;
  // A box whose text couldn't be read; other boxes still show the last good value.
  let failed: BaseField | null = null;

  const status = h("div", { class: "nb-status" });
  const info = h("p", { class: "nb-info" });
  const grid = h("div", { class: "nb-grid" });

  function show(v: bigint, base: number): string {
    const upperCase = upper && base > 10;
    if (!width || base === 10) return formatInteger(v, base, { group, upper: upperCase });
    return formatInteger(toBits(v, width), base, { width, group, upper: upperCase });
  }

  function makeField(key: string, label: string, base: () => number, extra?: HTMLElement): BaseField {
    const input = h("input", { type: "text", id: `nb-${key}`, class: "mono", spellcheck: false, autocomplete: "off", inputMode: "text" });
    const el = h(
      "div",
      { class: "field" },
      h(
        "div",
        { class: "label-row" },
        h("label", { htmlFor: input.id }, label),
        h(
          "div",
          { class: "row-actions" },
          extra ?? null,
          copyButton(() => input.value, "Copy", label),
        ),
      ),
      input,
    );
    const f: BaseField = { key, base, input, el };
    input.addEventListener("input", () => onType(f));
    return f;
  }

  const baseInput = h("input", { type: "number", min: 2, max: 36, value: customBase, class: "num-input", "aria-label": "Custom base" });
  const fields = [
    makeField("dec", "Decimal", () => 10),
    makeField("hex", "Hex", () => 16),
    makeField("bin", "Binary", () => 2),
    makeField("oct", "Octal", () => 8),
    makeField("custom", "Custom base", () => customBase, h("span", { class: "inline" }, baseInput)),
  ];
  baseInput.addEventListener("input", () => {
    const n = Number(baseInput.value);
    if (!Number.isInteger(n) || n < 2 || n > 36) return baseInput.setAttribute("aria-invalid", "true");
    baseInput.removeAttribute("aria-invalid");
    customBase = n;
    refresh();
  });

  function onType(f: BaseField) {
    gridWidth = null;
    failed = null;
    fields.forEach((x) => x.input.removeAttribute("aria-invalid"));
    if (!f.input.value.trim()) {
      value = null;
      status.replaceChildren();
      return refresh(f);
    }
    const r = width ? parseWithWidth(f.input.value, f.base(), width) : parseInteger(f.input.value, f.base());
    if (!r.ok) {
      f.input.setAttribute("aria-invalid", "true");
      status.replaceChildren(message("error", r.error));
      failed = f;
      return;
    }
    status.replaceChildren();
    value = r.value;
    refresh(f);
  }

  /** Redraw everything except the field being typed in. */
  function refresh(skip?: BaseField) {
    const fits = value === null || !width || fitsWidth(value, width);
    for (const f of fields) {
      if (f === skip) continue;
      f.input.value = value === null || (!fits && f.base() !== 10) ? "" : show(value, f.base());
    }
    if (!fits && value !== null && width) status.replaceChildren(message("error", widthError(value, width)));
    else if (!skip) status.replaceChildren();
    drawInfo(fits);
    drawGrid(fits);
    runCalc();
  }

  function drawInfo(fits: boolean) {
    info.replaceChildren();
    if (value === null || !fits) return;
    const bits = value < 0n ? bitLength(-value - 1n) + 1 : bitLength(value);
    const parts = [`Needs ${plural(bits, "bit")}${value < 0n ? " as a signed number" : ""}`, plural(Math.ceil(bits / 8), "byte")];
    if (width) {
      const pattern = toBits(value, width);
      parts.push(`As signed ${width}-bit: ${toSigned(pattern, width)}`, `as unsigned: ${pattern}`);
    }
    info.textContent = parts.join(" · ");
  }

  function drawGrid(fits: boolean) {
    grid.replaceChildren();
    if (value === null || !fits) return;
    const w = width ?? (gridWidth && value >= 0n && value < 1n << BigInt(gridWidth) ? gridWidth : autoWidth(value));
    if (!w) {
      grid.append(
        h(
          "p",
          { class: "hint" },
          value < 0n
            ? "Pick a bit size above to see how a negative number is stored."
            : `The bit grid shows numbers up to 64 bits; this one needs ${bitLength(value)}.`,
        ),
      );
      return;
    }
    const bits = toBits(value, w);
    const bytes: HTMLElement[] = [];
    for (let byte = w / 8 - 1; byte >= 0; byte--) {
      const cells: HTMLElement[] = [];
      for (let i = byte * 8 + 7; i >= byte * 8; i--) {
        const on = ((bits >> BigInt(i)) & 1n) === 1n;
        cells.push(
          h(
            "button",
            {
              type: "button",
              class: `nb-bit${on ? " on" : ""}`,
              "aria-pressed": String(on),
              "aria-label": `Bit ${i}`,
              title: `Bit ${i} (value ${1n << BigInt(i)})`,
              onclick: () => {
                failed = null;
                const next = bits ^ (1n << BigInt(i));
                value = width ? toSigned(next, width) : next;
                gridWidth = w;
                fields.forEach((x) => x.input.removeAttribute("aria-invalid"));
                refresh();
              },
            },
            h("span", { class: "nb-bit-val" }, on ? "1" : "0"),
            h("span", { class: "nb-bit-idx" }, String(i)),
          ),
        );
      }
      bytes.push(h("div", { class: "nb-byte" }, ...cells));
    }
    grid.append(...bytes);
  }

  // ---------- Bitwise calculator ----------
  let op: BitOp = "and";
  const aInput = h("input", { type: "text", id: "nb-a", class: "mono", value: "0b1100", spellcheck: false, autocomplete: "off" });
  const bInput = h("input", { type: "text", id: "nb-b", class: "mono", value: "0b1010", spellcheck: false, autocomplete: "off" });
  const opSelect = h("select", { id: "nb-op", "aria-label": "Operation" }, ...OPS.map(([v, label]) => h("option", { value: v }, label)));
  const bField = h("div", { class: "field" }, h("label", { htmlFor: "nb-b" }, "B"), bInput);
  const calcOut = h("div", { class: "nb-calc-out" });

  function runCalc() {
    bField.hidden = op === "not";
    const a = parseInteger(aInput.value, 10);
    const b = op === "not" ? ({ ok: true, value: 0n } as const) : parseInteger(bInput.value, 10);
    aInput.setAttribute("aria-invalid", String(!a.ok && aInput.value.trim() !== ""));
    bInput.setAttribute("aria-invalid", String(!b.ok && bInput.value.trim() !== ""));
    if (!a.ok || !b.ok) {
      const err = !a.ok ? `A: ${a.error}` : !b.ok ? `B: ${b.error}` : "";
      return calcOut.replaceChildren(aInput.value.trim() && (op === "not" || bInput.value.trim()) ? message("error", err) : "");
    }
    const r = bitwise(op, a.value, b.value, width ?? undefined);
    if (!r.ok) return calcOut.replaceChildren(message("error", r.error));
    calcOut.replaceChildren(
      kvTable([
        ["Decimal", show(r.value, 10)],
        ["Hex", `0x${show(r.value, 16)}`.replace("0x-", "-0x")],
        ["Binary", `0b${show(r.value, 2)}`.replace("0b-", "-0b")],
        ["Octal", `0o${show(r.value, 8)}`.replace("0o-", "-0o")],
      ]),
      !width && r.value < 0n
        ? h("p", { class: "hint" }, "Negative results are shown with a minus sign. Pick a bit size above to see the two's complement bits.")
        : "",
    );
  }
  for (const el of [aInput, bInput]) el.addEventListener("input", debounce(runCalc, 80));
  opSelect.addEventListener("change", () => {
    op = opSelect.value as BitOp;
    runCalc();
  });

  // ---------- Text to bytes ----------
  const textIn = textarea({ rows: 2, placeholder: "Type some text, e.g. Hi €", "aria-label": "Text to encode" });
  const textOut = h("div");
  function runText() {
    if (!textIn.value) return textOut.replaceChildren();
    const t = textBytes(textIn.value);
    textOut.replaceChildren(
      h(
        "p",
        { class: "hint" },
        `${plural([...textIn.value].length, "character")} · ${plural(t.bytes.length, "byte")} · ${t.ascii ? "plain ASCII" : "includes non-ASCII characters (multi-byte UTF-8)"}`,
      ),
      kvTable([
        ["Hex", t.hex],
        ["Binary", t.binary],
        ["Decimal", t.decimal],
      ]),
    );
  }
  textIn.addEventListener("input", debounce(runText, 100));

  const section = h(
    "section",
    {},
    header(tool),
    h(
      "div",
      { class: "options" },
      h(
        "span",
        { class: "inline" },
        h("span", { class: "lbl" }, "Two's complement"),
        segmented(
          "Two's complement bit size",
          [
            ["off", "Off"],
            ["8", "8-bit"],
            ["16", "16-bit"],
            ["32", "32-bit"],
            ["64", "64-bit"],
          ],
          "off",
          (v) => {
            width = v === "off" ? null : (Number(v) as Width);
            // Re-read a box that failed at the old size (e.g. 300 at 8 bits) so the new size can accept it.
            if (failed) return onType(failed);
            gridWidth = null;
            refresh();
          },
        ),
      ),
      checkbox("Group digits", group, (v) => {
        group = v;
        refresh();
      }),
      checkbox("Uppercase letters", upper, (v) => {
        upper = v;
        refresh();
      }),
    ),
    h("div", { class: "nb-fields" }, ...fields.map((f) => f.el)),
    status,
    info,
    h("p", { class: "hint" }, "Type in any box. Prefixes (0x, 0b, 0o), spaces, underscores, commas and a leading minus are fine."),
    h("h2", {}, "Bits"),
    h("p", { class: "hint" }, "Click a bit to flip it. Bit 0 is the lowest."),
    grid,
    h("h2", {}, "Bitwise calculator"),
    h(
      "div",
      { class: "nb-calc" },
      h("div", { class: "field" }, h("label", { htmlFor: "nb-a" }, "A"), aInput),
      h("div", { class: "field" }, h("label", { htmlFor: "nb-op" }, "Operation"), opSelect),
      bField,
    ),
    h("p", { class: "hint" }, "A and B are decimal unless you add 0x, 0b or 0o. Results wrap to the bit size chosen above."),
    calcOut,
    h("h2", {}, "Text to bytes"),
    textIn,
    textOut,
  );
  refresh();
  return section;
}

export const tool: Tool = {
  id: "number-base",
  name: "Number Base Converter",
  description: "Convert between binary, octal, decimal, hex and any base up to 36, with two's complement and bitwise maths.",
  icon: "M4 7h16M4 17h16M9 3 7 21M17 3l-2 18",
  keywords:
    "number base converter binary octal decimal hex hexadecimal radix bits bitwise twos complement signed unsigned bigint ascii utf-8 bytes",
  render,
};
