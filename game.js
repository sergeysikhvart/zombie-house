/* =============================================================
   Зомби в доме: Заражение — браузерный прототип (v0.1)
   Один файл, без зависимостей. Открой index.html в браузере.

   Структура (для будущей 3D/Unity-версии):
     MAP      — сетка: сад + дом с комнатами, старт/финиш машины
     PLAYERS  — 4 героя, сердца, оружие, инвентарь
     ZOMBIES  — 24 карточки рубашкой вверх, вскрываются при контакте
     SPINNER  — крутилка: Сбегать×2, Огнестрел×4, Холодное×3, Череп×1
     STATES   — MENU / PLAY / SPIN / WIN / LOSE
   ============================================================= */

"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------- Карта ----------
const COLS = 15, ROWS = 12;
// типы клеток: G сад, '.' пол, '#' стена, 'D' дверь, 'S' старт, 'F' финиш
let grid = [];

function buildMap() {
  grid = [];
  for (let r = 0; r < ROWS; r++) {
    grid.push(new Array(COLS).fill("G"));
  }
  // дом: прямоугольник стен
  const top = 2, bot = 9, left = 4, right = 12;
  for (let c = left; c <= right; c++) { grid[top][c] = "#"; grid[bot][c] = "#"; }
  for (let r = top; r <= bot; r++) { grid[r][left] = "#"; grid[r][right] = "#"; }
  // пол внутри
  for (let r = top + 1; r < bot; r++)
    for (let c = left + 1; c < right; c++) grid[r][c] = ".";
  // внутренние стены (комнаты)
  const midC = 8, midR = 5;
  for (let r = top + 1; r < bot; r++) grid[r][midC] = "#";
  for (let c = left + 1; c < right; c++) grid[midR][c] = "#";
  // дверные проёмы во внутренних стенах
  grid[midR][6] = "."; grid[midR][10] = ".";
  grid[3][midC] = "."; grid[7][midC] = ".";
  // двери в наружных стенах
  grid[midR][left] = "D";      // вход слева
  grid[midR][right] = "D";     // вход справа
  grid[top][6] = "D";          // вход сверху
  grid[bot][10] = "D";         // вход снизу
  // машины
  grid[10][2] = "S";           // жёлтая стартовая
  grid[1][13] = "F";           // белая финишная
}

function isWalkable(r, c) {
  if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return false;
  return grid[r][c] !== "#";
}

// ---------- Поиск пути (BFS) ----------
function findPath(sr, sc, tr, tc) {
  if (!isWalkable(tr, tc)) return null;
  const key = (r, c) => r * COLS + c;
  const q = [[sr, sc]];
  const prev = new Map();
  prev.set(key(sr, sc), null);
  while (q.length) {
    const [r, c] = q.shift();
    if (r === tr && c === tc) break;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (isWalkable(nr, nc) && !prev.has(key(nr, nc))) {
        prev.set(key(nr, nc), [r, c]);
        q.push([nr, nc]);
      }
    }
  }
  if (!prev.has(key(tr, tc))) return null;
  const path = [];
  let cur = [tr, tc];
  while (cur) { path.push(cur); cur = prev.get(key(cur[0], cur[1])); }
  path.reverse();
  return path; // включая старт
}

// ---------- Герои ----------
const CHAR_DEFS = [
  { name: "Полицейский", color: "#3d7bd6", hp: 4, items: ["pistol"] },
  { name: "Хулиганка",   color: "#c64bd0", hp: 4, items: ["axe"] },
  { name: "Медсестра",   color: "#3fb98a", hp: 5, items: ["knife", "medkit"] },
  { name: "Байкер",      color: "#d68a3d", hp: 5, items: ["shotgun"] },
];

const ITEMS = {
  pistol:  { name: "Пистолет",  icon: "🔫", kind: "firearm" },
  shotgun: { name: "Дробовик",  icon: "🔫", kind: "firearm" },
  revolver:{ name: "Револьвер", icon: "🔫", kind: "firearm" },
  axe:     { name: "Топор",     icon: "🪓", kind: "melee"   },
  knife:   { name: "Нож",       icon: "🔪", kind: "melee"   },
  grenade: { name: "Граната",   icon: "💣", kind: "firearm" },
  medkit:  { name: "Аптечка",   icon: "🩹", kind: "heal"    },
};

