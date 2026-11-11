// Lava VS Stair — 시작점. 시뮬레이션(sim) ↔ 화면(view) ↔ UI ↔ 소리 ↔ 저장을 잇는다.
import { CFG } from './config.js';
import { Sim } from './sim.js';
import { botLoadout, climbAI } from './ai.js';
import { RP, toWorld } from './course.js';
import { View } from './view/view.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Sfx } from './audio.js';
import { loadSave, persist, loadoutOf } from './save.js';
import { Online } from './online.js';

const canvas = document.getElementById('game');
const save = loadSave();
const view = new View(canvas);
const sfx = new Sfx(save.settings);
const STEP = 1 / CFG.simHz;
const coarse = matchMedia('(pointer: coarse)').matches;

let sim = null, me = null;
let mode = 'title';          // 'title'(배경 시연) | 'match'
let paused = false, earned = 0, bestNew = null, acc = 0, last = performance.now();
let attractT = 0, slow = 0, wasWaiting = false, speed = 1;   // speed: 검증 도구가 경기를 빨리 돌릴 때만 바꾼다

const applyQuality = () => view.setQuality(save.settings.quality === 'auto' ? (coarse ? 'low' : 'high') : save.settings.quality);
applyQuality();

const ui = new UI(document.getElementById('ui'), save, {
  click: () => sfx.play('click'),
  play: () => startSolo(),
  online: () => ui.openOnline(roomParam),
  isOnline: () => online.active,
  joinRoom: async (name) => {
    save.name = name.slice(0, 10); persist(save);
    try {
      await online.join(roomParam || randomCode(), save.name || '손님', loadoutOf(save));
      roomParam = online.net.room;
      history.replaceState(null, '', '?room=' + roomParam);
      ui.openLobby(lobbyView());
    } catch (e) { ui.openOnline(roomParam, e.message); }
  },
  leaveRoom: () => leaveRoom(),
  fill: (v) => online.setFill(v),
  startOnline: () => online.start(),
  pause: () => openPause(),
  resume: () => ui.closePanel(),
  restart: () => startSolo(),
  again: () => (online.active ? ui.openLobby(lobbyView()) : startSolo()),
  quit: () => (online.active ? leaveRoom() : startAttract()),
  ready: () => (online.inMatch ? online.ready() : sim.skipWait()),
  volume: (v) => { save.settings.volume = v; sfx.apply(); persist(save); },
  mute: () => { save.settings.muted = !save.settings.muted; sfx.apply(); persist(save); },
  quality: (q) => { save.settings.quality = q; applyQuality(); persist(save); },
  canShop: () => mode === 'title' || sim.phase !== 'leg',
  thumb: (id, lv) => view.gunThumb(id, lv),
  // 모달이 열려 있는 동안 솔로 경기는 멈춘다(상점에서 시간에 쫓기지 않게)
  panel: (name, open) => {
    if (!open && name === 'shop' && ui.lobbyBack) { ui.lobbyBack = false; if (online.active) return ui.openLobby(lobbyView()); }
    if (mode !== 'match' || name === 'results' || name === 'lobby') return;
    if (!online.active) paused = open;                 // 온라인 경기는 멈추지 않는다
    if (!open && name === 'shop' && sim.phase === 'results' && ui.resultsInfo) ui.showResults(ui.resultsInfo);
  },
  shopChanged: (act, id) => {
    persist(save);
    sfx.play(act === 'up' ? 'upgrade' : act === 'deny' ? 'deny' : act);
    // 차례가 진행 중이면 sim이 현재 능력치를 그대로 두고 다음 차례부터 적용한다
    if (mode === 'match') sim.setLoadout(me.id, save.equipped, save.levels[save.equipped]);
    online.setLoadout(loadoutOf(save));
  },
});
const input = new Input(canvas, document.querySelector('.touch'));
input.onAny = () => { sfx.unlock(); sfx.loop('lava_loop', 0.16); sfx.loop('music', 0.22); };
input.onKey = (code) => {
  if (code === 'Escape' || code === 'KeyP') {
    if (ui.panel) { if (ui.panel.name !== 'results') ui.closePanel(); }
    else if (mode === 'match') openPause();
  }
  if (code === 'Enter' && mode === 'title' && !ui.panel) startSolo();
  if (code === 'KeyM') { save.settings.muted = !save.settings.muted; sfx.apply(); persist(save); ui.syncSound(); }
};
document.addEventListener('pointerdown', () => input.onAny(), { once: true });
addEventListener('resize', () => view.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'match' && !ui.panel && sim.phase !== 'results') openPause(); });

