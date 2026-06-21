/* =============================================================
   Зомби в доме: Заражение — браузерный прототип (v0.2)
   По официальным правилам Magellan.
   Один файл, без зависимостей. Открой index.html в браузере.

   Ключевые правила:
   - Вертушка задаёт ЧИСЛО ШАГОВ: Побег=2, Огнестрел=4, Холодное=3, Череп=1.
   - Ходишь вслепую, карты рубашкой вверх, вскрываются при наступании.
   - Бой = отдельный бросок вертушки (символ решает исход).
   - Победа: найти КЛЮЧИ + КАНИСТРУ и доехать до финишной машины.
   ============================================================= */

"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------- Карта ----------
const COLS = 15, ROWS = 12;
let grid = [];

function buildMap() {
  grid = Array.from({ length: ROWS }, () => new Array(COLS).fill("G"));
  const top = 2, bot = 9, left = 4, right = 12;
  for (let c = left; c <= right; c++) { grid[top][c] = "#"; grid[bot][c] = "#"; }
  for (let r = top; r <= bot; r++) { grid[r][left] = "#"; grid[r][right] = "#"; }
  for (let r = top + 1; r < bot; r++)
    for (let c = left + 1; c < right; c++) grid[r][c] = ".";
  const midC = 8, midR = 5;
  for (let r = top + 1; r < bot; r++) grid[r][midC] = "#";
  for (let c = left + 1; c < right; c++) grid[midR][c] = "#";
  grid[midR][6] = "."; grid[midR][10] = ".";
  grid[3][midC] = "."; grid[7][midC] = ".";
  grid[midR][left] = "D"; grid[midR][right] = "D";
  grid[top][6] = "D"; grid[bot][10] = "D";
  grid[10][2] = "S"; grid[1][13] = "F";
}
function isWalkable(r, c) {
  if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return false;
  return grid[r][c] !== "#";
}

// ---------- Поиск пути / достижимость (BFS) ----------
const K = (r, c) => r * COLS + c;
function findPath(sr, sc, tr, tc) {
  if (!isWalkable(tr, tc)) return null;
  const q = [[sr, sc]], prev = new Map(); prev.set(K(sr, sc), null);
  while (q.length) {
    const [r, c] = q.shift();
    if (r === tr && c === tc) break;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (isWalkable(nr, nc) && !prev.has(K(nr, nc))) { prev.set(K(nr, nc), [r, c]); q.push([nr, nc]); }
    }
  }
  if (!prev.has(K(tr, tc))) return null;
  const path = []; let cur = [tr, tc];
  while (cur) { path.push(cur); cur = prev.get(K(cur[0], cur[1])); }
  return path.reverse();
}
function reachable(sr, sc, maxN) {
  const dist = new Map(); dist.set(K(sr, sc), 0);
  const q = [[sr, sc]];
  while (q.length) {
    const [r, c] = q.shift(); const d = dist.get(K(r, c));
    if (d >= maxN) continue;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (isWalkable(nr, nc) && !dist.has(K(nr, nc))) { dist.set(K(nr, nc), d + 1); q.push([nr, nc]); }
    }
  }
  return dist; // включает старт (d=0)
}

// ---------- Предметы и оружие ----------
const ITEMS = {
  pistol:   { name: "Пистолет",      icon: "🔫", kind: "firearm" },
  musket:   { name: "Мушкет",        icon: "🔫", kind: "firearm" },
  shotgun:  { name: "Двустволка",    icon: "🔫", kind: "firearm" },
  revolver: { name: "Револьвер",     icon: "🔫", kind: "firearm" },
  machete:  { name: "Мачете",        icon: "🔪", kind: "melee"   },
  sword:    { name: "Меч",           icon: "🗡️", kind: "melee"   },
  axe:      { name: "Топор",         icon: "🪓", kind: "melee"   },
  knife:    { name: "Нож",           icon: "🔪", kind: "melee"   },
  grenade:  { name: "Граната",       icon: "💣", kind: "special" },
  dart:     { name: "Ядовитый дротик",icon: "🎯", kind: "special" },
  medkit:   { name: "Аптечка",       icon: "🩹", kind: "heal"    },
  boards:   { name: "Доски",         icon: "🪵", kind: "util"    },
  energy:   { name: "Энергетик",     icon: "⚡", kind: "util"    },
  keys:     { name: "Ключи",         icon: "🔑", kind: "goal"    },
  gas:      { name: "Канистра",      icon: "⛽", kind: "goal"    },
};

