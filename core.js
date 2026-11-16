/* Core helpers shared by every module: safe HTML templating, dates, hashing, icons, CSV. */
window.Q = window.Q || {};
(function (Q) {
  'use strict';

  // ---------- Safe HTML templating ----------
  // Every interpolated value is escaped unless it is already a Raw (built by Q.h or Q.raw).
  function Raw(s) { this.s = s; }
  Raw.prototype.toString = function () { return this.s; };
  Q.Raw = Raw;
  Q.raw = function (s) { return new Raw(String(s == null ? '' : s)); };
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  Q.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  Q.str = function (v) {
    if (v == null || v === false || v === true) return '';
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(Q.str).join('');
    return Q.esc(v);
  };
  Q.h = function (strings) {
    var out = strings[0];
    for (var i = 1; i < arguments.length; i++) out += Q.str(arguments[i]) + strings[i];
    return new Raw(out);
  };
  Q.when = function (cond, a, b) { return cond ? a : (b || ''); };
  Q.attr = function (name, val) { return val ? Q.raw(' ' + name + '="' + Q.esc(val) + '"') : ''; };

  // ---------- Dates (stored as UTC ISO strings, shown in local time) ----------
  var DAY = 86400000;
  Q.DAY = DAY;
  Q.startOfDay = function (d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  Q.today = function () { return Q.startOfDay(new Date()); };
  Q.addDays = function (d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; };
  Q.iso = function (d) { return new Date(d).toISOString(); };
  Q.dayIso = function (n, hour, min) { // n days from today, at a local time
    var d = Q.addDays(Q.today(), n); d.setHours(hour == null ? 17 : hour, min || 0, 0, 0); return d.toISOString();
  };
  Q.daysFromToday = function (iso) {
    if (!iso) return null;
    return Math.round((Q.startOfDay(iso) - Q.today()) / DAY);
  };
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MOL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  Q.fmtDate = function (iso) { if (!iso) return '—'; var d = new Date(iso); return d.getDate() + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear(); };
  Q.fmtShort = function (iso) { if (!iso) return '—'; var d = new Date(iso); return d.getDate() + ' ' + MO[d.getMonth()]; };
  Q.fmtDay = function (iso) { var d = new Date(iso); return WD[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()]; };
  Q.fmtLong = function (d) { d = new Date(d); return WDL[d.getDay()] + ' ' + d.getDate() + ' ' + MOL[d.getMonth()]; };
  Q.fmtTime = function (iso) { var d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  Q.fmtDateTime = function (iso) { if (!iso) return '—'; return Q.fmtShort(iso) + ', ' + Q.fmtTime(iso); };
  Q.fmtUtc = function (iso) { if (!iso) return '—'; return new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'); };
  Q.relDue = function (iso) {
    // Wording from the Step 2 chips: "Overdue 2 days", "Due Fri", "Due Mon 16 Nov".
    var n = Q.daysFromToday(iso);
    if (n === null) return { text: 'No due date', cls: '' };
    if (n < 0) return { text: 'Overdue ' + (-n) + (n === -1 ? ' day' : ' days'), cls: 'chip-overdue', n: n };
    if (n === 0) return { text: 'Due today', cls: 'chip-due', n: n };
    if (n === 1) return { text: 'Due tomorrow', cls: 'chip-due', n: n };
    if (n < 7) return { text: 'Due ' + Q.fmtDay(iso), cls: 'chip-due', n: n };
    return { text: 'Due ' + Q.fmtDay(iso), cls: 'chip-outline', n: n };
  };
  Q.ago = function (iso) {
    var s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
    return Q.fmtShort(iso);
  };

  // ---------- SHA-256 (synchronous, so it works from file:// as well as a server) ----------
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function ror(x, n) { return (x >>> n) | (x << (32 - n)); }
  Q.sha256 = function (text) {
    var bytes = new TextEncoder().encode(String(text));
    var l = bytes.length;
    var total = Math.ceil((l + 9) / 64) * 64;
    var buf = new Uint8Array(total);
    buf.set(bytes); buf[l] = 0x80;
    var dv = new DataView(buf.buffer);
    var bits = l * 8;
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(total - 4, bits >>> 0);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Uint32Array(64);
    for (var i = 0; i < total; i += 64) {
      for (var t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4);
      for (t = 16; t < 64; t++) {
        var x = W[t - 15], y = W[t - 2];
        var s0 = ror(x, 7) ^ ror(x, 18) ^ (x >>> 3);
        var s1 = ror(y, 17) ^ ror(y, 19) ^ (y >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ror(e, 6) ^ ror(e, 11) ^ ror(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        var S0 = ror(a, 2) ^ ror(a, 13) ^ ror(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(function (v) { return v.toString(16).padStart(8, '0'); }).join('');
  };
  // Canonical JSON: sorted keys, no whitespace (stands in for RFC 8785 in the prototype).
  Q.canon = function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  };

  // ---------- Misc ----------
  Q.uid = function (p) { return (p || 'x') + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); };
  Q.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  Q.by = function (key, dir) {
    dir = dir || 1;
    return function (a, b) {
      var x = typeof key === 'function' ? key(a) : a[key], y = typeof key === 'function' ? key(b) : b[key];
      if (x == null) return 1; if (y == null) return -1;
      return x < y ? -dir : x > y ? dir : 0;
    };
  };
  Q.plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); };
  Q.pct = function (a, b) { return b ? Math.round((a / b) * 100) : 0; };
  Q.debounce = function (fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; };

  Q.csv = function (rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        // Neutralise spreadsheet formula injection, then quote.
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\r\n');
  };
  Q.download = function (filename, text, type) {
    var blob = new Blob([text], { type: type || 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  };

  // ---------- Icons (simple 24px line icons) ----------
  var P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    doc: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 17h5"/>',
    training: '<path d="M3 6.5 12 3l9 3.5-9 3.5z"/><path d="M7 8.3V14c0 1.6 2.2 3 5 3s5-1.4 5-3V8.3"/><path d="M21 6.5V12"/>',
    change: '<path d="M4 8h13"/><path d="m14 4 4 4-4 4"/><path d="M20 16H7"/><path d="m10 12-4 4 4 4"/>',
    review: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="m9 15 2 2 4-4"/>',
    quality: '<path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5M12 17h.01"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7.5 16v-4M12 16V8M16.5 16v-6"/>',
    admin: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.3-2.5 3.9"/><path d="M12 17h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    back: '<path d="m15 6-6 6 6 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    board: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.1.7 3.5 2.8 3.5 5.7"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    clip: '<path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.4 17.3a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    wifiOff: '<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2.1-1.6M2 8.8a15 15 0 0 1 4.3-2.6M22 8.8A15 15 0 0 0 11 5"/><path d="M12 20h.01"/>',
    filter: '<path d="M3 5h18l-7 8.5V19l-4 2v-7.5z"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sign: '<path d="M3 19c3-1 4.5-6 6.5-6 1.5 0-.5 5 1.5 5 1.5 0 2.5-3 4-3 1 0 1 2 2 2h4"/><path d="m15 4 4 4-8 8H7v-4z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    comment: '<path d="M4 5h16v11H9l-5 4z"/>',
    plug: '<path d="M9 2v5M15 2v5"/><path d="M6 7h12v4a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    template: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    flow: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v4a2 2 0 0 0 2 2h7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    log: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h1v0M3 12h1M3 18h1"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    send: '<path d="M21 3 10 14"/><path d="M21 3 14 21l-4-7-7-4z"/>',
    raise: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    tasks: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
    shieldAlert: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z"/><path d="M12 8v4.5M12 16h.01"/>',
    printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M6 14h12v7H6z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    out: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'
  };
  Q.icon = function (name, cls) {
    return Q.raw('<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (P[name] || P.doc) + '</svg>');
  };
})(window.Q);
