// 온라인 검증: 친구 목록·방 목록·게임 안 초대·링크 입장 뒤 실제 입력으로 한 경기를 끝까지 한다.
//   node tools/onlinetest.mjs      (서버가 떠 있어야 한다: node server.js)
import { mkdirSync } from 'node:fs';
import { open, sleep, click } from './lib.mjs';
import { pilot } from './pilot.mjs';

const OUT = 'out/online';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const info = (page) => page.evaluate(() => {
  const g = window.__lvs, s = g.sim, me = g.me;
  return {
    phase: s.phase, leg: s.leg, pt: s.phaseT, clock: s.clock, host: g.online.isHost, id: g.online.id, inMatch: g.online.inMatch, panel: g.ui.panel?.name || null,
    me: me && { id: me.id, role: me.role, team: me.p.team, th: me.body.th, r: me.body.r, y: me.body.y, alive: me.alive, points: me.points, hits: me.hits, falls: me.falls, shots: me.shotsFired },
    actors: s.actors.map((a) => ({ id: a.id, kind: a.p.kind, team: a.p.team, auth: a.auth, role: a.role, th: a.body.th, y: a.body.y, alive: a.alive, points: a.points, hits: a.hits, falls: a.falls, stage: a.stageDone })),
    scores: [s.score(0), s.score(1)], coins: g.save.coins,
    stair: s.course.platforms.filter((p) => p.moving).map((p) => +p.k.toFixed(2)).join(','),
  };
});

// 1) 링크 없이 친구 만나기 입장 → 실시간 이름·방 목록
const A = await open();
await click(A.page, '.online'); await sleep(300);
await A.page.fill('.nick', '테스트방장');
await click(A.page, '.join');
await A.page.waitForSelector('.sheet.hall', { timeout: 100000 });
const B = await open();
await click(B.page, '.online'); await sleep(300);
await B.page.fill('.nick', '테스트친구');
await click(B.page, '.join');
await B.page.waitForSelector('.sheet.hall', { timeout: 100000 });
await A.page.waitForFunction(() => [...document.querySelectorAll('.person b')].some((e) => e.textContent === '테스트친구'));
check('링크 없이 입장 → 서로의 이름이 친구 목록에 나타남', (await B.page.locator('.people-list').innerText()).includes('테스트방장'));
const guestId = await B.page.evaluate(() => window.__lvs.online.net.visitorId);
await A.page.fill('.room-title', '친구 모여라! 용암탑');
await click(A.page, '.create');
await A.page.waitForSelector('.sheet.lobby', { timeout: 8000 });
let code = await A.page.evaluate(() => window.__lvs.online.net.room);
await B.page.waitForSelector(`.room-card[data-room="${code}"]`);
check('정한 방 제목과 인원이 친구의 방 목록에 나타남', (await B.page.locator(`.room-card[data-room="${code}"]`).innerText()).includes('친구 모여라! 용암탑'));
await B.page.screenshot({ path: `${OUT}/00-room-list.png` });
await B.page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
check('휴대폰 너비에서 방·친구 목록이 가로로 넘치지 않음', await B.page.evaluate(() => { const s = document.querySelector('.sheet'); return s.scrollWidth <= s.clientWidth + 1; }));
await B.page.screenshot({ path: `${OUT}/00-room-list-mobile.png` });
await B.page.setViewportSize({ width: 1280, height: 720 }); await sleep(300);
await B.page.locator(`.room-card[data-room="${code}"]`).scrollIntoViewIfNeeded();
await click(B.page, `.room-card[data-room="${code}"]`);
await B.page.waitForSelector('.sheet.lobby');
check('방 제목을 눌러 바로 입장', await B.page.evaluate((code) => window.__lvs.online.net.room === code, code));
await click(B.page, '.sheet.lobby .x');
await B.page.waitForSelector('.sheet.hall');
check('방에서 나가면 친구 만나기로 복귀', await B.page.evaluate(() => window.__lvs.online.connected && !window.__lvs.online.active));
await click(A.page, '.sheet.lobby .x');
await A.page.waitForSelector('.sheet.hall');
await B.page.waitForSelector(`.room-card[data-room="${code}"]`, { state: 'detached' });
check('마지막 사람이 나간 방은 목록에서 사라짐', true);

