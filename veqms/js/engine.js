/* Workflow engine + automation rules (event → condition → action).
   Every transition writes the state change, an audit entry and an "outbox" event together.
   The outbox is processed synchronously here; in production a worker does it. */
(function (Q) {
  'use strict';
  var wf = Q.wf = {};
  function now() { return new Date().toISOString(); }
  function due(days) { return Q.dayIso(days, 17, 0); }
  function me() { return Q.S.session.userId; }

  // ---------- Automation engine ----------
  function rule(id) { return Q.S.rules.find(function (r) { return r.id === id; }); }
  function ran(r, ctx, result, detail) {
    r.runs = (r.runs || 0) + 1; r.lastRun = now();
    Q.S.runs.unshift({ id: Q.uid('RUN'), rule: r.id, at: now(), event: r.event, record: ctx.record || null, result: result, detail: detail });
    Q.audit('automation', 'Automation rule', r.id, r.id + ' ran on ' + (ctx.record || 'system') + ': ' + detail, null, null, { actor: 'system' });
  }
  function active(id) { var r = rule(id); return r && r.status === 'Active' ? r : null; }
  var ALL = ['in-app', 'email', 'teams', 'push'];

  Q.fire = function (event, ctx) {
    ctx = ctx || {};
    var r;
    switch (event) {
      case 'task.assigned':
        if ((r = active('RULE-01')) && !ctx.task.fyi) {
          Q.notify({ to: ctx.task.assignee, kind: 'action', mandatory: true, channels: ALL, record: ctx.task.record, rule: r.id,
            title: 'New task: ' + Q.taskMeta(ctx.task).label + ' · ' + ctx.task.record, body: Q.taskTitle(ctx.task) + (ctx.task.due ? ' · ' + Q.relDue(ctx.task.due).text : '') });
          ran(r, { record: ctx.task.record }, 'Sent', 'Notified ' + Q.fullName(ctx.task.assignee));
        }
        break;
      case 'stage.reached': // your turn
        if ((r = active('RULE-02'))) {
          Q.notify({ to: ctx.to, kind: 'action', mandatory: true, channels: ALL, record: ctx.record, rule: r.id, title: 'Your turn to ' + ctx.what + ' ' + ctx.record, body: ctx.body || Q.recTitle(ctx.record) });
          ran(r, ctx, 'Sent', ctx.to.length + ' notified: your turn to ' + ctx.what);
        }
        break;
      case 'workflow.entered': // FYI to later stages
        if ((r = active('RULE-03')) && ctx.to.length) {
          Q.notify({ to: ctx.to, kind: 'fyi', channels: ['in-app', 'email'], record: ctx.record, rule: r.id, title: 'FYI: you’ll be asked to ' + ctx.what + ' ' + ctx.record, body: ctx.body || ('Expected around ' + Q.fmtDay(due(7))) });
          ran(r, ctx, 'Sent', 'FYI to ' + ctx.to.map(Q.fullName).join(', '));
        }
        break;
      case 'state.changed':
        if ((r = active('RULE-04')) && ctx.owner && ctx.owner !== me()) {
          Q.notify({ to: ctx.owner, kind: 'info', channels: ['in-app', 'email'], record: ctx.record, rule: r.id, title: ctx.record + ' is now ' + ctx.state, body: Q.recTitle(ctx.record) });
          ran(r, ctx, 'Sent', 'Owner told: ' + ctx.state);
        }
        break;
      case 'sent.back':
        if ((r = active('RULE-05'))) {
          Q.notify({ to: ctx.to, kind: 'warn', mandatory: false, channels: ['in-app', 'email', 'teams'], record: ctx.record, rule: r.id, title: ctx.record + ' was sent back', body: 'Reason: ' + ctx.reason });
          ran(r, ctx, 'Sent', 'Sent back; ' + ctx.to.length + ' people told the reason');
        }
        break;
      case 'doc.effective':
        // The QA approvers' retraining decision is used here: with no retraining, training on the version it replaced
        // still counts (open allocations stay open) and only people with no training on it are allocated.
        if ((r = active('RULE-09'))) {
          var dd = Q.S.docs[ctx.record], ev = Q.effVer(dd), keep = !!ev && ev.retrain === false;
          var n = Q.allocateDoc(ctx.record, 'New version effective');
          ran(r, ctx, 'Done', keep ? 'No retraining (QA approvers’ decision: ' + (ev.retrainReason || 'no reason recorded').replace(/[.\s]+$/, '') + '). Earlier training still counts; ' + (n ? Q.plural(n, 'person', 'people') + ' with no training on it allocated v' + ev.v : 'nobody newly allocated')
            : n ? 'Allocated the new version to ' + Q.plural(n, 'person', 'people') + '; earlier records kept as superseded' : Q.hasAudience(dd) ? 'Everyone in the audience already has a record for this version' : 'No training audience on this document');
        }
        break;
      case 'record.created':
        if (ctx.severity === 'High' && (r = active('RULE-11'))) {
          var qms = Q.S.users.filter(function (u) { return u.roles.indexOf('qm') >= 0 && u.status === 'Active'; }).map(function (u) { return u.id; });
          Q.notify({ to: qms.concat([ctx.owner]).filter(function (x, i, a) { return a.indexOf(x) === i; }), kind: 'info', channels: ['in-app', 'email', 'teams'], record: ctx.record, rule: r.id, title: 'High-severity ' + Q.KIND_LABEL[Q.kindOf(ctx.record)].toLowerCase() + ' ' + ctx.record + ' raised', body: Q.recTitle(ctx.record) });
          if (!Q.integrationOn('teams')) Q.S.deadLetter.unshift({ id: Q.uid('DLQ'), rule: r.id, at: now(), record: ctx.record, channel: 'Teams channel', target: '#quality-events', attempts: 6, error: 'Teams connector is switched off (Phase 6).', status: 'Failed' });
          ran(r, ctx, Q.integrationOn('teams') ? 'Sent' : 'Partly failed', Q.integrationOn('teams') ? 'QM, owner and #quality-events told' : 'Email sent; Teams channel post queued (connector off)');
        }
        break;
      case 'signature.completed':
        if ((r = active('RULE-12')) && ctx.owner && ctx.owner !== me()) {
          Q.notify({ to: ctx.owner, kind: 'info', channels: ['in-app', 'email'], record: ctx.record, rule: r.id, title: Q.fullName(me()) + ' signed ' + ctx.record, body: 'Meaning: ' + ctx.meaning });
          ran(r, ctx, 'Sent', 'Owner told of signature');
        }
        break;
      case 'esign.completed':
        if ((r = active('RULE-15'))) ran(r, ctx, 'Done', 'Agreement ' + ctx.agreement + ' completed: signed PDF and audit report stored' + (ctx.training ? '; ' + Q.plural(ctx.training, 'completed training record') + ' for author and reviewers' : ''));
        break;
      case 'security':
        if ((r = active('RULE-13'))) {
          var admins = Q.S.users.filter(function (u) { return u.roles.indexOf('admin') >= 0; }).map(function (u) { return u.id; });
          Q.notify({ to: [ctx.user].concat(ctx.privilege ? admins : []), kind: 'security', mandatory: true, channels: ['in-app', 'email'], rule: r.id, title: ctx.title, body: ctx.body || '' });
          ran(r, { record: null }, 'Sent', ctx.title);
        }
        break;
    }
  };

  // quiet: the caller fires a "your turn" notification itself, so skip the generic "task assigned" one.
  function assign(o) { var t = Q.addTask(o); Q.audit('task.assign', 'Task', o.record, 'Assigned "' + Q.taskMeta(t).label + '" to ' + Q.fullName(o.assignee), null, { assignee: o.assignee, due: o.due }); if (!o.quiet) Q.fire('task.assigned', { task: t }); return t; }
  wf.assign = assign;

  // ---------- Signatures (insert-only) ----------
  // Every signature except read-and-understood training is made in Adobe Sign (see esign.js); completed agreements
  // add one row per signer to Q.S.signatures. The statement is printed on every agreement PDF.
  Q.statementFor = function (meaning) { return Q.S.settings.statement.replace('{meaning}', meaning); };
  Q.sigById = function (id) { return Q.S.signatures.find(function (s) { return s.id === id; }); };

  // Segregation of duties: may this person approve this record? Returns the reason when not. Every Adobe Sign
  // signing plan checks its approvers with it; with no uid it checks the current user.
  Q.sodBlock = function (rec, kind, uid) {
    var self = !uid || uid === me(), u = Q.user(uid || me());
    var who = self ? 'You' : u.name, they = self ? 'you' : 'they', own = self ? 'own' : 'owns';
    if (self && Q.readOnly()) return 'Your role is read-only.';
    if (Q.S.settings.sod.adminCannotApprove && u.roles.indexOf('admin') >= 0 && u.roles.indexOf('approver') < 0 && u.roles.indexOf('qm') < 0) return (self ? 'System Administrators' : u.name + ' is a System Administrator and') + ' cannot approve quality records (segregation of duties).';
    if (kind === 'doc' && Q.S.settings.sod.authorCannotApprove && rec.author === u.id) return who + ' authored this version, so ' + they + ' can’t approve it (segregation of duties). Choose another QA approver.';
    if (kind === 'cr' && rec.owner === u.id) return who + ' ' + own + ' this change request, so ' + they + ' can’t also approve it (segregation of duties).';
    if ((kind === 'capa' || kind === 'qe') && rec.owner === u.id) return who + ' ' + own + ' this record, so ' + they + ' can’t also approve it (segregation of duties).';
    return null;
  };

  // ---------- Documents ----------
  // The amendment flow (PJ Walters, 24 November 2026). Every amendment starts as a change request. The author edits the
  // Word file in the SharePoint Drafts library (simulated here by a stand-in editor) and submits in two steps: the draft
  // is converted to PDF, hashed and locked, then the author checks the locked PDF (footer, version, document ID, dates).
  // Reviewers mark it reviewed; QA approvers approve it in VeQMS and decide whether it needs retraining. The last
  // approval sends one Adobe Sign agreement with every signer (Signing). The version is Effective when it completes.
  // Draft → In review → In approval → Signing → Effective. Anyone on it can return it to the author before signing.
  var D = wf.doc = {};
  Q.DOC_STATES = ['Draft', 'In review', 'In approval', 'Signing', 'Effective'];
  function participants(d) { return [d.author].concat(d.reviewers.map(function (r) { return r.u; }), d.approvers.map(function (a) { return a.u; })).filter(function (x, i, a) { return x && a.indexOf(x) === i; }); }
  // The document's Word file in the SharePoint Drafts library (simulated: a name and a last-edited time).
  Q.draftFileName = function (d) { return (d.id + ' ' + d.title).replace(/["*:<>?/\\|#%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) + '.docx'; };
  function draftFile(d) { return { name: Q.draftFileName(d), library: 'Drafts', editedAt: now(), editedBy: me() }; }
  D.setState = function (d, state, summary) {
    var before = d.state; d.state = state; Q.curVer(d).state = state; d.modified = now();
    Q.audit('state', 'Document', d.id, summary || (d.id + ' moved to ' + state), { state: before }, { state: state });
    Q.fire('state.changed', { record: d.id, owner: d.owner, state: state });
  };
  D.create = function (o) {
    var prefix = o.prefix;
    var id = Q.nextId(prefix);
    var tpl = Q.S.templates.find(function (t) { return t.id === o.template; });
    var content = o.content || (tpl ? tpl.sections.reduce(function (acc, s) { acc.push({ t: 'h', x: s }); acc.push({ t: 'p', x: '[Write this section.]' }); return acc; }, []) : [{ t: 'h', x: '1. Purpose' }, { t: 'p', x: '[Write this section.]' }]);
    var v = { v: '0.1', kind: 'major', state: 'Draft', summary: 'First draft.', created: now(), createdBy: me(), content: content, approvedAt: null, signatures: [], pdf: null, verification: null, retrain: true, retrainReason: null };
    v.hash = Q.sha256(Q.canon(content));
    var d = {
      id: id, docType: o.docType, title: o.title, state: 'Draft', classification: o.classification, owner: o.owner || me(), author: me(),
      process: o.process, template: o.template || null, tags: o.tags || [], created: now(), modified: now(), effective: null,
      route: 'sequential', reviewRoute: 'parallel', audience: o.audience || { groups: [], roles: [], users: [], days: 14, quiz: false, retrainMonths: null }, sourceFile: o.sourceFile || null,
      periodic: { months: +o.months || 12, notice: 60, approval: true }, reviewDue: null, approvalDue: null,
      reviewers: [], approvers: [], versions: [v], comments: [], draft: null
    };
    Q.S.docs[id] = d;
    Q.audit('create', 'Document', id, 'Created ' + id + (o.template ? ' from template ' + o.template : o.sourceFile ? ' from upload ' + o.sourceFile : ' from a blank page'), null, { title: o.title, classification: o.classification });
    d.draft = draftFile(d);
    Q.audit('create', 'Document', id, 'Created the Word file "' + d.draft.name + '" in the SharePoint Drafts library', null, { file: d.draft.name, library: 'Drafts' }, { actor: 'system' });
    C.openForVersion(d, v, 'New document', 'Major');
    assign({ kind: 'author', record: id, assignee: me(), due: due(7), note: 'Edit the Word file in the Drafts library, then submit' });
    Q.save();
    return d;
  };
  // The author saves the Word file (in the prototype, the stand-in editor). A PDF made from the old text no longer
  // matches it, so it is cleared and has to be made and checked again.
  D.saveDraft = function (d, content, summary) {
    if (d.state !== 'Draft') throw new Error('Only a draft can be edited.');
    if ([d.author, d.owner].indexOf(me()) < 0) throw new Error('Only the author or owner can edit the draft.');
    var v = Q.curVer(d), before = v.hash, hadPdf = !!v.pdf;
    v.content = content; v.summary = summary; v.hash = Q.sha256(Q.canon(content));
    v.pdf = null; v.verification = null;
    d.draft = d.draft || draftFile(d); d.draft.editedAt = now(); d.draft.editedBy = me(); d.modified = now();
    Q.audit('checkin', 'Document', d.id, 'Saved the Word file of ' + d.id + ' v' + v.v + ': ' + summary + (hadPdf ? '. The locked PDF no longer matched the draft and was cleared' : ''), { sha256: before, pdf: hadPdf }, { sha256: v.hash, pdf: false });
    Q.save();
  };
  function lockedPdf(d, v, signers) {
    var list = signers.map(function (s) { return { u: s.u, role: s.role, meaning: s.meaning, order: s.order }; });
    return { name: d.id + '_v' + v.v + '.pdf', hash: Q.sha256(Q.canon({ document: d.id, version: v.v, content: v.hash, signers: list })), madeAt: now(), madeBy: me(), signers: list };
  }
  // Submit, step 1: choose reviewers and QA approvers, then the draft is converted to PDF with a signature field for each
  // signer, hashed (SHA-256) and locked. Segregation of duties is checked here, where the approvers are chosen; a refusal
  // is logged.
  D.makePdf = function (d, reviewers, approvers) {
    if (d.state !== 'Draft') throw new Error('Only a draft can be submitted.');
    if (Q.readOnly() || [d.author, d.owner].indexOf(me()) < 0) throw new Error('Only the author or owner can submit it.');
    reviewers = (reviewers || []).filter(function (u, i, a) { return u && a.indexOf(u) === i; });
    approvers = (approvers || []).filter(Boolean);
    if (!approvers.length || approvers.length > 2) throw new Error('Choose one or two QA approvers.');
    if (approvers.length === 2 && approvers[0] === approvers[1]) throw new Error('Choose two different QA approvers.');
    var v = Q.curVer(d);
    var p = Q.esign.plan(d.id, { stage: 'doc-approval', reviewers: reviewers, approvers: approvers });
    if (p.problems.length) {
      var sod = p.problems.filter(Q.esign.isSod);
      if (sod.length) { Q.audit('sod.block', 'Document', d.id, 'Submit refused by segregation of duties: ' + sod[0], null, { reviewers: reviewers.map(Q.fullName), approvers: approvers.map(Q.fullName) }); Q.save(); }
      throw new Error((sod.length ? 'Submit refused. ' : '') + p.problems[0]);
    }
    d.reviewers = reviewers.map(function (u) { return { u: u, status: 'Not started' }; });
    d.approvers = approvers.map(function (u) { return { u: u, status: 'Waiting' }; });
    var before = v.pdf ? v.pdf.hash : null;
    v.pdf = lockedPdf(d, v, p.signers); v.verification = null;
    Q.audit('pdf.lock', 'Document', d.id, 'Converted v' + v.v + ' to PDF from the Word file and locked it for checking', before ? { pdfSha256: before } : null, { pdfSha256: v.pdf.hash, signers: p.signers.length });
    Q.save();
    return v.pdf;
  };
  // Submit, step 2: the author has checked the locked PDF. pdfHash is the hash of the PDF they were shown, so a PDF made
  // again in the meantime is refused rather than submitted unchecked.
  D.submit = function (d, ver, pdfHash) {
    if (d.state !== 'Draft') throw new Error('Only a draft can be submitted.');
    if (Q.readOnly() || [d.author, d.owner].indexOf(me()) < 0) throw new Error('Only the author or owner can submit it.');
    if (!(ver && ver.footer && ver.version && ver.docId && ver.dates)) throw new Error('Check the PDF and tick all four checks (footer, version, document ID, dates) before submitting.');
    var v = Q.curVer(d);
    if (!v.pdf) throw new Error('Make the PDF and check it before submitting.');
    if (pdfHash && v.pdf.hash !== pdfHash) throw new Error('The PDF changed after you opened it. Check the new PDF and submit again.');
    var p = Q.esign.plan(d.id, { stage: 'doc-approval' }); // roles or accounts may have changed since the PDF was made
    if (p.problems.length) throw new Error(p.problems[0]);
    v.verification = { footer: true, version: true, docId: true, dates: true, note: ver.note || '', by: me(), at: now() };
    Q.audit('submit', 'Document', d.id, 'Submitted v' + v.v + ': locked PDF checked (footer, version, document ID, dates)', null, { pdfSha256: v.pdf.hash, verification: Q.clone(v.verification) });
    Q.closeTasks(function (t) { return t.record === d.id && (t.kind === 'author' || t.kind === 'resubmit'); });
    d.approvers.forEach(function (a) { a.status = 'Waiting'; delete a.at; delete a.retrain; delete a.retrainReason; });
    if (!d.reviewers.length) { startApproval(d, 'Submitted v' + v.v + ' (no reviewers): approval in VeQMS'); Q.save(); return; }
    d.reviewers.forEach(function (r) { r.status = 'Pending'; delete r.at; });
    d.reviewDue = due(5);
    D.setState(d, 'In review', 'Submitted v' + v.v + ' for review');
    var later = d.approvers.map(function (a) { return a.u; });
    d.reviewers.forEach(function (r) { assign({ kind: 'review-doc', record: d.id, assignee: r.u, due: d.reviewDue }); });
    later.forEach(function (u) { Q.addTask({ kind: 'fyi', record: d.id, assignee: u, due: due(7), fyi: true, note: 'You approve in VeQMS after review, then sign in Adobe Sign' }); });
    Q.fire('workflow.entered', { record: d.id, to: later, what: 'approve', body: 'Expected around ' + Q.fmtDay(due(7)) + ', after review. You approve in VeQMS, then sign in Adobe Sign.' });
    Q.save();
  };
  // Review done (or no reviewers): the QA approvers approve in VeQMS.
  function startApproval(d, summary) {
    D.setState(d, 'In approval', summary);
    d.approvalDue = due(3);
    d.approvers.forEach(function (a) { a.status = 'To approve'; delete a.at; delete a.retrain; delete a.retrainReason; });
    Q.closeTasks(function (t) { return t.record === d.id && t.kind === 'fyi'; });
    d.approvers.forEach(function (a) { assign({ kind: 'approve-doc', record: d.id, assignee: a.u, due: d.approvalDue, note: 'Approve in VeQMS and decide whether retraining is needed', quiet: true }); });
    Q.fire('stage.reached', { record: d.id, to: d.approvers.map(function (a) { return a.u; }), what: 'approve', body: 'Review is complete. When the last QA approver approves, the agreement goes to Adobe Sign for signing.' });
  }
  D.review = function (d, comment) {
    if (d.state !== 'In review') throw new Error('This document isn’t in review.');
    var r = d.reviewers.find(function (x) { return x.u === me() && x.status === 'Pending'; });
    if (!r) throw new Error('You aren’t a pending reviewer on this document.');
    r.status = 'Reviewed'; r.at = now();
    if (comment) d.comments.push({ id: Q.uid('c'), u: me(), at: now(), block: null, text: comment, resolved: false });
    Q.audit('review', 'Document', d.id, 'Marked reviewed' + (comment ? ' with a comment' : ''));
    Q.closeTasks(function (t) { return t.record === d.id && t.kind === 'review-doc' && t.assignee === me(); });
    if (d.reviewers.every(function (x) { return x.status === 'Reviewed'; })) startApproval(d, 'Review complete: all ' + Q.plural(d.reviewers.length, 'reviewer') + ' done');
    Q.save();
  };
  // A QA approver approves in VeQMS and decides whether the change needs retraining (yes by default; "no" needs a
  // reason). The last approval sends the Adobe Sign agreement at once; if it can't go (connector off, allowance used up),
  // the approval isn't recorded.
  D.approve = function (d, o) {
    o = o || {};
    if (d.state !== 'In approval') throw new Error('This document isn’t waiting for approval.');
    var a = d.approvers.find(function (x) { return x.u === me() && x.status === 'To approve'; });
    if (Q.readOnly() || !a) throw new Error('You aren’t a QA approver waiting to approve this document.');
    var reason = (o.reason || '').trim(), retrain = o.retrain !== false;
    if (!retrain && reason.length < 10) throw new Error('Say why no retraining is needed (at least a short sentence).');
    var last = d.approvers.every(function (x) { return x === a || x.status === 'Approved'; });
    if (last) { var block = Q.esign.cantSend(d.id, 'doc-approval'); if (block) throw new Error('Not approved: the agreement can’t go to Adobe Sign. ' + block); }
    var v = Q.curVer(d);
    a.status = 'Approved'; a.at = now(); a.retrain = retrain; a.retrainReason = retrain ? null : reason;
    if (o.comment) d.comments.push({ id: Q.uid('c'), u: me(), at: now(), block: null, text: o.comment, resolved: false });
    Q.audit('approve', 'Document', d.id, 'Approved v' + v.v + ' in VeQMS; ' + (retrain ? 'retraining needed' : 'no retraining needed: ' + reason), null, { retrain: retrain, reason: retrain ? null : reason });
    Q.closeTasks(function (t) { return t.record === d.id && t.kind === 'approve-doc' && t.assignee === me(); });
    if (!last) { Q.save(); return null; }
    // Retraining unless every approver decided it isn't needed.
    v.retrain = d.approvers.some(function (x) { return x.retrain !== false; });
    v.retrainReason = v.retrain ? null : d.approvers.map(function (x) { return x.retrainReason; }).filter(Boolean).join(' · ');
    return Q.esign.send(d.id, { stage: 'doc-approval', verification: v.verification, auto: true });
  };
  // The agreement went to Adobe Sign on the last approval (esign.js, doc-approval onSent).
  D.signing = function (d, ag) {
    d.approvalDue = due(5);
    Q.curVer(d).agreement = ag.id;
    D.setState(d, 'Signing', 'Approved in VeQMS; v' + ag.version + ' sent to Adobe Sign with every signer (agreement ' + ag.id + ')');
    Q.closeTasks(function (t) { return t.record === d.id && (t.kind === 'approve-doc' || t.kind === 'fyi'); });
    var first = Math.min.apply(null, ag.signers.map(function (s) { return s.order; }));
    ag.signers.filter(function (s) { return s.order > first; }).forEach(function (s) { Q.addTask({ kind: 'fyi', record: d.id, assignee: s.u, due: d.approvalDue, fyi: true, ref: ag.id, note: 'You’re signer ' + s.order + ' as ' + s.role + '. Adobe Sign emails you when it’s your turn.' }); });
  };
  function resetApprovals(d) {
    d.reviewers.forEach(function (r) { r.status = 'Not started'; delete r.at; });
    d.approvers.forEach(function (a) { a.status = 'Waiting'; delete a.at; delete a.retrain; delete a.retrainReason; delete a.signedAt; });
    var v = Q.curVer(d); v.retrain = true; v.retrainReason = null;
  }
  // Return the draft to its author: a reviewer or approver, or the owner, author or a Quality Manager, while it is in
  // review or approval. Once it is out for signing, cancelling the agreement does the same.
  D.canReturn = function (d, uid) {
    uid = uid || me();
    if (Q.readOnly() || ['In review', 'In approval'].indexOf(d.state) < 0) return false;
    return d.reviewers.some(function (r) { return r.u === uid; }) || d.approvers.some(function (a) { return a.u === uid; }) || d.owner === uid || d.author === uid || Q.hasRole('qm', Q.user(uid));
  };
  D.sendBack = function (d, reason) {
    if (['In review', 'In approval'].indexOf(d.state) < 0) throw new Error('Only a document in review or approval can be returned. Cancel an agreement that is out for signing instead.');
    if (!D.canReturn(d)) throw new Error('Only a reviewer, an approver, the owner, the author or a Quality Manager can return it.');
    if (!reason) throw new Error('Give a reason so the author knows what to fix.');
    var before = d.state;
    var told = participants(d).filter(function (u) { return u !== me(); });
    resetApprovals(d);
    D.setState(d, 'Draft', 'Returned to the author by ' + Q.fullName(me()) + ' from ' + before + '. Reason: ' + reason);
    Q.closeTasks(function (t) { return t.record === d.id && ['review-doc', 'approve-doc', 'esign-sign', 'fyi'].indexOf(t.kind) >= 0; });
    assign({ kind: 'resubmit', record: d.id, assignee: d.author, due: due(5), note: 'Reason: ' + reason });
    Q.fire('sent.back', { record: d.id, to: told, reason: reason });
    Q.save();
  };
  // A declined or cancelled agreement: back to Draft, the approvals and the retraining decision undone. It goes through
  // review and approval again, and a corrected agreement is a new transaction.
  D.returnedFromSigning = function (d, ag, back) {
    resetApprovals(d);
    D.setState(d, 'Draft', 'Returned to draft: ' + back.why + '. Review and approval start again');
    assign({ kind: 'resubmit', record: d.id, assignee: d.author, due: due(5), note: back.why });
    Q.fire('sent.back', { record: d.id, to: ag.signers.map(function (s) { return s.u; }).filter(function (u, i, a) { return u !== me() && a.indexOf(u) === i; }), reason: back.why });
  };
  D.newVersion = function (d, kind, summary) {
    if (d.state !== 'Effective') throw new Error('Start a new version from the effective one.');
    var cur = Q.curVer(d), parts = cur.v.split('.');
    var nv = kind === 'major' ? (+parts[0] + 1) + '.0' : parts[0] + '.' + (+parts[1] + 1);
    var v = { v: nv, kind: kind, state: 'Draft', summary: summary || '', created: now(), createdBy: me(), content: Q.clone(cur.content), approvedAt: null, signatures: [], pdf: null, verification: null, retrain: true, retrainReason: null };
    v.hash = Q.sha256(Q.canon(v.content));
    d.versions.push(v); d.state = 'Draft'; d.author = me();
    d.draft = d.draft || draftFile(d); d.draft.editedAt = now(); d.draft.editedBy = me();
    d.reviewers.forEach(function (r) { r.status = 'Not started'; delete r.at; });
    d.approvers.forEach(function (a) { a.status = 'Waiting'; delete a.at; delete a.retrain; delete a.retrainReason; delete a.signedAt; });
    d.comments = [];
    Q.audit('version', 'Document', d.id, 'Started ' + kind + ' version v' + nv + ' of ' + d.id + ': ' + (summary || ''), { state: 'Effective' }, { state: 'Draft', version: nv });
    C.openForVersion(d, v, summary || 'New version', kind === 'major' ? 'Major' : 'Minor');
    assign({ kind: 'author', record: d.id, assignee: me(), due: due(7), note: 'Edit the Word file; update the version to v' + nv + ' on the cover and in the footer' });
    Q.save();
    return v;
  };
  D.makeEffective = function (d) {
    var v = Q.curVer(d);
    d.versions.forEach(function (x) { if (x !== v && x.state === 'Effective') { x.state = 'Superseded'; } });
    d.effective = now();
    D.setState(d, 'Effective', d.id + ' v' + v.v + ' is Effective' + (d.versions.length > 1 ? '; previous version Superseded' : ''));
    Q.closeTasks(function (t) { return t.record === d.id && (t.kind === 'fyi' || t.kind === 'esign-sign' || t.kind === 'approve-doc'); });
    C.closeForVersion(d, v);
    // Schedule the next periodic review
    if (d.periodic) {
      var nextDue = Q.iso(Q.addDays(new Date(), Math.round(d.periodic.months * 30.4)));
      var id = Q.nextId('PR');
      Q.S.reviews[id] = { id: id, doc: d.id, reviewer: d.owner, due: nextDue, notice: d.periodic.notice, approval: d.periodic.approval, created: now(), state: 'Open' };
    }
    Q.notify({ to: d.owner, kind: 'info', channels: ['in-app', 'email'], record: d.id, title: d.id + ' v' + v.v + ' is now Effective', body: d.title });
    Q.fire('doc.effective', { record: d.id });
    // The locked PDF goes to the controlled SharePoint library; the superseded file stays there, marked Superseded.
    if (Q.sp) Q.sp.publish(d, v);
  };
  // ag: the completed Adobe Sign agreement that approved it (the app always passes one; tests may call it directly).
  D.obsolete = function (d, reason, ag) {
    var v = Q.effVer(d) || Q.curVer(d);
    Q.S.assignments.filter(function (a) { return a.doc === d.id && !a.completed && !a.closed; }).forEach(function (a) { closeOpen(a, d.id + ' made obsolete'); });
    v.state = 'Obsolete'; d.obsoleteReason = reason; d.obsoleteAgreement = ag ? ag.id : null;
    D.setState(d, 'Obsolete', 'Made ' + d.id + ' obsolete (archived, not deleted)' + (ag ? ', approved through Adobe Sign agreement ' + ag.id : '') + '. Reason: ' + reason);
    if (Q.sp) Q.sp.publishPending(); // the published file is marked Obsolete, not removed
    Q.save();
  };
  D.comment = function (d, block, text) {
    d.comments.push({ id: Q.uid('c'), u: me(), at: now(), block: block, text: text, resolved: false });
    Q.audit('comment', 'Document', d.id, 'Commented on ' + d.id + (block != null ? ' (section ' + block + ')' : ''));
    Q.save();
  };
  D.resolve = function (d, cid) { var c = d.comments.find(function (x) { return x.id === cid; }); if (c) { c.resolved = true; Q.audit('comment', 'Document', d.id, 'Resolved a comment'); Q.save(); } };
  // Every PDF open is logged with the version it showed. A trainee must have opened the PDF of the version since it was
  // allocated before they can confirm read and understood.
  Q.logPdfOpen = function (d, v, why) {
    Q.audit('read', 'Document', d.id, 'Opened the PDF of ' + d.id + ' v' + v.v + (why ? ' (' + why + ')' : ''), null, { version: v.v });
    Q.save();
  };
  Q.pdfOpenedAt = function (a) {
    var e = Q.S.audit.find(function (x) { return x.actor === a.user && x.action === 'read' && x.objectId === a.doc && x.after && x.after.version === a.ver && x.at >= a.assigned; });
    return e ? e.at : null;
  };

  // ---------- Training: read-and-understood records (not Part 11 signatures) ----------
  // Each record is attributable (SSO user), tied to one version, dated by the system and locked once
  // completed. Nobody edits or deletes a completed record; a correction is a new record with a reason.
  Q.audienceOf = function (d) { return (d && d.audience) || { groups: [], roles: [], users: [], days: 14, quiz: false, retrainMonths: null }; };
  Q.hasAudience = function (d) { var a = Q.audienceOf(d); return !!(a.groups.length || a.roles.length || a.users.length); };
  Q.inAudience = function (d, u) {
    var a = Q.audienceOf(d);
    if (!u || u.status !== 'Active') return false;
    return a.groups.some(function (g) { return (u.groups || []).indexOf(g) >= 0; }) || a.roles.some(function (r) { return (u.roles || []).indexOf(r) >= 0; }) || a.users.indexOf(u.id) >= 0;
  };
  Q.audienceMembers = function (d) { return Q.S.users.filter(function (u) { return Q.inAudience(d, u); }).map(function (u) { return u.id; }); };
  Q.audienceText = function (a) {
    if (!a) return 'Nobody';
    var parts = [].concat(a.groups, (a.roles || []).map(function (r) { return 'role: ' + Q.ROLE_LABEL[r]; }), (a.users || []).map(Q.fullName));
    return parts.length ? parts.join(', ') : 'Nobody (no training needed)';
  };
  Q.ackStatement = function (docId, ver) { return Q.S.settings.ackStatement.replace('{doc}', docId).replace('{version}', ver); };
  Q.trCorrections = function (a) { return Q.S.assignments.filter(function (x) { return x.correctionOf === a.id; }); };
  // The versions whose training counts: the effective one and, while the QA approvers decided a version needed no
  // retraining, the version it replaced (and so on back to the last version that needed retraining).
  Q.trainVersions = function (d) {
    var eff = d && Q.effVer(d); if (!eff) return [];
    var i = d.versions.indexOf(eff), out = [eff.v];
    while (i > 0 && d.versions[i].retrain === false) { i--; out.push(d.versions[i].v); }
    return out;
  };
  Q.trStatus = function (a) {
    if (a.correctionOf && a.noRetrain) return 'Correction';
    if (Q.trCorrections(a).length) return 'Corrected';
    var d = Q.S.docs[a.doc], eff = d && Q.effVer(d);
    if (!eff) return 'Obsolete';
    if (Q.trainVersions(d).indexOf(a.ver) < 0) return 'Superseded';
    if (a.closed) return 'Withdrawn';
    if (a.completed) return 'Complete';
    if (a.leaver) return 'Left';
    return Q.daysFromToday(a.due) < 0 ? 'Overdue' : 'Assigned';
  };
  Q.trOpen = function (a) { return !a.completed && !a.closed && !a.leaver && !a.noRetrain && ['Assigned', 'Overdue'].indexOf(Q.trStatus(a)) >= 0; };
  function trSnap(a) { return { person: Q.fullName(a.user), document: a.doc, title: a.title, version: a.ver, allocatedBy: a.allocatedBy === 'system' ? 'System' : Q.fullName(a.allocatedBy), reason: a.allocReason, assigned: a.assigned, due: a.due, completed: a.completed }; }
  function trTask(a) {
    Q.addTask({ kind: 'training', record: a.doc, assignee: a.user, due: a.due, ref: a.id });
    Q.notify({ to: a.user, kind: 'action', channels: ['in-app', 'email', 'push'], record: a.doc, rule: 'RULE-09', title: 'New training: ' + a.doc + ' ' + a.title + ' v' + a.ver, body: a.allocReason + ' · ' + Q.relDue(a.due).text });
  }
  function closeOpen(a, why) {
    if (a.completed || a.closed) return;
    var before = { status: Q.trStatus(a) };
    a.closed = { at: now(), reason: why };
    Q.audit('training.withdraw', 'Training record', a.id, 'Closed open allocation ' + a.doc + ' v' + a.ver + ' for ' + Q.fullName(a.user) + ': ' + why, before, { status: Q.trStatus(a), reason: why });
    Q.closeTasks(function (t) { return t.kind === 'training' && t.assignee === a.user && t.record === a.doc && (!t.ref || t.ref === a.id || t.ref === a.doc); });
  }
  function allocate(d, uid, o) {
    var v = Q.effVer(d); if (!v) return null;
    var counts = Q.trainVersions(d);
    var has = Q.S.assignments.some(function (a) { return a.user === uid && a.doc === d.id && counts.indexOf(a.ver) >= 0 && !a.closed && !a.noRetrain; });
    if (has) return null;
    var a = { id: Q.uid('TA'), user: uid, doc: d.id, title: d.title, ver: v.v, allocatedBy: o.by || 'system', allocReason: o.reason, assigned: now(), due: due(Q.audienceOf(d).days || 14), completed: null };
    Q.S.assignments.push(a);
    Q.audit('training.allocate', 'Training record', a.id, 'Allocated ' + d.id + ' v' + v.v + ' to ' + Q.fullName(uid) + ' (' + o.reason + ')', null, trSnap(a), o.by === 'system' || !o.by ? { actor: 'system' } : null);
    trTask(a);
    return a;
  }
  // New effective version: open allocations of versions that no longer count close as superseded, then everyone in the
  // audience without training on a version that counts is assigned the new one. With no retraining, that is nobody who
  // already trained on (or was allocated) the version it replaced.
  Q.allocateDoc = function (docId, reason, by) {
    var d = Q.S.docs[docId], v = Q.effVer(d); if (!v) return 0;
    var counts = Q.trainVersions(d);
    Q.S.assignments.filter(function (a) { return a.doc === docId && counts.indexOf(a.ver) < 0 && !a.completed && !a.closed; }).forEach(function (a) { closeOpen(a, 'Superseded by v' + v.v); });
    var n = 0;
    Q.audienceMembers(d).forEach(function (uid) { if (allocate(d, uid, { reason: reason, by: by })) n++; });
    return n;
  };
  // New starters, group moves and role changes get the current version of everything their audience needs.
  Q.reconcileUser = function (uid, reason, by) {
    var u = Q.user(uid), added = 0, closed = 0;
    Object.keys(Q.S.docs).forEach(function (k) {
      var d = Q.S.docs[k]; if (!Q.effVer(d)) return;
      if (Q.inAudience(d, u)) { if (allocate(d, uid, { reason: reason, by: by })) added++; }
      else Q.S.assignments.filter(function (a) { return a.user === uid && a.doc === k && !a.completed && !a.closed && !a.correctionOf; }).forEach(function (a) { closeOpen(a, reason + ': no longer in the audience'); closed++; });
    });
    return { added: added, closed: closed };
  };
  // Approval agreement completed: author and each reviewer get a completed record for that version.
  Q.recordApprovalTraining = function (d, ver, ag) {
    var seen = [];
    ag.signers.filter(function (s) { return s.meaning === 'Authored' || s.meaning === 'Reviewed'; }).forEach(function (s) {
      if (seen.indexOf(s.u) >= 0) return; seen.push(s.u);
      var a = { id: Q.uid('TA'), user: s.u, doc: d.id, title: d.title, ver: ver, allocatedBy: 'system', allocReason: 'Approval agreement (' + s.meaning.toLowerCase() + ')', assigned: ag.sentAt, due: ag.completedAt, completed: ag.completedAt, agreement: ag.id,
        statement: 'Signed ' + d.id + ', version ' + ver + ' in Adobe Sign with the reason “' + s.meaning + '” (agreement ' + ag.id + ')' };
      Q.S.assignments.push(a);
      Q.audit('training.record', 'Training record', a.id, 'Completed record for ' + Q.fullName(s.u) + ' on ' + d.id + ' v' + ver + ' from Adobe Sign agreement ' + ag.id, null, trSnap(a), { actor: 'system' });
    });
    return seen.length;
  };
  Q.completeTraining = function (a, info) {
    if (a.user !== me()) { Q.toast('Only ' + Q.fullName(a.user) + ' can confirm this record.', 'warn'); return false; }
    if (a.completed || !Q.trOpen(a)) return false;
    if (!Q.pdfOpenedAt(a)) { Q.toast('Open the PDF of ' + a.doc + ' v' + a.ver + ' first. VeQMS records that you opened it.', 'warn'); return false; }
    var before = { completed: null, status: Q.trStatus(a) };
    a.completed = now(); a.statement = Q.ackStatement(a.doc, a.ver); a.quiz = info.quiz || null; a.via = 'Microsoft 365 single sign-on';
    Q.closeTasks(function (t) { return t.kind === 'training' && t.record === a.doc && t.assignee === a.user; });
    Q.audit('training.complete', 'Training record', a.id, Q.fullName(a.user) + ' confirmed read and understood: ' + a.doc + ' v' + a.ver + (a.quiz ? ' (knowledge check ' + a.quiz + ')' : ''), before, { completed: a.completed, statement: a.statement, status: 'Complete' });
    Q.save();
    return true;
  };
  Q.correctTraining = function (a, reason, retrain) {
    if (!Q.can('training.manage') || !a.completed) return null;
    var d = Q.S.docs[a.doc];
    var before = { status: Q.trStatus(a) };
    var c = { id: Q.uid('TA'), user: a.user, doc: a.doc, title: a.title, ver: a.ver, allocatedBy: me(), allocReason: 'Correction', correctionOf: a.id, correctionReason: reason, assigned: now(), due: retrain ? due(Q.audienceOf(d).days || 14) : null, completed: null, noRetrain: !retrain };
    Q.S.assignments.push(c);
    Q.audit('training.correct', 'Training record', a.id, 'Correction ' + c.id + ' recorded for ' + Q.fullName(a.user) + ' on ' + a.doc + ' v' + a.ver + '. The original stays. Reason: ' + reason, before, { status: 'Corrected', correction: c.id, retrain: !!retrain });
    Q.audit('training.allocate', 'Training record', c.id, (retrain ? 'Re-allocated ' : 'Recorded in error, no retraining: ') + a.doc + ' v' + a.ver + ' for ' + Q.fullName(a.user) + ' (correction of ' + a.id + ')', null, trSnap(c));
    if (retrain) trTask(c);
    Q.save();
    return c;
  };
  Q.setAudience = function (d, aud) {
    var before = Q.clone(Q.audienceOf(d));
    d.audience = aud;
    Q.audit('training.audience', 'Document', d.id, 'Changed training audience of ' + d.id + ': ' + Q.audienceText(before) + ' → ' + Q.audienceText(aud), { audience: before }, { audience: Q.clone(aud) });
    var added = 0, closed = 0;
    if (Q.effVer(d)) {
      Q.audienceMembers(d).forEach(function (uid) { if (allocate(d, uid, { reason: 'Audience change', by: me() })) added++; });
      Q.S.assignments.filter(function (a) { return a.doc === d.id && Q.trOpen(a) && !a.correctionOf && !Q.inAudience(d, Q.user(a.user)); }).forEach(function (a) { closeOpen(a, 'Audience change: no longer in the audience'); closed++; });
    }
    Q.save();
    return { added: added, closed: closed };
  };
  Q.sendReminders = function () {
    var lead = Math.max.apply(null, Q.S.settings.reminders || [3]);
    var sent = 0, over = 0;
    Q.S.assignments.filter(Q.trOpen).forEach(function (a) {
      var n = Q.daysFromToday(a.due);
      if (n < 0) {
        var u = Q.user(a.user);
        Q.notify({ to: [a.user].concat(u.manager ? [u.manager] : []), kind: 'overdue', mandatory: true, channels: ['in-app', 'email'], record: a.doc, rule: 'RULE-16', title: 'Overdue: ' + a.doc + ' v' + a.ver + ' training for ' + u.name, body: 'Was due ' + Q.fmtShort(a.due) + '.' });
        over++;
      } else if (n <= lead) {
        Q.notify({ to: a.user, kind: 'reminder', channels: ['in-app', 'email'], record: a.doc, rule: 'RULE-16', title: 'Reminder: ' + a.doc + ' v' + a.ver + ' training is due ' + Q.relDue(a.due).text.toLowerCase(), body: 'Read and understood' });
        sent++;
      }
    });
    Q.audit('training.reminders', 'Training', 'REMINDERS', 'Sent ' + Q.plural(sent, 'reminder') + ' and ' + Q.plural(over, 'overdue notice') + ' (managers copied on overdue)', null, { reminders: sent, overdue: over });
    Q.save();
    return { sent: sent, overdue: over };
  };

  // ---------- Change requests ----------
  var C = wf.cr = {};
  C.setState = function (cr, state, summary) {
    var b = cr.state; cr.state = state;
    Q.audit('state', 'Change request', cr.id, summary || cr.id + ' moved to ' + state, { state: b }, { state: state });
    Q.fire('state.changed', { record: cr.id, owner: cr.owner, state: state });
  };
  C.create = function (o) {
    var id = Q.nextId('CR');
    var cr = { id: id, title: o.title, size: o.size, state: 'Planning', classification: o.classification, owner: me(), createdBy: me(), process: o.process, created: now(), reviewDue: due(7), route: 'parallel',
      description: o.description, reason: o.reason, impact: o.impact, impacted: o.impacted || [], items: o.items || [], reviewers: (o.reviewers || []).map(function (u) { return { u: u, status: 'Not started' }; }), approvers: (o.approvers || []).map(function (u) { return { u: u, status: 'Waiting' }; }),
      actions: [], attachments: [], effectiveness: { criteria: o.criteria || '', result: null }, signatures: [] };
    Q.S.crs[id] = cr;
    cr.items.forEach(function (d) { Q.S.links.push([id, d]); });
    Q.audit('create', 'Change request', id, 'Created ' + id + ' (' + o.size + ')', null, { title: o.title });
    assign({ kind: 'cr-plan', record: id, assignee: me(), due: due(7) });
    Q.save(); return cr;
  };
  // Every amendment starts as a change request. Phase 1 keeps it minimal: creating a document or starting a new version
  // opens one in execution, linked to the version it produces, and it closes when that version is Effective. The full
  // change control screens (plan, review, actions, effectiveness) are Phase 2.
  C.openForVersion = function (d, v, why, size) {
    var id = Q.nextId('CR');
    var cr = { id: id, title: (d.id + ' v' + v.v + ': ' + d.title).slice(0, 200), size: size, state: 'In execution', classification: d.classification, owner: me(), createdBy: me(), process: d.process, created: now(), reviewDue: null, route: 'parallel',
      description: why, reason: why, impact: 'Readers of ' + d.id + ' and everyone in its training audience.', impacted: [String(d.process || '').replace('ISMS · ', '')], items: [d.id], reviewers: [], approvers: [],
      actions: [], attachments: [], effectiveness: { criteria: 'Closes when ' + d.id + ' v' + v.v + ' is Effective.', result: null }, signatures: [], forVersion: { doc: d.id, ver: v.v } };
    Q.S.crs[id] = cr; v.cr = id;
    Q.S.links.push([id, d.id]);
    Q.audit('create', 'Change request', id, 'Opened ' + id + ' for ' + d.id + ' v' + v.v + ': ' + why, null, { document: d.id, version: v.v, size: size });
    return cr;
  };
  C.closeForVersion = function (d, v) {
    var cr = v.cr && Q.S.crs[v.cr];
    if (!cr || cr.state === 'Closed') return;
    cr.closedAt = now();
    C.setState(cr, 'Closed', cr.id + ' closed: ' + d.id + ' v' + v.v + ' is Effective');
  };
  C.addAction = function (cr, a) {
    a.id = 'A-' + (++Q.S.counters.ACT); a.status = 'Not started'; a.needsSignature = !!a.needsSignature;
    cr.actions.push(a);
    Q.audit('update', 'Change request', cr.id, 'Added action "' + a.title + '" for ' + Q.fullName(a.assignee));
    if (cr.state === 'In execution') assign({ kind: 'cr-action', record: cr.id, assignee: a.assignee, due: a.due, ref: a.id });
    Q.save();
  };
  C.submit = function (cr) {
    cr.reviewers.forEach(function (r) { r.status = 'Pending'; });
    C.setState(cr, 'Review', 'Submitted ' + cr.id + ' for review (' + cr.route + ')');
    Q.closeTasks(function (t) { return t.record === cr.id && t.kind === 'cr-plan'; });
    cr.reviewers.forEach(function (r) { assign({ kind: 'cr-review', record: cr.id, assignee: r.u, due: cr.reviewDue }); });
    Q.fire('workflow.entered', { record: cr.id, to: cr.approvers.map(function (a) { return a.u; }), what: 'approve the plan for' });
    if (!cr.reviewers.length) C.toApproval(cr);
    Q.save();
  };
  C.review = function (cr, comment) {
    var r = cr.reviewers.find(function (x) { return x.u === me(); }); if (!r) return;
    r.status = 'Reviewed'; r.at = now(); if (comment) r.comment = comment;
    Q.audit('review', 'Change request', cr.id, 'Completed review of ' + cr.id + (comment ? ': ' + comment : ''));
    Q.closeTasks(function (t) { return t.record === cr.id && t.kind === 'cr-review' && t.assignee === me(); });
    if (cr.reviewers.every(function (x) { return x.status === 'Reviewed'; })) C.toApproval(cr);
    Q.save();
  };
  // Review complete: the process owner checks the plan PDF and sends one Adobe Sign agreement (owner, then approvers).
  C.toApproval = function (cr) {
    C.setState(cr, 'Approval', 'Review complete; plan ready to send to Adobe Sign');
    assign({ kind: 'send-approval', record: cr.id, assignee: cr.owner, due: due(2), stage: 'cr-plan', note: 'Verify the plan PDF, then send one Adobe Sign agreement' });
    cr.approvers.forEach(function (a) { a.status = 'Waiting'; Q.addTask({ kind: 'fyi', record: cr.id, assignee: a.u, due: due(5), fyi: true, note: 'You sign the plan in Adobe Sign after ' + Q.fullName(cr.owner) }); });
    Q.fire('workflow.entered', { record: cr.id, to: cr.approvers.map(function (a) { return a.u; }), what: 'sign the plan in Adobe Sign for' });
  };
  // The plan agreement completed: one signature row per signer, then execution starts.
  C.planApproved = function (cr, ag, rows) {
    (rows || []).filter(function (x) { return x.meaning === 'Approved'; }).forEach(function (x) { cr.signatures.push({ id: x.id, stage: 'Plan approved', user: x.user, meaning: x.meaning, at: x.at, agreement: ag.id }); });
    C.setState(cr, 'In execution', 'Plan approved through Adobe Sign agreement ' + ag.id + '; actions assigned');
    cr.actions.filter(function (x) { return x.status !== 'Done'; }).forEach(function (x) { assign({ kind: 'cr-action', record: cr.id, assignee: x.assignee, due: x.due, ref: x.id }); });
    Q.save();
  };
  // A plan agreement declined or cancelled: back to planning with the reason.
  C.returned = function (cr, why) {
    cr.approvers.forEach(function (a) { a.status = 'Waiting'; delete a.at; });
    C.setState(cr, 'Planning', 'Plan returned to planning: ' + why);
    assign({ kind: 'cr-plan', record: cr.id, assignee: cr.owner, due: due(5), note: why });
    Q.fire('sent.back', { record: cr.id, to: [cr.owner].filter(function (u) { return u !== me(); }), reason: why });
  };
  // sig: the signature row from a completed action agreement, or null when the action needs no signature.
  C.completeAction = function (cr, act, sig) {
    act.status = 'Done'; act.doneAt = now(); if (sig) { act.signedBy = sig.user; act.signature = sig.id; }
    Q.audit('update', 'Change request', cr.id, 'Completed action "' + act.title + '"' + (sig ? ' (signed in Adobe Sign, agreement ' + sig.agreement + ')' : ' in VeQMS (no signature needed)'), null, { status: 'Done', signed: !!sig }, sig ? { actor: 'system' } : null);
    Q.closeTasks(function (t) { return t.record === cr.id && t.ref === act.id; });
    if (cr.state === 'In execution' && cr.actions.every(function (x) { return x.status === 'Done'; })) {
      C.setState(cr, 'Effectiveness check', 'All actions done; effectiveness check started');
      cr.effectivenessDue = due(14);
      assign({ kind: 'cr-effectiveness', record: cr.id, assignee: cr.owner, due: cr.effectivenessDue });
    }
    Q.save();
  };
  // The completion agreement completed: record the result and close.
  C.close = function (cr, result, verdict, ag, rows) {
    var pc = cr.pendingClosure || {};
    cr.effectiveness.result = result; cr.effectiveness.verdict = verdict; cr.effectiveness.by = pc.by || ag.sentBy; cr.effectiveness.at = pc.at || now();
    (rows || []).filter(function (x) { return x.meaning === 'Approved'; }).forEach(function (x) { cr.signatures.push({ id: x.id, stage: 'Completion approved', user: x.user, meaning: x.meaning, at: x.at, agreement: ag.id }); });
    cr.closedAt = now(); cr.closeAgreement = ag.id;
    Q.closeTasks(function (t) { return t.record === cr.id; });
    C.setState(cr, 'Closed', 'Completion approved through Adobe Sign agreement ' + ag.id + '; ' + cr.id + ' closed (' + verdict + ')');
    Q.save();
  };
  C.sendBack = function (cr, reason) {
    var told = [cr.owner].concat(cr.reviewers.map(function (r) { return r.u; })).filter(function (u, i, a) { return u !== me() && a.indexOf(u) === i; });
    cr.reviewers.forEach(function (r) { r.status = 'Not started'; delete r.at; });
    cr.approvers.forEach(function (a) { a.status = 'Waiting'; });
    Q.closeTasks(function (t) { return t.record === cr.id && (t.kind === 'cr-review' || t.kind === 'send-approval' || t.kind === 'fyi'); });
    C.setState(cr, 'Planning', 'Sent back to planning. Reason: ' + reason);
    assign({ kind: 'cr-plan', record: cr.id, assignee: cr.owner, due: due(5), note: 'Reason: ' + reason });
    Q.fire('sent.back', { record: cr.id, to: told, reason: reason });
    Q.save();
  };

  // ---------- Observations, quality events, CAPA ----------
  wf.obs = {
    raise: function (o) {
      var id = Q.nextId('OBS');
      var ob = { id: id, title: o.title, details: o.details, area: o.area, raisedBy: me(), at: o.at || now(), state: 'New', owner: o.owner || 'u-grace', attachments: o.attachments || [], location: o.location || '', classification: 'Internal', offline: !!o.offline };
      Q.S.obs[id] = ob;
      Q.audit('create', 'Observation', id, 'Raised ' + id + (o.offline ? ' (synced from offline draft)' : ''));
      assign({ kind: 'obs-review', record: id, assignee: ob.owner, due: due(2) });
      Q.save(); return ob;
    },
    escalate: function (ob, o) {
      var qe = wf.qe.create({ type: o.type, title: ob.title, desc: ob.details, severity: o.severity, owner: ob.owner, process: o.process || 'ISMS · ' + ob.area, source: ob.id });
      ob.state = 'Escalated'; ob.escalatedTo = qe.id;
      Q.S.links.push([ob.id, qe.id]);
      Q.audit('state', 'Observation', ob.id, 'Escalated ' + ob.id + ' to ' + qe.id, { state: 'New' }, { state: 'Escalated' });
      Q.closeTasks(function (t) { return t.record === ob.id; });
      Q.save(); return qe;
    },
    close: function (ob, justification) {
      ob.state = 'Closed'; ob.closure = { justification: justification, by: me(), at: now() };
      Q.audit('state', 'Observation', ob.id, 'Closed ' + ob.id + ' with justification: ' + justification, { state: 'New' }, { state: 'Closed' });
      Q.closeTasks(function (t) { return t.record === ob.id; });
      Q.notify({ to: ob.raisedBy, kind: 'info', channels: ['in-app', 'email'], record: ob.id, title: 'Your observation ' + ob.id + ' was closed', body: justification });
      Q.save();
    }
  };
  wf.qe = {
    create: function (o) {
      var id = Q.nextId('QE');
      var qe = { id: id, type: o.type, title: o.title, desc: o.desc, state: 'Open', severity: o.severity, classification: o.classification || 'Internal', owner: o.owner || me(), process: o.process, due: due(7), created: now(), tags: o.tags || [], assessment: '', source: o.source || null };
      Q.S.events[id] = qe;
      Q.audit('create', 'Quality event', id, 'Raised ' + id + ' (' + o.type + ', ' + o.severity + ')');
      assign({ kind: 'qe-assess', record: id, assignee: qe.owner, due: qe.due });
      Q.fire('record.created', { record: id, severity: o.severity, owner: qe.owner });
      Q.save(); return qe;
    },
    assess: function (qe, text, severity) {
      var b = { state: qe.state, severity: qe.severity };
      qe.assessment = text; qe.severity = severity; if (qe.state === 'Open') qe.state = 'Assessment';
      Q.audit('update', 'Quality event', qe.id, 'Saved assessment of ' + qe.id, b, { state: qe.state, severity: severity });
      Q.save();
    },
    raiseCapa: function (qe) {
      var id = Q.nextId('CAPA');
      var c = { id: id, title: qe.title, severity: qe.severity, classification: qe.classification, state: 'Planning', source: qe.id, owner: qe.owner, process: qe.process,
        route: qe.severity === 'High' ? 'High severity: QM approval' : 'Low severity: process owner approval', created: now(), effectivenessPlan: qe.severity === 'High' ? '90 days after close of actions' : '60 days after close of actions', actionsLocked: false,
        actions: [], whys: ['', '', '', '', ''], problem: qe.desc, rootWhy: null, fishbone: { People: [], Process: [], Technology: [], Environment: [], Suppliers: [], Measurement: [] }, risk: { likelihood: null, impact: null, notes: '' }, evidence: [], effectiveness: { due: null, criteria: '', result: null } };
      Q.S.capas[id] = c; qe.capa = id;
      var b = qe.state; qe.state = 'CAPA raised';
      Q.S.links.push([qe.id, id]);
      Q.audit('create', 'CAPA', id, 'Created ' + id + ' from ' + qe.id + ' (linked both ways)');
      Q.audit('state', 'Quality event', qe.id, qe.id + ' moved to CAPA raised', { state: b }, { state: qe.state });
      Q.closeTasks(function (t) { return t.record === qe.id; });
      assign({ kind: 'capa-plan', record: id, assignee: c.owner, due: due(5) });
      Q.fire('record.created', { record: id, severity: c.severity, owner: c.owner });
      Q.save(); return c;
    },
    // ag: the completed Adobe Sign agreement (owner, then QA approver) that approved the closure.
    closeNoCapa: function (qe, justification, ag) {
      var b = qe.state, pc = qe.pendingClosure || {}; qe.state = 'Closed';
      qe.closure = { justification: justification, by: pc.by || ag.sentBy, at: now(), agreement: ag.id };
      Q.audit('state', 'Quality event', qe.id, 'Closed ' + qe.id + ' without CAPA (approved through Adobe Sign agreement ' + ag.id + ')', { state: b }, { state: 'Closed' }, { actor: 'system' });
      Q.closeTasks(function (t) { return t.record === qe.id; });
      Q.save();
    }
  };
  wf.capa = {
    setState: function (c, state, summary) { var b = c.state; c.state = state; Q.audit('state', 'CAPA', c.id, summary || c.id + ' moved to ' + state, { state: b }, { state: state }); Q.fire('state.changed', { record: c.id, owner: c.owner, state: state }); },
    addAction: function (c, a) {
      a.id = 'CA-' + (++Q.S.counters.ACT); a.status = 'Not started'; a.needsSignature = !!a.needsSignature; c.actions.push(a);
      Q.audit('update', 'CAPA', c.id, 'Added ' + a.type.toLowerCase() + ' action "' + a.title + '"'); Q.save();
    },
    removeAction: function (c, id) { c.actions = c.actions.filter(function (a) { return a.id !== id; }); Q.audit('update', 'CAPA', c.id, 'Removed action ' + id); Q.save(); },
    approvePlan: function (c, ag) {
      c.actionsLocked = true; c.planAgreement = ag.id;
      wf.capa.setState(c, 'Execution', 'Actions approved and locked through Adobe Sign agreement ' + ag.id + '; execution started');
      Q.closeTasks(function (t) { return t.record === c.id && t.kind === 'capa-plan'; });
      c.actions.forEach(function (a) { assign({ kind: 'capa-action', record: c.id, assignee: a.assignee, due: a.due, ref: a.id }); });
      Q.save();
    },
    // sig: the signature row from a completed action agreement, or null when the action needs no signature.
    completeAction: function (c, a, sig) {
      a.status = 'Done'; a.doneAt = now(); if (sig) { a.signedBy = sig.user; a.signature = sig.id; }
      Q.audit('update', 'CAPA', c.id, 'Completed ' + a.type.toLowerCase() + ' action "' + a.title + '"' + (sig ? ' (signed in Adobe Sign, agreement ' + sig.agreement + ')' : ' in VeQMS (no signature needed)'), null, { status: 'Done', signed: !!sig }, sig ? { actor: 'system' } : null);
      Q.closeTasks(function (t) { return t.record === c.id && t.ref === a.id; });
      Q.save();
    },
    // The completed-actions agreement completed (owner, then a Quality Manager for high severity).
    approveActions: function (c, ag) {
      c.actionsAgreement = ag.id;
      c.effectiveness.due = Q.iso(Q.addDays(new Date(), c.severity === 'High' ? 90 : 60));
      c.effectiveness.assignee = c.owner;
      Q.closeTasks(function (t) { return t.record === c.id && t.kind === 'capa-submit'; });
      wf.capa.setState(c, 'Effectiveness check', 'Completed actions approved through Adobe Sign agreement ' + ag.id + '; effectiveness check scheduled');
      assign({ kind: 'effectiveness', record: c.id, assignee: c.owner, due: c.effectiveness.due });
      Q.save();
    },
    // ag: the completed Adobe Sign closure agreement (owner, then QA approver).
    close: function (c, result, verdict, ag) {
      var pc = c.pendingClosure || {};
      c.effectiveness.result = result; c.effectiveness.verdict = verdict; c.effectiveness.by = pc.by || ag.sentBy; c.effectiveness.at = pc.at || now(); c.closedAt = now();
      c.closeAgreement = ag.id;
      Q.closeTasks(function (t) { return t.record === c.id; });
      wf.capa.setState(c, 'Closed', 'Effectiveness verified (' + verdict + '); closure approved through Adobe Sign agreement ' + ag.id + '; ' + c.id + ' closed');
      var qe = Q.S.events[c.source]; if (qe && qe.state !== 'Closed') { var qb = qe.state; qe.state = 'Closed'; Q.audit('state', 'Quality event', qe.id, qe.id + ' closed with ' + c.id, { state: qb }, { state: 'Closed' }); }
      Q.save();
    }
  };

  // ---------- Periodic reviews ----------
  wf.review = {
    // ag: the completed Adobe Sign agreement the reviewer signed.
    noUpdate: function (r, ag) {
      var d = Q.S.docs[r.doc];
      r.state = 'Completed'; r.outcome = 'No update needed'; r.completedAt = now(); r.agreement = ag.id;
      var nextDue = Q.iso(Q.addDays(new Date(), Math.round((d.periodic ? d.periodic.months : 12) * 30.4)));
      r.nextDue = nextDue;
      var id = Q.nextId('PR');
      Q.S.reviews[id] = { id: id, doc: r.doc, reviewer: r.reviewer, due: nextDue, notice: r.notice, approval: r.approval, created: now(), state: 'Open' };
      Q.audit('review', 'Periodic review', r.id, 'Periodic review of ' + r.doc + ': no update needed (signed in Adobe Sign, agreement ' + ag.id + '); next review ' + Q.fmtDate(nextDue), null, null, { actor: 'system' });
      Q.closeTasks(function (t) { return t.record === r.id; });
      Q.save();
    },
    needsUpdate: function (r, route, reason) {
      var d = Q.S.docs[r.doc];
      r.state = 'Completed'; r.outcome = 'Needs update'; r.completedAt = now(); r.reason = reason;
      Q.closeTasks(function (t) { return t.record === r.id; });
      if (route === 'cr') {
        var cr = C.create({ title: 'Update ' + d.id + ' ' + d.title + ' after periodic review', size: 'Minor', classification: d.classification, process: d.process, description: reason, reason: 'Periodic review ' + r.id + ' found the document needs an update.', impact: 'Readers of ' + d.id + '.', items: [d.id], reviewers: [], approvers: [d.owner === me() ? 'u-tom' : d.owner] });
        r.followUp = cr.id; Q.S.links.push([r.id, cr.id]);
      } else {
        if (d.state === 'Effective') D.newVersion(d, 'minor', 'Periodic review: ' + reason); // opens a change request too
        r.followUp = d.id;
      }
      Q.audit('review', 'Periodic review', r.id, 'Periodic review of ' + r.doc + ': needs update → ' + r.followUp);
      Q.save();
      return r.followUp;
    }
  };

  // ---------- Users and access ----------
  wf.user = {
    revokeNow: function (u, reason) {
      var b = u.status; u.status = 'Revoked'; u.sessionsRevokedAt = now();
      Q.audit('access.revoke', 'User', u.id, 'Revoke-now: ended all sessions for ' + u.name + '. Reason: ' + reason, { status: b }, { status: 'Revoked' });
      var open = Q.S.tasks.filter(function (t) { return t.assignee === u.id && t.status === 'open'; });
      open.forEach(function (t) { t.assignee = u.manager || 'u-vic'; t.note = 'Reassigned from ' + u.name + ' (access revoked)'; });
      if (open.length) Q.audit('task.assign', 'User', u.id, 'Reassigned ' + open.length + ' open tasks to ' + Q.fullName(u.manager || 'u-vic'));
      Q.fire('security', { user: u.id, privilege: true, title: 'Access revoked for ' + u.name, body: 'Records, signatures and training history are kept.' });
      Q.save();
    },
    leaver: function (u) {
      var b = u.status; u.status = 'Left'; u.leftOn = now(); u.groups = [];
      Q.audit('access.deprovision', 'User', u.id, 'Deprovisioned ' + u.name + ' (leaver). Training records and signatures kept.', { status: b }, { status: 'Left' });
      Q.S.assignments.forEach(function (a) { if (a.user === u.id) a.leaver = true; });
      Q.S.tasks.forEach(function (t) { if (t.assignee === u.id && t.status === 'open') { t.assignee = u.manager || 'u-vic'; t.note = 'Reassigned from leaver ' + u.name; } });
      Q.save();
    },
    // New starter from Entra ID (SCIM). Training for every document their groups and roles need is allocated at once.
    provision: function (o) {
      var base = 'u-' + o.name.toLowerCase().replace(/[^a-z]+/g, '').slice(0, 10), id = base, i = 2;
      while (Q.S.users.some(function (x) { return x.id === id; })) id = base + (i++);
      var parts = o.name.trim().split(/\s+/);
      var u = { id: id, name: o.name.trim(), initials: (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase(), email: o.email || id.slice(2) + '@veqms.example', roles: o.roles && o.roles.length ? o.roles : ['employee'], title: o.title || 'New starter', clearance: 'Internal', status: 'Active', site: o.site || 'London', manager: o.manager || null, groups: ['All staff'].concat((o.groups || []).filter(function (g) { return g !== 'All staff'; })), startedOn: now() };
      Q.S.users.push(u);
      Q.audit('access.provision', 'User', u.id, 'New starter provisioned from Entra ID (SCIM): ' + u.name, null, { groups: u.groups.slice(), roles: u.roles.slice() }, { actor: 'system' });
      var r = Q.reconcileUser(u.id, 'New starter', 'system');
      Q.save(); return { user: u, added: r.added };
    },
    // Group move from Entra ID (SCIM): adds training for new audiences, closes open items that no longer apply.
    setGroups: function (u, groups) {
      var b = u.groups.slice();
      u.groups = groups.filter(function (g, i, a) { return a.indexOf(g) === i; });
      Q.audit('access.groups', 'User', u.id, 'Group change from Entra ID (SCIM) for ' + u.name + ': ' + (b.join(', ') || 'none') + ' → ' + u.groups.join(', '), { groups: b }, { groups: u.groups.slice() }, { actor: 'system' });
      var r = Q.reconcileUser(u.id, 'Group change', 'system');
      Q.save(); return r;
    },
    requestRole: function (u, role) {
      var needsSecond = ['approver', 'qm', 'admin'].indexOf(role) >= 0 && Q.S.settings.twoPerson !== false;
      if (needsSecond) {
        Q.S.roleRequests.unshift({ id: Q.uid('RR'), user: u.id, role: role, requestedBy: me(), at: now(), status: 'Waiting for second admin' });
        Q.audit('role.request', 'User', u.id, 'Requested ' + Q.ROLE_LABEL[role] + ' for ' + u.name + ' (two-person rule: a second admin must approve)');
      } else {
        var b = u.roles.slice(); u.roles.push(role);
        Q.audit('role.change', 'User', u.id, 'Granted ' + Q.ROLE_LABEL[role] + ' to ' + u.name, { roles: b }, { roles: u.roles.slice() });
        Q.fire('security', { user: u.id, privilege: true, title: 'Role change: ' + u.name + ' is now ' + Q.ROLE_LABEL[role] });
        Q.reconcileUser(u.id, 'Role change', 'system');
      }
      Q.save(); return needsSecond;
    },
    removeRole: function (u, role) {
      var b = u.roles.slice(); u.roles = u.roles.filter(function (r) { return r !== role; });
      Q.audit('role.change', 'User', u.id, 'Removed ' + Q.ROLE_LABEL[role] + ' from ' + u.name, { roles: b }, { roles: u.roles.slice() });
      Q.fire('security', { user: u.id, privilege: true, title: 'Role change: ' + Q.ROLE_LABEL[role] + ' removed from ' + u.name });
      Q.reconcileUser(u.id, 'Role change', 'system');
      Q.save();
    },
    decideRequest: function (rq, approve) {
      var u = Q.user(rq.user);
      rq.status = approve ? 'Approved' : 'Declined'; rq.decidedBy = me(); rq.decidedAt = now();
      if (approve) {
        var b = u.roles.slice(); if (u.roles.indexOf(rq.role) < 0) u.roles.push(rq.role);
        Q.audit('role.change', 'User', u.id, 'Second admin approved ' + Q.ROLE_LABEL[rq.role] + ' for ' + u.name, { roles: b }, { roles: u.roles.slice() });
        Q.fire('security', { user: u.id, privilege: true, title: 'Role change: ' + u.name + ' is now ' + Q.ROLE_LABEL[rq.role] });
        Q.reconcileUser(u.id, 'Role change', 'system');
      } else Q.audit('role.request', 'User', u.id, 'Declined role request ' + rq.id);
      Q.save();
    }
  };
})(window.Q);
