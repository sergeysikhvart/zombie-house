/* =============================================================
   Зомби в доме: Заражение — браузерный прототип (v0.3)
   Один файл, без зависимостей. Открой index.html в браузере.

   Правила (по уточнениям игрока):
   - Карта: сад 11×11, дом 7×7 (отступ 2 клетки от края сада).
   - Крутилка: 4 равных сектора — Череп, Побег, Огнестрел, Холодное.
     В фазе хода символ задаёт число шагов: Побег=2, Огнестрел=4,
     Холодное=3, Череп=1.
   - Бой = отдельный бросок. Спецсредства меняют исход.
   - Игроки не могут вставать на клетку другого игрока.
   - Зомби (вскрытые) двигаются: обычный/девка −1, крыса =, собака +1.
   - Победа: найти КЛЮЧИ + КАНИСТРУ и доехать до финишной машины.
   ============================================================= */

"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// ---------- Карта: сад 11×11, дом 7×7 ----------
const COLS = 11, ROWS = 11;
let grid = [];

function buildMap() {
  // весь сад — проходимая трава
  grid = Array.from({ length: ROWS }, () => new Array(COLS).fill("G"));
  // дом 7×7: отступ 2 клетки от края → строки/столбцы 2..8
  const a = 2, b = 8;
  for (let c = a; c <= b; c++) { grid[a][c] = "#"; grid[b][c] = "#"; }
  for (let r = a; r <= b; r++) { grid[r][a] = "#"; grid[r][b] = "#"; }
  // интерьер дома — открытый (крест убран; комнаты сделаем позже)
  for (let r = a + 1; r < b; r++)
    for (let c = a + 1; c < b; c++) grid[r][c] = ".";
  // двери по сторонам дома
  grid[a][5] = "D"; grid[b][5] = "D"; grid[5][a] = "D"; grid[5][b] = "D";
  // машины: старт (жёлтая) и финиш (белая)
  grid[10][0] = "S"; grid[0][10] = "F";
}
function isWalkable(r, c) {
  if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return false;
  return grid[r][c] !== "#" && grid[r][c] !== "B"; // B — заколоченная дверь
}
function adjacentDoorCell(p) {
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const r = p.r + dr, c = p.c + dc;
    if (r >= 0 && c >= 0 && r < ROWS && c < COLS && grid[r][c] === "D") return [r, c];
  }
  return null;
}
function useBoards() {
  const p = active();
  if (!p.items.includes("boards")) return;
  const d = adjacentDoorCell(p);
  if (!d) { log = "Рядом нет двери, чтобы заколотить."; return; }
  grid[d[0]][d[1]] = "B"; removeItem(p, "boards");
  if (reachSet) reachSet = reachable(p.r, p.c, pendingSteps, otherPlayersBlocked(p.id));
  log = `🪵 ${p.name} заколотил дверь — зомби не пройдут.`;
}

// ---------- Поиск пути / достижимость (BFS) ----------
const K = (r, c) => r * COLS + c;
function passable(r, c, blocked) {
  if (!isWalkable(r, c)) return false;
  if (blocked && blocked.has(K(r, c))) return false;
  return true;
}
function findPath(sr, sc, tr, tc, blocked) {
  if (!isWalkable(tr, tc)) return null;
  const q = [[sr, sc]], prev = new Map(); prev.set(K(sr, sc), null);
  while (q.length) {
    const [r, c] = q.shift();
    if (r === tr && c === tc) break;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      const isTarget = (nr === tr && nc === tc);
      const ok = isTarget ? isWalkable(nr, nc) : passable(nr, nc, blocked);
      if (ok && !prev.has(K(nr, nc))) { prev.set(K(nr, nc), [r, c]); q.push([nr, nc]); }
    }
  }
  if (!prev.has(K(tr, tc))) return null;
  const path = []; let cur = [tr, tc];
  while (cur) { path.push(cur); cur = prev.get(K(cur[0], cur[1])); }
  return path.reverse();
}
function reachable(sr, sc, maxN, blocked) {
  const dist = new Map(); dist.set(K(sr, sc), 0);
  const q = [[sr, sc]];
  while (q.length) {
    const [r, c] = q.shift(); const d = dist.get(K(r, c));
    if (d >= maxN) continue;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc;
      if (passable(nr, nc, blocked) && !dist.has(K(nr, nc))) { dist.set(K(nr, nc), d + 1); q.push([nr, nc]); }
    }
  }
  return dist; // включает старт (d=0)
}
// клетки, занятые другими живыми игроками (нельзя вставать)
function otherPlayersBlocked(selfId) {
  const set = new Set();
  for (const q of players) {
    if (q.id === selfId || !q.alive || q.escaped) continue;
    set.add(K(q.r, q.c));
  }
  return set;
}

