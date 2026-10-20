// The five resume layouts. Each turns the same data into a page; styling lives in resume.css.
import { h } from "../ui";
import {
  type Basics,
  bulletLines,
  dateRange,
  displayUrl,
  type Education,
  type Experience,
  linkHref,
  type Resume,
  splitItems,
  TEMPLATES,
} from "./data";

type Child = Node | string | null | undefined | false;
const nodes = (xs: Child[]): (Node | string)[] => xs.filter((c): c is Node | string => !!c);
const el = (tag: keyof HTMLElementTagNameMap, cls: string, ...kids: Child[]) => h(tag, { class: cls }, ...nodes(kids));
const text = (tag: keyof HTMLElementTagNameMap, cls: string, value: string) => (value.trim() ? h(tag, { class: cls }, value.trim()) : null);

function link(value: string, kind: "web" | "email" | "phone"): Node | null {
  if (!value.trim()) return null;
  const href = linkHref(value, kind);
  const label = kind === "web" ? displayUrl(value) : value.trim();
  return href ? h("a", { href }, label) : document.createTextNode(label);
}

function contactItems(b: Basics): Node[] {
  return nodes([
    b.email.trim() && link(b.email, "email"),
    b.phone.trim() && link(b.phone, "phone"),
    b.location.trim() && document.createTextNode(b.location.trim()),
    b.website.trim() && link(b.website, "web"),
    b.linkedin.trim() && link(b.linkedin, "web"),
  ]) as Node[];
}

/** Contact details on one line, separated by dots. */
function contactLine(b: Basics, cls = "r-contact"): HTMLElement | null {
  const items = contactItems(b);
  if (!items.length) return null;
  return el("p", cls, ...items.flatMap((n, i) => (i ? [h("span", { class: "r-sep", "aria-hidden": "true" }, "•"), n] : [n])));
}

function section(title: string, cls: string, ...content: Child[]): HTMLElement | null {
  const kids = nodes(content);
  if (!kids.length) return null;
  return el("section", `r-section ${cls}`, h("h2", { class: "r-h2" }, title), el("div", "r-section-body", ...kids));
}

function experienceEntry(e: Experience): HTMLElement | null {
  if (!e.role.trim() && !e.company.trim() && !e.bullets.trim()) return null;
  const bullets = bulletLines(e.bullets);
  return el(
    "article",
    "r-entry",
    el(
      "div",
      "r-entry-head",
      el(
        "div",
        "r-entry-main",
        text("h3", "r-role", e.role),
        el(
          "p",
          "r-org",
          ...nodes([
            e.company.trim(),
            e.company.trim() && e.location.trim() ? h("span", { class: "r-loc" }, `, ${e.location.trim()}`) : e.location.trim(),
          ]),
        ),
      ),
      text("p", "r-dates", dateRange(e.start, e.end, e.current)),
    ),
    bullets.length ? el("ul", "r-bullets", ...bullets.map((b) => h("li", {}, b))) : null,
  );
}

function educationEntry(e: Education): HTMLElement | null {
  if (!e.degree.trim() && !e.school.trim()) return null;
  return el(
    "article",
    "r-entry",
    el(
      "div",
      "r-entry-head",
      el(
        "div",
        "r-entry-main",
        text("h3", "r-role", e.degree),
        el(
          "p",
          "r-org",
          ...nodes([
            e.school.trim(),
            e.school.trim() && e.location.trim() ? h("span", { class: "r-loc" }, `, ${e.location.trim()}`) : e.location.trim(),
          ]),
        ),
      ),
      text("p", "r-dates", dateRange(e.start, e.end, false)),
    ),
    text("p", "r-details", e.details),
  );
}

const summary = (r: Resume, title = "Summary") => section(title, "r-summary", text("p", "r-text", r.basics.summary));
const experience = (r: Resume, title = "Experience") => section(title, "r-experience", ...r.experience.map(experienceEntry));
const education = (r: Resume, title = "Education") => section(title, "r-education", ...r.education.map(educationEntry));

function skillsList(r: Resume): HTMLElement[] {
  return r.skills
    .filter((s) => s.items.trim())
    .map((s) => el("p", "r-skill", s.name.trim() ? h("strong", {}, `${s.name.trim()}: `) : null, splitItems(s.items).join(", ")));
}
function skillTags(r: Resume): HTMLElement[] {
  return r.skills
    .filter((s) => s.items.trim())
    .map((s) =>
      el("div", "r-skill-group", text("h3", "r-skill-name", s.name), el("ul", "r-tags", ...splitItems(s.items).map((i) => h("li", {}, i)))),
    );
}
const skills = (r: Resume, title = "Skills") => section(title, "r-skills", ...skillsList(r));

