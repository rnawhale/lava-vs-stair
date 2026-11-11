// 규칙 자체 점검(브라우저 없이): 물총 수치·강화, 거래 중복 방지, 저장 복구, 계단 기회, 점수·보상 규칙.
//   node tools/check.mjs
import assert from 'node:assert/strict';
import { CFG, gunStats } from '../public/src/config.js';
import { buildCourse, stepPhase, nextRetractAt } from '../public/src/course.js';
import { defaultSave, sanitize, buy, upgrade, equip, loadSave, persist, loadoutOf } from '../public/src/save.js';
import { Sim } from '../public/src/sim.js';

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
}
// ── 코스: 6/8/10 계단, 고정 발판, 예고 0.5초, 8초 안에 반드시 오는 착지 기회 ──
{
  const c = buildCourse();
  eq(c.stages.map((s) => s.steps.length), [6, 8, 10]);
  eq(c.pads.length, 4);
  ok(c.pads.every((p) => p.safe) && c.platforms.filter((p) => p.kind === 'step').every((p) => !p.safe), '물총 안전 지대는 출발·체크포인트·완주 발판');
  ok(c.thEnd < Math.PI * 2 - 0.2, '코스가 한 바퀴를 넘지 않음');
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
  for (const padIndex of [1, 1, 2, 3, 3]) {              // 같은 발판을 다시 밟아도 한 번만
    a.body.ground = sim.course.pads[padIndex];
    if (a.body.ground.padIndex === a.stageDone + 1) sim.completeStage(a);
    drain();
  }
  eq([rewards, a.points, a.stageDone, a.finished], [60, 6, 3, true], '보상 10+20+30=60, 점수 1+2+3=6');
  sim.kill(a); drain();
  eq([a.points, a.stageDone], [6, 3], '추락해도 완료 단계·점수 유지');
  eq(sim.score(0), 3, '팀원당 평균: (6+0)/2');
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
console.log(`규칙 점검 ${n}개 통과`);