let players = [];
function makePlayers() {
  players = CHAR_DEFS.map((d, i) => ({
    id: i, name: d.name, color: d.color,
    hp: d.hp, maxHp: d.hp,
    items: d.items.slice(),
    r: 10, c: 2,            // у стартовой машины
    px: 2, py: 10,          // плавная позиция (в клетках)
    path: null, step: 0, moveT: 0,
    alive: true, escaped: false,
  }));
  // разводим стартовые позиции вокруг машины
  const spots = [[10,2],[10,3],[9,2],[9,3]];
  players.forEach((p, i) => { p.r = spots[i][0]; p.c = spots[i][1]; p.px = p.c; p.py = p.r; });
}
function hasKind(p, kind) { return p.items.some(it => ITEMS[it].kind === kind); }

// ---------- Зомби (24 карточки рубашкой вверх) ----------
const ZTYPES = {
  normal: { name: "Обычный зомби",  emoji: "🧟", color: "#7fae53", hp: 2 },
  girl:   { name: "Девочка-зомби",  emoji: "🧟‍♀️", color: "#9ec06a", hp: 2 },
  dog:    { name: "Зомби-собака",   emoji: "🐕", color: "#a08050", hp: 1 },
  rat:    { name: "Зомби-крыса",    emoji: "🐀", color: "#8a8a8a", hp: 1 },
  circus: { name: "Цирковой зомби", emoji: "🤡", color: "#c2562f", hp: 3 },
};
const ZPOOL = [
  ...Array(4).fill("normal"),
  ...Array(4).fill("girl"),
  ...Array(5).fill("dog"),
  ...Array(5).fill("rat"),
  ...Array(6).fill("circus"),
]; // = 24

let zombies = []; // {r,c,type,revealed,dead}
function placeZombies() {
  zombies = [];
  // допустимые клетки: проходимые, не в безопасной зоне старта, не финиш
  const cells = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!isWalkable(r, c)) continue;
      if (grid[r][c] === "S" || grid[r][c] === "F") continue;
      if (Math.abs(r - 10) + Math.abs(c - 2) <= 3) continue; // зона старта
      cells.push([r, c]);
    }
  // перемешиваем
  for (let i = cells.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const pool = ZPOOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (let i = 0; i < pool.length && i < cells.length; i++) {
    zombies.push({ r: cells[i][0], c: cells[i][1], type: pool[i], revealed: false, dead: false });
  }
}
function zombieAt(r, c) {
  return zombies.find(z => !z.dead && z.r === r && z.c === c) || null;
}

// ---------- Крутилка ----------
// 10 секторов: 2 Сбегать, 4 Огнестрел, 3 Холодное, 1 Череп
const WHEEL = [
  "run","firearm","run","firearm","melee",
  "firearm","melee","firearm","melee","skull",
];
const SEG = (Math.PI * 2) / WHEEL.length;
const SECTOR = {
  run:     { label: "Сбегать",  color: "#3fb98a", icon: "🏃" },
  firearm: { label: "Огнестрел", color: "#d6a03d", icon: "🔫" },
  melee:   { label: "Холодное", color: "#b8693a", icon: "🗡️" },
  skull:   { label: "Череп",    color: "#7a3030", icon: "💀" },
};

let spin = null; // {rot, target, vel, settling, resultIdx, zombie, player, done, message}

function startSpin(player, zombie) {
  const idx = (Math.random() * WHEEL.length) | 0;
  // финальный угол так, чтобы центр сектора idx встал под указатель (вверх)
  const turns = 5;
  const target = Math.PI * 2 * turns - (idx * SEG + SEG / 2) - Math.PI / 2;
  spin = { rot: 0, target, vel: 0, t: 0, resultIdx: idx, zombie, player,
           spinning: false, done: false, message: "" };
  state = "SPIN";
}

