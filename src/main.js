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
  spinDir: 2,         // сторона вращения: 0 — по часовой, 1 — против часовой, 2 — чередуется (разворот при каждом разрушенном кольце)
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

// Телефон / планшет (основной указатель — палец). Для них упрощаем графику и пересобираем часть интерфейса
const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
// На случай, если в HTML нет мета-тега viewport: без него мобильный браузер рисует страницу как десктопную и мелко
if (!document.querySelector('meta[name="viewport"]')) {
  const m = document.createElement('meta');
  m.name = 'viewport';
  m.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
  document.head.appendChild(m);
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
  // iOS: по умолчанию Web Audio молчит при включённом беззвучном режиме — просим «воспроизведение»
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { /* не критично */ }
  // 'suspended' — до первого жеста, 'interrupted' — после звонка / сворачивания на iOS
  if (audioCtx.state !== 'running') { const p = audioCtx.resume(); if (p && p.catch) p.catch(() => {}); }
}

// Контекст мог уснуть (звонок, фон, блокировка): любое касание или возврат на вкладку его будит
function wakeAudio() {
  if (audioCtx && audioCtx.state !== 'running') { const p = audioCtx.resume(); if (p && p.catch) p.catch(() => {}); }
}
document.addEventListener('pointerdown', wakeAudio, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) wakeAudio(); });

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