// 2) 친구 이름 옆에서 초대: 방 자동 생성, 만료·거절·수락
await A.page.locator(`[data-invite="${guestId}"]`).scrollIntoViewIfNeeded();
await click(A.page, `[data-invite="${guestId}"]`);
await A.page.waitForSelector('.sheet.lobby');
await B.page.waitForSelector('.invite-offer:not([hidden])');
check('친구 목록에서 초대 → 방 생성과 상대의 초대 알림', (await B.page.locator('.invite-offer').innerText()).includes('테스트방장'));
await click(A.page, '.sheet.lobby .x');
await B.page.waitForSelector('.invite-offer', { state: 'hidden' });
check('초대한 사람이 방을 닫으면 오래된 초대가 사라짐', true);
await sleep(3100);
await A.page.locator(`[data-invite="${guestId}"]`).scrollIntoViewIfNeeded();
await click(A.page, `[data-invite="${guestId}"]`);
await B.page.waitForSelector('.invite-offer:not([hidden])');
await click(B.page, '.decline-invite');
check('초대를 거절하고 방 목록에 머물 수 있음', (await info(B.page)).panel === 'hall' && !await B.page.locator('.invite-offer').isVisible());
await sleep(3100);
await A.page.locator(`[data-invite="${guestId}"]`).scrollIntoViewIfNeeded();
await click(A.page, `[data-invite="${guestId}"]`);
await B.page.waitForSelector('.invite-offer:not([hidden])');
await B.page.screenshot({ path: `${OUT}/00-invitation.png` });
await click(B.page, '.accept-invite');
await B.page.waitForSelector('.sheet.lobby');
check('초대의 같이 하기 버튼으로 같은 방에 입장', await B.page.evaluate(() => window.__lvs.online.net.room) === await A.page.evaluate(() => window.__lvs.online.net.room));
const link = await A.page.inputValue('.link');
check('밖에 있는 친구를 위한 초대 링크도 유지', /\?room=[A-Z0-9]{5}$/.test(link), link);
const C = await open({ query: link.split('?')[1] });
await C.page.waitForSelector('.sheet.online');
await C.page.fill('.nick', '링크친구'); await click(C.page, '.join');
await C.page.waitForSelector('.sheet.lobby', { timeout: 100000 });
check('기존 초대 링크에서도 입장 가능', await C.page.evaluate(() => window.__lvs.online.active));
await click(C.page, '.sheet.lobby .x');
await C.page.waitForSelector('.sheet.hall');
await sleep(500);
const slots = async () => { const [x, y] = await Promise.all([A.page.locator('.slot').allInnerTexts(), B.page.locator('.slot').allInnerTexts()]); return [x, JSON.stringify(x).replace(/ · 나/g, '') === JSON.stringify(y).replace(/ · 나/g, '')]; };
const humanTeams = (page) => page.evaluate(() => window.__lvs.online.roster().filter((p) => p.kind === 'human').map((p) => p.team).join(''));
let [slotsA, same] = await slots();
check('두 화면의 대기실 명단이 같다(사람 2 + AI 4, 3대3)', slotsA.length === 6 && same, slotsA.join(' / ').replace(/\n/g, ' '));
check('손님 화면에는 시작 버튼 대신 대기 안내', (await B.page.locator('.start').count()) === 0 && (await B.page.locator('.wait').count()) === 1);
await B.page.screenshot({ path: `${OUT}/02-lobby-guest.png` });
await A.page.screenshot({ path: `${OUT}/01-lobby-host.png` });

// 2-1) 팀 고르기: 손님이 방장과 같은 팀으로 옮겼다가 돌아온다. 방장은 AI 난이도를 바꾼다
await click(B.page, '.pick');
await A.page.waitForFunction(() => window.__lvs.online.roster().filter((p) => p.kind === 'human').every((p) => p.team === 0));
await sleep(300);
[slotsA, same] = await slots();
check('손님이 민트 팀으로 옮기면 두 화면 모두 같은 팀(상대는 AI 셋)', (await humanTeams(A.page)) === '00' && (await humanTeams(B.page)) === '00' && same
  && await A.page.evaluate(() => window.__lvs.online.roster().filter((p) => p.team === 1).every((p) => p.kind === 'bot')), slotsA.join(' / ').replace(/\n/g, ' '));
