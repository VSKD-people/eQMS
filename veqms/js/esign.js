/* Signatures through Adobe Sign (Adobe Acrobat Sign, with the account's Bio-Pharma settings for Part 11).
   Every signature except read-and-understood training is an Adobe Sign agreement: one agreement per sign-off,
   every signer in it in order, and one transaction each against the yearly allowance. The record changes state
   only when the agreement completes; a declined or cancelled agreement returns it with the reason recorded.
   Each stage below says who signs, what goes in the PDF, and what completing or returning does.
   SIMULATED in the prototype: nothing leaves the browser. In production the API sends agreements through the
   Acrobat Sign REST API, learns of changes from webhooks and re-reads the agreement from the API before acting,
   with polling as a fallback. */
(function (Q) {
  'use strict';
  var es = Q.esign = {};
  function now() { return new Date().toISOString(); }
  function me() { return Q.S.session.userId; }
  function due(days) { return Q.dayIso(days, 17, 0); }
  function guid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  // ---------- Allowance: one transaction per agreement sent ----------
  es.cfg = function () { return Q.S.settings.esign; };
  es.yearRange = function (at) {
    var m = (es.cfg().yearStartMonth || 1) - 1, d = at ? new Date(at) : new Date();
    var y = d.getMonth() >= m ? d.getFullYear() : d.getFullYear() - 1;
    var start = new Date(y, m, 1), end = new Date(y + 1, m, 1);
    return { start: start.toISOString(), end: end.toISOString(), label: Q.fmtDate(start.toISOString()) + ' to ' + Q.fmtDate(new Date(end.getTime() - Q.DAY).toISOString()) };
  };
  es.transactions = function (range) { range = range || es.yearRange(); return Q.S.agreements.filter(function (a) { return a.sentAt >= range.start && a.sentAt < range.end; }); };
  es.used = function () { return es.transactions().length; };
  es.remaining = function () { return Math.max(0, es.cfg().allowance - es.used()); };
  es.txNo = function (ag) { var list = es.transactions(es.yearRange(ag.sentAt)).slice().sort(Q.by('sentAt')); return list.indexOf(ag) + 1; };

  // ---------- Lookups ----------
  function match(a, rid, stage, ref) { return a.record === rid && (!stage || a.stage === stage) && (ref === undefined || ref === null || a.ref === ref); }
  es.byId = function (id) { return id ? Q.S.agreements.find(function (a) { return a.id === id; }) : null; };
  es.forRecord = function (rid, stage, ref) { return Q.S.agreements.filter(function (a) { return match(a, rid, stage, ref); }).sort(Q.by('sentAt', -1)); };
  es.active = function (rid, stage, ref) { return Q.S.agreements.find(function (a) { return a.status === 'sent' && match(a, rid, stage, ref); }) || null; };
  es.current = function (ag) { var open = ag.signers.filter(function (s) { return s.status !== 'Signed'; }); return open.length ? Math.min.apply(null, open.map(function (s) { return s.order; })) : null; };
  es.myTurn = function (ag, uid) { uid = uid || me(); return !!ag && ag.status === 'sent' && ag.signers.some(function (s) { return s.u === uid && s.status === 'Sent'; }); };
  es.signedCount = function (ag) { return ag.signers.filter(function (s) { return s.status === 'Signed'; }).length; };
  es.STATUS = { sent: 'Out for signature', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled' };

  // QA approvers: Quality Managers first, then approvers. Never the excluded people (owner or author).
  es.qaApprovers = function (exclude, qmOnly) {
    exclude = exclude || [];
    var act = Q.activeUsers().filter(function (u) { return exclude.indexOf(u.id) < 0; });
    var qms = act.filter(function (u) { return u.roles.indexOf('qm') >= 0; });
    return qmOnly ? qms : qms.concat(act.filter(function (u) { return u.roles.indexOf('qm') < 0 && u.roles.indexOf('approver') >= 0; }));
  };

  // ---------- Stages: one per kind of sign-off ----------
  function S(u, role, meaning, order) { return { u: u, role: role, meaning: meaning, order: order }; }
  function action(r, ref) { return (r.actions || []).find(function (a) { return a.id === ref; }) || null; }
  // Approver checks shared by every plan: role, then segregation of duties (Q.sodBlock) against the record.
  function checkApprovers(p, r, kind, approvers, o) {
    o = o || {};
    if (!approvers.length) p.problems.push(o.none || 'Choose a QA approver.');
    approvers.forEach(function (u) {
      var usr = Q.user(u);
      if (usr.status !== 'Active') { p.problems.push(usr.name + ' is not an active user.'); return; }
      if (o.qmOnly && usr.roles.indexOf('qm') < 0) { p.problems.push(usr.name + ' isn’t a Quality Manager. High-severity CAPAs need a Quality Manager’s approval.'); return; }
      if (usr.roles.indexOf('approver') < 0 && usr.roles.indexOf('qm') < 0) { p.problems.push(usr.name + ' doesn’t hold the Approver or Quality Manager role.'); return; }
      var sod = Q.sodBlock(r, kind, u); if (sod) p.problems.push(sod);
    });
  }
  function closureLabels(id) {
    return { footer: 'The PDF footer shows ' + id + ' and “Page X of Y”', version: 'The summary in the PDF matches the record (result, verdict or justification)', docId: 'The record ID ' + id + ' and its title are correct', dates: 'Dates are correct: raised, due and effectiveness dates' };
  }
  function signOffLabels(id) {
    return { footer: 'The PDF footer shows ' + id + ' and “Page X of Y”', version: 'The summary in the PDF matches what is being signed off', docId: 'The ID ' + id + ' and its title are correct', dates: 'Dates are correct' };
  }
  function giveTask(kind, rid, uid, why, ref) { Q.wf.assign({ kind: kind, record: rid, assignee: uid, due: due(3), note: why, ref: ref || null }); }

  var ST = es.STAGES = {};

  // Controlled documents (vendor approvals and validation plans and reports included): author, reviewers, QA approvers.
  ST['doc-approval'] = {
    kind: 'doc', purpose: function () { return 'Document approval'; }, approvers: function () { return 2; },
    subject: function (r) { return r.id + ' v' + Q.curVer(r).v + ' · ' + r.title + ' · Approval'; },
    version: function (r) { return Q.curVer(r).v; },
    pdf: function (r) { var v = Q.curVer(r); return { name: r.id + '_v' + v.v + '.pdf', hash: v.hash }; },
    defaultApprovers: function (r) { var a = r.approvers.map(function (x) { return x.u; }).slice(0, 2); return a.length ? a : [(es.qaApprovers([r.author])[0] || {}).id].filter(Boolean); },
    plan: function (r, ap, p) {
      p.signers.push(S(r.author, 'Author', 'Authored', 1));
      r.reviewers.forEach(function (x) { p.signers.push(S(x.u, 'Reviewer', 'Reviewed', 2)); });
      var base = r.reviewers.length ? 3 : 2;
      ap.forEach(function (u, i) { p.signers.push(S(u, ap.length > 1 ? 'QA approver ' + (i + 1) : 'QA approver', 'Approved', base + i)); });
      ap.forEach(function (u) { if (r.reviewers.some(function (x) { return x.u === u; })) p.problems.push(Q.fullName(u) + ' is a reviewer, so they can’t also be the QA approver.'); });
      checkApprovers(p, r, 'doc', ap);
    },
    cantSend: function (r, u) {
      if (r.state !== 'Review closed') return 'Only a document in Review closed can be sent for approval.';
      if (!(r.owner === u.id || r.author === u.id || Q.hasRole('qm'))) return 'Only the owner, the author or a Quality Manager can send this agreement.';
      return null;
    },
    labels: function (r) {
      var ver = Q.curVer(r).v;
      return { footer: 'The footer shows ' + r.id + ', version ' + ver + ' and “Page X of Y” on every page', version: 'The version on the cover and in the agreement name is v' + ver, docId: 'The document ID ' + r.id + ' is correct throughout, including the title block', dates: 'Dates are correct: issue date, review date and any dates in the text' };
    },
    onSent: function (r, ag, o) {
      r.approvers = (o.approvers || r.approvers.map(function (a) { return a.u; })).map(function (u) { return { u: u, status: 'Waiting' }; });
      r.route = 'sequential'; r.approvalDue = due(5);
      Q.wf.doc.setState(r, 'In approval', 'Sent v' + ag.version + ' to Adobe Sign for approval (agreement ' + ag.id + ')');
      Q.curVer(r).agreement = ag.id;
      Q.closeTasks(function (t) { return t.record === r.id && t.kind === 'send-approval'; });
    },
    onTurn: function (r, ag, s) { var a = r.approvers.find(function (x) { return x.u === s.u; }); if (a && s.meaning === 'Approved') a.status = 'Your turn'; },
    onSigned: function (r, ag, s) { var a = r.approvers.find(function (x) { return x.u === s.u; }); if (a && s.meaning === 'Approved') { a.status = 'Signed'; a.at = s.at; } },
    onComplete: function (r, ag, rows) {
      var v = r.versions.find(function (x) { return x.v === ag.version; }) || Q.curVer(r);
      v.agreement = ag.id; v.signedPdf = ag.signedPdf; v.auditReport = ag.auditReport; v.approvedAt = ag.completedAt;
      v.signatures = rows.map(function (x) { return { id: x.id, user: x.user, meaning: x.meaning, at: x.at, hash: x.hash, source: 'Adobe Sign', agreement: ag.id, statement: x.statement }; });
      var n = Q.recordApprovalTraining(r, v.v, ag);
      Q.wf.doc.makeEffective(r);
      return n;
    },
    onReturn: function (r, ag, back) {
      r.approvers.forEach(function (a) { a.status = 'Waiting'; delete a.at; });
      r.reviewers.forEach(function (x) { x.status = 'Not started'; delete x.at; });
      Q.wf.doc.setState(r, 'Draft', 'Returned to draft: ' + back.why);
      Q.wf.assign({ kind: 'resubmit', record: r.id, assignee: r.author, due: due(5), note: back.why });
      Q.fire('sent.back', { record: r.id, to: ag.signers.map(function (s) { return s.u; }).filter(function (u, i, a) { return u !== me() && a.indexOf(u) === i; }), reason: back.why });
    }
  };

  // Making a document obsolete: the Quality Manager who asks for it signs.
  ST['doc-obsolete'] = {
    kind: 'doc', purpose: function () { return 'Document made obsolete'; }, approvers: function () { return 0; },
    subject: function (r) { var v = Q.effVer(r) || Q.curVer(r); return r.id + ' v' + v.v + ' · ' + r.title + ' · Obsolete'; },
    version: function (r) { return (Q.effVer(r) || Q.curVer(r)).v; },
    plan: function (r, ap, p, ref, sender) {
      p.signers.push(S(sender, 'Quality Manager', 'Approved', 1));
      if (!r.pendingObsolete) p.problems.push('Give the reason first.');
    },
    cantSend: function (r) {
      if (r.state !== 'Effective') return 'Only an effective document can be made obsolete.';
      if (!Q.hasRole('qm')) return 'Only a Quality Manager can make a document obsolete.';
      return null;
    },
    lines: function (r) { var v = Q.effVer(r) || Q.curVer(r); return [['Document', r.id + ' ' + r.title], ['Version', 'v' + v.v + ' (' + v.state + ')'], ['Reason', (r.pendingObsolete || {}).reason || '—'], ['Effect', 'Archived, not deleted. Open training for it closes; completed records stay.']]; },
    onSent: function (r, ag) { r.obsoleteAgreement = ag.id; r.obsoleteReturned = null; },
    onComplete: function (r, ag) { var reason = (r.pendingObsolete || {}).reason || ''; r.pendingObsolete = null; Q.wf.doc.obsolete(r, reason, ag); },
    onReturn: function (r, ag, back) { r.obsoleteAgreement = null; r.obsoleteReturned = back; r.pendingObsolete = null; Q.audit('state', 'Document', r.id, 'Obsolete request returned: ' + back.why); }
  };

  // Change request plan: the process owner, then the approvers named on the change request.
  ST['cr-plan'] = {
    kind: 'cr', purpose: function () { return 'Change request plan approval'; }, approvers: function () { return 0; },
    subject: function (r) { return r.id + ' · ' + r.title + ' · Plan approval'; },
    plan: function (r, ap, p) {
      var approvers = r.approvers.map(function (a) { return a.u; });
      p.signers.push(S(r.owner, 'Process owner', 'Authored', 1));
      approvers.forEach(function (u, i) { p.signers.push(S(u, approvers.length > 1 ? 'Approver ' + (i + 1) : 'Approver', 'Approved', 2 + i)); });
      checkApprovers(p, r, 'cr', approvers, { none: 'Add an approver to the change request first.' });
      if (!r.actions.length) p.problems.push('Add at least one action first.');
    },
    cantSend: function (r, u) {
      if (r.state !== 'Approval') return 'The plan goes to Adobe Sign once review is complete.';
      if (!(r.owner === u.id || Q.hasRole('qm'))) return 'Only the process owner or a Quality Manager can send the plan.';
      return null;
    },
    lines: function (r) { return [['Change', r.title + ' (' + r.size + ')'], ['Description', r.description], ['Reason', r.reason], ['Expected impact', r.impact], ['Items to change', r.items.join(', ') || '—'], ['Actions', r.actions.map(function (a) { return a.title + ' · ' + Q.fullName(a.assignee) + ' · due ' + Q.fmtDate(a.due); }).join('; ')], ['Reviews', r.reviewers.map(function (x) { return Q.fullName(x.u) + ': ' + x.status; }).join('; ') || 'None']]; },
    onSent: function (r, ag) {
      r.planAgreement = ag.id; r.planReturned = null;
      r.approvers.forEach(function (a) { a.status = 'Waiting'; });
      Q.closeTasks(function (t) { return t.record === r.id && t.kind === 'send-approval'; });
    },
    onTurn: function (r, ag, s) { var a = r.approvers.find(function (x) { return x.u === s.u; }); if (a && s.meaning === 'Approved') a.status = 'Your turn'; },
    onSigned: function (r, ag, s) { var a = r.approvers.find(function (x) { return x.u === s.u; }); if (a && s.meaning === 'Approved') { a.status = 'Signed'; a.at = s.at; } },
    onComplete: function (r, ag, rows) { Q.wf.cr.planApproved(r, ag, rows); },
    onReturn: function (r, ag, back) { r.planAgreement = null; r.planReturned = back; Q.wf.cr.returned(r, back.why); }
  };

  // A change action that needs a signature: the person who did it signs that it is done.
  ST['cr-action'] = {
    kind: 'cr', usesRef: true, purpose: function () { return 'Change action sign-off'; }, approvers: function () { return 0; },
    subject: function (r, ref) { var a = action(r, ref); return r.id + ' · ' + (a ? a.title : ref) + ' · Action completed'; },
    plan: function (r, ap, p, ref) { var a = action(r, ref); if (!a) { p.problems.push('Action not found.'); return; } p.signers.push(S(a.assignee, 'Action owner', 'Completed', 1)); },
    cantSend: function (r, u, ref) {
      var a = action(r, ref);
      if (!a) return 'Action not found.';
      if (r.state !== 'In execution') return 'Actions are signed off while the change is in execution.';
      if (a.status === 'Done') return 'This action is already done.';
      if (!a.sig) return 'This action doesn’t need a signature.';
      if (a.assignee !== u.id) return 'Only ' + Q.fullName(a.assignee) + ' can sign off this action.';
      return null;
    },
    lines: function (r, ref) { var a = action(r, ref) || {}; return [['Change request', r.id + ' ' + r.title], ['Action', a.title || ref], ['Details', a.desc || '—'], ['Linked document', a.doc || '—'], ['Done by', Q.fullName(a.assignee)], ['Due', Q.fmtDate(a.due)]]; },
    onSent: function (r, ag) { var a = action(r, ag.ref); a.agreement = ag.id; a.returned = null; Q.closeTasks(function (t) { return t.record === r.id && t.kind === 'cr-action' && t.ref === ag.ref; }); },
    onComplete: function (r, ag, rows) { Q.wf.cr.completeAction(r, action(r, ag.ref), rows[0]); },
    onReturn: function (r, ag, back) { var a = action(r, ag.ref); a.agreement = null; a.returned = back; giveTask('cr-action', r.id, a.assignee, back.why, a.id); }
  };

  // Change request completion: the process owner, then the approvers, once the effectiveness result is recorded.
  ST['cr-completion'] = {
    kind: 'cr', purpose: function () { return 'Change request completion'; }, approvers: function () { return 0; },
    subject: function (r) { return r.id + ' · ' + r.title + ' · Completion'; },
    plan: function (r, ap, p) {
      var approvers = r.approvers.map(function (a) { return a.u; });
      p.signers.push(S(r.owner, 'Process owner', 'Authored', 1));
      approvers.forEach(function (u, i) { p.signers.push(S(u, approvers.length > 1 ? 'Approver ' + (i + 1) : 'Approver', 'Approved', 2 + i)); });
      checkApprovers(p, r, 'cr', approvers, { none: 'Add an approver to the change request first.' });
      if (!r.pendingClosure) p.problems.push('Record the effectiveness result first.');
    },
    cantSend: function (r, u) {
      if (r.state !== 'Effectiveness check') return 'Completion goes to Adobe Sign once every action is done and the effectiveness result is recorded.';
      if (!(r.owner === u.id || Q.hasRole('qm') || r.approvers.some(function (a) { return a.u === u.id; }))) return 'Only the process owner, an approver or a Quality Manager can send the completion.';
      return null;
    },
    labels: function (r) { return closureLabels(r.id); },
    lines: function (r) { var pc = r.pendingClosure || {}; return [['Change', r.title], ['Actions', r.actions.map(function (a) { return a.title + ' (' + a.status + ')'; }).join('; ')], ['Success criteria', r.effectiveness.criteria], ['Result', pc.result || r.effectiveness.result || '—'], ['Verdict', pc.verdict || r.effectiveness.verdict || '—']]; },
    onSent: function (r, ag) { r.closureAgreement = ag.id; r.closureReturned = null; Q.closeTasks(function (t) { return t.record === r.id && t.kind === 'cr-effectiveness'; }); },
    onComplete: function (r, ag, rows) { var pc = r.pendingClosure; Q.wf.cr.close(r, pc.result, pc.verdict, ag, rows); r.pendingClosure = null; },
    onReturn: function (r, ag, back) { r.closureAgreement = null; r.closureReturned = back; Q.audit('state', 'Change request', r.id, 'Completion returned to the owner: ' + back.why); giveTask('cr-effectiveness', r.id, r.owner, back.why); }
  };

  // CAPA action plan: high severity needs the process owner, then a Quality Manager; low severity the process owner alone.
  function capaRoute(r) { return r.severity === 'High'; }
  ST['capa-plan'] = {
    kind: 'capa', purpose: function () { return 'CAPA action plan approval'; }, approvers: function (r) { return capaRoute(r) ? 1 : 0; },
    subject: function (r) { return r.id + ' · ' + r.title + ' · Action plan'; },
    defaultApprovers: function (r) { return capaRoute(r) ? [(es.qaApprovers([r.owner], true)[0] || {}).id].filter(Boolean) : []; },
    plan: function (r, ap, p) {
      if (capaRoute(r)) {
        p.signers.push(S(r.owner, 'Process owner', 'Authored', 1));
        ap.forEach(function (u, i) { p.signers.push(S(u, 'Quality Manager', 'Approved', 2 + i)); });
        checkApprovers(p, r, 'capa', ap, { qmOnly: true, none: 'Choose the Quality Manager who approves the plan.' });
      } else p.signers.push(S(r.owner, 'Process owner', 'Approved', 1));
      if (!r.actions.length) p.problems.push('Add at least one action first.');
    },
    cantSend: function (r, u) {
      if (r.state !== 'Planning' || r.actionsLocked) return 'The action plan is approved during Planning.';
      if (!(r.owner === u.id || Q.hasRole('qm'))) return 'Only the CAPA owner or a Quality Manager can send the plan.';
      return null;
    },
    lines: function (r) { return [['Problem', r.problem], ['Route', r.route], ['Actions', r.actions.map(function (a) { return a.type + ': ' + a.title + ' · ' + Q.fullName(a.assignee) + ' · due ' + Q.fmtDate(a.due) + (a.sig ? ' · signature' : ''); }).join('; ') || '—'], ['Effect', 'The actions lock and their owners are told.']]; },
    onSent: function (r, ag) { r.planAgreement = ag.id; r.planReturned = null; Q.closeTasks(function (t) { return t.record === r.id && t.kind === 'capa-plan'; }); },
    onComplete: function (r, ag) { Q.wf.capa.approvePlan(r, ag); },
    onReturn: function (r, ag, back) { r.planAgreement = null; r.planReturned = back; giveTask('capa-plan', r.id, r.owner, back.why); }
  };
  ST['capa-action'] = {
    kind: 'capa', usesRef: true, purpose: function () { return 'CAPA action sign-off'; }, approvers: function () { return 0; },
    subject: function (r, ref) { var a = action(r, ref); return r.id + ' · ' + (a ? a.title : ref) + ' · Action completed'; },
    plan: function (r, ap, p, ref) { var a = action(r, ref); if (!a) { p.problems.push('Action not found.'); return; } p.signers.push(S(a.assignee, 'Action owner', 'Completed', 1)); },
    cantSend: function (r, u, ref) {
      var a = action(r, ref);
      if (!a) return 'Action not found.';
      if (r.state !== 'Execution') return 'Actions are signed off during Execution.';
      if (a.status === 'Done') return 'This action is already done.';
      if (!a.sig) return 'This action doesn’t need a signature.';
      if (a.assignee !== u.id) return 'Only ' + Q.fullName(a.assignee) + ' can sign off this action.';
      return null;
    },
    lines: function (r, ref) { var a = action(r, ref) || {}; return [['CAPA', r.id + ' ' + r.title], ['Action', (a.type || '') + ': ' + (a.title || ref)], ['Linked document', a.doc || '—'], ['Done by', Q.fullName(a.assignee)], ['Due', Q.fmtDate(a.due)]]; },
    onSent: function (r, ag) { var a = action(r, ag.ref); a.agreement = ag.id; a.returned = null; Q.closeTasks(function (t) { return t.record === r.id && t.kind === 'capa-action' && t.ref === ag.ref; }); },
    onComplete: function (r, ag, rows) { Q.wf.capa.completeAction(r, action(r, ag.ref), rows[0]); },
    onReturn: function (r, ag, back) { var a = action(r, ag.ref); a.agreement = null; a.returned = back; giveTask('capa-action', r.id, a.assignee, back.why, a.id); }
  };
  // Completed actions: high severity needs a Quality Manager who did none of the actions; low severity the process owner.
  ST['capa-actions'] = {
    kind: 'capa', purpose: function () { return 'CAPA completed actions approval'; }, approvers: function (r) { return capaRoute(r) ? 1 : 0; },
    subject: function (r) { return r.id + ' · ' + r.title + ' · Completed actions'; },
    defaultApprovers: function (r) { var did = r.actions.map(function (a) { return a.assignee; }); return capaRoute(r) ? [(es.qaApprovers([r.owner].concat(did), true)[0] || es.qaApprovers([r.owner], true)[0] || {}).id].filter(Boolean) : []; },
    plan: function (r, ap, p) {
      if (capaRoute(r)) {
        p.signers.push(S(r.owner, 'Process owner', 'Authored', 1));
        ap.forEach(function (u, i) { p.signers.push(S(u, 'Quality Manager', 'Approved', 2 + i)); });
        checkApprovers(p, r, 'capa', ap, { qmOnly: true, none: 'Choose the Quality Manager who approves the completed actions.' });
        ap.forEach(function (u) { if (r.actions.some(function (a) { return a.assignee === u; })) p.problems.push(Q.fullName(u) + ' completed one of these actions, so they can’t approve them (segregation of duties).'); });
      } else p.signers.push(S(r.owner, 'Process owner', 'Approved', 1));
      if (r.actions.some(function (a) { return a.status !== 'Done'; })) p.problems.push('Every action must be done first.');
      if (r.rootWhy == null) p.problems.push('Record the root cause first.');
    },
    cantSend: function (r, u) {
      if (r.state !== 'Execution') return 'Completed actions are approved at the end of Execution.';
      if (!(r.owner === u.id || Q.hasRole('qm'))) return 'Only the CAPA owner or a Quality Manager can send the completed actions.';
      return null;
    },
    lines: function (r) { return [['Problem', r.problem], ['Root cause', r.rootWhy != null ? r.whys[r.rootWhy] : '—'], ['Actions', r.actions.map(function (a) { return a.type + ': ' + a.title + ' (' + a.status + (a.doneAt ? ', ' + Q.fmtDate(a.doneAt) : '') + ')'; }).join('; ')], ['Evidence', r.evidence.map(function (e) { return e.name; }).join(', ') || 'None']]; },
    onSent: function (r, ag) { r.actionsAgreement = ag.id; r.actionsReturned = null; Q.closeTasks(function (t) { return t.record === r.id && t.kind === 'capa-submit'; }); },
    onComplete: function (r, ag) { Q.wf.capa.approveActions(r, ag); },
    onReturn: function (r, ag, back) { r.actionsAgreement = null; r.actionsReturned = back; giveTask('capa-submit', r.id, r.owner, back.why); }
  };
  // CAPA closure: the owner, then a QA approver, once the effectiveness result is recorded.
  ST['capa-closure'] = {
    kind: 'capa', purpose: function () { return 'CAPA closure'; }, approvers: function () { return 1; },
    subject: function (r) { return r.id + ' · ' + r.title + ' · CAPA closure'; },
    defaultApprovers: function (r) { return [(es.qaApprovers([r.owner])[0] || {}).id].filter(Boolean); },
    plan: function (r, ap, p) {
      p.signers.push(S(r.owner, 'CAPA owner', 'Authored', 1));
      ap.forEach(function (u, i) { p.signers.push(S(u, 'QA approver', 'Approved', 2 + i)); });
      checkApprovers(p, r, 'capa', ap);
      if (!r.pendingClosure) p.problems.push('Record the effectiveness result first.');
    },
    cantSend: function (r, u) {
      if (r.state !== 'Effectiveness check') return 'A CAPA goes to Adobe Sign when its effectiveness check is recorded.';
      if (!(r.owner === u.id || Q.hasRole('qm') || r.effectiveness.assignee === u.id)) return 'Only the CAPA owner or a Quality Manager can send the closure.';
      return null;
    },
    labels: function (r) { return closureLabels(r.id); },
    lines: function (r) { var pc = r.pendingClosure || {}; return [['Problem', r.problem], ['Root cause', r.rootWhy != null ? r.whys[r.rootWhy] : '—'], ['Actions', r.actions.map(function (a) { return a.type + ': ' + a.title + ' (' + a.status + ')'; }).join('; ')], ['Success criteria', r.effectiveness.criteria], ['Result', pc.result || r.effectiveness.result || '—'], ['Verdict', pc.verdict || r.effectiveness.verdict || '—']]; },
    onSent: function (r, ag) { r.closureAgreement = ag.id; r.closureReturned = null; Q.closeTasks(function (t) { return t.record === r.id && t.kind === 'effectiveness'; }); },
    onComplete: function (r, ag) { var pc = r.pendingClosure; Q.wf.capa.close(r, pc.result, pc.verdict, ag); r.pendingClosure = null; },
    onReturn: function (r, ag, back) { r.closureAgreement = null; r.closureReturned = back; Q.audit('state', 'CAPA', r.id, 'Closure returned to the owner: ' + back.why, null, { closureReturned: true }); giveTask('effectiveness', r.id, r.owner, back.why); }
  };
  // Closing a quality event without a CAPA (any type): the owner, then a QA approver.
  ST['qe-closure'] = {
    kind: 'qe', purpose: function (r) { return r && r.type === 'Deviation' ? 'Deviation closure' : 'Quality event closure'; }, approvers: function () { return 1; },
    subject: function (r) { return r.id + ' · ' + r.title + ' · Closure without CAPA'; },
    defaultApprovers: function (r) { return [(es.qaApprovers([r.owner])[0] || {}).id].filter(Boolean); },
    plan: function (r, ap, p) {
      p.signers.push(S(r.owner, r.type === 'Deviation' ? 'Deviation owner' : 'Event owner', 'Authored', 1));
      ap.forEach(function (u, i) { p.signers.push(S(u, 'QA approver', 'Approved', 2 + i)); });
      checkApprovers(p, r, 'qe', ap);
      if (!r.pendingClosure) p.problems.push('Write the closure justification first.');
    },
    cantSend: function (r, u) {
      if (['Open', 'Assessment'].indexOf(r.state) < 0) return 'This event is not open.';
      if (!(r.owner === u.id || Q.hasRole('qm'))) return 'Only the owner or a Quality Manager can send the closure.';
      return null;
    },
    labels: function (r) { return closureLabels(r.id); },
    lines: function (r) { var pc = r.pendingClosure || {}; return [['Type', r.type], ['Description', r.desc], ['Assessment', r.assessment || '—'], ['Justification for closing without a CAPA', pc.justification || (r.closure || {}).justification || '—']]; },
    onSent: function (r, ag) { r.closureAgreement = ag.id; r.closureReturned = null; Q.closeTasks(function (t) { return t.record === r.id && t.kind === 'qe-assess'; }); },
    onComplete: function (r, ag) { Q.wf.qe.closeNoCapa(r, r.pendingClosure.justification, ag); r.pendingClosure = null; },
    onReturn: function (r, ag, back) { r.closureAgreement = null; r.closureReturned = back; Q.audit('state', 'Quality event', r.id, 'Closure returned to the owner: ' + back.why, null, { closureReturned: true }); giveTask('qe-assess', r.id, r.owner, back.why); }
  };
  // Periodic review with no update needed: the reviewer signs.
  ST.review = {
    kind: 'review', purpose: function () { return 'Periodic review: no update needed'; }, approvers: function () { return 0; },
    subject: function (r) { var d = Q.S.docs[r.doc]; return r.id + ' · ' + r.doc + ' ' + d.title + ' · Periodic review'; },
    version: function (r) { var d = Q.S.docs[r.doc]; return (Q.effVer(d) || Q.curVer(d)).v; },
    pdf: function (r) { var d = Q.S.docs[r.doc], v = Q.effVer(d) || Q.curVer(d); return { name: r.id + '_' + r.doc + '_review.pdf', hash: Q.sha256(Q.canon({ review: r.id, doc: r.doc, version: v.v, hash: v.hash })) }; },
    plan: function (r, ap, p) { p.signers.push(S(r.reviewer, 'Reviewer', 'Reviewed', 1)); },
    cantSend: function (r, u) {
      if (r.state === 'Completed') return 'This review is complete.';
      if (r.reviewer !== u.id) return 'Only ' + Q.fullName(r.reviewer) + ' can sign this review.';
      return null;
    },
    lines: function (r) { var d = Q.S.docs[r.doc], v = Q.effVer(d) || Q.curVer(d); return [['Document', r.doc + ' ' + d.title], ['Version reviewed', 'v' + v.v], ['Outcome', 'No update needed'], ['Reviewer', Q.fullName(r.reviewer)], ['Due', Q.fmtDate(r.due)], ['Next review', 'Every ' + (d.periodic ? d.periodic.months : 12) + ' months from completion']]; },
    onSent: function (r, ag) { r.agreement = ag.id; r.returned = null; Q.closeTasks(function (t) { return t.record === r.id && t.kind === 'periodic'; }); },
    onComplete: function (r, ag) { Q.wf.review.noUpdate(r, ag); },
    onReturn: function (r, ag, back) { r.agreement = null; r.returned = back; giveTask('periodic', r.id, r.reviewer, back.why); }
  };
  // Configuration sign-offs in Administration.
  ST['access-review'] = {
    kind: 'admin', label: 'Access review', purpose: function () { return 'Access review sign-off'; }, approvers: function () { return 0; },
    target: function (rid) { return { title: 'Quarterly access review (' + rid.replace('ACCESS-REVIEW-', '') + ')', href: '#/admin/users?tab=review', obj: Q.S.accessReviews[rid] || (Q.S.accessReviews[rid] = { id: rid }) }; },
    subject: function (r) { return r.id + ' · Quarterly access review · Sign-off'; },
    plan: function (r, ap, p, ref, sender) { p.signers.push(S(sender, 'Reviewer', 'Reviewed', 1)); },
    cantSend: function (r) {
      if (!Q.can('admin.users')) return 'Only a System Administrator can sign off the access review.';
      if (r.signedAt) return 'This quarter’s access review is already signed off.';
      return null;
    },
    lines: function () { var act = Q.S.users.filter(function (u) { return u.status === 'Active'; }); return [['People reviewed', act.length + ' active accounts'], ['Roles', act.map(function (u) { return u.name + ': ' + u.roles.map(function (x) { return Q.ROLE_LABEL[x]; }).join(', '); }).join('; ')], ['Leavers and revoked', Q.S.users.filter(function (u) { return u.status !== 'Active'; }).map(function (u) { return u.name + ' (' + u.status + ')'; }).join(', ') || 'None']]; },
    onComplete: function (r, ag) { r.signedAt = ag.completedAt; r.agreement = ag.id; Q.closeTasks(function (t) { return t.record === 'ADMIN-AR'; }); Q.audit('state', 'Access review', r.id, 'Access review signed off (Adobe Sign agreement ' + ag.id + ')', null, null, { actor: 'system' }); },
    onReturn: function (r, ag, back) { Q.audit('state', 'Access review', r.id, 'Access review sign-off returned: ' + back.why); }
  };
  ST.rule = {
    kind: 'admin', label: 'Automation rule', purpose: function () { return 'Automation rule approval'; }, approvers: function () { return 0; },
    target: function (rid) { var r = Q.S.rules.find(function (x) { return x.id === rid; }); return { title: r ? r.name : rid, href: '#/admin/automations?rule=' + rid, obj: r }; },
    subject: function (r) { return r.id + ' v' + r.version + ' · ' + r.name + ' · Approval'; },
    version: function (r) { return String(r.version); },
    plan: function (r, ap, p, ref, sender) { p.signers.push(S(sender, 'Quality Manager', 'Approved', 1)); },
    cantSend: function (r) {
      if (r.status !== 'Pending approval') return 'This rule isn’t waiting for approval.';
      if (!Q.hasRole('qm')) return 'Only a Quality Manager can approve automation rules.';
      return null;
    },
    lines: function (r) { return [['Rule', r.id + ' v' + r.version + ' · ' + r.name], ['When', r.event], ['If', r.conditions], ['Then', r.actions.join('; ')], ['Channels', r.channels.join(', ')], ['Change', r.pendingOff ? 'Switch off' : 'Switch on']]; },
    onComplete: function (r, ag) { r.status = r.pendingOff ? 'Off' : 'Active'; r.pendingOff = false; r.approvedBy = ag.signers[0].u; r.approvedAt = ag.completedAt; r.agreement = ag.id; Q.audit('state', 'Automation rule', r.id, r.id + ' v' + r.version + ' approved through Adobe Sign: ' + r.status, null, null, { actor: 'system' }); },
    onReturn: function (r, ag, back) { Q.audit('state', 'Automation rule', r.id, r.id + ' approval returned: ' + back.why); }
  };
  ST.workflow = {
    kind: 'admin', label: 'Workflow', purpose: function () { return 'Workflow approval'; }, approvers: function () { return 0; },
    target: function (rid) { var w = Q.S.workflows.find(function (x) { return x.id === rid; }); return { title: w ? w.name : rid, href: '#/admin/workflows', obj: w }; },
    subject: function (r) { return r.id + ' v' + r.version + ' · ' + r.name + ' · Approval'; },
    version: function (r) { return String(r.version); },
    plan: function (r, ap, p, ref, sender) { p.signers.push(S(sender, 'Quality Manager', 'Approved', 1)); },
    cantSend: function (r) {
      if (r.status !== 'Pending approval') return 'This workflow isn’t waiting for approval.';
      if (!Q.hasRole('qm')) return 'Only a Quality Manager can approve workflows.';
      return null;
    },
    lines: function (r) { return [['Workflow', r.id + ' v' + r.version + ' · ' + r.name], ['Module', r.module], ['States', r.states.join(' → ')], ['Transitions', r.transitions.map(function (t) { return t.from + ' → ' + t.to; }).join('; ') || 'Draft definition']]; },
    onComplete: function (r, ag) { r.status = 'Active'; r.approvedBy = ag.signers[0].u; r.agreement = ag.id; Q.audit('state', 'Workflow', r.id, 'Workflow ' + r.id + ' v' + r.version + ' approved through Adobe Sign; new records use it, running ones keep their version', null, null, { actor: 'system' }); },
    onReturn: function (r, ag, back) { Q.audit('state', 'Workflow', r.id, r.id + ' approval returned: ' + back.why); }
  };

  // The stage a record uses by default, from its kind and state.
  es.defaultStage = function (rid) {
    var k = Q.kindOf(rid), r = Q.rec(rid);
    if (k === 'doc') return 'doc-approval';
    if (k === 'cr') return r.state === 'Effectiveness check' ? 'cr-completion' : 'cr-plan';
    if (k === 'capa') return r.state === 'Planning' ? 'capa-plan' : r.state === 'Execution' ? 'capa-actions' : 'capa-closure';
    if (k === 'qe') return 'qe-closure';
    if (k === 'review') return 'review';
    return null;
  };
  // What a stage signs off: the record itself, or a configuration item for the admin stages.
  es.target = function (rid, stage) {
    var st = ST[stage];
    if (st && st.kind === 'admin') return st.target(rid);
    var r = Q.rec(rid);
    return { title: Q.recTitle(rid), href: Q.recHref(rid), obj: r };
  };
  es.kindLabel = function (ag) { var st = ST[ag.stage]; return st && st.kind === 'admin' ? st.label : Q.KIND_LABEL[st ? st.kind : Q.kindOf(ag.record)] || 'Record'; };
  es.href = function (ag) { return es.target(ag.record, ag.stage).href; };
  es.canSee = function (ag) { var st = ST[ag.stage]; if (st && st.kind === 'admin') return true; var r = Q.rec(ag.record); return !!r && Q.canSee(r.doc && Q.kindOf(ag.record) === 'review' ? Q.S.docs[r.doc] : r); };
  es.labels = function (rid, stage) { var st = ST[stage], r = es.target(rid, stage).obj; return st.labels ? st.labels(r) : signOffLabels(rid); };
  es.lines = function (rid, stage, ref) { var st = ST[stage], r = es.target(rid, stage).obj; return st.lines ? st.lines(r, ref) : []; };

  // ---------- Plan: who signs, in what order, and what is wrong with it ----------
  // opts: { stage, ref, approvers (user ids, where the stage lets the sender choose) }
  es.plan = function (rid, opts) {
    opts = opts || {};
    var stage = opts.stage || es.defaultStage(rid), st = ST[stage];
    var p = { record: rid, stage: stage, ref: opts.ref || null, problems: [], signers: [] };
    if (!st) { p.problems.push('This record doesn’t go to Adobe Sign.'); return p; }
    var r = es.target(rid, stage).obj;
    if (!r) { p.problems.push('Not found.'); return p; }
    p.kind = st.kind; p.purpose = st.purpose(r); p.title = es.target(rid, stage).title;
    p.subject = st.subject(r, p.ref);
    p.version = st.version ? st.version(r) : null;
    var nApprovers = st.approvers(r);
    var approvers = nApprovers ? (opts.approvers || (st.defaultApprovers ? st.defaultApprovers(r) : [])).filter(Boolean).slice(0, nApprovers) : [];
    p.approvers = approvers;
    st.plan(r, approvers, p, p.ref, opts.sender || me());
    p.pdf = st.pdf ? st.pdf(r, p.ref) : { name: (rid + (p.ref ? '_' + p.ref : '') + '_' + stage + '.pdf'), hash: Q.sha256(Q.canon({ record: rid, stage: stage, ref: p.ref, lines: es.lines(rid, stage, p.ref) })) };
    p.signers.forEach(function (s) { if (Q.user(s.u).status !== 'Active') p.problems.push(Q.fullName(s.u) + ' (' + s.role.toLowerCase() + ') is no longer active.'); });
    p.problems = p.problems.filter(function (x, i, a) { return a.indexOf(x) === i; });
    return p;
  };
  es.isSod = function (text) { return /segregation of duties|can’t approve|can’t also/.test(text); };

  // Can the current user send now? Returns a reason string when not.
  es.cantSend = function (rid, stage, ref) {
    stage = stage || es.defaultStage(rid);
    var st = ST[stage], u = Q.me();
    if (!st) return 'This record doesn’t go to Adobe Sign.';
    var r = es.target(rid, stage).obj;
    if (!r) return 'Not found.';
    if (Q.readOnly()) return 'Your role is read-only.';
    if (!Q.integrationOn('adobesign')) return 'The Adobe Sign connector is switched off. A System Administrator can switch it on in Administration → Integrations.';
    if (es.active(rid, stage, st.usesRef ? ref : undefined)) return 'An agreement for this is already out for signature.';
    if (es.remaining() <= 0) return 'This year’s allowance of ' + es.cfg().allowance + ' Adobe Sign transactions is used up. Talk to the Quality Manager before sending more.';
    return st.cantSend(r, u, ref) || null;
  };

  // ---------- Send (one agreement = one transaction) ----------
  es.send = function (rid, o) {
    o = o || {};
    var stage = o.stage || es.defaultStage(rid), st = ST[stage];
    var block = es.cantSend(rid, stage, o.ref); if (block) throw new Error(block);
    var ver = o.verification || {};
    if (!(ver.footer && ver.version && ver.docId && ver.dates)) throw new Error('Complete the verification check first.');
    var p = es.plan(rid, { stage: stage, ref: o.ref, approvers: o.approvers });
    if (p.problems.length) throw new Error(p.problems[0]);
    var r = es.target(rid, stage).obj, label = es.kindLabel({ stage: stage, record: rid });
    var last = es.forRecord(rid, stage, st.usesRef ? o.ref : undefined)[0], prev = last && (last.status === 'cancelled' || last.status === 'declined') ? last : null;
    var ag = {
      id: guid(), stage: stage, record: rid, ref: p.ref, kind: st.kind, version: p.version, subject: p.subject, purpose: p.purpose,
      status: 'sent', sentBy: me(), sentAt: now(), completedAt: null,
      signers: p.signers.map(function (s) { return { u: s.u, role: s.role, meaning: s.meaning, order: s.order, status: 'Waiting' }; }),
      pdf: p.pdf, signedPdf: null, auditReport: null,
      verification: { footer: true, version: true, docId: true, dates: true, by: me(), at: now(), note: ver.note || '' },
      events: [], correctionOf: prev ? prev.id : null
    };
    Q.S.agreements.push(ag);
    ag.events.push({ at: ag.sentAt, type: 'sent', u: me(), detail: 'Agreement sent to ' + Q.plural(ag.signers.length, 'signer') + (prev ? ' (correction of ' + prev.id.slice(0, 8) + '…)' : '') });
    var n = es.txNo(ag);
    Q.audit('esign.verify', label, rid, 'Verification check passed for ' + ag.subject.split(' · ').slice(0, 2).join(' · ') + ': footer, version, ID and dates', null, { footer: true, version: true, docId: true, dates: true, note: ver.note || '' });
    Q.audit('esign.send', label, rid, 'Sent Adobe Sign agreement ' + ag.id + ' (' + ag.purpose.toLowerCase() + '; transaction ' + n + ' of ' + es.cfg().allowance + ' this year' + (prev ? '; correction after a ' + prev.status + ' agreement' : '') + ')', null, { agreement: ag.id, stage: stage, subject: ag.subject, signers: ag.signers.map(function (s) { return Q.fullName(s.u) + ' · ' + s.meaning; }), transactionsUsed: es.used(), transactionsRemaining: es.remaining() });
    if (st.onSent) st.onSent(r, ag, o);
    advance(ag);
    if (es.remaining() <= (es.cfg().warnAt || 50)) {
      var qms = Q.activeUsers().filter(function (u) { return u.roles.indexOf('qm') >= 0; }).map(function (u) { return u.id; });
      Q.notify({ to: qms, kind: 'warn', channels: ['in-app', 'email'], title: 'Adobe Sign allowance running low: ' + es.remaining() + ' transactions left this year', body: 'Used ' + es.used() + ' of ' + es.cfg().allowance + '.', href: '#/approvals' });
    }
    Q.save();
    return ag;
  };

  // Deliver to the next signing step once everyone in the current step has signed.
  function advance(ag) {
    var cur = es.current(ag);
    if (cur === null) { complete(ag); return; }
    var next = ag.signers.filter(function (s) { return s.order === cur && s.status === 'Waiting'; });
    if (!next.length) return;
    var st = ST[ag.stage], r = es.target(ag.record, ag.stage).obj;
    next.forEach(function (s) {
      s.status = 'Sent'; s.sentAt = now();
      ag.events.push({ at: now(), type: 'delivered', u: s.u, detail: 'Adobe Sign emailed the signing link' });
      if (st.onTurn) st.onTurn(r, ag, s);
      Q.closeTasks(function (t) { return t.record === ag.record && t.assignee === s.u && t.kind === 'fyi'; });
      Q.wf.assign({ kind: 'esign-sign', record: ag.record, assignee: s.u, due: ag.kind === 'doc' && r.approvalDue ? r.approvalDue : due(5), ref: ag.id, quiet: true, note: s.role + ' · meaning: ' + s.meaning, title: 'Sign ' + ag.subject.split(' · ')[0] + ' · ' + ag.purpose.toLowerCase() });
    });
    Q.fire('stage.reached', { record: ag.record, to: next.map(function (s) { return s.u; }), what: 'sign in Adobe Sign', body: ag.subject + '. Adobe Sign has emailed you the signing link.' });
  }

  // Signer completes in Adobe Sign. The app learns of it from a webhook and reads the agreement back from the API.
  es.sign = function (ag) {
    var s = ag.signers.find(function (x) { return x.u === me() && x.status === 'Sent'; });
    if (!s || ag.status !== 'sent') throw new Error('It isn’t your turn to sign this agreement.');
    s.status = 'Signed'; s.at = now();
    ag.events.push({ at: s.at, type: 'signed', u: s.u, detail: 'Identity confirmed; reason for signing: ' + s.meaning });
    var st = ST[ag.stage], r = es.target(ag.record, ag.stage).obj;
    Q.audit('esign.signed', es.kindLabel(ag), ag.record, 'Adobe Sign webhook: ' + Q.fullName(s.u) + ' signed ' + ag.subject.split(' · ')[0] + ' · ' + s.meaning + ' (identity confirmed, reason for signing recorded)', null, { agreement: ag.id, signer: Q.fullName(s.u), meaning: s.meaning, at: s.at }, { actor: 'system' });
    Q.closeTasks(function (t) { return t.assignee === s.u && t.kind === 'esign-sign' && (t.ref === ag.id || (!t.ref && t.record === ag.record)); });
    if (st.onSigned) st.onSigned(r, ag, s);
    Q.fire('signature.completed', { record: ag.record, owner: (r || {}).owner, meaning: s.meaning + ' (Adobe Sign)' });
    advance(ag);
    Q.save();
  };

  function complete(ag) {
    var st = ST[ag.stage], r = es.target(ag.record, ag.stage).obj;
    ag.status = 'completed'; ag.completedAt = now();
    ag.signedPdf = { name: ag.pdf.name.replace(/\.pdf$/, '_signed.pdf'), hash: Q.sha256('signed:' + ag.id + ag.pdf.hash) };
    ag.auditReport = { name: 'Audit_report_' + ag.id.slice(0, 8) + '.pdf', hash: Q.sha256('audit-report:' + ag.id + ag.completedAt) };
    ag.events.push({ at: ag.completedAt, type: 'completed', detail: 'Agreement completed. Signed PDF and audit report downloaded and stored.' });
    var rows = ag.signers.map(function (s) {
      var sig = { id: 'AS-' + (++Q.S.counters.AS), record: ag.record, version: ag.version, user: s.u, meaning: s.meaning, at: s.at, hash: ag.pdf.hash, source: 'Adobe Sign', agreement: ag.id, stage: ag.stage,
        statement: 'Signed in Adobe Sign: identity confirmed at signing and reason for signing “' + s.meaning + '” recorded.' };
      Q.S.signatures.push(sig);
      return sig;
    });
    Q.audit('esign.completed', es.kindLabel(ag), ag.record, 'Agreement ' + ag.id + ' completed; signed PDF, audit report and agreement ID stored against ' + (ag.version ? ag.record + ' v' + ag.version : ag.record), null, { agreement: ag.id, signedPdf: ag.signedPdf.name, signedPdfSha256: ag.signedPdf.hash, auditReport: ag.auditReport.name }, { actor: 'system' });
    var n = st.onComplete ? st.onComplete(r, ag, rows) || 0 : 0;
    var owner = r && (r.owner || r.reviewer);
    Q.notify({ to: [ag.sentBy, owner].filter(function (x, i, a) { return x && a.indexOf(x) === i; }), kind: 'info', channels: ['in-app', 'email'], record: Q.kindOf(ag.record) ? ag.record : null, title: 'Adobe Sign agreement completed: ' + ag.subject.split(' · ')[0], body: ag.purpose + '. Signed PDF and audit report are stored against the record.' });
    Q.fire('esign.completed', { record: ag.record, agreement: ag.id, training: n });
  }

  // Declined in Adobe Sign, or cancelled from the app: the record goes back with the reason recorded.
  function giveBack(ag, how, reason, by) {
    var st = ST[ag.stage], r = es.target(ag.record, ag.stage).obj;
    Q.closeTasks(function (t) { return (t.kind === 'esign-sign' && (t.ref === ag.id || (!t.ref && t.record === ag.record))) || (t.kind === 'fyi' && t.record === ag.record); });
    var why = 'Agreement ' + how + ' by ' + Q.fullName(by) + '. Reason: ' + reason;
    if (st.onReturn) st.onReturn(r, ag, { how: how, reason: reason, by: by, at: now(), agreement: ag.id, why: why });
  }
  es.decline = function (ag, reason) {
    var s = ag.signers.find(function (x) { return x.u === me() && x.status === 'Sent'; });
    if (!s || ag.status !== 'sent') throw new Error('It isn’t your turn on this agreement.');
    s.status = 'Declined'; s.at = now();
    ag.status = 'declined'; ag.declinedAt = now(); ag.declinedBy = me(); ag.declineReason = reason;
    ag.events.push({ at: ag.declinedAt, type: 'declined', u: me(), detail: reason });
    Q.audit('esign.declined', es.kindLabel(ag), ag.record, 'Adobe Sign webhook: ' + Q.fullName(me()) + ' declined to sign ' + ag.subject.split(' · ')[0] + '. Reason: ' + reason, { status: 'sent' }, { status: 'declined', reason: reason }, { actor: 'system' });
    giveBack(ag, 'declined', reason, me());
    Q.save();
  };
  es.canCancel = function (ag) {
    if (!ag || ag.status !== 'sent' || Q.readOnly()) return false;
    var r = es.target(ag.record, ag.stage).obj;
    return ag.sentBy === me() || (r && r.owner === me()) || Q.hasRole('qm');
  };
  es.cancel = function (ag, reason) {
    if (!es.canCancel(ag)) throw new Error('You can’t cancel this agreement.');
    ag.status = 'cancelled'; ag.cancelledAt = now(); ag.cancelledBy = me(); ag.cancelReason = reason;
    ag.signers.forEach(function (s) { if (s.status !== 'Signed') s.status = 'Cancelled'; });
    ag.events.push({ at: ag.cancelledAt, type: 'cancelled', u: me(), detail: reason });
    Q.audit('esign.cancel', es.kindLabel(ag), ag.record, 'Cancelled Adobe Sign agreement ' + ag.id + '. Reason: ' + reason + '. A corrected agreement is a new transaction.', { status: 'sent' }, { status: 'cancelled', reason: reason });
    giveBack(ag, 'cancelled', reason, me());
    Q.save();
  };
  // Manual status check (polling fallback for a missed webhook).
  es.checkStatus = function (ag) {
    ag.events.push({ at: now(), type: 'status', u: me(), detail: 'Status read from the Adobe Sign API: ' + es.STATUS[ag.status].toLowerCase() + ', no change' });
    Q.audit('esign.poll', es.kindLabel(ag), ag.record, 'Read agreement ' + ag.id + ' status from the Adobe Sign API: ' + es.STATUS[ag.status]);
    Q.save();
  };
})(window.Q);