const projects = (r: Resume, title = "Projects") =>
  section(
    title,
    "r-projects",
    ...r.projects
      .filter((p) => p.name.trim() || p.description.trim())
      .map((p) =>
        el(
          "article",
          "r-entry r-small",
          el("div", "r-entry-head", text("h3", "r-role", p.name), p.link.trim() ? el("p", "r-dates", link(p.link, "web")) : null),
          text("p", "r-details", p.description),
        ),
      ),
  );

const certifications = (r: Resume, title = "Certifications") =>
  section(
    title,
    "r-certs",
    ...r.certifications
      .filter((c) => c.name.trim())
      .map((c) =>
        el(
          "p",
          "r-line",
          h("strong", {}, c.name.trim()),
          c.issuer.trim() ? ` — ${c.issuer.trim()}` : "",
          c.date.trim() ? h("span", { class: "r-dates" }, ` (${c.date.trim()})`) : null,
        ),
      ),
  );

const languages = (r: Resume, title = "Languages") =>
  section(
    title,
    "r-langs",
    ...r.languages
      .filter((l) => l.name.trim())
      .map((l) => el("p", "r-line", h("strong", {}, l.name.trim()), l.level.trim() ? ` — ${l.level.trim()}` : "")),
  );

function photo(r: Resume): HTMLElement | null {
  return r.basics.photo ? h("img", { class: "r-photo", src: r.basics.photo, alt: "" }) : null;
}

const name = (r: Resume) => text("h1", "r-name", r.basics.name || "Your Name");

// ---------- Layouts ----------

function classic(r: Resume): Child[] {
  return [
    el("header", "r-head", name(r), text("p", "r-title", r.basics.title), contactLine(r.basics)),
    summary(r, "Profile"),
    experience(r),
    education(r),
    skills(r),
    projects(r),
    certifications(r),
    languages(r),
  ];
}

function modern(r: Resume): Child[] {
  const contact = contactItems(r.basics);
  return [
    el(
      "aside",
      "r-side",
      photo(r),
      contact.length ? section("Contact", "r-contact-list", ...contact.map((c) => el("p", "r-line", c))) : null,
      section("Skills", "r-skills", ...skillTags(r)),
      languages(r),
      certifications(r),
    ),
    el(
      "div",
      "r-main",
      el("header", "r-head", name(r), text("p", "r-title", r.basics.title)),
      summary(r, "Profile"),
      experience(r),
      education(r),
      projects(r),
    ),
  ];
}

function minimal(r: Resume): Child[] {
  return [
    el("header", "r-head", name(r), text("p", "r-title", r.basics.title), contactLine(r.basics)),
    summary(r, "About"),
    experience(r),
    education(r),
    skills(r),
    projects(r),
    certifications(r),
    languages(r),
  ];
}

function executive(r: Resume): Child[] {
  return [
    el("header", "r-band", photo(r), el("div", "r-band-text", name(r), text("p", "r-title", r.basics.title), contactLine(r.basics))),
    el(
      "div",
      "r-body",
      summary(r, "Executive Summary"),
      experience(r, "Professional Experience"),
      education(r),
      skills(r, "Core Skills"),
      projects(r),
      certifications(r),
      languages(r),
    ),
  ];
}

function compact(r: Resume): Child[] {
  return [
    el("header", "r-head", name(r), text("p", "r-title", r.basics.title), contactLine(r.basics)),
    summary(r),
    skills(r),
    experience(r),
    education(r),
    projects(r),
    certifications(r),
    languages(r),
  ];
}

const LAYOUTS = { classic, modern, minimal, executive, compact };

export function renderResume(r: Resume): HTMLElement {
  const font = r.font === "default" ? TEMPLATES.find((t) => t.id === r.template)!.defaultFont : r.font;
  const root = el("div", `resume tpl-${r.template} font-${font} page-${r.pageSize}`, ...LAYOUTS[r.template](r));
  root.style.setProperty("--r-accent", r.template === "compact" ? "#111111" : r.accent);
  return root;
}