// ── 온라인 ──
let roomParam = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || null;
const randomCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[(Math.random() * 32) | 0]).join('');
const online = new Online({
  lobby: () => { if (ui.panel?.name === 'lobby') ui.openLobby(lobbyView()); },
  start: (players, opts) => { beginMatch(players, opts); return sim; },
  closed: (msg) => { startAttract(); ui.say(`<small>${msg}</small>`, '', 2500); },
  note: (html) => ui.note(html),
});
function lobbyView() {
  return { room: online.net.room, link: online.link, isHost: online.isHost, fill: online.fill, canStart: online.canStart(),
    players: online.roster().map((p) => ({ ...p, me: p.id === online.id, host: p.id === online.net.hostId })) };
}
function leaveRoom() {
  online.leave(); roomParam = null;
  history.replaceState(null, '', location.pathname);
  startAttract();
}

function openPause() { if (mode === 'match' && sim.phase !== 'results') ui.openPause(); }

const shuffled = (xs) => xs.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);

function startAttract() {
  const names = shuffled(CFG.botNames);
  sim = new Sim([0, 1, 2, 3].map(i => ({ id: 'b' + i, name: names[i], team: i % 2, kind: 'bot', loadout: botLoadout(3, i >> 1) })), { aiLevel: 3 });
  sim.phaseT = 1.2;
  me = null; mode = 'title'; paused = false; attractT = 0;
  view.attach(sim); ui.showTitle();
  document.body.classList.remove('aiming');
}

function startSolo() {
  const lv = save.aiLevel, names = shuffled(CFG.botNames);
  beginMatch([
    { id: 'me', name: save.name || '나', team: 0, kind: 'human', local: true, loadout: loadoutOf(save) },
    { id: 'b1', name: names[0], team: 0, kind: 'bot', loadout: botLoadout(lv, 1) },
    { id: 'b2', name: names[1], team: 1, kind: 'bot', loadout: botLoadout(lv, 0) },
    { id: 'b3', name: names[2], team: 1, kind: 'bot', loadout: botLoadout(lv, 1) },
  ], { aiLevel: lv, firstClimb: save.stats.matches % 2 });   // 첫 경기는 내가 먼저 등반
}

function beginMatch(players, opts) {
  sim = new Sim(players, opts);
  me = sim.actors.find((a) => a.p.local); mode = 'match'; paused = false; earned = 0; bestNew = null; acc = 0;
  view.attach(sim);
  ui.startMatch(sim, me, input.isTouch || coarse);
  ui.fade();
}

function tip(key, html, ms = 7000) {
  if (save.tips[key]) return;
  save.tips[key] = true; persist(save);
  ui.hint(html, ms);
}

function finishMatch(result) {
  const won = result.winner === me.p.team, draw = result.winner < 0;
  save.stats.matches++;
  const name = (lv) => `${CFG.ai.levels[lv - 1].name} ${'★'.repeat(lv)}`;
  let levelMsg;
  if (online.active) { if (won) save.stats.wins++; levelMsg = '온라인 대전 · 대기실에서 방장이 다음 경기를 시작해요'; }
  else if (won) {
    save.stats.wins++;
    if (save.aiLevel < 5) { save.aiLevel++; levelMsg = `이겼으니 다음 AI는 더 매워져요 → ${name(save.aiLevel)}`; }
    else levelMsg = '최고 난이도 불지옥맛을 꺾었어요!';
  } else if (!draw && save.aiLevel > 1) { save.aiLevel--; levelMsg = `다음 AI는 한 단계 순해져요 → ${name(save.aiLevel)}`; }
  else levelMsg = `다음 AI: ${name(save.aiLevel)}`;
  persist(save);
  ui.hideHint(); ui.hideInter();
  ui.showResults({ result, earned, best: bestNew, levelMsg, online: online.active });
  sfx.play(won ? 'win' : draw ? 'stage' : 'lose');
}

