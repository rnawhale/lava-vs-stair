// AI 참가자 — 등반과 물총 방해를 모두 한다.
// 사람이 공략할 여지: 등반 봇은 발판에서 뜸을 들이고 가끔 타이밍을 잘못 읽으며,
// 사격 봇은 쏘기 전에 조준선을 보여 주고(windup) 그때의 속도로만 예측해서 쏜다.
import { CFG } from './config.js';
import { stepPhase, nextRetractAt, toWorld } from './course.js';

const AIR = 0.47;    // +2 높이 점프의 체공 시간
const CROSS = 0.3;   // 착지 후 다음 도약 지점까지 걸리는 최소 시간
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (rng, [a, b]) => a + (b - a) * rng();
const gauss = (rng) => (rng() + rng() + rng() + rng() - 2) * 1.22;

const landable = (p, t) => {
  if (!p.moving) return true;
  const ph = stepPhase(p.moving, t);
  return ph.state === 'out' || ph.state === 'warn' || (ph.state === 'ext' && ph.k > 0.8);
};

/** route[i]에 tArr에 착지하면 다음 고정 발판까지 이어 갈 수 있는가 */
function chainOK(route, i, tArr, depth = 0) {
  const p = route[i];
  if (!p || !p.moving) return true;
  if (!landable(p, tArr)) return false;
  if (depth > 3 || !route[i + 1]) return true;
  const deadline = nextRetractAt(p.moving, tArr) + 0.2 * p.moving.trav;
  for (let t = tArr + CROSS; t <= deadline; t += 0.1) {
    if (landable(route[i + 1], t + AIR) && chainOK(route, i + 1, t + AIR, depth + 1)) return true;
  }
  return false;
}

/** 곧 내 쪽으로 지나갈 물줄기가 있는가. 실력(L.dodge)에 따라 물줄기마다 "봤다/못 봤다"가 한 번 정해진다. */
function incoming(a, sim) {
  const ai = a.ai, b = a.body, w = toWorld(b.th, b.r, b.y + 2.4);
  ai.seen = ai.seen || {};
  for (const s of sim.shots) {
    if (!s.alive) continue;
    if (ai.seen[s.id] === undefined) ai.seen[s.id] = sim.rng() < sim.lv.dodge;
    if (!ai.seen[s.id]) continue;
    const dx = w.x - s.x, dy = w.y - s.y, dz = w.z - s.z, v2 = s.vx * s.vx + s.vy * s.vy + s.vz * s.vz;
    const t = (dx * s.vx + dy * s.vy + dz * s.vz) / v2;
    if (t < 0 || t > 0.5) continue;
    if (Math.hypot(dx - s.vx * t, dy - s.vy * t, dz - s.vz * t) < 5) return true;
  }
  return false;
}

export function climbAI(a, sim, dt) {
  const ai = a.ai, b = a.body, inp = a.inp, L = sim.lv, rng = sim.rng;
  const route = sim.course.route, speed = CFG.move.speed;
  inp.fwd = 0; inp.out = 0; inp.jump = false; inp.hold = true;
  if (ai.laneR === undefined) ai.laneR = CFG.towerRadius + 2.6 + rng() * 4;
  if (sim.phase !== 'leg' || a.finished || b.kbT > 0) return inp;

  const dr = ai.laneR - b.r;
  inp.out = Math.abs(dr) > 0.4 ? Math.sign(dr) : 0;
  if (!b.ground) {                       // 공중: 향하던 쪽으로 계속
    inp.fwd = ai.dir || 0;
    return inp;
  }
  const p = b.ground, i = p.id, next = route[i + 1], prev = route[i - 1];
  if (!next) return inp;
  if (ai.cur !== i) {                    // 새 발판에 도착
    ai.cur = i; ai.dir = 0; ai.committed = false; ai.retreat = false;
    ai.e = clamp(1 + gauss(rng) * L.takeoffNoise, -1.2, 3.8);   // 가장자리 몇 stud 앞에서 뛸지
    if (!p.moving) {
      ai.think = rand(rng, L.think) * (p.kind === 'pad' ? 1 : 0.55);
      // 가끔 계단 시계를 늦게 읽는다 → 접히는 계단에 올라타 허둥대거나 떨어진다
      ai.clockErr = next.moving && rng() < L.slip * (0.6 + 0.2 * p.stage) ? 0.35 + rng() * 0.6 : 0;
    }
  }
  const tNow = sim.clock - (ai.clockErr || 0);
  const edge = (p.th1 - b.th) * b.r;
  const toTakeoff = edge - ai.e;
  const tLand = tNow + Math.max(0, toTakeoff) / speed + AIR;
  const go = landable(next, tLand) && chainOK(route, i + 1, tLand);
  const waitAt = Math.max(ai.e + 1.6, (p.th1 - p.th0) * b.r * 0.5);
  const walkTo = (e) => { const d = edge - e; inp.fwd = d > 0.25 ? 1 : d < -0.6 ? -1 : 0; };
  const leap = (dir) => { inp.jump = true; ai.dir = dir; inp.fwd = dir; };

  if (ai.retreat && prev) {              // 뒤 발판으로 물러나기
    inp.fwd = -1;
    if ((b.th - p.th0) * b.r <= 1) leap(-1);
    return inp;
  }
  if (!p.moving) {
    if (ai.think > 0) { ai.think -= dt; walkTo(waitAt); return inp; }
    if (!ai.committed) {
      if (!go) { ai.react = undefined; walkTo(waitAt); return inp; }
      // 창이 열린 걸 알아채는 데 걸리는 시간
      if (ai.react === undefined) ai.react = rand(rng, L.react);
      if ((ai.react -= dt) > 0) { walkTo(waitAt); return inp; }
      ai.committed = true; ai.react = undefined;
    } else if (!go && toTakeoff > 0.5) { ai.committed = false; return inp; }  // 창이 닫혔다: 멈춤
    if (incoming(a, sim)) { ai.committed = false; walkTo(waitAt); return inp; }
    inp.fwd = 1;
    if (toTakeoff <= 0) leap(1);
    return inp;
  }
  // 움직이는 계단 위: 이어 갈 수 있으면 바로, 아니면 버티다가 비상 탈출
  if (go) { inp.fwd = 1; if (toTakeoff <= 0) leap(1); return inp; }
  const left = nextRetractAt(p.moving, tNow) - tNow;
  if (p.state === 'out' && left > 0.45) { walkTo(waitAt); return inp; }
  const ph = stepPhase(next.moving, tLand);
  if (!next.moving || ph.k > 0.45) { inp.fwd = 1; if (toTakeoff <= 0.3) leap(1); }
  else if (prev && landable(prev, tNow + 0.6)) ai.retreat = true;
  else { inp.fwd = 1; if (toTakeoff <= 0.3) leap(1); }
  return inp;
}

