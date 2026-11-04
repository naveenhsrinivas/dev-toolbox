// Builders and readers for common QR code payloads, plus colour contrast checks.

export type WifiSecurity = "WPA" | "WEP" | "nopass";

export interface Wifi {
  ssid: string;
  password: string;
  security: WifiSecurity;
  hidden: boolean;
}

/** Escape a value for the WIFI: format (ZXing convention): backslash before \ ; , : " */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

export function wifiPayload(w: Wifi): string {
  let out = `WIFI:T:${w.security};S:${escapeWifi(w.ssid)};`;
  if (w.security !== "nopass") out += `P:${escapeWifi(w.password)};`;
  if (w.hidden) out += "H:true;";
  return out + ";";
}

/** Split `text` on unescaped `sep`, unescaping backslash pairs. */
function splitEscaped(text: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) cur += text[++i];
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseWifi(text: string): Wifi | undefined {
  if (!/^WIFI:/i.test(text)) return undefined;
  const w: Wifi = { ssid: "", password: "", security: "nopass", hidden: false };
  let sawSsid = false;
  for (const part of splitEscaped(text.slice(5), ";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const key = part.slice(0, i).toUpperCase();
    const value = part.slice(i + 1);
    if (key === "S") {
      w.ssid = value;
      sawSsid = true;
    } else if (key === "P") w.password = value;
    else if (key === "T") w.security = /^WEP$/i.test(value) ? "WEP" : /^(nopass)?$/i.test(value) ? "nopass" : "WPA";
    else if (key === "H") w.hidden = /^true$/i.test(value);
  }
  return sawSsid ? w : undefined;
}

export interface Email {
  to: string;
  subject: string;
  body: string;
}

export function mailtoPayload(e: Email): string {
  const params: string[] = [];
  if (e.subject) params.push(`subject=${encodeURIComponent(e.subject)}`);
  if (e.body) params.push(`body=${encodeURIComponent(e.body.replace(/\r?\n/g, "\r\n"))}`);
  // Addresses keep @ and commas readable; anything else unusual is percent-encoded.
  const to = e.to
    .split(",")
    .map((a) => encodeURIComponent(a.trim()).replace(/%40/g, "@"))
    .filter(Boolean)
    .join(",");
  return `mailto:${to}${params.length ? `?${params.join("&")}` : ""}`;
}

/** Keep the characters a dialler understands. */
export function cleanPhone(number: string): string {
  const trimmed = number.trim();
  return (trimmed.startsWith("+") ? "+" : "") + trimmed.replace(/[^0-9*#]/g, "");
}

export function telPayload(number: string): string {
  return `tel:${cleanPhone(number)}`;
}

/** SMSTO:number:message — the format most scanner apps recognise. */
export function smsPayload(number: string, text: string): string {
  return `SMSTO:${cleanPhone(number)}:${text}`;
}

export interface Contact {
  firstName: string;
  lastName: string;
  org: string;
  title: string;
  phone: string;
  workPhone: string;
  email: string;
  url: string;
  street: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
  note: string;
}

export const EMPTY_CONTACT: Contact = {
  firstName: "",
  lastName: "",
  org: "",
  title: "",
  phone: "",
  workPhone: "",
  email: "",
  url: "",
  street: "",
  city: "",
  region: "",
  postcode: "",
  country: "",
  note: "",
};

/** Escape a vCard text value (RFC 6350 §3.4): backslash, comma, semicolon and newlines. */
export function escapeVcard(value: string): string {
  return value.replace(/([\\,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

export function vcardPayload(c: Contact): string {
  const e = escapeVcard;
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  const fn =
    [c.firstName, c.lastName]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ") || c.org.trim();
  lines.push(`N:${e(c.lastName.trim())};${e(c.firstName.trim())};;;`);
  lines.push(`FN:${e(fn)}`);
  if (c.org.trim()) lines.push(`ORG:${e(c.org.trim())}`);
  if (c.title.trim()) lines.push(`TITLE:${e(c.title.trim())}`);
  if (c.phone.trim()) lines.push(`TEL;TYPE=CELL:${e(c.phone.trim())}`);
  if (c.workPhone.trim()) lines.push(`TEL;TYPE=WORK:${e(c.workPhone.trim())}`);
  if (c.email.trim()) lines.push(`EMAIL:${e(c.email.trim())}`);
  if (c.url.trim()) lines.push(`URL:${e(c.url.trim())}`);
  const adr = [c.street, c.city, c.region, c.postcode, c.country].map((s) => e(s.trim()));
  if (adr.some(Boolean)) lines.push(`ADR:;;${adr.join(";")}`);
  if (c.note.trim()) lines.push(`NOTE:${e(c.note.trim())}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export type PayloadKind = "url" | "wifi" | "email" | "tel" | "sms" | "vcard" | "geo" | "text";

export interface Recognised {
  kind: PayloadKind;
  label: string;
  details: [string, string][];
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** URI query parameters, keeping "+" literal (mailto: and sms: use %20 for spaces). */
function queryParams(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of query.split("&")) {
    const i = pair.indexOf("=");
    if (i > 0) out[safeDecode(pair.slice(0, i)).toLowerCase()] = safeDecode(pair.slice(i + 1));
  }
  return out;
}

function unescapeVcard(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Work out what a decoded QR payload is, with the useful parts pulled out. */
export function recognise(text: string): Recognised {
  const t = text.trim();
  const wifi = parseWifi(t);
  if (wifi) {
    const sec = { WPA: "WPA/WPA2/WPA3", WEP: "WEP", nopass: "None (open network)" }[wifi.security];
    const details: [string, string][] = [
      ["Network name (SSID)", wifi.ssid],
      ["Security", sec],
    ];
    if (wifi.security !== "nopass") details.push(["Password", wifi.password]);
    if (wifi.hidden) details.push(["Hidden network", "Yes"]);
    return { kind: "wifi", label: "Wi-Fi network", details };
  }
  if (/^https?:\/\/\S+$/i.test(t)) {
    try {
      const u = new URL(t);
      return {
        kind: "url",
        label: "Web link",
        details: [
          ["URL", u.href],
          ["Site", u.host],
        ],
      };
    } catch {
      /* fall through to text */
    }
  }
  if (/^mailto:/i.test(t)) {
    const [addr, query = ""] = t.slice(7).split("?");
    const p = queryParams(query);
    const details: [string, string][] = [["To", safeDecode(addr)]];
    if (p.subject) details.push(["Subject", p.subject]);
    if (p.body) details.push(["Body", p.body]);
    return { kind: "email", label: "Email", details };
  }
  if (/^tel:/i.test(t)) return { kind: "tel", label: "Phone number", details: [["Number", t.slice(4)]] };
  const smsto = /^SMSTO:([^:]*):?([\s\S]*)$/i.exec(t);
  if (smsto)
    return {
      kind: "sms",
      label: "Text message",
      details: [
        ["To", smsto[1]],
        ["Message", smsto[2]],
      ],
    };
  const sms = /^sms:([^?]*)(?:\?(.*))?$/i.exec(t);
  if (sms) {
    const body = queryParams(sms[2] ?? "").body ?? "";
    return {
      kind: "sms",
      label: "Text message",
      details: [
        ["To", sms[1]],
        ["Message", body],
      ],
    };
  }
  if (/^BEGIN:VCARD/i.test(t)) {
    const details: [string, string][] = [];
    // Undo line folding (a newline followed by a space continues the line).
    for (const line of t.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
      const m = /^([A-Z-]+)(?:;[^:]*)?:(.*)$/i.exec(line);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const label = { FN: "Name", ORG: "Organisation", TITLE: "Job title", TEL: "Phone", EMAIL: "Email", URL: "Website", NOTE: "Note" }[
        key
      ];
      if (label) details.push([label, unescapeVcard(m[2])]);
      else if (key === "ADR") details.push(["Address", m[2].split(";").map(unescapeVcard).filter(Boolean).join(", ")]);
    }
    return { kind: "vcard", label: "Contact card", details };
  }
  const geo = /^geo:(-?[\d.]+),(-?[\d.]+)/i.exec(t);
  if (geo)
    return {
      kind: "geo",
      label: "Location",
      details: [
        ["Latitude", geo[1]],
        ["Longitude", geo[2]],
      ],
    };
  return { kind: "text", label: "Text", details: [] };
}

// ---------- Colours ----------

/** Parse #rgb or #rrggbb into [r, g, b] (0–255). */
export function parseHex(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const s = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const la = luminance(ca);
  const lb = luminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A warning about colours that scanners may struggle with, or undefined if they're fine. */
export function colourWarning(foreground: string, background: string): string | undefined {
  const ratio = contrastRatio(foreground, background);
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (ratio < 3)
    return `The colours are too similar (contrast ${ratio.toFixed(1)}:1). Many scanners need at least 3:1 — 7:1 or more is safest.`;
  if (fg && bg && luminance(fg) > luminance(bg))
    return "The code is lighter than its background (inverted). Some scanner apps can't read light-on-dark codes; dark on light is safest.";
  if (ratio < 4.5) return `Contrast is low (${ratio.toFixed(1)}:1). It may scan poorly in dim light — darker foreground colours help.`;
  return undefined;
}
