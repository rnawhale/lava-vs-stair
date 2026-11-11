// 플레이 검증 공통: 설치된 Chrome(GPU 사용)으로 게임을 열고 실제 키보드·마우스 입력을 보낸다.
import { chromium } from 'playwright';

export const BASE = process.env.LVS_URL || 'http://localhost:8787';

export async function open({ width = 1280, height = 720, query = '', video = null, touch = false, storage = null } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const ctx = await browser.newContext({
    viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1,
    recordVideo: video ? { dir: video, size: { width, height } } : undefined,
    storageState: storage || undefined,
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push('[error] ' + m.text()); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto(`${BASE}/${query ? '?' + query : ''}`);
  await page.waitForFunction(() => window.__lvs && window.__lvs.sim);
  return { browser, ctx, page, logs };
}

/** 게임 상태 요약(검증용 읽기 전용) */
export const state = (page) => page.evaluate(() => {
  const g = window.__lvs, s = g.sim, me = g.me;
  return {
    phase: s.phase, leg: s.leg, t: +s.phaseT.toFixed(2), clock: +s.clock.toFixed(2), coins: g.save.coins,
    me: me && { role: me.role, alive: me.alive, stage: me.stageDone, finished: me.finished, th: +me.body.th.toFixed(3), r: +me.body.r.toFixed(2), y: +me.body.y.toFixed(2),
      ground: me.body.ground ? (me.body.ground.kind === 'pad' ? 'pad' + me.body.ground.padIndex : me.body.ground.kind === 'step' ? `S${me.body.ground.stage}-${me.body.ground.index}` : 'lane') : null,
      falls: me.falls, hits: me.hits, shots: me.shotsFired, points: me.points, gun: me.gun.id + me.gun.level },
    scores: [s.score(0), s.score(1)], panel: g.ui.panel?.name || null,
    save: JSON.parse(JSON.stringify(g.save)),
  };
});

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 요소 가운데를 실제 마우스로 클릭(애니메이션 중인 버튼도 사람처럼 누른다) */
export async function click(page, selector, opts = {}) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error('보이지 않는 요소: ' + selector);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, opts);
}