export function shootAI(a, sim, dt) {
  const ai = a.ai, b = a.body, inp = a.inp, L = sim.lv, rng = sim.rng, lane = sim.course.lane;
  inp.fwd = 0; inp.out = 0; inp.fire = false;
  if (ai.laneR === undefined) { ai.laneR = lane.r0 + 2 + rng() * 5; ai.wait = 0.6 + rng(); ai.retarget = 0; }
  if (a.windup > 0) {                    // 조준선을 보여 주는 동안은 조준점 고정
    a.windup -= dt;
    if (a.windup <= 0) { a.windup = 0; inp.fire = sim.phase === 'leg'; }
    return inp;
  }
  const targets = sim.actors.filter(c => c.role === 'climb' && !c.finished);
  if (!targets.length || sim.phase === 'results') return inp;
  ai.retarget -= dt;
  if (!ai.tgt || !targets.includes(ai.tgt) || ai.retarget <= 0) {
    // 서로 다른 등반자를 맡되, 가끔은 앞서가는 쪽을 함께 노린다
    const lead = targets.reduce((m, c) => (c.body.th > m.body.th ? c : m));
    ai.tgt = rng() < 0.3 ? lead : targets[a.slot % targets.length];
    ai.retarget = 3 + rng() * 3;
    ai.side = rng() < 0.75 ? 1 : -1;
    ai.offset = (a.gun.range < 50 ? 0.2 : 0.27) + rng() * 0.05;
  }
  const t = ai.tgt, tb = t.body;
  const want = clamp(tb.th + ai.side * ai.offset, lane.th0 + 0.04, lane.th1 - 0.04);
  const dth = (want - b.th) * b.r;
  inp.fwd = Math.abs(dth) > 2 ? Math.sign(dth) : 0;
  const dr = ai.laneR - b.r;
  inp.out = Math.abs(dr) > 0.6 ? Math.sign(dr) : 0;
  if (sim.phase !== 'leg') return inp;
  ai.wait -= dt;
  if (a.cool > 0 || ai.wait > 0 || !t.alive || t.safe || t.protectT > 0.2) return inp;

  // 예측 사격: 지금 속도가 그대로 이어진다고 보고 쏜다 (방향을 바꾸면 피할 수 있다)
  const from = toWorld(b.th, b.r, b.y + 3);
  const now = toWorld(tb.th, tb.r, tb.y + 2.4);
  const dist = Math.hypot(now.x - from.x, now.y - from.y, now.z - from.z);
  if (dist > a.gun.range * 0.94) return inp;
  const tHit = L.windup + dist / a.gun.speed;
  const k = dist / 35;
  const th = tb.th + ((tb.vt + tb.kbVt) * tHit * L.lead + gauss(rng) * L.aimErr * k) / tb.r;
  const r = Math.max(CFG.towerRadius + 1, tb.r + tb.vr * tHit * L.lead * 0.5);
  let y = tb.y;
  if (!tb.ground) y = Math.max(tb.y - 4, tb.y + tb.vy * tHit - 0.5 * CFG.move.gravity * tHit * tHit);
  a.aim = toWorld(th, r, y + 2.4 + gauss(rng) * L.aimErr * 0.35 * k);
  a.windup = a.windupMax = L.windup;
  const stage = Math.min(2, t.stageDone);
  ai.wait = rand(rng, L.fireWait) / CFG.ai.stagePressure[stage];
  sim.emit('windup', { a });
  return inp;
}

/** AI 난이도별 봇 장비 */
export const botLoadout = (level, slot) => {
  const L = CFG.ai.levels[Math.min(5, Math.max(1, level)) - 1];
  return { id: L.guns[slot % L.guns.length], level: L.lv };
};
