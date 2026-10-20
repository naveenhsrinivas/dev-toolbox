import "./resume.css";
import { button, debounce, h, header, icon, ICONS, message, type Tool, toast } from "../ui";
import {
  ACCENTS,
  blankItem,
  emptyResume,
  isEmpty,
  type ListKey,
  normalizeResume,
  type Resume,
  sampleResume,
  TEMPLATES,
  type TemplateId,
} from "./data";
import { renderResume } from "./templates";

const STORAGE_KEY = "resume:v1";
const MM = 96 / 25.4;
const PAGE_MM = { a4: [210, 297], letter: [215.9, 279.4] } as const;

type FieldDef = {
  key: string;
  label: string;
  kind?: "text" | "textarea" | "checkbox";
  placeholder?: string;
  full?: boolean;
  rows?: number;
  hint?: string;
};

const LISTS: { key: ListKey; title: string; add: string; fields: FieldDef[]; label: (item: Record<string, unknown>) => string }[] = [
  {
    key: "experience",
    title: "Experience",
    add: "Add job",
    fields: [
      { key: "role", label: "Job title", placeholder: "Senior Software Engineer" },
      { key: "company", label: "Company", placeholder: "Acme Inc." },
      { key: "start", label: "Start", placeholder: "Mar 2021" },
      { key: "end", label: "End", placeholder: "Jun 2024" },
      { key: "location", label: "Location", placeholder: "Remote" },
      { key: "current", label: "I work here now", kind: "checkbox" },
      {
        key: "bullets",
        label: "Achievements (one per line)",
        kind: "textarea",
        full: true,
        rows: 5,
        hint: "Start with a verb and include numbers: “Cut load time by 40%…”",
      },
    ],
    label: (i) => [i.role, i.company].filter((x) => String(x ?? "").trim()).join(" · ") || "New job",
  },
  {
    key: "education",
    title: "Education",
    add: "Add education",
    fields: [
      { key: "degree", label: "Degree", placeholder: "B.S. in Computer Science", full: true },
      { key: "school", label: "School", placeholder: "University of …", full: true },
      { key: "start", label: "Start", placeholder: "2015" },
      { key: "end", label: "End", placeholder: "2019" },
      { key: "location", label: "Location", full: true },
      { key: "details", label: "Details (optional)", kind: "textarea", full: true, rows: 2, placeholder: "Honours, GPA, thesis…" },
    ],
    label: (i) => String(i.degree || i.school || "").trim() || "New education",
  },
  {
    key: "skills",
    title: "Skills",
    add: "Add skill group",
    fields: [
      { key: "name", label: "Group (optional)", placeholder: "Languages", full: true },
      { key: "items", label: "Skills, separated by commas", kind: "textarea", full: true, rows: 2, placeholder: "TypeScript, Go, SQL" },
    ],
    label: (i) =>
      String(i.name || i.items || "")
        .trim()
        .slice(0, 40) || "New skills",
  },
  {
    key: "projects",
    title: "Projects",
    add: "Add project",
    fields: [
      { key: "name", label: "Name" },
      { key: "link", label: "Link (optional)", placeholder: "github.com/you/project" },
      { key: "description", label: "Description", kind: "textarea", full: true, rows: 2 },
    ],
    label: (i) => String(i.name ?? "").trim() || "New project",
  },
  {
    key: "certifications",
    title: "Certifications",
    add: "Add certification",
    fields: [
      { key: "name", label: "Name", full: true },
      { key: "issuer", label: "Issuer" },
      { key: "date", label: "Year", placeholder: "2024" },
    ],
    label: (i) => String(i.name ?? "").trim() || "New certification",
  },
  {
    key: "languages",
    title: "Languages",
    add: "Add language",
    fields: [
      { key: "name", label: "Language", placeholder: "Spanish" },
      { key: "level", label: "Level", placeholder: "Fluent" },
    ],
    label: (i) => String(i.name ?? "").trim() || "New language",
  },
];

function load(): Resume {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeResume(JSON.parse(saved));
  } catch {
    // Nothing saved, or storage blocked.
  }
  return sampleResume();
}

let fieldCount = 0;

