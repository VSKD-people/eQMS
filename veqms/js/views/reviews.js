/* Periodic reviews: My reviews / Organisation reviews, and the review record ("No update needed" or "Needs update"). */
(function (Q) {
  'use strict';
  var h = Q.h;
  Q.reviewStatus = function (r) {
    if (r.state === 'Completed') return 'Completed';
    var n = Q.daysFromToday(r.due);
    if (n < 0) return 'Overdue';
    if (n <= 14) return 'Due soon';
    if (n <= (r.notice || 60)) return 'Upcoming';
    return 'Scheduled';
  };
  function all() { return Object.keys(Q.S.reviews).map(function (k) { return Q.S.reviews[k]; }).filter(function (r) { return Q.S.docs[r.doc] && Q.canSee(Q.S.docs[r.doc]); }); }

  Q.views.reviews = function (p, q) {
    var org = q.tab === 'org' && Q.can('reviews.org');
    var me = Q.S.session.userId;
    var list = all().filter(function (r) { return org || r.reviewer === me; });
    if (q.owner) list = list.filter(function (r) { return r.reviewer === q.owner; });
    var buckets = ['Overdue', 'Due soon', 'Upcoming', 'Scheduled', 'Completed'];
    var by = {}; buckets.forEach(function (b) { by[b] = []; });
    list.forEach(function (r) { by[Q.reviewStatus(r)].push(r); });
    buckets.forEach(function (b) { by[b].sort(Q.by('due', b === 'Completed' ? -1 : 1)); });
    var tabs = [['mine', 'My reviews']]; if (Q.can('reviews.org')) tabs.push(['org', 'Organisation reviews']);
    var owners = all().map(function (r) { return r.reviewer; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
    return h`<div class="page-head"><div><h1>Periodic reviews</h1><div class="sub">Reviews are created automatically at each document’s advance-notice date.</div></div><button class="btn" data-act="reviews-export">${Q.icon('download', 'ico-sm')} Export CSV</button></div>
      <div class="tabs" role="tablist">${tabs.map(function (t) { var on = (q.tab || 'mine') === t[0]; return h`<button class="tab ${on ? 'active' : ''}" role="tab" aria-selected="${on}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>
      ${Q.tip('reviews', h`<b>Periodic reviews.</b> Choose <b>No update needed</b> (signed in Adobe Sign; the review date resets) or <b>Needs update</b>, which starts a new draft or a change request.`)}
      <div class="grid-4 mb-16">${['Overdue', 'Due soon', 'Upcoming', 'Completed'].map(function (b) { return h`<div class="card kpi"><div class="kpi-label">${b}</div><div class="kpi-value" style="${b === 'Overdue' && by[b].length ? 'color:var(--overdue)' : ''}">${by[b].length}</div></div>`; })}</div>
      ${org ? h`<div class="toolbar"><select class="select" data-change="qfilter" data-key="owner" aria-label="Reviewer"><option value="">All reviewers</option>${owners.map(function (u) { return h`<option value="${u}" ${q.owner === u ? 'selected' : ''}>${Q.fullName(u)}</option>`; })}</select></div>` : ''}
      ${list.length ? buckets.map(function (b) {
        if (!by[b].length) return '';
        return h`<div class="group-label ${b === 'Overdue' ? 'overdue' : ''}">${b} · ${by[b].length}</div>${Q.table({ id: 'rv-' + b, rows: by[b].map(function (r) { var d = Q.S.docs[r.doc]; return Object.assign({ title: d.title, who: Q.fullName(r.reviewer), freq: d.periodic ? d.periodic.months : 12 }, r); }), href: function (r) { return '#/reviews/' + r.id; },
          cols: [{ key: 'doc', label: 'Document', cls: 'id', render: function (r) { return h`<a href="#/reviews/${r.id}">${r.doc}</a>`; } }, { key: 'title', label: 'Title' }, { key: 'who', label: 'Reviewer' }, { key: 'freq', label: 'Frequency', render: function (r) { return 'Every ' + r.freq + ' months'; } },
            { key: 'due', label: b === 'Completed' ? 'Completed' : 'Due', render: function (r) { return b === 'Completed' ? Q.fmtDate(r.completedAt) : Q.dueChip(r.due); } },
            { key: 'outcome', label: b === 'Completed' ? 'Outcome' : 'Approval', render: function (r) { return b === 'Completed' ? h`${r.outcome}${r.followUp ? h` → ${Q.recLink(r.followUp, { short: true })}` : ''}` : Q.esign.active(r.id, 'review') ? 'Out for signature' : 'Adobe Sign'; } }] })}`;
      }) : Q.empty('No reviews', 'Reviews you own appear here at the advance-notice date.')}`;
  };
  Q.act['reviews-export'] = function () {
    var rows = [['Review', 'Document', 'Title', 'Reviewer', 'Due (UTC)', 'Status', 'Outcome', 'Completed (UTC)', 'Follow-up']];
    all().forEach(function (r) { rows.push([r.id, r.doc, Q.S.docs[r.doc].title, Q.fullName(r.reviewer), r.due, Q.reviewStatus(r), r.outcome || '', r.completedAt || '', r.followUp || '']); });
    Q.exportCsv('periodic-reviews.csv', rows, 'periodic reviews');
  };

  Q.views.review = function (p) {
    var r = Q.S.reviews[p.id];
    if (!r) return Q.views.notFound();
    var d = Q.S.docs[r.doc]; var v = Q.effVer(d) || Q.curVer(d);
    var st = Q.reviewStatus(r);
    var out = Q.esign.active(r.id, 'review');
    var mine = r.reviewer === Q.S.session.userId && r.state !== 'Completed' && !Q.readOnly() && !out;
    var past = all().filter(function (x) { return x.doc === r.doc && x.id !== r.id && x.state === 'Completed'; });
    return h`<nav class="breadcrumb" aria-label="Breadcrumb"><a href="#/reviews">Periodic reviews</a><span>/</span><span>${r.id}</span></nav>
      <div class="page-head"><div><div class="record-meta"><span>Periodic review · ${r.id}</span>${Q.chip(st)}${Q.cls(d.classification)}</div><h1>${d.id} ${d.title}</h1></div>
        ${mine ? h`<div class="btn-row"><button class="btn" data-act="rv-update" data-id="${r.id}">Needs update</button><button class="btn btn-primary" data-act="rv-ok" data-id="${r.id}">No update needed</button></div>` : out && Q.esign.myTurn(out) ? h`<div class="btn-row">${Q.esign.signButton(r.id)}</div>` : ''}</div>
      ${out ? h`<div class="callout mb-16"><strong>“No update needed” is out for Adobe Sign signature.</strong> The review completes when ${Q.fullName(r.reviewer)} signs.</div>` : ''}
      ${r.returned && r.state !== 'Completed' && !out ? h`<div class="callout warn mb-16"><strong>Review sign-off ${r.returned.how} in Adobe Sign.</strong> ${Q.fullName(r.returned.by)}: ${r.returned.reason}</div>` : ''}
      <div class="split"><div class="stack">
        ${r.state === 'Completed' ? h`<div class="callout ${r.outcome === 'No update needed' ? 'ok' : ''}"><strong>${r.outcome}</strong><p class="small" style="margin:4px 0 0">Completed by ${Q.fullName(r.reviewer)} on ${Q.fmtDate(r.completedAt)}${r.agreement ? ' · signed in Adobe Sign' : ''}${r.nextDue ? ' · next review ' + Q.fmtDate(r.nextDue) : ''}</p>${r.followUp ? h`<p class="small" style="margin:4px 0 0">Follow-up: ${Q.recLink(r.followUp)}</p>` : ''}</div>` : ''}
        <div class="card card-pad"><div class="label mb-8">What to check</div><ul style="margin:0;padding-left:20px">
          <li>Is the document still accurate? Does it match how the work is done today?</li><li>Have laws, contracts, risks or Annex A controls changed since v${v.v}?</li><li>Are the owner, links and training rule still right?</li></ul></div>
        <div class="card card-pad"><div class="spread mb-8"><div class="label">Current effective version · v${v.v}</div><a class="btn-link" style="min-height:32px" href="#/documents/${d.id}">Open document</a></div>
          <p class="small muted">${v.summary}</p>${v.content.slice(0, 6).map(function (b) { return b.t === 'h' ? h`<h3 style="margin-top:10px">${b.x}</h3>` : h`<p class="small">${b.x}</p>`; })}</div>
        ${past.length ? h`<div class="card card-pad"><div class="label mb-8">Past reviews</div>${past.map(function (x) { return h`<div class="people-row"><span>${Q.fmtDate(x.completedAt)} · ${Q.fullName(x.reviewer)}</span><span class="status-text st-wait">${x.outcome}</span></div>`; })}</div>` : ''}
      </div>
      <aside class="context"><div class="card ctx-card"><span class="label">Details</span><dl class="dl">
        <div><dt>Reviewer</dt><dd>${Q.name(r.reviewer)}</dd></div><div><dt>Due</dt><dd>${Q.fmtDate(r.due)}</dd></div>
        <div><dt>Frequency</dt><dd>Every ${d.periodic ? d.periodic.months : 12} months</dd></div><div><dt>Advance notice</dt><dd>${r.notice} days</dd></div>
        <div><dt>Signature</dt><dd>Adobe Sign (reviewer)</dd></div><div><dt>Last effective</dt><dd>${Q.fmtDate(d.effective)}</dd></div></dl></div>
        ${Q.esign.recordCard(r.id)}${Q.linkedCard(r.id)}${Q.activityCard(r.id)}</aside></div>`;
  };
  // "No update needed" is a sign-off: the reviewer signs it in Adobe Sign, and the review completes when they do.
  Q.act['rv-ok'] = function (el) { Q.esign.openSend(el.getAttribute('data-id'), 'review'); };
  Q.act['rv-update'] = function (el) {
    var r = Q.S.reviews[el.getAttribute('data-id')], d = Q.S.docs[r.doc];
    Q.drawer.open({ kicker: 'Periodic review · ' + d.id, title: 'Needs update', submitLabel: 'Continue',
      body: h`<div class="field mb-16"><label for="ru">What needs to change? (required)</label><textarea class="textarea" id="ru" name="reason"></textarea></div>
        <fieldset><legend>How should the update happen?</legend><div class="radio-cards">
          <label class="radio-card"><input type="radio" name="route" value="draft" checked><span><b>Start a new draft now</b><br><span class="small muted">For updates you can make yourself. Opens v${Q.curVer(d).v.split('.')[0]}.${+Q.curVer(d).v.split('.')[1] + 1} as a draft.</span></span></label>
          <label class="radio-card"><input type="radio" name="route" value="cr"><span><b>Raise a change request</b><br><span class="small muted">For changes that affect a process, other documents or training.</span></span></label></div></fieldset>`,
      submit: function (f, form) { if (!f.reason) return Q.fieldError(form, 'reason', 'Say what needs to change.'); var to = Q.wf.review.needsUpdate(r, f.route, f.reason); Q.drawer.close(); Q.toast('Review recorded. ' + (f.route === 'cr' ? to + ' created.' : 'New draft started.')); Q.go(Q.recHref(to)); } });
  };
})(window.Q);
