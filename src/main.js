const TAU = Math.PI * 2;

const DEFAULTS = {
  ballRadius: 8.5,
  gravity: 360,
  bounce: 0.9,
  ringCount: 12,
  ringSpacing: 14,
  lineWidth: 2,
  gapSize: 97,
  gapBalance: -0.45,
  spin: 0.85,
  spinBalance: -0.35,
  smoothFlip: false,
  spinDir: 2,
  gradient: true,
  advancedGradient: false,
  gradSmooth: true,
  trail: true,
  trailOpacity: 0.6,
  trailLength: 0.4,
  trailGradient: true,
  trailBallStart: false,
  trailAdvancedGradient: false,
  trailGradSmooth: true,
  glowRing: true,
  glowRingMode: 0,
  glowRingOpacity: 0.35,
  glowRingSize: 3.5,
  glowRingCustom: false,
  glowRingColor: '#ffffff',
  glowBall: true,
  glowBallMode: 1,
  glowBallOpacity: 0.45,
  glowBallSize: 3,
  glowBallCustom: false,
  glowBallColor: '#ffffff',
  particles: true,
  sound: true,
};

const STEP = 1 / 240;
const BALANCE_K = 3;
const FLIP_EASE = 6;
const TOP_SPEED = 50;
const JITTER = 0.12;
const HOLD_AFTER = 1.6;
const MAX_SPEED = 12000;
const REF_VIEW = 142;

const balance = (b, t) => Math.pow(BALANCE_K, b * (1 - 2 * t));

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function colorAtStops(stops, smooth, t) {
  const n = stops.length;
  if (n === 1 || t <= stops[0].pos) return stops[0].rgb;
  if (t >= stops[n - 1].pos) return stops[n - 1].rgb;
  for (let i = 0; i < n - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t <= b.pos) {
      if (!smooth) return t - a.pos < b.pos - t ? a.rgb : b.rgb;
      const f = (t - a.pos) / Math.max(1e-6, b.pos - a.pos);
      return a.rgb.map((v, k) => v + (b.rgb[k] - v) * f);
    }
  }
  return stops[n - 1].rgb;
}

function gradientCss(stops, smooth) {
  const st = [...stops].sort((a, b) => a.pos - b.pos);
  if (smooth) return `linear-gradient(90deg, ${st.map((x) => `${x.color} ${(x.pos * 100).toFixed(1)}%`).join(', ')})`;
  const parts = st.map((x, i) => {
    const from = i === 0 ? 0 : (st[i - 1].pos + x.pos) / 2;
    const to = i === st.length - 1 ? 1 : (x.pos + st[i + 1].pos) / 2;
    return `${x.color} ${(from * 100).toFixed(1)}% ${(to * 100).toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

const randomAnyColor = () => hslToHex(Math.random() * 360, 0.2 + Math.random() * 0.8, 0.2 + Math.random() * 0.6);
const randomHueColor = () => hslToHex(Math.random() * 360, 1, 0.5);

function randomColors() {
  const h = Math.random() * 360;
  return {
    ringColor: hslToHex(h, 0.95, 0.58),
    ringColor2: hslToHex((h + 70 + Math.random() * 180) % 360, 0.95, 0.58),
    ballColor: hslToHex((h + 150 + Math.random() * 60) % 360, 0.9, 0.72),
  };
}

const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
{
  const vp = document.querySelector('meta[name="viewport"]');
  if (!vp) {
    const m = document.createElement('meta');
    m.name = 'viewport';
    m.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    document.head.appendChild(m);
  } else if (!/viewport-fit/.test(vp.content)) {
    vp.content += ', viewport-fit=cover';
  }
}

let audioCtx = null;
let lastSound = 0;
const SCALE = [0, 2, 4, 7, 9];
const NOTES = 15;

function unlockAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
  }
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
  if (audioCtx.state !== 'running') { const p = audioCtx.resume(); if (p && p.catch) p.catch(() => {}); }
}

function wakeAudio() {
  if (audioCtx && audioCtx.state !== 'running') { const p = audioCtx.resume(); if (p && p.catch) p.catch(() => {}); }
}
document.addEventListener('pointerdown', wakeAudio, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeAudio(); });

function scheduleNote(ctx, t, k, vol, dur) {
  k = Math.max(0, Math.min(NOTES - 1, Math.round(k)));
  const semis = SCALE[k % 5] + 12 * Math.floor(k / 5);
  const f = 523.25 * Math.pow(2, semis / 12);
  [[1, 1], [2, 0.3]].forEach(([mul, amp]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = Math.min(f * mul, 8000);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol * amp, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  });
}

let voices = 0;
const MAX_VOICES = COARSE ? 14 : 28;
function playNote(k, vol, dur) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const now = performance.now();
  if (vol < 0.2 && now - lastSound < 40) return;
  if (voices >= MAX_VOICES && vol < 0.6) return;
  lastSound = now;
  voices++;
  setTimeout(() => { voices--; }, (dur + 0.1) * 1000);
  scheduleNote(audioCtx, audioCtx.currentTime, k, vol, dur);
}

function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return Math.abs(d);
}

function createSim(canvas, opts) {
  const ctx = canvas.getContext('2d');
  const P = opts.particles;
  const pX = new Float32Array(P), pY = new Float32Array(P);
  const pVX = new Float32Array(P), pVY = new Float32Array(P);
  const pLife = new Float32Array(P), pMax = new Float32Array(P);
  const pCol = new Uint8Array(P);
  let pHead = 0;

  const trail = [];
  let simT = 0;
  let trailCanvas = null, tctx = null;

  const rings = [];
  const ball = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 };
  const state = { alpha: 0, hold: 0, ending: false, dir: 1, dirTarget: 1, flipT: 0 };
  const g = {};
  let cfg = null;
  const startDir = () => (cfg && cfg.spinDir === 1 ? -1 : 1);
  let running = false, raf = 0, last = 0, acc = 0;
  let zoom = 1, zoomTarget = 1;
  let dprCap = COARSE ? 2 : 2.5;
  const curDpr = () => Math.max(1, Math.min(window.devicePixelRatio || 1, dprCap));
  let slowFrames = 0;
  let trailBox = null;
  let sink = null, sinkLast = -1, clock = 0, cycleEnded = false;

  function sound(k, vol, dur) {
    if (!opts.audio || !cfg.sound) return;
    if (sink) {
      if (vol < 0.2 && clock - sinkLast < 0.04) return;
      sinkLast = clock;
      sink.push({ t: clock, k, vol, dur });
    } else {
      playNote(k, vol, dur);
    }
  }

  function derive(c, o) {
    cfg = { ...c };
    const r = cfg.ballRadius, lw = cfg.lineWidth;
    g.pad = r + lw / 2;
    g.inner = Math.max(54, 3 * r + lw);
    g.spacing = Math.max(cfg.ringSpacing, 0.5);
    g.arena = Math.max(100, 2.2 * r + lw);
    g.full = Math.max(1, Math.round(cfg.ringCount));
    g.scene = o.scene || 'play';
    g.hasBall = g.scene === 'play' || g.scene === 'ball';
    g.rotates = g.scene !== 'static' && g.scene !== 'ball';
    g.R0 = g.scene === 'ball' ? g.arena : g.inner;
    if (g.scene === 'ball') {
      g.count = 1;
      g.view = g.arena + g.pad + 14;
    } else if (o.mode === 'cut') {
      g.view = Math.max(REF_VIEW, g.inner + g.pad + 20);
      const fit = Math.floor((g.view - 8 - g.inner) / g.spacing) + 1;
      g.count = Math.min(g.full, Math.max(3, fit));
    } else {
      g.count = g.full;
      g.view = g.inner + (g.count - 1) * g.spacing + g.pad + 12;
    }
    g.outer = g.R0 + (g.count - 1) * g.spacing;
    g.restitution = 0.7 + 0.3 * cfg.bounce;
    g.reach = 0.6 + 0.4 * cfg.bounce;
    if (!cfg.gradient) {
      g.stops = [{ pos: 0, rgb: hexToRgb(cfg.ringColor) }];
      g.smooth = true;
    } else if (!cfg.advancedGradient) {
      g.stops = [{ pos: 0, rgb: hexToRgb(cfg.ringColor) }, { pos: 1, rgb: hexToRgb(cfg.ringColor2) }];
      g.smooth = true;
    } else {
      g.stops = [...cfg.gradStops].sort((a, b) => a.pos - b.pos).map((x) => ({ pos: x.pos, rgb: hexToRgb(x.color) }));
      g.smooth = cfg.gradSmooth;
    }
    g.gbRgb = hexToRgb(cfg.glowBallCustom ? cfg.glowBallColor : cfg.ballColor);
    if (!cfg.trailGradient) {
      g.tStops = [{ pos: 0, rgb: hexToRgb(cfg.trailColor) }];
      g.tSmooth = true;
    } else if (!cfg.trailAdvancedGradient) {
      g.tStops = [{ pos: 0, rgb: hexToRgb(cfg.trailColor) }, { pos: 1, rgb: hexToRgb(cfg.trailColor2) }];
      g.tSmooth = true;
    } else {
      g.tStops = [...cfg.trailGradStops].sort((a, b) => a.pos - b.pos).map((x) => ({ pos: x.pos, rgb: hexToRgb(x.color) }));
      g.tSmooth = cfg.trailGradSmooth;
    }
  }

  function makeRing(i) {
    const t = g.full > 1 ? i / (g.full - 1) : 0;
    const R = g.R0 + i * g.spacing;
    const len = cfg.gapSize * balance(cfg.gapBalance, t);
    const half = g.scene === 'ball' ? 0 : Math.min(2.9, Math.max(len / (2 * R), (1.3 * cfg.ballRadius) / R));
    const rgb = colorAtStops(g.stops, g.smooth, t).map(Math.round).join(',');
    return {
      R, half,
      rot: -Math.PI / 2,
      speed: cfg.spin * balance(cfg.spinBalance, t),
      broken: false,
      core: `rgb(${rgb})`,
      idx: i,
    };
  }

  function build() {
    rings.length = 0;
    for (let i = 0; i < g.count; i++) rings.push(makeRing(i));
    state.alpha = 0;
    state.hold = 0;
    state.ending = false;
    state.dir = state.dirTarget = startDir();
    state.flipT = 0;
    pLife.fill(0);
    resetBall();
  }

  function resetBall() {
    trail.length = 0;
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
    ball.x = ball.px = 0;
    ball.y = ball.py = 0;
    ball.vx = Math.cos(a) * 120;
    ball.vy = Math.sin(a) * 120;
  }

  function configure(c, o = {}) {
    derive(c, o);
    cycleEnded = false;
    build();
  }

  function update(c, o = {}, reset = false) {
    const prevScene = g.scene;
    const hadBall = g.hasBall;
    derive(c, o);
    const frozen = g.scene === 'static' || g.scene === 'ball';
    const old = rings.slice();
    rings.length = 0;
    for (let i = 0; i < g.count; i++) {
      const r = makeRing(i);
      if (old[i]) { r.rot = old[i].rot; r.broken = old[i].broken; }
      if (frozen) { r.rot = -Math.PI / 2; r.broken = false; }
      rings.push(r);
    }
    if (g.scene !== prevScene) {
      state.dir = state.dirTarget = startDir();
      state.flipT = 0;
    }
    if (reset) {
      for (let i = 0; i < rings.length; i++) rings[i].rot = -Math.PI / 2;
      state.dir = state.dirTarget = startDir();
      state.flipT = 0;
      state.alpha = 1;
    }
    if (!cfg.smoothFlip) state.dir = state.dirTarget;
    if (g.hasBall && (!hadBall || (g.scene === 'ball' && Math.hypot(ball.x, ball.y) > rings[0].R - g.pad))) resetBall();
  }

  function innermostRadius() {
    for (let i = 0; i < rings.length; i++) if (!rings[i].broken) return rings[i].R;
    return g.outer;
  }

  function keepBouncy() {
    const G = cfg.gravity;
    const top = innermostRadius() - g.pad;
    const target = G * top * (2 * g.reach - 1) + 0.5 * TOP_SPEED * TOP_SPEED;
    const U = -G * ball.y;
    const E = 0.5 * (ball.vx * ball.vx + ball.vy * ball.vy) + U;
    if (E >= target) return;
    const v2 = 2 * (target - U);
    const sp = Math.hypot(ball.vx, ball.vy) || 1;
    const k = Math.sqrt(Math.max(v2, 0)) / sp;
    ball.vx *= k;
    ball.vy *= k;
  }

  function spawnBurst(ring) {
    const spread = Math.max(1, g.view / 150);
    for (let n = 0; n < opts.burst; n++) {
      let a;
      do { a = Math.random() * TAU; } while (angDiff(a, ring.rot) < ring.half);
      const i = pHead;
      pHead = (pHead + 1) % P;
      const cx = Math.cos(a), cy = Math.sin(a);
      const out = (Math.random() - 0.5) * 70 * spread;
      const tan = (Math.random() - 0.5) * 40 * spread;
      pX[i] = cx * ring.R; pY[i] = cy * ring.R;
      pVX[i] = cx * out - cy * tan + ball.vx * 0.1;
      pVY[i] = cy * out + cx * tan + ball.vy * 0.1;
      pMax[i] = pLife[i] = 0.7 + Math.random() * 0.9;
      pCol[i] = ring.idx;
    }
  }

  const noteOf = (ring) => (ring.idx / Math.max(1, g.full - 1)) * (NOTES - 1);

  function collideBall() {
    const d = Math.hypot(ball.x, ball.y);
    if (d < 1e-6) return;
    const pd = Math.hypot(ball.px, ball.py);
    const nx = ball.x / d, ny = ball.y / d;
    const theta = Math.atan2(ball.y, ball.x);

    const lo = Math.max(0, Math.ceil((d - g.pad - g.R0) / g.spacing));
    const hi = Math.min(g.count - 1, Math.floor((d + g.pad - g.R0) / g.spacing));

    for (let i = lo; i <= hi; i++) {
      const ring = rings[i];
      if (ring.broken) continue;
      if (Math.abs(d - ring.R) >= g.pad) continue;

      if (angDiff(theta, ring.rot) + cfg.ballRadius / ring.R <= ring.half) {
        ring.broken = true;
        if (cfg.spinDir === 2) {
          state.dirTarget = -state.dirTarget;
          if (!cfg.smoothFlip) state.dir = state.dirTarget;
        }
        if (cfg.particles) spawnBurst(ring);
        sound(noteOf(ring), 0.22, 0.9);
        continue;
      }

      const side = pd - ring.R >= 0 ? 1 : -1;
      const r = ring.R + side * (g.pad + 0.001);
      ball.x = nx * r;
      ball.y = ny * r;

      const vr = ball.vx * nx + ball.vy * ny;
      if (vr * side < 0) {
        const k = (1 + g.restitution) * vr;
        ball.vx -= k * nx;
        ball.vy -= k * ny;

        const j = (Math.random() - 0.5) * 2 * JITTER;
        const c = Math.cos(j), s = Math.sin(j);
        const vx = ball.vx * c - ball.vy * s;
        ball.vy = ball.vx * s + ball.vy * c;
        ball.vx = vx;

        keepBouncy();
        sound(noteOf(ring), 0.08, 0.35);
      }
    }
  }

  function stepOnce(dt) {
    if (g.rotates) {
      if (cfg.smoothFlip) state.dir += (state.dirTarget - state.dir) * Math.min(1, FLIP_EASE * dt);
      for (let i = 0; i < rings.length; i++) rings[i].rot += rings[i].speed * state.dir * dt;
    }
    if (!g.hasBall) return;

    ball.px = ball.x;
    ball.py = ball.y;
    ball.vy += cfg.gravity * dt;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > MAX_SPEED) { ball.vx *= MAX_SPEED / sp; ball.vy *= MAX_SPEED / sp; }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    collideBall();
  }

  function recordTrail(dt) {
    if (!g.hasBall) return;
    simT += dt;
    if (!cfg.trail) { trail.length = 0; return; }
    const lastP = trail[trail.length - 1];
    if (!lastP || Math.hypot(ball.x - lastP.x, ball.y - lastP.y) > 0.4) trail.push({ x: ball.x, y: ball.y, t: simT });
    const len = Math.max(0.05, cfg.trailLength);
    let k = 0;
    while (k < trail.length && simT - trail[k].t > len) k++;
    if (k) trail.splice(0, k);
  }

  function step(dt) {
    const sp = g.hasBall ? Math.hypot(ball.vx, ball.vy) : 0;
    const n = Math.min(64, Math.max(1, Math.ceil((sp * dt) / (g.pad * 0.6))));
    const h = dt / n;
    for (let k = 0; k < n; k++) stepOnce(h);
    recordTrail(dt);
  }

  function updateParticles(dt) {
    const drag = Math.exp(-1.8 * dt);
    for (let i = 0; i < P; i++) {
      if (pLife[i] <= 0) continue;
      pLife[i] -= dt;
      pVX[i] *= drag;
      pVY[i] = pVY[i] * drag + cfg.gravity * 0.3 * dt;
      pX[i] += pVX[i] * dt;
      pY[i] += pVY[i] * dt;
    }
  }

  function updateLifecycle(dt) {
    if (g.scene !== 'play') {
      if (state.alpha < 1) state.alpha = Math.min(1, state.alpha + dt * 1.5);
      if (g.scene === 'flip') {
        state.flipT += dt;
        if (state.flipT >= 2) {
          state.flipT = 0;
          if (cfg.spinDir === 2) {
            state.dirTarget = -state.dirTarget;
            if (!cfg.smoothFlip) state.dir = state.dirTarget;
          }
        }
      }
      return;
    }
    if (state.ending) {
      state.alpha -= dt * 1.2;
      if (state.alpha <= 0) { cycleEnded = true; build(); }
      return;
    }
    if (state.alpha < 1) state.alpha = Math.min(1, state.alpha + dt * 1.5);

    if (rings[rings.length - 1].broken) {
      state.hold += dt;
      if (state.hold > HOLD_AFTER) state.ending = true;
    }
  }

  function drawTrail(scale) {
    if (!cfg.trail || !g.hasBall || !trail.length) return;
    const W = canvas.width, H = canvas.height;
    if (!trailCanvas) { trailCanvas = document.createElement('canvas'); tctx = trailCanvas.getContext('2d'); }
    if (trailCanvas.width !== W || trailCanvas.height !== H) { trailCanvas.width = W; trailCanvas.height = H; trailBox = null; }
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    if (trailBox) tctx.clearRect(trailBox.x, trailBox.y, trailBox.w, trailBox.h);
    tctx.setTransform(scale, 0, 0, scale, W / 2, H / 2);
    tctx.lineCap = 'round';
    tctx.lineJoin = 'round';

    const len = Math.max(0.05, cfg.trailLength);
    const full = 2 * Math.max(cfg.ballRadius, 2.5 / scale);
    const n = trail.length;
    const stride = Math.max(1, Math.ceil(n / 360));
    let prev = trail[0];
    let x0 = prev.x * scale + W / 2, x1 = x0, y0 = prev.y * scale + H / 2, y1 = y0;
    const seg = (p) => {
      const sx = p.x * scale + W / 2, sy = p.y * scale + H / 2;
      if (sx < x0) x0 = sx; else if (sx > x1) x1 = sx;
      if (sy < y0) y0 = sy; else if (sy > y1) y1 = sy;
      const a = Math.min(1, Math.max(0, (simT - (prev.t + p.t) / 2) / len));
      const w = full * (1 - a);
      if (w > 0.2 / scale) {
        const c = colorAtStops(g.tStops, g.tSmooth, a);
        tctx.strokeStyle = `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
        tctx.lineWidth = w;
        tctx.beginPath();
        tctx.moveTo(prev.x, prev.y);
        tctx.lineTo(p.x, p.y);
        tctx.stroke();
      }
      prev = p;
    };
    for (let i = stride; i < n; i += stride) seg(trail[i]);
    seg({ x: ball.x, y: ball.y, t: simT });

    const pad = full * scale / 2 + 3;
    const bx = Math.max(0, Math.floor(x0 - pad)), by = Math.max(0, Math.floor(y0 - pad));
    const bw = Math.min(W, Math.ceil(x1 + pad)) - bx, bh = Math.min(H, Math.ceil(y1 + pad)) - by;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (bw > 0 && bh > 0) {
      trailBox = { x: bx, y: by, w: bw, h: bh };
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = state.alpha * cfg.trailOpacity;
      ctx.drawImage(trailCanvas, bx, by, bw, bh, bx, by, bw, bh);
    }
    ctx.setTransform(scale, 0, 0, scale, W / 2, H / 2);
    ctx.globalAlpha = state.alpha;
  }

  function render() {
    const scale = (Math.min(canvas.width, canvas.height) / (2 * g.view)) * zoom;
    const minW = 1.5 / scale;
    const lw = Math.max(cfg.lineWidth, minW);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height / 2);

    ctx.lineCap = 'butt';
    ctx.globalAlpha = state.alpha;

    if (cfg.glowRing && cfg.glowRingOpacity > 0) {
      const want = lw * cfg.glowRingSize;
      const gw = g.count < 2 ? want : Math.min(want, g.spacing);
      if (gw > lw * 1.2) {
        const passes = cfg.glowRingMode === 1 ? (opts.lite ? 4 : 6) : 1;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = state.alpha * (cfg.glowRingOpacity / passes);
        for (let k = 0; k < passes; k++) {
          ctx.lineWidth = lw + ((gw - lw) * (passes - k)) / passes;
          for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (ring.broken) continue;
            ctx.beginPath();
            ctx.arc(0, 0, ring.R, ring.rot + ring.half, ring.rot + TAU - ring.half);
            ctx.strokeStyle = cfg.glowRingCustom ? cfg.glowRingColor : ring.core;
            ctx.stroke();
          }
        }
        ctx.globalAlpha = state.alpha;
      }
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = lw;
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      if (ring.broken) continue;
      ctx.beginPath();
      ctx.arc(0, 0, ring.R, ring.rot + ring.half, ring.rot + TAU - ring.half);
      ctx.strokeStyle = ring.core;
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'lighter';
    const ps = Math.max(1.6, 1.6 / scale);
    for (let i = 0; i < P; i++) {
      if (pLife[i] <= 0) continue;
      const rg = rings[pCol[i]];
      if (!rg) continue;
      ctx.globalAlpha = state.alpha * (pLife[i] / pMax[i]) * 0.9;
      ctx.fillStyle = rg.core;
      ctx.fillRect(pX[i] - ps / 2, pY[i] - ps / 2, ps, ps);
    }

    if (!g.hasBall) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; return; }

    drawTrail(scale);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = state.alpha;
    const br = Math.max(cfg.ballRadius, 2.5 / scale);
    if (cfg.glowBall && cfg.glowBallOpacity > 0) {
      const gr = br * cfg.glowBallSize, c = g.gbRgb, op = cfg.glowBallOpacity;
      ctx.globalCompositeOperation = 'lighter';
      if (cfg.glowBallMode === 1) {
        const grad = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, gr);
        grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${op})`);
        grad.addColorStop(0.4, `rgba(${c[0]},${c[1]},${c[2]},${op * 0.4})`);
        grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${op})`;
      }
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, gr, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = cfg.ballColor;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, br, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    if (!running) return;
    const raw = (now - last) / 1000;
    const dt = Math.min(raw, 0.05);
    last = now;
    if (opts.adaptive && raw < 0.25) {
      if (raw > 0.04) slowFrames++; else if (slowFrames > 0) slowFrames--;
      if (slowFrames > 40 && curDpr() > 1) { dprCap = Math.max(1, curDpr() - 0.5); slowFrames = 0; resize(); }
    }
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
    }
    updateParticles(dt);
    updateLifecycle(dt);
    zoom += (zoomTarget - zoom) * (1 - Math.exp(-14 * dt));
    render();
    raf = requestAnimationFrame(frame);
  }

  function advance(dt) {
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      clock += STEP;
      acc -= STEP;
    }
    updateParticles(dt);
    updateLifecycle(dt);
    zoom += (zoomTarget - zoom) * (1 - Math.exp(-14 * dt));
    if (cycleEnded) return false;
    render();
    return true;
  }

  function progress() {
    let done = 0;
    for (let i = 0; i < rings.length; i++) if (rings[i].broken) done++;
    return { done, total: rings.length };
  }

  function beginCapture(events) { sink = events; sinkLast = -1; clock = 0; acc = 0; cycleEnded = false; }
  function endCapture() { sink = null; }

  function resize() {
    const [w, h] = opts.getSize();
    let dpr = opts.dpr || curDpr();
    const MAX_PIXELS = 12e6;
    const px = w * h * dpr * dpr;
    if (px > MAX_PIXELS) dpr *= Math.sqrt(MAX_PIXELS / px);
    const cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function zoomBy(factor, instant) {
    zoomTarget = Math.min(10, Math.max(0.2, zoomTarget * factor));
    if (instant) zoom = zoomTarget;
  }

  function resetZoom() {
    zoom = zoomTarget = 1;
  }

  return { configure, update, resize, start, stop, zoomBy, resetZoom, advance, beginCapture, endCapture, progress };
}

