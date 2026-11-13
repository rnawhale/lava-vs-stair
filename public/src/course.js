// 코스 기하와 계단 주기 — 렌더러 없이 Node에서도 돌아가는 순수 로직.
// 좌표: 탑 축이 y축. 원통 좌표 (th, r, y). 월드 x = r·cos th, z = -r·sin th.
// th가 커지는 쪽이 등반 방향이고, 그때 벽(탑)은 진행 방향의 왼쪽에 있다.
import { CFG } from './config.js';

export const RP = CFG.towerRadius + CFG.stepRadial / 2 + 0.25; // 계단 중심 반지름 (≈68.5+)

export const toWorld = (th, r, y, out = {}) => {
  out.x = r * Math.cos(th); out.y = y; out.z = -r * Math.sin(th);
  return out;
};
/** 월드 좌표 → 한 바퀴 안의 각도. 코스는 한 바퀴를 넘으므로 어느 바퀴인지는 course.unwrap(th, y)가 높이로 정한다. */
export const angleOf = (x, z) => {
  let th = Math.atan2(-z, x);
  if (th < -0.5) th += Math.PI * 2;
  return th;
};

/** 움직이는 계단의 시각 t에서의 상태. k: 1=완전히 나옴, 0=벽 속 */
export function stepPhase(m, t) {
  if (!m || t < m.phase) return { state: 'out', k: 1, tau: 0 };
  const period = m.ext + m.trav * 2 + m.hid;
  const tau = (t - m.phase) % period;
  const warnAt = m.ext - CFG.warnSeconds;
  if (tau < warnAt) return { state: 'out', k: 1, tau };
  if (tau < m.ext) return { state: 'warn', k: 1, tau, w: (tau - warnAt) / CFG.warnSeconds };
  if (tau < m.ext + m.trav) return { state: 'in', k: 1 - (tau - m.ext) / m.trav, tau };
  if (tau < m.ext + m.trav + m.hid) return { state: 'hidden', k: 0, tau };
  return { state: 'ext', k: (tau - m.ext - m.trav - m.hid) / m.trav, tau };
}

/** t 이후 이 계단이 다음에 접히기 시작하는 시각 (고정 발판은 Infinity) */
export function nextRetractAt(m, t) {
  if (!m) return Infinity;
  if (t < m.phase) return m.phase + m.ext;
  const period = m.ext + m.trav * 2 + m.hid;
  const n = Math.floor((t - m.phase) / period);
  const start = m.phase + n * period + m.ext;
  return start > t ? start : start + period;
}

export function buildCourse() {
  const C = CFG;
  const platforms = [];
  const pads = [];
  const stages = [];
  let s = 0;            // 계단 중심 반지름에서의 호 길이
  let y = C.startY;
  const addPad = (padIndex) => {
    const p = {
      id: platforms.length, kind: 'pad', padIndex, stage: padIndex, index: 0,
      th0: s / RP, th1: (s + C.padLength) / RP,
      r0: C.towerRadius, rFull: C.towerRadius + C.padRadial,
      top: y, thick: C.padThick, moving: null, safe: true, k: 1, state: 'out',
    };
    p.r1 = p.rFull; p.thc = (p.th0 + p.th1) / 2;
    platforms.push(p); pads.push(p);
    s += C.padLength;
    return p;
  };
  let pad = addPad(0);
  C.stages.forEach((st, si) => {
    const gap = st.run - C.stepLength;
    const steps = [];
    for (let i = 1; i <= st.steps; i++) {
      s += gap; y += st.rise;
      const p = {
        id: platforms.length, kind: 'step', stage: si + 1, index: i,
        th0: s / RP, th1: (s + C.stepLength) / RP,
        r0: C.towerRadius, rFull: C.towerRadius + C.stepRadial,
        top: y, thick: C.stepThick, moving: st.moving[i] || null, safe: false, k: 1, state: 'out',
      };
      p.r1 = p.rFull; p.thc = (p.th0 + p.th1) / 2;
      platforms.push(p); steps.push(p);
      s += C.stepLength;
    }
    s += gap; y += st.rise;
    const end = addPad(si + 1);
    stages.push({ id: si + 1, start: pad, steps, end, gap, cfg: st });
    pad = end;
  });

  const thEnd = s / RP;
  // 사격 통로: 발판 중심 높이를 잇는 완만한 나선, 계단보다 drop만큼 낮다.
  const laneR = RP + C.lane.radiusOffset;
  const knots = pads.map(p => [p.thc, p.top - C.lane.drop]);
  const lane = {
    th0: -0.1, th1: thEnd + 0.1,
    r0: laneR - C.lane.width / 2, r1: laneR + C.lane.width / 2, rc: laneR,
    yAt(th) {
      if (th <= knots[0][0]) return knots[0][1];
      for (let i = 1; i < knots.length; i++) {
        if (th <= knots[i][0]) {
          const a = knots[i - 1], b = knots[i];
          return a[1] + (b[1] - a[1]) * (th - a[0]) / (b[0] - a[0]);
        }
      }
      return knots[knots.length - 1][1];
    },
  };

  return {
    platforms, pads, stages, lane, thEnd, route: platforms, // route = 진행 순서
    t: 0,
    /** 계단 시계를 t로 맞춘다 (t<0이면 전부 펼침) */
    update(t) {
      this.t = t;
      for (const p of platforms) {
        if (!p.moving) continue;
        const ph = stepPhase(p.moving, t);
        p.state = ph.state; p.k = ph.k; p.w = ph.w || 0;
        p.r1 = p.r0 + (p.rFull - p.r0) * ph.k;
      }
    },
    /** 한 바퀴 안의 각도를, 높이 y에 가장 가까운 바퀴의 코스 각도로 편다(바퀴 사이는 55 stud 넘게 떨어져 있다) */
    unwrap(th, y) {
      let best = th, gap = Infinity;
      for (let t = th; t <= lane.th1; t += Math.PI * 2) {
        const d = Math.abs(lane.yAt(t) + C.lane.drop - y);
        if (d < gap) { gap = d; best = t; }
      }
      return best;
    },
    /** (th, r) 바로 아래에서 가장 높은 발판 윗면. 그림자·AI용 */
    groundBelow(th, r, y, margin = 0) {
      let best = null;
      for (const p of platforms) {
        if (p.k < 0.04 || p.top > y + 0.05) continue;
        const m = margin / r;
        if (th < p.th0 - m || th > p.th1 + m || r < p.r0 - 2 || r > p.r1 + margin) continue;
        if (!best || p.top > best.top) best = p;
      }
      return best;
    },
  };
}
