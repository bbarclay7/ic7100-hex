// ic7100ctl — IC-7100 control panel.
// Adapted from the Radio Gateway ic7100 panel. The original lived inside a
// multi-radio gateway shell; this version is standalone. Endpoint/link/
// interlock/voice-relay chrome was removed (see notes inline). The chase-
// target tuner, pot-knob chase, freq-spinner _userTuning lock, and RIT
// auto-engage logic are preserved verbatim.

// ── Static data ─────────────────────────────────────────────────────────
// USA national calling frequencies (MHz) + conventional mode for each.
// [name, freq_mhz, mode]
var IC_BANDS = [
  ['160m', 1.910,  'LSB'], ['80m', 3.985,  'LSB'], ['40m', 7.285,  'LSB'],
  ['30m', 10.116,  'CW'],  ['20m', 14.285, 'USB'], ['17m', 18.130, 'USB'],
  ['15m', 21.385,  'USB'], ['12m', 24.950, 'USB'], ['10m', 28.400, 'USB'],
  ['6m', 50.125,   'USB'], ['2m', 146.520, 'FM'],  ['70cm', 446.000, 'FM'],
];
var IC_MODES = ['LSB', 'USB', 'AM', 'CW', 'CW-R', 'RTTY', 'RTTY-R', 'FM', 'DV'];

// ── Helpers ─────────────────────────────────────────────────────────────
function icGet(path) {
  return fetch(path, {cache: 'no-store'}).then(function(r){ return r.json(); })
                                         .catch(function(){ return {}; });
}
function icPost(body) {
  return fetch('/ic7100cmd', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  }).then(function(r){ return r.json(); })
    .catch(function(e){ return {ok:false, error:String(e)}; });
}
function icFeedback(msg, isErr) {
  var el = document.getElementById('ic-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = 'ic-val ' + (isErr ? 'err' : 'ok');
  setTimeout(function(){ if (el.textContent === msg) el.textContent = ''; }, 3000);
}
function icCmd(cmd, extra) {
  var body = Object.assign({cmd: cmd}, extra || {});
  return icPost(body).then(function(d){
    if (!d.ok) icFeedback(d.error || 'cmd failed', true);
    pollStatus();
    return d;
  });
}

// ── Memory helpers ─────────────────────────────────────────────────────
var _memMode = false;
function toggleMemoryMode() {
  if (_memMode) {
    icCmd('vfo', {vfo: _activeVfo || 'A'});
  } else {
    icCmd('memory_mode', {on: true});
  }
}
// Both are idempotent, so they always send: the shown mode can be an inference.
// Walk the programmed memories in the current bank (the head unit's M-CH dial).
// Steps pile up while a request is in flight and go out as one.
var _memStepPending = 0, _memStepBusy = false, _memWheelAcc = 0;
function memStep(n) { _memStepPending += n; _flushMemStep(); }
function _flushMemStep() {
  if (_memStepBusy || !_memStepPending) return;
  var n = _memStepPending; _memStepPending = 0; _memStepBusy = true;
  icCmd('memory_step', {n: n}).then(function () { _memStepBusy = false; _flushMemStep(); },
                                    function () { _memStepBusy = false; });
}
(function () {
  function hook() {
    ['ic-memo', 'ic-chstep'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('wheel', function (e) {
        e.preventDefault();
        var n;
        if (e.deltaMode === 0 && Math.abs(e.deltaY) < 50) {   // trackpad
          _memWheelAcc += -e.deltaY;
          n = Math.trunc(_memWheelAcc / 25);
          if (n === 0) return;
          _memWheelAcc -= n * 25;
        } else {
          n = e.deltaY < 0 ? 1 : -1;                           // mouse notch
        }
        memStep(n);
      }, {passive: false});
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
})();

var _inMem = false;   // memory mode as shown (set by the panel or inferred); see pollStatus
// Tap the MEMO/VFO block, like the head unit: switch to the other mode.
function toggleVfoMem() { if (_inMem) setVfoMode(); else setMemMode(); }
function setVfoMode() { icCmd('vfo', {vfo: _activeVfo || 'A'}); }
function setMemMode() { icCmd('memory_mode', {on: true}); }
function selectMemoryChannel() {
  var el = document.getElementById('ic-mem-ch');
  var n = parseInt(el.value, 10);
  if (isNaN(n) || n < 1) n = 1;
  if (n > 99) n = 99;
  el.value = n;
  icCmd('memory_select', {channel: n});
}
var _memBank = null;
function selectMemoryBank(b) {
  icCmd('memory_bank', {bank: b});
}
function _bankLabel() { return _memBank ? _memBank + '-' : ''; }
function writeMemory() {
  var ch = parseInt(document.getElementById('ic-mem-ch').value, 10) || 0;
  if (!window.confirm('Overwrite memory channel ' + _bankLabel() + ch + ' with current VFO?' +
      (_memBank ? '' : '\n(Active bank unknown: select a bank first to be sure.)'))) return;
  icCmd('memory_write');
}
function clearMemory() {
  var ch = parseInt(document.getElementById('ic-mem-ch').value, 10) || 0;
  if (!window.confirm('Clear memory channel ' + _bankLabel() + ch + '?' +
      (_memBank ? '' : '\n(Active bank unknown: select a bank first to be sure.)'))) return;
  icCmd('memory_clear');
}
var _activeVfo = null;

// ── Band + mode row population ─────────────────────────────────────────
function buildBandRow() {
  var row = document.getElementById('ic-band-row');
  IC_BANDS.forEach(function(b) {
    var btn = document.createElement('button');
    btn.className = 'rb rb-sm';
    btn.textContent = b[0];
    btn.dataset.band = b[0];
    btn.dataset.freq = b[1];
    btn.onclick = function() {
      _freqHz = _clampFreq(b[1] * 1e6);
      _userTuning = true;
      _renderFreq();
      icPost({cmd:'freq', args: String(b[1])}).then(function() {
        icPost({cmd:'mode', mode: b[2]}).then(function() {
          setTimeout(function() { _userTuning = false; }, 250);
        });
      });
    };
    row.appendChild(btn);
  });
}
function buildModeRow() {
  var row = document.getElementById('ic-mode-row');
  if (!row) return;   // head-unit layout has no mode row: the mode box opens a menu
  IC_MODES.forEach(function(m) {
    var btn = document.createElement('button');
    btn.className = 'rb rb-sm';
    btn.textContent = m;
    btn.dataset.mode = m;
    btn.onclick = function() { icCmd('mode', {mode: m}); };
    row.appendChild(btn);
  });
}

// ── Head-unit style pick menus: tap the mode box / filter box ──────────
var _lcdMenu = null;
function closeLcdMenu() { if (_lcdMenu) { _lcdMenu.remove(); _lcdMenu = null; } }
function openLcdMenu(anchor, items, current, onPick) {
  var wasOpenHere = _lcdMenu && _lcdMenu._anchor === anchor;
  closeLcdMenu();
  if (wasOpenHere) return;                       // second tap closes it
  var m = document.createElement('div');
  m.className = 'lcd-menu';
  m._anchor = anchor;
  items.forEach(function (it) {
    var b = document.createElement('button');
    b.className = 'rb rb-sm' + (String(it.value) === String(current) ? ' active' : '');
    b.textContent = it.label;
    b.onclick = function (e) { e.stopPropagation(); closeLcdMenu(); onPick(it.value); };
    m.appendChild(b);
  });
  var r = anchor.getBoundingClientRect();
  m.style.left = (window.scrollX + r.left) + 'px';
  m.style.top = (window.scrollY + r.bottom + 4) + 'px';
  document.body.appendChild(m);
  _lcdMenu = m;
}
document.addEventListener('click', function (e) {
  if (_lcdMenu && !_lcdMenu.contains(e.target) && !_lcdMenu._anchor.contains(e.target)) closeLcdMenu();
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLcdMenu(); });
function openModeMenu(anchor) {
  var cur = (document.getElementById('ic-mode-cur') || {}).textContent;
  openLcdMenu(anchor, IC_MODES.map(function (m) { return {label: m, value: m}; }), cur,
              function (m) { icCmd('mode', {mode: m}); });
}
function openFilterMenu(anchor) {
  var cur = (document.getElementById('ic-filter-cur') || {}).textContent;
  openLcdMenu(anchor, [1, 2, 3].map(function (i) { return {label: 'FIL' + i, value: i}; }), cur,
              function (i) { icCmd('filter', {idx: i}); });
}

// ── Freq display: digit-row "spin the knob" controller ─────────────────
var IC_FREQ_DIGITS = 10;
var IC_FREQ_MIN_HZ = 30000;        // 0.030 MHz
var IC_FREQ_MAX_HZ = 470000000;    // 470 MHz
var _freqHz = 14200000;
var _activePos = 3;
var _userTuning = false;

function _clampFreq(hz) {
  return Math.max(IC_FREQ_MIN_HZ, Math.min(IC_FREQ_MAX_HZ, Math.round(hz)));
}

function _renderFreq() {
  var el = document.getElementById('ic-freq');
  if (!el) return;
  var hz = Math.max(0, Math.round(_freqHz));
  var s = String(hz).padStart(IC_FREQ_DIGITS, '0');
  var html = '';
  var seenNonZero = false;
  for (var i = 0; i < IC_FREQ_DIGITS; i++) {
    var pos = IC_FREQ_DIGITS - 1 - i;
    var digit = s.charAt(i);
    if (digit !== '0') seenNonZero = true;
    var leading = !seenNonZero && pos > 6;
    var active = (pos === _activePos);
    html += '<span class="ic-fd' + (active ? ' active' : '')
          + (leading ? ' leading' : '') + '" data-pos="' + pos + '">'
          + digit + '</span>';
    if (pos === 6 || pos === 3) html += '<span class="ic-freq-dot">.</span>';
  }
  html += '<span class="ic-freq-unit">MHz</span>';
  el.innerHTML = html;
  var miniF = document.getElementById('ic-mini-freq');
  if (miniF) {                                  // e.g. 147.220.000 (phones' sticky readout)
    var ms = String(hz).padStart(9, '0');
    miniF.textContent = String(+ms.slice(0, ms.length - 6)) + '.' + ms.slice(-6, -3) + '.' + ms.slice(-3);
  }
  var kc = document.getElementById('ic-vfo-knob-cap');
  if (kc) kc.textContent = 'VFO · ' + _fmtStep(Math.pow(10, _activePos));
}

// Single-in-flight tuner: only one freq cmd at a time. When it completes,
// if the user's displayed target has moved, fire another for the new
// target. This self-throttles to whatever rate the radio + serial link
// actually sustain — measured ~1-3 cmd/s on real hardware.
var _freqSendInFlight = false;
var _freqLastSentHz = null;
var _freqSettleMs = 20;

function _kickFreqSend() {
  if (_freqSendInFlight) return;
  if (_freqHz === _freqLastSentHz) return;
  _freqSendInFlight = true;
  var target = _freqHz;
  icPost({cmd:'freq', args: String(target / 1e6)}).then(function(d) {
    if (!d.ok) icFeedback(d.error || 'tune failed', true);
    _freqLastSentHz = target;
  }).catch(function() {
    /* ignore — let poll resync */
  }).finally(function() {
    setTimeout(function() {
      _freqSendInFlight = false;
      if (_freqHz !== _freqLastSentHz) {
        _kickFreqSend();
      } else {
        setTimeout(function() { _userTuning = false; }, 250);
      }
    }, _freqSettleMs);
  });
}

function _stepFreq(delta) {
  var want = _freqHz + delta;
  _freqHz = _clampFreq(want);
  if (_freqHz !== Math.round(want)) {
    icFeedback(_freqHz === IC_FREQ_MIN_HZ ? 'min 0.030 MHz' : 'max 470 MHz', true);
  }
  _userTuning = true;
  _renderFreq();
  _kickFreqSend();
}

function _moveActivePos(delta) {
  _activePos = Math.max(0, Math.min(IC_FREQ_DIGITS - 1, _activePos + delta));
  _renderFreq();
}

function initFreqDisplay() {
  var el = document.getElementById('ic-freq');

  el.addEventListener('click', function(e) {
    var target = e.target.closest('.ic-fd');
    if (target) {
      _activePos = +target.dataset.pos;
      _renderFreq();
      el.focus();
    }
  });

  el.addEventListener('wheel', function(e) {
    e.preventDefault();
    var target = e.target.closest('.ic-fd');
    var pos = target ? +target.dataset.pos : _activePos;
    var n;
    if (e.deltaMode === 0 && Math.abs(e.deltaY) < 50) {   // trackpad: accumulate
      _freqWheelAcc += -e.deltaY;
      n = Math.trunc(_freqWheelAcc / 25);
      if (n === 0) return;
      _freqWheelAcc -= n * 25;
    } else {                                              // mouse notch
      n = e.deltaY < 0 ? 1 : -1;
    }
    _stepFreq(n * Math.pow(10, pos));
  }, {passive: false});

  el.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowUp')   { e.preventDefault(); _stepFreq( Math.pow(10, _activePos)); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); _stepFreq(-Math.pow(10, _activePos)); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); _moveActivePos(+1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); _moveActivePos(-1); }
    else if (e.key === 'PageUp')   { e.preventDefault(); _stepFreq( 10 * Math.pow(10, _activePos)); }
    else if (e.key === 'PageDown') { e.preventDefault(); _stepFreq(-10 * Math.pow(10, _activePos)); }
    else if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      var place = Math.pow(10, _activePos);
      var curDigit = Math.floor(_freqHz / place) % 10;
      var delta = (parseInt(e.key, 10) - curDigit) * place;
      _stepFreq(delta);
      if (_activePos > 0) _moveActivePos(-1);
    }
  });
}

