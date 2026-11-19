/*
  VeQMS smoke test.
  Paste into the browser console on http://localhost:4173 (or run it with a browser tool).
  Renders every page and record as every active persona, reports any page that fails,
  checks the audit hash chain, then puts you back on the page and persona you started with.
  It doesn't change any records. Opening a Restricted document adds one "read" audit entry,
  which the app logs on purpose.
  Last run on this build: 13 personas, 3,822 renders, 0 errors, audit chain valid.
*/
(function () {
  var Q = window.Q;
  var errors = [];
  var renders = 0;
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
    ['/today', '/today?f=overdue', '/today?f=upcoming', '/tasks', '/documents'],
    withTabs('/training', ['my', 'matrix', 'records', 'audiences']),
    ['/training?tab=records&u=u-vic', '/training?tab=records&d=SOP-012&all=1', '/training?tab=matrix&g=IT%20team'],
    ['/approvals', '/approvals?tab=register', '/approvals?year=all&st=voided'],
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
    ['/admin/audit', '/admin/integrations', '/admin/templates', '/admin/workflows', '/admin/settings']
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

  try {
    people.forEach(function (u) {
      Q.S.session.userId = u.id;
      pages.concat(records).forEach(function (p) { show(p); });
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
    errors: errors.length,
    auditChain: chain.ok ? 'valid (' + chain.count + ' entries)' : 'BROKEN at entry ' + chain.brokenAt
  };
  console.log('VeQMS smoke test', result);
  if (errors.length) console.log(errors.slice(0, 50).join('\n'));
  return result;
})();
