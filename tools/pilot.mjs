// 가상 플레이어: 게임에 "지금 무엇을 해야 하나"만 묻고, 조작은 실제 키보드·마우스 이벤트로 보낸다.
// (입력 → 물리 → 화면까지 사람이 누르는 것과 같은 경로를 탄다)
import { sleep } from './lib.mjs';

export async function pilot(page, { until, maxMs = 180000, level = 5, onTick } = {}) {
  const held = new Set();
  const set = async (key, on) => {
    if (on && !held.has(key)) { held.add(key); await page.keyboard.down(key); }
    else if (!on && held.has(key)) { held.delete(key); await page.keyboard.up(key); }
  };
  let mouseDown = false;
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < maxMs) {
      const r = await page.evaluate((lv) => {
        const g = window.__lvs, s = g.sim;
        return { a: g.advise(lv), phase: s.phase, leg: s.leg, stage: g.me?.stageDone, finished: g.me?.finished, alive: g.me?.alive, panel: g.ui.panel?.name || null, coins: g.save.coins };
      }, level);
      if (onTick) await onTick(r);
      if (until && (await until(r))) break;
      const a = r.a;
      if (a?.role === 'climb') {
        await set('KeyD', a.fwd > 0.3); await set('KeyA', a.fwd < -0.3);
        await set('KeyW', a.out < -0.3); await set('KeyS', a.out > 0.3);
        if (a.jump) { await set('Space', false); await set('Space', true); }
        else if (!a.hold) await set('Space', false);
        if (mouseDown) { await page.mouse.up(); mouseDown = false; }
      } else if (a?.role === 'shoot') {
        await set('KeyD', a.fwd > 0.3); await set('KeyA', a.fwd < -0.3);
        await set('Space', false);
        if (a.x !== undefined) await page.mouse.move(a.x, a.y);
        if (a.fire && !mouseDown) { await page.mouse.down(); mouseDown = true; }
        if (!a.fire && mouseDown) { await page.mouse.up(); mouseDown = false; }
      } else {
        for (const k of [...held]) await set(k, false);
      }
      await sleep(12);
    }
  } finally {
    for (const k of [...held]) await page.keyboard.up(k);
    if (mouseDown) await page.mouse.up();
  }
}
