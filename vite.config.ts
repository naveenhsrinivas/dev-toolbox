import { defineConfig, type Plugin } from "vite";

// Strict Content Security Policy for the built site. connect-src 'none' means the
// page can't send anything it is given to any server — the browser blocks it.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

const csp: Plugin = {
  name: "csp",
  apply: "build",
  transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
};

export default defineConfig({
  // Relative asset paths so the build works under https://<user>.github.io/dev-toolbox/
  base: "./",
  plugins: [csp],
  worker: { format: "es" },
});
