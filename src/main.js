// ASMR ball & rings — меню настроек + физика и рендеринг (vanilla JS + Canvas 2D)
// Нужен <canvas> на странице (берётся первый). Меню, превью, кнопка «Назад» и стили создаются из JS.
// Во время рендеринга: кнопка «← Назад» (или Esc) возвращает в меню, настройки сохраняются.

const TAU = Math.PI * 2;

// ───────────────────────────── Настройки по умолчанию ─────────────────────────────
// Стартовый набор; цвета выбираются случайно при каждой загрузке страницы.
const DEFAULTS = {
  ballRadius: 8.5,
  gravity: 360,
  bounce: 0.9,        // прыгучесть: 1 = упруго, 0 = вялый, >1 = безумный
  ringCount: 12,
  ringSpacing: 14,
  lineWidth: 2,
  gapSize: 97,        // общий размер отверстий — длина дуги у среднего кольца
  gapBalance: -0.45,  // баланс отверстий: 0 — одинаковые по всем кольцам, <0 — у центра меньше, у края больше (−0.45 → край ×2.7), >0 — наоборот
  spin: 0.85,         // общая скорость вращения (рад/сек) у среднего кольца
  spinBalance: -0.35, // баланс скорости: 0 — все кольца одинаково, <0 — у центра медленнее, у края быстрее (−0.35 → край ×2.2), >0 — наоборот
  smoothFlip: false,  // плавная смена направления
  gradient: false,
  advancedGradient: false,  // расширенный редактор градиента (доступен при включённом градиенте)
  gradSmooth: true,         // в расширенном редакторе: плавный переход (true) или «классика» — цвета без перехода (false)
  trail: false,             // след в воздухе за шариком
  trailOpacity: 0.6,        // прозрачность следа: 1 — плотный, 0.05 — почти невидимый
  trailLength: 1.2,         // длина следа: через сколько секунд он полностью затирается
  trailGradient: false,
  trailAdvancedGradient: false,
  trailGradSmooth: true,
  particles: true,    // анимация разрушения колец (частицы)
  sound: true,        // звук при столкновениях
};

// Внутренние константы физики
const STEP = 1 / 240;     // базовый шаг физики (при высокой скорости делится на подшаги)
const BALANCE_K = 3;      // при балансе ±1 край и центр различаются в 3² = 9 раз (при ±1.5 — в 27)
const FLIP_EASE = 6;      // плавность разворота вращения (1/сек)
const TOP_SPEED = 50;     // минимальная скорость шарика в верхней точке
const JITTER = 0.12;      // случайный разброс отскока (рад)
const HOLD_AFTER = 1.6;   // сколько шарик летит за последнее кольцо до перезапуска (сек)
const MAX_SPEED = 12000;  // предохранитель от «взрыва» энергии
const REF_VIEW = 142;     // масштаб превью в режиме «кусочек сцены»

// Множитель «баланса» для кольца с позицией t (0 — центр, 1 — край).
// b = 0 → везде 1; b < 0 → у центра меньше, у края больше; b > 0 → наоборот. У среднего кольца (t = 0.5) всегда 1,
// поэтому «общий» ползунок задаёт величину посередине, а баланс только перекашивает её к центру или к краю.
const balance = (b, t) => Math.pow(BALANCE_K, b * (1 - 2 * t));

// ───────────────────────────── Цвет ─────────────────────────────
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

// Цвет на позиции t (0..1) по точкам stops = [{ pos, rgb }], отсортированным по pos.
// smooth — плавный переход; иначе «классика»: берётся цвет ближайшей точки (границы посередине между точками).
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

// CSS-фон для полосы редактора градиента (stops = [{ pos, color }])
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

// Случайные цвета: «обычный» — с произвольной насыщенностью и яркостью; «по hue» — только оттенок, насыщенность максимальная
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

// ───────────────────────────── Звук ─────────────────────────────
let audioCtx = null;
let lastSound = 0;
const SCALE = [0, 2, 4, 7, 9]; // пентатоника
const NOTES = 15;              // 3 октавы пентатоники: нота 0 — до пятой октавы (≈523 Гц), нота 14 — ≈3.6 кГц

function unlockAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

// k — номер ноты 0..NOTES-1. Основной тон + тихая октава сверху — получается звонкий «колокольчик»
// ctx — живой AudioContext или OfflineAudioContext (для скоростной записи), t — время старта в секундах контекста
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

function playNote(k, vol, dur) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const now = performance.now();
  if (vol < 0.2 && now - lastSound < 40) return;
  lastSound = now;
  scheduleNote(audioCtx, audioCtx.currentTime, k, vol, dur);
}

// ───────────────────────────── Симуляция ─────────────────────────────
function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return Math.abs(d);
}