// ---------- Предметы и оружие ----------
const ITEMS = {
  pistol:   { name: "Пистолет",        icon: "🔫", kind: "firearm" },
  musket:   { name: "Мушкет",          icon: "🔫", kind: "firearm" },
  shotgun:  { name: "Двухстволка",     icon: "🔫", kind: "firearm" }, // нужен символ «Огнестрел»
  revolver: { name: "Револьвер",       icon: "🔫", kind: "firearm" },
  machete:  { name: "Мачете",          icon: "🔪", kind: "melee"   },
  katana:   { name: "Катана",          icon: "🗡️", kind: "melee"   }, // нужен символ «Холодное»
  knife:    { name: "Нож",             icon: "🔪", kind: "melee"   },
  grenade:  { name: "Граната",         icon: "💣", kind: "special" }, // авто
  dart:     { name: "Ядовитый дротик", icon: "🎯", kind: "special" }, // на выбор
  lasso:    { name: "Лассо",           icon: "🪢", kind: "special" }, // на выбор, обездвиживает
  poison:   { name: "Яд",              icon: "🧪", kind: "special" }, // авто при укусе
  medkit:   { name: "Аптечка",         icon: "🩹", kind: "heal"    },
  boards:   { name: "Доски",           icon: "🪵", kind: "util"    },
  energy:   { name: "Энергетик",       icon: "⚡", kind: "util"    }, // +1 к ходу, на выбор
  keys:     { name: "Ключи",           icon: "🔑", kind: "goal"    },
  gas:      { name: "Канистра",        icon: "⛽", kind: "goal"    },
};
const INV_MAX = 4;                  // у игрока всего 4 места под предметы
const FLASH_MS = 5000;             // подобранная карта видна на полу ещё 5 сек

// ---------- Герои ----------
const HEAL_MAX = 5; // лечиться можно до 5
const CHAR_DEFS = [
  { name: "Полицейский", color: "#3d7bd6", hp: 3, items: ["revolver"] },
  { name: "Хулиганка",   color: "#c64bd0", hp: 3, items: ["machete"] },
  { name: "Медсестра",   color: "#3fb98a", hp: 3, items: ["knife", "medkit"] },
  { name: "Байкер",      color: "#d68a3d", hp: 3, items: ["musket"] },
];
let players = [];
let playerCount = 4;
function makePlayers(n) {
  const spots = [[10,1],[9,0],[9,1],[10,2]];
  players = CHAR_DEFS.slice(0, n).map((d, i) => ({
    id: i, name: d.name, color: d.color, hp: d.hp, maxHp: HEAL_MAX,
    items: d.items.slice(),
    r: spots[i][0], c: spots[i][1], px: spots[i][1], py: spots[i][0],
    path: null, step: 0, moveT: 0, prevR: null, prevC: null,
    movedThisTurn: false, alive: true, escaped: false,
  }));
}
const hasKind = (p, kind) => p.items.some(it => ITEMS[it].kind === kind);
const firstOfKind = (p, kind) => p.items.find(it => ITEMS[it].kind === kind);
function removeItem(p, id) { const i = p.items.indexOf(id); if (i >= 0) p.items.splice(i, 1); }

