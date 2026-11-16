/* Analytics: KPIs and charts, every chart drills down to its records ("Full report") and exports. Respects RBAC. */
(function (Q) {
  'use strict';
  var h = Q.h;
  function vals(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
  function within(iso, from, to) { var n = Q.daysFromToday(iso); return n !== null && n >= -to && n < -from + 1; }

  function data(days) {
    var docs = vals(Q.S.docs).filter(function (d) { return Q.canSee(d); });
    var crs = vals(Q.S.crs).filter(function (c) { return Q.canSee(c); });
    var evs = vals(Q.S.events).filter(function (e) { return Q.canSee(e); });
    var capas = vals(Q.S.capas).filter(function (c) { return Q.canSee(c); });
    var reviews = vals(Q.S.reviews).filter(function (r) { return Q.S.docs[r.doc] && Q.canSee(Q.S.docs[r.doc]); });
    var asg = Q.S.assignments.filter(function (a) { return !a.leaver; });
    var versions = []; docs.forEach(function (d) { d.versions.forEach(function (v) { versions.push({ doc: d.id, title: d.title, v: v.v, kind: v.kind, state: v.state, created: v.created, by: v.createdBy }); }); });
    return { docs: docs, crs: crs, evs: evs, capas: capas, reviews: reviews, asg: asg, versions: versions, days: days };
  }
  function rpt(title, rows) { Q.ui.reports = Q.ui.reports || {}; var k = 'r' + Object.keys(Q.ui.reports).length; Q.ui.reports[k] = { title: title, rows: rows }; return k; }
  function fullLink(key) { return h`<button class="btn-link" style="min-height:32px;font-size:13px" data-act="full-report" data-k="${key}">Full report</button>`; }
  Q.act['full-report'] = function (el) {
    var r = Q.ui.reports[el.getAttribute('data-k')]; if (!r) return;
    var head = r.rows[0], body = r.rows.slice(1);
    Q.drawer.open({ wide: true, kicker: 'Full report', title: r.title, sub: Q.plural(body.length, 'record') + ' · only records you can see',
      body: h`<div class="table-wrap"><table class="t"><thead><tr>${head.map(function (c) { return h`<th scope="col">${c}</th>`; })}</tr></thead><tbody>${body.length ? body.map(function (row) { return h`<tr>${row.map(function (c, i) { return i === 0 && Q.rec(String(c)) ? h`<td class="id"><a href="${Q.recHref(String(c))}" data-act="drawer-close-go" data-href="${Q.recHref(String(c))}">${c}</a></td>` : h`<td>${c}</td>`; })}</tr>`; }) : h`<tr><td colspan="${head.length}"><div class="empty">No records.</div></td></tr>`}</tbody></table></div>`,
      foot: h`<button class="btn btn-primary" type="button" data-act="report-export" data-k="${el.getAttribute('data-k')}">Export CSV</button><button class="btn" type="button" data-act="drawer-close">Close</button>` });
  };
  Q.act['drawer-close-go'] = function (el) { Q.drawer.close(); Q.go(el.getAttribute('data-href')); };
  Q.act['report-export'] = function (el) { var r = Q.ui.reports[el.getAttribute('data-k')]; Q.exportCsv(r.title.toLowerCase().replace(/\W+/g, '-') + '.csv', r.rows, 'analytics report: ' + r.title); };

  function hbar(rows, max, opts) {
    opts = opts || {};
    max = max || Math.max.apply(null, rows.map(function (r) { return r[1]; }).concat([1]));
    return h`<div class="hbar" role="list">${rows.map(function (r) { return h`<span role="listitem">${r[0]}</span><div class="bar-track"><div class="bar" style="width:${Math.max(1, (r[1] / max) * 100)}%;${r[2] ? 'background:' + r[2] : ''}"></div></div><span class="v">${r[1]}${opts.unit || ''}</span>`; })}</div>`;
  }
  function weekly(d) {
    // Due vs overdue per week for the last 8 weeks (training). Real assignments plus sample history for earlier weeks.
    var weeks = [];
    for (var w = 7; w >= 0; w--) {
      var from = w * 7 + 6, to = w * 7;
      var due = d.asg.filter(function (a) { var n = -Q.daysFromToday(a.due); return n >= to && n <= from; });
      var od = due.filter(function (a) { return !a.completed || a.completed > a.due; });
      var sampleDue = [6, 9, 5, 11, 7, 8, 4, 0][7 - w], sampleOd = [1, 3, 1, 2, 2, 1, 1, 0][7 - w];
      weeks.push({ label: Q.fmtShort(Q.addDays(Q.today(), -from)), due: due.length + sampleDue, od: od.length + sampleOd });
    }
    var max = Math.max.apply(null, weeks.map(function (x) { return x.due; }).concat([1]));
    var W = 560, H = 200, pad = 28, bw = (W - pad) / weeks.length;
    var bars = weeks.map(function (x, i) {
      var x0 = pad + i * bw + 6, w2 = (bw - 16) / 2;
      var h1 = (x.due / max) * (H - 40), h2 = (x.od / max) * (H - 40);
      return '<rect x="' + x0 + '" y="' + (H - 20 - h1) + '" width="' + w2 + '" height="' + h1 + '" rx="2" fill="var(--chart-due)"><title>' + x.label + ': ' + x.due + ' due</title></rect>' +
        '<rect x="' + (x0 + w2 + 2) + '" y="' + (H - 20 - h2) + '" width="' + w2 + '" height="' + h2 + '" rx="2" fill="var(--chart-overdue)"><title>' + x.label + ': ' + x.od + ' overdue</title></rect>' +
        '<text x="' + (x0 + w2) + '" y="' + (H - 4) + '" text-anchor="middle">' + x.label + '</text>';
    }).join('');
    var grid = [0.5, 1].map(function (f) { var y = H - 20 - f * (H - 40); return '<line class="grid" x1="' + pad + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" /><text x="0" y="' + (y + 4) + '">' + Math.round(max * f) + '</text>'; }).join('');
    return { svg: Q.raw('<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Training due versus overdue by week">' + grid + bars + '</svg>'), weeks: weeks };
  }

  Q.views.analytics = function (p, q) {
    if (!Q.can('analytics')) return Q.views.denied('Analytics');
    Q.ui.reports = {};
    var days = +(q.days || 90);
    var d = data(days);
    var tab = q.tab || 'overview';
    var tabs = [['overview', 'Overview'], ['documents', 'Documents'], ['training', 'Training'], ['changes', 'Change requests'], ['quality', 'Quality events and CAPA'], ['reviews', 'Periodic reviews'], ['actions', 'Actions']];
    var body = { overview: overview, documents: documents, training: training, changes: changes, quality: quality, reviews: reviews, actions: actions }[tab](d);
    return h`<div class="page-head"><div><h1 class="display">Analytics</h1><div class="sub">You see only records you have access to. Last ${days} days vs the ${days} days before.</div></div>
      <div class="btn-row"><select class="select" style="width:auto" data-change="qfilter" data-key="days" aria-label="Period"><option value="30" ${days === 30 ? 'selected' : ''}>Last 30 days</option><option value="90" ${days === 90 ? 'selected' : ''}>Last 90 days</option><option value="365" ${days === 365 ? 'selected' : ''}>Last 12 months</option></select><button class="btn" data-act="an-export">Export</button></div></div>
      <div class="tabs" role="tablist">${tabs.map(function (t) { return h`<button class="tab ${tab === t[0] ? 'active' : ''}" role="tab" aria-selected="${tab === t[0]}" data-act="tab" data-tab="${t[0]}">${t[1]}</button>`; })}</div>
      ${body}
      <p class="small muted mt-24">Prototype: charts use the sample records, plus sample history for earlier weeks so trends are visible.</p>`;
  };

  function kpis(d) {
    var dueNow = d.asg.filter(function (a) { return !a.completed; });
    var od = dueNow.filter(function (a) { return Q.daysFromToday(a.due) < 0; });
    var closed = d.capas.filter(function (c) { return c.state === 'Closed'; });
    var onTime = closed.filter(function (c) { return c.actions.every(function (a) { return !a.doneAt || a.doneAt <= a.due; }); });
    var vNow = d.versions.filter(function (v) { return within(v.created, 0, d.days); });
    var vPrev = d.versions.filter(function (v) { return within(v.created, d.days, d.days * 2); });
    var rOd = d.reviews.filter(function (r) { return Q.reviewStatus(r) === 'Overdue'; });
    return { dueNow: dueNow, od: od, closed: closed, onTime: onTime, vNow: vNow, vPrev: vPrev, rOd: rOd };
  }
  function kpiRow(d) {
    var k = kpis(d);
    var r1 = rpt('Training overdue', [['Document', 'Person', 'Version', 'Due', 'Rule']].concat(k.od.map(function (a) { return [a.doc, Q.fullName(a.user), a.ver, Q.fmtDate(a.due), a.rule]; })));
    var r2 = rpt('CAPA closed', [['CAPA', 'Title', 'Severity', 'Closed', 'On time']].concat(k.closed.map(function (c) { return [c.id, c.title, c.severity, Q.fmtDate(c.closedAt), k.onTime.indexOf(c) >= 0 ? 'Yes' : 'No']; })));
    var r3 = rpt('Documents and versions created', [['Document', 'Title', 'Version', 'Kind', 'State', 'Created', 'Author']].concat(k.vNow.map(function (v) { return [v.doc, v.title, v.v, v.kind, v.state, Q.fmtDate(v.created), Q.fullName(v.by)]; })));
    var r4 = rpt('Periodic reviews overdue', [['Review', 'Document', 'Reviewer', 'Due']].concat(k.rOd.map(function (r) { return [r.id, r.doc, Q.fullName(r.reviewer), Q.fmtDate(r.due)]; })));
    var owners = k.rOd.map(function (r) { return r.reviewer; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).length;
    var pctNow = Q.pct(k.onTime.length, k.closed.length), prior = 67;
    return h`<div class="grid-4 mb-16">
      <div class="card kpi"><div class="spread"><span class="kpi-label">Training overdue</span>${fullLink(r1)}</div><div class="kpi-value" style="${k.od.length ? 'color:var(--overdue)' : ''}">${k.od.length}</div><div class="kpi-sub">of ${k.dueNow.length} due</div></div>
      <div class="card kpi"><div class="spread"><span class="kpi-label">CAPA closed on time</span>${fullLink(r2)}</div><div class="kpi-value">${pctNow}%</div><div class="kpi-sub"><span class="${pctNow >= prior ? 'trend-up' : 'trend-down'}">${pctNow >= prior ? '▲' : '▼'} ${Math.abs(pctNow - prior)} pts</span> vs ${prior}% prior period</div></div>
      <div class="card kpi"><div class="spread"><span class="kpi-label">Documents and versions created</span>${fullLink(r3)}</div><div class="kpi-value">${k.vNow.length}</div><div class="kpi-sub">vs ${k.vPrev.length} prior period</div></div>
      <div class="card kpi"><div class="spread"><span class="kpi-label">Periodic reviews overdue</span>${fullLink(r4)}</div><div class="kpi-value" style="${k.rOd.length ? 'color:var(--overdue)' : ''}">${k.rOd.length}</div><div class="kpi-sub">across ${owners} owner${owners === 1 ? '' : 's'}</div></div></div>`;
  }
  function stateTiles(states, items, title, keyFn) {
    var rows = [['Record', 'Title', 'State', 'Owner']].concat(items.map(function (x) { return [x.id, x.title, x.state, Q.fullName(x.owner)]; }));
    var r = rpt(title, rows);
    return h`<div class="card card-pad"><div class="card-head"><h2>${title}</h2>${fullLink(r)}</div><div class="state-tiles">${states.map(function (s) {
      var n = items.filter(function (x) { return (keyFn ? keyFn(x) : x.state) === s; }).length;
      var rs = rpt(title + ': ' + s, [rows[0]].concat(items.filter(function (x) { return (keyFn ? keyFn(x) : x.state) === s; }).map(function (x) { return [x.id, x.title, x.state, Q.fullName(x.owner)]; })));
      return h`<button class="state-tile" data-act="full-report" data-k="${rs}">${s} <b>${n}</b></button>`;
    })}</div></div>`;
  }
  function overview(d) {
    var wk = weekly(d);
    var avg = [['Draft', 6.2], ['In review', 4.1], ['In approval', 3.4], ['Pending training', 9.8]];
    var rAvg = rpt('Average days in each workflow state', [['State', 'Average days', 'Transitions measured']].concat(avg.map(function (a, i) { return [a[0], a[1], [14, 12, 11, 4][i]]; })));
    var rWk = rpt('Training due vs overdue by week', [['Week starting', 'Due', 'Overdue']].concat(wk.weeks.map(function (w) { return [w.label, w.due, w.od]; })));
    var openEv = d.evs.filter(function (e) { return e.state === 'Open' || e.state === 'Assessment'; });
    var capaEx = d.capas.filter(function (c) { return c.state === 'Execution'; });
    var noCapa = d.evs.filter(function (e) { return e.state === 'Closed' && !e.capa; });
    var effDue = d.capas.filter(function (c) { return c.state === 'Effectiveness check'; });
    var qRows = function (arr) { return [['Record', 'Title', 'State', 'Owner']].concat(arr.map(function (x) { return [x.id, x.title, x.state, Q.fullName(x.owner)]; })); };
    var qt = [['Open events', openEv], ['CAPA in execution', capaEx], ['Closed without CAPA', noCapa], ['Effectiveness checks due', effDue]];
    return h`${kpiRow(d)}
      <div class="grid-2 mb-16">
        <div class="card card-pad"><div class="card-head"><h2>Average days in each workflow state</h2>${fullLink(rAvg)}</div>${hbar(avg)}<p class="small muted mt-16" style="margin-bottom:0">Documents, last ${d.days} days.</p></div>
        <div class="card card-pad"><div class="card-head"><h2>Training due vs overdue, by week</h2>${fullLink(rWk)}</div>${wk.svg}<div class="legend mt-8"><span><i style="background:var(--chart-due)"></i>Due</span><span><i style="background:var(--chart-overdue)"></i>Overdue</span></div></div></div>
      <div class="grid-2">
        ${stateTiles(Q.CR_STATES, d.crs, 'Change requests by state')}
        <div class="card card-pad"><div class="card-head"><h2>Quality events and CAPA by state</h2>${fullLink(rpt('Quality events and CAPA', qRows(d.evs.concat(d.capas))))}</div><div class="state-tiles" style="grid-template-columns:1fr 1fr">${qt.map(function (t) { return h`<button class="state-tile" data-act="full-report" data-k="${rpt(t[0], qRows(t[1]))}">${t[0]} <b>${t[1].length}</b></button>`; })}</div></div></div>`;
  }
  function documents(d) {
    var types = {}; d.docs.forEach(function (x) { types[x.docType] = (types[x.docType] || 0) + 1; });
    var states = {}; d.docs.forEach(function (x) { states[x.state] = (states[x.state] || 0) + 1; });
    var inWf = d.docs.filter(function (x) { return ['In review', 'Review closed', 'In approval', 'Pending training'].indexOf(x.state) >= 0; });
    var odAppr = d.docs.filter(function (x) { return x.state === 'In approval' && Q.daysFromToday(x.approvalDue) < 0; });
    var rAll = rpt('Documents register', [['Document', 'Title', 'Type', 'State', 'Version', 'Owner']].concat(d.docs.map(function (x) { return [x.id, x.title, x.docType, x.state, Q.curVer(x).v, Q.fullName(x.owner)]; })));
    var rWf = rpt('Documents in a workflow', [['Document', 'Title', 'State', 'Owner']].concat(inWf.map(function (x) { return [x.id, x.title, x.state, Q.fullName(x.owner)]; })));
    return h`<div class="grid-4 mb-16"><div class="card kpi"><div class="kpi-label">Controlled documents</div><div class="kpi-value">${d.docs.length}</div><div class="kpi-sub">${states.Effective || 0} effective</div></div>
      <div class="card kpi"><div class="spread"><span class="kpi-label">In a workflow</span>${fullLink(rWf)}</div><div class="kpi-value">${inWf.length}</div></div>
      <div class="card kpi"><div class="kpi-label">Approvals overdue</div><div class="kpi-value" style="${odAppr.length ? 'color:var(--overdue)' : ''}">${odAppr.length}</div></div>
      <div class="card kpi"><div class="kpi-label">Obsolete (archived)</div><div class="kpi-value">${states.Obsolete || 0}</div></div></div>
      <div class="grid-2"><div class="card card-pad"><div class="card-head"><h2>Documents by type</h2>${fullLink(rAll)}</div>${hbar(Object.keys(types).map(function (k) { return [k, types[k]]; }).sort(function (a, b) { return b[1] - a[1]; }))}</div>
        <div class="card card-pad"><div class="card-head"><h2>Documents by state</h2>${fullLink(rAll)}</div>${hbar(Object.keys(states).map(function (k) { return [k, states[k]]; }))}</div></div>`;
  }
  function training(d) {
    var rules = Q.S.trainingRules.filter(function (r) { return r.status === 'Active'; });
    var rows = rules.map(function (r) { var a = d.asg.filter(function (x) { return x.rule === r.id; }); return [r.name, Q.pct(a.filter(function (x) { return x.completed; }).length, a.length)]; });
    var people = {}; d.asg.filter(function (a) { return !a.completed && Q.daysFromToday(a.due) < 0; }).forEach(function (a) { people[a.user] = (people[a.user] || 0) + 1; });
    var rOd = rpt('Overdue training by person', [['Person', 'Overdue items', 'Manager']].concat(Object.keys(people).map(function (u) { return [Q.fullName(u), people[u], Q.user(u).manager ? Q.fullName(Q.user(u).manager) : '—']; })));
    var wk = weekly(d);
    return h`${kpiRow(d)}<div class="grid-2 mb-16"><div class="card card-pad"><div class="card-head"><h2>Completion by rule</h2>${fullLink(rpt('Training by rule', [['Rule', '% complete']].concat(rows)))}</div>${hbar(rows.map(function (r) { return [r[0], r[1], 'var(--done)']; }), 100, { unit: '%' })}</div>
      <div class="card card-pad"><div class="card-head"><h2>Overdue by person</h2>${fullLink(rOd)}</div>${Object.keys(people).length ? hbar(Object.keys(people).map(function (u) { return [Q.fullName(u), people[u], 'var(--chart-overdue)']; })) : h`<p class="muted">Nobody is overdue.</p>`}</div></div>
      <div class="card card-pad"><div class="card-head"><h2>Training due vs overdue, by week</h2></div>${wk.svg}<div class="legend mt-8"><span><i style="background:var(--chart-due)"></i>Due</span><span><i style="background:var(--chart-overdue)"></i>Overdue</span></div></div>`;
  }
  function changes(d) {
    var major = d.crs.filter(function (c) { return c.size === 'Major'; }).length;
    var acts = []; d.crs.forEach(function (c) { c.actions.forEach(function (a) { acts.push(a); }); });
    return h`<div class="grid-4 mb-16"><div class="card kpi"><div class="kpi-label">Change requests</div><div class="kpi-value">${d.crs.length}</div><div class="kpi-sub">${major} major · ${d.crs.length - major} minor</div></div>
      <div class="card kpi"><div class="kpi-label">Open actions</div><div class="kpi-value">${acts.filter(function (a) { return a.status !== 'Done'; }).length}</div></div>
      <div class="card kpi"><div class="kpi-label">Average cycle time</div><div class="kpi-value">38 days</div><div class="kpi-sub">Planning to Closed (sample history)</div></div>
      <div class="card kpi"><div class="kpi-label">Closed as effective</div><div class="kpi-value">${d.crs.filter(function (c) { return c.effectiveness.verdict === 'Effective'; }).length}</div></div></div>
      ${stateTiles(Q.CR_STATES, d.crs, 'Change requests by state')}
      <div class="card card-pad mt-16"><div class="card-head"><h2>Average days in each change state</h2></div>${hbar([['Planning', 5.5], ['Review', 3.2], ['Approval', 2.1], ['In execution', 21.4], ['Effectiveness check', 14.0]])}</div>`;
  }
  function quality(d) {
    var types = {}; d.evs.forEach(function (e) { types[e.type] = (types[e.type] || 0) + 1; });
    var k = kpis(d);
    return h`<div class="grid-4 mb-16"><div class="card kpi"><div class="kpi-label">Quality events</div><div class="kpi-value">${d.evs.length}</div><div class="kpi-sub">${d.evs.filter(function (e) { return e.severity === 'High'; }).length} high severity</div></div>
      <div class="card kpi"><div class="kpi-label">Open CAPAs</div><div class="kpi-value">${d.capas.filter(function (c) { return c.state !== 'Closed'; }).length}</div></div>
      <div class="card kpi"><div class="kpi-label">CAPA closed on time</div><div class="kpi-value">${Q.pct(k.onTime.length, k.closed.length)}%</div></div>
      <div class="card kpi"><div class="kpi-label">Observations this period</div><div class="kpi-value">${vals(Q.S.obs).filter(function (o) { return within(o.at, 0, d.days); }).length}</div></div></div>
      <div class="grid-2"><div class="card card-pad"><div class="card-head"><h2>Events by type</h2>${fullLink(rpt('Quality events', [['Event', 'Title', 'Type', 'Severity', 'State']].concat(d.evs.map(function (e) { return [e.id, e.title, e.type, e.severity, e.state]; }))))}</div>${hbar(Object.keys(types).map(function (t) { return [t, types[t]]; }))}</div>
        ${stateTiles(['Planning', 'Execution', 'Effectiveness check', 'Closed'], d.capas, 'CAPA by state')}</div>`;
  }
  function reviews(d) {
    var owners = d.reviews.map(function (r) { return r.reviewer; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
    var st = ['Overdue', 'Due soon', 'Upcoming', 'Scheduled', 'Completed'];
    var r = rpt('Periodic reviews', [['Review', 'Document', 'Reviewer', 'Due', 'Status']].concat(d.reviews.map(function (x) { return [x.id, x.doc, Q.fullName(x.reviewer), Q.fmtDate(x.due), Q.reviewStatus(x)]; })));
    return h`${kpiRow(d)}<div class="card card-pad"><div class="card-head"><h2>Periodic reviews by owner and status</h2>${fullLink(r)}</div>
      <div class="table-wrap"><table class="t"><thead><tr><th scope="col">Owner</th>${st.map(function (s) { return h`<th scope="col">${s}</th>`; })}</tr></thead><tbody>${owners.map(function (u) { return h`<tr><td>${Q.fullName(u)}</td>${st.map(function (s) { var n = d.reviews.filter(function (x) { return x.reviewer === u && Q.reviewStatus(x) === s; }).length; return h`<td>${n ? (s === 'Overdue' ? Q.chip(String(n), 'chip-overdue') : n) : h`<span class="muted">0</span>`}</td>`; })}</tr>`; })}</tbody></table></div></div>`;
  }
  function actions(d) {
    var all = [];
    d.crs.forEach(function (c) { c.actions.forEach(function (a) { all.push({ rec: c.id, title: a.title, who: a.assignee, due: a.due, status: a.status }); }); });
    d.capas.forEach(function (c) { c.actions.forEach(function (a) { all.push({ rec: c.id, title: a.type + ': ' + a.title, who: a.assignee, due: a.due, status: a.status }); }); });
    var st = function (a) { return a.status === 'Done' ? 'Done' : Q.daysFromToday(a.due) < 0 ? 'Overdue' : a.status; };
    var groups = ['Not started', 'In progress', 'Overdue', 'Done'];
    var colors = { 'Not started': 'var(--chart-soft)', 'In progress': 'var(--chart-due)', 'Overdue': 'var(--chart-overdue)', 'Done': 'var(--done)' };
    var r = rpt('Actions', [['Record', 'Action', 'Assignee', 'Due', 'Status']].concat(all.map(function (a) { return [a.rec, a.title, Q.fullName(a.who), Q.fmtDate(a.due), st(a)]; })));
    return h`<div class="grid-2"><div class="card card-pad"><div class="card-head"><h2>Actions by status</h2>${fullLink(r)}</div>${hbar(groups.map(function (g) { return [g, all.filter(function (a) { return st(a) === g; }).length, colors[g]]; }))}<p class="small muted mt-16" style="margin-bottom:0">Change request and CAPA actions.</p></div>
      <div class="card card-pad"><div class="card-head"><h2>Open tasks by module</h2></div>${hbar((function () { var m = {}; Q.S.tasks.filter(function (t) { return t.status === 'open' && !t.fyi; }).forEach(function (t) { var k = Q.KIND_LABEL[Q.kindOf(t.record)] || 'Other'; m[k] = (m[k] || 0) + 1; }); return Object.keys(m).map(function (k) { return [k, m[k]]; }); })())}</div></div>`;
  }
  Q.act['an-export'] = function () {
    var d = data(+(Q.current.query.days || 90)), k = kpis(d);
    Q.exportCsv('analytics-kpis.csv', [['KPI', 'Value', 'Period (days)'], ['Training overdue', k.od.length, d.days], ['Training due', k.dueNow.length, d.days], ['CAPA closed on time %', Q.pct(k.onTime.length, k.closed.length), d.days], ['Documents and versions created', k.vNow.length, d.days], ['Periodic reviews overdue', k.rOd.length, d.days], ['Open change requests', d.crs.filter(function (c) { return c.state !== 'Closed'; }).length, d.days], ['Open quality events', d.evs.filter(function (e) { return e.state !== 'Closed'; }).length, d.days]], 'analytics KPIs');
  };
})(window.Q);
