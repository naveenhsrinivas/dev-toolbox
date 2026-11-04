// A minimal ZIP writer. Entries are stored without compression: the files we zip
// (PDFs, PNGs, JPEGs) are already compressed, so deflating them again gains little.
import { crc32 } from "./image";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

/** DOS date and time as stored in ZIP headers (local time, 2-second steps, 1980–2107). */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  if (year !== date.getFullYear()) date = new Date(year, 0, 1);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** The pieces of a ZIP file, in order. Join them with `new Blob(parts)` or `concat`. */
export function zipParts(entries: ZipEntry[], modified = new Date()): Uint8Array[] {
  // ZIP64 isn't supported, so counts and offsets must fit the classic 16/32-bit fields.
  if (entries.length > MAX_ENTRIES) throw new RangeError(`A ZIP file can hold at most ${MAX_ENTRIES.toLocaleString()} files.`);
  const { time, date } = dosDateTime(modified);
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    if (!name.length || name.length > 0xffff) throw new RangeError(`"${entry.name}" can't be used as a file name in a ZIP.`);
    const size = entry.data.length;
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed: 2.0
    lv.setUint16(6, 0x0800, true); // bit 11: the name is UTF-8
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, time, true);
    dv.setUint16(14, date, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, size, true);
    dv.setUint32(24, size, true);
    dv.setUint16(28, name.length, true);
    // Extra length, comment length, disk number, internal and external attributes stay 0.
    dv.setUint32(42, offset, true);
    dir.set(name, 46);

    parts.push(local, entry.data);
    central.push(dir);
    offset += local.length + size;
    if (offset > MAX_BYTES) throw new RangeError("These files are too large to put in one ZIP (over 4 GB).");
  }

  const dirSize = central.reduce((n, d) => n + d.length, 0);
  if (offset + dirSize > MAX_BYTES) throw new RangeError("These files are too large to put in one ZIP (over 4 GB).");
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  return [...parts, ...central, end];
}

/** Build a whole ZIP file in memory. */
export function createZip(entries: ZipEntry[], modified?: Date): Uint8Array {
  const parts = zipParts(entries, modified);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Build a ZIP as a Blob without first joining everything into one array. */
export function zipBlob(entries: ZipEntry[], modified?: Date): Blob {
  return new Blob(zipParts(entries, modified) as Uint8Array<ArrayBuffer>[], { type: "application/zip" });
}

/**
 * Make file names unique, case-insensitively (as most file systems compare them),
 * by adding " (2)", " (3)"… before the extension.
 */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let candidate = name;
    for (let n = 2; seen.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}