const launchColors = randomColors();
const settings = {
  ...DEFAULTS,
  ...launchColors,
  gradStops: [{ pos: 0, color: launchColors.ringColor }, { pos: 1, color: launchColors.ringColor2 }],
  gradStopsEdited: false,
  trailColor: launchColors.ballColor,
  trailColor2: launchColors.ringColor,
  trailGradStops: [{ pos: 0, color: launchColors.ballColor }, { pos: 1, color: launchColors.ringColor }],
  trailGradStopsEdited: false,
};
const INITIAL = JSON.parse(JSON.stringify(settings));

const mainCanvas = document.querySelector('canvas');
document.documentElement.style.background = '#000';
Object.assign(document.body.style, { margin: '0', background: '#000', overflow: 'hidden', overscrollBehavior: 'none' });
Object.assign(mainCanvas.style, {
  position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', display: 'block',
  touchAction: 'none',
  webkitUserSelect: 'none', userSelect: 'none', webkitTouchCallout: 'none',
});

const mainSim = createSim(mainCanvas, {
  getSize: () => [mainCanvas.clientWidth || window.innerWidth, mainCanvas.clientHeight || window.innerHeight],
  particles: COARSE ? 700 : 1200, burst: 70, audio: true, adaptive: true, lite: COARSE,
});

const PREVIEW_SIZE = window.innerWidth < 520 ? 132 : 180;
let pvSize = PREVIEW_SIZE;
const previewCanvas = document.createElement('canvas');
previewCanvas.className = 'pv-canvas';
const preview = createSim(previewCanvas, {
  getSize: () => [previewCanvas.clientWidth || pvSize, previewCanvas.clientHeight || pvSize],
  particles: 250, burst: 24, audio: false, lite: COARSE,
});
preview.resize();

function fmtBalance(v) {
  if (Math.abs(v) < 0.025) return 'одинаково';
  return (v < 0 ? 'край ×' : 'центр ×') + Math.pow(BALANCE_K, 2 * Math.abs(v)).toFixed(1);
}

