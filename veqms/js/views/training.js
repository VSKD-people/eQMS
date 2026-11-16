/* Training: My training (read → knowledge check → sign), Organisation view, and versioned Training rules. */
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

  function myAssignments(uid) {
    return Q.S.assignments.filter(function (a) { return a.user === (uid || Q.S.session.userId) && !a.leaver; });
  }
  function status(a) { return a.completed ? 'Done' : Q.daysFromToday(a.due) < 0 ? 'Overdue' : 'Not started'; }

  Q.views.training = function (p, q) {
    var tab = q.tab || 'my';
    var tabs = [['my', 'My training']];
    if (Q.can('training.org')) tabs.push(['org', 'Organisation']);
    tabs.push(['rules', 'Training rules']);
    var content = tab === 'org' && Q.can('training.org') ? orgTab(q) : tab === 'rules' ? rulesTab(q) : myTab(q);
    if (q.doc && tab === 'my') Q.after(function () { var a = myAssignments().find(function (x) { return x.doc === q.doc && !x.completed; }); if (a) openTraining(a); history.replaceState(null, '', '#/training'); });
    if (q.rule && tab === 'rules') Q.after(function () { var r = Q.S.trainingRules.find(function (x) { return x.id === q.rule; }); if (r) openRule(r); });
    return h`<div class="page-head"><div><h1>Training</h1><div class="sub">Read, confirm and sign. Records stay with the person and are never deleted.</div></div>
      ${Q.can('training.rules') ? h`<button class="btn btn-primary" data-act="new-rule">${Q.icon('plus', 'ico-sm')} New training rule</button>` : ''}</div>
      <div class="tabs" role="tablist">${tabs.map(function (t) { return h`<button class="tab ${tab === t[0] ? 'active' : ''}" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>
      ${content}`;
  };

  function myTab() {
    var mine = myAssignments();
    var open = mine.filter(function (a) { return !a.completed; }).sort(Q.by('due'));
    var done = mine.filter(function (a) { return a.completed; }).sort(Q.by('completed', -1));
    return h`${Q.tip('training', h`<b>My training.</b> Read the document, answer the short knowledge check if the rule asks for one, then sign with a fresh sign-in. That creates your training record.`)}
      <div class="label mb-8">My assignments · ${open.length}</div>
      ${open.length ? open.map(function (a) {
        var d = Q.S.docs[a.doc], rule = Q.S.trainingRules.find(function (r) { return r.id === a.rule; });
        var opened = (Q.ui.opened || {})[a.id];
        return h`<div class="card card-pad mb-8"><div class="spread" style="align-items:flex-start;flex-wrap:wrap">
          <div><div class="tc-kicker row-wrap small muted">Read and confirm · Rule: ${rule ? rule.name : a.rule}${rule && rule.retrainMonths ? ', yearly' : ''} ${Q.dueChip(a.due)}</div>
            <div style="font-weight:600;margin-top:4px">${a.doc} ${d.title} v${a.ver}</div>
            <div class="row-wrap mt-8 small"><span class="chip ${opened ? 'chip-done' : 'chip-outline'}">1 Read${opened ? ' · opened ' + Q.fmtShort(opened) : ''}</span>${rule && rule.quiz ? h`<span class="chip chip-outline">2 Knowledge check · ${quizFor(a.doc).length} questions</span>` : ''}<span class="chip chip-outline">${rule && rule.quiz ? '3' : '2'} Sign · fresh sign-in required</span></div></div>
          ${Q.readOnly() ? '' : h`<button class="btn ${opened ? 'btn-primary' : ''}" data-act="train-start" data-id="${a.id}">${opened ? 'Continue' : 'Start'}</button>`}</div></div>`;
      }) : Q.empty('No training due', 'When a document you’re trained on changes, it shows up here.')}
      <details class="mt-24"><summary class="btn-link" style="padding:0;display:inline-flex;align-items:center">Completed: ${done.length} records · See history</summary>
        <div class="mt-16">${Q.table({ id: 'mydone', rows: done.map(function (a) { return Object.assign({ title: Q.S.docs[a.doc].title }, a); }), defaultSort: 'completed', defaultDir: -1,
          cols: [{ key: 'doc', label: 'Document', render: function (a) { return h`${a.doc} ${a.title} v${a.ver}`; } }, { key: 'rule', label: 'Rule' }, { key: 'completed', label: 'Completed', render: function (a) { return Q.fmtDate(a.completed); } }, { key: 'quiz', label: 'Knowledge check', render: function (a) { return a.quiz || '—'; } }, { key: 'sig', label: 'Signature', render: function (a) { return a.sig || '—'; } }] })}</div></details>`;
  }
  Q.act['train-start'] = function (el) { var a = Q.S.assignments.find(function (x) { return x.id === el.getAttribute('data-id'); }); if (a) openTraining(a); };

  function openTraining(a) {
    var d = Q.S.docs[a.doc], rule = Q.S.trainingRules.find(function (r) { return r.id === a.rule; });
    var v = d.versions.find(function (x) { return x.v === a.ver; }) || Q.effVer(d) || Q.curVer(d);
    var quiz = rule && rule.quiz ? quizFor(a.doc) : null;
    var st = { step: 1, answers: {}, wrong: [] };
    Q.ui.opened = Q.ui.opened || {}; if (!Q.ui.opened[a.id]) { Q.ui.opened[a.id] = new Date().toISOString(); Q.audit('read', 'Document', a.doc, 'Opened ' + a.doc + ' v' + a.ver + ' for training'); Q.save(); }
    function body() {
      var steps = h`<div class="sign-steps" style="grid-template-columns:repeat(${quiz ? 3 : 2},1fr)"><div class="${st.step === 1 ? 'on' : 'ok'}">1 Read</div>${quiz ? h`<div class="${st.step === 2 ? 'on' : st.step > 2 ? 'ok' : ''}">2 Knowledge check</div>` : ''}<div class="${st.step === 3 ? 'on' : ''}">${quiz ? '3' : '2'} Sign</div></div>`;
      if (st.step === 1) return h`${steps}<div class="viewer" style="max-height:52vh"><div class="page" style="min-height:0">${h`<h2>${d.id} ${d.title}</h2><div class="doc-meta"><span>Version ${v.v}</span><span>${d.classification.toUpperCase()}</span></div>`}${v.content.map(function (b) { return b.t === 'h' ? h`<h3>${b.x}</h3>` : h`<p>${b.x}</p>`; })}</div></div>
        <label class="check mt-16"><input type="checkbox" name="read" ${st.read ? 'checked' : ''}> I have read and understood ${d.id} v${v.v}</label>`;
      if (st.step === 2) return h`${steps}<p class="small muted">Answer all ${quiz.length} questions. You can try again if one is wrong.</p>${quiz.map(function (x, i) {
        return h`<fieldset class="quiz-q ${st.wrong.indexOf(i) >= 0 ? 'wrong' : ''}"><legend style="font-size:15px">${i + 1}. ${x.q}</legend>${x.o.map(function (o, j) { return h`<label class="check"><input type="radio" name="q${i}" value="${j}" ${st.answers[i] === j ? 'checked' : ''}> ${o}</label>`; })}${st.wrong.indexOf(i) >= 0 ? h`<div class="err">Not quite. Check section ${i + 2} of the document.</div>` : ''}</fieldset>`;
      })}`;
      return h`${steps}<div class="callout ok"><strong>Ready to sign</strong><p class="small" style="margin:4px 0 0">${quiz ? 'Knowledge check passed (' + quiz.length + ' of ' + quiz.length + '). ' : ''}Signing creates your training record for ${d.id} v${v.v}.</p></div>`;
    }
    Q.drawer.open({
      wide: true, kicker: 'Read and confirm · Rule: ' + (rule ? rule.name : ''), title: d.id + ' ' + d.title + ' v' + v.v, body: body,
      foot: function () { return h`<button class="btn btn-primary" type="submit">${st.step === 1 ? (quiz ? 'Continue to knowledge check' : 'Continue to sign') : st.step === 2 ? 'Check answers' : 'Sign training record'}</button><button class="btn" type="button" data-act="drawer-close">Save and close</button>`; },
      submit: function (f) {
        if (st.step === 1) { if (!f.read) { Q.toast('Tick the box to confirm you have read it.', 'warn'); return; } st.read = true; st.step = quiz ? 2 : 3; Q.drawer.paint(); Q.drawer.focusFirst(); return; }
        if (st.step === 2) {
          st.wrong = []; quiz.forEach(function (x, i) { st.answers[i] = f['q' + i] == null ? null : +f['q' + i]; if (st.answers[i] !== x.a) st.wrong.push(i); });
          if (st.wrong.length) { Q.drawer.paint(); return; }
          st.step = 3; Q.drawer.paint(); return;
        }
        Q.drawer.close();
        Q.sign({ items: [{ id: d.id, version: v.v, hash: v.hash }], meaning: 'Read and understood', meanings: ['Read and understood'], title: 'Sign training: ' + d.id + ' v' + v.v,
          onSigned: function (sigs) { Q.completeTraining(a, { quiz: quiz ? quiz.length + '/' + quiz.length : null, sig: sigs[0].id }); Q.toast('Training recorded for ' + d.id); } });
      }
    });
  }

  function orgTab(q) {
    var rows = Q.S.assignments.slice();
    if (q.rule) rows = rows.filter(function (a) { return a.rule === q.rule; });
    if (q.st) rows = rows.filter(function (a) { return status(a) === q.st; });
    var cur = rows.filter(function (a) { return !a.leaver; });
    var done = cur.filter(function (a) { return a.completed; });
    var avg = done.length ? Math.round(done.reduce(function (s, a) { return s + (new Date(a.completed) - new Date(a.assigned)) / Q.DAY; }, 0) / done.length) : 0;
    var overdue = cur.filter(function (a) { return status(a) === 'Overdue'; }).length;
    var data = rows.map(function (a) { var u = Q.user(a.user); return Object.assign({ name: u.name + (a.leaver ? ' · left' : ''), docLabel: a.doc + ' v' + a.ver, st: a.leaver && a.completed ? 'Done · kept' : status(a) }, a); });
    return h`<div class="spread mb-16" style="flex-wrap:wrap"><h2>Organisation training</h2><div class="btn-row"><button class="btn" data-act="train-export">Export CSV</button><button class="btn" data-act="train-pdf">Export PDF</button></div></div>
      <div class="grid-3 mb-16">
        <div class="card kpi"><div class="kpi-label">Complete</div><div class="kpi-value">${Q.pct(done.length, cur.length)}%</div><div class="progress"><div style="width:${Q.pct(done.length, cur.length)}%"></div></div></div>
        <div class="card kpi"><div class="kpi-label">Average completion time</div><div class="kpi-value">${avg} days</div><div class="kpi-sub">from assignment to signature</div></div>
        <div class="card kpi"><div class="kpi-label">Overdue</div><div class="kpi-value" style="color:${overdue ? 'var(--overdue)' : 'inherit'}">${overdue}</div><div class="kpi-sub">escalated to managers on day 2, then every 2 days</div></div></div>
      <div class="toolbar"><select class="select" data-change="qfilter" data-key="rule" aria-label="Rule"><option value="">All rules</option>${Q.S.trainingRules.map(function (r) { return h`<option value="${r.id}" ${q.rule === r.id ? 'selected' : ''}>${r.name}</option>`; })}</select>
        <select class="select" data-change="qfilter" data-key="st" aria-label="Status"><option value="">Any status</option>${['Overdue', 'Not started', 'Done'].map(function (s) { return h`<option ${q.st === s ? 'selected' : ''}>${s}</option>`; })}</select></div>
      ${Q.table({ id: 'orgtr', rows: data, defaultSort: 'due', caption: 'Training records',
        cols: [{ key: 'name', label: 'User' }, { key: 'docLabel', label: 'Document' }, { key: 'assigned', label: 'Assigned', render: function (a) { return Q.fmtShort(a.assigned); } }, { key: 'due', label: 'Due', render: function (a) { return Q.fmtShort(a.due); } }, { key: 'completed', label: 'Completed', render: function (a) { return a.completed ? Q.fmtShort(a.completed) : '—'; } }, { key: 'st', label: 'Status', render: function (a) { return Q.chip(a.st, a.st === 'Done · kept' ? 'chip-done' : null); } }] })}
      <p class="small muted mt-8">Leavers’ records stay and are never deleted. A new major version of a document assigns training automatically to everyone in its rules.</p>`;
  }
  function orgRows() {
    var rows = [['User', 'Status', 'Document', 'Version', 'Rule', 'Assigned (UTC)', 'Due (UTC)', 'Completed (UTC)', 'Knowledge check', 'Signature']];
    Q.S.assignments.forEach(function (a) { var u = Q.user(a.user); rows.push([u.name, a.leaver ? 'Left' : u.status, a.doc, a.ver, a.rule, a.assigned, a.due, a.completed || '', a.quiz || '', a.sig || '']); });
    return rows;
  }
  Q.act['train-export'] = function () { Q.exportCsv('training-records.csv', orgRows(), 'organisation training records'); };
  Q.act['train-pdf'] = function () {
    var r = orgRows();
    Q.printHtml('Training records', '<h1>Organisation training records</h1><p>Generated ' + Q.fmtUtc(new Date().toISOString()) + ' by ' + Q.esc(Q.me().name) + '</p><table><tr>' + r[0].map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr>' + r.slice(1).map(function (row) { return '<tr>' + row.map(function (c) { return '<td>' + Q.esc(String(c).replace('T', ' ').replace(/\.\d+Z$/, 'Z')) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>', 'training records PDF');
  };

  function rulesTab() {
    return h`${Q.tip('rules', h`<b>Training rules</b> say who must train on which documents, and by when. Rules are versioned and only go live after a Quality Manager approves them, because they change how controlled processes run.`)}
      ${Q.table({ id: 'rules', rows: Q.S.trainingRules, defaultSort: 'id', href: function (r) { return '#/training?tab=rules&rule=' + r.id; },
        cols: [{ key: 'id', label: 'ID', cls: 'id' }, { key: 'name', label: 'Name' }, { key: 'groups', label: 'Applies to', sort: false, render: function (r) { return r.groups.concat((r.users || []).map(Q.fullName)).join(', '); } },
          { key: 'docs', label: 'Documents', sort: false, render: function (r) { return h`<span class="small">${r.docs.join(', ')}</span>`; } }, { key: 'days', label: 'Time allowed', render: function (r) { return r.days + ' days'; } },
          { key: 'retrainMonths', label: 'Retraining', render: function (r) { return r.retrainMonths ? 'Every ' + r.retrainMonths + ' months' : '—'; } }, { key: 'gate', label: 'Holds document', render: function (r) { return r.gate ? 'Yes' : 'No'; } },
          { key: 'version', label: 'Version', render: function (r) { return 'v' + r.version; } }, { key: 'status', label: 'Status', render: function (r) { return Q.stateChip(r.status); } }] })}`;
  }
  function openRule(r) {
    var canApprove = r.status === 'Pending approval' && Q.hasRole('qm') && !Q.readOnly();
    var mem = Q.ruleMembers(r);
    Q.drawer.open({
      kicker: 'Training rule · ' + r.id + ' v' + r.version, title: r.name, foot: canApprove ? h`<button class="btn btn-primary" type="submit">Approve and activate</button><button class="btn" type="button" data-act="drawer-close">Close</button>` : h`<button class="btn" type="button" data-act="drawer-close">Close</button>`,
      onClose: function () { if (Q.current.query.rule) Q.setQuery({ rule: '' }); },
      body: h`<div class="row-wrap mb-16">${Q.stateChip(r.status)}<span class="small muted">${r.approvedBy ? 'Approved by ' + Q.fullName(r.approvedBy) + ' on ' + Q.fmtDate(r.approvedAt) : 'Created by ' + Q.fullName(r.createdBy) + (r.createdAt ? ' on ' + Q.fmtDate(r.createdAt) : '')}</span></div>
        <p>${r.desc}</p>
        <dl class="dl mb-16"><div><dt>Applies to</dt><dd>${r.groups.concat((r.users || []).map(Q.fullName)).join(', ')} (${mem.length} people)</dd></div><div><dt>Time allowed</dt><dd>${r.days} days</dd></div>
          <div><dt>Retraining</dt><dd>${r.retrainMonths ? 'Every ' + r.retrainMonths + ' months' : 'None'}</dd></div><div><dt>Knowledge check</dt><dd>${r.quiz ? 'Yes' : 'No'}</dd></div>
          <div style="grid-column:1/-1"><dt>Holds documents in Pending training</dt><dd>${r.gate ? 'Yes: a document stays in Pending training until everyone has completed' : 'No: training is assigned when the document becomes effective'}</dd></div></dl>
        <div class="label mb-8">Required documents</div><div class="stack-sm">${r.docs.map(function (d) { return h`<div>${Q.recLink(d)}</div>`; })}</div>
        ${canApprove ? h`<div class="callout mt-24"><strong>Approving activates the rule</strong><p class="small" style="margin:4px 0 0">Training is assigned to ${mem.length} people for each effective document listed. Your approval is signed.</p></div>` : ''}`,
      submit: function () {
        Q.drawer.close();
        Q.sign({ items: [{ id: r.id, version: String(r.version), hash: Q.sha256(Q.canon(r)) }], meaning: 'Approved', meanings: ['Approved'], title: 'Approve training rule ' + r.id,
          onSigned: function () { var n = Q.wf.rule.approve(r); Q.toast(r.id + ' is active · ' + Q.plural(n, 'assignment') + ' created'); } });
      }
    });
  }
  Q.act['new-rule'] = function () {
    var docs = Object.keys(Q.S.docs).filter(function (id) { return ['Obsolete'].indexOf(Q.S.docs[id].state) < 0; });
    Q.drawer.open({
      kicker: 'Training', title: 'New training rule', submitLabel: 'Submit for approval',
      body: h`<div class="form-grid"><div class="field full"><label for="rn">Name</label><input class="input" id="rn" name="name" placeholder="e.g. New starters"></div>
        <div class="field full"><label for="rdsc">Description</label><textarea class="textarea" id="rdsc" name="desc" style="min-height:64px"></textarea></div>
        <fieldset class="full"><legend>Applies to groups</legend><div class="grid-2" style="gap:0 16px">${Q.S.groups.map(function (g) { return h`<label class="check"><input type="checkbox" data-multi name="groups" value="${g.name}"> ${g.name}</label>`; })}</div></fieldset>
        <fieldset class="full"><legend>Required documents</legend><div class="grid-2" style="gap:0 16px">${docs.map(function (id) { return h`<label class="check"><input type="checkbox" data-multi name="docs" value="${id}"> ${id} ${Q.S.docs[id].title}</label>`; })}</div></fieldset>
        <div class="field"><label for="rdays">Time allowed (days)</label><input class="input" id="rdays" name="days" type="number" min="1" value="14"></div>
        <div class="field"><label for="rret">Retrain every (months, optional)</label><input class="input" id="rret" name="retrain" type="number" min="1" placeholder="e.g. 12"></div>
        <label class="check full"><input type="checkbox" name="gate"> Hold new versions in Pending training until everyone completes</label>
        <label class="check full"><input type="checkbox" name="quiz" checked> Include a knowledge check</label></div>
        <p class="small muted mt-16">The rule is saved as v1 and stays inactive until a Quality Manager approves it.</p>`,
      submit: function (f, form) {
        if (!f.name) return Q.fieldError(form, 'name', 'Give the rule a name.');
        if (!f.groups.length) return Q.toast('Pick at least one group.', 'warn');
        if (!f.docs.length) return Q.toast('Pick at least one document.', 'warn');
        var r = Q.wf.rule.create(f); Q.drawer.close(); Q.toast(r.id + ' submitted for approval'); Q.go('#/training?tab=rules');
      }
    });
  };
})(window.Q);