export function mountResume(section: HTMLElement, tool: Pick<Tool, "name" | "description">) {
  let data = load();
  const open = new Set<string>(["basics"]);

  const status = h("div");
  const form = h("div", { class: "rs-form" });
  const templates = h("div", { class: "rs-templates", role: "group", "aria-label": "Template" });
  const settings = h("div", { class: "rs-settings" });
  const preview = h("div", { class: "rs-preview", "aria-label": "Resume preview" });
  const pageInfo = h("span");
  const importPicker = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  const photoPicker = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });

  const save = debounce(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      say("Couldn't save in this browser (storage is full or blocked). Use Export to keep a copy.", "warn");
    }
  }, 400);

  function say(text: string, kind: "info" | "error" | "ok" | "warn" = "info") {
    status.replaceChildren(text ? message(kind, text) : "");
  }

  // ---------- Preview ----------
  function drawPreview() {
    const page = renderResume(data);
    preview.replaceChildren(page);
    const [wMm, hMm] = PAGE_MM[data.pageSize];
    const pageW = wMm * MM;
    const pageH = hMm * MM;
    const s = Math.min(1, (preview.clientWidth || 600) / pageW);
    page.style.transform = `scale(${s})`;
    const height = Math.max(page.offsetHeight, pageH);
    preview.style.height = `${height * s}px`;
    const pagesCount = Math.max(1, Math.ceil((page.offsetHeight - 2) / pageH));
    for (let i = 1; i < pagesCount; i++) {
      const line = h("div", { class: "rs-break" }, h("span", {}, `Page ${i + 1}`));
      line.style.top = `${i * pageH * s}px`;
      preview.append(line);
    }
    pageInfo.textContent = `${pagesCount} page${pagesCount === 1 ? "" : "s"} · ${data.pageSize === "a4" ? "A4" : "US Letter"}`;
  }

  function drawTemplates() {
    const sample = isEmpty(data) ? sampleResume() : data;
    templates.replaceChildren(
      ...TEMPLATES.map((t) => {
        const page = renderResume({ ...sample, template: t.id, accent: data.accent, font: data.font, pageSize: "a4" });
        page.style.transform = `scale(${118 / (210 * MM)})`;
        const mini = h("span", { class: "rs-mini", "aria-hidden": "true", inert: true }, page);
        const b = button(h("span", {}, mini, h("strong", {}, t.name)), () => setTemplate(t.id), "rs-template", `${t.name}: ${t.blurb}`);
        b.setAttribute("aria-pressed", String(t.id === data.template));
        return b;
      }),
    );
    // Scale each thumbnail to its card's actual width.
    requestAnimationFrame(() => {
      for (const mini of templates.querySelectorAll<HTMLElement>(".rs-mini")) {
        const page = mini.firstElementChild as HTMLElement;
        page.style.transform = `scale(${mini.clientWidth / (210 * MM)})`;
      }
    });
  }

  const refresh = debounce(() => {
    drawPreview();
    drawTemplates();
  }, 150);

  function changed() {
    save();
    refresh();
  }

  function setTemplate(id: TemplateId) {
    data.template = id;
    const t = TEMPLATES.find((x) => x.id === id)!;
    say(`${t.name}: ${t.blurb}${!t.photo && data.basics.photo ? " (This template doesn't show a photo.)" : ""}`);
    save();
    drawPreview();
    drawTemplates();
  }

  // ---------- Settings ----------
  function drawSettings() {
    const font = h(
      "select",
      { "aria-label": "Font" },
      ...[
        ["default", "Template's font"],
        ["sans", "Sans-serif"],
        ["serif", "Serif"],
      ].map(([v, l]) => h("option", { value: v, selected: data.font === v }, l)),
    );
    font.addEventListener("change", () => {
      data.font = font.value as Resume["font"];
      changed();
    });
    const size = h(
      "select",
      { "aria-label": "Paper size" },
      h("option", { value: "a4", selected: data.pageSize === "a4" }, "A4"),
      h("option", { value: "letter", selected: data.pageSize === "letter" }, "US Letter"),
    );
    size.addEventListener("change", () => {
      data.pageSize = size.value as Resume["pageSize"];
      changed();
    });
    const custom = h("input", { type: "color", value: data.accent, "aria-label": "Custom accent colour" });
    custom.addEventListener("input", () => {
      data.accent = custom.value;
      changed();
      drawSettings();
    });
    settings.replaceChildren(
      h(
        "div",
        { class: "pe-swatches", role: "group", "aria-label": "Accent colour" },
        h("span", { class: "lbl" }, "Colour"),
        ...ACCENTS.map((c) => {
          const b = button(
            "",
            () => {
              data.accent = c;
              changed();
              drawSettings();
            },
            `pe-swatch${c === data.accent ? " on" : ""}`,
            `Accent ${c}`,
          );
          b.style.background = c;
          return b;
        }),
        custom,
      ),
      h("label", { class: "inline" }, "Font", font),
      h("label", { class: "inline" }, "Paper", size),
    );
  }

  // ---------- Form ----------
  function input(def: FieldDef, value: unknown, onInput: (v: string | boolean) => void): HTMLElement {
    const id = `rs${++fieldCount}`;
    if (def.kind === "checkbox") {
      const box = h("input", { type: "checkbox", id, checked: value === true });
      box.addEventListener("change", () => onInput(box.checked));
      return h("label", { class: `check${def.full ? " full" : ""}` }, box, def.label);
    }
    const control =
      def.kind === "textarea"
        ? h("textarea", { id, rows: def.rows ?? 3, placeholder: def.placeholder ?? "" })
        : h("input", { id, type: "text", placeholder: def.placeholder ?? "", autocomplete: "off" });
    control.value = String(value ?? "");
    control.addEventListener("input", () => onInput(control.value));
    return h(
      "div",
      { class: `field${def.full ? " full" : ""}` },
      h("label", { htmlFor: id }, def.label),
      control,
      def.hint ? h("p", { class: "hint" }, def.hint) : null,
    );
  }

  function card(key: string, title: string, count: string, ...body: Node[]): HTMLElement {
    const d = h(
      "details",
      { class: "rs-card", open: open.has(key) },
      h("summary", {}, title, h("span", { class: "rs-count" }, count)),
      h("div", { class: "rs-card-body" }, ...body),
    );
    d.addEventListener("toggle", () => (d.open ? open.add(key) : open.delete(key)));
    return d;
  }

  function basicsCard(): HTMLElement {
    const b = data.basics;
    const fields: FieldDef[] = [
      { key: "name", label: "Full name", placeholder: "Alex Morgan", full: true },
      { key: "title", label: "Job title / headline", placeholder: "Senior Software Engineer", full: true },
      { key: "email", label: "Email", placeholder: "you@example.com" },
      { key: "phone", label: "Phone", placeholder: "+1 555 0100" },
      { key: "location", label: "City", placeholder: "Austin, TX" },
      { key: "website", label: "Website", placeholder: "yoursite.com" },
      { key: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/you", full: true },
      {
        key: "summary",
        label: "Summary",
        kind: "textarea",
        rows: 4,
        full: true,
        hint: "2–4 sentences: who you are, your strongest results, what you're looking for.",
      },
    ];
    const photoRow = h(
      "div",
      { class: "rs-photo-row full" },
      b.photo ? h("img", { src: b.photo, alt: "Your photo" }) : null,
      button(b.photo ? "Change photo" : "Add photo", () => photoPicker.click(), "btn small"),
      b.photo
        ? button(
            "Remove",
            () => {
              data.basics.photo = "";
              changed();
              drawForm();
            },
            "btn small ghost",
          )
        : null,
      h("span", { class: "hint" }, "Shown in Modern and Executive. Many employers prefer no photo."),
    );
    return card(
      "basics",
      "Personal details",
      b.name,
      h(
        "div",
        { class: "rs-grid" },
        ...fields.map((f) =>
          input(f, b[f.key as keyof typeof b], (v) => {
            (data.basics as unknown as Record<string, string>)[f.key] = String(v);
            changed();
          }),
        ),
        photoRow,
      ),
    );
  }

  function listCard(def: (typeof LISTS)[number]): HTMLElement {
    const items = data[def.key] as unknown as Record<string, unknown>[];
    const move = (i: number, dir: number) => {
      const j = i + dir;
      if (j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      changed();
      drawForm();
    };
    const blocks = items.map((item, i) => {
      const label = h("strong", {}, def.label(item));
      return h(
        "div",
        { class: "rs-item" },
        h(
          "div",
          { class: "rs-item-head" },
          label,
          Object.assign(
            button(icon("m18 15-6-6-6 6"), () => move(i, -1), "icon-btn", "Move up"),
            { disabled: i === 0 },
          ),
          Object.assign(
            button(icon("m6 9 6 6 6-6"), () => move(i, 1), "icon-btn", "Move down"),
            { disabled: i === items.length - 1 },
          ),
          button(
            icon(ICONS.x),
            () => {
              items.splice(i, 1);
              changed();
              drawForm();
            },
            "icon-btn",
            "Remove",
          ),
        ),
        h(
          "div",
          { class: "rs-grid" },
          ...def.fields.map((f) =>
            input(f, item[f.key], (v) => {
              item[f.key] = v;
              label.textContent = def.label(item);
              changed();
            }),
          ),
        ),
      );
    });
    return card(
      def.key,
      def.title,
      items.length ? String(items.length) : "",
      ...blocks,
      button(
        h("span", {}, icon("M12 5v14M5 12h14"), def.add),
        () => {
          (items as unknown[]).push(blankItem[def.key]());
          open.add(def.key);
          changed();
          drawForm();
          // Focus the first field of the new entry.
          form
            .querySelector<HTMLElement>(`details[open] .rs-item:last-of-type input, details[open] .rs-item:last-of-type textarea`)
            ?.focus();
        },
        "btn small",
      ),
    );
  }

  function drawForm() {
    form.replaceChildren(basicsCard(), ...LISTS.map(listCard));
  }

  // ---------- Photo ----------
  photoPicker.addEventListener("change", async () => {
    const f = photoPicker.files?.[0];
    photoPicker.value = "";
    if (!f) return;
    try {
      // Shrink to a small square JPEG so it stays light in storage and in the PDF.
      const bmp = await createImageBitmap(f);
      const side = Math.min(bmp.width, bmp.height);
      const c = h("canvas", { width: 360, height: 360 });
      c.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 360, 360);
      data.basics.photo = c.toDataURL("image/jpeg", 0.85);
      if (!TEMPLATES.find((t) => t.id === data.template)!.photo) say("Photo added. Switch to Modern or Executive to show it.", "info");
      changed();
      drawForm();
    } catch {
      say("That image couldn't be read.", "error");
    }
  });

  // ---------- Import / export / print ----------
  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    h("a", { href: url, download: `${(data.basics.name || "resume").replace(/[^\w-]+/g, "-")}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Resume data exported");
  }

  importPicker.addEventListener("change", async () => {
    const f = importPicker.files?.[0];
    importPicker.value = "";
    if (!f) return;
    try {
      if (f.size > 5_000_000) throw new Error("too big");
      data = normalizeResume(JSON.parse(await f.text()));
      changed();
      redraw();
      say(`Imported ${f.name}.`, "ok");
    } catch {
      say("That file isn't a resume exported from here (it should be a .json file).", "error");
    }
  });

  function printPdf() {
    const root = h("div", { id: "resume-print", class: `page-${data.pageSize}` }, renderResume(data));
    document.getElementById("resume-print")?.remove();
    document.body.append(root);
    document.documentElement.classList.add("printing-resume");
    const title = document.title;
    // The browser suggests the page title as the PDF's file name.
    document.title = `${data.basics.name.trim() || "Resume"} - Resume`;
    const done = () => {
      root.remove();
      document.documentElement.classList.remove("printing-resume");
      document.title = title;
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
  }

  function redraw() {
    drawSettings();
    drawForm();
    drawPreview();
    drawTemplates();
  }

  const layout = h(
    "div",
    { class: "rs-layout" },
    h("div", { class: "rs-form-col" }, form),
    h(
      "div",
      { class: "rs-preview-col" },
      h("div", { class: "rs-preview-bar" }, pageInfo, button(h("span", {}, icon(ICONS.download), "Download PDF"), printPdf, "btn small")),
      preview,
      h(
        "p",
        { class: "footnote" },
        "Download PDF opens your browser's print window: choose “Save as PDF” as the destination. The text stays selectable, so applicant tracking systems can read it.",
      ),
    ),
  );

  section.replaceChildren(
    header(
      tool,
      button(h("span", {}, icon(ICONS.download), "Download PDF"), printPdf, "btn primary"),
      button("Export", exportJson, "btn", "Save your resume data as a file"),
      button("Import", () => importPicker.click(), "btn", "Load resume data from a file"),
      button(
        "Example",
        () => {
          if (!isEmpty(data) && !confirm("Replace what you've written with the example resume?")) return;
          const keep = { template: data.template, accent: data.accent, font: data.font, pageSize: data.pageSize };
          data = { ...sampleResume(), ...keep };
          changed();
          redraw();
        },
        "btn ghost",
      ),
      button(
        "Start over",
        () => {
          if (!confirm("Clear everything and start a blank resume?")) return;
          const keep = { template: data.template, accent: data.accent, font: data.font, pageSize: data.pageSize };
          data = { ...emptyResume(), ...keep };
          changed();
          redraw();
        },
        "btn ghost",
      ),
      importPicker,
      photoPicker,
    ),
    h("h2", {}, "Template"),
    templates,
    settings,
    status,
    layout,
    h(
      "p",
      { class: "footnote" },
      "Everything is saved automatically in this browser only. Use Export to back it up or move it to another device.",
    ),
  );

  redraw();
  new ResizeObserver(debounce(() => section.isConnected && (drawPreview(), drawTemplates()), 100)).observe(preview);
}
