// UUID generation: v4 (random) and v7 (time-ordered, sorts by creation time).
import { toHex } from "./hash";

export type UuidVersion = 4 | 7;

function format(bytes: Uint8Array): string {
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidV4(): string {
  return crypto.randomUUID();
}

/** RFC 9562 version 7: 48-bit Unix time in milliseconds, then random bits. */
export function uuidV7(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return format(bytes);
}

export function generateUuids(version: UuidVersion, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(version === 4 ? uuidV4() : uuidV7());
  // v7 values made in the same millisecond only sort by their random part, so sort them.
  return version === 7 ? out.sort() : out;
}

export interface UuidInfo {
  version: number;
  variant: string;
  /** Creation time, for v1, v6 and v7. */
  time?: Date;
}

export function inspectUuid(text: string): UuidInfo | undefined {
  const hex = text
    .trim()
    .replace(/^urn:uuid:/i, "")
    .replace(/[{}]/g, "")
    .replace(/-/g, "")
    .toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return undefined;
  const version = parseInt(hex[12], 16);
  const v = parseInt(hex[16], 16);
  const variant = v < 8 ? "NCS (reserved)" : v < 12 ? "RFC 9562" : v < 14 ? "Microsoft (reserved)" : "Future (reserved)";
  let time: Date | undefined;
  if (version === 7) time = new Date(parseInt(hex.slice(0, 12), 16));
  if (version === 1 || version === 6) {
    // 60-bit count of 100 ns intervals since 1582-10-15.
    const ticks =
      version === 1
        ? BigInt(`0x${hex.slice(13, 16)}${hex.slice(8, 12)}${hex.slice(0, 8)}`)
        : BigInt(`0x${hex.slice(0, 12)}${hex.slice(13, 16)}`);
    time = new Date(Number(ticks / 10000n - 12219292800000n));
  }
  return { version, variant, time };
}
