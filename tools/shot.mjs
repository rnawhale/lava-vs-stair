// 개발용 스크린샷: node tools/shot.mjs <출력.png> [쿼리] [대기ms] [가로x세로]
//   실행 중인 서버(기본 http://localhost:8787)를 설치된 Chrome으로 열어 캡처한다.
import { chromium } from 'playwright';

const [out = 'out/shot.png', query = '', wait = '2500', size = '1280x720'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const base = process.env.LVS_URL || 'http://localhost:8787';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
await page.goto(`${base}/${query ? '?' + query : ''}`);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
const info = await page.evaluate(() => {
  const g = window.__lvs;
  if (!g) return null;
  const gl = document.getElementById('game').getContext('webgl2');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return { phase: g.sim?.phase, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?' };
});
console.log(JSON.stringify(info), logs.slice(0, 12).join('\n'));
await browser.close();