function resolveSpin() {
  const type = WHEEL[spin.resultIdx];
  const p = spin.player, z = spin.zombie;
  let msg = "";
  if (type === "run") {
    msg = `🏃 ${p.name} убегает! Зомби остаётся на месте.`;
    // откатываемся на предыдущую клетку, если есть
    if (p.prevR != null) { p.r = p.prevR; p.c = p.prevC; p.px = p.c; p.py = p.r; }
  } else if (type === "firearm") {
    if (hasKind(p, "firearm")) { z.dead = true; msg = `🔫 Выстрел! ${ZTYPES[z.type].name} уничтожен.`; }
    else { damage(p, 1); msg = `Нет огнестрела! ${ZTYPES[z.type].name} кусает. −1 ❤`; }
  } else if (type === "melee") {
    if (hasKind(p, "melee")) { z.dead = true; msg = `🗡️ Удар! ${ZTYPES[z.type].name} уничтожен.`; }
    else { damage(p, 1); msg = `Нет холодного оружия! Укус. −1 ❤`; }
  } else if (type === "skull") {
    damage(p, 1); msg = `💀 Череп! ${p.name} теряет 1 ❤.`;
  }
  spin.message = msg;
  spin.done = true;
}

function damage(p, n) {
  p.hp -= n;
  if (p.hp <= 0) {
    p.hp = 0; p.alive = false;
    p.path = null;
    if (activeId === p.id) pickNextActive();
  }
}

// ---------- Состояние игры ----------
let state = "MENU"; // MENU PLAY SPIN WIN LOSE
let activeId = 0;
let cell = 32, ox = 0, oy = 0; // геометрия отрисовки
let buttons = []; // кликабельные зоны: {x,y,w,h,action}
let showInv = false;

function activePlayer() { return players[activeId]; }
function pickNextActive() {
  for (let k = 1; k <= players.length; k++) {
    const id = (activeId + k) % players.length;
    if (players[id].alive && !players[id].escaped) { activeId = id; return; }
  }
}

function newGame() {
  buildMap();
  makePlayers();
  placeZombies();
  activeId = 0; showInv = false;
  state = "PLAY";
}

function checkEnd() {
  const onBoard = players.filter(p => p.alive && !p.escaped);
  const escaped = players.filter(p => p.escaped);
  if (players.every(p => !p.alive)) { state = "LOSE"; return; }
  if (onBoard.length === 0 && escaped.length > 0) { state = "WIN"; return; }
}

// ---------- Ввод ----------
function resize() {
  const W = Math.min(window.innerWidth, 1100);
  const H = Math.min(window.innerHeight - 28, 820);
  cell = Math.floor(Math.min(W / COLS, H / ROWS));
  canvas.width = cell * COLS;
  canvas.height = cell * ROWS;
  ox = 0; oy = 0;
}
window.addEventListener("resize", resize);

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  return { x: cx * (canvas.width / rect.width), y: cy * (canvas.height / rect.height) };
}

function onPress(e) {
  e.preventDefault();
  const { x, y } = canvasPos(e);
  // сначала проверяем кнопки UI
  for (const b of buttons) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.action(); return; }
  }
  if (state === "PLAY" && !showInv) {
    const c = Math.floor((x - ox) / cell);
    const r = Math.floor((y - oy) / cell);
    movePlayerTo(r, c);
  }
}
canvas.addEventListener("mousedown", onPress);
canvas.addEventListener("touchstart", onPress, { passive: false });

window.addEventListener("keydown", (e) => {
  if (e.key === "Tab") { e.preventDefault(); if (state === "PLAY") showInv = !showInv; }
  if (state === "PLAY") {
    if (e.key >= "1" && e.key <= "4") {
      const id = +e.key - 1;
      if (players[id] && players[id].alive && !players[id].escaped) { activeId = id; }
    }
  }
});

function movePlayerTo(r, c) {
  const p = activePlayer();
  if (!p.alive || p.escaped) return;
  if (p.path) return; // уже идёт
  const path = findPath(p.r, p.c, r, c);
  if (!path || path.length < 2) return;
  p.path = path; p.step = 0; p.moveT = 0;
}

