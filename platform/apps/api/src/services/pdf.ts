// PDFs made on our own server with pdf-lib: the exact document version that goes into the Adobe Sign agreement
// (every page footed with the document ID, version and "Page X of Y", plus a signature page with one invisible
// anchor per signer), closure summaries for CAPAs and deviations, and report tables.
// The standard Helvetica font only covers WinAnsi characters, so text is cleaned first.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const A4: [number, number] = [595.28, 841.89];
const M = 56; // margin

export function clean(s: string): string {
  return String(s ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/→/g, '->')
    .replace(/ /g, ' ').replace(/[^\x20-\x7E -ÿ]/g, '?');
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) > width && line) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

class Writer {
  readonly doc: PDFDocument; readonly font: PDFFont; readonly bold: PDFFont;
  page!: PDFPage; y = 0;
  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont) { this.doc = doc; this.font = font; this.bold = bold; this.newPage(); }
  newPage(): void { this.page = this.doc.addPage(A4); this.y = A4[1] - M; }
  ensure(h: number): void { if (this.y - h < M + 30) this.newPage(); }
  text(t: string, size = 10, opts: { bold?: boolean; gap?: number; colour?: [number, number, number] } = {}): void {
    const f = opts.bold ? this.bold : this.font;
    for (const line of wrap(t, f, size, A4[0] - 2 * M)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: M, y: this.y - size, size, font: f, color: rgb(...(opts.colour ?? [0, 0.17, 0.29])) });
      this.y -= size + 4;
    }
    this.y -= opts.gap ?? 4;
  }
}

async function start(): Promise<Writer> {
  const doc = await PDFDocument.create();
  return new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
}

function footer(w: Writer, label: string): void {
  const pages = w.doc.getPages();
  pages.forEach((p, i) => {
    const t = clean(`${label} · Page ${i + 1} of ${pages.length}`);
    p.drawText(t, { x: M, y: 30, size: 8, font: w.font, color: rgb(0.33, 0.38, 0.42) });
  });
}

export interface SignerLine { name: string; roleLabel: string; meaning: string; anchor: string }

export interface DocumentPdfInput {
  number: string; title: string; version: string; classification: string; owner: string; generatedAt: Date;
  blocks: { t: 'h' | 'p'; x: string }[]; signers: SignerLine[];
}

export async function documentPdf(d: DocumentPdfInput): Promise<Uint8Array> {
  const w = await start();
  w.text(`${d.number} ${d.title}`, 16, { bold: true, gap: 2 });
  w.text(`Version ${d.version} · ${d.classification.toUpperCase()} · Owner: ${d.owner} · Prepared ${d.generatedAt.toISOString().slice(0, 10)}`, 9, { gap: 12 });
  for (const b of d.blocks) b.t === 'h' ? w.text(b.x, 12, { bold: true, gap: 2 }) : w.text(b.x, 10, { gap: 8 });
  signaturePage(w, `${d.number} version ${d.version}`, d.signers);
  footer(w, `${d.number} · version ${d.version}`);
  return w.doc.save();
}

function signaturePage(w: Writer, what: string, signers: SignerLine[]): void {
  w.newPage();
  w.text('Approval signatures', 14, { bold: true });
  w.text(`Signed in Adobe Sign (Part 11). Each signer signs ${what} in the order below and chooses the meaning shown.`, 9, { gap: 12 });
  for (const s of signers) {
    w.ensure(70);
    w.text(`${s.roleLabel}: ${s.name}`, 10, { bold: true, gap: 0 });
    w.text(`Meaning: ${s.meaning}`, 9, { gap: 2 });
    // Invisible anchor: Adobe Sign places this signer's signature here.
    w.page.drawText(s.anchor, { x: M, y: w.y - 24, size: 8, font: w.font, color: rgb(1, 1, 1) });
    w.y -= 44;
  }
}

export interface ClosurePdfInput { number: string; title: string; purpose: string; owner: string; lines: [string, string][]; signers: SignerLine[]; generatedAt: Date }
export async function closurePdf(c: ClosurePdfInput): Promise<Uint8Array> {
  const w = await start();
  w.text(`${c.number} ${c.title}`, 16, { bold: true, gap: 2 });
  w.text(`${c.purpose} · Owner: ${c.owner} · Prepared ${c.generatedAt.toISOString().slice(0, 10)}`, 9, { gap: 12 });
  for (const [k, v] of c.lines) { w.text(k, 10, { bold: true, gap: 0 }); w.text(v || '-', 10, { gap: 8 }); }
  signaturePage(w, `${c.number} ${c.purpose.toLowerCase()}`, c.signers);
  footer(w, `${c.number} · ${c.purpose}`);
  return w.doc.save();
}

// Mock mode only: stands in for Adobe Sign's signed PDF and audit report.
export async function mockAuditReport(lines: [string, string][]): Promise<Uint8Array> {
  const w = await start();
  w.text('Audit report (MOCK - development only)', 14, { bold: true });
  for (const [k, v] of lines) w.text(`${k}: ${v}`, 10);
  footer(w, 'Mock audit report');
  return w.doc.save();
}
export async function stampSigned(original: Uint8Array, lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(A4);
  let y = A4[1] - M;
  page.drawText('Signatures (MOCK - development only)', { x: M, y, size: 14, font });
  for (const l of lines) { y -= 18; page.drawText(clean(l), { x: M, y, size: 10, font }); }
  return doc.save();
}

// Report tables (PDF export), stamped with who generated them and when.
export async function tablePdf(title: string, rows: (string | number | null)[][], stamp: { at: Date; by: string }): Promise<Uint8Array> {
  const w = await start();
  w.text(title, 14, { bold: true, gap: 2 });
  w.text(`Generated ${stamp.at.toISOString().replace('T', ' ').slice(0, 19)} UTC by ${stamp.by}`, 9, { gap: 10 });
  const [head, ...body] = rows;
  if (head) w.text(head.join(' | '), 8, { bold: true, gap: 2 });
  for (const r of body) w.text(r.map((c) => (c === null ? '' : String(c))).join(' | '), 8, { gap: 2 });
  footer(w, `${title} · generated ${stamp.at.toISOString().slice(0, 10)} by ${stamp.by}`);
  return w.doc.save();
}
