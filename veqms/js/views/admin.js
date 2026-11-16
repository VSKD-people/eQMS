/* Administration (web only): users and roles, audit trail, automations, integrations, templates, workflows, settings. */
(function (Q) {
  'use strict';
  var h = Q.h;
  var SECTIONS = [
    { id: 'users', label: 'Users and roles', icon: 'users', perm: 'admin.users' },
    { id: 'audit', label: 'Audit trail', icon: 'log', perm: 'admin.audit' },
    { id: 'automations', label: 'Automations', icon: 'zap', perm: 'admin.automations' },
    { id: 'integrations', label: 'Integrations', icon: 'plug', perm: 'admin.integrations' },
    { id: 'templates', label: 'Templates', icon: 'template', perm: 'admin.templates' },
    { id: 'workflows', label: 'Workflows', icon: 'flow', perm: 'admin.workflows' },
    { id: 'settings', label: 'Settings', icon: 'settings', perm: 'admin.settings' }
  ];

  Q.views.admin = function (p, q) {
    var allowed = SECTIONS.filter(function (s) { return Q.can(s.perm); });
    if (!allowed.length) return Q.views.denied('Administration');
    var sec = allowed.find(function (s) { return s.id === p.section; }) || allowed[0];
    if (p.section && sec.id !== p.section) return Q.views.denied(p.section);
    var body = { users: users, audit: audit, automations: automations, integrations: integrations, templates: templates, workflows: workflows, settings: settings }[sec.id](q);
    return h`<div class="page-head"><div><h1>Administration</h1><div class="sub">Web only. ${Q.hasRole('admin') ? 'System Administrators can’t approve quality records (segregation of duties).' : 'Changes to controlled processes need approval before they go live.'}</div></div></div>
      <div class="tabs" role="tablist" aria-label="Administration sections">${allowed.map(function (s) { return h`<a class="tab ${s.id === sec.id ? 'active' : ''}" href="#/admin/${s.id}" role="tab" aria-selected="${s.id === sec.id}">${Q.icon(s.icon, 'ico-sm')}<span style="margin-left:6px">${s.label}</span></a>`; })}</div>
      ${body}`;
  };
  function subTabs(list, cur, key) { return h`<div class="seg mb-16" role="group">${list.map(function (t) { return h`<button class="${cur === t[0] ? 'active' : ''}" data-act="tab" data-key="${key || 'tab'}" data-tab="${t[0]}">${t[1]}</button>`; })}</div>`; }

  // ---------- Users and roles ----------
  function users(q) {
    var tab = q.tab || 'users';
    var body;
    if (tab === 'requests') {
      body = Q.S.roleRequests.length ? h`<div class="list-rows">${Q.S.roleRequests.map(function (r) {
        var mineReq = r.requestedBy === Q.S.session.userId;
        return h`<div class="list-row"><div class="lr-main"><b>${Q.ROLE_LABEL[r.role]}</b> for ${Q.fullName(r.user)}<div class="small muted">Requested by ${Q.fullName(r.requestedBy)} · ${Q.fmtDateTime(r.at)}${r.decidedBy ? ' · ' + r.status + ' by ' + Q.fullName(r.decidedBy) : ''}</div></div>
          ${r.status === 'Waiting for second admin' ? (mineReq ? h`<span class="small muted" style="max-width:240px;text-align:right">You requested this. A second admin must approve it.</span>` : h`<div class="btn-row"><button class="btn btn-sm" data-act="rr" data-id="${r.id}" data-ok="0">Decline</button><button class="btn btn-sm btn-primary" data-act="rr" data-id="${r.id}" data-ok="1">Approve</button></div>`) : Q.chip(r.status)}</div>`;
      })}</div>${Q.S.users.filter(function (u) { return u.roles.indexOf('admin') >= 0 && u.status === 'Active'; }).length < 2 ? h`<div class="callout warn mt-16"><strong>Only one System Administrator.</strong><p class="small" style="margin:4px 0 0">The two-person rule (Step 3, decision R3) needs at least two admins, so these requests can’t be approved yet.</p></div>` : ''}` : Q.empty('No role requests', '');
    } else if (tab === 'review') {
      var rows = Q.S.users.filter(function (u) { return u.status === 'Active'; });
      body = h`<div class="spread mb-16" style="flex-wrap:wrap"><p class="muted" style="margin:0">Quarterly access review: managers confirm each person still needs their roles and clearance.</p><div class="btn-row"><button class="btn" data-act="ar-export">Export access review (CSV)</button><button class="btn btn-primary" data-act="ar-signoff">Sign off this quarter</button></div></div>
        ${Q.table({ id: 'ar', rows: rows.map(function (u) { return Object.assign({ mgr: u.manager ? Q.fullName(u.manager) : '—', rl: u.roles.map(function (r) { return Q.ROLE_LABEL[r]; }).join(', ') }, u); }), defaultSort: 'mgr',
          cols: [{ key: 'name', label: 'Person' }, { key: 'mgr', label: 'Manager' }, { key: 'rl', label: 'Roles' }, { key: 'clearance', label: 'Clearance', render: function (u) { return Q.cls(u.clearance); } }, { key: 'groups', label: 'Groups', sort: false, render: function (u) { return h`<span class="small">${u.groups.join(', ')}</span>`; } }, { key: 'site', label: 'Site' }] })}`;
    } else if (tab === 'delegations') {
      body = h`<p class="muted">Delegates can review but not sign approvals. Delegated actions are logged as “X on behalf of Y”.</p>
        ${Q.table({ id: 'del', rows: Q.S.delegations.map(function (d) { return Object.assign({ f: Q.fullName(d.from), t: Q.fullName(d.to) }, d); }), defaultSort: 'start', empty: 'No delegations.',
          cols: [{ key: 'f', label: 'From' }, { key: 't', label: 'Delegate' }, { key: 'start', label: 'Start', render: function (d) { return Q.fmtDate(d.start); } }, { key: 'end', label: 'End', render: function (d) { return Q.fmtDate(d.end); } }, { key: 'scope', label: 'Scope' }, { key: 'reason', label: 'Reason' }] })}`;
    } else {
      body = Q.table({ id: 'users', rows: Q.S.users.map(function (u) { return Object.assign({ rl: u.roles.map(function (r) { return Q.ROLE_LABEL[r]; }).join(', ') }, u); }), defaultSort: 'name', href: function (u) { return '#/admin/users?user=' + u.id; },
        cols: [{ key: 'name', label: 'Name', render: function (u) { return h`<span class="row" style="gap:8px">${Q.avatar(u.id, 'xs')}<b>${u.name}</b></span>`; } }, { key: 'title', label: 'Job title' }, { key: 'rl', label: 'Roles', render: function (u) { return h`<span class="small">${u.rl}</span>`; } }, { key: 'clearance', label: 'Clearance', render: function (u) { return Q.cls(u.clearance); } }, { key: 'site', label: 'Site' }, { key: 'status', label: 'Status', render: function (u) { return Q.stateChip(u.status) ; } }] });
      if (q.user) Q.after(function () { var u = Q.user(q.user); if (u && u.roles) openUser(u); });
    }
    return h`<div class="spread mb-8" style="flex-wrap:wrap">${subTabs([['users', 'Users'], ['requests', 'Role requests · ' + Q.S.roleRequests.filter(function (r) { return r.status === 'Waiting for second admin'; }).length], ['review', 'Access review'], ['delegations', 'Delegations']], tab)}
      <span class="small muted">Users and groups come from Microsoft Entra ID through SCIM. Leavers lose access within ${Q.S.settings.leaverTarget} minutes; revoke-now ends it at once.</span></div>${body}`;
  }
  function openUser(u) {
    var isAdmin = Q.hasRole('admin');
    Q.drawer.open({ kicker: 'User', title: u.name, sub: u.title + ' · ' + u.email,
      onClose: function () { if (Q.current.query.user) Q.setQuery({ user: '' }); },
      body: h`<div class="row-wrap mb-16">${Q.stateChip(u.status)}${Q.cls(u.clearance)}<span class="small muted">${u.site}${u.manager ? ' · manager ' + Q.fullName(u.manager) : ''}</span></div>
        ${u.status !== 'Active' ? h`<div class="callout plain mb-16"><b style="color:var(--ink)">${u.status === 'Left' ? 'Leaver' : 'Access revoked'}</b><p class="small" style="margin:4px 0 0">Past signatures and training records stay attached to the records and are never deleted.</p></div>` : ''}
        <fieldset class="mb-16"><legend>Roles</legend>${Object.keys(Q.ROLE_LABEL).map(function (r) { var priv = ['approver', 'qm', 'admin'].indexOf(r) >= 0; return h`<label class="check"><input type="checkbox" data-multi name="roles" value="${r}" ${u.roles.indexOf(r) >= 0 ? 'checked' : ''} ${isAdmin && u.status === 'Active' ? '' : 'disabled'}> ${Q.ROLE_LABEL[r]}${priv ? h` <span class="small muted">· needs a second admin</span>` : ''}</label>`; })}</fieldset>
        <div class="field mb-16"><label for="ucl">Information clearance</label><select class="select" id="ucl" name="clearance" ${isAdmin && u.status === 'Active' ? '' : 'disabled'}>${Q.CLASSES.map(function (c) { return h`<option ${u.clearance === c ? 'selected' : ''}>${c}</option>`; })}</select></div>
        <div class="small muted">Groups: ${u.groups.join(', ') || '—'} (managed in Entra ID)</div>
        ${isAdmin && u.status === 'Active' && u.id !== Q.S.session.userId ? h`<hr><div class="label mb-8">Remove access</div><div class="btn-row"><button type="button" class="btn btn-danger" data-act="u-revoke" data-id="${u.id}">Revoke now</button><button type="button" class="btn" data-act="u-leaver" data-id="${u.id}">Process as leaver</button></div><p class="small muted mt-8">Revoke-now ends every session at once and reassigns open tasks to the manager.</p>` : ''}`,
      foot: isAdmin && u.status === 'Active' ? h`<button class="btn btn-primary" type="submit">Save changes</button><button class="btn" type="button" data-act="drawer-close">Cancel</button>` : h`<button class="btn" type="button" data-act="drawer-close">Close</button>`,
      submit: function (f) {
        var added = (f.roles || []).filter(function (r) { return u.roles.indexOf(r) < 0; });
        var removed = u.roles.filter(function (r) { return (f.roles || []).indexOf(r) < 0; });
        var pending = 0;
        removed.forEach(function (r) { Q.wf.user.removeRole(u, r); });
        added.forEach(function (r) { if (Q.wf.user.requestRole(u, r)) pending++; });
        if (f.clearance && f.clearance !== u.clearance) { var b = u.clearance; u.clearance = f.clearance; Q.audit('permission', 'User', u.id, 'Changed clearance of ' + u.name + ' from ' + b + ' to ' + f.clearance, { clearance: b }, { clearance: f.clearance }); Q.fire('security', { user: u.id, privilege: true, title: 'Clearance changed for ' + u.name }); }
        Q.save(); Q.drawer.close(); Q.toast(pending ? pending + ' privileged role change(s) waiting for a second admin' : 'Saved'); Q.render();
      } });
  }
  Q.act['u-revoke'] = function (el) {
    var u = Q.user(el.getAttribute('data-id'));
    var open = Q.S.tasks.filter(function (t) { return t.assignee === u.id && t.status === 'open'; }).length;
    Q.drawer.open({ kicker: 'Revoke now', title: 'End ' + u.name + '’s access now', submitLabel: 'Revoke access now',
      body: h`<div class="callout warn mb-16"><strong>This takes effect at once.</strong><p class="small" style="margin:4px 0 0">Every session and refresh token is revoked and the next request is refused. ${open ? Q.plural(open, 'open task') + ' will be reassigned to ' + (u.manager ? Q.fullName(u.manager) : 'the Quality Manager') + '.' : ''} Records, signatures and training history are kept.</p></div>
        <div class="field"><label for="rvr">Reason (required, logged)</label><textarea class="textarea" id="rvr" name="reason" placeholder="e.g. Urgent leaver, suspected account compromise"></textarea></div>`,
      submit: function (f, form) { if (!f.reason) return Q.fieldError(form, 'reason', 'Give a reason; it goes in the audit trail.'); Q.wf.user.revokeNow(u, f.reason); Q.drawer.close(); Q.toast('Access revoked for ' + u.name + '. Admins alerted.'); Q.render(); } });
  };
  Q.act['u-leaver'] = function (el) {
    var u = Q.user(el.getAttribute('data-id'));
    Q.drawer.open({ kicker: 'Leaver', title: 'Process ' + u.name + ' as a leaver', submitLabel: 'Process leaver',
      body: h`<p>Removes access and group memberships. In production this normally arrives from Entra ID through SCIM within ${Q.S.settings.leaverTarget} minutes; use this for manual cases.</p><div class="callout plain"><b style="color:var(--ink)">Kept for the record</b><p class="small" style="margin:4px 0 0">Past signatures, training records and authored documents stay attached and are never deleted. Open tasks go to their manager.</p></div>`,
      submit: function () { Q.wf.user.leaver(u); Q.drawer.close(); Q.toast(u.name + ' processed as a leaver'); Q.render(); } });
  };
  Q.act.rr = function (el) { var r = Q.S.roleRequests.find(function (x) { return x.id === el.getAttribute('data-id'); }); Q.wf.user.decideRequest(r, el.getAttribute('data-ok') === '1'); Q.refresh(); };
  Q.act['ar-export'] = function () {
    var rows = [['Person', 'Email', 'Status', 'Manager', 'Roles', 'Clearance', 'Groups', 'Site']];
    Q.S.users.forEach(function (u) { rows.push([u.name, u.email, u.status, u.manager ? Q.fullName(u.manager) : '', u.roles.map(function (r) { return Q.ROLE_LABEL[r]; }).join('; '), u.clearance, u.groups.join('; '), u.site]); });
    Q.exportCsv('access-review.csv', rows, 'quarterly access review');
  };
  Q.act['ar-signoff'] = function () {
    Q.sign({ items: [{ id: 'ACCESS-REVIEW-Q4', hash: Q.sha256(Q.canon(Q.S.users.map(function (u) { return [u.id, u.roles, u.clearance, u.status]; }))) }], meaning: 'Reviewed', meanings: ['Reviewed'], title: 'Sign off the Q4 access review',
      onSigned: function () { Q.closeTasks(function (t) { return t.record === 'ADMIN-AR'; }); Q.toast('Access review signed off'); } });
  };

  // ---------- Audit trail ----------
  function audit(q) {
    var v = Q.ui.chain || Q.verifyChain();
    var s = (q.q || '').toLowerCase();
    var rows = Q.S.audit.slice().reverse().filter(function (e) {
      if (s && (e.objectId + ' ' + e.summary + ' ' + Q.fullName(e.actor) + ' ' + e.action).toLowerCase().indexOf(s) < 0) return false;
      if (q.action && e.action.split('.')[0] !== q.action) return false;
      return true;
    });
    var actions = Q.S.audit.map(function (e) { return e.action.split('.')[0]; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
    var limit = +(q.limit || 60);
    return h`<div class="card card-pad mb-16"><div class="spread" style="flex-wrap:wrap;align-items:flex-start">
        <div><div class="row">${v.ok ? h`<span class="health h-ok">Chain verified</span>` : h`<span class="health h-bad">Chain broken at entry ${v.brokenAt}</span>`}<span class="small muted">${v.count} entries · hash-chained SHA-256 per tenant</span></div>
          <div class="small muted mt-8">Head: <span class="mono">${(Q.S.audit[Q.S.audit.length - 1] || {}).hash}</span></div>
          <div class="small muted">Last immutable (WORM) anchor: ${Q.fmtDateTime(Q.S.settings.lastAnchor)} · every ${Q.S.settings.anchorMinutes} minutes · hourly verifier, nightly full check</div></div>
        <div class="btn-row"><button class="btn" data-act="chain-verify">${Q.icon('refresh', 'ico-sm')} Verify chain now</button><button class="btn" data-act="audit-export">${Q.icon('download', 'ico-sm')} Export CSV</button>${Q.hasRole('admin') || Q.hasRole('qm') ? (Q.ui.tamper ? h`<button class="btn" data-act="tamper-undo">Undo tamper test</button>` : h`<button class="btn" data-act="tamper">Run tamper test</button>`) : ''}</div></div>
      ${!v.ok ? h`<div class="callout warn mt-16"><strong>Security alert raised</strong><p class="small" style="margin:4px 0 0">Entry ${v.brokenAt} no longer matches its hash. In production this opens a security incident and evidence is preserved from the last anchor.</p></div>` : ''}</div>
      <div class="toolbar"><input class="input search" type="search" placeholder="Search record, person or text" value="${q.q || ''}" data-input="audit-search" aria-label="Search the audit trail">
        <select class="select" data-change="qfilter" data-key="action" aria-label="Action"><option value="">All actions</option>${actions.map(function (a) { return h`<option ${q.action === a ? 'selected' : ''}>${a}</option>`; })}</select>
        <span class="small muted" style="margin-left:auto">Append-only. Nobody can edit or delete entries, including admins.</span></div>
      <div class="table-wrap"><table class="t"><caption class="sr-only">Audit trail</caption><thead><tr><th scope="col">#</th><th scope="col">Time (UTC)</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Object</th><th scope="col">Summary</th><th scope="col">IP · device</th><th scope="col">Hash</th></tr></thead><tbody>
      ${rows.slice(0, limit).map(function (e) { var bad = !v.ok && e.seq === v.brokenAt; return h`<tr class="click" data-act="audit-row" data-seq="${e.seq}" style="${bad ? 'background:var(--overdue-bg)' : ''}"><td class="small muted">${e.seq}</td><td class="nowrap small">${Q.fmtUtc(e.at)}</td><td class="nowrap">${e.actor === 'system' ? 'System' : Q.fullName(e.actor)}${e.onBehalfOf ? h`<div class="small muted">for ${Q.fullName(e.onBehalfOf)}</div>` : ''}</td><td><span class="chip chip-outline">${e.action}</span></td><td class="nowrap">${e.objectId}</td><td class="small">${e.summary}</td><td class="small muted nowrap">${e.ip}<br>${e.device}</td><td class="mono" title="${e.hash}">${e.hash.slice(0, 10)}…</td></tr>`; })}
      </tbody></table></div>
      ${rows.length > limit ? h`<button class="btn mt-16" data-act="tab" data-key="limit" data-tab="${limit + 100}">Show more (${rows.length - limit} older)</button>` : ''}`;
  }
  Q.on['audit-search'] = Q.debounce(function (el) { Q.setQuery({ q: el.value }); var i = document.querySelector('[data-input="audit-search"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
  Q.act['chain-verify'] = function () { Q.ui.chain = Q.verifyChain(); Q.toast(Q.ui.chain.ok ? 'Chain verified: ' + Q.ui.chain.count + ' entries, no gaps' : 'Chain broken at entry ' + Q.ui.chain.brokenAt, Q.ui.chain.ok ? '' : 'warn'); Q.render({ keepScroll: true }); };
  Q.act.tamper = function () {
    if (!confirm('Run the tamper test? This simulates a database super-admin quietly editing one old audit entry, to show the verifier catches it. You can undo it.')) return;
    var e = Q.S.audit[Math.floor(Q.S.audit.length / 3)];
    Q.ui.tamper = { seq: e.seq, summary: e.summary };
    e.summary = e.summary + ' (edited)';
    Q.ui.chain = Q.verifyChain(); Q.save(); Q.toast('Verifier: chain broken at entry ' + Q.ui.chain.brokenAt + '. Security alert raised.', 'warn'); Q.render({ keepScroll: true });
  };
  Q.act['tamper-undo'] = function () { var t = Q.ui.tamper; var e = Q.S.audit.find(function (x) { return x.seq === t.seq; }); e.summary = t.summary; Q.ui.tamper = null; Q.ui.chain = Q.verifyChain(); Q.save(); Q.toast('Tamper test undone; chain verified'); Q.render({ keepScroll: true }); };
  Q.act['audit-row'] = function (el) {
    var e = Q.S.audit.find(function (x) { return x.seq === +el.getAttribute('data-seq'); });
    Q.drawer.open({ kicker: 'Audit entry #' + e.seq, title: e.summary, foot: h`<button class="btn" type="button" data-act="drawer-close">Close</button>`,
      body: h`<dl class="dl mb-16"><div><dt>Time (UTC)</dt><dd>${Q.fmtUtc(e.at)}</dd></div><div><dt>Actor</dt><dd>${e.actor === 'system' ? 'System' : Q.fullName(e.actor)}${e.onBehalfOf ? ' on behalf of ' + Q.fullName(e.onBehalfOf) : ''}</dd></div><div><dt>Action</dt><dd>${e.action}</dd></div><div><dt>Object</dt><dd>${e.objectType} · ${e.objectId}</dd></div><div><dt>IP address</dt><dd>${e.ip}</dd></div><div><dt>Device</dt><dd>${e.device}</dd></div></dl>
        <div class="label mb-8">Before</div><div class="code-block mb-16">${e.before ? JSON.stringify(e.before, null, 2) : '—'}</div><div class="label mb-8">After</div><div class="code-block mb-16">${e.after ? JSON.stringify(e.after, null, 2) : '—'}</div>
        <div class="label mb-8">Previous hash</div><div class="mono mb-16">${e.prevHash}</div><div class="label mb-8">Entry hash</div><div class="mono">${e.hash}</div>` });
  };
  Q.act['audit-export'] = function () {
    var rows = [['Seq', 'Time (UTC)', 'Actor', 'On behalf of', 'Action', 'Object type', 'Object', 'Summary', 'Before', 'After', 'IP', 'Device', 'Previous hash', 'Hash']];
    Q.S.audit.forEach(function (e) { rows.push([e.seq, e.at, e.actor === 'system' ? 'System' : Q.fullName(e.actor), e.onBehalfOf ? Q.fullName(e.onBehalfOf) : '', e.action, e.objectType, e.objectId, e.summary, e.before ? JSON.stringify(e.before) : '', e.after ? JSON.stringify(e.after) : '', e.ip, e.device, e.prevHash, e.hash]); });
    Q.exportCsv('audit-trail.csv', rows, 'audit trail');
  };

  // ---------- Automations ----------
  function automations(q) {
    var tab = q.tab || 'rules';
    var failed = Q.S.deadLetter.filter(function (d) { return d.status === 'Failed'; });
    var body;
    if (tab === 'runs') body = Q.table({ id: 'runs', rows: Q.S.runs, defaultSort: 'at', defaultDir: -1, cols: [{ key: 'at', label: 'Time', render: function (r) { return Q.fmtDateTime(r.at); } }, { key: 'rule', label: 'Rule' }, { key: 'event', label: 'Event' }, { key: 'record', label: 'Record', render: function (r) { return r.record ? Q.recLink(r.record, { short: true }) : '—'; } }, { key: 'result', label: 'Result', render: function (r) { return Q.chip(r.result, r.result === 'Sent' || r.result === 'Done' ? 'chip-done' : 'chip-overdue'); } }, { key: 'detail', label: 'Detail', sort: false }] });
    else if (tab === 'failed') body = failed.length || Q.S.deadLetter.length ? h`<p class="muted">Jobs that failed after 6 tries with backoff. Nothing fails silently: retry once the connector is fixed.</p>
      ${Q.table({ id: 'dlq', rows: Q.S.deadLetter, defaultSort: 'at', defaultDir: -1, cols: [{ key: 'at', label: 'Failed', render: function (d) { return Q.fmtDateTime(d.at); } }, { key: 'rule', label: 'Rule' }, { key: 'record', label: 'Record', render: function (d) { return d.record ? Q.recLink(d.record, { short: true }) : '—'; } }, { key: 'channel', label: 'Channel' }, { key: 'target', label: 'Target' }, { key: 'attempts', label: 'Tries' }, { key: 'error', label: 'Error', sort: false, render: function (d) { return h`<span class="small">${d.error}</span>`; } }, { key: 'status', label: '', sort: false, render: function (d) { return d.status === 'Failed' && Q.can('admin.users') ? h`<button class="btn btn-sm" data-act="dlq-retry" data-id="${d.id}">Retry</button>` : Q.chip(d.status); } }] })}` : Q.empty('No failed automations', '');
    else if (tab === 'log') body = h`<p class="muted">Every notification sent, per channel, as evidence that people were told. Emails and Teams messages carry a summary and a deep link, never the document.</p>${Q.table({ id: 'nlog', rows: Q.S.notifLog.slice(0, 200).map(function (n) { return Object.assign({ who: Q.fullName(n.to) }, n); }), defaultSort: 'at', defaultDir: -1, empty: 'Nothing sent in this session yet. Act on a record to see entries here.',
      cols: [{ key: 'at', label: 'Time', render: function (n) { return Q.fmtDateTime(n.at); } }, { key: 'who', label: 'Recipient' }, { key: 'channel', label: 'Channel' }, { key: 'title', label: 'Message', render: function (n) { return h`<span class="small">${n.title}</span>`; } }, { key: 'status', label: 'Delivery', render: function (n) { return Q.chip(n.status, n.status === 'Delivered' ? 'chip-done' : 'chip-due'); } }, { key: 'note', label: 'Note', sort: false, render: function (n) { return h`<span class="small muted">${n.note}</span>`; } }] })}`;
    else body = h`${Q.table({ id: 'rules-a', rows: Q.S.rules, defaultSort: 'id', href: function (r) { return '#/admin/automations?rule=' + r.id; },
      cols: [{ key: 'id', label: 'ID', cls: 'id' }, { key: 'name', label: 'Rule', render: function (r) { return h`<b>${r.name}</b>${r.mandatory ? h` <span class="chip chip-outline">Mandatory</span>` : ''}<div class="small muted">When ${r.event.toLowerCase()} · ${r.conditions} → ${r.actions.join(', ').toLowerCase()}</div>`; } }, { key: 'channels', label: 'Channels', sort: false, render: function (r) { return h`<span class="small">${r.channels.join(', ')}</span>`; } }, { key: 'version', label: 'Version', render: function (r) { return 'v' + r.version; } }, { key: 'status', label: 'Status', render: function (r) { return Q.stateChip(r.status); } }, { key: 'runs', label: 'Runs' }] })}`;
    if (q.rule) Q.after(function () { var r = Q.S.rules.find(function (x) { return x.id === q.rule; }); if (r) openRule(r); });
    return h`<div class="spread mb-8" style="flex-wrap:wrap">${subTabs([['rules', 'Rules'], ['runs', 'Run history'], ['failed', 'Failed · ' + failed.length], ['log', 'Notification log']], tab)}
      ${tab === 'rules' ? h`<button class="btn btn-primary" data-act="rule-new">${Q.icon('plus', 'ico-sm')} New rule</button>` : ''}</div>
      ${tab === 'rules' ? h`<p class="muted">Event → condition → action. Rules are versioned, need Quality Manager approval before they go live, and every run is written to the audit trail.</p>` : ''}${body}`;
  }
  var EVENTS = ['Record created', 'State changed', 'Task assigned', 'Task completed', 'Task rejected or sent back', 'Due date approaching', 'Due date passed', 'Signature completed', 'Training rule activated', 'Periodic review due', 'Document became effective', 'Integration event received'];
  var ACTIONS = ['Notify', 'Create task', 'Reassign', 'Escalate', 'Move to next workflow stage', 'Create calendar entry', 'Publish to SharePoint', 'Send for DocuSign signature', 'Call a webhook'];
  function openRule(r) {
    var canApprove = r.status === 'Pending approval' && Q.hasRole('qm');
    Q.drawer.open({ wide: true, kicker: 'Automation rule · ' + r.id + ' v' + r.version, title: r.name,
      onClose: function () { if (Q.current.query.rule) Q.setQuery({ rule: '' }); },
      body: h`<div class="row-wrap mb-16">${Q.stateChip(r.status)}${r.mandatory ? Q.chip('Mandatory: users can’t switch it off', 'chip-outline') : ''}<span class="small muted">${r.approvedBy ? 'Approved by ' + Q.fullName(r.approvedBy) + ' · ' + Q.fmtDate(r.approvedAt) : 'Not approved yet'}</span></div>
        <div class="rule-flow mb-16"><div class="rf"><b>When</b>${r.event}</div><div class="arrow">${Q.icon('chevron')}</div><div class="rf"><b>If</b>${r.conditions}</div><div class="arrow">${Q.icon('chevron')}</div><div class="rf"><b>Then</b>${r.actions.join('; ')}<div class="small muted mt-8">${r.channels.join(', ')}</div></div></div>
        ${r.note ? h`<p class="small muted">${r.note}</p>` : ''}
        <dl class="dl"><div><dt>Runs</dt><dd>${r.runs}</dd></div><div><dt>Last run</dt><dd>${r.lastRun ? Q.fmtDateTime(r.lastRun) : '—'}</dd></div></dl>
        <hr><div class="label mb-8">Recent runs</div>${(function () { var rs = Q.S.runs.filter(function (x) { return x.rule === r.id; }).slice(0, 6); return rs.length ? rs.map(function (x) { return h`<div class="people-row small"><span>${Q.fmtDateTime(x.at)} · ${x.record || '—'} · ${x.detail}</span><span class="status-text ${x.result === 'Sent' || x.result === 'Done' ? 'st-done' : 'st-overdue'}">${x.result}</span></div>`; }) : h`<p class="small muted">No runs in this session.</p>`; })()}`,
      foot: h`${canApprove ? h`<button class="btn btn-primary" type="button" data-act="rule-approve" data-id="${r.id}">Approve and activate</button>` : ''}${Q.can('admin.automations') && !r.mandatory && r.status !== 'Pending approval' ? h`<button class="btn" type="button" data-act="rule-toggle" data-id="${r.id}">${r.status === 'Active' ? 'Switch off (needs approval)' : 'Switch on (needs approval)'}</button>` : ''}<button class="btn" type="button" data-act="drawer-close">Close</button>` });
  }
  Q.act['rule-approve'] = function (el) {
    var r = Q.S.rules.find(function (x) { return x.id === el.getAttribute('data-id'); });
    Q.drawer.close();
    Q.sign({ items: [{ id: r.id, version: String(r.version), hash: Q.sha256(Q.canon(r)) }], meaning: 'Approved', meanings: ['Approved'], title: 'Approve automation rule ' + r.id,
      onSigned: function () { r.status = r.pendingOff ? 'Off' : 'Active'; r.pendingOff = false; r.approvedBy = Q.S.session.userId; r.approvedAt = new Date().toISOString(); Q.audit('state', 'Automation rule', r.id, r.id + ' v' + r.version + ' approved: ' + r.status); Q.toast(r.id + ' is ' + r.status.toLowerCase()); } });
  };
  Q.act['rule-toggle'] = function (el) {
    var r = Q.S.rules.find(function (x) { return x.id === el.getAttribute('data-id'); });
    r.pendingOff = r.status === 'Active'; r.version++; r.status = 'Pending approval'; r.approvedBy = null;
    Q.audit('version', 'Automation rule', r.id, 'Created ' + r.id + ' v' + r.version + ' (' + (r.pendingOff ? 'switch off' : 'switch on') + '); waiting for approval');
    Q.drawer.close(); Q.toast('New version v' + r.version + ' waiting for Quality Manager approval'); Q.refresh();
  };
  Q.act['rule-new'] = function () {
    Q.drawer.open({ wide: true, kicker: 'Automations · no code', title: 'New automation rule', submitLabel: 'Submit for approval',
      body: h`<div class="form-grid"><div class="field full"><label for="an">Name</label><input class="input" id="an" name="name" placeholder="e.g. Tell the Supplier team about supplier CAPAs"></div>
        <div class="field"><label for="ae">When (event)</label><select class="select" id="ae" name="event">${EVENTS.map(function (e) { return h`<option>${e}</option>`; })}</select></div>
        <div class="field"><label for="am">Module</label><select class="select" id="am" name="module"><option>Any module</option><option>Documents</option><option>Training</option><option>Change requests</option><option>Quality events</option><option>CAPA</option><option>Periodic reviews</option></select></div>
        <div class="field"><label for="asv">Severity</label><select class="select" id="asv" name="severity"><option>Any</option><option>High</option><option>Low</option></select></div>
        <div class="field"><label for="acl">Classification</label><select class="select" id="acl" name="cls"><option>Any</option>${Q.CLASSES.map(function (c) { return h`<option>${c}</option>`; })}</select></div>
        <div class="field"><label for="aa2">Then (action)</label><select class="select" id="aa2" name="action">${ACTIONS.map(function (a) { return h`<option>${a}</option>`; })}</select></div>
        <div class="field"><label for="aw">Who</label><select class="select" id="aw" name="who"><option>Record owner</option><option>Task owner</option><option>Task owner’s manager</option><option>Quality Manager</option><option>Next stage</option><option>Teams channel #quality-events</option></select></div>
        <fieldset class="full"><legend>Channels</legend><div class="row-wrap">${['Email', 'Teams', 'In-app', 'Push'].map(function (c) { return h`<label class="check" style="margin-right:12px"><input type="checkbox" data-multi name="channels" value="${c}" ${c === 'In-app' || c === 'Email' ? 'checked' : ''}> ${c}</label>`; })}</div></fieldset></div>
        <div class="callout mt-16"><strong>Goes live only after approval</strong><p class="small" style="margin:4px 0 0">Rules change how controlled processes run, so a Quality Manager signs each version before it’s active.</p></div>`,
      submit: function (f, form) {
        if (!f.name) return Q.fieldError(form, 'name', 'Give the rule a name.');
        var id = Q.nextId('RULE');
        var cond = [f.module, f.severity !== 'Any' ? 'severity ' + f.severity : null, f.cls !== 'Any' ? f.cls : null].filter(Boolean).join(' · ');
        Q.S.rules.push({ id: id, name: f.name, event: f.event, conditions: cond, actions: [f.action + ' ' + f.who.toLowerCase()], channels: f.channels, status: 'Pending approval', version: 1, approvedBy: null, runs: 0, createdBy: Q.S.session.userId, createdAt: new Date().toISOString() });
        Q.audit('create', 'Automation rule', id, 'Created automation rule ' + id + ' ' + f.name + ' (pending approval)');
        Q.drawer.close(); Q.toast(id + ' submitted for approval'); Q.refresh();
      } });
  };
  Q.act['dlq-retry'] = function (el) {
    var d = Q.S.deadLetter.find(function (x) { return x.id === el.getAttribute('data-id'); });
    var conn = /Teams/.test(d.channel) ? 'teams' : /SharePoint/.test(d.channel) ? 'sp-pub' : null;
    d.attempts++;
    if (!conn || Q.integrationOn(conn)) { d.status = 'Retried · sent'; Q.audit('automation', 'Dead-letter', d.id, 'Manual retry of ' + d.id + ' succeeded'); Q.toast('Retried and sent'); }
    else { Q.audit('automation', 'Dead-letter', d.id, 'Manual retry of ' + d.id + ' failed: connector still off'); Q.toast('Still failing: the ' + d.channel + ' connector is off. Switch it on in Integrations first.', 'warn'); }
    if (!Q.S.deadLetter.some(function (x) { return x.status === 'Failed'; })) Q.closeTasks(function (t) { return t.record === 'ADMIN-DLQ'; });
    Q.refresh();
  };

  // ---------- Integrations ----------
  function integrations() {
    return h`<p class="muted">Each connector is separate and switchable. If one is down, the core QMS keeps working and failed items queue for retry. Secrets live in Azure Key Vault and every call is audited.</p>
      <div class="grid-2">${Q.S.integrations.map(function (i) {
        var hl = { ok: ['h-ok', 'Healthy'], warn: ['h-warn', 'Degraded'], bad: ['h-bad', 'Failing'], off: ['h-off', 'Off'] }[i.on ? i.health === 'off' ? 'warn' : i.health : 'off'];
        return h`<div class="card card-pad"><div class="spread mb-8"><h2>${i.name}</h2><label class="switch"><input type="checkbox" data-change="int-toggle" data-id="${i.id}" ${i.on ? 'checked' : ''} aria-label="Turn ${i.name} ${i.on ? 'off' : 'on'}"></label></div>
          <div class="row-wrap mb-16"><span class="health ${hl[0]}">${hl[1]}</span>${Q.chip(i.phase, 'chip-outline')}</div>
          <dl class="dl one"><div><dt>How it connects</dt><dd class="small">${i.mech}</dd></div><div><dt>Least permission</dt><dd class="small">${i.perms}</dd></div></dl>
          <dl class="dl mt-16"><div><dt>Last success</dt><dd>${i.lastOk ? Q.fmtDateTime(i.lastOk) : '—'}</dd></div><div><dt>Failures / retry queue</dt><dd>${i.failures} / ${i.queue}</dd></div></dl>
          ${i.note ? h`<p class="small muted mt-8" style="margin-bottom:0">${i.note}</p>` : ''}
          <div class="btn-row mt-16"><button class="btn btn-sm" data-act="int-test" data-id="${i.id}">Test connection</button>${i.queue ? h`<button class="btn btn-sm" data-act="int-retry" data-id="${i.id}">Retry ${i.queue} queued</button>` : ''}</div></div>`;
      })}</div>`;
  }
  Q.on['int-toggle'] = function (el) {
    var i = Q.S.integrations.find(function (x) { return x.id === el.getAttribute('data-id'); });
    i.on = el.checked; i.health = i.on ? 'ok' : 'off'; if (i.on) i.lastOk = new Date().toISOString();
    Q.audit('config', 'Integration', i.id, (i.on ? 'Switched on ' : 'Switched off ') + i.name, { on: !i.on }, { on: i.on });
    Q.toast(i.name + (i.on ? ' on (prototype: simulated connection)' : ' off')); Q.refresh();
  };
  Q.act['int-test'] = function (el) { var i = Q.S.integrations.find(function (x) { return x.id === el.getAttribute('data-id'); }); Q.audit('integration', 'Integration', i.id, 'Connection test: ' + (i.on ? 'OK' : 'connector off')); Q.save(); Q.toast(i.on ? i.name + ': connection OK' : i.name + ' is switched off', i.on ? '' : 'warn'); };
  Q.act['int-retry'] = function (el) {
    var i = Q.S.integrations.find(function (x) { return x.id === el.getAttribute('data-id'); });
    if (!i.on) { Q.toast('Switch the connector on first.', 'warn'); return; }
    Q.S.deadLetter.forEach(function (d) { if (d.status === 'Failed' && ((i.id === 'teams' && /Teams/.test(d.channel)) || (i.id === 'sp-pub' && /SharePoint/.test(d.channel)))) { d.status = 'Retried · sent'; d.attempts++; } });
    Q.S.notifLog.forEach(function (n) { if (i.id === 'teams' && n.channel === 'teams' && n.status === 'Queued') n.status = 'Delivered'; });
    i.queue = 0; i.failures = 0; Q.audit('integration', 'Integration', i.id, 'Retried queued items for ' + i.name);
    if (!Q.S.deadLetter.some(function (x) { return x.status === 'Failed'; })) Q.closeTasks(function (t) { return t.record === 'ADMIN-DLQ'; });
    Q.toast('Queue retried'); Q.refresh();
  };

  // ---------- Templates ----------
  function templates() {
    return h`<div class="spread mb-16"><p class="muted" style="margin:0">Templates are version-controlled. Documents record which template version they came from.</p>${Q.can('admin.templates') && !Q.readOnly() ? h`<button class="btn btn-primary" data-act="tpl-new">${Q.icon('plus', 'ico-sm')} New template</button>` : ''}</div>
      ${Q.table({ id: 'tpl', rows: Q.S.templates, defaultSort: 'id', cols: [{ key: 'id', label: 'ID', cls: 'id' }, { key: 'name', label: 'Name' }, { key: 'kind', label: 'For' }, { key: 'version', label: 'Version', render: function (t) { return 'v' + t.version; } }, { key: 'state', label: 'State', render: function (t) { return Q.stateChip(t.state); } }, { key: 'sections', label: 'Sections', sort: false, render: function (t) { return h`<span class="small muted">${t.sections.join(' · ')}</span>`; } }, { key: 'updated', label: 'Updated', render: function (t) { return Q.fmtDate(t.updated); } }] })}`;
  }
  Q.act['tpl-new'] = function () {
    Q.drawer.open({ kicker: 'Templates library', title: 'New template', submitLabel: 'Save as draft',
      body: h`<div class="field mb-16"><label for="tn">Name</label><input class="input" id="tn" name="name"></div><div class="field mb-16"><label for="tk">For</label><select class="select" id="tk" name="kind"><option>Document</option><option>Change request</option><option>CAPA</option><option>Quality event</option></select></div>
        <div class="field"><label for="ts">Sections (one per line)</label><textarea class="textarea" id="ts" name="sections">1. Purpose\n2. Scope\n3. Requirements</textarea></div><p class="small muted mt-16">Templates go through the document lifecycle before they can be used.</p>`,
      submit: function (f, form) { if (!f.name) return Q.fieldError(form, 'name', 'Name the template.'); var id = Q.nextId('TPL'); Q.S.templates.push({ id: id, name: f.name, kind: f.kind, docType: 'Policy', version: '0.1', state: 'Draft', updated: new Date().toISOString(), sections: f.sections.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) }); Q.audit('create', 'Template', id, 'Created template ' + id + ' ' + f.name); Q.drawer.close(); Q.refresh(); } });
  };

  // ---------- Workflows ----------
  function workflows() {
    return h`<p class="muted">One engine drives every module. Definitions are versioned JSON; a new version needs Quality Manager approval, and running records keep the version they started on. Guards run in the API, never in the browser.</p>
      ${Q.S.workflows.map(function (w) {
        return h`<div class="card card-pad mb-16"><div class="spread mb-8" style="flex-wrap:wrap"><div><h2>${w.name}</h2><div class="small muted">${w.module} · v${w.version}${w.approvedBy ? ' · approved by ' + Q.fullName(w.approvedBy) : ''}</div></div><div class="row-wrap">${Q.stateChip(w.status)}${w.status === 'Pending approval' && Q.hasRole('qm') ? h`<button class="btn btn-sm btn-primary" data-act="wf-approve" data-id="${w.id}">Approve and sign</button>` : ''}</div></div>
          <div class="wf-states mb-16">${w.states.map(function (s, i) { return h`${i ? h`<span class="arrow">→</span>` : ''}${Q.chip(s, 'chip-outline')}`; })}</div>
          ${w.transitions.length ? h`<div class="table-wrap"><table class="t"><thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Who can</th><th scope="col">Signature</th><th scope="col">Segregation of duties</th><th scope="col">Required fields</th><th scope="col">SLA</th></tr></thead><tbody>${w.transitions.map(function (t) { return h`<tr><td>${t.from}</td><td>${t.to}</td><td class="small">${t.roles}</td><td class="small">${t.sig || '—'}</td><td class="small">${t.sod || '—'}</td><td class="small">${t.fields || '—'}</td><td class="small">${t.sla || '—'}</td></tr>`; })}</tbody></table></div>` : h`<p class="small muted" style="margin:0">Draft definition: adds a Legal review stage for contract documents.</p>`}</div>`;
      })}`;
  }
  Q.act['wf-approve'] = function (el) {
    var w = Q.S.workflows.find(function (x) { return x.id === el.getAttribute('data-id'); });
    Q.sign({ items: [{ id: w.id, version: String(w.version), hash: Q.sha256(Q.canon(w)) }], meaning: 'Approved', meanings: ['Approved'], title: 'Approve workflow ' + w.name,
      onSigned: function () { w.status = 'Active'; w.approvedBy = Q.S.session.userId; Q.audit('state', 'Workflow', w.id, 'Workflow ' + w.id + ' v' + w.version + ' approved; new records use it, running ones keep their version'); Q.toast('Workflow approved'); } });
  };

  // ---------- Settings ----------
  function settings() {
    var st = Q.S.settings, isQm = Q.hasRole('qm'), isAdmin = Q.hasRole('admin');
    var row = function (label, ctrl, help) { return h`<div class="spread" style="padding:10px 0;border-bottom:1px solid var(--border);align-items:flex-start;gap:24px"><div><div style="font-weight:600">${label}</div>${help ? h`<div class="small muted" style="max-width:560px">${help}</div>` : ''}</div><div>${ctrl}</div></div>`; };
    var sw = function (key, val, dis) { return h`<label class="switch"><input type="checkbox" data-change="set-toggle" data-key="${key}" ${val ? 'checked' : ''} ${dis ? 'disabled' : ''} aria-label="${key}"></label>`; };
    return h`<div class="stack">
      <form class="card card-pad" data-submit="set-statement"><h2 class="mb-8">Electronic signatures</h2>
        <div class="field"><label for="ss">Signature statement</label><textarea class="textarea" id="ss" name="statement" ${isQm ? '' : 'disabled'}>${st.statement}</textarea><div class="help">Use {meaning} where the meaning goes. Agreed by the Quality Manager.</div></div>
        ${isQm ? h`<button class="btn mt-8" type="submit">Save statement</button>` : ''}
        ${row('Fresh sign-in for every signature', sw('x', true, true), 'Always on. Each signing action needs its own re-authentication with MFA; an existing session is never enough.')}
        ${row('Batch signing', sw('x2', true, true), 'One fresh sign-in covers a listed set of records; each record still gets its own signature row.')}
        ${row('Biometrics as part of a signature', sw('x3', false, true), 'Off by decision: face or fingerprint only unlocks the mobile app.')}</form>
      <div class="card card-pad"><h2 class="mb-8">Segregation of duties</h2>
        ${row('Authors cannot approve their own documents', sw('sod.authorCannotApprove', st.sod.authorCannotApprove, !isAdmin), 'Overrides need a named admin, a reason and a signature, and are logged.')}
        ${row('System Administrators cannot approve quality records', sw('sod.adminCannotApprove', st.sod.adminCannotApprove, !isAdmin))}
        ${row('Two-person rule for privileged roles', sw('twoPerson', st.twoPerson !== false, !isAdmin), 'Granting Approver, Quality Manager or System Administrator needs a second admin (Step 3, decision R3). Needs at least two admins.')}
        ${row('Delegates can sign approvals', sw('x4', false, true), 'Off by decision: delegates can review only.')}</div>
      <div class="card card-pad"><h2 class="mb-8">Classification and handling</h2>
        <div class="table-wrap"><table class="t"><thead><tr><th scope="col">Class</th><th scope="col">Download</th><th scope="col">Print</th><th scope="col">Watermark</th><th scope="col">Rule</th></tr></thead><tbody>${Q.CLASSES.map(function (c) { var x = st.classes[c]; return h`<tr><td>${Q.cls(c)}</td><td>${x.download ? 'Yes' : 'Clearance only'}</td><td>${x.print ? 'Yes' : 'No'}</td><td>${x.watermark ? 'Viewer name + date' : 'No'}</td><td class="small">${x.desc}</td></tr>`; })}</tbody></table></div>
        <p class="small muted mt-8" style="margin-bottom:0">No public links, ever. Every export is logged. Push notifications mask Confidential and Restricted titles.</p></div>
      <div class="card card-pad"><h2 class="mb-8">Escalation and reminders</h2>
        ${row('Reminders before due date', h`<span>${st.reminders.join(' and ')} days before</span>`)}
        ${row('Overdue: owner and manager', h`<span>Day ${st.escalation.firstDays}, then every ${st.escalation.repeatDays} days</span>`)}
        ${row('Overdue: Quality Manager step', sw('escalation.qmStep', st.escalation.qmStep, !isQm), 'Switch on once a Quality Manager is appointed (rule RULE-08).')}</div>
      <div class="card card-pad"><h2 class="mb-8">Regulated record types (21 CFR Part 11 / EU Annex 11)</h2><p class="small muted">Off by default. When on, adds stricter signature display and audit-trail review; records under it need formal validation.</p>
        ${Object.keys(st.regulated).map(function (k) { return row(k, sw('regulated.' + k, st.regulated[k], !isQm)); })}</div>
      <div class="card card-pad"><h2 class="mb-8">AI change summary</h2>
        ${row('Draft change summaries with AI', sw('ai.enabled', st.ai.enabled, true), 'Off until an AI provider is approved under the AI usage policy. When on, never used for Confidential or Restricted documents, and every call is logged.')}</div>
      <div class="card card-pad"><h2 class="mb-8">Retention and legal hold</h2>
        <div class="table-wrap mb-16"><table class="t"><thead><tr><th scope="col">Record type</th><th scope="col">Keep for</th><th scope="col">Then</th></tr></thead><tbody>${st.retention.map(function (r) { return h`<tr><td>${r.type}</td><td>${r.keep}</td><td>${r.after}</td></tr>`; })}</tbody></table></div>
        <div class="label mb-8">Legal holds</div>${st.legalHolds.map(function (l) { return h`<div class="people-row"><span>${Q.recLink(l.record)} · ${l.reason}</span><span class="small muted">${Q.fullName(l.by)} · ${Q.fmtDate(l.at)}</span></div>`; })}
        <p class="small muted mt-8" style="margin-bottom:0">Quality records are never hard-deleted. Records on legal hold are excluded from retention deletion.</p></div>
      <div class="card card-pad"><h2 class="mb-8">Security</h2>
        ${row('Session timeout', h`<span>${st.sessionTimeout} minutes</span>`)}
        ${row('Leaver access removed within', h`<span>${st.leaverTarget} minutes (revoke-now: at once)</span>`)}
        ${row('Audit anchor interval', h`<select class="select" style="width:auto" data-change="set-anchor" ${isAdmin ? '' : 'disabled'}><option value="15" ${st.anchorMinutes === 15 ? 'selected' : ''}>Every 15 minutes</option><option value="5" ${st.anchorMinutes === 5 ? 'selected' : ''}>Every 5 minutes</option></select>`, 'Step 3, decision R4: shorter intervals shrink the window for undetected rewrites.')}</div>
      <div class="card card-pad"><h2 class="mb-8">Support owners</h2><p class="small muted">The Support Owner role is transferable; you can add up to 3 more people.</p>
        ${st.supportOwners.map(function (u) { return Q.peopleRow(u, 'Support Owner', 'Active', 'st-done'); })}
        ${isQm && st.supportOwners.length < 4 ? h`<form class="row mt-16" data-submit="set-support"><select class="select" name="u" aria-label="Person">${Q.activeUsers().filter(function (u) { return st.supportOwners.indexOf(u.id) < 0 && u.roles.indexOf('auditor') < 0; }).map(function (u) { return h`<option value="${u.id}">${u.name}</option>`; })}</select><button class="btn" type="submit">Add</button></form>` : ''}</div>
    </div>`;
  }
  function setPath(obj, path, val) { var p = path.split('.'); var o = obj; for (var i = 0; i < p.length - 1; i++) o = o[p[i]]; var b = o[p[p.length - 1]]; o[p[p.length - 1]] = val; return b; }
  Q.on['set-toggle'] = function (el) { var k = el.getAttribute('data-key'); var b = setPath(Q.S.settings, k, el.checked); Q.audit('config', 'Setting', k, 'Changed setting ' + k + ' to ' + (el.checked ? 'on' : 'off'), { value: b }, { value: el.checked }); Q.toast('Setting saved · logged'); Q.refresh(); };
  Q.on['set-statement'] = function (form) { var f = Q.formData(form); if (!f.statement || f.statement.indexOf('{meaning}') < 0) return Q.fieldError(form, 'statement', 'Keep {meaning} in the statement.'); var b = Q.S.settings.statement; Q.S.settings.statement = f.statement; Q.audit('config', 'Setting', 'signature.statement', 'Changed the signature statement', { text: b }, { text: f.statement }); Q.toast('Statement saved'); Q.refresh(); };
  Q.on['set-anchor'] = function (el) { var b = Q.S.settings.anchorMinutes; Q.S.settings.anchorMinutes = +el.value; Q.audit('config', 'Setting', 'audit.anchor', 'Audit anchor interval set to ' + el.value + ' minutes', { minutes: b }, { minutes: +el.value }); Q.toast('Saved'); Q.refresh(); };
  Q.on['set-support'] = function (form) { var u = Q.formData(form).u; Q.S.settings.supportOwners.push(u); Q.audit('role.change', 'User', u, 'Added ' + Q.fullName(u) + ' as a Support Owner'); Q.toast('Support Owner added'); Q.refresh(); };
})(window.Q);