function buildStepRow() {
  var row = document.getElementById('ic-tune-steps');
  var steps = [
    [-1000000, '−1M'], [-100000, '−100k'], [-10000, '−10k'], [-1000, '−1k'],
    [-100, '−100'], [-10, '−10'], [-1, '−1'],
    [ 1, '+1'], [ 10, '+10'], [ 100, '+100'], [ 1000, '+1k'],
    [ 10000, '+10k'], [ 100000, '+100k'], [ 1000000, '+1M'],
  ];
  steps.forEach(function(s, i) {
    var b = document.createElement('button');
    b.className = 'rb rb-sm';
    b.textContent = s[1];
    b.title = (s[0] > 0 ? '+' : '') + s[0] + ' Hz';
    b.onclick = function() { _stepFreq(s[0]); document.getElementById('ic-freq').focus(); };
    if (i === 7) b.style.marginLeft = 'var(--s-2)';
    row.appendChild(b);
  });
}

function applyTypedFreq() {
  var inp = document.getElementById('ic-freq-typed');
  var v = inp.value.trim();
  if (!v) return;
  var n = parseFloat(v);
  if (isNaN(n)) { icFeedback('not a number', true); return; }
  var mhz = (n > 3000) ? (n / 1000) : n;
  var want = Math.round(mhz * 1e6);
  _freqHz = _clampFreq(want);
  if (_freqHz !== want) {
    icFeedback('clamped to ' + (_freqHz / 1e6).toFixed(3) + ' MHz (IC-7100 RX range)', true);
  }
  _userTuning = true;
  _renderFreq();
  icPost({cmd:'freq', args: String(_freqHz / 1e6)}).then(function(d) {
    if (!d.ok) icFeedback(d.error || 'tune failed', true);
    setTimeout(function() { _userTuning = false; }, 500);
  });
  inp.value = '';
  inp.blur();
}

function initTypedFreq() {
  var inp = document.getElementById('ic-freq-typed');
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); applyTypedFreq(); }
  });
}

// Phones: keep the sticky readout's mode / tone / memory text in step with the display.
function updateMini() {
  var m = document.getElementById('ic-mini');
  if (!m) return;
  var t = function (id) { var e = document.getElementById(id); return e ? e.textContent.replace(/\u00a0/g, ' ').trim() : ''; };
  document.getElementById('ic-mini-mode').textContent = t('ic-mode-cur');
  document.getElementById('ic-mini-info').textContent =
    [t('ic-tone-ind'), t('ic-memo-id'), t('ic-mem-name')].filter(Boolean).join(' \u00b7 ');
}
function setFreqDisplay(mhz) {
  if (_userTuning) return;
  if (!mhz || +mhz <= 0) return;
  _freqHz = _clampFreq((+mhz) * 1e6);
  _renderFreq();
}

// ── RIT digit tuner — same spin pattern, signed ±9999 Hz ───────────────
var _ritHz = 0;
var _ritActivePos = 1;
var _ritDigits = 4;
var _ritDebounce = null;
var _ritUserTuning = false;

function _renderRit() {
  var el = document.getElementById('ic-rit-hz');
  if (!el) return;
  var hz = Math.max(-9999, Math.min(9999, _ritHz | 0));
  var mag = Math.abs(hz);
  var s = String(mag).padStart(_ritDigits, '0');
  var sign = (hz < 0) ? '−' : '+';
  var html = '';
  html += '<span class="ic-fd" data-rit-sign="1" title="Click to toggle sign">' + sign + '</span>';
  var seenNonZero = false;
  for (var i = 0; i < _ritDigits; i++) {
    var pos = _ritDigits - 1 - i;
    var digit = s.charAt(i);
    if (digit !== '0') seenNonZero = true;
    var leading = !seenNonZero && pos > 0;
    var active = (pos === _ritActivePos);
    html += '<span class="ic-fd' + (active ? ' active' : '')
          + (leading ? ' leading' : '') + '" data-rit-pos="' + pos + '">'
          + digit + '</span>';
  }
  el.innerHTML = html;
  var rkc = document.getElementById('ic-rit-knob-cap');
  if (rkc) rkc.textContent = 'RIT · ' + _fmtStep(Math.pow(10, _ritActivePos));
}

function _sendRit() {
  if (_ritDebounce) clearTimeout(_ritDebounce);
  _ritDebounce = setTimeout(function() {
    icPost({cmd:'rit', hz: _ritHz}).then(function(d) {
      if (!d.ok) icFeedback(d.error || 'RIT failed', true);
      setTimeout(function() { _ritUserTuning = false; }, 250);
    });
  }, 50);
}

function _stepRit(delta) {
  _ritHz = Math.max(-9999, Math.min(9999, _ritHz + delta));
  _ritUserTuning = true;
  _renderRit();
  _sendRit();
}

function _setRitHz(hz) {
  _ritHz = Math.max(-9999, Math.min(9999, hz | 0));
  _ritUserTuning = true;
  _renderRit();
  _sendRit();
}

function _toggleRitSign() {
  if (_ritHz === 0) return;
  _ritHz = -_ritHz;
  _ritUserTuning = true;
  _renderRit();
  _sendRit();
}

function _moveRitActivePos(delta) {
  _ritActivePos = Math.max(0, Math.min(_ritDigits - 1, _ritActivePos + delta));
  _renderRit();
}

function initRitDisplay() {
  var el = document.getElementById('ic-rit-hz');
  if (!el) return;

  el.addEventListener('click', function(e) {
    var sign = e.target.closest('[data-rit-sign]');
    if (sign) { _toggleRitSign(); el.focus(); return; }
    var d = e.target.closest('[data-rit-pos]');
    if (d) {
      _ritActivePos = +d.dataset.ritPos;
      _renderRit();
      el.focus();
    }
  });

  el.addEventListener('wheel', function(e) {
    e.preventDefault();
    var d = e.target.closest('[data-rit-pos]');
    var pos = d ? +d.dataset.ritPos : _ritActivePos;
    var dir = e.deltaY < 0 ? +1 : -1;
    _stepRit(dir * Math.pow(10, pos));
  }, {passive: false});

  el.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowUp')   { e.preventDefault(); _stepRit( Math.pow(10, _ritActivePos)); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); _stepRit(-Math.pow(10, _ritActivePos)); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); _moveRitActivePos(+1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); _moveRitActivePos(-1); }
    else if (e.key === '+' || e.key === '-') {
      e.preventDefault();
      var want = (e.key === '-') ? -1 : +1;
      if (Math.sign(_ritHz) !== want && _ritHz !== 0) _toggleRitSign();
    }
    else if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      _setRitHz(0);
    }
  });
}

function setRitDisplay(hz) {
  if (_ritUserTuning) return;
  _ritHz = (typeof hz === 'number') ? hz : 0;
  _renderRit();
}

// ── Tuning knobs — drag-to-spin VFO / RIT controls ─────────────────────
var KNOB_VFO = {degPerDetent: 7,   accelKnee: 220, accelSpan: 1200, accelMax: 8, accelExp: 1.7};
var KNOB_RIT = {degPerDetent: 7.2, accelKnee: 280, accelSpan: 1700, accelMax: 3, accelExp: 1.6};
// Drag style: straight-line (right/up = up) by default; add ?knob=circular to
// the page address for the original around-the-centre drag.
var KNOB_LINEAR = !/[?&]knob=circular/.test(location.search);
var KNOB_PX_PER_DETENT = 4;   // px of drag per detent in linear mode
var WHEEL_PX_PER_DETENT = 25; // trackpad scroll px per detent
var _freqWheelAcc = 0;       // trackpad scroll accumulator for the frequency digits

function _fmtStep(hz) {
  if (hz >= 1e6) return (hz / 1e6) + ' MHz';
  if (hz >= 1e3) return (hz / 1e3) + ' kHz';
  return hz + ' Hz';
}

function _knobAccelGain(speed, p) {
  if (speed <= p.accelKnee) return 1;
  var g = 1 + Math.pow((speed - p.accelKnee) / p.accelSpan,
                       p.accelExp) * (p.accelMax - 1);
  return Math.min(p.accelMax, g);
}

