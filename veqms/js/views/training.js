/* Training (Route 2): read-and-understood acknowledgements in the app. Not Part 11 signatures, but every
   record is attributable (single sign-on), tied to one version, dated by the system and locked once made.
   Tabs: My training · Training matrix · Records (individual and per-document reports) · Audiences. */
(function (Q) {
  'use strict';
  var h = Q.h;

  var QUIZ = {
    'SOP-012': [
      { q: 'How often is a restore test run?', o: ['Once a year', 'Every quarter', 'Only after an incident'], a: 1 },
      { q: 'What is the recovery point objective (RPO)?', o: ['1 hour', '1 business day', '1 week'], a: 0 },
      { q: 'Where are backup copies kept?', o: ['Only in the primary region', 'Encrypted, and copied to a second region', 'On staff laptops'], a: 1 }
    ],
    'POL-009': [
      { q: 'Can you put Confidential information into a public AI tool?', o: ['Yes, if it saves time', 'No', 'Only with a manager’s email approval'], a: 1 },
      { q: 'What do you do if you lose a work device?', o: ['Report it to IT at once', 'Wait a day in case it turns up', 'Buy a replacement'], a: 0 },
      { q: 'When is limited personal use allowed?', o: ['Any time', 'Outside working hours', 'Never'], a: 1 }
    ],
    'POL-001': [
      { q: 'Who leads the ISMS?', o: ['The Quality Manager', 'Every team lead', 'The external auditor'], a: 0 },
      { q: 'When should you report a security incident?', o: ['At the next team meeting', 'At once', 'Only if data was lost'], a: 1 },
      { q: 'How often are information security objectives set?', o: ['Every year', 'Every 5 years', 'Only after an audit'], a: 0 }
    ],
    'POL-004': [
      { q: 'How often do system owners review access now?', o: ['Once a year', 'Every quarter', 'Never'], a: 1 },
      { q: 'How quickly must leavers lose access?', o: ['Within 5 working days', 'Within 60 minutes', 'At the end of the month'], a: 1 },
      { q: 'Which form do managers use to request access?', o: ['FRM-007', 'SOP-012', 'REG-002'], a: 0 }
    ]
  };
  function quizFor(docId) {
    if (QUIZ[docId]) return QUIZ[docId];
    var d = Q.S.docs[docId];
    return [
      { q: 'Who owns ' + docId + '?', o: [Q.fullName(d.owner), 'The external auditor', 'Nobody'], a: 0 },
      { q: 'What should you do if this document is unclear?', o: ['Ignore the unclear part', 'Ask the owner or raise an observation', 'Edit your printed copy'], a: 1 },
      { q: 'Is a printed copy controlled?', o: ['Yes', 'No, it is uncontrolled when printed'], a: 1 }
    ];
  }
  function by(a) { return a.allocatedBy === 'system' ? 'System' : Q.fullName(a.allocatedBy); }

  // Shared rows for every training export (PDF and Excel).
  Q.trainingRows = function (list) {
    var rows = [['Person', 'Account status', 'Document', 'Title', 'Version', 'Allocated by', 'Reason', 'Assigned (UTC)', 'Due (UTC)', 'Completed (UTC)', 'Record status', 'Statement', 'Knowledge check', 'Agreement ID', 'Correction of', 'Correction reason', 'Record ID']];
    list.slice().sort(Q.by(function (a) { return Q.fullName(a.user) + a.doc + a.assigned; })).forEach(function (a) {
      var u = Q.user(a.user);
      rows.push([u.name, a.leaver ? 'Left' : u.status, a.doc, a.title, a.ver, by(a), a.allocReason || '', Q.fmtUtc(a.assigned), a.due ? Q.fmtUtc(a.due) : '', a.completed ? Q.fmtUtc(a.completed) : '', Q.trStatus(a), a.statement || '', a.quiz || '', a.agreement || '', a.correctionOf || '', a.correctionReason || '', a.id]);
    });
    return rows;
  };

  Q.views.training = function (p, q) {
    var org = Q.can('training.org');
    var tabs = [['my', 'My training']].concat(org ? [['matrix', 'Training matrix'], ['records', 'Records'], ['audiences', 'Audiences']] : []);
    var tab = tabs.some(function (t) { return t[0] === q.tab; }) ? q.tab : 'my';
    var content = tab === 'matrix' ? matrixTab(q) : tab === 'records' ? recordsTab(q) : tab === 'audiences' ? audiencesTab(q) : myTab(q);
    if (q.doc && tab === 'my') Q.after(function () { var a = mine().find(function (x) { return x.doc === q.doc && Q.trOpen(x); }); if (a) openTraining(a); history.replaceState(null, '', '#/training'); });
    if (q.rec) Q.after(function () { var a = Q.S.assignments.find(function (x) { return x.id === q.rec; }); if (a && (org || a.user === Q.S.session.userId)) openRecord(a); });
    return h`<div class="page-head"><div><h1>Training</h1><div class="sub">Read and understood. Records are dated by the system, locked once made, and kept with the person.</div></div>
      ${tab === 'records' && Q.can('training.manage') && !Q.readOnly() ? h`<button class="btn" data-act="tr-reminders">${Q.icon('bell', 'ico-sm')} Send reminders now</button>` : ''}</div>
      <div class="tabs" role="tablist">${tabs.map(function (t) { return h`<button class="tab ${tab === t[0] ? 'active' : ''}" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>
      ${content}`;
  };
  function mine(uid) { return Q.S.assignments.filter(function (a) { return a.user === (uid || Q.S.session.userId); }); }

  // ---------- My training ----------
  function myTab() {
    var list = mine();
    var open = list.filter(Q.trOpen).sort(Q.by('due'));
    var done = list.filter(function (a) { return !Q.trOpen(a); }).sort(Q.by(function (a) { return a.completed || a.assigned; }, -1));
    Q.reports['my-record'] = { title: 'Training record: ' + Q.me().name, file: 'training-record-' + Q.S.session.userId, rows: function () { return Q.trainingRows(mine()); } };
    return h`${Q.tip('training', h`<b>My training.</b> Read the document, answer the short knowledge check if there is one, then confirm you have read and understood that version. You’re signed in through Microsoft 365, so the record is yours alone; the app sets the date and time.`)}
      <div class="label mb-8">To do · ${open.length}</div>
      ${open.length ? open.map(function (a) {
        var d = Q.S.docs[a.doc], aud = Q.audienceOf(d);
        var opened = (Q.ui.opened || {})[a.id];
        return h`<div class="card card-pad mb-8"><div class="spread" style="align-items:flex-start;flex-wrap:wrap">
          <div><div class="tc-kicker row-wrap small muted">Read and understood · ${a.allocReason} · allocated by ${by(a)} ${Q.dueChip(a.due)}</div>
            <div style="font-weight:600;margin-top:4px">${a.doc} ${a.title} v${a.ver}</div>
            <div class="row-wrap mt-8 small"><span class="chip ${opened ? 'chip-done' : 'chip-outline'}">1 Read${opened ? ' · opened ' + Q.fmtShort(opened) : ''}</span>${aud.quiz ? h`<span class="chip chip-outline">2 Knowledge check · ${quizFor(a.doc).length} questions</span>` : ''}<span class="chip chip-outline">${aud.quiz ? '3' : '2'} Confirm</span></div></div>
          ${Q.readOnly() ? '' : h`<button class="btn ${opened ? 'btn-primary' : ''}" data-act="train-start" data-id="${a.id}">${opened ? 'Continue' : 'Start'}</button>`}</div></div>`;
      }) : Q.empty('No training due', 'When a document you must train on changes, the new version shows up here.')}
      <div class="spread mt-24 mb-8"><div class="label" style="margin:0">My training record · ${done.length}</div>${done.length ? Q.reportButtons('my-record') : ''}</div>
      ${Q.table({ id: 'mydone', rows: done.map(function (a) { return Object.assign({ st: Q.trStatus(a) }, a); }), defaultSort: 'completed', defaultDir: -1, href: function (a) { return '#/training?rec=' + a.id; }, empty: 'No records yet.',
        cols: [{ key: 'doc', label: 'Document', render: function (a) { return h`${a.doc} ${a.title} v${a.ver}`; } }, { key: 'allocReason', label: 'Why' }, { key: 'completed', label: 'Completed (UTC)', render: function (a) { return a.completed ? Q.fmtUtc(a.completed) : '—'; } }, { key: 'st', label: 'Status', render: function (a) { return Q.chip(a.st); } }] })}`;
  }
  Q.act['train-start'] = function (el) { var a = Q.S.assignments.find(function (x) { return x.id === el.getAttribute('data-id'); }); if (a) openTraining(a); };

  function openTraining(a) {
    var d = Q.S.docs[a.doc];
    var v = d.versions.find(function (x) { return x.v === a.ver; }) || Q.effVer(d) || Q.curVer(d);
    var quiz = Q.audienceOf(d).quiz ? quizFor(a.doc) : null;
    var st = { step: 1, answers: {}, wrong: [] };
    var statement = Q.ackStatement(d.id, v.v);
    Q.ui.opened = Q.ui.opened || {}; if (!Q.ui.opened[a.id]) { Q.ui.opened[a.id] = new Date().toISOString(); Q.audit('read', 'Document', a.doc, 'Opened ' + a.doc + ' v' + a.ver + ' for training'); Q.save(); }
    function body() {
      var steps = h`<div class="sign-steps" style="grid-template-columns:repeat(${quiz ? 3 : 2},1fr)"><div class="${st.step === 1 ? 'on' : 'ok'}">1 Read</div>${quiz ? h`<div class="${st.step === 2 ? 'on' : st.step > 2 ? 'ok' : ''}">2 Knowledge check</div>` : ''}<div class="${st.step === 3 ? 'on' : ''}">${quiz ? '3' : '2'} Confirm</div></div>`;
      if (st.step === 1) return h`${steps}<div class="viewer" style="max-height:52vh"><div class="page" style="min-height:0">${h`<h2>${d.id} ${d.title}</h2><div class="doc-meta"><span>Version ${v.v}</span><span>${d.classification.toUpperCase()}</span></div>`}${v.content.map(function (b) { return b.t === 'h' ? h`<h3>${b.x}</h3>` : h`<p>${b.x}</p>`; })}</div></div>
        <label class="check mt-16"><input type="checkbox" name="read" ${st.read ? 'checked' : ''}> I have read all of ${d.id} v${v.v}</label>`;
      if (st.step === 2) return h`${steps}<p class="small muted">Answer all ${quiz.length} questions. You can try again if one is wrong.</p>${quiz.map(function (x, i) {
        return h`<fieldset class="quiz-q ${st.wrong.indexOf(i) >= 0 ? 'wrong' : ''}"><legend style="font-size:15px">${i + 1}. ${x.q}</legend>${x.o.map(function (o, j) { return h`<label class="check"><input type="radio" name="q${i}" value="${j}" ${st.answers[i] === j ? 'checked' : ''}> ${o}</label>`; })}${st.wrong.indexOf(i) >= 0 ? h`<div class="err">Not quite. Check section ${i + 2} of the document.</div>` : ''}</fieldset>`;
      })}`;
      var me = Q.me();
      return h`${steps}${quiz ? h`<div class="callout ok mb-16"><strong>Knowledge check passed</strong><p class="small" style="margin:4px 0 0">${quiz.length} of ${quiz.length} correct.</p></div>` : ''}
        <dl class="dl mb-16"><div><dt>Signed in as</dt><dd>${me.name}</dd></div><div><dt>Account</dt><dd>${me.email} · Microsoft 365 single sign-on</dd></div><div><dt>Document</dt><dd>${d.id} ${d.title}</dd></div><div><dt>Version</dt><dd>${v.v}</dd></div></dl>
        <label class="check statement" style="align-items:flex-start;padding:14px 16px"><input type="checkbox" name="confirm" style="margin-top:3px"> <span style="font-weight:600">${statement}</span></label>
        <p class="small muted mt-16">The app records the date and time when you confirm; nobody can type or change them. Once confirmed, the record is locked: it can’t be edited or deleted, by anyone. Only you can confirm your own record.</p>`;
    }
    Q.drawer.open({
      wide: true, kicker: 'Read and understood · ' + a.allocReason, title: d.id + ' ' + d.title + ' v' + v.v, body: body,
      foot: function () { return h`<button class="btn btn-primary" type="submit">${st.step === 1 ? (quiz ? 'Continue to knowledge check' : 'Continue') : st.step === 2 ? 'Check answers' : 'Confirm read and understood'}</button><button class="btn" type="button" data-act="drawer-close">Save and close</button>`; },
      submit: function (f) {
        if (st.step === 1) { if (!f.read) { Q.toast('Tick the box to confirm you have read it.', 'warn'); return; } st.read = true; st.step = quiz ? 2 : 3; Q.drawer.paint(); Q.drawer.focusFirst(); return; }
        if (st.step === 2) {
          st.wrong = []; quiz.forEach(function (x, i) { st.answers[i] = f['q' + i] == null ? null : +f['q' + i]; if (st.answers[i] !== x.a) st.wrong.push(i); });
          if (st.wrong.length) { Q.drawer.paint(); return; }
          st.step = 3; Q.drawer.paint(); return;
        }
        if (!f.confirm) { Q.toast('Tick the statement to confirm.', 'warn'); return; }
        if (Q.completeTraining(a, { quiz: quiz ? quiz.length + '/' + quiz.length : null })) { Q.drawer.close(); Q.toast('Recorded: ' + statement); Q.refresh(); }
      }
    });
  }

  // ---------- Training matrix: person by document ----------
  function matrixDocs() { return Object.keys(Q.S.docs).map(function (k) { return Q.S.docs[k]; }).filter(function (d) { return Q.effVer(d) && (Q.hasAudience(d) || Q.S.assignments.some(function (a) { return a.doc === d.id; })); }).sort(Q.by('id')); }
  Q.trCell = function (u, d) {
    var cur = Q.effVer(d), recs = Q.S.assignments.filter(function (a) { return a.user === u.id && a.doc === d.id && !a.noRetrain && !a.closed; }).sort(Q.by('assigned', -1));
    var curRec = recs.find(function (a) { return a.ver === cur.v && Q.trStatus(a) !== 'Corrected'; });
    if (curRec) return { status: Q.trStatus(curRec), rec: curRec, trained: curRec.completed ? curRec.ver : null, current: cur.v };
    var older = recs.filter(function (a) { return a.completed && a.ver !== cur.v; }).sort(Q.by(function (a) { return a.completed; }, -1))[0];
    if (Q.inAudience(d, u)) return { status: older ? 'Superseded' : 'Not allocated', rec: older || null, trained: older ? older.ver : null, current: cur.v };
    if (older) return { status: 'Not required', rec: older, trained: older.ver, current: cur.v };
    return null;
  };
  function matrixPeople(q) { return Q.activeUsers().filter(function (u) { return u.roles.indexOf('auditor') < 0 && (!q.g || u.groups.indexOf(q.g) >= 0); }).sort(Q.by('name')); }
  function matrixRows(q) {
    var rows = [['Person', 'Groups', 'Document', 'Title', 'Current version', 'Version trained', 'Status', 'Assigned (UTC)', 'Due (UTC)', 'Completed (UTC)']];
    matrixPeople(q).forEach(function (u) { matrixDocs().forEach(function (d) { var c = Q.trCell(u, d); if (!c) return; var r = c.rec || {}; rows.push([u.name, u.groups.join('; '), d.id, d.title, c.current, c.trained || '', c.status, r.assigned ? Q.fmtUtc(r.assigned) : '', r.due ? Q.fmtUtc(r.due) : '', r.completed ? Q.fmtUtc(r.completed) : '']); }); });
    return rows;
  }
  function matrixTab(q) {
    var docs = matrixDocs(), people = matrixPeople(q);
    Q.reports.matrix = { title: 'Training matrix' + (q.g ? ': ' + q.g : ''), file: 'training-matrix', rows: function () { return matrixRows(q); }, intro: 'Person by document: version trained, current version, status and dates.' };
    var CLS = { 'Complete': 'chip-done', 'Overdue': 'chip-overdue', 'Assigned': 'chip-turn', 'Superseded': 'chip-due', 'Not allocated': 'chip-overdue', 'Not required': 'chip-outline' };
    var cell = function (u, d) {
      var c = Q.trCell(u, d);
      if (!c) return h`<td class="muted" title="Not in the audience">·</td>`;
      var r = c.rec;
      var tip = u.name + ' · ' + d.id + ' · current v' + c.current + (c.trained ? ' · trained on v' + c.trained : '') + (r && r.completed ? ' on ' + Q.fmtDate(r.completed) : '') + (r && !r.completed && r.due ? ' · due ' + Q.fmtDate(r.due) : '') + ' · ' + c.status;
      var label = c.status === 'Complete' ? 'v' + c.trained : c.status === 'Assigned' ? 'Due ' + Q.fmtShort(r.due) : c.status === 'Overdue' ? 'Overdue' : c.status === 'Superseded' ? 'v' + c.trained + ' → v' + c.current : c.status === 'Not required' ? 'v' + c.trained : 'Not allocated';
      return h`<td><button class="chip ${CLS[c.status] || ''}" style="border:0;cursor:pointer" title="${tip}" aria-label="${tip}" ${Q.raw(r ? 'data-act="go" data-href="' + Q.esc('#/training?tab=matrix' + (q.g ? '&g=' + q.g : '') + '&rec=' + r.id) + '"' : '')}>${label}</button></td>`;
    };
    return h`<div class="toolbar"><select class="select" data-change="qfilter" data-key="g" aria-label="Group"><option value="">Everyone</option>${Q.S.groups.map(function (g) { return h`<option ${q.g === g.name ? 'selected' : ''}>${g.name}</option>`; })}</select>
        <span class="legend small"><span><i style="background:var(--done-bg)"></i>Trained on current</span><span><i style="background:var(--due-bg)"></i>Trained on an earlier version</span><span><i style="background:var(--overdue-bg)"></i>Overdue or not allocated</span></span>
        <span style="margin-left:auto">${Q.reportButtons('matrix')}</span></div>
      <div class="table-wrap"><table class="t"><caption class="sr-only">Training matrix, person by document</caption><thead><tr><th scope="col">Person</th>${docs.map(function (d) { return h`<th scope="col" title="${d.title}"><a href="#/documents/${d.id}?tab=training">${d.id}</a><div class="small muted" style="font-weight:400;text-transform:none;letter-spacing:0">v${Q.effVer(d).v}</div></th>`; })}</tr></thead>
        <tbody>${people.map(function (u) { return h`<tr><th scope="row" style="white-space:nowrap;text-transform:none;letter-spacing:0;font-size:14px;color:var(--ink)"><a href="#/training?tab=records&u=${u.id}">${u.name}</a><div class="small muted" style="font-weight:400">${u.title}</div></th>${docs.map(function (d) { return cell(u, d); })}</tr>`; })}</tbody></table></div>
      <p class="small muted mt-8">“·” means the person isn’t in that document’s audience. Select a cell to open the record. “Not allocated” means someone in the audience has no record for the current version: check their start date or group.</p>`;
  }

  // ---------- Records: everything, or one person, or one document ----------
  function recordsTab(q) {
    var rows = Q.S.assignments.slice();
    var u = q.u ? Q.user(q.u) : null, d = q.d ? Q.S.docs[q.d] : null;
    if (u) rows = rows.filter(function (a) { return a.user === u.id; });
    if (d) rows = rows.filter(function (a) { return a.doc === d.id; });
    if (!q.all) rows = rows.filter(function (a) { return ['Superseded', 'Withdrawn', 'Corrected', 'Correction', 'Obsolete'].indexOf(Q.trStatus(a)) < 0; });
    if (q.st) rows = rows.filter(function (a) { return Q.trStatus(a) === q.st; });
    var live = Q.S.assignments.filter(function (a) { return ['Complete', 'Assigned', 'Overdue'].indexOf(Q.trStatus(a)) >= 0 && !a.leaver; });
    var done = live.filter(function (a) { return a.completed; });
    var overdue = live.filter(function (a) { return Q.trStatus(a) === 'Overdue'; }).length;
    var title = u ? 'Training records: ' + u.name : d ? 'Training status: ' + d.id + ' ' + d.title : 'Training records';
    Q.reports.records = { title: title, file: u ? 'training-records-' + u.id : d ? 'training-status-' + d.id : 'training-records', rows: function () { return Q.trainingRows(rows); }, intro: (q.all ? 'All records, including superseded, withdrawn and corrected.' : 'Current records.') + (d ? ' Current version: v' + (Q.effVer(d) || {}).v + '.' : '') };
    var people = Q.S.users.filter(function (x) { return x.roles.indexOf('auditor') < 0; }).sort(Q.by('name'));
    var docs = Object.keys(Q.S.docs).filter(function (k) { return Q.S.assignments.some(function (a) { return a.doc === k; }); }).sort();
    return h`${u || d ? '' : h`<div class="grid-3 mb-16">
        <div class="card kpi"><div class="kpi-label">Complete (current versions)</div><div class="kpi-value">${Q.pct(done.length, live.length)}%</div><div class="progress"><div style="width:${Q.pct(done.length, live.length)}%"></div></div></div>
        <div class="card kpi"><div class="kpi-label">Open</div><div class="kpi-value">${live.length - done.length}</div><div class="kpi-sub">reminders ${Q.S.settings.reminders.join(' and ')} days before due</div></div>
        <div class="card kpi"><div class="kpi-label">Overdue</div><div class="kpi-value" style="color:${overdue ? 'var(--overdue)' : 'inherit'}">${overdue}</div><div class="kpi-sub">trainee and manager told every ${Q.S.settings.escalation.repeatDays} days</div></div></div>`}
      ${u || d ? h`<div class="card card-pad mb-16"><div class="spread" style="flex-wrap:wrap"><div><div class="label">${u ? 'Individual training record' : 'Training status of one document'}</div><h2 style="margin:4px 0 0">${title}</h2>
          <div class="small muted">${u ? u.title + ' · ' + u.groups.join(', ') + (u.status !== 'Active' ? ' · ' + u.status : '') : 'Current version v' + ((Q.effVer(d) || {}).v || '—') + ' · audience: ' + Q.audienceText(Q.audienceOf(d))}</div></div>
          <a class="btn" href="#/training?tab=records">Show everyone</a></div></div>` : ''}
      <div class="toolbar">
        <select class="select" data-change="qfilter" data-key="u" aria-label="Person"><option value="">Everyone</option>${people.map(function (x) { return h`<option value="${x.id}" ${q.u === x.id ? 'selected' : ''}>${x.name}${x.status !== 'Active' ? ' (' + x.status.toLowerCase() + ')' : ''}</option>`; })}</select>
        <select class="select" data-change="qfilter" data-key="d" aria-label="Document"><option value="">All documents</option>${docs.map(function (k) { return h`<option value="${k}" ${q.d === k ? 'selected' : ''}>${k} ${Q.S.docs[k].title}</option>`; })}</select>
        <select class="select" data-change="qfilter" data-key="st" aria-label="Status"><option value="">Any status</option>${['Complete', 'Assigned', 'Overdue', 'Superseded', 'Corrected', 'Correction', 'Withdrawn', 'Left'].map(function (s) { return h`<option ${q.st === s ? 'selected' : ''}>${s}</option>`; })}</select>
        <label class="check small"><input type="checkbox" data-change="tr-all" ${q.all ? 'checked' : ''}> Include superseded, withdrawn and corrected</label>
        <span style="margin-left:auto">${Q.reportButtons('records')}</span></div>
      ${Q.table({ id: 'trrec', rows: rows.map(function (a) { var x = Q.user(a.user); return Object.assign({ name: x.name + (a.leaver ? ' · left' : ''), st: Q.trStatus(a) }, a); }), defaultSort: 'due', caption: title,
        href: function (a) { return '#/training?tab=records' + (q.u ? '&u=' + q.u : '') + (q.d ? '&d=' + q.d : '') + (q.all ? '&all=1' : '') + (q.st ? '&st=' + q.st : '') + '&rec=' + a.id; },
        cols: [{ key: 'name', label: 'Person' }, { key: 'doc', label: 'Document', render: function (a) { return h`${a.doc} v${a.ver}`; } }, { key: 'allocReason', label: 'Allocated', render: function (a) { return h`<span class="small">${a.allocReason} · ${by(a)}</span>`; } },
          { key: 'assigned', label: 'Assigned', render: function (a) { return Q.fmtShort(a.assigned); } }, { key: 'due', label: 'Due', render: function (a) { return a.due ? Q.fmtShort(a.due) : '—'; } },
          { key: 'completed', label: 'Completed (UTC)', render: function (a) { return a.completed ? Q.fmtUtc(a.completed) : '—'; } }, { key: 'st', label: 'Status', render: function (a) { return h`${Q.chip(a.st)}${a.agreement ? h` <span class="small muted">· Adobe Sign</span>` : ''}`; } }] })}
      <p class="small muted mt-8">Completed records can’t be edited or deleted by anyone, administrators included. A correction is a new record with a reason; the original stays. Leavers’ records are kept.</p>`;
  }
  Q.on['tr-all'] = function (el) { Q.setQuery({ all: el.checked ? '1' : '' }); };
  Q.act['tr-reminders'] = function () { var r = Q.sendReminders(); Q.toast('Sent ' + Q.plural(r.sent, 'reminder') + ' and ' + Q.plural(r.overdue, 'overdue notice') + ' · logged'); Q.refresh(); };

  function fmtVals(o) {
    if (!o) return '—';
    return Object.keys(o).map(function (k) { var v = o[k]; if (v && typeof v === 'object') v = Array.isArray(v) ? v.join(', ') : v.groups ? Q.audienceText(v) : JSON.stringify(v); return k + ': ' + (/^\d{4}-\d\d-\d\dT/.test(String(v)) ? Q.fmtUtc(v) : (v === null || v === '' ? '—' : v)); }).join(' · ');
  }
  function openRecord(a) {
    var d = Q.S.docs[a.doc], status = Q.trStatus(a), corr = Q.trCorrections(a);
    var hist = Q.history(a.id);
    var canCorrect = Q.can('training.manage') && !Q.readOnly() && a.completed && !corr.length;
    Q.drawer.open({
      wide: true, kicker: 'Training record · ' + a.id, title: a.doc + ' v' + a.ver + ' · ' + Q.fullName(a.user),
      onClose: function () { if (Q.current.query.rec) Q.setQuery({ rec: '' }); },
      body: h`<div class="row-wrap mb-16">${Q.chip(status)}${a.completed ? h`<span class="chip chip-outline">${Q.icon('lock', 'ico-sm')} Locked</span>` : ''}${a.agreement ? Q.chip('From Adobe Sign approval', 'chip-outline') : ''}</div>
        <dl class="dl mb-16"><div><dt>Person</dt><dd>${Q.fullName(a.user)}${a.leaver ? ' (left)' : ''}</dd></div><div><dt>Document</dt><dd>${Q.recLink(a.doc, { short: true })} · v${a.ver}</dd></div>
          <div style="grid-column:1/-1"><dt>Title</dt><dd>${a.title}</dd></div>
          <div><dt>Allocated by</dt><dd>${by(a)}</dd></div><div><dt>Reason</dt><dd>${a.allocReason}</dd></div>
          <div><dt>Assigned (UTC)</dt><dd>${Q.fmtUtc(a.assigned)}</dd></div><div><dt>Due (UTC)</dt><dd>${a.due ? Q.fmtUtc(a.due) : '—'}</dd></div>
          <div><dt>Completed (UTC)</dt><dd>${a.completed ? Q.fmtUtc(a.completed) : '—'}</dd></div><div><dt>Knowledge check</dt><dd>${a.quiz || '—'}</dd></div>
          ${a.statement ? h`<div style="grid-column:1/-1"><dt>Statement</dt><dd>${a.statement}</dd></div>` : ''}
          ${a.via ? h`<div><dt>Identity</dt><dd>${a.via}</dd></div>` : ''}
          ${a.agreement ? h`<div style="grid-column:1/-1"><dt>Adobe Sign agreement</dt><dd><button type="button" class="btn-link mono" style="padding:0;min-height:0" data-act="es-agreement" data-id="${a.agreement}">${a.agreement}</button></dd></div>` : ''}
          ${a.correctionOf ? h`<div style="grid-column:1/-1"><dt>Correction of</dt><dd><a href="#/training?tab=records&all=1&rec=${a.correctionOf}">${a.correctionOf}</a> · ${a.correctionReason}${a.noRetrain ? ' (recorded in error, no retraining)' : ''}</dd></div>` : ''}
          ${corr.length ? h`<div style="grid-column:1/-1"><dt>Corrected by</dt><dd>${corr.map(function (c) { return h`<a href="#/training?tab=records&all=1&rec=${c.id}">${c.id}</a> · ${c.correctionReason} `; })}</dd></div>` : ''}
          ${a.closed ? h`<div style="grid-column:1/-1"><dt>Closed</dt><dd>${Q.fmtUtc(a.closed.at)} · ${a.closed.reason}</dd></div>` : ''}</dl>
        <div class="label mb-8">Audit trail for this record (old → new values)</div>
        ${hist.length ? h`<div class="table-wrap"><table class="t"><thead><tr><th>When (UTC)</th><th>Who</th><th>What</th><th>Old values</th><th>New values</th></tr></thead><tbody>${hist.map(function (e) { return h`<tr><td class="nowrap small">${Q.fmtUtc(e.at)}</td><td class="small">${e.actor === 'system' ? 'System' : Q.fullName(e.actor)}</td><td class="small">${e.summary}</td><td class="small">${fmtVals(e.before)}</td><td class="small">${fmtVals(e.after)}</td></tr>`; })}</tbody></table></div>` : h`<p class="small muted">${a.id.indexOf('TA-') === 0 && /^TA-\d+$/.test(a.id) ? 'Sample record created with the demo data; changes from now on are logged here.' : 'No entries yet.'}</p>`}
        <p class="small muted mt-16">Dates and times are set by the system. Completed records can’t be edited or deleted by anyone, administrators included.</p>`,
      foot: h`${canCorrect ? h`<button class="btn" type="button" data-act="tr-correct" data-id="${a.id}">Record a correction</button>` : ''}${Q.trOpen(a) && a.user === Q.S.session.userId && !Q.readOnly() ? h`<button class="btn btn-primary" type="button" data-act="train-start" data-id="${a.id}">Start training</button>` : ''}<button class="btn" type="button" data-act="drawer-close">Close</button>`
    });
    void d;
  }
  Q.openTrainingRecord = openRecord;
  Q.act['tr-correct'] = function (el) {
    var a = Q.S.assignments.find(function (x) { return x.id === el.getAttribute('data-id'); });
    Q.drawer.open({ kicker: 'Training record · ' + a.id, title: 'Record a correction', submitLabel: 'Record correction',
      body: h`<div class="callout plain mb-16"><b style="color:var(--ink)">The original record stays exactly as it is.</b><p class="small" style="margin:4px 0 0">A correction is a new record that points at ${a.id} (${Q.fullName(a.user)}, ${a.doc} v${a.ver}, completed ${Q.fmtUtc(a.completed)}). Both are kept and both appear in the audit trail.</p></div>
        <fieldset class="mb-16"><legend>What should happen</legend><div class="radio-cards">
          <label class="radio-card"><input type="radio" name="mode" value="retrain" checked><span><b>Retrain</b><br><span class="small muted">Allocate ${a.doc} v${a.ver} again. The person confirms it as a new record.</span></span></label>
          <label class="radio-card"><input type="radio" name="mode" value="void"><span><b>Recorded in error</b><br><span class="small muted">No retraining. The correction record explains why the original doesn’t count.</span></span></label></div></fieldset>
        <div class="field"><label for="trcr">Reason (required)</label><textarea class="textarea" id="trcr" name="reason" placeholder="e.g. Confirmed during a demo, not a real read"></textarea></div>`,
      submit: function (f, form) { if (!f.reason || f.reason.length < 10) return Q.fieldError(form, 'reason', 'Give a reason of at least a few words.'); var c = Q.correctTraining(a, f.reason, f.mode === 'retrain'); Q.drawer.close(); Q.toast(c ? 'Correction ' + c.id + ' recorded · original kept' : 'Not allowed', c ? '' : 'warn'); Q.refresh(); } });
  };

  // ---------- Audiences ----------
  function audiencesTab() {
    var docs = Object.keys(Q.S.docs).map(function (k) { return Q.S.docs[k]; }).filter(function (d) { return d.state !== 'Obsolete'; }).sort(Q.by('id'));
    var can = Q.can('training.manage') && !Q.readOnly();
    return h`${Q.tip('audiences', h`<b>Audiences.</b> Each document lists who must train on it: groups (including All staff), roles and named people. When a new version becomes effective, the whole audience is allocated it. New starters and people who change group or role get the current version automatically.`)}
      ${Q.table({ id: 'aud', rows: docs.map(function (d) { var eff = Q.effVer(d); var live = eff ? Q.S.assignments.filter(function (a) { return a.doc === d.id && a.ver === eff.v && ['Complete', 'Assigned', 'Overdue'].indexOf(Q.trStatus(a)) >= 0 && !a.leaver; }) : []; return Object.assign({ aud: Q.audienceText(Q.audienceOf(d)), n: Q.audienceMembers(d).length, effV: eff ? eff.v : '', pct: Q.pct(live.filter(function (a) { return a.completed; }).length, live.length), has: Q.hasAudience(d) }, d); }), defaultSort: 'id', href: function (d) { return '#/documents/' + d.id + '?tab=training'; },
        cols: [{ key: 'id', label: 'Document', cls: 'id' }, { key: 'title', label: 'Title' }, { key: 'aud', label: 'Who must train', render: function (d) { return h`<span class="small ${d.has ? '' : 'muted'}">${d.aud}</span>`; } }, { key: 'n', label: 'People' },
          { key: 'effV', label: 'Effective', render: function (d) { return d.effV ? 'v' + d.effV : '—'; } }, { key: 'pct', label: 'Complete', render: function (d) { return d.has && d.effV ? d.pct + '%' : '—'; } },
          { key: 'edit', label: '', sort: false, render: function (d) { return can ? h`<button class="btn btn-sm" data-act="doc-audience" data-id="${d.id}">Change</button>` : ''; } }] })}`;
  }
})(window.Q);
