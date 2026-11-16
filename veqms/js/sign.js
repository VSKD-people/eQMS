/* Electronic signature drawer: 1 Confirm → 2 Sign in again → 3 Recorded.
   Every signing action needs its own fresh re-authentication; a batch signs a listed set after one
   fresh sign-in, and each record still gets its own signature row. The sign-in here is SIMULATED. */
(function (Q) {
  'use strict';
  var h = Q.h;

  // o: { items:[{id, version, hash, label}], meaning, meanings, title, extra(st)->Raw, validate(form)->string|null,
  //      onSigned(sigs, form) }
  Q.sign = function (o) {
    var st = { step: 1, meaning: o.meaning || 'Approved', phase: 'start', form: {}, sigs: [], intentAt: null, error: null };
    var multi = o.items.length > 1;

    function steps() {
      return h`<div class="sign-steps" aria-label="Signing steps">
        <div class="${st.step === 1 ? 'on' : 'ok'}">1 Confirm</div>
        <div class="${st.step === 2 ? 'on' : st.step > 2 ? 'ok' : ''}">2 Sign in again</div>
        <div class="${st.step === 3 ? 'ok' : ''}">3 Recorded</div></div>`;
    }
    function body() {
      var me = Q.me();
      if (st.step === 1) {
        return h`${steps()}
          ${o.extra ? o.extra(st) : ''}
          <div class="field mb-16"><label for="sig-meaning">Meaning of your signature</label>
            <select class="select" id="sig-meaning" name="meaning" data-change="sig-meaning">${(o.meanings || [st.meaning]).map(function (m) { return h`<option ${m === st.meaning ? 'selected' : ''}>${m}</option>`; })}</select></div>
          <div class="statement mb-16"><div style="font-weight:600;margin-bottom:6px">Signature statement</div><div id="sig-statement">${Q.statementFor(st.meaning)}</div><div class="small muted mt-8">Text agreed by the Quality Manager (editable in Administration → Settings).</div></div>
          <dl class="dl mb-16"><div><dt>Signing as</dt><dd>${me.name}</dd></div><div><dt>${multi ? 'Records' : 'Version'}</dt><dd>${multi ? o.items.length + ' records, one signature each' : (o.items[0].version ? 'v' + o.items[0].version + ', content locked' : o.items[0].id)}</dd></div></dl>
          <div class="mb-16"><div class="small muted">Content fingerprint (SHA-256)</div>
            ${o.items.map(function (it) { return h`<div class="mt-8">${multi ? h`<div class="small" style="font-weight:600">${it.label || it.id}</div>` : ''}<div class="mono">${it.hash}</div></div>`; })}</div>
          <div class="callout"><strong>Next, you sign in again</strong><p style="margin:6px 0 0" class="small">Each signature needs a fresh sign-in with MFA, even if you signed in a minute ago. Fingerprint or face unlock on your phone does not count as a signature.</p></div>
          ${multi ? h`<p class="small muted mt-16">Signing a batch: one fresh sign-in covers the ${o.items.length} records listed; each record still gets its own signature.</p>` : ''}`;
      }
      if (st.step === 2) {
        return h`${steps()}
          <div class="idp">
            <div class="idp-head"><span class="idp-mark">${Q.icon('lock', 'ico-sm')}</span><div><div style="font-weight:600">Sign in again to sign</div><div class="small muted">Simulated identity provider · prototype only</div></div></div>
            <div class="small muted">Account</div><div style="font-weight:600;margin-bottom:16px">${me.email}</div>
            ${st.phase === 'start' ? h`<p class="small">A fresh sign-in is required. Your current session does not count.</p><button class="btn btn-primary" type="submit" style="width:100%">Sign in again</button>` : ''}
            ${st.phase === 'wait' ? h`<div class="row"><span class="spinner" aria-hidden="true"></span><span>Waiting for the identity provider…</span></div>` : ''}
            ${st.phase === 'mfa' ? h`<div class="field"><label for="otp">Enter the 6-digit code from your authenticator app</label><input class="input otp" id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" autofocus><div class="help">Prototype: any 6 digits work.</div>${st.error ? h`<div class="err">${st.error}</div>` : ''}</div><button class="btn btn-primary mt-16" type="submit" style="width:100%">Verify and sign</button>` : ''}
          </div>
          <p class="small muted mt-16">In production this is Microsoft Entra ID with <span class="mono">prompt=login</span> and Conditional Access authentication context <span class="mono">c1</span>. The API refuses the signature unless <span class="mono">auth_time</span> is later than the signing intent (${Q.fmtUtc(st.intentAt)}).</p>`;
      }
      return h`${steps()}
        <div class="callout ok mb-16"><strong>${st.sigs.length > 1 ? st.sigs.length + ' signatures recorded' : 'Signature recorded'}</strong><p class="small" style="margin:6px 0 0">Stored insert-only and attached to the record. It cannot be edited or detached.</p></div>
        ${st.sigs.map(function (s) { return h`<div class="card card-pad mb-8" style="padding:14px 16px"><dl class="dl">
          <div><dt>Signature</dt><dd>${s.id}</dd></div><div><dt>Record</dt><dd>${s.record}${s.version ? ' v' + s.version : ''}</dd></div>
          <div><dt>Signer</dt><dd>${Q.fullName(s.user)}</dd></div><div><dt>Meaning</dt><dd>${s.meaning}</dd></div>
          <div><dt>Signed (UTC)</dt><dd>${Q.fmtUtc(s.at)}</dd></div><div><dt>Fresh sign-in (auth_time)</dt><dd>${Q.fmtUtc(s.authAt)}</dd></div>
          <div style="grid-column:1/-1"><dt>Content fingerprint (SHA-256)</dt><dd class="mono">${s.hash}</dd></div></dl></div>`; })}`;
    }
    function foot() {
      if (st.step === 1) return h`<button class="btn btn-primary" type="submit">Continue to sign-in</button><button class="btn" type="button" data-act="drawer-close">Cancel</button>`;
      if (st.step === 2) return h`<button class="btn" type="button" data-act="sig-back">Back</button><button class="btn" type="button" data-act="drawer-close">Cancel</button>`;
      return h`<button class="btn btn-primary" type="button" data-act="drawer-close">Done</button>`;
    }
    Q.on['sig-meaning'] = function (el) { st.meaning = el.value; var s = document.getElementById('sig-statement'); if (s) s.textContent = Q.statementFor(st.meaning); };
    Q.act['sig-back'] = function () { st.step = 1; st.phase = 'start'; Q.drawer.paint(); };

    Q.drawer.open({
      kicker: 'Electronic signature', title: o.title || ('Sign ' + o.items.map(function (i) { return i.id + (i.version ? ' v' + i.version : ''); }).join(', ')),
      body: body, foot: foot,
      submit: function (f, form) {
        if (st.step === 1) {
          if (o.validate) { var err = o.validate(f, form); if (err) { if (typeof err === 'object') Q.fieldError(form, err.field, err.msg); else Q.toast(err, 'warn'); return; } }
          st.form = f; st.meaning = f.meaning || st.meaning; st.intentAt = new Date().toISOString();
          Q.audit('sign.intent', 'Signature', o.items.map(function (i) { return i.id; }).join(','), 'Signing intent recorded for ' + o.items.length + ' record(s) · ' + st.meaning);
          st.step = 2; st.phase = 'start'; Q.drawer.paint(); Q.drawer.focusFirst(); return;
        }
        if (st.step === 2 && st.phase === 'start') {
          st.phase = 'wait'; Q.drawer.paint();
          setTimeout(function () { if (!Q.drawer.isOpen()) return; st.phase = 'mfa'; Q.drawer.paint(); var i = document.getElementById('otp'); if (i) i.focus(); }, 900);
          return;
        }
        if (st.step === 2 && st.phase === 'mfa') {
          if (!/^\d{6}$/.test(f.otp || '')) { st.error = 'Enter 6 digits.'; Q.drawer.paint(); var i = document.getElementById('otp'); if (i) i.focus(); return; }
          var authAt = new Date(Math.max(Date.now(), new Date(st.intentAt).getTime() + 1000)).toISOString();
          Q.audit('login.stepup', 'Session', Q.S.session.userId, 'Fresh sign-in with MFA for signing (acrs c1)');
          st.sigs = o.items.map(function (it) { return Q.makeSignature({ record: it.id, version: it.version, meaning: st.meaning, authAt: authAt, hash: it.hash, stage: it.stage }); });
          try { o.onSigned(st.sigs, st.form); } catch (e) { console.error(e); }
          st.step = 3; Q.save(); Q.drawer.update({ onClose: function () { Q.render({ keepScroll: true }); } });
          var done = document.querySelector('.drawer-foot .btn'); if (done) done.focus();
        }
      }
    });
  };
})(window.Q);