// ---------- Зомби ----------
// moveMod: модификатор к выпавшему числу шагов при ходе зомби
const ZTYPES = {
  normal: { name: "Обычный зомби",   emoji: "🧟",   color: "#7fae53", lives: 1, moveMod: -1 },
  girl:   { name: "Зомби-девка",     emoji: "🧟‍♀️", color: "#8fae63", lives: 1, moveMod: -1 },
  dog:    { name: "Зомби-собака",    emoji: "🐕",   color: "#a08050", lives: 1, moveMod: +1 },
  rat:    { name: "Зомби-крыса",     emoji: "🐀",   color: "#8a8a8a", lives: 1, moveMod: 0  },
  clown:  { name: "Зомби-клоун",     emoji: "🤡",   color: "#c2562f", lives: 1, moveMod: 0, circus: true },
  nurseZ: { name: "Зомби-медсестра", emoji: "💉",   color: "#c2562f", lives: 2, moveMod: 0, circus: true, revives: true },
  monkey: { name: "Зомби-обезьяна",  emoji: "🐒",   color: "#c2562f", lives: 1, moveMod: 0, circus: true },
  bear:   { name: "Босс-медведь",    emoji: "🐻",   color: "#7a3030", lives: 2, moveMod: 0, circus: true, onlyDart: true },
};
// 24: 4 обычных + 4 девки + 5 крыс + 5 собак + 6 цирковых
const ZPOOL = [
  ...Array(4).fill("normal"),
  ...Array(4).fill("girl"),
  ...Array(5).fill("rat"),
  ...Array(5).fill("dog"),
  "clown", "clown", "nurseZ", "monkey", "monkey", "bear",
];

// ---------- Карты на поле (рубашкой вверх) ----------
let cards = [];
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]];} return a; }

function placeCards() {
  cards = [];
  const deck = [];
  for (const t of ZPOOL) deck.push({ kind: "zombie", ztype: t, lives: ZTYPES[t].lives, revealed: false, dead: false, immobilized: false });
  // предметы по уточнённому списку игрока
  const itemList = [
    "boards","boards","boards",        // 3 доски
    "revolver","revolver",             // 2 револьвера
    "machete","machete",               // 2 мачете
    "katana",                          // 1 катана (по ауре)
    "musket",                          // 1 мушкет
    "shotgun",                         // 1 двухстволка (по ауре)
    "grenade","grenade",               // 2 гранаты (авто)
    "dart",                            // 1 дротик (выбор)
    "lasso","lasso",                   // 2 лассо (выбор)
    "poison",                          // 1 яд (авто)
    "energy","energy",                 // 2 энергетика (выбор)
    "medkit","medkit","medkit",        // 3 аптечки
    "keys","gas",                      // цели для победы
  ];
  itemList.forEach(id => deck.push({ kind: "item", item: id, revealed: false }));
  shuffle(deck);

  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!isWalkable(r, c)) continue;
    if (grid[r][c] === "S" || grid[r][c] === "F") continue;
    if (Math.abs(r - 10) + Math.abs(c - 0) <= 3) continue; // зона старта
    cells.push([r, c]);
  }
  shuffle(cells);
  for (let i = 0; i < deck.length && i < cells.length; i++) {
    deck[i].r = cells[i][0]; deck[i].c = cells[i][1];
    cards.push(deck[i]);
  }
}
function cardAt(r, c) { return cards.find(z => z.r === r && z.c === c && !z.taken && !(z.kind === "zombie" && z.dead)) || null; }

// ---------- Вертушка: 4 сектора, по 1 ----------
const WHEEL = ["skull", "run", "firearm", "melee"];
const SEG = (Math.PI * 2) / WHEEL.length;
const STEPS = { run: 2, firearm: 4, melee: 3, skull: 1 };
const SECTOR = {
  run:     { label: "Побег",     color: "#3fb98a", icon: "🏃" },
  firearm: { label: "Огнестрел", color: "#d6a03d", icon: "🔫" },
  melee:   { label: "Холодное",  color: "#b8693a", icon: "🗡️" },
  skull:   { label: "Череп",     color: "#7a3030", icon: "💀" },
};

// ---------- Состояние ----------
let state = "MENU";            // MENU PLAY WIN LOSE
let phase = "spin";            // spin | move | combat
let activeId = 0;
let spin = null;
let pendingSteps = 0;
let reachSet = null;
let team = { keys: false, gas: false };
let log = "";
let toast = null;              // всплывающее уведомление {msg, color, until}
let cell = 32, ox = 0, oy = 0, buttons = [], showInv = false;

const active = () => players[activeId];
function showToast(msg, color) { toast = { msg, color: color || "#3fb98a", until: performance.now() + 2600 }; }

function newGame(n) {
  playerCount = n;
  buildMap(); makePlayers(n); placeCards();
  team = { keys: false, gas: false };
  activeId = 0; showInv = false; spin = null; reachSet = null;
  state = "PLAY"; log = "Ход: " + active().name;
  startTurn();
}

