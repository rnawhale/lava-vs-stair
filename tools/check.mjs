// 규칙 자체 점검(브라우저 없이): 물총 수치·강화, 거래 중복 방지, 저장 복구, 계단 기회, 점수·보상 규칙, 3대3 자리·팀 고르기.
//   node tools/check.mjs
import assert from 'node:assert/strict';
import { CFG, gunStats } from '../public/src/config.js';
import { buildCourse, stepPhase, nextRetractAt, angleOf, toWorld, RP } from '../public/src/course.js';
import { defaultSave, sanitize, buy, upgrade, equip, loadSave, persist, loadoutOf } from '../public/src/save.js';
import { Sim } from '../public/src/sim.js';
import { Online } from '../public/src/online.js';
import { botLoadout } from '../public/src/ai.js';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++; };

// ── 물총 기준값과 강화(기본 간격의 95%/90%, 누적 곱 아님) ──
eq([gunStats('basic', 0).interval, gunStats('basic', 1).interval, gunStats('basic', 2).interval], [0.9, 0.855, 0.81]);
eq([gunStats('rapid', 0).interval, gunStats('rapid', 1).interval, gunStats('rapid', 2).interval], [0.45, 0.4275, 0.405]);
eq([gunStats('heavy', 0).interval, gunStats('heavy', 1).interval, gunStats('heavy', 2).interval], [1.6, 1.52, 1.44]);
for (const id of CFG.gunOrder) for (const lv of [1, 2]) { eq(gunStats(id, lv).range, CFG.guns[id].range, '사거리는 강화로 안 바뀜'); eq(gunStats(id, lv).knock, CFG.guns[id].knock, '밀치기는 강화로 안 바뀜'); }
eq([CFG.guns.basic.price, CFG.guns.rapid.price, CFG.guns.heavy.price], [0, 60, 120]);
eq([CFG.guns.basic.range, CFG.guns.rapid.range, CFG.guns.heavy.range], [60, 45, 60]);
eq([CFG.guns.basic.knock, CFG.guns.rapid.knock, CFG.guns.heavy.knock], [15, 8, 24]);
eq([CFG.upgrades[1].cost, CFG.upgrades[2].cost], [30, 60]);
eq(gunStats('basic', 3), null); eq(gunStats('nope', 0), null);