const FIELDS = [
  { section: 'Шарик' },
  { key: 'ballRadius', label: 'Размер шарика', type: 'range', min: 1, max: 50, step: 0.5, fmt: (v) => v.toFixed(1) },
  { key: 'ballColor', label: 'Цвет шарика', type: 'color' },
  { key: 'gravity', label: 'Гравитация', type: 'range', min: 0, max: 8000, step: 50, fmt: (v) => v.toFixed(0) },
  { key: 'bounce', label: 'Прыгучесть', pct: true, type: 'range', min: 0, max: 2.5, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },

  { section: 'След за шариком' },
  { key: 'trail', label: 'Показывать след', type: 'toggle' },
  { key: 'trailOpacity', label: 'Яркость следа', pct: true, type: 'range', min: 0.05, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', visible: (s) => s.trail },
  { key: 'trailLength', label: 'Длина следа', type: 'range', min: 0.1, max: 5, step: 0.1, fmt: (v) => v.toFixed(1) + ' с', visible: (s) => s.trail },
  { key: 'trailPaint', label: 'Цвет следа', type: 'paint', visible: (s) => s.trail,
    p: { grad: 'trailGradient', adv: 'trailAdvancedGradient', c1: 'trailColor', c2: 'trailColor2', stops: 'trailGradStops', smooth: 'trailGradSmooth', edited: 'trailGradStopsEdited', ballStart: 'trailBallStart' } },

  { section: 'Кольца' },
  { key: 'ringCount', label: 'Количество колец', type: 'range', min: 1, max: 25, step: 1, fmt: (v) => v.toFixed(0) },
  { key: 'ringSpacing', label: 'Расстояние между кольцами', type: 'range', min: 0.5, max: 150, step: 0.5, fmt: (v) => v.toFixed(1) },
  { key: 'lineWidth', label: 'Толщина колец', type: 'range', min: 0.5, max: 30, step: 0.5, fmt: (v) => v.toFixed(1) },
  { key: 'ringPaint', label: 'Цвет колец', type: 'paint',
    p: { grad: 'gradient', adv: 'advancedGradient', c1: 'ringColor', c2: 'ringColor2', stops: 'gradStops', smooth: 'gradSmooth', edited: 'gradStopsEdited' } },

  { section: 'Отверстия' },
  { key: 'gapSize', label: 'Размер отверстий', type: 'range', min: 2, max: 1500, step: 1, fmt: (v) => v.toFixed(0) },
  { key: 'gapBalance', label: 'Отверстия: центр и край', type: 'range', min: -1.5, max: 1.5, step: 0.05, fmt: fmtBalance },

  { section: 'Вращение' },
  { key: 'spin', label: 'Скорость вращения', type: 'range', min: 0, max: 15, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'spinBalance', label: 'Скорость: центр и край', type: 'range', min: -1.5, max: 1.5, step: 0.05, fmt: fmtBalance },
  { key: 'spinDir', label: 'Направление вращения', type: 'segment', options: ['По часовой', 'Против часовой', 'Чередуется'] },
  { key: 'smoothFlip', label: 'Плавная смена направления', type: 'toggle', visible: (s) => s.spinDir === 2 },

  { section: 'Эффекты' },
  { key: 'glow', label: 'Свечение', type: 'glow' },
  { key: 'particles', label: 'Осколки при разрушении колец', type: 'toggle' },
  { key: 'sound', label: 'Звук при столкновениях', type: 'toggle', noRandomAll: true },
];

const INFO = {
  ballRadius: 'Чем крупнее шарик, тем труднее ему пролезть в отверстия: кольцо ломается, только если шарик целиком помещается в отверстие. Слишком большой шарик может вообще не пройти.',
  ballColor: 'Лучше выбрать цвет, заметно отличающийся от цвета колец, — тогда шарик не сливается с ними.',
  gravity: 'Сила, которая тянет шарик вниз.\nЧем она больше, тем быстрее шарик падает и тем резче отскакивает. При нуле шарик не падает, а летает по инерции. Гравитация влияет и на ритм ударов, а значит, и на звук.',
  bounce: 'Насколько сильно шарик отскакивает от колец.\n100% — упругий удар без потерь. Меньше — с каждым ударом шарик теряет скорость. Больше — с каждым ударом он набирает скорость, и движение становится всё более безумным.',
  trail: 'За шариком остаётся тающая лента — след его движения.\nПосле включения появятся настройки яркости, длины и цвета следа.',
  trailOpacity: 'Насколько заметен след.\nВлево — почти не виден, вправо — яркий и плотный. Настройка действует на весь след сразу, поэтому там, где след пересекает сам себя, цвет не становится гуще.',
  trailLength: 'Как долго след остаётся виден: через столько секунд каждая его точка полностью исчезает.\nКороткий след — небольшой хвостик за шариком, длинный — вся траектория за последние секунды.',
  trailPaint: 'Цвет следа.\n«Один цвет» — след одного цвета по всей длине. «Градиент» — плавный переход между двумя цветами от шарика к концу следа. «Свой градиент» — градиент из любого числа точек: их можно добавлять, двигать и удалять. Выключатель «Плавный градиент» убирает плавность: цвета сменяют друг друга ступенями.\nВыключатель «Начало следа — цвет шарика» делает первую точку следа такого же цвета, как шарик, даже если вы потом измените цвет шарика. Если выбрать для этой точки другой цвет, выключатель отключится сам. На длину и яркость следа он не влияет.',
  ringCount: 'Сколько колец вложено друг в друга.\nШарик должен пробить их все по очереди, поэтому чем больше колец, тем дольше длится сцена.',
  ringSpacing: 'При малом расстоянии кольца плотно прилегают друг к другу, и шарик почти сразу упирается в следующее. При большом между кольцами много места для полёта.',
  lineWidth: 'Толстые кольца выглядят массивнее и сильнее бросаются в глаза, тонкие — изящнее и легче.',
  ringPaint: 'Цвет колец.\n«Один цвет» — все кольца одного цвета. «Градиент» — плавный переход между двумя цветами от центра к краю. «Свой градиент» — градиент из любого числа точек: их можно добавлять, двигать и удалять. Выключатель «Плавный градиент» убирает плавность: цвета сменяют друг друга ступенями.',
  gapSize: 'Размер отверстий в кольцах — длина дуги у среднего кольца.\nЧерез большие отверстия шарик проходит легко, а в маленькие нужно попасть точно, поэтому сцена длится дольше.',
  gapBalance: 'Как размер отверстий меняется от центра к краю.\nВлево — у центра отверстия меньше, у края больше (подпись «край ×2» значит, что у края они примерно вдвое больше). Вправо — наоборот, больше у центра. По центру — у всех колец отверстия одинаковые.',
  spin: 'Скорость вращения среднего кольца.\nЧем она выше, тем быстрее убегают отверстия и тем труднее шарику в них попасть. При нуле кольца стоят на месте.',
  spinBalance: 'Как скорость вращения меняется от центра к краю.\nВлево — внешние кольца крутятся быстрее внутренних (подпись «край ×2» значит, что примерно вдвое быстрее). Вправо — наоборот. По центру — все кольца вращаются с одной скоростью.',
  spinDir: 'В какую сторону вращаются кольца.\n«По часовой» и «Против часовой» — кольца всегда крутятся в выбранную сторону. «Чередуется» — каждый раз, когда шарик разрушает кольцо, направление меняется на противоположное.',
  smoothFlip: 'Как кольца меняют направление.\nВыключено — мгновенно, рывком. Включено — кольца плавно тормозят и разгоняются в обратную сторону. Доступно, когда выбрано «Чередуется».',
  glow: 'Мягкое свечение вокруг колец и шарика. Для колец и для шарика оно настраивается отдельно — на вкладках «Кольца» и «Шарик».\n«Простое» — один полупрозрачный контур. «Плавное» — свечение, которое постепенно тает к краям. «Яркость» задаёт силу свечения, «Размер» — как далеко оно расходится. У колец оно не шире расстояния между ними, поэтому у плотно сжатых колец свечения нет. По умолчанию цвет свечения такой же, как у колец и шарика, но можно выбрать свой.',
  particles: 'В момент пробития кольцо рассыпается на разлетающиеся осколки.\nЕсли выключить, кольцо просто исчезнет — так устройству работать легче.',
  sound: 'Удары шарика и разрушение колец звучат нотами одной гаммы, поэтому звук получается мелодичным.\nКнопка «Случайные настройки» этот переключатель не меняет.',
};

const SCENES = {
  ballRadius: 'ball', ballColor: 'ball', gravity: 'ball', bounce: 'ball',
  trail: 'ball', trailOpacity: 'ball', trailLength: 'ball', trailPaint: 'ball', glow: 'ball',
  ringCount: 'static', ringSpacing: 'static', lineWidth: 'static', ringPaint: 'static',
  gapSize: 'static', gapBalance: 'static',
  spin: 'spin', spinBalance: 'spin', spinDir: 'spin', smoothFlip: 'flip',
};

const FIXED_KEYS = new Set(['ringSpacing', 'lineWidth']);

const ROTATION_KEYS = new Set(['spin', 'spinBalance', 'spinDir', 'smoothFlip']);

const CSS = `
:root{--bg:#0e0f13;--surface:#16181e;--surface2:#1e2128;--line:#2b2f38;--line2:#3d424e;--text:#e8e9ed;--muted:#8d92a0;--accent:#8aa2ff;--danger:#ff8c8c;--pv-space:212px}
.asmr-menu{position:fixed;inset:0;z-index:10;overflow-y:auto;display:flex;justify-content:center;align-items:flex-start;
  overscroll-behavior:contain;box-sizing:border-box;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--gutter:12px;
  padding:max(24px,env(safe-area-inset-top)) calc(var(--gutter) + env(safe-area-inset-right)) max(32px,env(safe-area-inset-bottom)) calc(var(--gutter) + env(safe-area-inset-left))}
.asmr-panel{width:min(520px,100%);min-width:0;margin:auto 0}
.asmr-cols{display:flex;gap:12px;align-items:flex-start}
.asmr-col{flex:1 1 0;min-width:0;display:flex;flex-direction:column}
@media (min-width:820px){
.asmr-panel{width:min(1080px,100%)}
}
@media (min-width:1000px){
.asmr-menu{padding-right:calc(var(--pv-space) + env(safe-area-inset-right))}
}
@media (min-width:1500px){
.asmr-panel{width:min(1500px,100%)}
}
.asmr-panel h1{margin:0 0 4px;font-size:21px;font-weight:600;text-align:center}
.asmr-panel p{margin:0 0 14px;text-align:center;font-size:13px;color:var(--muted)}
.asmr-top{display:flex;gap:8px;margin:0 0 6px}
.asmr-top button{flex:1;padding:12px 8px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--text);
  font:500 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}
.asmr-menu .sec{margin:22px 4px 8px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.asmr-menu .row{border:1px solid var(--line);border-radius:14px;background:var(--surface);padding:4px 12px 10px;margin:0 0 8px}
.asmr-menu .row.active{border-color:var(--accent)}
.asmr-menu .card{border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:6px 14px 8px;margin:0 0 12px;min-width:0}
.asmr-panel>.card{align-self:start}
.card-title{margin:10px 0 4px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.asmr-menu .card .row{border:0;border-radius:0;background:none;box-shadow:none;margin:0;padding:2px 0 10px}
.asmr-menu .card .row+.row{border-top:1px solid var(--line);padding-top:6px}
.asmr-menu .card .row.active{background:rgba(138,162,255,.07);border-radius:10px;margin:0 -8px;padding-left:8px;padding-right:8px;border-top-color:transparent;box-shadow:none}
.row .head{display:flex;align-items:center;gap:8px;min-height:38px}
.row .head label{flex:1;min-width:0;font-size:14px;line-height:1.3}
.row .acts{display:flex;flex:none;margin-right:-6px}
.row .acts button{width:34px;height:34px;padding:0;display:grid;place-items:center;border:0;border-radius:9px;background:none;color:var(--muted);cursor:pointer}
.row .acts button:active{background:var(--surface2);color:var(--text)}
.row .srow{display:flex;align-items:center;gap:10px}
.row .val{flex:none;box-sizing:border-box;width:96px;height:40px;padding:0 10px;text-align:right;font:500 16px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  color:var(--text);background:var(--bg);border:1px solid var(--line2);border-radius:10px;font-variant-numeric:tabular-nums;outline:none}
.row .val:focus{border-color:var(--accent)}
input[type=color]::-webkit-color-swatch-wrapper{padding:0}
input[type=color]::-webkit-color-swatch{border:0;border-radius:7px}
input[type=color]::-moz-color-swatch{border:0;border-radius:7px}
input.switch{appearance:none;-webkit-appearance:none;flex:none;width:56px;height:32px;margin:0;border:0;border-radius:16px;background:var(--line2);position:relative;cursor:pointer;transition:background .15s}
input.switch::before{content:"";position:absolute;inset:-8px -4px}
input.switch::after{content:"";position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:50%;background:var(--text);transition:transform .15s}
input.switch:checked{background:var(--accent)}
input.switch:checked::after{transform:translateX(24px)}
.sl{position:relative;flex:1;min-width:0;height:44px;touch-action:pan-y;cursor:pointer;outline:none;-webkit-user-select:none;user-select:none}
.sl-in{position:absolute;left:12px;right:12px;top:0;bottom:0}
.sl-line,.sl-fill{position:absolute;left:0;top:50%;height:4px;margin-top:-2px;border-radius:2px}
.sl-line{right:0;background:var(--line2)}
.sl-fill{width:0;background:var(--accent)}
.sl-thumb{position:absolute;top:50%;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:var(--text)}
.sl.drag .sl-thumb{background:var(--accent)}
.sl:focus-visible .sl-thumb{outline:2px solid var(--accent);outline-offset:2px}
.paint{display:flex;flex-direction:column;gap:12px;padding-top:2px}
.glow{display:flex;flex-direction:column;gap:10px;padding-top:2px}
.glow-t{display:flex;flex-direction:column;gap:6px}
.glow-body{display:flex;flex-direction:column;gap:8px}
.glow-line{display:flex;align-items:center;gap:10px;min-height:40px;font-size:14px}
.glow-line label,.glow-line>span{flex:1;min-width:0}
.glow-sh{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:var(--muted)}
.glow-val{font-variant-numeric:tabular-nums;color:var(--text)}
.seg{position:relative;display:grid;grid-template-columns:repeat(3,1fr);height:44px;border:1px solid var(--line);border-radius:12px;background:var(--bg);
  touch-action:pan-y;cursor:pointer;outline:none;-webkit-user-select:none;user-select:none}
.seg-thumb{position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/3);border-radius:9px;background:var(--accent);transition:transform .18s ease;pointer-events:none}
.seg span{position:relative;z-index:1;display:grid;place-items:center;padding:0 3px;text-align:center;line-height:1.15;font-size:13px;font-weight:500;color:var(--muted);pointer-events:none;transition:color .15s}
.seg span.on{color:#0e0f13}
.seg:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pcols{display:flex;align-items:center;gap:10px}
.pcols .cswatch.wide{flex:1;width:auto}
.pball{display:flex;align-items:center;gap:10px;min-height:34px;font-size:13px;color:var(--muted)}
.pball label{flex:1;min-width:0}
.pball input.switch{width:44px;height:26px;border-radius:13px}
.pball input.switch::after{top:3px;left:3px;width:20px;height:20px}
.pball input.switch:checked::after{transform:translateX(18px)}
.pball input.switch:active::after{width:25px}
.pball input.switch:checked:active::after{transform:translateX(13px)}
.pbar{flex:1;height:44px;border-radius:9px;border:1px solid var(--line2)}
.gbody{display:flex;flex-direction:column;gap:12px}
.gbar{height:36px;margin:0 22px;border-radius:18px;border:1px solid var(--line2)}
.gtrack{position:relative;height:56px;margin:0 22px}
.ghandle{position:absolute;top:10px;width:44px;height:44px;margin-left:-22px;padding:5px;box-sizing:border-box;border-radius:12px;
  border:2px solid var(--line2);background:var(--surface2);cursor:grab;touch-action:none}
.ghandle i{display:block;width:100%;height:100%;border-radius:6px}
.ghandle::before{content:"";position:absolute;top:-10px;left:50%;margin-left:-5px;border:5px solid transparent;border-bottom-color:var(--line2)}
.ghandle.sel{border-color:var(--accent);z-index:2}
.ghandle.sel::before{border-bottom-color:var(--accent)}
.ghandle:active{cursor:grabbing}
.ginfo{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted)}
.ginfo span{flex:1;min-width:0}
.gbtns{display:flex;gap:8px}
.gbtns button{flex:1;padding:11px 6px;border:1px solid var(--line2);border-radius:12px;background:var(--surface2);color:var(--text);
  font:500 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}
.gbtns button:disabled{opacity:.4;cursor:default}
.gsmooth{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--bg);font-size:13px}
.gsmooth label{flex:1;min-width:0}
.asmr-start{display:block;width:100%;margin-top:20px;padding:15px;border:0;border-radius:14px;font-size:16px;font-weight:600;
  color:var(--bg);background:var(--text);cursor:pointer;transition:transform .1s}
.asmr-start:active{transform:scale(.98)}
.asmr-start:disabled{opacity:.35;cursor:default}
.asmr-fast{display:block;width:100%;margin-top:10px;min-height:48px;padding:14px;border-radius:14px;border:1px solid var(--line2);
  background:var(--surface);color:var(--text);font:600 15px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;transition:transform .1s}
.asmr-fast:active{transform:scale(.98)}
.asmr-fast.busy{border-color:var(--danger);color:var(--danger)}
.asmr-fast:disabled{opacity:.6}
.asmr-status{min-height:18px;margin-top:10px;font-size:12px;line-height:1.5;text-align:center;color:var(--muted);font-variant-numeric:tabular-nums;white-space:pre-line}
.asmr-status.err{color:var(--danger)}
.asmr-pv{position:fixed;z-index:11;box-sizing:content-box;overflow:hidden;border-radius:14px;background:#000;border:1px solid var(--line2);
  box-shadow:0 10px 40px rgba(0,0,0,.55);-webkit-user-select:none;user-select:none}
.pv-head{display:flex;align-items:center;gap:6px;box-sizing:border-box;padding:0 4px 0 10px;background:var(--surface);color:var(--muted);
  font:500 12px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:grab;touch-action:none}
.asmr-pv.drag .pv-head{cursor:grabbing}
.pv-head svg{flex:none}
.pv-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pv-btn{flex:none;display:inline-flex;align-items:center;gap:6px;height:28px;min-width:28px;padding:0 7px;justify-content:center;border:0;border-radius:8px;
  background:none;color:var(--muted);font:500 12px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}
.pv-btn:active{background:var(--surface2);color:var(--text)}
.pv-body{position:relative;background:#000}
.pv-canvas{display:block;width:100%;height:100%}
.pv-resize{position:absolute;right:0;bottom:0;width:28px;height:28px;color:rgba(255,255,255,.5);cursor:nwse-resize;touch-action:none}
.pv-resize svg{position:absolute;right:4px;bottom:4px}
.asmr-pv.min .pv-body{display:none}
.asmr-pv.min{border-radius:12px}
@media (hover:hover){.pv-btn:hover{background:var(--surface2);color:var(--text)}}
@media (pointer:coarse){.pv-btn{height:34px;min-width:34px}.pv-resize{width:40px;height:40px}}
.asmr-back{position:fixed;z-index:20;top:max(12px,env(safe-area-inset-top));left:max(12px,env(safe-area-inset-left));display:none;min-height:44px;padding:10px 16px;
  border:1px solid var(--line2);border-radius:12px;background:var(--surface);color:var(--text);font:500 14px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;opacity:.85}
@media (hover:hover){
.asmr-top button:hover,.gbtns button:hover:not(:disabled),.asmr-fast:hover,.row .tools button:hover{background:var(--surface2)}
.row .acts button:hover{background:var(--surface2);color:var(--text)}
.asmr-start:hover{opacity:.9}
.asmr-back:hover{opacity:1}
}
html,body{-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}
canvas{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
button{touch-action:manipulation}
@media (pointer:coarse){
.row .acts button{width:44px;height:44px}
.asmr-top button{padding:14px 8px}
}
.asmr-warn{display:flex;gap:12px;align-items:flex-start;margin:0 0 14px;padding:12px 14px;border:1px solid rgba(255,196,87,.38);border-radius:14px;
  background:rgba(255,196,87,.08);text-align:left}
.asmr-warn svg{flex:none;margin-top:1px;color:#ffc457}
.asmr-warn b{display:block;margin-bottom:3px;font-size:13px;font-weight:600;color:#ffc457}
.asmr-warn span{display:block;font-size:12.5px;line-height:1.5;color:#d6d8df}
.asmr-warn summary{display:inline-block;margin-top:2px;padding:8px 0;font-size:12.5px;color:#ffc457;cursor:pointer}
.asmr-warn details span{margin-bottom:2px}
.row .acts .info-btn{color:var(--accent)}
.row button svg.go{animation:asmr-pop .45s ease}
.row button[data-a=dice] svg.go{animation-name:asmr-dice}
.row button[data-a=reset] svg.go{animation-name:asmr-undo}
.row .acts button[aria-expanded=true]{background:var(--surface2);color:var(--text)}
.row .tools{display:none;flex-wrap:wrap;gap:8px;margin-top:10px}
.row.tools-open .tools{display:flex}
.row .tools button{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border:1px solid var(--line2);border-radius:12px;
  background:var(--surface);color:var(--text);font:500 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}
.row .tools button:active{transform:scale(.97)}
.asmr-modal{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;
  background:rgba(4,5,9,.58);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);overscroll-behavior:contain;touch-action:none;
  opacity:0;visibility:hidden;pointer-events:none;transition:opacity .22s ease,visibility 0s linear .22s}
.asmr-modal.open{opacity:1;visibility:visible;pointer-events:auto;transition:opacity .22s ease,visibility 0s}
.asmr-modal .box{width:min(420px,100%);max-height:min(80vh,560px);max-height:min(80dvh,560px);overflow-y:auto;touch-action:pan-y;box-sizing:border-box;padding:18px 18px 20px;
  border:1px solid var(--line2);border-radius:18px;background:var(--surface);color:var(--text);box-shadow:0 20px 60px rgba(0,0,0,.5);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;transform:translateY(14px) scale(.96);transition:transform .28s cubic-bezier(.2,.9,.3,1.15)}
.asmr-modal.open .box{transform:none}
.asmr-modal .mh{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px}
.asmr-modal h2{flex:1;min-width:0;margin:0;font-size:17px;font-weight:600;line-height:1.3}
.asmr-modal .x{flex:none;width:36px;height:36px;margin:-6px -8px 0 0;display:grid;place-items:center;border:0;border-radius:10px;background:none;
  color:var(--muted);cursor:pointer;transition:background .15s,color .15s,transform .12s}
.asmr-modal .x:hover{background:var(--surface2);color:var(--text)}
.asmr-modal .x:active{transform:scale(.9)}
.asmr-modal .mb{font-size:14px;line-height:1.6;color:#c9ccd6;white-space:pre-line}
.asmr-panel>.asmr-warn{animation:asmr-rise .4s ease both}
.asmr-panel.intro .asmr-col>.card{animation:asmr-rise .4s ease both;animation-delay:calc(var(--i,0)*70ms)}
.asmr-menu .row{transition:border-color .2s ease,box-shadow .25s ease}
.asmr-menu .row.active{box-shadow:0 0 0 3px rgba(138,162,255,.12)}
.paint>*:not(.seg){animation:asmr-fade .28s ease}
.asmr-menu.fade{animation:asmr-fade .35s ease}
.asmr-pv{animation:asmr-pop-in .22s ease}
.asmr-back{animation:asmr-fade .3s ease}
.asmr-hint{position:fixed;z-index:15;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translateX(-50%);max-width:calc(100% - 32px);box-sizing:border-box;
  padding:10px 18px;border-radius:999px;background:rgba(22,24,30,.82);border:1px solid var(--line2);color:var(--text);text-align:center;
  font:500 14px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .4s ease,visibility 0s linear .4s}
.asmr-hint.show{opacity:1;visibility:visible;transition:opacity .4s ease,visibility 0s}
.row .acts button{transition:background .15s,color .15s,transform .12s}
.row .acts button:active{transform:scale(.9)}
.asmr-top button,.gbtns button,.asmr-fast{transition:background .15s,transform .1s}
.asmr-top button:active,.gbtns button:active:not(:disabled){transform:scale(.97)}
input.switch:active::after{width:31px}
input.switch:checked:active::after{transform:translateX(19px)}
@keyframes asmr-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes asmr-fade{from{opacity:0}to{opacity:1}}
@keyframes asmr-pop-in{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}
@keyframes asmr-pop{0%{transform:scale(1)}40%{transform:scale(1.3)}100%{transform:scale(1)}}
@keyframes asmr-dice{0%{transform:rotate(0) scale(1)}40%{transform:rotate(180deg) scale(1.2)}100%{transform:rotate(360deg) scale(1)}}
@keyframes asmr-undo{to{transform:rotate(-360deg)}}
@media (prefers-reduced-motion:reduce){
.asmr-menu,.asmr-menu *,.asmr-modal,.asmr-modal *,.asmr-pv,.asmr-back,.asmr-hint{animation:none!important;transition:none!important}
}
`;
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));

const el = (tag, cls, props) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (props) Object.assign(e, props);
  if (tag === 'input') e.setAttribute('autocomplete', 'off');
  return e;
};

const menu = el('div', 'asmr-menu');
const panel = el('div', 'asmr-panel');
panel.innerHTML = '<h1>ASMR Physics</h1><p>Настройте шарик и кольца, затем запустите сцену</p>';

const warn = el('div', 'asmr-warn');
warn.setAttribute('role', 'note');
warn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
  + '<div><b>Предупреждение: яркие вспышки</b>'
  + '<span>Резкие вспышки и перепады яркости могут вызвать приступ у людей с фоточувствительной эпилепсией.</span>'
  + '<details><summary>Подробнее</summary>'
  + '<span>Резкие смены яркости и вспышки есть и в превью, и в самой сцене — это часть задумки, отключить их нельзя. '
  + 'Если вы склонны к таким приступам, не открывайте превью и не запускайте сцену. '
  + 'Если почувствовали себя плохо, сразу прекратите просмотр.</span></details></div>';