function startTurn() {
  const p = active();
  if (!p || !p.alive || p.escaped) { endTurn(); return; }
  p.movedThisTurn = false;
  phase = "spin";
  spin = makeSpin("move");
  log = `Ход: ${p.name}. Крути вертушку — узнай, на сколько клеток идти.`;
}

function endTurn() {
  if (checkEnd()) return;
  moveZombies();          // вскрытые зомби двигаются после хода игрока
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
function autoResult(zombie, msg, end) {
  spin = { mode: "combat", zombie, rot: 0, target: 0, t: 0, resultIdx: 0,
           spinning: false, done: true, auto: true, combatEnd: end, message: msg };
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
  if (spin.mode === "move") {
    spin = null; phase = "move";
    const p = active();
    reachSet = reachable(p.r, p.c, pendingSteps, otherPlayersBlocked(p.id));
    log = `${active().name}: выбери клетку (до ${pendingSteps} шагов).`;
  } else {
    if (spin.combatEnd) { spin = null; reachSet = null; endTurn(); }
    else { spin = makeSpin("combat", spin.zombie); }
  }
}

function resolveCombat(sym) {
  const p = active(), z = spin.zombie, zd = ZTYPES[z.ztype];
  spin.combatEnd = false;
  if (sym === "skull") {
    if (p.items.includes("poison")) { // яд: укус не отнимает ХП, зомби гибнет
      removeItem(p, "poison"); killFully(z);
      spin.message = `🧪 Яд! ${zd.name} укусил и сам погиб.`; spin.combatEnd = true; return;
    }
    damage(p, 1);
    if (!p.alive) { spin.message = `💀 Череп! ${p.name} погибает.`; spin.combatEnd = true; }
    else spin.message = `💀 Череп! ${zd.name} кусает: −1 ❤. Крути снова.`;
    return;
  }
  if (sym === "run") {
    if (p.prevR != null) { p.r = p.prevR; p.c = p.prevC; p.px = p.c; p.py = p.r; }
    spin.message = `🏃 Побег! ${p.name} отступает. Зомби остаётся.`;
    spin.combatEnd = true; return;
  }
  // firearm / melee
  if (z.ztype === "bear") {
    spin.message = `🐻 Босс-медведя берёт только 🎯 дротик (или 🪢 лассо). Крути снова или беги.`;
    return;
  }
  const need = sym; // 'firearm' | 'melee'
  if (hasKind(p, need)) {
    const w = firstOfKind(p, need);
    removeItem(p, w); // любое оружие одноразовое
    damageZombie(z);
    let msg = `${SECTOR[sym].icon} ${ITEMS[w].name}: ${zd.name} уничтожен! (израсходовано)`;
    if (!z.dead) msg = `💉 ${zd.name} воскресает! Нужен ещё удар. Крути снова.`;
    spin.message = msg;
    spin.combatEnd = z.dead;
  } else {
    // нет нужного оружия — просто промах, ХП НЕ снимается. Крути снова или беги.
    spin.message = `${SECTOR[sym].icon} Промах — нет ${sym === "firearm" ? "огнестрела" : "холодного оружия"}. Крути снова или беги.`;
  }
}

function damageZombie(z) { z.lives -= 1; if (z.lives <= 0) z.dead = true; }
function killFully(z) { z.lives = 0; z.dead = true; }

// спецсредства на выбор игрока в бою
function useSpecial(itemId) {
  if (!spin || spin.mode !== "combat") return;
  const p = active(), z = spin.zombie, zd = ZTYPES[z.ztype];
  if (itemId === "dart") {            // дротик — убивает любого, даже медведя
    removeItem(p, "dart"); killFully(z);
    autoResult(z, `🎯 Дротик: ${zd.name} уничтожен!`, true);
  } else if (itemId === "lasso") {    // лассо — обездвиживает зомби, бой окончен
    removeItem(p, "lasso"); z.immobilized = true;
    if (p.prevR != null) { p.r = p.prevR; p.c = p.prevC; p.px = p.c; p.py = p.r; }
    autoResult(z, `🪢 Лассо! ${zd.name} обездвижен.`, true);
  }
}

// побег из боя без вертушки (отступаем на клетку, откуда пришли)
function fleeCombat() {
  if (!spin || spin.mode !== "combat") return;
  const p = active(), z = spin.zombie;
  if (p.prevR != null) { p.r = p.prevR; p.c = p.prevC; p.px = p.c; p.py = p.r; }
  autoResult(z, `🏃 ${p.name} отступает. Зомби остаётся на месте.`, true);
}

function damage(p, n) {
  p.hp -= n;
  if (p.hp <= 0) { p.hp = 0; p.alive = false; p.path = null; }
}

// ---------- Движение игрока ----------
function tryMoveTo(r, c) {
  if (phase !== "move" || !reachSet) return;
  const p = active();
  if (p.path) return;
  const d = reachSet.get(K(r, c));
  if (d == null || d === 0) return;
  const path = findPath(p.r, p.c, r, c, otherPlayersBlocked(p.id));
  if (!path || path.length - 1 > pendingSteps) return;
  p.path = path; p.step = 0; p.moveT = 0; p.movedThisTurn = true;
  reachSet = null;
}

function useEnergy() {
  const p = active();
  if (phase !== "move" || !reachSet || p.path || !p.items.includes("energy")) return;
  removeItem(p, "energy"); pendingSteps += 1;
  reachSet = reachable(p.r, p.c, pendingSteps, otherPlayersBlocked(p.id));
  log = `⚡ Энергетик: +1 к ходу (до ${pendingSteps}).`;
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
    startCombat(p, card);
    return "combat";
  }
  card.revealed = true;
  pickUp(p, card);
  return "continue";
}

