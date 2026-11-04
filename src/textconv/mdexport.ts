// Helpers for the Markdown tool that don't need a DOM.

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** The document title: the first heading, or a fallback. */
export function markdownTitle(md: string, fallback = "Document"): string {
  for (const line of md.split(/\r?\n/)) {
    const m = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      // Drop simple inline markup so the title reads cleanly.
      const text = m[1]
        .replace(/<[^>]*>/g, "")
        .replace(/[*_`~]|!?\[([^\]]*)\]\([^)]*\)/g, (_, label) => label ?? "")
        .trim();
      if (text) return text;
    }
  }
  return fallback;
}

/** Images that point at another site (http/https or protocol-relative), which the page's security policy blocks. */
export function remoteImageCount(md: string): number {
  const markdownImages = md.match(/!\[[^\]]*\]\(\s*<?(https?:)?\/\//gi)?.length ?? 0;
  const refImages = md.match(/^ {0,3}\[[^\]]+\]:\s*<?(https?:)?\/\//gim)?.length ?? 0;
  const htmlImages = md.match(/<img\b[^>]*\bsrc\s*=\s*["']?(https?:)?\/\//gi)?.length ?? 0;
  // A reference definition might be a link rather than an image; only count it if images use references.
  return markdownImages + htmlImages + (/!\[[^\]]*\]\[/.test(md) ? refImages : 0);
}

const EXPORT_CSS = `
body { max-width: 760px; margin: 40px auto; padding: 0 20px; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2328; background: #fff; }
h1, h2 { border-bottom: 1px solid #d8dee4; padding-bottom: .3em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.5em 0 .5em; }
a { color: #0969da; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }
code { background: #f0f2f5; padding: .15em .35em; border-radius: 4px; }
pre { background: #f6f8fa; padding: 14px 16px; border-radius: 8px; overflow: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 0; padding: 0 1em; color: #59636e; border-left: 4px solid #d1d9e0; }
table { border-collapse: collapse; display: block; overflow: auto; }
th, td { border: 1px solid #d1d9e0; padding: 6px 13px; }
tr:nth-child(2n) { background: #f6f8fa; }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid #d1d9e0; margin: 24px 0; }
li:has(> input[type="checkbox"]) { list-style: none; }
@media (prefers-color-scheme: dark) {
  body { color: #e6edf3; background: #0d1117; }
  a { color: #4493f8; }
  code { background: #262c36; }
  pre, tr:nth-child(2n) { background: #151b23; }
  h1, h2, th, td, hr { border-color: #3d444d; }
  blockquote { color: #9198a1; border-color: #3d444d; }
}
`.trim();

/** A complete HTML file around already-sanitized body HTML. */
export function standaloneHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${EXPORT_CSS}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

export function fileNameFromTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "document"
  );
}