// opts: { getSize: () => [w, h], particles, burst, audio }
// o.mode:  'full' — все кольца, масштаб по размеру сцены; 'cut' — только центральные кольца в фиксированном масштабе (превью)
// o.scene: 'play'   — полноценная сцена (шарик, вращение, разрушение колец)
//          'ball'   — превью шарика: одно закрытое кольцо без отверстия, шарик не выберется
//          'static' — превью колец/отверстий: без шарика, кольца неподвижны в начальном положении
//          'spin'   — превью вращения: без шарика, кольца вращаются
//          'flip'   — как 'spin', но направление вращения меняется каждые пару секунд
function createSim(canvas, opts) {
  const ctx = canvas.getContext('2d');
  const P = opts.particles;
  const pX = new Float32Array(P), pY = new Float32Array(P);
  const pVX = new Float32Array(P), pVY = new Float32Array(P);
  const pLife = new Float32Array(P), pMax = new Float32Array(P);
  const pCol = new Uint8Array(P);
  let pHead = 0;

  const trail = [];               // след шарика: точки { x, y, t }
  let simT = 0;                   // время симуляции (сек) — по нему вычисляется возраст точек следа
  let trailCanvas = null, tctx = null;   // буфер, в котором след рисуется сплошным, а прозрачность применяется при выводе

  const rings = [];
  const ball = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 };
  const state = { alpha: 0, hold: 0, ending: false, dir: 1, dirTarget: 1, flipT: 0 };
  const g = {};          // производная геометрия/физика
  let cfg = null;
  let running = false, raf = 0, last = 0, acc = 0;
  let zoom = 1, zoomTarget = 1;   // приближение камеры (колёсико / щипок)
  // Режим скоростной записи: звуки не играются, а складываются в sink с временем по часам симуляции
  let sink = null, sinkLast = -1, clock = 0, cycleEnded = false;

  function sound(k, vol, dur) {
    if (!opts.audio || !cfg.sound) return;
    if (sink) {
      if (vol < 0.2 && clock - sinkLast < 0.04) return;   // тот же антиспам, что и в живом режиме
      sinkLast = clock;
      sink.push({ t: clock, k, vol, dur });
    } else {
      playNote(k, vol, dur);
    }
  }

  // Пересчёт производных величин из настроек
  function derive(c, o) {
    cfg = { ...c };
    const r = cfg.ballRadius, lw = cfg.lineWidth;
    g.pad = r + lw / 2;
    g.inner = Math.max(54, 3 * r + lw);                    // внутри первого кольца всегда есть место для шарика
    g.spacing = Math.max(cfg.ringSpacing, 0.5);            // можно сближать кольца до полного слияния
    g.arena = Math.max(100, 2.2 * r + lw);                 // радиус «тестового полигона» в превью шарика
    g.full = Math.max(1, Math.round(cfg.ringCount));
    g.scene = o.scene || 'play';
    g.hasBall = g.scene === 'play' || g.scene === 'ball';
    g.rotates = g.scene !== 'static' && g.scene !== 'ball';
    g.R0 = g.scene === 'ball' ? g.arena : g.inner;          // радиус первого кольца
    if (g.scene === 'ball') {
      g.count = 1;                                          // одно кольцо без отверстия
      g.view = g.arena + g.pad + 14;                        // полигон занимает почти всё окно превью
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
    g.reach = 0.6 + 0.4 * cfg.bounce;                      // до какой доли высоты кольца допрыгивает шарик
    // цвета колец: один цвет / градиент из двух / расширенный редактор с любым числом точек
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
    // цвета следа: позиция 0 — у шарика, 1 — самый старый конец следа
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
    // длина дуги отверстия = общий размер × баланс; отверстие всегда шире шарика
    const len = cfg.gapSize * balance(cfg.gapBalance, t);
    const half = g.scene === 'ball' ? 0 : Math.min(2.9, Math.max(len / (2 * R), (1.3 * cfg.ballRadius) / R));
    const rgb = colorAtStops(g.stops, g.smooth, t).map(Math.round).join(',');
    return {
      R, half,
      rot: -Math.PI / 2,                                     // отверстие сверху
      speed: cfg.spin * balance(cfg.spinBalance, t),
      broken: false,
      glow: `rgba(${rgb},0.16)`,
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
    state.dir = state.dirTarget = 1;
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

  // Полный перезапуск сцены с анимацией появления
  function configure(c, o = {}) {
    derive(c, o);
    cycleEnded = false;
    build();
  }

  // «Мягкое» обновление: сцена продолжает идти, без перезапуска и анимации появления
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
      if (frozen) { r.rot = -Math.PI / 2; r.broken = false; }   // неподвижные кольца — всегда в начальном положении
      rings.push(r);
    }
    if (g.scene !== prevScene) {
      state.dir = state.dirTarget = 1;
      state.flipT = 0;
    }
    if (reset) {
      // сброс в самое начало рендеринга: отверстия наверху, направление исходное, без анимации появления
      for (let i = 0; i < rings.length; i++) rings[i].rot = -Math.PI / 2;
      state.dir = state.dirTarget = 1;
      state.flipT = 0;
      state.alpha = 1;
    }
    if (!cfg.smoothFlip) state.dir = state.dirTarget;
    // шарик появился или оказался вне кольца после смены размеров — возвращаем в центр
    if (g.hasBall && (!hadBall || (g.scene === 'ball' && Math.hypot(ball.x, ball.y) > rings[0].R - g.pad))) resetBall();
  }

  // ── Физика ──
  function innermostRadius() {
    for (let i = 0; i < rings.length; i++) if (!rings[i].broken) return rings[i].R;
    return g.outer;
  }

  // Прыгучесть: после удара шарик получает энергию, достаточную, чтобы долететь до нужной высоты кольца
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
    const spread = Math.max(1, g.view / 150);               // на больших сценах частицы разлетаются дальше
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

  // нота кольца: от самой низкой у центра до самой высокой у края — независимо от количества колец
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

      // шарик целиком в отверстии → кольцо разрушается, шарик летит дальше
      if (angDiff(theta, ring.rot) + cfg.ballRadius / ring.R <= ring.half) {
        ring.broken = true;
        state.dirTarget = -state.dirTarget;                 // смена направления вращения у всех колец
        if (!cfg.smoothFlip) state.dir = state.dirTarget;   // без плавности — мгновенно
        if (cfg.particles) spawnBurst(ring);
        sound(noteOf(ring), 0.22, 0.9);
        continue;
      }

      // иначе — отскок с той стороны кольца, откуда шарик пришёл
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
    // направление разворачивается плавно (или мгновенно); углы отверстий не сбрасываются
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

  // След: запоминаем позиции шарика и выбрасываем те, что старше trailLength секунд
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

  // Подшаги: чем быстрее шарик, тем мельче шаг — на экстремальных настройках он не пролетает сквозь кольца
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
      // превью: без разрушения и перезапуска; в режиме 'flip' направление меняется каждые ~2 секунды
      if (state.alpha < 1) state.alpha = Math.min(1, state.alpha + dt * 1.5);
      if (g.scene === 'flip') {
        state.flipT += dt;
        if (state.flipT >= 2) {
          state.flipT = 0;
          state.dirTarget = -state.dirTarget;
          if (!cfg.smoothFlip) state.dir = state.dirTarget;
        }
      }
      return;
    }
    if (state.ending) {
      state.alpha -= dt * 1.2;
      if (state.alpha <= 0) { cycleEnded = true; build(); }   // цикл завершён (для скоростной записи)
      return;
    }
    if (state.alpha < 1) state.alpha = Math.min(1, state.alpha + dt * 1.5);

    // последнее кольцо разрушено, шарик вылетел наружу → запускаем заново
    if (rings[rings.length - 1].broken) {
      state.hold += dt;
      if (state.hold > HOLD_AFTER) state.ending = true;
    }
  }

  // ── Рендер ──
  // След — сужающаяся лента от шарика к хвосту. Рисуется сплошным цветом в отдельный буфер (чтобы перекрывающиеся
  // участки не накапливали прозрачность), затем целиком выводится с заданной прозрачностью.
  function drawTrail(scale) {
    if (!cfg.trail || !g.hasBall || !trail.length) return;
    const W = canvas.width, H = canvas.height;
    if (!trailCanvas) { trailCanvas = document.createElement('canvas'); tctx = trailCanvas.getContext('2d'); }
    if (trailCanvas.width !== W || trailCanvas.height !== H) { trailCanvas.width = W; trailCanvas.height = H; }
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, W, H);
    tctx.setTransform(scale, 0, 0, scale, W / 2, H / 2);
    tctx.lineCap = 'round';
    tctx.lineJoin = 'round';

    const len = Math.max(0.05, cfg.trailLength);
    const full = 2 * Math.max(cfg.ballRadius, 2.5 / scale);
    const n = trail.length;
    const stride = Math.max(1, Math.ceil(n / 360));       // на длинных следах рисуем не каждую точку
    let prev = trail[0];
    const seg = (p) => {
      const a = Math.min(1, Math.max(0, (simT - (prev.t + p.t) / 2) / len));   // 0 — свежий участок, 1 — самый старый
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
    seg({ x: ball.x, y: ball.y, t: simT });               // последний участок — до самого шарика

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = state.alpha * cfg.trailOpacity;
    ctx.drawImage(trailCanvas, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, W / 2, H / 2);
    ctx.globalAlpha = state.alpha;
  }

  function render() {
    const scale = (Math.min(canvas.width, canvas.height) / (2 * g.view)) * zoom;
    const minW = 1.5 / scale;                               // линии никогда не тоньше ~1.5px
    const lw = Math.max(cfg.lineWidth, minW);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height / 2);

    ctx.lineCap = 'butt';
    ctx.globalAlpha = state.alpha;

    // Мягкая подсветка по бокам: не шире расстояния между кольцами (соседние не накладываются),
    // а когда кольца сближены вплотную — исчезает совсем, и они сливаются в сплошной монолит
    const gw = g.count < 2 ? lw * 3 : Math.min(lw * 3, g.spacing);
    if (gw > lw * 1.2) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = gw;
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        if (ring.broken) continue;
        ctx.beginPath();
        ctx.arc(0, 0, ring.R, ring.rot + ring.half, ring.rot + TAU - ring.half);
        ctx.strokeStyle = ring.glow;
        ctx.stroke();
      }
    }

    // Основная линия — обычным наложением, без складывания яркости там, где кольца перекрываются
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
    ctx.shadowColor = cfg.ballColor;
    ctx.shadowBlur = 14 * scale;
    ctx.fillStyle = cfg.ballColor;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, Math.max(cfg.ballRadius, 2.5 / scale), 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // ── Цикл ──
  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
    }
    updateParticles(dt);
    updateLifecycle(dt);
    zoom += (zoomTarget - zoom) * (1 - Math.exp(-14 * dt));   // плавное приближение
    render();
    raf = requestAnimationFrame(frame);
  }

  // Один кадр с фиксированным dt — без requestAnimationFrame и реальных часов. Для скоростной записи.
  // Возвращает false, когда сцена завершила полный цикл (последнее кольцо разрушено, всё угасло) — кадр уже не рисуется.
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

  // Сколько колец уже разрушено — для шкалы прогресса записи
  function progress() {
    let done = 0;
    for (let i = 0; i < rings.length; i++) if (rings[i].broken) done++;
    return { done, total: rings.length };
  }

  function beginCapture(events) { sink = events; sinkLast = -1; clock = 0; acc = 0; cycleEnded = false; }
  function endCapture() { sink = null; }

  function resize() {
    const [w, h] = opts.getSize();
    const dpr = opts.dpr || Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
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

  // factor > 1 — приблизить, < 1 — отдалить; instant — без сглаживания (для жеста щипка)
  function zoomBy(factor, instant) {
    zoomTarget = Math.min(10, Math.max(0.2, zoomTarget * factor));
    if (instant) zoom = zoomTarget;
  }

  function resetZoom() {
    zoom = zoomTarget = 1;
  }

  return { configure, update, resize, start, stop, zoomBy, resetZoom, advance, beginCapture, endCapture, progress };
}

