// Confetti + synthesized sounds (drumroll, air horn, ding). No audio files needed.

let soundOn = true;
try { soundOn = localStorage.getItem("ss:sound") !== "off"; } catch {}

export function isSoundOn() { return soundOn; }
export function setSound(on) {
  soundOn = on;
  try { localStorage.setItem("ss:sound", on ? "on" : "off"); } catch {}
}

let ctx = null;
function audio() {
  if (!soundOn) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function noiseBuffer(ac, seconds) {
  const buf = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Snare drumroll that speeds up, lasting `seconds`. */
export function drumroll(seconds = 2.2) {
  const ac = audio();
  if (!ac) return;
  const buf = noiseBuffer(ac, 0.12);
  const start = ac.currentTime + 0.02;
  let t = 0;
  let gap = 0.11;
  while (t < seconds) {
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    const g = ac.createGain();
    const vol = 0.25 + 0.35 * (t / seconds);
    g.gain.setValueAtTime(vol, start + t);
    g.gain.exponentialRampToValueAtTime(0.001, start + t + 0.09);
    src.connect(filter).connect(g).connect(ac.destination);
    src.start(start + t);
    src.stop(start + t + 0.1);
    t += gap;
    gap = Math.max(0.035, gap * 0.94);
  }
  // cymbal crash at the end
  const crash = ac.createBufferSource();
  crash.buffer = noiseBuffer(ac, 1.5);
  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 5000;
  const cg = ac.createGain();
  cg.gain.setValueAtTime(0.5, start + seconds);
  cg.gain.exponentialRampToValueAtTime(0.001, start + seconds + 1.4);
  crash.connect(hp).connect(cg).connect(ac.destination);
  crash.start(start + seconds);
}

/** Obnoxious air horn: three blasts. */
export function airhorn() {
  const ac = audio();
  if (!ac) return;
  const blasts = [[0, 0.18], [0.24, 0.18], [0.48, 0.7]];
  for (const [offset, len] of blasts) {
    const t0 = ac.currentTime + 0.02 + offset;
    const master = ac.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
    master.gain.setValueAtTime(0.18, t0 + len - 0.05);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    master.connect(lp).connect(ac.destination);
    for (const f of [466, 470, 554, 698]) {
      const o = ac.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f * 0.94, t0);
      o.frequency.exponentialRampToValueAtTime(f, t0 + 0.06);
      o.connect(master);
      o.start(t0);
      o.stop(t0 + len + 0.02);
    }
  }
}

export function ding() {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + 0.01;
  for (const [f, d] of [[1046, 0], [1568, 0.08]]) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.2, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + d + 0.5);
    o.connect(g).connect(ac.destination);
    o.start(t0 + d);
    o.stop(t0 + d + 0.55);
  }
}

export function gobble() {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + 0.01;
  for (let i = 0; i < 6; i++) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "square";
    const s = t0 + i * 0.07;
    o.frequency.setValueAtTime(700 - i * 30, s);
    o.frequency.exponentialRampToValueAtTime(380, s + 0.06);
    g.gain.setValueAtTime(0.08, s);
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.065);
    o.connect(g).connect(ac.destination);
    o.start(s);
    o.stop(s + 0.07);
  }
}

// ---------- confetti ----------
const COLORS = ["#ff2e93", "#b6ff00", "#2d6bff", "#ffe500", "#ff7a00", "#00c46a", "#ffffff"];
const EMOJI = ["🎁", "❄️", "🦃", "✨", "🎄"];
let particles = [];
let raf = null;

export function confetti(amount = 180) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.getElementById("confetti");
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < amount; i++) {
    const fromLeft = i % 2 === 0;
    particles.push({
      x: fromLeft ? -10 : innerWidth + 10,
      y: innerHeight * (0.5 + Math.random() * 0.4),
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 10),
      vy: -(10 + Math.random() * 12),
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 8 + Math.random() * 8,
      h: 5 + Math.random() * 6,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      emoji: Math.random() < 0.08 ? EMOJI[(Math.random() * EMOJI.length) | 0] : null,
      life: 0,
    });
  }
  if (!raf) loop(c);
}

function loop(c) {
  c.clearRect(0, 0, innerWidth, innerHeight);
  particles = particles.filter((p) => p.y < innerHeight + 40 && p.life < 400);
  for (const p of particles) {
    p.life++;
    p.vy += 0.35;
    p.vx *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.r += p.vr;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.r);
    if (p.emoji) {
      c.font = "26px serif";
      c.fillText(p.emoji, -13, 9);
    } else {
      c.fillStyle = p.color;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 6)));
    }
    c.restore();
  }
  if (particles.length) {
    raf = requestAnimationFrame(() => loop(c));
  } else {
    raf = null;
    c.clearRect(0, 0, innerWidth, innerHeight);
  }
}
