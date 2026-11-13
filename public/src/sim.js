// 경기 시뮬레이션 — 역할 교대, 계단 시계, 물총, 피격 규칙, 점수.
// three.js에 의존하지 않아 Node에서 고속으로 돌려 밸런스를 볼 수 있다.
import { CFG, gunStats } from './config.js';
import { buildCourse, RP, toWorld, angleOf } from './course.js';
import { makeBody, stepClimber, stepLaneWalker, applyKnock } from './physics.js';
import { climbAI, shootAI } from './ai.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const newInput = () => ({ fwd: 0, out: 0, jump: false, hold: false, fire: false, aim: null });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// 팀 안 자리(slot)별 시작 위치. 등반: [발판 중심에서 진행 방향 stud, 계단 중심 반지름에서 바깥 stud] — 셋 다 계단 폭 안이라 곧장 달려도 첫 계단에 오른다.
const CLIMB_SPOTS = [[-2.2, -1.5], [3.4, 1.9], [-6.6, 1.9]];
// 방해: [출발 발판 중심에서 각도, 통로 중심에서 바깥 stud]
const SHOOT_SPOTS = [[0.1, -2], [-0.06, 1.5], [0.26, 1.5]];
const MAX_POINTS = CFG.stages.reduce((s, st) => s + st.points, 0);

export class Sim {
  /**
   * players: [{ id, name, team(0|1), kind:'human'|'bot', local, loadout:{id,level} }]
   * opts: { firstClimb, aiLevel(1..5), seed, host(경기 진행 권한), authAll(모든 캐릭터를 여기서 계산) }
   */
  constructor(players, opts = {}) {
    this.rng = mulberry32(opts.seed ?? (Date.now() & 0xffffffff));
    this.course = buildCourse();
    this.host = opts.host ?? true;
    this.aiLevel = Math.min(5, Math.max(1, opts.aiLevel || 1));
    this.lv = CFG.ai.levels[this.aiLevel - 1];
    this.events = [];
    this.shots = [];
    this.shotSeq = 0;
    this.time = 0;
    this.actors = players.map((p, i) => ({
      id: p.id, p, idx: i,
      slot: players.slice(0, i).filter(q => q.team === p.team).length,
      auth: p.auth ?? true,           // false면 원격 꼭두각시(위치를 네트워크가 넣는다)
      role: 'idle', body: makeBody(0, RP, CFG.startY), inp: newInput(), ai: {},
      alive: true, respawnT: 0, stageDone: 0, finished: false,
      protectT: 0, immuneT: 0, safe: true, hitT: -9, lastHitBy: null,
      gun: gunStats(p.loadout?.id || 'basic', p.loadout?.level || 0),
      cool: 0, windup: 0, windupMax: 0, aim: null, fireT: -9,
      points: 0, stageTimes: [], falls: 0, shotsFired: 0, hits: 0, knockoffs: 0, dodges: 0,
    }));
    this.leg = 0;
    this.firstClimb = opts.firstClimb ?? 0;
    this.climbTeam = this.firstClimb;
    this.legEndHold = 0;
    this.phase = 'countdown';
    this.phaseT = CFG.time.countdown;
    this.clock = -this.phaseT;
    this.course.update(this.clock);
    this.assignRoles();
    this.emit('phase', { phase: 'countdown' });
  }

  emit(type, data = {}) { data.type = type; this.events.push(data); }
  actor(id) { return this.actors.find(a => a.id === id); }
  team(t) { return this.actors.filter(a => a.p.team === t); }
  climbers() { return this.actors.filter(a => a.role === 'climb'); }

