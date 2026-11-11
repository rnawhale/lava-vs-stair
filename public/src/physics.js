// 캐릭터 이동 — 원통 좌표(th, r, y)에서 도는 순수 로직.
// 발판은 [th0..th1]×[r0..r1]×[top-thick..top] 상자다. 계단이 접히면 r1이 줄어든다.
import { CFG } from './config.js';

export function makeBody(th, r, y) {
  return {
    th, r, y, vt: 0, vr: 0, vy: 0,
    pth: th, pr: r, py: y,          // 이전 틱 위치(렌더 보간용)
    ground: null, coyote: 0, buffer: 0, airT: 0,
    kbT: 0, kbVt: 0, kbVr: 0,       // 밀치기 채널: 조작 속도와 따로 더한다
  };
}

const supported = (p, th, r, g) =>
  p.k > 0.04 && th >= p.th0 - g / r && th <= p.th1 + g / r && r <= p.r1 + g;

/**
 * 등반자 한 틱. inp = { fwd, out, jump(이번 틱에 눌림), hold(누르고 있음) }
 * emit(type, value)로 jump/land/ledge 이벤트를 알린다.
 */
export function stepClimber(b, inp, course, dt, emit) {
  const M = CFG.move;
  b.pth = b.th; b.pr = b.r; b.py = b.y;
  b.buffer = inp.jump ? M.jumpBuffer : b.buffer - dt;
  b.coyote = b.ground ? M.coyote : b.coyote - dt;
  const stagger = b.kbT > 0;

  // 조작 속도: 목표 속도로 빠르게 수렴 (공중에서도 꽤 잘 꺾인다)
  let fx = inp.fwd, fo = inp.out;
  const len = Math.hypot(fx, fo);
  if (len > 1) { fx /= len; fo /= len; }
  let accel = b.ground ? M.groundAccel : (len > 0.05 ? M.airAccel : M.airAccel * 0.45);
  if (stagger) accel *= 0.1;
  const dx = fx * M.speed - b.vt, dy = fo * M.speed - b.vr;
  const d = Math.hypot(dx, dy), a = accel * dt;
  if (d <= a) { b.vt += dx; b.vr += dy; } else { b.vt += dx / d * a; b.vr += dy / d * a; }

  // 점프: 입력 예약 + 가장자리 유예
  if (b.buffer > 0 && (b.ground || b.coyote > 0) && !stagger) {
    b.vy = M.jumpVel; b.ground = null; b.coyote = 0; b.buffer = 0;
    emit('jump');
  }
  const g = M.gravity * (b.vy > 0 && !inp.hold ? M.jumpCutGravity : 1);
  b.vy = Math.max(b.vy - g * dt, -M.terminal);

  // 밀치기: knockDuration 동안 일정 속도로 밀리고 그 뒤 빠르게 사라진다
  if (b.kbT > 0) b.kbT -= dt;
  else if (b.kbVt || b.kbVr) {
    const f = Math.exp(-dt / 0.06);
    b.kbVt *= f; b.kbVr *= f;
    if (Math.hypot(b.kbVt, b.kbVr) < 0.4) b.kbVt = b.kbVr = 0;
  }
  const vt = b.vt + b.kbVt, vr = b.vr + b.kbVr;
  const hw = M.halfWidth;
  // 몸통이 발판 옆면에 걸리는가 (윗면 위에 있으면 걸리지 않는다)
  const blocks = (p) => p.k > 0.04 && b.y < p.top - 0.02 && b.y + M.height > p.top - p.thick;
  // 점프로 날아와 윗면에 살짝 못 미쳤을 때 올려 준다
  const assist = (p) => b.airT > 0.12 && b.vy < 12 && b.y >= p.top - M.ledgeAssist;
  const mount = (p) => { b.y = p.top; b.vy = 0; b.ground = p; b.airT = 0; emit('ledge'); };

  // ── 진행 방향 ──
  let th = b.th + vt * dt / b.r;
  for (const p of course.platforms) {
    if (!blocks(p) || b.r - hw >= p.r1 || b.r + hw <= p.r0) continue;
    const m = hw / b.r;
    if (th + m <= p.th0 || th - m >= p.th1) continue;
    const fromBelow = b.th < p.thc;
    if (assist(p) && (fromBelow ? vt > 1 : vt < -1)) {
      mount(p);
      th = fromBelow ? Math.max(th, p.th0 - (M.edgeGrace - 0.1) / b.r) : Math.min(th, p.th1 + (M.edgeGrace - 0.1) / b.r);
    } else {
      th = fromBelow ? p.th0 - m : p.th1 + m;
      b.vt = 0; b.kbVt = 0;
    }
  }

  // ── 반지름 방향 (안쪽은 탑 벽) ──
  let r = b.r + vr * dt;
  const wall = CFG.towerRadius + hw;
  if (r < wall) { r = wall; if (b.vr < 0) b.vr = 0; if (b.kbVr < 0) b.kbVr = 0; }
  for (const p of course.platforms) {
    if (!blocks(p)) continue;
    const m = hw / r;
    if (th + m <= p.th0 || th - m >= p.th1 || r - hw >= p.r1) continue;
    if (p.state === 'in' && vr >= 0) continue;        // 접히는 계단은 발밑에서 빠져나갈 뿐
    if (assist(p) && vr < -1) { mount(p); r = Math.min(r, p.r1 + M.edgeGrace - 0.1); }
    else { r = p.r1 + hw; if (b.vr < 0) b.vr = 0; if (b.kbVr < 0) b.kbVr = 0; }
  }

  // ── 수직: 내려오다 윗면을 지나면 착지 ──
  const prevY = b.y;
  let y = b.y + b.vy * dt;
  let ground = null;
  if (b.vy <= 0) {
    for (const p of course.platforms) {
      if (prevY >= p.top - 0.03 && y <= p.top && supported(p, th, r, M.edgeGrace) && (!ground || p.top > ground.top)) ground = p;
    }
  }
  if (ground) {
    if (!b.ground && b.airT > 0.05) emit('land', -b.vy);
    y = ground.top; b.vy = 0;
  }
  b.airT = ground ? 0 : b.airT + dt;
  b.ground = ground; b.th = th; b.r = r; b.y = y;
}

/** 사격 통로 위 이동: 통로 밖으로 나갈 수 없고 높이는 통로 경사를 따른다. */
export function stepLaneWalker(b, inp, course, dt) {
  const L = course.lane, sp = CFG.lane.speed, mg = CFG.lane.margin;
  b.pth = b.th; b.pr = b.r; b.py = b.y;
  let fx = inp.fwd, fo = inp.out;
  const len = Math.hypot(fx, fo);
  if (len > 1) { fx /= len; fo /= len; }
  const dx = fx * sp - b.vt, dy = fo * sp - b.vr;
  const d = Math.hypot(dx, dy), a = CFG.move.groundAccel * dt;
  if (d <= a) { b.vt += dx; b.vr += dy; } else { b.vt += dx / d * a; b.vr += dy / d * a; }
  b.r = Math.min(L.r1 - mg, Math.max(L.r0 + mg, b.r + b.vr * dt));
  b.th = Math.min(L.th1 - mg / b.r, Math.max(L.th0 + mg / b.r, b.th + b.vt * dt / b.r));
  b.y = L.yAt(b.th); b.vy = 0; b.ground = L;
}

/** 수평 밀치기. (dirT, dirR)는 대상 위치의 접선/반지름 성분(정규화). */
export function applyKnock(b, dirT, dirR, dv) {
  b.kbVt = dirT * dv; b.kbVr = dirR * dv; b.kbT = CFG.knockDuration;
}
