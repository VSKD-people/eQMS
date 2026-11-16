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
          var n = Q.assignTraining(ctx.record);
          ran(r, ctx, 'Done', n ? 'Assigned training to ' + Q.plural(n, 'person', 'people') : 'No training rule matches');
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
  Q.makeSignature = function (o) {
    var s = {
      id: 'SIG-' + (++Q.S.counters.SIG), record: o.record, version: o.version || null, user: me(), onBehalfOf: null,
      meaning: o.meaning, statement: Q.statementFor(o.meaning),
      at: now(), authAt: o.authAt, acrs: 'c1', hash: o.hash || Q.sha256(Q.canon(Q.rec(o.record) || o.record)), stage: o.stage || null
    };
    Q.S.signatures.push(s);
    Q.audit('sign', Q.KIND_LABEL[Q.kindOf(o.record)] || 'Record', o.record, 'Signed ' + o.record + (o.version ? ' v' + o.version : '') + ' · ' + o.meaning + (o.stage ? ' (' + o.stage + ')' : ''), null, { signature: s.id, hash: s.hash, auth_time: s.authAt });
    Q.fire('signature.completed', { record: o.record, owner: (Q.rec(o.record) || {}).owner, meaning: o.meaning });
    return s;
  };
  Q.statementFor = function (meaning) { return Q.S.settings.statement.replace('{meaning}', meaning); };
  Q.sigById = function (id) { return Q.S.signatures.find(function (s) { return s.id === id; }); };

  // Segregation of duties. Returns a reason string when the current user may not sign.
  Q.sodBlock = function (rec, kind) {
    var u = Q.me();
    if (Q.readOnly()) return 'Your role is read-only.';
    if (Q.S.settings.sod.adminCannotApprove && u.roles.indexOf('admin') >= 0 && u.roles.indexOf('approver') < 0 && u.roles.indexOf('qm') < 0) return 'System Administrators cannot approve quality records (segregation of duties).';
    if (kind === 'doc' && Q.S.settings.sod.authorCannotApprove && rec.author === u.id) return 'You authored this version, so you cannot approve it. An admin override is needed, and it is logged.';
    if (kind === 'cr' && rec.owner === u.id) return 'You own this change request, so you cannot approve its plan.';
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
      route: o.route || 'sequential', reviewRoute: 'parallel', trainingRule: o.trainingRule || null, sourceFile: o.sourceFile || null,
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
    if (!d.reviewers.length) { // no reviewers: go straight to approval
      D.setState(d, 'Review closed', 'Submitted v' + Q.curVer(d).v + ' (no reviewers assigned)');
      D.startApproval(d); return;
    }
    d.checkedOut = null;
    d.reviewers.forEach(function (r) { r.status = 'Pending'; delete r.at; });
    d.approvers.forEach(function (a) { a.status = 'Waiting'; delete a.at; });
    d.reviewDue = d.reviewDue && Q.daysFromToday(d.reviewDue) >= 0 ? d.reviewDue : due(5);
    D.setState(d, 'In review', 'Submitted v' + Q.curVer(d).v + ' for review');
    Q.closeTasks(function (t) { return t.record === d.id && (t.kind === 'author' || t.kind === 'resubmit'); });
    d.reviewers.forEach(function (r) { assign({ kind: 'review-doc', record: d.id, assignee: r.u, due: d.reviewDue }); });
    var later = d.approvers.map(function (a) { return a.u; });
    later.forEach(function (u) { Q.addTask({ kind: 'fyi', record: d.id, assignee: u, due: due(9), fyi: true }); });
    Q.fire('workflow.entered', { record: d.id, to: later, what: 'approve', body: 'Expected around ' + Q.fmtDay(due(9)) + ', after review.' });
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
      D.startApproval(d); // next in line is notified automatically, no manual step
    }
    Q.save();
  };
  D.startApproval = function (d) {
    d.approvalDue = due(5);
    D.setState(d, 'In approval', 'Sent v' + Q.curVer(d).v + ' for approval (' + d.route + ' route)');
    Q.closeTasks(function (t) { return t.record === d.id && t.kind === 'fyi'; });
    var first = d.route === 'sequential' ? d.approvers.slice(0, 1) : d.approvers;
    first.forEach(function (a) { a.status = 'Your turn'; assign({ kind: 'approve-doc', record: d.id, assignee: a.u, due: d.approvalDue, quiet: true, note: d.route === 'sequential' ? 'You are approver ' + (d.approvers.indexOf(a) + 1) + ' of ' + d.approvers.length + ' · sequential route' : 'Parallel route' }); });
    Q.fire('stage.reached', { record: d.id, to: first.map(function (a) { return a.u; }), what: 'approve', body: Q.recTitle(d.id) + ' v' + Q.curVer(d).v });
    var later = d.route === 'sequential' ? d.approvers.slice(1) : [];
    later.forEach(function (a) { Q.addTask({ kind: 'fyi', record: d.id, assignee: a.u, due: due(8), fyi: true, note: 'You approve after ' + Q.fullName(d.approvers[0].u) }); });
  };
  D.sendBack = function (d, reason) {
    var before = d.state;
    var told = participants(d).filter(function (u) { return u !== me(); });
    d.reviewers.forEach(function (r) { r.status = 'Not started'; delete r.at; });
    d.approvers.forEach(function (a) { a.status = 'Waiting'; delete a.at; });
    D.setState(d, 'Draft', 'Sent back to draft from ' + before + '. Reason: ' + reason);
    Q.closeTasks(function (t) { return t.record === d.id && ['review-doc', 'approve-doc', 'fyi'].indexOf(t.kind) >= 0; });
    assign({ kind: 'resubmit', record: d.id, assignee: d.author, due: due(5), note: 'Reason: ' + reason });
    Q.fire('sent.back', { record: d.id, to: told, reason: reason });
    Q.save();
  };
  D.approve = function (d, sig) {
    var a = d.approvers.find(function (x) { return x.u === me(); });
    if (!a) return;
    a.status = 'Signed'; a.at = now(); a.sig = sig.id;
    Q.curVer(d).signatures.push({ id: sig.id, user: me(), meaning: sig.meaning, at: sig.at, authAt: sig.authAt, hash: sig.hash, statement: sig.statement });
    Q.closeTasks(function (t) { return t.record === d.id && t.assignee === me() && (t.kind === 'approve-doc' || t.kind === 'fyi'); });
    var next = d.approvers.find(function (x) { return x.status === 'Waiting'; });
    if (d.route === 'sequential' && next) {
      next.status = 'Your turn';
      Q.closeTasks(function (t) { return t.record === d.id && t.assignee === next.u && t.kind === 'fyi'; });
      assign({ kind: 'approve-doc', record: d.id, assignee: next.u, due: d.approvalDue || due(3), quiet: true, note: 'You are approver ' + (d.approvers.indexOf(next) + 1) + ' of ' + d.approvers.length + ' · sequential route' });
      Q.fire('stage.reached', { record: d.id, to: [next.u], what: 'approve', body: Q.fullName(me()) + ' signed. You are next.' });
      Q.audit('state', 'Document', d.id, 'Approval ' + d.approvers.filter(function (x) { return x.status === 'Signed'; }).length + ' of ' + d.approvers.length + ' signed; next: ' + Q.fullName(next.u));
    } else if (d.approvers.every(function (x) { return x.status === 'Signed'; })) {
      var v = Q.curVer(d); v.approvedAt = now();
      var rule = Q.S.trainingRules.find(function (r) { return r.id === d.trainingRule && r.status === 'Active'; });
      if (rule && rule.gate) {
        D.setState(d, 'Pending training', 'All approvals signed; waiting for training under ' + rule.id + ' ' + rule.name);
        var n = Q.assignTraining(d.id);
        Q.audit('automation', 'Document', d.id, 'RULE-09 assigned training to ' + Q.plural(n, 'person', 'people'), null, null, { actor: 'system' });
        if (!n) D.makeEffective(d);
      } else {
        D.makeEffective(d);
      }
    }
    Q.save();
  };
  D.makeEffective = function (d) {
    var v = Q.curVer(d);
    d.versions.forEach(function (x) { if (x !== v && x.state === 'Effective') { x.state = 'Superseded'; } });
    d.effective = now();
    D.setState(d, 'Effective', d.id + ' v' + v.v + ' is Effective' + (d.versions.length > 1 ? '; previous version Superseded' : ''));
    Q.closeTasks(function (t) { return t.record === d.id && (t.kind === 'fyi' || t.kind === 'approve-doc'); });
    // Schedule the next periodic review
    if (d.periodic) {
      var nextDue = Q.iso(Q.addDays(new Date(), Math.round(d.periodic.months * 30.4)));
      var id = Q.nextId('PR');
      Q.S.reviews[id] = { id: id, doc: d.id, reviewer: d.owner, due: nextDue, notice: d.periodic.notice, approval: d.periodic.approval, created: now(), state: 'Open' };
    }
    Q.notify({ to: d.owner, kind: 'info', channels: ['in-app', 'email'], record: d.id, title: d.id + ' v' + v.v + ' is now Effective', body: d.title });
    Q.fire('doc.effective', { record: d.id });
  };
  D.obsolete = function (d, reason) {
    var v = Q.effVer(d) || Q.curVer(d); v.state = 'Obsolete'; d.obsoleteReason = reason;
    D.setState(d, 'Obsolete', 'Made ' + d.id + ' obsolete (archived, not deleted). Reason: ' + reason);
    Q.save();
  };
  D.comment = function (d, block, text) {
    d.comments.push({ id: Q.uid('c'), u: me(), at: now(), block: block, text: text, resolved: false });
    Q.audit('comment', 'Document', d.id, 'Commented on ' + d.id + (block != null ? ' (section ' + block + ')' : ''));
    Q.save();
  };
  D.resolve = function (d, cid) { var c = d.comments.find(function (x) { return x.id === cid; }); if (c) { c.resolved = true; Q.audit('comment', 'Document', d.id, 'Resolved a comment'); Q.save(); } };

  // ---------- Training ----------
  Q.ruleMembers = function (rule) {
    var ids = [];
    rule.groups.forEach(function (g) { Q.usersInGroup(g).forEach(function (u) { if (ids.indexOf(u.id) < 0) ids.push(u.id); }); });
    (rule.users || []).forEach(function (u) { if (ids.indexOf(u) < 0 && Q.user(u).status === 'Active') ids.push(u); });
    return ids;
  };
  Q.assignTraining = function (docId, onlyRule) {
    var d = Q.S.docs[docId]; var v = Q.curVer(d); var count = 0;
    Q.S.trainingRules.filter(function (r) { return r.status === 'Active' && r.docs.indexOf(docId) >= 0 && (!onlyRule || r.id === onlyRule); }).forEach(function (rule) {
      Q.ruleMembers(rule).forEach(function (uid) {
        var exists = Q.S.assignments.find(function (a) { return a.user === uid && a.doc === docId && a.ver === v.v && !a.leaver; });
        if (exists) return;
        var a = { id: Q.uid('TA'), user: uid, doc: docId, ver: v.v, rule: rule.id, assigned: now(), due: due(rule.days), completed: null };
        Q.S.assignments.push(a); count++;
        var t = Q.addTask({ kind: 'training', record: docId, assignee: uid, due: a.due, ref: docId });
        Q.notify({ to: uid, kind: 'action', channels: ['in-app', 'email', 'push'], record: docId, rule: 'RULE-09', title: 'New training: ' + docId + ' ' + d.title + ' v' + v.v, body: 'Rule: ' + rule.name + ' · ' + Q.relDue(a.due).text });
        void t;
      });
    });
    return count;
  };
  Q.completeTraining = function (a, info) {
    a.completed = now(); a.quiz = info.quiz || null; a.sig = info.sig || null;
    Q.closeTasks(function (t) { return t.kind === 'training' && t.record === a.doc && t.assignee === a.user; });
    Q.audit('training', 'Training record', a.doc, Q.fullName(a.user) + ' completed training on ' + a.doc + ' v' + a.ver + (info.quiz ? ' (quiz ' + info.quiz + ')' : ''), null, { record: a.id });
    var d = Q.S.docs[a.doc];
    if (d.state === 'Pending training') {
      var gating = Q.S.assignments.filter(function (x) { return x.doc === a.doc && x.ver === Q.curVer(d).v && !x.leaver; });
      if (gating.every(function (x) { return x.completed; })) {
        Q.notify({ to: d.owner, kind: 'info', channels: ['in-app', 'email'], record: d.id, title: 'Training complete for ' + d.id, body: 'All trainees are done. The document is now Effective.' });
        wf.doc.makeEffective(d);
      }
    }
    Q.save();
  };
  wf.rule = {
    create: function (o) {
      var id = Q.nextId('TR');
      var r = { id: id, name: o.name, desc: o.desc, groups: o.groups, users: [], docs: o.docs, days: +o.days, retrainMonths: o.retrain ? +o.retrain : null, gate: !!o.gate, quiz: !!o.quiz, version: 1, status: 'Pending approval', approvedBy: null, createdBy: me(), createdAt: now() };
      Q.S.trainingRules.push(r);
      Q.audit('create', 'Training rule', id, 'Created training rule ' + id + ' ' + o.name + ' (needs approval before it is active)');
      var qms = Q.S.users.filter(function (u) { return u.roles.indexOf('qm') >= 0 && u.id !== me(); });
      (qms.length ? qms : [Q.me()]).forEach(function (u) { assign({ kind: 'rule-approve', record: id, assignee: u.id, due: due(5) }); });
      Q.save(); return r;
    },
    approve: function (r) {
      r.status = 'Active'; r.approvedBy = me(); r.approvedAt = now();
      Q.audit('state', 'Training rule', r.id, r.id + ' v' + r.version + ' approved and active');
      Q.closeTasks(function (t) { return t.record === r.id && t.kind === 'rule-approve'; });
      var n = 0; r.docs.forEach(function (d) { if (Q.S.docs[d] && Q.S.docs[d].state === 'Effective') n += Q.assignTraining(d, r.id); });
      Q.save(); return n;
    }
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
  C.toApproval = function (cr) {
    C.setState(cr, 'Approval', 'Review complete; plan sent for approval');
    cr.approvers.forEach(function (a) { a.status = 'Your turn'; assign({ kind: 'cr-approve', record: cr.id, assignee: a.u, due: due(3), quiet: true }); });
    Q.fire('stage.reached', { record: cr.id, to: cr.approvers.map(function (a) { return a.u; }), what: 'approve the plan for' });
  };
  C.approvePlan = function (cr, sig) {
    var a = cr.approvers.find(function (x) { return x.u === me(); }); if (a) { a.status = 'Signed'; a.at = now(); }
    cr.signatures.push({ id: sig.id, stage: 'Plan approved', user: me(), meaning: sig.meaning, at: sig.at });
    Q.closeTasks(function (t) { return t.record === cr.id && t.kind === 'cr-approve' && t.assignee === me(); });
    if (cr.approvers.every(function (x) { return x.status === 'Signed'; })) {
      C.setState(cr, 'In execution', 'Plan approved with e-signature; actions assigned');
      cr.actions.filter(function (x) { return x.status !== 'Done'; }).forEach(function (x) { assign({ kind: 'cr-action', record: cr.id, assignee: x.assignee, due: x.due, ref: x.id }); });
    }
    Q.save();
  };
  C.completeAction = function (cr, act, sig) {
    act.status = 'Done'; act.doneAt = now(); if (sig) act.signedBy = me();
    Q.audit('update', 'Change request', cr.id, 'Completed action "' + act.title + '"' + (sig ? ' with signature ' + sig.id : ''));
    Q.closeTasks(function (t) { return t.record === cr.id && t.ref === act.id; });
    if (cr.state === 'In execution' && cr.actions.every(function (x) { return x.status === 'Done'; })) {
      C.setState(cr, 'Effectiveness check', 'All actions done; effectiveness check started');
      cr.effectivenessDue = due(14);
      assign({ kind: 'cr-effectiveness', record: cr.id, assignee: cr.owner, due: cr.effectivenessDue });
    }
    Q.save();
  };
  C.close = function (cr, result, verdict, sig) {
    cr.effectiveness.result = result; cr.effectiveness.verdict = verdict; cr.effectiveness.by = me(); cr.effectiveness.at = now();
    cr.signatures.push({ id: sig.id, stage: 'Completion approved', user: me(), meaning: sig.meaning, at: sig.at });
    cr.closedAt = now();
    Q.closeTasks(function (t) { return t.record === cr.id; });
    C.setState(cr, 'Closed', 'Completion approved with e-signature; ' + cr.id + ' closed (' + verdict + ')');
    Q.save();
  };
  C.sendBack = function (cr, reason) {
    var told = [cr.owner].concat(cr.reviewers.map(function (r) { return r.u; })).filter(function (u, i, a) { return u !== me() && a.indexOf(u) === i; });
    cr.reviewers.forEach(function (r) { r.status = 'Not started'; delete r.at; });
    cr.approvers.forEach(function (a) { a.status = 'Waiting'; });
    Q.closeTasks(function (t) { return t.record === cr.id && (t.kind === 'cr-review' || t.kind === 'cr-approve'); });
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
    closeNoCapa: function (qe, justification, sig) {
      var b = qe.state; qe.state = 'Closed'; qe.closure = { justification: justification, by: me(), at: now(), sigId: sig.id };
      Q.audit('state', 'Quality event', qe.id, 'Closed ' + qe.id + ' without CAPA (justified and signed ' + sig.id + ')', { state: b }, { state: 'Closed' });
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
    approvePlan: function (c, sig) {
      c.actionsLocked = true; c.planSig = sig.id;
      wf.capa.setState(c, 'Execution', 'Actions approved and locked (signature ' + sig.id + '); execution started');
      Q.closeTasks(function (t) { return t.record === c.id && t.kind === 'capa-plan'; });
      c.actions.forEach(function (a) { assign({ kind: 'capa-action', record: c.id, assignee: a.assignee, due: a.due, ref: a.id }); });
      Q.save();
    },
    completeAction: function (c, a, sig) {
      a.status = 'Done'; a.doneAt = now(); if (sig) a.signedBy = me();
      Q.audit('update', 'CAPA', c.id, 'Completed ' + a.type.toLowerCase() + ' action "' + a.title + '"' + (sig ? ' (signed ' + sig.id + ')' : ''));
      Q.closeTasks(function (t) { return t.record === c.id && t.ref === a.id; });
      Q.save();
    },
    submitForApproval: function (c) {
      c.awaitingApproval = true;
      var approver = c.severity === 'High' ? (Q.S.users.find(function (u) { return u.roles.indexOf('qm') >= 0 && u.status === 'Active'; }) || {}).id : c.owner;
      c.approver = approver;
      Q.audit('state', 'CAPA', c.id, 'Completed actions sent for approval to ' + Q.fullName(approver));
      assign({ kind: 'capa-approve', record: c.id, assignee: approver, due: due(3), quiet: true });
      Q.fire('stage.reached', { record: c.id, to: [approver], what: 'approve completed actions on' });
      Q.save();
    },
    approveActions: function (c, sig) {
      c.awaitingApproval = false; c.actionsSig = sig.id;
      c.effectiveness.due = Q.iso(Q.addDays(new Date(), c.severity === 'High' ? 90 : 60));
      c.effectiveness.assignee = c.owner;
      Q.closeTasks(function (t) { return t.record === c.id && t.kind === 'capa-approve'; });
      wf.capa.setState(c, 'Effectiveness check', 'Completed actions approved (signature ' + sig.id + '); effectiveness check scheduled');
      assign({ kind: 'effectiveness', record: c.id, assignee: c.owner, due: c.effectiveness.due });
      Q.save();
    },
    close: function (c, result, verdict, sig) {
      c.effectiveness.result = result; c.effectiveness.verdict = verdict; c.effectiveness.by = me(); c.effectiveness.at = now(); c.closedAt = now(); c.closeSig = sig.id;
      Q.closeTasks(function (t) { return t.record === c.id; });
      wf.capa.setState(c, 'Closed', 'Effectiveness verified (' + verdict + ', signature ' + sig.id + '); ' + c.id + ' closed');
      var qe = Q.S.events[c.source]; if (qe && qe.state !== 'Closed') { qe.state = 'Closed'; Q.audit('state', 'Quality event', qe.id, qe.id + ' closed with ' + c.id); }
      Q.save();
    }
  };

  // ---------- Periodic reviews ----------
  wf.review = {
    noUpdate: function (r, sig) {
      var d = Q.S.docs[r.doc];
      r.state = 'Completed'; r.outcome = 'No update needed'; r.completedAt = now(); r.sigId = sig.id;
      var nextDue = Q.iso(Q.addDays(new Date(), Math.round((d.periodic ? d.periodic.months : 12) * 30.4)));
      r.nextDue = nextDue;
      var id = Q.nextId('PR');
      Q.S.reviews[id] = { id: id, doc: r.doc, reviewer: r.reviewer, due: nextDue, notice: r.notice, approval: r.approval, created: now(), state: 'Open' };
      Q.audit('review', 'Periodic review', r.id, 'Periodic review of ' + r.doc + ': no update needed (signed ' + sig.id + '); next review ' + Q.fmtDate(nextDue));
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
    requestRole: function (u, role) {
      var needsSecond = ['approver', 'qm', 'admin'].indexOf(role) >= 0 && Q.S.settings.twoPerson !== false;
      if (needsSecond) {
        Q.S.roleRequests.unshift({ id: Q.uid('RR'), user: u.id, role: role, requestedBy: me(), at: now(), status: 'Waiting for second admin' });
        Q.audit('role.request', 'User', u.id, 'Requested ' + Q.ROLE_LABEL[role] + ' for ' + u.name + ' (two-person rule: a second admin must approve)');
      } else {
        var b = u.roles.slice(); u.roles.push(role);
        Q.audit('role.change', 'User', u.id, 'Granted ' + Q.ROLE_LABEL[role] + ' to ' + u.name, { roles: b }, { roles: u.roles.slice() });
        Q.fire('security', { user: u.id, privilege: true, title: 'Role change: ' + u.name + ' is now ' + Q.ROLE_LABEL[role] });
      }
      Q.save(); return needsSecond;
    },
    removeRole: function (u, role) {
      var b = u.roles.slice(); u.roles = u.roles.filter(function (r) { return r !== role; });
      Q.audit('role.change', 'User', u.id, 'Removed ' + Q.ROLE_LABEL[role] + ' from ' + u.name, { roles: b }, { roles: u.roles.slice() });
      Q.fire('security', { user: u.id, privilege: true, title: 'Role change: ' + Q.ROLE_LABEL[role] + ' removed from ' + u.name });
      Q.save();
    },
    decideRequest: function (rq, approve) {
      var u = Q.user(rq.user);
      rq.status = approve ? 'Approved' : 'Declined'; rq.decidedBy = me(); rq.decidedAt = now();
      if (approve) {
        var b = u.roles.slice(); if (u.roles.indexOf(rq.role) < 0) u.roles.push(rq.role);
        Q.audit('role.change', 'User', u.id, 'Second admin approved ' + Q.ROLE_LABEL[rq.role] + ' for ' + u.name, { roles: b }, { roles: u.roles.slice() });
        Q.fire('security', { user: u.id, privilege: true, title: 'Role change: ' + u.name + ' is now ' + Q.ROLE_LABEL[rq.role] });
      } else Q.audit('role.request', 'User', u.id, 'Declined role request ' + rq.id);
      Q.save();
    }
  };
})(window.Q);
