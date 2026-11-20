// Confetti (no sound on this site).

const COLORS = ["#d7263d", "#3fbf6a", "#ffc23d", "#ffffff", "#1f8a4c", "#b3001b"];
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
