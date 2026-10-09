// Make the test waveforms: identical speech-like audio, processed three ways, all scaled to the SAME peak.
const fs_ = require('fs');
const { CessbCore } = require('/Users/bb/aiwork/ic7100-remote/ic7100-remote/ic7100ctl/web/cessb.js');
const fs = 48000, SECS = 8, N = fs * SECS, PEAK = 0.85;
let seed = 20261008; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const rms = x => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length), pk = x => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const db = v => 20 * Math.log10(v);
function resonator(f, bw) { const r = Math.exp(-Math.PI * bw / fs), th = 2 * Math.PI * f / fs, a1 = -2 * r * Math.cos(th), a2 = r * r, g = 1 - r; let y1 = 0, y2 = 0;
  return x => { const y = g * x - a1 * y1 - a2 * y2; y2 = y1; y1 = y; return y; }; }
function speech() {                              // pulse train through three formants, syllable envelope, a few plosive-like bursts
  const f1 = resonator(650, 90), f2 = resonator(1150, 110), f3 = resonator(2450, 160), out = new Float64Array(N); let ph = 0;
  for (let i = 0; i < N; i++) { const t = i / fs; ph += (105 + 25 * Math.sin(2 * Math.PI * 0.7 * t)) / fs;
    let src = 0; if (ph >= 1) { ph -= 1; src = 1 - 0.3 * rnd(); }
    const syl = Math.pow(Math.max(0, Math.sin(Math.PI * ((t * 3.7) % 1))), 1.5);
    const burst = (Math.floor(t * 1.9) % 2 === 0 && (t * 1.9) % 1 < 0.01) ? (rnd() - 0.5) * 6 : 0;
    out[i] = syl * (f1(src) + 0.8 * f2(src) + 0.5 * f3(src)) * 8 + burst * 0.3; }
  return out;
}
function preamble() {
  const out = []; const A = 0.4;
  if (process.env.NOPRE) { for (let i = 0; i < fs * 0.5; i++) out.push(0); return out; }
  for (let i = 0; i < fs * 0.5; i++) out.push(0);
  const T = 0.3, f0 = 300, f1 = 2500;
  for (let i = 0; i < fs * T; i++) { const t = i / fs; out.push(A * Math.sin(2 * Math.PI * (f0 * t + (f1 - f0) * t * t / (2 * T)))); }
  for (let i = 0; i < fs * 0.2; i++) out.push(0);
  for (let i = 0; i < fs * 0.5; i++) out.push(A * Math.sin(2 * Math.PI * 1000 * i / fs));
  for (let i = 0; i < fs * 0.2; i++) out.push(0);
  return out;                                      // test signal starts at 1.7 s
}
function wav(name, x) {
  const pre = preamble(), post = fs / 2, n = pre.length + x.length + post, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(fs, 24); b.writeUInt32LE(fs * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  const put = (i, v) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2);
  for (let i = 0; i < pre.length; i++) put(i, pre[i]);
  for (let i = 0; i < x.length; i++) put(pre.length + i, x[i]);
  fs_.writeFileSync((process.env.NOPRE ? 'np_' : '') + name, b);
  console.log(name.padEnd(22), 'test signal: peak', db(pk(x)).toFixed(1).padStart(6), 'dBFS | rms', db(rms(x)).toFixed(1).padStart(6), 'dBFS | crest', (db(pk(x)) - db(rms(x))).toFixed(1), 'dB | length', (x.length / fs).toFixed(1), 's');
}
const base = speech(); const k = 0.056 / rms(base); const mic = base.map(v => v * k);            // "mic" speech at about -25 dBFS RMS
const plainGain = PEAK / pk(mic);
wav('speech_plain.wav', mic.map(v => v * plainGain));
for (const drive of [12, 18]) {
  const c = CessbCore(); c.drive = Math.pow(10, drive / 20); c.setCeiling(PEAK);
  wav(`speech_cessb${drive}.wav`, Float64Array.from(mic, v => c.process(v)));
}
const tt = Float64Array.from({ length: N }, (_, i) => (Math.sin(2 * Math.PI * 900 * i / fs) + Math.sin(2 * Math.PI * 1400 * i / fs)) * PEAK / 2);
wav('twotone_plain.wav', tt.slice(0, fs * 4));
fs_.writeFileSync('speech_ref_input.f64', Buffer.from(mic.buffer));      // the unprocessed mic speech, for the analysis
// two-tone level sweep (peak of the pair, dBFS): -4.4, -7.4, -10.4, -13.4
for (const lvl of [-4.4, -7.4, -10.4, -13.4, -19.4, -25.4, -31.4, -37.4]) {
  const A = Math.pow(10, lvl / 20) / 2;
  const t2 = Float64Array.from({ length: fs * 4 }, (_, i) => (Math.sin(2 * Math.PI * 900 * i / fs) + Math.sin(2 * Math.PI * 1400 * i / fs)) * A);
  wav(`twotone_${Math.abs(lvl).toFixed(1).replace('.', 'p')}.wav`, t2);
}
// two-tone points for the knee at 40% power
for (const lvl of [-16.4, -22.4]) {
  const A = Math.pow(10, lvl / 20) / 2;
  const t2 = Float64Array.from({ length: fs * 4 }, (_, i) => (Math.sin(2 * Math.PI * 900 * i / fs) + Math.sin(2 * Math.PI * 1400 * i / fs)) * A);
  wav(`twotone_${Math.abs(lvl).toFixed(1).replace('.', 'p')}.wav`, t2);
}
// the same three speech versions, all scaled to a peak of -25.4 dBFS (inside the radio's linear region)
const LOW = Math.pow(10, -25.4 / 20);
const variants = { plain: mic.map(v => v * plainGain) };
for (const drive of [12, 18]) { const c = CessbCore(); c.drive = Math.pow(10, drive / 20); c.setCeiling(PEAK); variants['cessb' + drive] = Float64Array.from(mic, v => c.process(v)); }
for (const [name, x] of Object.entries(variants)) { const g = LOW / pk(x); wav(`speech_${name}_m25.wav`, x.map(v => v * g)); }
// the same three speech versions at a peak of -11.4 dBFS (the radio is at its set power here at 40%)
{ const HI = Math.pow(10, -11.4 / 20);
  for (const [name, x] of Object.entries(variants)) { const g = HI / pk(x); wav(`speech_${name}_m11.wav`, x.map(v => v * g)); } }
