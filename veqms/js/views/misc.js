/* Notifications, profile and preferences, help centre, search results, and the mobile "Raise" screen. */
(function (Q) {
  'use strict';
  var h = Q.h;

  // ---------- Notifications ----------
  Q.views.notifications = function (p, q) {
    var me = Q.S.session.userId;
    var f = q.f || 'all';
    var list = Q.S.notifications.filter(function (n) { return n.to === me; });
    if (f === 'action') list = list.filter(function (n) { return n.kind === 'action' || n.kind === 'overdue'; });
    if (f === 'fyi') list = list.filter(function (n) { return n.kind === 'fyi' || n.kind === 'info' || n.kind === 'reminder' || n.kind === 'warn'; });
    if (f === 'security') list = list.filter(function (n) { return n.kind === 'security'; });
    list.sort(Q.by('at', -1));
    var icon = { action: 'sign', overdue: 'clock', fyi: 'eye', info: 'bell', reminder: 'clock', security: 'shieldAlert', warn: 'back' };
    return h`<div class="page-head"><div><h1>Notifications</h1><div class="sub">${Q.unread()} unread · emails and Teams messages carry a summary and a link, never the document</div></div>
      <div class="btn-row"><button class="btn" data-act="notif-allread">Mark all as read</button><a class="btn" href="#/profile?tab=notifications">Preferences</a></div></div>
      <div class="seg mb-16" role="group" aria-label="Filter">${[['all', 'All'], ['action', 'Action needed'], ['fyi', 'FYI'], ['security', 'Security']].map(function (o) { return h`<button class="${f === o[0] ? 'active' : ''}" data-act="tab" data-key="f" data-tab="${o[0]}">${o[1]}</button>`; })}</div>
      ${list.length ? h`<div class="card" style="overflow:hidden">${list.map(function (n) {
        return h`<div class="notif ${n.read ? '' : 'unread'}"><span class="${n.kind === 'overdue' || n.kind === 'security' ? 'st-overdue' : 'muted'}" style="margin-top:2px">${Q.icon(icon[n.kind] || 'bell')}</span>
          <div class="n-main"><div class="n-title">${n.record || n.href ? h`<a href="#" data-act="notif-open" data-id="${n.id}" style="color:inherit">${n.title}</a>` : n.title}</div><div class="small">${n.body}</div>
            <div class="n-meta">${Q.ago(n.at)} · ${n.channels.map(function (c) { return { 'in-app': 'In-app', email: 'Email', teams: 'Teams', push: 'Push' }[c]; }).join(' · ')}${n.mandatory ? ' · mandatory' : ''}</div></div>
          ${n.read ? '' : h`<span class="sr-only">Unread</span><span class="dot" style="position:static;margin-top:8px" aria-hidden="true"></span>`}</div>`;
      })}</div>` : Q.empty('No notifications', 'You’re all caught up.')}`;
  };
  Q.act['notif-open'] = function (el) {
    var n = Q.S.notifications.find(function (x) { return x.id === el.getAttribute('data-id'); });
    n.read = true; Q.save();
    if (n.record && Q.kindOf(n.record) === 'doc' && Q.S.tasks.some(function (t) { return t.kind === 'training' && t.record === n.record && t.assignee === Q.S.session.userId && t.status === 'open'; }) && /training/i.test(n.title)) Q.go('#/training?doc=' + n.record);
    else Q.go(n.href || Q.recHref(n.record));
  };
  Q.act['notif-allread'] = function () { var me = Q.S.session.userId; Q.S.notifications.forEach(function (n) { if (n.to === me) n.read = true; }); Q.refresh(); };

  // ---------- Profile and preferences ----------
  Q.views.profile = function (p, q) {
    var me = Q.me(), pr = Q.prefs();
    var tab = q.tab || 'notifications';
    var mineDel = Q.S.delegations.filter(function (d) { return d.from === me.id || d.to === me.id; });
    var tabs = [['notifications', 'Notifications'], ['delegation', 'Delegation'], ['account', 'Account and privacy']];
    var body;
    if (tab === 'delegation') {
      body = h`<div class="card card-pad mb-16"><h2 class="mb-8">Out of office</h2><p class="muted">Delegate your tasks to a named backup for a date range. Delegates can review, but they can’t sign approvals. Their actions are logged as “X on behalf of you”.</p>
        <form data-submit="del-add" class="form-grid"><div class="field"><label for="dto">Delegate</label><select class="select" id="dto" name="to">${Q.activeUsers().filter(function (u) { return u.id !== me.id && u.roles.indexOf('auditor') < 0; }).map(function (u) { return h`<option value="${u.id}">${u.name}</option>`; })}</select></div>
          <div class="field"><label for="dr">Reason</label><input class="input" id="dr" name="reason" placeholder="e.g. Annual leave"></div>
          <div class="field"><label for="ds">From</label><input class="input" type="date" id="ds" name="start" value="${Q.dayIso(1).slice(0, 10)}"></div><div class="field"><label for="de">To</label><input class="input" type="date" id="de" name="end" value="${Q.dayIso(8).slice(0, 10)}"></div>
          <div class="full btn-row"><button class="btn btn-primary" type="submit">Add delegation</button><button class="btn" type="button" disabled title="Later phase: reads Outlook automatic replies through Microsoft Graph">Suggest from Outlook out-of-office</button></div></form></div>
        ${mineDel.length ? h`<div class="list-rows">${mineDel.map(function (d) { return h`<div class="list-row"><div class="lr-main"><b>${Q.fullName(d.from)} → ${Q.fullName(d.to)}</b><div class="small muted">${Q.fmtDate(d.start)} to ${Q.fmtDate(d.end)} · ${d.scope} · ${d.reason || ''}</div></div>${Q.chip(d.scope, 'chip-outline')}</div>`; })}</div>` : ''}`;
    } else if (tab === 'account') {
      body = h`<div class="card card-pad mb-16"><h2 class="mb-8">${me.name}</h2><dl class="dl"><div><dt>Email</dt><dd>${me.email}</dd></div><div><dt>Job title</dt><dd>${me.title}</dd></div><div><dt>Roles</dt><dd>${me.roles.map(function (r) { return Q.ROLE_LABEL[r]; }).join(', ')}</dd></div><div><dt>Clearance</dt><dd>${Q.cls(me.clearance)}</dd></div><div><dt>Site and time zone</dt><dd>${me.site} · times shown in your local time zone</dd></div><div><dt>Signed in</dt><dd>${Q.fmtDateTime(Q.S.session.signedInAt)} · SSO + MFA</dd></div></dl>
          <div class="btn-row mt-16"><button class="btn" data-act="theme">${Q.isDark() ? 'Light mode' : 'Dark mode'}</button><button class="btn" data-act="tour">Take the tour</button></div></div>
        <div class="card card-pad mb-16"><h2 class="mb-8">Your data</h2><p class="muted">Under UK GDPR you can get a copy of the personal data VeQMS holds about you, and ask for corrections.</p><div class="btn-row"><button class="btn" data-act="sar-export">Download my data (CSV)</button><a class="btn" href="#/help?a=privacy">Privacy notice</a></div></div>
        <div class="card card-pad"><h2 class="mb-8">Demo</h2><p class="muted">This prototype stores everything in this browser only. Reset it to start again with the sample records.</p><button class="btn btn-danger" data-act="reset-demo">Reset demo data</button></div>`;
    } else {
      var sw = function (key, val, label, help, locked) { return h`<div class="spread" style="padding:10px 0;border-bottom:1px solid var(--border);gap:16px"><div><div style="font-weight:600">${label}</div>${help ? h`<div class="small muted">${help}</div>` : ''}</div><label class="switch"><input type="checkbox" data-change="pref" data-key="${key}" ${val ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="${label}"></label></div>`; };
      body = h`<div class="card card-pad mb-16"><h2 class="mb-8">Channels</h2>${sw('email', pr.email, 'Email', 'From the QMS mailbox, with a summary and a deep link')}${sw('teams', pr.teams, 'Microsoft Teams', 'Personal messages from the QMS bot (Phase 6)')}${sw('push', pr.push, 'Mobile push', 'Generic text on the lock screen; details after unlock')}${sw('fyiEmail', pr.fyiEmail, 'FYI notices by email', 'Otherwise FYIs are in-app only')}${sw('calendar', pr.calendar, 'Add due dates to my Outlook calendar')}</div>
        <div class="card card-pad mb-16"><h2 class="mb-8">Digest and quiet hours</h2>
          <div class="form-grid"><div class="field"><label for="dg">Digest</label><select class="select" id="dg" data-change="pref-sel" data-key="digest"><option value="none" ${pr.digest === 'none' ? 'selected' : ''}>Send each one as it happens</option><option value="daily" ${pr.digest === 'daily' ? 'selected' : ''}>Daily digest</option><option value="weekly" ${pr.digest === 'weekly' ? 'selected' : ''}>Weekly digest</option></select></div><div></div>
          <div class="field"><label for="qs1">Quiet hours from</label><input class="input" type="time" id="qs1" value="${pr.quietStart}" data-change="pref-sel" data-key="quietStart"></div><div class="field"><label for="qs2">to</label><input class="input" type="time" id="qs2" value="${pr.quietEnd}" data-change="pref-sel" data-key="quietEnd"></div></div>
          ${sw('quiet', pr.quiet, 'Use quiet hours', 'In your own time zone')}</div>
        <div class="card card-pad"><h2 class="mb-8">Always on</h2><p class="small muted">These can’t be switched off.</p>${sw('m1', true, 'Your turn to sign', '', true)}${sw('m2', true, 'Overdue tasks and escalations', '', true)}${sw('m3', true, 'Security alerts (new device, MFA or role change)', '', true)}</div>`;
    }
    return h`<div class="page-head"><div class="row">${Q.avatar(me.id, '')}<div><h1>${me.name}</h1><div class="sub">${me.title}</div></div></div></div>
      <div class="tabs" role="tablist">${tabs.map(function (t) { return h`<button class="tab ${tab === t[0] ? 'active' : ''}" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>${body}`;
  };
  Q.on.pref = function (el) { var p = Q.prefs(); p[el.getAttribute('data-key')] = el.checked; Q.audit('config', 'Preferences', Q.S.session.userId, 'Changed notification preference ' + el.getAttribute('data-key')); Q.save(); Q.toast('Saved'); };
  Q.on['pref-sel'] = function (el) { var p = Q.prefs(); p[el.getAttribute('data-key')] = el.value; Q.save(); Q.toast('Saved'); };
  Q.on['del-add'] = function (form) {
    var f = Q.formData(form);
    if (!f.start || !f.end || f.end < f.start) return Q.fieldError(form, 'end', 'The end date must be after the start date.');
    var d = { id: Q.uid('DEL'), from: Q.S.session.userId, to: f.to, start: new Date(f.start + 'T00:00:00').toISOString(), end: new Date(f.end + 'T23:59:00').toISOString(), scope: 'Review only', reason: f.reason };
    Q.S.delegations.push(d); Q.audit('delegation', 'User', d.from, 'Delegated review tasks to ' + Q.fullName(f.to) + ' from ' + f.start + ' to ' + f.end + ' (review only)');
    Q.notify({ to: f.to, kind: 'info', channels: ['in-app', 'email'], title: Q.fullName(d.from) + ' named you as their delegate', body: f.start + ' to ' + f.end + ' · review only' });
    Q.toast('Delegation added'); Q.refresh();
  };
  Q.act['sar-export'] = function () {
    var me = Q.me();
    var rows = [['Category', 'Item', 'Detail', 'When (UTC)']];
    rows.push(['Profile', 'Name', me.name, ''], ['Profile', 'Email', me.email, ''], ['Profile', 'Job title', me.title, ''], ['Profile', 'Site', me.site, '']);
    Q.S.assignments.filter(function (a) { return a.user === me.id; }).forEach(function (a) { rows.push(['Training record', a.doc + ' v' + a.ver, a.completed ? 'Completed' : 'Open', a.completed || a.assigned]); });
    Q.S.signatures.filter(function (s) { return s.user === me.id; }).forEach(function (s) { rows.push(['Signature', s.id + ' ' + s.record, s.meaning, s.at]); });
    Q.S.audit.filter(function (e) { return e.actor === me.id; }).forEach(function (e) { rows.push(['Audit trail', e.action, e.summary + ' · ' + e.ip, e.at]); });
    Q.exportCsv('my-data.csv', rows, 'subject access export for ' + me.name);
  };

  // ---------- Help centre ----------
  var ARTICLES = [
    { id: 'today', t: 'Your Today page', x: 'Everything assigned to you, grouped by urgency. Sign-offs open in Adobe Sign; training is confirmed in the app. Use the filters for Upcoming or Overdue, switch to “Created by me” to see who you’re waiting on, and save your own views.' },
    { id: 'sign', t: 'How approvals and signatures work', x: 'Every signature except read-and-understood training is made in Adobe Sign: document approvals (vendor approvals and validation deliverables included), change request plans, action sign-offs and completion, CAPA plans, actions, completed actions and closures, quality event closures, periodic reviews, making a document obsolete, access reviews and rule or workflow approvals. Each sign-off is one agreement with its signers in order. Adobe Sign checks each signer’s identity when they sign and records their reason for signing. The signed PDF, audit report and agreement ID are stored with the record. Approve buttons in email or Teams only open the app.' },
    { id: 'esign', t: 'Sending to Adobe Sign', x: 'For a document, the author checks the locked PDF at submit (footer, version, document ID and dates) and the agreement goes to Adobe Sign by itself when the last QA approver approves. For other sign-offs, whoever sends opens the PDF and ticks the same four checks. Each agreement uses one of the 500 Adobe Sign transactions a year; a correction after sending uses another, so check first. A declined or cancelled agreement returns the record with the reason recorded.' },
    { id: 'docs', t: 'Documents: from draft to effective', x: 'Every amendment starts as a change request: one opens with each new document or version and closes when it becomes Effective. Edit the Word file in the SharePoint Drafts library (in this prototype, a stand-in editor). Then submit in two steps: choose the reviewers and QA approvers and make the PDF (it is converted, hashed and locked), then open it, tick the four checks and submit. Reviewers mark it reviewed; QA approvers approve it here and decide whether people need retraining. Anyone on it can return it to you with a reason. The last approval sends one Adobe Sign agreement with every signer. When it completes, the version is Effective, published to the controlled SharePoint library, and training goes to the audience unless the approvers decided none is needed.' },
    { id: 'training', t: 'Completing training', x: 'Open the PDF of the version and read it (VeQMS records that you opened it; you can’t confirm until you have), answer the short knowledge check if there is one, then confirm the statement “I confirm I have read and understood” that document and version. You are signed in through Microsoft 365, so nobody can do this for you. The app sets the date and time, and the record is locked once made. It stays with you, even if you leave.' },
    { id: 'cr', t: 'Raising a change request', x: 'Describe what changes and why, say whether it’s major or minor, list the documents and actions, then submit it for review. The plan and the completion are each signed in Adobe Sign, and so is every action marked as needing a signature; other actions are marked done here.' },
    { id: 'quality', t: 'Observations, events and CAPA', x: 'Anyone can raise an observation, even offline on a phone. The process owner escalates it to a quality event or closes it with a reason. A CAPA plans corrective and preventive actions, finds the root cause and checks that the fix worked.' },
    { id: 'privacy', t: 'Privacy notice', x: 'VeQMS processes names, work email addresses, job roles, and device and IP data to run the quality system and keep an audit trail, under UK GDPR and the Data Protection Act 2018. The privacy notice text is owned by the Support Owner and must be published before real records go live (Gate 2).' }
  ];
  Q.views.help = function (p, q) {
    return h`<div class="page-head"><div><h1>Help centre</h1><div class="sub">Short answers in plain words. Each module also shows a first-run tip.</div></div><button class="btn btn-primary" data-act="tour">Take the tour</button></div>
      <div class="split"><div class="stack">${ARTICLES.map(function (a) { return h`<details class="card card-pad" ${q.a === a.id ? 'open' : ''}><summary style="cursor:pointer;font-weight:600;font-size:16px">${a.t}</summary><p class="mt-8" style="margin-bottom:0">${a.x}</p></details>`; })}</div>
      <aside class="context"><div class="card ctx-card"><span class="label">Keyboard</span><div class="people-row"><span>Command bar</span><span class="kbd">Ctrl K</span></div><div class="people-row"><span>Close a drawer or menu</span><span class="kbd">Esc</span></div><div class="people-row"><span>Move through results</span><span class="kbd">↑ ↓</span></div></div>
        <div class="card ctx-card"><span class="label">Support</span><p class="small" style="margin:0">Support Owner: ${Q.S.settings.supportOwners.map(Q.fullName).join(', ')}</p></div>
        <div class="card ctx-card"><span class="label">About this prototype</span><p class="small" style="margin:0">Frontend only. Sample data lives in this browser. Sign-in, Microsoft 365, Adobe Sign and malware scanning are simulated. Nothing here is “ISO 27001 compliant”: the app supports controls and produces evidence for your ISMS.</p></div></aside></div>`;
  };

  // ---------- Search results ----------
  Q.views.search = function (p, q) {
    var s = (q.q || '').toLowerCase().trim();
    var hits = [];
    if (s) Q.allRecordIds().forEach(function (id) {
      var r = Q.rec(id); if (!Q.canSee(r)) return;
      var text = id + ' ' + Q.recTitle(id) + ' ' + (r.description || r.desc || r.details || '');
      var where = text.toLowerCase().indexOf(s) >= 0 ? 'Title or description' : null;
      if (!where && Q.kindOf(id) === 'doc') { var b = Q.curVer(r).content.find(function (x) { return x.x.toLowerCase().indexOf(s) >= 0; }); if (b) where = '“' + b.x.slice(0, 120) + '”'; }
      if (where) hits.push({ id: id, where: where });
    });
    var hidden = s ? Q.allRecordIds().filter(function (id) { return !Q.canSee(Q.rec(id)) && (id + ' ' + Q.recTitle(id)).toLowerCase().indexOf(s) >= 0; }).length : 0;
    return h`<div class="page-head"><div><h1>Search</h1><div class="sub">${s ? Q.plural(hits.length, 'result') + ' for “' + q.q + '”' : 'Type in the command bar (Ctrl K) to search'}</div></div></div>
      <form class="toolbar" data-submit="search-go"><input class="input search" name="q" type="search" value="${q.q || ''}" placeholder="Search records and document text" aria-label="Search"><button class="btn" type="submit">Search</button></form>
      ${hits.length ? h`<div class="list-rows">${hits.map(function (x) { var r = Q.rec(x.id); return h`<div class="list-row"><div class="lr-main">${Q.recLink(x.id)}<div class="small muted">${Q.KIND_LABEL[Q.kindOf(x.id)]} · ${x.where}</div></div>${r.state ? Q.stateChip(r.state) : ''}</div>`; })}</div>` : s ? Q.empty('No results', 'Try a record number like CAPA-007, or a word from a document.') : ''}
      ${hidden ? h`<p class="small muted mt-16">Some matching records are hidden because of their classification.</p>` : ''}`;
  };
  Q.on['search-go'] = function (form) { Q.go('#/search?q=' + encodeURIComponent(Q.formData(form).q)); };

  // ---------- Mobile: Raise an observation (works offline) ----------
  function offline() { return Q.ui.simOffline || !navigator.onLine; }
  Q.views.raise = function () {
    var off = offline();
    var drafts = Q.S.drafts.filter(function (d) { return d.by === Q.S.session.userId; });
    if (Q.readOnly()) return Q.views.denied('raising observations');
    return h`<h1>Raise an observation</h1><p class="muted">Anyone can raise one. The process owner reviews it.</p>
      ${off ? h`<div class="offline-banner">${Q.icon('wifiOff')}<div><b>You’re offline</b><div class="small">Your draft is saved on this phone and sends when you’re back online. (In the app it is encrypted with a key in the phone’s secure storage and wiped on sign-out.)</div></div></div>` : ''}
      <form class="stack" data-submit="raise">
        <div class="field"><label for="rw">What did you notice?</label><input class="input" id="rw" name="title" placeholder="One line"></div>
        <div class="field"><label for="rdd">Details</label><textarea class="textarea" id="rdd" name="details"></textarea></div>
        <div class="field"><label for="ra">Process area</label><select class="select" id="ra" name="area">${Q.OBS_AREAS.map(function (a) { return h`<option>${a}</option>`; })}</select></div>
        <label class="drop">${Q.icon('camera')}<span>Add photo or file</span><input type="file" class="sr-only" name="files" accept="image/*" capture="environment" multiple data-change="raise-files"></label>
        <div id="raise-files" class="small muted"></div>
        <label class="check"><input type="checkbox" name="loc" data-change="raise-loc"> ${Q.icon('pin', 'ico-sm')} Attach my location</label><div id="raise-loc" class="small muted"></div>
        <button class="btn btn-primary" type="submit">${off ? 'Submit when online' : 'Submit'}</button>
      </form>
      ${drafts.length ? h`<div class="card card-pad mt-24"><div class="spread mb-8"><div class="label">Waiting to send · ${drafts.length}</div>${!off ? h`<button class="btn btn-sm" data-act="raise-sync">Send now</button>` : ''}</div>${drafts.map(function (d) { return h`<div class="people-row"><span>${d.title}</span><span class="small muted">${Q.fmtDateTime(d.at)}</span></div>`; })}</div>` : ''}
      <label class="check mt-24 small muted"><input type="checkbox" data-change="sim-offline" ${Q.ui.simOffline ? 'checked' : ''}> Prototype: simulate being offline</label>`;
  };
  Q.on['raise-files'] = function (el) { var t = document.getElementById('raise-files'); if (t) t.textContent = Array.prototype.map.call(el.files, function (f) { return f.name + ' (' + Q.fmtBytes(f.size) + ')'; }).join(', '); };
  Q.on['raise-loc'] = function (el) {
    var t = document.getElementById('raise-loc'); if (!el.checked) { Q.ui.loc = null; if (t) t.textContent = ''; return; }
    if (!navigator.geolocation) { if (t) t.textContent = 'Location isn’t available on this device.'; return; }
    if (t) t.textContent = 'Getting your location…';
    navigator.geolocation.getCurrentPosition(function (pos) { Q.ui.loc = pos.coords.latitude.toFixed(4) + ', ' + pos.coords.longitude.toFixed(4); if (t) t.textContent = 'Location: ' + Q.ui.loc; }, function () { Q.ui.loc = null; if (t) t.textContent = 'Location not shared. You can describe where in the details.'; el.checked = false; }, { timeout: 8000 });
  };
  Q.on['sim-offline'] = function (el) { Q.ui.simOffline = el.checked; if (!el.checked) syncDrafts(); Q.render({ keepScroll: true }); };
  Q.on.raise = function (form) {
    var f = Q.formData(form);
    if (!f.title) return Q.fieldError(form, 'title', 'Say what you noticed.');
    var item = { id: Q.uid('DR'), by: Q.S.session.userId, title: f.title, details: f.details || f.title, area: f.area, attachments: (f.files || []).map(function (x) { return { name: x.name, size: Q.fmtBytes(x.size), scan: 'clean' }; }), location: Q.ui.loc || '', at: new Date().toISOString() };
    if (offline()) { Q.S.drafts.push(item); Q.save(); Q.toast('Saved on this phone. It sends when you’re back online.'); Q.render(); return; }
    var o = Q.wf.obs.raise(item); Q.ui.loc = null; Q.toast(o.id + ' sent to ' + Q.fullName(o.owner)); Q.go('#/quality/' + o.id);
  };
  function syncDrafts() {
    if (offline() || !Q.S.drafts.length) return;
    var n = 0;
    Q.S.drafts.slice().forEach(function (d) { if (d.by !== Q.S.session.userId) return; var prev = Q.S.session.userId; Q.wf.obs.raise({ title: d.title, details: d.details, area: d.area, attachments: d.attachments, location: d.location, at: d.at, offline: true }); Q.S.session.userId = prev; n++; });
    Q.S.drafts = Q.S.drafts.filter(function (d) { return d.by !== Q.S.session.userId; });
    if (n) { Q.save(); Q.toast('Back online: ' + Q.plural(n, 'observation') + ' sent'); }
  }
  Q.act['raise-sync'] = function () { syncDrafts(); Q.render(); };
  window.addEventListener('online', function () { syncDrafts(); Q.render({ keepScroll: true }); });
  window.addEventListener('offline', function () { if (Q.current.section === 'raise') Q.render({ keepScroll: true }); });
})(window.Q);
