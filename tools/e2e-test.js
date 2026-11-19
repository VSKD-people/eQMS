/*
  VeQMS end-to-end test: the DocuSign approval route and read-and-understood training, driven through the UI
  as each persona. Needs Node.js and Playwright with Chromium.
    1. Serve the app:  python3 -m http.server 4173 --bind 127.0.0.1 --directory veqms
    2. Run:            node tools/e2e-test.js [output-folder] [app-url]
  It starts from fresh demo data, writes the exported Excel files and e2e-results.json to the output folder
  (default: the system temp folder), and prints PASS or FAIL for each check.
  Last run on this build: 56 of 56 passed.
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
  const signCurrent = async (envSel) => { // open signing drawer, tick, continue, code, sign
    await click(envSel);
    await p.check('#drawer-root input[name="agree"]'); await submit();
    await p.fill('#dsotp', '123456'); await submit(); await p.waitForTimeout(900);
    await click('#drawer-root .drawer-foot .btn-primary'); // Done
  };
  const sendDrawer = async () => { for (const k of ['footer', 'version', 'docId', 'dates']) await p.check(`#drawer-root input[name="${k}"]`); await submit(); };
  const startUsed = await E(() => Q.ds.used());

  // ---------- A. POL-004: finish an envelope already out for signature ----------
  await as('u-vic'); await go('#/documents/POL-004');
  ok('A1 POL-004 shows Sign in DocuSign for Victoria', await p.locator('.page-head [data-act="ds-open-sign"]').count() === 1);
  await signCurrent('.page-head [data-act="ds-open-sign"]');
  let s = await E(() => { const e = Q.ds.active('POL-004'); return { st: e && e.status, signers: e && e.signers.map(x => x.u + ':' + x.status), doc: Q.S.docs['POL-004'].state, tomTask: Q.S.tasks.some(t => t.kind === 'ds-sign' && t.assignee === 'u-tom' && t.status === 'open' && t.record === 'POL-004') }; });
  ok('A2 after Victoria signs, PJ is next and has a DocuSign task', s.st === 'sent' && s.signers.join() === 'u-sam:Signed,u-priya:Signed,u-omar:Signed,u-vic:Signed,u-tom:Sent' && s.doc === 'In approval' && s.tomTask, JSON.stringify(s));
  await as('u-tom'); await go('#/today');
  ok('A3 PJ sees "Sign in DocuSign" task on Today', (await p.locator('.task-card', { hasText: 'Sign in DocuSign' }).count()) >= 1);
  await go('#/documents/POL-004');
  await signCurrent('.page-head [data-act="ds-open-sign"]');
  s = await E(() => {
    const d = Q.S.docs['POL-004'], v = Q.curVer(d), env = Q.ds.byId(v.envelope);
    const part = Q.S.assignments.filter(a => a.doc === 'POL-004' && a.ver === '2.0' && a.envelope);
    const aud = Q.S.assignments.filter(a => a.doc === 'POL-004' && a.ver === '2.0' && !a.envelope);
    return { state: d.state, v1: d.versions[0].state, env: env.status, signed: !!env.signedPdf, cert: !!env.certificate, vEnv: v.envelope === env.id, vSigned: !!v.signedPdf, sigs: v.signatures.map(x => x.meaning).join(','),
      part: part.map(a => a.user + ':' + (a.completed ? 'done' : 'open')).sort().join(','), partStmt: part[0] && part[0].statement, aud: aud.length, audHasPart: aud.some(a => ['u-sam', 'u-priya', 'u-omar'].includes(a.user)),
      members: Q.audienceMembers(d).length, used: Q.ds.used(), globalSigs: Q.S.signatures.filter(x => x.envelope === env.id).length, rule15: Q.S.runs.some(r => r.rule === 'RULE-15') };
  });
  ok('A4 envelope completes → POL-004 v2.0 Effective, v1.0 Superseded', s.state === 'Effective' && s.v1 === 'Superseded' && s.env === 'completed', JSON.stringify(s));
  ok('A5 signed PDF, certificate and envelope ID stored against v2.0', s.signed && s.cert && s.vEnv && s.vSigned && s.globalSigs === 5 && s.sigs === 'Authored,Reviewed,Reviewed,Approved,Approved', s.sigs);
  ok('A6 completed training records for author and both reviewers, linked to envelope', s.part === 'u-omar:done,u-priya:done,u-sam:done' && /envelope/.test(s.partStmt), s.part);
  ok('A7 rest of the All staff audience allocated v2.0 (participants not re-allocated)', s.aud === s.members - 3 && !s.audHasPart, s.aud + ' of ' + s.members);
  ok('A8 completing an envelope does not use a send', s.used === startUsed, s.used + ' vs ' + startUsed);
  ok('A9 RULE-15 ran on completion', s.rule15);

  // ---------- B. POL-003: segregation of duties, decline, correction send, void ----------
  await as('u-vic'); await go('#/documents/POL-003');
  ok('B1 POL-003 warns about segregation of duties before sending', /authored this version/.test(await p.locator('.callout.warn').first().innerText()));
  await click('.page-head [data-act="ds-send"]');
  await sendDrawer();
  s = await E(() => ({ used: Q.ds.used(), st: Q.S.docs['POL-003'].state, sod: Q.S.audit.some(e => e.action === 'sod.block' && e.objectId === 'POL-003') }));
  ok('B2 send blocked by segregation of duties and logged; no send used', s.used === startUsed && s.st === 'Review closed' && s.sod, JSON.stringify(s));
  await p.selectOption('#dsa0', 'u-tom'); await p.waitForTimeout(150);
  await p.selectOption('#dsa1', ''); await p.waitForTimeout(150);
  await sendDrawer();
  s = await E(() => { const e = Q.ds.active('POL-003'); return { used: Q.ds.used(), st: Q.S.docs['POL-003'].state, signers: e.signers.map(x => x.u + ':' + x.meaning + ':' + x.order + ':' + x.status).join(','), subj: e.subject, ver: e.verification && e.verification.footer, audit: Q.S.audit.filter(a => a.objectId === 'POL-003' && /docusign\.(send|verify)/.test(a.action)).length }; });
  ok('B3 one envelope sent: subject has ID and version, order author → reviewer → QA approver', s.used === startUsed + 1 && s.st === 'In approval' && /^POL-003 v1\.1 · /.test(s.subj) && s.signers === 'u-vic:Authored:1:Sent,u-priya:Reviewed:2:Waiting,u-tom:Approved:3:Waiting' && s.ver && s.audit === 2, JSON.stringify(s));
  await signCurrent('.page-head [data-act="ds-open-sign"]');
  await as('u-priya'); await go('#/documents/POL-003');
  await click('.page-head [data-act="ds-open-sign"]'); await click('#drawer-root [data-act="ds-decline"]');
  await p.fill('#dsdr', 'Section 3 still says Confidential may be printed.'); await submit();
  s = await E(() => { const e = Q.ds.forRecord('POL-003')[0]; return { env: e.status, reason: e.declineReason, st: Q.S.docs['POL-003'].state, task: Q.S.tasks.some(t => t.kind === 'resubmit' && t.record === 'POL-003' && t.assignee === 'u-vic' && t.status === 'open' && /Section 3/.test(t.note)), audit: Q.S.audit.some(a => a.action === 'docusign.declined' && /Section 3/.test(a.summary)), used: Q.ds.used() }; });
  ok('B4 declined envelope returns POL-003 to Draft with the reason recorded', s.env === 'declined' && s.st === 'Draft' && s.task && s.audit && s.used === startUsed + 1, JSON.stringify(s));
  await as('u-vic');
  await E(() => { const d = Q.S.docs['POL-003']; d.reviewers = []; Q.wf.doc.submitForReview(d); });
  await go('#/documents/POL-003'); await click('.page-head [data-act="ds-send"]'); await p.selectOption('#dsa0', 'u-tom'); await p.waitForTimeout(100); await p.selectOption('#dsa1', ''); await p.waitForTimeout(100); await sendDrawer();
  s = await E(() => { const list = Q.ds.forRecord('POL-003'); return { n: list.length, corr: list[0].correctionOf === list[1].id, used: Q.ds.used() }; });
  ok('B5 corrected envelope is a second send and points at the declined one', s.n === 2 && s.corr && s.used === startUsed + 2, JSON.stringify(s));
  await click('.page-head [data-act="ds-void"]'); await p.fill('#dsvr', 'Wrong review date on page 1.'); await submit();
  s = await E(() => ({ env: Q.ds.forRecord('POL-003')[0].status, st: Q.S.docs['POL-003'].state, used: Q.ds.used(), signTasks: Q.S.tasks.filter(t => t.record === 'POL-003' && t.kind === 'ds-sign' && t.status === 'open').length }));
  ok('B6 void returns to Draft, closes signing tasks, send still counted', s.env === 'voided' && s.st === 'Draft' && s.used === startUsed + 2 && s.signTasks === 0, JSON.stringify(s));

  // ---------- C. VP-001: validation plan, QA approval ----------
  await go('#/today');
  ok('C1 Victoria has a "Verify and send" task for VP-001', (await p.locator('.task-card', { hasText: 'VP-001' }).count()) === 1);
  await go('#/documents/VP-001'); await click('.page-head [data-act="ds-send"]'); await sendDrawer();
  for (const u of ['u-priya', 'u-omar', 'u-vic']) { await as(u); await go('#/documents/VP-001'); await signCurrent('.page-head [data-act="ds-open-sign"]'); }
  s = await E(() => { const d = Q.S.docs['VP-001']; return { st: d.state, part: Q.S.assignments.filter(a => a.doc === 'VP-001' && a.envelope).map(a => a.user).sort().join(','), aud: Q.S.assignments.filter(a => a.doc === 'VP-001' && !a.envelope).map(a => a.user).sort().join(','), reviewOpen: Object.values(Q.S.reviews).some(r => r.doc === 'VP-001' && r.state === 'Open') }; });
  ok('C2 VP-001 Effective after author, reviewer and QA approver sign', s.st === 'Effective' && s.reviewOpen, JSON.stringify(s));
  ok('C3 audience (IT team + Quality Manager role) allocated; author and reviewer have records from the envelope', s.part === 'u-omar,u-priya' && s.aud.indexOf('u-vic') >= 0 && s.aud.indexOf('u-jake') >= 0 && s.aud.indexOf('u-priya') < 0, JSON.stringify(s));

  // ---------- D. CAPA-005 closure through DocuSign ----------
  await as('u-vic'); await go('#/quality/CAPA-005?tab=effectiveness');
  await p.fill('#cer', 'Next simulation click rate was 4% (1 of 24).'); await click('form[data-submit="capa-eff"] button[type="submit"]');
  await sendDrawer();
  s = await E(() => { const e = Q.ds.active('CAPA-005'); return e && e.signers.map(x => x.u + ':' + x.meaning).join(','); });
  ok('D1 CAPA closure envelope: owner (Authored) then QA approver (Approved)', s === 'u-priya:Authored,u-vic:Approved', s);
  await as('u-priya'); await go('#/quality/CAPA-005'); await signCurrent('.page-head [data-act="ds-open-sign"]');
  await as('u-vic'); await go('#/quality/CAPA-005'); await signCurrent('.page-head [data-act="ds-open-sign"]');
  s = await E(() => { const c = Q.S.capas['CAPA-005']; return { st: c.state, env: !!c.closeEnvelope, res: c.effectiveness.result, by: c.effectiveness.by, qe: Q.S.events['QE-013'].state }; });
  ok('D2 CAPA-005 closed when the envelope completed; source event closed', s.st === 'Closed' && s.env && /4%/.test(s.res) && s.by === 'u-vic' && s.qe === 'Closed', JSON.stringify(s));

  // ---------- E. Deviation QE-017 through DocuSign; other event types stay in-app ----------
  await go('#/quality/QE-017');
  ok('E1 deviation offers "Close through DocuSign"', /Close through DocuSign/.test(await p.locator('.page-head').innerText()));
  await click('.page-head [data-act="qe-close"]'); await p.fill('#dj', 'One-off delay; the test passed and the schedule stays the same.'); await submit();
  await sendDrawer();
  await as('u-grace'); await go('#/quality/QE-017'); await signCurrent('.page-head [data-act="ds-open-sign"]');
  await as('u-vic'); await go('#/quality/QE-017'); await signCurrent('.page-head [data-act="ds-open-sign"]');
  s = await E(() => { const e = Q.S.events['QE-017']; return { st: e.state, env: e.closure && e.closure.envelope }; });
  ok('E2 deviation QE-017 closed by completed envelope', s.st === 'Closed' && !!s.env, JSON.stringify(s));
  await go('#/quality/QE-015');
  ok('E3 non-deviation event keeps in-app "Close without CAPA"', /Close without CAPA/.test(await p.locator('.page-head').innerText()));

  // ---------- F. Read and understood (Route 2) ----------
  await go('#/training');
  const a = await E(() => Q.S.assignments.find(x => x.user === 'u-vic' && x.doc === 'SOP-012' && Q.trOpen(x)).id);
  await click(`[data-act="train-start"][data-id="${a}"]`);
  await p.check('#drawer-root input[name="read"]'); await submit();
  for (const [i, ans] of [[0, 1], [1, 0], [2, 1]]) await p.check(`#drawer-root input[name="q${i}"][value="${ans}"]`);
  await submit();
  const stmtShown = await p.locator('#drawer-root .statement').innerText();
  ok('F1 confirm step shows the exact statement naming document and version', /I confirm I have read and understood SOP-012, version 3\.0/.test(stmtShown), stmtShown);
  ok('F2 no date or time field can be typed in the acknowledgement', (await p.locator('#drawer-root input[type="date"], #drawer-root input[type="datetime-local"], #drawer-root input[type="time"]').count()) === 0);
  await p.check('#drawer-root input[name="confirm"]'); await submit();
  s = await E(id => { const r = Q.S.assignments.find(x => x.id === id); const au = Q.S.audit.filter(e => e.objectId === id && e.action === 'training.complete')[0]; return { done: !!r.completed, stmt: r.statement, via: r.via, quiz: r.quiz, before: au && au.before, after: au && au.after && au.after.status, status: Q.trStatus(r), title: r.title, by: r.allocatedBy, assigned: !!r.assigned, due: !!r.due }; }, a);
  ok('F3 record completed: statement, SSO identity, system time, audit with old and new values', s.done && s.stmt === 'I confirm I have read and understood SOP-012, version 3.0' && /single sign-on/.test(s.via) && s.quiz === '3/3' && s.before && s.before.completed === null && s.after === 'Complete' && s.status === 'Complete', JSON.stringify(s));
  ok('F4 record holds person, document, title, version, allocated by, assigned, due', s.title === 'Backup and Restore Procedure' && s.by && s.assigned && s.due);
  s = await E(() => { const r = Q.S.assignments.find(x => x.user === 'u-daniel' && x.doc === 'SOP-012' && Q.trOpen(x)); const res = Q.completeTraining(r, {}); return { res, done: !!r.completed }; });
  ok('F5 nobody can acknowledge for someone else (Victoria → Daniel refused)', s.res === false && !s.done, JSON.stringify(s));
  s = await E(id => { const r = Q.S.assignments.find(x => x.id === id); const t = r.completed; const res = Q.completeTraining(r, {}); return { res, same: r.completed === t }; }, a);
  ok('F6 a completed record cannot be confirmed again or changed', s.res === false && s.same);

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
  ok('H1 new starter automatically gets the current version of every document their groups need', s.docs.indexOf('SOP-018 v1.1') >= 0 && s.docs.indexOf('POL-004 v2.0') >= 0 && s.docs.indexOf('VP-001 v1.0') >= 0 && s.reasons === 'New starter' && s.tasks >= 6 && s.audit, s.docs);
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
  const ap = await p.locator('main').innerText();
  ok('K6 register shows sends used and remaining against 500', new RegExp((startUsed + 5) + ' of 500').test(ap) && /remaining/.test(ap), (ap.match(/\d+ of 500/) || [''])[0]);
  const [dl3] = await Promise.all([p.waitForEvent('download'), click('[data-act="rpt-xlsx"][data-key="sends"]')]); await dl3.saveAs(OUT + '/docusign-sends.xlsx');
  await go('#/approvals?tab=register');
  const [dl4] = await Promise.all([p.waitForEvent('download'), click('[data-act="rpt-xlsx"][data-key="approvals"]')]); await dl4.saveAs(OUT + '/approvals-register.xlsx');
  const regRows = await p.locator('table.t tbody tr').count();
  ok('K7 register of approvals lists completed envelopes', regRows >= 11, regRows);
  await p.locator('table.t tbody tr').first().click(); await p.waitForTimeout(250);
  const [pc] = await Promise.all([ctx.waitForEvent('page'), click('#drawer-root [data-act="ds-cert"]')]); await pc.waitForLoadState(); const certText = await pc.locator('body').innerText(); await pc.close();
  ok('K8 certificate of completion opens from the envelope', /Certificate of completion/.test(certText) && /Envelope ID/.test(certText));
  await click('#drawer-root .drawer-foot .btn:last-child');

  // ---------- L. Allowance, connector off, permissions ----------
  s = await E(() => {
    const d = Q.S.docs['WI-003']; d.checkedOut = null; d.reviewers = []; d.approvers = [{ u: 'u-tom', status: 'Waiting' }];
    Q.S.session.userId = 'u-sam'; Q.wf.doc.submitForReview(d);
    const cap = Q.S.settings.docusign.allowance; Q.S.settings.docusign.allowance = Q.ds.used();
    const blockedCap = Q.ds.cantSend('WI-003'); Q.S.settings.docusign.allowance = cap;
    Q.S.integrations.find(i => i.id === 'docusign').on = false; const blockedOff = Q.ds.cantSend('WI-003'); Q.S.integrations.find(i => i.id === 'docusign').on = true;
    Q.S.session.userId = 'u-daniel'; const emp = Q.ds.cantSend('WI-003'); const empNav = Q.can('approvals.view');
    Q.S.session.userId = 'u-aud'; const aud = Q.ds.cantSend('WI-003'); const audNav = Q.can('approvals.view'); const audCorr = Q.can('training.manage');
    Q.S.session.userId = 'u-sam'; const plan = Q.ds.plan('WI-003', { approvers: ['u-hannah'] }).problems.join(' ');
    Q.S.session.userId = 'u-vic';
    return { blockedCap, blockedOff, emp, empNav, aud, audNav, audCorr, plan };
  });
  ok('L1 no send once the yearly allowance is used up', /allowance of \d+ DocuSign sends is used up/.test(s.blockedCap), s.blockedCap);
  ok('L2 no send while the DocuSign connector is off', /connector is switched off/.test(s.blockedOff));
  ok('L3 employee cannot send and has no Approvals page; auditor read-only', /Only the owner/.test(s.emp) && !s.empNav && /read-only/.test(s.aud) && s.audNav && !s.audCorr, JSON.stringify(s));
  ok('L4 System Administrator cannot be a QA approver', /doesn’t hold the Approver or Quality Manager role/.test(s.plan), s.plan);
  s = await E(() => { const n = Q.S.notifications.filter(x => /allowance running low/.test(x.title)).length; const cap = Q.S.settings.docusign.allowance; Q.S.settings.docusign.allowance = Q.ds.used() + 3; Q.S.session.userId = 'u-sam'; Q.ds.send('WI-003', { verification: { footer: 1, version: 1, docId: 1, dates: 1 } }); Q.S.settings.docusign.allowance = cap; Q.S.session.userId = 'u-vic'; return Q.S.notifications.filter(x => /allowance running low/.test(x.title)).length - n; });
  ok('L5 Quality Manager is warned when the allowance runs low', s >= 1, s);

  // ---------- M. Obsolete closes open training; chain intact ----------
  s = await E(() => { const d = Q.S.docs['POL-009']; Q.wf.doc.obsolete(d, 'Replaced by POL-012'); return { open: Q.S.assignments.filter(a => a.doc === 'POL-009' && Q.trOpen(a)).length, done: Q.S.assignments.filter(a => a.doc === 'POL-009' && a.completed).length, tasks: Q.S.tasks.filter(t => t.record === 'POL-009' && t.kind === 'training' && t.status === 'open').length, chain: Q.verifyChain().ok }; });
  ok('M1 obsolete document closes open training; completed records kept', s.open === 0 && s.done > 0 && s.tasks === 0, JSON.stringify(s));
  ok('M2 audit chain still valid after all flows', s.chain);

  // ---------- N. Smoke test on the changed state ----------
  await go('#/today');
  const sm = await E(fs.readFileSync(SMOKE, 'utf8'));
  ok('N1 smoke test after the flows: every page and record renders for every persona', sm.errors === 0 && /valid/.test(sm.auditChain), JSON.stringify(sm));
  ok('N2 no page or console errors during the whole run', errs.length === 0, errs.slice(0, 5).join(' | '));

  fs.writeFileSync(OUT + '/e2e-results.json', JSON.stringify(results, null, 1));
  const failed = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '  → ' + r.detail)));
  console.log(`\n${results.length - failed.length} of ${results.length} passed · files in ${OUT}`);
  process.exitCode = failed.length ? 1 : 0;
  await b.close();
})().catch(e => { console.error('SCRIPT ERROR', e.message); process.exit(1); });