// ---------- Герои ----------
const CHAR_DEFS = [
  { name: "Полицейский", color: "#3d7bd6", hp: 4, items: ["pistol"] },
  { name: "Хулиганка",   color: "#c64bd0", hp: 4, items: ["axe"] },
  { name: "Медсестра",   color: "#3fb98a", hp: 5, items: ["knife", "medkit"] },
  { name: "Байкер",      color: "#d68a3d", hp: 5, items: ["shotgun"] },
];
let players = [];
function makePlayers() {
  const spots = [[10,2],[10,3],[9,2],[9,3]];
  players = CHAR_DEFS.map((d, i) => ({
    id: i, name: d.name, color: d.color, hp: d.hp, maxHp: d.hp,
    items: d.items.slice(),
    r: spots[i][0], c: spots[i][1], px: spots[i][1], py: spots[i][0],
    path: null, step: 0, moveT: 0, prevR: null, prevC: null,
    alive: true, escaped: false,
  }));
}
const hasKind = (p, kind) => p.items.some(it => ITEMS[it].kind === kind);
const firstOfKind = (p, kind) => p.items.find(it => ITEMS[it].kind === kind);
function removeItem(p, id) { const i = p.items.indexOf(id); if (i >= 0) p.items.splice(i, 1); }

// ---------- Зомби ----------
const ZTYPES = {
  normal:    { name: "Обычный зомби",  emoji: "🧟", color: "#7fae53", lives: 1 },
  dog:       { name: "Зомби-собака",   emoji: "🐕", color: "#a08050", lives: 1 },
  rat:       { name: "Зомби-крыса",    emoji: "🐀", color: "#8a8a8a", lives: 1 },
  acrobat:   { name: "Зомби-акробат",  emoji: "🤸", color: "#c2562f", lives: 1, circus: true },
  clown:     { name: "Зомби-клоун",    emoji: "🤡", color: "#c2562f", lives: 1, circus: true },
  strongman: { name: "Зомби-силач",    emoji: "💪", color: "#c2562f", lives: 1, circus: true },
  nurseZ:    { name: "Зомби-медсестра",emoji: "💉", color: "#c2562f", lives: 2, circus: true, revives: true },
  monkey:    { name: "Зомби-обезьяна", emoji: "🐒", color: "#c2562f", lives: 1, circus: true },
  bear:      { name: "Босс-медведь",   emoji: "🐻", color: "#7a3030", lives: 2, circus: true, onlyDart: true },
};
const ZPOOL = [
  ...Array(8).fill("normal"),
  ...Array(5).fill("dog"),
  ...Array(5).fill("rat"),
  "acrobat", "clown", "strongman", "nurseZ", "monkey", "bear",
]; // 24

// ---------- Карты на поле (рубашкой вверх) ----------
// Колода: 24 зомби + оружие + предметы. cards: {r,c,kind:'zombie'|'item', ...}
let cards = [];
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]];} return a; }

