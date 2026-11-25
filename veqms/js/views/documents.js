/* Document Control: register, record page (viewer, compare, comments, history, training), create, lifecycle. */
(function (Q) {
  'use strict';
  var h = Q.h;
  var DOC_STATES = Q.DOC_STATES; // Draft → In review → In approval → Signing → Effective (engine.js)
  // User access reviews and risk assessments are signed like vendor approvals: one Adobe Sign agreement per version.
  Q.DOC_TYPES = [
    { type: 'Policy', prefix: 'POL' }, { type: 'Procedure', prefix: 'SOP' }, { type: 'Work instruction', prefix: 'WI' }, { type: 'Form', prefix: 'FRM' },
    { type: 'Register', prefix: 'REG' }, { type: 'Plan', prefix: 'PLN' }, { type: 'Specification', prefix: 'SPEC' }, { type: 'Statement of Applicability', prefix: 'SOA' },
    { type: 'Vendor approval', prefix: 'VEN' }, { type: 'Validation plan', prefix: 'VP' }, { type: 'Validation report', prefix: 'VR' },
    { type: 'User access review', prefix: 'UAR' }, { type: 'Risk assessment', prefix: 'RA' }
  ];
  Q.PROCESSES = ['ISMS · Governance', 'ISMS · Access control', 'ISMS · Continuity', 'ISMS · Risk', 'ISMS · People', 'ISMS · Supplier management', 'ISMS · Vulnerability mgmt', 'ISMS · Incident management', 'ISMS · Asset management', 'ISMS · Physical security', 'ISMS · Information handling', 'ISMS · Endpoint', 'ISMS · Awareness', 'ISMS · Cryptography'];
  var WATERMARK = { 'Draft': 'DRAFT', 'In review': 'FOR REVIEW', 'In approval': 'FOR APPROVAL', 'Signing': 'FOR SIGNATURE', 'Superseded': 'SUPERSEDED', 'Obsolete': 'OBSOLETE' };

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
    var states = DOC_STATES.concat(['Obsolete']);
    return h`
      <div class="page-head"><div><h1>Documents</h1><div class="sub">Controlled documents register · ${Q.plural(rows.length, 'document')}${hidden ? ' · ' + hidden + ' hidden by classification' : ''}</div></div>
        <div class="btn-row"><button class="btn" data-act="docs-export">${Q.icon('download', 'ico-sm')} Export CSV</button>${Q.can('doc.create') ? h`<button class="btn btn-primary" data-act="new-doc">${Q.icon('plus', 'ico-sm')} New document</button>` : ''}</div></div>
      ${Q.tip('documents', h`<b>Document Control.</b> Every amendment starts as a change request. The author edits the Word file in SharePoint, then the document moves Draft → In review → In approval (QA approvers approve here) → Signing (one Adobe Sign agreement) → Effective, and is published to the controlled SharePoint library. Open one to read it, compare versions, comment, or check its approval.`)}
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
          { key: 'title', label: 'Title', render: function (r) { return h`<a href="#/documents/${r.id}">${r.title}</a>`; } },
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
    var v = Q.curVer(d), eff = Q.effVer(d);
    var verSel = q.v ? d.versions.find(function (x) { return x.v === q.v; }) || v : v;
    var tab = q.tab || 'document';
    var env = Q.esign.active(d.id, 'doc-approval');
    var approved = d.approvers.filter(function (a) { return a.status === 'Approved' || a.status === 'Signed'; }).length;
    var labels = { 'In approval': d.state === 'In approval' ? 'In approval · ' + approved + ' of ' + d.approvers.length + ' approved' : 'In approval', 'Signing': env ? 'Adobe Sign · ' + Q.esign.signedCount(env) + ' of ' + env.signers.length + ' signed' : 'Signing' };
    var cr = v.cr && Q.S.crs[v.cr];
    var mineToApprove = d.state === 'In approval' && d.approvers.some(function (a) { return a.u === me && a.status === 'To approve'; });
    var reviewer = d.reviewers.find(function (r) { return r.u === me; });

    // Actions in the header (one primary)
    var acts = [];
    var ro = Q.readOnly();
    if (!ro) {
      if (d.state === 'Draft' && (d.author === me || d.owner === me)) {
        acts.push(h`<button class="btn" data-act="doc-edit" data-id="${d.id}">${Q.icon('edit', 'ico-sm')} Open in Word</button>`);
        acts.push(h`<button class="btn btn-primary" data-act="doc-submit" data-id="${d.id}">Submit for review</button>`);
      }
      if (Q.wf.doc.canReturn(d)) acts.push(h`<button class="btn" data-act="doc-sendback" data-id="${d.id}">Return to the author</button>`);
      if (d.state === 'In review' && reviewer && reviewer.status === 'Pending') acts.push(h`<button class="btn btn-primary" data-act="doc-review" data-id="${d.id}">Mark reviewed</button>`);
      if (mineToApprove) acts.push(h`<button class="btn btn-primary" data-act="doc-approve" data-id="${d.id}">Approve</button>`);
      if (d.state === 'Signing' && env && Q.esign.myTurn(env)) acts.push(h`<button class="btn btn-primary" data-act="es-open-sign" data-id="${env.id}">${Q.icon('sign', 'ico-sm')} Sign in Adobe Sign</button>`);
      if (d.state === 'Signing' && env && Q.esign.canCancel(env)) acts.push(h`<button class="btn" data-act="es-cancel" data-id="${env.id}">Cancel agreement</button>`);
      var obs = Q.esign.active(d.id, 'doc-obsolete');
      if (obs && Q.esign.myTurn(obs)) acts.push(h`<button class="btn btn-primary" data-act="es-open-sign" data-id="${obs.id}">${Q.icon('sign', 'ico-sm')} Sign in Adobe Sign</button>`);
      if ((d.state === 'Effective') && (d.owner === me || d.author === me || Q.hasRole('qm'))) acts.push(h`<button class="btn" data-act="doc-newver" data-id="${d.id}">New version</button>`);
      if (d.state === 'Effective' && Q.hasRole('qm') && !obs) acts.push(h`<button class="btn btn-danger" data-act="doc-obsolete" data-id="${d.id}">Make obsolete</button>`);
    }
    acts.push(h`<button class="btn" data-act="doc-download" data-id="${d.id}" data-v="${verSel.v}">${Q.icon('download', 'ico-sm')} PDF</button>`);

    var tabs = [['document', 'Document'], ['compare', 'Compare versions'], ['comments', 'Comments · ' + d.comments.length], ['history', 'Version history'], ['approval', 'Approval · Adobe Sign'], ['training', 'Training']];
    var content;
    if (tab === 'compare') content = compareTab(d, q);
    else if (tab === 'comments') content = commentsTab(d, q);
    else if (tab === 'history') content = historyTab(d);
    else if (tab === 'training') content = trainingTab(d, q);
    else if (tab === 'approval') content = approvalTab(d);
    else content = viewer(d, verSel, q);

    var effMonths = d.periodic ? 'Every ' + d.periodic.months + ' months' : 'Not scheduled';
    var nextReview = Object.keys(Q.S.reviews).map(function (k) { return Q.S.reviews[k]; }).find(function (r) { return r.doc === d.id && r.state === 'Open'; });
    var pub = eff && eff.publish;
    var pubText = !pub ? '—' : pub.status === 'published' ? (pub.deleted ? 'v' + eff.v + ': file missing (integrity alert)' : 'v' + eff.v + ' in the controlled library') : pub.status === 'pending' ? 'v' + eff.v + ': waiting to publish' : pub.status === 'failed' ? 'v' + eff.v + ': publishing failed (see Administration → SharePoint)' : '—';
    var returned = d.state === 'Draft' ? Q.S.tasks.find(function (t) { return t.record === d.id && t.kind === 'resubmit' && t.status === 'open'; }) : null;

    return h`
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="#/documents">Documents</a><span>/</span><span>${d.id}</span></nav>
      <div class="page-head">
        <div style="min-width:0">
          <div class="record-meta"><span>${d.docType} · ${d.id}</span>${Q.cls(d.classification)}<span class="chip chip-outline">v${v.v} ${v.kind} · ${v.state}</span>${d.state === 'Obsolete' ? Q.stateChip(d.state) : ''}</div>
          <h1>${d.title}</h1>
        </div>
        <div class="btn-row">${acts}</div>
      </div>
      ${returned ? h`<div class="callout warn mb-16"><strong>Returned to the author.</strong> ${returned.note || ''}</div>` : ''}
      ${d.state === 'Draft' && v.pdf && !ro && (d.author === me || d.owner === me) ? h`<div class="callout mb-16"><strong>The PDF is made and locked.</strong> Check it and submit. Editing the Word file clears it.</div>` : ''}
      ${d.state !== 'Obsolete' ? h`<div class="card mb-16">${Q.stepper(DOC_STATES, d.state, labels, { allDone: d.state === 'Effective' })}</div>` : h`<div class="callout warn mb-16"><strong>Obsolete.</strong> ${d.obsoleteReason || ''} Archived, not deleted; it stays in the register and audit trail.</div>`}
      <div class="split">
        <div style="min-width:0">
          <div class="tabs" role="tablist">${tabs.map(function (t) { return h`<button class="tab ${tab === t[0] ? 'active' : ''}" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>
          ${content}
        </div>
        <aside class="context" aria-label="Record details">
          <div class="card ctx-card"><span class="label">Details</span><dl class="dl">
            <div><dt>Owner</dt><dd>${Q.name(d.owner)}</dd></div><div><dt>Author</dt><dd>${Q.name(d.author)}</dd></div>
            <div><dt>Quality process</dt><dd>${d.process}</dd></div>
            <div><dt>Change request</dt><dd>${cr ? h`${Q.recLink(cr.id, { short: true })} · ${cr.state}` : '—'}</dd></div>
            <div style="grid-column:1/-1"><dt>Word file (SharePoint Drafts library)</dt><dd>${d.draft ? h`<span class="small">${d.draft.name}</span><br><span class="small muted">Edited ${Q.fmtDateTime(d.draft.editedAt)} by ${Q.name(d.draft.editedBy)}</span>` : '—'}</dd></div>
            ${v.pdf ? h`<div style="grid-column:1/-1"><dt>Locked PDF of v${v.v}</dt><dd><span class="mono small" title="${v.pdf.hash}">SHA-256 ${v.pdf.hash.slice(0, 16)}…</span><br><span class="small muted">${v.verification ? 'Checked by ' + Q.fullName(v.verification.by) + ', ' + Q.fmtShort(v.verification.at) : 'Not checked yet'}</span></dd></div>` : ''}
            <div><dt>Published</dt><dd>${pubText}</dd></div>
            ${['Signing', 'Effective'].indexOf(v.state) >= 0 ? h`<div><dt>Retraining</dt><dd>${v.retrain === false ? 'Not needed: ' + (v.retrainReason || '') : 'Needed'}</dd></div>` : ''}
            <div><dt>Source template</dt><dd>${d.template ? d.template + ' ' + ((Q.S.templates.find(function (t) { return t.id === d.template; }) || {}).name || '') : d.sourceFile ? 'Upload: ' + d.sourceFile : 'Blank page'}</dd></div>
            ${d.state === 'Signing' || d.state === 'In approval' ? h`<div><dt>${d.state === 'Signing' ? 'Signing due' : 'Approval due'}</dt><dd class="${Q.daysFromToday(d.approvalDue) < 0 ? 'st-overdue' : ''}" style="font-weight:${Q.daysFromToday(d.approvalDue) < 0 ? 600 : 400}">${Q.fmtShort(d.approvalDue)}${Q.daysFromToday(d.approvalDue) < 0 ? ' · overdue' : ''}</dd></div>` : d.state === 'In review' ? h`<div><dt>Review due</dt><dd>${Q.fmtShort(d.reviewDue)}</dd></div>` : h`<div><dt>Effective date</dt><dd>${Q.fmtDate(d.effective)}</dd></div>`}
            <div><dt>Periodic review</dt><dd>${effMonths}${nextReview ? h`<br><a class="small" href="#/reviews/${nextReview.id}">Next: ${Q.fmtShort(nextReview.due)}</a>` : ''}</dd></div>
            <div><dt>Tags</dt><dd>${d.tags.join(', ') || '—'}</dd></div>
            <div><dt>Approved</dt><dd>${v.approvedAt ? Q.fmtDate(v.approvedAt) + (v.agreement ? ' · Adobe Sign' : v.migrated ? ' · KSTARRS' : '') : '—'}</dd></div>
            <div><dt>Training audience</dt><dd>${Q.audienceText(Q.audienceOf(d))}</dd></div>
          </dl></div>
          <div class="card ctx-card"><span class="label">People</span>
            ${Q.peopleRow(d.author, 'Author', d.state === 'Draft' ? 'Drafting' : 'Submitted', 'st-wait')}
            ${d.reviewers.map(function (r) { return Q.peopleRow(r.u, 'Reviewer', r.status === 'Pending' ? (r.u === me ? 'Your turn' : 'Reviewing') : r.status, r.status === 'Reviewed' ? 'st-done' : r.status === 'Pending' ? 'st-turn' : 'st-wait'); })}
            ${d.approvers.map(function (a, i) {
              var signer = env && env.signers.find(function (s) { return s.u === a.u && s.meaning === 'Approved'; });
              var st = a.status === 'To approve' ? (a.u === me ? 'Your turn to approve' : 'Approving') : a.status === 'Waiting' && ['In review'].indexOf(d.state) >= 0 ? 'Waiting · FYI sent' : a.status;
              if (a.status === 'Approved' && signer) st = signer.status === 'Sent' ? 'Approved · signing now' : 'Approved · signs later';
              if (a.retrain === false) st += ' · no retraining'; else if (a.retrain === true && a.status !== 'Signed') st += ' · retraining';
              return Q.peopleRow(a.u, d.approvers.length > 1 ? 'QA approver ' + (i + 1) : 'QA approver', st, a.status === 'Signed' ? 'st-done' : a.status === 'To approve' || (signer && signer.status === 'Sent') ? 'st-turn' : a.status === 'Approved' ? 'st-done' : 'st-wait');
            })}
            <div class="small muted mt-8">Reviewed and approved here, then signed in Adobe Sign in one agreement: author, reviewers, then QA approvers.</div>
          </div>
          ${Q.esign.recordCard(d.id)}
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
      <h2>Signature manifest</h2><div class="doc-meta"><span>${d.id} ${d.title} · v${v.v}</span><span>${v.agreement ? 'Adobe Sign agreement ' + v.agreement.slice(0, 8) + '…' : v.migrated ? 'Migrated from KSTARRS' : 'Content SHA-256 below'}</span></div>
      <p>Each row is rendered from the stored signature record, not typed. Signatures cannot be edited or detached from this version.</p>
      <table class="manifest-table"><thead><tr><th>Signer</th><th>Meaning</th><th>Signed (UTC)</th><th>Signature</th></tr></thead><tbody>
      ${sigs.map(function (s) { return h`<tr><td>${Q.fullName(s.user)}</td><td>${s.meaning}</td><td>${Q.fmtUtc(s.at)}</td><td>${s.source === 'Adobe Sign' ? 'Adobe Sign · ' + s.id : s.source === 'KSTARRS' ? 'KSTARRS · ' + s.id : s.id}</td></tr>`; })}</tbody></table>
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
        { key: 'cr', label: 'Change request', sort: false, render: function (x) { return x.cr ? Q.recLink(x.cr, { short: true }) : '—'; } },
        { key: 'approvedAt', label: 'Approved', render: function (x) { return x.approvedAt ? Q.fmtDate(x.approvedAt) : '—'; } },
        { key: 'retrain', label: 'Retraining', sort: false, render: function (x) { return ['Signing', 'Effective', 'Superseded'].indexOf(x.state) < 0 || x.migrated ? '—' : x.retrain === false ? h`<span class="small" title="${x.retrainReason || ''}">Not needed</span>` : 'Needed'; } },
        { key: 'agreement', label: 'Approval record', sort: false, render: function (x) { return x.agreement ? h`<button class="btn-link" style="padding:0;min-height:0;font-size:13px" data-act="es-agreement" data-id="${x.agreement}">Adobe Sign ${x.agreement.slice(0, 8)}…</button>` : x.migrated ? h`<span class="small muted">KSTARRS (migrated)</span>` : '—'; } },
        { key: 'hash', label: 'Locked PDF SHA-256', sort: false, render: function (x) { return x.pdf ? h`<span class="mono" title="${x.pdf.hash}">${x.pdf.hash.slice(0, 12)}…</span>` : h`<span class="small muted">Not made yet</span>`; } },
        { key: 'go', label: '', sort: false, render: function (x) { return h`<button class="btn btn-sm" data-act="tab" data-key="v" data-tab="${x.v}">View</button>`; } }
      ]
    });
  }
  function approvalTab(d) {
    var envs = Q.esign.forRecord(d.id);
    var migrated = d.versions.filter(function (v) { return v.migrated; });
    return h`${envs.length ? Q.table({ id: 'dag-' + d.id, rows: envs, defaultSort: 'sentAt', defaultDir: -1,
        cols: [{ key: 'version', label: 'Version', render: function (e) { return 'v' + e.version; } }, { key: 'purpose', label: 'Purpose' }, { key: 'sentAt', label: 'Sent', render: function (e) { return Q.fmtDateTime(e.sentAt); } }, { key: 'sentBy', label: 'Sent by', render: function (e) { return Q.fullName(e.sentBy); } },
          { key: 'status', label: 'Status', render: function (e) { return h`${Q.esign.statusChip(e)}${e.correctionOf ? h` <span class="chip chip-due">Correction</span>` : ''}`; } }, { key: 'signed', label: 'Signed', sort: false, render: function (e) { return Q.esign.signedCount(e) + ' of ' + e.signers.length; } },
          { key: 'files', label: 'Stored files', sort: false, render: function (e) { return e.signedPdf ? h`<span class="row-wrap"><button class="btn btn-sm" data-act="es-signed" data-id="${e.id}">Signed PDF</button><button class="btn btn-sm" data-act="es-audit-report" data-id="${e.id}">Audit report</button></span>` : h`<span class="small muted">${e.status === 'sent' ? 'When completed' : e.declineReason || e.cancelReason || '—'}</span>`; } },
          { key: 'id', label: '', sort: false, render: function (e) { return h`<button class="btn btn-sm" data-act="es-agreement" data-id="${e.id}">Details</button>`; } }] }) : Q.empty('No Adobe Sign agreements yet', 'The agreement goes to Adobe Sign when the last QA approver approves in VeQMS.')}
      ${migrated.length ? h`<p class="small muted mt-16">${migrated.map(function (v) { return 'v' + v.v; }).join(', ')} ${migrated.length > 1 ? 'were' : 'was'} approved in KSTARRS before go-live. Those signatures are kept as migrated records on the version history.</p>` : ''}`;
  }

  function trainingTab(d, q) {
    var aud = Q.audienceOf(d);
    var eff = Q.effVer(d);
    var all = Q.S.assignments.filter(function (a) { return a.doc === d.id; });
    var counts = Q.trainVersions(d);
    var cur = eff ? all.filter(function (a) { return counts.indexOf(a.ver) >= 0 && !a.closed && !a.noRetrain; }) : [];
    var live = cur.filter(function (a) { return ['Corrected'].indexOf(Q.trStatus(a)) < 0 && !a.leaver; });
    var done = live.filter(function (a) { return a.completed; }).length;
    var rows = (q.all ? all : cur).map(function (a) { return Object.assign({ name: Q.fullName(a.user), st: Q.trStatus(a) }, a); });
    var canEdit = !Q.readOnly() && (Q.can('training.manage') || d.owner === Q.S.session.userId);
    Q.reports['docstatus-' + d.id] = { title: 'Training status: ' + d.id + ' ' + d.title, file: 'training-status-' + d.id, rows: function () { return Q.trainingRows(all); }, intro: 'Current version: ' + (eff ? 'v' + eff.v : 'none effective') + '. Audience: ' + Q.audienceText(aud) + '.' };
    return h`<div class="grid-3 mb-16">
        <div class="card kpi"><div class="spread"><span class="kpi-label">Who must train</span>${canEdit ? h`<button class="btn-link" style="min-height:28px;font-size:13px;padding:0" data-act="doc-audience" data-id="${d.id}">Change</button>` : ''}</div><div style="font-weight:600;margin-top:6px">${Q.audienceText(aud)}</div><div class="kpi-sub">${Q.plural(Q.audienceMembers(d).length, 'person', 'people')} · ${aud.days} days to complete${aud.quiz ? ' · knowledge check' : ''}</div></div>
        <div class="card kpi"><div class="kpi-label">Complete for ${eff ? 'v' + counts.join(', v') : 'the effective version'}</div><div class="kpi-value">${Q.pct(done, live.length)}%</div><div class="progress"><div style="width:${Q.pct(done, live.length)}%"></div></div></div>
        <div class="card kpi"><div class="kpi-label">Overdue</div><div class="kpi-value">${live.filter(function (a) { return Q.trStatus(a) === 'Overdue'; }).length}</div><div class="kpi-sub">of ${live.length} on this version</div></div></div>
      <div class="spread mb-8" style="flex-wrap:wrap"><label class="check small"><input type="checkbox" data-change="doc-tr-all" ${q.all ? 'checked' : ''}> Show earlier versions, withdrawn and corrected records</label>${Q.reportButtons('docstatus-' + d.id)}</div>
      ${Q.table({ id: 'dt-' + d.id, rows: rows, defaultSort: 'name', empty: eff ? 'No training allocated for this version.' : 'Training is allocated when a version becomes effective.', href: function (a) { return '#/training?tab=records&rec=' + a.id; },
        cols: [{ key: 'name', label: 'Person', render: function (a) { return h`${a.name}${a.leaver ? h` <span class="muted small">· left</span>` : ''}`; } }, { key: 'ver', label: 'Version', render: function (a) { return 'v' + a.ver; } },
          { key: 'allocReason', label: 'Allocated', render: function (a) { return h`<span class="small">${a.allocReason} · ${a.allocatedBy === 'system' ? 'System' : Q.fullName(a.allocatedBy)}</span>`; } },
          { key: 'assigned', label: 'Assigned', render: function (a) { return Q.fmtShort(a.assigned); } }, { key: 'due', label: 'Due', render: function (a) { return a.due ? Q.fmtShort(a.due) : '—'; } },
          { key: 'completed', label: 'Completed (UTC)', render: function (a) { return a.completed ? Q.fmtUtc(a.completed) : '—'; } }, { key: 'st', label: 'Status', render: function (a) { return Q.chip(a.st); } }] })}
      <p class="small muted mt-8">Records are dated by the system and locked once completed. Earlier versions’ records are kept and shown as superseded.${counts.length > 1 ? ' The QA approvers decided v' + eff.v + ' needs no retraining, so training on v' + counts.slice(1).join(' and v') + ' still counts.' : ''}</p>`;
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
  function toText(content) { return content.map(function (b) { return b.t === 'h' ? '## ' + b.x : b.x; }).join('\n\n'); }
  function fromText(t) { return t.split(/\n\s*\n/).map(function (s) { s = s.trim(); if (!s) return null; return /^##\s/.test(s) ? { t: 'h', x: s.replace(/^##\s*/, '') } : { t: 'p', x: s.replace(/\n/g, ' ') }; }).filter(Boolean); }
  // "Open in Word": authors edit the Word file in the SharePoint Drafts library. In the prototype this editor stands in
  // for Word; saving updates the file's last-edited time and clears a PDF made from the old text.
  Q.act['doc-edit'] = function (el) {
    var d = D(el), v = Q.curVer(d);
    var aiOn = Q.S.settings.ai.enabled && ['Confidential', 'Restricted'].indexOf(d.classification) < 0;
    Q.drawer.open({
      wide: true, kicker: 'Open in Word · stand-in editor (prototype)', title: (d.draft ? d.draft.name : d.id + ' v' + v.v), submitLabel: 'Save the Word file',
      body: h`<div class="callout mb-16"><strong>This editor stands in for Word.</strong><p class="small" style="margin:4px 0 0">In VeQMS the author edits ${d.id}’s Word file in the SharePoint Drafts library, as today. The prototype can’t open Word, so this editor plays that part. Saving updates the file’s last-edited time.${v.pdf ? ' The PDF you already made no longer matches once you save, so it is cleared and you make it again at submit.' : ''}</p></div>
        <div class="field mb-16"><label for="dc">Content of v${v.v}</label><textarea class="textarea" id="dc" name="content" style="min-height:340px;font-family:var(--font-mono);font-size:13px">${toText(v.content)}</textarea><div class="help">Start a line with <span class="mono">## </span> for a heading. Leave a blank line between paragraphs. In Word, keep the version (v${v.v}) on the cover and in the footer up to date.</div></div>
        <div class="field"><div class="spread"><label for="cs">Change summary (required)</label><button type="button" class="btn btn-sm" ${aiOn ? '' : 'disabled'} title="${aiOn ? 'Suggest text from the diff' : 'Off until an AI provider is approved under the AI usage policy'}">Draft summary with AI</button></div>
          <textarea class="textarea" id="cs" name="summary" placeholder="What changed and why, in plain words">${v.summary === 'Working draft.' || v.summary === 'First draft.' ? '' : v.summary}</textarea>
          <div class="help">${aiOn ? 'You must review and edit any suggestion before saving.' : 'AI summaries are switched off: no AI provider is approved yet. When on, they are never used for Confidential or Restricted documents.'}</div></div>`,
      submit: function (f, form) {
        if (!f.summary) return Q.fieldError(form, 'summary', 'A change summary is required for every version.');
        var c = fromText(f.content); if (!c.length) return Q.fieldError(form, 'content', 'The document can’t be empty.');
        var had = !!v.pdf;
        try { Q.wf.doc.saveDraft(d, c, f.summary); } catch (e) { Q.toast(e.message, 'warn'); return; }
        Q.drawer.close(); Q.toast('Saved the Word file' + (had ? ' · the locked PDF was cleared; make it again at submit' : '')); Q.refresh();
      }
    });
  };
  // The locked PDF: the converted draft plus a signature page with one Adobe Sign field per signer.
  function lockedHtml(d, v) {
    var signers = (v.pdf && v.pdf.signers) || [];
    return Q.docHtml(d, v, true) + (signers.length ? '<h2 style="page-break-before:always">Signature page</h2><p>One Adobe Sign signature field per signer, in signing order.</p><table><tr><th>Order</th><th>Signer</th><th>Role</th><th>Reason for signing</th><th>Signature</th></tr>' +
      signers.map(function (s) { return '<tr><td>' + s.order + '</td><td>' + Q.esc(Q.fullName(s.u)) + '</td><td>' + Q.esc(s.role) + '</td><td>' + Q.esc(s.meaning) + '</td><td>[Adobe Sign field]</td></tr>'; }).join('') + '</table>' : '') +
      '<div class="foot">' + Q.esc(v.pdf ? v.pdf.name : d.id) + ' · locked ' + Q.fmtUtc(v.pdf ? v.pdf.madeAt : v.created) + ' · SHA-256 <span class="mono">' + (v.pdf ? v.pdf.hash : v.hash) + '</span></div>';
  }
  Q.act['doc-pdf-locked'] = function (el) {
    var d = D(el), v = Q.curVer(d);
    if (!v.pdf) { Q.toast('Make the PDF first.', 'warn'); return; }
    Q.logPdfOpen(d, v, 'locked PDF');
    Q.printHtml(v.pdf.name, lockedHtml(d, v), 'Locked PDF of ' + d.id + ' v' + v.v);
  };
  // Submit in two steps. (1) Choose reviewers and QA approvers, then make the PDF: the draft is converted, hashed and
  // locked; segregation-of-duties problems are refused here and logged. (2) Open the locked PDF, make the four checks,
  // submit. What is checked is what is reviewed, approved and signed.
  Q.act['doc-submit'] = function (el) {
    var d = D(el), v = Q.curVer(d);
    var users = Q.activeUsers().filter(function (u) { return u.id !== d.author && u.roles.indexOf('auditor') < 0; });
    var revUsers = users.filter(function (u) { return ['reviewer', 'author', 'approver', 'qm'].some(function (r) { return u.roles.indexOf(r) >= 0; }); });
    var apUsers = users.filter(function (u) { return u.roles.indexOf('approver') >= 0 || u.roles.indexOf('qm') >= 0; });
    var s = { reviewers: d.reviewers.map(function (r) { return r.u; }), a1: (d.approvers[0] || {}).u || '', a2: (d.approvers[1] || {}).u || '', error: null, shown: null };
    function picked(f) { return { reviewers: (f.reviewers || []).slice(), approvers: [f.a1].concat(f.a2 ? [f.a2] : []).filter(Boolean) }; }
    function body() {
      var cr = v.cr && Q.S.crs[v.cr];
      var plan = v.pdf ? Q.esign.plan(d.id, { stage: 'doc-approval' }) : null;
      var labels = Q.esign.labels(d.id, 'doc-approval');
      s.shown = v.pdf ? v.pdf.hash : null;
      return h`<div class="statement mb-16"><div class="small muted">Change summary${cr ? ' · ' + cr.id : ''}</div><div>${v.summary}</div></div>
        <div class="label mb-8">Step 1 · Choose the people and make the PDF</div>
        <fieldset class="mb-16"><legend>Reviewers (review in parallel; they sign after you)</legend>${revUsers.map(function (u) { return h`<label class="check"><input type="checkbox" data-multi name="reviewers" value="${u.id}" ${s.reviewers.indexOf(u.id) >= 0 ? 'checked' : ''}> ${u.name} <span class="muted small">· ${u.title}</span></label>`; })}</fieldset>
        <div class="form-grid mb-16"><div class="field"><label for="a1">QA approver</label><select class="select" id="a1" name="a1"><option value="">Choose…</option>${apUsers.map(function (u) { return h`<option value="${u.id}" ${s.a1 === u.id ? 'selected' : ''}>${u.name}</option>`; })}</select></div>
          <div class="field"><label for="a2">Second QA approver (optional)</label><select class="select" id="a2" name="a2"><option value="">None</option>${apUsers.map(function (u) { return h`<option value="${u.id}" ${s.a2 === u.id ? 'selected' : ''}>${u.name}</option>`; })}</select></div></div>
        <p class="small muted">The draft is converted to PDF with a signature field for each signer, hashed (SHA-256) and locked. Editing the draft afterwards clears it, and the PDF is made again.</p>
        <button type="button" class="btn ${v.pdf ? '' : 'btn-primary'}" data-act="ds-make" data-id="${d.id}">${v.pdf ? 'Make the PDF again' : 'Make the PDF'}</button>
        ${s.error ? h`<div class="callout warn mt-16" role="alert" id="ds-error" tabindex="-1"><strong>Not done.</strong> ${s.error}</div>` : ''}
        ${v.pdf ? h`<hr><div class="label mb-8">Step 2 · Check the locked PDF</div>
          <div class="statement mb-16"><div class="small muted">Locked PDF · ${v.pdf.name} · SHA-256 <span class="mono">${v.pdf.hash.slice(0, 16)}…</span> · made ${Q.fmtDateTime(v.pdf.madeAt)}</div>
            <div class="row-wrap mt-8"><button type="button" class="btn btn-sm" data-act="doc-pdf-locked" data-id="${d.id}">Open the PDF to check it</button></div></div>
          <div class="label mb-8">Signing order in Adobe Sign (after approval)</div>
          <div class="list-rows mb-16">${plan.signers.map(function (x) { return h`<div class="list-row"><span class="chip chip-outline">${x.order}</span><div class="lr-main"><b>${Q.fullName(x.u)}</b> · ${x.role}<div class="small muted">Reason for signing: ${x.meaning}</div></div></div>`; })}</div>
          ${plan.problems.length ? h`<div class="callout warn mb-16"><strong>Fix before submitting</strong>${plan.problems.map(function (x) { return h`<p class="small" style="margin:4px 0 0">${x}</p>`; })}</div>` : ''}
          <fieldset class="mb-16"><legend>Checks (all four required)</legend>${['footer', 'version', 'docId', 'dates'].map(function (k) { return h`<label class="check"><input type="checkbox" name="${k}"> ${labels[k]}</label>`; })}</fieldset>
          <div class="field mb-16"><label for="dsn">Note for the record (optional)</label><input class="input" id="dsn" name="note" placeholder="e.g. Checked against the Word file"></div>
          <div class="callout"><strong>What happens next</strong><p class="small" style="margin:4px 0 0">Reviewers mark it reviewed, then the QA approvers approve it here and decide whether people need retraining. Anyone on it can return it to you with a reason. When the last QA approver approves, this PDF goes to Adobe Sign in one agreement: you sign first as author, then the reviewers, then the QA approvers. It becomes effective when the agreement completes.</p></div>` : ''}`;
    }
    function fail(msg) { s.error = msg; Q.drawer.paint(); var e = document.getElementById('ds-error'); if (e) e.focus(); }
    Q.act['ds-make'] = function (btn) {
      var f = Q.formData(btn.closest('form')), c = picked(f);
      s.reviewers = c.reviewers; s.a1 = f.a1 || ''; s.a2 = f.a2 || '';
      try { Q.wf.doc.makePdf(d, c.reviewers, c.approvers); } catch (e) { fail(e.message); return; }
      s.error = null; Q.drawer.paint(); Q.toast('PDF made and locked · SHA-256 ' + v.pdf.hash.slice(0, 12) + '…');
    };
    Q.drawer.open({
      wide: true, kicker: d.id + ' v' + v.v, title: 'Submit for review', body: body,
      foot: function () { return h`<button class="btn btn-primary" type="submit" ${v.pdf ? '' : 'disabled'}>Submit for review</button><button class="btn" type="button" data-act="drawer-close">Cancel</button>`; },
      submit: function (f) {
        if (!v.pdf) return fail('Make the PDF first.');
        var c = picked(f);
        if (c.reviewers.slice().sort().join() !== d.reviewers.map(function (r) { return r.u; }).sort().join() || c.approvers.join() !== d.approvers.map(function (a) { return a.u; }).join()) return fail('You changed the people after making the PDF. Make the PDF again, so it has a signature field for each signer.');
        if (!(f.footer && f.version && f.docId && f.dates)) return fail('Open the PDF and tick all four checks before submitting.');
        try { Q.wf.doc.submit(d, { footer: true, version: true, docId: true, dates: true, note: f.note || '' }, s.shown); } catch (e) { return fail(e.message); }
        Q.drawer.close(); Q.toast(d.reviewers.length ? 'Submitted. ' + Q.plural(d.reviewers.length, 'reviewer') + ' notified.' : 'Submitted. No reviewers, so the QA approvers were asked to approve.'); Q.refresh();
      }
    });
  };
  Q.act['doc-review'] = function (el) {
    var d = D(el);
    Q.drawer.open({
      kicker: d.id + ' v' + Q.curVer(d).v, title: 'Finish your review', submitLabel: 'Mark reviewed',
      body: h`<p>Mark the document reviewed, or return it to the author with a reason instead.</p><div class="row-wrap mb-16"><button type="button" class="btn btn-sm" data-act="doc-pdf-locked" data-id="${d.id}">Open the locked PDF</button></div><div class="field"><label for="rc">Comment (optional)</label><textarea class="textarea" id="rc" name="comment" placeholder="Anything the author should know"></textarea></div>
        <p class="small muted mt-16">When you are the last reviewer, the QA approvers are asked to approve it.</p>`,
      foot: h`<button class="btn btn-primary" type="submit">Mark reviewed</button><button class="btn" type="button" data-act="doc-sendback" data-id="${d.id}">Return to the author</button><button class="btn" type="button" data-act="drawer-close">Cancel</button>`,
      submit: function (f) { try { Q.wf.doc.review(d, f.comment); } catch (e) { Q.toast(e.message, 'warn'); return; } Q.drawer.close(); Q.toast(d.state === 'In approval' ? 'Review complete. QA approvers asked to approve.' : 'Marked reviewed'); Q.refresh(); }
    });
  };
  // A QA approver approves in VeQMS and decides whether the change needs retraining. The last approval sends the
  // agreement to Adobe Sign at once.
  Q.act['doc-approve'] = function (el) {
    var d = D(el), v = Q.curVer(d), cr = v.cr && Q.S.crs[v.cr];
    var last = d.approvers.filter(function (a) { return a.status !== 'Approved'; }).length === 1;
    var prev = d.versions[d.versions.indexOf(v) - 1];
    Q.drawer.open({
      wide: true, kicker: d.id + ' v' + v.v + ' · approval in VeQMS', title: 'Approve ' + d.id + ' v' + v.v, submitLabel: 'Approve',
      body: h`<div class="statement mb-16"><div class="small muted">Change summary${cr ? ' · ' + cr.id : ''}</div><div>${v.summary}</div>
          <div class="row-wrap mt-8"><button type="button" class="btn btn-sm" data-act="doc-pdf-locked" data-id="${d.id}">Open the locked PDF</button><span class="small muted mono">SHA-256 ${v.pdf ? v.pdf.hash.slice(0, 16) + '…' : '—'}</span></div></div>
        <fieldset class="mb-16"><legend>Does this change need retraining?</legend>
          <label class="check"><input type="radio" name="retrain" value="yes" checked> Yes: everyone in the audience reads and confirms the new version</label>
          <label class="check"><input type="radio" name="retrain" value="no"> No: existing training on ${prev ? 'v' + prev.v : 'the previous version'} still counts</label></fieldset>
        <div class="field mb-16"><label for="dar">If no, why not? (required for no)</label><textarea class="textarea" id="dar" name="reason" placeholder="For example: corrects a typing error; what people do doesn’t change."></textarea></div>
        <div class="field mb-16"><label for="dac">Comment (optional)</label><textarea class="textarea" id="dac" name="comment"></textarea></div>
        <div class="callout"><strong>${last ? 'You are the last QA approver' : 'You sign later in Adobe Sign'}</strong><p class="small" style="margin:4px 0 0">${last ? 'When you approve, the locked PDF goes to Adobe Sign at once in one agreement with every signer: the author, then the reviewers, then the QA approvers. It uses 1 of the ' + Q.esign.remaining() + ' Adobe Sign transactions left this year.' : 'When the last QA approver approves, the locked PDF goes to Adobe Sign at once in one agreement with every signer.'} If any approver says retraining is needed, it is.</p></div>`,
      foot: h`<button class="btn btn-primary" type="submit">Approve</button><button class="btn" type="button" data-act="doc-sendback" data-id="${d.id}">Return to the author</button><button class="btn" type="button" data-act="drawer-close">Cancel</button>`,
      submit: function (f, form) {
        var retrain = f.retrain !== 'no';
        if (!retrain && (f.reason || '').length < 10) return Q.fieldError(form, 'reason', 'Say why no retraining is needed (at least a short sentence).');
        var ag;
        try { ag = Q.wf.doc.approve(d, { retrain: retrain, reason: f.reason, comment: f.comment }); } catch (e) { Q.toast(e.message, 'warn'); return; }
        Q.drawer.close();
        Q.toast(ag ? 'Approved. Sent to Adobe Sign · transaction ' + Q.esign.txNo(ag) + ' of ' + Q.esign.cfg().allowance + ' · ' + Q.fullName(ag.signers[0].u) + ' signs first' : 'Approved. Waiting for the other QA approver.');
        Q.refresh();
      }
    });
  };
  Q.act['doc-sendback'] = function (el) {
    var d = D(el);
    Q.drawer.open({
      kicker: d.id + ' · ' + d.state, title: 'Return to the author', submitLabel: 'Return to the author',
      body: h`<div class="field"><label for="sb">Reason (required)</label><textarea class="textarea" id="sb" name="reason" placeholder="What needs to change before this can go ahead?"></textarea><div class="help">${Q.fullName(d.author)} and everyone already on it are told, with this reason. Review and approval start again when it is submitted again.</div></div>`,
      submit: function (f, form) {
        if (!f.reason) return Q.fieldError(form, 'reason', 'Give a reason so the author knows what to fix.');
        try { Q.wf.doc.sendBack(d, f.reason); } catch (e) { Q.toast(e.message, 'warn'); return; }
        Q.drawer.close(); Q.toast('Returned to the author'); if (Q.current.section === 'task') Q.go('#/today'); else Q.refresh();
      }
    });
  };
  Q.act['doc-newver'] = function (el) {
    var d = D(el), v = Q.curVer(d);
    Q.drawer.open({
      kicker: d.id + ' · v' + v.v + ' effective', title: 'Start a new version', submitLabel: 'Start draft',
      body: h`<fieldset class="mb-16"><legend>Kind of change</legend><div class="radio-cards">
          <label class="radio-card"><input type="radio" name="kind" value="major" checked><span><b>Major</b><br><span class="small muted">Changes what people must do.</span></span></label>
          <label class="radio-card"><input type="radio" name="kind" value="minor"><span><b>Minor</b><br><span class="small muted">Wording, layout or corrections.</span></span></label></div></fieldset>
        <div class="field"><label for="ns">Why are you changing it? (required)</label><textarea class="textarea" id="ns" name="summary"></textarea></div>
        <p class="small muted mt-16">This opens a change request for the new version, and you edit the Word file in the Drafts library. Either way it is reviewed, approved and signed in Adobe Sign; the QA approvers decide whether people need retraining. v${v.v} stays Effective until the new version’s agreement completes.</p>`,
      submit: function (f, form) {
        if (!f.summary) return Q.fieldError(form, 'summary', 'Say why the document is changing.');
        var nv; try { nv = Q.wf.doc.newVersion(d, f.kind, f.summary); } catch (e) { Q.toast(e.message, 'warn'); return; }
        Q.drawer.close(); Q.toast('Draft v' + nv.v + ' started · ' + nv.cr + ' opened'); Q.refresh();
      }
    });
  };
  // Making a document obsolete is a sign-off: write the reason, then sign it in Adobe Sign.
  Q.act['doc-obsolete'] = function (el) {
    var d = D(el);
    var block = Q.esign.cantSend(d.id, 'doc-obsolete'); if (block) { Q.toast(block, 'warn'); return; }
    Q.drawer.open({ kicker: d.id + ' · obsolete', title: 'Make ' + d.id + ' obsolete', submitLabel: 'Continue to Adobe Sign',
      body: h`<div class="callout warn mb-16"><strong>This can’t be undone from the app.</strong><p class="small" style="margin:4px 0 0">The document is archived, not deleted. Open training for it closes. It becomes obsolete when you sign the Adobe Sign agreement.</p></div><div class="field mb-16"><label for="or">Reason (required)</label><textarea class="textarea" id="or" name="reason">${(d.pendingObsolete || {}).reason || ''}</textarea></div>`,
      submit: function (f, form) {
        if (!f.reason) return Q.fieldError(form, 'reason', 'Give a reason.');
        d.pendingObsolete = { reason: f.reason, by: Q.S.session.userId, at: new Date().toISOString() };
        Q.audit('update', 'Document', d.id, 'Asked to make ' + d.id + ' obsolete (to be signed in Adobe Sign). Reason: ' + f.reason);
        Q.save(); Q.drawer.close(); Q.esign.openSend(d.id, 'doc-obsolete');
      } });
  };
  function docHtml(d, v, bare) { // bare: the locked PDF that is checked, reviewed, approved and signed
    var me = Q.me(); var wm = bare ? null : WATERMARK[v.state];
    var body = '<h1>' + Q.esc(d.id + ' ' + d.title) + '</h1><p><b>Version ' + v.v + '</b> · ' + Q.esc(v.state) + ' · ' + Q.esc(d.classification.toUpperCase()) + ' · Owner: ' + Q.esc(Q.fullName(d.owner)) + '</p>' + (wm ? '<div class="wm">' + wm + '</div>' : '') +
      v.content.map(function (b) { return b.t === 'h' ? '<h2>' + Q.esc(b.x) + '</h2>' : '<p>' + Q.esc(b.x) + '</p>'; }).join('');
    if (v.signatures.length && !bare) body += '<h2 style="page-break-before:always">Signature manifest</h2>' + (v.agreement ? '<p>Approved through Adobe Sign · agreement <span class="mono">' + v.agreement + '</span></p>' : v.migrated ? '<p>Approved in KSTARRS before go-live (migrated record).</p>' : '') + '<table><tr><th>Signer</th><th>Meaning</th><th>Signed (UTC)</th><th>Signature</th></tr>' + v.signatures.map(function (s) { return '<tr><td>' + Q.esc(Q.fullName(s.user)) + '</td><td>' + Q.esc(s.meaning) + '</td><td>' + Q.fmtUtc(s.at) + '</td><td>' + (s.source ? s.source + ' · ' : '') + s.id + '</td></tr>'; }).join('') + '</table><p>' + Q.esc(v.signatures[0].statement || Q.statementFor('Approved')) + '</p><p>Content SHA-256: <span class="mono">' + v.hash + '</span></p>';
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
    Q.logPdfOpen(d, v);
    Q.printHtml(d.id + ' v' + v.v, docHtml(d, v), d.id + ' v' + v.v + ' PDF (watermarked for ' + Q.fullName(Q.S.session.userId) + ')');
  };
  Q.act['doc-newtab'] = function (el) {
    var d = D(el); var v = d.versions.find(function (x) { return x.v === el.getAttribute('data-v'); }) || Q.curVer(d);
    if (!Q.canDownload(d)) { Q.toast(d.classification + ' documents open only inside the app viewer.', 'warn'); return; }
    Q.logPdfOpen(d, v, 'viewer copy');
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
          <label class="radio-card"><input type="radio" name="source" value="template" data-change="nd-src" ${st.source === 'template' ? 'checked' : ''}><span><b>An approved template</b><br><span class="small muted">The Word file starts from the template’s headings.</span></span></label>
          <label class="radio-card"><input type="radio" name="source" value="blank" data-change="nd-src" ${st.source === 'blank' ? 'checked' : ''}><span><b>A blank page</b></span></label>
          <label class="radio-card"><input type="radio" name="source" value="upload" data-change="nd-src" ${st.source === 'upload' ? 'checked' : ''}><span><b>Upload a Word file</b><br><span class="small muted">Scanned for malware, then stored as the document’s Word file.</span></span></label></div></fieldset>
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
        <p class="small muted mt-16">VeQMS creates the Word file in the SharePoint Drafts library and opens a change request for v0.1. The change request closes when the document becomes Effective.</p>
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
        Q.drawer.close(); Q.toast(d.id + ' created · ' + Q.curVer(d).cr + ' opened · Word file in the Drafts library'); Q.go('#/documents/' + d.id);
      }
    });
  };
})(window.Q);