  /** 팀원당 평균 점수 (인원이 달라도 공정하게 비교) */
  score(t) {
    const m = this.team(t);
    return m.length ? m.reduce((s, a) => s + a.points, 0) / m.length : 0;
  }
  /** 팀이 최종 점수에 도달한 시각(동점일 때 빠른 쪽 승리) */
  reachTime(t) {
    return Math.max(0, ...this.team(t).map(a => a.stageTimes[a.stageTimes.length - 1] || 0));
  }
  result() {
    const s = [this.score(0), this.score(1)], r = [this.reachTime(0), this.reachTime(1)];
    let winner = -1, by = 'draw';
    if (Math.abs(s[0] - s[1]) > 1e-9) { winner = s[0] > s[1] ? 0 : 1; by = 'score'; }
    else if (s[0] > 0 && Math.abs(r[0] - r[1]) > 0.05) { winner = r[0] < r[1] ? 0 : 1; by = 'time'; }
    return { scores: s, times: r, winner, by };
  }

  /** 상점에서 바꾼 장비. 차례(leg)가 진행 중이면 현재 능력치는 그대로 두고 다음 차례부터 적용한다. */
  setLoadout(id, gunId, level) {
    const a = this.actor(id);
    if (!a || !gunStats(gunId, level)) return;
    a.p.loadout = { id: gunId, level };
    if (this.phase !== 'leg') a.gun = gunStats(gunId, level);
  }

  assignRoles() {
    for (const a of this.actors) {
      a.role = a.p.team === this.climbTeam ? 'climb' : 'shoot';
      a.gun = gunStats(a.p.loadout?.id || 'basic', a.p.loadout?.level || 0); // 차례 장비 확정
      a.stageDone = 0; a.finished = false; a.alive = true;
      a.cool = 0; a.windup = 0; a.aim = null; a.ai = {};
      a.inp = newInput();
      a.lastHitBy = null;
      this.place(a);
    }
  }

  place(a) {
    const c = this.course;
    if (a.role === 'climb') {
      const pad = c.pads[Math.min(a.stageDone, c.pads.length - 1)], [along, out] = CLIMB_SPOTS[a.slot % CLIMB_SPOTS.length];
      a.body = makeBody(pad.thc + along / RP, RP + out, pad.top);
      a.body.ground = pad;
      a.safe = true;
    } else {
      const [dth, out] = SHOOT_SPOTS[a.slot % SHOOT_SPOTS.length], th = c.pads[0].thc + dth;
      a.body = makeBody(th, c.lane.rc + out, c.lane.yAt(th));
    }
  }

  // ── 진행 단계 ───────────────────────────────────────────
  startLeg() {
    this.phase = 'leg'; this.phaseT = CFG.time.leg; this.clock = 0; this.legEndHold = 0;
    for (const a of this.actors) { a.protectT = 0; a.immuneT = 0; a.windup = 0; }
    this.emit('phase', { phase: 'leg', leg: this.leg });
  }
  endLeg() {
    this.shots.length = 0;
    this.emit('legEnd', { leg: this.leg, climbTeam: this.climbTeam });
    if (this.leg === 0) {
      this.leg = 1; this.climbTeam = 1 - this.climbTeam;
      this.phase = 'switch'; this.phaseT = CFG.time.switch; this.clock = -this.phaseT;
      this.assignRoles();
      this.emit('phase', { phase: 'switch' });
    } else {
      this.phase = 'results'; this.phaseT = 0;
      for (const a of this.actors) { a.windup = 0; a.inp = newInput(); }
      this.emit('phase', { phase: 'results', result: this.result() });
    }
  }
  /** 솔로: 교대 대기를 건너뛴다 (마지막 3초 카운트는 남긴다) */
  skipWait() { if ((this.phase === 'switch' || this.phase === 'countdown') && this.phaseT > 3) this.phaseT = 3; }

  tickPhase(dt) {
    if (this.phase === 'results') return;
    const before = this.phaseT;
    this.phaseT -= dt;
    if (this.phase === 'leg') {
      if (this.phaseT <= 10 && Math.ceil(before) !== Math.ceil(this.phaseT) && this.phaseT > 0) this.emit('hurry', { n: Math.ceil(this.phaseT) });
      const cl = this.climbers();
      if (cl.length && cl.every(a => a.finished)) { this.legEndHold += dt; if (this.legEndHold > 1.6) return this.endLeg(); }
      if (this.phaseT <= 0) this.endLeg();
      return;
    }
    if (Math.ceil(before) !== Math.ceil(this.phaseT) && this.phaseT > 0 && this.phaseT <= 3) this.emit('count', { n: Math.ceil(this.phaseT) });
    if (this.phaseT <= 0) this.startLeg();
  }