function placeCards() {
  cards = [];
  const deck = [];
  for (const t of ZPOOL) deck.push({ kind: "zombie", ztype: t, lives: ZTYPES[t].lives, revealed: false, dead: false });
  // оружие (11)
  ["pistol","revolver","musket","shotgun","machete","sword","axe","knife","grenade","dart","grenade"]
    .forEach(id => deck.push({ kind: "item", item: id, revealed: false }));
  // предметы (12) — ключи и канистра обязательны для победы
  ["keys","gas","medkit","medkit","medkit","medkit","boards","boards","energy","energy","medkit","energy"]
    .forEach(id => deck.push({ kind: "item", item: id, revealed: false }));
  shuffle(deck);

  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!isWalkable(r, c)) continue;
    if (grid[r][c] === "S" || grid[r][c] === "F") continue;
    if (Math.abs(r - 10) + Math.abs(c - 2) <= 3) continue; // зона старта
    cells.push([r, c]);
  }
  shuffle(cells);
  for (let i = 0; i < deck.length && i < cells.length; i++) {
    deck[i].r = cells[i][0]; deck[i].c = cells[i][1];
    cards.push(deck[i]);
  }
}
function cardAt(r, c) { return cards.find(z => z.r === r && z.c === c && !(z.kind === "zombie" && z.dead)) || null; }

// ---------- Вертушка ----------
// 10 секторов: Побег×2, Огнестрел×4, Холодное×3, Череп×1
const WHEEL = ["run","firearm","run","firearm","melee","firearm","melee","firearm","melee","skull"];
const SEG = (Math.PI * 2) / WHEEL.length;
const STEPS = { run: 2, firearm: 4, melee: 3, skull: 1 };
const SECTOR = {
  run:     { label: "Побег",    color: "#3fb98a", icon: "🏃" },
  firearm: { label: "Огнестрел", color: "#d6a03d", icon: "🔫" },
  melee:   { label: "Холодное", color: "#b8693a", icon: "🗡️" },
  skull:   { label: "Череп",    color: "#7a3030", icon: "💀" },
};

// ---------- Состояние ----------
let state = "MENU";            // MENU PLAY WIN LOSE
let phase = "spin";            // spin | move | combat
let activeId = 0;
let spin = null;               // {mode:'move'|'combat', rot,target,t,resultIdx,spinning,done,message,zombie}
let pendingSteps = 0;
let reachSet = null;
let team = { keys: false, gas: false };
let log = "";
let cell = 32, ox = 0, oy = 0, buttons = [], showInv = false;

const active = () => players[activeId];

function newGame() {
  buildMap(); makePlayers(); placeCards();
  team = { keys: false, gas: false };
  activeId = 0; showInv = false; spin = null; reachSet = null;
  state = "PLAY"; log = "Ход: " + active().name;
  startTurn();
}

function startTurn() {
  const p = active();
  if (!p || !p.alive || p.escaped) { endTurn(); return; }
  phase = "spin";
  spin = makeSpin("move");
  log = `Ход: ${p.name}. Крути вертушку — узнай, на сколько клеток идти.`;
}

function endTurn() {
  if (checkEnd()) return;
  for (let k = 1; k <= players.length; k++) {
    const id = (activeId + k) % players.length;
    if (players[id].alive && !players[id].escaped) { activeId = id; startTurn(); return; }
  }
  checkEnd();
}

function checkEnd() {
  if (players.every(p => !p.alive)) { state = "LOSE"; return true; }
  if (players.some(p => p.escaped)) { state = "WIN"; return true; }
  return false;
}

// ---------- Вертушка: запуск/решение ----------
function makeSpin(mode, zombie = null) {
  const idx = (Math.random() * WHEEL.length) | 0;
  const target = Math.PI * 2 * 5 - (idx * SEG + SEG / 2) - Math.PI / 2;
  return { mode, rot: 0, target, t: 0, resultIdx: idx, spinning: false, done: false, message: "", zombie };
}

function resolveSpin() {
  const sym = WHEEL[spin.resultIdx];
  if (spin.mode === "move") {
    pendingSteps = STEPS[sym];
    spin.message = `${SECTOR[sym].icon} ${SECTOR[sym].label} — иди на ${pendingSteps} клеток (или меньше).`;
  } else {
    resolveCombat(sym);
  }
  spin.done = true;
}