await B.page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
check('휴대폰 너비에서 팀 고르기 대기실이 가로로 넘치지 않음', await B.page.evaluate(() => { const s = document.querySelector('.sheet'); return s.scrollWidth <= s.clientWidth + 1; }));
await B.page.screenshot({ path: `${OUT}/02-lobby-same-team-mobile.png` });
await B.page.setViewportSize({ width: 1280, height: 720 }); await sleep(300);
await A.page.screenshot({ path: `${OUT}/01-lobby-same-team-host.png` });
await B.page.locator('.pick').scrollIntoViewIfNeeded();
await click(B.page, '.pick');
await A.page.waitForFunction(() => window.__lvs.online.roster().filter((p) => p.kind === 'human').map((p) => p.team).join('') === '01');
await sleep(300);
check('다시 핑크 팀으로 옮기면 서로 다른 팀', (await humanTeams(B.page)) === '01' && (await slots())[1]);
check('손님 화면에는 AI 난이도 버튼이 없음(방장만 변경)', (await B.page.locator('.ai-pick').count()) === 0);
const ai0 = await A.page.evaluate(() => window.__lvs.online.aiLevel);
await A.page.locator('.ai-pick').scrollIntoViewIfNeeded();
await click(A.page, '.ai-pick');
await B.page.waitForFunction((v) => window.__lvs.online.aiLevel === v, ai0 % 5 + 1);
check('방장이 AI 난이도를 바꾸면 손님 화면에도 반영', await A.page.evaluate(() => window.__lvs.online.aiLevel) === ai0 % 5 + 1 && (await slots())[1]);
await A.page.locator('.start').scrollIntoViewIfNeeded();

// 3) 방장이 시작 → 두 화면 모두 경기 진입
await click(A.page, '.start');
await sleep(1200);
let a = await info(A.page), b = await info(B.page);
check('양쪽 모두 경기 시작', a.inMatch && b.inMatch && a.phase === 'countdown' && b.phase === 'countdown', `${a.phase}/${b.phase}`);
check('사람은 서로 다른 팀, 캐릭터 6명(3대3)', a.me.team !== b.me.team && a.actors.length === 6 && b.actors.length === 6);
check('권한: 방장=본인+AI 4, 손님=본인만', a.actors.filter((x) => x.auth).length === 5 && b.actors.filter((x) => x.auth).length === 1);
await click(A.page, '.ready'); await click(B.page, '.ready');
code = await A.page.evaluate(() => window.__lvs.online.net.room);
await C.page.waitForFunction((code) => document.querySelector(`.room-card[data-room="${code}"]`)?.disabled, code);
check('경기가 시작되면 다른 친구의 방 목록에 게임 중·입장 제한 표시', (await C.page.locator(`.room-card[data-room="${code}"]`).innerText()).includes('게임 중'));
await click(C.page, '.sheet.hall .x');
await A.page.waitForFunction(() => !window.__lvs.online.directory.people.some(p => p.name === '링크친구'));
check('친구 만나기를 닫으면 접속한 친구 목록에서 사라짐', true);
await C.browser.close();

