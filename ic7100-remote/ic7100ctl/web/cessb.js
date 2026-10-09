// CESSB: controlled-envelope SSB speech processor.
//
// An SSB transmitter's RF envelope is the magnitude of the audio's analytic
// signal (audio plus its 90-degree-shifted copy). A plain audio clipper limits
// the audio waveform, but the SSB filtering that follows makes the RF envelope
// overshoot, so the transmitter must be backed off. This clips the *envelope*
// instead, filters to the voice band, then clips the small overshoot again, so
// the envelope never exceeds `ceiling` and the average level can be higher.
//
// The 90-degree pair is a two-path all-pass network (O. Niemitalo): within 0.7
// degrees across 300-2700 Hz at 48 kHz, no latency to speak of. It assumes
// fs = 48000 (the sample rate the panel's mic chain is built for).
//
// Self-contained on purpose: CessbCore.toString() is shipped into an
// AudioWorklet, so it must not reference anything outside itself.
function CessbCore(fs) {
  fs = fs || 48000;
  var A1 = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737];
  var A2 = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278];

  function chain(a) {                 // cascade of (c - z^-2)/(1 - c z^-2), c = a^2
    var n = a.length, c = [], x1 = [], x2 = [], y1 = [], y2 = [];
    for (var i = 0; i < n; i++) { c.push(a[i] * a[i]); x1.push(0); x2.push(0); y1.push(0); y2.push(0); }
    return function (x) {
      for (var i = 0; i < n; i++) {
        var y = c[i] * x - x2[i] + c[i] * y2[i];
        x2[i] = x1[i]; x1[i] = x; y2[i] = y1[i]; y1[i] = y;
        x = y;
      }
      return x;
    };
  }
  function analytic() {               // x -> [re, im]; |re + j im| is the envelope
    var p1 = chain(A1), p2 = chain(A2), d = 0, out = [0, 0];
    return function (x) {
      var a = p1(x), b = p2(x);
      out[0] = b; out[1] = d; d = a;  // path 1 carries the extra unit delay
      return out;
    };
  }
  function biquad(type, f0, q) {      // RBJ cookbook, direct form I
    var w = 2 * Math.PI * f0 / fs, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
    var b0, b1, b2, a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
    if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
    else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return function (x) {
      var y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      return y;
    };
  }
  function clipper(ceiling, track) {  // scale the analytic signal down where its envelope exceeds the ceiling
    var an = analytic();
    return function (x) {
      var v = an(x), e = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
      if (e <= ceiling) return v[0];
      if (track) { var r = e / ceiling; if (r > self.gr) self.gr = r; }   // deepest clip since last reset (ratio)
      return v[0] * (ceiling / e);
    };
  }

  var self = { drive: 1, ceiling: 0.8, gr: 1 };
  var clip1 = clipper(self.ceiling, true), clip2 = clipper(self.ceiling, false);
  var hp = biquad('hp', 300, 0.7071);
  var lp1 = biquad('lp', 2800, 0.5412), lp2 = biquad('lp', 2800, 1.3066);   // 4th-order Butterworth
  // Both clippers read the ceiling when constructed; rebuild them if it changes.
  self.setCeiling = function (c) { self.ceiling = c; clip1 = clipper(c, true); clip2 = clipper(c, false); };
  self.process = function (x) {
    return clip2(lp2(lp1(hp(clip1(x * self.drive)))));
  };
  return self;
}

// AudioWorklet source: the core above plus a processor that applies it to channel 0.
// Messages in: {drive: linear gain} or {ceiling: 0..1}. Out: {gr: dB of envelope clipping}.
function cessbWorkletSource() {
  return 'var CessbCore = ' + CessbCore.toString() + ';\n' +
    'registerProcessor("cessb", class extends AudioWorkletProcessor {\n' +
    '  constructor() { super(); this.c = CessbCore(sampleRate);\n' +
    '    this.port.onmessage = (m) => { if (m.data.drive != null) this.c.drive = m.data.drive;\n' +
    '                                   if (m.data.ceiling != null) this.c.setCeiling(m.data.ceiling); }; }\n' +
    '  process(inputs, outputs) {\n' +
    '    var i = inputs[0][0], o = outputs[0][0];\n' +
    '    if (!i || !o) return true;\n' +
    '    for (var n = 0; n < i.length; n++) o[n] = this.c.process(i[n]);\n' +
    '    if ((this.k = (this.k || 0) + 1) % 20 === 0) {            // ~50 ms: report how hard it is clipping (dB)\n' +
    '      this.port.postMessage({gr: 20 * Math.log10(this.c.gr)}); this.c.gr = 1; }\n' +
    '    return true;\n' +
    '  }\n' +
    '});';
}

if (typeof module !== 'undefined') module.exports = { CessbCore: CessbCore, cessbWorkletSource: cessbWorkletSource };