// ---------- Обновление ----------
let last = performance.now();
function update(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;

  if (state === "PLAY") {
    const p = activePlayer();
    if (p && p.path) {
      p.moveT += dt * 6; // скорость
      if (p.moveT >= 1) {
        p.moveT = 0; p.step++;
        if (p.step >= p.path.length - 1 + 1 || p.step >= p.path.length) {
          // дошли
          const cellRC = p.path[p.path.length - 1];
          arriveCell(p, cellRC[0], cellRC[1]);
          p.path = null;
        } else {
          const fromC = p.path[p.step];
          p.r = fromC[0]; p.c = fromC[1];
          // проверяем зомби на этой клетке
          const z = zombieAt(p.r, p.c);
          if (z && !z.revealed) {
            z.revealed = true;
            p.prevR = p.path[p.step - 1][0]; p.prevC = p.path[p.step - 1][1];
            p.path = null;
            startSpin(p, z);
          } else if (z && z.revealed) {
            p.prevR = p.path[p.step - 1][0]; p.prevC = p.path[p.step - 1][1];
            p.path = null;
            startSpin(p, z);
          }
        }
      }
      if (p.path) {
        const a = p.path[p.step], b = p.path[Math.min(p.step + 1, p.path.length - 1)];
        p.px = a[1] + (b[1] - a[1]) * p.moveT;
        p.py = a[0] + (b[0] - a[0]) * p.moveT;
      }
    } else if (p) { p.px = p.c; p.py = p.r; }
  }

  if (state === "SPIN" && spin) {
    if (spin.spinning && !spin.done) {
      spin.t += dt;
      const dur = 2.6;
      const k = Math.min(1, spin.t / dur);
      const ease = 1 - Math.pow(1 - k, 3); // easeOutCubic
      spin.rot = spin.target * ease;
      if (k >= 1) { spin.spinning = false; resolveSpin(); }
    }
  }
}

function arriveCell(p, r, c) {
  p.r = r; p.c = c; p.px = c; p.py = r;
  if (grid[r][c] === "F") { p.escaped = true; checkEnd(); }
  const z = zombieAt(r, c);
  if (z) { z.revealed = true; p.prevR = null; startSpin(p, z); }
}

// ---------- Отрисовка ----------
function draw() {
  buttons = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (state === "MENU") { drawMenu(); return; }

  drawBoard();
  drawZombies();
  drawPlayers();
  drawHUD();

  if (showInv) drawInventory();
  if (state === "SPIN") drawSpinner();
  if (state === "WIN") drawEnd("ПОБЕДА!", "Выжившие добрались до машины 🚗", "#3fb98a");
  if (state === "LOSE") drawEnd("ПОРАЖЕНИЕ", "Все герои пали под натиском зомби 🧟", "#c0392b");
}