function makeTuningKnob(opts) {
  var el = opts.el;
  if (!el) return;
  var hit = opts.hitEl || el;   // what responds to the finger/mouse (phones: the whole pad)
  var p = opts.profile;
  var rotation = 0;
  var dragging = false;
  var prevAngle = 0;
  var prevX = 0, prevY = 0;
  var prevT = 0;
  var emaSpeed = 0;
  var accum = 0;
  var wheelT = 0;

  function centre() {
    var r = el.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  }
  function angleAt(e, c) {
    return Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180 / Math.PI;
  }
  function spinGlow(gain) {
    el.style.setProperty('--spin',
      Math.min(1, (gain - 1) / (p.accelMax - 1)).toFixed(3));
  }

  hit.addEventListener('pointerdown', function(e) {
    dragging = true;
    el.classList.add('spinning');
    try { hit.setPointerCapture(e.pointerId); } catch (_) {}
    prevAngle = angleAt(e, centre());
    prevX = e.clientX; prevY = e.clientY;
    prevT = performance.now();
    emaSpeed = 0; accum = 0;
    e.preventDefault();
  });

  hit.addEventListener('pointermove', function(e) {
    if (!dragging) return;
    var dAng;
    if (KNOB_LINEAR) {
      var dxy = (e.pointerType === 'touch') ? (e.clientX - prevX)        // finger: sideways only
                                            : ((e.clientX - prevX) - (e.clientY - prevY));
      dAng = dxy * (p.degPerDetent / KNOB_PX_PER_DETENT);
      prevX = e.clientX; prevY = e.clientY;
    } else {
      var ang = angleAt(e, centre());
      dAng = ang - prevAngle;
      if (dAng > 180) dAng -= 360;
      else if (dAng < -180) dAng += 360;
      prevAngle = ang;
    }

    var now = performance.now();
    var dt = Math.max((now - prevT) / 1000, 0.001);
    prevT = now;

    rotation += dAng;
    el.style.transform = 'rotate(' + rotation.toFixed(2) + 'deg)';

    var speed = Math.abs(dAng) / dt;
    emaSpeed = emaSpeed * 0.6 + speed * 0.4;

    var gain = _knobAccelGain(emaSpeed, p);
    spinGlow(gain);
    accum += (dAng / p.degPerDetent) * gain;
    var whole = Math.trunc(accum);
    if (whole !== 0) {
      accum -= whole;
      opts.onStep(whole * opts.baseStep());
    }
  });

  function release(e) {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('spinning');
    spinGlow(1);
    try { hit.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  hit.addEventListener('pointerup', release);
  hit.addEventListener('pointercancel', release);

  // Wheel / two-finger scroll over the knob (no click held). A mouse notch
  // is one big event: one step. A trackpad is many tiny pixel events:
  // accumulate them and step every WHEEL_PX_PER_DETENT px. Scroll up = up.
  var wheelAcc = 0;
  hit.addEventListener('wheel', function(e) {
    e.preventDefault();
    var now = performance.now();
    var dt = Math.max((now - wheelT) / 1000, 0.001);
    wheelT = now;
    var n;
    if (e.deltaMode === 0 && Math.abs(e.deltaY) < 50) {          // trackpad
      wheelAcc += -e.deltaY;
      n = Math.trunc(wheelAcc / WHEEL_PX_PER_DETENT);
      if (n === 0) return;
      wheelAcc -= n * WHEEL_PX_PER_DETENT;
    } else {                                                      // mouse notch
      n = e.deltaY < 0 ? 1 : -1;
    }
    emaSpeed = emaSpeed * 0.5 + (Math.abs(n) * p.degPerDetent / dt) * 0.5;
    var gain = _knobAccelGain(emaSpeed, p);
    var mult = Math.max(1, Math.round(gain));
    rotation += n * p.degPerDetent * mult;
    el.style.transform = 'rotate(' + rotation.toFixed(2) + 'deg)';
    spinGlow(gain);
    opts.onStep(n * mult * opts.baseStep());
    clearTimeout(el._wheelGlow);
    el._wheelGlow = setTimeout(function() { spinGlow(1); }, 180);
  }, {passive: false});
}

function initTuningKnobs() {
  var vfoEl = document.getElementById('ic-vfo-knob');
  makeTuningKnob({
    el: vfoEl,
    hitEl: vfoEl ? vfoEl.closest('.knob-wrap') : null,
    profile: KNOB_VFO,
    baseStep: function() { return Math.pow(10, _activePos); },
    onStep: function(d) { _stepFreq(d); }});
  makeTuningKnob({
    el: document.getElementById('ic-rit-knob'),
    profile: KNOB_RIT,
    baseStep: function() { return Math.pow(10, _ritActivePos); },
    onStep: function(d) { _stepRit(d); }});
}

// ── Pot knobs — bounded, linear rotary controls ─────
function makePotKnob(opts) {
  var el = opts.el;
  if (!el) return null;
  var min = opts.min, max = opts.max, sweep = opts.sweep || 270;
  var dial = el.closest('.knob-dial');
  var value = Math.max(min, Math.min(max, opts.value != null ? opts.value : min));
  var dragging = false, prevAngle = 0, sendT = null, pending = null;
  var moved = 0, lastTapT = 0;
  var chaseInFlight = false, chaseLastSent = null;

  function centre() {
    var r = el.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  }
  function angleAt(e, c) {
    return Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180 / Math.PI;
  }
  function render() {
    var frac = (value - min) / (max - min);
    el.style.transform = 'rotate(' + (-sweep / 2 + frac * sweep).toFixed(2) + 'deg)';
    if (dial) dial.style.setProperty('--val', frac.toFixed(4));
    if (opts.onRender) opts.onRender(Math.round(value));
  }
  function _kickChase() {
    if (chaseInFlight) return;
    var t = pending;
    if (t === chaseLastSent) return;
    chaseInFlight = true;
    var ret = opts.onChange(t);
    Promise.resolve(ret).finally(function() {
      chaseLastSent = t;
      chaseInFlight = false;
      if (pending !== chaseLastSent) _kickChase();
    });
  }
  function commit() {
    pending = Math.round(value);
    if (opts.chase) {
      _kickChase();
      return;
    }
    if (sendT) clearTimeout(sendT);
    sendT = setTimeout(function() {
      pending = Math.round(value);
      opts.onChange(pending);
    }, 150);
  }
  function setValue(v) {
    value = Math.max(min, Math.min(max, v));
    render();
    commit();
  }

  el.addEventListener('pointerdown', function(e) {
    dragging = true;
    moved = 0;
    el.classList.add('spinning');
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    prevAngle = angleAt(e, centre());
    e.preventDefault();
  });
  el.addEventListener('pointermove', function(e) {
    if (!dragging) return;
    var ang = angleAt(e, centre());
    var dAng = ang - prevAngle;
    if (dAng > 180) dAng -= 360;
    else if (dAng < -180) dAng += 360;
    prevAngle = ang;
    moved += Math.abs(dAng);
    setValue(value + (dAng / sweep) * (max - min));
  });
  function release(e) {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('spinning');
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    if (moved < 3 && opts.resetValue != null) {
      var now = performance.now();
      if (now - lastTapT < 350) { setValue(opts.resetValue); lastTapT = 0; }
      else { lastTapT = now; }
    }
  }
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);

  // Scroll / two-finger swipe over the knob. A mouse notch is one step; a
  // trackpad sends many tiny pixel events, so those add up (25 px per step).
  var wheelAcc = 0;
  el.addEventListener('wheel', function(e) {
    e.preventDefault();
    var step = opts.wheelStep || Math.max(1, Math.round((max - min) / 50));
    var n;
    if (e.deltaMode === 0 && Math.abs(e.deltaY) < 50) {          // trackpad
      wheelAcc += -e.deltaY;
      n = Math.trunc(wheelAcc / WHEEL_PX_PER_DETENT);
      if (n === 0) return;
      wheelAcc -= n * WHEEL_PX_PER_DETENT;
    } else {                                                      // mouse notch
      n = e.deltaY < 0 ? 1 : -1;
    }
    setValue(value + n * step);
  }, {passive: false});

  render();
  return {
    set: function(v) {
      if (typeof v !== 'number' || dragging) return;
      v = Math.max(min, Math.min(max, v));
      if (pending !== null) {
        if (Math.abs(v - pending) <= 1) pending = null;
        else return;
      }
      value = v;
      render();
    }
  };
}

var _volKnob = null, _rfKnob = null, _sqlKnob = null, _pwrKnob = null, _micKnob = null, _afKnob = null;
function initPotKnobs() {
  _volKnob = makePotKnob({
    el: document.getElementById('ic-vol-knob'),
    min: 0, max: 100, value: 100, wheelStep: 5, resetValue: 0,
    chase: true,
    onRender: function(v) {
      var c = document.getElementById('ic-vol-knob-cap');
      if (c) c.textContent = 'Vol ' + v + '%';
      var led = document.getElementById('ic-vol-led');
      if (led) led.classList.toggle('led-red', v === 0);
    },
    onChange: function(v) { return icCmd('vol', {value: v}); }});
  _rfKnob = makePotKnob({
    el: document.getElementById('ic-rf-knob'),
    min: 0, max: 100, value: 100, wheelStep: 2, resetValue: 100,
    chase: true,
    onRender: function(v) {
      var c = document.getElementById('ic-rf-knob-cap');
      if (c) c.textContent = 'RF Gain ' + v + '%';
    },
    onChange: function(v) { return icCmd('rf_gain', {pct: v}); }});
  _sqlKnob = makePotKnob({
    el: document.getElementById('ic-squelch-knob'),
    min: 0, max: 100, value: 0, wheelStep: 2, resetValue: 20,
    chase: true,
    onRender: function(v) {
      var c = document.getElementById('ic-squelch-knob-cap');
      if (c) c.textContent = 'Sql ' + v + '%';
    },
    onChange: function(v) { return icCmd('squelch', {pct: v}); }});
  _pwrKnob = makePotKnob({
    el: document.getElementById('ic-pwr-knob'),
    min: 0, max: 100, value: 0, wheelStep: 5, resetValue: 0,
    chase: true,
    onRender: function(v) {
      var c = document.getElementById('ic-pwr-knob-cap');
      if (c) c.textContent = 'PWR ' + v + '%';
    },
    onChange: function(v) { return icCmd('power', {pct: v}); }});
  _micKnob = makePotKnob({
    el: document.getElementById('ic-mic-knob'),
    min: 0, max: 100, value: 50, wheelStep: 5,
    chase: true,
    onRender: function(v) {
      var c = document.getElementById('ic-mic-knob-cap');
      if (c) c.textContent = 'MIC ' + v + '%';
    },
    onChange: function(v) { return icCmd('mic_gain', {pct: v}); }});
  _afKnob = makePotKnob({
    el: document.getElementById('ic-af-knob'),
    min: 0, max: 100, value: 50, wheelStep: 5,
    chase: true,
    onRender: function(v) {
      var c = document.getElementById('ic-af-knob-cap');
      if (c) c.textContent = 'AF ' + v + '%';
    },
    onChange: function(v) { return icCmd('af_level', {pct: v}); }});
}

// ── CTCSS ───────────────────────────────────────────────────────────────
function icCtcssApply(which) {
  if (which === 'tx') {
    var hz = parseFloat(document.getElementById('ic-ctcss-tx').value);
    var on = document.getElementById('ic-ctcss-tx-on').checked;
    icCmd('ctcss', {tx_hz: isNaN(hz) ? 0 : hz, tone_on: on});
  } else {
    var hzR = parseFloat(document.getElementById('ic-ctcss-rx').value);
    icCmd('ctcss', {rx_hz: isNaN(hzR) ? 0 : hzR});
  }
}

var IC_CTCSS_TONES = [
  67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5,
  94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0, 127.3,
  131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 162.2, 167.9, 173.8, 179.9,
  186.2, 192.8, 203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8,
  250.3, 254.1
];
function buildCtcssTones() {
  ['ic-ctcss-tx', 'ic-ctcss-rx'].forEach(function(id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    IC_CTCSS_TONES.forEach(function(hz) {
      var opt = document.createElement('option');
      opt.value = hz.toFixed(1);
      opt.textContent = hz.toFixed(1) + ' Hz';
      sel.appendChild(opt);
    });
  });
}

var IC_DTCS_CODES = [
  23,25,26,31,32,36,43,47,51,53,54,65,71,72,73,74,
  114,115,116,122,125,131,132,134,143,145,152,155,156,162,
  165,172,174,205,212,223,225,226,243,244,245,246,251,252,
  255,261,263,265,266,271,274,306,311,315,325,331,332,343,
  346,351,356,364,365,371,411,412,413,423,431,432,445,446,
  452,454,455,462,464,465,466,503,506,516,523,526,532,546,
  565,606,612,624,627,631,632,654,662,664,703,712,723,731,
  732,734,743,754
];
function buildDtcsCodes() {
  var sel = document.getElementById('ic-dtcs-code');
  if (!sel) return;
  IC_DTCS_CODES.forEach(function(code) {
    var opt = document.createElement('option');
    opt.value = code;
    opt.textContent = String(code).padStart(3, '0');
    sel.appendChild(opt);
  });
}

// ── Raw CI-V console ────────────────────────────────────────────────────
function icCatSend() {
  var inp = document.getElementById('ic-cat-in');
  var hex = inp.value.trim();
  if (!hex) return;
  var log = document.getElementById('ic-cat-log');
  log.textContent += '> ' + hex + '\n';
  icPost({cmd: 'cat', args: hex}).then(function(d){
    log.textContent += '< ' + (d.error || d.response || JSON.stringify(d)) + '\n';
    log.scrollTop = log.scrollHeight;
  });
  inp.value = '';
}

// ── Status polling ─────────────────────────────────────────────────────
function setOfflineFlags(connected, civ, audio) {
  var apply = function(id, ok, text) {
    var dot = document.getElementById('ic-chk-' + id);
    var tx  = document.getElementById('ic-chk-' + id + '-text');
    if (!dot || !tx) return;
    dot.className = 'dot ' + (ok === null ? 'pending' : (ok ? 'ok' : 'err'));
    tx.textContent = text;
    tx.className = 'ic-val ' + (ok ? 'ok' : 'dim');
  };
  apply('civ',   civ,   civ   ? 'connected' : 'waiting (check USB cable + power)');
  apply('audio', audio, audio ? 'streaming' : 'waiting (check USB audio device)');
}

// SWR meter raw (0–255) → VSWR ratio. IC-7100 meter breakpoints.
// Meter calibration for the IC-7100 (raw CI-V 0-255 -> physical units), from
// Hamlib's IC-7100 backend. Piecewise linear between points.
var IC_CAL = {
  s:    [[0, -54], [124, 0], [241, 60]],           // dB rel. S9; S9 anchored at 124 (Hamlib: 120), measured on this radio
  swr:  [[0, 1.0], [48, 1.5], [80, 2.0], [120, 3.0], [240, 6.0]],
  po:   [[0, 0], [21, 5], [43, 10], [65, 15], [83, 20], [95, 25], [105, 30],
         [114, 35], [124, 40], [143, 50], [183, 75], [213, 100], [255, 120]],  // W
  comp: [[0, 0], [130, 15], [241, 30]],            // dB
  vd:   [[0, 0], [13, 10], [241, 16]],             // V
  id:   [[0, 0], [97, 10], [146, 15], [241, 25]]   // A
};
function calInterp(pts, raw) {
  if (raw <= pts[0][0]) return pts[0][1];
  for (var i = 1; i < pts.length; i++) {
    if (raw <= pts[i][0]) {
      var a = pts[i - 1], b = pts[i];
      return a[1] + (b[1] - a[1]) * (raw - a[0]) / (b[0] - a[0]);
    }
  }
  return pts[pts.length - 1][1];
}
function swrRatio(raw) { return calInterp(IC_CAL.swr, raw); }
// S-meter reading as an operator would say it: S0-S9, then S9+10/20/30...
// (nearest 10 dB; finer than that isn't how signals are reported).
function sLabel(raw) {
  var db = calInterp(IC_CAL.s, raw);              // 0 at S9, 6 dB per S unit
  if (db <= 0) return 'S' + Math.max(0, Math.round(9 + db / 6));
  var over = Math.round(db / 10) * 10;
  return over ? 'S9+' + over : 'S9';
}
// Peak-hold marker on a bar: remembers the highest recent reading and shows it
// as a thin line for the hold time after the bar falls below it. The hold time
// (3 s / 10 s / 30 s / until the bar is clicked) is cycled by clicking the
// S-meter label and remembered in this browser; 0 means "until clicked".
var PEAK_HOLDS = [3000, 10000, 30000, 0], _peaks = {}, _peakHold = 3000;
try { var _ph = parseInt(localStorage.getItem('peakHold'), 10);
      if (PEAK_HOLDS.indexOf(_ph) >= 0) _peakHold = _ph; } catch (_) {}
function peakHoldName() { return _peakHold ? (_peakHold / 1000) + ' s' : 'until clicked'; }
function cyclePeakHold() {
  _peakHold = PEAK_HOLDS[(PEAK_HOLDS.indexOf(_peakHold) + 1) % PEAK_HOLDS.length];
  try { localStorage.setItem('peakHold', String(_peakHold)); } catch (_) {}
  _peaks = {};
  decoratePeakControls();
}
// Returns the held peak (raw) while the marker is showing, else null.
function updatePeak(fillId, raw, nowMs) {
  var f = document.getElementById(fillId);
  if (!f || !f.parentNode) return null;
  var wrap = f.parentNode, m = wrap.querySelector('.ic-peak');
  if (!m) { m = document.createElement('div'); m.className = 'ic-peak'; wrap.appendChild(m); }
  var now = (nowMs === undefined) ? performance.now() : nowMs;
  var p = _peaks[fillId] || {v: 0, t: now};
  if (raw >= p.v || (_peakHold && now - p.t > _peakHold)) p = {v: raw, t: now};   // new high, or hold expired
  _peaks[fillId] = p;
  var show = p.v - raw > 3;                       // only once the bar has dropped below it
  m.style.display = show ? 'block' : 'none';
  m.style.left = Math.min(100, p.v * 100 / 255).toFixed(1) + '%';
  return show ? p.v : null;
}
function resetPeak(fillId) { delete _peaks[fillId]; }
// S-meter label cycles the hold time; clicking the bar clears the peak.
function decoratePeakControls() {
  var f = document.getElementById('ic-smeter-fill');
  if (!f) return;
  var wrap = f.parentNode, row = wrap.closest('.ic-row');
  var label = row && row.querySelector('.ic-label');
  if (label) {
    label.style.cursor = 'pointer';
    label.title = 'Peak hold: ' + peakHoldName() + '. Click to change (3 s, 10 s, 30 s, until clicked).';
    label.onclick = cyclePeakHold;
  }
  wrap.style.cursor = 'pointer';
  wrap.onclick = function () { resetPeak('ic-smeter-fill'); };
  wrap.title = 'Receive signal strength. Click to clear the peak marker.';
}
// Tick labels under a bar, placed by raw value (bars are raw/255 wide).
function decorateMeter(fillId, ticks) {
  var f = document.getElementById(fillId);
  if (!f || !f.parentNode || f.parentNode.parentNode.classList.contains('ic-meter')) return;
  var wrap = f.parentNode, outer = document.createElement('div');
  var row = wrap.closest('.ic-row'), lab = row && row.querySelector('.ic-label');
  if (lab) lab.style.minWidth = '5.5em';          // same label width on every meter row
  outer.className = 'ic-meter';
  wrap.parentNode.insertBefore(outer, wrap);
  outer.appendChild(wrap);
  var strip = document.createElement('div');
  strip.className = 'ic-scale';
  ticks.forEach(function (t) {
    var sp = document.createElement('span');
    sp.style.left = (t[0] * 100 / 255).toFixed(2) + '%';
    sp.textContent = t[1];
    strip.appendChild(sp);
  });
  outer.appendChild(strip);
}
function decorateMeters() {
  decorateMeter('ic-smeter-fill', [[14, '1'], [41, '3'], [69, '5'], [96, '7'], [124, '9'],
                                   [163, '+20'], [202, '+40'], [241, '+60dB']]);
  decorateMeter('ic-po-fill',   [[0, '0'], [95, '25'], [143, '50'], [213, '100 W']]);
  decorateMeter('ic-alc-fill',  [[0, '0'], [120, 'full']]);
  decorateMeter('ic-swr-fill',  [[0, '1'], [48, '1.5'], [80, '2'], [120, '3'], [240, '\u221e']]);
  decorateMeter('ic-comp-fill', [[0, '0'], [43, '5'], [87, '10'], [130, '15'], [167, '20 dB']]);
  decorateMeter('ic-id-fill',   [[0, '0'], [48, '5'], [97, '10'], [146, '15'], [194, '20'], [241, '25 A']]);
  decorateMeter('ic-vd-fill',   [[13, '10'], [89, '12'], [165, '14'], [241, '16 V']]);
}

// Adaptive status polling — fast while transmitting so the TX meters stay
// live, relaxed on receive.
var _txActive = false, _pollTimer = null;
function _schedulePoll() {
  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(pollStatus, _txActive ? 200 : 300);
}

// ── Radio power button ──────────────────────────────────────────────────
// The radio's USB port stays alive while it is switched off, so CI-V can switch it on (wake-up bytes + 18 01).
var _pwrWaitUntil = 0;
function updatePowerButton(s) {
  var b = document.getElementById('ic-radio-power'); if (!b) return;
  var serial = s.connected !== false, up = serial && s.radio_responding !== false, now = Date.now();
  if (up) _pwrWaitUntil = 0;
  var waiting = !up && now < _pwrWaitUntil;
  if (!up && _pwrWaitUntil && now >= _pwrWaitUntil) {          // asked to start, never answered
    _pwrWaitUntil = 0; icFeedback('The radio did not start: press its own power button.', true);
  }
  var lcd = document.getElementById('ic-lcd'); if (lcd) lcd.classList.toggle('radio-off', !up);
  b.disabled = !serial;
  b.classList.toggle('pwr-on', up);
  b.classList.toggle('pwr-wait', waiting);
  b.title = !serial ? 'No serial connection to the radio (USB cable?).'
    : up ? 'Radio is ON. Click to switch it off (asks first).'
    : waiting ? 'Starting the radio...' : 'Radio is OFF (or not answering). Click to switch it on.';
}
function radioPowerClick() {
  var b = document.getElementById('ic-radio-power'); if (!b || b.disabled) return;
  if (b.classList.contains('pwr-on')) {
    if (!window.confirm('Switch the radio OFF? You can switch it back on from here.')) return;
    icCmd('radio_power', {on: false});
  } else if (!b.classList.contains('pwr-wait')) {
    _pwrWaitUntil = Date.now() + 20000; icCmd('radio_power', {on: true});
  }
}
(function () { var b = document.getElementById('ic-radio-power'); if (b) b.addEventListener('click', radioPowerClick); })();

function pollStatus() {
  icGet('/ic7100status').then(function(s) {
    s = s || {};
    var offline = document.getElementById('ic-offline');
    var panel = document.getElementById('ic-panel');

    // "Connected" semantics: in the standalone server we treat the radio as
    // connected when CI-V is talking. (The gateway version had a `connected`
    // field reflecting whether the IC-7100 endpoint was registered with the
    // gateway link manager — that's gone here.) Fall back: if `connected`
    // is present in the status, honour it; otherwise infer from
    // `serial_connected`.
    var civ   = !!s.serial_connected;
    var audio = !!(s.audio_rx || s.input_active);
    var connected = (typeof s.connected === 'boolean') ? s.connected : civ;

    setOfflineFlags(connected, civ, audio);
    if (!connected) {
      offline.style.display = '';
      panel.style.display = 'none';
      return;
    }
    offline.style.display = 'none';
    panel.style.display = '';

    // Status bar — stripped to CI-V + audio + VFO/MEM. The gateway version
    // also showed endpoint name, mute state, and HF/VHF TX interlock dots;
    // those are gateway-side concepts and don't apply to a single-radio app.
    var civEl = document.getElementById('ic-civ-state');
    if (civEl) {
      var alive = civ && s.radio_responding !== false;
      civEl.textContent = !civ ? 'no serial' : alive ? 'connected' : 'radio not answering (off?)';
      civEl.className = 'ic-val ' + (!civ ? 'err' : alive ? 'ok' : 'warn');
    }
    updatePowerButton(s);
    var audEl = document.getElementById('ic-audio-state');
    if (audEl) {
      var aSt = window._audioState || 'off';
      audEl.textContent = !audio ? 'no audio' : aSt === 'mic' ? 'streaming, mic'
                        : aSt === 'rxonly' ? 'RX only, NO MIC' : 'off (press Start audio)';
      audEl.className = 'ic-val ' + (!audio ? 'err' : aSt === 'mic' ? 'ok' : 'warn');
      audEl.title = aSt === 'rxonly' ? ('No microphone: ' + window._micWhy) : '';
    }

    // TX badge + PTT button
    var txOn = !!(s.transmitting || s.ptt_active);
    // Follow the operator's finger: stale polls (sent before the key/unkey took
    // effect) must not flip the lamp/button for a moment after a press or release.
    if (window._pttHeld) txOn = true;
    else if (performance.now() - (window._pttReleasedAt || -1e9) < 500) txOn = false;
    if (txOn !== _txActive) { _txActive = txOn; _schedulePoll(); }
    var badge = document.getElementById('ic-tx-badge');
    if (badge) badge.classList.toggle('on', txOn);
    var pttBtn = document.getElementById('ic-ptt-btn');
    if (pttBtn) pttBtn.classList.toggle('active', txOn);
    // TX/RX lamp like the head unit's: dark = squelched, green = receiving, red = TX.
    var lamp = document.getElementById('ic-trx-lamp');
    if (lamp) {
      lamp.classList.toggle('tx', txOn);
      lamp.classList.toggle('rx', !txOn && s.squelch_open === true);
    }
    var pwrLed = document.getElementById('ic-pwr-led');
    if (pwrLed) {
      pwrLed.classList.toggle('led-red', txOn);
      pwrLed.classList.toggle('led-pulse', txOn);
    }

    // NOTE: gateway-side TX antenna-port safety interlock (tx_allow_hf /
    // tx_allow_vu / tx_port) is intentionally not surfaced here — a
    // standalone control panel should not pretend to enforce RF safety in
    // software; use a dummy load or a physical antenna switch instead.

    // Frequency + mode + filter
    if (typeof s.freq === 'number') setFreqDisplay(s.freq);
    var modeEl = document.getElementById('ic-mode-cur');
    if (modeEl) modeEl.textContent = s.mode || '—';
    if (s.mode !== window._icMode) { window._icMode = s.mode; swcApply(window._micChain); cessbButton(); preButton(); }
    var filtEl = document.getElementById('ic-filter-cur');
    if (filtEl) filtEl.textContent = (s.filter !== undefined) ? String(s.filter) : '—';

    // Highlight active mode button
    Array.prototype.forEach.call(document.querySelectorAll('#ic-mode-row button'), function(btn) {
      btn.classList.toggle('active', btn.dataset.mode === s.mode);
    });

    // S-meter (0–255 -> 0–100%)
    var smRaw = (typeof s.smeter === 'number') ? s.smeter : 0;
    var smPct = Math.max(0, Math.min(100, smRaw * 100 / 255));
    var smF = document.getElementById('ic-smeter-fill');
    if (smF) smF.style.width = smPct.toFixed(0) + '%';
    var smV = document.getElementById('ic-smeter-val');
    if (smV) smV.textContent = sLabel(smRaw);
    var smPk = updatePeak('ic-smeter-fill', smRaw);
    if (smV && smPk !== null) smV.textContent = sLabel(smRaw) + '  pk ' + sLabel(smPk);

    // TX meters
    function _txMeter(fillId, valId, raw, text) {
      var pct = Math.max(0, Math.min(100, raw * 100 / 255));
      var f = document.getElementById(fillId);
      if (f) f.style.clipPath = 'inset(0 ' + (100 - pct).toFixed(1) + '% 0 0)';
      var v = document.getElementById(valId);
      if (v) v.textContent = text;
    }
    var poRaw  = (typeof s.po  === 'number') ? s.po  : 0;
    var alcRaw = (typeof s.alc === 'number') ? s.alc : 0;
    var swrRaw = (typeof s.swr === 'number') ? s.swr : 0;
    updatePeak('ic-po-fill', poRaw);
    _txMeter('ic-po-fill',  'ic-po-val',  poRaw,  Math.round(calInterp(IC_CAL.po, poRaw)) + ' W');
    _txMeter('ic-alc-fill', 'ic-alc-val', alcRaw, Math.round(alcRaw * 100 / 120) + '%');  // 120 = full
    _txMeter('ic-swr-fill', 'ic-swr-val', swrRaw,
             txOn ? swrRatio(swrRaw).toFixed(1) + ':1' : '—');

    // COMP / ID / Vd, calibrated with IC_CAL (Hamlib's IC-7100 tables).
    var compRaw = (typeof s.comp === 'number') ? s.comp : 0;
    var idRaw   = (typeof s.id_a === 'number') ? s.id_a : 0;
    var vdRaw   = (typeof s.vd   === 'number') ? s.vd   : 0;
    if (window._micChain && SWC.on && s.data_mode && txOn) {      // browser audio: show OUR compressor
      var gr = _swcPeak; _swcPeak = 0;
      _txMeter('ic-comp-fill', 'ic-comp-val', calInverse(IC_CAL.comp, gr), gr.toFixed(0) + ' dB');
    } else {
      _txMeter('ic-comp-fill', 'ic-comp-val', compRaw, calInterp(IC_CAL.comp, compRaw).toFixed(0) + ' dB');
    }
    _txMeter('ic-id-fill',   'ic-id-val',   idRaw,   calInterp(IC_CAL.id, idRaw).toFixed(1) + ' A');
    _txMeter('ic-vd-fill',   'ic-vd-val',   vdRaw,   vdRaw ? calInterp(IC_CAL.vd, vdRaw).toFixed(1) + ' V' : '\u2014');

    // CTCSS — only update if user isn't editing the dropdown
    var ctxEls = {
      'ic-ctcss-tx':    s.ctcss_tx_hz,
      'ic-ctcss-rx':    s.ctcss_rx_hz,
    };
    Object.keys(ctxEls).forEach(function(id) {
      var el = document.getElementById(id);
      var v = ctxEls[id];
      if (el && document.activeElement !== el && typeof v === 'number') {
        el.value = v.toFixed(1);
      }
    });
    var txOnBox = document.getElementById('ic-ctcss-tx-on');
    if (txOnBox && document.activeElement !== txOnBox) {
      txOnBox.checked = !!s.tone_on;
    }

    // HF panel sync
    function setCheck(id, val) {
      var el = document.getElementById(id);
      if (el && document.activeElement !== el) el.checked = !!val;
    }
    function setRange(id, valId, v, suffix) {
      var el = document.getElementById(id);
      if (el && document.activeElement !== el && typeof v === 'number') {
        el.value = v;
        var lbl = document.getElementById(valId);
        if (lbl) lbl.textContent = v + (suffix || '');
      }
    }
    function setActiveBtn(rowId, attr, want) {
      Array.prototype.forEach.call(document.querySelectorAll('#' + rowId + ' button'), function(btn) {
        btn.classList.toggle('active', String(btn.dataset[attr]) === String(want));
      });
    }
    setCheck('ic-split-on', s.split);
    setCheck('ic-rit-on',   s.rit_on);
    setCheck('ic-xit-on',   s.xit_on);
    setCheck('ic-nb-on',    s.nb_on);
    setCheck('ic-nr-on',    s.nr_on);
    setCheck('ic-atten-on', s.atten);
    if (typeof s.rit_hz === 'number') setRitDisplay(s.rit_hz);
    setRange('ic-nb-level',  'ic-nb-level-val',  s.nb_level,  '%');
    setRange('ic-nr-level',  'ic-nr-level-val',  s.nr_level,  '%');
    setRange('ic-mic-gain',  'ic-mic-gain-val',  s.mic_gain,  '%');
    setRange('ic-radcomp-level', 'ic-radcomp-level-val', s.comp_level, '%');
    var rcOn = document.getElementById('ic-radcomp-on');
    if (rcOn && document.activeElement !== rcOn) rcOn.checked = !!s.comp_on;
    setRange('ic-ifshift',   'ic-ifshift-val',   s.if_shift,  '%');
    // rx_boost_pct was a gateway-side concept (RX audio gain applied
    // before streaming over the gateway link). On a standalone panel the
    // Vol knob mirrors a server-side gain; we fall back to either
    // `rx_boost_pct` (legacy) or `vol` if the server exposes that name.
    if (_volKnob) _volKnob.set(typeof s.vol === 'number' ? s.vol : s.rx_boost_pct);
    if (_sqlKnob) _sqlKnob.set(s.squelch);
    if (_rfKnob && typeof s.rf_gain === 'number') _rfKnob.set(s.rf_gain);
    if (_pwrKnob) _pwrKnob.set(s.rf_power);
    if (_micKnob) _micKnob.set(s.mic_gain);
    if (_afKnob && typeof s.af_level === 'number') _afKnob.set(s.af_level);
    var sqlLed = document.getElementById('ic-squelch-led');
    if (sqlLed) sqlLed.classList.toggle('led-green', s.squelch_open !== false);
    setActiveBtn('ic-agc-row',    'agc',    s.agc);
    setActiveBtn('ic-preamp-row', 'preamp', s.preamp);
    setActiveBtn('ic-filter-row', 'filter', s.filter);

    // VFO / Memory state
    if (s.active_vfo === 'A' || s.active_vfo === 'B') _activeVfo = s.active_vfo;
    _memMode = !!s.memory_mode;
    _memBank = s.memory_bank || null;
    // Memory mode as far as we can tell: the panel set it, or the live
    // frequency+mode matches a stored memory (the radio won't say).
    var inMem = _memMode || !!s.memory_match;
    _inMem = inMem;
    // In memory mode no VFO is in use: don't leave VFO A/B lit.
    // Only the panel's own memory mode unlights the VFOs; a mere frequency match with a stored memory is a guess
    // (the radio does not report VFO vs MEM), so then the active VFO stays lit, dashed.
    setActiveBtn('ic-vfo-row', 'vfo', _memMode ? null : s.active_vfo);
    var vfoRow = document.getElementById('ic-vfo-row');
    if (vfoRow) vfoRow.classList.toggle('dim', _memMode);
    Array.prototype.forEach.call(document.querySelectorAll('#ic-vfo-row button[data-vfo]'), function (b) {
      var guess = !_memMode && inMem && b.dataset.vfo === s.active_vfo;
      b.classList.toggle('inferred', guess);
      b.title = guess ? 'VFO ' + b.dataset.vfo + ' is the active VFO. The frequency also matches a stored memory, so the radio may be in memory mode (it does not report that).'
                      : 'Select VFO ' + b.dataset.vfo;
    });
    // Big VFO | MEM selector next to the mode, like the control head.
    var vmV = document.getElementById('ic-vm-vfo'), vmM = document.getElementById('ic-vm-mem');
    if (vmV && vmM) {
      var mmU = (s.memory_match && !s.memory_match.candidates) ? s.memory_match : null;
      var chNum = mmU ? mmU.ch : s.memory_channel;
      var chN = (typeof chNum === 'number') ? String(chNum).padStart(2, '0') : '--';
      var bk = _memBank || (mmU ? mmU.bank : null);
      vmV.textContent = 'VFO ' + (s.active_vfo || '');
      vmM.textContent = 'MEM ' + (bk ? bk + '-' : '') + chN;
      vmV.classList.toggle('active', !inMem);
      vmM.classList.toggle('active', inMem);
    }
    // The radio can't report its memory/bank, so this is inferred by matching
    // the live frequency+mode against a scan of all memories (server side).
    var mm = s.memory_match || null;
    var nameEl = document.getElementById('ic-mem-name');
    if (nameEl) {
      nameEl.textContent = (mm && !mm.candidates) ? mm.name : '';  // blank if ambiguous
      nameEl.title = !mm ? '' : mm.candidates ?
        ('Same frequency and mode as:\n' + mm.candidates.join('\n')) :
        ('Matches memory ' + mm.bank + '-' + mm.ch +
         (mm.others ? ' (and ' + mm.others + ' other' + (mm.others > 1 ? 's' : '') + ')' : '') +
         ' by frequency and mode');
    }
    var shownBank = _memBank || (mm ? mm.bank : null);  // null when ambiguous
    document.querySelectorAll('#ic-bank-row [data-bank]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.bank === shownBank);
      b.classList.toggle('inferred', !_memBank && !!mm && !!mm.bank && b.dataset.bank === mm.bank);
    });
    // Tone indicator like the head unit: TSQL (16 43), TONE (16 42), DTCS, or blank.
    var toneEl = document.getElementById('ic-tone-ind');
    if (toneEl) {
      var tn = s.tsql_on ? 'TSQL' : s.tone_on ? 'TONE' : s.dtcs_on ? 'DTCS' : '';
      toneEl.textContent = tn;
      toneEl.title = tn && tn !== 'DTCS' && s.ctcss_tx_hz ? s.ctcss_tx_hz.toFixed(1) + ' Hz' : '';
    }
    // Head-unit style annunciator line (P.AMP, ATT, AGC-x, NB, NR, SPLIT, RIT, DATA).
    var stEl = document.getElementById('ic-lcd-status');
    if (stEl) {
      var an = [];
      if (s.preamp) an.push(s.preamp === 2 ? 'P.AMP2' : 'P.AMP');
      if (s.atten) an.push('ATT');
      an.push('AGC-' + ({fast: 'F', mid: 'M', slow: 'S'}[s.agc] || '?'));
      if (s.nb_on) an.push('NB');
      if (s.nr_on) an.push('NR');
      if (s.comp_on) an.push('COMP');
      if (s.split) an.push('SPLIT');
      if (s.rit_on) an.push('RIT');
      if (s.xit_on) an.push('XIT');
      if (s.data_mode) an.push('DATA');
      stEl.innerHTML = an.map(function (t) { return '<span>' + t + '</span>'; }).join('');
    }
    // MEMO / bank+channel block. The radio can't report VFO-vs-memory mode or
    // the memory number, so: unique frequency match = MEMO (inferred); several
    // matches = MEMO? with no number; otherwise whatever the panel last set.
    var mCap = document.getElementById('ic-memo-cap'), mId = document.getElementById('ic-memo-id');
    if (mCap && mId) {
      var mx = s.memory_match;
      if (mx && !mx.candidates) {
        mCap.textContent = 'MEMO';
        mId.textContent = mx.bank + String(mx.ch).padStart(2, '0');
      } else if (mx) {
        mCap.textContent = 'MEMO?';
        mId.textContent = '---';
      } else if (_memMode) {
        mCap.textContent = 'MEMO';
        mId.textContent = (_memBank || '') + String(s.memory_channel || 0).padStart(2, '0');
      } else {
        mCap.textContent = 'VFO';
        mId.textContent = s.active_vfo || '';
      }
      document.getElementById('ic-memo').title = (mx ?
        'Inferred by matching the frequency and mode against the radio\u2019s memories. ' :
        'From the panel; the radio does not report this. ') +
        'Click to switch to ' + (_inMem ? 'VFO' : 'memory') + '.';
    }
    updateMini();
    var bankSt = document.getElementById('ic-bank-state');
    if (bankSt) bankSt.textContent = _memBank ? '' :
      (mm && mm.bank ? 'inferred from frequency' : 'not reported by the radio: pick a bank');
    var memBtn = document.getElementById('ic-mem-toggle');
    if (memBtn) memBtn.classList.toggle('active', _memMode);
    var memCh = document.getElementById('ic-mem-ch');
    if (memCh && document.activeElement !== memCh && typeof s.memory_channel === 'number') {
      memCh.value = s.memory_channel;
    }
    var vfoPill = document.getElementById('ic-vfo-pill');
    if (vfoPill) {
      if (_memMode) {
        var n = (typeof s.memory_channel === 'number') ? String(s.memory_channel).padStart(2, '0') : '--';
        vfoPill.textContent = 'MEM ' + n;
      } else {
        vfoPill.textContent = s.active_vfo || '—';
      }
    }

    // FM squelch type + DTCS
    setActiveBtn('ic-sqltype-row', 'sqltype', s.squelch_type || 'noise');
    var dcEl = document.getElementById('ic-dtcs-code');
    if (dcEl && document.activeElement !== dcEl && typeof s.dtcs_code === 'number') {
      dcEl.value = s.dtcs_code;
    }
    var dpEl = document.getElementById('ic-dtcs-pol');
    if (dpEl && document.activeElement !== dpEl && typeof s.dtcs_polarity === 'number') {
      dpEl.value = s.dtcs_polarity;
    }
  });
}

