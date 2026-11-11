// 플레이 영상 녹화: 가상 플레이어가 실제 키보드·마우스로 한 경기를 한다.
//   node tools/record.mjs [가상 플레이어 실력 1..5=3]   → out/video/match.webm
import { mkdirSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { open, sleep, click, state } from './lib.mjs';
import { pilot } from './pilot.mjs';

const level = +process.argv[2] || 3;
const DIR = 'out/video';
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const { browser, ctx, page } = await open({ video: DIR });
await sleep(2500);
await click(page, '.play'); await sleep(2200);
await click(page, '.ready');
const marks = [];
const t0 = Date.now();
let last = '';
await pilot(page, { level, maxMs: 300000, until: async (r) => {
  if (r.phase !== last) { last = r.phase; marks.push([((Date.now() - t0) / 1000).toFixed(1), r.phase]); if (r.phase === 'switch') { await sleep(2500); await click(page, '.ready').catch(() => {}); } }
  return r.phase === 'results';
} });
await sleep(4000);
const s = await state(page);
console.log('marks', JSON.stringify(marks), 'me', JSON.stringify(s.me), 'scores', s.scores);
await ctx.close(); await browser.close();
const f = readdirSync(DIR).find((x) => x.endsWith('.webm'));
renameSync(`${DIR}/${f}`, `${DIR}/match.webm`);
console.log('saved', `${DIR}/match.webm`);