// ── 거래: 연타·잔액 부족·미보유 ──
{
  const s = defaultSave();
  eq(buy(s, 'rapid').ok, false, '잔액 부족');
  s.coins = 100;
  eq(buy(s, 'rapid').ok, true); eq(s.coins, 40);
  eq(buy(s, 'rapid').ok, false, '이미 보유 → 두 번 결제되지 않음'); eq(s.coins, 40);
  eq(upgrade(s, 'heavy', 0).ok, false, '미보유 강화 불가');
  eq(upgrade(s, 'rapid', 0).ok, true); eq([s.coins, s.levels.rapid], [10, 1]);
  eq(upgrade(s, 'rapid', 0).ok, false, '같은 요청 재전송(연타)은 거부'); eq([s.coins, s.levels.rapid], [10, 1]);
  eq(upgrade(s, 'rapid', 1).ok, false, 'Lv.2는 60 필요');
  s.coins = 60;
  eq(upgrade(s, 'rapid', 1).ok, true); eq([s.coins, s.levels.rapid], [0, 2]);
  eq(upgrade(s, 'rapid', 2).ok, false, '최대 레벨');
  eq(equip(s, 'heavy').ok, false); eq(equip(s, 'rapid').ok, true); eq(loadoutOf(s), { id: 'rapid', level: 2 });
}
// ── 저장: 복구와 조작된 값 바로잡기 ──
{
  const mem = { v: null, getItem() { return this.v; }, setItem(k, v) { this.v = v; } };
  const s = defaultSave(); s.coins = 77; s.owned.rapid = true; s.levels.rapid = 1; s.equipped = 'rapid';
  persist(s, mem);
  eq(loadSave(mem), s, '저장 → 불러오기 동일');
  const bad = sanitize({ coins: -5, owned: { heavy: 1 }, levels: { heavy: 9, rapid: 2 }, equipped: 'rapid', aiLevel: 99 });
  eq([bad.coins, bad.levels.heavy, bad.levels.rapid, bad.equipped, bad.aiLevel, bad.owned.basic], [0, 2, 0, 'basic', 5, true]);
  mem.v = '{깨진';
  eq(loadSave(mem), defaultSave(), '깨진 저장 → 기본값');
  eq(sanitize({ stats: { best: 55.5 } }).stats.best, null, '단계 수가 다른(세 단계 시절) 완주 기록은 지움');
  eq(sanitize({ stats: { best: 99.5, stages: CFG.stages.length } }).stats.best, 99.5, '현재 코스의 완주 기록은 유지');
}
// ── 코스: 6/8/10/12/14 계단, 고정 발판, 예고 0.5초, 8초 안에 반드시 오는 착지 기회 ──
{
  const c = buildCourse();
  eq(c.stages.map((s) => s.steps.length), [6, 8, 10, 12, 14]);
  eq([CFG.stages.map((s) => s.reward), CFG.stages.map((s) => s.points)], [[10, 20, 30, 40, 50], [1, 2, 3, 4, 5]]);
  eq(c.pads.length, 6);
  ok(c.pads.every((p) => p.safe) && c.platforms.filter((p) => p.kind === 'step').every((p) => !p.safe), '물총 안전 지대는 출발·체크포인트·완주 발판');
  // 나선: 탑을 한 바퀴 넘게 감는다. 위아래 바퀴가 충분히 떨어져 있어야 높이만으로 어느 바퀴인지 가릴 수 있다
  ok(c.thEnd > Math.PI * 2 && c.thEnd < Math.PI * 4 - 0.2, '코스는 한 바퀴를 넘고 두 바퀴를 넘지 않음');
  for (let th = c.lane.th0; th + Math.PI * 2 <= c.lane.th1; th += 0.05) ok(c.lane.yAt(th + Math.PI * 2) - c.lane.yAt(th) > 45, '위아래 바퀴 간격 45 stud 이상');
  for (const p of c.platforms) {
    const w = toWorld(p.thc, RP, p.top);
    ok(Math.abs(c.unwrap(angleOf(w.x, w.z), p.top - 0.5) - p.thc) < 1e-6, '월드 좌표 → 그 발판이 있는 바퀴의 코스 각도');
  }
  for (const st of c.stages) ok(st.steps.some((p) => !p.moving) , '단계마다 고정 발판');
  for (const p of c.platforms.filter((q) => q.moving)) {
    const m = p.moving, period = m.ext + m.trav * 2 + m.hid;
    let warn = 0, longestGap = 0, gap = 0;
    for (let t = m.phase; t < m.phase + period * 3; t += 0.01) {
      const ph = stepPhase(m, t);
      if (ph.state === 'warn') warn += 0.01;
      if (ph.state === 'out' || ph.state === 'warn') gap = 0; else { gap += 0.01; longestGap = Math.max(longestGap, gap); }
    }
    ok(Math.abs(warn / 3 - CFG.warnSeconds) < 0.03, `접히기 전 예고 ${CFG.warnSeconds}초`);
    ok(longestGap < 8 && m.ext - CFG.warnSeconds >= 1, '8초 안에 다시 1초 이상 펼쳐짐');
    ok(nextRetractAt(m, m.phase + 0.1) === m.phase + m.ext, '접힘 시각 계산');
  }
}
// ── 경기: 보상 중복 없음, 평균 점수, 차례 장비 고정 ──
{
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, team: i < 2 ? 0 : 1, kind: 'bot', loadout: { id: 'basic', level: 0 } }));
  const sim = new Sim(mk(3), { seed: 1 });               // 2명 대 1명
  eq([sim.team(0).length, sim.team(1).length], [2, 1]);
  sim.startLeg();
  const a = sim.actor('p0');
  let rewards = 0;
  const drain = () => { for (const e of sim.events) if (e.type === 'stage' && e.a === a) rewards += e.reward; sim.events.length = 0; };
  for (const padIndex of [1, 1, 2, 3, 3, 4, 5, 5]) {     // 같은 발판을 다시 밟아도 한 번만
    a.body.ground = sim.course.pads[padIndex];
    if (a.body.ground.padIndex === a.stageDone + 1) sim.completeStage(a);
    drain();
  }
  eq([rewards, a.points, a.stageDone, a.finished], [150, 15, 5, true], '보상 10+20+30+40+50=150, 점수 1+2+3+4+5=15');
  sim.kill(a); drain();
  eq([a.points, a.stageDone], [15, 5], '추락해도 완료 단계·점수 유지');
  eq(sim.score(0), 7.5, '팀원당 평균: (15+0)/2');
  sim.actor('p2').points = 3;
  eq(sim.score(1), 3, '1명 팀은 그대로 3');
  // 차례 중 장비 변경은 다음 차례부터
  sim.setLoadout('p2', 'heavy', 2);
  eq(sim.actor('p2').gun.id, 'basic', '차례 중에는 현재 능력치 유지');
  sim.endLeg();
  eq([sim.phase, sim.actor('p2').gun.id, sim.actor('p2').gun.interval], ['switch', 'heavy', 1.44], '다음 차례에 적용');
  eq(sim.actor('p0').role, 'shoot'); eq(sim.actor('p2').role, 'climb');
}
// ── 보호 규칙: 안전 지대·재등장 보호·피격 면역 ──
{
  const sim = new Sim([{ id: 'c', name: 'C', team: 0, kind: 'human', loadout: { id: 'basic', level: 0 } }, { id: 's', name: 'S', team: 1, kind: 'human', loadout: { id: 'heavy', level: 0 } }], { seed: 2 });
  sim.startLeg();
  const c = sim.actor('c'), s = sim.actor('s');
  const shoot = () => { const shot = { owner: s, gun: s.gun, x: 0, y: 0, z: 0, vx: 1, vy: 0, vz: 0, near: {}, alive: true }; sim.resolveHit(shot, c); return sim.events.splice(0).map((e) => e.type + (e.reason ? ':' + e.reason : '')).filter((t) => /^(hit|blocked)/.test(t))[0]; };
  c.safe = true; eq(shoot(), 'blocked:safe');
  c.safe = false; c.protectT = 1; eq(shoot(), 'blocked:protect');
  c.protectT = 0; eq(shoot(), 'hit'); ok(Math.hypot(c.body.kbVt, c.body.kbVr) > 23.9, 'heavy 밀치기 24');
  eq(shoot(), 'blocked:immune'); ok(c.immuneT > 0.7 && c.immuneT <= CFG.hitImmunity);
  eq(s.hits, 1);
}
// ── 3대3: 여섯 자리가 겹치지 않고, 등반 자리는 계단 폭 안·방해 자리는 통로 안 ──
const bots = (lv) => Array.from({ length: CFG.teamSize * 2 }, (_, i) => ({ id: 'b' + i, name: 'B' + i, team: i % 2, kind: 'bot', loadout: botLoadout(lv, i >> 1) }));
{
  const sim = new Sim(bots(3), { seed: 3 });
  eq([CFG.teamSize, sim.team(0).length, sim.team(1).length], [3, 3, 3]);
  const L = sim.course.lane, at = (a) => toWorld(a.body.th, a.body.r, a.body.y);
  for (const a of sim.actors) for (const b of sim.actors) if (a.idx < b.idx) ok(Math.hypot(at(a).x - at(b).x, at(a).z - at(b).z) > 3, '시작 자리가 서로 3 stud 넘게 떨어짐');
  for (const a of sim.climbers()) ok(a.body.ground === sim.course.pads[0] && a.body.r + CFG.move.halfWidth < CFG.towerRadius + CFG.stepRadial, '등반 자리는 계단 폭 안');
  for (const a of sim.actors.filter((x) => x.role === 'shoot')) ok(a.body.r > L.r0 + CFG.lane.margin && a.body.r < L.r1 - CFG.lane.margin, '방해 자리는 통로 안');
}
// ── 추락: 첫 바퀴는 용암까지, 두 바퀴째는 아래 바퀴 발판에 닿기 전에(뚫고 지나가지 않게) ──
{
  const sim = new Sim(bots(3), { seed: 4 }), c = sim.course;
  let upper = 0;
  for (const p of c.platforms) {
    const floor = sim.fallFloor(p.thc);
    if (p.thc - Math.PI * 2 < c.lane.th0) { eq(floor, CFG.lavaY + 0.5, '첫 바퀴는 용암까지'); continue; }
    upper++;
    ok(floor < p.top - 30, '자기 발판보다 30 stud 넘게 아래(평소 점프·착지에는 걸리지 않음)');
    for (const q of c.platforms) if (Math.abs(q.thc + Math.PI * 2 - p.thc) < 0.2) ok(floor > q.top + 8, '아래 바퀴 발판보다 위');
  }
  ok(upper > 20, '두 바퀴째 발판이 있음');
}
// ── 코스를 실제로 깰 수 있다: 최고 난이도 봇 여섯이 물총 방해 없이 다섯 단계를 모두 완주 ──
{
  const pressure = CFG.ai.stagePressure;
  CFG.ai.stagePressure = pressure.map(() => 0);
  const sim = new Sim(bots(5), { aiLevel: 5, seed: 5 });
  for (let i = 0; sim.phase !== 'results' && i < (CFG.time.leg * 2 + 60) * CFG.simHz; i++) { sim.step(1 / CFG.simHz); sim.events.length = 0; }
  CFG.ai.stagePressure = pressure;
  eq(sim.actors.map((a) => a.stageTimes.length), sim.actors.map(() => CFG.stages.length), '모두 완주');
  ok(sim.actors.every((a) => a.stageTimes[CFG.stages.length - 1] < CFG.time.leg * 0.6), '제한 시간의 60% 안에 완주');
}
// ── 온라인 팀 고르기: 기본은 번갈아, 고르면 그 팀, 정원이 차면 반대 팀, 빈 자리는 AI ──
{
  const o = new Online({ lobby() {} });
  const room = (n) => { o.net = { id: 'p1', hostId: 'p1', isHost: true, send() {}, peers: new Map(Array.from({ length: n }, (_, i) => ['p' + (i + 1), { name: 'P' + (i + 1) }])) }; o.teams.clear(); };
  const teams = () => o.roster().filter((p) => p.kind === 'human').map((p) => p.team);
  room(2);
  eq(teams(), [0, 1], '기본: 들어온 순서대로 민트/핑크');
  eq(o.roster().map((p) => p.kind + p.team).sort(), ['bot0', 'bot0', 'bot1', 'bot1', 'human0', 'human1'], '빈 자리는 AI가 채워 3대3');
  o.setTeam(1);
  eq(teams(), [1, 1], '방장이 핑크를 고르면 친구와 같은 팀');
  eq(o.roster().filter((p) => p.team === 0).map((p) => p.kind), ['bot', 'bot', 'bot'], '같은 팀이면 상대는 AI 셋');
  o.fill = false;
  eq(o.canStart(), false, 'AI 없이 한 팀에만 사람이 있으면 시작 불가');
  o.setTeam(0);
  eq([teams(), o.canStart()], [[0, 1], true]);
  o.fill = true; room(6);
  for (const id of ['p1', 'p2', 'p3', 'p4']) o.teams.set(id, 0);
  eq(teams(), [0, 0, 0, 1, 1, 1], '정원 3명이 찬 팀을 고른 사람은 반대 팀으로');
  eq(o.roster().length, 6, '여섯 명이면 AI 없음');
}
console.log(`규칙 점검 ${n}개 통과`);