// ───────────────────────────── Меню ─────────────────────────────
const launchColors = randomColors();
const settings = {
  ...DEFAULTS,
  ...launchColors,
  gradStops: [{ pos: 0, color: launchColors.ringColor }, { pos: 1, color: launchColors.ringColor2 }],
  gradStopsEdited: false,   // правили ли точки вручную (пока нет — при включении редактора они берутся из двух цветов)
  trailColor: launchColors.ballColor,
  trailColor2: launchColors.ringColor,
  trailGradStops: [{ pos: 0, color: launchColors.ballColor }, { pos: 1, color: launchColors.ringColor }],
  trailGradStopsEdited: false,
};
// Значения на момент запуска сайта (с теми самыми случайными цветами) — к ним возвращает «Сбросить»
const INITIAL = JSON.parse(JSON.stringify(settings));

const mainCanvas = document.querySelector('canvas');
document.documentElement.style.background = '#000';
Object.assign(document.body.style, { margin: '0', background: '#000', overflow: 'hidden' });
Object.assign(mainCanvas.style, {
  position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', display: 'block',
  touchAction: 'none',   // жесты щипка обрабатываем сами, а не браузер
});

const mainSim = createSim(mainCanvas, {
  getSize: () => [window.innerWidth, window.innerHeight],
  particles: 1200, burst: 70, audio: true,
});

const PREVIEW_SIZE = 180;
const previewCanvas = document.createElement('canvas');
previewCanvas.className = 'asmr-preview';
previewCanvas.style.width = previewCanvas.style.height = PREVIEW_SIZE + 'px';
const preview = createSim(previewCanvas, {
  getSize: () => [PREVIEW_SIZE, PREVIEW_SIZE],
  particles: 250, burst: 24, audio: false,
});
preview.resize();

// Подпись баланса: во сколько раз край отличается от центра (или наоборот)
function fmtBalance(v) {
  if (Math.abs(v) < 0.025) return 'поровну';
  return (v < 0 ? 'край ×' : 'центр ×') + Math.pow(BALANCE_K, 2 * Math.abs(v)).toFixed(1);
}

