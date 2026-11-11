// 터치 조작 검증(모바일 에뮬레이션): 스틱 이동·점프 버튼·화면 터치 조준/발사, 가로/세로 화면 배치
//   node tools/touchtest.mjs
import { mkdirSync } from 'node:fs';
import { open, state, sleep } from './lib.mjs';

const OUT = 'out/touch';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const { browser, page, logs } = await open({ width: 844, height: 390, touch: true });
const cdp = await page.context().newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id ?? 0, radiusX: 8, radiusY: 8, force: 1 })) });
const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const tap = async (sel) => { const c = await center(sel); await page.touchscreen.tap(c.x, c.y); };

await page.screenshot({ path: `${OUT}/01-title-landscape.png` });
await tap('.play'); await sleep(900);
let s = await state(page);
check('터치로 바로 플레이 시작', s.phase === 'countdown');
check('터치 조작 UI 표시(스틱·점프)', (await page.locator('.touch .stick').isVisible()) && (await page.locator('.touch .btn-jump').isVisible()));
await page.screenshot({ path: `${OUT}/02-climb-landscape.png` });

// 스틱을 오른쪽으로 → 앞으로 이동
const st = await center('.touch .stick');
const th0 = s.me.th;
await touch('touchStart', [{ ...st, id: 1 }]);
await touch('touchMove', [{ x: st.x + 50, y: st.y, id: 1 }]);
await sleep(350);
s = await state(page);
check('스틱 오른쪽 = 앞으로 이동', s.me.th > th0 + 0.02, `dth=${(s.me.th - th0).toFixed(3)}`);
// 스틱을 잡은 채 다른 손가락으로 점프(멀티 터치)
const jb = await center('.touch .btn-jump');
await touch('touchStart', [{ x: st.x + 50, y: st.y, id: 1 }, { ...jb, id: 2 }]);
await sleep(140);
s = await state(page);
check('스틱을 잡은 채 점프 버튼(멀티 터치)', s.me.y > 10.5, `y=${s.me.y}`);
await touch('touchEnd', []);
await sleep(300);
const th1 = (await state(page)).me.th; await sleep(200);
check('손을 떼면 멈춤', Math.abs((await state(page)).me.th - th1) < 0.01);

// 방해 차례로 넘어가 화면 터치 조준·발사
await page.evaluate(() => { const g = window.__lvs; g.sim.skipWait(); });
await sleep(3300);
await page.evaluate(() => { window.__lvs.sim.phaseT = 0.3; });      // 검증용: 첫 차례를 바로 끝낸다
await sleep(900);
s = await state(page);
check('교대 후 방해 역할', s.phase === 'switch' && s.me.role === 'shoot');
check('방해 차례에는 점프 버튼 대신 조준 안내', !(await page.locator('.touch .btn-jump').isVisible()) && (await page.locator('.touch .fire-tip').isVisible()));
await tap('.inter .ready'); await sleep(3400);
await page.screenshot({ path: `${OUT}/03-shoot-landscape.png` });
const shots0 = (await state(page)).me.shots;
await touch('touchStart', [{ x: 480, y: 170, id: 3 }]);
await sleep(1300);
await touch('touchMove', [{ x: 560, y: 150, id: 3 }]);
await sleep(700);
await page.screenshot({ path: `${OUT}/04-shoot-firing.png` });
await touch('touchEnd', []);
s = await state(page);
check('화면을 누르는 동안 조준·연사', s.me.shots - shots0 >= 2, `발사 ${s.me.shots - shots0}`);
const shots1 = s.me.shots; await sleep(1200);
check('손을 떼면 발사 중지', (await state(page)).me.shots === shots1);

// 세로 화면
await page.setViewportSize({ width: 390, height: 844 }); await sleep(600);
await page.screenshot({ path: `${OUT}/05-shoot-portrait.png` });
await tap('.pause'); await sleep(300);
check('세로 화면에서 일시정지 메뉴', (await state(page)).panel === 'pause');
await page.screenshot({ path: `${OUT}/06-pause-portrait.png` });
await tap('.sheet .quit'); await sleep(500);
await tap('.title .shop-open'); await sleep(400);
await page.screenshot({ path: `${OUT}/07-shop-portrait.png` });
const x = await page.locator('.sheet .x').boundingBox();
check('세로 화면 상점: 닫기 버튼이 화면 안', x && x.y >= 0 && x.x + x.width <= 390 && x.y + x.height <= 844);
await tap('.sheet .x'); await sleep(300);
await page.screenshot({ path: `${OUT}/08-title-portrait.png` });
const bad = logs.filter((l) => !l.includes('404'));
check('콘솔 오류 없음', bad.length === 0, bad.slice(0, 2).join(' | '));
await browser.close();
const fail = results.filter((r) => !r).length;
console.log(`\n${results.length - fail}/${results.length} 통과`);
process.exit(fail ? 1 : 0);