function afterSpin() {
  // нажата "Продолжить" после броска
  if (spin.mode === "move") {
    spin = null; phase = "move";
    const p = active();
    reachSet = reachable(p.r, p.c, pendingSteps);
    log = `${active().name}: выбери клетку (до ${pendingSteps} шагов).`;
  } else {
    // combat: смотрим что записано в spin
    if (spin.combatEnd) { spin = null; reachSet = null; endTurn(); }
    else { spin = makeSpin("combat", spin.zombie); } // крутим снова
  }
}

function resolveCombat(sym) {
  const p = active(), z = spin.zombie, zd = ZTYPES[z.ztype];
  spin.combatEnd = false;
  if (sym === "skull") {
    damage(p, 1);
    if (!p.alive) { spin.message = `💀 Череп! ${p.name} погибает.`; spin.combatEnd = true; }
    else spin.message = `💀 Череп! ${zd.name} кусает: −1 ❤. Крути снова.`;
    return;
  }
  if (sym === "run") {
    // отбегаем на предыдущую клетку
    if (p.prevR != null) { p.r = p.prevR; p.c = p.prevC; p.px = p.c; p.py = p.r; }
    spin.message = `🏃 Побег! ${p.name} отступает. Зомби остаётся.`;
    spin.combatEnd = true; return;
  }
  // firearm / melee
  if (z.ztype === "bear") {
    spin.message = `🐻 Босс-медведя берёт только 🎯 ядовитый дротик! Крути снова или беги.`;
    return;
  }
  const need = sym; // 'firearm' | 'melee'
  if (hasKind(p, need)) {
    const w = firstOfKind(p, need);
    let killMsg = `${SECTOR[sym].icon} ${ITEMS[w].name}: ${zd.name} уничтожен!`;
    if (need === "firearm") removeItem(p, w); // огнестрел тратится
    hitZombie(z);
    if (!z.dead) killMsg = `💉 ${zd.name} воскресает! Нужен ещё удар. Крути снова.`;
    spin.message = killMsg;
    spin.combatEnd = z.dead;
  } else {
    spin.message = `${SECTOR[sym].icon} Нет такого оружия! Крути снова.`;
  }
}

function hitZombie(z) {
  z.lives -= 1;
  if (z.lives <= 0) z.dead = true;
}

function useSpecial(itemId) {
  // спецоружие: используется в бою вместо вертушки
  const p = active(), z = spin.zombie, zd = ZTYPES[z.ztype];
  if (!spin || spin.mode !== "combat") return;
  if (itemId === "dart") {
    z.dead = true; removeItem(p, "dart");
    spin.message = `🎯 Ядовитый дротик: ${zd.name} уничтожен!`; spin.done = true; spin.combatEnd = true;
  } else if (itemId === "grenade") {
    if (z.ztype === "bear") { spin.message = "💣 Гранатой медведя не убить!"; spin.done = true; return; }
    z.dead = true; removeItem(p, "grenade");
    spin.message = `💣 Граната: ${zd.name} уничтожен!`; spin.done = true; spin.combatEnd = true;
  }
}

function damage(p, n) {
  p.hp -= n;
  if (p.hp <= 0) { p.hp = 0; p.alive = false; p.path = null; }
}

// ---------- Движение ----------
function tryMoveTo(r, c) {
  if (phase !== "move" || !reachSet) return;
  const p = active();
  if (p.path) return;
  const d = reachSet.get(K(r, c));
  if (d == null || d === 0) return;
  const path = findPath(p.r, p.c, r, c);
  if (!path || path.length - 1 > pendingSteps) return;
  p.path = path; p.step = 0; p.moveT = 0;
  reachSet = null;
}

