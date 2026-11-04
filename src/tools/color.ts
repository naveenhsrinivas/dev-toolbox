import "../devtools-extra/color.css";
import {
  allFormats,
  composite,
  contrastChecks,
  contrastRatio,
  formatRatio,
  parseColor,
  type Rgba,
  suggestForeground,
  tintsAndShades,
  toHex,
  toHex6,
} from "../lib/color";
import { button, copyText, h, header, icon, ICONS, kvTable, message, type Tool } from "../ui";

const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };

/** A text box plus a native colour picker that stay in sync. Calls `onchange` with each valid colour. */
function colorInput(label: string, id: string, initial: string, onchange: (c: Rgba | null) => void) {
  const text = h("input", { type: "text", id, value: initial, class: "mono", spellcheck: false, autocomplete: "off" });
  const picker = h("input", { type: "color", class: "cc-picker", "aria-label": `${label} picker`, title: "Pick a colour" });
  const status = h("div", { class: "cc-status" });
  let current: Rgba | null = null;

  function read(fromPicker = false) {
    const r = parseColor(text.value);
    text.setAttribute("aria-invalid", String(!r.ok && text.value.trim() !== ""));
    status.replaceChildren();
    if (!r.ok) {
      current = null;
      if (text.value.trim()) status.append(message("error", r.error));
    } else {
      current = r.color;
      if (!fromPicker) picker.value = toHex6(r.color);
      if (r.outOfGamut)
        status.append(
          message("warn", "That colour is outside what most screens (sRGB) can show, so it's shown as the nearest one that fits."),
        );
    }
    onchange(current);
  }
  text.addEventListener("input", () => read());
  picker.addEventListener("input", () => {
    // The picker has no alpha, so keep any transparency the text had.
    const a = current?.a ?? 1;
    const picked = parseColor(picker.value);
    if (!picked.ok) return;
    text.value = toHex({ ...picked.color, a });
    read(true);
  });

  return {
    row: h("div", { class: "cc-input" }, picker, text),
    status,
    set(value: string) {
      text.value = value;
      read();
    },
    get: () => current,
    text,
    init: () => read(),
  };
}

function swatch(color: Rgba, cls = "cc-swatch"): HTMLElement {
  const inner = h("span", { class: "cc-fill" });
  inner.style.backgroundColor = toHex(color);
  return h("span", { class: cls, "aria-hidden": "true" }, inner);
}

