import { describe, expect, it } from "vitest";
import {
  autoWidth,
  bitLength,
  bitwise,
  fitsWidth,
  formatInteger,
  groupDigits,
  MAX_DIGITS,
  parseAuto,
  parseInteger,
  parseWithWidth,
  textBytes,
  toBits,
  toSigned,
} from "./numberbase";

function value(text: string, base: number): bigint {
  const r = parseInteger(text, base);
  if (!r.ok) throw new Error(`${text}: ${r.error}`);
  return r.value;
}
function error(r: ReturnType<typeof parseInteger>): string {
  if (r.ok) throw new Error(`expected an error, got ${r.value}`);
  return r.error;
}

describe("parseInteger", () => {
  it("reads each base", () => {
    expect(value("101010", 2)).toBe(42n);
    expect(value("52", 8)).toBe(42n);
    expect(value("42", 10)).toBe(42n);
    expect(value("2a", 16)).toBe(42n);
    expect(value("2A", 16)).toBe(42n);
    expect(value("16", 26)).toBe(32n);
    expect(value("z", 36)).toBe(35n);
    expect(value("zz", 36)).toBe(1295n);
    expect(value("0", 7)).toBe(0n);
  });

  it("accepts prefixes, separators and signs", () => {
    expect(value("0b1010_1010", 2)).toBe(170n);
    expect(value("0o777", 8)).toBe(511n);
    expect(value("0xFF FF", 16)).toBe(65535n);
    expect(value("1 000 000", 10)).toBe(1000000n);
    expect(value("1_000", 10)).toBe(1000n);
    expect(value("1,234,567", 10)).toBe(1234567n);
    expect(value("-0x10", 16)).toBe(-16n);
    expect(value("+12", 10)).toBe(12n);
    expect(value(" -42 ", 10)).toBe(-42n);
    // A decimal field takes any prefix.
    expect(value("0x1f", 10)).toBe(31n);
    expect(value("0b11", 10)).toBe(3n);
    expect(value("-0o10", 10)).toBe(-8n);
  });

  it("doesn't mistake hex digits for a prefix", () => {
    // In a hex field "0b1" is the number 0xB1.
    expect(value("0b1", 16)).toBe(0xb1n);
    // In base 36, x is a digit.
    expect(value("0x", 36)).toBe(33n);
  });

  it("handles very large numbers", () => {
    const big = 2n ** 200n + 12345n;
    for (const base of [2, 3, 8, 10, 16, 36]) expect(value(big.toString(base), base)).toBe(big);
    expect(value("-" + (3n ** 500n).toString(7), 7)).toBe(-(3n ** 500n));
  });

  it("explains bad input", () => {
    expect(error(parseInteger("", 10))).toMatch(/Enter a number/);
    expect(error(parseInteger("  _ ", 10))).toMatch(/Enter a number/);
    expect(error(parseInteger("-", 10))).toMatch(/digits after the sign/);
    expect(error(parseInteger("0x", 16))).toMatch(/digits after 0x/);
    expect(error(parseInteger("102", 2))).toBe('"2" isn\'t a valid binary digit. Use 0–1.');
    expect(error(parseInteger("78", 8))).toBe('"8" isn\'t a valid octal digit. Use 0–7.');
    expect(error(parseInteger("fg", 16))).toBe('"g" isn\'t a valid hex digit. Use 0–9 and a–f.');
    expect(error(parseInteger("1.5", 10))).toMatch(/"\." isn't a valid decimal digit/);
    expect(error(parseInteger("0b12", 2))).toMatch(/"2" isn't a valid binary digit/);
    expect(error(parseInteger("0b12", 10))).toMatch(/"2" isn't a valid binary digit/);
    expect(error(parseInteger("1", 37))).toMatch(/between 2 and 36/);
    expect(error(parseInteger("1".repeat(MAX_DIGITS + 1), 10))).toMatch(/too long/);
  });

  it("parseAuto reads decimal or prefixed input", () => {
    const r = parseAuto("0xff");
    expect(r.ok && r.value).toBe(255n);
  });
});

describe("formatInteger", () => {
  it("writes each base", () => {
    expect(formatInteger(255n, 2)).toBe("11111111");
    expect(formatInteger(255n, 16)).toBe("ff");
    expect(formatInteger(255n, 16, { upper: true })).toBe("FF");
    expect(formatInteger(-255n, 16)).toBe("-ff");
    expect(formatInteger(35n, 36)).toBe("z");
  });

  it("pads to a width and groups digits", () => {
    expect(formatInteger(5n, 2, { width: 8 })).toBe("00000101");
    expect(formatInteger(5n, 16, { width: 16 })).toBe("0005");
    expect(formatInteger(5n, 8, { width: 8 })).toBe("005");
    expect(formatInteger(5n, 10, { width: 8 })).toBe("5");
    expect(formatInteger(0xabcdefn, 2, { group: true })).toBe("1010 1011 1100 1101 1110 1111");
    expect(formatInteger(1234567n, 10, { group: true })).toBe("1,234,567");
    expect(formatInteger(-1234567n, 10, { group: true })).toBe("-1,234,567");
    expect(formatInteger(0x1abcden, 16, { group: true, upper: true })).toBe("1A BCDE");
    expect(groupDigits("1101010", 4)).toBe("110 1010");
    expect(groupDigits("", 4)).toBe("");
  });

  it("round-trips through every base", () => {
    const n = -(2n ** 130n) + 987654321n;
    for (let base = 2; base <= 36; base++) {
      expect(value(formatInteger(n, base), base)).toBe(n);
      expect(value(formatInteger(n, base, { group: true, upper: true }), base)).toBe(n);
    }
  });
});

describe("two's complement", () => {
  it("turns negative numbers into bit patterns and back", () => {
    expect(toBits(-1n, 8)).toBe(0xffn);
    expect(toBits(-128n, 8)).toBe(0x80n);
    expect(toBits(-56n, 8)).toBe(0xc8n);
    expect(toBits(-1n, 64)).toBe(0xffffffffffffffffn);
    expect(toSigned(0xffn, 8)).toBe(-1n);
    expect(toSigned(0x7fn, 8)).toBe(127n);
    expect(toSigned(0x8000n, 16)).toBe(-32768n);
    expect(toSigned(0xffffffffn, 32)).toBe(-1n);
  });

  it("knows what fits", () => {
    expect(fitsWidth(-128n, 8)).toBe(true);
    expect(fitsWidth(255n, 8)).toBe(true);
    expect(fitsWidth(-129n, 8)).toBe(false);
    expect(fitsWidth(256n, 8)).toBe(false);
  });

  it("reads fields as signed bit patterns", () => {
    const v = (t: string, b: number, w: 8 | 16 | 32 | 64) => {
      const r = parseWithWidth(t, b, w);
      if (!r.ok) throw new Error(r.error);
      return r.value;
    };
    expect(v("ff", 16, 8)).toBe(-1n);
    expect(v("ff", 16, 16)).toBe(255n);
    expect(v("10000000", 2, 8)).toBe(-128n);
    expect(v("-1", 10, 32)).toBe(-1n);
    expect(v("200", 10, 8)).toBe(200n); // fits as unsigned, decimal is taken as written
    expect(v("-0x01", 16, 8)).toBe(-1n);
    const tooBig = parseWithWidth("1ff", 16, 8);
    expect(!tooBig.ok && tooBig.error).toMatch(/more than 8 bits/);
    const tooSmall = parseWithWidth("-129", 10, 8);
    expect(!tooSmall.ok && tooSmall.error).toMatch(/doesn't fit in 8 bits.*-128.*255/);
  });

  it("measures numbers", () => {
    expect(bitLength(0n)).toBe(1);
    expect(bitLength(255n)).toBe(8);
    expect(bitLength(256n)).toBe(9);
    expect(bitLength(-256n)).toBe(9);
    expect(autoWidth(0n)).toBe(8);
    expect(autoWidth(255n)).toBe(8);
    expect(autoWidth(256n)).toBe(16);
    expect(autoWidth(2n ** 64n - 1n)).toBe(64);
    expect(autoWidth(2n ** 64n)).toBeNull();
    expect(autoWidth(-1n)).toBeNull();
  });
});

describe("bitwise", () => {
  const run = (...args: Parameters<typeof bitwise>) => {
    const r = bitwise(...args);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it("does the basic operations", () => {
    expect(run("and", 0b1100n, 0b1010n)).toBe(0b1000n);
    expect(run("or", 0b1100n, 0b1010n)).toBe(0b1110n);
    expect(run("xor", 0b1100n, 0b1010n)).toBe(0b0110n);
    expect(run("not", 5n, 0n)).toBe(-6n);
    expect(run("shl", 1n, 70n)).toBe(2n ** 70n);
    expect(run("shr", -16n, 2n)).toBe(-4n);
    expect(run("and", -1n, 0xffn)).toBe(0xffn);
  });

  it("wraps to a bit width like C does", () => {
    expect(run("not", 0n, 0n, 8)).toBe(-1n);
    expect(toBits(run("not", 5n, 0n, 32), 32)).toBe(0xfffffffan);
    expect(run("shl", 1n, 7n, 8)).toBe(-128n);
    expect(run("shl", 1n, 8n, 8)).toBe(0n);
    expect(run("shr", 0x80n, 1n, 8)).toBe(-64n); // 0x80 is -128 at 8 bits
    expect(run("ushr", -1n, 28n, 32)).toBe(0xfn);
    expect(run("ushr", 0x80n, 1n, 8)).toBe(0x40n);
    expect(run("xor", 200n, 0xffn, 8)).toBe(55n);
  });

  it("explains impossible requests", () => {
    const err = (r: ReturnType<typeof bitwise>) => (r.ok ? "" : r.error);
    expect(err(bitwise("ushr", 1n, 1n))).toMatch(/needs a bit size/);
    expect(err(bitwise("shl", 1n, -1n))).toMatch(/shift amount/);
    expect(err(bitwise("shl", 1n, 10n ** 9n))).toMatch(/shift amount/);
    expect(err(bitwise("and", 300n, 1n, 8))).toMatch(/^A: 300 doesn't fit/);
    expect(err(bitwise("or", 1n, 300n, 8))).toMatch(/^B: 300 doesn't fit/);
    // B is a shift count, not a value, so it isn't checked against the width.
    expect(bitwise("shl", 1n, 300n, 8).ok).toBe(true);
  });
});

describe("textBytes", () => {
  it("encodes text as UTF-8", () => {
    expect(textBytes("Hi")).toMatchObject({ hex: "48 69", binary: "01001000 01101001", decimal: "72 105", ascii: true });
    expect(textBytes("é").hex).toBe("c3 a9");
    expect(textBytes("€").hex).toBe("e2 82 ac");
    expect(textBytes("😀").hex).toBe("f0 9f 98 80");
    expect(textBytes("é").ascii).toBe(false);
    expect(textBytes("").bytes.length).toBe(0);
  });
});