function onEnterCell(p, r, c) {
  p.r = r; p.c = c;
  const card = cardAt(r, c);
  if (!card) return "continue";
  if (card.kind === "zombie") {
    card.revealed = true;
    p.prevR = (p.step > 0) ? p.path[p.step - 1][0] : null;
    p.prevC = (p.step > 0) ? p.path[p.step - 1][1] : null;
    p.path = null;
    phase = "combat";
    spin = makeSpin("combat", card);
    log = `Бой: ${p.name} против ${ZTYPES[card.ztype].name}!`;
    return "combat";
  }
  // предмет
  card.revealed = true;
  pickUp(p, card);
  return "continue";
}

function pickUp(p, card) {
  const id = card.item, def = ITEMS[id];
  // забираем карту с поля
  cards = cards.filter(x => x !== card);
  if (def.kind === "goal") {
    if (id === "keys") team.keys = true;
    if (id === "gas") team.gas = true;
    log = `${p.name} нашёл ${def.icon} ${def.name}!`;
  } else {
    p.items.push(id);
    log = `${p.name} подобрал ${def.icon} ${def.name}.`;
  }
}

function arrive(p) {
  // дошёл до конца пути без зомби
  p.path = null;
  if (grid[p.r][p.c] === "F") {
    if (team.keys && team.gas) { p.escaped = true; checkEnd(); return; }
    else { log = "Нужны 🔑 ключи и ⛽ канистра, чтобы уехать!"; }
  }
  endTurn();
}

// ---------- Ввод ----------
function resize() {
  const W = Math.min(window.innerWidth, 1100);
  const H = Math.min(window.innerHeight - 28, 820);
  cell = Math.floor(Math.min(W / COLS, H / ROWS));
  canvas.width = cell * COLS; canvas.height = cell * ROWS;
}
window.addEventListener("resize", resize);

function cpos(e) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  return { x: cx * (canvas.width / rect.width), y: cy * (canvas.height / rect.height) };
}
function onPress(e) {
  e.preventDefault();
  const { x, y } = cpos(e);
  for (const b of buttons) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { b.action(); return; }
  if (state === "PLAY" && phase === "move" && !showInv) {
    tryMoveTo(Math.floor((y - oy) / cell), Math.floor((x - ox) / cell));
  }
}
canvas.addEventListener("mousedown", onPress);
canvas.addEventListener("touchstart", onPress, { passive: false });
window.addEventListener("keydown", (e) => {
  if (e.key === "Tab") { e.preventDefault(); if (state === "PLAY") showInv = !showInv; }
});

// ---------- Цикл обновления ----------
let last = performance.now();
function update(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const p = active();
  if (state === "PLAY" && p && p.path) {
    p.moveT += dt * 6;
    if (p.moveT >= 1) {
      p.moveT = 0; p.step++;
      if (p.step >= p.path.length) { arrive(p); }
      else {
        const cellRC = p.path[p.step];
        const res = onEnterCell(p, cellRC[0], cellRC[1]);
        if (res === "combat") { /* стоп */ }
      }
    }
    if (p.path) {
      const a = p.path[p.step], b = p.path[Math.min(p.step + 1, p.path.length - 1)];
      p.px = a[1] + (b[1] - a[1]) * p.moveT;
      p.py = a[0] + (b[0] - a[0]) * p.moveT;
    }
  } else if (p && !p.path) { p.px = p.c; p.py = p.r; }

  if (state === "PLAY" && spin && spin.spinning && !spin.done) {
    spin.t += dt;
    const k = Math.min(1, spin.t / 2.4);
    spin.rot = spin.target * (1 - Math.pow(1 - k, 3));
    if (k >= 1) { spin.spinning = false; resolveSpin(); }
  }
}

// ---------- Отрисовка ----------
function draw() {
  buttons = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (state === "MENU") { drawMenu(); return; }
  drawBoard(); drawCards(); drawPlayers(); drawHUD(); drawLog();
  if (phase === "move" && reachSet) drawReach();
  if (showInv) drawInventory();
  if (spin) drawSpinner();
  if (state === "WIN") drawEnd("ПОБЕДА!", "Выжившие уехали на машине 🚗💨", "#3fb98a");
  if (state === "LOSE") drawEnd("ПОРАЖЕНИЕ", "Все герои пали 🧟", "#c0392b");
}