function startCombat(p, z) {
  phase = "combat";
  const zd = ZTYPES[z.ztype];
  log = `Бой: ${p.name} против ${zd.name}!`;
  // авто срабатывает ТОЛЬКО граната (кроме медведя). Катана/двухстволка — обычное оружие по символу.
  if (z.ztype !== "bear" && p.items.includes("grenade")) {
    removeItem(p, "grenade"); killFully(z);
    autoResult(z, `💣 Граната сработала автоматически: ${zd.name} уничтожен!`, true);
    return;
  }
  spin = makeSpin("combat", z);
}

function pickUp(p, card) {
  const id = card.item, def = ITEMS[id];
  if (def.kind === "goal") {
    if (id === "keys") team.keys = true;
    if (id === "gas") team.gas = true;
    card.taken = true; card.takenAt = performance.now(); // мелькнёт 5 сек и исчезнет
    log = `${p.name} нашёл ${def.icon} ${def.name}!`;
    showToast(`Найдено: ${def.icon} ${def.name}!`, "#d8c24a");
    return;
  }
  if (p.items.length >= INV_MAX) {            // мест нет — предмет остаётся на полу (вскрыт)
    card.revealed = true;
    log = `${p.name}: нет места (${INV_MAX}/${INV_MAX})! ${def.icon} ${def.name} на полу.`;
    showToast(`Нет места! ${def.icon} ${def.name} осталось на полу`, "#c0392b");
    return;
  }
  p.items.push(id);
  card.taken = true; card.takenAt = performance.now();
  log = `${p.name} подобрал ${def.icon} ${def.name}.`;
  showToast(`Подобрано: ${def.icon} ${def.name}`, "#3fb98a");
}

function arrive(p) {
  p.path = null;
  if (grid[p.r][p.c] === "F") {
    if (team.keys && team.gas) { p.escaped = true; checkEnd(); return; }
    else { log = "Нужны 🔑 ключи и ⛽ канистра, чтобы уехать!"; }
  }
  endTurn();
}

