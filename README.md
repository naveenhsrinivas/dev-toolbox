# Dev Toolbox

Everyday developer tools in one page. Everything runs in your browser: nothing you paste is uploaded, and the site's
Content Security Policy (`connect-src 'none'`) blocks the page from sending data anywhere.

| Tool                        | What it does                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Text & data**             |                                                                                                                    |
| Text Compare                | Side-by-side or unified diff with word-level highlights; ignore whitespace/case; collapse unchanged lines          |
| JSON Formatter              | Format, minify, sort keys; exact line/column for errors; big numbers kept exactly                                  |
| YAML / JSON / CSV Converter | Convert between formats with auto-detect; nested objects ⇄ dotted CSV columns; big integers kept exact             |
| SQL Formatter               | Format or minify SQL in 8 dialects; keyword case and indent options; clear parse errors                            |
| Markdown Preview            | Live GitHub-flavoured preview, sanitised with DOMPurify; export HTML or .md                                        |
| Regex Tester                | Live highlighting, groups, replace; runs in a Web Worker and stops runaway patterns after 1.5 s                    |
| Text Tools                  | Character/word/line/byte counts, case conversion (camel, snake, kebab…), sort/dedupe lines                         |
| **Encoding & security**     |                                                                                                                    |
| JWT Decoder                 | Header, claims (with explanations), expiry status; verifies HS256/384/512 signatures with a secret                 |
| Password Generator          | `crypto.getRandomValues` with no modulo bias; character sets, look-alike exclusion, entropy meter                  |
| Base64                      | Unicode-safe encode/decode, URL-safe variant, file → data URL                                                      |
| URL Encode / Decode         | Component or full-URL encoding, `+` as space, URL parts and query parameters                                       |
| Hash Generator              | MD5, SHA-1, SHA-256/384/512 of text or files, checksum compare                                                     |
| **Generators & converters** |                                                                                                                    |
| UUID Generator              | v4 and time-ordered v7 in bulk; inspector shows version and creation time                                          |
| Timestamp Converter         | Live Unix time; seconds/ms/µs/ns or date text → ISO, local, UTC, relative                                          |
| Cron Explainer              | Plain-English description, per-field breakdown and the next 10 runs (local or UTC); `L`, `#`, seconds, aliases     |
| QR Code                     | Make codes for text, Wi-Fi, email, phone, SMS or contacts (PNG/SVG); read codes from images, paste or camera       |
| Color Converter             | HEX/RGB/HSL/HWB/OKLCH and named colours; WCAG contrast checker with passing-colour suggestions                     |
| Number Base Converter       | Binary/octal/decimal/hex/base-N with BigInt; two's complement, bit grid, bitwise calculator                        |
| **PDF**                     |                                                                                                                    |
| PDF Editor                  | Text, drawing, highlight, white-out, box, image and signature; rotate, reorder, delete and insert pages; undo/redo |
| PDF Merge                   | Combine PDFs in any order (drag or arrows), choose pages per file (`1-3, 5`, `8-`, `5-3`)                          |
| PDF Split                   | Split by ranges or every N pages, extract pages, or one file per page; ZIP download                                |
| PDF Compress / Resize       | Shrink by level or to a target size (text stays selectable), or pad up to an exact size for upload forms           |
| PDF Protect / Unlock        | Add an AES-256 password and permissions, or remove a password you know                                             |
| Image to PDF                | Combine images into one PDF; reorder, rotate, page size, margins; keeps original JPEG quality                      |
| PDF to Images               | Export pages as PNG or JPEG at any DPI; single pages or all as a ZIP                                               |
| **Images**                  |                                                                                                                    |
| Image Resizer               | Resize by percent or pixels, convert JPEG/PNG/WebP, fit under a target KB/MB or pad to an exact byte size          |
| Image Crop & Rotate         | Drag-to-crop with aspect presets (incl. passport 35×45 mm), rotate, flip and straighten                            |
| Image Converter             | Batch convert to JPEG/PNG/WebP with quality and max size; ZIP download                                             |
| **Documents**               |                                                                                                                    |
| Resume Maker                | Classic, Modern, Minimal, Executive and Compact (ATS) templates; autosave; JSON import/export; PDF via Save as PDF |

```sh
npm install
npm run dev     # http://localhost:5173
npm run check   # typecheck, formatting and unit tests
npm run build   # static site in dist/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.
