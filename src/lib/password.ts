// Password generation with the browser's cryptographic random number generator.

export const CHARSETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.<>?/~",
} as const;

/** Characters that are easy to confuse with each other when read or typed. */
export const AMBIGUOUS = "Il1|O0o`'\"";

export type Charset = keyof typeof CHARSETS;

export interface PasswordOptions {
  length: number;
  sets: Charset[];
  excludeAmbiguous?: boolean;
}

/** Uniform random integer in [0, max), without modulo bias. */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError("max must be an integer in 1..2^32");
  const limit = 2 ** 32 - (2 ** 32 % max);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

function pools(options: PasswordOptions): string[] {
  return options.sets
    .map((s) => (options.excludeAmbiguous ? [...CHARSETS[s]].filter((c) => !AMBIGUOUS.includes(c)).join("") : CHARSETS[s]))
    .filter((p) => p.length > 0);
}

/**
 * Generate a password containing at least one character from every chosen set,
 * with every position then shuffled so the guaranteed characters aren't predictable.
 */
export function generatePassword(options: PasswordOptions): string {
  const chosen = pools(options);
  if (!chosen.length) throw new Error("Choose at least one type of character.");
  if (options.length < chosen.length) throw new Error(`Length must be at least ${chosen.length} to include every chosen type.`);
  const all = chosen.join("");
  const chars = chosen.map((p) => p[randomInt(p.length)]);
  while (chars.length < options.length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const k = randomInt(i + 1);
    [chars[i], chars[k]] = [chars[k], chars[i]];
  }
  return chars.join("");
}

/** Bits of entropy for a random password of this length drawn from these options. */
export function passwordEntropy(options: PasswordOptions): number {
  const size = pools(options).join("").length;
  return size ? options.length * Math.log2(size) : 0;
}

export function strengthLabel(bits: number): { label: string; level: 0 | 1 | 2 | 3 } {
  if (bits < 45) return { label: "Weak", level: 0 };
  if (bits < 65) return { label: "Fair", level: 1 };
  if (bits < 90) return { label: "Strong", level: 2 };
  return { label: "Very strong", level: 3 };
}
