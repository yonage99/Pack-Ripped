/* Pack Ripped visual effects: confetti bursts and a quick flash (canvas, no libraries). */
(function (root) {
  'use strict';

  const COLORS = ['#ff7a3d', '#ffb347', '#ffd84d', '#3ddc84', '#4fc3ff', '#b47cff', '#ff6fae', '#ffffff'];
  const GOLD = ['#ffd84d', '#ffb347', '#fff1a8', '#e8c45a', '#ffffff'];
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let canvas = null;
  let ctx = null;
  let parts = [];
  let running = false;

  function setup() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    const size = () => {
      const r = window.devicePixelRatio || 1;
      canvas.width = innerWidth * r;
      canvas.height = innerHeight * r;
      ctx.setTransform(r, 0, 0, r, 0, 0);
    };
    size();
    window.addEventListener('resize', size);
  }

  function loop() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.life > 0);
    for (const p of parts) {
      p.vy += 0.32; // gravity
      p.vx *= 0.985; // air
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 1;
      const alpha = Math.min(1, p.life / 30);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.rot * 2)); // flutter
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (parts.length) requestAnimationFrame(loop);
    else {
      running = false;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
  }

  /**
   * Confetti burst.
   * opts: { x, y } origin in px (default: middle of the screen), count, colors, power, spread
   */
  function confetti(opts) {
    opts = opts || {};
    setup();
    const n = Math.round((opts.count || 140) * (reduced() ? 0.25 : 1));
    const x = opts.x != null ? opts.x : innerWidth / 2;
    const y = opts.y != null ? opts.y : innerHeight / 2;
    const colors = opts.colors || COLORS;
    const power = opts.power || 13;
    const spread = opts.spread || Math.PI * 2;
    const aim = opts.aim != null ? opts.aim : -Math.PI / 2; // up
    for (let i = 0; i < n; i++) {
      const ang = aim + (Math.random() - 0.5) * spread;
      const sp = power * (0.35 + Math.random() * 0.75);
      parts.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 2,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 8,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: colors[Math.floor(Math.random() * colors.length)],
        round: Math.random() < 0.2,
        life: 90 + Math.random() * 60,
      });
    }
    if (!running) {
      running = true;
      requestAnimationFrame(loop);
    }
  }

  /** Burst from the middle of an element. */
  function burstFrom(el, opts) {
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    confetti({ ...(opts || {}), x: r ? r.left + r.width / 2 : undefined, y: r ? r.top + r.height / 3 : undefined });
  }

  /** A soft white flash over the screen. */
  function flash(color) {
    if (reduced()) return;
    const f = document.createElement('div');
    f.className = 'fx-flash';
    if (color) f.style.background = color;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 600);
  }

  /** Big hit: gold confetti raining from both top corners. */
  function goldShower() {
    confetti({ x: 0, y: innerHeight * 0.25, aim: -Math.PI / 4, spread: Math.PI / 2.2, count: 90, colors: GOLD, power: 16 });
    confetti({ x: innerWidth, y: innerHeight * 0.25, aim: (-3 * Math.PI) / 4, spread: Math.PI / 2.2, count: 90, colors: GOLD, power: 16 });
  }

  root.PRFx = { confetti, burstFrom, flash, goldShower };
})(typeof self !== 'undefined' ? self : this);
