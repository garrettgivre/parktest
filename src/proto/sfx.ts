// Tiny synthesized sound effects (WebAudio, no files). Browsers only allow
// audio after a user gesture, so the context is created lazily on first use.

let ctx: AudioContext | null = null;
let muted = false;
try { muted = localStorage.getItem("park.muted") === "1"; } catch { /* storage blocked */ }

export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem("park.muted", m ? "1" : "0"); } catch { /* storage blocked */ }
}
export function isMuted() { return muted; }

export function unlock() {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return; }
  }
  if (ctx.state === "suspended") void ctx.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "square", vol = 0.06, slide = 0) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(start: number, dur: number, vol = 0.04) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + start;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1800;
  src.buffer = buf;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t0);
}

export const sfx = {
  tap: () => tone(660, 0, 0.05, "square", 0.03),
  done: () => { tone(520, 0, 0.07); tone(780, 0.07, 0.09); },
  misery: () => tone(220, 0, 0.18, "sawtooth", 0.05, -90),
  combo: () => [523, 659, 784, 1047].forEach((f, k) => tone(f, k * 0.07, 0.14, "square", 0.05)),
  caught: () => { tone(880, 0, 0.12, "square", 0.06); tone(880, 0.18, 0.12, "square", 0.06); tone(440, 0.36, 0.3, "sawtooth", 0.06, -200); },
  radio: () => { noise(0, 0.12); tone(1200, 0.12, 0.06, "sine", 0.03); noise(0.2, 0.08); },
  banner: () => { tone(392, 0, 0.12, "triangle", 0.07); tone(523, 0.12, 0.2, "triangle", 0.07); },
  sad: () => [392, 370, 349, 330].forEach((f, k) => tone(f, k * 0.25, 0.3, "triangle", 0.06)),
};