let voices = 0;
const MAX_VOICES = COARSE ? 14 : 28;   // сколько нот звучит одновременно: на телефоне больше — трески и просадки кадров
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
  const startDir = () => (cfg && cfg.spinDir === 1 ? -1 : 1);   // начальное направление: против часовой — минус
  let running = false, raf = 0, last = 0, acc = 0;
  let zoom = 1, zoomTarget = 1;   // приближение камеры (колёсико / щипок)
  let dprAuto = Math.min(window.devicePixelRatio || 1, COARSE ? 2 : 2.5);   // при просадках FPS (opts.adaptive) понижается сам
  let slowFrames = 0;
  let trailBox = null;            // «грязный» прямоугольник буфера следа — очищаем и выводим только его
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
      state.dir = state.dirTarget = startDir();
      state.flipT = 0;
    }
    if (reset) {
      // сброс в самое начало рендеринга: отверстия наверху, направление исходное, без анимации появления
      for (let i = 0; i < rings.length; i++) rings[i].rot = -Math.PI / 2;
      state.dir = state.dirTarget = startDir();
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
        if (cfg.spinDir === 2) {                            // режим «Чередуется»: смена направления вращения у всех колец
          state.dirTarget = -state.dirTarget;
          if (!cfg.smoothFlip) state.dir = state.dirTarget; // без плавности — мгновенно
        }
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
    if (trailCanvas.width !== W || trailCanvas.height !== H) { trailCanvas.width = W; trailCanvas.height = H; trailBox = null; }
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    if (trailBox) tctx.clearRect(trailBox.x, trailBox.y, trailBox.w, trailBox.h);   // не весь экран, а только то, где был след
    tctx.setTransform(scale, 0, 0, scale, W / 2, H / 2);
    tctx.lineCap = 'round';
    tctx.lineJoin = 'round';

    const len = Math.max(0.05, cfg.trailLength);
    const full = 2 * Math.max(cfg.ballRadius, 2.5 / scale);
    const n = trail.length;
    const stride = Math.max(1, Math.ceil(n / 360));       // на длинных следах рисуем не каждую точку
    let prev = trail[0];
    let x0 = prev.x * scale + W / 2, x1 = x0, y0 = prev.y * scale + H / 2, y1 = y0;
    const seg = (p) => {
      const sx = p.x * scale + W / 2, sy = p.y * scale + H / 2;
      if (sx < x0) x0 = sx; else if (sx > x1) x1 = sx;
      if (sy < y0) y0 = sy; else if (sy > y1) y1 = sy;
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
    const br = Math.max(cfg.ballRadius, 2.5 / scale);
    ctx.fillStyle = cfg.ballColor;
    if (opts.lite) {
      // shadowBlur на мобильном Canvas очень дорог — вместо него дешёвое «свечение» полупрозрачным кругом
      ctx.globalAlpha = state.alpha * 0.25;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, br * 1.9, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = state.alpha;
    } else {
      ctx.shadowColor = cfg.ballColor;
      ctx.shadowBlur = 14 * scale;
    }
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, br, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // ── Цикл ──
  function frame(now) {
    if (!running) return;
    const raw = (now - last) / 1000;
    const dt = Math.min(raw, 0.05);
    last = now;
    // Адаптивное качество: если кадры стабильно дольше ~40 мс, снижаем разрешение холста (а не заставляем телефон мучиться)
    if (opts.adaptive && raw < 0.25) {
      if (raw > 0.04) slowFrames++; else if (slowFrames > 0) slowFrames--;
      if (slowFrames > 40 && dprAuto > 1) { dprAuto = Math.max(1, dprAuto - 0.5); slowFrames = 0; resize(); }
    }
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
    const dpr = opts.dpr || dprAuto;
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
  webkitUserSelect: 'none', userSelect: 'none', webkitTouchCallout: 'none',   // долгое нажатие не вызывает выделение / лупу на iOS
});

const mainSim = createSim(mainCanvas, {
  // размер берём у самого холста (он растянут на 100% layout-вьюпорта): так нет рассинхрона с innerHeight из-за панели Safari
  getSize: () => [mainCanvas.clientWidth || window.innerWidth, mainCanvas.clientHeight || window.innerHeight],
  particles: COARSE ? 700 : 1200, burst: 70, audio: true, adaptive: true, lite: COARSE,
});

const PREVIEW_SIZE = window.innerWidth < 520 ? 132 : 180;   // стартовый размер окна превью
let pvSize = PREVIEW_SIZE;                                   // текущая сторона квадратного холста превью (меняется ресайзом)
const previewCanvas = document.createElement('canvas');
previewCanvas.className = 'pv-canvas';
const preview = createSim(previewCanvas, {
  getSize: () => [pvSize, pvSize],
  particles: 250, burst: 24, audio: false, lite: COARSE,
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
  { key: 'bounce', label: 'Прыгучесть', pct: true, type: 'range', min: 0, max: 2.5, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },

  { section: 'След за шариком' },
  { key: 'trail', label: 'След в воздухе', type: 'toggle' },
  { key: 'trailOpacity', label: 'Прозрачность следа', hint: 'влево — прозрачнее, вправо — плотнее', pct: true, type: 'range', min: 0.05, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', visible: (s) => s.trail },
  { key: 'trailLength', label: 'Длина следа', hint: 'через сколько секунд след затирается', type: 'range', min: 0.1, max: 5, step: 0.1, fmt: (v) => v.toFixed(1) + ' с', visible: (s) => s.trail },
  { key: 'trailPaint', label: 'Цвет следа', type: 'paint', visible: (s) => s.trail,
    p: { grad: 'trailGradient', adv: 'trailAdvancedGradient', c1: 'trailColor', c2: 'trailColor2', stops: 'trailGradStops', smooth: 'trailGradSmooth', edited: 'trailGradStopsEdited' } },

  { section: 'Кольца' },
  { key: 'ringCount', label: 'Количество колец', type: 'range', min: 1, max: 25, step: 1, fmt: (v) => v.toFixed(0) },
  { key: 'ringSpacing', label: 'Расстояние между кольцами', type: 'range', min: 0.5, max: 150, step: 0.5, fmt: (v) => v.toFixed(1) },
  { key: 'lineWidth', label: 'Толщина колец', type: 'range', min: 0.5, max: 30, step: 0.5, fmt: (v) => v.toFixed(1) },
  { key: 'ringPaint', label: 'Цвет колец', type: 'paint',
    p: { grad: 'gradient', adv: 'advancedGradient', c1: 'ringColor', c2: 'ringColor2', stops: 'gradStops', smooth: 'gradSmooth', edited: 'gradStopsEdited' } },

  { section: 'Отверстия' },
  { key: 'gapSize', label: 'Размер отверстий', type: 'range', min: 2, max: 1500, step: 1, fmt: (v) => v.toFixed(0) },
  { key: 'gapBalance', label: 'Баланс отверстий', hint: 'влево — край больше, вправо — центр больше', type: 'range', min: -1.5, max: 1.5, step: 0.05, fmt: fmtBalance },

  { section: 'Вращение' },
  { key: 'spin', label: 'Скорость вращения', type: 'range', min: 0, max: 15, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'spinBalance', label: 'Баланс скорости', hint: 'влево — край быстрее, вправо — центр быстрее', type: 'range', min: -1.5, max: 1.5, step: 0.05, fmt: fmtBalance },
  { key: 'spinDir', label: 'Сторона вращения', hint: 'в какую сторону крутятся кольца', type: 'segment', options: ['По часовой', 'Против часовой', 'Чередуется'] },
  { key: 'smoothFlip', label: 'Плавная смена направления', type: 'toggle', visible: (s) => s.spinDir === 2 },

  { section: 'Эффекты' },
  { key: 'particles', label: 'Анимация разрушения колец', type: 'toggle' },
  { key: 'sound', label: 'Звук при столкновениях', type: 'toggle', noRandomAll: true },   // «Рандомизировать всё» звук не трогает
];

// Описания для кнопок «i» на карточках: что делает настройка и зачем она нужна (абзацы разделяются переводом строки)
const INFO = {
  ballRadius: 'Чем крупнее шарик, тем сильнее он перекрывает проходы: кольцо разрушается только тогда, когда шарик целиком помещается в отверстие. Слишком большой шарик может вообще не пролезать.',
  ballColor: 'Лучше выбирать оттенок, который контрастирует с кольцами, — тогда шарик не сливается с ними и его хорошо видно.',
  gravity: 'Сила, которая тянет шарик вниз.\nЧем она больше, тем быстрее шарик падает и тем резче отскакивает. При нуле он летает по инерции и не падает. Влияет и на ритм ударов, а значит, и на звук.',
  bounce: 'Насколько энергично шарик отскакивает от колец.\n100% — упругий удар без потерь. Меньше — шарик с каждым ударом теряет скорость. Больше — каждый удар добавляет энергии, и движение становится всё более безумным.',
  trail: 'Включает след в воздухе: за шариком остаётся тающая лента, по которой видна траектория движения.\nПосле включения появятся настройки прозрачности, длины и цвета следа.',
  trailOpacity: 'Насколько заметен след.\nВлево — почти прозрачный, вправо — плотный. Прозрачность применяется ко всему следу целиком, поэтому места, где он пересекает сам себя, не темнеют.',
  trailLength: 'Как долго след остаётся в воздухе: через столько секунд его точка полностью затирается.\nКороткий след — маленький хвостик за шариком, длинный — вся траектория за последние секунды.',
  trailPaint: 'Цвет следа.\n«Цвет» — один оттенок. «Градиент» — плавный переход между двумя цветами от шарика к концу следа. «Редактор» — собственный градиент из любого числа точек: их можно добавлять, двигать и удалять, а также переключать плавный и ступенчатый переход.',
  ringCount: 'Сколько колец-препятствий вложено друг в друга.\nШарик должен пробить их все по очереди, поэтому чем больше колец, тем дольше длится один рендеринг.',
  ringSpacing: 'При малом расстоянии кольца плотно сидят друг в друге и шарик почти сразу упирается в следующее. При большом между ними много свободного места для полёта.',
  lineWidth: 'Толстые кольца выглядят массивнее и сильнее бросаются в глаза, тонкие — изящнее и легче.',
  ringPaint: 'Цвет колец.\n«Цвет» — один оттенок для всех колец. «Градиент» — плавный переход между двумя цветами от центра к краю. «Редактор» — собственный градиент из любого числа точек: их можно добавлять, двигать и удалять, а также переключать плавный и ступенчатый переход.',
  gapSize: 'Размер отверстий в кольцах — длина дуги у среднего кольца.\nБольшие отверстия шарик проходит легко, маленькие требуют точного попадания и растягивают рендеринг.',
  gapBalance: 'Как размер отверстий распределяется между кольцами.\nВлево — у центра отверстия меньше, у края больше. Вправо — наоборот. По центру — у всех колец одинаковые.',
  spin: 'Общая скорость вращения колец (у среднего кольца).\nЧем она выше, тем быстрее убегают отверстия и тем сложнее шарику в них попасть. При нуле кольца стоят неподвижно.',
  spinBalance: 'Как скорость вращения распределяется между кольцами.\nВлево — внешние кольца крутятся быстрее внутренних. Вправо — наоборот. По центру — все кольца вращаются одинаково.',
  spinDir: 'В какую сторону вращаются кольца.\n«По часовой» и «Против часовой» — кольца всегда крутятся в одну выбранную сторону. «Чередуется» — направление меняется на противоположное каждый раз, когда шарик разрушает очередное кольцо.',
  smoothFlip: 'Как кольца разворачиваются при смене направления.\nВыключено — мгновенно, резким рывком. Включено — кольца плавно тормозят и разгоняются в обратную сторону. Доступно, когда выбрана сторона «Чередуется».',
  particles: 'Эффект разрушения колец: в момент пробития кольцо рассыпается на разлетающиеся частицы.\nЕсли выключить, кольцо просто исчезнет — так нагрузка на устройство ниже.',
  sound: 'Звук столкновений: удары шарика и разрушение колец играют ноты гармоничной гаммы.\nКнопка «Рандомизировать всё» этот переключатель не трогает.',
};

// Что показывает превью для каждого пункта (у пунктов без записи превью нет)
//   ball   — одно закрытое кольцо + шарик      static — неподвижные кольца, без шарика
//   spin   — вращающиеся кольца, без шарика    flip   — вращение со сменой направления каждые ~2 с, без шарика
const SCENES = {
  ballRadius: 'ball', ballColor: 'ball', gravity: 'ball', bounce: 'ball',
  trail: 'ball', trailOpacity: 'ball', trailLength: 'ball', trailPaint: 'ball',
  ringCount: 'static', ringSpacing: 'static', lineWidth: 'static', ringPaint: 'static',
  gapSize: 'static', gapBalance: 'static',
  spin: 'spin', spinBalance: 'spin', spinDir: 'spin', smoothFlip: 'flip',
};

// Только для этих пунктов превью показывает центральные кольца в фиксированном масштабе (чтобы было видно, как они раздвигаются
// и утолщаются). Во всех остальных превью (кроме шарика) видны ВСЕ кольца целиком — иначе не оценить пропорции.
const FIXED_KEYS = new Set(['ringSpacing', 'lineWidth']);

// Пункты раздела «Вращение»: при любом изменении превью начинается заново (без плавного появления)
const ROTATION_KEYS = new Set(['spin', 'spinBalance', 'spinDir', 'smoothFlip']);

const CSS = `
:root{--bg:#0e0f13;--surface:#16181e;--surface2:#1e2128;--line:#2b2f38;--line2:#3d424e;--text:#e8e9ed;--muted:#8d92a0;--accent:#8aa2ff;--danger:#ff8c8c;--pv-space:212px}
.asmr-menu{position:fixed;inset:0;z-index:10;overflow-y:auto;display:flex;justify-content:center;align-items:flex-start;
  overscroll-behavior:contain;box-sizing:border-box;background:var(--bg);color:var(--text);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--gutter:12px;
  padding:max(24px,env(safe-area-inset-top)) calc(var(--gutter) + env(safe-area-inset-right)) max(32px,env(safe-area-inset-bottom)) calc(var(--gutter) + env(safe-area-inset-left))}
.asmr-panel{width:min(520px,100%);margin:auto 0}
@media (min-width:820px){
.asmr-panel{width:min(1080px,100%);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:12px;align-content:start}
.asmr-panel>h1,.asmr-panel>p,.asmr-panel>.asmr-warn,.asmr-panel>.asmr-top,.asmr-panel>.sec,.asmr-panel>.asmr-start,.asmr-panel>.asmr-fast{grid-column:1/-1}
}
@media (min-width:1000px){
.asmr-menu{padding-right:calc(var(--pv-space) + env(safe-area-inset-right))}   /* справа остаётся место под превью — оно не перекрывает карточки */
}
@media (min-width:1500px){
.asmr-panel{width:min(1500px,100%);grid-template-columns:repeat(3,minmax(0,1fr))}
}
.asmr-panel h1{margin:0 0 4px;font-size:21px;font-weight:600;text-align:center}
.asmr-panel p{margin:0 0 14px;text-align:center;font-size:13px;color:var(--muted)}
.asmr-top{display:flex;gap:8px;margin:0 0 6px}
.asmr-top button{flex:1;padding:12px 8px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--text);
  font:500 13px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}
.asmr-menu .sec{margin:22px 4px 8px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.asmr-menu .row{border:1px solid var(--line);border-radius:14px;background:var(--surface);padding:4px 12px 10px;margin:0 0 8px}
.asmr-menu .row.active{border-color:var(--accent)}
.row .head{display:flex;align-items:center;gap:8px;min-height:38px}
.row .head label{flex:1;min-width:0;font-size:14px;line-height:1.3}
.row .head label small{display:block;margin-top:2px;font-size:12.5px;line-height:1.35;color:var(--muted)}
.row .acts{display:flex;flex:none;margin-right:-6px}
.row .acts button{width:34px;height:34px;padding:0;display:grid;place-items:center;border:0;border-radius:9px;background:none;color:var(--muted);cursor:pointer}
.row .acts button:active{background:var(--surface2);color:var(--text)}
.row .srow{display:flex;align-items:center;gap:10px}
.row .val{flex:none;box-sizing:border-box;width:96px;height:40px;padding:0 10px;text-align:right;font:500 16px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  color:var(--text);background:var(--bg);border:1px solid var(--line2);border-radius:10px;font-variant-numeric:tabular-nums;outline:none}
.row .val:focus{border-color:var(--accent)}
.row input[type=color],.paint input[type=color],.ginfo input[type=color]{flex:none;width:56px;height:44px;padding:0;border:1px solid var(--line2);border-radius:9px;background:none;cursor:pointer}
input[type=color]::-webkit-color-swatch-wrapper{padding:0}
input[type=color]::-webkit-color-swatch{border:0;border-radius:7px}
input[type=color]::-moz-color-swatch{border:0;border-radius:7px}
input.switch{appearance:none;-webkit-appearance:none;flex:none;width:56px;height:32px;margin:0;border:0;border-radius:16px;background:var(--line2);position:relative;cursor:pointer;transition:background .15s}
input.switch::before{content:"";position:absolute;inset:-8px -4px}   /* невидимое расширение зоны нажатия до 48 px */
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
.seg{position:relative;display:grid;grid-template-columns:repeat(3,1fr);height:44px;border:1px solid var(--line);border-radius:12px;background:var(--bg);
  touch-action:pan-y;cursor:pointer;outline:none;-webkit-user-select:none;user-select:none}
.seg-thumb{position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/3);border-radius:9px;background:var(--accent);transition:transform .18s ease;pointer-events:none}
.seg span{position:relative;z-index:1;display:grid;place-items:center;padding:0 3px;text-align:center;line-height:1.15;font-size:13px;font-weight:500;color:var(--muted);pointer-events:none;transition:color .15s}
.seg span.on{color:#0e0f13}
.seg:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.pcols{display:flex;align-items:center;gap:10px}
.pcols input[type=color]{width:56px;height:44px}
.pcols input.wide{flex:1;width:auto}
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
.gsmooth small{display:block;margin-top:2px;font-size:12.5px;line-height:1.35;color:var(--muted)}
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
.asmr-pv{position:fixed;z-index:11;box-sizing:border-box;overflow:hidden;border-radius:14px;background:#000;border:1px solid var(--line2);
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
.asmr-modal .box{width:min(420px,100%);max-height:min(80vh,560px);overflow-y:auto;touch-action:pan-y;box-sizing:border-box;padding:18px 18px 20px;
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
.asmr-panel>.row,.asmr-panel>.sec,.asmr-panel>.asmr-warn{animation:asmr-rise .4s ease both}
.asmr-panel.intro>.row,.asmr-panel.intro>.sec{animation-delay:calc(var(--i,0)*35ms)}
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
  return e;
};

const menu = el('div', 'asmr-menu');
const panel = el('div', 'asmr-panel');
panel.innerHTML = '<h1>ASMR Physics</h1><p>Настройте параметры и запустите рендеринг</p>';

// Предупреждение для людей с фоточувствительной эпилепсией — вверху страницы, сразу видно при входе
const warn = el('div', 'asmr-warn');
warn.setAttribute('role', 'note');
warn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
  + '<div><b>Предупреждение о фоточувствительности</b>'
  + '<span>Резкие вспышки и перепады яркости могут вызвать приступ у людей с фоточувствительной эпилепсией.</span>'
  + '<details><summary>Подробнее</summary>'
  + '<span>В превью и при рендеринге есть резкие переходы и яркие вспышки — это часть задумки, и убрать их нельзя. '
  + 'Если вы склонны к таким приступам, не запускайте превью и рендеринг. '
  + 'Если почувствовали недомогание, сразу прекратите просмотр.</span></details></div>';
panel.appendChild(warn);
menu.appendChild(panel);

// ── Превью ──
// Плавающее окно: всегда на экране, пока открыто главное меню (на время рендеринга и записи скрывается само).
// Его можно перетаскивать за заголовок, менять размер уголком, сворачивать в полоску и открывать обратно.
// Когда ни одна карточка не выбрана, в нём идёт обычная сцена целиком (шарик, вращение, разрушение колец).
let activeRow = null;
let previewOn = false;     // сцена превью уже настроена
let pvSig = '';            // что сейчас показывается (режим + сцена) — чтобы зря не перезапускать

const PV_HEAD = COARSE ? 40 : 34;
const PV_MIN_SIZE = 120;
const PV_STRIP_W = 168;
const PV_KEY = 'asmr-pv-v1';
let pvX = 0, pvY = 0, pvMin = false;

const pvWrap = el('div', 'asmr-pv');
const pvHead = el('div', 'pv-head');
pvHead.style.height = PV_HEAD + 'px';
pvHead.title = 'Перетащите, чтобы переместить (двойной клик — свернуть)';
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
  try { localStorage.setItem(PV_KEY, JSON.stringify({ x: pvX, y: pvY, s: pvSize, m: pvMin })); } catch (_) { /* не критично */ }
}

// Размер и положение окна: всегда целиком в пределах экрана
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
function pvQueueCanvasResize() {            // холст пересчитываем не чаще раза за кадр
  if (pvRaf) return;
  pvRaf = requestAnimationFrame(() => { pvRaf = 0; if (!pvMin) preview.resize(); });
}

// Превью крутится, только пока видно меню и окно развёрнуто; на рендеринге и записи его нет вообще
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
pvHead.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) setPvMin(!pvMin); });

// Перетаскивание за заголовок (мышь, палец, перо). Короткое касание свёрнутой полоски разворачивает окно
let pvDrag = null;
pvHead.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
  pvDrag = { id: e.pointerId, dx: e.clientX - pvX, dy: e.clientY - pvY, sx: e.clientX, sy: e.clientY, moved: false };
  try { pvHead.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }
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
  if (!d.moved && pvMin && e.type === 'pointerup') setPvMin(false);
  else pvSave();
};
pvHead.addEventListener('pointerup', pvEndDrag);
pvHead.addEventListener('pointercancel', pvEndDrag);

// Изменение размера уголком (окно остаётся квадратным — сцена круглая)
let pvRs = null;
pvGrip.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pvRs = { id: e.pointerId, sx: e.clientX, sy: e.clientY, s0: pvSize };
  try { pvGrip.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }
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

// Стартовое состояние: прошлое положение (если было) или правый верхний угол
(function pvInit() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PV_KEY) || 'null'); } catch (_) { /* нет или битое */ }
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

// Что показывать в превью для выбранного пункта; без выбора (или у пунктов без своей сцены) — обычная сцена целиком
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

// Снимает выделение карточки и возвращает превью к обычной сцене. Само окно НЕ скрывается.
// force — перезапустить сцену с нуля (после «Рандомизировать всё» / «Сбросить всё»)
function hidePreview(force) {
  if (activeRow) activeRow.classList.remove('active');
  activeRow = null;
  if (force || pvSig !== 'full:play') {
    preview.configure(settings, { mode: 'full', scene: 'play' });
    previewOn = true;
    pvSig = 'full:play';
  }
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
  if (def.type === 'segment') return Math.floor(Math.random() * def.options.length);
  if (def.type === 'color') return hue ? randomHueColor() : randomAnyColor();
  if (def.type === 'paint') {                                 // режим (цвет / градиент / редактор) + все цвета и точки
    const st = randomStops(hue);
    const rc = () => (hue ? randomHueColor() : randomAnyColor());
    return { mode: Math.floor(Math.random() * 3), c1: rc(), c2: rc(), stops: st.stops, smooth: st.smooth, edited: true };
  }
  return randomStops(hue);                                    // gradient
}

function initialValue(def) {
  if (def.type === 'paint') {
    const q = def.p;
    return {
      mode: !INITIAL[q.grad] ? 0 : !INITIAL[q.adv] ? 1 : 2, c1: INITIAL[q.c1], c2: INITIAL[q.c2],
      stops: JSON.parse(JSON.stringify(INITIAL[q.stops])), smooth: INITIAL[q.smooth], edited: false,
    };
  }
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

// ── Значки кнопок строки (однотонные, без эмодзи) ──
const SVG_ATTR = 'viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  reset: `<svg ${SVG_ATTR}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v5h5"/></svg>`,
  dice: `<svg ${SVG_ATTR}><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none"/></svg>`,
  hue: `<svg ${SVG_ATTR}><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/></svg>`,
  info: `<svg ${SVG_ATTR}><circle cx="12" cy="12" r="9"/><path d="M12 16v-5"/><path d="M12 8h.01"/></svg>`,
  close: `<svg ${SVG_ATTR}><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  more: `<svg ${SVG_ATTR}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>`,
};

// ── Ползунок значения ──
// Не нативный <input type=range>: у него пальцем нельзя отличить «листаю страницу» от «двигаю ползунок».
// Здесь вертикальное движение пальца — это прокрутка страницы (touch-action: pan-y), а значение меняется только
// после явного горизонтального сдвига. Касание дорожки значение не меняет — случайно сбить настройку нельзя.
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
    if (e.pointerType === 'mouse') {                       // мышь: ползунок прыгает под курсор и тянется как обычно
      if (e.button !== 0) return;
      g = { id: e.pointerId, mode: 'abs' };
      try { node.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }
      node.classList.add('drag');
      apply(xToValue(e.clientX));
      return;
    }
    g = { id: e.pointerId, mode: 'wait', x: e.clientX, y: e.clientY, v: cur };   // палец: сначала ждём, куда он поедет
  });
  node.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    if (g.mode === 'abs') { apply(xToValue(e.clientX)); return; }
    if (g.mode === 'wait') {
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }   // это прокрутка страницы
      if (Math.abs(dx) < 6) return;
      g.mode = 'rel'; g.x = e.clientX; g.v = cur;          // значение двигаем от текущего — без рывка в момент захвата
      node.classList.add('drag');                          // (у касания захват указателя и так неявный — явный не нужен)
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

// ── Трёхпозиционный переключатель («ползунок» с тремя положениями) ──
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
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }   // это прокрутка страницы
      if (Math.abs(dx) < 4) return;
      g.drag = true;
    }
    draw(posAt(e.clientX), false);                         // бегунок едет за пальцем
  });
  node.addEventListener('pointerup', (e) => {
    if (!g || e.pointerId !== g.id) return;
    g = null;
    choose(Math.round(posAt(e.clientX)));                  // тап по трети или отпускание после перетаскивания — прилипаем к ближайшему
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

// ── Цвет: один переключатель вместо цепочки тумблеров. 0 — простой цвет, 1 — простой градиент, 2 — полный редактор ──
function buildPaint(def) {
  const q = def.p;
  const getMode = () => (!settings[q.grad] ? 0 : !settings[q.adv] ? 1 : 2);
  const wrap = el('div', 'paint');
  const c1 = el('input', '', { type: 'color', value: settings[q.c1] });
  const c2 = el('input', '', { type: 'color', value: settings[q.c2] });
  const bar = el('div', 'pbar');
  const cols = el('div', 'pcols');
  cols.append(c1, bar, c2);
  const editor = buildGradientEditor(() => commit(def.key), { stops: q.stops, smooth: q.smooth, edited: q.edited });
  const seg = buildSegment(['Цвет', 'Градиент', 'Редактор'], getMode(), (m) => setMode(m, true));
  wrap.append(seg.node, cols, editor.node);

  function show() {
    const m = getMode();
    cols.style.display = m === 2 ? 'none' : 'flex';
    bar.style.display = c2.style.display = m === 1 ? '' : 'none';
    c1.classList.toggle('wide', m === 0);
    editor.node.style.display = m === 2 ? '' : 'none';
    bar.style.background = gradientCss([{ pos: 0, color: settings[q.c1] }, { pos: 1, color: settings[q.c2] }], true);
  }
  function setMode(m, user) {
    settings[q.grad] = m >= 1;
    settings[q.adv] = m === 2;
    // впервые открыли редактор — точки берём из текущих двух цветов
    if (m === 2 && !settings[q.edited]) {
      editor.set({ stops: [{ pos: 0, color: settings[q.c1] }, { pos: 1, color: settings[q.c2] }], smooth: true, edited: false });
    }
    show();
    if (user) commit(def.key);
  }
  c1.addEventListener('input', () => { settings[q.c1] = c1.value; show(); commit(def.key); });
  c2.addEventListener('input', () => { settings[q.c2] = c2.value; show(); commit(def.key); });
  show();

  // v = { mode, c1, c2, stops, smooth, edited }
  const set = (v) => {
    settings[q.c1] = v.c1; settings[q.c2] = v.c2;
    c1.value = v.c1; c2.value = v.c2;
    editor.set({ stops: v.stops, smooth: v.smooth, edited: v.edited });
    settings[q.grad] = v.mode >= 1;
    settings[q.adv] = v.mode === 2;
    seg.set(v.mode);
    show();
  };
  return { node: wrap, set };
}

// ── Окно с описанием настройки (кнопка «i» на карточке) ──
// Появляется по центру экрана; всё остальное, пока оно открыто, затемняется и размывается. Закрыть: крестик, клик мимо или Esc.
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

// В описаниях первая строка нередко просто повторяет заголовок окна («Размер шарика.» под «Размер шарика») — такую строку не показываем
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
  menu.inert = true;                                   // фон недоступен с клавиатуры, пока окно открыто
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
  else if (e.key === 'Tab') { e.preventDefault(); infoX.focus({ preventScroll: true }); }   // фокус не уходит за окно
}, true);

function makeRow(def) {
  const row = el('div', 'row');
  const id = 'f-' + def.key;
  const head = el('div', 'head');
  const label = el('label', '', { textContent: def.label });
  label.id = id + '-l';
  if (def.hint) label.appendChild(el('small', '', { textContent: def.hint }));
  head.appendChild(label);
  row.appendChild(head);

  let set;
  if (def.type === 'range') {
    // Значение — это поле ввода: пальцем точно попасть в нужное число на коротком ползунке нельзя, а цифрами — можно.
    // В фокусе в поле лежит «сырое» число (для процентных пунктов — в процентах), вне фокуса — красивая подпись.
    const val = el('input', 'val', { type: 'text', value: def.fmt(settings[def.key]) });
    val.inputMode = def.min < 0 ? 'text' : 'decimal';          // на iPhone в «decimal» нет минуса, а баланс бывает отрицательным
    val.setAttribute('enterkeyhint', 'done');
    val.setAttribute('autocomplete', 'off');
    val.spellcheck = false;
    val.setAttribute('aria-label', def.label + ' — ввести значение');
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
      setTimeout(() => { try { val.select(); } catch (_) { /* не критично */ } }, 0);
    });
    val.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); val.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editCancelled = true; val.blur(); }
    });
    val.addEventListener('blur', () => {
      const n = parseFloat(val.value.replace(',', '.').replace(/[^\d.\-]/g, ''));
      if (!editCancelled && isFinite(n)) sl.apply(def.pct ? n / 100 : n);   // apply сам обрежет по краям и подгонит под шаг
      val.value = def.fmt(settings[def.key]);
    });
    set = (v) => { settings[def.key] = v; sl.set(v); if (document.activeElement !== val) val.value = def.fmt(v); };
    const line = el('div', 'srow');
    line.append(sl.node, val);
    row.appendChild(line);
  } else if (def.type === 'color') {
    label.htmlFor = id;
    const input = el('input', '', { id, type: 'color', value: settings[def.key] });
    set = (v) => { settings[def.key] = v; input.value = v; };
    input.addEventListener('input', () => { set(input.value); commit(def.key); });
    head.appendChild(input);
  } else if (def.type === 'toggle') {
    label.htmlFor = id;
    const input = el('input', 'switch', { id, type: 'checkbox', checked: settings[def.key] });
    set = (v) => { settings[def.key] = v; input.checked = v; };
    input.addEventListener('change', () => {
      set(input.checked);
      // включили звук — клик это жест пользователя, звук разрешён; играем пробную ноту
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
  } else {                                                    // paint
    const paint = buildPaint(def);
    set = paint.set;
    row.appendChild(paint.node);
  }
  controls[def.key] = { row, set };

  // Кнопки строки. На самой карточке только две: «i» (описание) и «⋯». Под «⋯» открывается ряд действий с подписями словами:
  // сбросить, случайное значение (у цветов ещё — случайный яркий оттенок). Раньше на каждой карточке было по 3–4 значка без подписей.
  const acts = el('div', 'acts');
  const tools = el('div', 'tools');
  const addAct = (parent, icon, title, fn, kind, text) => {
    const b = el('button', '', { type: 'button', title });
    b.innerHTML = icon + (text ? `<span>${text}</span>` : '');
    b.setAttribute('aria-label', title);
    if (kind) b.dataset.a = kind;
    b.addEventListener('click', () => {
      const ic = b.querySelector('svg');                 // значок коротко «играет» при нажатии
      if (ic) { ic.classList.remove('go'); void ic.getBoundingClientRect(); ic.classList.add('go'); }
      fn();
    });
    parent.appendChild(b);
    return b;
  };
  addAct(tools, ICONS.reset, 'Сбросить до значения при запуске', () => { set(initialValue(def)); commit(def.key); }, 'reset', 'Сбросить');
  addAct(tools, ICONS.dice, 'Случайное значение', () => { set(randomValue(def, false)); commit(def.key); }, 'dice', 'Случайно');
  if (def.type === 'color' || def.type === 'paint') {
    addAct(tools, ICONS.hue, 'Случайный яркий цвет: любой оттенок при максимальной насыщенности', () => { set(randomValue(def, true)); commit(def.key); }, 'hue', 'Яркий оттенок');
  }
  if (INFO[def.key]) {
    const ib = addAct(acts, ICONS.info, 'Что это такое?', () => openInfo(def, ib), 'info');
    ib.classList.add('info-btn');
    ib.setAttribute('aria-haspopup', 'dialog');
    ib.addEventListener('pointerdown', (e) => e.stopPropagation());   // нажатие на «i» не запускает превью карточки
  }
  const moreBtn = addAct(acts, ICONS.more, 'Ещё: сбросить, случайное значение', () => {
    moreBtn.setAttribute('aria-expanded', String(row.classList.toggle('tools-open')));
  }, 'more');
  moreBtn.setAttribute('aria-expanded', 'false');
  row.appendChild(tools);
  head.appendChild(acts);

  row.addEventListener('pointerdown', () => activate(row, def.key, false));
  row.addEventListener('focusin', (e) => {
    if (e.target.closest && e.target.closest('.info-btn')) return;   // «i» только открывает описание, превью не нужно
    activate(row, def.key, false);
  });
  if (def.visible) visibles.push({ row, fn: def.visible });
  return row;
}

// Кнопки сверху
const topBar = el('div', 'asmr-top');
const randAllBtn = el('button', '', { type: 'button', textContent: 'Рандомизировать всё' });
const resetAllBtn = el('button', '', { type: 'button', textContent: 'Сбросить всё' });
topBar.append(randAllBtn, resetAllBtn);
panel.appendChild(topBar);

// Карточки при первом показе выезжают друг за другом (--i — порядковый номер для задержки)
let introI = 0;
FIELDS.forEach((def) => {
  const node = def.section ? el('div', 'sec', { textContent: def.section }) : makeRow(def);
  node.style.setProperty('--i', Math.min(introI++, 16));
  panel.appendChild(node);
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

const startBtn = el('button', 'asmr-start', { type: 'button', textContent: 'Начать рендеринг' });
panel.appendChild(startBtn);

// Самая нижняя кнопка: скоростная запись в MP4 (логика — в блоке «Скоростная запись» ниже)
const FAST_LABEL = 'Скоростная запись в MP4';
const fastBtn = el('button', 'asmr-fast', { type: 'button', textContent: FAST_LABEL });
panel.append(fastBtn);

const backBtn = el('button', 'asmr-back', { type: 'button', textContent: '← Назад' });

document.body.append(menu, pvWrap, backBtn, infoEl);

// Без этого на iOS не работает :active (подсветка нажатия) у кнопок
document.addEventListener('touchstart', () => {}, { passive: true });

// Клик вне строк настроек снимает выделение карточки (превью возвращается к обычной сцене, но не исчезает)
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.row') && !e.target.closest('.asmr-pv')) hidePreview();
});
// Окно превью живёт, пока открыто меню: любое показ/скрытие меню (рендеринг, запись, возврат) автоматически скрывает/показывает его
new MutationObserver(pvApplyRun).observe(menu, { attributes: true, attributeFilter: ['style'] });
syncPreview(null);
pvApplyRun();
// На телефоне панель браузера сворачивается при прокрутке и шлёт resize — реагируем только на реальную смену ширины / высоты окна
let lastW = window.innerWidth, lastH = window.innerHeight;
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  if (w !== lastW || h !== lastH) { pvLayout(); pvQueueCanvasResize(); }   // окно превью всегда должно оставаться в пределах экрана
  const bigH = Math.abs(h - lastH) > 120;                // скачок высоты поменьше — это панель Safari
  if ((w !== lastW || bigH) && menu.style.display === 'none') mainSim.resize();
  lastW = w; lastH = h;
});

// ── Приближение: колёсико мыши / щипок на тачскрине ──
mainCanvas.addEventListener('wheel', (e) => {
  if (menu.style.display !== 'none') return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;     // строки / страницы → пиксели
  const k = e.ctrlKey ? 0.01 : 0.0015;                                    // ctrl+колёсико = щипок на тачпаде
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
  try { mainCanvas.setPointerCapture(e.pointerId); } catch (_) { /* не критично */ }
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

// Подсказка про приближение: показывается при запуске рендеринга и сама гаснет; после первого приближения больше не появляется
const zoomHint = el('div', 'asmr-hint', { textContent: COARSE ? 'Приблизить — щипок двумя пальцами' : 'Приблизить — колёсико мыши или щипок на тачпаде' });
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
  unlockAudio();                 // клик по кнопке — жест пользователя, звук разрешён
  hidePreview();
  menu.style.display = 'none';
  backBtn.style.display = 'block';
  mainSim.configure(settings, { mode: 'full' });
  mainSim.resetZoom();
  mainSim.resize();
  mainSim.start();
  showZoomHint();
}

// Настройки живут в объекте settings и в самих полях меню — при возврате ничего не сбрасывается
function backToMenu() {
  hideZoomHint();
  mainSim.stop();
  backBtn.style.display = 'none';
  menu.style.display = 'flex';
  menu.classList.remove('fade');                // мягкое появление меню после рендеринга
  void menu.offsetWidth;
  menu.classList.add('fade');
}

startBtn.addEventListener('click', startRender);
backBtn.addEventListener('click', backToMenu);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.style.display === 'none' && recScreen.style.display === 'none') backToMenu();
});

// ───────────────────────────── Скоростная запись в MP4 ─────────────────────────────
// Сцена считается и рисуется БЕЗ привязки к реальным часам — кадр за кадром с фиксированным шагом 1/60 с — настолько быстро,
// насколько позволяет железо. Каждый кадр сразу уходит в видеокодировщик браузера (WebCodecs, H.264 или VP9), а метки времени
// проставляются по номеру кадра (i / 60 с) — поэтому в готовом файле всё идёт в обычной скорости, а не ускоренно.
// Звук собирается отдельно: все столкновения запоминаются с временем симуляции и синтезируются в OfflineAudioContext (AAC или Opus). Упаковка в MP4 — встроенная (Mp4Writer), без внешних библиотек и интернета.
// «Чтобы железо не сошло с ума»: очередь кодировщика ограничена (если он не успевает — рендер ждёт), работа идёт короткими
// слайсами по ~12 мс с отдачей управления браузеру, видео квадратное 1:1 (сцена вписана в кадр без чёрных полей), длина — не больше REC_MAX_SECONDS.
const REC_FPS = 60;
const REC_SIDES = COARSE ? [720, 480] : [1080, 720, 480];   // сторона квадратного кадра: пробуем по порядку, пока кодировщик не согласится
const REC_MAX_SECONDS = 120;          // предохранитель: если шарик так и не выбрался, запись остановится сама
const REC_MAX_INFLIGHT = 6;           // сколько кадров максимум может быть «в полёте» (отправлено в кодировщик, но ещё не вышло из него)
const REC_AUDIO_RATE = 48000;
class RecCancelled extends Error {}
let recJob = null;

// ── Экран записи ──
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
[['codec', 'Кодировщик'], ['res', 'Разрешение'], ['size', 'Размер записи'], ['video', 'Длина видео'],
  ['speed', 'Скорость'], ['eta', 'Осталось']].forEach(([key, label]) => {
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
  textContent: 'Съёмка может занять до 2 минут. Не закрывайте и не обновляйте сайт, не сворачивайте браузер и не блокируйте экран, пока идёт запись — иначе она прервётся.',
});
const recStop = el('button', 'asmr-fast busy', { type: 'button', textContent: '■ Остановить запись' });
const recAgain = el('button', 'asmr-fast', { type: 'button', textContent: '⬇ Скачать ещё раз' });
const recBack = el('button', 'asmr-fast', { type: 'button', textContent: '← Назад в меню' });
const recProg = el('div', 'rec-prog');
recProg.append(recRings, recPct);
const recBar = el('div', 'rec-bar');
recBar.appendChild(recFill);
const recBox = el('div', 'rec-box');
const recActions = el('div', 'rec-actions');
recActions.append(recStop, recAgain, recBack);      // закреплены внизу экрана: кнопка «Остановить» всегда под пальцем, без прокрутки
recBox.append(el('h2', '', { textContent: 'Скоростная запись' }), recView, recProg, recBar, recPhase, recMore, recWarn, recActions);
recScreen.appendChild(recBox);
document.body.appendChild(recScreen);

const recLast = { url: null, blob: null, name: '' };   // готовый файл — для кнопки «Скачать ещё раз»

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
  recAgain.textContent = COARSE ? '⬇ Сохранить видео' : '⬇ Скачать ещё раз';
  recAgain.style.display = recLast.url ? 'block' : 'none';
}

// Остановка. Вызывается безопасно сколько угодно раз.
function requestStop() {
  if (!recJob || recJob.cancel) return;
  recJob.cancel = true;
  recJob.abort();                                          // прерывает и долгие ожидания (кодировщик, синтез звука), а не только цикл кадров
  recStop.disabled = true;
  recStop.textContent = 'Останавливаю…';
}
// Основной путь — pointerup: на iPhone «click» после касания синтезируется с задержкой и пропадает, если страница в этот
// момент занята или если кнопка хоть чуть сдвинулась. pointerup у касания всегда приходит на ту кнопку, на которой палец
// был прижат. Проверяем, что палец отпущен над кнопкой (иначе человек передумал). «click» оставлен для клавиатуры и мыши.
recStop.addEventListener('pointerup', (e) => {
  const r = recStop.getBoundingClientRect(), m = 12;
  if (e.clientX >= r.left - m && e.clientX <= r.right + m && e.clientY >= r.top - m && e.clientY <= r.bottom + m) requestStop();
});
recStop.addEventListener('click', requestStop);
// На телефоне — системное меню «Поделиться» (там есть «Сохранить видео»); автоскачивание без жеста Safari часто блокирует
async function saveLast() {
  if (!recLast.url) return;
  if (COARSE && recLast.blob && navigator.canShare && navigator.share) {
    try {
      const f = new File([recLast.blob], recLast.name, { type: 'video/mp4' });
      if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); return; }
    } catch (e) {
      if (e && e.name === 'AbortError') return;          // пользователь закрыл меню
    }
  }
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

// Экран не должен гаснуть во время записи (иначе телефон усыпляет вкладку и запись срывается)
let wakeLock = null;
let recWasHidden = false, recResumedAt = 0;
async function acquireWake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (_) { /* не поддерживается или отказано — не критично */ }
}
function releaseWake() {
  try { if (wakeLock) wakeLock.release(); } catch (_) { /* уже снят */ }
  wakeLock = null;
}
const onRecVisibility = () => {
  if (!recJob) return;
  if (document.hidden) recWasHidden = true;
  else { recResumedAt = performance.now(); acquireWake(); }   // система снимает блокировку при сворачивании — берём заново
};

// Сырой текст исключения («Error: …», «NotSupportedError: …») обычному человеку ничего не говорит — переводим в понятную фразу.
// Точная техническая причина остаётся в консоли и в «Подробностях» на экране записи.
function explainRecError(err) {
  const name = (err && err.name) || '';
  const msg = String((err && err.message) || err || '');
  if (/[а-яё]/i.test(msg)) return msg;                       // наши собственные сообщения уже написаны по-русски
  const low = (name + ' ' + msg).toLowerCase();
  if (name === 'NotSupportedError' || /not supported|unsupported|codec/.test(low)) {
    return 'Браузер не смог закодировать видео в этом формате. Попробуйте Chrome или Edge.';
  }
  if (name === 'QuotaExceededError' || err instanceof RangeError || /memory|allocation|too large/.test(low)) {
    return 'Не хватило памяти для записи. Закройте другие вкладки и попробуйте ещё раз.';
  }
  if (name === 'EncodingError' || /encod/.test(low)) {
    return 'Кодировщик видео сообщил об ошибке. Попробуйте ещё раз или откройте сайт в Chrome или Edge.';
  }
  return 'Не удалось записать видео. Попробуйте ещё раз.';
}

const setStatus = (text, isErr) => {
  recPhase.textContent = text;
  recPhase.classList.toggle('err', !!isErr);
};

// ───────────────────────────── Встроенный MP4-мультиплексор ─────────────────────────────
// Раньше упаковку делала библиотека mp4-muxer, которую страница докачивала с CDN, — без интернета запись не работала.
// Теперь всё нужное лежит здесь: закодированные кадры и звук складываются в обычный MP4 (блок moov стоит перед mdat,
// поэтому файл открывается и перематывается сразу). Видео — H.264 или VP9, звук — AAC или Opus. Кадры идут в порядке показа
// (кодировщик запущен в режиме realtime, B-кадров нет), поэтому таблица задержек ctts не нужна.
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
  const u32s = (arr) => {                                   // массив чисел → подряд идущие 32-битные big-endian
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
      if (!t.description) throw new Error('Кодировщик не вернул параметры H.264 (avcC).');
      return box('avcC', t.description);
    }
    if (t.codec === 'vp9') {                                // 'vp09.PP.LL.BD[.CC.cp.tc.mc.FF]'
      const p = (t.string || 'vp09.00.41.08').split('.');
      const n = (i, d) => (p[i] !== undefined && p[i] !== '' ? parseInt(p[i], 10) : d);
      const bitDepth = n(3, 8), chroma = n(4, 1), range = n(8, 0);
      return full('vpcC', 1, 0, Uint8Array.of(n(1, 0), n(2, 41), (bitDepth << 4) | (chroma << 1) | range, n(5, 1), n(6, 1), n(7, 1)), be(0, 2));
    }
    if (t.codec === 'aac') {
      let asc = t.description;
      if (!asc) {                                           // запасной вариант: AAC-LC, параметры из настроек
        const fi = Math.max(0, AAC_RATES.indexOf(t.sampleRate));
        asc = Uint8Array.of((2 << 3) | (fi >> 1), ((fi & 1) << 7) | (t.channels << 3));
      }
      const dsi = cat(Uint8Array.of(0x05, asc.length), asc);
      const dcd = cat(Uint8Array.of(0x40, 0x15, 0, 0, 0), be(192000, 4), be(128000, 4), dsi);
      const dcdFull = cat(Uint8Array.of(0x04, dcd.length), dcd);
      const body = cat(Uint8Array.of(0, 0, 0), dcdFull, Uint8Array.of(0x06, 0x01, 0x02));
      return full('esds', 0, 0, Uint8Array.of(0x03, body.length), body);
    }
    // Opus: из OpusHead (little-endian) делаем dOps (big-endian); если описания нет — типичные значения libopus
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

    const runs = [];                                        // stts: подряд идущие одинаковые длительности — одной записью
    for (const s of t.samples) {
      const last = runs[runs.length - 1];
      if (last && last[1] === s.dur) last[0]++; else runs.push([1, s.dur]);
    }
    const stts = full('stts', 0, 0, be(runs.length, 4), u32s(runs.flat()));
    const keys = [];
    t.samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
    const stss = isV ? full('stss', 0, 0, be(keys.length, 4), u32s(keys)) : new Uint8Array(0);
    const stsc = full('stsc', 0, 0, be(1, 4), be(1, 4), be(1, 4), be(1, 4));          // каждый «чанк» — ровно один семпл
    const stsz = full('stsz', 0, 0, be(0, 4), be(t.samples.length, 4), u32s(t.samples.map((s) => s.data.length)));
    const stco = full('stco', 0, 0, be(t.samples.length, 4), u32s(offsets));
    const stsd = full('stsd', 0, 0, be(1, 4), sampleEntry(t));
    const dinf = box('dinf', full('dref', 0, 0, be(1, 4), full('url ', 0, 1)));
    const media = isV ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4));
    const minf = box('minf', media, dinf, box('stbl', stsd, stts, stss, stsc, stsz, stco));
    return box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
  }

  class Mp4Writer {
    // opts: { video: { codec: 'avc'|'vp9', string, width, height }, audio?: { codec: 'aac'|'opus', channels, sampleRate } }
    constructor(opts) {
      this.v = { kind: 'video', ...opts.video, timescale: 90000, samples: [], description: null };
      this.a = opts.audio ? { kind: 'audio', ...opts.audio, timescale: opts.audio.sampleRate, samples: [], description: null } : null;
    }
    _add(t, chunk, meta) {
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !t.description) t.description = toU8(meta.decoderConfig.description).slice();
      const last = t.samples[t.samples.length - 1];
      if (last && chunk.timestamp < last.ts) throw new Error('Кодировщик выдал кадры не по порядку.');
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      t.samples.push({ data, ts: chunk.timestamp, durUs: chunk.duration || 0, key: chunk.type !== 'delta' });
    }
    addVideoChunk(chunk, meta) { this._add(this.v, chunk, meta); }
    addAudioChunk(chunk, meta) { if (this.a) this._add(this.a, chunk, meta); }

    // Возвращает Blob с готовым MP4
    finalize() {
      const tracks = [this.v, this.a].filter((t) => t && t.samples.length);
      if (!this.v.samples.length) throw new Error('В видео не оказалось ни одного кадра.');
      for (const t of tracks) {
        const k = t.timescale / 1e6, s = t.samples;
        s.forEach((x) => { x.tick = Math.round(x.ts * k); });
        s.forEach((x, i) => {
          const d = i + 1 < s.length ? s[i + 1].tick - x.tick : x.durUs ? Math.round(x.durUs * k) : i ? s[i - 1].dur : 1;
          x.dur = Math.max(1, d);
        });
        t.duration = s.reduce((sum, x) => sum + x.dur, 0);
      }
      // Кадры и звук идут вперемешку по времени — так файл удобно проигрывать и перематывать
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
      const base = ftyp.length + buildMoov(offs).length + 8;      // размер moov от смещений не зависит
      let pos = base;
      for (const o of order) { offs[o.ti][o.si] = pos; pos += o.s.data.length; }
      if (pos >= 4294967295) throw new Error('Видео получилось больше 4 ГБ — такой MP4 не собрать.');
      const moov = buildMoov(offs);
      return new Blob([ftyp, moov, cat(be(pos - base + 8, 4), ascii('mdat')), ...order.map((o) => o.s.data)], { type: 'video/mp4' });
    }
  }
  return Mp4Writer;
})();

// Отдача управления без задержки таймеров (MessageChannel не душится в фоновой вкладке так, как setTimeout)
const yieldChannel = new MessageChannel();
let yieldResolve = null;
yieldChannel.port1.onmessage = () => { const r = yieldResolve; yieldResolve = null; if (r) r(); };
const yieldNow = () => new Promise((r) => { yieldResolve = r; yieldChannel.port2.postMessage(0); });
const yieldPaint = () => new Promise((r) => setTimeout(r, 0));   // даём браузеру успеть отрисовать статус
// Цепочка MessageChannel-пауз ни разу не оставляет браузеру свободной секунды: касания (в первую очередь на iOS) стоят
// в очереди, и кнопка «Остановить» срабатывает с большой задержкой или теряется. Раз в ~50 мс делаем настоящую паузу по таймеру.
const yieldInput = () => new Promise((r) => setTimeout(r, 0));

// Ждём, пока кодировщик разгребёт очередь (с таймаутом на случай, если событие dequeue не поддерживается)
const waitDequeue = (enc) => new Promise((resolve) => {
  let done = false;
  const fin = () => { if (done) return; done = true; enc.removeEventListener('dequeue', fin); resolve(); };
  enc.addEventListener('dequeue', fin);
  setTimeout(fin, 50);
});

// Кодеки по порядку предпочтения: H.264 (работает почти везде), запасной — VP9 (в Firefox на Linux H.264 обычно нет).
// mux — имя кодека для встроенного мультиплексора (Mp4Writer).
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
async function pickVideo(job) {
  for (const side of REC_SIDES) {
    const W = side, H = side;
    const bitrate = Math.round(W * H * 4);                      // ≈ 4.7 Мбит/с для 1080×1080
    for (const c of VIDEO_CODECS) {
      if (job && job.cancel) throw new RecCancelled();
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
  const job = { cancel: false, abort: null };
  job.aborted = new Promise((_, reject) => { job.abort = () => reject(new RecCancelled()); });
  job.aborted.catch(() => {});                              // чтобы браузер не ругался на «необработанное» отклонение
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
  document.addEventListener('visibilitychange', onRecVisibility);
  recWasHidden = document.hidden;
  acquireWake();

  let venc = null, aenc = null, recSim = null;
  const checkAbort = () => { if (job.cancel) throw new RecCancelled(); };
  // Долгие ожидания (подбор кодека, досчёт кодировщика, синтез звука) гонятся с отменой — кнопка «Остановить» срабатывает сразу
  const guard = (promise) => Promise.race([promise, job.aborted]);

  try {
    setStatus('Подготовка…');
    await yieldPaint();
    checkAbort();

    const snap = JSON.parse(JSON.stringify(settings));      // снимок настроек: правки меню во время записи не влияют

    setStatus('Подбираю кодек…');
    await yieldPaint();
    const vsel = await guard(pickVideo(job));
    if (!vsel) throw new Error('Браузер не смог запустить ни один видеокодек (пробовал H.264 и VP9).');
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

    const muxer = new Mp4Writer({
      video: { codec: vsel.mux, string: vcfg.codec, width: W, height: H },
      audio: wantAudio ? { codec: audioMux, channels: 2, sampleRate: REC_AUDIO_RATE } : undefined,
    });

    let encError = null;
    let inflight = 0;                                       // свой счётчик кадров в кодировщике (encodeQueueSize в Firefox ненадёжен)
    let bytes = 0;                                          // сколько уже весит запись
    venc = new VideoEncoder({
      output: (chunk, meta) => {
        inflight--;
        bytes += chunk.byteLength;
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
    let sliceStart = wallStart, lastUi = 0, lastInput = wallStart, frame = 0, capped = false, etaSmooth = null;

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
      let stallStart = performance.now();
      while (inflight >= REC_MAX_INFLIGHT) {
        checkAbort();
        if (encError) throw encError;
        // пока вкладка была в фоне (или только что вернулась) — таймер зависания не считаем
        if (document.hidden || recResumedAt > stallStart) stallStart = performance.now();
        if (performance.now() - stallStart > 15000) throw new Error('Кодировщик перестал отвечать (15 секунд без результата). Закройте другие вкладки и попробуйте ещё раз.');
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
    setProgress(1, 'Колец осталось: 0');
    recCells.eta.textContent = '—';

    checkAbort();
    setStatus('Досчитываю видео…');
    await guard(venc.flush());
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
      await guard(aenc.flush());
      if (encError) throw encError;
      aenc.close();
      aenc = null;
    }

    // ── Готовый файл → загрузка в браузере ──
    setStatus('Собираю MP4…');
    await yieldPaint();
    const blob = muxer.finalize();
    const url = URL.createObjectURL(blob);
    recLast.url = url;
    recLast.blob = blob;
    recLast.name = `asmr-physics-${W}x${H}.mp4`;
    if (!COARSE) downloadUrl(url, recLast.name);          // на телефоне — по кнопке (нужен жест пользователя)
    recCells.size.textContent = (blob.size / 1048576).toFixed(1) + ' МБ';

    const wall = (performance.now() - wallStart) / 1000;
    setStatus(
      `Готово: ${seconds.toFixed(1)} с видео за ${wall.toFixed(1)} с (×${(seconds / wall).toFixed(1)}), ${(blob.size / 1048576).toFixed(1)} МБ. ` + (COARSE ? 'Нажмите «Сохранить видео».' : 'Файл скачан.') +
      (capped ? `\nДостигнут лимит ${REC_MAX_SECONDS} с — запись остановлена.` : '') +
      (audioSkipped ? '\nЗвук не записан: браузер не умеет кодировать AAC/Opus.' : ''),
    );
  } catch (err) {
    if (err instanceof RecCancelled) setStatus('Запись остановлена.');
    else {
      console.error(err);
      recTech.textContent = ((err && err.name) ? err.name + ': ' : '') + String((err && err.message) || err);
      setStatus(explainRecError(err) +
        (recWasHidden ? '\nВо время записи экран гас или браузер сворачивался — оставьте вкладку открытой и не блокируйте телефон.' : ''), true);
    }
  } finally {
    if (recSim) recSim.endCapture();
    try { if (venc && venc.state !== 'closed') venc.close(); } catch (_) { /* уже закрыт */ }
    try { if (aenc && aenc.state !== 'closed') aenc.close(); } catch (_) { /* уже закрыт */ }
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