// Пункты сгруппированы по смыслу. visible — когда строку вообще показывать.
const FIELDS = [
  { section: 'Шарик' },
  { key: 'ballRadius', label: 'Размер шарика', type: 'range', min: 1, max: 50, step: 0.5, fmt: (v) => v.toFixed(1) },
  { key: 'ballColor', label: 'Цвет шарика', type: 'color' },
  { key: 'gravity', label: 'Гравитация', type: 'range', min: 0, max: 8000, step: 50, fmt: (v) => v.toFixed(0) },
  { key: 'bounce', label: 'Прыгучесть', type: 'range', min: 0, max: 2.5, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },

  { section: 'След за шариком' },
  { key: 'trail', label: 'След в воздухе', type: 'toggle' },
  { key: 'trailOpacity', label: 'Прозрачность следа', hint: 'влево — прозрачнее, вправо — плотнее', type: 'range', min: 0.05, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', visible: (s) => s.trail },
  { key: 'trailLength', label: 'Длина следа', hint: 'через сколько секунд след затирается', type: 'range', min: 0.1, max: 5, step: 0.1, fmt: (v) => v.toFixed(1) + ' с', visible: (s) => s.trail },
  { key: 'trailColor', label: 'Цвет следа', type: 'color', visible: (s) => s.trail && !(s.trailGradient && s.trailAdvancedGradient) },
  { key: 'trailGradient', label: 'Градиент следа', type: 'toggle', visible: (s) => s.trail },
  { key: 'trailColor2', label: 'Второй цвет следа', type: 'color', visible: (s) => s.trail && s.trailGradient && !s.trailAdvancedGradient },
  { key: 'trailAdvancedGradient', label: 'Расширенный редактор', type: 'toggle', visible: (s) => s.trail && s.trailGradient,
    adv: { stops: 'trailGradStops', c1: 'trailColor', c2: 'trailColor2' } },
  { key: 'trailGradStops', label: 'Редактор градиента следа', type: 'gradient', smoothKey: 'trailGradSmooth', editedKey: 'trailGradStopsEdited',
    visible: (s) => s.trail && s.trailGradient && s.trailAdvancedGradient },

  { section: 'Кольца' },
  { key: 'ringCount', label: 'Количество колец', type: 'range', min: 1, max: 25, step: 1, fmt: (v) => v.toFixed(0) },
  { key: 'ringSpacing', label: 'Расстояние между кольцами', type: 'range', min: 0.5, max: 150, step: 0.5, fmt: (v) => v.toFixed(1) },
  { key: 'lineWidth', label: 'Толщина колец', type: 'range', min: 0.5, max: 30, step: 0.5, fmt: (v) => v.toFixed(1) },
  { key: 'ringColor', label: 'Цвет колец', type: 'color', visible: (s) => !(s.gradient && s.advancedGradient) },
  { key: 'gradient', label: 'Градиент', type: 'toggle' },
  { key: 'ringColor2', label: 'Второй цвет', type: 'color', visible: (s) => s.gradient && !s.advancedGradient },
  { key: 'advancedGradient', label: 'Расширенный редактор', type: 'toggle', visible: (s) => s.gradient,
    adv: { stops: 'gradStops', c1: 'ringColor', c2: 'ringColor2' } },
  { key: 'gradStops', label: 'Редактор градиента', type: 'gradient', smoothKey: 'gradSmooth', editedKey: 'gradStopsEdited', visible: (s) => s.gradient && s.advancedGradient },

  { section: 'Отверстия' },
  { key: 'gapSize', label: 'Размер отверстий', type: 'range', min: 2, max: 1500, step: 1, fmt: (v) => v.toFixed(0) },
  { key: 'gapBalance', label: 'Баланс отверстий', hint: 'влево — край больше, вправо — центр больше', type: 'range', min: -1.5, max: 1.5, step: 0.05, fmt: fmtBalance },

  { section: 'Вращение' },
  { key: 'spin', label: 'Скорость вращения', type: 'range', min: 0, max: 15, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'spinBalance', label: 'Баланс скорости', hint: 'влево — край быстрее, вправо — центр быстрее', type: 'range', min: -1.5, max: 1.5, step: 0.05, fmt: fmtBalance },
  { key: 'smoothFlip', label: 'Плавная смена направления', type: 'toggle' },

  { section: 'Эффекты' },
  { key: 'particles', label: 'Анимация разрушения колец', type: 'toggle' },
  { key: 'sound', label: 'Звук при столкновениях', type: 'toggle', noRandomAll: true },   // «Рандомизировать всё» звук не трогает
];

// Что показывает превью для каждого пункта (у пунктов без записи превью нет)
//   ball   — одно закрытое кольцо + шарик      static — неподвижные кольца, без шарика
//   spin   — вращающиеся кольца, без шарика    flip   — вращение со сменой направления каждые ~2 с, без шарика
const SCENES = {
  ballRadius: 'ball', ballColor: 'ball', gravity: 'ball', bounce: 'ball',
  trail: 'ball', trailOpacity: 'ball', trailLength: 'ball', trailColor: 'ball', trailGradient: 'ball', trailColor2: 'ball',
  trailAdvancedGradient: 'ball', trailGradStops: 'ball',
  ringCount: 'static', ringSpacing: 'static', lineWidth: 'static', ringColor: 'static', gradient: 'static', ringColor2: 'static',
  advancedGradient: 'static', gradStops: 'static',
  gapSize: 'static', gapBalance: 'static',
  spin: 'spin', spinBalance: 'spin', smoothFlip: 'flip',
};

// Только для этих пунктов превью показывает центральные кольца в фиксированном масштабе (чтобы было видно, как они раздвигаются
// и утолщаются). Во всех остальных превью (кроме шарика) видны ВСЕ кольца целиком — иначе не оценить пропорции.
const FIXED_KEYS = new Set(['ringSpacing', 'lineWidth']);

// Пункты раздела «Вращение»: при любом изменении превью начинается заново (без плавного появления)
const ROTATION_KEYS = new Set(['spin', 'spinBalance', 'smoothFlip']);

const CSS = `
.asmr-menu{position:fixed;inset:0;z-index:10;overflow-y:auto;display:flex;justify-content:center;align-items:flex-start;
  padding:28px 12px 40px;box-sizing:border-box;background:radial-gradient(ellipse at 50% 0%,#151a2b 0%,#07080d 70%);
  color:#e8eaf2;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.asmr-panel{width:min(520px,100%);margin:auto 0}
.asmr-panel h1{margin:0 0 4px;font-size:22px;font-weight:600;text-align:center;letter-spacing:.02em}
.asmr-panel p{margin:0 0 12px;text-align:center;font-size:13px;opacity:.55}
.asmr-top{display:flex;gap:8px;margin:0 0 6px}
.asmr-top button{flex:1;padding:11px 8px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);
  color:#fff;font:500 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;transition:background .15s}
.asmr-top button:hover{background:rgba(255,255,255,.12)}
.asmr-menu .sec{margin:18px 14px 4px;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;opacity:.45}
.asmr-menu .row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:11px 14px;border-radius:12px;transition:background .15s}
.asmr-menu .row.active{background:rgba(255,255,255,.07)}
.asmr-menu .row label{order:1;flex:1 1 0;min-width:0;font-size:14px}
.asmr-menu .row label small{display:block;margin-top:2px;font-size:11px;opacity:.45}
.asmr-menu .row .val{order:2;text-align:right;font-size:13px;opacity:.65;font-variant-numeric:tabular-nums;white-space:nowrap}
.asmr-menu .row .ctl{order:2;flex:none}
.asmr-menu .row .acts{order:3;display:flex;gap:4px;flex:none}
.asmr-menu .row .acts button{width:28px;height:28px;padding:0;border-radius:8px;border:1px solid rgba(255,255,255,.16);
  background:rgba(255,255,255,.05);color:#fff;font-size:14px;line-height:1;cursor:pointer;transition:background .15s}
.asmr-menu .row .acts button:hover{background:rgba(255,255,255,.14)}
.asmr-menu .row input[type=range]{order:5;flex:1 1 100%;width:100%;margin:0;accent-color:#8aa4ff}
.asmr-menu .row input[type=color]{width:46px;height:30px;padding:0;border:1px solid rgba(255,255,255,.25);border-radius:8px;background:none;cursor:pointer}
.asmr-menu .row input.switch{appearance:none;-webkit-appearance:none;width:44px;height:24px;border-radius:12px;background:#323850;position:relative;cursor:pointer;transition:background .2s;margin:0}
.asmr-menu .row input.switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s}
.asmr-menu .row input.switch:checked{background:#6f8cff}
.asmr-menu .row input.switch:checked::after{transform:translateX(20px)}
.gbody{order:5;flex:1 1 100%;display:flex;flex-direction:column;gap:12px;padding:4px 0 6px}
.gbar{height:44px;margin:0 22px;border-radius:22px;border:1px solid rgba(255,255,255,.22)}
.gtrack{position:relative;height:54px;margin:0 22px}
.ghandle{position:absolute;top:8px;width:44px;height:44px;margin-left:-22px;padding:5px;box-sizing:border-box;border-radius:14px;
  border:3px solid rgba(220,190,255,.4);background:#1c1626;cursor:grab;touch-action:none}
.ghandle i{display:block;width:100%;height:100%;border-radius:8px}
.ghandle::before{content:"";position:absolute;top:-12px;left:50%;margin-left:-6px;border:6px solid transparent;border-bottom-color:rgba(220,190,255,.4)}
.ghandle.sel{border-color:#e0b8ff;z-index:2}
.ghandle.sel::before{border-bottom-color:#e0b8ff}
.ghandle:active{cursor:grabbing}
.ginfo{display:flex;align-items:center;gap:10px;font-size:13px;color:#d9c3ee}
.ginfo span{flex:1;min-width:0}
.ginfo input[type=color]{flex:none}
.gbtns{display:flex;gap:8px}
.gbtns button{flex:1;padding:12px 6px;border:0;border-radius:14px;background:#4a3359;color:#fff;font:500 14px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}
.gbtns button:disabled{opacity:.38;cursor:default;background:#2d2438}
.gsmooth{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:14px;background:#2d2438;font-size:14px}
.gsmooth label{flex:1}
.gsmooth small{display:block;margin-top:2px;font-size:11px;opacity:.5}
.gsmooth input.switch{appearance:none;-webkit-appearance:none;width:44px;height:24px;border-radius:12px;background:#4a3a5c;position:relative;cursor:pointer;transition:background .2s;margin:0;flex:none}
.gsmooth input.switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s}
.gsmooth input.switch:checked{background:#c79bff}
.gsmooth input.switch:checked::after{transform:translateX(20px);background:#3b0b6b}
.asmr-start{display:block;width:100%;margin-top:22px;padding:15px;border:0;border-radius:14px;font-size:16px;font-weight:600;
  color:#07080d;background:#fff;cursor:pointer;transition:transform .1s,opacity .2s}
.asmr-start:hover{opacity:.9}.asmr-start:active{transform:scale(.98)}
.asmr-start:disabled{opacity:.35;cursor:default}
.asmr-fast{display:block;width:100%;margin-top:10px;padding:14px;border-radius:14px;border:1px solid rgba(255,255,255,.28);
  background:rgba(255,255,255,.07);color:#fff;font:600 15px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;
  transition:background .15s,transform .1s}
.asmr-fast:hover{background:rgba(255,255,255,.14)}.asmr-fast:active{transform:scale(.98)}
.asmr-fast.busy{border-color:rgba(255,138,138,.6);color:#ffb4b4}
.asmr-status{min-height:18px;margin-top:10px;font-size:12px;line-height:1.5;text-align:center;opacity:.65;
  font-variant-numeric:tabular-nums;white-space:pre-line}
.asmr-status.err{color:#ff9a9a;opacity:1}
.asmr-preview{position:fixed;z-index:11;display:none;box-sizing:border-box;border-radius:16px;background:#000;
  border:1px solid rgba(255,255,255,.18);box-shadow:0 10px 40px rgba(0,0,0,.6);pointer-events:none}
.asmr-back{position:fixed;z-index:20;top:12px;left:12px;display:none;padding:9px 16px;border:1px solid rgba(255,255,255,.22);
  border-radius:12px;background:rgba(20,22,32,.55);color:#fff;font:500 14px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:.75;transition:opacity .2s}
.asmr-back:hover{opacity:1}
`;
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));

