/* Document Control: register, record page (viewer, compare, comments, history, training), create, lifecycle. */
(function (Q) {
  'use strict';
  var h = Q.h;
  var DOC_STATES = ['Draft', 'In review', 'Review closed', 'In approval', 'Effective'];
  Q.DOC_STATES = DOC_STATES;
  Q.DOC_TYPES = [
    { type: 'Policy', prefix: 'POL' }, { type: 'Procedure', prefix: 'SOP' }, { type: 'Work instruction', prefix: 'WI' }, { type: 'Form', prefix: 'FRM' },
    { type: 'Register', prefix: 'REG' }, { type: 'Plan', prefix: 'PLN' }, { type: 'Specification', prefix: 'SPEC' }, { type: 'Statement of Applicability', prefix: 'SOA' },
    { type: 'Vendor approval', prefix: 'VEN' }, { type: 'Validation plan', prefix: 'VP' }, { type: 'Validation report', prefix: 'VR' }
  ];
  Q.PROCESSES = ['ISMS · Governance', 'ISMS · Access control', 'ISMS · Continuity', 'ISMS · Risk', 'ISMS · People', 'ISMS · Supplier management', 'ISMS · Vulnerability mgmt', 'ISMS · Incident management', 'ISMS · Asset management', 'ISMS · Physical security', 'ISMS · Information handling', 'ISMS · Endpoint', 'ISMS · Awareness', 'ISMS · Cryptography'];
  var WATERMARK = { 'Draft': 'DRAFT', 'In review': 'FOR REVIEW', 'Review closed': 'FOR APPROVAL', 'In approval': 'FOR APPROVAL', 'Superseded': 'SUPERSEDED', 'Obsolete': 'OBSOLETE' };

  // ---------- Register ----------
  Q.views.documents = function (p, q) {
    var docs = Object.keys(Q.S.docs).map(function (id) { return Q.S.docs[id]; }).filter(function (d) { return Q.canSee(d); });
    var hidden = Object.keys(Q.S.docs).length - docs.length;
    var s = (q.q || '').toLowerCase();
    var rows = docs.filter(function (d) {
      if (s && (d.id + ' ' + d.title + ' ' + d.tags.join(' ')).toLowerCase().indexOf(s) < 0) return false;
      if (q.type && d.docType !== q.type) return false;
      if (q.state && d.state !== q.state) return false;
      if (q.cls && d.classification !== q.cls) return false;
      if (q.owner === 'me' && d.owner !== Q.S.session.userId) return false;
      return true;
    }).map(function (d) { return Object.assign({}, d, { ver: Q.curVer(d).v, ownerName: Q.fullName(d.owner) }); });
    var states = ['Draft', 'In review', 'Review closed', 'In approval', 'Effective', 'Superseded', 'Obsolete'];
    return h`
      <div class="page-head"><div><h1>Documents</h1><div class="sub">Controlled documents register · ${Q.plural(rows.length, 'document')}${hidden ? ' · ' + hidden + ' hidden by classification' : ''}</div></div>
        <div class="btn-row"><button class="btn" data-act="docs-export">${Q.icon('download', 'ico-sm')} Export CSV</button>${Q.can('doc.create') ? h`<button class="btn btn-primary" data-act="new-doc">${Q.icon('plus', 'ico-sm')} New document</button>` : ''}</div></div>
      ${Q.tip('documents', h`<b>Document Control.</b> Every document moves Draft → In review → Review closed → In approval (one DocuSign envelope) → Effective. Open one to read it, compare versions, comment, or check its approval.`)}
      <div class="toolbar" role="search">
        <input class="input search" type="search" placeholder="Search ID, title or tag" value="${q.q || ''}" data-input="docs-search" aria-label="Search documents">
        <select class="select" data-change="qfilter" data-key="type" aria-label="Type"><option value="">All types</option>${Q.DOC_TYPES.map(function (t) { return h`<option ${q.type === t.type ? 'selected' : ''}>${t.type}</option>`; })}</select>
        <select class="select" data-change="qfilter" data-key="state" aria-label="State"><option value="">All states</option>${states.map(function (t) { return h`<option ${q.state === t ? 'selected' : ''}>${t}</option>`; })}</select>
        <select class="select" data-change="qfilter" data-key="cls" aria-label="Classification"><option value="">All classifications</option>${Q.CLASSES.map(function (t) { return h`<option ${q.cls === t ? 'selected' : ''}>${t}</option>`; })}</select>
        <select class="select" data-change="qfilter" data-key="owner" aria-label="Owner"><option value="">Any owner</option><option value="me" ${q.owner === 'me' ? 'selected' : ''}>Owned by me</option></select>
      </div>
      ${Q.table({
        id: 'docs', caption: 'Documents register', defaultSort: 'id', rows: rows, href: function (r) { return '#/documents/' + r.id; },
        cols: [
          { key: 'id', label: 'ID', cls: 'id' },
          { key: 'title', label: 'Title', render: function (r) { return h`<a href="#/documents/${r.id}">${r.title}</a>${r.checkedOut ? h` <span class="chip chip-outline" title="Checked out">${Q.icon('lock', 'ico-sm')} ${Q.user(r.checkedOut.u).initials}</span>` : ''}`; } },
          { key: 'docType', label: 'Type' },
          { key: 'state', label: 'State', render: function (r) { return Q.stateChip(r.state); } },
          { key: 'ver', label: 'Version', render: function (r) { var e = Q.effVer(r); return h`v${r.ver}${e && e.v !== r.ver ? h`<span class="muted small"> · v${e.v} effective</span>` : ''}`; } },
          { key: 'classification', label: 'Class', render: function (r) { return Q.cls(r.classification); } },
          { key: 'tags', label: 'Tags', sort: false, render: function (r) { return h`<span class="small muted">${r.tags.join(', ')}</span>`; } },
          { key: 'ownerName', label: 'Owner' },
          { key: 'modified', label: 'Last modified', render: function (r) { return Q.fmtDate(r.modified); } }
        ]
      })}`;
  };
  Q.on['docs-search'] = Q.debounce(function (el) { Q.setQuery({ q: el.value }); var i = document.querySelector('[data-input="docs-search"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
  Q.on.qfilter = function (el) { var p = {}; p[el.getAttribute('data-key')] = el.value; Q.setQuery(p); };
  Q.act['docs-export'] = function () {
    var rows = [['ID', 'Title', 'Type', 'State', 'Version', 'Effective version', 'Classification', 'Tags', 'Owner', 'Last modified (UTC)']];
    Object.keys(Q.S.docs).map(function (id) { return Q.S.docs[id]; }).filter(function (d) { return Q.canSee(d); }).forEach(function (d) {
      var e = Q.effVer(d); rows.push([d.id, d.title, d.docType, d.state, Q.curVer(d).v, e ? e.v : '', d.classification, d.tags.join('; '), Q.fullName(d.owner), d.modified]);
    });
    Q.exportCsv('documents-register.csv', rows, 'documents register');
  };

  // ---------- Record page ----------
  Q.views.document = function (p, q) {
    var d = Q.S.docs[p.id];
    if (!d) return Q.views.notFound();
    if (!Q.canSee(d)) {
      Q.audit('read', 'Document', d.id, 'Access denied: ' + d.id + ' is ' + d.classification); Q.save();
      return h`<div class="card card-pad"><h1>${d.id} is ${d.classification}</h1><p class="muted">You need ${d.classification} clearance or named access to open it. The attempt was logged.</p><a class="btn" href="#/documents">Back to documents</a></div>`;
    }
    Q.ui.recent = [d.id].concat((Q.ui.recent || []).filter(function (x) { return x !== d.id; })).slice(0, 6);
    if (d.classification === 'Restricted' && Q.ui.lastRead !== d.id) { Q.ui.lastRead = d.id; Q.audit('read', 'Document', d.id, 'Opened Restricted document ' + d.id); Q.save(); }
    var me = Q.S.session.userId;
    var v = Q.curVer(d);
    var verSel = q.v ? d.versions.find(function (x) { return x.v === q.v; }) || v : v;
    var tab = q.tab || 'document';
    var openComments = d.comments.filter(function (c) { return !c.resolved; }).length;
    var reviewer = d.reviewers.find(function (r) { return r.u === me; });
    var env = Q.ds.active(d.id);
    var labels = { 'Review closed': 'Review closed · verify and send', 'In approval': env ? 'DocuSign · ' + Q.ds.signedCount(env) + ' of ' + env.signers.length + ' signed' : 'In approval' };
    var sendBlock = d.state === 'Review closed' ? Q.ds.cantSend(d.id) : 'n/a';
    var sendPlan = d.state === 'Review closed' && !sendBlock ? Q.ds.plan(d.id) : null;

    // Actions in the header (one primary)
    var acts = [];
    var ro = Q.readOnly();
    if (!ro) {
      if (d.state === 'Draft' && (d.author === me || d.owner === me)) {
        if (d.checkedOut && d.checkedOut.u === me) acts.push(h`<button class="btn" data-act="doc-cancel-co" data-id="${d.id}">Cancel check-out</button><button class="btn" data-act="doc-edit" data-id="${d.id}">${Q.icon('edit', 'ico-sm')} Edit and check in</button>`);
        else if (!d.checkedOut) acts.push(h`<button class="btn" data-act="doc-checkout" data-id="${d.id}">${Q.icon('lock', 'ico-sm')} Check out to edit</button>`);
        acts.push(h`<button class="btn btn-primary" data-act="doc-submit" data-id="${d.id}">Submit for review</button>`);
      }
      if (d.state === 'In review' && reviewer && reviewer.status === 'Pending') acts.push(h`<button class="btn" data-act="doc-sendback" data-id="${d.id}">Send back to draft</button><button class="btn btn-primary" data-act="doc-review" data-id="${d.id}">Mark reviewed</button>`);
      if (d.state === 'Review closed' && !sendBlock) acts.push(h`<button class="btn" data-act="doc-sendback" data-id="${d.id}">Send back to draft</button><button class="btn btn-primary" data-act="ds-send" data-id="${d.id}">${Q.icon('sign', 'ico-sm')} Verify and send to DocuSign</button>`);
      if (d.state === 'In approval' && env && Q.ds.myTurn(env)) acts.push(h`<button class="btn btn-primary" data-act="ds-open-sign" data-id="${env.id}">${Q.icon('sign', 'ico-sm')} Sign in DocuSign</button>`);
      if (d.state === 'In approval' && env && Q.ds.canVoid(env)) acts.push(h`<button class="btn" data-act="ds-void" data-id="${env.id}">Void envelope</button>`);
      if ((d.state === 'Effective') && (d.owner === me || d.author === me || Q.hasRole('qm'))) acts.push(h`<button class="btn" data-act="doc-newver" data-id="${d.id}">New version</button>`);
      if (d.state === 'Effective' && Q.hasRole('qm')) acts.push(h`<button class="btn btn-danger" data-act="doc-obsolete" data-id="${d.id}">Make obsolete</button>`);
    }
    acts.push(h`<button class="btn" data-act="doc-download" data-id="${d.id}" data-v="${verSel.v}">${Q.icon('download', 'ico-sm')} PDF</button>`);

    var tabs = [['document', 'Document'], ['compare', 'Compare versions'], ['comments', 'Comments · ' + d.comments.length], ['history', 'Version history'], ['approval', 'Approval · DocuSign'], ['training', 'Training']];
    var content;
    if (tab === 'compare') content = compareTab(d, q);
    else if (tab === 'comments') content = commentsTab(d, q);
    else if (tab === 'history') content = historyTab(d);
    else if (tab === 'training') content = trainingTab(d, q);
    else if (tab === 'approval') content = approvalTab(d);
    else content = viewer(d, verSel, q);

    var effMonths = d.periodic ? 'Every ' + d.periodic.months + ' months' : 'Not scheduled';
    var nextReview = Object.keys(Q.S.reviews).map(function (k) { return Q.S.reviews[k]; }).find(function (r) { return r.doc === d.id && r.state === 'Open'; });

    return h`
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="#/documents">Documents</a><span>/</span><span>${d.id}</span></nav>
      <div class="page-head">
        <div style="min-width:0">
          <div class="record-meta"><span>${d.docType} · ${d.id}</span>${Q.cls(d.classification)}<span class="chip chip-outline">v${v.v} ${v.kind}${d.checkedOut ? ' · checked out by ' + Q.name(d.checkedOut.u) : ' · checked in'}</span>${d.state === 'Obsolete' || d.state === 'Superseded' ? Q.stateChip(d.state) : ''}</div>
          <h1>${d.title}</h1>
        </div>
        <div class="btn-row">${acts}</div>
      </div>
      ${sendPlan && sendPlan.problems.length ? h`<div class="callout warn mb-16"><strong>Check before sending to DocuSign.</strong>${sendPlan.problems.map(function (x) { return h` ${x}`; })}</div>` : ''}
      ${d.state === 'Review closed' && sendBlock && sendBlock !== 'n/a' && !Q.readOnly() && (d.owner === me || d.author === me) ? h`<div class="callout warn mb-16"><strong>Can’t send yet.</strong> ${sendBlock}</div>` : ''}
      ${d.state !== 'Obsolete' ? h`<div class="card mb-16">${Q.stepper(DOC_STATES, d.state, labels, { allDone: d.state === 'Effective' })}</div>` : h`<div class="callout warn mb-16"><strong>Obsolete.</strong> ${d.obsoleteReason || ''} Archived, not deleted; it stays in the register and audit trail.</div>`}
      <div class="split">
        <div style="min-width:0">
          <div class="tabs" role="tablist">${tabs.map(function (t) { return h`<button class="tab ${tab === t[0] ? 'active' : ''}" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>
          ${content}
        </div>
        <aside class="context" aria-label="Record details">
          <div class="card ctx-card"><span class="label">Details</span><dl class="dl">
            <div><dt>Owner</dt><dd>${Q.name(d.owner)}</dd></div><div><dt>Quality process</dt><dd>${d.process}</dd></div>
            <div><dt>Source template</dt><dd>${d.template ? d.template + ' ' + ((Q.S.templates.find(function (t) { return t.id === d.template; }) || {}).name || '') : d.sourceFile ? 'Upload: ' + d.sourceFile : 'Blank page'}</dd></div>
            ${d.state === 'In approval' ? h`<div><dt>Approval due</dt><dd class="${Q.daysFromToday(d.approvalDue) < 0 ? 'st-overdue' : ''}" style="font-weight:${Q.daysFromToday(d.approvalDue) < 0 ? 600 : 400}">${Q.fmtShort(d.approvalDue)}${Q.daysFromToday(d.approvalDue) < 0 ? ' · overdue' : ''}</dd></div>` : d.state === 'In review' ? h`<div><dt>Review due</dt><dd>${Q.fmtShort(d.reviewDue)}</dd></div>` : h`<div><dt>Effective date</dt><dd>${Q.fmtDate(d.effective)}</dd></div>`}
            <div><dt>Periodic review</dt><dd>${effMonths}${nextReview ? h`<br><a class="small" href="#/reviews/${nextReview.id}">Next: ${Q.fmtShort(nextReview.due)}</a>` : ''}</dd></div>
            <div><dt>Tags</dt><dd>${d.tags.join(', ') || '—'}</dd></div>
            <div><dt>Approved</dt><dd>${v.approvedAt ? Q.fmtDate(v.approvedAt) + (v.envelope ? ' · DocuSign' : v.migrated ? ' · KSTARRS' : '') : '—'}</dd></div>
            <div><dt>Training audience</dt><dd>${Q.audienceText(Q.audienceOf(d))}</dd></div>
            <div><dt>Last review closed</dt><dd>${(function () { var rs = d.reviewers.filter(function (r) { return r.at; }).map(function (r) { return r.at; }).sort(); return rs.length ? Q.fmtShort(rs[rs.length - 1]) : '—'; })()}</dd></div>
          </dl></div>
          <div class="card ctx-card"><span class="label">People</span>
            ${Q.peopleRow(d.author, 'Author', d.state === 'Draft' ? 'Drafting' : 'Submitted', 'st-wait')}
            ${d.reviewers.map(function (r, i) { return Q.peopleRow(r.u, 'Reviewer', r.status === 'Pending' ? (r.u === me ? 'Your turn' : 'Reviewing') : r.status, r.status === 'Reviewed' ? 'st-done' : r.status === 'Pending' ? 'st-turn' : 'st-wait'); })}
            ${d.approvers.map(function (a, i) {
              var st = a.status === 'Waiting' && d.state !== 'Draft' && d.state !== 'Effective' ? 'Waiting · FYI sent' : a.status === 'Your turn' && a.u !== me ? 'Signing in DocuSign' : a.status;
              return Q.peopleRow(a.u, d.approvers.length > 1 ? 'QA approver ' + (i + 1) : 'QA approver', st, a.status === 'Signed' ? 'st-done' : a.status === 'Your turn' ? 'st-turn' : 'st-wait');
            })}
            <div class="small muted mt-8">${d.reviewRoute === 'sequential' ? 'Sequential' : 'Parallel'} review · DocuSign signing order: author, reviewers, then QA approver</div>
          </div>
          ${Q.ds.recordCard(d.id)}
          ${Q.linkedCard(d.id)}
          ${Q.activityCard(d.id)}
        </aside>
      </div>`;
  };

  function pages(blocks) { // split content into pages of about 8 blocks
    var out = [], cur = [];
    blocks.forEach(function (b, i) { cur.push({ b: b, i: i }); if (cur.length >= 8 && b.t === 'p') { out.push(cur); cur = []; } });
    if (cur.length) out.push(cur);
    return out;
  }
  function viewer(d, v, q) {
    var zoom = Q.ui.zoom || 100;
    var me = Q.me();
    var wm = WATERMARK[v.state] || null;
    var pg = pages(v.content);
    var commented = {}; d.comments.forEach(function (c) { if (c.block != null && v === Q.curVer(d)) commented[c.block] = (commented[c.block] || 0) + (c.resolved ? 0 : 1); });
    var sigs = v.signatures || [];
    var totalPages = pg.length + (sigs.length ? 1 : 0);
    var page = function (blocks, n) {
      return h`<div class="page" style="transform:scale(${zoom / 100});margin-bottom:${Math.max(20, 20 + (zoom - 100) * 7)}px">
        ${wm ? h`<div class="watermark" aria-hidden="true">${wm}</div>` : ''}
        ${n === 1 ? h`<h2>${d.id} ${d.title}</h2><div class="doc-meta"><span>Version ${v.v} · ${v.state}</span><span>Owner: ${Q.fullName(d.owner)}</span><span>${d.classification.toUpperCase()}</span></div>` : ''}
        ${blocks.map(function (x) {
          if (x.b.t === 'h') return h`<h3>${x.b.x}</h3>`;
          var open = commented[x.i];
          return open ? h`<p class="commented" data-act="tab" data-tab="comments" title="${open} open comment${open > 1 ? 's' : ''}: open the Comments tab">${x.b.x}</p>` : h`<p>${x.b.x}</p>`;
        })}
        <div class="footer-line">Viewed by ${me.name} on ${Q.fmtDate(new Date())}. ${v.state === 'Effective' ? 'Controlled copy on screen; uncontrolled when printed.' : 'Uncontrolled when printed.'} · Page ${n} of ${totalPages}</div>
      </div>`;
    };
    var manifest = sigs.length ? h`<div class="page" style="transform:scale(${zoom / 100})">
      ${wm ? h`<div class="watermark" aria-hidden="true">${wm}</div>` : ''}
      <h2>Signature manifest</h2><div class="doc-meta"><span>${d.id} ${d.title} · v${v.v}</span><span>${v.envelope ? 'DocuSign envelope ' + v.envelope.slice(0, 8) + '…' : v.migrated ? 'Migrated from KSTARRS' : 'Content SHA-256 below'}</span></div>
      <p>Each row is rendered from the stored signature record, not typed. Signatures cannot be edited or detached from this version.</p>
      <table class="manifest-table"><thead><tr><th>Signer</th><th>Meaning</th><th>Signed (UTC)</th><th>Signature</th></tr></thead><tbody>
      ${sigs.map(function (s) { return h`<tr><td>${Q.fullName(s.user)}</td><td>${s.meaning}</td><td>${Q.fmtUtc(s.at)}</td><td>${s.source === 'DocuSign' ? 'DocuSign · ' + s.id : s.source === 'KSTARRS' ? 'KSTARRS · ' + s.id : s.id}</td></tr>`; })}</tbody></table>
      <h3>Signature statement</h3><p>${sigs[0].statement || Q.statementFor('Approved')}</p>
      <h3>Content fingerprint (SHA-256)</h3><p style="font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all">${v.hash}</p>
      <div class="footer-line">Viewed by ${me.name} on ${Q.fmtDate(new Date())}. · Page ${totalPages} of ${totalPages}</div></div>` : '';
    return h`
      ${v !== Q.curVer(d) ? h`<div class="callout plain mb-8 spread"><span>Viewing <b>v${v.v}</b> (${v.state}).</span><button class="btn btn-sm" data-act="tab" data-key="v" data-tab="">Back to v${Q.curVer(d).v}</button></div>` : ''}
      <div class="viewer-bar">
        <div class="row"><button class="btn btn-sm" data-act="zoom" data-d="-10" aria-label="Zoom out">−</button><span class="small" style="min-width:44px;text-align:center" aria-live="polite">${zoom}%</span><button class="btn btn-sm" data-act="zoom" data-d="10" aria-label="Zoom in">+</button></div>
        <span class="small muted">${totalPages} page${totalPages > 1 ? 's' : ''}${sigs.length ? ' incl. signature manifest' : ''}</span>
        <button class="btn-link" style="font-size:13px" data-act="doc-newtab" data-id="${d.id}" data-v="${v.v}">Open in new tab</button>
      </div>
      <div class="viewer" tabindex="0" aria-label="Document viewer">${pg.map(function (b, i) { return page(b, i + 1); })}${manifest}</div>
      <p class="small muted mt-8">Office files are converted to PDF on our own server and shown here; nothing is sent to an outside viewer.${Object.keys(commented).some(function (k) { return commented[k]; }) ? ' Highlighted blocks have open reviewer comments.' : ''}</p>`;
  }
  Q.act.zoom = function (el) { Q.ui.zoom = Math.max(60, Math.min(160, (Q.ui.zoom || 100) + +el.getAttribute('data-d'))); Q.render({ keepScroll: true }); };

  // Word-level diff (LCS) for version comparison
  function wordDiff(a, b) {
    var A = a.split(/(\s+)/), B = b.split(/(\s+)/), n = A.length, m = B.length;
    if (n * m > 60000) return { l: h`${a}`, r: h`${b}` };
    var L = []; for (var i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var left = [], right = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { left.push(Q.esc(A[i])); right.push(Q.esc(B[j])); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { left.push(A[i].trim() ? '<span class="del">' + Q.esc(A[i]) + '</span>' : Q.esc(A[i])); i++; }
      else { right.push(B[j].trim() ? '<span class="add">' + Q.esc(B[j]) + '</span>' : Q.esc(B[j])); j++; }
    }
    while (i < n) { left.push(A[i].trim() ? '<span class="del">' + Q.esc(A[i]) + '</span>' : Q.esc(A[i])); i++; }
    while (j < m) { right.push(B[j].trim() ? '<span class="add">' + Q.esc(B[j]) + '</span>' : Q.esc(B[j])); j++; }
    return { l: Q.raw(left.join('')), r: Q.raw(right.join('')) };
  }
  function sections(content) { // [{title, text}]
    var out = []; var cur = null;
    content.forEach(function (b) { if (b.t === 'h') { cur = { title: b.x, text: '' }; out.push(cur); } else { if (!cur) { cur = { title: '', text: '' }; out.push(cur); } cur.text += (cur.text ? ' ' : '') + b.x; } });
    return out;
  }
  function compareTab(d, q) {
    if (d.versions.length < 2) return Q.empty('Only one version so far', 'Comparison appears once there is a second version.');
    var right = d.versions.find(function (x) { return x.v === q.b; }) || d.versions[d.versions.length - 1];
    var left = d.versions.find(function (x) { return x.v === q.a; }) || d.versions[d.versions.length - 2];
    var L = sections(left.content), R = sections(right.content);
    var titles = []; L.concat(R).forEach(function (s) { var k = s.title.replace(/^\d+\.\s*/, ''); if (titles.indexOf(k) < 0) titles.push(k); });
    var find = function (arr, t) { return arr.find(function (s) { return s.title.replace(/^\d+\.\s*/, '') === t; }); };
    var sel = function (key, cur) { return h`<select class="select" style="width:auto;min-height:40px" data-change="qfilter" data-key="${key}" aria-label="${key === 'a' ? 'Older version' : 'Newer version'}">${d.versions.map(function (x) { return h`<option value="${x.v}" ${x === cur ? 'selected' : ''}>v${x.v} · ${x.state}</option>`; })}</select>`; };
    return h`<div class="toolbar">${sel('a', left)}<span class="muted">compared with</span>${sel('b', right)}<span class="legend" style="margin-left:auto"><span><i style="background:var(--overdue-bg);border:1px solid var(--overdue)"></i>Removed</span><span><i style="background:var(--done-bg);border:1px solid var(--done)"></i>Added</span></span></div>
      <div class="diff"><div class="col"><div class="label mb-8">v${left.v} · ${left.state}</div>${titles.map(function (t) { var a = find(L, t), b = find(R, t); var df = wordDiff(a ? a.text : '', b ? b.text : ''); return h`<h4>${a ? a.title : h`<span class="del">${b.title}</span>`}</h4><p>${a ? df.l : h`<span class="muted small">Not in this version</span>`}</p>`; })}</div>
        <div class="col"><div class="label mb-8">v${right.v} · ${right.state}</div>${titles.map(function (t) { var a = find(L, t), b = find(R, t); var df = wordDiff(a ? a.text : '', b ? b.text : ''); return h`<h4>${b ? (a ? b.title : h`<span class="add">${b.title}</span>`) : ''}</h4><p>${b ? df.r : h`<span class="muted small">Removed in this version</span>`}</p>`; })}</div></div>
      <div class="card card-pad mt-16"><div class="label mb-8">Change summary for v${right.v}</div><p style="margin:0">${right.summary || '—'}</p></div>`;
  }
  function commentsTab(d) {
    var v = Q.curVer(d);
    var canComment = !Q.readOnly() && ['Draft', 'In review', 'In approval'].indexOf(d.state) >= 0;
    var blockLabel = function (i) { var b = v.content; for (var k = i; k >= 0; k--) if (b[k] && b[k].t === 'h') return b[k].x; return 'General'; };
    return h`${canComment ? h`<form class="card card-pad mb-16" data-submit="doc-comment" data-id="${d.id}"><div class="form-grid"><div class="field"><label for="cb">Section</label><select class="select" id="cb" name="block"><option value="">General</option>${v.content.map(function (b, i) { return b.t === 'p' ? h`<option value="${i}">${blockLabel(i)}</option>` : ''; })}</select></div><div class="field full"><label for="ct">Comment</label><textarea class="textarea" id="ct" name="text" placeholder="Suggest a change or ask a question"></textarea></div></div><button class="btn btn-primary mt-16" type="submit">Add comment</button></form>` : ''}
      ${d.comments.length ? h`<div class="list-rows">${d.comments.slice().reverse().map(function (c) {
        return h`<div class="list-row" style="align-items:flex-start">${Q.avatar(c.u)}<div class="lr-main"><div class="spread"><b>${Q.name(c.u)}</b><span class="small muted">${Q.fmtDateTime(c.at)}</span></div>
          <div class="small muted">${c.block != null ? 'On: ' + blockLabel(c.block) : 'General'}</div><p style="margin:6px 0 0">${c.text}</p>${c.reply ? h`<p class="small muted" style="margin:6px 0 0">Author: ${c.reply}</p>` : ''}</div>
          ${c.resolved ? Q.chip('Resolved', 'chip-done') : Q.readOnly() ? Q.chip('Open', 'chip-turn') : h`<button class="btn btn-sm" data-act="doc-resolve" data-id="${d.id}" data-c="${c.id}">Resolve</button>`}</div>`;
      })}</div>` : Q.empty('No comments', 'Reviewers can comment on any section.')}`;
  }
  Q.on['doc-comment'] = function (form) {
    var f = Q.formData(form); var d = Q.S.docs[form.getAttribute('data-id')];
    if (!f.text) return Q.fieldError(form, 'text', 'Write a comment first.');
    Q.wf.doc.comment(d, f.block === '' ? null : +f.block, f.text); Q.toast('Comment added'); Q.refresh();
  };
  Q.act['doc-resolve'] = function (el) { Q.wf.doc.resolve(Q.S.docs[el.getAttribute('data-id')], el.getAttribute('data-c')); Q.refresh(); };

  function historyTab(d) {
    return Q.table({
      id: 'vh-' + d.id, rows: d.versions.slice().reverse(), defaultSort: null,
      cols: [
        { key: 'v', label: 'Version', render: function (x) { return h`<b>v${x.v}</b> <span class="small muted">${x.kind}</span>`; } },
        { key: 'state', label: 'State', render: function (x) { return Q.stateChip(x.state); } },
        { key: 'summary', label: 'Change summary', sort: false, render: function (x) { return h`<span class="small">${x.summary}</span>`; } },
        { key: 'createdBy', label: 'Author', render: function (x) { return Q.fullName(x.createdBy); } },
        { key: 'approvedAt', label: 'Approved', render: function (x) { return x.approvedAt ? Q.fmtDate(x.approvedAt) : '—'; } },
        { key: 'sig', label: 'Signatures', sort: false, render: function (x) { return x.signatures.length ? x.signatures.map(function (s) { return Q.user(s.user).initials; }).join(', ') : '—'; } },
        { key: 'envelope', label: 'Approval record', sort: false, render: function (x) { return x.envelope ? h`<button class="btn-link" style="padding:0;min-height:0;font-size:13px" data-act="ds-env" data-id="${x.envelope}">DocuSign ${x.envelope.slice(0, 8)}…</button>` : x.migrated ? h`<span class="small muted">KSTARRS (migrated)</span>` : '—'; } },
        { key: 'hash', label: 'SHA-256', sort: false, render: function (x) { return h`<span class="mono" title="${x.hash}">${x.hash.slice(0, 12)}…</span>`; } },
        { key: 'go', label: '', sort: false, render: function (x) { return h`<button class="btn btn-sm" data-act="tab" data-key="v" data-tab="${x.v}">View</button>`; } }
      ]
    });
  }
  function approvalTab(d) {
    var envs = Q.ds.forRecord(d.id);
    var migrated = d.versions.filter(function (v) { return v.migrated; });
    return h`${envs.length ? Q.table({ id: 'denv-' + d.id, rows: envs, defaultSort: 'sentAt', defaultDir: -1,
        cols: [{ key: 'version', label: 'Version', render: function (e) { return 'v' + e.version; } }, { key: 'sentAt', label: 'Sent', render: function (e) { return Q.fmtDateTime(e.sentAt); } }, { key: 'sentBy', label: 'Sent by', render: function (e) { return Q.fullName(e.sentBy); } },
          { key: 'status', label: 'Status', render: function (e) { return h`${Q.ds.statusChip(e)}${e.correctionOf ? h` <span class="chip chip-due">Correction</span>` : ''}`; } }, { key: 'signed', label: 'Signed', sort: false, render: function (e) { return Q.ds.signedCount(e) + ' of ' + e.signers.length; } },
          { key: 'files', label: 'Stored files', sort: false, render: function (e) { return e.signedPdf ? h`<span class="row-wrap"><button class="btn btn-sm" data-act="ds-signed" data-id="${e.id}">Signed PDF</button><button class="btn btn-sm" data-act="ds-cert" data-id="${e.id}">Certificate</button></span>` : h`<span class="small muted">${e.status === 'sent' ? 'When completed' : e.declineReason || e.voidReason || '—'}</span>`; } },
          { key: 'id', label: '', sort: false, render: function (e) { return h`<button class="btn btn-sm" data-act="ds-env" data-id="${e.id}">Details</button>`; } }] }) : Q.empty('No DocuSign envelopes yet', d.state === 'Review closed' ? 'Verify the PDF and send it to DocuSign.' : 'An envelope is sent once review closes.')}
      ${migrated.length ? h`<p class="small muted mt-16">${migrated.map(function (v) { return 'v' + v.v; }).join(', ')} ${migrated.length > 1 ? 'were' : 'was'} approved in KSTARRS before go-live. Those signatures are kept as migrated records on the version history.</p>` : ''}`;
  }

  function trainingTab(d, q) {
    var aud = Q.audienceOf(d);
    var eff = Q.effVer(d);
    var all = Q.S.assignments.filter(function (a) { return a.doc === d.id; });
    var cur = eff ? all.filter(function (a) { return a.ver === eff.v && !a.closed && !a.noRetrain; }) : [];
    var live = cur.filter(function (a) { return ['Corrected'].indexOf(Q.trStatus(a)) < 0 && !a.leaver; });
    var done = live.filter(function (a) { return a.completed; }).length;
    var rows = (q.all ? all : cur).map(function (a) { return Object.assign({ name: Q.fullName(a.user), st: Q.trStatus(a) }, a); });
    var canEdit = !Q.readOnly() && (Q.can('training.manage') || d.owner === Q.S.session.userId);
    Q.reports['docstatus-' + d.id] = { title: 'Training status: ' + d.id + ' ' + d.title, file: 'training-status-' + d.id, rows: function () { return Q.trainingRows(all); }, intro: 'Current version: ' + (eff ? 'v' + eff.v : 'none effective') + '. Audience: ' + Q.audienceText(aud) + '.' };
    return h`<div class="grid-3 mb-16">
        <div class="card kpi"><div class="spread"><span class="kpi-label">Who must train</span>${canEdit ? h`<button class="btn-link" style="min-height:28px;font-size:13px;padding:0" data-act="doc-audience" data-id="${d.id}">Change</button>` : ''}</div><div style="font-weight:600;margin-top:6px">${Q.audienceText(aud)}</div><div class="kpi-sub">${Q.plural(Q.audienceMembers(d).length, 'person', 'people')} · ${aud.days} days to complete${aud.quiz ? ' · knowledge check' : ''}</div></div>
        <div class="card kpi"><div class="kpi-label">Complete for ${eff ? 'v' + eff.v : 'the effective version'}</div><div class="kpi-value">${Q.pct(done, live.length)}%</div><div class="progress"><div style="width:${Q.pct(done, live.length)}%"></div></div></div>
        <div class="card kpi"><div class="kpi-label">Overdue</div><div class="kpi-value">${live.filter(function (a) { return Q.trStatus(a) === 'Overdue'; }).length}</div><div class="kpi-sub">of ${live.length} on this version</div></div></div>
      <div class="spread mb-8" style="flex-wrap:wrap"><label class="check small"><input type="checkbox" data-change="doc-tr-all" ${q.all ? 'checked' : ''}> Show earlier versions, withdrawn and corrected records</label>${Q.reportButtons('docstatus-' + d.id)}</div>
      ${Q.table({ id: 'dt-' + d.id, rows: rows, defaultSort: 'name', empty: eff ? 'No training allocated for this version.' : 'Training is allocated when a version becomes effective.', href: function (a) { return '#/training?tab=records&rec=' + a.id; },
        cols: [{ key: 'name', label: 'Person', render: function (a) { return h`${a.name}${a.leaver ? h` <span class="muted small">· left</span>` : ''}`; } }, { key: 'ver', label: 'Version', render: function (a) { return 'v' + a.ver; } },
          { key: 'allocReason', label: 'Allocated', render: function (a) { return h`<span class="small">${a.allocReason} · ${a.allocatedBy === 'system' ? 'System' : Q.fullName(a.allocatedBy)}</span>`; } },
          { key: 'assigned', label: 'Assigned', render: function (a) { return Q.fmtShort(a.assigned); } }, { key: 'due', label: 'Due', render: function (a) { return a.due ? Q.fmtShort(a.due) : '—'; } },
          { key: 'completed', label: 'Completed (UTC)', render: function (a) { return a.completed ? Q.fmtUtc(a.completed) : '—'; } }, { key: 'st', label: 'Status', render: function (a) { return Q.chip(a.st); } }] })}
      <p class="small muted mt-8">Records are dated by the system and locked once completed. Earlier versions’ records are kept and shown as superseded.</p>`;
  }
  Q.on['doc-tr-all'] = function (el) { Q.setQuery({ all: el.checked ? '1' : '' }); };
  Q.audienceFields = function (aud) {
    aud = aud || { groups: [], roles: [], users: [], days: 14, quiz: false };
    return h`<fieldset class="full mb-16"><legend>Groups</legend><div class="grid-2" style="gap:0 16px">${Q.S.groups.map(function (g) { return h`<label class="check"><input type="checkbox" data-multi name="groups" value="${g.name}" ${aud.groups.indexOf(g.name) >= 0 ? 'checked' : ''}> ${g.name}</label>`; })}</div></fieldset>
      <fieldset class="full mb-16"><legend>Roles</legend><div class="grid-2" style="gap:0 16px">${Object.keys(Q.ROLE_LABEL).filter(function (r) { return r !== 'auditor'; }).map(function (r) { return h`<label class="check"><input type="checkbox" data-multi name="roles" value="${r}" ${aud.roles.indexOf(r) >= 0 ? 'checked' : ''}> ${Q.ROLE_LABEL[r]}</label>`; })}</div></fieldset>
      <details class="full mb-16" ${aud.users.length ? 'open' : ''}><summary class="btn-link" style="padding:0">Named people (${aud.users.length})</summary><div class="grid-2 mt-8" style="gap:0 16px">${Q.activeUsers().filter(function (u) { return u.roles.indexOf('auditor') < 0; }).map(function (u) { return h`<label class="check"><input type="checkbox" data-multi name="users" value="${u.id}" ${aud.users.indexOf(u.id) >= 0 ? 'checked' : ''}> ${u.name}</label>`; })}</div></details>
      <div class="form-grid"><div class="field"><label for="aud-days">Days to complete</label><input class="input" type="number" min="1" id="aud-days" name="days" value="${aud.days}"></div>
        <label class="check" style="align-self:end"><input type="checkbox" name="quiz" ${aud.quiz ? 'checked' : ''}> Include a knowledge check</label></div>`;
  };
  Q.audienceFrom = function (f, prev) { return { groups: f.groups || [], roles: f.roles || [], users: f.users || [], days: Math.max(1, +f.days || 14), quiz: !!f.quiz, retrainMonths: prev ? prev.retrainMonths || null : null }; };
  Q.act['doc-audience'] = function (el) {
    var d = Q.S.docs[el.getAttribute('data-id')];
    Q.drawer.open({ kicker: d.id + ' · training', title: 'Who must train on ' + d.id, submitLabel: 'Save audience',
      body: h`${Q.audienceFields(Q.audienceOf(d))}<p class="small muted mt-16">Saving applies to ${Q.effVer(d) ? 'v' + Q.effVer(d).v + ' now: new people are allocated it, and open allocations for people no longer in the audience close' : 'the next version when it becomes effective'}. The change is logged with the old and new audience.</p>`,
      submit: function (f) { var r = Q.setAudience(d, Q.audienceFrom(f, Q.audienceOf(d))); Q.drawer.close(); Q.toast('Audience saved · ' + Q.plural(r.added, 'new allocation') + (r.closed ? ' · ' + r.closed + ' closed' : '')); Q.refresh(); } });
  };

  // ---------- Document actions ----------
  function D(el) { return Q.S.docs[el.getAttribute('data-id')]; }
  Q.act['doc-checkout'] = function (el) { var d = D(el); Q.wf.doc.checkOut(d); Q.toast('Checked out. Nobody else can edit until you check in.'); Q.refresh(); };
  Q.act['doc-cancel-co'] = function (el) { var d = D(el); Q.wf.doc.cancelCheckout(d); Q.toast('Check-out cancelled'); Q.refresh(); };
  function toText(content) { return content.map(function (b) { return b.t === 'h' ? '## ' + b.x : b.x; }).join('\n\n'); }
  function fromText(t) { return t.split(/\n\s*\n/).map(function (s) { s = s.trim(); if (!s) return null; return /^##\s/.test(s) ? { t: 'h', x: s.replace(/^##\s*/, '') } : { t: 'p', x: s.replace(/\n/g, ' ') }; }).filter(Boolean); }
  Q.act['doc-edit'] = function (el) {
    var d = D(el), v = Q.curVer(d);
    var aiOn = Q.S.settings.ai.enabled && ['Confidential', 'Restricted'].indexOf(d.classification) < 0;
    Q.drawer.open({
      wide: true, kicker: d.id + ' · checked out to you', title: 'Edit v' + v.v + ' and check in', submitLabel: 'Check in',
      body: h`<div class="field mb-16"><label for="dc">Content</label><textarea class="textarea" id="dc" name="content" style="min-height:360px;font-family:var(--font-mono);font-size:13px">${toText(v.content)}</textarea><div class="help">Start a line with <span class="mono">## </span> for a heading. Leave a blank line between paragraphs. (In Phase 2 you may edit in Word through Microsoft 365.)</div></div>
        <div class="field"><div class="spread"><label for="cs">Change summary (required)</label><button type="button" class="btn btn-sm" ${aiOn ? '' : 'disabled'} title="${aiOn ? 'Suggest text from the diff' : 'Off until an AI provider is approved under the AI usage policy'}">Draft summary with AI</button></div>
          <textarea class="textarea" id="cs" name="summary" placeholder="What changed and why, in plain words">${v.summary === 'Working draft.' || v.summary === 'First draft.' ? '' : v.summary}</textarea>
          <div class="help">${aiOn ? 'You must review and edit any suggestion before saving.' : 'AI summaries are switched off: no AI provider is approved yet. When on, they are never used for Confidential or Restricted documents.'}</div></div>`,
      submit: function (f, form) {
        if (!f.summary) return Q.fieldError(form, 'summary', 'A change summary is required for every version.');
        var c = fromText(f.content); if (!c.length) return Q.fieldError(form, 'content', 'The document can’t be empty.');
        Q.wf.doc.checkIn(d, c, f.summary); Q.drawer.close(); Q.toast('Checked in v' + Q.curVer(d).v); Q.refresh();
      }
    });
  };
  Q.act['doc-submit'] = function (el) {
    var d = D(el), v = Q.curVer(d);
    if (d.checkedOut) { Q.toast('Check the document in before you submit it.', 'warn'); return; }
    if (!d.approvers.length) { Q.toast('Add at least one approver first.', 'warn'); }
    var users = Q.activeUsers().filter(function (u) { return u.id !== d.author && u.roles.indexOf('auditor') < 0; });
    var approverUsers = users.filter(function (u) { return u.roles.indexOf('approver') >= 0 || u.roles.indexOf('qm') >= 0; });
    Q.drawer.open({
      kicker: d.id + ' v' + v.v, title: 'Submit for review', submitLabel: 'Submit for review',
      body: h`<div class="statement mb-16"><div class="small muted">Change summary</div><div>${v.summary}</div></div>
        <fieldset class="mb-16"><legend>Reviewers (review in parallel)</legend>${users.filter(function (u) { return u.roles.indexOf('reviewer') >= 0 || u.roles.indexOf('author') >= 0; }).map(function (u) { return h`<label class="check"><input type="checkbox" data-multi name="reviewers" value="${u.id}" ${d.reviewers.some(function (r) { return r.u === u.id; }) ? 'checked' : ''}> ${u.name} <span class="muted small">· ${u.title}</span></label>`; })}</fieldset>
        <div class="form-grid mb-16"><div class="field"><label for="a1">QA approver</label><select class="select" id="a1" name="a1">${approverUsers.map(function (u) { return h`<option value="${u.id}" ${d.approvers[0] && d.approvers[0].u === u.id ? 'selected' : ''}>${u.name}</option>`; })}</select></div>
          <div class="field"><label for="a2">Second QA approver (optional)</label><select class="select" id="a2" name="a2"><option value="">None</option>${approverUsers.map(function (u) { return h`<option value="${u.id}" ${d.approvers[1] && d.approvers[1].u === u.id ? 'selected' : ''}>${u.name}</option>`; })}</select></div>
          <div class="field"><label for="rd">Review due</label><input class="input" type="date" id="rd" name="reviewDue" value="${Q.dayIso(5).slice(0, 10)}"></div></div>
        <div class="callout"><strong>What happens next</strong><p class="small" style="margin:4px 0 0">Reviewers comment and mark the document reviewed here. When review closes, the owner checks the PDF and sends one DocuSign envelope: you sign first as author, then the reviewers, then the QA approver. The document becomes effective when the envelope completes.</p></div>`,
      submit: function (f, form) {
        if (f.a2 && f.a2 === f.a1) return Q.fieldError(form, 'a2', 'Choose two different approvers.');
        if ((f.reviewers || []).indexOf(f.a1) >= 0 || (f.a2 && (f.reviewers || []).indexOf(f.a2) >= 0)) return Q.toast('A QA approver can’t also be a reviewer.', 'warn');
        d.reviewers = (f.reviewers || []).map(function (u) { return { u: u, status: 'Not started' }; });
        d.approvers = [f.a1].concat(f.a2 ? [f.a2] : []).map(function (u) { return { u: u, status: 'Waiting' }; });
        d.route = 'sequential';
        d.reviewDue = f.reviewDue ? new Date(f.reviewDue + 'T17:00:00').toISOString() : Q.dayIso(5);
        Q.wf.doc.submitForReview(d); Q.drawer.close(); Q.toast(d.reviewers.length ? 'Submitted. ' + Q.plural(d.reviewers.length, 'reviewer') + ' notified.' : 'Submitted. Review closed: verify the PDF and send it to DocuSign.'); Q.refresh();
      }
    });
  };
  Q.act['doc-review'] = function (el) {
    var d = D(el);
    Q.drawer.open({
      kicker: d.id + ' v' + Q.curVer(d).v, title: 'Finish your review', submitLabel: 'Mark reviewed',
      body: h`<p>Mark the document reviewed, or send it back to draft with a reason instead.</p><div class="field"><label for="rc">Comment (optional)</label><textarea class="textarea" id="rc" name="comment" placeholder="Anything the author should know"></textarea></div>
        <p class="small muted mt-16">When you are the last reviewer, the review closes and the approvers are notified automatically.</p>`,
      foot: h`<button class="btn btn-primary" type="submit">Mark reviewed</button><button class="btn" type="button" data-act="doc-sendback" data-id="${d.id}">Send back to draft</button><button class="btn" type="button" data-act="drawer-close">Cancel</button>`,
      submit: function (f) { Q.wf.doc.review(d, f.comment); Q.drawer.close(); Q.toast(d.state === 'In approval' ? 'Review closed. Approvers notified.' : 'Marked reviewed'); Q.refresh(); }
    });
  };
  Q.act['doc-sendback'] = function (el) {
    var d = D(el);
    Q.drawer.open({
      kicker: d.id, title: 'Send back to draft', submitLabel: 'Send back',
      body: h`<div class="field"><label for="sb">Reason (required)</label><textarea class="textarea" id="sb" name="reason" placeholder="What needs to change before this can go ahead?"></textarea><div class="help">The author and everyone already in the chain are told, with this reason.</div></div>`,
      submit: function (f, form) { if (!f.reason) return Q.fieldError(form, 'reason', 'Give a reason so the author knows what to fix.'); Q.wf.doc.sendBack(d, f.reason); Q.drawer.close(); Q.toast('Sent back to draft'); if (Q.current.section === 'task') Q.go('#/today'); else Q.refresh(); }
    });
  };
  Q.act['doc-newver'] = function (el) {
    var d = D(el), v = Q.curVer(d);
    Q.drawer.open({
      kicker: d.id + ' · v' + v.v + ' effective', title: 'Start a new version', submitLabel: 'Start draft',
      body: h`<fieldset class="mb-16"><legend>Kind of change</legend><div class="radio-cards">
          <label class="radio-card"><input type="radio" name="kind" value="major" checked><span><b>Major</b><br><span class="small muted">Changes what people must do. Everyone in the training audience is allocated the new version.</span></span></label>
          <label class="radio-card"><input type="radio" name="kind" value="minor"><span><b>Minor</b><br><span class="small muted">Wording, layout or corrections only. Still approved through DocuSign; the audience is allocated the new version.</span></span></label></div></fieldset>
        <div class="field"><label for="ns">Why are you changing it? (required)</label><textarea class="textarea" id="ns" name="summary"></textarea></div>
        <p class="small muted mt-16">v${v.v} stays Effective until the new version is approved.</p>`,
      submit: function (f, form) { if (!f.summary) return Q.fieldError(form, 'summary', 'Say why the document is changing.'); var nv = Q.wf.doc.newVersion(d, f.kind, f.summary); Q.drawer.close(); Q.toast('Draft v' + nv.v + ' started and checked out to you'); Q.refresh(); }
    });
  };
  Q.act['doc-obsolete'] = function (el) {
    var d = D(el), v = Q.effVer(d) || Q.curVer(d);
    Q.sign({ items: [{ id: d.id, version: v.v, hash: v.hash }], meaning: 'Approved', meanings: ['Approved'], title: 'Make ' + d.id + ' obsolete',
      extra: function () { return h`<div class="callout warn mb-16"><strong>This can’t be undone from the app.</strong><p class="small" style="margin:4px 0 0">The document is archived, not deleted. Training rules stop assigning it.</p></div><div class="field mb-16"><label for="or">Reason (required)</label><textarea class="textarea" id="or" name="reason"></textarea></div>`; },
      validate: function (f) { return f.reason ? null : { field: 'reason', msg: 'Give a reason.' }; },
      onSigned: function (s, f) { Q.wf.doc.obsolete(d, f.reason); Q.toast(d.id + ' is obsolete'); } });
  };
  function docHtml(d, v, bare) { // bare: the PDF that goes into the DocuSign envelope
    var me = Q.me(); var wm = bare ? null : WATERMARK[v.state];
    var body = '<h1>' + Q.esc(d.id + ' ' + d.title) + '</h1><p><b>Version ' + v.v + '</b> · ' + Q.esc(v.state) + ' · ' + Q.esc(d.classification.toUpperCase()) + ' · Owner: ' + Q.esc(Q.fullName(d.owner)) + '</p>' + (wm ? '<div class="wm">' + wm + '</div>' : '') +
      v.content.map(function (b) { return b.t === 'h' ? '<h2>' + Q.esc(b.x) + '</h2>' : '<p>' + Q.esc(b.x) + '</p>'; }).join('');
    if (v.signatures.length && !bare) body += '<h2 style="page-break-before:always">Signature manifest</h2>' + (v.envelope ? '<p>Approved through DocuSign · envelope <span class="mono">' + v.envelope + '</span></p>' : v.migrated ? '<p>Approved in KSTARRS before go-live (migrated record).</p>' : '') + '<table><tr><th>Signer</th><th>Meaning</th><th>Signed (UTC)</th><th>Signature</th></tr>' + v.signatures.map(function (s) { return '<tr><td>' + Q.esc(Q.fullName(s.user)) + '</td><td>' + Q.esc(s.meaning) + '</td><td>' + Q.fmtUtc(s.at) + '</td><td>' + (s.source ? s.source + ' · ' : '') + s.id + '</td></tr>'; }).join('') + '</table><p>' + Q.esc(v.signatures[0].statement || Q.statementFor('Approved')) + '</p><p>Content SHA-256: <span class="mono">' + v.hash + '</span></p>';
    body += bare ? '<div class="foot">' + Q.esc(d.id) + ' · version ' + Q.esc(v.v) + ' · Page 1 of 1</div>' : '<div class="foot">Downloaded by ' + Q.esc(me.name) + ' on ' + Q.fmtDate(new Date()) + ' (' + Q.fmtUtc(new Date().toISOString()) + '). Uncontrolled when printed.</div>';
    return body;
  }
  Q.docHtml = docHtml;
  Q.act['doc-download'] = function (el) {
    var d = D(el); var v = d.versions.find(function (x) { return x.v === el.getAttribute('data-v'); }) || Q.curVer(d);
    if (!Q.canDownload(d)) {
      Q.audit('read', 'Document', d.id, 'Download attempt blocked: ' + d.id + ' is ' + d.classification + ' and ' + Q.fullName(Q.S.session.userId) + ' lacks clearance');
      Q.save(); Q.toast('Download blocked: ' + d.id + ' is ' + d.classification + '. The attempt was logged.', 'warn'); Q.renderShell(); return;
    }
    Q.printHtml(d.id + ' v' + v.v, docHtml(d, v), d.id + ' v' + v.v + ' PDF (watermarked for ' + Q.fullName(Q.S.session.userId) + ')');
  };
  Q.act['doc-newtab'] = function (el) {
    var d = D(el); var v = d.versions.find(function (x) { return x.v === el.getAttribute('data-v'); }) || Q.curVer(d);
    if (!Q.canDownload(d)) { Q.toast(d.classification + ' documents open only inside the app viewer.', 'warn'); return; }
    Q.printHtml(d.id + ' v' + v.v, docHtml(d, v), 'Viewer copy of ' + d.id);
  };

  // ---------- Create ----------
  Q.act['new-doc'] = function () {
    if (!Q.can('doc.create')) { Q.toast('Your role can’t create documents.', 'warn'); return; }
    var st = { source: 'template', type: 'Procedure' };
    var users = Q.activeUsers().filter(function (u) { return u.roles.indexOf('auditor') < 0; });
    function nextNo() { var p = Q.DOC_TYPES.find(function (t) { return t.type === st.type; }).prefix; return p + '-' + String((Q.S.counters[p] || 0) + 1).padStart(3, '0'); }
    function body() {
      var tpls = Q.S.templates.filter(function (t) { return t.kind === 'Document' && t.state === 'Effective'; });
      return h`<fieldset class="mb-16"><legend>Start from</legend><div class="radio-cards">
          <label class="radio-card"><input type="radio" name="source" value="template" data-change="nd-src" ${st.source === 'template' ? 'checked' : ''}><span><b>An approved template</b><br><span class="small muted">Sections are filled in for you.</span></span></label>
          <label class="radio-card"><input type="radio" name="source" value="blank" data-change="nd-src" ${st.source === 'blank' ? 'checked' : ''}><span><b>A blank page</b></span></label>
          <label class="radio-card"><input type="radio" name="source" value="upload" data-change="nd-src" ${st.source === 'upload' ? 'checked' : ''}><span><b>Upload DOCX, PDF or XLSX</b><br><span class="small muted">Scanned for malware, then converted to PDF on our server.</span></span></label></div></fieldset>
        <div class="form-grid">
          <div class="field"><label for="nt">Document type</label><select class="select" id="nt" name="type" data-change="nd-type">${Q.DOC_TYPES.map(function (t) { return h`<option ${t.type === st.type ? 'selected' : ''}>${t.type}</option>`; })}</select><div class="help">Will be numbered <b id="nd-no">${nextNo()}</b></div></div>
          <div class="field"><label for="ncl">Classification</label><select class="select" id="ncl" name="classification">${Q.CLASSES.map(function (c) { return h`<option ${c === 'Internal' ? 'selected' : ''}>${c}</option>`; })}</select></div>
          <div class="field full"><label for="ntt">Title</label><input class="input" id="ntt" name="title" placeholder="e.g. Clear Desk and Screen Procedure"></div>
          ${st.source === 'template' ? h`<div class="field full"><label for="ntp">Template</label><select class="select" id="ntp" name="template">${tpls.map(function (t) { return h`<option value="${t.id}" ${t.docType === st.type ? 'selected' : ''}>${t.id} ${t.name} v${t.version}</option>`; })}</select></div>` : ''}
          ${st.source === 'upload' ? h`<div class="field full"><label for="nf">File</label><input class="input" type="file" id="nf" name="file" accept=".docx,.pdf,.xlsx"></div>` : ''}
          <div class="field"><label for="no">Owner</label><select class="select" id="no" name="owner">${users.map(function (u) { return h`<option value="${u.id}" ${u.id === Q.S.session.userId ? 'selected' : ''}>${u.name}</option>`; })}</select></div>
          <div class="field"><label for="np">Quality process</label><select class="select" id="np" name="process">${Q.PROCESSES.map(function (p) { return h`<option>${p}</option>`; })}</select></div>
          <div class="field"><label for="nm">Periodic review</label><select class="select" id="nm" name="months"><option value="12">Every 12 months</option><option value="6">Every 6 months</option><option value="24">Every 24 months</option></select></div>
          <div class="field full"><label for="ntg">Tags</label><input class="input" id="ntg" name="tags" placeholder="e.g. A.7.7, Clause 7.5"><div class="help">Separate with commas.</div></div>
        </div>
        <div class="label mt-24 mb-8">Who must train on it (read and understood)</div>${Q.audienceFields({ groups: [], roles: [], users: [], days: 14, quiz: false })}`;
    }
    Q.on['nd-src'] = function (el) { st.source = el.value; Q.drawer.paint(); };
    Q.on['nd-type'] = function (el) { st.type = el.value; var n = document.getElementById('nd-no'); if (n) n.textContent = nextNo(); };
    Q.drawer.open({
      kicker: 'Document Control', title: 'New document', submitLabel: 'Create draft', body: body,
      submit: function (f, form) {
        if (!f.title) return Q.fieldError(form, 'title', 'Give the document a title.');
        if (st.source === 'upload' && !(f.file && f.file.length)) return Q.fieldError(form, 'file', 'Choose a DOCX, PDF or XLSX file.');
        var prefix = Q.DOC_TYPES.find(function (t) { return t.type === f.type; }).prefix;
        var content = null;
        if (st.source === 'upload') content = [{ t: 'h', x: 'Imported from ' + f.file[0].name }, { t: 'p', x: '[Converted to PDF on our server after a clean malware scan. Text extraction appears here in production.]' }];
        var d = Q.wf.doc.create({ prefix: prefix, docType: f.type, title: f.title, classification: f.classification, owner: f.owner, process: f.process, template: st.source === 'template' ? f.template : null, sourceFile: st.source === 'upload' ? f.file[0].name : null, audience: Q.audienceFrom(f), months: f.months, tags: f.tags ? f.tags.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [], content: content });
        Q.drawer.close(); Q.toast(d.id + ' created and checked out to you'); Q.go('#/documents/' + d.id);
      }
    });
  };
})(window.Q);
