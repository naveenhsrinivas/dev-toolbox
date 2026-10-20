// Decoding (and optional HMAC verification) of JSON Web Tokens, entirely local.
import { base64ToBytes, bytesToBase64 } from "./encoding";

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: unknown;
  signature: string;
  /** The "header.payload" part that the signature covers. */
  signingInput: string;
}

export type JwtResult = { ok: true; jwt: DecodedJwt } | { ok: false; error: string };

function decodePart(part: string, name: string): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(base64ToBytes(part));
  } catch {
    throw new Error(`The ${name} isn't valid Base64URL.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The ${name} isn't valid JSON.`);
  }
}

export function decodeJwt(input: string): JwtResult {
  const token = input.trim().replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, error: "Paste a token to decode it." };
  const parts = token.split(".");
  if (parts.length === 5)
    return { ok: false, error: "This is an encrypted token (JWE). Its contents can't be read without the decryption key." };
  if (parts.length !== 3) return { ok: false, error: `A JWT has 3 parts separated by dots; this has ${parts.length}.` };
  try {
    const header = decodePart(parts[0], "header");
    if (!header || typeof header !== "object" || Array.isArray(header)) return { ok: false, error: "The header must be a JSON object." };
    const payload = decodePart(parts[1], "payload");
    return {
      ok: true,
      jwt: { header: header as Record<string, unknown>, payload, signature: parts[2], signingInput: `${parts[0]}.${parts[1]}` },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface TimeClaim {
  claim: "exp" | "nbf" | "iat";
  label: string;
  date: Date;
}

/** The standard time claims, as dates. */
export function timeClaims(payload: unknown): TimeClaim[] {
  if (!payload || typeof payload !== "object") return [];
  const labels = { iat: "Issued at", nbf: "Not valid before", exp: "Expires" } as const;
  const out: TimeClaim[] = [];
  for (const claim of ["iat", "nbf", "exp"] as const) {
    const v = (payload as Record<string, unknown>)[claim];
    if (typeof v === "number" && Number.isFinite(v)) out.push({ claim, label: labels[claim], date: new Date(v * 1000) });
  }
  return out;
}

export function tokenStatus(
  payload: unknown,
  now = Date.now(),
): { state: "valid" | "expired" | "not-yet-valid" | "no-expiry"; message: string } {
  const claims = timeClaims(payload);
  const exp = claims.find((c) => c.claim === "exp");
  const nbf = claims.find((c) => c.claim === "nbf");
  if (nbf && nbf.date.getTime() > now) return { state: "not-yet-valid", message: "Not valid yet" };
  if (exp && exp.date.getTime() <= now) return { state: "expired", message: "Expired" };
  if (exp) return { state: "valid", message: "Not expired" };
  return { state: "no-expiry", message: "No expiry (exp) claim" };
}

const HMAC: Record<string, string> = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" };

export function canVerifyWithSecret(alg: unknown): alg is string {
  return typeof alg === "string" && alg in HMAC;
}

/** Check an HS256/384/512 signature with a shared secret. */
export async function verifyHmac(jwt: DecodedJwt, secret: string, secretIsBase64 = false): Promise<boolean> {
  const alg = jwt.header.alg;
  if (!canVerifyWithSecret(alg)) throw new Error(`Can't verify ${String(alg)} tokens with a secret.`);
  const keyBytes = secretIsBase64 ? base64ToBytes(secret) : new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey("raw", keyBytes as Uint8Array<ArrayBuffer>, { name: "HMAC", hash: HMAC[alg] }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(jwt.signingInput)));
  return bytesToBase64(sig, true) === jwt.signature.replace(/=+$/, "");
}
