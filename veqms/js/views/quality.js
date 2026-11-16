/* Observations, Quality Events and CAPA. */
(function (Q) {
  'use strict';
  var h = Q.h;
  var QE_STATES = ['Open', 'Assessment', 'CAPA raised', 'Closed'];
  var CAPA_STATES = ['Planning', 'Execution', 'Effectiveness check', 'Closed'];
  var OBS_STATES = ['New', 'Escalated', 'Closed'];
  Q.QE_TYPES = ['Nonconformance', 'Deviation', 'Complaint', 'Audit finding', 'Security incident'];
  Q.OBS_AREAS = ['Physical security', 'Information handling', 'Access control', 'IT systems', 'Suppliers', 'Facilities', 'Other'];
  function vals(o) { return Object.keys(o).map(function (k) { return o[k]; }); }

  Q.views.quality = function (p, q) {
    var tab = q.tab || 'events';
    var board = q.view === 'board';
    var tabs = [['observations', 'Observations · ' + vals(Q.S.obs).filter(function (o) { return o.state === 'New'; }).length + ' new'], ['events', 'Quality events'], ['capa', 'CAPA']];
    var body;
    if (tab === 'observations') {
      var obs = vals(Q.S.obs).filter(function (o) { return Q.canSee(o); });
      body = board ? Q.boardView(OBS_STATES, obs, function (o) { return h`<a class="board-card" href="#/quality/${o.id}"><div class="bc-id">${o.id} · ${o.area}</div><div class="bc-title">${o.title}</div><div class="small muted">Raised by ${Q.fullName(o.raisedBy)} · ${Q.fmtShort(o.at)}</div></a>`; })
        : Q.table({ id: 'obs', rows: obs.map(function (o) { return Object.assign({ by: Q.fullName(o.raisedBy), own: Q.fullName(o.owner) }, o); }), defaultSort: 'at', defaultDir: -1, href: function (o) { return '#/quality/' + o.id; },
          cols: [{ key: 'id', label: 'ID', cls: 'id' }, { key: 'title', label: 'Observation', render: function (o) { return h`<a href="#/quality/${o.id}">${o.title}</a>${o.attachments.length ? h` <span class="muted">${Q.icon('camera', 'ico-sm')}</span>` : ''}`; } }, { key: 'area', label: 'Area' }, { key: 'state', label: 'State', render: function (o) { return Q.stateChip(o.state); } }, { key: 'by', label: 'Raised by' }, { key: 'own', label: 'Owner' }, { key: 'at', label: 'Raised', render: function (o) { return Q.fmtDateTime(o.at); } }] });
    } else if (tab === 'capa') {
      var capas = vals(Q.S.capas).filter(function (c) { return Q.canSee(c); });
      body = board ? Q.boardView(CAPA_STATES, capas, function (c) { var done = c.actions.filter(function (a) { return a.status === 'Done'; }).length; return h`<a class="board-card" href="#/quality/${c.id}"><div class="bc-id">${c.id} · from ${c.source}</div><div class="bc-title">${c.title}</div><div class="row-wrap small">${Q.sev(c.severity)}<span class="muted">${done}/${c.actions.length} actions</span></div></a>`; })
        : Q.table({ id: 'capa', rows: capas.map(function (c) { return Object.assign({ own: Q.fullName(c.owner), prog: c.actions.filter(function (a) { return a.status === 'Done'; }).length + ' of ' + c.actions.length }, c); }), defaultSort: 'id', defaultDir: -1, href: function (c) { return '#/quality/' + c.id; },
          cols: [{ key: 'id', label: 'ID', cls: 'id' }, { key: 'title', label: 'Title', render: function (c) { return h`<a href="#/quality/${c.id}">${c.title}</a>`; } }, { key: 'source', label: 'Source event' }, { key: 'severity', label: 'Severity', render: function (c) { return Q.sev(c.severity); } }, { key: 'state', label: 'State', render: function (c) { return Q.stateChip(c.state); } }, { key: 'prog', label: 'Actions done' }, { key: 'own', label: 'Process owner' }, { key: 'classification', label: 'Class', render: function (c) { return Q.cls(c.classification); } }] });
    } else {
      var evs = vals(Q.S.events).filter(function (e) { return Q.canSee(e); });
      body = board ? Q.boardView(QE_STATES, evs, function (e) { return h`<a class="board-card" href="#/quality/${e.id}"><div class="bc-id">${e.id} · ${e.type}</div><div class="bc-title">${e.title}</div><div class="row-wrap small">${Q.sev(e.severity)}${e.capa ? h`<span class="muted">${e.capa}</span>` : ''}</div></a>`; })
        : Q.table({ id: 'qe', rows: evs.map(function (e) { return Object.assign({ own: Q.fullName(e.owner) }, e); }), defaultSort: 'id', defaultDir: -1, href: function (e) { return '#/quality/' + e.id; },
          cols: [{ key: 'id', label: 'ID', cls: 'id' }, { key: 'title', label: 'Title', render: function (e) { return h`<a href="#/quality/${e.id}">${e.title}</a>`; } }, { key: 'type', label: 'Type' }, { key: 'severity', label: 'Severity', render: function (e) { return Q.sev(e.severity); } }, { key: 'state', label: 'State', render: function (e) { return Q.stateChip(e.state); } }, { key: 'capa', label: 'CAPA', render: function (e) { return e.capa ? Q.recLink(e.capa, { short: true }) : e.state === 'Closed' ? h`<span class="small muted">Closed without CAPA</span>` : '—'; } }, { key: 'own', label: 'Owner' }, { key: 'due', label: 'Due', render: function (e) { return e.state === 'Closed' ? '—' : Q.dueChip(e.due); } }] });
    }
    return h`<div class="page-head"><div><h1>Quality events and CAPA</h1><div class="sub">Anyone can raise an observation. Owners escalate it to a quality event or close it with a reason.</div></div>
      <div class="btn-row"><div class="seg" role="group" aria-label="View"><button class="${!board ? 'active' : ''}" data-act="tab" data-key="view" data-tab="">${Q.icon('list', 'ico-sm')}<span class="sr-only">List view</span></button><button class="${board ? 'active' : ''}" data-act="tab" data-key="view" data-tab="board">${Q.icon('board', 'ico-sm')}<span class="sr-only">Board view</span></button></div>
      ${Q.can('obs.raise') ? h`<button class="btn" data-act="new-obs">Raise observation</button>` : ''}${Q.can('qe.create') ? h`<button class="btn btn-primary" data-act="new-qe">${Q.icon('plus', 'ico-sm')} Quality event</button>` : ''}</div></div>
      <div class="tabs" role="tablist">${tabs.map(function (t) { return h`<button class="tab ${tab === t[0] ? 'active' : ''}" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>
      ${Q.tip('quality', h`<b>Quality events and CAPA.</b> Observation → (escalate) → Quality event → CAPA: Planning → Execution → Effectiveness check → Closed. Closing an event without a CAPA needs a justification and a signature.`)}
      ${body}`;
  };

  Q.views.qualityRecord = function (p, q) {
    var id = p.id;
    if (Q.S.obs[id]) return obsView(Q.S.obs[id]);
    if (Q.S.events[id]) return qeView(Q.S.events[id], q);
    if (Q.S.capas[id]) return capaView(Q.S.capas[id], q);
    return Q.views.notFound();
  };
  function guard(r) {
    if (Q.canSee(r)) { Q.ui.recent = [r.id].concat((Q.ui.recent || []).filter(function (x) { return x !== r.id; })).slice(0, 6); return null; }
    Q.audit('read', 'Record', r.id, 'Access denied: ' + r.id + ' is ' + r.classification); Q.save();
    return h`<div class="card card-pad"><h1>${r.id} is ${r.classification}</h1><p class="muted">You need clearance or named access to open it. The attempt was logged.</p><a class="btn" href="#/quality">Back</a></div>`;
  }
  function crumbs(id, tab) { return h`<nav class="breadcrumb" aria-label="Breadcrumb"><a href="#/quality?tab=${tab}">Quality events and CAPA</a><span>/</span><span>${id}</span>${tab !== 'observations' ? h`<span>·</span><a href="#/quality?tab=${tab}&view=board">Switch to board view</a>` : ''}</nav>`; }

  // ---------- Observation ----------
  function obsView(o) {
    var g = guard(o); if (g) return g;
    var mine = o.owner === Q.S.session.userId && o.state === 'New' && !Q.readOnly();
    return h`${crumbs(o.id, 'observations')}
      <div class="page-head"><div><div class="record-meta"><span>Observation · ${o.id}</span>${Q.stateChip(o.state)}${Q.cls(o.classification)}</div><h1>${o.title}</h1></div>
        ${mine ? h`<div class="btn-row"><button class="btn" data-act="obs-close" data-id="${o.id}">Close with a reason</button><button class="btn btn-primary" data-act="obs-escalate" data-id="${o.id}">Escalate to quality event</button></div>` : ''}</div>
      <div class="card mb-16">${Q.stepper(['New', 'Initial review', o.state === 'Closed' ? 'Closed' : 'Escalated'], o.state === 'New' ? 'Initial review' : o.state === 'Closed' ? 'Closed' : 'Escalated', null, { allDone: o.state !== 'New' })}</div>
      <div class="split"><div class="stack">
        <div class="card card-pad"><div class="label mb-8">What was noticed</div><p>${o.details}</p>${o.location ? h`<p class="small muted" style="margin:0">${Q.icon('pin', 'ico-sm')} ${o.location}</p>` : ''}</div>
        ${o.attachments.length ? h`<div class="card card-pad"><div class="label mb-8">Photos and files</div>${o.attachments.map(function (a) { return h`<div class="people-row"><span class="who">${Q.icon('camera', 'ico-sm')}<span>${a.name} · ${a.size}</span></span><span class="health ${a.scan === 'clean' ? 'h-ok' : 'h-warn'}">${a.scan === 'clean' ? 'Scanned clean' : 'Scanning…'}</span></div>`; })}</div>` : ''}
        ${o.closure ? h`<div class="callout plain"><b style="color:var(--ink)">Closed by ${Q.fullName(o.closure.by)} on ${Q.fmtDate(o.closure.at)}</b><p class="small" style="margin:4px 0 0">${o.closure.justification}</p></div>` : ''}
        ${o.escalatedTo ? h`<div class="callout"><strong>Escalated</strong><p class="small" style="margin:4px 0 0">Now tracked as ${Q.recLink(o.escalatedTo)}.</p></div>` : ''}
      </div><aside class="context">
        <div class="card ctx-card"><span class="label">Details</span><dl class="dl"><div><dt>Raised by</dt><dd>${Q.name(o.raisedBy)}</dd></div><div><dt>Raised</dt><dd>${Q.fmtDateTime(o.at)}</dd></div><div><dt>Process area</dt><dd>${o.area}</dd></div><div><dt>Owner</dt><dd>${Q.name(o.owner)}</dd></div></dl>${o.offline ? h`<p class="small muted mt-8">Raised offline on a phone and synced later.</p>` : ''}</div>
        ${Q.linkedCard(o.id)}${Q.activityCard(o.id)}</aside></div>`;
  }
  Q.act['obs-escalate'] = function (el) {
    var o = Q.S.obs[el.getAttribute('data-id')];
    Q.drawer.open({ kicker: o.id, title: 'Escalate to a quality event', submitLabel: 'Create quality event',
      body: h`<div class="form-grid"><div class="field"><label for="et">Type</label><select class="select" id="et" name="type">${Q.QE_TYPES.map(function (t) { return h`<option>${t}</option>`; })}</select></div>
        <div class="field"><label for="es">Severity</label><select class="select" id="es" name="severity"><option>Low</option><option>High</option></select><div class="help">High notifies the Quality Manager and posts to the #quality-events Teams channel.</div></div>
        <div class="field full"><label for="ep">Quality process</label><select class="select" id="ep" name="process">${Q.PROCESSES.map(function (p) { return h`<option ${p.indexOf(o.area) >= 0 ? 'selected' : ''}>${p}</option>`; })}</select></div></div>`,
      submit: function (f) { var qe = Q.wf.obs.escalate(o, f); Q.drawer.close(); Q.toast('Escalated to ' + qe.id); Q.go('#/quality/' + qe.id); } });
  };
  Q.act['obs-close'] = function (el) {
    var o = Q.S.obs[el.getAttribute('data-id')];
    Q.drawer.open({ kicker: o.id, title: 'Close the observation', submitLabel: 'Close observation',
      body: h`<div class="field"><label for="oj">Justification (required)</label><textarea class="textarea" id="oj" name="j" placeholder="Why this doesn’t need a quality event"></textarea><div class="help">The person who raised it is told, with this reason.</div></div>`,
      submit: function (f, form) { if (!f.j) return Q.fieldError(form, 'j', 'A written justification is required.'); Q.wf.obs.close(o, f.j); Q.drawer.close(); Q.toast(o.id + ' closed'); Q.refresh(); } });
  };

  // ---------- Quality event ----------
  function qeView(e, q) {
    var g = guard(e); if (g) return g;
    var me = Q.S.session.userId;
    var canAct = (e.owner === me || Q.hasRole('qm')) && !Q.readOnly() && (e.state === 'Open' || e.state === 'Assessment');
    return h`${crumbs(e.id, 'events')}
      <div class="page-head"><div><div class="record-meta"><span>Quality event · ${e.id} · ${e.type}</span>${Q.sev(e.severity)}${Q.cls(e.classification)}${e.legalHold ? Q.chip('Legal hold', 'chip-overdue') : ''}</div><h1>${e.title}</h1></div>
        ${canAct ? h`<div class="btn-row"><button class="btn" data-act="qe-close" data-id="${e.id}">Close without CAPA</button><button class="btn btn-primary" data-act="qe-capa" data-id="${e.id}">Raise CAPA</button></div>` : ''}</div>
      <div class="card mb-16">${Q.stepper(QE_STATES, e.state, null, { allDone: e.state === 'Closed' })}</div>
      <div class="split"><div class="stack">
        <div class="card card-pad"><div class="label mb-8">Description</div><p style="margin:0">${e.desc}</p></div>
        ${canAct ? h`<form class="card card-pad" data-submit="qe-assess" data-id="${e.id}"><div class="label mb-8">Assessment</div>
          <div class="form-grid"><div class="field full"><label for="qa">Impact and containment</label><textarea class="textarea" id="qa" name="assessment" placeholder="What was affected, how far, what has been done so far">${e.assessment}</textarea></div>
          <div class="field"><label for="qs">Severity</label><select class="select" id="qs" name="severity"><option ${e.severity === 'Low' ? 'selected' : ''}>Low</option><option ${e.severity === 'High' ? 'selected' : ''}>High</option></select><div class="help">Severity sets the CAPA route: High needs Quality Manager approval.</div></div></div>
          <button class="btn mt-16" type="submit">Save assessment</button></form>` : h`<div class="card card-pad"><div class="label mb-8">Assessment</div><p style="margin:0">${e.assessment || 'Not assessed yet.'}</p></div>`}
        ${e.closure ? h`<div class="callout plain"><b style="color:var(--ink)">Closed without CAPA · signed ${e.closure.sigId}</b><p class="small" style="margin:4px 0 0">${e.closure.justification}</p><p class="small muted" style="margin:4px 0 0">${Q.fullName(e.closure.by)} · ${Q.fmtDateTime(e.closure.at)}</p></div>` : ''}
        ${e.capa ? h`<div class="callout"><strong>CAPA raised</strong><p class="small" style="margin:4px 0 0">${Q.recLink(e.capa)} · ${Q.S.capas[e.capa] ? Q.S.capas[e.capa].state : ''}. Linked both ways.</p></div>` : ''}
      </div><aside class="context">
        <div class="card ctx-card"><span class="label">Details</span><dl class="dl"><div><dt>Owner</dt><dd>${Q.name(e.owner)}</dd></div><div><dt>Quality process</dt><dd>${e.process}</dd></div><div><dt>Due</dt><dd>${Q.fmtDate(e.due)}</dd></div><div><dt>Raised</dt><dd>${Q.fmtDate(e.created)}</dd></div><div style="grid-column:1/-1"><dt>Tags</dt><dd>${(e.tags || []).join(', ') || '—'}</dd></div>${e.source ? h`<div style="grid-column:1/-1"><dt>Source</dt><dd>${Q.recLink(e.source)}</dd></div>` : ''}</dl></div>
        ${Q.linkedCard(e.id)}${Q.activityCard(e.id)}</aside></div>`;
  }
  Q.on['qe-assess'] = function (form) { var e = Q.S.events[form.getAttribute('data-id')], f = Q.formData(form); Q.wf.qe.assess(e, f.assessment, f.severity); Q.toast('Assessment saved'); Q.refresh(); };
  Q.act['qe-capa'] = function (el) {
    var e = Q.S.events[el.getAttribute('data-id')];
    if (!e.assessment) { Q.toast('Save an assessment before you raise a CAPA.', 'warn'); return; }
    var c = Q.wf.qe.raiseCapa(e); Q.toast(c.id + ' created in Planning'); Q.go('#/quality/' + c.id + '?tab=actions');
  };
  Q.act['qe-close'] = function (el) {
    var e = Q.S.events[el.getAttribute('data-id')];
    Q.sign({ items: [{ id: e.id, hash: Q.sha256(Q.canon(e)) }], meaning: 'Closed without CAPA', meanings: ['Closed without CAPA'], title: 'Close ' + e.id + ' without a CAPA',
      extra: function () { return h`<div class="callout warn mb-16"><strong>Closing without a CAPA</strong><p class="small" style="margin:4px 0 0">This is blocked until you write a justification and sign it.</p></div><div class="field mb-16"><label for="cj">Justification (required)</label><textarea class="textarea" id="cj" name="justification" placeholder="Why no corrective or preventive action is needed"></textarea></div>`; },
      validate: function (f) { return f.justification && f.justification.length >= 15 ? null : { field: 'justification', msg: 'Write a justification of at least a sentence.' }; },
      onSigned: function (s, f) { Q.wf.qe.closeNoCapa(e, f.justification, s[0]); Q.toast(e.id + ' closed without CAPA'); } });
  };

  // ---------- CAPA ----------
  function capaView(c, q) {
    var g = guard(c); if (g) return g;
    var me = Q.S.session.userId, ro = Q.readOnly();
    var tab = q.tab || 'overview';
    var done = c.actions.filter(function (a) { return a.status === 'Done'; }).length;
    var isOwner = c.owner === me || Q.hasRole('qm');
    var acts = [];
    if (!ro) {
      if (c.state === 'Planning' && isOwner) acts.push(h`<button class="btn btn-primary" data-act="capa-plan" data-id="${c.id}">${c.severity === 'High' && !Q.hasRole('qm') ? 'Send plan to Quality Manager' : 'Approve actions and start'}</button>`);
      if (c.state === 'Planning' && c.planPending && Q.hasRole('qm') && !isOwner) acts.push(h`<button class="btn btn-primary" data-act="capa-plan" data-id="${c.id}">Approve actions and sign</button>`);
      if (c.state === 'Execution') {
        acts.push(h`<button class="btn" data-act="tab" data-tab="evidence">Upload evidence</button>`);
        if (c.awaitingApproval && c.approver === me) acts.push(h`<button class="btn btn-primary" data-act="capa-approve" data-id="${c.id}">Approve completed actions</button>`);
        else if (isOwner && !c.awaitingApproval) acts.push(h`<button class="btn btn-primary" data-act="capa-submit" data-id="${c.id}" ${done === c.actions.length ? '' : 'aria-disabled="true"'}>Submit actions for approval</button>`);
      }
      if (c.state === 'Effectiveness check' && (isOwner || (c.effectiveness.assignee === me))) acts.push(h`<button class="btn btn-primary" data-act="tab" data-tab="effectiveness">Record effectiveness</button>`);
    }
    var labels = { 'Planning': c.actionsLocked ? 'Planning · actions locked' : 'Planning', 'Execution': c.state === 'Execution' ? 'Execution · ' + done + ' of ' + c.actions.length + ' actions done' : 'Execution' };
    var tabs = [['overview', 'Overview'], ['actions', 'Actions · ' + c.actions.length], ['rootcause', 'Root cause'], ['risk', 'Risk assessment'], ['evidence', 'Evidence · ' + c.evidence.length], ['effectiveness', 'Effectiveness check']];
    var content = { overview: capaOverview, actions: capaActions, rootcause: rootCause, risk: risk, evidence: evidence, effectiveness: capaEff }[tab] || capaOverview;
    var src = Q.S.events[c.source];
    return h`${crumbs(c.id, 'capa')}
      <div class="page-head"><div><div class="record-meta"><span>CAPA · ${c.id} · from</span>${src ? h`<a href="#/quality/${src.id}">${src.id} ${src.title.split(':')[0]}</a>` : ''}${Q.sev(c.severity)}${Q.cls(c.classification)}</div><h1>${c.title}</h1></div><div class="btn-row">${acts}</div></div>
      ${c.awaitingApproval ? h`<div class="callout mb-16"><strong>Completed actions are with ${Q.fullName(c.approver)} for approval.</strong></div>` : ''}
      ${c.planPending && c.state === 'Planning' ? h`<div class="callout mb-16"><strong>Plan sent to the Quality Manager for approval.</strong> High severity route.</div>` : ''}
      <div class="card mb-16">${Q.stepper(CAPA_STATES, c.state, labels, { allDone: c.state === 'Closed' })}</div>
      <div class="split"><div style="min-width:0">
        <div class="tabs" role="tablist">${tabs.map(function (t) { return h`<button class="tab ${tab === t[0] ? 'active' : ''}" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>
        ${content(c, q)}
      </div><aside class="context">
        <div class="card ctx-card"><span class="label">Details</span><dl class="dl"><div><dt>Process owner</dt><dd>${Q.name(c.owner)}</dd></div><div><dt>Quality process</dt><dd>${c.process}</dd></div><div><dt>Route</dt><dd>${c.route}</dd></div><div><dt>Effectiveness check</dt><dd>${c.effectiveness.due ? 'Due ' + Q.fmtDate(c.effectiveness.due) : c.effectivenessPlan}</dd></div></dl></div>
        <div class="card ctx-card"><span class="label">Evidence</span>${c.evidence.length ? c.evidence.map(function (ev) { return h`<div class="people-row"><span class="small">${ev.name}${ev.pdf ? ' → PDF' : ''}</span><span class="health ${ev.scan === 'clean' ? 'h-ok' : 'h-warn'}">${ev.scan === 'clean' ? 'Scanned clean' : 'Scanning…'}</span></div>`; }) : h`<p class="small muted" style="margin:0">None yet.</p>`}<p class="small muted mt-8" style="margin-bottom:0">Files can’t be opened until the malware scan finishes.</p></div>
        ${Q.linkedCard(c.id)}${Q.activityCard(c.id)}</aside></div>`;
  }
  function capaOverview(c) {
    var src = Q.S.events[c.source];
    return h`<div class="card card-pad stack"><div><div class="label mb-8">Problem</div><p style="margin:0">${c.problem}</p></div>
      ${src ? h`<div><div class="label mb-8">Source event</div><p style="margin:0">${Q.recLink(src.id)} · ${src.type} · raised ${Q.fmtDate(src.created)}</p></div>` : ''}
      <div><div class="label mb-8">Root cause</div><p style="margin:0">${c.rootWhy != null && c.whys[c.rootWhy] ? c.whys[c.rootWhy] : 'Not set yet. Use the Root cause tab.'}</p></div>
      <div><div class="label mb-8">Progress</div><div class="progress"><div style="width:${Q.pct(c.actions.filter(function (a) { return a.status === 'Done'; }).length, c.actions.length)}%"></div></div><p class="small muted mt-8" style="margin-bottom:0">${c.actions.filter(function (a) { return a.status === 'Done'; }).length} of ${c.actions.length} actions done</p></div>
      ${c.effectiveness.result ? h`<div><div class="label mb-8">Effectiveness</div><p style="margin:0">${Q.chip(c.effectiveness.verdict, c.effectiveness.verdict === 'Effective' ? 'chip-done' : 'chip-overdue')} ${c.effectiveness.result}</p></div>` : ''}</div>`;
  }
  function capaActions(c) {
    var me = Q.S.session.userId;
    var editable = c.state === 'Planning' && !c.actionsLocked && (c.owner === me || Q.hasRole('qm')) && !Q.readOnly();
    return h`${!editable && c.state !== 'Planning' ? h`<p class="small muted">Actions are defined only during Planning and are now locked.</p>` : ''}
      <div class="label mb-8">Actions (set in Planning)</div>
      <div class="list-rows">${c.actions.length ? c.actions.map(function (a) {
        var mine = a.assignee === me && c.state === 'Execution' && a.status !== 'Done' && !Q.readOnly();
        return h`<div class="list-row"><div class="lr-main"><b>${a.type}</b> · ${a.title}${a.doc ? h` · ${Q.recLink(a.doc, { short: true })}` : ''}<div class="small muted">${Q.name(a.assignee)} · ${a.sig ? 'signature required' : 'no signature'}</div></div>
          ${mine ? h`<button class="btn btn-sm btn-primary" data-act="capa-done" data-id="${c.id}" data-a="${a.id}">${a.sig ? 'Complete and sign' : 'Mark done'}</button>` : a.status === 'Done' ? Q.chip(a.signedBy ? 'Done · signed' : 'Done', 'chip-done') : c.state === 'Planning' ? Q.chip('Planned', 'chip-outline') : a.status === 'In progress' ? Q.dueChip(a.due) : a.status === 'Not started' && Q.daysFromToday(a.due) > 7 ? Q.chip('Not started', 'chip-outline') : Q.dueChip(a.due)}
          ${editable ? h`<button class="icon-btn plain" data-act="capa-rmaction" data-id="${c.id}" data-a="${a.id}" aria-label="Remove action ${a.title}">${Q.icon('x', 'ico-sm')}</button>` : ''}</div>`;
      }) : h`<div class="empty" style="padding:20px">No actions yet. Add at least one corrective or preventive action.</div>`}</div>
      ${editable ? h`<button class="btn mt-16" data-act="capa-addaction" data-id="${c.id}">${Q.icon('plus', 'ico-sm')} Add action</button>` : ''}`;
  }
  function canEditRca(c) { return !Q.readOnly() && c.state !== 'Closed' && c.state !== 'Effectiveness check' && (c.owner === Q.S.session.userId || Q.hasRole('qm') || c.actions.some(function (a) { return a.assignee === Q.S.session.userId; })); }
  function rootCause(c, q) {
    var mode = q.rca || '5whys';
    var ed = canEditRca(c);
    var head = h`<div class="spread mb-16"><h2>${mode === 'fishbone' ? 'Fishbone' : '5 Whys'}</h2><div class="seg" role="group" aria-label="Method"><button class="${mode === '5whys' ? 'active' : ''}" data-act="tab" data-key="rca" data-tab="5whys">5 Whys</button><button class="${mode === 'fishbone' ? 'active' : ''}" data-act="tab" data-key="rca" data-tab="fishbone">Fishbone</button></div></div>`;
    if (mode === 'fishbone') {
      return h`${head}<div class="fishbone">${Object.keys(c.fishbone).map(function (k) { return h`<div class="bone"><h4><span>${k}</span><span class="muted">${c.fishbone[k].length}</span></h4><ul>${c.fishbone[k].map(function (x) { return h`<li>${x}</li>`; })}</ul>${ed ? h`<form data-submit="fb-add" data-id="${c.id}" data-k="${k}" class="row mt-8"><input class="input" name="v" style="min-height:36px;padding:6px 10px" placeholder="Add cause" aria-label="Add a ${k} cause"><button class="btn btn-sm" type="submit">Add</button></form>` : ''}</div>`; })}
        <div class="fish-spine"><div class="line"></div><div class="head">${c.problem}</div></div></div>`;
    }
    return h`${head}<form data-submit="whys-save" data-id="${c.id}"><div class="whys">
      <div class="why"><span class="why-label">Problem</span><span>${c.problem}</span><span></span></div>
      ${c.whys.map(function (w, i) { return h`<div class="why ${c.rootWhy === i ? 'root' : ''}"><span class="why-label">Why ${i + 1}</span>${ed ? h`<input class="input" name="w${i}" value="${w}" placeholder="${i > 0 && !c.whys[i - 1] ? 'Answer the previous why first' : 'Add an answer, or mark Why ' + i + ' as the root cause'}" aria-label="Why ${i + 1}">` : h`<span>${w || '—'}</span>`}${ed ? h`<label class="check small" style="min-height:32px"><input type="radio" name="root" value="${i}" ${c.rootWhy === i ? 'checked' : ''}> Root cause</label>` : c.rootWhy === i ? Q.chip('Root cause', 'chip-turn') : h`<span></span>`}</div>`; })}
      </div>
      <div class="callout mt-16"><strong>Root cause</strong><p class="small" style="margin:4px 0 0">${c.rootWhy != null && c.whys[c.rootWhy] ? c.whys[c.rootWhy] : 'Pick the why that is the root cause. Actions in Planning should answer it.'}</p></div>
      ${ed ? h`<button class="btn mt-16" type="submit">Save 5 Whys</button>` : ''}</form>`;
  }
  Q.on['whys-save'] = function (form) {
    var c = Q.S.capas[form.getAttribute('data-id')], f = Q.formData(form);
    var b = Q.clone(c.whys);
    c.whys = c.whys.map(function (_, i) { return f['w' + i] || ''; }); c.rootWhy = f.root != null ? +f.root : c.rootWhy;
    Q.audit('update', 'CAPA', c.id, 'Updated 5 Whys' + (c.rootWhy != null ? '; root cause is Why ' + (c.rootWhy + 1) : ''), { whys: b }, { whys: c.whys }); Q.toast('5 Whys saved'); Q.refresh();
  };
  Q.on['fb-add'] = function (form) {
    var c = Q.S.capas[form.getAttribute('data-id')], k = form.getAttribute('data-k'), v = Q.formData(form).v;
    if (!v) return; c.fishbone[k].push(v); Q.audit('update', 'CAPA', c.id, 'Added fishbone cause (' + k + '): ' + v); Q.refresh();
  };
  function risk(c) {
    var ed = canEditRca(c);
    var L = ['Unlikely', 'Possible', 'Likely'], I = ['Minor', 'Moderate', 'Major'];
    var lvl = function (l, i) { var s = l * i; return s >= 6 ? ['High', 'r-high'] : s >= 3 ? ['Medium', 'r-med'] : ['Low', 'r-low']; };
    var cur = c.risk.likelihood && c.risk.impact ? lvl(c.risk.likelihood, c.risk.impact) : null;
    return h`<div class="card card-pad"><div class="spread mb-16"><h2>Risk assessment</h2>${cur ? Q.chip(cur[0] + ' risk', cur[1] === 'r-high' ? 'chip-overdue' : cur[1] === 'r-med' ? 'chip-due' : 'chip-done') : Q.chip('Not assessed', 'chip-outline')}</div>
      <div class="risk-grid" role="grid" aria-label="Likelihood by impact"><div></div>${I.map(function (x) { return h`<div class="lbl">${x}</div>`; })}
      ${[3, 2, 1].map(function (l) { return h`<div class="lbl">${L[l - 1]}</div>${[1, 2, 3].map(function (i) { var x = lvl(l, i); var sel = c.risk.likelihood === l && c.risk.impact === i; return ed ? h`<button class="cell ${x[1]} ${sel ? 'sel' : ''}" data-act="risk-set" data-id="${c.id}" data-l="${l}" data-i="${i}" aria-pressed="${sel}" aria-label="${L[l - 1]} likelihood, ${I[i - 1]} impact: ${x[0]}">${x[0]}</button>` : h`<div class="cell ${x[1]} ${sel ? 'sel' : ''}">${x[0]}</div>`; })}`; })}</div>
      <form data-submit="risk-notes" data-id="${c.id}" class="mt-16"><div class="field"><label for="rn2">Notes</label><textarea class="textarea" id="rn2" name="notes" ${ed ? '' : 'disabled'}>${c.risk.notes}</textarea></div>${ed ? h`<button class="btn mt-8" type="submit">Save notes</button>` : ''}</form>
      <p class="small muted mt-8" style="margin-bottom:0">Link the risk to the risk register (${Q.recLink('REG-001', { short: true })}) when it changes the residual score.</p></div>`;
  }
  Q.act['risk-set'] = function (el) { var c = Q.S.capas[el.getAttribute('data-id')]; c.risk.likelihood = +el.getAttribute('data-l'); c.risk.impact = +el.getAttribute('data-i'); Q.audit('update', 'CAPA', c.id, 'Set risk to likelihood ' + c.risk.likelihood + ' × impact ' + c.risk.impact); Q.refresh(); };
  Q.on['risk-notes'] = function (form) { var c = Q.S.capas[form.getAttribute('data-id')]; c.risk.notes = Q.formData(form).notes; Q.audit('update', 'CAPA', c.id, 'Updated risk notes'); Q.toast('Saved'); Q.refresh(); };
  function evidence(c) {
    var can = !Q.readOnly() && c.state !== 'Closed';
    return h`${c.evidence.length ? h`<div class="list-rows">${c.evidence.map(function (ev, i) { return h`<div class="list-row">${Q.icon('clip')}<div class="lr-main"><b>${ev.name}</b>${ev.pdf ? ' → PDF' : ''}<div class="small muted">${Q.fullName(ev.by)} · ${Q.fmtDateTime(ev.at)}</div></div><span class="health ${ev.scan === 'clean' ? 'h-ok' : 'h-warn'}">${ev.scan === 'clean' ? 'Scanned clean' : 'Scanning…'}</span>${ev.scan === 'clean' ? h`<button class="btn btn-sm" data-act="ev-open" data-id="${c.id}" data-i="${i}">Open</button>` : h`<button class="btn btn-sm" disabled title="Available after the malware scan">Open</button>`}</div>`; })}</div>` : Q.empty('No evidence yet', 'Upload test results, screenshots or reports. Any file type; it is converted to PDF for the record.')}
      ${can ? h`<label class="drop mt-16">${Q.icon('upload')}<span>Upload evidence (any file type, converted to PDF for the record)</span><input type="file" class="sr-only" data-change="ev-upload" data-id="${c.id}" multiple></label>` : ''}`;
  }
  Q.on['ev-upload'] = function (el) {
    var c = Q.S.capas[el.getAttribute('data-id')];
    Array.prototype.forEach.call(el.files, function (f) {
      var ev = { name: f.name, pdf: !/\.pdf$/i.test(f.name), scan: 'scanning', by: Q.S.session.userId, at: new Date().toISOString() };
      c.evidence.push(ev);
      Q.audit('upload', 'CAPA', c.id, 'Uploaded evidence ' + f.name + ' (malware scan started)');
      setTimeout(function () { ev.scan = 'clean'; Q.audit('scan', 'CAPA', c.id, f.name + ' scanned clean' + (ev.pdf ? '; converted to PDF' : ''), null, null, { actor: 'system' }); Q.refresh(); }, 2500);
    });
    Q.toast('Uploading and scanning…'); Q.refresh();
  };
  Q.act['ev-open'] = function (el) { var c = Q.S.capas[el.getAttribute('data-id')], ev = c.evidence[+el.getAttribute('data-i')]; Q.audit('read', 'CAPA', c.id, 'Opened evidence ' + ev.name); Q.save(); Q.toast('Prototype: the PDF copy of ' + ev.name + ' would open in the viewer.'); };
  function capaEff(c) {
    var e = c.effectiveness;
    if (e.result) return h`<div class="card card-pad"><dl class="dl"><div style="grid-column:1/-1"><dt>Success criteria</dt><dd>${e.criteria}</dd></div><div style="grid-column:1/-1"><dt>Result</dt><dd>${e.result}</dd></div><div><dt>Verdict</dt><dd>${Q.chip(e.verdict, e.verdict === 'Effective' ? 'chip-done' : 'chip-overdue')}</dd></div><div><dt>Verified by</dt><dd>${Q.fullName(e.by)} · ${Q.fmtDate(e.at)}</dd></div></dl></div>`;
    var can = c.state === 'Effectiveness check' && !Q.readOnly() && (c.owner === Q.S.session.userId || Q.hasRole('qm') || e.assignee === Q.S.session.userId);
    if (!can) return h`<div class="card card-pad"><div class="label mb-8">Plan</div><p>${e.criteria || 'Set the success criteria during Planning.'}</p><p class="small muted" style="margin:0">${c.effectivenessPlan}${e.due ? ' · due ' + Q.fmtDate(e.due) : ''}</p></div>`;
    return h`<form class="card card-pad" data-submit="capa-eff" data-id="${c.id}"><div class="label mb-8">Success criteria</div><p>${e.criteria}</p>
      <div class="field mb-16"><label for="cer">Result</label><textarea class="textarea" id="cer" name="result" placeholder="What the evidence shows"></textarea></div>
      <fieldset class="mb-16"><legend>Verdict</legend><label class="check"><input type="radio" name="verdict" value="Effective" checked> Effective: close the CAPA</label><label class="check"><input type="radio" name="verdict" value="Not effective"> Not effective: record it and raise a new event</label></fieldset>
      <button class="btn btn-primary" type="submit">Verify and sign</button></form>`;
  }
  Q.on['capa-eff'] = function (form) {
    var c = Q.S.capas[form.getAttribute('data-id')], f = Q.formData(form);
    if (!f.result) return Q.fieldError(form, 'result', 'Describe the result.');
    Q.sign({ items: [{ id: c.id, hash: Q.sha256(Q.canon({ id: c.id, result: f.result })) }], meaning: 'Verified', meanings: ['Verified'], title: 'Verify effectiveness of ' + c.id,
      onSigned: function (s) { Q.wf.capa.close(c, f.result, f.verdict, s[0]); Q.toast(c.id + ' closed'); } });
  };

  function CA(el) { return Q.S.capas[el.getAttribute('data-id')]; }
  Q.act['capa-addaction'] = function (el) {
    var c = CA(el); var users = Q.activeUsers().filter(function (u) { return u.roles.indexOf('auditor') < 0; });
    Q.drawer.open({ kicker: c.id + ' · Planning', title: 'Add action', submitLabel: 'Add action',
      body: h`<div class="form-grid"><fieldset class="full"><legend>Type</legend><div class="seg"><label class="check" style="padding:0 10px;min-height:36px"><input type="radio" name="type" value="Corrective" checked> Corrective</label><label class="check" style="padding:0 10px;min-height:36px"><input type="radio" name="type" value="Preventive"> Preventive</label></div></fieldset>
        <div class="field full"><label for="cat">Title</label><input class="input" id="cat" name="title"></div>
        <div class="field"><label for="caa">Assignee</label><select class="select" id="caa" name="assignee">${users.map(function (u) { return h`<option value="${u.id}">${u.name}</option>`; })}</select></div>
        <div class="field"><label for="cad">Due</label><input class="input" type="date" id="cad" name="due" value="${Q.dayIso(14).slice(0, 10)}"></div>
        <div class="field"><label for="cadoc">Linked document</label><select class="select" id="cadoc" name="doc"><option value="">None</option>${Object.keys(Q.S.docs).map(function (d) { return h`<option value="${d}">${d} ${Q.S.docs[d].title}</option>`; })}</select></div>
        <label class="check" style="align-self:end"><input type="checkbox" name="sig" checked> Requires signature</label></div>`,
      submit: function (f, form) { if (!f.title) return Q.fieldError(form, 'title', 'Give the action a title.'); Q.wf.capa.addAction(c, { type: f.type, title: f.title, assignee: f.assignee, due: new Date(f.due + 'T17:00:00').toISOString(), doc: f.doc || null, sig: f.sig }); if (f.doc) Q.link(c.id, f.doc); Q.drawer.close(); Q.toast('Action added'); Q.refresh(); } });
  };
  Q.act['capa-rmaction'] = function (el) { var c = CA(el); Q.wf.capa.removeAction(c, el.getAttribute('data-a')); Q.refresh(); };
  Q.act['capa-plan'] = function (el) {
    var c = CA(el);
    if (!c.actions.length) { Q.toast('Add at least one action first.', 'warn'); return; }
    if (c.severity === 'High' && !Q.hasRole('qm')) {
      c.planPending = true;
      var qm = Q.S.users.find(function (u) { return u.roles.indexOf('qm') >= 0 && u.status === 'Active'; });
      Q.wf.assign({ kind: 'capa-approve', record: c.id, assignee: qm.id, due: Q.dayIso(3) });
      Q.audit('state', 'CAPA', c.id, 'Plan sent to the Quality Manager (high severity route)'); Q.closeTasks(function (t) { return t.record === c.id && t.kind === 'capa-plan'; });
      Q.toast('Sent to ' + qm.name + ' for approval'); Q.refresh(); return;
    }
    Q.sign({ items: [{ id: c.id, hash: Q.sha256(Q.canon(c.actions)), stage: 'Actions approved' }], meaning: 'Approved', meanings: ['Approved'], title: 'Approve the actions for ' + c.id,
      extra: function () { return h`<div class="callout plain mb-16"><b style="color:var(--ink)">Actions lock after this.</b><p class="small" style="margin:4px 0 0">${c.actions.length} action${c.actions.length > 1 ? 's' : ''} will be assigned and their owners notified.</p></div>`; },
      onSigned: function (s) { c.planPending = false; Q.closeTasks(function (t) { return t.record === c.id && t.kind === 'capa-approve'; }); Q.wf.capa.approvePlan(c, s[0]); Q.toast('Actions locked. Execution started.'); } });
  };
  Q.act['capa-done'] = function (el) {
    var c = CA(el), a = c.actions.find(function (x) { return x.id === el.getAttribute('data-a'); });
    if (!a.sig) { Q.wf.capa.completeAction(c, a, null); Q.toast('Action done'); Q.refresh(); return; }
    Q.sign({ items: [{ id: c.id, hash: Q.sha256(Q.canon(a)), stage: 'Action ' + a.id }], meaning: 'Completed', meanings: ['Completed'], title: 'Sign completion: ' + a.title,
      onSigned: function (s) { Q.wf.capa.completeAction(c, a, s[0]); Q.toast('Action signed'); } });
  };
  Q.act['capa-submit'] = function (el) {
    var c = CA(el);
    if (c.actions.some(function (a) { return a.status !== 'Done'; })) { Q.toast('Every action must be done before you submit for approval.', 'warn'); Q.setQuery({ tab: 'actions' }); return; }
    if (c.rootWhy == null) { Q.toast('Record the root cause first.', 'warn'); Q.setQuery({ tab: 'rootcause' }); return; }
    Q.wf.capa.submitForApproval(c); Q.toast('Sent for approval'); Q.refresh();
  };
  Q.act['capa-approve'] = function (el) {
    var c = CA(el);
    if (c.actions.some(function (a) { return a.assignee === Q.S.session.userId; }) && c.severity === 'High') { Q.toast('You completed one of these actions, so you can’t approve them (segregation of duties).', 'warn'); return; }
    Q.sign({ items: [{ id: c.id, hash: Q.sha256(Q.canon(c.actions)), stage: 'Completed actions approved' }], meaning: 'Approved', meanings: ['Approved'], title: 'Approve completed actions on ' + c.id,
      onSigned: function (s) { Q.wf.capa.approveActions(c, s[0]); Q.toast('Approved. Effectiveness check scheduled.'); } });
  };

  // ---------- Create ----------
  Q.act['new-obs'] = function () {
    if (window.innerWidth <= 760) { Q.go('#/raise'); return; }
    Q.drawer.open({ kicker: 'Anyone can raise one', title: 'Raise an observation', submitLabel: 'Submit',
      body: h`<div class="field mb-16"><label for="ot">What did you notice?</label><input class="input" id="ot" name="title" placeholder="One line, e.g. Server room door propped open"></div>
        <div class="field mb-16"><label for="od">Details</label><textarea class="textarea" id="od" name="details" placeholder="Where, when, what you saw"></textarea></div>
        <div class="field mb-16"><label for="oa">Process area</label><select class="select" id="oa" name="area">${Q.OBS_AREAS.map(function (a) { return h`<option>${a}</option>`; })}</select></div>
        <div class="field"><label for="of">Add photo or file</label><input class="input" type="file" id="of" name="files" multiple accept="image/*,.pdf,.docx,.xlsx"></div>
        <p class="small muted mt-16">The process owner reviews it and either escalates it to a quality event or closes it with a reason. You’ll be told either way.</p>`,
      submit: function (f, form) {
        if (!f.title) return Q.fieldError(form, 'title', 'Say what you noticed.');
        var o = Q.wf.obs.raise({ title: f.title, details: f.details || f.title, area: f.area, attachments: (f.files || []).map(function (x) { return { name: x.name, size: Q.fmtBytes(x.size), scan: 'clean' }; }) });
        Q.drawer.close(); Q.toast(o.id + ' raised. ' + Q.fullName(o.owner) + ' has been notified.'); Q.go('#/quality/' + o.id);
      } });
  };
  Q.act['new-qe'] = function () {
    var users = Q.activeUsers().filter(function (u) { return u.roles.indexOf('process') >= 0 || u.roles.indexOf('qm') >= 0; });
    Q.drawer.open({ kicker: 'Quality events', title: 'New quality event', submitLabel: 'Create event',
      body: h`<div class="form-grid"><div class="field full"><label for="qt">Title</label><input class="input" id="qt" name="title"></div>
        <div class="field"><label for="qty">Type</label><select class="select" id="qty" name="type">${Q.QE_TYPES.map(function (t) { return h`<option>${t}</option>`; })}</select></div>
        <div class="field"><label for="qsv">Severity</label><select class="select" id="qsv" name="severity"><option>Low</option><option>High</option></select></div>
        <div class="field full"><label for="qd">Description</label><textarea class="textarea" id="qd" name="desc"></textarea></div>
        <div class="field"><label for="qo">Owner</label><select class="select" id="qo" name="owner">${users.map(function (u) { return h`<option value="${u.id}">${u.name}</option>`; })}</select></div>
        <div class="field"><label for="qp">Quality process</label><select class="select" id="qp" name="process">${Q.PROCESSES.map(function (p) { return h`<option>${p}</option>`; })}</select></div>
        <div class="field"><label for="qc">Classification</label><select class="select" id="qc" name="classification">${Q.CLASSES.map(function (c) { return h`<option ${c === 'Internal' ? 'selected' : ''}>${c}</option>`; })}</select></div>
        <div class="field"><label for="qtg">Tags</label><input class="input" id="qtg" name="tags" placeholder="e.g. A.8.8"></div></div>`,
      submit: function (f, form) {
        if (!f.title) return Q.fieldError(form, 'title', 'Give the event a title.');
        if (!f.desc) return Q.fieldError(form, 'desc', 'Describe what happened.');
        var e = Q.wf.qe.create({ type: f.type, title: f.title, desc: f.desc, severity: f.severity, owner: f.owner, process: f.process, classification: f.classification, tags: f.tags ? f.tags.split(',').map(function (s) { return s.trim(); }) : [] });
        Q.drawer.close(); Q.toast(e.id + ' created' + (f.severity === 'High' ? ' · Quality Manager notified' : '')); Q.go('#/quality/' + e.id);
      } });
  };
})(window.Q);
