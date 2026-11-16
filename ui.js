/* UI framework: router, shell, event delegation, drawer, menus, palette, toasts and shared components. */
(function (Q) {
  'use strict';
  var h = Q.h;
  Q.ui = Q.ui || {};          // ephemeral view state (tabs, filters, sort)
  Q.act = Q.act || {};        // click handlers: data-act="name"
  Q.on = Q.on || {};          // change/input handlers: data-change / data-input
  Q.views = Q.views || {};

  // ---------- Router ----------
  var routes = [];
  Q.route = function (pattern, view) {
    var keys = [];
    var re = new RegExp('^' + pattern.replace(/:(\w+)/g, function (_, k) { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ re: re, keys: keys, view: view });
  };
  Q.parse = function () {
    var hash = location.hash.replace(/^#/, '') || '/today';
    var qi = hash.indexOf('?');
    var path = qi >= 0 ? hash.slice(0, qi) : hash;
    var query = {};
    if (qi >= 0) hash.slice(qi + 1).split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); });
    return { path: path, query: query };
  };
  Q.go = function (href) { if (location.hash === href) Q.render(); else location.hash = href; };
  Q.setQuery = function (patch) {
    var r = Q.parse(); Object.keys(patch).forEach(function (k) { if (patch[k] == null || patch[k] === '') delete r.query[k]; else r.query[k] = patch[k]; });
    var qs = Object.keys(r.query).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(r.query[k]); }).join('&');
    history.replaceState(null, '', '#' + r.path + (qs ? '?' + qs : ''));
    Q.render();
  };
  Q.current = { path: '/today', query: {}, section: 'today' };

  Q.render = function (opts) {
    opts = opts || {};
    var r = Q.parse();
    var main = document.getElementById('main');
    var match = null, params = {};
    for (var i = 0; i < routes.length; i++) {
      var m = routes[i].re.exec(r.path);
      if (m) { match = routes[i]; routes[i].keys.forEach(function (k, j) { params[k] = decodeURIComponent(m[j + 1]); }); break; }
    }
    var changedPage = Q.current.path !== r.path;
    Q.current = { path: r.path, query: r.query, params: params, section: r.path.split('/')[1] || 'today' };
    var out;
    try {
      out = match ? match.view(params, r.query) : Q.views.notFound();
    } catch (err) {
      console.error(err);
      out = h`<div class="card card-pad"><h2>Something went wrong on this page</h2><p class="muted">${String(err && err.message || err)}</p><a class="btn" href="#/today">Back to Today</a></div>`;
    }
    var scrollY = window.scrollY;
    main.innerHTML = String(out);
    Q.renderShell();
    if (changedPage && !opts.keepScroll) { window.scrollTo(0, 0); if (!opts.noFocus) main.focus({ preventScroll: true }); }
    else window.scrollTo(0, scrollY);
    var title = main.querySelector('h1');
    document.title = (title ? title.textContent.trim() + ' · ' : '') + 'VeQMS';
    (Q.afterRender || []).forEach(function (fn) { fn(); });
    Q.afterRender = [];
  };
  Q.refresh = function () { Q.save(); Q.render({ keepScroll: true }); };
  Q.after = function (fn) { (Q.afterRender = Q.afterRender || []).push(fn); };

  // ---------- Shell ----------
  var NAV = [
    { id: 'today', label: 'Today', icon: 'home', href: '#/today' },
    { id: 'documents', label: 'Documents', icon: 'doc', href: '#/documents' },
    { id: 'training', label: 'Training', icon: 'training', href: '#/training' },
    { id: 'changes', label: 'Change requests', icon: 'change', href: '#/changes' },
    { id: 'reviews', label: 'Periodic reviews', icon: 'review', href: '#/reviews' },
    { id: 'quality', label: 'Quality events and CAPA', icon: 'quality', href: '#/quality' },
    { id: 'analytics', label: 'Analytics', icon: 'chart', href: '#/analytics', perm: 'analytics' }
  ];
  Q.isDark = function () {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  Q.renderShell = function () {
    var sec = Q.current.section;
    var overdue = Q.openTasks().filter(function (t) { return !t.fyi && t.due && Q.daysFromToday(t.due) < 0; }).length;
    var rail = NAV.filter(function (n) { return !n.perm || Q.can(n.perm); }).map(function (n) {
      var active = sec === n.id || (n.id === 'today' && (sec === 'task' || sec === 'tasks'));
      return h`<a class="rail-item ${active ? 'active' : ''}" href="${n.href}" data-tip="${n.label}" aria-label="${n.label}" ${Q.raw(active ? 'aria-current="page"' : '')}>${Q.icon(n.icon)}<span class="rail-text">${n.label}</span>${n.id === 'today' && overdue ? h`<span class="rail-badge" aria-label="${overdue} overdue">${overdue}</span>` : ''}</a>`;
    });
    document.getElementById('rail').innerHTML = String(h`
      <button class="rail-logo" data-act="rail-toggle" aria-label="Expand or collapse navigation" title="VeQMS">V</button>
      ${rail}
      <div class="rail-spacer"></div>
      ${Q.can('admin.any') ? h`<a class="rail-item ${sec === 'admin' ? 'active' : ''}" href="#/admin" data-tip="Administration" aria-label="Administration">${Q.icon('admin')}<span class="rail-text">Administration</span></a>` : ''}
      <a class="rail-item ${sec === 'help' ? 'active' : ''}" href="#/help" data-tip="Help centre" aria-label="Help centre">${Q.icon('help')}<span class="rail-text">Help centre</span></a>
      <button class="rail-item" data-act="theme" data-tip="${Q.isDark() ? 'Light mode' : 'Dark mode'}" aria-label="Switch to ${Q.isDark() ? 'light' : 'dark'} mode">${Q.icon(Q.isDark() ? 'sun' : 'moon')}<span class="rail-text">${Q.isDark() ? 'Light mode' : 'Dark mode'}</span></button>
    `);

    var me = Q.me();
    var unread = Q.unread();
    document.getElementById('topbar').innerHTML = String(h`
      <button class="rail-logo mobile-logo" data-act="go" data-href="#/today" aria-label="Today">V</button>
      <button class="cmd-trigger" data-act="palette" aria-label="Search, create or jump to a record (Ctrl K)">${Q.icon('search', 'ico-sm')}<span>Search, create or jump to a record</span><span class="kbd">${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}</span></button>
      <div class="topbar-spacer"></div>
      ${Q.readOnly() ? '' : h`<button class="btn btn-primary new-btn" data-act="new-menu" aria-haspopup="menu">${Q.icon('plus', 'ico-sm')} New</button>`}
      <a class="icon-btn" href="#/notifications" aria-label="Notifications${unread ? ', ' + unread + ' unread' : ''}">${Q.icon('bell')}${unread ? h`<span class="dot"></span>` : ''}</a>
      <button class="avatar" data-act="user-menu" aria-haspopup="menu" aria-label="Account menu for ${me.name}">${me.initials}</button>
    `);

    var tabs = [
      { id: 'today', label: 'Home', icon: 'home', href: '#/today' },
      { id: 'tasks', label: 'Tasks', icon: 'tasks', href: '#/tasks' },
      { id: 'raise', label: 'Raise', icon: 'raise', href: '#/raise' },
      { id: 'notifications', label: 'Alerts', icon: 'bell', href: '#/notifications' },
      { id: 'profile', label: 'Profile', icon: 'user', href: '#/profile' }
    ];
    document.getElementById('tabbar').innerHTML = String(tabs.map(function (t) {
      var active = sec === t.id || (t.id === 'tasks' && sec === 'task');
      return h`<a href="${t.href}" class="${active ? 'active' : ''}" ${Q.raw(active ? 'aria-current="page"' : '')}>${Q.icon(t.icon, 'ico-lg')}<span>${t.label}</span>${t.id === 'notifications' && unread ? h`<span class="dot"></span>` : ''}</a>`;
    }).join(''));

    var banner = '';
    if (Q.hasRole('auditor')) banner = h`<div class="banner info">${Q.icon('eye', 'ico-sm')}<span><b>Auditor access · read-only.</b> Time-boxed until ${Q.fmtDate(me.accessUntil)}. Every record you open is logged.</span></div>`;
    else if (me.id !== 'u-vic') banner = h`<div class="banner info">${Q.icon('users', 'ico-sm')}<span>Demo: viewing as <b>${me.name}</b> · ${me.roles.map(function (r) { return Q.ROLE_LABEL[r]; }).join(', ')}.</span><button class="btn btn-sm" data-act="persona" data-id="u-vic">Back to Victoria</button></div>`;
    document.getElementById('banner').innerHTML = String(banner);
    document.getElementById('app').classList.toggle('rail-open', !!Q.ui.railOpen);
  };

  // ---------- Event delegation ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var fn = Q.act[el.getAttribute('data-act')];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-change]');
    if (el && Q.on[el.getAttribute('data-change')]) Q.on[el.getAttribute('data-change')](el, e);
  });
  document.addEventListener('input', function (e) {
    var el = e.target.closest('[data-input]');
    if (el && Q.on[el.getAttribute('data-input')]) Q.on[el.getAttribute('data-input')](el, e);
  });
  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form[data-submit]');
    if (!form) return;
    e.preventDefault();
    var fn = Q.on[form.getAttribute('data-submit')];
    if (fn) fn(form, e);
  });
  // Rail tooltips when collapsed
  var tipEl = null;
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest('.rail [data-tip]');
    if (!el || Q.ui.railOpen || window.innerWidth <= 760) { if (tipEl) { tipEl.remove(); tipEl = null; } return; }
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'rail-tip'; document.body.appendChild(tipEl); }
    var r = el.getBoundingClientRect(); tipEl.textContent = el.getAttribute('data-tip'); tipEl.style.left = (r.right + 8) + 'px'; tipEl.style.top = (r.top + r.height / 2 - 12) + 'px';
  });
  document.addEventListener('mouseout', function (e) { if (tipEl && !e.relatedTarget?.closest?.('.rail [data-tip]')) { tipEl.remove(); tipEl = null; } });

  Q.formData = function (form) {
    var o = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') {
        if (el.hasAttribute('data-multi')) { o[el.name] = o[el.name] || []; if (el.checked) o[el.name].push(el.value); }
        else o[el.name] = el.checked;
      } else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else if (el.type === 'file') { o[el.name] = Array.prototype.map.call(el.files || [], function (f) { return { name: f.name, size: f.size }; }); }
      else if (el.multiple) { o[el.name] = Array.prototype.filter.call(el.options, function (op) { return op.selected; }).map(function (op) { return op.value; }); }
      else o[el.name] = el.value.trim();
    });
    return o;
  };
  Q.fieldError = function (form, name, msg) {
    var el = form.querySelector('[name="' + name + '"]');
    if (!el) { Q.toast(msg, 'warn'); return; }
    el.classList.add('invalid'); el.setAttribute('aria-invalid', 'true');
    var holder = el.closest('.field') || el.parentNode;
    var e = holder.querySelector('.err');
    if (!e) { e = document.createElement('div'); e.className = 'err'; e.id = 'err-' + name; holder.appendChild(e); el.setAttribute('aria-describedby', e.id); }
    e.textContent = msg; el.focus();
  };
  Q.fmtBytes = function (n) { if (n == null) return ''; if (n < 1024) return n + ' B'; if (n < 1048576) return Math.round(n / 1024) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; };

  // ---------- Toast ----------
  Q.toast = function (msg, type) {
    var root = document.getElementById('toast-root');
    var t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.innerHTML = String(h`${Q.icon(type === 'warn' ? 'quality' : 'check', 'ico-sm')}<span>${msg}</span>`);
    root.appendChild(t);
    setTimeout(function () { t.remove(); }, type === 'warn' ? 6000 : 3800);
  };

  // ---------- Drawer (preferred over modals for create/edit) ----------
  var drawerState = null;
  Q.drawer = {
    open: function (o) {
      drawerState = o; drawerState.returnFocus = document.activeElement;
      Q.drawer.paint();
      Q.drawer.focusFirst();
    },
    paint: function () {
      var o = drawerState; if (!o) return;
      var root = document.getElementById('drawer-root');
      var body = typeof o.body === 'function' ? o.body() : o.body;
      var foot = typeof o.foot === 'function' ? o.foot() : o.foot;
      root.innerHTML = String(h`
        <div class="scrim" data-act="drawer-close"></div>
        <form class="drawer ${o.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="drawer-title" data-submit="drawer-submit" novalidate>
          <div class="drawer-head">
            <div>${o.kicker ? h`<div class="label">${o.kicker}</div>` : ''}<h2 id="drawer-title" class="h1" style="margin-top:4px">${o.title}</h2>${o.sub ? h`<div class="muted small" style="margin-top:4px">${o.sub}</div>` : ''}</div>
            <button type="button" class="icon-btn" data-act="drawer-close" aria-label="Close">${Q.icon('x')}</button>
          </div>
          <div class="drawer-body">${body}</div>
          ${foot === false ? '' : h`<div class="drawer-foot">${foot || h`<button class="btn btn-primary" type="submit">${o.submitLabel || 'Save'}</button><button class="btn" type="button" data-act="drawer-close">Cancel</button>`}</div>`}
        </form>`);
      if (o.after) o.after(root.querySelector('.drawer'));
    },
    update: function (patch) { Object.keys(patch || {}).forEach(function (k) { drawerState[k] = patch[k]; }); Q.drawer.paint(); },
    focusFirst: function () {
      var d = document.querySelector('#drawer-root .drawer'); if (!d) return;
      var f = d.querySelector('[autofocus], .drawer-body input:not([type=hidden]):not([disabled]), .drawer-body select, .drawer-body textarea, .drawer-body button, .drawer-foot .btn-primary');
      (f || d.querySelector('.icon-btn')).focus();
    },
    close: function () {
      var o = drawerState; drawerState = null;
      document.getElementById('drawer-root').innerHTML = '';
      if (o && o.onClose) o.onClose();
      if (o && o.returnFocus && document.body.contains(o.returnFocus)) o.returnFocus.focus();
    },
    isOpen: function () { return !!drawerState; },
    state: function () { return drawerState; }
  };
  Q.act['drawer-close'] = function () { Q.drawer.close(); };
  Q.on['drawer-submit'] = function (form) {
    if (!drawerState || !drawerState.submit) return;
    form.querySelectorAll('.invalid').forEach(function (el) { el.classList.remove('invalid'); el.removeAttribute('aria-invalid'); });
    form.querySelectorAll('.err').forEach(function (el) { el.remove(); });
    drawerState.submit(Q.formData(form), form);
  };

  // ---------- Menus ----------
  var menuState = null;
  Q.menu = {
    open: function (anchor, content, opts) {
      Q.menu.close();
      opts = opts || {};
      var root = document.getElementById('popover-root');
      root.innerHTML = '<div class="menu" role="menu">' + String(content) + '</div>';
      var m = root.firstChild;
      var r = anchor.getBoundingClientRect();
      var w = m.offsetWidth, ht = m.offsetHeight;
      var left = opts.alignLeft ? r.left : r.right - w;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      var top = r.bottom + 6; if (top + ht > window.innerHeight - 8) top = Math.max(8, r.top - ht - 6);
      m.style.left = left + 'px'; m.style.top = top + 'px';
      menuState = { anchor: anchor };
      var first = m.querySelector('.menu-item'); if (first) first.focus();
    },
    close: function () {
      if (!menuState) return;
      var ae = document.activeElement;
      var focusInMenu = !ae || ae === document.body || !!ae.closest('.menu');
      document.getElementById('popover-root').innerHTML = ''; var a = menuState.anchor; menuState = null;
      if (focusInMenu && a && document.body.contains(a)) a.focus();
    },
    isOpen: function () { return !!menuState; }
  };
  document.addEventListener('mousedown', function (e) { if (menuState && !e.target.closest('.menu') && !e.target.closest('[data-act$="-menu"]')) Q.menu.close(); });
  document.addEventListener('click', function (e) { if (menuState && e.target.closest('.menu .menu-item')) setTimeout(Q.menu.close, 0); }, true);

  Q.act['new-menu'] = function (el) {
    var items = [];
    if (Q.can('doc.create')) items.push(h`<button class="menu-item" data-act="new-doc" role="menuitem">${Q.icon('doc')} Document</button>`);
    if (Q.can('cr.create')) items.push(h`<button class="menu-item" data-act="new-cr" role="menuitem">${Q.icon('change')} Change request</button>`);
    if (Q.can('obs.raise')) items.push(h`<button class="menu-item" data-act="new-obs" role="menuitem">${Q.icon('eye')} Observation</button>`);
    if (Q.can('qe.create')) items.push(h`<button class="menu-item" data-act="new-qe" role="menuitem">${Q.icon('quality')} Quality event</button>`);
    if (Q.can('training.rules')) items.push(h`<button class="menu-item" data-act="new-rule" role="menuitem">${Q.icon('training')} Training rule</button>`);
    Q.menu.open(el, h`<div class="menu-label">Create new</div>${items}`);
  };
  Q.act['user-menu'] = function (el) {
    var me = Q.me();
    var personas = ['u-vic', 'u-sam', 'u-priya', 'u-tom', 'u-grace', 'u-daniel', 'u-hannah', 'u-aud'].map(Q.user);
    Q.menu.open(el, h`
      <div style="padding:10px 10px 8px"><div style="font-weight:600">${me.name}</div><div class="small muted">${me.title}</div></div>
      <div class="menu-sep"></div>
      <a class="menu-item" href="#/profile" role="menuitem">${Q.icon('user')} Profile and preferences</a>
      <a class="menu-item" href="#/notifications" role="menuitem">${Q.icon('bell')} Notifications</a>
      <button class="menu-item" data-act="theme" role="menuitem">${Q.icon(Q.isDark() ? 'sun' : 'moon')} ${Q.isDark() ? 'Light mode' : 'Dark mode'}</button>
      <button class="menu-item" data-act="tour" role="menuitem">${Q.icon('help')} Take the tour</button>
      <div class="menu-sep"></div>
      <div class="menu-label">Demo · view as</div>
      <div class="persona-list">${personas.map(function (p) { return h`<button class="menu-item ${p.id === me.id ? 'active' : ''}" data-act="persona" data-id="${p.id}" role="menuitemradio" aria-checked="${p.id === me.id}"><span class="avatar xs">${p.initials}</span><span>${p.name}<span class="pl-role">${p.roles.map(function (r) { return Q.ROLE_LABEL[r]; }).join(' · ')}</span></span></button>`; })}</div>
      <div class="menu-sep"></div>
      <button class="menu-item" data-act="reset-demo" role="menuitem">${Q.icon('refresh')} Reset demo data</button>
    `);
  };
  Q.act.persona = function (el) {
    var id = el.getAttribute('data-id');
    if (id === Q.S.session.userId) return;
    Q.S.session.userId = id; Q.S.session.signedInAt = new Date().toISOString();
    Q.audit('login', 'Session', id, Q.fullName(id) + ' signed in (SSO + MFA) · demo persona switch');
    Q.save();
    Q.toast('Now viewing as ' + Q.fullName(id));
    if (Q.current.section === 'admin' && !Q.can('admin.any')) Q.go('#/today'); else Q.render();
  };
  Q.act['reset-demo'] = function () {
    if (!confirm('Reset all demo data? Everything you changed in this browser is replaced with the sample records.')) return;
    Q.reset(); Q.ui = {}; Q.toast('Demo data reset'); Q.go('#/today'); Q.render();
  };
  Q.act.theme = function () {
    var dark = !Q.isDark();
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem('veqms-theme', dark ? 'dark' : 'light'); } catch (e) { }
    Q.renderShell();
  };
  Q.act['rail-toggle'] = function () { Q.ui.railOpen = !Q.ui.railOpen; Q.renderShell(); };
  Q.act.go = function (el) { Q.go(el.getAttribute('data-href')); };
  Q.act.tab = function (el) { var p = {}; p[el.getAttribute('data-key') || 'tab'] = el.getAttribute('data-tab'); Q.setQuery(p); };

  // ---------- Command palette (Ctrl/Cmd + K) ----------
  var pal = null;
  Q.palette = {
    open: function () {
      pal = { q: '', idx: 0, returnFocus: document.activeElement };
      var root = document.getElementById('palette-root');
      root.innerHTML = String(h`<div class="palette-scrim" data-act="palette-close"><div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" data-stop="1">
        <div class="palette-input">${Q.icon('search')}<input id="pal-input" placeholder="Search records, create something, or go to a page" aria-label="Search" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="pal-list"><span class="kbd">Esc</span></div>
        <div class="palette-list" id="pal-list" role="listbox"></div>
        <div class="palette-foot"><span>↑↓ to move</span><span>Enter to open</span><span>Results respect your permissions</span></div>
      </div></div>`);
      var inp = document.getElementById('pal-input');
      inp.addEventListener('input', function () { pal.q = inp.value; pal.idx = 0; Q.palette.paint(); });
      inp.addEventListener('keydown', function (e) {
        var items = Q.palette.items();
        if (e.key === 'ArrowDown') { e.preventDefault(); pal.idx = Math.min(items.length - 1, pal.idx + 1); Q.palette.paint(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); pal.idx = Math.max(0, pal.idx - 1); Q.palette.paint(); }
        else if (e.key === 'Enter') { e.preventDefault(); var it = items[pal.idx]; if (it) Q.palette.run(it); }
      });
      Q.palette.paint(); inp.focus();
    },
    items: function () {
      var q = (pal.q || '').toLowerCase().trim();
      var out = [];
      var creates = [
        { g: 'Create', label: 'New document', icon: 'doc', act: 'new-doc', perm: 'doc.create' },
        { g: 'Create', label: 'New change request', icon: 'change', act: 'new-cr', perm: 'cr.create' },
        { g: 'Create', label: 'Raise an observation', icon: 'eye', act: 'new-obs', perm: 'obs.raise' },
        { g: 'Create', label: 'New quality event', icon: 'quality', act: 'new-qe', perm: 'qe.create' },
        { g: 'Create', label: 'New training rule', icon: 'training', act: 'new-rule', perm: 'training.rules' }
      ].filter(function (c) { return Q.can(c.perm); });
      var pages = [
        { g: 'Go to', label: 'Today', icon: 'home', href: '#/today' }, { g: 'Go to', label: 'Documents', icon: 'doc', href: '#/documents' },
        { g: 'Go to', label: 'My training', icon: 'training', href: '#/training' }, { g: 'Go to', label: 'Change requests', icon: 'change', href: '#/changes' },
        { g: 'Go to', label: 'Periodic reviews', icon: 'review', href: '#/reviews' }, { g: 'Go to', label: 'Quality events and CAPA', icon: 'quality', href: '#/quality' },
        { g: 'Go to', label: 'Analytics', icon: 'chart', href: '#/analytics', perm: 'analytics' }, { g: 'Go to', label: 'Audit trail', icon: 'log', href: '#/admin/audit', perm: 'admin.audit' },
        { g: 'Go to', label: 'Automation rules', icon: 'zap', href: '#/admin/automations', perm: 'admin.automations' }, { g: 'Go to', label: 'Users and roles', icon: 'users', href: '#/admin/users', perm: 'admin.users' },
        { g: 'Go to', label: 'Integrations', icon: 'plug', href: '#/admin/integrations', perm: 'admin.integrations' }, { g: 'Go to', label: 'Notifications', icon: 'bell', href: '#/notifications' },
        { g: 'Go to', label: 'Profile and preferences', icon: 'user', href: '#/profile' }, { g: 'Go to', label: 'Help centre', icon: 'help', href: '#/help' }
      ].filter(function (p) { return !p.perm || Q.can(p.perm); });
      var recs = Q.allRecordIds().filter(function (id) { return Q.canSee(Q.rec(id)); }).map(function (id) {
        return { g: 'Records', label: id + '  ' + Q.recTitle(id), sub: Q.KIND_LABEL[Q.kindOf(id)] + ' · ' + (Q.rec(id).state || ''), icon: { doc: 'doc', cr: 'change', qe: 'quality', capa: 'quality', obs: 'eye' }[Q.kindOf(id)], href: Q.recHref(id), id: id };
      });
      if (!q) {
        var recent = (Q.ui.recent || []).filter(function (id) { return Q.rec(id) && Q.canSee(Q.rec(id)); }).slice(0, 4).map(function (id) { return recs.find(function (r) { return r.id === id; }); }).filter(Boolean).map(function (r) { return Object.assign({}, r, { g: 'Recent' }); });
        return recent.concat(creates, pages.slice(0, 7));
      }
      var match = function (s) { return s.toLowerCase().indexOf(q) >= 0; };
      out = out.concat(recs.filter(function (r) { return match(r.label); }).slice(0, 8));
      // document content search (permission-filtered)
      Object.keys(Q.S.docs).forEach(function (id) {
        var d = Q.S.docs[id]; if (!Q.canSee(d) || out.some(function (o) { return o.id === id; })) return;
        var hit = Q.curVer(d).content.find(function (b) { return match(b.x); });
        if (hit) out.push({ g: 'In document text', label: id + '  ' + d.title, sub: '“' + hit.x.slice(0, 70) + (hit.x.length > 70 ? '…' : '') + '”', icon: 'doc', href: '#/documents/' + id, id: id });
      });
      out = out.concat(creates.filter(function (c) { return match(c.label); }), pages.filter(function (p) { return match(p.label); }));
      out.push({ g: 'Search', label: 'Search everything for “' + pal.q + '”', icon: 'search', href: '#/search?q=' + encodeURIComponent(pal.q) });
      return out;
    },
    paint: function () {
      var items = Q.palette.items(); var g = null;
      var html = items.map(function (it, i) {
        var head = it.g !== g ? h`<div class="palette-group">${it.g}</div>` : ''; g = it.g;
        return h`${head}<div class="palette-item ${i === pal.idx ? 'active' : ''}" role="option" aria-selected="${i === pal.idx}" data-act="palette-pick" data-i="${i}" id="pal-${i}">${Q.icon(it.icon || 'chevron', 'ico-sm')}<span class="pi-main">${it.label}${it.sub ? h` <span class="muted small">· ${it.sub}</span>` : ''}</span></div>`;
      });
      var list = document.getElementById('pal-list');
      list.innerHTML = items.length ? String(h`${html}`) : '<div class="empty">Nothing matches. Try a record number like SOP-012.</div>';
      var act = document.getElementById('pal-' + pal.idx); if (act) { act.scrollIntoView({ block: 'nearest' }); document.getElementById('pal-input').setAttribute('aria-activedescendant', act.id); }
    },
    run: function (it) {
      Q.palette.close(true);
      if (it.act) Q.act[it.act](document.body);
      else if (it.href) Q.go(it.href);
    },
    close: function (silent) {
      if (!pal) return; var rf = pal.returnFocus; pal = null; document.getElementById('palette-root').innerHTML = '';
      if (!silent && rf && document.body.contains(rf)) rf.focus();
    },
    isOpen: function () { return !!pal; }
  };
  Q.act.palette = function () { Q.palette.open(); };
  Q.act['palette-close'] = function (el, e) { if (e.target.closest('[data-stop]')) return; Q.palette.close(); };
  Q.act['palette-pick'] = function (el) { var it = Q.palette.items()[+el.getAttribute('data-i')]; if (it) Q.palette.run(it); };

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (Q.palette.isOpen()) Q.palette.close(); else Q.palette.open(); return; }
    if (e.key === 'Escape') {
      if (Q.palette.isOpen()) { Q.palette.close(); return; }
      if (Q.menu.isOpen()) { Q.menu.close(); return; }
      if (document.querySelector('.tour')) { Q.tour.close(); return; }
      if (Q.drawer.isOpen()) { Q.drawer.close(); return; }
    }
    if (e.key === 'Tab' && Q.drawer.isOpen()) { // keep focus inside the drawer
      var d = document.querySelector('#drawer-root .drawer'); if (!d) return;
      var f = Array.prototype.filter.call(d.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'), function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
    if (Q.menu.isOpen() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      var items = Array.prototype.slice.call(document.querySelectorAll('.menu .menu-item'));
      var i = items.indexOf(document.activeElement);
      e.preventDefault(); var n = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1); items[n].focus();
    }
  });

  // ---------- Components ----------
  var STATE_CLS = {
    'Effective': 'chip-done', 'Closed': 'chip-done', 'Done': 'chip-done', 'Reviewed': 'chip-done', 'Signed': 'chip-done', 'Completed': 'chip-done', 'Active': 'chip-done', 'Approved': 'chip-done',
    'In review': 'chip-turn', 'In approval': 'chip-turn', 'Review': 'chip-turn', 'Approval': 'chip-turn', 'Your turn': 'chip-turn', 'Review closed': 'chip-turn', 'Pending approval': 'chip-turn',
    'Pending training': 'chip-due', 'Effectiveness check': 'chip-due', 'Execution': 'chip-due', 'In execution': 'chip-due', 'Assessment': 'chip-due', 'In progress': 'chip-due', 'CAPA raised': 'chip-due', 'Escalated': 'chip-due', 'Due soon': 'chip-due',
    'Overdue': 'chip-overdue', 'Failed': 'chip-overdue', 'Revoked': 'chip-overdue', 'High': 'chip-overdue',
    'Superseded': 'chip-outline', 'Obsolete': 'chip-outline', 'Left': 'chip-outline', 'Off': 'chip-outline', 'Not started': 'chip-outline', 'Waiting': 'chip-outline', 'Upcoming': 'chip-outline', 'Scheduled': 'chip-outline'
  };
  Q.chip = function (text, cls) { return h`<span class="chip ${cls || STATE_CLS[text] || ''}">${text}</span>`; };
  Q.stateChip = function (s) { return Q.chip(s); };
  Q.dueChip = function (iso, opts) {
    opts = opts || {};
    if (opts.expected) return h`<span class="chip chip-outline">Expected around ${Q.fmtShort(iso)}</span>`;
    var r = Q.relDue(iso);
    return h`<span class="chip ${r.cls}">${r.text}</span>`;
  };
  Q.cls = function (c) { c = c || 'Internal'; return h`<span class="cls cls-${c.toLowerCase()}" title="Classification: ${c}">${c}</span>`; };
  Q.sev = function (s) { return h`<span class="chip ${s === 'High' ? 'chip-overdue' : 'chip-outline'}">${s} severity</span>`; };
  Q.avatar = function (uid, size) { var u = Q.user(uid); return h`<span class="avatar ${size || 'sm'}" aria-hidden="true" title="${u.name}">${u.initials}</span>`; };
  Q.stepper = function (states, current, labels, opts) {
    opts = opts || {};
    var ci = states.indexOf(current);
    if (opts.allDone) ci = states.length;
    return h`<div class="stepper ${opts.mini ? 'mini' : ''}" role="list" aria-label="Lifecycle">${states.map(function (s, i) {
      var st = i < ci ? 'done' : i === ci ? 'current' : '';
      var label = (labels && labels[s]) || s;
      return h`<div class="step ${st}" role="listitem" ${Q.raw(i === ci ? 'aria-current="step"' : '')}><div class="step-bar"></div>${opts.mini ? '' : h`<div class="step-name">${label}</div>`}<span class="sr-only">${st === 'done' ? ' (done)' : st === 'current' ? ' (current)' : ''}</span></div>`;
    })}</div>`;
  };
  Q.recLink = function (id, opts) {
    opts = opts || {};
    var r = Q.rec(id); if (!r) return h`<span>${id}</span>`;
    if (!Q.canSee(r)) return h`<span class="muted">${id} · restricted record</span>`;
    return h`<a href="${Q.recHref(id)}">${id}${opts.short ? '' : ' ' + Q.recTitle(id)}</a>`;
  };
  Q.peopleRow = function (uid, role, status, cls) {
    return h`<div class="people-row"><span class="who">${Q.avatar(uid, 'xs')}<span>${Q.name(uid)} · ${role}</span></span><span class="status-text ${cls || 'st-wait'}">${status}</span></div>`;
  };
  Q.empty = function (title, text, action) { return h`<div class="empty">${Q.icon('check', 'ico-lg')}<h3 style="margin-top:8px">${title}</h3><p>${text || ''}</p>${action || ''}</div>`; };
  Q.timeline = function (id, limit) {
    var ev = Q.history(id).slice(0, limit || 6);
    if (!ev.length) return h`<p class="muted small">No activity yet.</p>`;
    return h`<div class="timeline">${ev.map(function (e) {
      var c = e.action === 'sign' ? 'sig' : e.action === 'state' ? 'state' : /revoke|blocked|read/.test(e.action + e.summary) ? 'warn' : '';
      return h`<div class="ev ${c}"><b>${e.actor === 'system' ? 'System' : Q.fullName(e.actor)}</b>${e.onBehalfOf ? ' on behalf of ' + Q.fullName(e.onBehalfOf) : ''} · ${e.summary.replace(/^(Signed|Marked|Closed|Submitted|Sent)/, function (m) { return m.toLowerCase(); })}<span class="when">${Q.fmtDateTime(e.at)}</span></div>`;
    })}</div>`;
  };
  Q.linkedCard = function (id) {
    var links = Q.linksOf(id);
    return h`<div class="card ctx-card"><div class="spread"><span class="label" style="margin:0">Linked records</span>${Q.readOnly() ? '' : h`<button class="btn-link" style="min-height:32px;font-size:13px" data-act="add-link" data-id="${id}">Add link</button>`}</div>
      <div class="stack-sm" style="margin-top:10px">${links.length ? links.map(function (l) { return h`<div class="small">${Q.recLink(l)} <span class="muted">· ${Q.KIND_LABEL[Q.kindOf(l)]}</span></div>`; }) : h`<p class="muted small" style="margin:0">No links yet.</p>`}</div></div>`;
  };
  Q.activityCard = function (id) {
    return h`<div class="card ctx-card"><span class="label">Activity (from the audit trail)</span>${Q.timeline(id)}${Q.can('admin.audit') ? h`<a class="btn-link" style="padding:0;min-height:36px;font-size:13px" href="#/admin/audit?q=${id}">Full audit trail</a>` : ''}</div>`;
  };
  Q.act['add-link'] = function (el) {
    var id = el.getAttribute('data-id');
    var opts = Q.allRecordIds().filter(function (x) { return x !== id && Q.linksOf(id).indexOf(x) < 0 && Q.canSee(Q.rec(x)); });
    Q.drawer.open({
      kicker: 'Link records', title: 'Link ' + id + ' to another record', submitLabel: 'Add link',
      body: h`<div class="field"><label for="lk">Record</label><select class="select" id="lk" name="target">${opts.map(function (x) { return h`<option value="${x}">${x} · ${Q.recTitle(x)}</option>`; })}</select><div class="help">Links show on both records.</div></div>`,
      submit: function (f) { Q.link(id, f.target); Q.drawer.close(); Q.toast('Linked ' + id + ' and ' + f.target); Q.refresh(); }
    });
  };

  // Sortable table
  Q.table = function (o) {
    var key = o.id || 'tbl';
    var s = Q.ui['sort-' + key] || { k: o.defaultSort || null, d: o.defaultDir || 1 };
    var rows = o.rows.slice();
    if (s.k) {
      var col = o.cols.find(function (c) { return c.key === s.k; });
      var getter = col && col.sortVal ? col.sortVal : function (r) { return r[s.k]; };
      rows.sort(Q.by(getter, s.d));
    }
    return h`<div class="table-wrap"><table class="t">${o.caption ? h`<caption class="sr-only">${o.caption}</caption>` : ''}<thead><tr>${o.cols.map(function (c) {
      if (c.sort === false) return h`<th scope="col">${c.label}</th>`;
      var on = s.k === c.key;
      return h`<th scope="col" ${Q.raw(on ? 'aria-sort="' + (s.d > 0 ? 'ascending' : 'descending') + '"' : '')}><button data-act="sort" data-t="${key}" data-k="${c.key}">${c.label}${on ? (s.d > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
    })}</tr></thead><tbody>${rows.length ? rows.map(function (r) {
      var href = o.href ? o.href(r) : null;
      return h`<tr class="${href ? 'click' : ''}" ${Q.raw(href ? 'data-act="row" data-href="' + Q.esc(href) + '"' : '')}>${o.cols.map(function (c) { return h`<td class="${c.cls || ''}">${c.render ? c.render(r) : r[c.key]}</td>`; })}</tr>`;
    }) : h`<tr><td colspan="${o.cols.length}"><div class="empty" style="padding:24px">${o.empty || 'No records match these filters.'}</div></td></tr>`}</tbody></table></div>`;
  };
  Q.act.sort = function (el) {
    var t = el.getAttribute('data-t'), k = el.getAttribute('data-k');
    var s = Q.ui['sort-' + t] || {};
    Q.ui['sort-' + t] = { k: k, d: s.k === k ? -s.d : 1 };
    Q.render({ keepScroll: true });
  };
  Q.act.row = function (el, e) { if (e.target.closest('a,button,input')) return; Q.go(el.getAttribute('data-href')); };

  // First-run walkthrough tips per module
  Q.tip = function (key, text) {
    var seen = Q.S.seen || (Q.S.seen = {});
    if (seen[Q.S.session.userId + ':' + key]) return '';
    return h`<div class="tip-banner" role="note">${Q.icon('help')}<div class="tb-main">${text}</div><button class="icon-btn plain" data-act="tip-dismiss" data-key="${key}" aria-label="Dismiss tip" style="width:36px;height:36px">${Q.icon('x', 'ico-sm')}</button></div>`;
  };
  Q.act['tip-dismiss'] = function (el) { Q.S.seen[Q.S.session.userId + ':' + el.getAttribute('data-key')] = true; Q.refresh(); };

  Q.exportCsv = function (name, rows, what) {
    Q.download(name, Q.csv(rows));
    Q.audit('export', 'Export', name, 'Exported ' + (what || name) + ' (' + (rows.length - 1) + ' rows, CSV)');
    Q.save();
    Q.toast('Exported ' + name + ' · logged in the audit trail');
  };
  Q.printHtml = function (title, bodyHtml, what) {
    var css = '<style>body{font:13px/1.5 Inter,system-ui,sans-serif;color:#17191E;margin:32px}h1,h2{font-family:"Space Grotesk",Inter,sans-serif}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #DADDE2;padding:6px 8px;text-align:left;vertical-align:top}th{background:#F1F1EE}.wm{position:fixed;top:40%;left:0;right:0;text-align:center;font:700 72px sans-serif;color:rgba(168,67,15,.12);transform:rotate(-28deg);pointer-events:none}.foot{margin-top:24px;font-size:11px;color:#5B616B;border-top:1px solid #DADDE2;padding-top:8px}.mono{font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all}@media print{.noprint{display:none}}</style>';
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + Q.esc(title) + '</title>' + css + '</head><body><p class="noprint" style="background:#E8EFF7;padding:8px 12px;border-radius:6px">Prototype output: use your browser’s Print → Save as PDF. In production the server renders this PDF.</p>' + bodyHtml + '</body></html>';
    var w = window.open('', '_blank');
    if (!w) { Q.download(title.replace(/\W+/g, '-') + '.html', html, 'text/html'); Q.toast('Pop-up blocked, so the file was downloaded instead'); }
    else { w.document.open(); w.document.write(html); w.document.close(); }
    Q.audit('export', 'Export', title, 'Generated ' + (what || title));
    Q.save();
  };

  // ---------- Tour (first-run walkthrough) ----------
  var TOUR = [
    { t: 'Welcome to VeQMS', x: 'This is a working prototype of the frontend. Everything runs in your browser with sample records; nothing is sent anywhere. Changes are saved in this browser until you reset the demo.' },
    { t: 'Start with Today', x: 'Today groups your work by urgency: overdue, next 7 days, then upcoming. Each card has one primary action. Pick a card to see the record beside it.' },
    { t: 'Search, create, jump: Ctrl K', x: 'The command bar searches records and document text, creates new items and jumps to any page. Results only include what you are allowed to see.' },
    { t: 'Sign with a fresh sign-in', x: 'Every signature asks you to sign in again (simulated here; Microsoft Entra ID with MFA in production). Each record gets its own signature with a SHA-256 fingerprint and UTC time.' },
    { t: 'See it from other seats', x: 'Use the account menu → "Demo · view as" to switch between the Quality Manager, author, approver, employee, System Administrator and auditor. Rules such as segregation of duties change with the role.' }
  ];
  Q.tour = {
    open: function (i) {
      i = i || 0; var s = TOUR[i];
      var el = document.querySelector('.tour'); if (!el) { el = document.createElement('div'); el.className = 'tour'; document.body.appendChild(el); }
      el.innerHTML = String(h`<div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-t"><div class="label">Guided tour · ${i + 1} of ${TOUR.length}</div><h2 id="tour-t" class="h1" style="margin:6px 0 10px">${s.t}</h2><p>${s.x}</p>
        <div class="spread mt-24"><div class="tour-dots">${TOUR.map(function (_, j) { return h`<i class="${j === i ? 'on' : ''}"></i>`; })}</div><div class="btn-row"><button class="btn" data-act="tour-close">Skip</button><button class="btn btn-primary" data-act="tour-next" data-i="${i + 1}">${i + 1 < TOUR.length ? 'Next' : 'Start'}</button></div></div></div>`);
      el.querySelector('.btn-primary').focus();
    },
    close: function () { var el = document.querySelector('.tour'); if (el) el.remove(); Q.S.seen.tour = true; Q.save(); }
  };
  Q.act.tour = function () { Q.tour.open(0); };
  Q.act['tour-next'] = function (el) { var i = +el.getAttribute('data-i'); if (i >= TOUR.length) Q.tour.close(); else Q.tour.open(i); };
  Q.act['tour-close'] = function () { Q.tour.close(); };

  Q.views.notFound = function () { return h`<div class="empty"><h1>Page not found</h1><p>That link doesn’t match a page.</p><a class="btn" href="#/today">Go to Today</a></div>`; };
  Q.views.denied = function (what) { return h`<div class="card card-pad"><h1>You don’t have access to ${what}</h1><p class="muted">Your role doesn’t include this area. Ask a System Administrator if you need it. The attempt was not logged as an error.</p><a class="btn" href="#/today">Back to Today</a></div>`; };
})(window.Q);