// ── Init ────────────────────────────────────────────────────────────────
function icInit() {
  buildBandRow();
  buildModeRow();
  decorateMeters();
  decoratePeakControls();
  buildStepRow();
  buildDtcsCodes();
  buildCtcssTones();
  initFreqDisplay();
  initTypedFreq();
  initRitDisplay();
  initTuningKnobs();
  initPotKnobs();
  initSwcControls();
  _renderFreq();
  _renderRit();
  pollStatus();
  _schedulePoll();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', icInit);
} else {
  icInit();
}

// One line of WebRTC receive health for the status bar. `stats` is an array of
// the browser's getStats() entries; `prev` is the previous result of this
// function's `raw` (to show recent change).
function fmtAudioStats(stats, prev) {
  var byId = {}, inb = null, pairId = null;
  stats.forEach(function (r) {
    byId[r.id] = r;
    if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio')) inb = r;
    if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
  });
  if (!inb) return {text: '', raw: null};
  var pair = pairId ? byId[pairId] : stats.filter(function (r) {
    return r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded'; })[0];
  var via = '';
  if (pair && byId[pair.remoteCandidateId]) {
    var rc = byId[pair.remoteCandidateId];
    via = ' \u00b7 via ' + (rc.address || rc.ip || '?') + (rc.candidateType === 'relay' ? ' (relay)' : '');
  }
  var lost = inb.packetsLost || 0, conc = inb.concealedSamples || 0;
  var dLost = prev ? lost - prev.lost : 0, dConc = prev ? conc - prev.conc : 0;
  var jit = Math.round((inb.jitter || 0) * 1000);
  var text = 'lost ' + lost + (dLost > 0 ? ' (+' + dLost + ')' : '') + ' \u00b7 jitter ' + jit + ' ms' +
             ' \u00b7 concealed ' + Math.round(conc / 48) + ' ms' + (dConc > 0 ? ' (+' + Math.round(dConc / 48) + ')' : '') + via;
  return {text: text, raw: {lost: lost, conc: conc}};
}

// ── Browser-side mic processing ─────────────────────────────────────────
// The radio's own compressor can't act on browser audio (it arrives over USB in
// DATA mode), so level, compression and a safety limiter happen here, before
// the audio is sent. Settings are remembered in this browser.
var SWC = {on: false, amt: 50, level: 100, cessb: true, drive: 12, deadCheck: false, pre: true};
try { var _sw = JSON.parse(localStorage.getItem('swc') || 'null'); if (_sw) SWC = Object.assign(SWC, _sw); } catch (_) {}
SWC.drive = Math.max(0, Math.min(18, +SWC.drive || 12));      // booster range 0..+18 dB (only simulated up to +18)
function swcSave() { try { localStorage.setItem('swc', JSON.stringify(SWC)); } catch (_) {} }
// Amount 0-100 -> compressor settings. 0 = off-equivalent (ratio 1, no makeup).
// The makeup gain gives back some of the level that compression takes off; the
// soft clipper at the end keeps the result safe.
function swcParams(amt) {
  var a = Math.max(0, Math.min(100, amt)) / 100;
  return {threshold: -12 - 24 * a, ratio: 1 + 11 * a, makeupDb: 10 * a};
}
function swcApply(c) {
  if (!c) return;
  var p = swcParams(SWC.on ? SWC.amt : 0);
  c.inGain.gain.value = Math.max(0, SWC.level) / 100;
  c.comp.threshold.value = p.threshold; c.comp.knee.value = 6; c.comp.ratio.value = p.ratio;
  c.comp.attack.value = 0.005; c.comp.release.value = 0.15;
  c.makeup.gain.value = Math.pow(10, p.makeupDb / 20);
  // Final stages: [FM pre-emphasis] then CESSB (SSB only, when on and loaded) or the soft clipper.
  var useC = !!(SWC.cessb && swcIsSsb() && c.cessb), usePre = !!(SWC.pre && swcIsFm());
  var key = (usePre ? 'P' : '-') + (useC ? 'C' : 'S');
  if (c.routeKey !== key) {
    c.makeup.disconnect(); c.pre.disconnect(); c.clip.disconnect(); if (c.cessb) c.cessb.disconnect();
    var head = c.makeup;
    if (usePre) { head.connect(c.pre); head = c.pre; }
    if (useC) { head.connect(c.cessb); c.cessb.connect(c.dest); }
    else { head.connect(c.clip); c.clip.connect(c.dest); }
    c.routeKey = key; c.route = useC;
  }
  if (c.cessb) c.cessb.port.postMessage({drive: Math.pow(10, SWC.drive / 20), ceiling: 0.85});
  cessbButton(); preButton();
}
// CESSB shapes an SSB signal's RF envelope; FM/AM have none worth shaping, so it is SSB-only.
function swcIsFm() { return window._icMode === 'FM'; }
function swcIsSsb() { return window._icMode === 'USB' || window._icMode === 'LSB'; }
function preButton() {
  var b = document.getElementById('ic-preemph'); if (!b) return;
  var fm = swcIsFm();
  b.classList.toggle('on', !!SWC.pre && fm);
  b.classList.toggle('na', !fm);
  b.title = !fm ? 'FM pre-emphasis applies only in FM (inactive in ' + (window._icMode || 'this mode') + ').'
    : 'FM pre-emphasis: boosts the highs (about +4.5 dB at 1 kHz, +11 dB at 3 kHz) because the radio\'s data input does not add it and receivers expect it. ' + (SWC.pre ? 'On.' : 'Off.');
}
function cessbButton() {
  var b = document.getElementById('ic-cessb'); if (!b) return;
  var c = window._micChain, ssb = swcIsSsb();
  b.classList.toggle('on', !!SWC.cessb && ssb);
  b.classList.toggle('na', !ssb);
  b.disabled = !!(c && c.cessbFailed);
  b.title = (c && c.cessbFailed) ? 'CESSB unavailable in this browser (using the soft clipper)'
    : !ssb ? 'CESSB works on SSB only (USB/LSB); inactive in ' + (window._icMode || 'this mode') + '.'
    : 'Controlled-envelope SSB: clips the RF envelope instead of the waveform, for more average power at the same peak. ' +
      (SWC.cessb ? 'On.' : 'Off (soft clipper).');
}
// Final safety stage: a soft clipper. Quiet audio passes unchanged (slope 1) and
// peaks are bounded below 1/k (0.91), so the radio's ALC isn't slammed. (Web Audio
// has no true limiter: a second compressor adds makeup gain instead.)
function softClipCurve(k) {
  var n = 2048, curve = new Float32Array(n);
  for (var i = 0; i < n; i++) { var x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / k; }
  return curve;
}
// FM pre-emphasis: H(s) = (1 + s/wz) / (1 + s/wp), flat below ~700 Hz, +6 dB/octave up to ~4 kHz
// (about +4.5 dB at 1 kHz, +11 dB at 3 kHz). A receiver de-emphasises FM by roughly the opposite,
// and the radio's data input (which this panel uses) does not add it. First-guess curve, tune by ear.
function preEmphCoefs(fs, fz, fp) {
  var a = 2 * fs / (2 * Math.PI * fz), b = 2 * fs / (2 * Math.PI * fp), n = 1 + b;
  return {ff: [(1 + a) / n, (1 - a) / n], fb: [1, (1 - b) / n]};
}
function buildMicChain(stream) {
  var AC = window.AudioContext || window.webkitAudioContext, ac;
  try { ac = new AC({sampleRate: 48000}); } catch (_) { ac = new AC(); }
  var src = ac.createMediaStreamSource(stream), dest = ac.createMediaStreamDestination();
  var c = {ac: ac, inGain: ac.createGain(), comp: ac.createDynamicsCompressor(),
           makeup: ac.createGain(), clip: ac.createWaveShaper()};
  c.clip.curve = softClipCurve(1.1); c.clip.oversample = '2x';
  c.an = ac.createAnalyser(); c.an.fftSize = 1024; src.connect(c.an);   // raw mic level, for the meter
  src.connect(c.inGain); c.inGain.connect(c.comp); c.comp.connect(c.makeup);
  c.makeup.connect(c.clip); c.clip.connect(dest);
  c.dest = dest; c.route = false;
  var pc = preEmphCoefs(ac.sampleRate, 700, 4000);
  c.pre = ac.createIIRFilter(pc.ff, pc.fb);
  c.stream = dest.stream; c.track = dest.stream.getAudioTracks()[0];
  swcApply(c);
  if (ac.audioWorklet && window.cessbWorkletSource) {            // CESSB loads asynchronously, then takes over the final stage
    var url = URL.createObjectURL(new Blob([cessbWorkletSource()], {type: 'text/javascript'}));
    ac.audioWorklet.addModule(url).then(function () {
      c.cessb = new AudioWorkletNode(ac, 'cessb', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]});
      c.gr = 0; c.grShow = 0;
      c.cessb.port.onmessage = function (m) { var g = m.data.gr || 0; c.gr = Math.max(c.gr, g); c.grShow = Math.max(g, c.grShow * 0.85); };
      swcApply(c);
    }).catch(function () { c.cessbFailed = true; swcApply(c); });
  } else { c.cessbFailed = true; swcApply(c); }
  if (ac.state === 'suspended') ac.resume();
  return c;
}
// Highest gain reduction (dB) since the last read; polled at 20 Hz so syllable
// peaks aren't missed between the page's slower status polls.
var _swcPeak = 0;
setInterval(function () {
  var c = window._micChain;
  if (c) {
    var viaC = c.route && c.cessb;
    _swcPeak = Math.max(_swcPeak, viaC ? (c.gr || 0) : -c.comp.reduction);
    if (viaC) c.gr = 0;                                   // read-and-clear: the readout keeps its own decaying value
    var gre = document.getElementById('ic-cessb-gr');
    if (gre) gre.textContent = viaC ? 'clip ' + (c.grShow || 0).toFixed(1) + ' dB' : '';
  }
}, 50);
// Live mic input level (raw mic, before level/compressor), 0..1. Shown as a bar on
// the Audio line; window._micPeak is the highest value since key-down (silent-mic warning).
var _micBuf = null, _micZeroTicks = 0;
setInterval(function () {
  var c = window._micChain, bar = document.getElementById('ic-mic-meter');
  if (!c || !c.an) {
    if (bar) bar.firstChild.style.width = '0';
    _micZeroTicks = 0; var d0 = document.getElementById('ic-mic-dead'); if (d0) d0.style.display = 'none';
    return;
  }
  _micBuf = _micBuf || new Float32Array(c.an.fftSize);
  c.an.getFloatTimeDomainData(_micBuf);
  var pk = 0; for (var i = 0; i < _micBuf.length; i++) { var a = Math.abs(_micBuf[i]); if (a > pk) pk = a; }
  window._micPeak = Math.max(window._micPeak || 0, pk);
  // A stream that has been exact digital zero for 6 s since it started and has NEVER
  // carried any signal is dead (e.g. a Bluetooth headset that never switched to its mic
  // mode). A live mic with noise suppression also outputs true zeros between words, so
  // once any signal has been seen it is never called dead. Restart the mic up to twice
  // (never mid-transmission), then just say so.
  var dead = document.getElementById('ic-mic-dead');
  if (pk > 0) c.alive = true;
  if (SWC.deadCheck && pk === 0 && !c.alive && c.ac.state === 'running') _micZeroTicks++; else _micZeroTicks = 0;
  if (dead) dead.style.display = _micZeroTicks >= 60 ? '' : 'none';
  if (_micZeroTicks === 60 && !window._pttHeld && window._micRestart && (window._micAutoRestarts || 0) < 2) {
    window._micAutoRestarts = (window._micAutoRestarts || 0) + 1;
    icFeedback('Mic stream is dead (digital silence): restarting the mic', true);
    _micZeroTicks = 0; window._micRestart();
  }
  if (bar) {
    var db = pk > 0 ? 20 * Math.log10(pk) : -90;                  // -60 dBFS .. 0 dBFS across the bar
    bar.firstChild.style.width = Math.max(0, Math.min(100, (db + 60) / 60 * 100)) + '%';
    bar.title = 'Microphone level: ' + (pk > 0 ? db.toFixed(0) + ' dBFS' : 'silent');
  }
}, 100);
function calInverse(pts, val) {            // physical value -> raw, for IC_CAL tables
  if (val <= pts[0][1]) return pts[0][0];
  for (var i = 1; i < pts.length; i++) {
    if (val <= pts[i][1]) {
      var a = pts[i - 1], b = pts[i];
      return a[0] + (b[0] - a[0]) * (val - a[1]) / (b[1] - a[1]);
    }
  }
  return pts[pts.length - 1][0];
}
function initSwcControls() {
  var on = document.getElementById('ic-swc-on'), amt = document.getElementById('ic-swc-amt'),
      lvl = document.getElementById('ic-mic-level');
  if (!on || !amt || !lvl) return;
  function show() {
    on.checked = !!SWC.on; amt.value = SWC.amt; lvl.value = SWC.level;
    document.getElementById('ic-swc-amt-val').textContent = SWC.amt + '%';
    document.getElementById('ic-mic-level-val').textContent = SWC.level + '%';
    var dr = document.getElementById('ic-cessb-drive');
    if (dr) { dr.value = SWC.drive; document.getElementById('ic-cessb-drive-val').textContent = '+' + SWC.drive + ' dB'; }
  }
  on.onchange  = function () { SWC.on = on.checked; swcSave(); swcApply(window._micChain); };
  var cb = document.getElementById('ic-cessb');
  cessbButton();
  var pb = document.getElementById('ic-preemph');
  if (pb) pb.onclick = function () { SWC.pre = !SWC.pre; swcSave(); swcApply(window._micChain); preButton(); };
  preButton();
  if (cb) cb.onclick = function () { SWC.cessb = !SWC.cessb; swcSave(); swcApply(window._micChain); cessbButton(); };
  amt.oninput  = function () { SWC.amt = +amt.value; swcSave(); show(); swcApply(window._micChain); };
  var dck = document.getElementById('ic-deadcheck');
  if (dck) { dck.checked = !!SWC.deadCheck; dck.onchange = function () { SWC.deadCheck = dck.checked; swcSave(); }; }
  var drv = document.getElementById('ic-cessb-drive');
  if (drv) drv.oninput = function () { SWC.drive = +drv.value; swcSave(); show(); swcApply(window._micChain); };
  lvl.oninput  = function () { SWC.level = +lvl.value; swcSave(); show(); swcApply(window._micChain); };
  show();
}

