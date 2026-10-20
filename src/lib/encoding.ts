// Base64 and URL encoding that handle all of Unicode (not just Latin-1).

export type TextResult = { ok: true; value: string } | { ok: false; error: string };

export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const b64 = btoa(binary);
  return urlSafe ? b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : b64;
}

/** Decode standard or URL-safe Base64, with or without padding and whitespace. */
export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("Contains characters that aren't Base64.");
  const unpadded = clean.replace(/=+$/, "");
  if (unpadded.length % 4 === 1) throw new Error("The length isn't valid for Base64 — some characters may be missing.");
  const binary = atob(unpadded + "=".repeat((4 - (unpadded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function encodeBase64(text: string, urlSafe = false): string {
  return bytesToBase64(new TextEncoder().encode(text), urlSafe);
}

export function decodeBase64(input: string): TextResult {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(input);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  try {
    return { ok: true, value: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, error: `Decoded ${bytes.length} bytes, but they aren't UTF-8 text (it may be an image or other binary data).` };
  }
}

export function encodeUrl(text: string, mode: "component" | "full"): string {
  return mode === "component" ? encodeURIComponent(text) : encodeURI(text);
}

export function decodeUrl(text: string, plusAsSpace: boolean): TextResult {
  try {
    return { ok: true, value: decodeURIComponent(plusAsSpace ? text.replace(/\+/g, " ") : text) };
  } catch {
    return { ok: false, error: "Contains a % that isn't followed by a valid encoded character (like %20)." };
  }
}

export interface ParsedUrl {
  parts: [label: string, value: string][];
  params: [name: string, value: string][];
}

function decodeOrKeep(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function parseUrl(text: string): ParsedUrl | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  const parts: [string, string][] = [
    ["Protocol", url.protocol],
    ["Username", decodeOrKeep(url.username)],
    ["Password", url.password ? "••••••" : ""],
    ["Host", url.hostname],
    ["Port", url.port],
    ["Path", decodeOrKeep(url.pathname)],
    ["Query", url.search],
    ["Fragment", url.hash],
    ["Origin", url.origin],
  ];
  return { parts: parts.filter(([, v]) => v && v !== "null"), params: [...url.searchParams] };
}
