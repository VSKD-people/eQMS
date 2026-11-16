/* Home: "Today" — cards grouped by urgency, one primary action each, selected task beside the list. */
(function (Q) {
  'use strict';
  var h = Q.h;

  function myTasks(q) {
    var me = Q.S.session.userId;
    var list;
    if (q.who === 'created') {
      list = Q.S.tasks.filter(function (t) {
        var r = Q.rec(t.record);
        return t.status === 'open' && t.assignee !== me && !t.fyi && r && (r.createdBy === me || r.author === me || r.raisedBy === me);
      });
    } else list = Q.openTasks(me);
    var view = q.view && (Q.S.savedViews[me] || []).find(function (v) { return v.name === q.view; });
    if (view) list = list.filter(function (t) { return view.kinds.indexOf(t.kind) >= 0; });
    if (q.f === 'overdue') list = list.filter(function (t) { return !t.fyi && Q.daysFromToday(t.due) < 0; });
    if (q.f === 'upcoming') list = list.filter(function (t) { return t.fyi || Q.daysFromToday(t.due) >= 0; });
    return list.sort(Q.by(function (t) { return t.due || '9'; }));
  }
  function groups(list) {
    var g = { overdue: [], week: [], later: [] };
    list.forEach(function (t) {
      var n = Q.daysFromToday(t.due);
      if (t.fyi || n === null || n > 7) g.later.push(t);
      else if (n < 0) g.overdue.push(t);
      else g.week.push(t);
    });
    return g;
  }
  Q.taskCard = function (t, selected, opts) {
    opts = opts || {};
    var m = Q.taskMeta(t);
    var r = Q.rec(t.record);
    var signable = t.kind === 'approve-doc' && !opts.created;
    var chip = t.fyi ? Q.dueChip(t.due, { expected: true }) : Q.dueChip(t.due);
    return h`<div class="task-card ${selected ? 'selected' : ''}" data-act="pick-task" data-id="${t.id}" role="button" tabindex="0" aria-pressed="${!!selected}" aria-label="${m.label}: ${Q.taskTitle(t)}">
      ${signable ? h`<input type="checkbox" class="tc-check" data-change="batch" data-id="${t.id}" aria-label="Select for Sign all" ${(Q.ui.batch || []).indexOf(t.id) >= 0 ? 'checked' : ''}>` : ''}
      <div class="tc-body">
        <div class="tc-kicker"><span>${m.label}</span>${chip}${r && r.classification && r.classification !== 'Internal' ? Q.cls(r.classification) : (selected && r && r.classification ? Q.cls(r.classification) : '')}${opts.created ? h`<span>· waiting on ${Q.fullName(t.assignee)}</span>` : ''}</div>
        <div class="tc-title">${Q.taskTitle(t)}</div>
      </div>
      ${opts.created ? '' : t.fyi ? h`<button class="btn-link" data-act="task-go" data-id="${t.id}">${m.action}</button>` : h`<button class="btn ${selected ? 'btn-primary' : ''}" data-act="task-go" data-id="${t.id}">${m.action}</button>`}
    </div>`;
  };

  Q.views.today = function (p, q) {
    var me = Q.me();
    var all = Q.openTasks();
    var overdueN = all.filter(function (t) { return !t.fyi && Q.daysFromToday(t.due) < 0; }).length;
    var weekN = all.filter(function (t) { var n = Q.daysFromToday(t.due); return !t.fyi && n >= 0 && n <= 7; }).length;
    var list = myTasks(q);
    var g = groups(list);
    var sel = list.find(function (t) { return t.id === Q.ui.selTask; }) || g.overdue[0] || g.week[0] || g.later[0];
    if (sel) Q.ui.selTask = sel.id;
    var created = q.who === 'created';
    var views = Q.S.savedViews[me.id] || [];
    var batch = (Q.ui.batch || []).filter(function (id) { return list.some(function (t) { return t.id === id; }); });

    function section(label, arr, cls) {
      if (!arr.length) return '';
      return h`<div class="group-label ${cls || ''}">${label} · ${arr.length}</div>${arr.map(function (t) { return Q.taskCard(t, sel && t.id === sel.id, { created: created }); })}`;
    }

    var body;
    if (!list.length) {
      body = Q.empty(q.f === 'overdue' ? 'Nothing overdue' : 'You’re all caught up', created ? 'Nobody is waiting on records you created.' : 'New tasks appear here as soon as they’re assigned to you.', Q.readOnly() ? h`<a class="btn" href="#/documents">Browse records</a>` : '');
    } else {
      body = h`${section('Overdue', g.overdue, 'overdue')}${section('Next 7 days', g.week)}${section('Upcoming', g.later)}`;
    }

    return h`
      <div class="page-head">
        <div><h1 class="display">Today</h1><div class="sub">${Q.fmtLong(new Date())} · ${overdueN} overdue · ${weekN} due in the next 7 days</div></div>
        <div class="row-wrap">
          <div class="seg" role="group" aria-label="Due filter">
            ${[['', 'All'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue']].map(function (o) { return h`<button class="${(q.f || '') === o[0] ? 'active' : ''}" data-act="tab" data-key="f" data-tab="${o[0]}" aria-pressed="${(q.f || '') === o[0]}">${o[1]}</button>`; })}
          </div>
          <div class="seg tint" role="group" aria-label="Whose tasks">
            <button class="${!created ? 'active' : ''}" data-act="tab" data-key="who" data-tab="" aria-pressed="${!created}">Assigned to me</button>
            <button class="${created ? 'active' : ''}" data-act="tab" data-key="who" data-tab="created" aria-pressed="${created}">Created by me</button>
          </div>
          <button class="btn btn-sm desktop-only" data-act="views-menu" aria-haspopup="menu" style="min-height:40px">${q.view ? 'Saved view: ' + q.view : 'Saved views'} ${Q.icon('chevronDown', 'ico-sm')}</button>
        </div>
      </div>
      ${Q.tip('today', h`<b>Today</b> shows everything assigned to you, grouped by urgency. Select a card to see the record and act on it. On a computer, tick approvals to sign several at once with one fresh sign-in.`)}
      ${batch.length ? h`<div class="callout spread mb-16"><span><strong>${batch.length} approval${batch.length > 1 ? 's' : ''} selected.</strong> One fresh sign-in covers the batch; each record gets its own signature.</span><span class="btn-row"><button class="btn btn-primary" data-act="sign-all">Sign all (${batch.length})</button><button class="btn" data-act="batch-clear">Clear</button></span></div>` : ''}
      <div class="split-today">
        <div>${body}<p class="small muted mt-16">Sample records, for layout only.</p></div>
        <div class="selected-wrap">${sel && !created ? Q.selectedPanel(sel) : sel ? Q.selectedPanel(sel, true) : ''}</div>
      </div>`;
  };

  Q.selectedPanel = function (t, readonly) {
    var r = Q.rec(t.record), k = Q.kindOf(t.record), m = Q.taskMeta(t);
    var inner;
    if (k === 'doc') {
      var d = r, v = Q.curVer(d);
      var states = ['Draft', 'In review', 'Review closed', 'In approval', 'Pending training', 'Effective'];
      var si = states.indexOf(d.state);
      var rule = Q.S.trainingRules.find(function (x) { return x.id === d.trainingRule; });
      var revDone = d.reviewers.filter(function (x) { return x.status === 'Reviewed'; }).length;
      inner = h`
        <h2>${d.id} ${d.title} v${v.v}</h2>
        ${t.note ? h`<div class="small muted" style="margin-top:2px">${t.note}</div>` : ''}
        <div class="mt-16">${Q.stepper(states, d.state, null, { mini: true })}</div>
        <div class="small muted mt-8">Stage ${si + 1} of ${states.length}: ${d.state}</div>
        <hr>
        <div style="font-weight:600;margin-bottom:4px" class="small">Change summary</div>
        <p class="small">${v.summary}</p>
        <dl class="dl mt-16"><div><dt>Owner</dt><dd>${Q.name(d.owner)}</dd></div><div><dt>Reviewers</dt><dd>${revDone} of ${d.reviewers.length} done</dd></div>
          <div><dt>Training on effective</dt><dd>${rule ? 'Rule: ' + rule.name : 'None'}</dd></div><div><dt>Classification</dt><dd>${d.classification}</dd></div></dl>
        ${t.kind === 'approve-doc' && Q.sodBlock(d, 'doc') ? h`<div class="callout warn mt-16"><strong>Segregation of duties</strong><p class="small" style="margin:4px 0 0">${Q.sodBlock(d, 'doc')} Ask a System Administrator to replace you as approver.</p></div>` : ''}`;
    } else if (k === 'review') {
      var doc = Q.S.docs[r.doc];
      inner = h`<h2>Periodic review · ${doc.id}</h2><p class="small muted" style="margin-top:2px">${doc.title} v${(Q.effVer(doc) || Q.curVer(doc)).v}</p>
        <dl class="dl mt-16"><div><dt>Review due</dt><dd>${Q.fmtDate(r.due)}</dd></div><div><dt>Frequency</dt><dd>Every ${doc.periodic.months} months</dd></div><div><dt>Last effective</dt><dd>${Q.fmtDate(doc.effective)}</dd></div><div><dt>Approval required</dt><dd>${r.approval ? 'Yes' : 'No'}</dd></div></dl>
        <p class="small mt-16">Choose <b>No update needed</b> (signed; the next review date resets) or <b>Needs update</b> (starts a new draft or a change request).</p>`;
    } else if (r) {
      var states2 = { cr: ['Planning', 'Review', 'Approval', 'In execution', 'Effectiveness check', 'Closed'], capa: ['Planning', 'Execution', 'Effectiveness check', 'Closed'], qe: ['Open', 'Assessment', 'CAPA raised', 'Closed'], obs: ['New', 'Escalated'] }[k];
      inner = h`<h2>${t.record} ${Q.recTitle(t.record)}</h2>
        <div class="row-wrap mt-8">${Q.stateChip(r.state || r.status)}${r.severity ? Q.sev(r.severity) : ''}${r.size ? Q.chip(r.size + ' change', 'chip-outline') : ''}${r.classification ? Q.cls(r.classification) : ''}</div>
        ${states2 ? h`<div class="mt-16">${Q.stepper(states2, r.state, null, { mini: true })}</div>` : ''}
        <hr>
        <p class="small">${r.description || r.desc || r.details || r.desc || ''}</p>
        <dl class="dl mt-16"><div><dt>Owner</dt><dd>${Q.name(r.owner || r.createdBy)}</dd></div><div><dt>Due</dt><dd>${t.due ? Q.fmtDate(t.due) : '—'}</dd></div>
        ${t.ref && r.actions ? h`<div style="grid-column:1/-1"><dt>Your action</dt><dd>${(r.actions.find(function (a) { return a.id === t.ref; }) || {}).title || ''}</dd></div>` : ''}</dl>`;
    } else {
      inner = h`<h2>${Q.taskTitle(t)}</h2><p class="small muted">${t.note || ''}</p>`;
    }
    return h`<div class="card selected-panel" style="position:sticky;top:84px">
      <div class="label mb-8">${readonly ? 'Waiting on ' + Q.fullName(t.assignee) : 'Selected task · ' + m.label}</div>
      ${inner}
      <div class="btn-row mt-24">${readonly || t.fyi ? '' : h`<button class="btn btn-primary" data-act="task-go" data-id="${t.id}">${m.action}</button>`}<a class="btn" href="${Q.taskHref(t)}">Open full record</a></div>
    </div>`;
  };

  // ---------- Actions ----------
  Q.act['pick-task'] = function (el, e) {
    if (e.target.closest('button, input, a')) return;
    var id = el.getAttribute('data-id');
    if (window.innerWidth <= 980) { Q.go('#/task/' + id); return; }
    Q.ui.selTask = id; Q.render({ keepScroll: true });
    var again = document.querySelector('.task-card[data-id="' + id + '"]'); if (again) again.focus();
  };
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('task-card')) { e.preventDefault(); Q.act['pick-task'](e.target, e); }
  });
  Q.taskGo = function (t) {
    switch (t.kind) {
      case 'approve-doc': Q.signDoc(t.record); break;
      case 'training': Q.go('#/training?doc=' + t.record); break;
      case 'capa-action': case 'capa-plan': Q.go('#/quality/' + t.record + '?tab=actions'); break;
      case 'effectiveness': Q.go('#/quality/' + t.record + '?tab=effectiveness'); break;
      case 'cr-action': Q.go('#/changes/' + t.record + '?tab=actions'); break;
      case 'cr-effectiveness': Q.go('#/changes/' + t.record + '?tab=effectiveness'); break;
      default: Q.go(Q.taskHref(t));
    }
  };
  Q.act['task-go'] = function (el) {
    var t = Q.S.tasks.find(function (x) { return x.id === el.getAttribute('data-id'); });
    if (t) Q.taskGo(t);
  };
  Q.on.batch = function (el) {
    var id = el.getAttribute('data-id');
    Q.ui.batch = Q.ui.batch || [];
    if (el.checked) { if (Q.ui.batch.indexOf(id) < 0) Q.ui.batch.push(id); } else Q.ui.batch = Q.ui.batch.filter(function (x) { return x !== id; });
    Q.render({ keepScroll: true });
  };
  Q.act['batch-clear'] = function () { Q.ui.batch = []; Q.render({ keepScroll: true }); };
  Q.act['sign-all'] = function () {
    var tasks = (Q.ui.batch || []).map(function (id) { return Q.S.tasks.find(function (t) { return t.id === id && t.status === 'open'; }); }).filter(Boolean);
    var blocked = [];
    var items = tasks.map(function (t) { return Q.S.docs[t.record]; }).filter(function (d) { var b = Q.sodBlock(d, 'doc'); if (b) blocked.push(d.id); return !b; })
      .map(function (d) { var v = Q.curVer(d); return { id: d.id, version: v.v, hash: v.hash, label: d.id + ' ' + d.title + ' v' + v.v }; });
    if (blocked.length) Q.toast('Left out ' + blocked.join(', ') + ': segregation of duties', 'warn');
    if (!items.length) return;
    Q.sign({ items: items, meaning: 'Approved', meanings: ['Approved'], title: 'Sign ' + items.length + ' approvals',
      onSigned: function (sigs) { sigs.forEach(function (s) { Q.wf.doc.approve(Q.S.docs[s.record], s); }); Q.ui.batch = []; Q.toast(sigs.length + ' approvals signed'); } });
  };
  Q.act['views-menu'] = function (el) {
    var views = Q.S.savedViews[Q.S.session.userId] || [];
    var q = Q.current.query;
    Q.menu.open(el, h`<div class="menu-label">Saved views</div>
      <button class="menu-item ${!q.view ? 'active' : ''}" data-act="tab" data-key="view" data-tab="">All my work</button>
      ${views.map(function (v) { return h`<button class="menu-item ${q.view === v.name ? 'active' : ''}" data-act="tab" data-key="view" data-tab="${v.name}">${v.name}</button>`; })}
      <div class="menu-sep"></div><button class="menu-item" data-act="save-view">${Q.icon('plus', 'ico-sm')} Save current filters as a view…</button>`);
  };
  Q.act['save-view'] = function () {
    var kinds = Object.keys(Q.TASK_META);
    Q.drawer.open({
      kicker: 'Saved views', title: 'Save a view', submitLabel: 'Save view',
      body: h`<div class="field mb-16"><label for="vn">Name</label><input class="input" id="vn" name="name" placeholder="e.g. My reviews"></div>
        <fieldset><legend>Show these task types</legend>${kinds.map(function (k) { return h`<label class="check"><input type="checkbox" data-multi name="kinds" value="${k}"> ${Q.TASK_META[k].label}</label>`; })}</fieldset>`,
      submit: function (f, form) {
        if (!f.name) return Q.fieldError(form, 'name', 'Give the view a name.');
        if (!f.kinds.length) return Q.toast('Pick at least one task type.', 'warn');
        var me = Q.S.session.userId; (Q.S.savedViews[me] = Q.S.savedViews[me] || []).push({ name: f.name, kinds: f.kinds });
        Q.save(); Q.drawer.close(); Q.setQuery({ view: f.name }); Q.toast('View saved');
      }
    });
  };

  // Shared: approve a document (SoD check, then e-signature)
  Q.signDoc = function (id) {
    var d = Q.S.docs[id];
    var a = d.approvers.find(function (x) { return x.u === Q.S.session.userId; });
    if (!a || a.status !== 'Your turn') { Q.toast(a ? 'It isn’t your turn to approve yet.' : 'You aren’t an approver on this document.', 'warn'); return; }
    var block = Q.sodBlock(d, 'doc');
    if (block) { Q.toast(block, 'warn'); Q.audit('sod.block', 'Document', id, 'Signature blocked by segregation of duties for ' + Q.fullName(Q.S.session.userId)); Q.save(); return; }
    var v = Q.curVer(d);
    Q.sign({ items: [{ id: d.id, version: v.v, hash: v.hash }], meaning: 'Approved', meanings: ['Approved'],
      onSigned: function (sigs) { Q.wf.doc.approve(d, sigs[0]); Q.toast('Signed ' + d.id + ' v' + v.v); } });
  };

  // ---------- Mobile: task list and task detail ----------
  Q.views.tasks = function (p, q) {
    var list = myTasks(q);
    return h`<div class="page-head"><div><h1>Tasks</h1><div class="sub">${Q.plural(list.length, 'open task')}</div></div>
      <div class="seg" role="group" aria-label="Due filter">${[['', 'All'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue']].map(function (o) { return h`<button class="${(q.f || '') === o[0] ? 'active' : ''}" data-act="tab" data-key="f" data-tab="${o[0]}">${o[1]}</button>`; })}</div></div>
      ${list.length ? list.map(function (t) { return Q.taskCard(t, false); }) : Q.empty('Nothing here', 'You have no tasks with this filter.')}`;
  };
  Q.views.task = function (p) {
    var t = Q.S.tasks.find(function (x) { return x.id === p.id; });
    if (!t) return Q.views.notFound();
    var m = Q.taskMeta(t), r = Q.rec(t.record), k = Q.kindOf(t.record);
    var signable = t.kind === 'approve-doc' && t.status === 'open';
    var v = k === 'doc' ? Q.curVer(r) : null;
    return h`<a class="btn-link" href="#/today" style="padding:0">${Q.icon('back', 'ico-sm')} Today</a>
      <div class="mt-8"><div class="small muted">${m.label}${t.fyi ? '' : ' · '}${t.fyi ? '' : Q.dueChip(t.due)}</div><h1 style="margin-top:6px">${Q.taskTitle(t)}</h1>${t.note ? h`<p class="muted small">${t.note}</p>` : ''}</div>
      ${k === 'doc' ? h`<a class="card card-pad spread mt-16" href="#/documents/${r.id}" style="text-decoration:none;color:inherit"><span><b>Read the document</b><br><span class="small muted">${r.id} v${v.v} · ${v.content.length > 8 ? '2' : '1'} pages</span></span>${Q.icon('chevron')}</a>
        <div class="card card-pad mt-16"><div class="label mb-8">Change summary</div><p class="small" style="margin:0">${v.summary}</p></div>` : h`<div class="mt-16">${Q.selectedPanel(t)}</div>`}
      ${signable ? h`<div class="card card-pad mt-16"><div class="label mb-8">Meaning of your signature</div><p class="small" style="margin:0">${Q.statementFor('Approved')}</p></div>
        <div class="callout mt-16"><strong>You’ll sign in again</strong><p class="small" style="margin:4px 0 0">Face or fingerprint unlock opens the app but never counts as a signature.</p></div>
        <div class="stack-sm mt-16"><button class="btn btn-primary" data-act="task-go" data-id="${t.id}">Continue to sign-in</button><button class="btn" data-act="doc-sendback" data-id="${r.id}">Send back with a reason</button></div>` :
        t.status === 'open' && !t.fyi ? h`<div class="stack-sm mt-16"><button class="btn btn-primary" data-act="task-go" data-id="${t.id}">${m.action}</button></div>` : ''}`;
  };
})(window.Q);
