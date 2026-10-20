// Regular expression matching for the regex tester (runs inside a Web Worker).

export interface RegexRequest {
  pattern: string;
  flags: string;
  text: string;
  replacement?: string;
}

export interface RegexMatch {
  index: number;
  text: string;
  groups: (string | undefined)[];
  named?: Record<string, string | undefined>;
}

export type RegexResponse = { ok: true; matches: RegexMatch[]; truncated: boolean; replaced?: string } | { ok: false; error: string };

export const MAX_MATCHES = 1000;

export function runRegex({ pattern, flags, text, replacement }: RegexRequest): RegexResponse {
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (err) {
    return { ok: false, error: (err as Error).message.replace(/^Invalid regular expression: /, "") };
  }
  const toMatch = (m: RegExpExecArray): RegexMatch => ({
    index: m.index,
    text: m[0],
    groups: m.slice(1),
    named: m.groups ? { ...m.groups } : undefined,
  });

  const matches: RegexMatch[] = [];
  let truncated = false;
  if (re.global) {
    for (const m of text.matchAll(re)) {
      if (matches.length === MAX_MATCHES) {
        truncated = true;
        break;
      }
      matches.push(toMatch(m));
    }
  } else {
    const m = re.exec(text);
    if (m) matches.push(toMatch(m));
  }
  re.lastIndex = 0;
  return { ok: true, matches, truncated, replaced: replacement === undefined ? undefined : text.replace(re, replacement) };
}
