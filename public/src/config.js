// Lava VS Stair — 모든 조정값은 이 파일 한곳에 둔다.
// 길이 단위는 기존 Roblox 빌드의 stud를 그대로 쓴다(캐릭터 키 약 5, 걷기 16/s).
// 그래서 사거리 60/45/60, 밀치기 15/8/24 같은 기준값이 환산 없이 1:1로 적용된다.

// null: 같은 주소의 서버(로컬·Render). GitHub Pages 배포 때 외부 서버 주소로 채운다.
export const ONLINE_SERVER = null;

/** 계단 from..to가 같은 주기로 gap초씩 늦게 움직인다. 주기가 같아서 간격이 어긋나지 않는다.
 *  gap이 한 계단 넘는 시간(약 0.87초)보다 짧으면 접힘이 뒤에서 쫓아오고, 0이면 동시에, 주기의 절반이면 번갈아 나온다. */
const wave = (from, to, m, gap) =>
  Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, { ...m, phase: +(m.phase + i * gap).toFixed(3) }]));

export const CFG = {
  online: { connectTimeoutMs: 90000, retryMs: 1500, inviteCooldownMs: 3000 },
  teamSize: 3,            // 한 팀 인원(3대3). 온라인 방 정원은 이 값의 두 배

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
  fallClear: 14,          // 두 바퀴째에서 떨어질 때: 아래 바퀴 계단보다 이만큼 위에서 추락 처리(아래층을 뚫고 지나가지 않게)
  // 바깥 사격 통로 (방해 팀 전용)
  lane: { radiusOffset: 24, width: 14, drop: 6, speed: 21, margin: 1.2 },

  // ── 코스: S1~S5 = 6/8/10/12/14 계단 ───────────────────────
  // ext=펼친 채 머무는 시간(끝 warn초는 예고), hid=숨김, trav=편도 이동, phase=첫 지연
  // S1~S3 값은 Roblox 빌드에서 "8초 안에 반드시 착지 창이 생기는지" 검증된 주기를 그대로 쓴다.
  // S4·S5는 웹에서 새로 만든 단계다. 코스가 탑을 한 바퀴 넘게 감아 S4 중간부터는 S1 위를 지난다.
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
    // S4 쫓아오는 파도: 가까운 계단부터 차례로 나오고 차례로 접힌다. 나오기 시작할 때 출발해 멈추지 않고 달린다.
    // tip: 그 단계에 처음 들어설 때 한 번 보여 주는 안내
    { steps: 12, run: 13.8, rise: 2, reward: 40, points: 4, tip: '🌊 <b>S4는 파도!</b> 가까운 계단이 <b>나오기 시작할 때</b> 바로 출발해 멈추지 말고 달려요. 접힘이 뒤에서 쫓아와요', moving: {
      ...wave(2, 5, { ext: 3.6, hid: 1.2, trav: 0.5, phase: 0.6 }, 0.5),
      ...wave(7, 10, { ext: 3.6, hid: 1.2, trav: 0.5, phase: 1.4 }, 0.5),
      12: { ext: 2.4, hid: 1, trav: 0.5, phase: 0.8 },
    } },
    // S5 불지옥 계단: 더 빠른 파도 → 번갈아 나오는 징검다리 → 넷이 한꺼번에 접히는 마지막 질주
    { steps: 14, run: 14, rise: 2, reward: 50, points: 5, tip: '🔥 <b>마지막 S5!</b> 번갈아 나오는 징검다리는 <b>다음 계단이 나오는 순간</b> 건너뛰고, 마지막 네 칸은 한꺼번에 접히니 쉬지 말고 달려요', moving: {
      ...wave(1, 4, { ext: 3.2, hid: 1.2, trav: 0.4, phase: 0.4 }, 0.4),
      ...wave(6, 9, { ext: 2.6, hid: 1.2, trav: 0.35, phase: 0.8 }, 2.25),
      ...wave(11, 14, { ext: 4.6, hid: 1.4, trav: 0.4, phase: 1.2 }, 0),
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
  knockFriction: 50,       // 땅에서 밀릴 때의 감속(stud/s²). 공중에서는 감속 없음
  time: { countdown: 5, leg: 180, switch: 10 },   // 다섯 단계라 한 차례를 180초로(세 단계일 때는 120초였다)

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
    stagePressure: [0.4, 0.75, 1, 1, 1],   // S1은 살살, S3부터 본격 압박
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
