// 전체 흐름 검증(실제 Chrome + 실제 키보드·마우스 이벤트):
//   시작 → 세 단계 등반 → 추락과 복귀 → 물총 방해 → 역할 교대 → 보상 → 구매·강화·장착 → 새로고침 후 복구
//   + 화면 크기 변경, 상점 열기/닫기, 재시작, 연속 클릭
//   node tools/playtest.mjs [--video]     (서버가 떠 있어야 한다: node server.js)
import { mkdirSync } from 'node:fs';
import { open, state, sleep, click } from './lib.mjs';
import { pilot } from './pilot.mjs';

const OUT = 'out/playtest';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const { browser, ctx, page, logs } = await open({ video: process.argv.includes('--video') ? OUT : null });
const snap = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const speed = (v) => page.evaluate((x) => { window.__lvs.speed = x; }, v);

// 1) 시작: 로그인 없이 "바로 플레이"
await snap('01-title');
check('타이틀에 바로 플레이 버튼', await page.locator('.play').isVisible());
await click(page, '.play'); await sleep(700);
let s = await state(page);
check('버튼 한 번으로 경기 시작(카운트다운)', s.phase === 'countdown' && s.me.role === 'climb', `phase=${s.phase} role=${s.me?.role}`);
// 카운트다운 중에도 움직이고 점프할 수 있다
const th0 = s.me.th;
await page.keyboard.down('KeyD'); await sleep(250); await page.keyboard.up('KeyD');
await page.keyboard.press('Space'); await sleep(120);
s = await state(page);
check('설명을 읽기 전에 이동·점프 가능', s.me.th > th0 + 0.01 && s.me.y > 10.2, `dth=${(s.me.th - th0).toFixed(3)} y=${s.me.y}`);
await snap('02-countdown');
await click(page, '.ready');

// 2) S1 통과 → 일부러 추락 → S2 시작점 복귀
await pilot(page, { maxMs: 60000, until: (r) => r.stage >= 1 });
s = await state(page);
check('S1 완료 → 10 Coins, 1점', s.me.stage === 1 && s.coins === 10 && s.me.points === 1, `stage=${s.me.stage} coins=${s.coins}`);
await snap('03-s1-clear');
await pilot(page, { maxMs: 30000, until: async () => /^S2-/.test((await state(page)).me.ground || '') });
await page.keyboard.down('KeyS'); await sleep(900); await page.keyboard.up('KeyS');   // 바깥으로 걸어 나가 추락
await sleep(700); await snap('04-fall');
s = await state(page);
check('추락 처리(용암)', s.me.alive === false || s.me.falls >= 1, `alive=${s.me.alive} falls=${s.me.falls}`);
const t1 = Date.now();
while ((await state(page)).me.alive === false && Date.now() - t1 < 6000) await sleep(30);
s = await state(page);
check('약 2초 뒤 현재 단계 시작점(S2 체크포인트)에서 복귀', s.me.alive && s.me.ground === 'pad1' && Date.now() - t1 < 3200, `ground=${s.me.ground} ${(Date.now() - t1)}ms`);
check('추락해도 완료 단계·Coins 유지', s.me.stage === 1 && s.coins === 10);

// 3) 끝까지 등반
await speed(2);
await pilot(page, { maxMs: 90000, until: (r) => r.finished || r.phase !== 'leg' });
s = await state(page);
check('세 단계 완주(S1→S2→S3)', s.me.finished && s.me.points === 6, `stage=${s.me.stage} points=${s.me.points}`);
check('완주 보상 합계 60 Coins(10/20/30, 중복 없음)', s.coins === 60, `coins=${s.coins}`);
await snap('05-finish');
// 완주 뒤 발판을 다시 밟아도 더 받지 않는다
await page.keyboard.down('KeyA'); await sleep(200); await page.keyboard.up('KeyA'); await page.keyboard.press('Space'); await sleep(600);
check('다시 밟아도 중복 보상 없음', (await state(page)).coins === 60);

// 4) 역할 교대
const t2 = Date.now();
while ((await state(page)).phase === 'leg' && Date.now() - t2 < 120000) await sleep(100);
await speed(1); await sleep(600);
s = await state(page);
check('역할 교대: 방해 차례로 전환', s.phase === 'switch' && s.me.role === 'shoot' && s.leg === 1, `phase=${s.phase} role=${s.me.role}`);
await snap('06-switch');

// 5) 교대 중 상점: 열기/닫기, 구매, 연속 클릭
await click(page, '.inter .shop-open'); await sleep(350);
s = await state(page);
check('교대 화면에서 상점 열림', s.panel === 'shop');
await snap('07-shop');
const paused0 = (await state(page)).t;
await sleep(700);
check('상점을 보는 동안 솔로 경기는 멈춤', Math.abs((await state(page)).t - paused0) < 0.05);
// rapid 구매 버튼을 빠르게 3번 누른다 → 한 번만 결제
const buyBtn = await page.locator('.gun.rapid button.buy').boundingBox();
for (let i = 0; i < 3; i++) await page.mouse.click(buyBtn.x + buyBtn.width / 2, buyBtn.y + buyBtn.height / 2);
await sleep(600);
s = await state(page);
check('연속 클릭해도 한 번만 결제(60 → 0)', s.coins === 0 && s.save.owned.rapid === true && s.save.levels.rapid === 0, `coins=${s.coins} lv=${s.save.levels.rapid}`);
check('구매한 총 자동 장착', s.save.equipped === 'rapid');
await snap('08-bought');
await click(page, '.sheet .x'); await sleep(300);
s = await state(page);
check('상점 닫기', s.panel === null);
check('차례 시작 전 장착 → 이번 방해 차례 총이 rapid', s.me.gun === 'rapid0', s.me.gun);
await click(page, '.ready');