panel.appendChild(warn);
menu.appendChild(panel);

let activeRow = null;
let previewOn = false;
let pvSig = '';

const PV_HEAD = COARSE ? 40 : 34;
const PV_MIN_SIZE = 120;
const PV_STRIP_W = 168;
const PV_KEY = 'asmr-pv-v1';
let pvX = 0, pvY = 0, pvMin = false;

const pvWrap = el('div', 'asmr-pv');
const pvHead = el('div', 'pv-head');
pvHead.style.height = PV_HEAD + 'px';
pvHead.title = 'Перетащите, чтобы передвинуть. Двойной клик — свернуть';
const pvBody = el('div', 'pv-body');
const pvTitle = el('span', 'pv-title', { textContent: 'Превью' });
const pvMinBtn = el('button', 'pv-btn', { type: 'button' });
const pvGrip = el('div', 'pv-resize');
pvGrip.title = 'Потяните, чтобы изменить размер';
pvGrip.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M14 5 5 14M14 10l-4 4"/></svg>';
const PV_ICON_GRIP = '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1.2"/><circle cx="11" cy="4" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/><circle cx="5" cy="12" r="1.2"/><circle cx="11" cy="12" r="1.2"/></svg>';
const PV_ICON_MIN = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 8h10"/></svg>';
const PV_ICON_OPEN = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/></svg>';
pvHead.insertAdjacentHTML('afterbegin', PV_ICON_GRIP);
pvHead.append(pvTitle, pvMinBtn);
pvBody.append(previewCanvas, pvGrip);
pvWrap.append(pvHead, pvBody);

const pvClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pvMaxSize = () => Math.max(PV_MIN_SIZE, Math.min(window.innerWidth - 8, window.innerHeight - PV_HEAD - 8, 640));

function pvSave() {
  try { localStorage.setItem(PV_KEY, JSON.stringify({ x: pvX, y: pvY, s: pvSize, m: pvMin })); } catch (_) {}
}

function pvLayout() {
  pvSize = pvClamp(Math.round(pvSize), PV_MIN_SIZE, pvMaxSize());
  const w = pvMin ? PV_STRIP_W : pvSize;
  const h = pvMin ? PV_HEAD : PV_HEAD + pvSize;
  pvX = pvClamp(pvX, 0, Math.max(0, window.innerWidth - w - 2));
  pvY = pvClamp(pvY, 0, Math.max(0, window.innerHeight - h - 2));
  pvWrap.style.left = pvX + 'px';
  pvWrap.style.top = pvY + 'px';
  pvWrap.style.width = w + 'px';
  pvBody.style.height = pvSize + 'px';
}

let pvRaf = 0;
function pvQueueCanvasResize() {
  if (pvRaf) return;
  pvRaf = requestAnimationFrame(() => { pvRaf = 0; if (!pvMin) preview.resize(); });
}

function pvApplyRun() {
  const menuVisible = menu.style.display !== 'none';
  pvWrap.style.display = menuVisible ? 'block' : 'none';
  if (menuVisible && !pvMin) { preview.resize(); preview.start(); } else preview.stop();
}

function setPvMin(v) {
  pvMin = v;
  pvWrap.classList.toggle('min', v);
  pvMinBtn.setAttribute('aria-expanded', String(!v));
  pvMinBtn.setAttribute('aria-label', v ? 'Открыть превью' : 'Свернуть превью');
  pvMinBtn.title = v ? 'Открыть превью' : 'Свернуть превью';
  pvMinBtn.innerHTML = v ? PV_ICON_OPEN + '<span>Открыть</span>' : PV_ICON_MIN;
  pvLayout();
  pvApplyRun();
  pvSave();
}
pvMinBtn.addEventListener('click', () => setPvMin(!pvMin));
pvHead.addEventListener('dblclick', (e) => { if (!e.target.closest('button') && performance.now() - pvOpenedAt > 500) setPvMin(!pvMin); });

let pvDrag = null;
let pvOpenedAt = 0;
pvHead.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
  pvDrag = { id: e.pointerId, dx: e.clientX - pvX, dy: e.clientY - pvY, sx: e.clientX, sy: e.clientY, moved: false };
  try { pvHead.setPointerCapture(e.pointerId); } catch (_) {}
  pvWrap.classList.add('drag');
  e.preventDefault();
});
pvHead.addEventListener('pointermove', (e) => {
  if (!pvDrag || e.pointerId !== pvDrag.id) return;
  if (Math.hypot(e.clientX - pvDrag.sx, e.clientY - pvDrag.sy) > 4) pvDrag.moved = true;
  if (!pvDrag.moved) return;
  pvX = e.clientX - pvDrag.dx;
  pvY = e.clientY - pvDrag.dy;
  pvLayout();
});
const pvEndDrag = (e) => {
  if (!pvDrag || e.pointerId !== pvDrag.id) return;
  const d = pvDrag;
  pvDrag = null;
  pvWrap.classList.remove('drag');
  if (!d.moved && pvMin && e.type === 'pointerup') { pvOpenedAt = performance.now(); setPvMin(false); }
  else pvSave();
};
pvHead.addEventListener('pointerup', pvEndDrag);
pvHead.addEventListener('pointercancel', pvEndDrag);

let pvRs = null;
pvGrip.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pvRs = { id: e.pointerId, sx: e.clientX, sy: e.clientY, s0: pvSize };
  try { pvGrip.setPointerCapture(e.pointerId); } catch (_) {}
  pvWrap.classList.add('drag');
  e.preventDefault();
  e.stopPropagation();
});
pvGrip.addEventListener('pointermove', (e) => {
  if (!pvRs || e.pointerId !== pvRs.id) return;
  pvSize = pvRs.s0 + ((e.clientX - pvRs.sx) + (e.clientY - pvRs.sy)) / 2;
  pvLayout();
  pvQueueCanvasResize();
});
const pvEndResize = (e) => {
  if (!pvRs || e.pointerId !== pvRs.id) return;
  pvRs = null;
  pvWrap.classList.remove('drag');
  pvSave();
};
pvGrip.addEventListener('pointerup', pvEndResize);
pvGrip.addEventListener('pointercancel', pvEndResize);

(function pvInit() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PV_KEY) || 'null'); } catch (_) {}
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.s)) {
    pvX = saved.x; pvY = saved.y; pvSize = saved.s; pvMin = !!saved.m;
  } else {
    pvX = window.innerWidth - pvSize - 16;
    pvY = 16;
  }
  pvWrap.classList.toggle('min', pvMin);
  pvMinBtn.setAttribute('aria-expanded', String(!pvMin));
  pvMinBtn.setAttribute('aria-label', pvMin ? 'Открыть превью' : 'Свернуть превью');
  pvMinBtn.title = pvMin ? 'Открыть превью' : 'Свернуть превью';
  pvMinBtn.innerHTML = pvMin ? PV_ICON_OPEN + '<span>Открыть</span>' : PV_ICON_MIN;
  pvLayout();
})();

function syncPreview(key) {
  const scene = !key ? 'play' : key === 'spinDir' ? (settings.spinDir === 2 ? 'flip' : 'spin') : (SCENES[key] || 'play');
  const o = { mode: key && FIXED_KEYS.has(key) ? 'cut' : 'full', scene };
  if (!previewOn) {
    preview.configure(settings, o);
    previewOn = true;
  } else {
    preview.update(settings, o, !!key && ROTATION_KEYS.has(key));
  }
  pvSig = o.mode + ':' + scene;
}

function activate(row, key, changed) {
  if (activeRow !== row) {
    if (activeRow) activeRow.classList.remove('active');
    activeRow = row;
    row.classList.add('active');
    changed = true;
  }
  if (!changed) return;
  syncPreview(key);
}

function hidePreview(force) {
  if (activeRow) activeRow.classList.remove('active');
  activeRow = null;
  if (force || pvSig !== 'full:play') {
    preview.configure(settings, { mode: 'full', scene: 'play' });
    previewOn = true;
    pvSig = 'full:play';
  }
}

function randomStops(hue) {
  const n = 2 + Math.floor(Math.random() * 4);
  const pos = [0, 1];
  for (let i = 2; i < n; i++) pos.push(Math.round(Math.random() * 100) / 100);
  pos.sort((a, b) => a - b);
  return {
    stops: pos.map((p) => ({ pos: p, color: hue ? randomHueColor() : randomAnyColor() })),
    smooth: Math.random() < 0.7,
    edited: true,
  };
}

function randomValue(def, hue) {
  if (def.type === 'glow') {
    const o = {};
    GLOW_T.forEach((t) => {
      const k = (x) => 'glow' + t.k + x;
      o[k('')] = Math.random() < 0.75;
      o[k('Mode')] = Math.random() < 0.5 ? 0 : 1;
      o[k('Opacity')] = parseFloat((GLOW_OP.min + Math.floor(Math.random() * ((GLOW_OP.max - GLOW_OP.min) / GLOW_OP.step + 1)) * GLOW_OP.step).toFixed(4));
      o[k('Size')] = parseFloat((t.size.min + Math.floor(Math.random() * ((t.size.max - t.size.min) / t.size.step + 1)) * t.size.step).toFixed(4));
      o[k('Custom')] = Math.random() < 0.25;
      o[k('Color')] = hue ? randomHueColor() : randomAnyColor();
    });
    return o;
  }
  if (def.type === 'range') {
    const n = Math.floor((def.max - def.min) / def.step);
    return parseFloat((def.min + Math.floor(Math.random() * (n + 1)) * def.step).toFixed(4));
  }
  if (def.type === 'toggle') return Math.random() < 0.5;
  if (def.type === 'segment') return Math.floor(Math.random() * def.options.length);
  if (def.type === 'color') return hue ? randomHueColor() : randomAnyColor();
  if (def.type === 'paint') {
    const st = randomStops(hue);
    const ends = [...st.stops].sort((a, b) => a.pos - b.pos);
    return { mode: Math.floor(Math.random() * 3), c1: ends[0].color, c2: ends[ends.length - 1].color, stops: st.stops, smooth: st.smooth, edited: true, ballStart: false };
  }
  return randomStops(hue);
}

function initialValue(def) {
  if (def.type === 'glow') {
    const o = {};
    GLOW_KEYS.forEach((k) => { o[k] = INITIAL[k]; });
    return o;
  }
  if (def.type === 'paint') {
    const q = def.p;
    return {
      mode: !INITIAL[q.grad] ? 0 : !INITIAL[q.adv] ? 1 : 2, c1: INITIAL[q.c1], c2: INITIAL[q.c2],
      stops: JSON.parse(JSON.stringify(INITIAL[q.stops])), smooth: INITIAL[q.smooth], edited: false,
      ballStart: q.ballStart ? INITIAL[q.ballStart] : false,
    };
  }
  if (def.type === 'gradient') {
    return { stops: JSON.parse(JSON.stringify(INITIAL[def.key])), smooth: INITIAL[def.smoothKey], edited: false };
  }
  return INITIAL[def.key];
}

const CP_PALETTE = [
  '#ffffff', '#d4d7de', '#8d92a0', '#3a3d46', '#000000',
  '#ff4d4d', '#ff7a3d', '#ffb938', '#ffe14d', '#c6f04d',
  '#58e06a', '#2fd6a0', '#35d4e6', '#4da3ff', '#6a73ff',
  '#9a5bff', '#d65bff', '#ff5bb4', '#ff8fa3', '#8b5e3c',
];
const CP_RECENT_KEY = 'asmr-recent-colors-v1';
const CP_RECENT_MAX = 10;
let cpRecent = [];
try {
  const raw = JSON.parse(localStorage.getItem(CP_RECENT_KEY) || '[]');
  if (Array.isArray(raw)) cpRecent = raw.filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase()).slice(0, CP_RECENT_MAX);
} catch (_) {}

function cpPushRecent(hex) {
  hex = hex.toLowerCase();
  if (CP_PALETTE.includes(hex)) return;
  cpRecent = [hex, ...cpRecent.filter((c) => c !== hex)].slice(0, CP_RECENT_MAX);
  try { localStorage.setItem(CP_RECENT_KEY, JSON.stringify(cpRecent)); } catch (_) {}
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}
function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return rgbToHex(t.map((u) => (u + m) * 255));
}
function normHex(str) {
  let t = String(str).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map((ch) => ch + ch).join('');
  return /^[0-9a-f]{6}$/i.test(t) ? '#' + t.toLowerCase() : null;
}