function sound(e) {
  const mine = e.a === me, v = e.a && view.views.get(e.a.id), pos = v ? v.pos : undefined;
  switch (e.type) {
    case 'jump': sfx.play('jump', { pos, vol: mine ? 0.55 : 0.3 }); break;
    case 'land': sfx.play('land', { pos, vol: Math.min(1, 0.25 + e.v / 120) * (mine ? 1 : 0.6) }); break;
    case 'ledge': sfx.play('land', { pos, vol: 0.5, rate: 1.3 }); break;
    case 'stair': {
      const p = toWorld(e.p.thc, RP, e.p.top);
      if (e.state === 'warn') sfx.play('warn', { pos: p, vol: 0.8 });
      else if (e.state === 'in') sfx.play('retract', { pos: p, vol: 0.9 });
      else if (e.state === 'ext') sfx.play('extend', { pos: p, vol: 0.7 });
      break;
    }
    case 'shot': sfx.play('shot_' + e.s.gun.id, mine ? { vol: 0.7 } : { pos, vol: 0.9 }); break;
    case 'splash':
      if (e.kind === 'hit') sfx.play('hit', { pos: e, vol: 1 });
      else if (e.kind === 'shield') sfx.play('shield', { pos: e, vol: 0.8 });
      else if (e.kind !== 'mist') sfx.play('splash', { pos: e, vol: 0.6, gap: 0.04 });
      break;
    case 'fall': sfx.play('fall', { pos: e, vol: mine ? 1 : 0.7 }); break;
    case 'respawn': if (mine) sfx.play('respawn'); break;
    case 'stage': if (mine) { sfx.play(e.stage === 3 ? 'finish' : 'stage'); sfx.play('coin', { vol: 0.8 }); } else sfx.play('stage', { pos, vol: 0.5 }); break;
    case 'count': sfx.play('count'); break;
    case 'hurry': sfx.play('count', { rate: 1.3, vol: 0.7 }); break;
    case 'nearMiss': if (mine) sfx.play('nearmiss'); break;
  }
}

function handle(e) {
  view.onEvent(e);
  if (mode !== 'match') return;
  ui.onEvent(e, view);
  sound(e);
  online.onLocalEvent(e);
  switch (e.type) {
    case 'phase':
      if (e.phase === 'countdown') ui.showInter(true);
      else if (e.phase === 'switch') { ui.fade(); ui.showInter(false); sfx.play('equip'); }
      else if (e.phase === 'leg') {
        ui.hideInter(); ui.say('<b>GO!</b>', 'go', 900); sfx.play('go');
        if (ui.panel?.name === 'shop' || ui.panel?.name === 'options') ui.closePanel();
        if (me.role === 'shoot') tip('lead', '상대가 <b>점프하는 순간</b>을 노리세요 — 공중에서 맞으면 크게 날아가요! 움직이는 상대는 <b>조금 앞</b>을 겨냥 💦', 9000);
      } else if (e.phase === 'results') finishMatch(e.result);
      break;
    case 'stage':
      if (e.a === me) {                               // 이 차례에 그 단계를 처음 끝냈을 때만 발생하는 이벤트
        save.coins += e.reward; earned += e.reward; persist(save);
        ui.coinFly(e.reward);
      }
      break;
    case 'finish':
      if (e.a === me && (!save.stats.best || e.time < save.stats.best)) { save.stats.best = +e.time.toFixed(2); bestNew = save.stats.best; persist(save); }
      break;
    case 'fall': if (e.a === me && sim.phase === 'leg') tip('fall', '괜찮아요! <b>2초 뒤</b> 이 단계 시작점에서 다시 도전해요. 얻은 Coins는 그대로!'); break;
    case 'hit': if (e.a === me) tip('hit', '땅에 붙어 있으면 조금만 밀리지만 <b>점프 중에 맞으면 크게 날아가요!</b> 조준선이 보이면 점프를 참으세요. <b>연두색 발판</b>은 안전 지대', 9000); break;
  }
}

function tick() {
  if (me && me.p.kind === 'human') {
    input.apply(me.inp, me.role);
    if (me.role === 'shoot') { const m = input.aimNdc(); me.inp.aim = view.aimPoint(m.x, m.y, me); }
  }
  sim.step(STEP);
  if (mode === 'match') online.afterStep(STEP);
  if (sim.events.length) { const evs = sim.events; sim.events = []; for (const e of evs) handle(e); }
  // 첫 등반 때 한 번: 움직이는 계단 설명
  if (me && me.role === 'climb' && sim.phase === 'leg' && !save.tips.stairs && me.body.ground?.kind === 'step') {
    tip('stairs', '<b>주황 화살표 계단</b>은 벽 속으로 들어가요. <b>빨갛게 깜빡이면</b> 곧 접힘! 흰 계단은 고정이에요', 9000);
  }
}

