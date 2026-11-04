// Password protection with @cantoo/pdf-lib (a pdf-lib fork that can encrypt and decrypt).
// Only this lazily loaded module imports it, so the main bundle and the other PDF tools don't pay for it.
import {
  PDFArray,
  PDFCatalog,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFObject,
  PDFPageLeaf,
  PDFPageTree,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
} from "@cantoo/pdf-lib";

export class ProtectError extends Error {}

export interface Permissions {
  printing: boolean;
  copying: boolean;
  editing: boolean;
}

export interface ProtectOptions {
  userPassword: string;
  /** Blank means a random one is generated, so nobody can lift the restrictions. */
  ownerPassword?: string;
  permissions: Permissions;
}

export interface PdfInfo {
  encrypted: boolean;
  /** Undefined when the PDF is encrypted, as pages can't be counted without the password. */
  pages?: number;
  /** For encrypted files: whether it opens without a password (only an owner password is set). */
  opensWithoutPassword?: boolean;
  /** For encrypted files: the security handler name, e.g. "Standard". */
  handler?: string;
}

/**
 * pdf-lib encrypts stream data but not text strings. Strings inside object streams don't need it (the object
 * stream is encrypted as a whole), but the catalog, page tree and pages are always written outside object
 * streams, and readers decrypt their strings, so things like the document language and page labels would come
 * out garbled. Encrypt those strings here, in the same objects the writer keeps uncompressed.
 */
function encryptLooseStrings(doc: PDFDocument) {
  const security = doc.context.security;
  if (!security) return;
  const encryptRef = doc.context.trailerInfo.Encrypt;
  const sig = PDFName.of("Sig");
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (ref === encryptRef) continue;
    const dict = obj instanceof PDFStream ? obj.dict : obj;
    const uncompressed =
      obj instanceof PDFStream ||
      obj instanceof PDFCatalog ||
      obj instanceof PDFPageTree ||
      obj instanceof PDFPageLeaf ||
      ref.generationNumber !== 0;
    // Signature /Contents must stay unencrypted, and signing an encrypted file is out of scope anyway.
    if (!uncompressed || !(dict instanceof PDFDict) || dict.get(PDFName.of("Type")) === sig) continue;
    const encrypt = security.getEncryptFn(ref.objectNumber, ref.generationNumber);
    const visit = (value: PDFObject): PDFObject | undefined => {
      if (value instanceof PDFString || value instanceof PDFHexString) {
        const bytes = encrypt(value.asBytes());
        return PDFHexString.of(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
      }
      if (value instanceof PDFDict) for (const [k, v] of value.entries()) set(v, (nv) => value.set(k, nv));
      if (value instanceof PDFArray) for (let i = 0; i < value.size(); i++) set(value.get(i), (nv) => value.set(i, nv));
      return undefined;
    };
    const set = (v: PDFObject, put: (nv: PDFObject) => void) => {
      const nv = visit(v);
      if (nv) put(nv);
    };
    visit(dict);
  }
}

async function parse(bytes: Uint8Array, password?: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: password === undefined, password, updateMetadata: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/password incorrect/i.test(msg)) throw new ProtectError("That password isn't right. Check for typos and Caps Lock, and try again.");
    if (/needs password/i.test(msg)) throw new ProtectError("This PDF needs a password to open. Enter it and try again.");
    if (/not supported|unknown|unsupported/i.test(msg))
      throw new ProtectError("This PDF uses a kind of encryption this tool can't handle.");
    throw new ProtectError("This file couldn't be read as a PDF. It may be damaged.");
  }
}

/** Look at a file without a password: is it encrypted, and if so, can it be opened with an empty password? */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const doc = await parse(bytes);
  if (!doc.isEncrypted) return { encrypted: false, pages: doc.getPageCount() };
  const dict = doc.context.lookup(doc.context.trailerInfo.Encrypt);
  const filter = dict instanceof PDFDict ? dict.get(PDFName.of("Filter")) : undefined;
  const handler = filter instanceof PDFName ? filter.decodeText() : undefined;
  let opensWithoutPassword = false;
  if (handler === "Standard") {
    try {
      await PDFDocument.load(bytes, { password: "", updateMetadata: false });
      opensWithoutPassword = true;
    } catch {
      // Needs a real password.
    }
  }
  return { encrypted: true, handler, opensWithoutPassword };
}

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Encrypt with AES-256. Returns the new file. */
export async function protectPdf(bytes: Uint8Array, opts: ProtectOptions): Promise<Uint8Array> {
  if (!opts.userPassword) throw new ProtectError("Enter a password to open the PDF with.");
  if (opts.ownerPassword && opts.ownerPassword === opts.userPassword)
    throw new ProtectError(
      "Use a different owner password, or leave it blank. If they match, anyone who can open the file can lift the restrictions.",
    );
  const doc = await parse(bytes);
  if (doc.isEncrypted) throw new ProtectError("This PDF is already password-protected. Remove the password first, then protect it again.");
  // The AES-256 handler (revision 6) hashes passwords as UTF-8 after SASLprep; pdf-lib does the UTF-8 part, which covers
  // ordinary passwords. Very long passwords are truncated to 127 bytes by the spec.
  doc.encrypt({
    userPassword: opts.userPassword,
    ownerPassword: opts.ownerPassword || randomPassword(),
    algorithm: "AES-256",
    permissions: {
      printing: opts.permissions.printing ? "highResolution" : false,
      copying: opts.permissions.copying,
      contentAccessibility: true,
      modifying: opts.permissions.editing,
      annotating: opts.permissions.editing,
      fillingForms: opts.permissions.editing,
      documentAssembly: opts.permissions.editing,
    },
  });
  encryptLooseStrings(doc);
  return doc.save({ useObjectStreams: true });
}

/** Decrypt with the password (user or owner) and return an unencrypted copy. */
export async function unlockPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const raw = await parse(bytes);
  if (!raw.isEncrypted) throw new ProtectError("This PDF isn't password-protected, so there's nothing to remove.");
  // An empty password would open a file that only has an owner password and strip its restrictions without
  // the owner's say-so, so a real password is always required.
  if (!password) throw new ProtectError("Enter the PDF's current password.");
  const doc = await parse(bytes, password);
  // pdf-lib reads objects in file order rather than through the cross-reference table, so leftovers from an
  // earlier edit can shadow the real catalog. Viewers cope; this library can't, so say so instead of failing oddly.
  if (!(doc.context.lookup(doc.context.trailerInfo.Root) instanceof PDFCatalog))
    throw new ProtectError(
      "The password is right, but this PDF's internal structure is unusual and it couldn't be unlocked reliably. Open it in a PDF viewer with the password and use Print › Save as PDF instead.",
    );
  // When decrypting, the parser can't read cross-reference streams (they're never encrypted, but it tries to
  // decrypt them), so it loses the document info link and keeps those streams, which still name the old
  // encryption dictionary, as broken loose objects. Take the structure from an undecrypted parse instead.
  const { Encrypt, Info } = raw.context.trailerInfo;
  if (Encrypt instanceof PDFRef) doc.context.delete(Encrypt);
  delete doc.context.trailerInfo.Encrypt;
  for (const [ref, obj] of raw.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Type")) === PDFName.of("XRef")) doc.context.delete(ref);
  }
  if (!doc.context.trailerInfo.Info && Info instanceof PDFRef && doc.context.lookup(Info) instanceof PDFDict)
    doc.context.trailerInfo.Info = Info;
  return doc.save({ useObjectStreams: true });
}
