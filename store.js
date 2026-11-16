/* State, persistence, permissions, audit trail, notifications and tasks.
   In production every rule here is enforced by the API; the browser only mirrors it. */
(function (Q) {
  'use strict';
  var KEY = 'veqms-demo-state';

  // ---------- Persistence (browser storage only; there is no database in the prototype) ----------
  Q.load = function () {
    var s = null;
    try { var raw = localStorage.getItem(KEY); if (raw) s = JSON.parse(raw); } catch (e) { s = null; }
    if (!s || s.version !== 8) { s = Q.seed(); Q.S = s; Q.seedAudit(); Q.save(); } else { Q.S = s; }
  };
  Q.save = function () { try { localStorage.setItem(KEY, JSON.stringify(Q.S)); } catch (e) { /* storage blocked: demo still runs in memory */ } };
  Q.reset = function () { Q.S = Q.seed(); Q.seedAudit(); Q.save(); };

  // ---------- People ----------
  Q.ROLE_LABEL = {
    admin: 'System Administrator', qm: 'Quality Manager', author: 'Document Owner / Author', reviewer: 'Reviewer',
    approver: 'Approver', process: 'Process Owner', employee: 'Employee / Trainee', auditor: 'Auditor (read-only)'
  };
  Q.user = function (id) { return Q.S.users.find(function (u) { return u.id === id; }) || { id: id, name: id === 'system' ? 'System' : 'Unknown', initials: '?', roles: [] }; };
  Q.me = function () { return Q.user(Q.S.session.userId); };
  Q.name = function (id) { return id === Q.S.session.userId ? 'You' : Q.user(id).name; };
  Q.fullName = function (id) { return Q.user(id).name; };
  Q.hasRole = function (role, u) { u = u || Q.me(); return u.roles.indexOf(role) >= 0; };
  Q.usersInGroup = function (g) { return Q.S.users.filter(function (u) { return u.status === 'Active' && u.groups.indexOf(g) >= 0; }); };
  Q.activeUsers = function () { return Q.S.users.filter(function (u) { return u.status === 'Active'; }); };

  var PERMS = {
    'write': ['admin', 'qm', 'author', 'reviewer', 'approver', 'process', 'employee'],
    'doc.create': ['author', 'qm'],
    'doc.approve': ['approver', 'qm'],
    'cr.create': ['process', 'qm', 'author'],
    'qe.create': ['process', 'qm', 'reviewer', 'author'],
    'capa.manage': ['process', 'qm'],
    'obs.raise': ['admin', 'qm', 'author', 'reviewer', 'approver', 'process', 'employee'],
    'training.rules': ['qm'],
    'training.org': ['qm', 'auditor', 'process', 'admin'],
    'reviews.org': ['qm', 'auditor', 'process', 'admin'],
    'analytics': ['qm', 'process', 'auditor', 'approver', 'admin'],
    'admin.users': ['admin'],
    'admin.settings': ['admin', 'qm'],
    'admin.automations': ['admin', 'qm'],
    'admin.audit': ['admin', 'qm', 'auditor'],
    'admin.integrations': ['admin'],
    'admin.templates': ['admin', 'qm'],
    'admin.workflows': ['admin', 'qm'],
    'admin.any': ['admin', 'qm', 'auditor']
  };
  Q.can = function (perm, u) {
    u = u || Q.me();
    var allowed = PERMS[perm] || [];
    return u.roles.some(function (r) { return allowed.indexOf(r) >= 0; });
  };
  Q.readOnly = function () { return !Q.can('write'); };

  // ---------- Classification ----------
  Q.CLASSES = ['Public', 'Internal', 'Confidential', 'Restricted'];
  Q.rank = function (c) { return Q.CLASSES.indexOf(c || 'Internal'); };
  Q.involved = function (r, uid) {
    uid = uid || Q.S.session.userId;
    if (!r) return false;
    if (r.owner === uid || r.author === uid || r.createdBy === uid || r.raisedBy === uid || r.reviewer === uid) return true;
    if ((r.reviewers || []).some(function (p) { return p.u === uid; })) return true;
    if ((r.approvers || []).some(function (p) { return p.u === uid; })) return true;
    if ((r.namedAccess || []).indexOf(uid) >= 0) return true;
    if ((r.actions || []).some(function (a) { return a.assignee === uid; })) return true;
    return false;
  };
  Q.canSee = function (r, u) {
    u = u || Q.me();
    if (!r) return false;
    var cls = r.classification || 'Internal';
    if (Q.rank(u.clearance) >= Q.rank(cls)) return true;
    return Q.involved(r, u.id);
  };
  Q.canDownload = function (r, u) {
    u = u || Q.me();
    var cls = r.classification || 'Internal';
    if (cls === 'Restricted') return u.clearance === 'Restricted';
    return Q.rank(u.clearance) >= Q.rank(cls) && Q.S.settings.classes[cls].download;
  };

  // ---------- Record lookup ----------
  Q.kindOf = function (id) {
    if (!id) return null;
    if (Q.S.docs[id]) return 'doc';
    if (Q.S.crs[id]) return 'cr';
    if (Q.S.events[id]) return 'qe';
    if (Q.S.capas[id]) return 'capa';
    if (Q.S.obs[id]) return 'obs';
    if (Q.S.reviews[id]) return 'review';
    if (/^TR-/.test(id)) return 'rule';
    return null;
  };
  Q.rec = function (id) {
    var k = Q.kindOf(id);
    if (k === 'doc') return Q.S.docs[id];
    if (k === 'cr') return Q.S.crs[id];
    if (k === 'qe') return Q.S.events[id];
    if (k === 'capa') return Q.S.capas[id];
    if (k === 'obs') return Q.S.obs[id];
    if (k === 'review') return Q.S.reviews[id];
    if (k === 'rule') return Q.S.trainingRules.find(function (r) { return r.id === id; });
    return null;
  };
  Q.KIND_LABEL = { doc: 'Document', cr: 'Change request', qe: 'Quality event', capa: 'CAPA', obs: 'Observation', review: 'Periodic review', rule: 'Training rule' };
  Q.curVer = function (d) { return d.versions[d.versions.length - 1]; };
  Q.effVer = function (d) { for (var i = d.versions.length - 1; i >= 0; i--) if (d.versions[i].state === 'Effective') return d.versions[i]; return null; };
  Q.recTitle = function (id) {
    var r = Q.rec(id), k = Q.kindOf(id);
    if (!r) return id;
    if (k === 'review') { var d = Q.S.docs[r.doc]; return 'Periodic review of ' + r.doc + (d ? ' ' + d.title : ''); }
    if (k === 'rule') return r.name;
    return r.title;
  };
  Q.recLabel = function (id) { // "POL-004 Access Control Policy v2.0"
    var r = Q.rec(id), k = Q.kindOf(id);
    if (k === 'doc') return id + ' ' + r.title + ' v' + Q.curVer(r).v;
    if (k === 'review') return Q.recTitle(id);
    if (k === 'rule') return id + ' ' + r.name;
    return id + ' ' + Q.recTitle(id);
  };
  Q.recHref = function (id) {
    var k = Q.kindOf(id);
    if (k === 'doc') return '#/documents/' + id;
    if (k === 'cr') return '#/changes/' + id;
    if (k === 'qe' || k === 'capa' || k === 'obs') return '#/quality/' + id;
    if (k === 'review') return '#/reviews/' + id;
    if (k === 'rule') return '#/training?tab=rules&rule=' + id;
    return '#/today';
  };
  Q.recClass = function (id) { var r = Q.rec(id); if (!r) return 'Internal'; if (Q.kindOf(id) === 'review') return (Q.S.docs[r.doc] || {}).classification || 'Internal'; return r.classification || 'Internal'; };
  Q.allRecordIds = function () {
    return [].concat(Object.keys(Q.S.docs), Object.keys(Q.S.crs), Object.keys(Q.S.events), Object.keys(Q.S.capas), Object.keys(Q.S.obs));
  };

  // ---------- Links (polymorphic, visible from both ends) ----------
  Q.linksOf = function (id) {
    var out = [];
    Q.S.links.forEach(function (l) { if (l[0] === id) out.push(l[1]); else if (l[1] === id) out.push(l[0]); });
    return out.filter(function (x, i) { return out.indexOf(x) === i && Q.rec(x); });
  };
  Q.link = function (a, b) {
    if (a === b || Q.linksOf(a).indexOf(b) >= 0) return false;
    Q.S.links.push([a, b]);
    Q.audit('link', Q.KIND_LABEL[Q.kindOf(a)] || 'Record', a, 'Linked ' + b + ' (link visible from both records)', null, { link: b });
    return true;
  };
  Q.unlink = function (a, b) {
    Q.S.links = Q.S.links.filter(function (l) { return !((l[0] === a && l[1] === b) || (l[0] === b && l[1] === a)); });
    Q.audit('unlink', Q.KIND_LABEL[Q.kindOf(a)] || 'Record', a, 'Removed link to ' + b);
  };

  Q.nextId = function (prefix) {
    var c = Q.S.counters; c[prefix] = (c[prefix] || 0) + 1;
    var n = String(c[prefix]).padStart(3, '0');
    return prefix + '-' + n;
  };

  // ---------- Audit trail (append-only, hash-chained per tenant) ----------
  function device(uid) {
    var d = { 'u-vic': ['Safari · macOS', '203.0.113.24'], 'u-tom': ['Edge · Windows 11', '203.0.113.31'], 'u-grace': ['VeQMS app · iOS', '198.51.100.12'], 'u-daniel': ['Chrome · Windows 11', '198.51.100.40'], 'u-aud': ['Firefox · Windows 11', '192.0.2.77'], 'system': ['Worker', '10.0.4.12'] }[uid];
    return d || ['Edge · Windows 11', '203.0.113.' + (10 + (uid || '').length * 3)];
  }
  function entryHash(e) {
    var copy = {}; Object.keys(e).forEach(function (k) { if (k !== 'hash') copy[k] = e[k]; });
    return Q.sha256((e.prevHash || '') + Q.canon(copy));
  }
  Q.audit = function (action, objectType, objectId, summary, before, after, opts) {
    opts = opts || {};
    var log = Q.S.audit;
    var prev = log.length ? log[log.length - 1].hash : '0'.repeat(64);
    var actor = opts.actor || Q.S.session.userId;
    var dv = device(actor);
    var e = {
      seq: log.length + 1, at: opts.at || new Date().toISOString(), actor: actor, onBehalfOf: opts.onBehalfOf || null,
      action: action, objectType: objectType, objectId: objectId, summary: summary,
      before: before == null ? null : before, after: after == null ? null : after,
      ip: dv[1], device: dv[0], prevHash: prev
    };
    e.hash = entryHash(e);
    log.push(e);
    return e;
  };
  Q.seedAudit = function () {
    Q.S.audit = [];
    var hist = Q.seedHistory().map(function (h) { return { at: Q.dayIso(h[0], h[1], h[2]), actor: h[3], action: h[4], type: h[5], id: h[6], sum: h[7] }; });
    hist.sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    hist.forEach(function (h) { Q.audit(h.action, h.type, h.id, h.sum, null, null, { actor: h.actor, at: h.at }); });
  };
  Q.verifyChain = function () {
    var log = Q.S.audit, prev = '0'.repeat(64);
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      if (e.prevHash !== prev || entryHash(e) !== e.hash) return { ok: false, count: log.length, brokenAt: e.seq };
      prev = e.hash;
    }
    return { ok: true, count: log.length, head: prev };
  };
  Q.history = function (id) { return Q.S.audit.filter(function (e) { return e.objectId === id; }).slice().reverse(); };

  // ---------- Notifications (every send is logged per channel) ----------
  Q.prefs = function (uid) {
    uid = uid || Q.S.session.userId;
    if (!Q.S.prefs[uid]) Q.S.prefs[uid] = { email: true, teams: true, push: true, digest: 'none', quietStart: '20:00', quietEnd: '07:00', quiet: false, calendar: false, fyiEmail: false };
    return Q.S.prefs[uid];
  };
  Q.integrationOn = function (id) { var i = Q.S.integrations.find(function (x) { return x.id === id; }); return i && i.on; };
  Q.notify = function (o) {
    var to = Array.isArray(o.to) ? o.to : [o.to];
    var cls = o.record ? Q.recClass(o.record) : 'Internal';
    to.filter(Boolean).forEach(function (uid) {
      var u = Q.user(uid);
      if (u.status !== 'Active') return;
      var p = Q.prefs(uid);
      var chans = (o.channels || ['in-app', 'email']).filter(function (c) {
        if (o.mandatory || c === 'in-app') return true;
        if (c === 'email') return o.kind === 'fyi' ? (p.email && p.fyiEmail) : p.email;
        if (c === 'teams') return p.teams;
        if (c === 'push') return p.push;
        return true;
      });
      var n = { id: Q.uid('N'), to: uid, at: new Date().toISOString(), kind: o.kind || 'info', title: o.title, body: o.body || '', record: o.record || null, href: o.href || null, read: false, mandatory: !!o.mandatory, channels: chans, rule: o.rule || null };
      if (chans.indexOf('in-app') >= 0) Q.S.notifications.unshift(n);
      chans.forEach(function (c) {
        var status = 'Delivered', note = '';
        if (c === 'teams' && !Q.integrationOn('teams')) { status = 'Queued'; note = 'Teams connector is off (Phase 6); will retry'; }
        if (c === 'email') note = 'Summary and deep link only';
        if (c === 'push' && (cls === 'Confidential' || cls === 'Restricted')) note = 'Title masked on lock screen';
        Q.S.notifLog.unshift({ id: Q.uid('NL'), at: n.at, to: uid, channel: c, title: o.title, record: o.record || null, status: status, note: note, rule: o.rule || null });
      });
    });
  };
  Q.unread = function () { var me = Q.S.session.userId; return Q.S.notifications.filter(function (n) { return n.to === me && !n.read; }).length; };

  // ---------- Tasks ----------
  Q.TASK_META = {
    'approve-doc': { label: 'Approve · Document', action: 'Review and sign' },
    'review-doc': { label: 'Review · Document', action: 'Start review' },
    'author': { label: 'Draft · Document', action: 'Continue draft' },
    'resubmit': { label: 'Sent back · Document', action: 'Revise draft' },
    'send-approval': { label: 'Review closed · Document', action: 'Send for approval' },
    'training': { label: 'Complete training', action: 'Start training' },
    'periodic': { label: 'Periodic review', action: 'Start review' },
    'cr-review': { label: 'Review · Change request', action: 'Review' },
    'cr-approve': { label: 'Approve · Change request', action: 'Review and sign' },
    'cr-action': { label: 'Change action', action: 'Update action' },
    'cr-plan': { label: 'Plan · Change request', action: 'Continue planning' },
    'cr-effectiveness': { label: 'Effectiveness check · Change request', action: 'Record result' },
    'capa-action': { label: 'Corrective action', action: 'Update action' },
    'capa-plan': { label: 'Plan · CAPA', action: 'Plan actions' },
    'capa-approve': { label: 'Approve · CAPA', action: 'Review and sign' },
    'effectiveness': { label: 'Effectiveness check', action: 'Open' },
    'fyi': { label: 'FYI · You approve after review', action: 'View' },
    'obs-review': { label: 'Initial review · Observation', action: 'Review' },
    'qe-assess': { label: 'Assess · Quality event', action: 'Assess' },
    'rule-approve': { label: 'Approve · Training rule', action: 'Review and sign' },
    'todo': { label: 'To-do', action: 'Open' }
  };
  Q.taskMeta = function (t) {
    var m = Q.TASK_META[t.kind] || Q.TASK_META.todo;
    if (t.kind === 'capa-action') {
      var c = Q.S.capas[t.record], a = c && c.actions.find(function (x) { return x.id === t.ref; });
      if (a) return { label: a.type + ' action', action: m.action };
    }
    if (t.kind === 'fyi') {
      var r = Q.rec(t.record);
      return { label: 'FYI · You approve after ' + (r && r.state === 'In approval' ? 'the current approver' : 'review'), action: 'View' };
    }
    return m;
  };
  Q.taskTitle = function (t) {
    if (t.title) return t.title;
    if (t.kind === 'cr-action') { var cr = Q.S.crs[t.record], a = cr && cr.actions.find(function (x) { return x.id === t.ref; }); return t.record + ' · ' + (a ? a.title : Q.recTitle(t.record)); }
    if (t.kind === 'capa-action') { var c = Q.S.capas[t.record], ca = c && c.actions.find(function (x) { return x.id === t.ref; }); return t.record + ' · ' + (ca ? ca.title : Q.recTitle(t.record)); }
    if (t.kind === 'periodic') { var r = Q.S.reviews[t.record]; return r ? r.doc + ' ' + Q.S.docs[r.doc].title : t.record; }
    if (t.kind === 'training') { var d = Q.S.docs[t.record]; return t.record + ' ' + d.title + ' v' + (Q.effVer(d) || Q.curVer(d)).v; }
    if (t.kind === 'rule-approve') { var rule = Q.rec(t.record); return t.record + ' ' + (rule ? rule.name : ''); }
    return Q.recLabel(t.record);
  };
  Q.taskHref = function (t) {
    if (t.href) return t.href;
    if (t.kind === 'training') return '#/training?doc=' + t.record;
    if (t.kind === 'rule-approve') return '#/training?tab=rules&rule=' + t.record;
    return Q.recHref(t.record);
  };
  Q.openTasks = function (uid) { uid = uid || Q.S.session.userId; return Q.S.tasks.filter(function (t) { return t.assignee === uid && t.status === 'open'; }); };
  Q.addTask = function (o) {
    var t = { id: Q.uid('T'), kind: o.kind, record: o.record, assignee: o.assignee, due: o.due || null, created: new Date().toISOString(), status: 'open', ref: o.ref || null, fyi: !!o.fyi, note: o.note || null, title: o.title || null, href: o.href || null, onBehalfOf: o.onBehalfOf || null };
    Q.S.tasks.push(t);
    return t;
  };
  Q.closeTasks = function (pred) {
    Q.S.tasks.forEach(function (t) { if (t.status === 'open' && pred(t)) { t.status = 'done'; t.doneAt = new Date().toISOString(); } });
  };
  Q.delegateFor = function (uid) {
    var now = new Date().toISOString();
    return Q.S.delegations.find(function (d) { return d.from === uid && d.start <= now && d.end >= now; });
  };
})(window.Q);