// ── WebRTC audio (Phase 2) ──────────────────────────────────────────────
// One peer connection: server sends RX audio (radio's USB codec → Opus),
// browser sends mic (Opus → server → aplay → radio's USB codec).
// PTT remains the existing CI-V button — audio just keeps flowing both
// ways; the radio modulates whatever's in its USB-codec input when
// DATA mode is on (set automatically by the gateway PTT path).
(function () {
  var pc = null;
  var micStream = null;
  var btn = document.getElementById('ic-audio-toggle');
  var rxEl = document.getElementById('ic-audio-rx');
  if (!btn || !rxEl) return;

  function setStatus(text) {
    var el = document.getElementById('ic-audio-state');
    if (el) el.textContent = text;
  }

  // Microphone choice: the browser otherwise reuses the system default (e.g. a
  // Bluetooth headset) without asking, so offer a list and remember the pick.
  var micSel = document.getElementById('ic-mic-dev');
  var micDev = '', micName = '';
  try { micDev = localStorage.getItem('micDev') || ''; micName = localStorage.getItem('micName') || ''; } catch (_) {}
  async function fillMicList() {
    if (!micSel) return;
    if (!micSel.options.length) micSel.innerHTML = '<option value="">System default</option>';
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    var devs = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) { return d.kind === 'audioinput'; });
    micSel.innerHTML = '';
    var o = document.createElement('option'); o.value = ''; o.textContent = 'System default'; micSel.appendChild(o);
    devs.forEach(function (d, i) {
      if (d.deviceId === 'default' || d.deviceId === 'communications') return;
      o = document.createElement('option'); o.value = d.deviceId;
      o.textContent = d.label || ('Microphone ' + (i + 1)); micSel.appendChild(o);
    });
    micSel.value = micDev;
    if (micSel.value !== micDev) {                    // saved id not listed: Bluetooth devices change id between modes, so match by name
      var byName = Array.prototype.filter.call(micSel.options, function (o) { return micName && o.value && o.textContent === micName; })[0];
      if (byName) { micSel.value = byName.value; micDev = byName.value; } else micSel.value = '';
    }
    if (micStream && micStream.getAudioTracks()[0]) syncMicDropdown(micStream.getAudioTracks()[0]);   // show what is really in use
  }
  if (micSel) {
    fillMicList().catch(function () {});
    if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', function () { fillMicList().catch(function () {}); });
    micSel.addEventListener('change', function () {
      micDev = micSel.value;
      micName = micDev ? micSel.options[micSel.selectedIndex].textContent : '';
      try { localStorage.setItem('micDev', micDev); localStorage.setItem('micName', micName); } catch (_) {}
      micSel.blur();                                 // a focused <select> would swallow the Space-bar PTT
      if (pc) { teardown(); startAudio(); }          // switch the live stream to the new mic
    });
  }

  function syncMicDropdown(track) {
    if (!micSel || !track) return;
    var id = (track.getSettings && track.getSettings().deviceId) || '', label = track.label || '';
    var opts = Array.prototype.slice.call(micSel.options);
    var hit = opts.filter(function (o) { return o.value && o.value === id; })[0];
    if (!hit && label) {                               // Chrome reports 'default' for the system-default device
      var bare = label.replace(/^(Default|Communications) - /, '');
      hit = opts.filter(function (o) { return o.value && (o.textContent === bare || o.textContent === label); })[0];
    }
    if (!hit) {                                        // not in the list: show it anyway, labelled as in use
      hit = document.createElement('option'); hit.value = ''; hit.textContent = (label || 'unknown input') + ' (in use)';
      micSel.appendChild(hit);
    }
    micSel.value = hit.value; hit.selected = true;
  }
  window._syncMicDropdown = syncMicDropdown;

  async function startAudio() {
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    // Try the mic, but don't abort if denied or unavailable — RX-only is
    // a valid mode (plain-HTTP origins block getUserMedia entirely).
    micStream = null;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        var base = { echoCancellation: false, noiseSuppression: false,
                     autoGainControl: false, channelCount: 1 };
        try {
          micStream = await navigator.mediaDevices.getUserMedia(
            { audio: micDev ? Object.assign({ deviceId: { exact: micDev } }, base) : base });
        } catch (e1) {
          if (!micDev) throw e1;
          var alt = null;                             // same-named device under a new id?
          try {
            alt = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) {
              return d.kind === 'audioinput' && micName && d.label === micName && d.deviceId !== micDev; })[0];
          } catch (_) {}
          try {
            if (!alt) throw e1;
            micStream = await navigator.mediaDevices.getUserMedia({ audio: Object.assign({ deviceId: { exact: alt.deviceId } }, base) });
            micDev = alt.deviceId; try { localStorage.setItem('micDev', micDev); } catch (_) {}
          } catch (e2) {                              // chosen mic gone: use the default, but say so
            micStream = await navigator.mediaDevices.getUserMedia({ audio: base });
            window._micFellBack = true;
          }
        }
      } catch (e) {
        // RX-only fallback — keep going.
      }
    }
    window._audioState = micStream ? 'mic' : 'rxonly';
    // Show which input the browser picked: easy to forget after connecting.
    window._micLabel = micStream ? (micStream.getAudioTracks()[0].label || 'unnamed input') : '';
    if (micStream) {
      fillMicList().then(function () {
        syncMicDropdown(micStream.getAudioTracks()[0]);
        if (window._micFellBack) { icFeedback('Chosen mic "' + micName + '" not available: using "' + window._micLabel + '"', true);
          var fb = document.getElementById('ic-feedback'); if (fb) { var m = fb.textContent; setTimeout(function () { if (fb.textContent === m) fb.textContent = ''; }, 12000); } }
        window._micFellBack = false;
      }).catch(function () {});
      micSel.title = 'In use: ' + window._micLabel;
    }
    icPost({cmd: 'mic_info', label: window._micLabel}).catch(function () {});
    if (micStream) {                      // the OS ended the mic (headset swapped/disconnected): reconnect, a few tries
      var tr = micStream.getAudioTracks()[0], mine = micStream;
      tr.addEventListener('ended', function () {
        if (micStream !== mine || !pc) return;                 // already torn down / replaced
        if ((window._micReconnects = (window._micReconnects || 0) + 1) > 3) {
          icFeedback('Mic stream ended and could not be restored: press Start audio', true); return; }
        icFeedback('Mic stream ended (headset change?): reconnecting', true);
        setTimeout(function () { if (micStream === mine && window._micRestart) window._micRestart(); }, 800);
      });
    }
    window._micWhy = micStream ? '' : (window.isSecureContext
      ? 'microphone permission was denied, or no microphone was found'
      : 'this page is not https, so the browser blocks the microphone');
    pc = new RTCPeerConnection({ iceServers: [] });
    if (micStream) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      var chain = null;
      try { chain = buildMicChain(micStream); } catch (e) {}
      if (chain) {                         // processed mic (level / compressor / limiter)
        window._micChain = chain;
        pc.addTrack(chain.track, chain.stream);
      } else {
        micStream.getAudioTracks().forEach(function (t) { pc.addTrack(t, micStream); });
      }
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    pc.ontrack = function (ev) {
      // First inbound track is the radio's RX audio.
      if (ev.streams && ev.streams[0]) {
        rxEl.srcObject = ev.streams[0];
      } else {
        var ms = new MediaStream();
        ms.addTrack(ev.track);
        rxEl.srcObject = ms;
      }
      rxEl.play().catch(function(){});
    };
    pc.onconnectionstatechange = function () {
      setStatus('audio: ' + pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        teardown();
      }
    };

    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait briefly for ICE candidates to be gathered (non-trickle).
    await new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') return resolve();
      var t = setTimeout(resolve, 800);
      pc.addEventListener('icegatheringstatechange', function () {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(t);
          resolve();
        }
      });
    });

    var resp;
    try {
      resp = await fetch('/webrtc/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sdp: pc.localDescription.sdp,
          type: pc.localDescription.type
        })
      }).then(function (r) { return r.json(); });
    } catch (e) {
      setStatus('audio: offer failed');
      teardown();
      return;
    }
    if (!resp || resp.ok === false || !resp.sdp) {
      setStatus('audio: ' + (resp && resp.error || 'no answer'));
      teardown();
      return;
    }
    await pc.setRemoteDescription({ type: resp.type, sdp: resp.sdp });

    btn.textContent = 'Stop audio';
    startStats();
    btn.disabled = false;
    setStatus('audio: connecting');
  }

  var statsTimer = null, statsPrev = null;
  function startStats() {
    stopStats();
    statsTimer = setInterval(function () {
      if (!pc || !pc.getStats) return;
      pc.getStats().then(function (rep) {
        var arr = []; rep.forEach(function (r) { arr.push(r); });
        var out = fmtAudioStats(arr, statsPrev);
        statsPrev = out.raw;
        var el = document.getElementById('ic-audio-stats');
        if (el) el.textContent = out.text;
      }).catch(function () {});
    }, 2000);
  }
  function stopStats() {
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    statsPrev = null;
    var el = document.getElementById('ic-audio-stats'); if (el) el.textContent = '';
  }
  function teardown() {
    stopStats();
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (micStream) {
      micStream.getTracks().forEach(function (t) { t.stop(); });
      micStream = null;
    }
    rxEl.srcObject = null;
    window._audioState = 'off'; window._micWhy = '';
    if (window._micChain) { try { window._micChain.ac.close(); } catch (e) {} window._micChain = null; }
    btn.textContent = 'Start audio';
    btn.disabled = false;
    setStatus('audio: off');
  }

  window._micRestart = function () { if (pc) teardown(); startAudio(); };
  btn.addEventListener('click', function () {
    window._micAutoRestarts = 0; window._micReconnects = 0;
    if (pc) teardown();
    else startAudio();
  });
})();