function drawBoard() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = grid[r][c], x = ox + c * cell, y = oy + r * cell;
    let col = "#2f6b3a";
    if (t === ".") col = "#caa56a"; else if (t === "#") col = "#5a4634";
    else if (t === "D") col = "#9c7b3e"; else if (t === "S") col = "#d8c24a";
    else if (t === "F") col = "#e8eef2";
    ctx.fillStyle = col; ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = "rgba(0,0,0,.12)"; ctx.strokeRect(x + .5, y + .5, cell - 1, cell - 1);
    if (t === "S" || t === "F") {
      ctx.font = `${cell * .6}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🚗", x + cell / 2, y + cell / 2);
    }
  }
}
function drawReach() {
  ctx.fillStyle = "rgba(80,180,255,.28)";
  for (const [key, d] of reachSet) {
    if (d === 0) continue;
    const r = Math.floor(key / COLS), c = key % COLS;
    ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
  }
}
function drawCards() {
  for (const z of cards) {
    if (z.kind === "zombie" && z.dead) continue;
    const x = ox + z.c * cell, y = oy + z.r * cell;
    const revealed = z.revealed;
    if (!revealed) {
      ctx.fillStyle = "#3a2f4a"; roundRect(x + cell*.12, y + cell*.12, cell*.76, cell*.76, 4); ctx.fill();
      ctx.strokeStyle = "#6b5b8a"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#6b5b8a"; ctx.font = `${cell*.4}px serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", x + cell/2, y + cell/2);
    } else if (z.kind === "zombie") {
      const def = ZTYPES[z.ztype];
      ctx.fillStyle = def.color; roundRect(x + cell*.1, y + cell*.1, cell*.8, cell*.8, 4); ctx.fill();
      ctx.font = `${cell*.5}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(def.emoji, x + cell/2, y + cell/2);
    }
  }
}
function drawPlayers() {
  for (const p of players) {
    if (!p.alive || p.escaped) continue;
    const x = ox + p.px * cell + cell/2, y = oy + p.py * cell + cell/2;
    ctx.beginPath(); ctx.arc(x, y, cell*.32, 0, Math.PI*2);
    ctx.fillStyle = p.color; ctx.fill();
    ctx.lineWidth = p.id === activeId ? 4 : 2;
    ctx.strokeStyle = p.id === activeId ? "#fff" : "rgba(0,0,0,.4)"; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = `bold ${cell*.3}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(p.name[0], x, y);
  }
}
function drawHUD() {
  const p = active(); if (!p) return;
  const w = Math.min(270, canvas.width * .45), h = 100, x = 8, y = 8;
  ctx.fillStyle = "rgba(10,16,22,.85)"; roundRect(x, y, w, h, 8); ctx.fill();
  ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(x+26, y+28, 18, 0, Math.PI*2); ctx.fillStyle = p.color; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "bold 18px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(p.name[0], x+26, y+28);
  ctx.fillStyle = "#e8eef2"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "left"; ctx.fillText(p.name, x+52, y+20);
  ctx.font = "15px serif";
  let hs = ""; for (let i=0;i<p.maxHp;i++) hs += i<p.hp ? "❤" : "🤍"; ctx.fillText(hs, x+52, y+40);
  ctx.font = "17px serif"; ctx.fillText(p.items.map(it => ITEMS[it].icon).join(" ") || "—", x+12, y+66);
  // цели команды
  ctx.font = "13px sans-serif"; ctx.fillStyle = "#cdd8e0"; ctx.textAlign = "left";
  ctx.fillText(`Цель: ${team.keys ? "🔑✓" : "🔑✗"}  ${team.gas ? "⛽✓" : "⛽✗"} → 🚗`, x+12, y+88);
  // ростер
  let rx = x + w + 8;
  for (const q of players) {
    ctx.globalAlpha = !q.alive ? .35 : 1;
    ctx.beginPath(); ctx.arc(rx+16, y+16, 14, 0, Math.PI*2); ctx.fillStyle = q.color; ctx.fill();
    if (q.id === activeId) { ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke(); }
    ctx.fillStyle = "#fff"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(q.escaped ? "✓" : (!q.alive ? "✕" : (q.id+1)), rx+16, y+16);
    ctx.globalAlpha = 1; rx += 38;
  }
}
function drawLog() {
  ctx.fillStyle = "rgba(10,16,22,.7)";
  const w = Math.min(canvas.width - 16, 560), x = (canvas.width - w)/2, y = canvas.height - 34;
  roundRect(x, y, w, 26, 6); ctx.fill();
  ctx.fillStyle = "#e8eef2"; ctx.font = "13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(log, canvas.width/2, y + 13);
  // кнопка инвентаря
  addButton(canvas.width - 96, 8, 88, 26, "Инвентарь", () => { showInv = !showInv; }, "#3d5566");
}