// 6) 물총 방해
await speed(2);
await pilot(page, { maxMs: 90000, until: (r) => r.phase === 'results' });
await speed(1); await sleep(900);
s = await state(page);
check('방해 차례: 실제 마우스 조준·발사로 명중', s.me.shots > 5 && s.me.hits > 0, `shots=${s.me.shots} hits=${s.me.hits}`);
check('차례 중 장비 고정(rapid Lv.0 유지)', s.me.gun === 'rapid0');
check('경기 종료 → 결과 화면', s.phase === 'results' && s.panel === 'results', `phase=${s.phase} panel=${s.panel}`);
await snap('09-results');

// 7) 화면 크기 변경: 작은 화면에서도 결과·상점 버튼이 보인다
await page.setViewportSize({ width: 640, height: 360 }); await sleep(500);
await snap('10-small-results');
const inView = async (sel) => { const b = await page.locator(sel).first().boundingBox(); const v = page.viewportSize(); return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= v.width + 1 && b.y + b.height <= v.height + 1; };
await page.locator('.again').scrollIntoViewIfNeeded();
check('작은 화면(640×360)에서 "한 판 더" 버튼 접근 가능', await inView('.again'));
await click(page, '.sheet .shop-open'); await sleep(350);
check('작은 화면에서 상점 닫기 버튼이 가려지지 않음', await inView('.sheet .x'));
await snap('11-small-shop');
await click(page, '.sheet .x'); await sleep(300);
check('상점을 닫으면 결과 화면으로 돌아옴', (await state(page)).panel === 'results');
await page.setViewportSize({ width: 390, height: 780 }); await sleep(500);
await snap('12-portrait-results');
await page.locator('.again').scrollIntoViewIfNeeded();
check('세로 화면(390×780)에서도 "한 판 더" 접근 가능', await inView('.again'));
await page.setViewportSize({ width: 1280, height: 720 }); await sleep(400);

// 8) 다음 경기 → 일시정지·재시작
await click(page, '.again'); await sleep(700);
s = await state(page);
check('한 판 더 → 새 경기 카운트다운', s.phase === 'countdown' && s.panel === null);
await page.keyboard.press('Escape'); await sleep(300);
s = await state(page);
const tp = s.t;
check('Esc 일시정지 화면', s.panel === 'pause');
await sleep(600);
check('일시정지 동안 시간 정지', Math.abs((await state(page)).t - tp) < 0.05);
await snap('13-pause');
await click(page, '.sheet .restart'); await sleep(600);
s = await state(page);
check('재시작 → 새 카운트다운, Coins 유지', s.phase === 'countdown' && s.panel === null && s.coins === 0);

// 9) 두 번째 경기로 Coins를 모아 강화 (이번에는 먼저 방해)
check('경기마다 먼저 등반하는 팀 교대', s.me.role === 'shoot', s.me.role);
await click(page, '.ready');
await speed(2);
await pilot(page, { maxMs: 150000, until: (r) => r.phase === 'switch' });
await speed(1); await sleep(500); await click(page, '.ready'); await speed(2);
await pilot(page, { maxMs: 150000, until: (r) => r.phase === 'results' });
await speed(1); await sleep(900);
s = await state(page);
check('두 번째 경기 등반 보상 적립', s.coins >= 30, `coins=${s.coins}`);
const coinsBefore = s.coins;
await click(page, '.sheet .shop-open'); await sleep(350);
const up = await page.locator('.gun.rapid button.up').boundingBox();
for (let i = 0; i < 4; i++) await page.mouse.click(up.x + up.width / 2, up.y + up.height / 2);
await sleep(700);
s = await state(page);
check('강화 연타 → Lv.1 한 단계만, 30 Coins만 차감', s.save.levels.rapid === 1 && s.coins === coinsBefore - 30, `lv=${s.save.levels.rapid} coins=${s.coins}`);
const txt = await page.locator('.gun.rapid').innerText();
check('상점에 현재 레벨·간격 표시(0.4275s)', /Lv\.1/.test(txt) && /0\.4275s/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 90));
await snap('14-upgraded');
// 장착 변경
await click(page, '.gun.basic button.equip'); await sleep(600);
check('basic 장착', (await state(page)).save.equipped === 'basic');
await click(page, '.gun.rapid button.equip'); await sleep(600);
check('rapid 다시 장착', (await state(page)).save.equipped === 'rapid');
const before = (await state(page)).save;

// 10) 새로고침 후 복구
await page.reload();
await page.waitForFunction(() => window.__lvs && window.__lvs.sim);
await sleep(500);
s = await state(page);
const same = s.save.coins === before.coins && s.save.equipped === 'rapid' && s.save.owned.rapid && s.save.levels.rapid === 1 && s.save.stats.matches === before.stats.matches;
check('새로고침 후 Coins·소유·강화·장착 복구', same, `coins=${s.save.coins} eq=${s.save.equipped} lv=${s.save.levels.rapid}`);
await click(page, '.title .shop-open'); await sleep(350);
await snap('15-reload-shop');
check('타이틀(대기)에서 상점 이용 가능', (await state(page)).panel === 'shop');
await click(page, '.sheet .x');

const bad = logs.filter((l) => !l.includes('404'));
check('콘솔 오류 없음', bad.length === 0, bad.slice(0, 3).join(' | '));
await ctx.close(); await browser.close();
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail}/${results.length} 통과`);
process.exit(fail ? 1 : 0);
