// Synthesised sound effects via WebAudio — no audio files, no network. The context is
// created lazily on the first user gesture (pointer lock click) so browsers allow it.
export function createAudio() {
  let ctx = null;
  let master = null;
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }
  function noiseBurst(dur, filterFreq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = type; filter.frequency.value = filterFreq;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(filter); filter.connect(g); g.connect(master);
    src.start();
  }
  function tone(freq, dur, gain, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const osc = ctx.createOscillator();
    osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g); g.connect(master);
    osc.start(); osc.stop(ctx.currentTime + dur + 0.02);
  }
  return {
    unlock() { ensure(); },
    shot(kind) {
      if (kind === 'sniper') { noiseBurst(0.22, 900, 0.9); tone(160, 0.12, 0.25, 'square', 60); }
      else if (kind === 'rifle') { noiseBurst(0.11, 1600, 0.7); tone(220, 0.06, 0.18, 'square', 90); }
      else if (kind === 'smg') { noiseBurst(0.07, 2200, 0.5); }
      else { noiseBurst(0.09, 1400, 0.6); tone(300, 0.05, 0.12, 'square', 120); }
    },
    dry() { tone(1200, 0.03, 0.15, 'square'); },
    reload() { tone(500, 0.05, 0.2, 'square'); setTimeout(() => tone(700, 0.05, 0.2, 'square'), 140); },
    hit() { tone(1900, 0.05, 0.25, 'sine'); },
    kill() { tone(1500, 0.07, 0.3, 'sine'); setTimeout(() => tone(2100, 0.09, 0.3, 'sine'), 70); },
    hurt() { noiseBurst(0.12, 500, 0.5); tone(110, 0.15, 0.25, 'sawtooth', 70); },
    step() { noiseBurst(0.04, 300, 0.08); },
    plant() { tone(880, 0.08, 0.25, 'sine'); },
    beep(hi) { tone(hi ? 1250 : 950, 0.07, 0.3, 'sine'); },
    explosion() { noiseBurst(0.9, 240, 1.0); tone(55, 0.8, 0.5, 'sine', 28); },
    buy() { tone(660, 0.06, 0.25, 'sine'); setTimeout(() => tone(990, 0.08, 0.25, 'sine'), 60); },
    denied() { tone(180, 0.15, 0.3, 'square', 120); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.3, 'triangle'), i * 110)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.2, 0.28, 'triangle'), i * 120)); },
    throwPin() { tone(1400, 0.04, 0.2, 'square'); },
  };
}
