/* Approvals through DocuSign: verification check and send, simulated DocuSign signing, envelope details,
   the envelope card shown on records, and the register of approvals and DocuSign sends. */
(function (Q) {
  'use strict';
  var h = Q.h, ds = Q.ds;

  ds.statusChip = function (env) { return Q.chip(ds.STATUS[env.status]); };
  function short(id) { return id.slice(0, 8) + '…'; }
  function signerList(env) {
    return h`<div class="stack-sm">${env.signers.map(function (s) {
      var st = s.status === 'Sent' ? (s.u === Q.S.session.userId ? 'Your turn' : 'Signing now') : s.status;
      var cls = s.status === 'Signed' ? 'st-done' : s.status === 'Sent' ? 'st-turn' : s.status === 'Declined' ? 'st-overdue' : 'st-wait';
      return h`<div class="people-row"><span class="who">${Q.avatar(s.u, 'xs')}<span>${s.order}. ${Q.name(s.u)} · ${s.role}<span class="muted small"> · ${s.meaning}</span></span></span><span class="status-text ${cls}">${st}${s.at && s.status === 'Signed' ? ' ' + Q.fmtShort(s.at) : ''}</span></div>`;
    })}</div>`;
  }
  ds.allowanceKpi = function () {
    var used = ds.used(), cap = ds.cfg().allowance, left = ds.remaining();
    return h`<div class="card kpi"><div class="kpi-label">DocuSign sends this year</div><div class="kpi-value">${used} <span class="muted" style="font-size:16px;font-weight:600">of ${cap}</span></div><div class="progress"><div style="width:${Q.pct(used, cap)}%"></div></div><div class="kpi-sub">${left} remaining · ${ds.yearRange().label}</div></div>`;
  };

  // ---------- Envelope card on record pages ----------
  ds.recordCard = function (rid) {
    var envs = ds.forRecord(rid), env = ds.active(rid) || envs[0];
    if (!env) return '';
    var older = envs.length - 1;
    var mine = ds.myTurn(env);
    return h`<div class="card ctx-card"><div class="spread"><span class="label" style="margin:0">DocuSign approval</span>${ds.statusChip(env)}</div>
      <div class="small mt-8" style="font-weight:600">${env.subject}</div>
      <div class="small muted">Envelope <span class="mono">${short(env.id)}</span> · sent ${Q.fmtShort(env.sentAt)} by ${Q.name(env.sentBy)}</div>
      <div class="mt-8">${signerList(env)}</div>
      ${env.status === 'declined' ? h`<p class="small mt-8" style="margin-bottom:0"><b>Declined:</b> ${env.declineReason}</p>` : env.status === 'voided' ? h`<p class="small mt-8" style="margin-bottom:0"><b>Voided:</b> ${env.voidReason}</p>` : ''}
      ${older ? h`<p class="small muted mt-8" style="margin-bottom:0">${Q.plural(older, 'earlier envelope')} for this record.</p>` : ''}
      <div class="btn-row mt-16">${mine ? h`<button class="btn btn-sm btn-primary" data-act="ds-open-sign" data-id="${env.id}">Sign in DocuSign</button>` : ''}<button class="btn btn-sm" data-act="ds-env" data-id="${env.id}">Envelope details</button></div></div>`;
  };

  // ---------- Verify and send ----------
  ds.openSend = function (rid) {
    var block = ds.cantSend(rid); if (block) { Q.toast(block, 'warn'); return; }
    var k = Q.kindOf(rid), r = Q.rec(rid);
    var st = { checks: { footer: false, version: false, docId: false, dates: false }, note: '' };
    st.approvers = k === 'doc' ? r.approvers.map(function (a) { return a.u; }).slice(0, 2) : [(ds.qaApprovers([r.owner])[0] || {}).id].filter(Boolean);
    if (k === 'doc' && !st.approvers.length) st.approvers = [(ds.qaApprovers([r.author])[0] || {}).id].filter(Boolean);
    var candidates = Q.activeUsers().filter(function (u) { return u.roles.indexOf('qm') >= 0 || u.roles.indexOf('approver') >= 0; });
    var ver = k === 'doc' ? Q.curVer(r).v : null;
    var labels = k === 'doc' ? {
      footer: 'The footer shows ' + rid + ', version ' + ver + ' and “Page X of Y” on every page',
      version: 'The version on the cover and in the envelope subject is v' + ver,
      docId: 'The document ID ' + rid + ' is correct throughout, including the title block',
      dates: 'Dates are correct: issue date, review date and any dates in the text'
    } : {
      footer: 'The closure PDF footer shows ' + rid + ' and “Page X of Y”',
      version: 'The closure summary matches the record (result, verdict or justification)',
      docId: 'The record ID ' + rid + ' and its title are correct',
      dates: 'Dates are correct: raised, due and effectiveness dates'
    };
    function sel(i, required) {
      var cur = st.approvers[i] || '';
      return h`<div class="field"><label for="dsa${i}">${i === 0 ? 'QA approver' : 'Second QA approver (optional)'}</label><select class="select" id="dsa${i}" data-change="ds-appr" data-i="${i}">${required ? '' : h`<option value="">None</option>`}${candidates.map(function (u) { return h`<option value="${u.id}" ${u.id === cur ? 'selected' : ''}>${u.name} · ${u.roles.indexOf('qm') >= 0 ? 'Quality Manager' : 'Approver'}</option>`; })}</select></div>`;
    }
    function body() {
      var p = ds.plan(rid, { approvers: st.approvers });
      var left = ds.remaining();
      return h`<div class="statement mb-16"><div class="small muted">Envelope subject</div><div style="font-weight:600">${p.subject}</div>
          <div class="row-wrap mt-8"><span class="small">Attached: <span class="mono">${p.pdf.name}</span></span><button type="button" class="btn btn-sm" data-act="ds-preview" data-id="${rid}">Open the PDF to check it</button></div></div>
        <fieldset class="mb-16"><legend>Verification check (required before sending)</legend>
          ${['footer', 'version', 'docId', 'dates'].map(function (key) { return h`<label class="check"><input type="checkbox" name="${key}" data-change="ds-check" data-k="${key}" ${st.checks[key] ? 'checked' : ''}> ${labels[key]}</label>`; })}
          <div class="help">A correction after sending means voiding the envelope and sending again, which costs a second send.</div></fieldset>
        <div class="form-grid mb-16">${sel(0, true)}${k === 'doc' ? sel(1, false) : ''}</div>
        <div class="label mb-8">Signing order in DocuSign</div>
        <div class="list-rows mb-16">${p.signers.map(function (s) { return h`<div class="list-row"><span class="chip chip-outline">${s.order}</span><div class="lr-main"><b>${Q.fullName(s.u)}</b> · ${s.role}<div class="small muted">Signature meaning: ${s.meaning}</div></div></div>`; })}</div>
        ${p.problems.length ? h`<div class="callout warn mb-16" id="ds-problems" tabindex="-1"><strong>Fix before sending</strong>${p.problems.map(function (x) { return h`<p class="small" style="margin:4px 0 0">${x}</p>`; })}</div>` : ''}
        ${st.error ? h`<div class="err mb-16" role="alert" id="ds-error" tabindex="-1">${st.error}</div>` : ''}
        <div class="field mb-16"><label for="dsn">Note for the record (optional)</label><input class="input" id="dsn" name="note" value="${st.note}" data-input="ds-note" placeholder="e.g. Checked against the Word source"></div>
        <div class="callout ${left <= (ds.cfg().warnAt || 50) ? 'warn' : ''}"><strong>This uses 1 DocuSign send</strong><p class="small" style="margin:4px 0 0">${ds.used()} of ${ds.cfg().allowance} used this year · ${left} remaining after this one: ${left - 1}. Every signer is in this one envelope, so the whole approval costs one send.</p></div>`;
    }
    Q.on['ds-check'] = function (el) { st.checks[el.getAttribute('data-k')] = el.checked; };
    Q.on['ds-note'] = function (el) { st.note = el.value; };
    Q.on['ds-appr'] = function (el) { var i = +el.getAttribute('data-i'); st.approvers[i] = el.value; st.approvers = st.approvers.filter(Boolean).filter(function (x, j, a) { return a.indexOf(x) === j; }); Q.drawer.paint(); };
    Q.drawer.open({
      wide: true, kicker: 'DocuSign · Part 11 approval', title: 'Verify and send ' + rid, body: body, submitLabel: 'Send to DocuSign',
      submit: function (f, form) {
        var fail = function (msg) { st.error = msg; Q.drawer.paint(); var el = document.getElementById('ds-error'); if (el) el.focus(); };
        var missing = ['footer', 'version', 'docId', 'dates'].filter(function (x) { return !f[x]; });
        if (missing.length) return fail('Tick all four verification checks before sending.');
        var p = ds.plan(rid, { approvers: st.approvers });
        if (p.problems.length) {
          if (p.problems.some(function (x) { return /segregation of duties|can’t approve|can’t also/.test(x); })) { Q.audit('sod.block', Q.KIND_LABEL[k], rid, 'DocuSign send blocked by segregation of duties: ' + p.problems[0]); Q.save(); }
          return fail('Not sent. ' + p.problems[0]);
        }
        st.error = null;
        try {
          var env = ds.send(rid, { verification: { footer: true, version: true, docId: true, dates: true, note: f.note || '' }, approvers: st.approvers });
          Q.drawer.close(); Q.toast('Sent to DocuSign · send ' + ds.sendNo(env) + ' of ' + ds.cfg().allowance + ' · ' + Q.fullName(env.signers[0].u) + ' signs first'); Q.refresh();
        } catch (e) { fail(e.message); }
        void form;
      }
    });
  };

  // ---------- Simulated DocuSign signing ceremony ----------
  ds.openSigning = function (env) {
    if (!env) return;
    if (!ds.myTurn(env)) { Q.toast(env.status !== 'sent' ? 'This envelope is ' + ds.STATUS[env.status].toLowerCase() + '.' : 'It isn’t your turn to sign this envelope yet.', 'warn'); return; }
    var s = env.signers.find(function (x) { return x.u === Q.S.session.userId && x.status === 'Sent'; });
    var st = { step: 1, error: null, phase: 'start' };
    var me = Q.me();
    function steps() { return h`<div class="sign-steps"><div class="${st.step === 1 ? 'on' : 'ok'}">1 Review</div><div class="${st.step === 2 ? 'on' : st.step > 2 ? 'ok' : ''}">2 Sign in to DocuSign</div><div class="${st.step === 3 ? 'ok' : ''}">3 Signed</div></div>`; }
    function body() {
      var head = h`<div class="idp mb-16"><div class="idp-head"><span class="idp-mark">${Q.icon('sign', 'ico-sm')}</span><div><div style="font-weight:600">DocuSign</div><div class="small muted">Simulated signing page · prototype only. In production this opens in DocuSign.</div></div></div>
        <div class="small muted">Envelope</div><div style="font-weight:600">${env.subject}</div><div class="small muted mt-8">From ${Q.fullName(env.sentBy)} via VeQMS · envelope <span class="mono">${env.id}</span></div></div>`;
      if (st.step === 1) return h`${steps()}${head}
        <dl class="dl mb-16"><div><dt>You sign as</dt><dd>${s.role}</dd></div><div><dt>Signature meaning</dt><dd>${s.meaning}</dd></div><div><dt>Signing order</dt><dd>${s.order} of ${Math.max.apply(null, env.signers.map(function (x) { return x.order; }))}</dd></div><div><dt>Document</dt><dd><button type="button" class="btn-link" style="padding:0;min-height:0" data-act="ds-preview-env" data-id="${env.id}">${env.pdf.name}</button></dd></div></dl>
        <label class="check mb-16"><input type="checkbox" name="agree"> I have reviewed ${env.pdf.name} and agree to sign it electronically with the meaning “${s.meaning}”.</label>
        <div class="callout"><strong>Part 11: you sign in to DocuSign again</strong><p class="small" style="margin:4px 0 0">DocuSign’s Part 11 module asks every signer to re-authenticate at the moment of signing and records the meaning with the signature.</p></div>`;
      if (st.step === 2) return h`${steps()}${head}
        <div class="small muted">DocuSign account</div><div style="font-weight:600;margin-bottom:16px">${me.email}</div>
        ${st.phase === 'wait' ? h`<div class="row"><span class="spinner" aria-hidden="true"></span><span>Checking with DocuSign…</span></div>` : h`<div class="field"><label for="dsotp">Enter the 6-digit code DocuSign sent you</label><input class="input otp" id="dsotp" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus><div class="help">Prototype: any 6 digits work.</div>${st.error ? h`<div class="err">${st.error}</div>` : ''}</div>`}`;
      var next = env.status === 'completed' ? null : env.signers.filter(function (x) { return x.status === 'Sent'; });
      return h`${steps()}<div class="callout ok mb-16"><strong>Signed in DocuSign</strong><p class="small" style="margin:6px 0 0">DocuSign told the app through its Connect webhook. The record below is up to date.</p></div>
        <dl class="dl"><div><dt>Signer</dt><dd>${me.name}</dd></div><div><dt>Meaning</dt><dd>${s.meaning}</dd></div><div><dt>Signed (UTC)</dt><dd>${Q.fmtUtc(s.at)}</dd></div><div><dt>Envelope</dt><dd>${ds.STATUS[env.status]}</dd></div>
        <div style="grid-column:1/-1"><dt>Next</dt><dd>${next ? (next.length ? next.map(function (x) { return Q.fullName(x.u) + ' (' + x.meaning + ')'; }).join(', ') : '—') : 'Everyone has signed. The signed PDF, certificate of completion and envelope ID are stored, and the record is updated.'}</dd></div></dl>`;
    }
    function foot() {
      if (st.step === 1) return h`<button class="btn btn-primary" type="submit">Continue</button><button class="btn" type="button" data-act="ds-decline" data-id="${env.id}">Decline to sign</button><button class="btn" type="button" data-act="drawer-close">Finish later</button>`;
      if (st.step === 2) return h`<button class="btn btn-primary" type="submit" ${st.phase === 'wait' ? 'disabled' : ''}>Sign</button><button class="btn" type="button" data-act="drawer-close">Cancel</button>`;
      return h`<button class="btn btn-primary" type="button" data-act="drawer-close">Done</button>`;
    }
    Q.drawer.open({
      wide: true, kicker: 'Sign in DocuSign', title: env.subject.split(' · ')[0], body: body, foot: foot,
      submit: function (f) {
        if (st.step === 1) { if (!f.agree) { Q.toast('Tick the box to confirm you reviewed the document.', 'warn'); return; } st.step = 2; Q.drawer.paint(); Q.drawer.focusFirst(); return; }
        if (st.step === 2) {
          if (!/^\d{6}$/.test(f.otp || '')) { st.error = 'Enter 6 digits.'; Q.drawer.paint(); return; }
          st.phase = 'wait'; Q.drawer.paint();
          setTimeout(function () {
            if (!Q.drawer.isOpen()) return;
            try { ds.sign(env); } catch (e) { Q.toast(e.message, 'warn'); Q.drawer.close(); return; }
            st.step = 3; Q.drawer.update({ onClose: function () { Q.render({ keepScroll: true }); } });
            Q.toast(env.status === 'completed' ? 'Envelope completed · ' + env.record + ' updated' : 'Signed · next signer notified by DocuSign');
          }, 700);
        }
      }
    });
  };
  Q.act['ds-open-sign'] = function (el) { ds.openSigning(ds.byId(el.getAttribute('data-id'))); };
  Q.act['ds-send'] = function (el) { ds.openSend(el.getAttribute('data-id')); };
  Q.act['ds-decline'] = function (el) {
    var env = ds.byId(el.getAttribute('data-id'));
    Q.drawer.open({ kicker: 'DocuSign', title: 'Decline to sign', submitLabel: 'Decline',
      body: h`<p>${env.subject}</p><div class="field"><label for="dsdr">Reason (required)</label><textarea class="textarea" id="dsdr" name="reason" placeholder="What needs to change before you can sign?"></textarea><div class="help">The envelope stops. ${env.kind === 'doc' ? 'The document returns to draft' : 'The closure returns to the owner'} with your reason recorded, and a corrected envelope is a new send.</div></div>`,
      submit: function (f, form) { if (!f.reason) return Q.fieldError(form, 'reason', 'Give a reason.'); try { ds.decline(env, f.reason); } catch (e) { Q.toast(e.message, 'warn'); return; } Q.drawer.close(); Q.toast('Declined. ' + env.record + ' returned with your reason.'); Q.refresh(); } });
  };
  Q.act['ds-void'] = function (el) {
    var env = ds.byId(el.getAttribute('data-id'));
    Q.drawer.open({ kicker: 'DocuSign', title: 'Void envelope', submitLabel: 'Void envelope',
      body: h`<div class="callout warn mb-16"><strong>Voiding stops the envelope for every signer.</strong><p class="small" style="margin:4px 0 0">${env.kind === 'doc' ? 'The document returns to draft' : 'The closure returns to the owner'} with your reason recorded. Sending a corrected envelope costs another send (${ds.remaining()} left this year).</p></div>
        <div class="field"><label for="dsvr">Reason (required)</label><textarea class="textarea" id="dsvr" name="reason" placeholder="e.g. Footer shows the wrong version"></textarea></div>`,
      submit: function (f, form) { if (!f.reason) return Q.fieldError(form, 'reason', 'Give a reason.'); try { ds.void(env, f.reason); } catch (e) { Q.toast(e.message, 'warn'); return; } Q.drawer.close(); Q.toast('Envelope voided'); Q.refresh(); } });
  };
  Q.act['ds-status'] = function (el) { var env = ds.byId(el.getAttribute('data-id')); ds.checkStatus(env); Q.toast('DocuSign: ' + ds.STATUS[env.status].toLowerCase()); Q.drawer.paint(); };

  // ---------- Envelope details ----------
  ds.openEnvelope = function (env, onClose) {
    var EV = { sent: 'Sent', delivered: 'Delivered', signed: 'Signed', completed: 'Completed', declined: 'Declined', voided: 'Voided', status: 'Status check' };
    Q.drawer.open({
      wide: true, kicker: 'DocuSign envelope · ' + env.purpose, title: env.subject.split(' · ')[0], onClose: onClose,
      body: function () {
        return h`<div class="row-wrap mb-16">${ds.statusChip(env)}<span class="small muted">Send ${ds.sendNo(env)} in the ${ds.yearRange(env.sentAt).label} allowance year</span>${env.correctionOf ? Q.chip('Correction send', 'chip-due') : ''}</div>
          <dl class="dl mb-16"><div style="grid-column:1/-1"><dt>Envelope ID</dt><dd class="mono">${env.id}</dd></div><div style="grid-column:1/-1"><dt>Subject</dt><dd>${env.subject}</dd></div>
            <div><dt>Record</dt><dd>${Q.recLink(env.record)}</dd></div><div><dt>Version</dt><dd>${env.version ? 'v' + env.version : '—'}</dd></div>
            <div><dt>Sent by</dt><dd>${Q.fullName(env.sentBy)}</dd></div><div><dt>Sent (UTC)</dt><dd>${Q.fmtUtc(env.sentAt)}</dd></div>
            <div><dt>Completed (UTC)</dt><dd>${Q.fmtUtc(env.completedAt)}</dd></div><div><dt>Verification check</dt><dd>${env.verification ? 'Passed · ' + Q.fullName(env.verification.by) + ', ' + Q.fmtShort(env.verification.at) : '—'}</dd></div>
            ${env.declineReason ? h`<div style="grid-column:1/-1"><dt>Declined by ${Q.fullName(env.declinedBy)}</dt><dd>${env.declineReason}</dd></div>` : ''}
            ${env.voidReason ? h`<div style="grid-column:1/-1"><dt>Voided by ${Q.fullName(env.voidedBy)}</dt><dd>${env.voidReason}</dd></div>` : ''}
            ${env.correctionOf ? h`<div style="grid-column:1/-1"><dt>Replaces</dt><dd class="mono">${env.correctionOf}</dd></div>` : ''}</dl>
          <div class="label mb-8">Signers (in order)</div>${signerList(env)}
          <div class="label mb-8 mt-24">Stored files</div>
          <div class="list-rows mb-16">
            <div class="list-row">${Q.icon('doc')}<div class="lr-main"><b>${env.pdf.name}</b><div class="small muted mono">SHA-256 ${env.pdf.hash.slice(0, 24)}…</div></div><button type="button" class="btn btn-sm" data-act="ds-preview-env" data-id="${env.id}">View</button></div>
            ${env.signedPdf ? h`<div class="list-row">${Q.icon('sign')}<div class="lr-main"><b>${env.signedPdf.name}</b><div class="small muted mono">SHA-256 ${env.signedPdf.hash.slice(0, 24)}…</div></div><button type="button" class="btn btn-sm" data-act="ds-signed" data-id="${env.id}">View</button></div>
              <div class="list-row">${Q.icon('check')}<div class="lr-main"><b>${env.certificate.name}</b><div class="small muted">Certificate of completion</div></div><button type="button" class="btn btn-sm" data-act="ds-cert" data-id="${env.id}">View</button></div>` : h`<p class="small muted" style="margin:8px 0">The signed PDF and certificate of completion are stored when the envelope completes.</p>`}</div>
          <div class="label mb-8">Status history (from DocuSign Connect)</div>
          <div class="timeline">${env.events.slice().reverse().map(function (e) { return h`<div class="ev ${e.type === 'signed' || e.type === 'completed' ? 'sig' : e.type === 'declined' || e.type === 'voided' ? 'warn' : 'state'}"><b>${EV[e.type] || e.type}</b>${e.u ? ' · ' + Q.fullName(e.u) : ''}${e.detail ? ' · ' + e.detail : ''}<span class="when">${Q.fmtUtc(e.at)}</span></div>`; })}</div>`;
      },
      foot: function () { return h`${ds.myTurn(env) ? h`<button class="btn btn-primary" type="button" data-act="ds-open-sign" data-id="${env.id}">Sign in DocuSign</button>` : ''}${env.status === 'sent' ? h`<button class="btn" type="button" data-act="ds-status" data-id="${env.id}">Check status</button>` : ''}${ds.canVoid(env) ? h`<button class="btn btn-danger" type="button" data-act="ds-void" data-id="${env.id}">Void envelope</button>` : ''}<button class="btn" type="button" data-act="drawer-close">Close</button>`; }
    });
  };
  Q.act['ds-env'] = function (el) { ds.openEnvelope(ds.byId(el.getAttribute('data-id'))); };

  // ---------- PDF views (prototype: printable HTML) ----------
  function recordHtml(rid, ver) {
    var k = Q.kindOf(rid), r = Q.rec(rid);
    if (k === 'doc') { var v = r.versions.find(function (x) { return x.v === ver; }) || Q.curVer(r); return Q.docHtml(r, v, true); }
    var pc = r.pendingClosure || {};
    var lines = k === 'capa' ? [['Problem', r.problem], ['Root cause', r.rootWhy != null ? r.whys[r.rootWhy] : '—'], ['Actions', r.actions.map(function (a) { return a.type + ': ' + a.title + ' (' + a.status + ')'; }).join('; ')], ['Success criteria', r.effectiveness.criteria], ['Result', pc.result || r.effectiveness.result || '—'], ['Verdict', pc.verdict || r.effectiveness.verdict || '—']]
      : [['Type', r.type], ['Description', r.desc], ['Assessment', r.assessment], ['Justification for closing without CAPA', pc.justification || (r.closure || {}).justification || '—']];
    return '<h1>' + Q.esc(rid + ' ' + r.title) + '</h1><p><b>' + (k === 'capa' ? 'CAPA closure' : 'Deviation closure') + '</b> · ' + Q.esc(r.classification || 'Internal') + ' · Owner: ' + Q.esc(Q.fullName(r.owner)) + '</p><table>' + lines.map(function (l) { return '<tr><th style="width:28%">' + Q.esc(l[0]) + '</th><td>' + Q.esc(l[1] || '') + '</td></tr>'; }).join('') + '</table>';
  }
  Q.act['ds-preview'] = function (el) { var rid = el.getAttribute('data-id'); Q.printHtml(rid + ' approval PDF', recordHtml(rid) + '<div class="foot">PDF prepared for DocuSign. Page 1 of 1.</div>', 'PDF check before DocuSign send for ' + rid); };
  Q.act['ds-preview-env'] = function (el) { var env = ds.byId(el.getAttribute('data-id')); Q.printHtml(env.pdf.name, recordHtml(env.record, env.version) + '<div class="foot">' + Q.esc(env.pdf.name) + ' · SHA-256 <span class="mono">' + env.pdf.hash + '</span></div>', 'Envelope PDF ' + env.pdf.name); };
  Q.act['ds-signed'] = function (el) {
    var env = ds.byId(el.getAttribute('data-id'));
    var page = '<h2 style="page-break-before:always">DocuSign signatures</h2><p>Envelope ID <span class="mono">' + env.id + '</span> · ' + Q.esc(env.subject) + '</p><table><tr><th>Order</th><th>Signer</th><th>Role</th><th>Meaning</th><th>Signed (UTC)</th></tr>' +
      env.signers.map(function (s) { return '<tr><td>' + s.order + '</td><td>' + Q.esc(Q.fullName(s.u)) + '</td><td>' + Q.esc(s.role) + '</td><td>' + Q.esc(s.meaning) + '</td><td>' + Q.fmtUtc(s.at) + '</td></tr>'; }).join('') + '</table><p>Each signer re-authenticated in DocuSign (Part 11 module) and chose the meaning shown.</p>';
    Q.printHtml(env.signedPdf.name, recordHtml(env.record, env.version) + page + '<div class="foot">' + Q.esc(env.signedPdf.name) + ' · SHA-256 <span class="mono">' + env.signedPdf.hash + '</span></div>', 'Signed PDF ' + env.signedPdf.name);
  };
  Q.act['ds-cert'] = function (el) {
    var env = ds.byId(el.getAttribute('data-id'));
    Q.printHtml(env.certificate.name, '<h1>Certificate of completion</h1><p>Prototype rendering of the DocuSign certificate stored with the record.</p><table>' +
      [['Envelope ID', env.id], ['Subject', env.subject], ['Status', 'Completed'], ['Envelope originator', Q.fullName(env.sentBy)], ['Sent (UTC)', Q.fmtUtc(env.sentAt)], ['Completed (UTC)', Q.fmtUtc(env.completedAt)], ['Document', env.pdf.name + ' · SHA-256 ' + env.pdf.hash]].map(function (r) { return '<tr><th style="width:28%">' + Q.esc(r[0]) + '</th><td>' + Q.esc(r[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<h2>Signer events</h2><table><tr><th>Signer</th><th>Meaning</th><th>Sent</th><th>Signed (UTC)</th><th>Authentication</th></tr>' + env.signers.map(function (s) { return '<tr><td>' + Q.esc(Q.fullName(s.u)) + '<br><span class="mono">' + Q.esc(Q.user(s.u).email || '') + '</span></td><td>' + Q.esc(s.meaning) + '</td><td>' + Q.fmtUtc(s.sentAt || env.sentAt) + '</td><td>' + Q.fmtUtc(s.at) + '</td><td>Part 11 re-authentication</td></tr>'; }).join('') + '</table>' +
      '<div class="foot">' + Q.esc(env.certificate.name) + '</div>', 'Certificate of completion ' + env.certificate.name);
  };

  // ---------- Register: approvals and DocuSign sends ----------
  function sendRows(list) {
    var rows = [['Send no.', 'Sent (UTC)', 'Envelope ID', 'Subject', 'Record', 'Version', 'Purpose', 'Sent by', 'Status', 'Signed', 'Completed (UTC)', 'Correction of', 'Reason (declined or voided)']];
    list.forEach(function (e) { rows.push([ds.sendNo(e), Q.fmtUtc(e.sentAt), e.id, e.subject, e.record, e.version || '', e.purpose, Q.fullName(e.sentBy), ds.STATUS[e.status], ds.signedCount(e) + ' of ' + e.signers.length, e.completedAt ? Q.fmtUtc(e.completedAt) : '', e.correctionOf || '', e.declineReason || e.voidReason || '']); });
    return rows;
  }
  function approvalRows(list) {
    var rows = [['Record', 'Version', 'Title', 'Purpose', 'Approved (UTC)', 'Signers and meanings', 'Envelope ID', 'Signed PDF', 'Certificate of completion']];
    list.forEach(function (e) { var r = Q.rec(e.record); rows.push([e.record, e.version || '', r ? r.title : '', e.purpose, Q.fmtUtc(e.completedAt), e.signers.map(function (s) { return Q.fullName(s.u) + ' (' + s.meaning + ', ' + Q.fmtUtc(s.at) + ')'; }).join('; '), e.id, e.signedPdf.name, e.certificate.name]); });
    return rows;
  }
  Q.views.approvals = function (p, q) {
    if (!Q.can('approvals.view')) return Q.views.denied('Approvals and DocuSign');
    var tab = q.tab || 'sends';
    var range = ds.yearRange();
    var all = Q.S.envelopes.filter(function (e) { var r = Q.rec(e.record); return r && Q.canSee(r); });
    var yearList = q.year === 'all' ? all : all.filter(function (e) { return e.sentAt >= range.start && e.sentAt < range.end; });
    var list = q.st ? yearList.filter(function (e) { return e.status === q.st; }) : yearList;
    var out = all.filter(function (e) { return e.status === 'sent'; });
    var thisYear = ds.sends();
    var corrections = thisYear.filter(function (e) { return e.status === 'voided' || e.status === 'declined'; }).length;
    if (q.env) Q.after(function () { var e = ds.byId(q.env); if (e) ds.openEnvelope(e, function () { if (Q.current.query.env) Q.setQuery({ env: '' }); }); });
    var body;
    if (tab === 'register') {
      var done = all.filter(function (e) { return e.status === 'completed'; }).sort(Q.by('completedAt', -1));
      Q.reports.approvals = { title: 'Register of approvals', file: 'approvals-register', rows: function () { return approvalRows(done); }, intro: 'Approvals completed through DocuSign (Part 11). Approvals before go-live were made in KSTARRS and are shown on each document’s version history.' };
      body = h`<div class="spread mb-16" style="flex-wrap:wrap"><p class="muted" style="margin:0">Every completed approval, with its signers and meanings, envelope ID, signed PDF and certificate of completion.</p>${Q.reportButtons('approvals')}</div>
        ${Q.table({ id: 'apreg', rows: done.map(function (e) { var r = Q.rec(e.record); return Object.assign({ title: r ? r.title : '' }, e); }), defaultSort: 'completedAt', defaultDir: -1, href: function (e) { return '#/approvals?tab=register&env=' + e.id; }, empty: 'No completed approvals yet.',
          cols: [{ key: 'record', label: 'Record', render: function (e) { return h`<a href="${Q.recHref(e.record)}">${e.record}</a>`; } }, { key: 'version', label: 'Version', render: function (e) { return e.version ? 'v' + e.version : '—'; } }, { key: 'title', label: 'Title' }, { key: 'purpose', label: 'Purpose' },
            { key: 'completedAt', label: 'Approved', render: function (e) { return Q.fmtDateTime(e.completedAt); } }, { key: 'signers', label: 'Signers', sort: false, render: function (e) { return h`<span class="small">${e.signers.map(function (s) { return Q.user(s.u).initials + ' · ' + s.meaning; }).join(', ')}</span>`; } },
            { key: 'id', label: 'Envelope', render: function (e) { return h`<span class="mono">${short(e.id)}</span>`; } }] })}`;
    } else {
      Q.reports.sends = { title: 'DocuSign sends log', file: 'docusign-sends', rows: function () { return sendRows(list.slice().sort(Q.by('sentAt'))); }, intro: 'Every envelope sent. Allowance: ' + ds.cfg().allowance + ' sends a year (' + range.label + '); ' + ds.used() + ' used, ' + ds.remaining() + ' remaining.' };
      body = h`<div class="toolbar"><select class="select" data-change="qfilter" data-key="year" aria-label="Period"><option value="">This allowance year</option><option value="all" ${q.year === 'all' ? 'selected' : ''}>All years</option></select>
          <select class="select" data-change="qfilter" data-key="st" aria-label="Status"><option value="">Any status</option>${Object.keys(ds.STATUS).map(function (k) { return h`<option value="${k}" ${q.st === k ? 'selected' : ''}>${ds.STATUS[k]}</option>`; })}</select>
          <span style="margin-left:auto">${Q.reportButtons('sends')}</span></div>
        ${Q.table({ id: 'sends', rows: list, defaultSort: 'sentAt', defaultDir: -1, href: function (e) { return '#/approvals?tab=sends&env=' + e.id + (q.year ? '&year=' + q.year : '') + (q.st ? '&st=' + q.st : ''); }, empty: 'No envelopes match.',
          cols: [{ key: 'no', label: 'Send', sortVal: function (e) { return e.sentAt; }, render: function (e) { return h`<b>${ds.sendNo(e)}</b>`; } }, { key: 'sentAt', label: 'Sent', render: function (e) { return Q.fmtDateTime(e.sentAt); } },
            { key: 'subject', label: 'Subject', render: function (e) { return h`${e.subject}${e.correctionOf ? h` <span class="chip chip-due">Correction</span>` : ''}`; } }, { key: 'sentBy', label: 'Sent by', render: function (e) { return Q.fullName(e.sentBy); } },
            { key: 'status', label: 'Status', render: function (e) { return ds.statusChip(e); } }, { key: 'signed', label: 'Signed', sort: false, render: function (e) { return ds.signedCount(e) + ' of ' + e.signers.length; } },
            { key: 'id', label: 'Envelope', render: function (e) { return h`<span class="mono">${short(e.id)}</span>`; } }] })}`;
    }
    return h`<div class="page-head"><div><h1>Approvals and DocuSign</h1><div class="sub">Part 11 approvals for controlled documents, CAPAs, deviations, vendor approvals and validation deliverables. One envelope per version.</div></div></div>
      ${Q.tip('approvals', h`<b>Approvals and DocuSign.</b> Every approval is one DocuSign envelope holding all signers: author, then reviewers, then QA approver. Each envelope counts as one send against the allowance of ${ds.cfg().allowance} a year. A correction after sending is a second send.`)}
      <div class="grid-4 mb-16">${ds.allowanceKpi()}
        <div class="card kpi"><div class="kpi-label">Out for signature</div><div class="kpi-value">${out.length}</div><div class="kpi-sub">${out.map(function (e) { return e.record; }).join(', ') || 'None'}</div></div>
        <div class="card kpi"><div class="kpi-label">Completed this year</div><div class="kpi-value">${thisYear.filter(function (e) { return e.status === 'completed'; }).length}</div><div class="kpi-sub">signed PDF and certificate stored</div></div>
        <div class="card kpi"><div class="kpi-label">Voided or declined</div><div class="kpi-value" style="${corrections ? 'color:var(--overdue)' : ''}">${corrections}</div><div class="kpi-sub">each correction costs another send</div></div></div>
      <div class="tabs" role="tablist">${[['sends', 'DocuSign sends'], ['register', 'Register of approvals']].map(function (t) { return h`<button class="tab ${tab === t[0] ? 'active' : ''}" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>
      ${body}`;
  };
})(window.Q);
