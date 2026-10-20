import { canVerifyWithSecret, decodeJwt, type DecodedJwt, timeClaims, tokenStatus, verifyHmac } from "../lib/jwt";
import { relativeTime } from "../lib/time";
import { button, checkbox, copyButton, debounce, field, h, header, message, textarea, type Tool } from "../ui";

const SAMPLE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

const CLAIMS: Record<string, string> = {
  iss: "Issuer — who created the token",
  sub: "Subject — who the token is about (usually a user ID)",
  aud: "Audience — who the token is meant for",
  exp: "Expiration time",
  nbf: "Not valid before",
  iat: "Issued at",
  jti: "Token ID",
  azp: "Authorized party",
  scope: "Permissions granted",
  scp: "Permissions granted",
  name: "Full name",
  email: "Email address",
  email_verified: "Whether the email is verified",
  roles: "Roles",
  sid: "Session ID",
  nonce: "Value to prevent replay",
  auth_time: "When the user authenticated",
  alg: "Signing algorithm",
  typ: "Token type",
  kid: "ID of the key used to sign",
};

function jsonBlock(title: string, value: unknown, cls: string): HTMLElement {
  const text = JSON.stringify(value, null, 2);
  const rows =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>).filter(([k]) => CLAIMS[k])
      : [];
  return h(
    "div",
    { class: `jwt-part ${cls}` },
    h(
      "div",
      { class: "label-row" },
      h("h2", {}, title),
      copyButton(() => text, "Copy", title),
    ),
    h("pre", { class: "code" }, text),
    rows.length ? h("dl", { class: "claims" }, ...rows.flatMap(([k]) => [h("dt", {}, h("code", {}, k)), h("dd", {}, CLAIMS[k])])) : null,
  );
}

function render(): HTMLElement {
  const input = textarea({
    placeholder: "Paste a JWT (eyJ…). It's decoded in your browser and never sent anywhere.",
    rows: 5,
    class: "mono token-input",
  });
  const out = h("div", { class: "jwt-out" });
  let current: DecodedJwt | undefined;

  const secret = h("input", { type: "password", placeholder: "Shared secret", autocomplete: "off", spellcheck: false, class: "mono" });
  let secretBase64 = false;
  const verifyResult = h("div");

  async function verify() {
    if (!current || !secret.value) return verifyResult.replaceChildren();
    try {
      const ok = await verifyHmac(current, secret.value, secretBase64);
      verifyResult.replaceChildren(
        ok ? message("ok", "Signature verified — this secret signed the token.") : message("error", "Invalid signature for this secret."),
      );
    } catch (err) {
      verifyResult.replaceChildren(message("error", (err as Error).message));
    }
  }
  secret.addEventListener("input", debounce(verify, 200));

  function colored(token: string): HTMLElement {
    const [a, b, c] = token
      .trim()
      .replace(/^Bearer\s+/i, "")
      .split(".");
    return h(
      "p",
      { class: "token-colored mono" },
      h("span", { class: "t-head" }, a),
      ".",
      h("span", { class: "t-body" }, b),
      ".",
      h("span", { class: "t-sig" }, c),
    );
  }

  function run() {
    current = undefined;
    verifyResult.replaceChildren();
    if (!input.value.trim())
      return out.replaceChildren(h("p", { class: "empty-hint" }, "Paste a token to see its header, payload and expiry."));
    const r = decodeJwt(input.value);
    if (!r.ok) return out.replaceChildren(message("error", r.error));
    current = r.jwt;
    const status = tokenStatus(r.jwt.payload);
    const times = timeClaims(r.jwt.payload);
    const alg = r.jwt.header.alg;

    out.replaceChildren(
      colored(input.value),
      h(
        "div",
        { class: "badges" },
        h("span", { class: `badge ${status.state}` }, status.message),
        h("span", { class: "badge" }, `Algorithm: ${String(alg ?? "none")}`),
      ),
      ...(times.length
        ? [
            h(
              "dl",
              { class: "kv" },
              ...times.flatMap((t) => [
                h("dt", {}, `${t.label} (${t.claim})`),
                h(
                  "dd",
                  {},
                  h(
                    "span",
                    {},
                    `${t.date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "long" })} · ${relativeTime(t.date)}`,
                  ),
                ),
              ]),
            ),
          ]
        : []),
      h("div", { class: "two-col" }, jsonBlock("Header", r.jwt.header, "head"), jsonBlock("Payload", r.jwt.payload, "body")),
      h(
        "div",
        { class: "jwt-part sig" },
        h("h2", {}, "Signature"),
        alg === "none"
          ? message("warn", 'This token is unsigned (alg "none"). Never accept it as proof of anything.')
          : canVerifyWithSecret(alg)
            ? h(
                "div",
                { class: "verify" },
                field(`Check the ${alg} signature`, secret, "Your secret stays in this tab."),
                checkbox("Secret is Base64-encoded", secretBase64, (v) => {
                  secretBase64 = v;
                  void verify();
                }),
                verifyResult,
              )
            : message(
                "info",
                `${String(alg)} signatures are checked with the issuer's public key, which this tool doesn't do. Decoding doesn't prove a token is genuine.`,
              ),
      ),
    );
    void verify();
  }
  input.addEventListener("input", debounce(run, 150));
  run();

  return h(
    "section",
    {},
    header(
      tool,
      button(
        "Load sample",
        () => {
          input.value = SAMPLE;
          run();
        },
        "btn ghost",
      ),
      button(
        "Clear",
        () => {
          input.value = secret.value = "";
          run();
          input.focus();
        },
        "btn ghost",
      ),
    ),
    field("Token", input),
    out,
  );
}

export const tool: Tool = {
  id: "jwt",
  name: "JWT Decoder",
  description: "Read a JSON Web Token's header, claims and expiry, and check HMAC signatures.",
  icon: "M7 14a4 4 0 1 1 3.9-5H21v4h-2v3h-3v-3h-5.1A4 4 0 0 1 7 14z",
  keywords: "jwt json web token decode bearer auth oauth claims verify",
  render,
};
