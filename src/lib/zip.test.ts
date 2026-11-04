import { describe, expect, it } from "vitest";
import { crc32 } from "./image";
import { createZip, dosDateTime, uniqueNames, zipBlob } from "./zip";

interface Read {
  name: string;
  data: Uint8Array;
  crc: number;
  flags: number;
  method: number;
  time: number;
  date: number;
}

/** Read a ZIP the way an unzip tool does: from the end record, through the central directory. */
function readZip(zip: Uint8Array): Read[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const endAt = zip.length - 22;
  expect(v.getUint32(endAt, true)).toBe(0x06054b50);
  const count = v.getUint16(endAt + 10, true);
  expect(v.getUint16(endAt + 8, true)).toBe(count);
  const dirSize = v.getUint32(endAt + 12, true);
  let p = v.getUint32(endAt + 16, true);
  expect(p + dirSize).toBe(endAt);

  const decoder = new TextDecoder();
  const out: Read[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const size = v.getUint32(p + 20, true);
    expect(v.getUint32(p + 24, true)).toBe(size);
    const local = v.getUint32(p + 42, true);
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));

    // The local header must agree with the central directory.
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(v.getUint32(local + 14, true)).toBe(v.getUint32(p + 16, true));
    expect(v.getUint32(local + 18, true)).toBe(size);
    const localNameLen = v.getUint16(local + 26, true);
    expect(decoder.decode(zip.subarray(local + 30, local + 30 + localNameLen))).toBe(name);
    const start = local + 30 + localNameLen + v.getUint16(local + 28, true);

    out.push({
      name,
      data: zip.slice(start, start + size),
      crc: v.getUint32(p + 16, true),
      flags: v.getUint16(p + 8, true),
      method: v.getUint16(p + 10, true),
      time: v.getUint16(p + 12, true),
      date: v.getUint16(p + 14, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("createZip", () => {
  it("writes an empty archive as just the end record", () => {
    const zip = createZip([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  it("stores files that read back byte for byte, with correct CRCs", () => {
    const big = new Uint8Array(100_000).map((_, i) => (i * 31) & 0xff);
    const entries = [
      { name: "hello.txt", data: new TextEncoder().encode("Hello, world!") },
      { name: "empty.bin", data: new Uint8Array(0) },
      { name: "folder/big.bin", data: big },
    ];
    const read = readZip(createZip(entries));
    expect(read.map((r) => r.name)).toEqual(["hello.txt", "empty.bin", "folder/big.bin"]);
    for (const [i, r] of read.entries()) {
      expect(r.data).toEqual(entries[i].data);
      expect(r.crc).toBe(crc32(entries[i].data));
      expect(r.method).toBe(0);
    }
    // The well-known CRC-32 of "Hello, world!".
    expect(read[0].crc).toBe(0xebe6c6e6);
  });

  it("marks names as UTF-8", () => {
    const [r] = readZip(createZip([{ name: "résumé – 日本.pdf", data: new Uint8Array([1]) }]));
    expect(r.name).toBe("résumé – 日本.pdf");
    expect(r.flags & 0x0800).toBe(0x0800);
  });

  it("records the modification time", () => {
    const [r] = readZip(createZip([{ name: "a", data: new Uint8Array(1) }], new Date(2024, 1, 29, 13, 45, 31)));
    expect(r.date).toBe(((2024 - 1980) << 9) | (2 << 5) | 29);
    expect(r.time).toBe((13 << 11) | (45 << 5) | 15);
  });

  it("refuses names that can't be stored", () => {
    expect(() => createZip([{ name: "", data: new Uint8Array(1) }])).toThrow(RangeError);
  });

  it("produces the same bytes as a Blob", async () => {
    const entries = [{ name: "x.txt", data: new Uint8Array([1, 2, 3]) }];
    const date = new Date(2020, 0, 1);
    const blob = zipBlob(entries, date);
    expect(blob.type).toBe("application/zip");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(createZip(entries, date));
  });
});

describe("dosDateTime", () => {
  it("clamps dates outside the range ZIP can store", () => {
    expect(dosDateTime(new Date(1970, 5, 5))).toEqual({ time: 0, date: (1 << 5) | 1 });
  });
});

describe("uniqueNames", () => {
  it("numbers repeats before the extension, ignoring case", () => {
    expect(uniqueNames(["a.pdf", "b.pdf", "A.pdf", "a.pdf", "notes", "notes"])).toEqual([
      "a.pdf",
      "b.pdf",
      "A (2).pdf",
      "a (3).pdf",
      "notes",
      "notes (2)",
    ]);
  });

  it("doesn't collide with a name that already has a number", () => {
    expect(uniqueNames(["a (2).pdf", "a.pdf", "a.pdf"])).toEqual(["a (2).pdf", "a.pdf", "a (3).pdf"]);
  });
});
