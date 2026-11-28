/*
  VeQMS smoke test.
  Paste into the browser console on http://localhost:4173 (or run it with a browser tool).
  Renders every page and record as every active persona, opens the document-flow drawers (submit, approve,
  return, the Word stand-in editor, review), the training drawers and the integrity-alert drawer wherever that
  persona may use them, reports anything that fails, checks the audit hash chain, then puts you back on the
  page and persona you started with. It doesn't change any records. Opening a Restricted document adds one
  "read" audit entry, which the app logs on purpose.
  Last run on this build (fresh data): 13 personas, 4,433 renders, 23 drawers, 0 errors, audit chain valid.
*/
(function () {
  var Q = window.Q;
  var errors = [];
  var renders = 0, drawers = 0;
  var origError = console.error;
  console.error = function () {
    errors.push(Array.prototype.map.call(arguments, String).join(' '));
    origError.apply(console, arguments);
  };

  var startUser = Q.S.session.userId;
  var startHash = location.hash || '#/today';
  var people = Q.S.users.filter(function (u) { return u.status !== 'Left'; });

  function withTabs(base, tabs) { return tabs.map(function (t) { return base + '?tab=' + t; }); }
  var pages = [].concat(
    ['/today', '/today?f=overdue', '/today?f=upcoming', '/tasks', '/documents', '/documents?state=Signing', '/documents?state=In%20approval', '/documents?type=User%20access%20review'],
    withTabs('/training', ['my', 'matrix', 'records', 'audiences']),
    ['/training?tab=records&u=u-vic', '/training?tab=records&d=SOP-012&all=1', '/training?tab=matrix&g=IT%20team'],
    ['/approvals', '/approvals?tab=transactions', '/approvals?tab=register', '/approvals?year=all&st=cancelled', '/approvals?year=all&st=declined'],
    ['/changes', '/changes?view=board'],
    withTabs('/reviews', ['mine', 'org']),
    withTabs('/quality', ['observations', 'events', 'capa']),
    ['/quality?tab=events&view=board', '/quality?tab=capa&view=board'],
    withTabs('/analytics', ['overview', 'documents', 'training', 'changes', 'quality', 'reviews', 'actions']),
    ['/notifications'],
    withTabs('/profile', ['notifications', 'delegation', 'account']),
    ['/help', '/search?q=access', '/raise'],
    withTabs('/admin/users', ['users', 'requests', 'review', 'delegations']),
    withTabs('/admin/automations', ['rules', 'runs', 'failed', 'log']),
    ['/admin/audit', '/admin/sharepoint', '/admin/integrations', '/admin/templates', '/admin/workflows', '/admin/settings']
  );
  var TABS = {
    doc: ['document', 'compare', 'comments', 'history', 'approval', 'training'],
    cr: ['overview', 'items', 'actions', 'attachments', 'related', 'effectiveness'],
    capa: ['overview', 'actions', 'rootcause', 'risk', 'evidence', 'effectiveness']
  };
  var records = [];
  Q.allRecordIds().forEach(function (id) {
    var base = Q.recHref(id).slice(1);
    records.push(base);
    (TABS[Q.kindOf(id)] || []).forEach(function (t) { records.push(base + '?tab=' + t); });
  });
  Object.keys(Q.S.reviews).forEach(function (id) { records.push('/reviews/' + id); });
  Q.S.tasks.forEach(function (t) { records.push('/task/' + t.id); });

  function show(path) {
    history.replaceState(null, '', '#' + path);
    var before = errors.length;
    Q.render({ noFocus: true });
    renders++;
    var main = document.getElementById('main');
    if (main && /Something went wrong on this page/.test(main.textContent) && errors.length === before) {
      errors.push('Error page shown for ' + path);
    }
    if (errors.length > before) errors[errors.length - 1] = '[' + path + '] ' + errors[errors.length - 1];
  }

  // Open a drawer the way a click would, then close it. Drawers here only read records.
  function openDrawer(act, id) {
    var before = errors.length;
    var el = { getAttribute: function (k) { return k === 'data-id' ? id : null; }, closest: function () { return null; } };
    try { Q.act[act](el, { target: document.body }); } catch (e) { errors.push(String(e && e.message || e)); }
    drawers++;
    var root = document.getElementById('drawer-root');
    if (!Q.drawer.isOpen() || !root || !root.querySelector('.drawer')) errors.push('Drawer did not open');
    if (errors.length > before) errors[errors.length - 1] = '[drawer ' + act + ' ' + id + ' as ' + Q.S.session.userId + '] ' + errors[errors.length - 1];
    Q.drawer.close();
  }
  function drawersFor(u) {
    var ro = Q.readOnly();
    Object.keys(Q.S.docs).forEach(function (k) {
      var d = Q.S.docs[k];
      if (!Q.canSee(d)) return;
      if (!ro && d.state === 'Draft' && (d.author === u.id || d.owner === u.id)) { openDrawer('doc-edit', k); openDrawer('doc-submit', k); }
      if (Q.wf.doc.canReturn(d)) openDrawer('doc-sendback', k);
      if (!ro && d.state === 'In review' && d.reviewers.some(function (r) { return r.u === u.id && r.status === 'Pending'; })) openDrawer('doc-review', k);
      if (!ro && d.state === 'In approval' && d.approvers.some(function (a) { return a.u === u.id && a.status === 'To approve'; })) openDrawer('doc-approve', k);
    });
    if (!ro) Q.S.assignments.filter(function (a) { return a.user === u.id && Q.trOpen(a); }).forEach(function (a) { openDrawer('train-start', a.id); });
    if (Q.sp.canResolve()) Q.sp.openAlerts().forEach(function (a) { openDrawer('sp-resolve', a.id); });
  }

  try {
    people.forEach(function (u) {
      Q.S.session.userId = u.id;
      pages.concat(records).forEach(function (p) { show(p); });
      drawersFor(u);
    });
  } finally {
    console.error = origError;
    Q.S.session.userId = startUser;
    Q.save();
    history.replaceState(null, '', startHash);
    Q.render({ noFocus: true });
  }

  var chain = Q.verifyChain();
  var result = {
    personas: people.length,
    renders: renders,
    drawers: drawers,
    errors: errors.length,
    auditChain: chain.ok ? 'valid (' + chain.count + ' entries)' : 'BROKEN at entry ' + chain.brokenAt
  };
  console.log('VeQMS smoke test', result);
  if (errors.length) console.log(errors.slice(0, 50).join('\n'));
  return result;
})();