const el = (tag, cls, props) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (props) Object.assign(e, props);
  return e;
};

const menu = el('div', 'asmr-menu');
const panel = el('div', 'asmr-panel');
panel.innerHTML = '<h1>ASMR Physics</h1><p>Настройте параметры и запустите рендеринг</p>';
menu.appendChild(panel);

// ── Превью ──
let activeRow = null;
let previewOn = false;

function placePreview(row) {
  const pr = panel.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const gap = 16, s = PREVIEW_SIZE;
  const midTop = Math.min(Math.max(rr.top + rr.height / 2 - s / 2, 8), window.innerHeight - s - 8);
  let left, top;
  if (window.innerWidth - pr.right >= s + gap) {
    left = pr.right + gap; top = midTop;
  } else if (pr.left >= s + gap) {
    left = pr.left - gap - s; top = midTop;
  } else {
    left = window.innerWidth - s - 8; top = 8;   // узкий экран: в правом верхнем углу
  }
  previewCanvas.style.left = left + 'px';
  previewCanvas.style.top = top + 'px';
}

// Первый показ — запуск превью с анимацией появления; дальше только мягкие обновления без перезапуска
function syncPreview(key) {
  const o = { mode: FIXED_KEYS.has(key) ? 'cut' : 'full', scene: SCENES[key] };
  if (previewOn) {
    preview.update(settings, o, ROTATION_KEYS.has(key));
  } else {
    preview.configure(settings, o);
    previewCanvas.style.display = 'block';
    preview.start();
    previewOn = true;
  }
}

function stopPreview() {
  previewOn = false;
  previewCanvas.style.display = 'none';
  preview.stop();
}

function activate(row, key, changed) {
  if (activeRow !== row) {
    if (activeRow) activeRow.classList.remove('active');
    activeRow = row;
    row.classList.add('active');
    changed = true;
  }
  if (!changed) return;
  if (!SCENES[key]) { stopPreview(); return; }   // у «Эффектов» превью нет
  syncPreview(key);
  placePreview(row);
}

function hidePreview() {
  if (activeRow) activeRow.classList.remove('active');
  activeRow = null;
  stopPreview();
}

// ── Случайные и начальные значения ──
function randomStops(hue) {
  const n = 2 + Math.floor(Math.random() * 4);               // 2–5 точек
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
  if (def.type === 'range') {
    const n = Math.floor((def.max - def.min) / def.step);
    return parseFloat((def.min + Math.floor(Math.random() * (n + 1)) * def.step).toFixed(4));
  }
  if (def.type === 'toggle') return Math.random() < 0.5;
  if (def.type === 'color') return hue ? randomHueColor() : randomAnyColor();
  return randomStops(hue);                                    // gradient
}

function initialValue(def) {
  if (def.type === 'gradient') {
    return { stops: JSON.parse(JSON.stringify(INITIAL[def.key])), smooth: INITIAL[def.smoothKey], edited: false };
  }
  return INITIAL[def.key];
}

// ── Редактор градиента (точки можно добавлять, двигать и удалять) ──
const MAX_STOPS = 16;

function buildGradientEditor(onChange, K) {
  const wrap = el('div', 'gbody');
  const bar = el('div', 'gbar');
  const track = el('div', 'gtrack');

  const info = el('div', 'ginfo');
  const infoText = el('span');
  const picker = el('input', '', { type: 'color' });
  info.append(infoText, picker);

  const btns = el('div', 'gbtns');
  const addBtn = el('button', '', { type: 'button', textContent: '+ Добавить точку' });
  const delBtn = el('button', '', { type: 'button', textContent: '− Удалить точку' });
  btns.append(addBtn, delBtn);

  const smoothRow = el('div', 'gsmooth');
  const smoothLabel = el('label', '', { htmlFor: 'f-' + K.smooth, textContent: 'Плавный градиент' });
  smoothLabel.appendChild(el('small', '', { textContent: 'выключено — «классика»: цвета без перехода' }));
  const smoothInput = el('input', 'switch', { id: 'f-' + K.smooth, type: 'checkbox' });
  smoothRow.append(smoothLabel, smoothInput);

  wrap.append(bar, track, info, btns, smoothRow);

  let selected = null;
  let handles = [];                                          // [{ stop, node }]
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
    infoText.textContent = `Точка ${order.indexOf(selected) + 1}/${order.length} · Позиция ${Math.round(selected.pos * 100)}% · ${selected.color.toUpperCase()}`;
    picker.value = selected.color;
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
        try { node.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }
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

  picker.addEventListener('input', () => {
    selected.color = picker.value;
    updateVisuals();
    changed();
  });

  addBtn.addEventListener('click', () => {
    if (stops().length >= MAX_STOPS) return;
    const st = sorted();
    const pts = [0, ...st.map((x) => x.pos), 1];
    let best = { gap: -1, pos: 0.5 };                        // середина самого большого промежутка
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

  // v = { stops, smooth, edited }
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

// ── Строки настроек ──
const controls = {};     // key → { row, set(v) }
const visibles = [];     // строки, показываемые по условию

function refreshVisibility() {
  visibles.forEach((v) => { v.row.style.display = v.fn(settings) ? '' : 'none'; });
}

// Любое изменение значения: обновить видимость зависимых строк и превью
function commit(key) {
  refreshVisibility();
  activate(controls[key].row, key, true);
}

function makeRow(def) {
  const row = el('div', 'row');
  const id = 'f-' + def.key;
  const label = el('label', '', { htmlFor: id, textContent: def.label });
  if (def.hint) label.appendChild(el('small', '', { textContent: def.hint }));
  row.appendChild(label);

  let set;
  if (def.type === 'range') {
    const input = el('input', '', { id, type: 'range', min: def.min, max: def.max, step: def.step, value: settings[def.key] });
    const val = el('span', 'val', { textContent: def.fmt(settings[def.key]) });
    set = (v) => { settings[def.key] = v; input.value = v; val.textContent = def.fmt(v); };
    input.addEventListener('input', () => { set(parseFloat(input.value)); commit(def.key); });
    row.append(val, input);
  } else if (def.type === 'color') {
    const input = el('input', 'ctl', { id, type: 'color', value: settings[def.key] });
    set = (v) => { settings[def.key] = v; input.value = v; };
    input.addEventListener('input', () => { set(input.value); commit(def.key); });
    row.appendChild(input);
  } else if (def.type === 'toggle') {
    const input = el('input', 'switch ctl', { id, type: 'checkbox', checked: settings[def.key] });
    set = (v) => { settings[def.key] = v; input.checked = v; };
    input.addEventListener('change', () => {
      set(input.checked);
      // впервые открыли расширенный редактор — берём точки из текущих двух цветов
      if (def.adv && input.checked && !settings[def.adv.stops + 'Edited']) {
        controls[def.adv.stops].set({
          stops: [{ pos: 0, color: settings[def.adv.c1] }, { pos: 1, color: settings[def.adv.c2] }],
          smooth: true, edited: false,
        });
      }
      // включили звук — клик это жест пользователя, звук разрешён; играем пробную ноту
      if (def.key === 'sound' && input.checked) {
        unlockAudio();
        setTimeout(() => playNote(7, 0.15, 0.6), 80);
      }
      commit(def.key);
    });
    row.appendChild(input);
  } else {
    const editor = buildGradientEditor(() => commit(def.key), { stops: def.key, smooth: def.smoothKey, edited: def.editedKey });
    set = (v) => editor.set(v);
    row.appendChild(editor.node);
  }
  controls[def.key] = { row, set };

  // Кнопки строки: сбросить / рандомизировать (/ рандомизировать по hue для цветов)
  const acts = el('div', 'acts');
  const addAct = (text, title, fn) => {
    const b = el('button', '', { type: 'button', textContent: text, title });
    b.setAttribute('aria-label', title);
    b.addEventListener('click', fn);
    acts.appendChild(b);
  };
  addAct('↺', 'Сбросить до значения при запуске', () => { set(initialValue(def)); commit(def.key); });
  addAct('🎲', 'Рандомизировать', () => { set(randomValue(def, false)); commit(def.key); });
  if (def.type === 'color' || def.type === 'gradient') {
    addAct('🌈', 'Рандомизировать по hue (максимальная насыщенность)', () => { set(randomValue(def, true)); commit(def.key); });
  }
  label.after(acts);

  row.addEventListener('pointerdown', () => activate(row, def.key, false));
  row.addEventListener('focusin', () => activate(row, def.key, false));
  if (def.visible) visibles.push({ row, fn: def.visible });
  return row;
}

// Кнопки сверху
const topBar = el('div', 'asmr-top');
const randAllBtn = el('button', '', { type: 'button', textContent: '🎲 Рандомизировать всё' });
const resetAllBtn = el('button', '', { type: 'button', textContent: '↺ Сбросить всё' });
topBar.append(randAllBtn, resetAllBtn);
panel.appendChild(topBar);

FIELDS.forEach((def) => {
  if (def.section) panel.appendChild(el('div', 'sec', { textContent: def.section }));
  else panel.appendChild(makeRow(def));
});
refreshVisibility();

randAllBtn.addEventListener('click', () => {
  FIELDS.forEach((def) => {
    if (!def.section && !def.noRandomAll) controls[def.key].set(randomValue(def, false));
  });
  refreshVisibility();
  hidePreview();
});
resetAllBtn.addEventListener('click', () => {
  FIELDS.forEach((def) => {
    if (!def.section) controls[def.key].set(initialValue(def));
  });
  refreshVisibility();
  hidePreview();
});

const startBtn = el('button', 'asmr-start', { type: 'button', textContent: 'Начать рендеринг' });
panel.appendChild(startBtn);

// Самая нижняя кнопка: скоростная запись в MP4 (логика — в блоке «Скоростная запись» ниже)
const FAST_LABEL = '⚡ Скоростная запись в MP4';
const fastBtn = el('button', 'asmr-fast', { type: 'button', textContent: FAST_LABEL });
panel.append(fastBtn);

const backBtn = el('button', 'asmr-back', { type: 'button', textContent: '← Назад' });

document.body.append(menu, previewCanvas, backBtn);

// Клик вне строк настроек скрывает превью; прокрутка меню переносит превью вслед за строкой
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.row')) hidePreview();
});
menu.addEventListener('scroll', () => { if (activeRow) placePreview(activeRow); });
window.addEventListener('resize', () => {
  hidePreview();
  if (menu.style.display === 'none') mainSim.resize();
});

// ── Приближение: колёсико мыши / щипок на тачскрине ──
mainCanvas.addEventListener('wheel', (e) => {
  if (menu.style.display !== 'none') return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;     // строки / страницы → пиксели
  const k = e.ctrlKey ? 0.01 : 0.0015;                                    // ctrl+колёсико = щипок на тачпаде
  mainSim.zoomBy(Math.exp(-e.deltaY * unit * k));
}, { passive: false });

const touches = new Map();
let pinchDist = 0;
const touchDist = () => {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
mainCanvas.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { mainCanvas.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }
  if (touches.size === 2) pinchDist = touchDist();
});
mainCanvas.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    const d = touchDist();
    if (pinchDist > 0 && d > 0) mainSim.zoomBy(d / pinchDist, true);
    pinchDist = d;
  }
});
const endTouch = (e) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinchDist = 0;
};
mainCanvas.addEventListener('pointerup', endTouch);
mainCanvas.addEventListener('pointercancel', endTouch);

