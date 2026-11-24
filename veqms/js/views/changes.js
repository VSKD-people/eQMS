/* Change Control: list + board, record page with tabs, plan approval, actions, effectiveness check. */
(function (Q) {
  'use strict';
  var h = Q.h;
  var CR_STATES = ['Planning', 'Review', 'Approval', 'In execution', 'Effectiveness check', 'Closed'];
  Q.CR_STATES = CR_STATES;

  Q.boardView = function (states, items, card) {
    return h`<div class="board" role="list">${states.map(function (s) {
      var col = items.filter(function (x) { return x.state === s; });
      return h`<section class="board-col" role="listitem" aria-label="${s}"><h3><span>${s}</span><span class="muted">${col.length}</span></h3>${col.map(card)}</section>`;
    })}</div>`;
  };

  Q.views.changes = function (p, q) {
    var board = q.view === 'board';
    var all = Object.keys(Q.S.crs).map(function (k) { return Q.S.crs[k]; }).filter(function (c) { return Q.canSee(c); });
    var s = (q.q || '').toLowerCase();
    var rows = all.filter(function (c) {
      if (s && (c.id + ' ' + c.title).toLowerCase().indexOf(s) < 0) return false;
      if (q.state && c.state !== q.state) return false;
      if (q.size && c.size !== q.size) return false;
      return true;
    });
    return h`<div class="page-head"><div><h1>Change requests</h1><div class="sub">${Q.plural(rows.length, 'change request')}</div></div>
      <div class="btn-row"><div class="seg" role="group" aria-label="View"><button class="${!board ? 'active' : ''}" data-act="tab" data-key="view" data-tab="" aria-pressed="${!board}">${Q.icon('list', 'ico-sm')}<span class="sr-only">List view</span></button><button class="${board ? 'active' : ''}" data-act="tab" data-key="view" data-tab="board" aria-pressed="${board}">${Q.icon('board', 'ico-sm')}<span class="sr-only">Board view</span></button></div>
      ${Q.can('cr.create') ? h`<button class="btn btn-primary" data-act="new-cr">${Q.icon('plus', 'ico-sm')} New change request</button>` : ''}</div></div>
      ${Q.tip('changes', h`<b>Change control.</b> Planning → Review → Approval (Adobe Sign) → In execution → Effectiveness check → Closed (Adobe Sign). Actions that need a signature are signed off in Adobe Sign too. Switch to the board to see every CR by state.`)}
      <div class="toolbar"><input class="input search" type="search" placeholder="Search ID or title" value="${q.q || ''}" data-input="cr-search" aria-label="Search change requests">
        <select class="select" data-change="qfilter" data-key="state" aria-label="State"><option value="">All states</option>${CR_STATES.map(function (t) { return h`<option ${q.state === t ? 'selected' : ''}>${t}</option>`; })}</select>
        <select class="select" data-change="qfilter" data-key="size" aria-label="Major or minor"><option value="">Major and minor</option><option ${q.size === 'Major' ? 'selected' : ''}>Major</option><option ${q.size === 'Minor' ? 'selected' : ''}>Minor</option></select></div>
      ${board ? Q.boardView(CR_STATES, rows, function (c) {
        var open = c.actions.filter(function (a) { return a.status !== 'Done'; }).length;
        return h`<a class="board-card" href="#/changes/${c.id}"><div class="bc-id">${c.id} · ${c.size}</div><div class="bc-title">${c.title}</div><div class="row-wrap small">${Q.avatar(c.owner, 'xs')}${c.state === 'In execution' ? h`<span class="muted">${open} action${open === 1 ? '' : 's'} open</span>` : ''}${c.classification !== 'Internal' ? Q.cls(c.classification) : ''}</div></a>`;
      }) : Q.table({ id: 'crs', rows: rows.map(function (c) { return Object.assign({ ownerName: Q.fullName(c.owner), open: c.actions.filter(function (a) { return a.status !== 'Done'; }).length }, c); }), defaultSort: 'id', defaultDir: -1, href: function (c) { return '#/changes/' + c.id; },
        cols: [{ key: 'id', label: 'ID', cls: 'id' }, { key: 'title', label: 'Title', render: function (c) { return h`<a href="#/changes/${c.id}">${c.title}</a>`; } }, { key: 'size', label: 'Major / minor' }, { key: 'state', label: 'State', render: function (c) { return Q.stateChip(c.state); } }, { key: 'process', label: 'Process' }, { key: 'ownerName', label: 'Process owner' }, { key: 'open', label: 'Open actions' }, { key: 'created', label: 'Created', render: function (c) { return Q.fmtDate(c.created); } }] })}`;
  };
  Q.on['cr-search'] = Q.debounce(function (el) { Q.setQuery({ q: el.value }); var i = document.querySelector('[data-input="cr-search"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);

  Q.views.change = function (p, q) {
    var c = Q.S.crs[p.id];
    if (!c) return Q.views.notFound();
    if (!Q.canSee(c)) return h`<div class="card card-pad"><h1>${c.id} is ${c.classification}</h1><p class="muted">You need clearance or named access to open it.</p></div>`;
    Q.ui.recent = [c.id].concat((Q.ui.recent || []).filter(function (x) { return x !== c.id; })).slice(0, 6);
    var me = Q.S.session.userId, ro = Q.readOnly();
    var tab = q.tab || 'overview';
    var rev = c.reviewers.find(function (r) { return r.u === me; });
    var appr = c.approvers.find(function (a) { return a.u === me; });
    var planOut = Q.esign.active(c.id, 'cr-plan'), closeOut = Q.esign.active(c.id, 'cr-completion');
    var acts = [];
    acts.push(h`<button class="btn" data-act="cr-pdf" data-id="${c.id}">Generate plan PDF</button>`);
    if (!ro) {
      if (c.state === 'Planning' && c.owner === me) acts.push(h`<button class="btn btn-primary" data-act="cr-submit" data-id="${c.id}">Submit for review</button>`);
      if (c.state === 'Review' && rev && rev.status === 'Pending') acts.push(h`<button class="btn" data-act="cr-sendback" data-id="${c.id}">Send back</button><button class="btn btn-primary" data-act="cr-review" data-id="${c.id}">Complete review</button>`);
      if (c.state === 'Approval' && !planOut && !Q.esign.cantSend(c.id, 'cr-plan')) acts.push(h`<button class="btn btn-primary" data-act="es-send" data-id="${c.id}" data-stage="cr-plan">${Q.icon('sign', 'ico-sm')} Verify and send plan to Adobe Sign</button>`);
      if (c.state === 'Effectiveness check' && !closeOut && (c.owner === me || Q.hasRole('qm') || appr)) acts.push(c.pendingClosure ? h`<button class="btn btn-primary" data-act="es-send" data-id="${c.id}" data-stage="cr-completion">${Q.icon('sign', 'ico-sm')} Send completion to Adobe Sign</button>` : h`<button class="btn btn-primary" data-act="tab" data-tab="effectiveness">Record effectiveness</button>`);
      acts.push(Q.esign.signButton(c.id));
    }
    var labels = { 'Approval': planOut ? 'Approval · Adobe Sign ' + Q.esign.signedCount(planOut) + ' of ' + planOut.signers.length + ' signed' : c.signatures.some(function (s) { return s.stage === 'Plan approved'; }) ? 'Approval · signed' : 'Approval', 'Closed': c.state === 'Closed' ? 'Closed · signed' : 'Closed', 'In execution': c.state === 'In execution' ? 'In execution · ' + c.actions.filter(function (a) { return a.status === 'Done'; }).length + ' of ' + c.actions.length + ' done' : 'In execution' };
    var tabs = [['overview', 'Overview'], ['items', 'Items to change · ' + c.items.length], ['actions', 'Actions · ' + c.actions.length], ['attachments', 'Attachments · ' + c.attachments.length], ['related', 'Related items'], ['effectiveness', 'Effectiveness check']];
    var content = { overview: overview, items: items, actions: actions, attachments: attachments, related: related, effectiveness: effectiveness }[tab] || overview;
    return h`<nav class="breadcrumb" aria-label="Breadcrumb"><a href="#/changes">Change requests</a><span>/</span><span>${c.id}</span><span>·</span><a href="#/changes?view=board">Switch to board view</a></nav>
      <div class="page-head"><div><div class="record-meta"><span>Change request · ${c.id}</span><span class="chip ${c.size === 'Major' ? 'chip-turn' : 'chip-outline'}">${c.size} change</span>${Q.cls(c.classification)}</div><h1>${c.title}</h1></div><div class="btn-row">${acts}</div></div>
      ${planOut ? h`<div class="callout mb-16"><strong>The plan is out for Adobe Sign signature.</strong> ${Q.esign.signedCount(planOut)} of ${planOut.signers.length} signed. Execution starts when the agreement completes.</div>` : ''}
      ${closeOut ? h`<div class="callout mb-16"><strong>Completion is out for Adobe Sign signature.</strong> ${Q.esign.signedCount(closeOut)} of ${closeOut.signers.length} signed. ${c.id} closes when the agreement completes.</div>` : ''}
      ${c.planReturned && c.state === 'Planning' ? h`<div class="callout warn mb-16"><strong>Plan ${c.planReturned.how} in Adobe Sign.</strong> ${Q.fullName(c.planReturned.by)}: ${c.planReturned.reason}</div>` : ''}
      ${c.closureReturned && c.state === 'Effectiveness check' && !closeOut ? h`<div class="callout warn mb-16"><strong>Completion ${c.closureReturned.how} in Adobe Sign.</strong> ${Q.fullName(c.closureReturned.by)}: ${c.closureReturned.reason}</div>` : ''}
      <div class="card mb-16">${Q.stepper(CR_STATES, c.state, labels, { allDone: c.state === 'Closed' })}</div>
      <div class="split"><div style="min-width:0">
        <div class="tabs" role="tablist">${tabs.map(function (t) { return h`<button class="tab ${tab === t[0] ? 'active' : ''}" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>
        ${content(c)}
      </div>
      <aside class="context" aria-label="Record details">
        <div class="card ctx-card"><span class="label">Details</span><dl class="dl"><div><dt>Process owner</dt><dd>${Q.name(c.owner)}</dd></div><div><dt>Quality process</dt><dd>${c.process}</dd></div>
          <div><dt>Review due</dt><dd>${Q.fmtDay(c.reviewDue)}</dd></div><div><dt>Route</dt><dd>${c.route === 'parallel' ? 'Parallel review' : 'Sequential review'}</dd></div></dl></div>
        <div class="card ctx-card"><span class="label">People</span>
          ${c.reviewers.map(function (r) { return Q.peopleRow(r.u, 'Reviewer', r.status === 'Pending' && r.u === me ? 'Your turn' : r.status === 'Pending' ? 'Reviewing' : r.status, r.status === 'Reviewed' ? 'st-done' : r.status === 'Pending' ? 'st-turn' : 'st-wait'); })}
          ${c.approvers.map(function (a) { return Q.peopleRow(a.u, 'Approver', a.status === 'Your turn' && a.u !== me ? 'Signing in Adobe Sign' : a.status === 'Waiting' && c.state !== 'Planning' ? 'Waiting · FYI sent' : a.status, a.status === 'Signed' ? 'st-done' : a.status === 'Your turn' ? 'st-turn' : 'st-wait'); })}</div>
        <div class="card ctx-card"><span class="label">Signatures needed (Adobe Sign)</span>
          <div class="people-row"><span>Approve the plan</span><span class="status-text ${c.signatures.some(function (s) { return s.stage === 'Plan approved'; }) ? 'st-done' : planOut ? 'st-turn' : 'st-wait'}">${c.signatures.some(function (s) { return s.stage === 'Plan approved'; }) ? 'Signed' : planOut ? 'Out for signature' : 'After review'}</span></div>
          <div class="people-row"><span>Actions that need a signature</span><span class="status-text ${c.actions.filter(function (a) { return a.sig; }).every(function (a) { return a.status === 'Done'; }) ? 'st-done' : 'st-wait'}">${c.actions.filter(function (a) { return a.sig && a.status === 'Done'; }).length} of ${c.actions.filter(function (a) { return a.sig; }).length} signed</span></div>
          <div class="people-row"><span>Approve completion</span><span class="status-text ${c.state === 'Closed' ? 'st-done' : closeOut ? 'st-turn' : 'st-wait'}">${c.state === 'Closed' ? 'Signed' : closeOut ? 'Out for signature' : 'After effectiveness check'}</span></div></div>
        ${Q.esign.recordCard(c.id)}
        ${Q.linkedCard(c.id)}
        ${Q.activityCard(c.id)}
      </aside></div>`;
  };

  function overview(c) {
    return h`<div class="card card-pad stack">
      <div><div class="label mb-8">Description</div><p style="margin:0">${c.description}</p></div>
      <div><div class="label mb-8">Reason</div><p style="margin:0">${c.reason}</p></div>
      <div><div class="label mb-8">Expected impact</div><p style="margin:0">${c.impact}</p></div>
      <div><div class="label mb-8">Impacted processes</div><p style="margin:0">${c.impacted.join('; ')}</p></div>
      <div class="callout plain"><b style="color:var(--ink)">Major or minor</b><p class="small" style="margin:4px 0 0">Major: changes a controlled process or needs new training. Minor: wording or layout only.</p></div></div>
      ${c.reviewers.some(function (r) { return r.comment; }) ? h`<div class="card card-pad mt-16"><div class="label mb-8">Review comments</div>${c.reviewers.filter(function (r) { return r.comment; }).map(function (r) { return h`<p><b>${Q.fullName(r.u)}:</b> ${r.comment}</p>`; })}</div>` : ''}`;
  }
  function items(c) {
    return h`${c.items.length ? h`<div class="list-rows">${c.items.map(function (id) { var d = Q.S.docs[id]; return h`<div class="list-row">${Q.icon('doc')}<div class="lr-main">${Q.recLink(id)}<div class="small muted">${d ? d.docType + ' · v' + Q.curVer(d).v + ' · ' + d.state : ''}</div></div>${d ? Q.stateChip(d.state) : ''}</div>`; })}</div>` : Q.empty('No documents listed', 'Add the controlled documents this change will update.')}
      ${!Q.readOnly() && c.state === 'Planning' ? h`<button class="btn mt-16" data-act="cr-additem" data-id="${c.id}">${Q.icon('plus', 'ico-sm')} Add a document</button>` : ''}`;
  }
  function actions(c) {
    var me = Q.S.session.userId;
    var canAdd = !Q.readOnly() && (c.state === 'Planning' || c.state === 'In execution') && (c.owner === me || Q.hasRole('qm'));
    return h`<div class="table-wrap"><table class="t"><caption class="sr-only">Actions</caption><thead><tr><th scope="col">Action</th><th scope="col">Linked document</th><th scope="col">Assignee</th><th scope="col">Due</th><th scope="col">Signature</th><th scope="col">Status</th></tr></thead><tbody>
      ${c.actions.map(function (a) {
        var out = Q.esign.active(c.id, 'cr-action', a.id);
        var mine = a.assignee === me && c.state === 'In execution' && a.status !== 'Done' && !Q.readOnly() && !out;
        return h`<tr><td><b>${a.title}</b>${a.desc ? h`<div class="small muted">${a.desc}</div>` : ''}${a.external ? h`<div class="small muted">Sent to external signers through Adobe Sign</div>` : ''}${a.returned && a.status !== 'Done' && !out ? h`<div class="small" style="color:var(--overdue)">${a.returned.how} in Adobe Sign: ${a.returned.reason}</div>` : ''}</td><td>${a.doc ? Q.recLink(a.doc, { short: true }) : '—'}</td><td>${Q.name(a.assignee)}</td><td class="nowrap">${a.status === 'Done' ? Q.fmtShort(a.doneAt) : Q.fmtShort(a.due)}</td><td>${a.sig ? 'Adobe Sign' : 'Not required'}</td>
          <td>${out && Q.esign.myTurn(out) ? h`<button class="btn btn-sm btn-primary" data-act="es-open-sign" data-id="${out.id}">Sign in Adobe Sign</button>` : out ? Q.chip('Out for signature', 'chip-turn') : mine ? h`<button class="btn btn-sm btn-primary" data-act="cr-done" data-id="${c.id}" data-a="${a.id}">${a.sig ? 'Complete and send to Adobe Sign' : 'Mark done'}</button>` : a.status === 'Done' ? Q.chip(a.signedBy ? 'Done · signed' : 'Done', 'chip-done') : a.status === 'In progress' ? Q.chip('In progress') : Q.dueChip(a.due)}</td></tr>`;
      })}
      ${!c.actions.length ? h`<tr><td colspan="6"><div class="empty" style="padding:20px">No actions yet.</div></td></tr>` : ''}</tbody></table></div>
      ${canAdd ? h`<button class="btn mt-16" data-act="cr-addaction" data-id="${c.id}">${Q.icon('plus', 'ico-sm')} Add action</button>` : ''}`;
  }
  function attachments(c) {
    return h`${c.attachments.length ? h`<div class="list-rows">${c.attachments.map(function (a) { return h`<div class="list-row">${Q.icon('clip')}<div class="lr-main"><b>${a.name}</b>${a.pdf ? ' → PDF' : ''}<div class="small muted">${a.size} · ${Q.fullName(a.by)} · ${Q.fmtDate(a.at)}</div></div><span class="health ${a.scan === 'clean' ? 'h-ok' : 'h-warn'}">${a.scan === 'clean' ? 'Scanned clean' : 'Scanning…'}</span></div>`; })}</div>` : Q.empty('No attachments', '')}
      ${!Q.readOnly() && c.state !== 'Closed' ? h`<label class="drop mt-16">${Q.icon('upload')}<span>Add files (scanned for malware before anyone can open them)</span><input type="file" class="sr-only" data-change="cr-upload" data-id="${c.id}" multiple></label>` : ''}
      <p class="small muted mt-8">You can also attach a SharePoint link as a reference; access stays governed by SharePoint permissions.</p>`;
  }
  function related(c) {
    var links = Q.linksOf(c.id);
    return h`${links.length ? h`<div class="list-rows">${links.map(function (id) { var r = Q.rec(id); return h`<div class="list-row"><div class="lr-main">${Q.recLink(id)}<div class="small muted">${Q.KIND_LABEL[Q.kindOf(id)]}</div></div>${r && r.state ? Q.stateChip(r.state) : ''}</div>`; })}</div>` : Q.empty('Nothing linked', 'Link documents, events, CAPAs or other changes.')}
      ${Q.readOnly() ? '' : h`<button class="btn mt-16" data-act="add-link" data-id="${c.id}">${Q.icon('link', 'ico-sm')} Link a record</button>`}`;
  }
  function effectiveness(c) {
    var e = c.effectiveness;
    var me = Q.S.session.userId, pend = c.pendingClosure, out = Q.esign.active(c.id, 'cr-completion');
    var canRecord = c.state === 'Effectiveness check' && !Q.readOnly() && !out && (c.owner === me || Q.hasRole('qm') || c.approvers.some(function (a) { return a.u === me; }));
    if (e.result) return h`<div class="card card-pad"><dl class="dl"><div style="grid-column:1/-1"><dt>Success criteria</dt><dd>${e.criteria}</dd></div><div style="grid-column:1/-1"><dt>Result</dt><dd>${e.result}</dd></div><div><dt>Verdict</dt><dd>${Q.chip(e.verdict, e.verdict === 'Effective' ? 'chip-done' : 'chip-overdue')}</dd></div><div><dt>Checked by</dt><dd>${Q.fullName(e.by)} · ${Q.fmtDate(e.at)}</dd></div>${c.closeAgreement ? h`<div style="grid-column:1/-1"><dt>Completion approved</dt><dd><button class="btn-link mono" style="padding:0;min-height:0" data-act="es-agreement" data-id="${c.closeAgreement}">Adobe Sign ${c.closeAgreement}</button></dd></div>` : ''}</dl></div>`;
    if (out) return h`<div class="card card-pad"><div class="label mb-8">Completion out for Adobe Sign signature</div><dl class="dl"><div style="grid-column:1/-1"><dt>Result</dt><dd>${pend.result}</dd></div><div><dt>Verdict</dt><dd>${pend.verdict}</dd></div><div><dt>Recorded by</dt><dd>${Q.fullName(pend.by)} · ${Q.fmtDate(pend.at)}</dd></div></dl></div>`;
    if (!canRecord) return h`<div class="card card-pad"><div class="label mb-8">Success criteria</div><p>${e.criteria || 'Set during planning.'}</p><p class="small muted" style="margin:0">${c.state === 'Effectiveness check' ? 'Due ' + Q.fmtDate(c.effectivenessDue) + '. The process owner records the result, then the owner and the approvers sign completion in Adobe Sign.' : 'Starts when every action is done.'}</p></div>`;
    return h`<form class="card card-pad" data-submit="cr-eff" data-id="${c.id}"><div class="label mb-8">Success criteria</div><p>${e.criteria}</p>
      <div class="field mb-16"><label for="er">What did you find?</label><textarea class="textarea" id="er" name="result" placeholder="Evidence that the change worked (or didn’t)">${pend ? pend.result : ''}</textarea></div>
      <fieldset class="mb-16"><legend>Verdict</legend><label class="check"><input type="radio" name="verdict" value="Effective" ${!pend || pend.verdict === 'Effective' ? 'checked' : ''}> Effective</label><label class="check"><input type="radio" name="verdict" value="Not effective" ${pend && pend.verdict === 'Not effective' ? 'checked' : ''}> Not effective: raise follow-up actions</label></fieldset>
      <div class="callout mb-16"><strong>Completion is approved in Adobe Sign</strong><p class="small" style="margin:4px 0 0">One agreement: ${Q.fullName(c.owner)} signs as process owner, then ${c.approvers.map(function (a) { return Q.fullName(a.u); }).join(', ')}. It uses 1 of ${Q.esign.remaining()} transactions left this year.</p></div>
      <button class="btn btn-primary" type="submit">Save result and send to Adobe Sign</button></form>`;
  }

  // ---------- Actions ----------
  function C(el) { return Q.S.crs[el.getAttribute('data-id')]; }
  Q.act['cr-submit'] = function (el) {
    var c = C(el);
    if (!c.actions.length) { Q.toast('Add at least one action before you submit.', 'warn'); Q.setQuery({ tab: 'actions' }); return; }
    if (!c.reviewers.length && !c.approvers.length) { Q.toast('Add reviewers or an approver first.', 'warn'); return; }
    Q.wf.cr.submit(c); Q.toast('Submitted. Reviewers notified.'); Q.refresh();
  };
  Q.act['cr-review'] = function (el) {
    var c = C(el);
    Q.drawer.open({ kicker: c.id, title: 'Complete your review', submitLabel: 'Complete review',
      body: h`<div class="field"><label for="crc">Comment (optional)</label><textarea class="textarea" id="crc" name="comment"></textarea></div><p class="small muted mt-16">When every reviewer is done, the plan goes to the approver automatically.</p>`,
      submit: function (f) { Q.wf.cr.review(c, f.comment); Q.drawer.close(); Q.toast(c.state === 'Approval' ? 'Review complete. Approver notified.' : 'Review recorded'); Q.refresh(); } });
  };
  Q.act['cr-sendback'] = function (el) {
    var c = C(el);
    Q.drawer.open({ kicker: c.id, title: 'Send back to planning', submitLabel: 'Send back',
      body: h`<div class="field"><label for="crs">Reason (required)</label><textarea class="textarea" id="crs" name="reason"></textarea><div class="help">The owner and earlier reviewers are told, with this reason.</div></div>`,
      submit: function (f, form) { if (!f.reason) return Q.fieldError(form, 'reason', 'Give a reason.'); Q.wf.cr.sendBack(c, f.reason); Q.drawer.close(); Q.toast('Sent back to planning'); Q.refresh(); } });
  };
  // An action that needs a signature is signed off in Adobe Sign by the person who did it.
  Q.act['cr-done'] = function (el) {
    var c = C(el), a = c.actions.find(function (x) { return x.id === el.getAttribute('data-a'); });
    if (!a.sig) { Q.wf.cr.completeAction(c, a, null); Q.toast('Action done'); Q.refresh(); return; }
    Q.esign.openSend(c.id, 'cr-action', a.id);
  };
  Q.on['cr-eff'] = function (form) {
    var f = Q.formData(form), c = Q.S.crs[form.getAttribute('data-id')];
    if (!f.result) return Q.fieldError(form, 'result', 'Describe what you found.');
    var block = Q.esign.cantSend(c.id, 'cr-completion'); if (block) { Q.toast(block, 'warn'); return; }
    var b = c.pendingClosure ? { result: c.pendingClosure.result, verdict: c.pendingClosure.verdict } : null;
    c.pendingClosure = { result: f.result, verdict: f.verdict, by: Q.S.session.userId, at: new Date().toISOString() };
    Q.audit('update', 'Change request', c.id, 'Recorded effectiveness result for ' + c.id + ' (' + f.verdict + '); completion to be approved in Adobe Sign', b, { result: f.result, verdict: f.verdict });
    Q.save(); Q.esign.openSend(c.id, 'cr-completion');
  };
  Q.act['cr-addaction'] = function (el) {
    var c = C(el);
    var users = Q.activeUsers().filter(function (u) { return u.roles.indexOf('auditor') < 0; });
    Q.drawer.open({ kicker: c.id, title: 'Add action', submitLabel: 'Add action',
      body: h`<div class="form-grid"><div class="field full"><label for="at">Title</label><input class="input" id="at" name="title"></div><div class="field full"><label for="ad">Description</label><textarea class="textarea" id="ad" name="desc" style="min-height:64px"></textarea></div>
        <div class="field"><label for="adoc">Linked document</label><select class="select" id="adoc" name="doc"><option value="">None</option>${Object.keys(Q.S.docs).map(function (d) { return h`<option value="${d}">${d} ${Q.S.docs[d].title}</option>`; })}</select></div>
        <div class="field"><label for="aa">Assignee</label><select class="select" id="aa" name="assignee">${users.map(function (u) { return h`<option value="${u.id}">${u.name}</option>`; })}</select></div>
        <div class="field"><label for="adue">Due</label><input class="input" type="date" id="adue" name="due" value="${Q.dayIso(14).slice(0, 10)}"></div>
        <label class="check" style="align-self:end"><input type="checkbox" name="sig" checked> Signed off in Adobe Sign</label></div>`,
      submit: function (f, form) { if (!f.title) return Q.fieldError(form, 'title', 'Give the action a title.'); Q.wf.cr.addAction(c, { title: f.title, desc: f.desc, doc: f.doc || null, assignee: f.assignee, due: new Date(f.due + 'T17:00:00').toISOString(), sig: f.sig }); if (f.doc) Q.link(c.id, f.doc); Q.drawer.close(); Q.toast('Action added'); Q.refresh(); } });
  };
  Q.act['cr-additem'] = function (el) {
    var c = C(el);
    Q.drawer.open({ kicker: c.id, title: 'Add a document to change', submitLabel: 'Add',
      body: h`<div class="field"><label for="ai">Document</label><select class="select" id="ai" name="doc">${Object.keys(Q.S.docs).filter(function (d) { return c.items.indexOf(d) < 0; }).map(function (d) { return h`<option value="${d}">${d} ${Q.S.docs[d].title}</option>`; })}</select></div>`,
      submit: function (f) { c.items.push(f.doc); Q.link(c.id, f.doc); Q.drawer.close(); Q.refresh(); } });
  };
  Q.on['cr-upload'] = function (el) {
    var c = Q.S.crs[el.getAttribute('data-id')];
    Array.prototype.forEach.call(el.files, function (f) {
      var a = { name: f.name, size: Q.fmtBytes(f.size), scan: 'scanning', by: Q.S.session.userId, at: new Date().toISOString(), pdf: !/\.pdf$/i.test(f.name) };
      c.attachments.push(a);
      Q.audit('upload', 'Change request', c.id, 'Uploaded ' + f.name + ' (malware scan started)');
      setTimeout(function () { a.scan = 'clean'; Q.audit('scan', 'Change request', c.id, f.name + ' scanned clean; converted to PDF for the record', null, null, { actor: 'system' }); Q.refresh(); }, 2500);
    });
    Q.refresh(); Q.toast('Uploading and scanning…');
  };
  Q.act['cr-pdf'] = function (el) {
    var c = C(el);
    var row = function (k, v) { return '<tr><th style="width:200px">' + k + '</th><td>' + Q.esc(v) + '</td></tr>'; };
    var html = '<h1>Change Request Plan · ' + c.id + '</h1><h2>' + Q.esc(c.title) + '</h2><table>' + row('State', c.state) + row('Major or minor', c.size) + row('Classification', c.classification) + row('Process owner', Q.fullName(c.owner)) + row('Quality process', c.process) + row('Description', c.description) + row('Reason', c.reason) + row('Expected impact', c.impact) + row('Impacted processes', c.impacted.join('; ')) + row('Items to change', c.items.join(', ')) + '</table>' +
      '<h2>Actions</h2><table><tr><th>Action</th><th>Linked document</th><th>Assignee</th><th>Due</th><th>Signature</th><th>Status</th></tr>' + c.actions.map(function (a) { return '<tr><td>' + Q.esc(a.title) + '</td><td>' + (a.doc || '—') + '</td><td>' + Q.esc(Q.fullName(a.assignee)) + '</td><td>' + Q.fmtDate(a.due) + '</td><td>' + (a.sig ? 'Adobe Sign' : 'Not required') + '</td><td>' + a.status + '</td></tr>'; }).join('') + '</table>' +
      '<h2>Signatures (Adobe Sign)</h2>' + (c.signatures.length ? '<table><tr><th>Stage</th><th>Signer</th><th>Reason for signing</th><th>UTC</th><th>Signature</th><th>Agreement</th></tr>' + c.signatures.map(function (s) { return '<tr><td>' + s.stage + '</td><td>' + Q.esc(Q.fullName(s.user)) + '</td><td>' + s.meaning + '</td><td>' + Q.fmtUtc(s.at) + '</td><td>' + s.id + '</td><td class="mono">' + (s.agreement || '—') + '</td></tr>'; }).join('') + '</table>' : '<p>None yet.</p>') +
      '<div class="foot">Generated from the record by ' + Q.esc(Q.me().name) + ' on ' + Q.fmtUtc(new Date().toISOString()) + '. ' + c.classification.toUpperCase() + '.</div>';
    Q.printHtml(c.id + ' plan', html, c.id + ' Change Request Plan PDF');
  };

  Q.act['new-cr'] = function () {
    if (!Q.can('cr.create')) { Q.toast('Your role can’t create change requests.', 'warn'); return; }
    var users = Q.activeUsers().filter(function (u) { return u.roles.indexOf('auditor') < 0 && u.id !== Q.S.session.userId; });
    Q.drawer.open({
      kicker: 'Change control', title: 'New change request', submitLabel: 'Create in Planning', wide: true,
      body: h`<div class="form-grid">
        <div class="field full"><label for="ct">Title</label><input class="input" id="ct" name="title" placeholder="What is changing?"></div>
        <fieldset class="full"><legend>Major or minor</legend><div class="radio-cards" style="grid-template-columns:1fr 1fr">
          <label class="radio-card"><input type="radio" name="size" value="Major" checked><span><b>Major</b><br><span class="small muted">Changes a controlled process or needs new training.</span></span></label>
          <label class="radio-card"><input type="radio" name="size" value="Minor"><span><b>Minor</b><br><span class="small muted">Wording or layout only.</span></span></label></div></fieldset>
        <div class="field"><label for="cp">Quality process</label><select class="select" id="cp" name="process">${Q.PROCESSES.map(function (p) { return h`<option>${p}</option>`; })}</select></div>
        <div class="field"><label for="ccl">Classification</label><select class="select" id="ccl" name="classification">${Q.CLASSES.map(function (c) { return h`<option ${c === 'Internal' ? 'selected' : ''}>${c}</option>`; })}</select></div>
        <div class="field full"><label for="cd">Description</label><textarea class="textarea" id="cd" name="description" placeholder="What will change, in plain words"></textarea></div>
        <div class="field"><label for="cr">Reason</label><textarea class="textarea" id="cr" name="reason" placeholder="Why the change is needed"></textarea></div>
        <div class="field"><label for="ci">Expected impact</label><textarea class="textarea" id="ci" name="impact" placeholder="Who and what it affects"></textarea></div>
        <fieldset class="full"><legend>Items to change (documents)</legend><div class="grid-2" style="gap:0 16px">${Object.keys(Q.S.docs).filter(function (d) { return Q.S.docs[d].state !== 'Obsolete'; }).map(function (d) { return h`<label class="check"><input type="checkbox" data-multi name="items" value="${d}"> ${d} ${Q.S.docs[d].title}</label>`; })}</div></fieldset>
        <fieldset><legend>Reviewers</legend>${users.filter(function (u) { return u.roles.some(function (r) { return ['reviewer', 'qm', 'process', 'approver'].indexOf(r) >= 0; }); }).map(function (u) { return h`<label class="check"><input type="checkbox" data-multi name="reviewers" value="${u.id}"> ${u.name}</label>`; })}</fieldset>
        <div class="field"><label for="cap">Approver</label><select class="select" id="cap" name="approver">${users.filter(function (u) { return u.roles.indexOf('approver') >= 0 || u.roles.indexOf('qm') >= 0; }).map(function (u) { return h`<option value="${u.id}">${u.name}</option>`; })}</select><div class="help">You can’t approve your own plan.</div>
          <label for="cc" style="margin-top:12px;font-weight:600;font-size:13px">Effectiveness criteria</label><textarea class="textarea" id="cc" name="criteria" style="min-height:64px" placeholder="How we will know it worked"></textarea></div>
      </div>`,
      submit: function (f, form) {
        if (!f.title) return Q.fieldError(form, 'title', 'Give the change a title.');
        if (!f.description) return Q.fieldError(form, 'description', 'Describe the change.');
        if (!f.reason) return Q.fieldError(form, 'reason', 'Say why it’s needed.');
        var c = Q.wf.cr.create({ title: f.title, size: f.size, process: f.process, classification: f.classification, description: f.description, reason: f.reason, impact: f.impact || '—', impacted: [f.process.replace('ISMS · ', '')], items: f.items, reviewers: f.reviewers, approvers: [f.approver], criteria: f.criteria });
        Q.drawer.close(); Q.toast(c.id + ' created in Planning. Add actions, then submit.'); Q.go('#/changes/' + c.id + '?tab=actions');
      }
    });
  };
})(window.Q);
