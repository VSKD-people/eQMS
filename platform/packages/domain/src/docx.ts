// Minimal Word (.docx) writer with no dependencies, for the starting Word file of a new document in the SharePoint
// Drafts library: the title block, the template's section headings, and a footer with the document number, version
// and "Page X of Y" (Word fields), which the author checks at submit. Uses the stored-zip writer from xlsx.ts.
import { zipStore } from './xlsx.ts';

function esc(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const run = (t: string, o: { bold?: boolean; size?: number } = {}) =>
  `<w:r><w:rPr>${o.bold ? '<w:b/>' : ''}${o.size ? `<w:sz w:val="${o.size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const para = (inner: string) => `<w:p>${inner}</w:p>`;
const field = (code: string) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;

export interface DocxInput { number: string; title: string; version: string; classification: string; owner: string; sections: string[] }

export function docx(d: DocxInput): Buffer {
  const enc = new TextEncoder();
  const body = [
    para(run(`${d.number} ${d.title}`, { bold: true, size: 32 })),
    para(run(`Version ${d.version} · ${d.classification.toUpperCase()} · Owner: ${d.owner}`, { size: 18 })),
    ...d.sections.flatMap((s) => [para(run(s, { bold: true, size: 24 })), para(run('[Write this section.]'))])
  ].join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}`
    + `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/>`
    + `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W}>`
    + para(run(`${d.number} · version ${d.version} · Page `, { size: 16 }) + field('PAGE') + run(' of ', { size: 16 }) + field('NUMPAGES')) + '</w:ftr>';
  const files: [string, string][] = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'],
    ['word/document.xml', document],
    ['word/footer1.xml', footer]
  ];
  return zipStore(files.map(([name, xml]) => ({ name, data: enc.encode(xml) })));
}