  // ── 한 틱 ───────────────────────────────────────────────
  step(dt) {
    this.time += dt;
    if (this.host) this.tickPhase(dt);
    else if (this.phase !== 'results') this.phaseT = Math.max(0, this.phaseT - dt);   // 표시용. 전환은 방장이 알려 준다
    if (this.phase === 'leg') this.clock += dt;
    else if (this.phase !== 'results') this.clock = -this.phaseT;
    this.updateStairs();
    for (const a of this.actors) this.stepActor(a, dt);
    this.stepShots(dt);
  }

  updateStairs() {
    const c = this.course;
    for (const p of c.platforms) if (p.moving) p._prev = p.state;
    c.update(this.clock);
    for (const p of c.platforms) if (p.moving && p._prev !== p.state) this.emit('stair', { p, state: p.state });
  }

  stepActor(a, dt) {
    const b = a.body;
    if (a.protectT > 0) a.protectT -= dt;
    if (a.immuneT > 0) a.immuneT -= dt;
    if (a.cool > 0) a.cool -= dt;
    if (!a.auth) return this.stepPuppet(a, dt);
    const bot = a.p.kind === 'bot';
    if (a.role === 'climb') {
      if (!a.alive) {
        a.respawnT -= dt;
        if (a.respawnT <= 0) this.respawn(a);
        return;
      }
      const inp = bot ? climbAI(a, this, dt) : a.inp;
      stepClimber(b, inp, this.course, dt, (type, v) => this.emit(type, { a, v }));
      inp.jump = false;
      if (this.phase !== 'leg') {                        // 출발 전에는 출발 발판 앞 게이트가 닫혀 있다
        const gate = this.course.pads[0].th1 - 1 / b.r;
        if (b.th > gate) { b.th = gate; if (b.vt > 0) b.vt = 0; }
      }
      a.safe = false;
      for (const pad of this.course.pads) {
        if (b.th >= pad.th0 && b.th <= pad.th1 && b.r <= pad.r1 + 0.3 && b.y >= pad.top - 0.5 && b.y <= pad.top + 9) a.safe = true;
      }
      if (b.y < this.fallFloor(b.th)) return this.kill(a);
      const g = b.ground;
      if (this.phase === 'leg' && g && g.kind === 'pad' && g.padIndex === a.stageDone + 1) this.completeStage(a);
    } else if (a.role === 'shoot') {
      const inp = bot ? shootAI(a, this, dt) : a.inp;
      stepLaneWalker(b, inp, this.course, dt);
      if (bot) { if (inp.fire) this.fire(a, a.aim); }
      else {
        if (inp.aim) a.aim = inp.aim;
        if (inp.fire && a.cool <= 0 && a.aim && this.phase !== 'results') this.fire(a, a.aim);
      }
    }
  }

  completeStage(a) {
    a.stageDone++;
    const st = CFG.stages[a.stageDone - 1];
    a.points += st.points;
    a.stageTimes.push(+this.clock.toFixed(2));
    // 보상은 이 차례에 해당 단계를 처음 끝낼 때만. stageDone이 늘 때만 불리므로 중복이 없다.
    this.emit('stage', { a, stage: a.stageDone, reward: st.reward, points: st.points });
    if (a.stageDone === CFG.stages.length) {
      a.finished = true;
      this.emit('finish', { a, time: this.clock });
    }
  }

  /** 이 높이 밑으로 떨어지면 추락. 두 바퀴째에서는 아래 바퀴 계단에 닿기 전에 끝낸다(뚫고 지나가지 않게), 그 밖에는 용암 */
  fallFloor(th) {
    const L = this.course.lane, below = th - Math.PI * 2;
    return below < L.th0 ? CFG.lavaY + 0.5 : L.yAt(below) + CFG.lane.drop + CFG.fallClear;
  }

