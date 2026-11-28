/* Approvals through Adobe Sign: the verification check and send, the simulated Adobe Sign signing page,
   agreement details, the agreement card shown on records, and the register of approvals and transactions. */
(function (Q) {
  'use strict';
  var h = Q.h, es = Q.esign;

  es.statusChip = function (ag) { return Q.chip(es.STATUS[ag.status]); };
  function short(id) { return id.slice(0, 8) + '…'; }
  function signerList(ag) {
    return h`<div class="stack-sm">${ag.signers.map(function (s) {
      var st = s.status === 'Sent' ? 'With signer' + (s.u === Q.S.session.userId ? ' · your turn' : '') : s.status;
      var cls = s.status === 'Signed' ? 'st-done' : s.status === 'Sent' ? 'st-turn' : s.status === 'Declined' ? 'st-overdue' : 'st-wait';
      return h`<div class="people-row"><span class="who">${Q.avatar(s.u, 'xs')}<span>${s.order}. ${Q.name(s.u)} · ${s.role}<span class="muted small"> · ${s.meaning}</span></span></span><span class="status-text ${cls}">${st}${s.at && s.status === 'Signed' ? ' ' + Q.fmtShort(s.at) : ''}</span></div>`;
    })}</div>`;
  }
  function recordLink(ag) { return h`<a href="${es.href(ag)}">${ag.record}${ag.ref ? ' · ' + ag.ref : ''}</a>`; }
  es.allowanceKpi = function () {
    var used = es.used(), cap = es.cfg().allowance, left = es.remaining();
    return h`<div class="card kpi"><div class="kpi-label">Adobe Sign transactions this year</div><div class="kpi-value">${used} <span class="muted" style="font-size:16px;font-weight:600">of ${cap}</span></div><div class="progress"><div style="width:${Q.pct(used, cap)}%"></div></div><div class="kpi-sub">${left} remaining · ${es.yearRange().label}</div></div>`;
  };
  // A sign button for whatever agreement on this record is waiting for the current user, if any.
  es.signButton = function (rid, cls) {
    var mine = Q.S.agreements.find(function (a) { return a.record === rid && es.myTurn(a); });
    return mine ? h`<button class="btn ${cls || 'btn-primary'}" data-act="es-open-sign" data-id="${mine.id}">${Q.icon('sign', 'ico-sm')} Sign in Adobe Sign</button>` : '';
  };

  // ---------- Agreement card on record pages ----------
  es.recordCard = function (rid) {
    var all = es.forRecord(rid);
    if (!all.length) return '';
    var open = all.filter(function (a) { return a.status === 'sent'; });
    var show = open.length ? open : [all[0]];
    return h`${show.map(function (ag) {
      var older = all.filter(function (a) { return a.stage === ag.stage && a.ref === ag.ref && a !== ag; }).length;
      return h`<div class="card ctx-card"><div class="spread"><span class="label" style="margin:0">Adobe Sign · ${ag.purpose}</span>${es.statusChip(ag)}</div>
        <div class="small mt-8" style="font-weight:600">${ag.subject}</div>
        <div class="small muted">Agreement <span class="mono">${short(ag.id)}</span> · sent ${Q.fmtShort(ag.sentAt)} by ${Q.name(ag.sentBy)}</div>
        <div class="mt-8">${signerList(ag)}</div>
        ${ag.status === 'declined' ? h`<p class="small mt-8" style="margin-bottom:0"><b>Declined:</b> ${ag.declineReason}</p>` : ag.status === 'cancelled' ? h`<p class="small mt-8" style="margin-bottom:0"><b>Cancelled:</b> ${ag.cancelReason}</p>` : ''}
        ${older ? h`<p class="small muted mt-8" style="margin-bottom:0">${Q.plural(older, 'earlier agreement')} for this sign-off.</p>` : ''}
        <div class="btn-row mt-16">${es.myTurn(ag) ? h`<button class="btn btn-sm btn-primary" data-act="es-open-sign" data-id="${ag.id}">Sign in Adobe Sign</button>` : ''}<button class="btn btn-sm" data-act="es-agreement" data-id="${ag.id}">Agreement details</button></div></div>`;
    })}`;
  };

  // ---------- Verify and send ----------
  es.openSend = function (rid, stage, ref) {
    stage = stage || es.defaultStage(rid);
    var block = es.cantSend(rid, stage, ref); if (block) { Q.toast(block, 'warn'); return; }
    var st = es.STAGES[stage], obj = es.target(rid, stage).obj;
    var nAppr = st.approvers(obj);
    var first = es.plan(rid, { stage: stage, ref: ref });
    var s = { checks: { footer: false, version: false, docId: false, dates: false }, note: '', approvers: first.approvers.slice() };
    var qmOnly = (stage === 'capa-plan' || stage === 'capa-actions');
    var candidates = Q.activeUsers().filter(function (u) { return u.roles.indexOf('qm') >= 0 || (!qmOnly && u.roles.indexOf('approver') >= 0); });
    var labels = es.labels(rid, stage);
    function sel(i, required) {
      var cur = s.approvers[i] || '';
      return h`<div class="field"><label for="esa${i}">${i === 0 ? (qmOnly ? 'Quality Manager' : 'QA approver') : 'Second QA approver (optional)'}</label><select class="select" id="esa${i}" data-change="es-appr" data-i="${i}">${required ? '' : h`<option value="">None</option>`}${candidates.map(function (u) { return h`<option value="${u.id}" ${u.id === cur ? 'selected' : ''}>${u.name} · ${u.roles.indexOf('qm') >= 0 ? 'Quality Manager' : 'Approver'}</option>`; })}</select></div>`;
    }
    function body() {
      var p = es.plan(rid, { stage: stage, ref: ref, approvers: s.approvers });
      var left = es.remaining();
      return h`<div class="statement mb-16"><div class="small muted">Agreement name</div><div style="font-weight:600">${p.subject}</div>
          <div class="row-wrap mt-8"><span class="small">Attached: <span class="mono">${p.pdf.name}</span></span><button type="button" class="btn btn-sm" data-act="es-preview" data-id="${rid}" data-stage="${stage}" data-ref="${ref || ''}">Open the PDF to check it</button></div></div>
        <fieldset class="mb-16"><legend>Verification check (required before sending)</legend>
          ${['footer', 'version', 'docId', 'dates'].map(function (key) { return h`<label class="check"><input type="checkbox" name="${key}" data-change="es-check" data-k="${key}" ${s.checks[key] ? 'checked' : ''}> ${labels[key]}</label>`; })}
          <div class="help">A correction after sending means cancelling the agreement and sending again, which uses a second transaction.</div></fieldset>
        ${nAppr ? h`<div class="form-grid mb-16">${sel(0, true)}${nAppr > 1 ? sel(1, false) : ''}</div>` : ''}
        <div class="label mb-8">Signing order in Adobe Sign</div>
        <div class="list-rows mb-16">${p.signers.map(function (x) { return h`<div class="list-row"><span class="chip chip-outline">${x.order}</span><div class="lr-main"><b>${Q.fullName(x.u)}</b> · ${x.role}<div class="small muted">Reason for signing: ${x.meaning}</div></div></div>`; })}</div>
        ${p.problems.length ? h`<div class="callout warn mb-16" id="es-problems" tabindex="-1"><strong>Fix before sending</strong>${p.problems.map(function (x) { return h`<p class="small" style="margin:4px 0 0">${x}</p>`; })}</div>` : ''}
        ${s.error ? h`<div class="err mb-16" role="alert" id="es-error" tabindex="-1">${s.error}</div>` : ''}
        <div class="field mb-16"><label for="esn">Note for the record (optional)</label><input class="input" id="esn" name="note" value="${s.note}" data-input="es-note" placeholder="e.g. Checked against the Word source"></div>
        <div class="callout ${left <= (es.cfg().warnAt || 50) ? 'warn' : ''}"><strong>This uses 1 Adobe Sign transaction</strong><p class="small" style="margin:4px 0 0">${es.used()} of ${es.cfg().allowance} used this year · ${left} remaining, ${left - 1} after this one. Every signer is in this one agreement, so the whole sign-off uses one transaction.</p></div>`;
    }
    Q.on['es-check'] = function (el) { s.checks[el.getAttribute('data-k')] = el.checked; };
    Q.on['es-note'] = function (el) { s.note = el.value; };
    Q.on['es-appr'] = function (el) { var i = +el.getAttribute('data-i'); s.approvers[i] = el.value; s.approvers = s.approvers.filter(Boolean).filter(function (x, j, a) { return a.indexOf(x) === j; }); Q.drawer.paint(); };
    Q.drawer.open({
      wide: true, kicker: 'Adobe Sign · ' + first.purpose, title: 'Verify and send ' + rid + (ref ? ' · ' + ref : ''), body: body, submitLabel: 'Send to Adobe Sign',
      submit: function (f) {
        var fail = function (msg) { s.error = msg; Q.drawer.paint(); var el = document.getElementById('es-error'); if (el) el.focus(); };
        var missing = ['footer', 'version', 'docId', 'dates'].filter(function (x) { return !f[x]; });
        if (missing.length) return fail('Tick all four verification checks before sending.');
        var p = es.plan(rid, { stage: stage, ref: ref, approvers: s.approvers });
        if (p.problems.length) {
          var sod = p.problems.find(es.isSod);
          if (sod) { Q.audit('sod.block', es.kindLabel({ stage: stage, record: rid }), rid, 'Adobe Sign send blocked by segregation of duties: ' + sod); Q.save(); }
          return fail('Not sent. ' + p.problems[0]);
        }
        s.error = null;
        try {
          var ag = es.send(rid, { stage: stage, ref: ref, verification: { footer: true, version: true, docId: true, dates: true, note: f.note || '' }, approvers: s.approvers });
          Q.drawer.close(); Q.toast('Sent to Adobe Sign · transaction ' + es.txNo(ag) + ' of ' + es.cfg().allowance + ' · ' + Q.fullName(ag.signers[0].u) + ' signs first'); Q.refresh();
        } catch (e) { fail(e.message); }
      }
    });
  };

  // ---------- Simulated Adobe Sign signing page ----------
  es.openSigning = function (ag) {
    if (!ag) return;
    if (!es.myTurn(ag)) { Q.toast(ag.status !== 'sent' ? 'This agreement is ' + es.STATUS[ag.status].toLowerCase() + '.' : 'It isn’t your turn to sign this agreement yet.', 'warn'); return; }
    var s = ag.signers.find(function (x) { return x.u === Q.S.session.userId && x.status === 'Sent'; });
    var st = { step: 1, error: null, phase: 'start' };
    var me = Q.me();
    function steps() { return h`<div class="sign-steps"><div class="${st.step === 1 ? 'on' : 'ok'}">1 Review</div><div class="${st.step === 2 ? 'on' : st.step > 2 ? 'ok' : ''}">2 Confirm your identity</div><div class="${st.step === 3 ? 'ok' : ''}">3 Signed</div></div>`; }
    function body() {
      var head = h`<div class="idp mb-16"><div class="idp-head"><span class="idp-mark">${Q.icon('sign', 'ico-sm')}</span><div><div style="font-weight:600">Adobe Sign</div><div class="small muted">Simulated signing page · prototype only. In production this opens in Adobe Sign.</div></div></div>
        <div class="small muted">Agreement</div><div style="font-weight:600">${ag.subject}</div><div class="small muted mt-8">From ${Q.fullName(ag.sentBy)} via VeQMS · agreement <span class="mono">${ag.id}</span></div></div>`;
      if (st.step === 1) return h`${steps()}${head}
        <dl class="dl mb-16"><div><dt>You sign as</dt><dd>${s.role}</dd></div><div><dt>Reason for signing</dt><dd>${s.meaning}</dd></div><div><dt>Signing order</dt><dd>${s.order} of ${Math.max.apply(null, ag.signers.map(function (x) { return x.order; }))}</dd></div><div><dt>Document</dt><dd><button type="button" class="btn-link" style="padding:0;min-height:0" data-act="es-preview-ag" data-id="${ag.id}">${ag.pdf.name}</button></dd></div></dl>
        <label class="check mb-16"><input type="checkbox" name="agree"> I have reviewed ${ag.pdf.name} and agree to sign it electronically with the reason “${s.meaning}”.</label>
        <div class="callout"><strong>Part 11: Adobe Sign checks who you are again</strong><p class="small" style="margin:4px 0 0">The account’s Bio-Pharma settings make every signer confirm their identity when they sign and record a reason for signing. The reason is printed beside your signature.</p></div>`;
      if (st.step === 2) return h`${steps()}${head}
        <div class="small muted">Adobe Sign account</div><div style="font-weight:600;margin-bottom:16px">${me.email}</div>
        ${st.phase === 'wait' ? h`<div class="row"><span class="spinner" aria-hidden="true"></span><span>Checking with Adobe Sign…</span></div>` : h`<div class="field"><label for="esotp">Enter the 6-digit code Adobe Sign emailed you</label><input class="input otp" id="esotp" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus><div class="help">Prototype: any 6 digits work.</div>${st.error ? h`<div class="err">${st.error}</div>` : ''}</div>`}`;
      var next = ag.status === 'completed' ? null : ag.signers.filter(function (x) { return x.status === 'Sent'; });
      return h`${steps()}<div class="callout ok mb-16"><strong>Signed in Adobe Sign</strong><p style="margin:6px 0 0" class="small">Adobe Sign told the app through a webhook, and the app read the agreement back from the Adobe Sign API. The record below is up to date.</p></div>
        <dl class="dl"><div><dt>Signer</dt><dd>${me.name}</dd></div><div><dt>Reason for signing</dt><dd>${s.meaning}</dd></div><div><dt>Signed (UTC)</dt><dd>${Q.fmtUtc(s.at)}</dd></div><div><dt>Agreement</dt><dd>${es.STATUS[ag.status]}</dd></div>
        <div style="grid-column:1/-1"><dt>Next</dt><dd>${next ? (next.length ? next.map(function (x) { return Q.fullName(x.u) + ' (' + x.meaning + ')'; }).join(', ') : '—') : 'Everyone has signed. The signed PDF, audit report and agreement ID are stored, and the record is updated.'}</dd></div></dl>`;
    }
    function foot() {
      if (st.step === 1) return h`<button class="btn btn-primary" type="submit">Continue</button><button class="btn" type="button" data-act="es-decline" data-id="${ag.id}">Decline to sign</button><button class="btn" type="button" data-act="drawer-close">Finish later</button>`;
      if (st.step === 2) return h`<button class="btn btn-primary" type="submit" ${st.phase === 'wait' ? 'disabled' : ''}>Sign</button><button class="btn" type="button" data-act="drawer-close">Cancel</button>`;
      return h`<button class="btn btn-primary" type="button" data-act="drawer-close">Done</button>`;
    }
    Q.drawer.open({
      wide: true, kicker: 'Sign in Adobe Sign', title: ag.subject.split(' · ')[0], body: body, foot: foot,
      submit: function (f) {
        if (st.step === 1) { if (!f.agree) { Q.toast('Tick the box to confirm you reviewed the document.', 'warn'); return; } st.step = 2; Q.drawer.paint(); Q.drawer.focusFirst(); return; }
        if (st.step === 2) {
          if (!/^\d{6}$/.test(f.otp || '')) { st.error = 'Enter 6 digits.'; Q.drawer.paint(); return; }
          st.phase = 'wait'; Q.drawer.paint();
          setTimeout(function () {
            if (!Q.drawer.isOpen()) return;
            try { es.sign(ag); } catch (e) { Q.toast(e.message, 'warn'); Q.drawer.close(); return; }
            st.step = 3; Q.drawer.update({ onClose: function () { Q.render({ keepScroll: true }); } });
            Q.toast(ag.status === 'completed' ? 'Agreement completed · ' + ag.record + ' updated' : 'Signed · next signer notified by Adobe Sign');
          }, 700);
        }
      }
    });
  };
  Q.act['es-open-sign'] = function (el) { es.openSigning(es.byId(el.getAttribute('data-id'))); };
  Q.act['es-send'] = function (el) { es.openSend(el.getAttribute('data-id'), el.getAttribute('data-stage') || null, el.getAttribute('data-ref') || null); };
  Q.act['es-decline'] = function (el) {
    var ag = es.byId(el.getAttribute('data-id'));
    Q.drawer.open({ kicker: 'Adobe Sign', title: 'Decline to sign', submitLabel: 'Decline',
      body: h`<p>${ag.subject}</p><div class="field"><label for="esdr">Reason (required)</label><textarea class="textarea" id="esdr" name="reason" placeholder="What needs to change before you can sign?"></textarea><div class="help">The agreement stops. ${ag.kind === 'doc' && ag.stage === 'doc-approval' ? 'The document returns to draft with your reason recorded; its approvals are undone and it goes through review and approval again' : 'The sign-off returns to whoever sent it with your reason recorded'}. A corrected agreement is a new transaction.</div></div>`,
      submit: function (f, form) { if (!f.reason) return Q.fieldError(form, 'reason', 'Give a reason.'); try { es.decline(ag, f.reason); } catch (e) { Q.toast(e.message, 'warn'); return; } Q.drawer.close(); Q.toast('Declined. ' + ag.record + ' returned with your reason.'); Q.refresh(); } });
  };
  Q.act['es-cancel'] = function (el) {
    var ag = es.byId(el.getAttribute('data-id'));
    Q.drawer.open({ kicker: 'Adobe Sign', title: 'Cancel this agreement', submitLabel: 'Cancel agreement',
      body: h`<div class="callout warn mb-16"><strong>Cancelling stops the agreement for every signer.</strong><p class="small" style="margin:4px 0 0">${ag.kind === 'doc' && ag.stage === 'doc-approval' ? 'The document returns to draft with your reason recorded. Its approvals and the retraining decision are undone, and it goes through review and approval again' : 'The sign-off returns to whoever sent it with your reason recorded'}. A corrected agreement uses another transaction (${es.remaining()} left this year).</p></div>
        <div class="field"><label for="escr">Reason (required)</label><textarea class="textarea" id="escr" name="reason" placeholder="e.g. Footer shows the wrong version"></textarea></div>`,
      submit: function (f, form) { if (!f.reason) return Q.fieldError(form, 'reason', 'Give a reason.'); try { es.cancel(ag, f.reason); } catch (e) { Q.toast(e.message, 'warn'); return; } Q.drawer.close(); Q.toast('Agreement cancelled'); Q.refresh(); } });
  };
  Q.act['es-status'] = function (el) { var ag = es.byId(el.getAttribute('data-id')); es.checkStatus(ag); Q.toast('Adobe Sign: ' + es.STATUS[ag.status].toLowerCase()); Q.drawer.paint(); };

  // ---------- Agreement details ----------
  es.openAgreement = function (ag, onClose) {
    var EV = { sent: 'Sent', delivered: 'Delivered', signed: 'Signed', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled', status: 'Status check' };
    Q.drawer.open({
      wide: true, kicker: 'Adobe Sign agreement · ' + ag.purpose, title: ag.subject.split(' · ')[0], onClose: onClose,
      body: function () {
        return h`<div class="row-wrap mb-16">${es.statusChip(ag)}<span class="small muted">Transaction ${es.txNo(ag)} in the ${es.yearRange(ag.sentAt).label} allowance year</span>${ag.correctionOf ? Q.chip('Correction', 'chip-due') : ''}</div>
          <dl class="dl mb-16"><div style="grid-column:1/-1"><dt>Agreement ID</dt><dd class="mono">${ag.id}</dd></div><div style="grid-column:1/-1"><dt>Name</dt><dd>${ag.subject}</dd></div>
            <div><dt>Record</dt><dd>${recordLink(ag)}</dd></div><div><dt>Version</dt><dd>${ag.version ? 'v' + ag.version : '—'}</dd></div>
            <div><dt>Sent by</dt><dd>${Q.fullName(ag.sentBy)}</dd></div><div><dt>Sent (UTC)</dt><dd>${Q.fmtUtc(ag.sentAt)}</dd></div>
            <div><dt>Completed (UTC)</dt><dd>${Q.fmtUtc(ag.completedAt)}</dd></div><div><dt>Verification check</dt><dd>${ag.verification ? 'Passed · ' + Q.fullName(ag.verification.by) + ', ' + Q.fmtShort(ag.verification.at) + (ag.stage === 'doc-approval' ? ' (at submit, on the locked PDF)' : '') : '—'}</dd></div>
            ${ag.declineReason ? h`<div style="grid-column:1/-1"><dt>Declined by ${Q.fullName(ag.declinedBy)}</dt><dd>${ag.declineReason}</dd></div>` : ''}
            ${ag.cancelReason ? h`<div style="grid-column:1/-1"><dt>Cancelled by ${Q.fullName(ag.cancelledBy)}</dt><dd>${ag.cancelReason}</dd></div>` : ''}
            ${ag.correctionOf ? h`<div style="grid-column:1/-1"><dt>Replaces</dt><dd class="mono">${ag.correctionOf}</dd></div>` : ''}</dl>
          <div class="label mb-8">Signers (in order)</div>${signerList(ag)}
          <div class="label mb-8 mt-24">Stored files</div>
          <div class="list-rows mb-16">
            <div class="list-row">${Q.icon('doc')}<div class="lr-main"><b>${ag.pdf.name}</b><div class="small muted mono">SHA-256 ${ag.pdf.hash.slice(0, 24)}…</div></div><button type="button" class="btn btn-sm" data-act="es-preview-ag" data-id="${ag.id}">View</button></div>
            ${ag.signedPdf ? h`<div class="list-row">${Q.icon('sign')}<div class="lr-main"><b>${ag.signedPdf.name}</b><div class="small muted mono">SHA-256 ${ag.signedPdf.hash.slice(0, 24)}…</div></div><button type="button" class="btn btn-sm" data-act="es-signed" data-id="${ag.id}">View</button></div>
              <div class="list-row">${Q.icon('check')}<div class="lr-main"><b>${ag.auditReport.name}</b><div class="small muted">Audit report</div></div><button type="button" class="btn btn-sm" data-act="es-audit-report" data-id="${ag.id}">View</button></div>` : h`<p class="small muted" style="margin:8px 0">The signed PDF and audit report are stored when the agreement completes.</p>`}</div>
          <div class="label mb-8">Status history (from Adobe Sign webhooks)</div>
          <div class="timeline">${ag.events.slice().reverse().map(function (e) { return h`<div class="ev ${e.type === 'signed' || e.type === 'completed' ? 'sig' : e.type === 'declined' || e.type === 'cancelled' ? 'warn' : 'state'}"><b>${EV[e.type] || e.type}</b>${e.u ? ' · ' + Q.fullName(e.u) : ''}${e.detail ? ' · ' + e.detail : ''}<span class="when">${Q.fmtUtc(e.at)}</span></div>`; })}</div>`;
      },
      foot: function () { return h`${es.myTurn(ag) ? h`<button class="btn btn-primary" type="button" data-act="es-open-sign" data-id="${ag.id}">Sign in Adobe Sign</button>` : ''}${ag.status === 'sent' ? h`<button class="btn" type="button" data-act="es-status" data-id="${ag.id}">Check status</button>` : ''}${es.canCancel(ag) ? h`<button class="btn btn-danger" type="button" data-act="es-cancel" data-id="${ag.id}">Cancel agreement</button>` : ''}<button class="btn" type="button" data-act="drawer-close">Close</button>`; }
    });
  };
  Q.act['es-agreement'] = function (el) { es.openAgreement(es.byId(el.getAttribute('data-id'))); };

  // ---------- PDF views (prototype: printable HTML) ----------
  function recordHtml(rid, stage, ref, ver) {
    var t = es.target(rid, stage), st = es.STAGES[stage], r = t.obj;
    if (stage === 'doc-approval') { var v = r.versions.find(function (x) { return x.v === ver; }) || Q.curVer(r); return Q.docHtml(r, v, true); }
    var lines = es.lines(rid, stage, ref);
    return '<h1>' + Q.esc(rid + ' ' + t.title) + '</h1><p><b>' + Q.esc(st.purpose(r)) + '</b> · ' + Q.esc(Q.recClass(rid)) + (r && r.owner ? ' · Owner: ' + Q.esc(Q.fullName(r.owner)) : '') + '</p><table>' + lines.map(function (l) { return '<tr><th style="width:28%">' + Q.esc(l[0]) + '</th><td>' + Q.esc(l[1] || '') + '</td></tr>'; }).join('') + '</table>' +
      '<p class="small">' + Q.esc(Q.S.settings.statement.replace('{meaning}', 'shown beside each signature')) + '</p>';
  }
  Q.act['es-preview'] = function (el) { var rid = el.getAttribute('data-id'), stage = el.getAttribute('data-stage'), ref = el.getAttribute('data-ref') || null; Q.printHtml(rid + ' PDF for Adobe Sign', recordHtml(rid, stage, ref) + '<div class="foot">PDF prepared for Adobe Sign. Page 1 of 1.</div>', 'PDF check before Adobe Sign send for ' + rid); };
  Q.act['es-preview-ag'] = function (el) { var ag = es.byId(el.getAttribute('data-id')); Q.printHtml(ag.pdf.name, recordHtml(ag.record, ag.stage, ag.ref, ag.version) + '<div class="foot">' + Q.esc(ag.pdf.name) + ' · SHA-256 <span class="mono">' + ag.pdf.hash + '</span></div>', 'Agreement PDF ' + ag.pdf.name); };
  Q.act['es-signed'] = function (el) {
    var ag = es.byId(el.getAttribute('data-id'));
    var page = '<h2 style="page-break-before:always">Adobe Sign signatures</h2><p>Agreement ID <span class="mono">' + ag.id + '</span> · ' + Q.esc(ag.subject) + '</p><table><tr><th>Order</th><th>Signer</th><th>Role</th><th>Reason for signing</th><th>Signed (UTC)</th></tr>' +
      ag.signers.map(function (s) { return '<tr><td>' + s.order + '</td><td>' + Q.esc(Q.fullName(s.u)) + '</td><td>' + Q.esc(s.role) + '</td><td>' + Q.esc(s.meaning) + '</td><td>' + Q.fmtUtc(s.at) + '</td></tr>'; }).join('') + '</table><p>Each signer confirmed their identity in Adobe Sign when they signed, and Adobe Sign recorded the reason for signing shown (Bio-Pharma settings).</p>';
    Q.printHtml(ag.signedPdf.name, recordHtml(ag.record, ag.stage, ag.ref, ag.version) + page + '<div class="foot">' + Q.esc(ag.signedPdf.name) + ' · SHA-256 <span class="mono">' + ag.signedPdf.hash + '</span></div>', 'Signed PDF ' + ag.signedPdf.name);
  };
  Q.act['es-audit-report'] = function (el) {
    var ag = es.byId(el.getAttribute('data-id'));
    Q.printHtml(ag.auditReport.name, '<h1>Audit report</h1><p>Prototype rendering of the Adobe Sign audit report stored with the record.</p><table>' +
      [['Agreement ID', ag.id], ['Name', ag.subject], ['Status', 'Completed'], ['Sent by', Q.fullName(ag.sentBy)], ['Sent (UTC)', Q.fmtUtc(ag.sentAt)], ['Completed (UTC)', Q.fmtUtc(ag.completedAt)], ['Document', ag.pdf.name + ' · SHA-256 ' + ag.pdf.hash]].map(function (r) { return '<tr><th style="width:28%">' + Q.esc(r[0]) + '</th><td>' + Q.esc(r[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<h2>Signer events</h2><table><tr><th>Signer</th><th>Reason for signing</th><th>Sent</th><th>Signed (UTC)</th><th>Identity check</th></tr>' + ag.signers.map(function (s) { return '<tr><td>' + Q.esc(Q.fullName(s.u)) + '<br><span class="mono">' + Q.esc(Q.user(s.u).email || '') + '</span></td><td>' + Q.esc(s.meaning) + '</td><td>' + Q.fmtUtc(s.sentAt || ag.sentAt) + '</td><td>' + Q.fmtUtc(s.at) + '</td><td>Confirmed at signing (email code)</td></tr>'; }).join('') + '</table>' +
      '<div class="foot">' + Q.esc(ag.auditReport.name) + '</div>', 'Audit report ' + ag.auditReport.name);
  };

  // ---------- Register: approvals and Adobe Sign transactions ----------
  function txRows(list) {
    var rows = [['Transaction no.', 'Sent (UTC)', 'Agreement ID', 'Name', 'Record', 'Version', 'Purpose', 'Sent by', 'Status', 'Signed', 'Completed (UTC)', 'Correction of', 'Reason (declined or cancelled)']];
    list.forEach(function (a) { rows.push([es.txNo(a), Q.fmtUtc(a.sentAt), a.id, a.subject, a.record + (a.ref ? ' ' + a.ref : ''), a.version || '', a.purpose, Q.fullName(a.sentBy), es.STATUS[a.status], es.signedCount(a) + ' of ' + a.signers.length, a.completedAt ? Q.fmtUtc(a.completedAt) : '', a.correctionOf || '', a.declineReason || a.cancelReason || '']); });
    return rows;
  }
  function approvalRows(list) {
    var rows = [['Record', 'Version', 'Title', 'Purpose', 'Approved (UTC)', 'Signers and reasons for signing', 'Agreement ID', 'Signed PDF', 'Audit report']];
    list.forEach(function (a) { rows.push([a.record + (a.ref ? ' ' + a.ref : ''), a.version || '', es.target(a.record, a.stage).title, a.purpose, Q.fmtUtc(a.completedAt), a.signers.map(function (s) { return Q.fullName(s.u) + ' (' + s.meaning + ', ' + Q.fmtUtc(s.at) + ')'; }).join('; '), a.id, a.signedPdf.name, a.auditReport.name]); });
    return rows;
  }
  Q.views.approvals = function (p, q) {
    if (!Q.can('approvals.view')) return Q.views.denied('Approvals');
    var tab = q.tab || 'transactions';
    var range = es.yearRange();
    var all = Q.S.agreements.filter(es.canSee);
    var yearList = q.year === 'all' ? all : all.filter(function (a) { return a.sentAt >= range.start && a.sentAt < range.end; });
    var list = q.st ? yearList.filter(function (a) { return a.status === q.st; }) : yearList;
    var out = all.filter(function (a) { return a.status === 'sent'; });
    var thisYear = es.transactions();
    var corrections = thisYear.filter(function (a) { return a.status === 'cancelled' || a.status === 'declined'; }).length;
    if (q.ag) Q.after(function () { var a = es.byId(q.ag); if (a) es.openAgreement(a, function () { if (Q.current.query.ag) Q.setQuery({ ag: '' }); }); });
    var body;
    if (tab === 'register') {
      var done = all.filter(function (a) { return a.status === 'completed'; }).sort(Q.by('completedAt', -1));
      Q.reports.approvals = { title: 'Register of approvals', file: 'approvals-register', rows: function () { return approvalRows(done); }, intro: 'Sign-offs completed through Adobe Sign. Approvals before go-live were made in KSTARRS and are shown on each document’s version history.' };
      body = h`<div class="spread mb-16" style="flex-wrap:wrap"><p class="muted" style="margin:0">Every completed sign-off, with its signers and reasons for signing, agreement ID, signed PDF and audit report.</p>${Q.reportButtons('approvals')}</div>
        ${Q.table({ id: 'apreg', rows: done.map(function (a) { return Object.assign({ title: es.target(a.record, a.stage).title }, a); }), defaultSort: 'completedAt', defaultDir: -1, href: function (a) { return '#/approvals?tab=register&ag=' + a.id; }, empty: 'No completed approvals yet.',
          cols: [{ key: 'record', label: 'Record', render: function (a) { return recordLink(a); } }, { key: 'version', label: 'Version', render: function (a) { return a.version ? 'v' + a.version : '—'; } }, { key: 'title', label: 'Title' }, { key: 'purpose', label: 'Purpose' },
            { key: 'completedAt', label: 'Approved', render: function (a) { return Q.fmtDateTime(a.completedAt); } }, { key: 'signers', label: 'Signers', sort: false, render: function (a) { return h`<span class="small">${a.signers.map(function (s) { return Q.user(s.u).initials + ' · ' + s.meaning; }).join(', ')}</span>`; } },
            { key: 'id', label: 'Agreement', render: function (a) { return h`<span class="mono">${short(a.id)}</span>`; } }] })}`;
    } else {
      Q.reports.transactions = { title: 'Transactions log', file: 'adobe-sign-transactions', rows: function () { return txRows(list.slice().sort(Q.by('sentAt'))); }, intro: 'Every agreement sent. Allowance: ' + es.cfg().allowance + ' transactions a year (' + range.label + '); ' + es.used() + ' used, ' + es.remaining() + ' remaining.' };
      body = h`<div class="toolbar"><select class="select" data-change="qfilter" data-key="year" aria-label="Period"><option value="">This allowance year</option><option value="all" ${q.year === 'all' ? 'selected' : ''}>All years</option></select>
          <select class="select" data-change="qfilter" data-key="st" aria-label="Status"><option value="">Any status</option>${Object.keys(es.STATUS).map(function (k) { return h`<option value="${k}" ${q.st === k ? 'selected' : ''}>${es.STATUS[k]}</option>`; })}</select>
          <span style="margin-left:auto">${Q.reportButtons('transactions')}</span></div>
        ${Q.table({ id: 'transactions', rows: list, defaultSort: 'sentAt', defaultDir: -1, href: function (a) { return '#/approvals?tab=transactions&ag=' + a.id + (q.year ? '&year=' + q.year : '') + (q.st ? '&st=' + q.st : ''); }, empty: 'No agreements match.',
          cols: [{ key: 'no', label: 'Transaction', sortVal: function (a) { return a.sentAt; }, render: function (a) { return h`<b>${es.txNo(a)}</b>`; } }, { key: 'sentAt', label: 'Sent', render: function (a) { return Q.fmtDateTime(a.sentAt); } },
            { key: 'subject', label: 'Name', render: function (a) { return h`${a.subject}${a.correctionOf ? h` <span class="chip chip-due">Correction</span>` : ''}`; } }, { key: 'purpose', label: 'Purpose' }, { key: 'sentBy', label: 'Sent by', render: function (a) { return Q.fullName(a.sentBy); } },
            { key: 'status', label: 'Status', render: function (a) { return es.statusChip(a); } }, { key: 'signed', label: 'Signed', sort: false, render: function (a) { return es.signedCount(a) + ' of ' + a.signers.length; } },
            { key: 'id', label: 'Agreement', render: function (a) { return h`<span class="mono">${short(a.id)}</span>`; } }] })}`;
    }
    return h`<div class="page-head"><div><h1>Approvals and Adobe Sign</h1><div class="sub">Every signature except read-and-understood training: document approvals, change requests, CAPAs, quality events, periodic reviews and configuration sign-offs. One agreement per sign-off.</div></div></div>
      ${Q.tip('approvals', h`<b>Approvals and Adobe Sign.</b> Every sign-off is one Adobe Sign agreement holding all its signers in order. Each agreement uses one transaction against the allowance of ${es.cfg().allowance} a year. A correction after sending is a second transaction.`)}
      <div class="grid-4 mb-16">${es.allowanceKpi()}
        <div class="card kpi"><div class="kpi-label">Out for signature</div><div class="kpi-value">${out.length}</div><div class="kpi-sub">${out.map(function (a) { return a.record; }).filter(function (x, i, arr) { return arr.indexOf(x) === i; }).join(', ') || 'None'}</div></div>
        <div class="card kpi"><div class="kpi-label">Completed this year</div><div class="kpi-value">${thisYear.filter(function (a) { return a.status === 'completed'; }).length}</div><div class="kpi-sub">signed PDF and audit report stored</div></div>
        <div class="card kpi"><div class="kpi-label">Cancelled or declined</div><div class="kpi-value" style="${corrections ? 'color:var(--overdue)' : ''}">${corrections}</div><div class="kpi-sub">each correction uses another transaction</div></div></div>
      <div class="tabs" role="tablist">${[['transactions', 'Transactions log'], ['register', 'Register of approvals']].map(function (t) { return h`<button class="tab ${tab === t[0] ? 'active' : ''}" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>
      ${body}`;
  };
})(window.Q);