function render(): HTMLElement {
  // ---------- Converter ----------
  const bigSwatch = h("div", { class: "cc-big-swatch cc-checker", "aria-hidden": "true" }, h("span", { class: "cc-fill" }));
  const formats = h("div");
  const scale = h("div", { class: "cc-scale" });
  const toContrast = h("div", { class: "row-actions" });

  const main = colorInput("Colour", "cc-main", "#4f46e5", (c) => {
    if (!c) {
      formats.replaceChildren();
      scale.replaceChildren();
      toContrast.hidden = true;
      return;
    }
    (bigSwatch.firstElementChild as HTMLElement).style.backgroundColor = toHex(c);
    formats.replaceChildren(kvTable(allFormats(c)));
    toContrast.hidden = false;
    scale.replaceChildren(
      ...tintsAndShades(c).map(({ label, color }) => {
        const hex = toHex(color);
        return h(
          "button",
          {
            type: "button",
            class: `cc-step${label === "Base" ? " base" : ""}`,
            title: `${label} · click to copy ${hex}`,
            onclick: () => copyText(hex, hex),
          },
          swatch(color, "cc-step-swatch"),
          h("span", { class: "cc-step-hex" }, hex),
          h("span", { class: "cc-step-label" }, label),
        );
      }),
    );
  });

  // ---------- Contrast ----------
  const ratioEl = h("div", { class: "cc-ratio", "aria-live": "polite" });
  const checksEl = h("ul", { class: "cc-checks" });
  const sample = h(
    "div",
    { class: "cc-sample" },
    h("p", { class: "cc-sample-normal" }, "Normal text at 16px. The quick brown fox jumps over the lazy dog."),
    h("p", { class: "cc-sample-large" }, "Large text at 24px"),
    h(
      "p",
      { class: "cc-sample-ui" },
      h("span", { class: "cc-sample-button" }, "Button outline"),
      h("span", { class: "cc-sample-icon" }, "★"),
    ),
  );
  const alphaNote = h("div");
  const suggestion = h("div", { class: "cc-suggestion" });
  const results = h("div", { class: "cc-results" });

  let fgColor: Rgba | null = null;
  let bgColor: Rgba | null = null;

  function updateContrast() {
    suggestion.replaceChildren();
    if (!fgColor || !bgColor) {
      results.hidden = true;
      return;
    }
    results.hidden = false;
    const ratio = contrastRatio(fgColor, bgColor);
    const checks = contrastChecks(ratio);
    const aa = checks.find((c) => c.id === "aa")!;
    ratioEl.replaceChildren(
      h("span", { class: "cc-ratio-num" }, formatRatio(ratio)),
      h(
        "span",
        { class: "cc-ratio-note" },
        aa.pass ? "Readable for body text (AA)" : ratio >= 3 ? "Only OK for large text and UI parts" : "Too low for text",
      ),
    );
    checksEl.replaceChildren(
      ...checks.map((c) =>
        h(
          "li",
          {},
          h("span", { class: `cc-badge ${c.pass ? "pass" : "fail"}` }, c.pass ? "Pass" : "Fail"),
          h("span", {}, h("strong", {}, c.label), h("span", { class: "hint" }, c.detail)),
        ),
      ),
    );
    const back = composite(bgColor, WHITE);
    sample.style.backgroundColor = toHex(back);
    sample.style.color = toHex(composite(fgColor, back));
    alphaNote.replaceChildren(
      fgColor.a < 1 || bgColor.a < 1
        ? message("info", "See-through colours are measured as they'd look: the text over the background, and the background over white.")
        : "",
    );
  }

  const fg = colorInput("Text colour", "cc-fg", "#777777", (c) => {
    fgColor = c;
    updateContrast();
  });
  const bg = colorInput("Background colour", "cc-bg", "#ffffff", (c) => {
    bgColor = c;
    updateContrast();
  });

  function suggest(target: number, name: string) {
    if (!fgColor || !bgColor) return;
    const before = contrastRatio(fgColor, bgColor);
    if (before >= target) {
      suggestion.replaceChildren(message("ok", `This text colour already passes ${name} (${target}:1).`));
      return;
    }
    const s = suggestForeground(fgColor, bgColor, target);
    if (!s) {
      suggestion.replaceChildren(
        message("warn", `No text colour reaches ${target}:1 on this background. Try a lighter or darker background.`),
      );
      return;
    }
    const hex = toHex(s);
    suggestion.replaceChildren(
      h(
        "div",
        { class: "cc-suggest-row" },
        swatch(s),
        h("code", {}, hex),
        h("span", { class: "hint" }, `${formatRatio(contrastRatio(s, bgColor))} · passes ${name}, closest lightness to yours`),
        button("Use it", () => fg.set(hex), "btn small primary"),
        button(icon(ICONS.copy), () => copyText(hex, hex), "icon-btn", `Copy ${hex}`),
      ),
    );
  }

  toContrast.append(
    button("Use as text colour", () => main.get() && fg.set(toHex(main.get()!)), "btn small"),
    button("Use as background", () => main.get() && bg.set(toHex(main.get()!)), "btn small"),
  );

  results.append(
    h("div", { class: "cc-summary" }, ratioEl, checksEl),
    sample,
    alphaNote,
    h(
      "div",
      { class: "row-actions" },
      button("Suggest a passing text colour (AA)", () => suggest(4.5, "AA"), "btn small"),
      button("Suggest for AAA", () => suggest(7, "AAA"), "btn small"),
    ),
    suggestion,
  );

  const section = h(
    "section",
    {},
    header(tool),
    h(
      "div",
      { class: "panel cc-converter" },
      bigSwatch,
      h(
        "div",
        { class: "cc-main" },
        h(
          "div",
          { class: "field" },
          h("label", { htmlFor: "cc-main" }, "Colour"),
          main.row,
          h("p", { class: "hint" }, "HEX, rgb(), hsl(), hwb(), oklch() or a CSS name like rebeccapurple."),
        ),
        main.status,
        toContrast,
      ),
    ),
    formats,
    h("h2", {}, "Tints and shades"),
    h("p", { class: "hint" }, "Mixed with white and black. Click one to copy its HEX."),
    scale,
    h("h2", {}, "Contrast checker"),
    h(
      "div",
      { class: "cc-pair" },
      h("div", { class: "field" }, h("label", { htmlFor: "cc-fg" }, "Text colour"), fg.row, fg.status),
      button(
        icon(ICONS.swap),
        () => {
          const [a, b] = [fg.text.value, bg.text.value];
          fg.set(b);
          bg.set(a);
        },
        "icon-btn cc-swap",
        "Swap text and background",
      ),
      h("div", { class: "field" }, h("label", { htmlFor: "cc-bg" }, "Background colour"), bg.row, bg.status),
    ),
    results,
    h("p", { class: "footnote" }, "Contrast uses the WCAG 2.x formula. Ratios are rounded down, so 4.499 never shows as a pass."),
  );
  main.init();
  fg.init();
  bg.init();
  return section;
}

export const tool: Tool = {
  id: "color",
  name: "Color Converter",
  description: "Convert colours between HEX, RGB, HSL, HWB and OKLCH, and check text contrast against WCAG.",
  icon: "M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 21 9.8C21 6 17 3 12 3zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01M17 11.5h.01",
  keywords: "color colour converter hex rgb hsl hwb oklch picker contrast wcag accessibility a11y tint shade palette css named",
  render,
};
