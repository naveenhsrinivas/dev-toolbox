import { PDFDocument, PDFName, PDFString, StandardFonts } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { inspectPdf, protectPdf, ProtectError, unlockPdf } from "./core";

/** Open with pdf.js, the way a browser viewer would, and read back what matters. */
async function readWithPdfJs(bytes: Uint8Array, password?: string) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 });
  const doc = await task.promise;
  const { info } = (await doc.getMetadata()) as { info: Record<string, unknown> };
  const page = await doc.getPage(1);
  const text = (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join("");
  const result = {
    pages: doc.numPages,
    title: info.Title,
    lang: info.Language,
    labels: await doc.getPageLabels(),
    text,
    encrypted: info.EncryptFilterName,
  };
  await task.destroy();
  return result;
}

async function samplePdf(pages = 2, useObjectStreams = true, catalogStrings = true): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([300, 400]).drawText(`Secret page ${i + 1}`, { x: 20, y: 350, font });
  doc.setTitle("Quarterly report");
  // Strings in the catalog are written outside object streams, which pdf-lib doesn't encrypt on its own.
  if (catalogStrings) {
    doc.catalog.set(PDFName.of("Lang"), PDFString.of("en-GB"));
    doc.catalog.set(PDFName.of("PageLabels"), doc.context.obj({ Nums: [0, { S: "D", P: PDFString.of("S-") }] }));
  }
  return doc.save({ useObjectStreams });
}

const all = { printing: true, copying: true, editing: true };
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("protectPdf", () => {
  it("encrypts with AES-256 and needs the password to open", async () => {
    const enc = await protectPdf(await samplePdf(), { userPassword: "open sesame", permissions: all });
    const text = latin1(enc);
    expect(text).toMatch(/\/Encrypt \d+ 0 R/);
    expect(text).toMatch(/\/V 5/);
    expect(text).toMatch(/\/R 6/);
    expect(text).not.toContain("Secret page");
    await expect(PDFDocument.load(enc)).rejects.toThrow(/encrypted/);
    await expect(PDFDocument.load(enc, { password: "nope" })).rejects.toThrow();
    expect((await PDFDocument.load(enc, { password: "open sesame" })).getPageCount()).toBe(2);
    await expect(readWithPdfJs(enc)).rejects.toMatchObject({ name: "PasswordException" });
    await expect(readWithPdfJs(enc, "wrong")).rejects.toMatchObject({ name: "PasswordException" });
    expect(await readWithPdfJs(enc, "open sesame")).toEqual({
      pages: 2,
      title: "Quarterly report",
      lang: "en-GB",
      labels: ["S-1", "S-2"],
      text: "Secret page 1",
      encrypted: "Standard",
    });
    expect(await inspectPdf(enc)).toMatchObject({ encrypted: true, handler: "Standard", opensWithoutPassword: false });
  });

  it("stores the chosen permissions in /P", async () => {
    const enc = await protectPdf(await samplePdf(), {
      userPassword: "u",
      ownerPassword: "owner",
      permissions: { printing: true, copying: false, editing: false },
    });
    const p = Number(/\/P (-?\d+)/.exec(latin1(enc))![1]);
    expect(p & (1 << 2)).toBeTruthy(); // print
    expect(p & (1 << 11)).toBeTruthy(); // high-quality print
    expect(p & (1 << 4)).toBe(0); // copy
    expect(p & (1 << 3)).toBe(0); // modify
    // The owner password opens it too.
    expect((await PDFDocument.load(enc, { password: "owner" })).getPageCount()).toBe(2);
  });

  it("refuses an already encrypted file, a blank password and matching passwords", async () => {
    const enc = await protectPdf(await samplePdf(), { userPassword: "a", permissions: all });
    await expect(protectPdf(enc, { userPassword: "b", permissions: all })).rejects.toThrow(/already password-protected/);
    await expect(protectPdf(await samplePdf(), { userPassword: "", permissions: all })).rejects.toThrow(ProtectError);
    await expect(protectPdf(await samplePdf(), { userPassword: "x", ownerPassword: "x", permissions: all })).rejects.toThrow(
      /different owner password/,
    );
  });

  it("reports damaged input plainly", async () => {
    await expect(protectPdf(new TextEncoder().encode("not a pdf"), { userPassword: "a", permissions: all })).rejects.toThrow(
      /couldn't be read/,
    );
  });
});

describe("unlockPdf", () => {
  it("round-trips: the result opens without a password and keeps its pages", async () => {
    for (const objectStreams of [true, false]) {
      const enc = await protectPdf(await samplePdf(3, objectStreams), { userPassword: "pässwörd", permissions: all });
      // Non-ASCII passwords must match what other readers derive (UTF-8 for AES-256).
      expect((await readWithPdfJs(enc, "pässwörd")).pages).toBe(3);
      const out = await unlockPdf(enc, "pässwörd");
      expect(latin1(out)).not.toMatch(/\/Encrypt/);
      const doc = await PDFDocument.load(out);
      expect(doc.isEncrypted).toBe(false);
      expect(doc.getPageCount()).toBe(3);
      expect(await inspectPdf(out)).toEqual({ encrypted: false, pages: 3 });
      expect(await readWithPdfJs(out)).toEqual({
        pages: 3,
        title: "Quarterly report",
        lang: "en-GB",
        labels: ["S-1", "S-2", "S-3"],
        text: "Secret page 1",
        encrypted: null,
      });
    }
  });

  it("accepts the owner password", async () => {
    const enc = await protectPdf(await samplePdf(), { userPassword: "u", ownerPassword: "o", permissions: all });
    expect((await PDFDocument.load(await unlockPdf(enc, "o"))).getPageCount()).toBe(2);
  });

  it("unlocks files encrypted with the older AES-128 and RC4 handlers", async () => {
    // Made with pdf-lib's own encrypt(), which leaves catalog strings unencrypted, so the sample has none.
    for (const algorithm of ["AES-128", "RC4-128", "RC4-40"] as const) {
      const doc = await PDFDocument.load(await samplePdf(2, true, false));
      doc.encrypt({ userPassword: "old", ownerPassword: "own", algorithm, allowWeakCryptography: true });
      const out = await unlockPdf(await doc.save(), "old");
      expect(await readWithPdfJs(out)).toMatchObject({ pages: 2, title: "Quarterly report", text: "Secret page 1", encrypted: null });
    }
  });

  it("removes restrictions from a file that only has an owner password, given that password", async () => {
    const doc = await PDFDocument.load(await samplePdf(2, true, false));
    doc.encrypt({ userPassword: "", ownerPassword: "only-owner", permissions: { copying: false } });
    const enc = await doc.save();
    expect(await inspectPdf(enc)).toMatchObject({ encrypted: true, opensWithoutPassword: true });
    await expect(unlockPdf(enc, "")).rejects.toThrow(/Enter the PDF's current password/);
    await expect(unlockPdf(enc, "guess")).rejects.toThrow(/password isn't right/);
    expect((await PDFDocument.load(await unlockPdf(enc, "only-owner"))).getPageCount()).toBe(2);
  });

  it("explains a wrong password and an unencrypted file", async () => {
    const enc = await protectPdf(await samplePdf(), { userPassword: "right", permissions: all });
    await expect(unlockPdf(enc, "wrong")).rejects.toThrow(/password isn't right/);
    await expect(unlockPdf(enc, "")).rejects.toThrow(ProtectError);
    await expect(unlockPdf(await samplePdf(), "x")).rejects.toThrow(/isn't password-protected/);
  });
});