  kill(a) {
    a.alive = false; a.respawnT = CFG.respawnDelay;
    const w = toWorld(a.body.th, a.body.r, Math.max(CFG.lavaY, a.body.y));
    let by = null;
    if (this.phase === 'leg') {
      a.falls++;
      if (a.lastHitBy && this.time - a.hitT < 3.2) { by = a.lastHitBy; by.knockoffs++; }
    }
    a.lastHitBy = null;
    this.emit('fall', { a, x: w.x, y: w.y, z: w.z, by });
  }

  respawn(a) {
    a.alive = true;
    this.place(a);
    a.protectT = CFG.respawnProtect;
    a.ai = {};
    this.emit('respawn', { a });
  }

  // ── 물총 ────────────────────────────────────────────────
  muzzle(a, aim) {
    const b = a.body, o = toWorld(b.th, b.r, b.y + 3.0);
    let dx = aim.x - o.x, dz = aim.z - o.z;
    const d = Math.hypot(dx, dz) || 1;
    o.x += dx / d * 1.9; o.z += dz / d * 1.9;
    return o;
  }

  fire(a, aim) {
    const g = a.gun, o = this.muzzle(a, aim);
    const dx = aim.x - o.x, dz = aim.z - o.z, h = aim.y - o.y;
    const d = Math.max(0.5, Math.hypot(dx, dz)), v = g.speed, G = CFG.waterGravity;
    const disc = v ** 4 - G * (G * d * d + 2 * h * v * v);
    const ang = disc >= 0 ? Math.atan2(v * v - Math.sqrt(disc), G * d) : Math.PI / 4;
    const ch = Math.cos(ang) * v;
    const s = {
      id: ++this.shotSeq, owner: a, gun: g, x: o.x, y: o.y, z: o.z,
      vx: dx / d * ch, vy: Math.sin(ang) * v, vz: dz / d * ch,
      px: o.x, py: o.y, pz: o.z, traveled: 0, alive: true, near: {}, n: a.shotsFired,
    };
    a.cool = g.interval; a.shotsFired++; a.fireT = this.time;
    this.shots.push(s);
    this.emit('shot', { a, s });
    return s;
  }

  endShot(s, kind, extra) {
    s.alive = false;
    this.emit('splash', { x: s.x, y: s.y, z: s.z, kind, gun: s.gun, ...extra });
    for (const id in s.near) {
      const a = this.actor(id);
      if (a && a.alive && s.near[id] < CFG.nearMiss && s.hitId !== a.id) { a.dodges++; this.emit('nearMiss', { a, s }); }
    }
  }