// ---------- Ход зомби (двигаются только вскрытые) ----------
function moveZombies() {
  const base = STEPS[WHEEL[(Math.random() * WHEEL.length) | 0]]; // общий бросок шагов
  for (const z of cards) {
    if (z.kind !== "zombie" || z.dead || !z.revealed || z.immobilized) continue;
    let steps = base + (ZTYPES[z.ztype].moveMod || 0);
    if (steps < 1) steps = 1;
    const tgt = nearestPlayer(z);
    if (!tgt) continue;
    const path = findPath(z.r, z.c, tgt.r, tgt.c);
    if (!path || path.length < 2) {
      bite(tgt, z); continue; // уже рядом/на цели
    }
    let idx = Math.min(steps, path.length - 1);
    const dest = path[idx];
    const onP = players.find(pp => pp.alive && !pp.escaped && pp.r === dest[0] && pp.c === dest[1]);
    if (onP) { idx = Math.max(0, idx - 1); z.r = path[idx][0]; z.c = path[idx][1]; bite(onP, z); }
    else { z.r = dest[0]; z.c = dest[1]; }
  }
}
function nearestPlayer(z) {
  let best = null, bd = Infinity;
  for (const p of players) {
    if (!p.alive || p.escaped) continue;
    const d = Math.abs(p.r - z.r) + Math.abs(p.c - z.c);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function bite(p, z) {
  if (!p || !p.alive) return;
  const zd = ZTYPES[z.ztype];
  if (p.items.includes("poison")) { // яд: укус смертелен для зомби
    removeItem(p, "poison"); killFully(z);
    log = `🧪 ${zd.name} укусил ${p.name}, но напоролся на яд и погиб.`;
  } else {
    damage(p, 1);
    log = `🩸 ${zd.name} кусает ${p.name}: −1 ❤.`;
  }
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
  // подобранные карты убираются с поля через 5 сек
  if (cards.some(c => c.taken && now - c.takenAt > FLASH_MS))
    cards = cards.filter(c => !(c.taken && now - c.takenAt > FLASH_MS));
  const p = active();
  if (state === "PLAY" && p && p.path) {
    p.moveT += dt * 6;
    if (p.moveT >= 1) {
      p.moveT = 0; p.step++;
      if (p.step >= p.path.length) { arrive(p); }
      else {
        const cellRC = p.path[p.step];
        onEnterCell(p, cellRC[0], cellRC[1]);
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
  if (phase === "move" && reachSet) { drawReach(); drawMoveControls(); }
  if (spin) drawSpinner();
  if (showInv) drawInventory();
  drawToast();
  if (state === "WIN") drawEnd("ПОБЕДА!", "Выжившие уехали на машине 🚗💨", "#3fb98a");
  if (state === "LOSE") drawEnd("ПОРАЖЕНИЕ", "Все герои пали 🧟", "#c0392b");
}
function drawToast() {
  if (!toast) return;
  const left = toast.until - performance.now();
  if (left <= 0) { toast = null; return; }
  ctx.globalAlpha = Math.min(1, left / 400);
  ctx.font = "bold 16px sans-serif";
  const tw = ctx.measureText(toast.msg).width, w = tw + 40, h = 42, x = (canvas.width - w) / 2, y = 60;
  ctx.fillStyle = "rgba(10,16,22,.93)"; roundRect(x, y, w, h, 10); ctx.fill();
  ctx.strokeStyle = toast.color; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(toast.msg, canvas.width / 2, y + h / 2);
  ctx.globalAlpha = 1;
}

function drawBoard() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = grid[r][c], x = ox + c * cell, y = oy + r * cell;
    let col = "#2f6b3a";
    if (t === ".") col = "#caa56a"; else if (t === "#") col = "#5a4634";
    else if (t === "D") col = "#9c7b3e"; else if (t === "S") col = "#d8c24a";
    else if (t === "F") col = "#e8eef2"; else if (t === "B") col = "#6e4a22";
    ctx.fillStyle = col; ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = "rgba(0,0,0,.12)"; ctx.strokeRect(x + .5, y + .5, cell - 1, cell - 1);
    if (t === "S" || t === "F") {
      ctx.font = `${cell * .6}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🚗", x + cell / 2, y + cell / 2);
    } else if (t === "B") {
      ctx.font = `${cell * .55}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🪵", x + cell / 2, y + cell / 2);
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
function drawMoveControls() {
  const p = active();
  if (p.path) return;
  if (p.items.includes("energy"))
    addButton(8, canvas.height - 70, 120, 28, "⚡ +1 ход", useEnergy, "#caa520");
  if (p.items.includes("boards") && adjacentDoorCell(p))
    addButton(134, canvas.height - 70, 134, 28, "🪵 Заколотить", useBoards, "#8a6a3a");
}
function drawCards() {
  for (const z of cards) {
    if (z.kind === "zombie" && z.dead) continue;
    const x = ox + z.c * cell, y = oy + z.r * cell;
    if (!z.revealed) {
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
      if (z.immobilized) { ctx.font = `${cell*.4}px serif`; ctx.fillText("🪢", x + cell*.78, y + cell*.78); }
    } else { // вскрытый предмет: лежит на полу или мелькает 5 сек после подбора
      const def = ITEMS[z.item];
      if (z.taken) ctx.globalAlpha = Math.max(.15, 1 - (performance.now() - z.takenAt) / FLASH_MS);
      ctx.fillStyle = "#243524"; roundRect(x + cell*.1, y + cell*.1, cell*.8, cell*.8, 4); ctx.fill();
      ctx.strokeStyle = "#6a8a4a"; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = `${cell*.5}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(def.icon, x + cell/2, y + cell/2);
      ctx.globalAlpha = 1;
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
  const w = Math.min(270, canvas.width * .5), h = 100, x = 8, y = 8;
  ctx.fillStyle = "rgba(10,16,22,.85)"; roundRect(x, y, w, h, 8); ctx.fill();
  ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(x+26, y+28, 18, 0, Math.PI*2); ctx.fillStyle = p.color; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "bold 18px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(p.name[0], x+26, y+28);
  ctx.fillStyle = "#e8eef2"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "left"; ctx.fillText(p.name, x+52, y+20);
  // сердца: только красные по числу ХП (исчезают при уроне, появляются при лечении)
  ctx.font = "bold 17px sans-serif"; ctx.fillStyle = "#e8455a";
  let hs = ""; for (let i = 0; i < p.hp; i++) hs += "♥ ";
  ctx.fillText(hs.trim() || "—", x+52, y+40);
  ctx.fillStyle = "#e8eef2"; ctx.font = "17px serif"; ctx.textAlign = "left";
  ctx.fillText(p.items.map(it => ITEMS[it].icon).join(" ") || "—", x+12, y+66);
  ctx.font = "12px sans-serif"; ctx.fillStyle = "#9fb0bd"; ctx.textAlign = "right";
  ctx.fillText(`🎒 ${p.items.length}/${INV_MAX}`, x+w-10, y+66);
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
  addButton(canvas.width - 96, 8, 88, 26, "Инвентарь", () => { showInv = !showInv; }, "#3d5566");
}

function drawInventory() {
  const p = active(); overlay();
  const w = 340, h = 320, x = (canvas.width-w)/2, y = (canvas.height-h)/2;
  ctx.fillStyle = "#1b2630"; roundRect(x,y,w,h,10); ctx.fill();
  ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#e8eef2"; ctx.textAlign = "center"; ctx.font = "bold 18px sans-serif";
  ctx.fillText("Инвентарь — " + p.name, x+w/2, y+28);
  ctx.font = "14px sans-serif"; ctx.textAlign = "left";
  let yy = y+58;
  if (!p.items.length) ctx.fillText("(пусто)", x+24, yy);
  const inCombat = spin && spin.mode === "combat" && !spin.done && !spin.auto;
  const inMove = phase === "move" && reachSet && !p.path;
  p.items.forEach(it => {
    const d = ITEMS[it];
    ctx.fillStyle = "#e8eef2"; ctx.fillText(`${d.icon}  ${d.name}`, x+24, yy);
    let label = null, act = null;
    if (d.kind === "heal" && p.hp < p.maxHp) { label = "Лечить"; act = () => { p.hp = Math.min(p.maxHp, p.hp+1); removeItem(p, it); }; }
    else if (it === "energy" && inMove)   { label = "+1 ход";     act = () => { useEnergy(); showInv = false; }; }
    else if (it === "lasso" && inCombat)  { label = "Накинуть";   act = () => { useSpecial("lasso"); showInv = false; }; }
    else if (it === "dart"  && inCombat)  { label = "Метнуть";    act = () => { useSpecial("dart");  showInv = false; }; }
    else if (it === "boards" && adjacentDoorCell(p)) { label = "Заколотить"; act = () => { useBoards(); showInv = false; }; }
    if (label) addButton(x+w-100, yy-15, 84, 22, label, act, "#3fb98a");
    yy += 28;
  });
  addButton(x+w/2-50, y+h-42, 100, 30, "Закрыть", () => { showInv = false; });
}

function drawSpinner() {
  overlay();
  const cx = canvas.width/2, cy = canvas.height/2 - 6, R = Math.min(canvas.width, canvas.height)*.27;
  // заголовок
  ctx.fillStyle = "#e8eef2"; ctx.font = "bold 17px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const title = spin.mode === "move" ? `${active().name}: бросок на движение`
    : `Бой: ${active().name} ⚔ ${ZTYPES[spin.zombie.ztype].emoji} ${ZTYPES[spin.zombie.ztype].name}`;
  ctx.fillText(title, cx, cy - R - 40);

  if (spin.auto) { // авто-исход без колеса (аура/граната/дротик/лассо)
    ctx.fillStyle = "#1b2630"; roundRect(cx-210, cy-30, 420, 64, 8); ctx.fill();
    ctx.strokeStyle = "#5a6b78"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#e8eef2"; ctx.font = "15px sans-serif"; wrapText(spin.message, cx, cy, 400, 18);
    addButton(cx-60, cy+50, 120, 32, "Продолжить", afterSpin, "#3fb98a");
    return;
  }

  for (let i = 0; i < WHEEL.length; i++) {
    const a0 = i*SEG + spin.rot;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a0+SEG); ctx.closePath();
    ctx.fillStyle = SECTOR[WHEEL[i]].color; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 2; ctx.stroke();
    const am = a0 + SEG/2;
    ctx.save(); ctx.translate(cx + Math.cos(am)*R*.62, cy + Math.sin(am)*R*.62);
    ctx.font = `${R*.16}px serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(SECTOR[WHEEL[i]].icon, 0, -R*.06);
    ctx.font = `bold ${R*.12}px sans-serif`; ctx.fillStyle = "#fff";
    ctx.fillText(spin.mode === "move" ? STEPS[WHEEL[i]] : SECTOR[WHEEL[i]].label, 0, R*.12); ctx.restore();
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
  // спецсредства + побег на выбор в бою
  if (spin.mode === "combat" && !spin.spinning && !spin.done) {
    const p = active();
    const opts = [];
    for (const sp of ["dart","lasso"]) if (p.items.includes(sp)) opts.push(["item", sp]);
    opts.push(["flee", null]);
    let bw = 140, gap = 10, bx = cx - (opts.length * bw + (opts.length-1) * gap) / 2;
    for (const [t, sp] of opts) {
      if (t === "item") addButton(bx, cy + R + 6, bw, 28, `${ITEMS[sp].icon} ${ITEMS[sp].name}`, () => useSpecial(sp), "#8a5a2a");
      else addButton(bx, cy + R + 6, bw, 28, "🏃 Сбежать", fleeCombat, "#3a6b78");
      bx += bw + gap;
    }
  }
  // результат броска
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
  ctx.fillText("ЗОМБИ В ДОМЕ", canvas.width/2, canvas.height/2 - 120);
  ctx.fillStyle = "#e8eef2"; ctx.font = "bold 26px sans-serif";
  ctx.fillText("Заражение", canvas.width/2, canvas.height/2 - 84);
  ctx.fillStyle = "#9fb0bd"; ctx.font = "16px sans-serif";
  ctx.fillText("Сколько игроков?", canvas.width/2, canvas.height/2 - 30);
  const bw = 64, gap = 14, total = bw*4 + gap*3, startX = canvas.width/2 - total/2;
  for (let n = 1; n <= 4; n++) {
    addButton(startX + (n-1)*(bw+gap), canvas.height/2, bw, 56, String(n), () => newGame(n), "#3fb98a");
  }
  ctx.fillStyle = "#7f8f9b"; ctx.font = "13px sans-serif";
  ctx.fillText("Найди 🔑 ключи и ⛽ канистру — и уезжай на машине!", canvas.width/2, canvas.height/2 + 92);
}
function drawEnd(title, sub, color) {
  overlay(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = color; ctx.font = "bold 44px sans-serif"; ctx.fillText(title, canvas.width/2, canvas.height/2 - 50);
  ctx.fillStyle = "#e8eef2"; ctx.font = "18px sans-serif"; ctx.fillText(sub, canvas.width/2, canvas.height/2 - 6);
  addButton(canvas.width/2-90, canvas.height/2+30, 180, 44, "В меню", () => { state = "MENU"; }, "#3fb98a");
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
