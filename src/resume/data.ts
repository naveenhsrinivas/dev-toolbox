// Resume content and settings, with an example and safe loading of saved/imported data.

export type TemplateId = "classic" | "modern" | "minimal" | "executive" | "compact";
export type FontChoice = "default" | "sans" | "serif";
export type PageSize = "a4" | "letter";

export interface Basics {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
  /** A small JPEG data URL, or "". */
  photo: string;
  summary: string;
}

export interface Experience {
  id: string;
  role: string;
  company: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  /** One achievement per line. */
  bullets: string;
}

export interface Education {
  id: string;
  degree: string;
  school: string;
  location: string;
  start: string;
  end: string;
  details: string;
}

export interface SkillGroup {
  id: string;
  name: string;
  /** Comma-separated. */
  items: string;
}

export interface Project {
  id: string;
  name: string;
  link: string;
  description: string;
}

export interface Certification {
  id: string;
  name: string;
  issuer: string;
  date: string;
}

export interface Language {
  id: string;
  name: string;
  level: string;
}

export interface Resume {
  version: 1;
  template: TemplateId;
  accent: string;
  font: FontChoice;
  pageSize: PageSize;
  basics: Basics;
  experience: Experience[];
  education: Education[];
  skills: SkillGroup[];
  projects: Project[];
  certifications: Certification[];
  languages: Language[];
}

export type ListKey = "experience" | "education" | "skills" | "projects" | "certifications" | "languages";

export const TEMPLATES: { id: TemplateId; name: string; blurb: string; defaultFont: "sans" | "serif"; photo: boolean }[] = [
  {
    id: "classic",
    name: "Classic",
    blurb: "Traditional single column with serif type. Safe for any industry.",
    defaultFont: "serif",
    photo: false,
  },
  {
    id: "modern",
    name: "Modern",
    blurb: "Coloured sidebar for contact details and skills, with an optional photo.",
    defaultFont: "sans",
    photo: true,
  },
  {
    id: "minimal",
    name: "Minimal",
    blurb: "Lots of white space, section labels in a narrow left column.",
    defaultFont: "sans",
    photo: false,
  },
  {
    id: "executive",
    name: "Executive",
    blurb: "Bold header band in your accent colour; confident and senior.",
    defaultFont: "sans",
    photo: true,
  },
  {
    id: "compact",
    name: "Compact (ATS)",
    blurb: "Plain and dense. Reads cleanly in applicant tracking systems.",
    defaultFont: "sans",
    photo: false,
  },
];

export const ACCENTS = ["#1f4e79", "#2563eb", "#0f766e", "#7c3aed", "#be123c", "#c2410c", "#374151"];

let n = 0;
export const uid = () => `r${Date.now().toString(36)}${(n++).toString(36)}`;

export function emptyResume(): Resume {
  return {
    version: 1,
    template: "classic",
    accent: ACCENTS[0],
    font: "default",
    pageSize: "a4",
    basics: { name: "", title: "", email: "", phone: "", location: "", website: "", linkedin: "", photo: "", summary: "" },
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    languages: [],
  };
}

export const blankItem: { [K in ListKey]: () => Resume[K][number] } = {
  experience: () => ({ id: uid(), role: "", company: "", location: "", start: "", end: "", current: false, bullets: "" }),
  education: () => ({ id: uid(), degree: "", school: "", location: "", start: "", end: "", details: "" }),
  skills: () => ({ id: uid(), name: "", items: "" }),
  projects: () => ({ id: uid(), name: "", link: "", description: "" }),
  certifications: () => ({ id: uid(), name: "", issuer: "", date: "" }),
  languages: () => ({ id: uid(), name: "", level: "" }),
};

export function sampleResume(): Resume {
  return {
    ...emptyResume(),
    basics: {
      name: "Alex Morgan",
      title: "Senior Software Engineer",
      email: "alex.morgan@example.com",
      phone: "+1 555 0142",
      location: "Austin, TX",
      website: "alexmorgan.dev",
      linkedin: "linkedin.com/in/alexmorgan",
      photo: "",
      summary:
        "Software engineer with 8 years of experience building reliable web platforms. Led the move of a payments system to event-driven services, cutting failed transactions by 40%. Enjoys mentoring and turning vague problems into simple, well-tested systems.",
    },
    experience: [
      {
        id: uid(),
        role: "Senior Software Engineer",
        company: "Brightwave",
        location: "Austin, TX",
        start: "Mar 2021",
        end: "",
        current: true,
        bullets:
          "Led a team of 5 rebuilding checkout as event-driven services; failed payments fell 40%\nCut p95 API latency from 820 ms to 190 ms by redesigning caching and database indexes\nIntroduced contract tests and staged rollouts, reducing production incidents by a third\nMentored 4 engineers, two of whom were promoted within a year",
      },
      {
        id: uid(),
        role: "Software Engineer",
        company: "Northline Logistics",
        location: "Dallas, TX",
        start: "Jun 2017",
        end: "Feb 2021",
        current: false,
        bullets:
          "Built real-time shipment tracking used by 2,000+ business customers\nAutomated invoicing reconciliation, saving the finance team 30 hours a month\nMoved the build pipeline to containers, shortening release time from days to hours",
      },
    ],
    education: [
      {
        id: uid(),
        degree: "B.S. in Computer Science",
        school: "University of Texas at Austin",
        location: "Austin, TX",
        start: "2013",
        end: "2017",
        details: "Graduated with honours. Teaching assistant for Data Structures.",
      },
    ],
    skills: [
      { id: uid(), name: "Languages", items: "TypeScript, Go, Python, SQL" },
      { id: uid(), name: "Platforms", items: "AWS, Kubernetes, PostgreSQL, Kafka, Redis" },
      { id: uid(), name: "Practices", items: "System design, Testing, CI/CD, Observability" },
    ],
    projects: [
      {
        id: uid(),
        name: "Open-source rate limiter",
        link: "github.com/alexmorgan/limiter",
        description: "A distributed rate-limiting library for Go with 1.2k GitHub stars.",
      },
    ],
    certifications: [{ id: uid(), name: "AWS Certified Solutions Architect – Associate", issuer: "Amazon Web Services", date: "2023" }],
    languages: [
      { id: uid(), name: "English", level: "Native" },
      { id: uid(), name: "Spanish", level: "Professional working" },
    ],
  };
}