document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
.cswatch{flex:none;width:56px;height:44px;padding:4px;box-sizing:border-box;border:1px solid var(--line2);border-radius:9px;background:var(--surface2);cursor:pointer}
.cswatch span{display:block;width:100%;height:100%;border-radius:6px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}
.cswatch[aria-expanded=true]{border-color:var(--accent)}
.asmr-modal.cp-overlay{z-index:60}
.asmr-modal .box.cpop{width:min(360px,100%);padding:14px 14px 12px;max-height:min(88vh,680px);max-height:min(88dvh,680px);outline:none;-webkit-user-select:none;user-select:none}
@media (pointer:coarse){.cp-grid button{height:40px}}
.cp-top{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.cp-cur{flex:none;width:30px;height:30px;border-radius:9px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
.cp-title{flex:1;min-width:0;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cp-x{flex:none;width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:9px;background:none;color:var(--muted);cursor:pointer}
.cp-x:active{background:var(--surface2);color:var(--text)}
.cp-lab{margin:8px 2px 5px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.cp-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}
.cp-grid button{height:34px;padding:0;border:2px solid transparent;border-radius:10px;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);transition:transform .12s ease}
.cp-grid button:active{transform:scale(.92)}
.cp-grid button.on{border-color:var(--accent)}
.cp-more{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:10px;min-height:42px;border:1px solid var(--line2);border-radius:12px;background:none;color:var(--text);font:500 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}
.cp-more:active{background:var(--surface2)}
.cp-more svg{transition:transform .3s ease}
.cp-more[aria-expanded=true] svg{transform:rotate(180deg)}
.cp-ext{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .32s ease,opacity .25s ease}
.cp-ext.open{grid-template-rows:1fr;opacity:1}
.cp-ext-in{overflow:hidden;min-height:0}
.cp-ext-pad{display:flex;flex-direction:column;gap:12px;padding:14px 2px 2px}
.cp-wheel{position:relative;align-self:center;width:176px;height:176px;border-radius:50%;touch-action:none;cursor:crosshair;
  background:radial-gradient(circle closest-side,#fff,rgba(255,255,255,0)),conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
.cp-wheel::after{content:"";position:absolute;inset:0;border-radius:50%;background:#000;opacity:var(--dark,0);pointer-events:none}
.cp-dot{position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:3px solid #fff;box-sizing:border-box;box-shadow:0 0 0 1px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.5);pointer-events:none;z-index:1}
.cp-sh{display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;color:var(--muted)}
.cp-sh b{font-weight:500;color:var(--text);font-variant-numeric:tabular-nums}
.cp-track{position:relative;height:22px;border-radius:11px;touch-action:none;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
.cp-track:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cp-thumb{position:absolute;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:3px solid #fff;box-sizing:border-box;box-shadow:0 0 0 1px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.5);pointer-events:none}
.cp-hexrow{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted)}
.cp-hexrow span{flex:1}
.cp-hex{flex:none;width:112px;height:40px;box-sizing:border-box;padding:0 10px;border:1px solid var(--line2);border-radius:10px;background:var(--bg);color:var(--text);
  font:500 16px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-transform:uppercase;-webkit-user-select:text;user-select:text}
.cp-hex:focus{outline:none;border-color:var(--accent)}
@media (prefers-reduced-motion:reduce){.cpop,.cpop *{transition:none!important}}
` }));

function cpSlider(label, max, fmt, onInput, onEnd) {
  const node = el('div', 'cp-sl');
  const head = el('div', 'cp-sh');
  const lab = el('span', '', { textContent: label });
  const val = el('b');
  head.append(lab, val);
  const track = el('div', 'cp-track');
  const thumb = el('div', 'cp-thumb');
  track.appendChild(thumb);
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-valuemin', 0);
  track.setAttribute('aria-valuemax', max);
  node.append(head, track);
  let v = 0, drag = null;
  const draw = () => {
    thumb.style.left = (v / max) * 100 + '%';
    val.textContent = fmt(v);
    track.setAttribute('aria-valuenow', Math.round(v));
  };
  const fromX = (x) => {
    const r = track.getBoundingClientRect();
    return Math.min(max, Math.max(0, ((x - r.left) / r.width) * max));
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = e.pointerId;
    try { track.setPointerCapture(e.pointerId); } catch (_) {}
    v = fromX(e.clientX); draw(); onInput(v);
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => { if (drag === e.pointerId) { v = fromX(e.clientX); draw(); onInput(v); } });
  const end = (e) => { if (drag === e.pointerId) { drag = null; onEnd(); } };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  track.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (!d) return;
    v = Math.min(max, Math.max(0, v + (d * max) / 100)); draw(); onInput(v);
    e.preventDefault();
  });
  track.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key.startsWith('Page')) onEnd(); });
  return { node, set: (x) => { v = x; draw(); }, setBg: (css) => { track.style.background = css; } };
}

const cp = (() => {
  const overlay = el('div', 'asmr-modal cp-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  const pop = el('div', 'box cpop');
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', 'Выбор цвета');
  pop.tabIndex = -1;

  const curSw = el('div', 'cp-cur');
  const title = el('div', 'cp-title', { textContent: 'Цвет' });
  const closeBtn = el('button', 'cp-x', { type: 'button', title: 'Закрыть' });
  closeBtn.setAttribute('aria-label', 'Закрыть');
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  pop.appendChild(Object.assign(el('div', 'cp-top'), {})).append(curSw, title, closeBtn);

  const palGrid = el('div', 'cp-grid');
  const recLab = el('div', 'cp-lab', { textContent: 'Недавно использованные' });
  const recGrid = el('div', 'cp-grid');
  pop.append(el('div', 'cp-lab', { textContent: 'Готовые цвета' }), palGrid, recLab, recGrid);

  const moreBtn = el('button', 'cp-more', { type: 'button' });
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.innerHTML = '<span>Точная настройка</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const ext = el('div', 'cp-ext');
  const extIn = el('div', 'cp-ext-in');
  const pad = el('div', 'cp-ext-pad');
  const wheel = el('div', 'cp-wheel');
  const dot = el('div', 'cp-dot');
  wheel.appendChild(dot);
  const hueSl = cpSlider('Оттенок', 360, (v) => Math.round(v) + '°', (v) => { st.h = Math.min(359.99, v); apply(); }, commitRecent);
  const satSl = cpSlider('Насыщенность', 100, (v) => Math.round(v) + '%', (v) => { st.s = v / 100; apply(); }, commitRecent);
  const valSl = cpSlider('Яркость', 100, (v) => Math.round(v) + '%', (v) => { st.v = v / 100; apply(); }, commitRecent);
  const hexRow = el('label', 'cp-hexrow');
  const hexIn = el('input', 'cp-hex', { type: 'text', maxLength: 7 });
  hexIn.setAttribute('autocomplete', 'off');
  hexIn.setAttribute('autocapitalize', 'off');
  hexIn.spellcheck = false;
  hexRow.append(el('span', '', { textContent: 'Код цвета (HEX)' }), hexIn);
  pad.append(wheel, hueSl.node, satSl.node, valSl.node, hexRow);
  extIn.appendChild(pad);
  ext.appendChild(extIn);
  pop.append(moreBtn, ext);
  overlay.appendChild(pop);
  document.body.appendChild(overlay);

  let anchor = null, cb = null, st = { h: 0, s: 1, v: 1 }, cur = '#000000', isOpen = false, hideT = 0, extOpen = false;

  function commitRecent() { cpPushRecent(cur); renderPalette(); }

  function swatchBtn(hex) {
    const b = el('button', hex === cur ? 'on' : '', { type: 'button', title: hex.toUpperCase() });
    b.style.background = hex;
    b.setAttribute('aria-label', 'Цвет ' + hex.toUpperCase());
    b.addEventListener('click', () => { setHex(hex); cpPushRecent(hex); renderPalette(); if (cb) cb(hex); });
    return b;
  }
  function renderPalette() {
    palGrid.replaceChildren(...CP_PALETTE.map(swatchBtn));
    recGrid.replaceChildren(...cpRecent.map(swatchBtn));
    recLab.style.display = recGrid.style.display = cpRecent.length ? '' : 'none';
  }

  function paintUi() {
    cur = hsvToHex(st.h, st.s, st.v);
    curSw.style.background = cur;
    const R = wheel.clientWidth / 2 || 88;
    const ang = (st.h * Math.PI) / 180;
    dot.style.left = R + Math.sin(ang) * st.s * R + 'px';
    dot.style.top = R - Math.cos(ang) * st.s * R + 'px';
    dot.style.background = cur;
    wheel.style.setProperty('--dark', String(1 - st.v));
    hueSl.set(st.h); satSl.set(st.s * 100); valSl.set(st.v * 100);
    hueSl.setBg('linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)');
    satSl.setBg(`linear-gradient(90deg,${hsvToHex(st.h, 0, st.v)},${hsvToHex(st.h, 1, st.v)})`);
    valSl.setBg(`linear-gradient(90deg,#000,${hsvToHex(st.h, st.s, 1)})`);
    if (document.activeElement !== hexIn) hexIn.value = cur.toUpperCase();
    [palGrid, recGrid].forEach((g) => [...g.children].forEach((b) => b.classList.toggle('on', b.title.toLowerCase() === cur)));
  }
  function apply() { paintUi(); if (cb) cb(cur); }
  function setHex(hex) {
    const c = hexToRgb(hex);
    const n = rgbToHsv(c[0], c[1], c[2]);
    st = { h: n.s === 0 || n.v === 0 ? st.h : n.h, s: n.s, v: n.v };
    paintUi();
  }

  let wDrag = null;
  const wheelAt = (e) => {
    const r = wheel.getBoundingClientRect(), R = r.width / 2;
    const dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    st.h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    st.s = Math.min(1, Math.hypot(dx, dy) / R);
    apply();
  };
  wheel.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    wDrag = e.pointerId;
    try { wheel.setPointerCapture(e.pointerId); } catch (_) {}
    wheelAt(e);
    e.preventDefault();
  });
  wheel.addEventListener('pointermove', (e) => { if (wDrag === e.pointerId) wheelAt(e); });
  const wEnd = (e) => { if (wDrag === e.pointerId) { wDrag = null; commitRecent(); } };
  wheel.addEventListener('pointerup', wEnd);
  wheel.addEventListener('pointercancel', wEnd);

  const hexCommit = () => {
    const h = normHex(hexIn.value);
    if (h) { setHex(h); commitRecent(); if (cb) cb(cur); }
    hexIn.value = cur.toUpperCase();
  };
  hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hexIn.blur(); } });
  hexIn.addEventListener('blur', hexCommit);
  hexIn.addEventListener('input', () => { const h = normHex(hexIn.value); if (h) { setHex(h); if (cb) cb(cur); } });

  function setExt(v) {
    extOpen = v;
    ext.classList.toggle('open', v);
    ext.inert = !v;
    moreBtn.setAttribute('aria-expanded', String(v));
    moreBtn.firstChild.textContent = v ? 'Свернуть' : 'Точная настройка';
    if (v) requestAnimationFrame(paintUi);
  }
  moreBtn.addEventListener('click', () => setExt(!extOpen));

  ext.inert = true;

  function open(a, hex, onChange, label) {
    if (anchor && anchor !== a) anchor.setAttribute('aria-expanded', 'false');
    anchor = a; cb = null;
    anchor.setAttribute('aria-expanded', 'true');
    title.textContent = label || 'Цвет';
    setHex(normHex(hex) || '#ffffff');
    renderPalette();
    isOpen = true;
    pop.scrollTop = 0;
    menu.inert = true;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('open');
    cb = onChange;
    requestAnimationFrame(paintUi);
    try { pop.focus({ preventScroll: true }); } catch (_) {}
  }
  function close(restoreFocus) {
    if (!isOpen) return;
    isOpen = false;
    const a = anchor;
    cb = null;
    if (a) a.setAttribute('aria-expanded', 'false');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    menu.inert = false;
    setExt(false);
    if (restoreFocus && a) { try { a.focus({ preventScroll: true }); } catch (_) {} }
    anchor = null;
  }
  closeBtn.addEventListener('click', () => close(true));

  let downOnBackdrop = false;
  overlay.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === overlay; });
  overlay.addEventListener('click', (e) => { if (downOnBackdrop && e.target === overlay) close(true); downOnBackdrop = false; });

  const trap = (e) => {
    const f = [...pop.querySelectorAll('button,input,[tabindex="0"]')].filter((n) => !n.disabled && !n.closest('[inert]') && n.offsetParent !== null);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1], act = document.activeElement;
    if (!pop.contains(act) || act === pop) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
    else if (e.shiftKey && act === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
  };
  window.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(true); }
    else if (e.key === 'Tab') trap(e);
  }, true);
  new MutationObserver(() => { if (menu.style.display === 'none') close(false); }).observe(menu, { attributes: true, attributeFilter: ['style'] });

  return {
    open, close,
    isOpenFor: (a) => isOpen && anchor === a,
    sync: (hex) => { if (isOpen && normHex(hex) && hex.toLowerCase() !== cur) { setHex(hex); } },
  };
})();

function makeColorButton(initial, onChange, label) {
  const node = el('button', 'cswatch', { type: 'button' });
  const fill = el('span');
  node.appendChild(fill);
  node.setAttribute('aria-haspopup', 'dialog');
  node.setAttribute('aria-expanded', 'false');
  let val = initial;
  const paint = () => {
    fill.style.background = val;
    node.setAttribute('aria-label', `${label || 'Цвет'}: ${String(val).toUpperCase()}. Выбрать цвет`);
    node.title = String(val).toUpperCase();
  };
  node.addEventListener('click', () => {
    if (cp.isOpenFor(node)) { cp.close(true); return; }
    cp.open(node, val, (hex) => { val = hex; paint(); onChange(hex); }, label);
  });
  paint();
  return { node, set: (v) => { val = v; paint(); cp.sync(v); } };
}

const MAX_STOPS = 16;

function buildGradientEditor(onChange, K, onSelect) {
  const wrap = el('div', 'gbody');
  const bar = el('div', 'gbar');
  const track = el('div', 'gtrack');

  const info = el('div', 'ginfo');
  const infoText = el('span');
  const picker = makeColorButton('#000000', (v) => { selected.color = v; updateVisuals(); changed(); }, 'Цвет точки');
  info.append(infoText, picker.node);

  const btns = el('div', 'gbtns');
  const addBtn = el('button', '', { type: 'button', textContent: '+ Добавить точку' });
  const delBtn = el('button', '', { type: 'button', textContent: '− Удалить точку' });
  btns.append(addBtn, delBtn);

  const smoothRow = el('div', 'gsmooth');
  const smoothLabel = el('label', '', { htmlFor: 'f-' + K.smooth, textContent: 'Плавный градиент' });
  const smoothInput = el('input', 'switch', { id: 'f-' + K.smooth, type: 'checkbox' });
  smoothRow.append(smoothLabel, smoothInput);
  switchSyncs.push(() => { smoothInput.checked = !!settings[K.smooth]; });

  wrap.append(bar, track, info, btns, smoothRow);

  let selected = null;
  let handles = [];
  const stops = () => settings[K.stops];
  const sorted = () => [...stops()].sort((a, b) => a.pos - b.pos);
  const changed = () => { settings[K.edited] = true; onChange(); };

  function updateVisuals() {
    bar.style.background = gradientCss(stops(), settings[K.smooth]);
    handles.forEach(({ stop, node }) => {
      node.style.left = stop.pos * 100 + '%';
      node.firstChild.style.background = stop.color;
      node.classList.toggle('sel', stop === selected);
    });
    const order = sorted();
    infoText.textContent = `Точка ${order.indexOf(selected) + 1} из ${order.length} · положение ${Math.round(selected.pos * 100)}% · ${selected.color.toUpperCase()}`;
    picker.set(selected.color);
    if (onSelect) onSelect(selected === order[0]);
    smoothInput.checked = settings[K.smooth];
    delBtn.disabled = stops().length <= 2;
    addBtn.disabled = stops().length >= MAX_STOPS;
  }

  function rebuildHandles() {
    if (!stops().includes(selected)) selected = stops()[0];
    handles = stops().map((stop) => {
      const node = el('button', 'ghandle', { type: 'button' });
      node.appendChild(el('i'));
      let dragging = false;
      node.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        selected = stop;
        dragging = true;
        try { node.setPointerCapture(e.pointerId); } catch (_) {}
        updateVisuals();
      });
      node.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const r = track.getBoundingClientRect();
        stop.pos = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 100) / 100;
        updateVisuals();
        changed();
      });
      const end = () => { dragging = false; };
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', end);
      return { stop, node };
    });
    track.replaceChildren(...handles.map((h) => h.node));
    updateVisuals();
  }

  addBtn.addEventListener('click', () => {
    if (stops().length >= MAX_STOPS) return;
    const st = sorted();
    const pts = [0, ...st.map((x) => x.pos), 1];
    let best = { gap: -1, pos: 0.5 };
    for (let i = 0; i < pts.length - 1; i++) {
      const gap = pts[i + 1] - pts[i];
      if (gap > best.gap) best = { gap, pos: (pts[i] + pts[i + 1]) / 2 };
    }
    const pos = Math.round(best.pos * 100) / 100;
    const rgb = colorAtStops(st.map((x) => ({ pos: x.pos, rgb: hexToRgb(x.color) })), true, pos);
    selected = { pos, color: rgbToHex(rgb) };
    stops().push(selected);
    rebuildHandles();
    changed();
  });

  delBtn.addEventListener('click', () => {
    if (stops().length <= 2) return;
    const order = sorted();
    const i = order.indexOf(selected);
    settings[K.stops] = stops().filter((x) => x !== selected);
    selected = order[i + 1] && order[i + 1] !== selected ? order[i + 1] : order[i - 1];
    rebuildHandles();
    changed();
  });

  smoothInput.addEventListener('change', () => {
    settings[K.smooth] = smoothInput.checked;
    updateVisuals();
    changed();
  });

  function set(v) {
    settings[K.stops] = JSON.parse(JSON.stringify(v.stops));
    settings[K.smooth] = v.smooth;
    settings[K.edited] = v.edited !== false;
    selected = null;
    rebuildHandles();
  }

  selected = stops()[0];
  rebuildHandles();
  return { node: wrap, set };
}

const controls = {};
const visibles = [];
const switchSyncs = [];

function syncSwitches() { switchSyncs.forEach((f) => f()); }

function refreshVisibility() {
  visibles.forEach((v) => { v.row.style.display = v.fn(settings) ? '' : 'none'; });
  syncSwitches();
  const tp = controls.trailPaint;
  if (tp && tp.refresh) tp.refresh();
}

function commit(key) {
  refreshVisibility();
  activate(controls[key].row, key, true);
}