function drawInventory() {
  const p = active(); overlay();
  const w = 340, h = 300, x = (canvas.width-w)/2, y = (canvas.height-h)/2;
  ctx.fillStyle = "#1b2630"; roundRect(x,y,w,h,10); ctx.fill();
  ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#e8eef2"; ctx.textAlign = "center"; ctx.font = "bold 18px sans-serif";
  ctx.fillText("Инвентарь — " + p.name, x+w/2, y+28);
  ctx.font = "14px sans-serif"; ctx.textAlign = "left";
  let yy = y+58;
  if (!p.items.length) ctx.fillText("(пусто)", x+24, yy);
  p.items.forEach(it => {
    const d = ITEMS[it];
    ctx.fillStyle = "#e8eef2"; ctx.fillText(`${d.icon}  ${d.name}`, x+24, yy);
    if (d.kind === "heal" && p.hp < p.maxHp)
      addButton(x+w-92, yy-15, 72, 22, "Лечить", () => { p.hp=Math.min(p.maxHp,p.hp+1); removeItem(p,it); }, "#3fb98a");
    yy += 30;
  });
  addButton(x+w/2-50, y+h-42, 100, 30, "Закрыть", () => { showInv = false; });
}

function drawSpinner() {
  overlay();
  const cx = canvas.width/2, cy = canvas.height/2 - 6, R = Math.min(canvas.width, canvas.height)*.27;
  for (let i = 0; i < WHEEL.length; i++) {
    const a0 = i*SEG + spin.rot;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a0+SEG); ctx.closePath();
    ctx.fillStyle = SECTOR[WHEEL[i]].color; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 2; ctx.stroke();
    const am = a0 + SEG/2;
    ctx.save(); ctx.translate(cx + Math.cos(am)*R*.66, cy + Math.sin(am)*R*.66);
    ctx.font = `${R*.13}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(SECTOR[WHEEL[i]].icon, 0, -R*.05);
    ctx.font = `bold ${R*.11}px sans-serif`; ctx.fillStyle = "#fff";
    ctx.fillText(STEPS[WHEEL[i]], 0, R*.1); ctx.restore();
  }
  // указатель
  ctx.fillStyle = "#fff"; ctx.beginPath();
  ctx.moveTo(cx, cy - R - 4); ctx.lineTo(cx - 13, cy - R - 24); ctx.lineTo(cx + 13, cy - R - 24);
  ctx.closePath(); ctx.fill();
  // центр-кнопка
  ctx.beginPath(); ctx.arc(cx, cy, R*.22, 0, Math.PI*2);
  ctx.fillStyle = spin.spinning ? "#555" : "#c0392b"; ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = `bold ${R*.1}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (!spin.done) ctx.fillText(spin.spinning ? "..." : "КРУТИТЬ", cx, cy);
  if (!spin.spinning && !spin.done)
    addButton(cx - R*.22, cy - R*.22, R*.44, R*.44, "", () => { spin.spinning = true; spin.t = 0; }, null);
  // заголовок
  ctx.fillStyle = "#e8eef2"; ctx.font = "bold 17px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const title = spin.mode === "move" ? `${active().name}: бросок на движение`
    : `Бой: ${active().name} ⚔ ${ZTYPES[spin.zombie.ztype].emoji} ${ZTYPES[spin.zombie.ztype].name}`;
  ctx.fillText(title, cx, cy - R - 40);
  // спецоружие в бою
  if (spin.mode === "combat" && !spin.spinning && !spin.done) {
    const p = active(); let bx = cx - 150;
    for (const sp of ["dart","grenade"]) if (p.items.includes(sp)) {
      addButton(bx, cy + R + 6, 140, 28, `${ITEMS[sp].icon} ${ITEMS[sp].name}`, () => useSpecial(sp), "#8a5a2a");
      bx += 150;
    }
  }
  // результат
  if (spin.done) {
    ctx.fillStyle = "#1b2630"; roundRect(cx-210, cy+R+6, 420, 56, 8); ctx.fill();
    ctx.strokeStyle = "#5a6b78"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#e8eef2"; ctx.font = "14px sans-serif"; wrapText(spin.message, cx, cy+R+30, 400, 18);
    addButton(cx-60, cy+R+74, 120, 32, "Продолжить", afterSpin, "#3fb98a");
  }
}

