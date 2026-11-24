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
        if ((r = active('RULE-09'))) {
          var n = Q.allocateDoc(ctx.record, 'New version effective');
          ran(r, ctx, 'Done', n ? 'Allocated the new version to ' + Q.plural(n, 'person', 'people') + '; earlier records kept as superseded' : Q.hasAudience(Q.S.docs[ctx.record]) ? 'Everyone in the audience already has a record for this version' : 'No training audience on this document');
        }
        if ((r = rule('RULE-14'))) {
          if (r.status === 'Active' && Q.integrationOn('sp-pub')) ran(r, ctx, 'Sent', 'Published read-only PDF to SharePoint; archived superseded version');
          else if (r.status === 'Active') {
            Q.S.deadLetter.unshift({ id: Q.uid('DLQ'), rule: r.id, at: now(), record: ctx.record, channel: 'SharePoint', target: 'QMS publication library', attempts: 6, error: 'SharePoint publishing connector is off.', status: 'Failed' });
            ran(r, ctx, 'Failed', 'Connector off; moved to dead-letter queue');
          }
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
  var D = wf.doc = {};
  function participants(d) { return [d.author].concat(d.reviewers.map(function (r) { return r.u; }), d.approvers.map(function (a) { return a.u; })).filter(function (x, i, a) { return x && a.indexOf(x) === i; }); }
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
    var v = { v: '0.1', kind: 'minor', state: 'Draft', summary: 'First draft.', created: now(), createdBy: me(), content: content, approvedAt: null, signatures: [] };
    v.hash = Q.sha256(Q.canon(content));
    var d = {
      id: id, docType: o.docType, title: o.title, state: 'Draft', classification: o.classification, owner: o.owner || me(), author: me(),
      process: o.process, template: o.template || null, tags: o.tags || [], created: now(), modified: now(), effective: null,
      route: 'sequential', reviewRoute: 'parallel', audience: o.audience || { groups: [], roles: [], users: [], days: 14, quiz: false, retrainMonths: null }, sourceFile: o.sourceFile || null,
      periodic: { months: +o.months || 12, notice: 60, approval: true }, reviewDue: o.reviewDue, approvalDue: o.approvalDue,
      reviewers: (o.reviewers || []).map(function (u) { return { u: u, status: 'Not started' }; }),
      approvers: (o.approvers || []).map(function (u) { return { u: u, status: 'Waiting' }; }),
      versions: [v], comments: [], checkedOut: { u: me(), at: now() }
    };
    Q.S.docs[id] = d;
    Q.audit('create', 'Document', id, 'Created ' + id + (o.template ? ' from template ' + o.template : o.sourceFile ? ' from upload ' + o.sourceFile : ' from a blank page'), null, { title: o.title, classification: o.classification });
    assign({ kind: 'author', record: id, assignee: me(), due: o.reviewDue || due(7) });
    Q.save();
    return d;
  };
  D.checkOut = function (d) { d.checkedOut = { u: me(), at: now() }; Q.audit('checkout', 'Document', d.id, 'Checked out ' + d.id + ' v' + Q.curVer(d).v); Q.save(); };
  D.checkIn = function (d, content, summary) {
    var v = Q.curVer(d);
    var before = v.hash;
    v.content = content; v.summary = summary; v.hash = Q.sha256(Q.canon(content));
    var parts = v.v.split('.'); if (v.state === 'Draft') v.v = parts[0] + '.' + (+parts[1] + 1);
    d.checkedOut = null; d.modified = now();
    Q.audit('checkin', 'Document', d.id, 'Checked in ' + d.id + ' v' + v.v + ': ' + summary, { hash: before }, { hash: v.hash });
    Q.save();
  };
  D.cancelCheckout = function (d) { d.checkedOut = null; Q.audit('checkin', 'Document', d.id, 'Cancelled check-out of ' + d.id); Q.save(); };
  D.newVersion = function (d, kind, summary) {
    var cur = Q.curVer(d), parts = cur.v.split('.');
    var nv = kind === 'major' ? (+parts[0] + 1) + '.0' : parts[0] + '.' + (+parts[1] + 1);
    var v = { v: nv, kind: kind, state: 'Draft', summary: summary || '', created: now(), createdBy: me(), content: Q.clone(cur.content), approvedAt: null, signatures: [] };
    v.hash = Q.sha256(Q.canon(v.content));
    d.versions.push(v); d.state = 'Draft'; d.author = me(); d.checkedOut = { u: me(), at: now() };
    d.reviewers.forEach(function (r) { r.status = 'Not started'; delete r.at; });
    d.approvers.forEach(function (a) { a.status = 'Waiting'; delete a.at; });
    d.comments = [];
    Q.audit('version', 'Document', d.id, 'Started ' + kind + ' version v' + nv + ' of ' + d.id);
    assign({ kind: 'author', record: d.id, assignee: me(), due: due(7) });
    Q.save();
    return v;
  };
  D.submitForReview = function (d) {
    d.checkedOut = null;
    d.approvers.forEach(function (a) { a.status = 'Waiting'; delete a.at; });
    Q.closeTasks(function (t) { return t.record === d.id && (t.kind === 'author' || t.kind === 'resubmit'); });
    var later = d.approvers.map(function (a) { return a.u; });
    if (!d.reviewers.length) { // no reviewers: straight to the verification check and Adobe Sign send
      D.setState(d, 'Review closed', 'Submitted v' + Q.curVer(d).v + ' (no reviewers assigned)');
      D.readyToSend(d);
      Q.save(); return;
    }
    d.reviewers.forEach(function (r) { r.status = 'Pending'; delete r.at; });
    d.reviewDue = d.reviewDue && Q.daysFromToday(d.reviewDue) >= 0 ? d.reviewDue : due(5);
    D.setState(d, 'In review', 'Submitted v' + Q.curVer(d).v + ' for review');
    d.reviewers.forEach(function (r) { assign({ kind: 'review-doc', record: d.id, assignee: r.u, due: d.reviewDue }); });
    later.forEach(function (u) { Q.addTask({ kind: 'fyi', record: d.id, assignee: u, due: due(9), fyi: true, note: 'You sign in Adobe Sign after review' }); });
    Q.fire('workflow.entered', { record: d.id, to: later, what: 'sign in Adobe Sign', body: 'Expected around ' + Q.fmtDay(due(9)) + ', after review.' });
    Q.save();
  };
  D.review = function (d, comment) {
    var r = d.reviewers.find(function (x) { return x.u === me(); });
    if (!r) return;
    r.status = 'Reviewed'; r.at = now();
    if (comment) d.comments.push({ id: Q.uid('c'), u: me(), at: now(), block: null, text: comment, resolved: false });
    Q.audit('review', 'Document', d.id, 'Marked reviewed' + (comment ? ' with a comment' : ''));
    Q.closeTasks(function (t) { return t.record === d.id && t.kind === 'review-doc' && t.assignee === me(); });
    if (d.reviewers.every(function (x) { return x.status === 'Reviewed'; })) {
      D.setState(d, 'Review closed', 'Review closed: all ' + d.reviewers.length + ' reviewers done');
      D.readyToSend(d);
    }
    Q.save();
  };
  // Review closed: the owner checks the PDF and sends one Adobe Sign agreement (see esign.js).
  D.readyToSend = function (d) {
    var who = Q.user(d.owner).status === 'Active' ? d.owner : d.author;
    assign({ kind: 'send-approval', record: d.id, assignee: who, due: due(2), stage: 'doc-approval', note: 'Verify the PDF, then send one Adobe Sign agreement' });
  };
  D.sendBack = function (d, reason) {
    var before = d.state;
    var told = participants(d).filter(function (u) { return u !== me(); });
    d.reviewers.forEach(function (r) { r.status = 'Not started'; delete r.at; });
    d.approvers.forEach(function (a) { a.status = 'Waiting'; delete a.at; });
    D.setState(d, 'Draft', 'Sent back to draft from ' + before + '. Reason: ' + reason);
    Q.closeTasks(function (t) { return t.record === d.id && ['review-doc', 'send-approval', 'esign-sign', 'fyi'].indexOf(t.kind) >= 0; });
    assign({ kind: 'resubmit', record: d.id, assignee: d.author, due: due(5), note: 'Reason: ' + reason });
    Q.fire('sent.back', { record: d.id, to: told, reason: reason });
    Q.save();
  };
  D.makeEffective = function (d) {
    var v = Q.curVer(d);
    d.versions.forEach(function (x) { if (x !== v && x.state === 'Effective') { x.state = 'Superseded'; } });
    d.effective = now();
    D.setState(d, 'Effective', d.id + ' v' + v.v + ' is Effective' + (d.versions.length > 1 ? '; previous version Superseded' : ''));
    Q.closeTasks(function (t) { return t.record === d.id && (t.kind === 'fyi' || t.kind === 'esign-sign' || t.kind === 'send-approval'); });
    // Schedule the next periodic review
    if (d.periodic) {
      var nextDue = Q.iso(Q.addDays(new Date(), Math.round(d.periodic.months * 30.4)));
      var id = Q.nextId('PR');
      Q.S.reviews[id] = { id: id, doc: d.id, reviewer: d.owner, due: nextDue, notice: d.periodic.notice, approval: d.periodic.approval, created: now(), state: 'Open' };
    }
    Q.notify({ to: d.owner, kind: 'info', channels: ['in-app', 'email'], record: d.id, title: d.id + ' v' + v.v + ' is now Effective', body: d.title });
    Q.fire('doc.effective', { record: d.id });
  };
  // ag: the completed Adobe Sign agreement that approved it (the app always passes one; tests may call it directly).
  D.obsolete = function (d, reason, ag) {
    var v = Q.effVer(d) || Q.curVer(d);
    Q.S.assignments.filter(function (a) { return a.doc === d.id && !a.completed && !a.closed; }).forEach(function (a) { closeOpen(a, d.id + ' made obsolete'); });
    v.state = 'Obsolete'; d.obsoleteReason = reason; d.obsoleteAgreement = ag ? ag.id : null;
    D.setState(d, 'Obsolete', 'Made ' + d.id + ' obsolete (archived, not deleted)' + (ag ? ', approved through Adobe Sign agreement ' + ag.id : '') + '. Reason: ' + reason);
    Q.save();
  };
  D.comment = function (d, block, text) {
    d.comments.push({ id: Q.uid('c'), u: me(), at: now(), block: block, text: text, resolved: false });
    Q.audit('comment', 'Document', d.id, 'Commented on ' + d.id + (block != null ? ' (section ' + block + ')' : ''));
    Q.save();
  };
  D.resolve = function (d, cid) { var c = d.comments.find(function (x) { return x.id === cid; }); if (c) { c.resolved = true; Q.audit('comment', 'Document', d.id, 'Resolved a comment'); Q.save(); } };

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
  Q.trStatus = function (a) {
    if (a.correctionOf && a.noRetrain) return 'Correction';
    if (Q.trCorrections(a).length) return 'Corrected';
    var d = Q.S.docs[a.doc], eff = d && Q.effVer(d);
    if (!eff) return 'Obsolete';
    if (eff.v !== a.ver) return 'Superseded';
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
    var has = Q.S.assignments.some(function (a) { return a.user === uid && a.doc === d.id && a.ver === v.v && !a.closed && !a.noRetrain; });
    if (has) return null;
    var a = { id: Q.uid('TA'), user: uid, doc: d.id, title: d.title, ver: v.v, allocatedBy: o.by || 'system', allocReason: o.reason, assigned: now(), due: due(Q.audienceOf(d).days || 14), completed: null };
    Q.S.assignments.push(a);
    Q.audit('training.allocate', 'Training record', a.id, 'Allocated ' + d.id + ' v' + v.v + ' to ' + Q.fullName(uid) + ' (' + o.reason + ')', null, trSnap(a), o.by === 'system' || !o.by ? { actor: 'system' } : null);
    trTask(a);
    return a;
  }
  // New effective version: earlier open allocations close as superseded, then the full audience is assigned.
  Q.allocateDoc = function (docId, reason, by) {
    var d = Q.S.docs[docId], v = Q.effVer(d); if (!v) return 0;
    Q.S.assignments.filter(function (a) { return a.doc === docId && a.ver !== v.v && !a.completed && !a.closed; }).forEach(function (a) { closeOpen(a, 'Superseded by v' + v.v); });
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
  C.addAction = function (cr, a) {
    a.id = 'A-' + (++Q.S.counters.ACT); a.status = 'Not started';
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
    Q.audit('update', 'Change request', cr.id, 'Completed action "' + act.title + '"' + (sig ? ' (signed in Adobe Sign, agreement ' + sig.agreement + ')' : ''), null, null, sig ? { actor: 'system' } : null);
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
      a.id = 'CA-' + (++Q.S.counters.ACT); a.status = 'Not started'; c.actions.push(a);
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
      Q.audit('update', 'CAPA', c.id, 'Completed ' + a.type.toLowerCase() + ' action "' + a.title + '"' + (sig ? ' (signed in Adobe Sign, agreement ' + sig.agreement + ')' : ''), null, null, sig ? { actor: 'system' } : null);
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
        D.newVersion(d, 'minor', 'Periodic review: ' + reason);
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