const SVG_ATTR = 'viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  reset: `<svg ${SVG_ATTR}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v5h5"/></svg>`,
  dice: `<svg ${SVG_ATTR}><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none"/></svg>`,
  hue: `<svg ${SVG_ATTR}><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/></svg>`,
  info: `<svg ${SVG_ATTR}><circle cx="12" cy="12" r="9"/><path d="M12 16v-5"/><path d="M12 8h.01"/></svg>`,
  close: `<svg ${SVG_ATTR}><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  more: `<svg ${SVG_ATTR}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>`,
};

function buildSlider(def, value, labelId, onInput) {
  const node = el('div', 'sl');
  const inner = el('div', 'sl-in');
  const line = el('div', 'sl-line'), fill = el('div', 'sl-fill'), thumb = el('div', 'sl-thumb');
  inner.append(line, fill, thumb);
  node.appendChild(inner);
  node.tabIndex = 0;
  node.setAttribute('role', 'slider');
  node.setAttribute('aria-labelledby', labelId);
  node.setAttribute('aria-valuemin', def.min);
  node.setAttribute('aria-valuemax', def.max);

  const span = def.max - def.min;
  const snap = (v) => {
    const n = Math.round((v - def.min) / def.step);
    return parseFloat(Math.min(def.max, Math.max(def.min, def.min + n * def.step)).toFixed(4));
  };
  let cur = value;
  const render = () => {
    const pc = ((cur - def.min) / span) * 100;
    fill.style.width = pc + '%';
    thumb.style.left = pc + '%';
    node.setAttribute('aria-valuenow', cur);
    node.setAttribute('aria-valuetext', def.fmt(cur));
  };
  const set = (v) => { cur = snap(v); render(); };
  const apply = (v) => { const nv = snap(v); if (nv === cur) return; cur = nv; render(); onInput(cur); };
  const xToValue = (x) => {
    const r = inner.getBoundingClientRect();
    return def.min + Math.min(1, Math.max(0, (x - r.left) / r.width)) * span;
  };
  render();

  let g = null;
  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      g = { id: e.pointerId, mode: 'abs' };
      try { node.setPointerCapture(e.pointerId); } catch (_) {}
      node.classList.add('drag');
      apply(xToValue(e.clientX));
      return;
    }
    g = { id: e.pointerId, mode: 'wait', x: e.clientX, y: e.clientY, v: cur };
  });
  node.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (g.mode === 'abs') { apply(xToValue(e.clientX)); return; }
    if (g.mode === 'wait') {
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
      if (Math.abs(dx) < 6) return;
      g.mode = 'rel'; g.x = e.clientX; g.v = cur;
      node.classList.add('drag');
    }
    apply(g.v + ((e.clientX - g.x) / inner.getBoundingClientRect().width) * span);
  });
  const end = (e) => { if (g && e.pointerId === g.id) { g = null; node.classList.remove('drag'); } };
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('keydown', (e) => {
    const big = Math.max(def.step, span / 10);
    const d = { ArrowRight: def.step, ArrowUp: def.step, ArrowLeft: -def.step, ArrowDown: -def.step, PageUp: big, PageDown: -big }[e.key];
    if (e.key === 'Home') apply(def.min);
    else if (e.key === 'End') apply(def.max);
    else if (d) apply(cur + d);
    else return;
    e.preventDefault();
  });
  return { node, set, apply };
}

function buildSegment(labels, index, onChange) {
  const node = el('div', 'seg');
  node.tabIndex = 0;
  node.setAttribute('role', 'slider');
  node.setAttribute('aria-valuemin', 0);
  node.setAttribute('aria-valuemax', labels.length - 1);
  const thumb = el('div', 'seg-thumb');
  node.appendChild(thumb);
  const spans = labels.map((t) => node.appendChild(el('span', '', { textContent: t })));
  const n = labels.length;
  node.style.gridTemplateColumns = `repeat(${n},1fr)`;
  thumb.style.width = `calc((100% - 6px)/${n})`;
  let idx = index;
  const draw = (pos, animate) => {
    thumb.style.transition = animate ? '' : 'none';
    thumb.style.transform = `translateX(${pos * 100}%)`;
    const near = Math.round(pos);
    spans.forEach((sp, i) => sp.classList.toggle('on', i === near));
    node.setAttribute('aria-valuenow', near);
    node.setAttribute('aria-valuetext', labels[near]);
  };
  const posAt = (x) => {
    const r = node.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, ((x - r.left) / r.width) * n - 0.5));
  };
  const choose = (i) => { if (i === idx) { draw(idx, true); return; } idx = i; draw(idx, true); onChange(idx); };
  draw(idx, false);

  let g = null;
  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, drag: false };
  });
  node.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (!g.drag) {
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
      if (Math.abs(dx) < 4) return;
      g.drag = true;
    }
    draw(posAt(e.clientX), false);
  });
  node.addEventListener('pointerup', (e) => {
    if (!g || e.pointerId !== g.id) return;
    g = null;
    choose(Math.round(posAt(e.clientX)));
  });
  const cancel = (e) => { if (g && e.pointerId === g.id) { g = null; draw(idx, true); } };
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') choose(Math.min(n - 1, idx + 1));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') choose(Math.max(0, idx - 1));
    else return;
    e.preventDefault();
  });
  return { node, set: (i) => { idx = i; draw(i, true); } };
}

const GLOW_OP = { min: 0.05, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' };
const GLOW_T = [
  { k: 'Ring', name: 'Кольца', size: { min: 1.5, max: 20, step: 0.5, fmt: (v) => '×' + v.toFixed(1) } },
  { k: 'Ball', name: 'Шарик', size: { min: 1.2, max: 8, step: 0.1, fmt: (v) => '×' + v.toFixed(1) } },
];
const GLOW_KEYS = GLOW_T.flatMap((t) => ['', 'Mode', 'Opacity', 'Size', 'Custom', 'Color'].map((x) => 'glow' + t.k + x));

function buildGlow(def) {
  const node = el('div', 'glow');
  let cur = 0;
  const tabs = buildSegment(GLOW_T.map((t) => t.name), 0, (i) => { cur = i; show(); });
  node.appendChild(tabs.node);

  const ui = GLOW_T.map((t) => {
    const key = (x) => 'glow' + t.k + x;
    const box = el('div', 'glow-t');

    const onId = 'f-glow-on-' + t.k;
    const onLine = el('div', 'glow-line');
    const onSw = el('input', 'switch', { id: onId, type: 'checkbox' });
    onLine.append(el('label', '', { htmlFor: onId, textContent: 'Включить свечение' }), onSw);

    const body = el('div', 'glow-body');
    const mode = buildSegment(['Простое', 'Плавное'], settings[key('Mode')], (i) => { settings[key('Mode')] = i; commit(def.key); });

    const slider = (x, label, d) => {
      const wrap = el('div', 'glow-sl');
      const lab = el('span', '', { textContent: label });
      lab.id = `f-glow-${t.k}-${x}-l`;
      const val = el('span', 'glow-val', { textContent: d.fmt(settings[key(x)]) });
      const head = el('div', 'glow-sh');
      head.append(lab, val);
      const sl = buildSlider(d, settings[key(x)], lab.id, (v) => { settings[key(x)] = v; val.textContent = d.fmt(v); commit(def.key); });
      wrap.append(head, sl.node);
      return { node: wrap, set: (v) => { settings[key(x)] = v; sl.set(v); val.textContent = d.fmt(v); } };
    };
    const opacity = slider('Opacity', 'Яркость', GLOW_OP);
    const size = slider('Size', 'Размер', t.size);

    const cuId = 'f-glow-cu-' + t.k;
    const cuLine = el('div', 'glow-line');
    const colorIn = makeColorButton(settings[key('Color')], (v) => { settings[key('Color')] = v; commit(def.key); }, 'Цвет свечения');
    const cuSw = el('input', 'switch', { id: cuId, type: 'checkbox' });
    cuLine.append(el('label', '', { htmlFor: cuId, textContent: 'Свой цвет' }), colorIn.node, cuSw);

    body.append(mode.node, opacity.node, size.node, cuLine);
    box.append(onLine, body);

    onSw.addEventListener('change', () => { settings[key('')] = onSw.checked; body.style.display = onSw.checked ? '' : 'none'; commit(def.key); });
    cuSw.addEventListener('change', () => { settings[key('Custom')] = cuSw.checked; colorIn.node.style.display = cuSw.checked ? '' : 'none'; commit(def.key); });

    const sync = () => {
      onSw.checked = !!settings[key('')];
      body.style.display = onSw.checked ? '' : 'none';
      mode.set(settings[key('Mode')]);
      opacity.set(settings[key('Opacity')]);
      size.set(settings[key('Size')]);
      cuSw.checked = !!settings[key('Custom')];
      colorIn.set(settings[key('Color')]);
      colorIn.node.style.display = cuSw.checked ? '' : 'none';
    };
    switchSyncs.push(() => {
      onSw.checked = !!settings[key('')];
      body.style.display = onSw.checked ? '' : 'none';
      cuSw.checked = !!settings[key('Custom')];
      colorIn.node.style.display = cuSw.checked ? '' : 'none';
    });
    node.appendChild(box);
    return { box, sync };
  });

  function show() { ui.forEach((u, i) => { u.box.style.display = i === cur ? '' : 'none'; }); }
  const syncAll = () => { ui.forEach((u) => u.sync()); show(); };
  syncAll();
  return { node, set: (v) => { GLOW_KEYS.forEach((k) => { if (v && k in v) settings[k] = v[k]; }); syncAll(); } };
}

function buildPaint(def) {
  const q = def.p;
  const getMode = () => (!settings[q.grad] ? 0 : !settings[q.adv] ? 1 : 2);
  const wrap = el('div', 'paint');
  const c1 = makeColorButton(settings[q.c1], (v) => {
    settings[q.c1] = v;
    if (hasBS && settings[q.ballStart] && !sameColor(v, settings.ballColor)) { settings[q.ballStart] = false; syncBs(); }
    show();
    commit(def.key);
  }, 'Первый цвет');
  const c2 = makeColorButton(settings[q.c2], (v) => { settings[q.c2] = v; show(); commit(def.key); }, 'Второй цвет');
  const bar = el('div', 'pbar');
  const cols = el('div', 'pcols');
  cols.append(c1.node, bar, c2.node);

  const hasBS = !!q.ballStart;
  const mkBs = (suffix) => {
    const row = el('div', 'pball');
    const id = `f-${q.ballStart}-${suffix}`;
    const input = el('input', 'switch', { id, type: 'checkbox' });
    row.append(el('label', '', { htmlFor: id, textContent: 'Начало следа — цвет шарика' }), input);
    input.addEventListener('change', () => setBallStart(input.checked));
    return { row, input };
  };
  const bsGrad = hasBS ? mkBs('g') : null;
  const bsEdit = hasBS ? mkBs('e') : null;
  let editorFirst = true;
  const sameColor = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  function syncBs() {
    if (!hasBS) return;
    bsGrad.input.checked = bsEdit.input.checked = !!settings[q.ballStart];
  }
  if (hasBS) switchSyncs.push(syncBs);

  const editor = buildGradientEditor(() => {
    if (hasBS && settings[q.ballStart] && !sameColor(sortedStops()[0].color, settings.ballColor)) {
      settings[q.ballStart] = false;
      syncBs();
    }
    commit(def.key);
  }, { stops: q.stops, smooth: q.smooth, edited: q.edited }, (isFirst) => {
    editorFirst = isFirst;
    if (hasBS) bsEdit.row.style.display = getMode() === 2 && isFirst ? '' : 'none';
  });
  const seg = buildSegment(['Один цвет', 'Градиент', 'Свой градиент'], getMode(), (m) => setMode(m, true));
  wrap.append(seg.node, cols);
  if (hasBS) wrap.append(bsGrad.row);
  wrap.appendChild(editor.node);
  if (hasBS) wrap.appendChild(bsEdit.row);

  function show() {
    const m = getMode();
    cols.style.display = m === 2 ? 'none' : 'flex';
    bar.style.display = c2.node.style.display = m === 1 ? '' : 'none';
    c1.node.classList.toggle('wide', m === 0);
    editor.node.style.display = m === 2 ? '' : 'none';
    if (hasBS) {
      bsGrad.row.style.display = m === 1 ? '' : 'none';
      bsEdit.row.style.display = m === 2 && editorFirst ? '' : 'none';
    }
    bar.style.background = gradientCss([{ pos: 0, color: settings[q.c1] }, { pos: 1, color: settings[q.c2] }], true);
  }
  const sortedStops = () => [...settings[q.stops]].sort((a, b) => a.pos - b.pos);
  function endsFromStops() {
    const st = sortedStops();
    settings[q.c1] = st[0].color;
    settings[q.c2] = st[st.length - 1].color;
    c1.set(settings[q.c1]);
    c2.set(settings[q.c2]);
  }
  function stopsFromEnds() {
    const st = JSON.parse(JSON.stringify(sortedStops()));
    st[0].color = settings[q.c1];
    st[st.length - 1].color = settings[q.c2];
    editor.set({ stops: st, smooth: settings[q.smooth], edited: settings[q.edited] });
  }
  function setMode(m, user) {
    const prev = getMode();
    if (user && prev !== m) {
      if (prev === 2) endsFromStops();
      else if (m === 2) {
        if (!settings[q.edited]) editor.set({ stops: [{ pos: 0, color: settings[q.c1] }, { pos: 1, color: settings[q.c2] }], smooth: true, edited: false });
        else if (prev === 1) stopsFromEnds();
      }
    }
    settings[q.grad] = m >= 1;
    settings[q.adv] = m === 2;
    show();
    if (user) commit(def.key);
  }
  function applyBallStart() {
    if (!hasBS || !settings[q.ballStart]) return;
    const bc = settings.ballColor;
    if (!sameColor(settings[q.c1], bc)) { settings[q.c1] = bc; c1.set(bc); show(); }
    const cl = JSON.parse(JSON.stringify(settings[q.stops]));
    const first = [...cl].sort((a, b) => a.pos - b.pos)[0];
    if (!sameColor(first.color, bc)) {
      first.color = bc;
      editor.set({ stops: cl, smooth: settings[q.smooth], edited: settings[q.edited] });
    }
  }
  function setBallStart(v) {
    settings[q.ballStart] = v;
    syncBs();
    if (v) applyBallStart();
    commit(def.key);
  }
  show();
  syncBs();

  const set = (v) => {
    settings[q.c1] = v.c1; settings[q.c2] = v.c2;
    c1.set(v.c1); c2.set(v.c2);
    editor.set({ stops: v.stops, smooth: v.smooth, edited: v.edited });
    settings[q.grad] = v.mode >= 1;
    settings[q.adv] = v.mode === 2;
    if (hasBS) { settings[q.ballStart] = !!v.ballStart; syncBs(); }
    seg.set(v.mode);
    show();
  };
  return { node: wrap, set, refresh: applyBallStart };
}

const infoEl = el('div', 'asmr-modal');
infoEl.setAttribute('aria-hidden', 'true');
const infoBox = el('div', 'box');
infoBox.setAttribute('role', 'dialog');
infoBox.setAttribute('aria-modal', 'true');
infoBox.setAttribute('aria-labelledby', 'asmr-info-title');
const infoTitle = el('h2', '', { id: 'asmr-info-title' });
const infoX = el('button', 'x', { type: 'button', title: 'Закрыть' });
infoX.setAttribute('aria-label', 'Закрыть');
infoX.innerHTML = ICONS.close;
const infoText = el('div', 'mb');
const infoHead = el('div', 'mh');
infoHead.append(infoTitle, infoX);
infoBox.append(infoHead, infoText);
infoEl.appendChild(infoBox);
let infoOpener = null;

function infoBody(def) {
  const norm = (t) => t.toLowerCase().replace(/[^a-zа-яё0-9 ]/g, '').trim();
  const parts = (INFO[def.key] || '').split('\n');
  if (parts.length > 1 && norm(parts[0]) === norm(def.label)) parts.shift();
  return parts.join('\n');
}

function openInfo(def, opener) {
  infoTitle.textContent = def.label;
  infoText.textContent = infoBody(def);
  infoBox.scrollTop = 0;
  infoOpener = opener;
  menu.inert = true;
  infoEl.setAttribute('aria-hidden', 'false');
  infoEl.classList.add('open');
  infoX.focus({ preventScroll: true });
}
function closeInfo() {
  if (!infoEl.classList.contains('open')) return;
  infoEl.classList.remove('open');
  infoEl.setAttribute('aria-hidden', 'true');
  menu.inert = false;
  if (infoOpener) infoOpener.focus({ preventScroll: true });
  infoOpener = null;
}
infoX.addEventListener('click', closeInfo);
infoEl.addEventListener('click', (e) => { if (e.target === infoEl) closeInfo(); });
window.addEventListener('keydown', (e) => {
  if (!infoEl.classList.contains('open')) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeInfo(); }
  else if (e.key === 'Tab') { e.preventDefault(); infoX.focus({ preventScroll: true }); }
}, true);

const TOUCH_SEL = '.sl, .seg, input, .cswatch, .gbar, .gbtns button';

function makeRow(def) {
  const row = el('div', 'row');
  const id = 'f-' + def.key;
  const head = el('div', 'head');
  const label = el('label', '', { textContent: def.label });
  label.id = id + '-l';
  head.appendChild(label);
  row.appendChild(head);

  let set, refresh;
  if (def.type === 'range') {
    const val = el('input', 'val', { type: 'text', value: def.fmt(settings[def.key]) });
    val.inputMode = def.min < 0 ? 'text' : 'decimal';
    val.setAttribute('enterkeyhint', 'done');
    val.setAttribute('autocomplete', 'off');
    val.spellcheck = false;
    val.setAttribute('aria-label', def.label + ' — ввести число');
    const shown = (v) => String(parseFloat((def.pct ? v * 100 : v).toFixed(4)));
    let editCancelled = false;
    const sl = buildSlider(def, settings[def.key], label.id, (v) => {
      settings[def.key] = v;
      if (document.activeElement !== val) val.value = def.fmt(v);
      commit(def.key);
    });
    val.addEventListener('focus', () => {
      editCancelled = false;
      val.value = shown(settings[def.key]);
      setTimeout(() => { try { val.select(); } catch (_) {} }, 0);
    });
    val.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); val.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editCancelled = true; val.blur(); }
    });
    val.addEventListener('blur', () => {
      const n = parseFloat(val.value.replace(',', '.').replace(/[^\d.\-]/g, ''));
      if (!editCancelled && isFinite(n)) sl.apply(def.pct ? n / 100 : n);
      val.value = def.fmt(settings[def.key]);
    });
    set = (v) => { settings[def.key] = v; sl.set(v); if (document.activeElement !== val) val.value = def.fmt(v); };
    const line = el('div', 'srow');
    line.append(sl.node, val);
    row.appendChild(line);
  } else if (def.type === 'color') {
    const cb = makeColorButton(settings[def.key], (v) => { settings[def.key] = v; commit(def.key); }, def.label);
    set = (v) => { settings[def.key] = v; cb.set(v); };
    head.appendChild(cb.node);
  } else if (def.type === 'toggle') {
    label.htmlFor = id;
    const input = el('input', 'switch', { id, type: 'checkbox', checked: settings[def.key] });
    set = (v) => { settings[def.key] = v; input.checked = v; };
    switchSyncs.push(() => { input.checked = !!settings[def.key]; });
    input.addEventListener('change', () => {
      set(input.checked);
      if (def.key === 'sound' && input.checked) {
        unlockAudio();
        setTimeout(() => playNote(7, 0.15, 0.6), 80);
      }
      commit(def.key);
    });
    head.appendChild(input);
  } else if (def.type === 'segment') {
    const seg = buildSegment(def.options, settings[def.key], (i) => { settings[def.key] = i; commit(def.key); });
    set = (v) => { settings[def.key] = v; seg.set(v); };
    row.appendChild(seg.node);
  } else if (def.type === 'glow') {
    const glow = buildGlow(def);
    set = glow.set;
    row.appendChild(glow.node);
  } else {
    const paint = buildPaint(def);
    set = paint.set;
    refresh = paint.refresh;
    row.appendChild(paint.node);
  }
  controls[def.key] = { row, set, refresh };

  const acts = el('div', 'acts');
  const tools = el('div', 'tools');
  const addAct = (parent, icon, title, fn, kind, text) => {
    const b = el('button', '', { type: 'button', title });
    b.innerHTML = icon + (text ? `<span>${text}</span>` : '');
    b.setAttribute('aria-label', title);
    if (kind) b.dataset.a = kind;
    b.addEventListener('click', () => {
      const ic = b.querySelector('svg');
      if (ic) { ic.classList.remove('go'); void ic.getBoundingClientRect(); ic.classList.add('go'); }
      fn();
    });
    parent.appendChild(b);
    return b;
  };
  addAct(tools, ICONS.reset, 'Вернуть исходное значение', () => { set(initialValue(def)); commit(def.key); }, 'reset', 'Сбросить');
  addAct(tools, ICONS.dice, 'Случайное значение', () => { set(randomValue(def, false)); commit(def.key); }, 'dice', 'Случайное');
  if (def.type === 'color' || def.type === 'paint') {
    addAct(tools, ICONS.hue, 'Случайный яркий цвет (максимальная насыщенность)', () => { set(randomValue(def, true)); commit(def.key); }, 'hue', 'Случайный яркий');
  }
  if (INFO[def.key]) {
    const ib = addAct(acts, ICONS.info, 'Что это за настройка?', () => openInfo(def, ib), 'info');
    ib.classList.add('info-btn');
    ib.setAttribute('aria-haspopup', 'dialog');
    ib.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  const moreBtn = addAct(acts, ICONS.more, 'Ещё: сбросить, случайное значение', () => {
    moreBtn.setAttribute('aria-expanded', String(row.classList.toggle('tools-open')));
  }, 'more');
  moreBtn.setAttribute('aria-expanded', 'false');
  row.appendChild(tools);
  head.appendChild(acts);

  row.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest(TOUCH_SEL)) activate(row, def.key, false);
  });
  if (def.visible) visibles.push({ row, fn: def.visible });
  return row;
}

const topBar = el('div', 'asmr-top');
const randAllBtn = el('button', '', { type: 'button', textContent: 'Случайные настройки' });
const resetAllBtn = el('button', '', { type: 'button', textContent: 'Сбросить всё' });
topBar.append(randAllBtn, resetAllBtn);
panel.appendChild(topBar);

const colsEl = el('div', 'asmr-cols');
panel.appendChild(colsEl);
const cards = [];
let colN = 0;

function layoutCols(force) {
  if (menu.style.display === 'none') return;
  const w = colsEl.clientWidth;
  if (!w) return;
  const n = Math.max(1, Math.min(3, Math.floor((w + 12) / (340 + 12))));
  if (!force && n === colN) return;
  colN = n;
  const cols = Array.from({ length: n }, () => el('div', 'asmr-col'));
  colsEl.replaceChildren(...cols);
  cards.forEach((c) => cols[0].appendChild(c));
  if (n > 1) {
    const hs = cards.map((c) => c.offsetHeight);
    const acc = new Array(n).fill(0);
    cards.forEach((c, i) => {
      let k = 0;
      for (let j = 1; j < n; j++) if (acc[j] < acc[k]) k = j;
      cols[k].appendChild(c);
      acc[k] += hs[i] + 12;
    });
  }
}

let introI = 0;
let card = null;
FIELDS.forEach((def) => {
  if (def.section) {
    card = el('div', 'card');
    card.style.setProperty('--i', Math.min(introI++, 16));
    card.appendChild(el('div', 'card-title', { textContent: def.section }));
    cards.push(card);
    colsEl.appendChild(card);
    return;
  }
  card.appendChild(makeRow(def));
});
panel.classList.add('intro');
setTimeout(() => panel.classList.remove('intro'), 1800);
refreshVisibility();

randAllBtn.addEventListener('click', () => {
  FIELDS.forEach((def) => {
    if (!def.section && !def.noRandomAll) controls[def.key].set(randomValue(def, false));
  });
  refreshVisibility();
  hidePreview(true);
});
resetAllBtn.addEventListener('click', () => {
  FIELDS.forEach((def) => {
    if (!def.section) controls[def.key].set(initialValue(def));
  });
  refreshVisibility();
  hidePreview(true);
});

const startBtn = el('button', 'asmr-start', { type: 'button', textContent: 'Запустить' });
panel.appendChild(startBtn);

const FAST_LABEL = 'Записать видео (MP4)';
const fastBtn = el('button', 'asmr-fast', { type: 'button', textContent: FAST_LABEL });
panel.append(fastBtn);

const backBtn = el('button', 'asmr-back', { type: 'button', textContent: '← К настройкам' });

document.body.append(menu, pvWrap, backBtn, infoEl);
layoutCols(true);

window.addEventListener('pageshow', syncSwitches);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSwitches(); });

document.addEventListener('touchstart', () => {}, { passive: true });

document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.row, .asmr-pv, .cpop, .asmr-modal')) hidePreview();
});
new MutationObserver(pvApplyRun).observe(menu, { attributes: true, attributeFilter: ['style'] });
syncPreview(null);
pvApplyRun();
let lastW = window.innerWidth, lastH = window.innerHeight;
const syncSizes = () => {
  const w = window.innerWidth, h = window.innerHeight;
  if (w !== lastW || h !== lastH) { pvLayout(); pvQueueCanvasResize(); lastW = w; lastH = h; }
  if (menu.style.display === 'none') mainSim.resize();
  layoutCols();
};
window.addEventListener('resize', syncSizes);
window.addEventListener('orientationchange', () => { setTimeout(syncSizes, 120); setTimeout(syncSizes, 450); });
if (window.ResizeObserver) {
  new ResizeObserver(() => { if (menu.style.display === 'none') mainSim.resize(); }).observe(mainCanvas);
  new ResizeObserver(() => layoutCols()).observe(colsEl);
}

mainCanvas.addEventListener('wheel', (e) => {
  if (menu.style.display !== 'none') return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const k = e.ctrlKey ? 0.01 : 0.0015;
  mainSim.zoomBy(Math.exp(-e.deltaY * unit * k));
  noteZoom();
}, { passive: false });

const touches = new Map();
let pinchDist = 0;
const touchDist = () => {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
mainCanvas.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { mainCanvas.setPointerCapture(e.pointerId); } catch (_) {}
  if (touches.size === 2) pinchDist = touchDist();
});
mainCanvas.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    const d = touchDist();
    if (pinchDist > 0 && d > 0) { mainSim.zoomBy(d / pinchDist, true); noteZoom(); }
    pinchDist = d;
  }
});
const endTouch = (e) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinchDist = 0;
};
mainCanvas.addEventListener('pointerup', endTouch);
mainCanvas.addEventListener('pointercancel', endTouch);

const zoomHint = el('div', 'asmr-hint', { textContent: COARSE ? 'Приблизить: сведите или разведите два пальца' : 'Приблизить: колёсико мыши или щипок на тачпаде' });
zoomHint.setAttribute('role', 'status');
document.body.appendChild(zoomHint);
let zoomHintTimer = 0, zoomUsed = false;
function hideZoomHint() { clearTimeout(zoomHintTimer); zoomHint.classList.remove('show'); }
function showZoomHint() {
  if (zoomUsed) return;
  zoomHint.classList.add('show');
  clearTimeout(zoomHintTimer);
  zoomHintTimer = setTimeout(hideZoomHint, 5000);
}
function noteZoom() { zoomUsed = true; hideZoomHint(); }

function startRender() {
  unlockAudio();
  hidePreview();
  menu.style.display = 'none';
  backBtn.style.display = 'block';
  mainSim.configure(settings, { mode: 'full' });
  mainSim.resetZoom();
  mainSim.resize();
  mainSim.start();
  showZoomHint();
}

function backToMenu() {
  hideZoomHint();
  mainSim.stop();
  backBtn.style.display = 'none';
  menu.style.display = 'flex';
  menu.classList.remove('fade');
  void menu.offsetWidth;
  menu.classList.add('fade');
}

startBtn.addEventListener('click', startRender);
backBtn.addEventListener('click', backToMenu);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.style.display === 'none' && recScreen.style.display === 'none') backToMenu();
});

const REC_FPS = 60;
const REC_SIDES = COARSE ? [720, 480] : [1080, 720, 480];
const REC_MAX_SECONDS = 120;
const REC_MAX_INFLIGHT = 6;
const REC_AUDIO_RATE = 48000;
class RecCancelled extends Error {}
let recJob = null;

document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
.asmr-rec{position:fixed;inset:0;z-index:30;display:none;overflow-y:auto;justify-content:center;align-items:flex-start;overscroll-behavior:contain;
  padding:max(20px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) 0 max(12px,env(safe-area-inset-left));box-sizing:border-box;
  background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.rec-box{width:min(560px,100%);min-height:100%;display:flex;flex-direction:column;gap:14px}
.rec-box h2{margin:0;font-size:19px;font-weight:600;text-align:center}
.rec-view{align-self:center;width:min(100%,440px,40vh);aspect-ratio:1/1;border-radius:14px;background:#000;border:1px solid var(--line2)}
.rec-prog{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.rec-bar{height:10px;border-radius:5px;background:var(--surface2);overflow:hidden;margin-top:-6px}
.rec-fill{height:100%;width:0;border-radius:5px;background:var(--accent);transition:width .15s}
.rec-phase{min-height:36px;font-size:13px;line-height:1.5;text-align:center;white-space:pre-line;color:var(--muted)}
.rec-phase.err{color:var(--danger)}
.rec-info{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.rec-cell{padding:9px 12px;border-radius:12px;background:var(--surface);border:1px solid var(--line);min-width:0}
.rec-cell small{display:block;margin-bottom:2px;font-size:12px;color:var(--muted)}
.rec-cell b{font-weight:500;font-size:14px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.rec-warn{padding:10px 14px;border-radius:12px;background:var(--surface);border:1px solid var(--line2);font-size:12.5px;line-height:1.5;color:var(--muted)}
.rec-more{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:0 12px}
.rec-more summary{display:flex;align-items:center;min-height:44px;font-size:13px;color:var(--muted);cursor:pointer}
.rec-more .rec-info{padding-bottom:12px}
.rec-tech{display:none;padding:0 0 12px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);overflow-wrap:anywhere}
.rec-tech:not(:empty){display:block}
.rec-actions{position:sticky;bottom:0;margin-top:auto;padding:12px 0 max(12px,env(safe-area-inset-bottom));background:var(--bg);border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px}
.rec-actions .asmr-fast{margin-top:0;min-height:52px}
` }));