// ── Hold-to-talk PTT ────────────────────────────────────────────────────
// Press and hold to transmit. Keepalives every 500 ms; the server unkeys by
// itself if they stop. Any loss of focus/visibility/pointer releases.
(function () {
  var btn = document.getElementById('ic-ptt-btn');
  if (!btn) return;
  var held = false, timer = null, kaPending = false;
  // Requests go out strictly in order (a release can never overtake the key-down),
  // and at most one keepalive is queued at a time.
  var chain = Promise.resolve();
  function send(on, keepalive) {
    var body = {cmd: 'ptt', state: on, hold: on};
    if (keepalive) body.keepalive = true;   // server never re-keys on a keepalive
    chain = chain.then(function () { return icPost(body); }).catch(function () {});
    return chain;
  }
  function start() {
    if (held) return;
    held = true;
    window._pttHeld = true;
    if (window._audioState !== 'mic') {   // keying works, but nothing will modulate it
      icFeedback(window._audioState === 'rxonly' ? 'No mic: ' + window._micWhy
                                                  : 'No mic audio: press Start audio first', true);
    }
    window._micPeak = 0;                // the meter loop refills this while keyed
    setTimeout(function () {
      if (held && window._audioState === 'mic' && (window._micPeak || 0) < 0.003)   // < -50 dBFS
        icFeedback('Mic is SILENT: nothing is reaching the radio. Check the mic selection.', true);
    }, 1500);
    btn.classList.add('active');  // immediate feedback
    var lamp0 = document.getElementById('ic-trx-lamp'); if (lamp0) { lamp0.classList.remove('rx'); lamp0.classList.add('tx'); }
    send(true).then(function (d) {   // refused (e.g. radio error): drop the held look
      if (d && d.ok === false) window._pttHeld = false;
    });
    timer = setInterval(function () {
      if (kaPending) return;
      kaPending = true;
      send(true, true).then(function () { kaPending = false; });
    }, 500);
  }
  function stop() {
    if (!held) return;
    held = false;
    window._pttHeld = false; window._pttReleasedAt = performance.now();
    clearInterval(timer); timer = null;
    send(false).then(pollStatus);
  }
  function down(e) {
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    start();
  }
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('lostpointercapture', stop);
  btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); });

  // Spacebar = PTT while held (not while typing in a field).
  function typing() {
    var a = document.activeElement;
    return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }
  document.addEventListener('keydown', function (e) {
    if (e.code !== 'Space' || typing()) return;
    e.preventDefault();  // always, incl. auto-repeats, or the page scrolls while held
    if (!e.repeat) start();
  });
  document.addEventListener('keyup', function (e) {
    if (e.code !== 'Space') return;
    e.preventDefault();
    stop();
  });
})();
