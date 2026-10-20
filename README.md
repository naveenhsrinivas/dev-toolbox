# Dev Toolbox

Everyday developer tools in one page. Everything runs in your browser: nothing you paste is uploaded, and the site's
Content Security Policy (`connect-src 'none'`) blocks the page from sending data anywhere.

| Tool                | What it does                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text Compare        | Side-by-side or unified diff with word-level highlights; ignore whitespace/case; collapse unchanged lines                                                        |
| JSON Formatter      | Format, minify, sort keys; exact line/column for errors; big numbers kept exactly                                                                                |
| JWT Decoder         | Header, claims (with explanations), expiry status; verifies HS256/384/512 signatures with a secret                                                               |
| Password Generator  | `crypto.getRandomValues` with no modulo bias; character sets, look-alike exclusion, entropy meter                                                                |
| PDF Editor          | Text, drawing, highlight, white-out, box, image and signature; rotate, reorder, delete and insert pages; undo/redo; correct on rotated pages                     |
| Resume Maker        | Classic, Modern, Minimal, Executive and Compact (ATS) templates; accent colour, font, A4/Letter; autosave; JSON import/export; PDF via the browser's Save as PDF |
| Base64              | Unicode-safe encode/decode, URL-safe variant, file → data URL                                                                                                    |
| URL Encode / Decode | Component or full-URL encoding, `+` as space, URL parts and query parameters                                                                                     |
| Hash Generator      | MD5, SHA-1, SHA-256/384/512 of text or files, checksum compare                                                                                                   |
| UUID Generator      | v4 and time-ordered v7 in bulk; inspector shows version and creation time                                                                                        |
| Timestamp Converter | Live Unix time; seconds/ms/µs/ns or date text → ISO, local, UTC, relative                                                                                        |
| Regex Tester        | Live highlighting, groups, replace; runs in a Web Worker and stops runaway patterns after 1.5 s                                                                  |
| Text Tools          | Character/word/line/byte counts, case conversion (camel, snake, kebab…), sort/dedupe lines                                                                       |

```sh
npm install
npm run dev     # http://localhost:5173
npm run check   # typecheck, formatting and unit tests
npm run build   # static site in dist/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.