function drawMenu() {
  ctx.fillStyle = "#11161c"; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#c0392b"; ctx.font = "bold 40px sans-serif";
  ctx.fillText("ЗОМБИ В ДОМЕ", canvas.width/2, canvas.height/2 - 100);
  ctx.fillStyle = "#e8eef2"; ctx.font = "bold 26px sans-serif";
  ctx.fillText("Заражение", canvas.width/2, canvas.height/2 - 60);
  ctx.fillStyle = "#9fb0bd"; ctx.font = "14px sans-serif";
  ctx.fillText("прототип v0.2 — по правилам Magellan", canvas.width/2, canvas.height/2 - 28);
  addButton(canvas.width/2-90, canvas.height/2+4, 180, 46, "ИГРАТЬ", () => newGame(), "#3fb98a");
  ctx.fillStyle = "#7f8f9b"; ctx.font = "13px sans-serif";
  ctx.fillText("Найди 🔑 ключи и ⛽ канистру — и уезжай на машине!", canvas.width/2, canvas.height/2+78);
}
function drawEnd(title, sub, color) {
  overlay(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = color; ctx.font = "bold 44px sans-serif"; ctx.fillText(title, canvas.width/2, canvas.height/2 - 50);
  ctx.fillStyle = "#e8eef2"; ctx.font = "18px sans-serif"; ctx.fillText(sub, canvas.width/2, canvas.height/2 - 6);
  addButton(canvas.width/2-90, canvas.height/2+30, 180, 44, "Заново", () => newGame(), "#3fb98a");
}

// ---------- помощники ----------
function overlay() { ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(0,0,canvas.width,canvas.height); }
function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function addButton(x,y,w,h,label,action,color){
  buttons.push({x,y,w,h,action});
  if (label){ ctx.fillStyle = color || "#3d7bd6"; roundRect(x,y,w,h,8); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, x+w/2, y+h/2); }
}
function wrapText(text,cx,y,maxW,lh){
  const words = String(text).split(" "); let line = ""; const lines = [];
  for (const w of words){ const t = line ? line+" "+w : w;
    if (ctx.measureText(t).width > maxW && line){ lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const sy = y - (lines.length-1)*lh/2; lines.forEach((l,i)=> ctx.fillText(l, cx, sy+i*lh));
}

// ---------- запуск ----------
function loop(now){ update(now); draw(); requestAnimationFrame(loop); }
resize(); buildMap();
requestAnimationFrame(loop);