// ---------- Loading saved or imported data safely ----------

const str = (v: unknown, max = 5000) => (typeof v === "string" ? v.slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 50).map(obj) : []);
const id = (v: unknown) => (typeof v === "string" && /^[\w-]{1,40}$/.test(v) ? v : uid());

/** Turn anything (saved data, an imported file) into a valid resume, dropping what doesn't fit. */
export function normalizeResume(raw: unknown): Resume {
  const r = obj(raw);
  const b = obj(r.basics);
  const base = emptyResume();
  const photo = str(b.photo, 3_000_000);
  return {
    version: 1,
    template: TEMPLATES.some((t) => t.id === r.template) ? (r.template as TemplateId) : base.template,
    accent: typeof r.accent === "string" && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent : base.accent,
    font: r.font === "sans" || r.font === "serif" ? r.font : "default",
    pageSize: r.pageSize === "letter" ? "letter" : "a4",
    basics: {
      name: str(b.name, 200),
      title: str(b.title, 200),
      email: str(b.email, 200),
      phone: str(b.phone, 100),
      location: str(b.location, 200),
      website: str(b.website, 300),
      linkedin: str(b.linkedin, 300),
      photo: /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) ? photo : "",
      summary: str(b.summary),
    },
    experience: list(r.experience).map((e) => ({
      id: id(e.id),
      role: str(e.role, 200),
      company: str(e.company, 200),
      location: str(e.location, 200),
      start: str(e.start, 50),
      end: str(e.end, 50),
      current: e.current === true,
      bullets: str(e.bullets),
    })),
    education: list(r.education).map((e) => ({
      id: id(e.id),
      degree: str(e.degree, 200),
      school: str(e.school, 200),
      location: str(e.location, 200),
      start: str(e.start, 50),
      end: str(e.end, 50),
      details: str(e.details),
    })),
    skills: list(r.skills).map((e) => ({ id: id(e.id), name: str(e.name, 100), items: str(e.items, 1000) })),
    projects: list(r.projects).map((e) => ({
      id: id(e.id),
      name: str(e.name, 200),
      link: str(e.link, 300),
      description: str(e.description),
    })),
    certifications: list(r.certifications).map((e) => ({
      id: id(e.id),
      name: str(e.name, 200),
      issuer: str(e.issuer, 200),
      date: str(e.date, 50),
    })),
    languages: list(r.languages).map((e) => ({ id: id(e.id), name: str(e.name, 100), level: str(e.level, 100) })),
  };
}

// ---------- Formatting helpers used by the templates ----------

export function dateRange(start: string, end: string, current: boolean): string {
  const s = start.trim();
  const e = current ? "Present" : end.trim();
  return s && e ? `${s} – ${e}` : s || e;
}

/** Lines of a bullet list, without any bullet characters the user typed. */
export function bulletLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•*–·]\s*/, "").trim())
    .filter(Boolean);
}

export function splitItems(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A safe link target for something the user typed, or undefined. */
export function linkHref(text: string, kind: "web" | "email" | "phone"): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? `mailto:${t}` : undefined;
  if (kind === "phone") return /^[+\d][\d\s().-]{4,}$/.test(t) ? `tel:${t.replace(/[^\d+]/g, "")}` : undefined;
  // Only web links; anything with another scheme (ftp:, javascript:…) isn't linked.
  if ((/^[a-z][\w+.-]*:\/\//i.test(t) && !/^https?:\/\//i.test(t)) || /^(javascript|data|vbscript|file|blob):/i.test(t)) return undefined;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export function displayUrl(text: string): string {
  return text
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
}

export function isEmpty(r: Resume): boolean {
  const b = r.basics;
  return (
    !Object.entries(b).some(([k, v]) => k !== "photo" && v.trim()) &&
    !r.experience.length &&
    !r.education.length &&
    !r.skills.length &&
    !r.projects.length &&
    !r.certifications.length &&
    !r.languages.length
  );
}
