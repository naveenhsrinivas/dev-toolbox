import { type Charset, generatePassword, type PasswordOptions, passwordEntropy, strengthLabel } from "../lib/password";
import { button, checkbox, copyText, h, header, icon, ICONS, message, type Tool } from "../ui";

function render(): HTMLElement {
  const options: PasswordOptions = { length: 20, sets: ["lower", "upper", "digits", "symbols"], excludeAmbiguous: false };
  let count = 1;

  const display = h("div", { class: "pw-list", "aria-live": "polite" });
  const strength = h("div", { class: "strength" });
  const error = h("div");

  const range = h("input", { type: "range", min: 4, max: 128, value: options.length, "aria-label": "Length" });
  const number = h("input", { type: "number", min: 4, max: 128, value: options.length, class: "num-input", "aria-label": "Length" });

  function generate() {
    error.replaceChildren();
    try {
      const passwords = Array.from({ length: count }, () => generatePassword(options));
      display.replaceChildren(
        ...passwords.map((p) =>
          h(
            "div",
            { class: "pw" },
            h("code", {}, p),
            button(icon(ICONS.copy), () => copyText(p, "Password"), "icon-btn", "Copy password"),
          ),
        ),
      );
      const bits = passwordEntropy(options);
      const s = strengthLabel(bits);
      strength.replaceChildren(
        h("div", { class: `meter level-${s.level}` }, h("span"), h("span"), h("span"), h("span")),
        h("span", {}, `${s.label} · about ${Math.round(bits)} bits of entropy`),
      );
    } catch (err) {
      display.replaceChildren();
      strength.replaceChildren();
      error.replaceChildren(message("error", (err as Error).message));
    }
  }

  const setLength = (n: number) => {
    options.length = Math.min(128, Math.max(4, Math.round(n) || 4));
    range.value = number.value = String(options.length);
    generate();
  };
  range.addEventListener("input", () => setLength(Number(range.value)));
  number.addEventListener("change", () => setLength(Number(number.value)));

  const setBox = (set: Charset, label: string) =>
    checkbox(label, options.sets.includes(set), (on) => {
      options.sets = on ? [...options.sets, set] : options.sets.filter((s) => s !== set);
      generate();
    });

  const countSelect = h(
    "select",
    { "aria-label": "How many passwords" },
    ...[1, 5, 10, 25].map((n) => h("option", { value: n, selected: n === count }, n === 1 ? "1 password" : `${n} passwords`)),
  );
  countSelect.addEventListener("change", () => {
    count = Number(countSelect.value);
    generate();
  });

  generate();
  return h(
    "section",
    {},
    header(
      tool,
      button(h("span", {}, icon(ICONS.refresh), "Generate"), generate, "btn primary"),
      button(
        h("span", {}, icon(ICONS.copy), "Copy all"),
        () => copyText([...display.querySelectorAll("code")].map((c) => c.textContent).join("\n"), count === 1 ? "Password" : "Passwords"),
        "btn",
      ),
    ),
    display,
    strength,
    error,
    h(
      "div",
      { class: "panel" },
      h("div", { class: "length-row" }, h("span", { class: "lbl" }, "Length"), range, number),
      h(
        "div",
        { class: "checks" },
        setBox("lower", "Lowercase (a–z)"),
        setBox("upper", "Uppercase (A–Z)"),
        setBox("digits", "Numbers (0–9)"),
        setBox("symbols", "Symbols (!@#$…)"),
      ),
      h(
        "div",
        { class: "checks" },
        checkbox("Avoid look-alike characters (l, 1, I, O, 0…)", !!options.excludeAmbiguous, (v) => {
          options.excludeAmbiguous = v;
          generate();
        }),
        countSelect,
      ),
    ),
    h(
      "p",
      { class: "footnote" },
      "Made with your browser's cryptographic random generator (crypto.getRandomValues). Nothing is stored or sent.",
    ),
  );
}

export const tool: Tool = {
  id: "password",
  name: "Password Generator",
  description: "Strong random passwords, generated securely on your device.",
  icon: "M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2",
  keywords: "password generator random secure strong passphrase secret",
  render,
};
