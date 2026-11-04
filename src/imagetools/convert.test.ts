import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32 } from "../lib/image";
import { fitWithin, isHeic, outputNames, sizeChange } from "./convert";
import { createZip as zipStore } from "../lib/zip";

/** Read a stored ZIP back through its central directory. */
function readZip(zip: Uint8Array): { name: string; data: Uint8Array; crc: number; flags: number }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  expect(p + view.getUint32(eocd + 12, true)).toBe(eocd);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const crc = view.getUint32(p + 16, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 8, true)).toBe(0); // stored
    expect(view.getUint32(local + 14, true)).toBe(crc);
    const localNameLen = view.getUint16(local + 26, true);
    const start = local + 30 + localNameLen + view.getUint16(local + 28, true);
    out.push({ name, data: zip.subarray(start, start + size), crc, flags: view.getUint16(p + 8, true) });
    p += 46 + nameLen;
  }
  return out;
}

describe("zipStore", () => {
  const files = [
    { name: "photo.jpg", data: new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]) },
    { name: "café – résumé.png", data: new Uint8Array(70_000).map((_, i) => (i * 31) & 0xff) },
    { name: "empty.webp", data: new Uint8Array(0) },
  ];

  it("round-trips names, contents and checksums", () => {
    const entries = readZip(zipStore(files));
    expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
    entries.forEach((e, i) => {
      expect(Array.from(e.data)).toEqual(Array.from(files[i].data));
      expect(e.crc).toBe(crc32(files[i].data));
      expect(e.flags & 0x0800).toBeTruthy();
    });
  });

  it("makes an empty archive that is just the end record", () => {
    expect(zipStore([]).length).toBe(22);
  });

  it("stores the date in DOS format", () => {
    const zip = zipStore([{ name: "a", data: new Uint8Array([1]) }], new Date(2024, 1, 29, 13, 45, 58));
    const view = new DataView(zip.buffer);
    expect(view.getUint16(10, true)).toBe((13 << 11) | (45 << 5) | 29);
    expect(view.getUint16(12, true)).toBe(((2024 - 1980) << 9) | (2 << 5) | 29);
  });

  it("is accepted by the system unzip, when there is one", () => {
    let hasUnzip = true;
    try {
      execFileSync("unzip", ["-v"], { stdio: "ignore" });
    } catch {
      hasUnzip = false;
    }
    if (!hasUnzip) return;
    const dir = mkdtempSync(join(tmpdir(), "zipstore-"));
    const path = join(dir, "t.zip");
    writeFileSync(path, zipStore(files));
    expect(execFileSync("unzip", ["-t", path]).toString()).toMatch(/No errors detected/);
  });
});

describe("fitWithin", () => {
  it("only ever scales down, keeping the aspect", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual([1600, 1200]);
    expect(fitWithin(4000, 3000, undefined, 600)).toEqual([800, 600]);
    expect(fitWithin(4000, 3000, 1000, 1000)).toEqual([1000, 750]);
    expect(fitWithin(800, 600, 1600, 1600)).toEqual([800, 600]);
    expect(fitWithin(800, 600, 0, undefined)).toEqual([800, 600]);
    expect(fitWithin(10000, 1, 100)).toEqual([100, 1]);
  });
});

describe("outputNames", () => {
  it("swaps the extension and keeps names unique", () => {
    expect(outputNames(["a.png", "b.jpeg", "A.gif", "noext", "x.tar.png", ".png"], "jpg")).toEqual([
      "a.jpg",
      "b.jpg",
      "A (2).jpg",
      "noext.jpg",
      "x.tar.jpg",
      "image.jpg",
    ]);
  });
});

describe("isHeic / sizeChange", () => {
  it("spots HEIC by name or type", () => {
    expect(isHeic("IMG_0001.HEIC", "")).toBe(true);
    expect(isHeic("x.heif", "")).toBe(true);
    expect(isHeic("photo", "image/heic")).toBe(true);
    expect(isHeic("photo.jpg", "image/jpeg")).toBe(false);
  });

  it("describes the change in size", () => {
    expect(sizeChange(1000, 370)).toBe("63% smaller");
    expect(sizeChange(1000, 1120)).toBe("12% bigger");
    expect(sizeChange(1000, 1001)).toBe("same size");
  });
});
