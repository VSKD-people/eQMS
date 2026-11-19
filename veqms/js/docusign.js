/* Route 1: approvals through DocuSign with the Part 11 module.
   One envelope per record version holds every signer (author, then reviewers, then QA approver), so one
   approval cycle costs one send. The record changes state only when the envelope completes; a declined or
   voided envelope returns it with the reason recorded. Every send is logged against the yearly allowance.
   SIMULATED in the prototype: no call leaves the browser. In production the API creates the envelope with
   the eSignature REST API and tracks status through Connect webhooks (HMAC verified), polling as a fallback. */
(function (Q) {
  'use strict';
  var ds = Q.ds = {};
  function now() { return new Date().toISOString(); }
  function me() { return Q.S.session.userId; }
  function due(days) { return Q.dayIso(days, 17, 0); }
  function guid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  // ---------- Allowance ----------
  ds.cfg = function () { return Q.S.settings.docusign; };
  ds.yearRange = function (at) {
    var m = (ds.cfg().yearStartMonth || 1) - 1, d = at ? new Date(at) : new Date();
    var y = d.getMonth() >= m ? d.getFullYear() : d.getFullYear() - 1;
    var start = new Date(y, m, 1), end = new Date(y + 1, m, 1);
    return { start: start.toISOString(), end: end.toISOString(), label: Q.fmtDate(start.toISOString()) + ' to ' + Q.fmtDate(new Date(end.getTime() - Q.DAY).toISOString()) };
  };
  ds.sends = function (range) { range = range || ds.yearRange(); return Q.S.envelopes.filter(function (e) { return e.sentAt >= range.start && e.sentAt < range.end; }); };
  ds.used = function () { return ds.sends().length; };
  ds.remaining = function () { return Math.max(0, ds.cfg().allowance - ds.used()); };
  ds.sendNo = function (env) { var r = ds.yearRange(env.sentAt); var list = ds.sends(r).slice().sort(Q.by('sentAt')); return list.indexOf(env) + 1; };

  // ---------- Lookups ----------
  ds.byId = function (id) { return id ? Q.S.envelopes.find(function (e) { return e.id === id; }) : null; };
  ds.forRecord = function (rid) { return Q.S.envelopes.filter(function (e) { return e.record === rid; }).sort(Q.by('sentAt', -1)); };
  ds.active = function (rid) { return Q.S.envelopes.find(function (e) { return e.record === rid && e.status === 'sent'; }) || null; };
  ds.current = function (env) { var open = env.signers.filter(function (s) { return s.status !== 'Signed'; }); return open.length ? Math.min.apply(null, open.map(function (s) { return s.order; })) : null; };
  ds.myTurn = function (env, uid) { uid = uid || me(); return env && env.status === 'sent' && env.signers.some(function (s) { return s.u === uid && s.status === 'Sent'; }); };
  ds.signedCount = function (env) { return env.signers.filter(function (s) { return s.status === 'Signed'; }).length; };
  ds.STATUS = { sent: 'Out for signature', completed: 'Completed', declined: 'Declined', voided: 'Voided' };
  ds.isDeviation = function (e) { return e && e.type === 'Deviation'; };

  // QA approvers: Quality Managers first, then approvers. Never the excluded people (owner or author).
  ds.qaApprovers = function (exclude) {
    exclude = exclude || [];
    var act = Q.activeUsers().filter(function (u) { return exclude.indexOf(u.id) < 0; });
    return act.filter(function (u) { return u.roles.indexOf('qm') >= 0; }).concat(act.filter(function (u) { return u.roles.indexOf('qm') < 0 && u.roles.indexOf('approver') >= 0; }));
  };

  // ---------- Plan: who signs, in what order, and what is wrong with it ----------
  // opts.approvers: user ids for QA approvers (documents: 1 or 2; CAPA and deviations: 1)
  ds.plan = function (rid, opts) {
    opts = opts || {};
    var k = Q.kindOf(rid), r = Q.rec(rid), p = { record: rid, kind: k, problems: [], signers: [] };
    var approvers;
    if (k === 'doc') {
      var v = Q.curVer(r);
      approvers = opts.approvers || r.approvers.map(function (a) { return a.u; });
      p.version = v.v; p.title = r.title; p.purpose = 'Document approval';
      p.subject = r.id + ' v' + v.v + ' · ' + r.title + ' · Approval';
      p.pdf = { name: r.id + '_v' + v.v + '.pdf', hash: v.hash };
      p.signers.push({ u: r.author, role: 'Author', meaning: 'Authored', order: 1 });
      r.reviewers.forEach(function (x) { p.signers.push({ u: x.u, role: 'Reviewer', meaning: 'Reviewed', order: 2 }); });
      var base = r.reviewers.length ? 3 : 2;
      approvers.forEach(function (u, i) { p.signers.push({ u: u, role: approvers.length > 1 ? 'QA approver ' + (i + 1) : 'QA approver', meaning: 'Approved', order: base + i }); });
      if (!approvers.length) p.problems.push('Choose a QA approver.');
      approvers.forEach(function (u) {
        if (u === r.author) p.problems.push(Q.fullName(u) + ' authored this version, so they can’t approve it (segregation of duties). Choose another QA approver.');
        if (r.reviewers.some(function (x) { return x.u === u; })) p.problems.push(Q.fullName(u) + ' is a reviewer, so they can’t also be the QA approver.');
      });
    } else if (k === 'capa' || k === 'qe') {
      var owner = r.owner;
      approvers = opts.approvers || [(ds.qaApprovers([owner])[0] || {}).id].filter(Boolean);
      var closure = r.pendingClosure;
      p.version = null; p.title = r.title;
      p.purpose = k === 'capa' ? 'CAPA closure' : 'Deviation closure';
      p.subject = r.id + ' · ' + r.title + ' · ' + p.purpose;
      p.pdf = { name: r.id + '_closure.pdf', hash: Q.sha256(Q.canon({ id: r.id, closure: closure || null })) };
      p.signers.push({ u: owner, role: k === 'capa' ? 'CAPA owner' : 'Deviation owner', meaning: 'Authored', order: 1 });
      approvers.forEach(function (u, i) { p.signers.push({ u: u, role: 'QA approver', meaning: 'Approved', order: 2 + i }); });
      if (!approvers.length) p.problems.push('Choose a QA approver.');
      approvers.forEach(function (u) { if (u === owner) p.problems.push(Q.fullName(u) + ' owns this record, so they can’t also approve its closure.'); });
      if (!closure) p.problems.push(k === 'capa' ? 'Record the effectiveness result first.' : 'Write the closure justification first.');
    } else { p.problems.push('This record type doesn’t use DocuSign.'); return p; }
    approvers.forEach(function (u) {
      var usr = Q.user(u);
      if (usr.status !== 'Active') p.problems.push(usr.name + ' is not an active user.');
      else if (usr.roles.indexOf('approver') < 0 && usr.roles.indexOf('qm') < 0) p.problems.push(usr.name + ' doesn’t hold the Approver or Quality Manager role.');
    });
    p.signers.forEach(function (s) { if (Q.user(s.u).status !== 'Active') p.problems.push(Q.fullName(s.u) + ' (' + s.role.toLowerCase() + ') is no longer active.'); });
    return p;
  };

  // Can the current user send now? Returns a reason string when not.
  ds.cantSend = function (rid) {
    var k = Q.kindOf(rid), r = Q.rec(rid), u = Q.me();
    if (Q.readOnly()) return 'Your role is read-only.';
    if (!Q.integrationOn('docusign')) return 'The DocuSign connector is switched off. A System Administrator can switch it on in Administration → Integrations.';
    if (ds.active(rid)) return 'An envelope for this record is already out for signature.';
    if (ds.remaining() <= 0) return 'This year’s allowance of ' + ds.cfg().allowance + ' DocuSign sends is used up. Talk to the Quality Manager before sending more.';
    if (k === 'doc') {
      if (r.state !== 'Review closed') return 'Only a document in Review closed can be sent for approval.';
      if (!(r.owner === u.id || r.author === u.id || Q.hasRole('qm'))) return 'Only the owner, the author or a Quality Manager can send this envelope.';
    } else if (k === 'capa') {
      if (r.state !== 'Effectiveness check') return 'A CAPA goes to DocuSign when its effectiveness check is recorded.';
      if (!(r.owner === u.id || Q.hasRole('qm') || r.effectiveness.assignee === u.id)) return 'Only the CAPA owner or a Quality Manager can send the closure.';
    } else if (k === 'qe') {
      if (!ds.isDeviation(r)) return 'Only deviations close through DocuSign.';
      if (['Open', 'Assessment'].indexOf(r.state) < 0) return 'This deviation is not open.';
      if (!(r.owner === u.id || Q.hasRole('qm'))) return 'Only the owner or a Quality Manager can send the closure.';
    } else return 'This record type doesn’t use DocuSign.';
    return null;
  };

  // ---------- Send (one envelope = one send) ----------
  ds.send = function (rid, o) {
    var block = ds.cantSend(rid); if (block) throw new Error(block);
    var ver = o.verification || {};
    if (!(ver.footer && ver.version && ver.docId && ver.dates)) throw new Error('Complete the verification check first.');
    var p = ds.plan(rid, { approvers: o.approvers });
    if (p.problems.length) throw new Error(p.problems[0]);
    var r = Q.rec(rid), k = p.kind;
    var last = ds.forRecord(rid)[0], prev = last && (last.status === 'voided' || last.status === 'declined') ? last : null;
    var env = {
      id: guid(), record: rid, kind: k, version: p.version, subject: p.subject, purpose: p.purpose,
      status: 'sent', sentBy: me(), sentAt: now(), completedAt: null,
      signers: p.signers.map(function (s) { return { u: s.u, role: s.role, meaning: s.meaning, order: s.order, status: 'Waiting' }; }),
      pdf: p.pdf, signedPdf: null, certificate: null,
      verification: { footer: true, version: true, docId: true, dates: true, by: me(), at: now(), note: ver.note || '' },
      events: [], correctionOf: prev ? prev.id : null
    };
    Q.S.envelopes.push(env);
    env.events.push({ at: env.sentAt, type: 'sent', u: me(), detail: 'Envelope sent to ' + Q.plural(env.signers.length, 'signer') + (prev ? ' (correction of ' + prev.id.slice(0, 8) + '…)' : '') });
    var n = ds.sendNo(env);
    Q.audit('docusign.verify', Q.KIND_LABEL[k], rid, 'Verification check passed for ' + env.subject.split(' · ')[0] + ': footer, version, document ID and dates', null, { footer: true, version: true, docId: true, dates: true, note: ver.note || '' });
    Q.audit('docusign.send', Q.KIND_LABEL[k], rid, 'Sent DocuSign envelope ' + env.id + ' (send ' + n + ' of ' + ds.cfg().allowance + ' this year' + (prev ? '; correction after a ' + prev.status + ' envelope' : '') + ')', null, { envelope: env.id, subject: env.subject, signers: env.signers.map(function (s) { return Q.fullName(s.u) + ' · ' + s.meaning; }), sendsUsed: ds.used(), sendsRemaining: ds.remaining() });
    if (k === 'doc') {
      r.approvers = (o.approvers || r.approvers.map(function (a) { return a.u; })).map(function (u) { return { u: u, status: 'Waiting' }; });
      r.route = 'sequential'; r.approvalDue = due(5);
      Q.wf.doc.setState(r, 'In approval', 'Sent v' + p.version + ' to DocuSign for approval (envelope ' + env.id + ')');
      Q.curVer(r).envelope = env.id;
      Q.closeTasks(function (t) { return t.record === rid && t.kind === 'send-approval'; });
    } else {
      r.closureEnvelope = env.id; r.closureReturned = null;
      Q.closeTasks(function (t) { return t.record === rid && (t.kind === 'effectiveness' || t.kind === 'qe-assess'); });
    }
    advance(env);
    if (ds.remaining() <= (ds.cfg().warnAt || 50)) {
      var qms = Q.activeUsers().filter(function (u) { return u.roles.indexOf('qm') >= 0; }).map(function (u) { return u.id; });
      Q.notify({ to: qms, kind: 'warn', channels: ['in-app', 'email'], title: 'DocuSign allowance running low: ' + ds.remaining() + ' sends left this year', body: 'Used ' + ds.used() + ' of ' + ds.cfg().allowance + '.', href: '#/approvals' });
    }
    Q.save();
    return env;
  };

  // Deliver to the next routing order once everyone in the current order has signed.
  function advance(env) {
    var cur = ds.current(env);
    if (cur === null) { complete(env); return; }
    var next = env.signers.filter(function (s) { return s.order === cur && s.status === 'Waiting'; });
    if (!next.length) return;
    var r = Q.rec(env.record);
    next.forEach(function (s) {
      s.status = 'Sent'; s.sentAt = now();
      env.events.push({ at: now(), type: 'delivered', u: s.u, detail: 'DocuSign emailed the signing link' });
      if (env.kind === 'doc') { var a = r.approvers.find(function (x) { return x.u === s.u; }); if (a && s.meaning === 'Approved') a.status = 'Your turn'; }
      Q.closeTasks(function (t) { return t.record === env.record && t.assignee === s.u && t.kind === 'fyi'; });
      Q.wf.assign({ kind: 'ds-sign', record: env.record, assignee: s.u, due: env.kind === 'doc' ? r.approvalDue : due(5), ref: env.id, quiet: true, note: s.role + ' · meaning: ' + s.meaning });
    });
    Q.fire('stage.reached', { record: env.record, to: next.map(function (s) { return s.u; }), what: 'sign in DocuSign', body: env.subject + '. DocuSign has emailed you the signing link.' });
  }

  // Signer completes in DocuSign. The app learns of it from the Connect webhook.
  ds.sign = function (env) {
    var s = env.signers.find(function (x) { return x.u === me() && x.status === 'Sent'; });
    if (!s || env.status !== 'sent') throw new Error('It isn’t your turn to sign this envelope.');
    s.status = 'Signed'; s.at = now();
    env.events.push({ at: s.at, type: 'signed', u: s.u });
    Q.audit('docusign.signed', Q.KIND_LABEL[env.kind], env.record, 'DocuSign Connect: ' + Q.fullName(s.u) + ' signed ' + env.subject.split(' · ')[0] + ' · ' + s.meaning + ' (Part 11 re-authentication)', null, { envelope: env.id, signer: Q.fullName(s.u), meaning: s.meaning, at: s.at }, { actor: 'system' });
    Q.closeTasks(function (t) { return t.record === env.record && t.assignee === s.u && t.kind === 'ds-sign'; });
    if (env.kind === 'doc') { var a = Q.rec(env.record).approvers.find(function (x) { return x.u === s.u; }); if (a && s.meaning === 'Approved') { a.status = 'Signed'; a.at = s.at; } }
    Q.fire('signature.completed', { record: env.record, owner: (Q.rec(env.record) || {}).owner, meaning: s.meaning + ' (DocuSign)' });
    advance(env);
    Q.save();
  };

  function complete(env) {
    var r = Q.rec(env.record);
    env.status = 'completed'; env.completedAt = now();
    env.signedPdf = { name: env.pdf.name.replace(/\.pdf$/, '_signed.pdf'), hash: Q.sha256('signed:' + env.id + env.pdf.hash) };
    env.certificate = { name: 'Certificate_of_completion_' + env.id.slice(0, 8) + '.pdf', hash: Q.sha256('certificate:' + env.id + env.completedAt) };
    env.events.push({ at: env.completedAt, type: 'completed', detail: 'Envelope completed. Signed PDF and certificate of completion downloaded and stored.' });
    var rows = env.signers.map(function (s) {
      var sig = { id: 'DS-' + (++Q.S.counters.DS), record: env.record, version: env.version, user: s.u, meaning: s.meaning, at: s.at, hash: env.pdf.hash, source: 'DocuSign', envelope: env.id,
        statement: 'Signed in DocuSign with the Part 11 module: signer re-authenticated and chose the meaning “' + s.meaning + '”.' };
      Q.S.signatures.push(sig);
      return sig;
    });
    Q.audit('docusign.completed', Q.KIND_LABEL[env.kind], env.record, 'Envelope ' + env.id + ' completed; signed PDF, certificate of completion and envelope ID stored against ' + (env.version ? 'v' + env.version : env.record), null, { envelope: env.id, signedPdf: env.signedPdf.name, signedPdfSha256: env.signedPdf.hash, certificate: env.certificate.name }, { actor: 'system' });
    var nTraining = 0;
    if (env.kind === 'doc') {
      var v = r.versions.find(function (x) { return x.v === env.version; }) || Q.curVer(r);
      v.envelope = env.id; v.signedPdf = env.signedPdf; v.certificate = env.certificate; v.approvedAt = env.completedAt;
      v.signatures = rows.map(function (x) { return { id: x.id, user: x.user, meaning: x.meaning, at: x.at, hash: x.hash, source: 'DocuSign', envelope: env.id, statement: x.statement }; });
      nTraining = Q.recordApprovalTraining(r, v.v, env);
      Q.wf.doc.makeEffective(r);
    } else if (env.kind === 'capa') {
      var pc = r.pendingClosure;
      Q.wf.capa.close(r, pc.result, pc.verdict, null, env);
      r.pendingClosure = null;
    } else if (env.kind === 'qe') {
      Q.wf.qe.closeNoCapa(r, r.pendingClosure.justification, null, env);
      r.pendingClosure = null;
    }
    Q.notify({ to: [env.sentBy, r.owner].filter(function (x, i, a) { return a.indexOf(x) === i; }), kind: 'info', channels: ['in-app', 'email'], record: env.record, title: 'DocuSign envelope completed: ' + env.subject.split(' · ')[0], body: 'Signed PDF and certificate of completion are stored against the record.' });
    Q.fire('docusign.completed', { record: env.record, envelope: env.id, training: nTraining });
  }

  // Declined in DocuSign, or voided from the app: the record goes back with the reason recorded.
  function giveBack(env, how, reason, by) {
    var r = Q.rec(env.record);
    Q.closeTasks(function (t) { return t.record === env.record && (t.kind === 'ds-sign' || t.kind === 'fyi'); });
    var why = 'Envelope ' + how + ' by ' + Q.fullName(by) + '. Reason: ' + reason;
    if (env.kind === 'doc') {
      r.approvers.forEach(function (a) { a.status = 'Waiting'; delete a.at; });
      r.reviewers.forEach(function (x) { x.status = 'Not started'; delete x.at; });
      Q.wf.doc.setState(r, 'Draft', 'Returned to draft: ' + why);
      Q.wf.assign({ kind: 'resubmit', record: r.id, assignee: r.author, due: due(5), note: why });
      Q.fire('sent.back', { record: r.id, to: env.signers.map(function (s) { return s.u; }).filter(function (u, i, a) { return u !== me() && a.indexOf(u) === i; }), reason: why });
    } else {
      r.closureEnvelope = null;
      r.closureReturned = { how: how, reason: reason, by: by, at: now(), envelope: env.id };
      Q.audit('state', Q.KIND_LABEL[env.kind], r.id, 'Closure returned to the owner: ' + why, null, { closureReturned: true });
      Q.wf.assign({ kind: env.kind === 'capa' ? 'effectiveness' : 'qe-assess', record: r.id, assignee: r.owner, due: due(3), note: why });
    }
  }
  ds.decline = function (env, reason) {
    var s = env.signers.find(function (x) { return x.u === me() && x.status === 'Sent'; });
    if (!s || env.status !== 'sent') throw new Error('It isn’t your turn on this envelope.');
    s.status = 'Declined'; s.at = now();
    env.status = 'declined'; env.declinedAt = now(); env.declinedBy = me(); env.declineReason = reason;
    env.events.push({ at: env.declinedAt, type: 'declined', u: me(), detail: reason });
    Q.audit('docusign.declined', Q.KIND_LABEL[env.kind], env.record, 'DocuSign Connect: ' + Q.fullName(me()) + ' declined to sign ' + env.subject.split(' · ')[0] + '. Reason: ' + reason, { status: 'sent' }, { status: 'declined', reason: reason }, { actor: 'system' });
    giveBack(env, 'declined', reason, me());
    Q.save();
  };
  ds.canVoid = function (env) {
    if (!env || env.status !== 'sent' || Q.readOnly()) return false;
    var r = Q.rec(env.record);
    return env.sentBy === me() || (r && r.owner === me()) || Q.hasRole('qm');
  };
  ds.void = function (env, reason) {
    if (!ds.canVoid(env)) throw new Error('You can’t void this envelope.');
    env.status = 'voided'; env.voidedAt = now(); env.voidedBy = me(); env.voidReason = reason;
    env.signers.forEach(function (s) { if (s.status !== 'Signed') s.status = 'Voided'; });
    env.events.push({ at: env.voidedAt, type: 'voided', u: me(), detail: reason });
    Q.audit('docusign.void', Q.KIND_LABEL[env.kind], env.record, 'Voided DocuSign envelope ' + env.id + '. Reason: ' + reason + '. A corrected envelope is a new send.', { status: 'sent' }, { status: 'voided', reason: reason });
    giveBack(env, 'voided', reason, me());
    Q.save();
  };
  // Manual status check (polling fallback for a missed webhook).
  ds.checkStatus = function (env) {
    env.events.push({ at: now(), type: 'status', u: me(), detail: 'Status checked through the DocuSign API: ' + ds.STATUS[env.status].toLowerCase() + ', no change' });
    Q.audit('docusign.poll', Q.KIND_LABEL[env.kind], env.record, 'Checked envelope ' + env.id + ' status through the DocuSign API: ' + ds.STATUS[env.status]);
    Q.save();
  };
})(window.Q);
