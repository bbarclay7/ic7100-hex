// Run: node tests/cessb_test.js   (exit 0 = pass). Checks the CESSB processor on synthetic speech.
const assert = require('assert');
const { CessbCore } = require('../ic7100ctl/web/cessb.js');
const fs = 48000, N = 1 << 15;
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const mx = a => a.reduce((m, v) => v > m ? v : m, 0), rms = x => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const db = v => 20 * Math.log10(v);

function resonator(f, bw) { const r = Math.exp(-Math.PI * bw / fs), th = 2 * Math.PI * f / fs, a1 = -2 * r * Math.cos(th), a2 = r * r, g = 1 - r; let y1 = 0, y2 = 0;
  return x => { const y = g * x - a1 * y1 - a2 * y2; y2 = y1; y1 = y; return y; }; }
function speechLike() {                           // pulse train through three formants with a syllable envelope
  const f1 = resonator(650, 90), f2 = resonator(1150, 110), f3 = resonator(2450, 160), out = new Float64Array(N); let ph = 0;
  for (let i = 0; i < N; i++) { const t = i / fs; ph += (105 + 25 * Math.sin(2 * Math.PI * 0.7 * t)) / fs;
    let src = 0; if (ph >= 1) { ph -= 1; src = 1 - 0.3 * rnd(); }
    const syl = Math.pow(Math.max(0, Math.sin(Math.PI * ((t * 3.7) % 1))), 1.5);
    out[i] = syl * (f1(src) + 0.8 * f2(src) + 0.5 * f3(src)); }
  const k = 0.1 / rms(out); return out.map(v => v * k);              // RMS -20 dBFS
}
function fft(re, im, inv) {
  const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const a = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(a), wi = Math.sin(a), h = len / 2;
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let j = 0; j < h; j++) { const ur = re[i+j], ui = im[i+j], vr = re[i+j+h]*cr - im[i+j+h]*ci, vi = re[i+j+h]*ci + im[i+j+h]*cr;
      re[i+j] = ur + vr; im[i+j] = ui + vi; re[i+j+h] = ur - vr; im[i+j+h] = ui - vi; const t = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = t; } } }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function envelope(x) {                            // exact |analytic signal| via FFT
  const re = Float64Array.from(x), im = new Float64Array(x.length); fft(re, im, false);
  for (let k = 1; k < x.length / 2; k++) { re[k] *= 2; im[k] *= 2; } for (let k = x.length / 2 + 1; k < x.length; k++) { re[k] = 0; im[k] = 0; }
  fft(re, im, true); return Float64Array.from(re, (v, i) => Math.hypot(v, im[i]));
}
function run(drive, ceiling) { const c = CessbCore(); c.drive = drive; c.setCeiling(ceiling); return Float64Array.from(speech, v => c.process(v)); }
const speech = speechLike();

// 1. The 90-degree pair: a steady tone in the voice band keeps a flat envelope when nothing is clipped.
for (const f of [400, 1000, 2400]) {
  const c = CessbCore(); c.setCeiling(10); const y = Float64Array.from({ length: 4096 }, (_, i) => c.process(0.3 * Math.sin(2 * Math.PI * f * i / fs)));
  const seg = y.slice(2048); const e = envelope(seg).slice(512, -512);
  assert(mx(e) / Math.min(...e) < 1.06, `envelope of a ${f} Hz tone is not flat: ${mx(e)} / ${Math.min(...e)}`);
}
// 2. The exact RF envelope of the output stays at the ceiling (small tolerance for the filters' final overshoot).
const ceil = 0.3, y = run(2, ceil), pk = mx(envelope(y).slice(2048, -2048));
assert(pk < ceil * 1.12, `RF envelope peak ${pk} exceeds ceiling ${ceil} by more than 12%`);
assert(pk > ceil * 0.8, 'ceiling was not reached: the test would prove nothing');
// 3. At equal RF-envelope peak, CESSB carries clearly more average power than the old tanh soft clipper.
function powerAtPeak(sig) { const e = envelope(sig).slice(2048, -2048), k = 0.8 / mx(e); return rms(sig.map(v => v * k).slice(2048, -2048)); }
const bp = () => { const c = CessbCore(); c.setCeiling(1e9); return a => Float64Array.from(a, v => c.process(v)); };
const soft = bp()(speech.map(v => Math.tanh(1.1 * v * 2) / 1.1));
const gain = db(powerAtPeak(y)) - db(powerAtPeak(soft));
assert(gain > 3, `CESSB gains only ${gain.toFixed(1)} dB over the soft clipper`);
// 4. It reports how hard it is clipping.
const c = CessbCore(); c.setCeiling(ceil); c.drive = 2; speech.forEach(v => c.process(v));
assert(c.gr > 1.2, 'gain-reduction report did not register any clipping');
console.log(`cessb ok: envelope peak ${(pk / ceil).toFixed(2)} x ceiling, +${gain.toFixed(1)} dB average power vs soft clip, max clip ${db(c.gr).toFixed(1)} dB`);
