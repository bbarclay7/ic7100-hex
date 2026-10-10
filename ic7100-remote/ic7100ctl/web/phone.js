// Phone layout (<= 1000 px): ready-to-talk strip, tuning Lock / Return, channel table, keyed styling.
// Loaded after panel.js; uses its globals (icGet, icPost, icCmd, sLabel, calInterp, IC_CAL, swrRatio).
// Everything here is inert on wide screens (CSS hides it). Requirements: UI-PHONE-LAYOUT.md.
(function () {
  'use strict';
  var PHONE = window.matchMedia('(max-width: 1000px)');
  var st = {};                       // last status
  var locked = false;
  var anchor = null;                 // {kind:'freq', hz, mode} | {kind:'mem', bank, ch, name}
  try { anchor = JSON.parse(localStorage.getItem('ic.anchor') || 'null'); } catch (_) {}
  function saveAnchor() { try { localStorage.setItem('ic.anchor', JSON.stringify(anchor)); } catch (_) {} }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function mhz(hz) {
    var m = Math.floor(hz / 1e6), r = Math.round(hz - m * 1e6), k = Math.floor(r / 1000), h = r % 1000;
    return m + '.' + String(k).padStart(3, '0') + '.' + String(h).padStart(3, '0');
  }

  // ── Lock: commands that retune are refused while locked (Return and the channel table bypass it) ──
  var rawPost = window.icPost;
  var TUNING = {freq: 1, memory_step: 1, memory_select: 1, memory_bank: 1, memory_pick: 1, memory_mode: 1, vfo: 1};
  window.icPost = function (body) {
    if (locked && body && TUNING[body.cmd]) return Promise.resolve({ok: false, error: 'tuning is locked'});
    return rawPost(body);
  };
  function setLocked(on) {
    locked = on;
    document.body.classList.toggle('tune-locked', on);
    var b = $('ic-m-lock'); if (b) { b.classList.toggle('on', on); b.querySelector('.cessb-txt').textContent = on ? 'LOCKED' : 'LOCK'; }
  }

  // ── Anchor (what Return goes back to) ──
  function setAnchorFreq(hz, mode) { anchor = {kind: 'freq', hz: hz, mode: mode || st.mode}; saveAnchor(); drawAnchor(); }
  function setAnchorMem(bank, ch, name) { anchor = {kind: 'mem', bank: bank, ch: ch, name: name || ''}; saveAnchor(); drawAnchor(); }
  function markHere() {
    if (st.memory_mode && st.memory_bank && st.memory_channel) setAnchorMem(st.memory_bank, st.memory_channel, st.memory_name || (st.memory_match && st.memory_match.name));
    else if (st.freq_hz) setAnchorFreq(st.freq_hz, st.mode);
  }
  function doReturn() {
    if (!anchor) return;
    if (anchor.kind === 'mem') { rawPost({cmd: 'memory_pick', bank: anchor.bank, ch: anchor.ch}).then(poll); return; }
    rawPost({cmd: 'freq', args: String(anchor.hz / 1e6)}).then(function () {
      if (anchor.mode && anchor.mode !== st.mode) return rawPost({cmd: 'mode', mode: anchor.mode});
    }).then(poll);
  }
  function drawAnchor() {
    var t = $('ic-m-anchor'); if (!t) return;
    if (!anchor) { t.textContent = 'No anchor: type a frequency, pick a channel or tap Mark'; return; }
    if (anchor.kind === 'mem') {
      var here = st.memory_mode && st.memory_bank === anchor.bank && st.memory_channel === anchor.ch;
      t.textContent = 'Set ' + anchor.bank + anchor.ch + (anchor.name ? ' ' + anchor.name : '') + (here ? ' (on it)' : ' (moved)');
    } else {
      var d = st.freq_hz ? st.freq_hz - anchor.hz : 0, ad = Math.abs(d);
      var diff = !st.freq_hz ? '' : ad < 1 ? ' (on it)' :
        ' (now ' + (d > 0 ? '+' : '−') + (ad >= 1000 ? (ad / 1000).toFixed(ad >= 10000 ? 0 : 1) + ' kHz' : ad + ' Hz') + ')';
      t.textContent = 'Set ' + mhz(anchor.hz) + diff;
    }
  }
  // typing a frequency and pressing Set makes it the anchor
  var origTyped = window.applyTypedFreq;
  window.applyTypedFreq = function () {
    var inp = $('ic-freq-typed'), v = inp ? inp.value.trim() : '', n = parseFloat(v);
    var before = locked;
    origTyped();
    if (!before && v && !isNaN(n)) setAnchorFreq(Math.round((n > 3000 ? n / 1000 : n) * 1e6), st.mode);
  };

  // ── Strip + extra buttons ──
  var strip, bar, barTxt, ptt, pttHome, pttNext;
  function lampBtn(id, label) {
    var b = el('button', 'cessb-btn'); b.id = id; b.type = 'button';
    b.appendChild(el('span', 'cessb-led')); b.appendChild(el('span', 'cessb-txt', label)); return b;
  }
  function build() {
    var mini = $('ic-mini');
    if (!mini || $('ic-strip')) return;
    // top bar: lock / return / mark / channel + anchor line
    var row = el('div', 'ic-mini-tools');
    var lock = lampBtn('ic-m-lock', 'LOCK'), ret = lampBtn('ic-m-return', 'RETURN'), mark = lampBtn('ic-m-mark', 'MARK'),
        chan = lampBtn('ic-m-chan', 'CHANNEL');
    lock.onclick = function () { setLocked(!locked); };
    ret.onclick = doReturn; mark.onclick = markHere; chan.onclick = openTable;
    [lock, ret, mark, chan].forEach(function (b) { row.appendChild(b); });
    mini.appendChild(row);
    mini.appendChild(el('div', 'ic-mini-anchor')).id = 'ic-m-anchor';

    // bottom strip
    strip = el('div', 'ic-strip'); strip.id = 'ic-strip';
    var meter = el('div', 'ic-strip-meter'); bar = el('div', 'ic-strip-fill'); barTxt = el('span', 'ic-strip-meter-txt', 'S 0');
    meter.appendChild(bar); meter.appendChild(barTxt); strip.appendChild(meter);

    var rx = el('div', 'ic-strip-row');
    var nr = lampBtn('ic-m-nr', 'NR'); nr.onclick = function () { rawPost({cmd: 'nr', on: !st.nr_on}).then(poll); };
    var rfWrap = el('label', 'ic-strip-rf', 'RF');
    var rf = document.createElement('input'); rf.type = 'range'; rf.min = 0; rf.max = 100; rf.step = 1; rf.value = 100; rf.id = 'ic-m-rf';
    var rfVal = el('span', 'ic-strip-val', '100');
    var rfBusy = false, rfPending = null, rfTouched = 0;
    function sendRf() {
      if (rfBusy || rfPending == null) return;
      var v = rfPending; rfPending = null; rfBusy = true;
      rawPost({cmd: 'rf_gain', pct: v}).then(function () { rfBusy = false; sendRf(); });
    }
    rf.addEventListener('input', function () { rfTouched = Date.now(); rfVal.textContent = rf.value; rfPending = +rf.value; sendRf(); });
    rfWrap.appendChild(rf); rfWrap.appendChild(rfVal); rfWrap.appendChild(el('span', 'ic-strip-tick', '▲100'));
    rx.appendChild(nr); rx.appendChild(rfWrap); strip.appendChild(rx);

    var tx = el('div', 'ic-strip-row');
    var mic = el('div', 'ic-strip-mic'); mic.id = 'ic-m-mic';
    var mm = el('div', 'ic-strip-micbar'); var mf = el('div', 'ic-strip-micfill'); mm.appendChild(mf); mic.appendChild(el('span', 'ic-strip-mictxt', 'Mic: —')); mic.appendChild(mm);
    var pre = lampBtn('ic-m-pre', 'PRE'), ces = lampBtn('ic-m-cessb', 'CESSB');
    pre.onclick = function () { var b = $('ic-preemph'); if (b) b.click(); };
    ces.onclick = function () { var b = $('ic-cessb'); if (b) b.click(); };
    tx.appendChild(mic); tx.appendChild(pre); tx.appendChild(ces); strip.appendChild(tx);

    var pw = el('div', 'ic-strip-ptt'); pw.id = 'ic-m-pttwrap'; strip.appendChild(pw);
    document.body.appendChild(strip);

    // mirror the existing widgets into the strip
    setInterval(function () {
      var m = $('ic-mini-mic'), t = mic.firstChild, src = $('ic-mic-meter');
      var txt = m ? m.textContent.replace(/^Mic: /, '') : '';
      t.textContent = 'Mic: ' + (txt || '—');
      if (src && src.firstChild) mf.style.width = src.firstChild.style.width || '0';
      [['ic-preemph', pre], ['ic-cessb', ces]].forEach(function (p) {
        var s = $(p[0]); if (!s) return;
        p[1].classList.toggle('on', s.classList.contains('on')); p[1].classList.toggle('na', s.classList.contains('na'));
      });
      nr.classList.toggle('on', !!st.nr_on);
      if (typeof st.rf_gain === 'number' && Date.now() - rfTouched > 1500) { rf.value = st.rf_gain; rfVal.textContent = st.rf_gain; }
    }, 200);

    movePtt();
    (PHONE.addEventListener ? PHONE.addEventListener('change', movePtt) : PHONE.addListener(movePtt));
  }
  // The real hold-to-talk button moves into the strip on phones (listeners come with it).
  function movePtt() {
    var b = $('ic-ptt-btn'), wrap = $('ic-m-pttwrap');
    if (!b || !wrap) return;
    if (PHONE.matches) { if (!pttHome) { pttHome = b.parentNode; pttNext = b.nextSibling; } wrap.appendChild(b); }
    else if (pttHome && b.parentNode === wrap) pttHome.insertBefore(b, pttNext);
  }

  // ── Status poll: meter, keyed styling, anchor drift ──
  function poll() {
    return icGet('/ic7100status').then(function (s) {
      st = s || {};
      if (!bar) return;
      var keyed = !!(st.transmitting || st.ptt_active || window._pttHeld);
      document.body.classList.toggle('keyed', keyed);
      var raw, txt;
      if (keyed) {
        raw = typeof st.po === 'number' ? st.po : 0;
        var w = typeof calInterp === 'function' ? Math.round(calInterp(IC_CAL.po, raw)) : raw;
        var swr = typeof swrRatio === 'function' ? swrRatio(typeof st.swr === 'number' ? st.swr : 0).toFixed(1) : '—';
        txt = w + ' W   SWR ' + swr;
      } else {
        raw = typeof st.smeter === 'number' ? st.smeter : 0;
        txt = typeof sLabel === 'function' ? sLabel(raw) : String(raw);
      }
      bar.style.width = Math.max(0, Math.min(100, raw * 100 / 255)).toFixed(0) + '%';
      barTxt.textContent = txt;
      drawAnchor();
    });
  }
  setInterval(function () { if (PHONE.matches || window.innerWidth <= 1000) poll(); }, 400);

  // ── Channel table ──
  var tableBank = null, rows = [];
  function openTable() {
    var o = $('ic-m-table');
    if (!o) {
      o = el('div', 'ic-table'); o.id = 'ic-m-table';
      var head = el('div', 'ic-table-head');
      var close = el('button', 'rb', 'Close'); close.onclick = function () { o.hidden = true; };
      head.appendChild(close);
      'ABCDE'.split('').forEach(function (b) {
        var bb = el('button', 'rb ic-table-bank', b); bb.dataset.bank = b;
        bb.onclick = function () { tableBank = b; render(); }; head.appendChild(bb);
      });
      o.appendChild(head); o.appendChild(el('div', 'ic-table-list')).id = 'ic-m-tablelist';
      document.body.appendChild(o);
    }
    o.hidden = false;
    if (!tableBank) tableBank = st.memory_bank || 'E';
    $('ic-m-tablelist').textContent = 'Loading…';
    rawPost({cmd: 'memory_list'}).then(function (d) {
      rows = (d && d.channels) || [];
      if (d && d.ok && !d.scanned) $('ic-m-tablelist').textContent = 'Memories are still being read from the radio, try again in a moment.';
      else render();
    });
  }
  function pick(r, close) {
    rawPost({cmd: 'memory_pick', bank: r.bank, ch: r.ch}).then(function (d) {
      if (d && d.ok) { setAnchorMem(r.bank, r.ch, r.name); if (close) $('ic-m-table').hidden = true; poll(); }
      else if (typeof icFeedback === 'function') icFeedback((d && d.error) || 'select failed', true);
    });
  }
  function render() {
    var list = $('ic-m-tablelist'); if (!list) return;
    Array.prototype.forEach.call($('ic-m-table').querySelectorAll('.ic-table-bank'), function (b) {
      b.classList.toggle('active', b.dataset.bank === tableBank);
    });
    list.textContent = '';
    var cur = st.memory_mode ? st.memory_channel : null;
    rows.filter(function (r) { return r.bank === tableBank; }).forEach(function (r) {
      var tr = el('div', 'ic-table-row' + (cur === r.ch && st.memory_bank === r.bank ? ' cur' : ''));
      tr.appendChild(el('span', 'ic-table-ch', String(r.ch)));
      tr.appendChild(el('span', 'ic-table-name', r.name || '—'));
      tr.appendChild(el('span', 'ic-table-freq', (r.freq_hz ? (r.freq_hz / 1e6).toFixed(4) : '') + ' ' + (r.mode || '')));
      // quick press: tune and stay open; long press (>= 0.5 s): tune and close
      var timer = null, long = false, moved = false, sx = 0, sy = 0;
      tr.addEventListener('pointerdown', function (e) {
        long = false; moved = false; sx = e.clientX; sy = e.clientY;
        timer = setTimeout(function () { long = true; timer = null; pick(r, true); }, 500);
      });
      tr.addEventListener('pointermove', function (e) {
        if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 10) { moved = true; if (timer) { clearTimeout(timer); timer = null; } }
      });
      tr.addEventListener('pointerup', function () {
        if (timer) { clearTimeout(timer); timer = null; if (!moved && !long) pick(r, false); }
      });
      tr.addEventListener('pointercancel', function () { if (timer) { clearTimeout(timer); timer = null; } });
      tr.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      list.appendChild(tr);
    });
    if (!list.firstChild) list.textContent = 'No programmed channels in bank ' + tableBank + '.';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
  window._phone = {setLocked: setLocked, state: function () { return {locked: locked, anchor: anchor}; }};
})();
