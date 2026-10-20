// Line-by-line comparison of two texts, with word-level detail for changed lines.
import { diffArrays, diffWordsWithSpace } from "diff";

export interface DiffOptions {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
}

/** A piece of a changed line; `changed` marks the words that differ. */
export interface Segment {
  text: string;
  changed: boolean;
}

export interface Side {
  /** 1-based line number in its own text. */
  line: number;
  text: string;
  /** Present on lines that were changed (not purely added or removed). */
  segments?: Segment[];
}

export type Row =
  | { kind: "same"; left: Side; right: Side }
  | { kind: "change"; left: Side; right: Side }
  | { kind: "removed"; left: Side }
  | { kind: "added"; right: Side };

export interface DiffResult {
  rows: Row[];
  added: number;
  removed: number;
  changed: number;
  identical: boolean;
}

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\r|\n/);
  // A final newline ends the last line rather than starting an empty one.
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function lineKey(line: string, options: DiffOptions): string {
  let key = options.ignoreWhitespace ? line.replace(/\s+/g, " ").trim() : line;
  if (options.ignoreCase) key = key.toLowerCase();
  return key;
}

function wordSegments(oldLine: string, newLine: string, options: DiffOptions): [Segment[], Segment[]] {
  const parts = diffWordsWithSpace(oldLine, newLine, { ignoreCase: options.ignoreCase });
  const left: Segment[] = [];
  const right: Segment[] = [];
  // With ignoreCase, common parts carry the new text, so rebuild the old side by position.
  let oldPos = 0;
  for (const part of parts) {
    if (part.added) {
      right.push({ text: part.value, changed: true });
    } else if (part.removed) {
      left.push({ text: oldLine.slice(oldPos, oldPos + part.value.length), changed: true });
      oldPos += part.value.length;
    } else {
      left.push({ text: oldLine.slice(oldPos, oldPos + part.value.length), changed: false });
      right.push({ text: part.value, changed: false });
      oldPos += part.value.length;
    }
  }
  return [left, right];
}

/**
 * Compare two texts line by line. Returns undefined if they are too different
 * to compare within `timeoutMs` (very large, unrelated inputs).
 */
export function compareTexts(oldText: string, newText: string, options: DiffOptions = {}, timeoutMs = 3000): DiffResult | undefined {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const changes = diffArrays(
    a.map((l) => lineKey(l, options)),
    b.map((l) => lineKey(l, options)),
    { timeout: timeoutMs },
  );
  if (!changes) return undefined;

  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (let c = 0; c < changes.length; c++) {
    const change = changes[c];
    const count = change.value.length;
    if (!change.added && !change.removed) {
      for (let k = 0; k < count; k++, i++, j++)
        rows.push({ kind: "same", left: { line: i + 1, text: a[i] }, right: { line: j + 1, text: b[j] } });
      continue;
    }
    if (change.removed && changes[c + 1]?.added) {
      // A removal followed by an addition: pair the lines up as changes.
      const addCount = changes[c + 1].value.length;
      const paired = Math.min(count, addCount);
      for (let k = 0; k < paired; k++, i++, j++) {
        const [ls, rs] = wordSegments(a[i], b[j], options);
        rows.push({ kind: "change", left: { line: i + 1, text: a[i], segments: ls }, right: { line: j + 1, text: b[j], segments: rs } });
        changed++;
      }
      for (let k = paired; k < count; k++, i++) {
        rows.push({ kind: "removed", left: { line: i + 1, text: a[i] } });
        removed++;
      }
      for (let k = paired; k < addCount; k++, j++) {
        rows.push({ kind: "added", right: { line: j + 1, text: b[j] } });
        added++;
      }
      c++;
      continue;
    }
    if (change.removed) {
      for (let k = 0; k < count; k++, i++) rows.push({ kind: "removed", left: { line: i + 1, text: a[i] } });
      removed += count;
    } else {
      for (let k = 0; k < count; k++, j++) rows.push({ kind: "added", right: { line: j + 1, text: b[j] } });
      added += count;
    }
  }
  return { rows, added, removed, changed, identical: added + removed + changed === 0 };
}
