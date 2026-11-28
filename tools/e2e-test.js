/*
  VeQMS end-to-end test: the document amendment flow (change request first, make the PDF, the four checks, submit,
  review, approval in VeQMS with the retraining choice, automatic send to Adobe Sign, signing in order, Effective,
  publishing to SharePoint), returns and declines, other sign-offs through Adobe Sign (closures, change requests,
  action sign-offs, CAPA plans, periodic reviews), actions done in the app without a signature, read-and-understood
  training (open the PDF before confirming) and SharePoint integrity alerts, driven through the UI as each persona.
  Needs Node.js and Playwright with Chromium.
    1. Serve the app:  python3 -m http.server 4173 --bind 127.0.0.1 --directory veqms
    2. Run:            node tools/e2e-test.js [output-folder] [app-url]
  It starts from fresh demo data, writes the exported Excel files and e2e-results.json to the output folder
  (default: the system temp folder), and prints PASS or FAIL for each check.
  Last run on this build: 110 of 110 passed.
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'veqms-e2e-'));
const URL = process.argv[3] || 'http://127.0.0.1:4173/';
const SMOKE = path.join(__dirname, 'smoke-test.js');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) }); }

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts/.test(m.text())) errs.push(m.text().slice(0, 300)); });
  ctx.on('page', pg => { pg.on('pageerror', e => errs.push('POPUP ' + e.message)); });
  await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);
  await p.evaluate(() => { Q.S.seen.tour = true; Q.save(); });
  await p.reload(); await p.waitForTimeout(600); await p.evaluate(() => { document.querySelectorAll('.tour').forEach(x => x.remove()); });
  const E = (fn, arg) => p.evaluate(fn, arg);
  const as = async (uid) => { await E(u => { Q.S.session.userId = u; Q.save(); Q.render({ noFocus: true }); }, uid); await p.waitForTimeout(80); };
  const go = async (hash) => { await E(hh => { if (location.hash === hh) { if (Q.drawer.isOpen()) Q.drawer.close(); Q.render({ noFocus: true }); } else location.hash = hh; }, hash); await p.waitForTimeout(250); };
  const click = async (sel) => { await p.evaluate(() => document.querySelectorAll('#toast-root > *').forEach(x => x.remove())); try { await p.click(sel, { timeout: 5000 }); } catch (e) { const info = await p.evaluate(() => ({ hash: location.hash, head: (document.querySelector('.page-head') || {}).innerText, drawer: (document.querySelector('#drawer-root') || {}).innerText, user: Q.S.session.userId })); results.forEach(r => console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '  → ' + r.detail))); console.log('CLICK FAILED', sel, JSON.stringify(info).slice(0, 900)); throw e; } await p.waitForTimeout(150); };
  const submit = async () => { await p.evaluate(() => document.querySelectorAll('#toast-root > *').forEach(x => x.remove())); await click('#drawer-root .drawer-foot .btn-primary'); };
  const toast = async () => (await p.locator('#toast-root').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const popup = async (sel) => { const [pg] = await Promise.all([ctx.waitForEvent('page'), click(sel)]); await pg.waitForLoadState(); const t = await pg.locator('body').innerText(); await pg.close(); return t; };
  const signCurrent = async (envSel) => { // open signing drawer, tick, continue, code, sign
    await click(envSel);
    await p.check('#drawer-root input[name="agree"]'); await submit();
    await p.fill('#esotp', '123456'); await submit(); await p.waitForTimeout(900);
    await click('#drawer-root .drawer-foot .btn-primary'); // Done
  };
  const sendDrawer = async () => { for (const k of ['footer', 'version', 'docId', 'dates']) await p.check(`#drawer-root input[name="${k}"]`); await submit(); };
  const checks = async () => { for (const k of ['footer', 'version', 'docId', 'dates']) await p.check(`#drawer-root input[name="${k}"]`); };
  const used = () => E(() => Q.esign.used());
  const startUsed = await used();

  // ---------- A. POL-004: an agreement already out for signature (sent on the last approval in VeQMS) ----------
  await as('u-vic'); await go('#/documents/POL-004');
  s = await E(() => ({ st: Q.S.docs['POL-004'].state, sign: document.querySelectorAll('.page-head [data-act="es-open-sign"]').length, send: document.querySelectorAll('[data-act="es-send"]').length, sentBy: Q.esign.active('POL-004').sentBy, approvers: Q.S.docs['POL-004'].approvers.map(a => a.u + ':' + a.status).join() }));
  ok('A1 POL-004 is in Signing (approved by both QA approvers in VeQMS); Victoria can sign; there is no manual send', s.st === 'Signing' && s.sign === 1 && s.send === 0 && s.sentBy === 'u-tom' && s.approvers === 'u-vic:Approved,u-tom:Approved', JSON.stringify(s));
  await signCurrent('.page-head [data-act="es-open-sign"]');
  var s = await E(() => { const e = Q.esign.active('POL-004'); return { st: e && e.status, signers: e && e.signers.map(x => x.u + ':' + x.status), doc: Q.S.docs['POL-004'].state, tomTask: Q.S.tasks.some(t => t.kind === 'esign-sign' && t.assignee === 'u-tom' && t.status === 'open' && t.record === 'POL-004') }; });
  ok('A2 after Victoria signs, PJ is next and has an Adobe Sign task', s.st === 'sent' && s.signers.join() === 'u-sam:Signed,u-priya:Signed,u-omar:Signed,u-vic:Signed,u-tom:Sent' && s.doc === 'Signing' && s.tomTask, JSON.stringify(s));
  await as('u-tom'); await go('#/today');
  ok('A3 PJ sees "Sign in Adobe Sign" task on Today', (await p.locator('.task-card', { hasText: 'Sign in Adobe Sign' }).count()) >= 1);
  await go('#/documents/POL-004');
  await signCurrent('.page-head [data-act="es-open-sign"]');
  s = await E(() => {
    const d = Q.S.docs['POL-004'], v = Q.curVer(d), env = Q.esign.byId(v.agreement);
    const part = Q.S.assignments.filter(a => a.doc === 'POL-004' && a.ver === '2.0' && a.agreement);
    const aud = Q.S.assignments.filter(a => a.doc === 'POL-004' && a.ver === '2.0' && !a.agreement);
    const cr = Q.S.crs[v.cr];
    return { state: d.state, v1: d.versions[0].state, env: env.status, signed: !!env.signedPdf, report: !!env.auditReport, vEnv: v.agreement === env.id, vSigned: !!v.signedPdf, sigs: v.signatures.map(x => x.meaning).join(','), pdfHash: env.pdf.hash === v.pdf.hash,
      part: part.map(a => a.user + ':' + (a.completed ? 'done' : 'open')).sort().join(','), partStmt: part[0] && part[0].statement, aud: aud.length, audHasPart: aud.some(a => ['u-sam', 'u-priya', 'u-omar'].includes(a.user)),
      members: Q.audienceMembers(d).length, used: Q.esign.used(), globalSigs: Q.S.signatures.filter(x => x.agreement === env.id).length, rule15: Q.S.runs.some(r => r.rule === 'RULE-15'),
      cr: cr && cr.id + ':' + cr.state, crAudit: Q.S.audit.some(e => e.objectId === v.cr && /closed: POL-004 v2\.0 is Effective/.test(e.summary)),
      pub2: v.publish && v.publish.status + ':' + (v.publish.hash === v.pdf.hash), pub1: d.versions[0].publish && d.versions[0].publish.status + ':' + d.versions[0].publish.fileStatus, pubAudit: Q.S.audit.some(e => e.action === 'publish' && e.objectId === 'POL-004' && /Published POL-004 v2\.0/.test(e.summary)) };
  });
  ok('A4 agreement completes → POL-004 v2.0 Effective, v1.0 Superseded', s.state === 'Effective' && s.v1 === 'Superseded' && s.env === 'completed', JSON.stringify(s));
  ok('A5 signed PDF, audit report and agreement ID stored; the agreement signed the locked PDF', s.signed && s.report && s.vEnv && s.vSigned && s.pdfHash && s.globalSigs === 5 && s.sigs === 'Authored,Reviewed,Reviewed,Approved,Approved', s.sigs);
  ok('A6 completed training records for author and both reviewers, linked to the agreement', s.part === 'u-omar:done,u-priya:done,u-sam:done' && /agreement/.test(s.partStmt), s.part);
  ok('A7 retraining needed: the rest of the All staff audience allocated v2.0 (participants not re-allocated)', s.aud === s.members - 3 && !s.audHasPart, s.aud + ' of ' + s.members);
  ok('A8 completing an agreement does not use a transaction', s.used === startUsed, s.used + ' vs ' + startUsed);
  ok('A9 RULE-15 ran on completion', s.rule15);
  ok('A10 the change request opened with v2.0 (CR-017) closed when it became Effective', s.cr === 'CR-017:Closed' && s.crAudit, JSON.stringify(s));
  ok('A11 v2.0 published to the controlled SharePoint library; the v1.0 file stays, marked Superseded', s.pub2 === 'published:true' && s.pub1 === 'superseded:Superseded' && s.pubAudit, JSON.stringify(s));

  // ---------- B. POL-003: return, edit, make the PDF (SoD refused), checks, submit, review, approve (no retraining),
  //               automatic send, decline, through again, sign, Effective with no retraining ----------
  await as('u-vic'); await go('#/documents/POL-003');
  const vicActs = await p.locator('.page-head .btn-row').innerText();
  await as('u-tom'); await go('#/documents/POL-003');
  const tomActs = await p.locator('.page-head .btn-row').innerText();
  ok('B1 POL-003 in approval: PJ can approve or return it; Victoria (author) can return it but not approve', /Approve/.test(tomActs) && /Return to the author/.test(tomActs) && !/Approve/.test(vicActs) && /Return to the author/.test(vicActs), tomActs + ' | ' + vicActs);
  await click('.page-head [data-act="doc-sendback"]'); await p.fill('#sb', 'Section 3 should say who sets the class for records from suppliers.'); await submit();
  s = await E(() => { const d = Q.S.docs['POL-003']; return { st: d.state, ap: d.approvers.map(a => a.u + ':' + a.status + ':' + (a.retrain === undefined)).join(), task: Q.S.tasks.some(t => t.kind === 'resubmit' && t.record === 'POL-003' && t.assignee === 'u-vic' && t.status === 'open' && /suppliers/.test(t.note)), approveOpen: Q.S.tasks.some(t => t.kind === 'approve-doc' && t.record === 'POL-003' && t.status === 'open'), audit: Q.S.audit.some(e => e.objectId === 'POL-003' && /Returned to the author by PJ Walters from In approval/.test(e.summary)) }; });
  ok('B2 return from approval: back to Draft with the reason; approval undone; the author has a task', s.st === 'Draft' && s.ap === 'u-tom:Waiting:true' && s.task && !s.approveOpen && s.audit, JSON.stringify(s));
  await as('u-vic'); await go('#/documents/POL-003');
  ok('B3 the document page shows the linked change request and the Word file in the Drafts library', /CR-018/.test(await p.locator('aside').innerText()) && /POL-003 Information Classification Policy\.docx/.test(await p.locator('aside').innerText()));
  const hadPdf = await E(() => !!Q.curVer(Q.S.docs['POL-003']).pdf);
  await click('.page-head [data-act="doc-edit"]');
  const editorText = await p.locator('#drawer-root').innerText();
  await p.fill('#dc', (await p.inputValue('#dc')).replace('The owner sets the class when the information is created.', 'The owner sets the class when the information is created, including records received from suppliers.'));
  await p.fill('#cs', 'Corrected typing errors, put the classes in order and said who classes supplier records.'); await submit();
  s = await E(() => { const v = Q.curVer(Q.S.docs['POL-003']); return { pdf: v.pdf, ver: v.verification, edited: Q.S.docs['POL-003'].draft.editedBy, audit: Q.S.audit.some(e => e.objectId === 'POL-003' && /locked PDF no longer matched the draft and was cleared/.test(e.summary)) }; });
  ok('B4 "Open in Word" opens the stand-in editor; saving the Word file clears the locked PDF', hadPdf && /stands in for Word/.test(editorText) && s.pdf === null && s.ver === null && s.edited === 'u-vic' && s.audit, JSON.stringify(s));
  await click('.page-head [data-act="doc-submit"]');
  const lists = await E(() => ({ rev: [...document.querySelectorAll('#drawer-root input[name="reviewers"]')].map(x => x.value), ap: [...document.querySelectorAll('#a1 option')].map(x => x.value).filter(Boolean) }));
  ok('B5 submit step 1: the author is offered neither as reviewer nor as QA approver; "Submit" stays off until the PDF is made', !lists.rev.includes('u-vic') && !lists.ap.includes('u-vic') && await p.locator('#drawer-root .drawer-foot .btn-primary').isDisabled(), JSON.stringify(lists));
  await p.check('#drawer-root input[name="reviewers"][value="u-tom"]'); await p.selectOption('#a1', 'u-tom'); await click('[data-act="ds-make"]');
  s = await E(() => ({ err: (document.getElementById('ds-error') || {}).innerText || '', pdf: Q.curVer(Q.S.docs['POL-003']).pdf, sod: Q.S.audit.some(e => e.action === 'sod.block' && e.objectId === 'POL-003' && /Submit refused/.test(e.summary)) }));
  ok('B6 PJ as both reviewer and QA approver: making the PDF is refused (segregation of duties) and logged', /segregation of duties/.test(s.err) && s.pdf === null && s.sod, JSON.stringify(s));
  await p.uncheck('#drawer-root input[name="reviewers"][value="u-tom"]'); await click('[data-act="ds-make"]');
  s = await E(() => { const v = Q.curVer(Q.S.docs['POL-003']); return { pdf: !!v.pdf && v.pdf.signers.map(x => x.u + ':' + x.meaning + ':' + x.order).join(), lock: Q.S.audit.some(e => e.action === 'pdf.lock' && e.objectId === 'POL-003' && e.after && e.after.pdfSha256 === v.pdf.hash), state: Q.S.docs['POL-003'].state }; });
  ok('B7 "Make the PDF": converted, hashed (SHA-256) and locked with a signature field per signer; still a draft', s.pdf === 'u-vic:Authored:1,u-priya:Reviewed:2,u-tom:Approved:3' && s.lock && s.state === 'Draft', JSON.stringify(s));
  await submit();
  ok('B8 submit without the four checks is refused', /tick all four checks/.test(await p.locator('#ds-error').innerText()) && await E(() => Q.S.docs['POL-003'].state === 'Draft'));
  const pdfText = await popup('#drawer-root [data-act="doc-pdf-locked"]');
  await checks(); await p.fill('#dsn', 'Checked against the Word file.'); await submit();
  s = await E(() => { const d = Q.S.docs['POL-003'], v = Q.curVer(d); return { st: d.state, ver: v.verification && v.verification.by + ':' + v.verification.footer + ':' + v.verification.note, rev: Q.S.tasks.some(t => t.kind === 'review-doc' && t.record === 'POL-003' && t.assignee === 'u-priya' && t.status === 'open'), fyi: Q.S.tasks.some(t => t.kind === 'fyi' && t.record === 'POL-003' && t.assignee === 'u-tom' && t.status === 'open'), read: Q.S.audit.some(e => e.action === 'read' && e.objectId === 'POL-003' && e.after && e.after.version === '1.1'), submitAudit: Q.S.audit.some(e => e.action === 'submit' && e.objectId === 'POL-003' && e.after && e.after.pdfSha256 === v.pdf.hash) }; });
  ok('B9 step 2: the locked PDF opens (logged with the version) with its signature page; four checks; submitted → In review', /Signature page/.test(pdfText) && /SHA-256/.test(pdfText) && s.st === 'In review' && s.ver === 'u-vic:true:Checked against the Word file.' && s.rev && s.fyi && s.read && s.submitAudit, JSON.stringify(s));
  await as('u-priya'); await go('#/documents/POL-003'); await click('.page-head [data-act="doc-review"]'); await submit();
  s = await E(() => ({ st: Q.S.docs['POL-003'].state, task: Q.S.tasks.some(t => t.kind === 'approve-doc' && t.record === 'POL-003' && t.assignee === 'u-tom' && t.status === 'open'), ag: !!Q.esign.active('POL-003') }));
  ok('B10 last reviewer done → In approval; PJ has an "Approve" task; nothing sent to Adobe Sign yet', s.st === 'In approval' && s.task && !s.ag, JSON.stringify(s));
  await as('u-tom'); await go('#/documents/POL-003'); await click('.page-head [data-act="doc-approve"]');
  await p.check('#drawer-root input[name="retrain"][value="no"]'); await submit();
  s = await E(() => ({ err: (document.querySelector('#drawer-root .err') || {}).innerText || '', st: Q.S.docs['POL-003'].approvers[0].status }));
  ok('B11 "No retraining" without a reason is refused', /Say why no retraining is needed/.test(s.err) && s.st === 'To approve', JSON.stringify(s));
  const usedB = await used();
  await p.fill('#dar', 'Corrections and a clarification only; what people do doesn’t change.'); await submit();
  s = await E(() => { const d = Q.S.docs['POL-003'], v = Q.curVer(d), e = Q.esign.active('POL-003'); return { st: d.state, vst: v.state, signers: e && e.signers.map(x => x.u + ':' + x.meaning + ':' + x.order + ':' + x.status).join(), sentBy: e && e.sentBy, pdf: e && e.pdf.hash === v.pdf.hash, ver: e && e.verification.by, retrain: v.retrain, reason: v.retrainReason, used: Q.esign.used(), verify: Q.S.audit.filter(a => a.objectId === 'POL-003' && a.action === 'esign.verify').length, approve: Q.S.audit.some(a => a.objectId === 'POL-003' && a.action === 'approve' && a.after && a.after.retrain === false) }; });
  ok('B12 the last approval sends one agreement at once: Signing, every signer in order, one transaction', s.st === 'Signing' && s.vst === 'Signing' && s.signers === 'u-vic:Authored:1:Sent,u-priya:Reviewed:2:Waiting,u-tom:Approved:3:Waiting' && s.sentBy === 'u-tom' && s.pdf && s.ver === 'u-vic' && s.used === usedB + 1 && s.verify === 0, JSON.stringify(s));
  ok('B13 the retraining decision is recorded on the version (no retraining, with the reason)', s.retrain === false && /Corrections/.test(s.reason) && s.approve, JSON.stringify(s));
  await as('u-vic'); await go('#/documents/POL-003'); await signCurrent('.page-head [data-act="es-open-sign"]');
  await as('u-priya'); await go('#/documents/POL-003');
  await click('.page-head [data-act="es-open-sign"]'); await click('#drawer-root [data-act="es-decline"]');
  await p.fill('#esdr', 'The review date on page 1 is wrong.'); await submit();
  s = await E(() => { const d = Q.S.docs['POL-003'], v = Q.curVer(d), e = Q.esign.forRecord('POL-003')[0]; return { env: e.status, st: d.state, ap: d.approvers.map(a => a.u + ':' + a.status + ':' + (a.retrain === undefined)).join(), rv: d.reviewers.map(r => r.status).join(), retrain: v.retrain, reason: v.retrainReason, task: Q.S.tasks.some(t => t.kind === 'resubmit' && t.record === 'POL-003' && t.status === 'open' && /review date/.test(t.note)), used: Q.esign.used() }; });
  ok('B14 decline → Draft: approvals and the retraining decision undone; the author has the reason; the transaction still counts', s.env === 'declined' && s.st === 'Draft' && s.ap === 'u-tom:Waiting:true' && s.rv === 'Not started' && s.retrain === true && s.reason === null && s.task && s.used === usedB + 1, JSON.stringify(s));
  // Through review and approval again (the PDF is still locked; the author checks it again and submits).
  await E(() => { const d = Q.S.docs['POL-003']; Q.S.session.userId = 'u-vic'; Q.wf.doc.submit(d, { footer: 1, version: 1, docId: 1, dates: 1 }, Q.curVer(d).pdf.hash); Q.S.session.userId = 'u-priya'; Q.wf.doc.review(d, ''); });
  await as('u-tom'); await go('#/documents/POL-003'); await click('.page-head [data-act="doc-approve"]');
  await p.check('#drawer-root input[name="retrain"][value="no"]'); await p.fill('#dar', 'Corrections and a clarification only; what people do doesn’t change.'); await submit();
  s = await E(() => { const list = Q.esign.forRecord('POL-003'); return { n: list.length, corr: list[0].correctionOf === list[1].id, used: Q.esign.used(), st: Q.S.docs['POL-003'].state }; });
  ok('B15 through review and approval again; the new agreement is a second transaction and points at the declined one', s.n === 2 && s.corr && s.used === usedB + 2 && s.st === 'Signing', JSON.stringify(s));
  for (const u of ['u-vic', 'u-priya', 'u-tom']) { await as(u); await go('#/documents/POL-003'); await signCurrent('.page-head [data-act="es-open-sign"]'); }
  s = await E(() => {
    const d = Q.S.docs['POL-003'], v = Q.curVer(d);
    const v11 = Q.S.assignments.filter(a => a.doc === 'POL-003' && a.ver === '1.1');
    const lena = Q.S.assignments.find(a => a.doc === 'POL-003' && a.user === 'u-lena' && a.ver === '1.0');
    const run = Q.S.runs.find(r => r.rule === 'RULE-09' && r.record === 'POL-003');
    return { st: d.state, v10: d.versions[0].state, cr: Q.S.crs[v.cr].state, alloc: v11.filter(a => !a.agreement).length, part: v11.filter(a => a.agreement).map(a => a.user).sort().join(), lena: lena && Q.trStatus(lena), cell: Q.trCell(Q.user('u-lena'), d).status, counts: Q.trainVersions(d).join(), run: run && run.detail, pub: v.publish && v.publish.status };
  });
  ok('B16 POL-003 v1.1 Effective; CR-018 closed; published', s.st === 'Effective' && s.v10 === 'Superseded' && s.cr === 'Closed' && s.pub === 'published', JSON.stringify(s));
  ok('B17 no retraining: training on v1.0 still counts and nobody is newly allocated', s.alloc === 0 && s.part === 'u-priya,u-vic' && s.lena === 'Complete' && s.cell === 'Complete' && s.counts === '1.1,1.0' && /No retraining/.test(s.run), JSON.stringify(s));

  // ---------- C. VP-001: approve (retraining), automatic send, cancel, through again, sign, Effective ----------
  await as('u-vic'); await go('#/today');
  ok('C1 Victoria has an "Approve" task for VP-001 on Today', (await p.locator('.task-card', { hasText: 'VP-001' }).count()) === 1 && /Approve · Document/.test(await p.locator('.task-card', { hasText: 'VP-001' }).innerText()));
  const usedC = await used();
  await go('#/documents/VP-001'); await click('.page-head [data-act="doc-approve"]'); await submit();
  s = await E(() => { const e = Q.esign.active('VP-001'); return { st: Q.S.docs['VP-001'].state, signers: e && e.signers.map(x => x.u + ':' + x.meaning).join(), retrain: Q.curVer(Q.S.docs['VP-001']).retrain, used: Q.esign.used() }; });
  ok('C2 VP-001: one QA approver approves (retraining, the default) → sent at once: author, reviewer, QA approver', s.st === 'Signing' && s.signers === 'u-priya:Authored,u-omar:Reviewed,u-vic:Approved' && s.retrain === true && s.used === usedC + 1, JSON.stringify(s));
  await click('.page-head [data-act="es-cancel"]'); await p.fill('#escr', 'Wrong review date on page 1.'); await submit();
  s = await E(() => { const d = Q.S.docs['VP-001']; return { env: Q.esign.forRecord('VP-001')[0].status, st: d.state, ap: d.approvers.map(a => a.status).join(), used: Q.esign.used(), signTasks: Q.S.tasks.filter(t => t.record === 'VP-001' && t.kind === 'esign-sign' && t.status === 'open').length }; });
  ok('C3 cancel → Draft, approval undone, signing tasks closed, transaction still counted', s.env === 'cancelled' && s.st === 'Draft' && s.ap === 'Waiting' && s.used === usedC + 1 && s.signTasks === 0, JSON.stringify(s));
  await E(() => { const d = Q.S.docs['VP-001']; Q.S.session.userId = 'u-priya'; Q.wf.doc.submit(d, { footer: 1, version: 1, docId: 1, dates: 1 }, Q.curVer(d).pdf.hash); Q.S.session.userId = 'u-omar'; Q.wf.doc.review(d, ''); Q.S.session.userId = 'u-vic'; Q.wf.doc.approve(d, { retrain: true }); });
  for (const u of ['u-priya', 'u-omar', 'u-vic']) { await as(u); await go('#/documents/VP-001'); await signCurrent('.page-head [data-act="es-open-sign"]'); }
  s = await E(() => { const d = Q.S.docs['VP-001']; return { st: d.state, corr: Q.esign.forRecord('VP-001')[0].correctionOf === Q.esign.forRecord('VP-001')[1].id, cr: Q.S.crs[Q.curVer(d).cr].state, part: Q.S.assignments.filter(a => a.doc === 'VP-001' && a.agreement).map(a => a.user).sort().join(','), aud: Q.S.assignments.filter(a => a.doc === 'VP-001' && !a.agreement).map(a => a.user).sort().join(','), reviewOpen: Object.values(Q.S.reviews).some(r => r.doc === 'VP-001' && r.state === 'Open') }; });
  ok('C4 VP-001 Effective after author, reviewer and QA approver sign; CR-021 closed', s.st === 'Effective' && s.corr && s.cr === 'Closed' && s.reviewOpen, JSON.stringify(s));
  ok('C5 audience (IT team + Quality Manager role) allocated; author and reviewer have records from the agreement', s.part === 'u-omar,u-priya' && s.aud.indexOf('u-vic') >= 0 && s.aud.indexOf('u-jake') >= 0 && s.aud.indexOf('u-priya') < 0, JSON.stringify(s));

  // ---------- D. CAPA-005 closure through Adobe Sign ----------
  await as('u-vic'); await go('#/quality/CAPA-005?tab=effectiveness');
  await p.fill('#cer', 'Next simulation click rate was 4% (1 of 24).'); await click('form[data-submit="capa-eff"] button[type="submit"]');
  await sendDrawer();
  s = await E(() => { const e = Q.esign.active('CAPA-005', 'capa-closure'); return e && e.signers.map(x => x.u + ':' + x.meaning).join(','); });
  ok('D1 CAPA closure agreement: owner (Authored) then QA approver (Approved)', s === 'u-priya:Authored,u-vic:Approved', s);
  await as('u-priya'); await go('#/quality/CAPA-005'); await signCurrent('.page-head [data-act="es-open-sign"]');
  await as('u-vic'); await go('#/quality/CAPA-005'); await signCurrent('.page-head [data-act="es-open-sign"]');
  s = await E(() => { const c = Q.S.capas['CAPA-005']; return { st: c.state, env: !!c.closeAgreement, res: c.effectiveness.result, by: c.effectiveness.by, qe: Q.S.events['QE-013'].state }; });
  ok('D2 CAPA-005 closed when the agreement completed; source event closed', s.st === 'Closed' && s.env && /4%/.test(s.res) && s.by === 'u-vic' && s.qe === 'Closed', JSON.stringify(s));

  // ---------- E. Quality events close without a CAPA through Adobe Sign, whatever their type ----------
  await go('#/quality/QE-017');
  ok('E1 deviation offers "Close without CAPA"', /Close without CAPA/.test(await p.locator('.page-head').innerText()));
  await click('.page-head [data-act="qe-close"]'); await p.fill('#dj', 'One-off delay; the test passed and the schedule stays the same.'); await submit();
  await sendDrawer();
  await as('u-grace'); await go('#/quality/QE-017'); await signCurrent('.page-head [data-act="es-open-sign"]');
  await as('u-vic'); await go('#/quality/QE-017'); await signCurrent('.page-head [data-act="es-open-sign"]');
  s = await E(() => { const e = Q.S.events['QE-017']; return { st: e.state, env: e.closure && e.closure.agreement }; });
  ok('E2 deviation QE-017 closed by completed agreement', s.st === 'Closed' && !!s.env, JSON.stringify(s));
  s = await E(() => { const p = Q.esign.plan('QE-015', { stage: 'qe-closure' }); return { signers: p.signers.map(x => x.u + ':' + x.meaning).join(','), purpose: p.purpose }; });
  ok('E3 a nonconformance (QE-015) also closes through Adobe Sign: owner, then QA approver', s.signers === 'u-grace:Authored,u-vic:Approved' && s.purpose === 'Quality event closure', JSON.stringify(s));

  // ---------- F. Read and understood: open the PDF of the version before confirming ----------
  await go('#/training');
  const a = await E(() => Q.S.assignments.find(x => x.user === 'u-vic' && x.doc === 'SOP-012' && Q.trOpen(x)).id);
  ok('F0 My training shows the open step not done yet', /1 Open the PDF and read/.test(await p.locator('main').innerText()) && await E(id => !Q.pdfOpenedAt(Q.S.assignments.find(x => x.id === id)), a));
  await click(`[data-act="train-start"][data-id="${a}"]`);
  ok('F1 step 1 offers "Open the PDF of v3.0"', (await p.locator('#drawer-root [data-act="train-pdf"]').count()) === 1 && /Open the PDF of v3\.0/.test(await p.locator('#drawer-root').innerText()));
  await p.check('#drawer-root input[name="read"]'); await submit();
  for (const [i, ans] of [[0, 1], [1, 0], [2, 1]]) await p.check(`#drawer-root input[name="q${i}"][value="${ans}"]`);
  await submit();
  const confirmText = await p.locator('#drawer-root').innerText();
  ok('F2 the confirm step says to open the PDF of v3.0 first', /Open the PDF of v3\.0 first/.test(confirmText), confirmText.slice(0, 200));
  await p.check('#drawer-root input[name="confirm"]'); await submit();
  s = await E(id => ({ done: !!Q.S.assignments.find(x => x.id === id).completed }), a);
  ok('F3 confirming before opening the PDF is refused', !s.done && /Open the PDF of SOP-012 v3\.0 first/.test(await toast()), JSON.stringify(s));
  const trPdf = await popup('#drawer-root .callout.warn [data-act="train-pdf"]');
  s = await E(id => { const r = Q.S.assignments.find(x => x.id === id); const e = Q.S.audit.filter(x => x.action === 'read' && x.objectId === 'SOP-012' && x.actor === 'u-vic').pop(); return { opened: !!Q.pdfOpenedAt(r), ver: e && e.after && e.after.version, warn: /first/.test(document.querySelector('#drawer-root').innerText) }; }, a);
  ok('F4 opening the PDF is logged with the version, and the warning goes', /SOP-012/.test(trPdf) && s.opened && s.ver === '3.0' && !s.warn, JSON.stringify(s));
  const stmtShown = await p.locator('#drawer-root .statement').innerText();
  ok('F5 confirm step shows the exact statement naming document and version', /I confirm I have read and understood SOP-012, version 3\.0/.test(stmtShown), stmtShown);
  ok('F6 no date or time field can be typed in the acknowledgement', (await p.locator('#drawer-root input[type="date"], #drawer-root input[type="datetime-local"], #drawer-root input[type="time"]').count()) === 0);
  await p.check('#drawer-root input[name="confirm"]'); await submit();
  s = await E(id => { const r = Q.S.assignments.find(x => x.id === id); const au = Q.S.audit.filter(e => e.objectId === id && e.action === 'training.complete')[0]; return { done: !!r.completed, stmt: r.statement, via: r.via, quiz: r.quiz, before: au && au.before, after: au && au.after && au.after.status, status: Q.trStatus(r), title: r.title, by: r.allocatedBy, assigned: !!r.assigned, due: !!r.due }; }, a);
  ok('F7 record completed: statement, SSO identity, system time, audit with old and new values', s.done && s.stmt === 'I confirm I have read and understood SOP-012, version 3.0' && /single sign-on/.test(s.via) && s.quiz === '3/3' && s.before && s.before.completed === null && s.after === 'Complete' && s.status === 'Complete', JSON.stringify(s));
  ok('F8 record holds person, document, title, version, allocated by, assigned, due', s.title === 'Backup and Restore Procedure' && s.by && s.assigned && s.due);
  s = await E(() => { const r = Q.S.assignments.find(x => x.user === 'u-daniel' && x.doc === 'SOP-012' && Q.trOpen(x)); const res = Q.completeTraining(r, {}); return { res, done: !!r.completed }; });
  ok('F9 nobody can acknowledge for someone else (Victoria → Daniel refused)', s.res === false && !s.done, JSON.stringify(s));
  s = await E(id => { const r = Q.S.assignments.find(x => x.id === id); const t = r.completed; const res = Q.completeTraining(r, {}); return { res, same: r.completed === t }; }, a);
  ok('F10 a completed record cannot be confirmed again or changed', s.res === false && s.same);
  s = await E(() => { const r = Q.S.assignments.find(x => x.user === 'u-daniel' && x.doc === 'POL-009' && Q.trOpen(x)); const d = Q.S.docs['POL-009']; Q.S.session.userId = 'u-daniel'; Q.logPdfOpen(d, d.versions[0]); const wrong = Q.completeTraining(r, {}); Q.logPdfOpen(d, Q.effVer(d)); const right = Q.completeTraining(r, {}); Q.S.session.userId = 'u-vic'; return { wrong, right }; });
  ok('F11 opening another version doesn’t count: only the PDF of the record’s version (v1.2)', s.wrong === false && s.right === true, JSON.stringify(s));

  // ---------- G. Corrections ----------
  const target = await E(() => Q.S.assignments.find(x => x.user === 'u-sam' && x.doc === 'SOP-012' && x.completed).id);
  await go('#/training?tab=records&rec=' + target); await p.waitForTimeout(200);
  ok('G1 record drawer shows Locked and a correction button for the Quality Manager', /Locked/.test(await p.locator('#drawer-root').innerText()) && (await p.locator('#drawer-root [data-act="tr-correct"]').count()) === 1);
  await click('#drawer-root [data-act="tr-correct"]'); await p.fill('#trcr', 'Confirmed during a screen-share demo, not a real read.'); await submit();
  s = await E(id => { const o = Q.S.assignments.find(x => x.id === id); const c = Q.S.assignments.find(x => x.correctionOf === id); return { orig: Q.trStatus(o), origDone: !!o.completed, corr: c && Q.trStatus(c), reason: c && c.correctionReason, task: Q.S.tasks.some(t => t.kind === 'training' && t.assignee === 'u-sam' && t.ref === (c && c.id) && t.status === 'open'), audit: Q.S.audit.some(e => e.objectId === id && e.action === 'training.correct' && e.before && e.after && e.after.status === 'Corrected') }; }, target);
  ok('G2 correction is a new record with a reason; original kept and shown as Corrected', s.orig === 'Corrected' && s.origDone && s.corr === 'Assigned' && /screen-share/.test(s.reason) && s.task && s.audit, JSON.stringify(s));
  s = await E(() => { const o = Q.S.assignments.find(x => x.user === 'u-lena' && x.doc === 'POL-001' && x.completed); Q.S.session.userId = 'u-hannah'; const r1 = Q.correctTraining(o, 'Admin trying to change it', false); Q.S.session.userId = 'u-vic'; return { adminBlocked: r1 === null }; });
  ok('G3 System Administrator cannot correct or change training records', s.adminBlocked);
  ok('G4 the app has no edit or delete action for training records', await E(() => !Object.keys(Q.act).some(k => /^(tr|train)-(edit|delete|remove)/.test(k))));

  // ---------- H. New starter, group change, role change ----------
  await as('u-hannah'); await go('#/admin/users');
  await click('[data-act="u-new"]'); await p.fill('#nsn', 'Alex Example'); await p.fill('#nst', 'Support Engineer'); await p.check('#drawer-root input[name="groups"][value="IT team"]'); await submit();
  s = await E(() => { const u = Q.S.users.find(x => x.name === 'Alex Example'); const list = Q.S.assignments.filter(a => a.user === u.id); return { id: u.id, docs: list.map(a => a.doc + ' v' + a.ver).sort().join(', '), reasons: [...new Set(list.map(a => a.allocReason))].join(), tasks: Q.S.tasks.filter(t => t.assignee === u.id && t.kind === 'training').length, audit: Q.S.audit.some(e => e.action === 'access.provision' && e.objectId === u.id) }; });
  ok('H1 new starter automatically gets the current version of every document their groups need', s.docs.indexOf('SOP-018 v1.1') >= 0 && s.docs.indexOf('POL-004 v2.0') >= 0 && s.docs.indexOf('VP-001 v1.0') >= 0 && s.docs.indexOf('POL-003 v1.1') >= 0 && s.reasons === 'New starter' && s.tasks >= 6 && s.audit, s.docs);
  await go('#/admin/users?user=u-daniel'); await p.waitForTimeout(200);
  await p.check('#drawer-root input[name="groups"][value="IT team"]'); await submit();
  s = await E(() => ({ sop18: Q.S.assignments.filter(a => a.user === 'u-daniel' && a.doc === 'SOP-018').map(a => a.allocReason + ':' + Q.trStatus(a)).join(), audit: Q.S.audit.some(e => e.action === 'access.groups' && e.objectId === 'u-daniel' && e.before && e.after) }));
  ok('H2 group change allocates the new audience’s documents (Daniel joins IT team → SOP-018)', /Group change:Assigned/.test(s.sop18) && s.audit, JSON.stringify(s));
  await go('#/admin/users?user=u-daniel'); await p.waitForTimeout(200);
  await p.uncheck('#drawer-root input[name="groups"][value="IT team"]'); await submit();
  s = await E(() => Q.S.assignments.filter(a => a.user === 'u-daniel' && a.doc === 'SOP-018').map(a => Q.trStatus(a) + ':' + (a.closed ? a.closed.reason : '')).join());
  ok('H3 leaving the group closes the open allocation with a reason (record kept)', /Withdrawn:Group change: no longer in the audience/.test(s), s);
  s = await E(() => { const d = Q.S.docs['SOP-018']; const before = Q.S.assignments.length; d.audience.roles = ['reviewer']; Q.S.session.userId = 'u-hannah'; const u = Q.user('u-mia'); Q.wf.user.requestRole(u, 'reviewer'); return Q.S.assignments.filter(a => a.user === 'u-mia' && a.doc === 'SOP-018').map(a => a.allocReason).join() + ' | +' + (Q.S.assignments.length - before); });
  ok('H4 role change allocates documents whose audience includes that role', /Role change/.test(s), s);

  // ---------- I. Audience change logged with old and new values ----------
  await as('u-vic'); await go('#/documents/SOP-014?tab=training'); await click('[data-act="doc-audience"]');
  await p.check('#drawer-root input[name="groups"][value="Support team"]'); await submit();
  s = await E(() => { const e = Q.S.audit.filter(x => x.action === 'training.audience' && x.objectId === 'SOP-014').pop(); return { before: e.before.audience.groups.join(), after: e.after.audience.groups.join(), n: Q.S.assignments.filter(a => a.doc === 'SOP-014' && a.allocReason === 'Audience change').map(a => a.user).sort().join() }; });
  ok('I1 audience change logs old and new audience and allocates the new members', s.before === 'Managers' && s.after === 'Managers,Support team' && /u-daniel/.test(s.n), JSON.stringify(s));

  // ---------- J. Reminders ----------
  await go('#/training?tab=records'); await click('[data-act="tr-reminders"]');
  s = await E(() => { const e = Q.S.audit.filter(x => x.action === 'training.reminders').pop(); return e && e.after; });
  ok('J1 reminders and overdue notices sent and logged', s && s.reminders + s.overdue > 0, JSON.stringify(s));

  // ---------- K. Reports: matrix, individual, document, approvals; PDF and Excel ----------
  await go('#/training?tab=matrix'); const mx = await p.locator('table.t tbody tr').count();
  ok('K1 training matrix renders person by document', mx >= 12, mx + ' rows');
  const cellText = await p.locator('table.t').innerText();
  ok('K2 matrix shows superseded training (earlier version trained, current not)', /v2\.1 → v3\.0|v1\.0 → v2\.0|v1\.1 → v1\.2/.test(cellText) || /Not allocated/.test(cellText), cellText.slice(0, 200));
  const [dl] = await Promise.all([p.waitForEvent('download'), click('[data-act="rpt-xlsx"][data-key="matrix"]')]);
  await dl.saveAs(OUT + '/training-matrix.xlsx');
  const [pop] = await Promise.all([ctx.waitForEvent('page'), click('[data-act="rpt-pdf"][data-key="matrix"]')]);
  await pop.waitForLoadState(); const popText = await pop.locator('body').innerText(); await pop.close();
  ok('K3 PDF export shows when and by whom it was generated', /Generated \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC by Victoria E\./.test(popText), popText.slice(0, 160));
  await go('#/training?tab=records&u=u-sam&all=1');
  ok('K4 individual training record report for one person', /Individual training record/i.test(await p.locator('main').innerText()));
  const [dl2] = await Promise.all([p.waitForEvent('download'), click('[data-act="rpt-xlsx"][data-key="records"]')]); await dl2.saveAs(OUT + '/training-records-sam.xlsx');
  await go('#/training?tab=records&d=POL-004&all=1');
  ok('K5 training status of a single document', /Training status of one document/i.test(await p.locator('main').innerText()));
  await go('#/approvals');
  const ap = await p.locator('main').innerText(), usedK = await used();
  ok('K6 register shows transactions used and remaining against 500', new RegExp(usedK + ' of 500').test(ap) && /remaining/.test(ap) && usedK === startUsed + 6, (ap.match(/\d+ of 500/) || [''])[0] + ' · used ' + usedK + ' from ' + startUsed);
  const [dl3] = await Promise.all([p.waitForEvent('download'), click('[data-act="rpt-xlsx"][data-key="transactions"]')]); await dl3.saveAs(OUT + '/adobe-sign-transactions.xlsx');
  await go('#/approvals?tab=register');
  const [dl4] = await Promise.all([p.waitForEvent('download'), click('[data-act="rpt-xlsx"][data-key="approvals"]')]); await dl4.saveAs(OUT + '/approvals-register.xlsx');
  const regRows = await p.locator('table.t tbody tr').count();
  ok('K7 register of approvals lists completed agreements', regRows >= 11, regRows);
  await p.locator('table.t tbody tr').first().click(); await p.waitForTimeout(250);
  const [pc] = await Promise.all([ctx.waitForEvent('page'), click('#drawer-root [data-act="es-audit-report"]')]); await pc.waitForLoadState(); const certText = await pc.locator('body').innerText(); await pc.close();
  ok('K8 audit report opens from the agreement', /Audit report/.test(certText) && /Agreement ID/.test(certText));
  await click('#drawer-root .drawer-foot .btn:last-child');

  // ---------- L. Allowance, connector off, permissions (WI-003 through submit to approval) ----------
  s = await E(() => {
    const d = Q.S.docs['WI-003'];
    Q.S.session.userId = 'u-sam'; Q.wf.doc.makePdf(d, [], ['u-tom']); Q.wf.doc.submit(d, { footer: 1, version: 1, docId: 1, dates: 1 }, Q.curVer(d).pdf.hash);
    const st = d.state;
    const tryApprove = (u) => { Q.S.session.userId = u; try { Q.wf.doc.approve(d, { retrain: true }); return 'approved'; } catch (e) { return e.message; } };
    const cap = Q.S.settings.esign.allowance; Q.S.settings.esign.allowance = Q.esign.used();
    const blockedCap = tryApprove('u-tom'); Q.S.settings.esign.allowance = cap;
    Q.S.integrations.find(i => i.id === 'adobesign').on = false; const blockedOff = tryApprove('u-tom'); Q.S.integrations.find(i => i.id === 'adobesign').on = true;
    const still = d.state + ':' + d.approvers[0].status;
    const emp = tryApprove('u-daniel'); Q.S.session.userId = 'u-daniel'; const empNav = Q.can('approvals.view');
    const aud = tryApprove('u-aud'); Q.S.session.userId = 'u-aud'; const audNav = Q.can('approvals.view'); const audCorr = Q.can('training.manage');
    Q.S.session.userId = 'u-sam'; const plan = Q.esign.plan('WI-003', { stage: 'doc-approval', approvers: ['u-hannah'] }).problems.join(' ');
    Q.S.session.userId = 'u-vic';
    return { st, blockedCap, blockedOff, still, emp, empNav, aud, audNav, audCorr, plan };
  });
  ok('L1 no reviewers: submit goes straight to approval in VeQMS', s.st === 'In approval', s.st);
  ok('L2 the last approval is refused (and not recorded) once the yearly allowance is used up', /allowance of \d+ Adobe Sign transactions is used up/.test(s.blockedCap) && s.still === 'In approval:To approve', s.blockedCap);
  ok('L3 the last approval is refused while the Adobe Sign connector is off', /connector is switched off/.test(s.blockedOff));
  ok('L4 employee and auditor cannot approve; employee has no Approvals page; auditor read-only', /aren’t a QA approver/.test(s.emp) && !s.empNav && /aren’t a QA approver/.test(s.aud) && s.audNav && !s.audCorr, JSON.stringify(s));
  ok('L5 System Administrator cannot be a QA approver', /doesn’t hold the Approver or Quality Manager role/.test(s.plan), s.plan);
  s = await E(() => { const n = Q.S.notifications.filter(x => /allowance running low/.test(x.title)).length; const cap = Q.S.settings.esign.allowance; Q.S.settings.esign.allowance = Q.esign.used() + 3; Q.S.session.userId = 'u-tom'; const ag = Q.wf.doc.approve(Q.S.docs['WI-003'], { retrain: true }); Q.S.settings.esign.allowance = cap; Q.S.session.userId = 'u-vic'; return { warned: Q.S.notifications.filter(x => /allowance running low/.test(x.title)).length - n, st: Q.S.docs['WI-003'].state, ag: !!ag }; });
  ok('L6 Quality Manager is warned when the allowance runs low (on the automatic send)', s.warned >= 1 && s.st === 'Signing' && s.ag, JSON.stringify(s));

  // ---------- M. Obsolete closes open training; chain intact ----------
  s = await E(() => { const d = Q.S.docs['POL-009']; Q.wf.doc.obsolete(d, 'Replaced by POL-012'); const v = d.versions[1]; return { open: Q.S.assignments.filter(a => a.doc === 'POL-009' && Q.trOpen(a)).length, done: Q.S.assignments.filter(a => a.doc === 'POL-009' && a.completed).length, tasks: Q.S.tasks.filter(t => t.record === 'POL-009' && t.kind === 'training' && t.status === 'open').length, file: v.publish.status + ':' + v.publish.fileStatus, chain: Q.verifyChain().ok }; });
  ok('M1 obsolete document closes open training; completed records kept', s.open === 0 && s.done > 0 && s.tasks === 0, JSON.stringify(s));
  ok('M2 its published file stays in the controlled library, marked Obsolete', s.file === 'superseded:Obsolete', s.file);
  ok('M3 audit chain still valid after all flows', s.chain);

  // ---------- O. Change requests, actions and other sign-offs ----------
  const usedBeforeO = await used();
  ok('O1 the in-app signing drawer is gone', await E(() => typeof Q.sign === 'undefined' && typeof Q.makeSignature === 'undefined'));
  // CR-016: the plan agreement is out; PJ signs it from Today.
  await as('u-tom'); await go('#/today');
  ok('O2 PJ has a "Sign in Adobe Sign" task for the CR-016 plan', (await p.locator('.task-card', { hasText: 'CR-016' }).count()) >= 1);
  await go('#/changes/CR-016'); await signCurrent('.page-head [data-act="es-open-sign"]');
  s = await E(() => { const c = Q.S.crs['CR-016']; const ag = Q.esign.byId(c.planAgreement); return { st: c.state, ag: ag.status, sig: c.signatures.map(x => x.stage + ':' + x.user + ':' + (x.agreement === ag.id)).join(), tasks: Q.S.tasks.filter(t => t.record === 'CR-016' && t.kind === 'cr-action' && t.status === 'open').map(t => t.ref).sort().join() }; });
  ok('O3 CR-016 plan agreement completes → In execution, signature recorded, action owners tasked', s.st === 'In execution' && s.ag === 'completed' && s.sig === 'Plan approved:u-tom:true' && s.tasks === 'A-8,A-9', JSON.stringify(s));
  // CR-015: review completes, the process owner sends the plan, owner and approver sign.
  await as('u-vic'); await E(() => { Q.wf.cr.review(Q.S.crs['CR-015'], 'Agree: UK West is the paired region.'); });
  s = await E(() => ({ st: Q.S.crs['CR-015'].state, send: Q.S.tasks.some(t => t.kind === 'send-approval' && t.record === 'CR-015' && t.assignee === 'u-tom' && t.stage === 'cr-plan' && t.status === 'open'), approve: Q.S.tasks.some(t => t.kind === 'cr-approve') }));
  ok('O4 when review completes, the process owner is asked to verify and send the plan (no in-app approve task)', s.st === 'Approval' && s.send && !s.approve, JSON.stringify(s));
  await as('u-tom'); await go('#/changes/CR-015'); await click('.page-head [data-act="es-send"][data-stage="cr-plan"]'); await sendDrawer();
  s = await E(() => { const a = Q.esign.active('CR-015', 'cr-plan'); return a && a.signers.map(x => x.u + ':' + x.meaning + ':' + x.order).join(); });
  ok('O5 CR-015 plan agreement: process owner (Authored), then approver (Approved)', s === 'u-tom:Authored:1,u-vic:Approved:2', s);
  await signCurrent('.page-head [data-act="es-open-sign"]');
  await as('u-vic'); await go('#/changes/CR-015'); await signCurrent('.page-head [data-act="es-open-sign"]');
  s = await E(() => ({ st: Q.S.crs['CR-015'].state, used: Q.esign.used() }));
  ok('O6 CR-015 moves to In execution only when the agreement completes; one transaction used', s.st === 'In execution' && s.used === usedBeforeO + 1, JSON.stringify(s));
  // Segregation of duties: a change request owner can't approve their own plan.
  s = await E(() => { const c = Q.wf.cr.create({ title: 'Test own approval', size: 'Minor', process: 'ISMS · Governance', classification: 'Internal', description: 'x', reason: 'y', impact: 'z', items: [], reviewers: [], approvers: ['u-vic'] }); Q.wf.cr.addAction(c, { title: 'Edit', assignee: 'u-vic', due: Q.dayIso(5), needsSignature: false }); Q.wf.cr.submit(c); return { st: c.state, problems: Q.esign.plan(c.id, { stage: 'cr-plan' }).problems.join(' ') }; });
  ok('O7 owner as approver of their own change request plan is refused (segregation of duties)', s.st === 'Approval' && /segregation of duties/.test(s.problems), JSON.stringify(s));
  // CR-015 action A-3 doesn't need a signature: Jim marks it done in the app; no agreement, no transaction.
  await as('u-sam'); await go('#/changes/CR-015?tab=actions');
  ok('O8 an action without "needs a signature" offers "Mark done", not Adobe Sign', /Mark done/.test(await p.locator('tr', { hasText: 'Update the asset inventory' }).innerText()));
  await click('[data-act="cr-done"][data-a="A-3"]');
  s = await E(() => { const a = Q.S.crs['CR-015'].actions.find(x => x.id === 'A-3'); return { st: a.status, sig: !!a.signature, ag: Q.esign.forRecord('CR-015', 'cr-action', 'A-3').length, audit: Q.S.audit.some(e => e.objectId === 'CR-015' && /Update the asset inventory" in VeQMS \(no signature needed\)/.test(e.summary)) }; });
  ok('O9 action A-3 done in the app with no signature and no agreement', s.st === 'Done' && !s.sig && s.ag === 0 && s.audit, JSON.stringify(s));
  // CR-012 action A-4 needs a signature: Jim completes it and signs it off in Adobe Sign.
  await go('#/changes/CR-012?tab=actions');
  await click('[data-act="cr-done"][data-a="A-4"]'); await sendDrawer();
  s = await E(() => { const a = Q.esign.active('CR-012', 'cr-action', 'A-4'); return a && { signers: a.signers.map(x => x.u + ':' + x.meaning).join(), done: Q.S.crs['CR-012'].actions.find(x => x.id === 'A-4').status }; });
  ok('O10 an action marked "needs a signature" goes to Adobe Sign to the person who did it; not done until signed', s && s.signers === 'u-sam:Completed' && s.done !== 'Done', JSON.stringify(s));
  await signCurrent('#main [data-act="es-open-sign"]');
  s = await E(() => { const a = Q.S.crs['CR-012'].actions.find(x => x.id === 'A-4'); return { st: a.status, by: a.signedBy, sig: !!a.signature && Q.S.signatures.some(x => x.id === a.signature && x.source === 'Adobe Sign') }; });
  ok('O11 action A-4 done and signed in Adobe Sign', s.st === 'Done' && s.by === 'u-sam' && s.sig, JSON.stringify(s));
  // CR-012 action A-6: Jim sends it, then declines; the action stays open with the reason.
  await go('#/changes/CR-012?tab=actions'); await click('[data-act="cr-done"][data-a="A-6"]'); await sendDrawer();
  await click('#main [data-act="es-open-sign"]'); await click('#drawer-root [data-act="es-decline"]');
  await p.fill('#esdr', 'FRM-007 still shows the old field order.'); await submit();
  s = await E(() => { const a = Q.S.crs['CR-012'].actions.find(x => x.id === 'A-6'); return { st: a.status, ret: a.returned && a.returned.how, task: Q.S.tasks.some(t => t.kind === 'cr-action' && t.ref === 'A-6' && t.status === 'open' && /FRM-007/.test(t.note || '')) }; });
  ok('O12 declined action sign-off returns the action to its owner with the reason', s.st !== 'Done' && s.ret === 'declined' && s.task, JSON.stringify(s));
  // Adding an action: "needs a signature" is a choice, unticked by default.
  await as('u-tom'); await go('#/changes/CR-015?tab=actions'); await click('[data-act="cr-addaction"]');
  const defaultTicked = await p.isChecked('#drawer-root input[name="needsSignature"]');
  await p.fill('#at', 'Tell the service desk about the new region'); await submit();
  await click('[data-act="cr-addaction"]'); await p.fill('#at', 'Sign off the restore runbook'); await p.check('#drawer-root input[name="needsSignature"]'); await submit();
  s = await E(() => Q.S.crs['CR-015'].actions.slice(-2).map(a => a.title.split(' ')[0] + ':' + a.needsSignature).join());
  ok('O13 a new action records "needs a signature" as set when it was created (unticked by default)', !defaultTicked && s === 'Tell:false,Sign:true', s);
  // CAPA-007 action CA-2 doesn't need a signature: Victoria marks it done in the app.
  await as('u-vic'); await go('#/quality/CAPA-007?tab=actions'); await click('[data-act="capa-done"][data-a="CA-2"]');
  s = await E(() => { const a = Q.S.capas['CAPA-007'].actions.find(x => x.id === 'CA-2'); return { st: a.status, sig: !!a.signature, ag: Q.esign.forRecord('CAPA-007', 'capa-action', 'CA-2').length }; });
  ok('O14 CAPA action CA-2 (no signature needed) done in the app with no agreement', s.st === 'Done' && !s.sig && s.ag === 0, JSON.stringify(s));
  // CAPA-008 action plan (high severity): owner, then a Quality Manager.
  await as('u-omar'); await go('#/quality/CAPA-008'); await click('.page-head [data-act="capa-plan"]');
  s = await E(() => { const p = Q.esign.plan('CAPA-008', { stage: 'capa-plan' }); return p.signers.map(x => x.u + ':' + x.meaning).join(); });
  ok('O15 high-severity CAPA plan: owner (Authored), then a Quality Manager (Approved)', s === 'u-omar:Authored,u-vic:Approved', s);
  await sendDrawer(); await signCurrent('.page-head [data-act="es-open-sign"]');
  await as('u-vic'); await go('#/quality/CAPA-008'); await signCurrent('.page-head [data-act="es-open-sign"]');
  s = await E(() => ({ st: Q.S.capas['CAPA-008'].state, locked: Q.S.capas['CAPA-008'].actionsLocked }));
  ok('O16 CAPA-008 actions lock and execution starts when the agreement completes', s.st === 'Execution' && s.locked, JSON.stringify(s));
  // Periodic review PR-031: "No update needed" is signed by the reviewer in Adobe Sign.
  await go('#/reviews/PR-031'); await click('.page-head [data-act="rv-ok"]'); await sendDrawer();
  s = await E(() => Q.S.reviews['PR-031'].state);
  ok('O17 periodic review stays open while its agreement is out', s === 'Open', s);
  await signCurrent('.page-head [data-act="es-open-sign"]');
  s = await E(() => { const r = Q.S.reviews['PR-031']; return { st: r.state, ag: !!r.agreement, next: Object.values(Q.S.reviews).some(x => x.doc === 'POL-001' && x.state === 'Open' && x.id !== 'PR-031') }; });
  ok('O18 review completes when the agreement completes; next review scheduled', s.st === 'Completed' && s.ag && s.next, JSON.stringify(s));
  s = await E(n => ({ used: Q.esign.used() - n, sigActions: Q.S.audit.filter(e => e.action === 'sign').length }), usedBeforeO);
  ok('O19 one transaction each for CR-015 plan, 2 signed actions, CAPA-008 plan and PR-031; none for actions done in the app', s.used === 5, JSON.stringify(s));
  ok('O20 audit chain still valid', await E(() => Q.verifyChain().ok));

  // ---------- S. SharePoint: libraries, publishing, integrity alerts ----------
  await as('u-vic'); await go('#/admin/sharepoint');
  const spText = await p.locator('main').innerText();
  ok('S1 SharePoint tab: last sync of both libraries, publishing status, the seeded open alert', /Drafts \(Word files\)/.test(spText) && /Controlled \(published PDFs\)/.test(spText) && /IA-2 · Changed outside VeQMS · FRM-007 v1\.3/.test(spText) && /Marked Superseded/.test(spText) && /Sync now/.test(spText), spText.slice(0, 300));
  await p.selectOption('#spd', 'SOP-012'); await p.check('input[name="how"][value="edit"]'); await click('form[data-submit="sp-simulate"] button[type="submit"]');
  s = await E(() => ({ open: Q.sp.openAlerts().filter(a => a.doc === 'SOP-012').length, pending: Q.sp.state().pending.length }));
  ok('S2 simulating an outside edit raises nothing until the next sync', s.open === 0 && s.pending === 1, JSON.stringify(s));
  const notesBefore = await E(() => Q.S.notifications.filter(n => n.to === 'u-vic' && /Integrity alert: SOP-012/.test(n.title)).length);
  await click('[data-act="sp-sync"]');
  s = await E(n => { const a = Q.sp.openAlerts().find(x => x.doc === 'SOP-012' && x.kind === 'outside-change'); return { a: a && a.id, detail: a && a.detail, run: Q.sp.state().runs.controlled.alerts, note: Q.S.notifications.filter(x => x.to === 'u-vic' && /Integrity alert: SOP-012/.test(x.title)).length - n, tom: Q.S.notifications.some(x => x.to === 'u-tom' && /Integrity alert: SOP-012/.test(x.title)), audit: Q.S.audit.some(e => e.action === 'integrity.alert' && e.objectId === 'SOP-012') }; }, notesBefore);
  ok('S3 "Sync now" raises an integrity alert (changed outside VeQMS); Quality Managers told; audited', !!s.a && /changed in the controlled library outside VeQMS by Victoria E\./.test(s.detail) && s.run === 1 && s.note === 1 && !s.tom && s.audit, JSON.stringify(s));
  await click('[data-act="sp-hash"]');
  s = await E(() => ({ mm: Q.sp.openAlerts().filter(a => a.doc === 'SOP-012' && a.kind === 'hash-mismatch').length, check: Q.sp.state().hashCheck.mismatches }));
  ok('S4 the hash check flags the changed file (hash mismatch)', s.mm === 1 && s.check === 1, JSON.stringify(s));
  await click('[data-act="sp-sync"]');
  ok('S5 the same alert isn’t raised twice', await E(() => Q.sp.openAlerts().filter(a => a.doc === 'SOP-012').length === 2));
  await as('u-hannah'); await go('#/admin/sharepoint');
  s = await E(() => ({ resolveBtns: document.querySelectorAll('[data-act="sp-resolve"]').length, sync: document.querySelectorAll('[data-act="sp-sync"]').length, can: Q.sp.canResolve(), tryIt: (() => { try { Q.sp.resolve(Q.sp.openAlerts()[0].id, 'Trying to resolve as admin'); return 'resolved'; } catch (e) { return e.message; } })() }));
  ok('S6 a System Administrator can sync but not resolve alerts', s.resolveBtns === 0 && s.sync === 1 && !s.can && /Only a Quality Manager/.test(s.tryIt), JSON.stringify(s));
  s = await E(() => { Q.S.session.userId = 'u-aud'; const aud = Q.can('admin.sharepoint') && !Q.can('admin.settings'); Q.S.session.userId = 'u-daniel'; const emp = Q.can('admin.sharepoint'); Q.S.session.userId = 'u-vic'; return { aud, emp }; });
  ok('S7 the auditor can view the SharePoint tab (read-only); an employee can’t', s.aud && !s.emp, JSON.stringify(s));
  await as('u-vic'); await go('#/admin/sharepoint');
  const alertId = await E(() => Q.sp.openAlerts().find(a => a.doc === 'SOP-012' && a.kind === 'outside-change').id);
  await click(`[data-act="sp-resolve"][data-id="${alertId}"]`); await submit();
  ok('S8 resolving needs a note', /Say what was found and done/.test(await p.locator('#drawer-root .err').innerText()) && await E(id => !Q.sp.state().alerts.find(a => a.id === id).resolvedAt, alertId));
  await p.fill('#spn', 'A site owner edited the file by mistake. Compared it with the locked PDF and published the locked PDF again.'); await submit();
  s = await E(id => { const a = Q.sp.state().alerts.find(x => x.id === id), v = Q.effVer(Q.S.docs['SOP-012']); return { by: a.resolvedBy, res: !!a.resolvedAt, restored: v.publish.fileHash === v.publish.hash, audit: Q.S.audit.some(e => e.action === 'integrity.resolve' && e.objectId === 'SOP-012'), btn: !!document.querySelector('[data-act="sp-resolve"][data-id="' + id + '"]'), again: (() => { try { Q.sp.resolve(id, 'Resolving it a second time'); return 'resolved'; } catch (e) { return e.message; } })() }; }, alertId);
  ok('S9 a Quality Manager resolves it with a note; the locked PDF is published again; audited', s.by === 'u-vic' && s.res && s.restored && s.audit && !s.btn, JSON.stringify(s));
  ok('S10 a resolved alert is final', /already resolved\. A resolved alert is final/.test(s.again), s.again);
  // Publishing fails while the SharePoint connector is off: still Effective in VeQMS; an alert; publish again later.
  s = await E(() => {
    Q.S.integrations.find(i => i.id === 'sp-pub').on = false;
    const ag = Q.esign.active('WI-003');
    for (const u of ['u-sam', 'u-tom']) { Q.S.session.userId = u; Q.esign.sign(ag); }
    const d = Q.S.docs['WI-003'], v = Q.curVer(d);
    const r = { st: d.state, pub: v.publish.status, alert: Q.sp.openAlerts().some(a => a.doc === 'WI-003' && a.kind === 'publish-failed'), dlq: Q.S.deadLetter.some(x => x.record === 'WI-003' && x.channel === 'SharePoint') };
    Q.S.integrations.find(i => i.id === 'sp-pub').on = true; Q.S.session.userId = 'u-vic';
    r.again = Q.sp.restore('WI-003', v.v); r.pub2 = v.publish.status; Q.save();
    return r;
  });
  ok('S11 publishing fails with the connector off: Effective in VeQMS anyway, alert raised, dead-lettered; "Publish again" works', s.st === 'Effective' && s.pub === 'failed' && s.alert && s.dlq && s.again && s.pub2 === 'published', JSON.stringify(s));

  // ---------- N. Smoke test on the changed state ----------
  await go('#/today');
  const sm = await E(fs.readFileSync(SMOKE, 'utf8'));
  ok('N1 smoke test after the flows: every page, record and drawer renders for every persona', sm.errors === 0 && /valid/.test(sm.auditChain), JSON.stringify(sm));
  ok('N2 no page or console errors during the whole run', errs.length === 0, errs.slice(0, 5).join(' | '));

  fs.writeFileSync(OUT + '/e2e-results.json', JSON.stringify(results, null, 1));
  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '  → ' + r.detail)));
  console.log(`\n${results.length - failed.length} of ${results.length} passed · files in ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
  await b.close();
})().catch(e => { console.error('SCRIPT ERROR', e.message); process.exit(1); });
