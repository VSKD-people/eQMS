/* SharePoint as the file store (PJ Walters, 24 November 2026). SIMULATED in the prototype: nothing leaves the browser.
   Two libraries on one site. Drafts: one Word file per document, edited by its author (the stand-in editor here).
   Controlled: the locked PDF of every Effective version, written only by VeQMS; superseded files stay, marked Superseded.
   VeQMS is the master record: a version is Effective whether or not its published copy has reached SharePoint yet.
   The delta sync reads both libraries' changes; a change in the controlled library not made by VeQMS raises an
   integrity alert for QA, and so does the nightly hash check when a published file no longer matches its locked PDF.
   In production: Microsoft Graph with Sites.Selected (write role on the QMS site), every 15 minutes and on "Sync now". */
(function (Q) {
  'use strict';
  var sp = Q.sp = {};
  function now() { return new Date().toISOString(); }
  function me() { return Q.S.session.userId; }
  var ATTEMPTS = 5; // publishing retries before a version goes to the dead-letter queue

  sp.state = function () { return Q.S.sharepoint || (Q.S.sharepoint = { runs: {}, hashCheck: null, alerts: [], pending: [] }); };
  sp.on = function () { return Q.integrationOn('sp-pub'); };
  sp.KIND = { 'outside-change': 'Changed outside VeQMS', missing: 'File missing', 'hash-mismatch': 'Hash mismatch', 'publish-failed': 'Publish failed' };
  sp.fileName = function (d, v) { return d.id + ' v' + v.v + '.pdf'; };
  function qms() { return Q.activeUsers().filter(function (u) { return u.roles.indexOf('qm') >= 0; }).map(function (u) { return u.id; }); }
  function lockedHash(v) { return v.pdf ? v.pdf.hash : v.hash; }
  function eachVersion(fn) { Object.keys(Q.S.docs).forEach(function (k) { var d = Q.S.docs[k]; d.versions.forEach(function (v) { fn(d, v); }); }); }
  sp.version = function (docId, ver) { var d = Q.S.docs[docId]; return d ? d.versions.find(function (x) { return x.v === ver; }) || null : null; };

  // ---------- Integrity alerts ----------
  // Raised once: an open alert of the same kind for the same version isn't repeated. QA is told and it is audited.
  sp.raise = function (a) {
    var st = sp.state();
    if (st.alerts.some(function (x) { return !x.resolvedAt && x.kind === a.kind && x.doc === (a.doc || null) && x.ver === (a.ver || null); })) return null;
    Q.S.counters.IA = (Q.S.counters.IA || 0) + 1;
    var al = { id: 'IA-' + Q.S.counters.IA, kind: a.kind, library: a.library || 'controlled', doc: a.doc || null, ver: a.ver || null, detail: a.detail, raisedAt: now(), resolvedAt: null, resolvedBy: null, resolution: null };
    st.alerts.unshift(al);
    Q.audit('integrity.alert', al.doc ? 'Document' : 'SharePoint', al.doc || 'controlled library', 'Integrity alert ' + al.id + ' (' + sp.KIND[al.kind].toLowerCase() + '): ' + al.detail, null, { alert: al.id, kind: al.kind, library: al.library }, { actor: 'system' });
    Q.notify({ to: qms(), kind: 'security', mandatory: true, channels: ['in-app', 'email'], record: al.doc, title: 'Integrity alert: ' + (al.doc ? al.doc + (al.ver ? ' v' + al.ver : '') : 'SharePoint') + ' · ' + sp.KIND[al.kind].toLowerCase(), body: al.detail, href: '#/admin/sharepoint' });
    return al;
  };
  sp.openAlerts = function () { return sp.state().alerts.filter(function (a) { return !a.resolvedAt; }); };
  sp.canResolve = function () { return Q.can('integrity.resolve') && !Q.readOnly(); };
  // Does the version's file in the controlled library differ from its locked PDF (changed, missing or not published)?
  sp.needsRestore = function (al) {
    var v = al && al.doc && sp.version(al.doc, al.ver);
    return !!(v && v.publish && (v.publish.status === 'failed' || v.publish.deleted || v.publish.fileHash !== v.publish.hash));
  };
  // A Quality Manager resolves an alert with a note of what was found and done. A resolved alert is final.
  sp.resolve = function (id, note, restore) {
    if (!sp.canResolve()) throw new Error('Only a Quality Manager can resolve an integrity alert.');
    var al = sp.state().alerts.find(function (x) { return x.id === id; });
    if (!al) throw new Error('That alert doesn’t exist.');
    if (al.resolvedAt) throw new Error('This alert is already resolved. A resolved alert is final.');
    note = (note || '').trim();
    if (note.length < 10) throw new Error('Say what was found and done (at least a short sentence).');
    al.resolvedAt = now(); al.resolvedBy = me(); al.resolution = note;
    Q.audit('integrity.resolve', al.doc ? 'Document' : 'SharePoint', al.doc || 'controlled library', 'Integrity alert ' + al.id + ' (' + sp.KIND[al.kind].toLowerCase() + ') resolved by ' + Q.fullName(me()) + ': ' + note, { resolved: false }, { resolved: true, resolution: note });
    if (restore && sp.needsRestore(al)) sp.restore(al.doc, al.ver);
    Q.save();
    return al;
  };

  // ---------- Publishing (the only write path into the controlled library) ----------
  sp.publish = function (d, v) {
    v.publish = { status: 'pending', name: sp.fileName(d, v), hash: lockedHash(v), fileHash: null, attempts: 0, error: null, at: null };
    return sp.publishPending();
  };
  // Upload every version waiting to publish, with its columns (number, version, status, effective date, SHA-256), and
  // mark the files of versions no longer effective. A failure is retried; after ATTEMPTS it goes to the dead-letter
  // queue and QA gets an integrity alert.
  sp.publishPending = function () {
    var out = { published: 0, failed: 0, marked: 0 };
    eachVersion(function (d, v) {
      var p = v.publish;
      if (!p) return;
      if (p.status === 'pending') {
        if (!sp.on()) {
          p.attempts = ATTEMPTS; p.error = 'The SharePoint connector is switched off.'; p.status = 'failed';
          Q.S.deadLetter.unshift({ id: Q.uid('DLQ'), rule: 'Publishing', at: now(), record: d.id, channel: 'SharePoint', target: 'Controlled library', attempts: ATTEMPTS, error: p.error, status: 'Failed' });
          sp.raise({ kind: 'publish-failed', doc: d.id, ver: v.v, detail: d.id + ' v' + v.v + ' could not be published to the controlled library after ' + ATTEMPTS + ' attempts: ' + p.error + ' It is Effective in VeQMS; publish it again once the cause is fixed.' });
          out.failed++; return;
        }
        p.status = 'published'; p.at = now(); p.hash = lockedHash(v); p.fileHash = p.hash; p.deleted = false; p.fileStatus = 'Effective'; p.attempts++; p.error = null;
        Q.audit('publish', 'Document', d.id, 'Published ' + d.id + ' v' + v.v + ' to the controlled SharePoint library as "' + p.name + '"', null, { file: p.name, sha256: p.hash, status: 'Effective' }, { actor: 'system' });
        out.published++;
      }
      if (p.status === 'published' && (v.state === 'Superseded' || v.state === 'Obsolete')) {
        p.status = 'superseded'; p.fileStatus = v.state;
        Q.audit('publish', 'Document', d.id, 'Marked the published file of ' + d.id + ' v' + v.v + ' ' + v.state + ' in the controlled library (it stays there)', { status: 'Effective' }, { status: v.state }, { actor: 'system' });
        out.marked++;
      }
    });
    return out;
  };
  // Publish the locked PDF again: after a failure, or over a file changed or deleted outside VeQMS.
  sp.restore = function (docId, ver) {
    var d = Q.S.docs[docId], v = sp.version(docId, ver);
    if (!v || !v.publish) throw new Error('Nothing to publish for ' + docId + ' v' + ver + '.');
    if (v.publish.status === 'failed') { v.publish.status = 'pending'; v.publish.attempts = 0; sp.publishPending(); return v.publish.status === 'published'; }
    v.publish.fileHash = v.publish.hash; v.publish.deleted = false; v.publish.at = now();
    Q.audit('publish', 'Document', d.id, 'Published the locked PDF of ' + d.id + ' v' + v.v + ' again over the file in the controlled library', null, { file: v.publish.name, sha256: v.publish.hash }, { actor: 'system' });
    return true;
  };

  // ---------- Delta sync ("Sync now"; every 15 minutes in production) ----------
  sp.sync = function () {
    var st = sp.state(), at = now();
    var pub = sp.publishPending();
    if (!sp.on()) {
      ['drafts', 'controlled'].forEach(function (lib) { st.runs[lib] = { at: at, outcome: 'Failed', changes: 0, alerts: 0, error: 'The SharePoint connector is switched off.' }; });
      Q.audit('sharepoint.sync', 'SharePoint', 'libraries', 'SharePoint sync failed: the connector is switched off', null, null);
      Q.save();
      return { outcome: 'Failed', published: 0, alerts: 0 };
    }
    var since = st.runs.drafts ? st.runs.drafts.at : '';
    var drafts = Object.keys(Q.S.docs).filter(function (k) { var d = Q.S.docs[k]; return d.draft && d.draft.editedAt > since; }).length;
    var changes = st.pending.splice(0), alerts = 0;
    changes.forEach(function (c) {
      var al = c.deleted
        ? sp.raise({ kind: 'missing', doc: c.doc, ver: c.ver, detail: 'The published file of ' + c.doc + ' v' + c.ver + ' (' + c.name + ') was deleted from the controlled library by ' + c.byName + ' at ' + Q.fmtUtc(c.at) + '. VeQMS still holds the locked PDF; publish it again.' })
        : sp.raise({ kind: 'outside-change', doc: c.doc, ver: c.ver, detail: c.name + ' (' + c.doc + ' v' + c.ver + ') was changed in the controlled library outside VeQMS by ' + c.byName + ' at ' + Q.fmtUtc(c.at) + '. Only VeQMS writes there: compare it with the locked PDF and restore it.' });
      if (al) alerts++;
    });
    st.runs.drafts = { at: at, outcome: 'OK', changes: drafts, alerts: 0 };
    st.runs.controlled = { at: at, outcome: 'OK', changes: changes.length + pub.published + pub.marked, alerts: alerts };
    Q.audit('sharepoint.sync', 'SharePoint', 'libraries', 'Synced the Drafts and Controlled libraries: ' + Q.plural(pub.published, 'version') + ' published, ' + Q.plural(drafts, 'draft') + ' edited, ' + Q.plural(changes.length, 'change') + ' made outside VeQMS, ' + Q.plural(alerts, 'integrity alert') + ' raised', null, { published: pub.published, marked: pub.marked, drafts: drafts, outside: changes.length, alerts: alerts });
    Q.save();
    return { outcome: 'OK', published: pub.published, alerts: alerts };
  };

  // ---------- Hash check (nightly in production) ----------
  // Every published Effective file is downloaded and its SHA-256 compared with the version's locked PDF.
  sp.hashCheck = function () {
    var out = { checked: 0, mismatches: 0, missing: 0 };
    eachVersion(function (d, v) {
      var p = v.publish;
      if (v.state !== 'Effective' || !p || p.status !== 'published') return;
      if (p.deleted) { out.missing++; sp.raise({ kind: 'missing', doc: d.id, ver: v.v, detail: 'The published file of ' + d.id + ' v' + v.v + ' is missing from the controlled library (hash check).' }); return; }
      out.checked++;
      if (p.fileHash !== p.hash) {
        out.mismatches++;
        sp.raise({ kind: 'hash-mismatch', doc: d.id, ver: v.v, detail: 'The published file of ' + d.id + ' v' + v.v + ' no longer matches its locked PDF (SHA-256 ' + p.fileHash.slice(0, 16) + '…, expected ' + p.hash.slice(0, 16) + '…).' });
      }
    });
    sp.state().hashCheck = { at: now(), checked: out.checked, mismatches: out.mismatches, missing: out.missing };
    Q.audit('integrity.check', 'SharePoint', 'controlled library', 'Hash check: ' + Q.plural(out.checked, 'published file') + ' checked, ' + out.mismatches + ' mismatched, ' + out.missing + ' missing', null, out);
    Q.save();
    return out;
  };

  // ---------- Demonstration only ----------
  // Someone edits or deletes the published file of an Effective version in SharePoint, outside VeQMS. Nothing happens
  // until the next sync reads the change.
  sp.simulateOutsideEdit = function (docId, how) {
    if (!Q.can('admin.settings') || Q.readOnly()) throw new Error('Only a System Administrator or Quality Manager can run the demonstration.');
    var d = Q.S.docs[docId], v = d && Q.effVer(d);
    if (!v || !v.publish || v.publish.status !== 'published' || v.publish.deleted) throw new Error(docId + ' has no published file to change. Sync first, so Effective versions are published.');
    if (how === 'delete') v.publish.deleted = true;
    else v.publish.fileHash = Q.sha256('outside edit:' + v.publish.hash + now());
    sp.state().pending.push({ library: 'controlled', doc: d.id, ver: v.v, name: v.publish.name, byName: Q.fullName(me()), at: now(), deleted: how === 'delete' });
    Q.audit('dev.simulate', 'Document', d.id, 'Simulated SharePoint: ' + (how === 'delete' ? 'deleted' : 'edited') + ' the published file of ' + d.id + ' v' + v.v + ' outside VeQMS', null, { file: v.publish.name, how: how === 'delete' ? 'delete' : 'edit' });
    Q.save();
  };
})(window.Q);