function startRender() {
  unlockAudio();                 // клик по кнопке — жест пользователя, звук разрешён
  hidePreview();
  menu.style.display = 'none';
  backBtn.style.display = 'block';
  mainSim.configure(settings, { mode: 'full' });
  mainSim.resetZoom();
  mainSim.resize();
  mainSim.start();
}

// Настройки живут в объекте settings и в самих полях меню — при возврате ничего не сбрасывается
function backToMenu() {
  mainSim.stop();
  backBtn.style.display = 'none';
  menu.style.display = 'flex';
}

startBtn.addEventListener('click', startRender);
backBtn.addEventListener('click', backToMenu);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.style.display === 'none' && recScreen.style.display === 'none') backToMenu();
});

// ───────────────────────────── Скоростная запись в MP4 ─────────────────────────────
// Сцена считается и рисуется БЕЗ привязки к реальным часам — кадр за кадром с фиксированным шагом 1/60 с — настолько быстро,
// насколько позволяет железо. Каждый кадр сразу уходит в аппаратный H.264-кодировщик (WebCodecs), а метки времени
// проставляются по номеру кадра (i / 60 с) — поэтому в готовом файле всё идёт в обычной скорости, а не ускоренно.
// Звук собирается отдельно: все столкновения запоминаются с временем симуляции и синтезируются в OfflineAudioContext (AAC).
// «Чтобы железо не сошло с ума»: очередь кодировщика ограничена (если он не успевает — рендер ждёт), работа идёт короткими
// слайсами по ~12 мс с отдачей управления браузеру, видео квадратное 1:1 (сцена вписана в кадр без чёрных полей), длина — не больше REC_MAX_SECONDS.
const REC_FPS = 60;
const REC_SIDES = [1080, 720, 480];   // сторона квадратного кадра: пробуем по порядку, пока кодировщик не согласится
const REC_MAX_SECONDS = 120;          // предохранитель: если шарик так и не выбрался, запись остановится сама
const REC_MAX_INFLIGHT = 6;           // сколько кадров максимум может быть «в полёте» (отправлено в кодировщик, но ещё не вышло из него)
const REC_AUDIO_RATE = 48000;
const MUXER_URLS = [
  'https://cdn.jsdelivr.net/npm/mp4-muxer@5/build/mp4-muxer.js',
  'https://unpkg.com/mp4-muxer@5/build/mp4-muxer.js',
];

class RecCancelled extends Error {}
let recJob = null;

