// Text statistics and case conversion.

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  lines: number;
  sentences: number;
  bytes: number;
  readingMinutes: number;
}

export function textStats(text: string): TextStats {
  // Count user-perceived characters, so an emoji or accented letter counts once.
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)];
  const words = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)].filter((s) => s.isWordLike).length;
  return {
    characters: graphemes.length,
    charactersNoSpaces: graphemes.filter((g) => !/^\s+$/.test(g.segment)).length,
    words,
    lines: text === "" ? 0 : text.split(/\r\n|\r|\n/).length,
    sentences: (text.match(/[^.!?\s][^.!?]*(?:[.!?]+|$)/g) ?? []).length,
    bytes: new TextEncoder().encode(text).length,
    readingMinutes: words / 230,
  };
}

/** Split into words at spaces, punctuation and lower→upper boundaries; digits stay with their word ("base64"). */
export function splitWords(text: string): string[] {
  return (
    text
      .replace(/([\p{Ll}\d])(\p{Lu})/gu, "$1 $2")
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export const CASES: { id: string; label: string; convert: (text: string) => string }[] = [
  { id: "upper", label: "UPPER CASE", convert: (t) => t.toUpperCase() },
  { id: "lower", label: "lower case", convert: (t) => t.toLowerCase() },
  {
    id: "title",
    label: "Title Case",
    convert: (t) => t.toLowerCase().replace(/(^|[\s\-_/("'])(\p{L})/gu, (_, p, l: string) => p + l.toUpperCase()),
  },
  {
    id: "sentence",
    label: "Sentence case",
    convert: (t) => t.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, p, l: string) => p + l.toUpperCase()),
  },
  {
    id: "camel",
    label: "camelCase",
    convert: (t) =>
      splitWords(t)
        .map((w, i) => (i ? cap(w) : w.toLowerCase()))
        .join(""),
  },
  { id: "pascal", label: "PascalCase", convert: (t) => splitWords(t).map(cap).join("") },
  {
    id: "snake",
    label: "snake_case",
    convert: (t) =>
      splitWords(t)
        .map((w) => w.toLowerCase())
        .join("_"),
  },
  {
    id: "kebab",
    label: "kebab-case",
    convert: (t) =>
      splitWords(t)
        .map((w) => w.toLowerCase())
        .join("-"),
  },
  {
    id: "constant",
    label: "CONSTANT_CASE",
    convert: (t) =>
      splitWords(t)
        .map((w) => w.toUpperCase())
        .join("_"),
  },
];

/** Applies a case style line by line, so multi-line input keeps its lines. */
export function convertCase(text: string, id: string): string {
  const style = CASES.find((c) => c.id === id);
  if (!style) return text;
  return ["upper", "lower", "title", "sentence"].includes(id) ? style.convert(text) : text.split("\n").map(style.convert).join("\n");
}