  stepShots(dt) {
    const c = this.course, L = c.lane;
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.px = s.x; s.py = s.y; s.pz = s.z;
      s.vy -= CFG.waterGravity * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.traveled += Math.hypot(s.vx, s.vy, s.vz) * dt;

      // 등반자 판정: 몸통 캡슐과의 거리
      let done = false;
      for (const a of this.actors) {
        if (a.role !== 'climb' || !a.alive || a === s.owner) continue;
        const b = a.body, w = toWorld(b.th, b.r, 0);
        const cy = Math.min(b.y + 3.8, Math.max(b.y + 0.9, s.y));
        const dist = Math.hypot(s.x - w.x, s.y - cy, s.z - w.z);
        if (dist < CFG.hitRadius + s.gun.radius) {
          if (a.auth) this.resolveHit(s, a);
          else this.endShot(s, 'water');           // 원격 대상: 판정은 대상 쪽 권한이 알려 준다
          done = true; break;
        }
        if (a.p.local && !a.safe && (s.near[a.id] === undefined || dist < s.near[a.id])) s.near[a.id] = dist;
      }
      if (done) continue;

      const r = Math.hypot(s.x, s.z);
      if (s.y < CFG.lavaY) { this.endShot(s, 'steam'); continue; }
      if (r < CFG.towerRadius) { this.endShot(s, 'wall'); continue; }
      const th = c.unwrap(angleOf(s.x, s.z), s.y);
      let hitWorld = false;
      if (r < CFG.towerRadius + CFG.padRadial + 0.5) {
        for (const p of c.platforms) {
          if (p.k > 0.04 && th >= p.th0 && th <= p.th1 && r <= p.r1 && s.y <= p.top && s.y >= p.top - p.thick) { hitWorld = true; break; }
        }
      } else if (r >= L.r0 && r <= L.r1 && th >= L.th0 && th <= L.th1 && s.traveled > 4) {
        const ly = L.yAt(th);
        if (s.y <= ly && s.y >= ly - 1.6) hitWorld = true;
      }
      if (hitWorld) { this.endShot(s, 'wall'); continue; }
      if (s.traveled >= s.gun.range) this.endShot(s, 'mist');
    }
    if (this.shots.length > 40 || (this.shots.length && !this.shots[0].alive)) this.shots = this.shots.filter(s => s.alive);
  }

  /** 대상 쪽 권한에서만 부른다: 안전 지대·보호·면역을 확인하고 밀친다. */
  resolveHit(s, a) {
    s.hitId = a.id;
    const blocked = this.phase !== 'leg' ? 'idle' : a.safe ? 'safe' : a.protectT > 0 ? 'protect' : a.immuneT > 0 ? 'immune' : null;
    if (blocked) {
      this.endShot(s, 'shield', { a, blocked });
      this.emit('blocked', { a, s, reason: blocked });
      return;
    }
    const b = a.body, hv = Math.hypot(s.vx, s.vz) || 1;
    const nx = s.vx / hv, nz = s.vz / hv;
    const sn = Math.sin(b.th), cs = Math.cos(b.th);
    applyKnock(b, nx * -sn + nz * -cs, nx * cs + nz * -sn, s.gun.knock);
    a.immuneT = CFG.hitImmunity;
    a.hitT = this.time; a.lastHitBy = s.owner;
    s.owner.hits++;
    this.endShot(s, 'hit', { a });
    this.emit('hit', { a, s, by: s.owner, gun: s.gun });
  }

  // ════ 온라인 대전 ════
  // 각 브라우저는 자기 캐릭터(와 방장은 AI)만 직접 계산(auth)하고, 나머지는 받은 상태를 따라간다.
  // 맞았는지는 "맞는 쪽"이 판정한다 → 내 화면에서 피한 물줄기에 억울하게 밀리지 않는다.

  packState(a) {
    const b = a.body, q = (v) => Math.round(v * 100) / 100;
    return [a.id, +b.th.toFixed(4), q(b.r), q(b.y), q(b.vt + b.kbVt), q(b.vr + b.kbVr), q(b.vy),
      b.ground ? (b.ground.id ?? -2) : -1,
      (a.alive ? 1 : 0) | (b.kbT > 0 ? 2 : 0) | (a.safe ? 4 : 0) | (a.protectT > 0 ? 8 : 0) | (a.immuneT > 0 ? 16 : 0),
      a.aim ? [q(a.aim.x), q(a.aim.y), q(a.aim.z)] : 0, q(Math.max(0, a.windup)), q(a.windupMax)];
  }

  /** 받은 상태(검증 후)를 꼭두각시의 목표로 삼는다. lag: 보낸 뒤 지난 시간(초) */
  applyState(s, lag = 0) {
    if (!Array.isArray(s)) return;
    const a = this.actor(s[0]);
    if (!a || a.auth || !s.slice(1, 9).every(Number.isFinite)) return;
    const [, th, r, y, vt, vr, vy, g, fl] = s;
    const ground = g >= 0 ? this.course.platforms[g] || null : g === -2 ? this.course.lane : null;
    const was = a.net ? a.net.ground : a.body.ground;
    a.net = {
      th: clamp(th, -0.3, this.course.thEnd + 0.3), r: clamp(r, 60, 112), y: clamp(y, -6, this.course.pads[this.course.pads.length - 1].top + 30),
      vt: clamp(vt, -70, 70), vr: clamp(vr, -70, 70), vy: clamp(vy, -160, 80), ground, kb: !!(fl & 2), age: clamp(lag, 0, 0.25),
    };
    a.safe = !!(fl & 4);
    a.protectT = fl & 8 ? Math.max(a.protectT, 0.2) : 0;
    a.immuneT = fl & 16 ? Math.max(a.immuneT, 0.2) : 0;
    if (Array.isArray(s[9]) && s[9].length === 3 && s[9].every(Number.isFinite)) a.aim = { x: s[9][0], y: s[9][1], z: s[9][2] };
    a.windup = Number.isFinite(s[10]) ? clamp(s[10], 0, 2) : 0;
    a.windupMax = Number.isFinite(s[11]) ? clamp(s[11], 0, 2) : 0;
    if (a.role === 'climb' && a.alive) {
      if (!was && ground) this.emit('land', { a, v: 45, remote: true });
      else if (was && !ground && vy > 20) this.emit('jump', { a, remote: true });
    }
  }

  stepPuppet(a, dt) {
    const b = a.body, n = a.net;
    b.pth = b.th; b.pr = b.r; b.py = b.y;
    if (a.windup > 0) a.windup -= dt;
    if (!n || !a.alive) return;
    n.age += dt;
    const e = Math.min(n.age, 0.22), g = n.ground ? 0 : CFG.move.gravity;
    const tth = n.th + (n.vt * e) / n.r, tr = n.r + n.vr * e, ty = n.y + (n.ground ? 0 : n.vy * e - 0.5 * g * e * e);
    const k = Math.min(1, dt * 20);
    b.th += (tth - b.th) * k; b.r += (tr - b.r) * k; b.y += (ty - b.y) * k;
    b.vt = n.vt; b.vr = n.vr; b.vy = n.vy - g * e; b.ground = n.ground; b.kbT = n.kb ? 0.05 : 0;
  }

  /** 다른 브라우저가 쏜 물줄기를 내 화면에도 띄운다(내 캐릭터가 맞는지는 여기서 판정) */
  addRemoteShot(m, lag = 0) {
    const a = this.actor(m.id);
    if (!a || a.auth || a.role !== 'shoot' || !Array.isArray(m.o) || !Array.isArray(m.v)) return;
    const o = m.o, v = m.v;
    if (o.length !== 3 || v.length !== 3 || ![...o, ...v].every(Number.isFinite)) return;
    if (Math.hypot(v[0], v[1], v[2]) > a.gun.speed * 1.05 + 1) return;         // 총 능력치를 넘는 탄속은 무시
    const t = clamp(lag, 0, 0.2);
    const s = {
      id: ++this.shotSeq, owner: a, gun: a.gun, n: m.n | 0, remote: true, alive: true, near: {},
      x: o[0] + v[0] * t, y: o[1] + v[1] * t - 0.5 * CFG.waterGravity * t * t, z: o[2] + v[2] * t,
      vx: v[0], vy: v[1] - CFG.waterGravity * t, vz: v[2], traveled: Math.hypot(v[0], v[1], v[2]) * t,
    };
    s.px = s.x; s.py = s.y; s.pz = s.z;
    a.shotsFired++; a.fireT = this.time;
    this.shots.push(s);
    this.emit('shot', { a, s, remote: true });
  }

  /** 대상 쪽 권한이 알려 온 사건(추락·복귀·단계 완료·명중)을 반영한다 */
  applyEvent(m) {
    const a = this.actor(m.id);
    if (!a || a.auth) return;
    const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
    const by = typeof m.by === 'string' ? this.actor(m.by) : null;
    const endShot = () => { const s = by && this.shots.find((x) => x.alive && x.owner === by && x.n === (m.n | 0)); if (s) s.alive = false; };
    switch (m.e) {
      case 'fall':
        if (!a.alive) break;
        a.alive = false; a.respawnT = 99;
        if (this.phase === 'leg') { a.falls++; if (by) by.knockoffs++; }
        this.emit('fall', { a, x: num(m.x), y: clamp(num(m.y, CFG.lavaY), CFG.lavaY, 400), z: num(m.z), by, remote: true });
        break;
      case 'respawn':
        a.alive = true; this.place(a); a.net = null; a.protectT = CFG.respawnProtect;
        this.emit('respawn', { a, remote: true });
        break;
      case 'stage': {
        const st = m.stage | 0;
        if (this.phase !== 'leg' || a.role !== 'climb' || st !== a.stageDone + 1 || st > CFG.stages.length) break;   // 순서대로만
        const cfg = CFG.stages[st - 1], time = clamp(num(m.time, this.clock), 0, CFG.time.leg);
        a.stageDone = st; a.points += cfg.points; a.stageTimes.push(+time.toFixed(2));
        this.emit('stage', { a, stage: st, reward: cfg.reward, points: cfg.points, remote: true });
        if (st === CFG.stages.length) { a.finished = true; this.emit('finish', { a, time, remote: true }); }
        break;
      }
      case 'hit':
        if (!by || by.role !== 'shoot') break;
        endShot();
        a.hitT = this.time; a.immuneT = CFG.hitImmunity; by.hits++;
        this.emit('splash', { x: num(m.x), y: num(m.y), z: num(m.z), kind: 'hit', gun: by.gun, a });
        this.emit('hit', { a, s: { owner: by, gun: by.gun }, by, gun: by.gun, remote: true });
        break;
      case 'blocked':
        if (!by) break;
        endShot();
        this.emit('splash', { x: num(m.x), y: num(m.y), z: num(m.z), kind: 'shield', gun: by.gun, a });
        this.emit('blocked', { a, s: { owner: by, gun: by.gun }, reason: ['safe', 'protect', 'immune', 'idle'].includes(m.reason) ? m.reason : 'safe', remote: true });
        break;
    }
  }

  packSync() {
    return { phase: this.phase, leg: this.leg, pt: +this.phaseT.toFixed(2), ck: +this.clock.toFixed(3),
      st: this.actors.map((a) => [a.id, a.stageDone, a.points, a.falls, a.hits, a.knockoffs, a.finished ? 1 : 0, a.stageTimes]) };
  }
  /** 방장의 공식 기록. all=true(차례 종료)면 내 캐릭터 기록도 방장 것에 맞춘다 */
  applyScores(rows, all = false) {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const a = Array.isArray(row) && this.actor(row[0]);
      if (!a || (a.auth && !all)) continue;
      a.stageDone = clamp(row[1] | 0, 0, CFG.stages.length); a.points = clamp(row[2] | 0, 0, MAX_POINTS); a.falls = Math.max(0, row[3] | 0);
      a.hits = Math.max(0, row[4] | 0); a.knockoffs = Math.max(0, row[5] | 0); a.finished = !!row[6];
      if (Array.isArray(row[7])) a.stageTimes = row[7].filter(Number.isFinite).slice(0, CFG.stages.length);
    }
  }
  applySync(m, lag = 0) {
    if (m.phase !== this.phase || m.leg !== this.leg || !Number.isFinite(m.pt) || !Number.isFinite(m.ck)) return;
    const pt = m.pt - lag;
    if (Math.abs(pt - this.phaseT) > 0.15) this.phaseT = Math.max(0, pt);
    if (this.phase === 'leg' && Math.abs(m.ck + lag - this.clock) > 0.08) this.clock = m.ck + lag;
    this.applyScores(m.st);
  }
  /** 나간 사람(또는 방장 교체 시 AI)의 캐릭터를 여기서 AI로 이어 받는다 */
  takeOver(a) { a.auth = true; a.p.kind = 'bot'; a.ai = {}; a.net = null; a.inp = newInput(); if (!a.alive) a.respawnT = Math.min(a.respawnT, CFG.respawnDelay); }
}