// ── Экран записи ──
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
.asmr-rec{position:fixed;inset:0;z-index:30;display:none;overflow-y:auto;justify-content:center;align-items:flex-start;
  padding:24px 12px 32px;box-sizing:border-box;background:radial-gradient(ellipse at 50% 0%,#151a2b 0%,#07080d 70%);
  color:#e8eaf2;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.rec-box{width:min(560px,100%);margin:auto 0;display:flex;flex-direction:column;gap:14px}
.rec-box h2{margin:0;font-size:20px;font-weight:600;text-align:center}
.rec-view{align-self:center;width:min(100%,440px,44vh);aspect-ratio:1/1;border-radius:16px;background:#000;border:1px solid rgba(255,255,255,.18)}
.rec-prog{display:flex;justify-content:space-between;gap:10px;font-size:13px;opacity:.8;font-variant-numeric:tabular-nums}
.rec-bar{height:12px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden;margin-top:-6px}
.rec-fill{height:100%;width:0;border-radius:6px;background:linear-gradient(90deg,#6f8cff,#c79bff);transition:width .15s}
.rec-phase{min-height:18px;font-size:13px;line-height:1.5;text-align:center;white-space:pre-line;opacity:.7}
.rec-phase.err{color:#ff9a9a;opacity:1}
.rec-info{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.rec-cell{padding:9px 12px;border-radius:12px;background:rgba(255,255,255,.05);min-width:0}
.rec-cell small{display:block;margin-bottom:2px;font-size:11px;opacity:.45}
.rec-cell b{font-weight:500;font-size:14px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.rec-warn{padding:10px 14px;border-radius:12px;background:rgba(255,196,87,.1);border:1px solid rgba(255,196,87,.3);
  color:#ffd68a;font-size:12.5px;line-height:1.5}
.rec-box .asmr-fast{margin-top:0}
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
[['codec', 'Кодировщик'], ['res', 'Разрешение'], ['size', 'Размер записи'], ['video', 'Длина видео'],
  ['speed', 'Скорость'], ['eta', 'Осталось']].forEach(([key, label]) => {
  const cell = el('div', 'rec-cell');
  const small = el('small', '', { textContent: label });
  recCells[key] = el('b', '', { textContent: '—' });
  cell.append(small, recCells[key]);
  recInfo.appendChild(cell);
});
const recWarn = el('div', 'rec-warn', {
  textContent: '⚠ Съёмка может занять до 2 минут. Не закрывайте и не обновляйте сайт, пока идёт запись — иначе она пропадёт.',
});
const recStop = el('button', 'asmr-fast busy', { type: 'button', textContent: '■ Остановить запись' });
const recAgain = el('button', 'asmr-fast', { type: 'button', textContent: '⬇ Скачать ещё раз' });
const recBack = el('button', 'asmr-fast', { type: 'button', textContent: '← Назад в меню' });
const recProg = el('div', 'rec-prog');
recProg.append(recRings, recPct);
const recBar = el('div', 'rec-bar');
recBar.appendChild(recFill);
const recBox = el('div', 'rec-box');
recBox.append(el('h2', '', { textContent: 'Скоростная запись' }), recView, recProg, recBar, recPhase, recInfo, recWarn, recStop, recAgain, recBack);
recScreen.appendChild(recBox);
document.body.appendChild(recScreen);

const recLast = { url: null, name: '' };   // готовый файл — для кнопки «Скачать ещё раз»

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
  if (recLast.url) { URL.revokeObjectURL(recLast.url); recLast.url = null; }
  menu.style.display = 'none';
  recScreen.style.display = 'flex';
  Object.values(recCells).forEach((c) => { c.textContent = '—'; });
  setProgress(0, 'Колец осталось: —');
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
  recAgain.style.display = recLast.url ? 'block' : 'none';
}

recStop.addEventListener('click', () => {
  if (!recJob) return;
  recJob.cancel = true;
  recStop.disabled = true;
  recStop.textContent = 'Останавливаю…';
});
recAgain.addEventListener('click', () => { if (recLast.url) downloadUrl(recLast.url, recLast.name); });
recBack.addEventListener('click', () => {
  if (recJob) return;
  if (recLast.url) { URL.revokeObjectURL(recLast.url); recLast.url = null; }
  recScreen.style.display = 'none';
  menu.style.display = 'flex';
});

const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };

const setStatus = (text, isErr) => {
  recPhase.textContent = text;
  recPhase.classList.toggle('err', !!isErr);
};

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('не загрузился ' + url)); };
    document.head.appendChild(s);
  });
}

async function loadMuxer() {
  if (window.Mp4Muxer) return;
  for (const url of MUXER_URLS) {
    try { await loadScript(url); if (window.Mp4Muxer) return; } catch (_) { /* пробуем следующий */ }
  }
  throw new Error('Не удалось загрузить библиотеку mp4-muxer — проверьте интернет.');
}

// Отдача управления без задержки таймеров (MessageChannel не душится в фоновой вкладке так, как setTimeout)
const yieldChannel = new MessageChannel();
let yieldResolve = null;
yieldChannel.port1.onmessage = () => { const r = yieldResolve; yieldResolve = null; if (r) r(); };
const yieldNow = () => new Promise((r) => { yieldResolve = r; yieldChannel.port2.postMessage(0); });
const yieldPaint = () => new Promise((r) => setTimeout(r, 0));   // даём браузеру успеть отрисовать статус

// Ждём, пока кодировщик разгребёт очередь (с таймаутом на случай, если событие dequeue не поддерживается)
const waitDequeue = (enc) => new Promise((resolve) => {
  let done = false;
  const fin = () => { if (done) return; done = true; enc.removeEventListener('dequeue', fin); resolve(); };
  enc.addEventListener('dequeue', fin);
  setTimeout(fin, 50);
});

// Кодеки по порядку предпочтения: H.264 (работает везде), запасные — VP9 и AV1 (в Firefox на Linux H.264 обычно нет).
// mux — имя кодека для mp4-muxer.
const VIDEO_CODECS = [
  { codec: 'avc1.640033', mux: 'avc' },
  { codec: 'avc1.64002A', mux: 'avc' },
  { codec: 'avc1.4D0033', mux: 'avc' },
  { codec: 'avc1.42E01F', mux: 'avc' },
  { codec: 'vp09.00.41.08', mux: 'vp9' },
  { codec: 'vp09.00.50.08', mux: 'vp9' },
  { codec: 'av01.0.09M.08', mux: 'av1' },
];
const AUDIO_CODECS = [
  { codec: 'mp4a.40.2', mux: 'aac' },
  { codec: 'opus', mux: 'opus' },
];

// isConfigSupported иногда обещает больше, чем браузер умеет, поэтому проверяем по-настоящему: кодируем один пробный кадр
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
    try { if (enc && enc.state !== 'closed') enc.close(); } catch (_) { /* уже закрыт */ }
  }
}

// Ищем рабочее сочетание кодек + разрешение. Кадр квадратный: сцена круглая, и так в видео нет лишних чёрных полей по бокам
async function pickVideo() {
  for (const side of REC_SIDES) {
    const W = side, H = side;
    const bitrate = Math.round(W * H * 4);                      // ≈ 4.7 Мбит/с для 1080×1080
    for (const c of VIDEO_CODECS) {
      const cfg = { codec: c.codec, width: W, height: H, bitrate, framerate: REC_FPS, latencyMode: 'realtime' };
      if (await probeVideo(cfg)) return { cfg, mux: c.mux, W, H };
    }
  }
  return null;
}

// Синтез звука столкновений офлайн: быстрее реального времени, длина ровно по видео
async function renderAudioOffline(events, seconds) {
  const length = Math.max(1, Math.ceil(seconds * REC_AUDIO_RATE));
  const oc = new OfflineAudioContext(2, length, REC_AUDIO_RATE);
  for (const e of events) scheduleNote(oc, e.t, e.k, e.vol, e.dur);
  return oc.startRendering();
}