const recScreen = el('div', 'asmr-rec');
const recView = el('canvas', 'rec-view', { width: 480, height: 480 });
const recViewCtx = recView.getContext('2d');
const recRings = el('span');
const recPct = el('span');
const recFill = el('div', 'rec-fill');
const recPhase = el('div', 'rec-phase');
const recCells = {};
const recInfo = el('div', 'rec-info');
[['codec', 'Кодек'], ['res', 'Разрешение'], ['size', 'Размер файла'], ['video', 'Длительность'],
  ['speed', 'Скорость записи'], ['eta', 'Осталось']].forEach(([key, label]) => {
  const cell = el('div', 'rec-cell');
  const small = el('small', '', { textContent: label });
  recCells[key] = el('b', '', { textContent: '—' });
  cell.append(small, recCells[key]);
  recInfo.appendChild(cell);
});
const recTech = el('div', 'rec-tech');
const recMore = el('details', 'rec-more');
recMore.append(el('summary', '', { textContent: 'Подробности' }), recInfo, recTech);
const recWarn = el('div', 'rec-warn', {
  textContent: 'Запись может занять до 2 минут. Пока она идёт, не закрывайте и не обновляйте страницу, не сворачивайте браузер и не выключайте экран — иначе запись прервётся.',
});
const recStop = el('button', 'asmr-fast busy', { type: 'button', textContent: '■ Остановить запись' });
const recAgain = el('button', 'asmr-fast', { type: 'button', textContent: '⬇ Скачать ещё раз' });
const recBack = el('button', 'asmr-fast', { type: 'button', textContent: '← К настройкам' });
const recProg = el('div', 'rec-prog');
recProg.append(recRings, recPct);
const recBar = el('div', 'rec-bar');
recBar.appendChild(recFill);
const recBox = el('div', 'rec-box');
const recActions = el('div', 'rec-actions');
recActions.append(recStop, recAgain, recBack);
recBox.append(el('h2', '', { textContent: 'Запись видео' }), recView, recProg, recBar, recPhase, recMore, recWarn, recActions);
recScreen.appendChild(recBox);
document.body.appendChild(recScreen);

const recLast = { url: null, blob: null, name: '' };

function downloadUrl(url, name) {
  const a = el('a', '', { href: url, download: name });
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function fmtDuration(sec) {
  sec = Math.max(0, sec);
  if (sec < 60) return Math.ceil(sec) + ' с';
  return Math.floor(sec / 60) + ' мин ' + String(Math.round(sec % 60)).padStart(2, '0') + ' с';
}

function setProgress(p, ringsText) {
  const v = Math.max(0, Math.min(1, p));
  recFill.style.width = (v * 100).toFixed(1) + '%';
  recPct.textContent = Math.floor(v * 100) + '%';
  if (ringsText) recRings.textContent = ringsText;
}

function recOpen() {
  if (recLast.url) { URL.revokeObjectURL(recLast.url); recLast.url = null; recLast.blob = null; }
  menu.style.display = 'none';
  recScreen.style.display = 'flex';
  Object.values(recCells).forEach((c) => { c.textContent = '—'; });
  recMore.open = false;
  recTech.textContent = '';
  setProgress(0, 'Осталось колец: —');
  recViewCtx.fillStyle = '#000';
  recViewCtx.fillRect(0, 0, recView.width, recView.height);
  recStop.style.display = 'block';
  recStop.disabled = false;
  recStop.textContent = '■ Остановить запись';
  recAgain.style.display = 'none';
  recBack.style.display = 'none';
  recWarn.style.display = 'block';
}

function recFinish() {
  recStop.style.display = 'none';
  recWarn.style.display = 'none';
  recBack.style.display = 'block';
  recAgain.textContent = COARSE ? '⬇ Скачать видео' : '⬇ Скачать ещё раз';
  recAgain.style.display = recLast.url ? 'block' : 'none';
}

function requestStop() {
  if (!recJob || recJob.cancel) return;
  recJob.cancel = true;
  recJob.abort();
  recStop.disabled = true;
  recStop.textContent = 'Останавливаю…';
}
recStop.addEventListener('pointerup', (e) => {
  const r = recStop.getBoundingClientRect(), m = 12;
  if (e.clientX >= r.left - m && e.clientX <= r.right + m && e.clientY >= r.top - m && e.clientY <= r.bottom + m) requestStop();
});
recStop.addEventListener('click', requestStop);
function saveLast() {
  if (!recLast.url) return;
  downloadUrl(recLast.url, recLast.name);
}
recAgain.addEventListener('click', saveLast);
recBack.addEventListener('click', () => {
  if (recJob) return;
  if (recLast.url) { URL.revokeObjectURL(recLast.url); recLast.url = null; recLast.blob = null; }
  recScreen.style.display = 'none';
  menu.style.display = 'flex';
});

const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };

let wakeLock = null;
let recWasHidden = false, recResumedAt = 0;
async function acquireWake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (_) {}
}
function releaseWake() {
  try { if (wakeLock) wakeLock.release(); } catch (_) {}
  wakeLock = null;
}
const onRecVisibility = () => {
  if (!recJob) return;
  if (document.hidden) recWasHidden = true;
  else { recResumedAt = performance.now(); acquireWake(); }
};

function explainRecError(err) {
  const name = (err && err.name) || '';
  const msg = String((err && err.message) || err || '');
  if (/[а-яё]/i.test(msg)) return msg;
  const low = (name + ' ' + msg).toLowerCase();
  if (name === 'NotSupportedError' || /not supported|unsupported|codec/.test(low)) {
    return 'Браузер не смог закодировать видео в этом формате. Попробуйте Chrome или Edge.';
  }
  if (name === 'QuotaExceededError' || err instanceof RangeError || /memory|allocation|too large/.test(low)) {
    return 'Не хватило памяти для записи. Закройте другие вкладки и попробуйте ещё раз.';
  }
  if (name === 'EncodingError' || /encod/.test(low)) {
    return 'При обработке видео произошла ошибка. Попробуйте ещё раз или откройте сайт в Chrome или Edge.';
  }
  return 'Не удалось записать видео. Попробуйте ещё раз.';
}

const setStatus = (text, isErr) => {
  recPhase.textContent = text;
  recPhase.classList.toggle('err', !!isErr);
};