function drawBoard() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      const x = ox + c * cell, y = oy + r * cell;
      let col = "#2f6b3a";          // сад
      if (t === ".") col = "#caa56a"; // пол дома
      else if (t === "#") col = "#5a4634"; // стена
      else if (t === "D") col = "#9c7b3e"; // дверь
      else if (t === "S") col = "#d8c24a"; // старт
      else if (t === "F") col = "#e8eef2"; // финиш
      ctx.fillStyle = col;
      ctx.fillRect(x, y, cell, cell);
      ctx.strokeStyle = "rgba(0,0,0,.12)";
      ctx.strokeRect(x + .5, y + .5, cell - 1, cell - 1);
      if (t === "S" || t === "F") {
        ctx.font = `${cell * .6}px serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("🚗", x + cell / 2, y + cell / 2);
      }
    }
  }
}

function drawZombies() {
  for (const z of zombies) {
    if (z.dead) continue;
    const x = ox + z.c * cell, y = oy + z.r * cell;
    if (!z.revealed) {
      // рубашка карты
      ctx.fillStyle = "#3a2f4a";
      roundRect(x + cell*.12, y + cell*.12, cell*.76, cell*.76, 4); ctx.fill();
      ctx.strokeStyle = "#6b5b8a"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#6b5b8a";
      ctx.font = `${cell*.4}px serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", x + cell/2, y + cell/2);
    } else {
      const def = ZTYPES[z.type];
      ctx.fillStyle = def.color;
      roundRect(x + cell*.1, y + cell*.1, cell*.8, cell*.8, 4); ctx.fill();
      ctx.font = `${cell*.5}px serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(def.emoji, x + cell/2, y + cell/2);
    }
  }
}

function drawPlayers() {
  for (const p of players) {
    if (!p.alive || p.escaped) continue;
    const x = ox + p.px * cell + cell/2, y = oy + p.py * cell + cell/2;
    ctx.beginPath();
    ctx.arc(x, y, cell*.32, 0, Math.PI*2);
    ctx.fillStyle = p.color; ctx.fill();
    ctx.lineWidth = p.id === activeId ? 4 : 2;
    ctx.strokeStyle = p.id === activeId ? "#fff" : "rgba(0,0,0,.4)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${cell*.3}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(p.name[0], x, y);
  }
}

function drawHUD() {
  const p = activePlayer();
  if (!p) return;
  const w = Math.min(260, canvas.width * .42), h = 96, x = 8, y = 8;
  ctx.fillStyle = "rgba(10,16,22,.82)";
  roundRect(x, y, w, h, 8); ctx.fill();
  ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.stroke();
  // портрет
  ctx.beginPath(); ctx.arc(x+26, y+28, 18, 0, Math.PI*2);
  ctx.fillStyle = p.color; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(p.name[0], x+26, y+28);
  // имя
  ctx.fillStyle = "#e8eef2"; ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(p.name, x+52, y+22);
  // сердца
  ctx.font = "15px serif";
  let hs = "";
  for (let i = 0; i < p.maxHp; i++) hs += i < p.hp ? "❤" : "🤍";
  ctx.fillText(hs, x+52, y+42);
  // предметы
  ctx.font = "18px serif";
  ctx.fillText(p.items.map(it => ITEMS[it].icon).join(" "), x+12, y+74);
  // ростер
  let rx = x + w + 8;
  for (const q of players) {
    const dead = !q.alive, gone = q.escaped;
    ctx.globalAlpha = dead ? .35 : 1;
    ctx.beginPath(); ctx.arc(rx+16, y+16, 14, 0, Math.PI*2);
    ctx.fillStyle = q.color; ctx.fill();
    if (q.id === activeId) { ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke(); }
    ctx.fillStyle = "#fff"; ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(gone ? "✓" : (dead ? "✕" : (q.id+1)), rx+16, y+16);
    ctx.globalAlpha = 1;
    rx += 38;
  }
}

function drawInventory() {
  const p = activePlayer();
  overlay();
  const w = 320, h = 260, x = (canvas.width-w)/2, y = (canvas.height-h)/2;
  ctx.fillStyle = "#1b2630"; roundRect(x,y,w,h,10); ctx.fill();
  ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#e8eef2"; ctx.textAlign = "center";
  ctx.font = "bold 18px sans-serif"; ctx.fillText("Инвентарь — " + p.name, x+w/2, y+30);
  ctx.font = "15px sans-serif"; ctx.textAlign = "left";
  let yy = y+64;
  p.items.forEach((it) => {
    const d = ITEMS[it];
    ctx.fillText(`${d.icon}  ${d.name}  (${d.kind === "firearm" ? "огнестрел" : d.kind === "melee" ? "холодное" : "лечение"})`, x+24, yy);
    if (d.kind === "heal" && p.hp < p.maxHp) {
      addButton(x+w-90, yy-16, 70, 24, "Лечить", () => { p.hp = Math.min(p.maxHp, p.hp+1); }, "#3fb98a");
    }
    yy += 34;
  });
  addButton(x+w/2-50, y+h-44, 100, 30, "Закрыть", () => { showInv = false; });
}

function drawSpinner() {
  overlay();
  const cx = canvas.width/2, cy = canvas.height/2 - 10, R = Math.min(canvas.width, canvas.height)*.28;
  // секторы
  for (let i = 0; i < WHEEL.length; i++) {
    const a0 = i*SEG + spin.rot, a1 = a0 + SEG;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
    ctx.fillStyle = SECTOR[WHEEL[i]].color; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 2; ctx.stroke();
    // иконка
    const am = a0 + SEG/2;
    ctx.save();
    ctx.translate(cx + Math.cos(am)*R*.66, cy + Math.sin(am)*R*.66);
    ctx.font = `${R*.18}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(SECTOR[WHEEL[i]].icon, 0, 0);
    ctx.restore();
  }
  // указатель сверху
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(cx, cy - R - 4);
  ctx.lineTo(cx - 14, cy - R - 26);
  ctx.lineTo(cx + 14, cy - R - 26);
  ctx.closePath(); ctx.fill();
  // центральная кнопка
  ctx.beginPath(); ctx.arc(cx, cy, R*.22, 0, Math.PI*2);
  ctx.fillStyle = spin.spinning ? "#555" : "#c0392b"; ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = `bold ${R*.1}px sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(spin.done ? "" : "КРУТИТЬ", cx, cy);
  if (!spin.spinning && !spin.done) {
    addButton(cx - R*.22, cy - R*.22, R*.44, R*.44, "", () => { spin.spinning = true; spin.t = 0; }, null);
  }
  // подпись зомби
  const zdef = ZTYPES[spin.zombie.type];
  ctx.fillStyle = "#e8eef2"; ctx.font = "bold 18px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`${spin.player.name} ⚔ ${zdef.emoji} ${zdef.name}`, cx, cy - R - 44);
  // результат
  if (spin.done) {
    ctx.fillStyle = "#1b2630"; roundRect(cx-200, cy+R+10, 400, 70, 8); ctx.fill();
    ctx.strokeStyle = "#5a6b78"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#e8eef2"; ctx.font = "15px sans-serif";
    wrapText(spin.message, cx, cy+R+36, 380, 20);
    addButton(cx-60, cy+R+90, 120, 32, "Продолжить", () => {
      spin = null;
      if (state === "SPIN") state = "PLAY";
      checkEnd();
    }, "#3fb98a");
  }
}

function drawMenu() {
  ctx.fillStyle = "#11161c"; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#c0392b"; ctx.font = "bold 40px sans-serif";
  ctx.fillText("ЗОМБИ В ДОМЕ", canvas.width/2, canvas.height/2 - 90);
  ctx.fillStyle = "#e8eef2"; ctx.font = "bold 26px sans-serif";
  ctx.fillText("Заражение", canvas.width/2, canvas.height/2 - 50);
  ctx.fillStyle = "#9fb0bd"; ctx.font = "14px sans-serif";
  ctx.fillText("прототип v0.1", canvas.width/2, canvas.height/2 - 18);
  addButton(canvas.width/2-90, canvas.height/2+10, 180, 46, "ИГРАТЬ", () => newGame(), "#3fb98a");
  ctx.fillStyle = "#7f8f9b"; ctx.font = "13px sans-serif";
  ctx.fillText("Ходи вслепую — зомби вскрываются при контакте.", canvas.width/2, canvas.height/2+80);
}

function drawEnd(title, sub, color) {
  overlay();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = color; ctx.font = "bold 44px sans-serif";
  ctx.fillText(title, canvas.width/2, canvas.height/2 - 50);
  ctx.fillStyle = "#e8eef2"; ctx.font = "18px sans-serif";
  ctx.fillText(sub, canvas.width/2, canvas.height/2 - 6);
  addButton(canvas.width/2-90, canvas.height/2+30, 180, 44, "Заново", () => newGame(), "#3fb98a");
}

// ---------- помощники отрисовки ----------
function overlay() { ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(0,0,canvas.width,canvas.height); }
function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function addButton(x,y,w,h,label,action,color){
  buttons.push({x,y,w,h,action});
  if (label){
    ctx.fillStyle = color || "#3d7bd6"; roundRect(x,y,w,h,8); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, x+w/2, y+h/2);
  }
}
function wrapText(text,cx,y,maxW,lh){
  const words = text.split(" "); let line = ""; const lines = [];
  for (const w of words){ const t = line ? line+" "+w : w;
    if (ctx.measureText(t).width > maxW && line){ lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const startY = y - (lines.length-1)*lh/2;
  lines.forEach((l,i)=> ctx.fillText(l, cx, startY+i*lh));
}

// ---------- цикл ----------
function loop(now){ update(now); draw(); requestAnimationFrame(loop); }
resize();
buildMap();
requestAnimationFrame(loop);