async function recordFast() {
  const job = { cancel: false };
  recJob = job;
  recOpen();
  hidePreview();

  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    setStatus('Этот браузер не поддерживает WebCodecs. Откройте сайт в Chrome, Edge или свежем Firefox.', true);
    recJob = null;
    recFinish();
    return;
  }
  window.addEventListener('beforeunload', onUnload);

  let venc = null, aenc = null, recSim = null;
  const checkAbort = () => { if (job.cancel) throw new RecCancelled(); };

  try {
    setStatus('Подготовка…');
    await yieldPaint();
    await loadMuxer();
    checkAbort();

    const snap = JSON.parse(JSON.stringify(settings));      // снимок настроек: правки меню во время записи не влияют

    setStatus('Подбираю кодек…');
    await yieldPaint();
    const vsel = await pickVideo();
    if (!vsel) throw new Error('Браузер не смог запустить ни один видеокодек (пробовал H.264, VP9, AV1).');
    const vcfg = vsel.cfg, W = vsel.W, H = vsel.H;
    recCells.codec.textContent = `${vsel.mux.toUpperCase()} (${vcfg.codec})`;
    recCells.res.textContent = `${W}×${H} · ${REC_FPS} кадр/с`;
    checkAbort();

    let acfg = null, audioMux = null;
    if (snap.sound && 'AudioEncoder' in window && 'OfflineAudioContext' in window) {
      for (const c of AUDIO_CODECS) {
        const cfg = { codec: c.codec, sampleRate: REC_AUDIO_RATE, numberOfChannels: 2, bitrate: 128000 };
        try {
          if ((await AudioEncoder.isConfigSupported(cfg)).supported) { acfg = cfg; audioMux = c.mux; break; }
        } catch (_) { /* следующий кодек */ }
      }
    }
    const wantAudio = !!acfg;
    const audioSkipped = snap.sound && !wantAudio;

    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxerOpts = { target, video: { codec: vsel.mux, width: W, height: H }, fastStart: 'in-memory' };
    if (wantAudio) muxerOpts.audio = { codec: audioMux, numberOfChannels: 2, sampleRate: REC_AUDIO_RATE };
    const muxer = new Mp4Muxer.Muxer(muxerOpts);

    let encError = null;
    let inflight = 0;                                       // свой счётчик кадров в кодировщике (encodeQueueSize в Firefox ненадёжен)
    let bytes = 0;                                          // сколько уже весит запись
    venc = new VideoEncoder({
      output: (chunk, meta) => {
        inflight--;
        bytes += chunk.byteLength;
        // VP9/AV1: muxer берёт цветовое пространство из decoderConfig, а Firefox его может не отдавать
        if (vsel.mux !== 'avc' && meta && meta.decoderConfig && !meta.decoderConfig.colorSpace) {
          meta = { ...meta, decoderConfig: { ...meta.decoderConfig, colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } } };
        }
        muxer.addVideoChunk(chunk, meta);
      },
      error: (e) => { encError = e; },
    });
    venc.configure(vcfg);

    // Отдельная невидимая сцена: то, что на экране, не трогаем. Кадр квадратный — сцена вписана без чёрных полей
    const recCanvas = document.createElement('canvas');
    recSim = createSim(recCanvas, { getSize: () => [W, H], dpr: 1, particles: 1200, burst: 70, audio: true });
    recSim.configure(snap, { mode: 'full' });
    recSim.resize();
    const events = [];
    recSim.beginCapture(events);

    // ── Видео: кадры считаются на максимальной скорости ──
    const dt = 1 / REC_FPS;
    const frameDur = Math.round(1e6 / REC_FPS);
    const wallStart = performance.now();
    let sliceStart = wallStart, lastUi = 0, frame = 0, capped = false, etaSmooth = null;

    const refreshUi = (now) => {
      const { done, total } = recSim.progress();
      const p = total ? done / total : 0;
      const vSec = frame / REC_FPS, wSec = Math.max(0.001, (now - wallStart) / 1000);
      let eta = 'считаю…';
      if (p > 0.03 && wSec > 3) {
        const raw = (wSec * (1 - p)) / p;                   // грубая оценка: по доле разрушенных колец
        etaSmooth = etaSmooth == null ? raw : etaSmooth * 0.85 + raw * 0.15;
        eta = '≈ ' + fmtDuration(etaSmooth);
      }
      setProgress(p, `Колец осталось: ${total - done} из ${total}`);
      recCells.size.textContent = (bytes / 1048576).toFixed(1) + ' МБ';
      recCells.video.textContent = vSec.toFixed(1) + ' с';
      recCells.speed.textContent = '×' + (vSec / wSec).toFixed(1);
      recCells.eta.textContent = eta;
      recViewCtx.drawImage(recCanvas, 0, 0, recView.width, recView.height);   // «окошко» в то, что сейчас считается
    };

    setStatus('Идёт запись: кадры считаются быстрее реального времени.');

    for (;;) {
      checkAbort();
      if (encError) throw encError;

      if (!recSim.advance(dt)) break;                       // полный цикл сцены записан

      const vf = new VideoFrame(recCanvas, { timestamp: Math.round((frame * 1e6) / REC_FPS), duration: frameDur });
      venc.encode(vf, { keyFrame: frame % (REC_FPS * 2) === 0 });
      vf.close();
      frame++;

      if (frame / REC_FPS >= REC_MAX_SECONDS) { capped = true; break; }

      // кодировщик не успевает — ждём, пока он разгребёт очередь (иначе кадры копятся в памяти и система зависает)
      inflight++;
      const stallStart = performance.now();
      while (inflight >= REC_MAX_INFLIGHT) {
        checkAbort();
        if (encError) throw encError;
        if (performance.now() - stallStart > 15000) throw new Error('Кодировщик завис: 15 с без результата.');
        await new Promise((r) => setTimeout(r, 4));
      }

      const now = performance.now();
      if (now - sliceStart > 12) {
        if (now - lastUi > 150) {
          lastUi = now;
          refreshUi(now);
          await yieldPaint();
        } else {
          await yieldNow();
        }
        sliceStart = performance.now();
      }
    }
    recSim.endCapture();
    setProgress(1, 'Колец осталось: 0');
    recCells.eta.textContent = '—';

    checkAbort();
    setStatus('Досчитываю видео…');
    await venc.flush();
    if (encError) throw encError;
    venc.close();
    venc = null;
    recCells.size.textContent = (bytes / 1048576).toFixed(1) + ' МБ';
    recCells.video.textContent = (frame / REC_FPS).toFixed(1) + ' с';

    const seconds = frame / REC_FPS;

    // ── Звук ──
    if (wantAudio) {
      setStatus('Синтезирую звук…');
      await yieldPaint();
      const buf = await renderAudioOffline(events, seconds);
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
      for (let off = 0; off < buf.length; off += CHUNK) {
        checkAbort();
        if (encError) throw encError;
        const n = Math.min(CHUNK, buf.length - off);
        const data = new Float32Array(n * 2);                // planar: сначала левый канал, потом правый
        for (let i = 0; i < n; i++) { data[i] = clamp(c0[off + i]); data[n + i] = clamp(c1[off + i]); }
        const ad = new AudioData({
          format: 'f32-planar', sampleRate: REC_AUDIO_RATE, numberOfFrames: n, numberOfChannels: 2,
          timestamp: Math.round((off / REC_AUDIO_RATE) * 1e6), data,
        });
        aenc.encode(ad);
        ad.close();
        if (aenc.encodeQueueSize > 16) await waitDequeue(aenc);
      }
      await aenc.flush();
      if (encError) throw encError;
      aenc.close();
      aenc = null;
    }

    // ── Готовый файл → загрузка в браузере ──
    setStatus('Собираю MP4…');
    await yieldPaint();
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    recLast.url = url;
    recLast.name = `asmr-physics-${W}x${H}.mp4`;
    downloadUrl(url, recLast.name);
    recCells.size.textContent = (blob.size / 1048576).toFixed(1) + ' МБ';

    const wall = (performance.now() - wallStart) / 1000;
    setStatus(
      `Готово: ${seconds.toFixed(1)} с видео за ${wall.toFixed(1)} с (×${(seconds / wall).toFixed(1)}), ${(blob.size / 1048576).toFixed(1)} МБ. Файл скачан.` +
      (capped ? `\nДостигнут лимит ${REC_MAX_SECONDS} с — запись остановлена.` : '') +
      (audioSkipped ? '\nЗвук не записан: браузер не умеет кодировать AAC/Opus.' : ''),
    );
  } catch (err) {
    if (err instanceof RecCancelled) setStatus('Запись остановлена.');
    else { console.error(err); setStatus('Ошибка записи: ' + ((err && (err.name ? err.name + ': ' : '') + err.message) || err), true); }
  } finally {
    if (recSim) recSim.endCapture();
    try { if (venc && venc.state !== 'closed') venc.close(); } catch (_) { /* уже закрыт */ }
    try { if (aenc && aenc.state !== 'closed') aenc.close(); } catch (_) { /* уже закрыт */ }
    window.removeEventListener('beforeunload', onUnload);
    recJob = null;
    recFinish();
  }
}

fastBtn.addEventListener('click', () => {
  if (!recJob) recordFast();
});