const Mp4Writer = (() => {
  const be = (n, len) => { const a = new Uint8Array(len); for (let i = len - 1; i >= 0; i--) { a[i] = n & 255; n = Math.floor(n / 256); } return a; };
  const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  const zeros = (n) => new Uint8Array(n);
  const cat = (...parts) => {
    const flat = parts.flat(Infinity);
    let n = 0;
    for (const p of flat) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of flat) { out.set(p, o); o += p.length; }
    return out;
  };
  const box = (type, ...parts) => { const body = cat(...parts); return cat(be(body.length + 8, 4), ascii(type), body); };
  const full = (type, version, flags, ...parts) => box(type, be(version * 16777216 + flags, 4), ...parts);
  const u32s = (arr) => {
    const out = new Uint8Array(arr.length * 4);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < arr.length; i++) dv.setUint32(i * 4, arr[i]);
    return out;
  };
  const toU8 = (d) => (d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
  const MATRIX = cat(be(0x10000, 4), zeros(12), be(0x10000, 4), zeros(12), be(0x40000000, 4));
  const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

  function configBox(t) {
    if (t.codec === 'avc') {
      if (!t.description) throw new Error('Браузер не передал параметры H.264, нужные для сборки файла.');
      return box('avcC', t.description);
    }
    if (t.codec === 'vp9') {
      const p = (t.string || 'vp09.00.41.08').split('.');
      const n = (i, d) => (p[i] !== undefined && p[i] !== '' ? parseInt(p[i], 10) : d);
      const bitDepth = n(3, 8), chroma = n(4, 1), range = n(8, 0);
      return full('vpcC', 1, 0, Uint8Array.of(n(1, 0), n(2, 41), (bitDepth << 4) | (chroma << 1) | range, n(5, 1), n(6, 1), n(7, 1)), be(0, 2));
    }
    if (t.codec === 'aac') {
      let asc = t.description;
      if (!asc) {
        const fi = Math.max(0, AAC_RATES.indexOf(t.sampleRate));
        asc = Uint8Array.of((2 << 3) | (fi >> 1), ((fi & 1) << 7) | (t.channels << 3));
      }
      const dsi = cat(Uint8Array.of(0x05, asc.length), asc);
      const dcd = cat(Uint8Array.of(0x40, 0x15, 0, 0, 0), be(192000, 4), be(128000, 4), dsi);
      const dcdFull = cat(Uint8Array.of(0x04, dcd.length), dcd);
      const body = cat(Uint8Array.of(0, 0, 0), dcdFull, Uint8Array.of(0x06, 0x01, 0x02));
      return full('esds', 0, 0, Uint8Array.of(0x03, body.length), body);
    }
    let pre = 312, rate = t.sampleRate, gain = 0, family = 0, ch = t.channels;
    const d = t.description;
    if (d && d.length >= 19 && d[0] === 0x4f) {
      ch = d[9]; pre = d[10] | (d[11] << 8); rate = (d[12] | (d[13] << 8) | (d[14] << 16) | (d[15] << 24)) >>> 0;
      gain = d[16] | (d[17] << 8); family = d[18];
    }
    return box('dOps', Uint8Array.of(0, ch), be(pre, 2), be(rate, 4), be(gain & 0xffff, 2), Uint8Array.of(family));
  }

  function sampleEntry(t) {
    const cfg = configBox(t);
    if (t.kind === 'video') {
      return box(t.codec === 'avc' ? 'avc1' : 'vp09', zeros(6), be(1, 2), zeros(16), be(t.width, 2), be(t.height, 2),
        be(0x480000, 4), be(0x480000, 4), zeros(4), be(1, 2), zeros(32), be(0x18, 2), be(0xffff, 2), cfg);
    }
    return box(t.codec === 'aac' ? 'mp4a' : 'Opus', zeros(6), be(1, 2), zeros(8), be(t.channels, 2), be(16, 2), be(0, 2), be(0, 2),
      be(t.sampleRate * 65536, 4), cfg);
  }

  function buildTrak(t, id, offsets) {
    const isV = t.kind === 'video';
    const movieDur = Math.round((t.duration / t.timescale) * 1000);
    const tkhd = full('tkhd', 0, 3, be(0, 4), be(0, 4), be(id, 4), be(0, 4), be(movieDur, 4), zeros(8), be(0, 2), be(0, 2),
      be(isV ? 0 : 0x100, 2), be(0, 2), MATRIX, be(isV ? t.width * 65536 : 0, 4), be(isV ? t.height * 65536 : 0, 4));
    const mdhd = full('mdhd', 0, 0, be(0, 4), be(0, 4), be(t.timescale, 4), be(t.duration, 4), be(0x55c4, 2), be(0, 2));
    const hdlr = full('hdlr', 0, 0, be(0, 4), ascii(isV ? 'vide' : 'soun'), zeros(12), ascii(isV ? 'VideoHandler' : 'SoundHandler'), zeros(1));

    const runs = [];
    for (const s of t.samples) {
      const last = runs[runs.length - 1];
      if (last && last[1] === s.dur) last[0]++; else runs.push([1, s.dur]);
    }
    const stts = full('stts', 0, 0, be(runs.length, 4), u32s(runs.flat()));
    const keys = [];
    t.samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
    const stss = isV ? full('stss', 0, 0, be(keys.length, 4), u32s(keys)) : new Uint8Array(0);
    const stsc = full('stsc', 0, 0, be(1, 4), be(1, 4), be(1, 4), be(1, 4));
    const stsz = full('stsz', 0, 0, be(0, 4), be(t.samples.length, 4), u32s(t.samples.map((s) => s.data.length)));
    const stco = full('stco', 0, 0, be(t.samples.length, 4), u32s(offsets));
    const stsd = full('stsd', 0, 0, be(1, 4), sampleEntry(t));
    const dinf = box('dinf', full('dref', 0, 0, be(1, 4), full('url ', 0, 1)));
    const media = isV ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4));
    const minf = box('minf', media, dinf, box('stbl', stsd, stts, stss, stsc, stsz, stco));
    return box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
  }

  class Mp4Writer {
    constructor(opts) {
      this.v = { kind: 'video', ...opts.video, timescale: 90000, samples: [], description: null };
      this.a = opts.audio ? { kind: 'audio', ...opts.audio, timescale: opts.audio.sampleRate, samples: [], description: null } : null;
    }
    _add(t, chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !t.description) t.description = toU8(meta.decoderConfig.description).slice();
      const last = t.samples[t.samples.length - 1];
      if (last && chunk.timestamp < last.ts) throw new Error('Кадры видео пришли не по порядку, файл собрать не получилось.');
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      t.samples.push({ data, ts: chunk.timestamp, durUs: chunk.duration || 0, key: chunk.type !== 'delta' });
    }
    addVideoChunk(chunk, meta) { this._add(this.v, chunk, meta); }
    addAudioChunk(chunk, meta) { if (this.a) this._add(this.a, chunk, meta); }

    finalize() {
      const tracks = [this.v, this.a].filter((t) => t && t.samples.length);
      if (!this.v.samples.length) throw new Error('В видео нет ни одного кадра.');
      for (const t of tracks) {
        const k = t.timescale / 1e6, s = t.samples;
        s.forEach((x) => { x.tick = Math.round(x.ts * k); });
        s.forEach((x, i) => {
          const d = i + 1 < s.length ? s[i + 1].tick - x.tick : x.durUs ? Math.round(x.durUs * k) : i ? s[i - 1].dur : 1;
          x.dur = Math.max(1, d);
        });
        t.duration = s.reduce((sum, x) => sum + x.dur, 0);
      }
      const order = [];
      tracks.forEach((t, ti) => t.samples.forEach((s, si) => order.push({ ti, si, s, time: s.tick / t.timescale })));
      order.sort((x, y) => x.time - y.time || x.ti - y.ti);

      const ftyp = box('ftyp', ascii('isom'), be(512, 4), ascii('isom'), ascii('iso2'), ascii(this.v.codec === 'avc' ? 'avc1' : 'vp09'), ascii('mp41'));
      const buildMoov = (offs) => {
        const dur = Math.max(...tracks.map((t) => Math.round((t.duration / t.timescale) * 1000)));
        const mvhd = full('mvhd', 0, 0, be(0, 4), be(0, 4), be(1000, 4), be(dur, 4), be(0x10000, 4), be(0x100, 2), zeros(10), MATRIX, zeros(24), be(tracks.length + 1, 4));
        return box('moov', mvhd, tracks.map((t, i) => buildTrak(t, i + 1, offs[i])));
      };
      const offs = tracks.map((t) => new Array(t.samples.length).fill(0));
      const base = ftyp.length + buildMoov(offs).length + 8;
      let pos = base;
      for (const o of order) { offs[o.ti][o.si] = pos; pos += o.s.data.length; }
      if (pos >= 4294967295) throw new Error('Видео вышло больше 4 ГБ — файл MP4 такого размера собрать нельзя. Сделайте сцену короче.');
      const moov = buildMoov(offs);
      return new Blob([ftyp, moov, cat(be(pos - base + 8, 4), ascii('mdat')), ...order.map((o) => o.s.data)], { type: 'video/mp4' });
    }
  }
  return Mp4Writer;
})();

const yieldChannel = new MessageChannel();
let yieldResolve = null;
yieldChannel.port1.onmessage = () => { const r = yieldResolve; yieldResolve = null; if (r) r(); };
const yieldNow = () => new Promise((r) => { yieldResolve = r; yieldChannel.port2.postMessage(0); });
const yieldPaint = () => new Promise((r) => setTimeout(r, 0));
const yieldInput = () => new Promise((r) => setTimeout(r, 0));

const waitDequeue = (enc) => new Promise((resolve) => {
  let done = false;
  const fin = () => { if (done) return; done = true; enc.removeEventListener('dequeue', fin); resolve(); };
  enc.addEventListener('dequeue', fin);
  setTimeout(fin, 50);
});

const VIDEO_CODECS = [
  { codec: 'avc1.640033', mux: 'avc' },
  { codec: 'avc1.64002A', mux: 'avc' },
  { codec: 'avc1.4D0033', mux: 'avc' },
  { codec: 'avc1.42E01F', mux: 'avc' },
  { codec: 'vp09.00.41.08', mux: 'vp9' },
  { codec: 'vp09.00.50.08', mux: 'vp9' },
];
const AUDIO_CODECS = [
  { codec: 'mp4a.40.2', mux: 'aac' },
  { codec: 'opus', mux: 'opus' },
];

async function probeVideo(cfg) {
  let err = null;
  let enc = null;
  try {
    enc = new VideoEncoder({ output() {}, error(e) { err = e; } });
    enc.configure(cfg);
    const c = document.createElement('canvas');
    c.width = cfg.width; c.height = cfg.height;
    const g = c.getContext('2d');
    g.fillStyle = '#123'; g.fillRect(0, 0, c.width, c.height);
    const vf = new VideoFrame(c, { timestamp: 0 });
    enc.encode(vf, { keyFrame: true });
    vf.close();
    await enc.flush();
    return !err;
  } catch (_) {
    return false;
  } finally {
    try { if (enc && enc.state !== 'closed') enc.close(); } catch (_) {}
  }
}

async function pickVideo(job) {
  for (const side of REC_SIDES) {
    const W = side, H = side;
    const bitrate = Math.round(W * H * 4);
    for (const c of VIDEO_CODECS) {
      if (job && job.cancel) throw new RecCancelled();
      const cfg = { codec: c.codec, width: W, height: H, bitrate, framerate: REC_FPS, latencyMode: 'realtime' };
      if (await probeVideo(cfg)) return { cfg, mux: c.mux, W, H };
    }
  }
  return null;
}

async function renderAudioOffline(events, seconds) {
  const length = Math.max(1, Math.ceil(seconds * REC_AUDIO_RATE));
  const oc = new OfflineAudioContext(2, length, REC_AUDIO_RATE);
  for (const e of events) scheduleNote(oc, e.t, e.k, e.vol, e.dur);
  return oc.startRendering();
}

async function recordFast() {
  const job = { cancel: false, abort: null };
  job.aborted = new Promise((_, reject) => { job.abort = () => reject(new RecCancelled()); });
  job.aborted.catch(() => {});
  recJob = job;
  recOpen();
  hidePreview();

  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    setStatus('Этот браузер не умеет записывать видео. Откройте сайт в Chrome, Edge или в последней версии Firefox.', true);
    recJob = null;
    recFinish();
    return;
  }
  window.addEventListener('beforeunload', onUnload);
  document.addEventListener('visibilitychange', onRecVisibility);
  recWasHidden = document.hidden;
  acquireWake();

  let venc = null, aenc = null, recSim = null;
  const checkAbort = () => { if (job.cancel) throw new RecCancelled(); };
  const guard = (promise) => Promise.race([promise, job.aborted]);

  try {
    setStatus('Подготовка…');
    await yieldPaint();
    checkAbort();

    const snap = JSON.parse(JSON.stringify(settings));

    setStatus('Выбираю формат видео…');
    await yieldPaint();
    const vsel = await guard(pickVideo(job));
    if (!vsel) throw new Error('Браузер не смог записать видео ни в одном из форматов (H.264, VP9).');
    const vcfg = vsel.cfg, W = vsel.W, H = vsel.H;
    recCells.codec.textContent = `${vsel.mux.toUpperCase()} (${vcfg.codec})`;
    recCells.res.textContent = `${W}×${H} · ${REC_FPS} кадров/с`;
    checkAbort();

    let acfg = null, audioMux = null;
    if (snap.sound && 'AudioEncoder' in window && 'OfflineAudioContext' in window) {
      for (const c of AUDIO_CODECS) {
        const cfg = { codec: c.codec, sampleRate: REC_AUDIO_RATE, numberOfChannels: 2, bitrate: 128000 };
        try {
          if ((await AudioEncoder.isConfigSupported(cfg)).supported) { acfg = cfg; audioMux = c.mux; break; }
        } catch (_) {}
      }
    }
    const wantAudio = !!acfg;
    const audioSkipped = snap.sound && !wantAudio;

    const muxer = new Mp4Writer({
      video: { codec: vsel.mux, string: vcfg.codec, width: W, height: H },
      audio: wantAudio ? { codec: audioMux, channels: 2, sampleRate: REC_AUDIO_RATE } : undefined,
    });

    let encError = null;
    let inflight = 0;
    let bytes = 0;
    venc = new VideoEncoder({
      output: (chunk, meta) => {
        inflight--;
        bytes += chunk.byteLength;
        muxer.addVideoChunk(chunk, meta);
      },
      error: (e) => { encError = e; },
    });
    venc.configure(vcfg);

    const recCanvas = document.createElement('canvas');
    recSim = createSim(recCanvas, { getSize: () => [W, H], dpr: 1, particles: 1200, burst: 70, audio: true });
    recSim.configure(snap, { mode: 'full' });
    recSim.resize();
    const events = [];
    recSim.beginCapture(events);

    const dt = 1 / REC_FPS;
    const frameDur = Math.round(1e6 / REC_FPS);
    const wallStart = performance.now();
    let sliceStart = wallStart, lastUi = 0, lastInput = wallStart, frame = 0, capped = false, etaSmooth = null;

    const refreshUi = (now) => {
      const { done, total } = recSim.progress();
      const p = total ? done / total : 0;
      const vSec = frame / REC_FPS, wSec = Math.max(0.001, (now - wallStart) / 1000);
      let eta = 'считаю…';
      if (p > 0.03 && wSec > 3) {
        const raw = (wSec * (1 - p)) / p;
        etaSmooth = etaSmooth == null ? raw : etaSmooth * 0.85 + raw * 0.15;
        eta = '≈ ' + fmtDuration(etaSmooth);
      }
      setProgress(p, `Осталось колец: ${total - done} из ${total}`);
      recCells.size.textContent = (bytes / 1048576).toFixed(1) + ' МБ';
      recCells.video.textContent = vSec.toFixed(1) + ' с';
      recCells.speed.textContent = '×' + (vSec / wSec).toFixed(1);
      recCells.eta.textContent = eta;
      recViewCtx.drawImage(recCanvas, 0, 0, recView.width, recView.height);
    };

    setStatus('Идёт запись: видео считается быстрее, чем длится сцена.');

    for (;;) {
      checkAbort();
      if (encError) throw encError;

      if (!recSim.advance(dt)) break;

      const vf = new VideoFrame(recCanvas, { timestamp: Math.round((frame * 1e6) / REC_FPS), duration: frameDur });
      venc.encode(vf, { keyFrame: frame % (REC_FPS * 2) === 0 });
      vf.close();
      frame++;

      if (frame / REC_FPS >= REC_MAX_SECONDS) { capped = true; break; }

      inflight++;
      let stallStart = performance.now();
      while (inflight >= REC_MAX_INFLIGHT) {
        checkAbort();
        if (encError) throw encError;
        if (document.hidden || recResumedAt > stallStart) stallStart = performance.now();
        if (performance.now() - stallStart > 15000) throw new Error('Запись зависла: 15 секунд нет результата. Закройте другие вкладки и попробуйте ещё раз.');
        await new Promise((r) => setTimeout(r, 4));
      }

      const now = performance.now();
      if (now - sliceStart > 12) {
        if (now - lastUi > 150) {
          lastUi = now;
          refreshUi(now);
          await yieldPaint();
          lastInput = performance.now();
        } else if (now - lastInput > 50) {
          await yieldInput();
          lastInput = performance.now();
        } else {
          await yieldNow();
        }
        sliceStart = performance.now();
      }
    }
    recSim.endCapture();
    setProgress(1, 'Осталось колец: 0');
    recCells.eta.textContent = '—';

    checkAbort();
    setStatus('Завершаю обработку видео…');
    await guard(venc.flush());
    if (encError) throw encError;
    venc.close();
    venc = null;
    recCells.size.textContent = (bytes / 1048576).toFixed(1) + ' МБ';
    recCells.video.textContent = (frame / REC_FPS).toFixed(1) + ' с';

    const seconds = frame / REC_FPS;

    if (wantAudio) {
      setStatus('Записываю звук…');
      await yieldPaint();
      const buf = await guard(renderAudioOffline(events, seconds));
      checkAbort();

      aenc = new AudioEncoder({
        output: (chunk, meta) => { bytes += chunk.byteLength; muxer.addAudioChunk(chunk, meta); },
        error: (e) => { encError = e; },
      });
      aenc.configure(acfg);

      const CHUNK = 4096;
      const c0 = buf.getChannelData(0);
      const c1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : c0;
      const clamp = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) { const a = Math.abs(c0[i]), b = Math.abs(c1[i]); if (a > peak) peak = a; if (b > peak) peak = b; }
      const norm = peak > 0.98 ? 0.98 / peak : 1;
      for (let off = 0; off < buf.length; off += CHUNK) {
        checkAbort();
        if (encError) throw encError;
        const n = Math.min(CHUNK, buf.length - off);
        const data = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { data[i] = clamp(c0[off + i] * norm); data[n + i] = clamp(c1[off + i] * norm); }
        const ad = new AudioData({
          format: 'f32-planar', sampleRate: REC_AUDIO_RATE, numberOfFrames: n, numberOfChannels: 2,
          timestamp: Math.round((off / REC_AUDIO_RATE) * 1e6), data,
        });
        aenc.encode(ad);
        ad.close();
        if (aenc.encodeQueueSize > 16) await waitDequeue(aenc);
      }
      await guard(aenc.flush());
      if (encError) throw encError;
      aenc.close();
      aenc = null;
    }

    setStatus('Собираю файл MP4…');
    await yieldPaint();
    const blob = muxer.finalize();
    const url = URL.createObjectURL(blob);
    recLast.url = url;
    recLast.blob = blob;
    recLast.name = `asmr-physics-${W}x${H}.mp4`;
    if (!COARSE) downloadUrl(url, recLast.name);
    recCells.size.textContent = (blob.size / 1048576).toFixed(1) + ' МБ';

    const wall = (performance.now() - wallStart) / 1000;
    setStatus(
      `Готово: видео на ${seconds.toFixed(1)} с записано за ${wall.toFixed(1)} с (×${(seconds / wall).toFixed(1)}), ${(blob.size / 1048576).toFixed(1)} МБ. ` + (COARSE ? 'Нажмите «Скачать видео».' : 'Файл уже скачан.') +
      (capped ? `\nВидео обрезано: достигнут лимит ${REC_MAX_SECONDS} с.` : '') +
      (audioSkipped ? '\nВидео без звука: этот браузер не умеет записывать звук.' : ''),
    );
  } catch (err) {
    if (err instanceof RecCancelled) setStatus('Запись остановлена.');
    else {
      recTech.textContent = ((err && err.name) ? err.name + ': ' : '') + String((err && err.message) || err);
      setStatus(explainRecError(err) +
        (recWasHidden ? '\nВо время записи экран гас или браузер сворачивался — оставьте вкладку открытой и не блокируйте телефон.' : ''), true);
    }
  } finally {
    if (recSim) recSim.endCapture();
    try { if (venc && venc.state !== 'closed') venc.close(); } catch (_) {}
    try { if (aenc && aenc.state !== 'closed') aenc.close(); } catch (_) {}
    window.removeEventListener('beforeunload', onUnload);
    document.removeEventListener('visibilitychange', onRecVisibility);
    releaseWake();
    recJob = null;
    recFinish();
  }
}

fastBtn.addEventListener('click', () => {
  if (!recJob) recordFast();
});