// 4) 두 사람이 동시에 실제 입력으로 플레이
let maxPosErr = 0, maxClockErr = 0, stairMismatch = 0, samples = 0, shotA = false;
const sample = async () => {
  const [x, y] = await Promise.all([info(A.page), info(B.page)]);
  if (x.phase !== 'leg' || y.phase !== 'leg') return;
  samples++;
  maxClockErr = Math.max(maxClockErr, Math.abs(x.clock - y.clock));
  // 두 화면을 읽는 시점이 수 ms 다르므로 움직이는 중인 계단은 조금 다를 수 있다 → 수치로 비교
  const ka = x.stair.split(',').map(Number), kb = y.stair.split(',').map(Number);
  if (ka.some((k, i) => Math.abs(k - kb[i]) > 0.2)) stairMismatch++;
  // A가 보는 B의 위치 vs B 자신의 위치 (호 길이 기준)
  const bInA = x.actors.find((q) => q.id === y.me.id);
  if (bInA.alive && y.me.alive) maxPosErr = Math.max(maxPosErr, Math.abs(bInA.th - y.me.th) * 68.5);
};
let n = 0;
const until = async (r) => { if (++n % 40 === 0) await sample(); return r.phase === 'results'; };
const snapAt = { 300: 'leg', 2500: 'leg-b' };
await Promise.all([
  pilot(A.page, { maxMs: 450000, until: async (r) => {
    if (snapAt[n]) { const k = snapAt[n]; delete snapAt[n]; await A.page.screenshot({ path: `${OUT}/03-${k}-host.png` }); await B.page.screenshot({ path: `${OUT}/03-${k}-guest.png` }); }
    if (r.phase === 'switch' && !shotA) { shotA = true; await sleep(300); await A.page.screenshot({ path: `${OUT}/04-switch-host.png` }); await click(A.page, '.ready').catch(() => {}); }
    return until(r);
  } }),
  (async () => { let sw = false; await pilot(B.page, { maxMs: 450000, until: async (r) => { if (r.phase === 'switch' && !sw) { sw = true; await sleep(500); await click(B.page, '.ready').catch(() => {}); } return r.phase === 'results'; } }); })(),
]);
await sleep(1500);
a = await info(A.page); b = await info(B.page);
check('경기 중 계단 시계 일치(차이 0.15초 이내)', maxClockErr < 0.15, `최대 ${maxClockErr.toFixed(3)}s, 표본 ${samples}`);
check('움직이는 계단 상태가 두 화면에서 같음', stairMismatch <= samples * 0.02, `불일치 ${stairMismatch}/${samples}`);
check('상대 캐릭터 위치 복제(오차 6 stud 이내)', maxPosErr < 6, `최대 ${maxPosErr.toFixed(2)} stud`);
check('양쪽 모두 결과 화면', a.phase === 'results' && b.phase === 'results' && a.panel === 'results' && b.panel === 'results', `${a.phase}/${b.phase} ${a.panel}/${b.panel}`);
check('두 화면의 최종 점수가 같다', JSON.stringify(a.scores) === JSON.stringify(b.scores), `${a.scores} vs ${b.scores}`);
const pts = (i) => JSON.stringify(i.actors.map((q) => [q.id, q.points]));
check('선수별 점수가 같다', pts(a) === pts(b), pts(a));
check('물총 명중이 양쪽에 반영', a.me.hits + b.me.hits > 0 && JSON.stringify(a.actors.map((q) => q.hits)) === JSON.stringify(b.actors.map((q) => q.hits)), `A ${a.me.hits}/${a.me.shots}발, B ${b.me.hits}/${b.me.shots}발`);
check('각자 자기 지갑에 Coins 적립', a.coins > 0 && b.coins > 0, `A ${a.coins}, B ${b.coins}`);
await A.page.screenshot({ path: `${OUT}/05-results-host.png` }); await B.page.screenshot({ path: `${OUT}/05-results-guest.png` });

// 5) 다음 경기: 대기실로 돌아가 다시 시작
await click(A.page, '.again'); await sleep(400);
check('결과 → 대기실 복귀', (await info(A.page)).panel === 'lobby');
await click(A.page, '.start'); await sleep(1500);
a = await info(A.page); b = await info(B.page);
check('두 번째 경기 시작(먼저 등반하는 팀 교대)', a.phase === 'countdown' && b.phase === 'countdown' && a.inMatch && b.inMatch, `${a.me.role}/${b.me.role}`);

// 6) 방장이 나가면 손님이 방장을 이어받고 경기는 계속된다
await A.browser.close();
await sleep(1500);
b = await info(B.page);
check('방장 이탈 → 손님이 방장 승계, 모든 캐릭터 인수', b.host && b.actors.every((q) => q.auth), `host=${b.host} auth=${b.actors.filter((q) => q.auth).length}/6`);
const pt0 = b.pt; await sleep(1200);
check('승계 뒤에도 경기 진행', (await info(B.page)).pt !== pt0);

const bad = [...A.logs, ...B.logs, ...C.logs].filter((l) => !l.includes('404') && !l.includes('WebSocket'));
check('콘솔 오류 없음', bad.length === 0, bad.slice(0, 3).join(' | '));
await B.browser.close();
const fail = results.filter((r) => !r).length;
console.log(`\n${results.length - fail}/${results.length} 통과`);
process.exit(fail ? 1 : 0);
