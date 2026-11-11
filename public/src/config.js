// Lava VS Stair — 모든 조정값은 이 파일 한곳에 둔다.
// 길이 단위는 기존 Roblox 빌드의 stud를 그대로 쓴다(캐릭터 키 약 5, 걷기 16/s).
// 그래서 사거리 60/45/60, 밀치기 15/8/24 같은 기준값이 환산 없이 1:1로 적용된다.

export const CFG = {
  // ── 월드 ────────────────────────────────────────────────
  towerRadius: 64,        // 탑 반지름
  stepRadial: 9.5,        // 계단이 벽 밖으로 나온 폭
  stepLength: 8,          // 진행 방향 길이
  stepThick: 1.5,
  padLength: 18,          // 출발·체크포인트·완주 발판
  padRadial: 13.5,
  padThick: 2.2,
  startY: 10,             // 출발 발판 윗면 높이
  lavaY: 0,
  // 바깥 사격 통로 (방해 팀 전용)
  lane: { radiusOffset: 24, width: 14, drop: 6, speed: 21, margin: 1.2 },

  // ── 코스: S1/S2/S3 = 6/8/10 계단 ─────────────────────────
  // ext=펼친 채 머무는 시간(끝 warn초는 예고), hid=숨김, trav=편도 이동, phase=첫 지연
  // 값은 Roblox 빌드에서 "8초 안에 반드시 착지 창이 생기는지" 검증된 주기를 그대로 쓴다.
  warnSeconds: 0.5,
  stages: [
    { steps: 6, run: 12, rise: 2, reward: 10, points: 1, moving: {
      2: { ext: 3.5, hid: 1, trav: 1, phase: 0 },
      4: { ext: 4, hid: 1, trav: 1.25, phase: 2 },
      6: { ext: 3, hid: 1, trav: 1.5, phase: 4 },
    } },
    { steps: 8, run: 13.2, rise: 2, reward: 20, points: 2, moving: {
      1: { ext: 5, hid: 1, trav: 0.7, phase: 0.4 },
      2: { ext: 5, hid: 1.1, trav: 0.7, phase: 0.4 },
      4: { ext: 5, hid: 1.2, trav: 0.7, phase: 0.8 },
      5: { ext: 5, hid: 1.3, trav: 0.7, phase: 0.8 },
      7: { ext: 5, hid: 1.4, trav: 0.7, phase: 1.2 },
      8: { ext: 5, hid: 1.5, trav: 0.7, phase: 1.2 },
    } },
    { steps: 10, run: 13.8, rise: 2, reward: 30, points: 3, moving: {
      1: { ext: 4.8, hid: 1, trav: 0.5, phase: 0.4 },
      2: { ext: 4.8, hid: 1, trav: 0.5, phase: 0.4 },
      3: { ext: 4.8, hid: 1, trav: 0.5, phase: 0.4 },
      5: { ext: 4.8, hid: 1.4, trav: 0.5, phase: 0.8 },
      6: { ext: 4.8, hid: 1.4, trav: 0.5, phase: 0.8 },
      8: { ext: 4.8, hid: 1.7, trav: 0.5, phase: 1.2 },
      9: { ext: 4.8, hid: 1.7, trav: 0.5, phase: 1.2 },
      10: { ext: 4.8, hid: 1.7, trav: 0.5, phase: 1.2 },
    } },
  ],

  // ── 캐릭터 조작감 ────────────────────────────────────────
  move: {
    speed: 16,
    jumpVel: 50,
    gravity: 196.2,
    jumpCutGravity: 2.4,   // 점프 키를 일찍 떼면 상승 중 중력 배율 → 낮은 점프
    terminal: 150,
    groundAccel: 240,      // 0→최고속 약 0.07초
    airAccel: 130,
    coyote: 0.1,           // 발판 끝을 벗어난 뒤 점프 유예
    jumpBuffer: 0.13,      // 착지 직전 점프 입력 예약
    halfWidth: 0.9,
    height: 4.6,
    edgeGrace: 0.45,       // 중심이 가장자리를 이만큼 벗어나도 서 있음
    ledgeAssist: 1.1,      // 발이 윗면보다 이만큼 낮게 닿아도 올려 준다
  },

  // ── 규칙 시간 ────────────────────────────────────────────
  respawnDelay: 2,
  respawnProtect: 2,
  hitImmunity: 0.75,
  knockDuration: 0.3,      // 밀치기 동안 조작 불가(비틀거림)
  time: { countdown: 5, leg: 120, switch: 10 },

  // ── 물총 ────────────────────────────────────────────────
  // range/interval/knock는 기준값. speed·radius는 웹에서 새로 정한 탄속·판정 크기.
  guns: {
    basic: { name: '기본 물총', price: 0, range: 60, interval: 0.9, knock: 15, speed: 105, radius: 0.85, color: 0x3fa9ff },
    rapid: { name: '속사 쌍물총', price: 60, range: 45, interval: 0.45, knock: 8, speed: 125, radius: 0.6, color: 0x4fe07a },
    heavy: { name: '대왕 물대포', price: 120, range: 60, interval: 1.6, knock: 24, speed: 88, radius: 1.35, color: 0xff9a3c },
  },
  gunOrder: ['basic', 'rapid', 'heavy'],
  // 강화: 기본 간격의 95% / 90% (누적 곱 아님). 사거리·밀치기는 그대로.
  upgrades: [null, { cost: 30, intervalMul: 0.95 }, { cost: 60, intervalMul: 0.9 }],
  waterGravity: 32,        // 물줄기 포물선
  hitRadius: 1.25,         // 캐릭터 피격 반지름
  nearMiss: 3.2,           // 이 거리 안으로 스치면 "아슬아슬"

  // ── AI ──────────────────────────────────────────────────
  // level 1..5. 사람이 이기면 +1, 지면 -1 (저장됨)
  ai: {
    // think/react: 발판에서 뜸 들이는 시간·창을 알아채는 시간, takeoffNoise: 도약 위치 오차, slip: 계단 시계를 잘못 읽을 확률,
    // dodge: 날아오는 물줄기를 보고 점프를 미룰 확률 / aimErr·windup·fireWait·lead: 사격 정확도·예고 시간·쉬는 시간·예측 정도
    levels: [
      { name: '순한맛', think: [2.2, 4.8], react: [0.6, 1.7], takeoffNoise: 1.45, slip: 0.5, dodge: 0, aimErr: 4.4, windup: 0.6, fireWait: [1.5, 3.0], lead: 0.6, guns: ['basic', 'basic'], lv: 0 },
      { name: '보통맛', think: [1.7, 3.8], react: [0.45, 1.3], takeoffNoise: 1.25, slip: 0.42, dodge: 0.2, aimErr: 3.3, windup: 0.5, fireWait: [1.0, 2.2], lead: 0.75, guns: ['basic', 'rapid'], lv: 0 },
      { name: '매콤한맛', think: [1.1, 2.6], react: [0.3, 0.9], takeoffNoise: 1.0, slip: 0.3, dodge: 0.45, aimErr: 2.4, windup: 0.45, fireWait: [0.6, 1.5], lead: 0.85, guns: ['rapid', 'basic'], lv: 1 },
      { name: '매운맛', think: [0.55, 1.4], react: [0.15, 0.5], takeoffNoise: 0.7, slip: 0.17, dodge: 0.7, aimErr: 1.7, windup: 0.4, fireWait: [0.35, 1.0], lead: 0.93, guns: ['heavy', 'rapid'], lv: 1 },
      { name: '불지옥맛', think: [0.15, 0.5], react: [0.05, 0.2], takeoffNoise: 0.35, slip: 0.05, dodge: 0.9, aimErr: 1.2, windup: 0.36, fireWait: [0.15, 0.6], lead: 1, guns: ['heavy', 'rapid'], lv: 2 },
    ],
    stagePressure: [0.4, 0.75, 1],   // S1은 살살, S3에서 본격 압박
  },

  // ── 팀 ──────────────────────────────────────────────────
  teams: [
    { name: '민트', color: 0x2fe0c2, css: '#2fe0c2' },
    { name: '핑크', color: 0xff5fa2, css: '#ff5fa2' },
  ],
  botNames: ['콩봇', '찍봇', '뿅봇', '덜렁봇', '삐약봇', '우당탕봇'],
  simHz: 120,
};

/** 차례 시작 때 고정하는 실제 발사 능력치. level은 0..2 */
export function gunStats(id, level = 0) {
  const base = CFG.guns[id];
  if (!base || !Number.isInteger(level) || level < 0 || level > 2) return null;
  const mul = level > 0 ? CFG.upgrades[level].intervalMul : 1;
  return { ...base, id, level, interval: +(base.interval * mul).toFixed(4) };
}