const arrowItems = [];
function updateArrows() {
  arrowItems.length = 0;
  if (mode === 'match' && sim.phase === 'leg') {
    for (const a of sim.actors) {
      const v = view.views.get(a.id);
      if (me.role === 'shoot' && a.role === 'climb' && a.alive && !a.finished) arrowItems.push({ pos: v.head, color: CFG.teams[a.p.team].css, label: a.p.name });
      // 등반 중: 나를 겨누는 조준이 화면 밖에서 시작되면 방향을 알려 준다
      if (me.role === 'climb' && a.role === 'shoot' && a.windup > 0 && a.aim) {
        const m = view.views.get(me.id).pos;
        if (Math.hypot(a.aim.x - m.x, a.aim.z - m.z) < 14) arrowItems.push({ pos: v.head, color: '#' + CFG.guns[a.gun.id].color.toString(16).padStart(6, '0'), label: '조준!' });
      }
    }
  }
  ui.setArrows(view, arrowItems);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  // 내가 먼저 완주했으면 아직 오르는 동료를 비춘다. 솔로에서는 남은 시간을 빨리 감는다.
  const waiting = mode === 'match' && sim.phase === 'leg' && me.role === 'climb' && me.finished;
  const watch = waiting ? sim.climbers().find((a) => !a.finished && a.alive) || me : me;
  const ff = waiting && !online.active ? 4 : 1;
  if (waiting !== wasWaiting) { wasWaiting = waiting; ui.setWaiting(waiting, ff > 1); }
  if (!paused) {
    acc += dt * speed * ff;
    let n = 0;
    while (acc >= STEP && n++ < 24) { tick(); acc -= STEP; }
    if (acc > STEP) acc = 0;
  }
  if (mode === 'title' && sim.phase === 'results' && (attractT += dt) > 4) startAttract();
  const orbit = mode === 'title' || sim.phase === 'results';
  view.render(paused ? 0 : dt, paused ? 1 : acc / STEP, orbit ? me : watch, orbit ? 'orbit' : 'play');
  if (mode === 'match') { ui.frame(view, input); updateArrows(); }
  const cam = view.camera;
  sfx.setListener(cam.position, { x: cam.matrixWorld.elements[0], z: cam.matrixWorld.elements[2] });
  // 자동 화질: 느리면 한 번 낮춘다
  if (save.settings.quality === 'auto' && view.quality === 'high') {
    slow = dt > 1 / 34 ? slow + dt : Math.max(0, slow - dt * 0.5);
    if (slow > 3) view.setQuality('low');
  }
}

// ── 검증용 훅: tools/의 플레이 테스트가 "지금 어떤 키를 눌러야 하는지" 묻는다. 실제 조작은 진짜 키보드·마우스 이벤트로 한다. ──
const pilot = { ai: {}, inp: {}, t: 0, key: '' };
function advise(level = 5) {
  if (!me || mode !== 'match' || paused) return null;
  const dt = Math.max(0, sim.time - pilot.t); pilot.t = sim.time;
  const key = me.role + sim.leg + me.falls + sim.phase;
  if (key !== pilot.key) { pilot.key = key; pilot.ai = {}; }
  if (me.role === 'climb') {
    const proxy = Object.create(me); proxy.ai = pilot.ai; proxy.inp = pilot.inp;
    const lv = sim.lv; sim.lv = { ...CFG.ai.levels[level - 1], slip: 0 };
    const i = climbAI(proxy, sim, dt);
    sim.lv = lv;
    return { role: 'climb', fwd: i.fwd, out: i.out, jump: i.jump, hold: i.hold };
  }
  let best = null, bd = 1e9;
  for (const c of sim.climbers()) {
    if (!c.alive || c.finished) continue;
    const d = Math.abs(c.body.th - me.body.th);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return { role: 'shoot', fwd: 0, out: 0, fire: false };
  const tb = best.body, from = toWorld(me.body.th, me.body.r, me.body.y + 3), now = toWorld(tb.th, tb.r, tb.y + 2.4);
  const dist = Math.hypot(now.x - from.x, now.y - from.y, now.z - from.z), tHit = dist / me.gun.speed;
  const p = toWorld(tb.th + (tb.vt * tHit) / tb.r, tb.r, tb.y + 2.4);
  const s = view.project(view.v.set(p.x, p.y, p.z), {});
  const want = tb.th + 0.2 - me.body.th;
  return { role: 'shoot', fwd: Math.abs(want) * me.body.r > 3 ? Math.sign(want) : 0, out: 0, x: s.x, y: s.y, fire: sim.phase === 'leg' && s.visible && !best.safe && best.protectT <= 0 && dist < me.gun.range * 0.95 };
}
window.__lvs = { get sim() { return sim; }, get me() { return me; }, get paused() { return paused; }, online, set speed(v) { speed = v; }, view, ui, input, save, sfx, CFG, startSolo, startAttract, advise, persist: () => persist(save) };
startAttract();
if (roomParam) ui.openOnline(roomParam);        // 초대 링크로 들어온 경우
requestAnimationFrame(frame);
