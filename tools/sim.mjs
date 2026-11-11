// 봇끼리 고속으로 경기를 돌려 난이도·밸런스를 본다.
//   node tools/sim.mjs [경기 수=20] [--peace]   (--peace: 물총 없이 순수 등반 능력만)
import { Sim } from '../public/src/sim.js';
import { CFG } from '../public/src/config.js';
import { botLoadout } from '../public/src/ai.js';

const N = +process.argv[2] || 20;
if (process.argv.includes('--peace')) CFG.ai.stagePressure = [0, 0, 0];
const dt = 1 / CFG.simHz;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log('lv  avgPts  S1%  S2%  S3%  finishT  falls  shots  hit%  knockoff/leg  legT');
for (let lv = 1; lv <= 5; lv++) {
  const rows = [];
  const legT = [];
  for (let n = 0; n < N; n++) {
    const players = [0, 1, 2, 3].map(i => ({ id: 'b' + i, name: 'B' + i, team: i % 2, kind: 'bot', loadout: botLoadout(lv, i >> 1) }));
    const sim = new Sim(players, { aiLevel: lv, seed: 1000 * lv + n });
    let guard = 0, legStart = 0;
    while (sim.phase !== 'results' && guard++ < 400 * CFG.simHz) {
      sim.step(dt);
      for (const e of sim.events) {
        if (e.type === 'phase' && e.phase === 'leg') legStart = sim.time;
        if (e.type === 'legEnd') legT.push(sim.time - legStart);
      }
      sim.events.length = 0;
    }
    if (sim.phase !== 'results') throw new Error('경기가 끝나지 않음');
    rows.push(...sim.actors);
  }
  const pct = (k) => (100 * rows.filter(a => a.stageTimes.length >= k).length / rows.length).toFixed(0).padStart(3);
  const fin = rows.filter(a => a.stageTimes.length === 3).map(a => a.stageTimes[2]);
  const shots = avg(rows.map(a => a.shotsFired)), hits = avg(rows.map(a => a.hits));
  console.log(
    `${lv}   ${avg(rows.map(a => a.points)).toFixed(2)}   ${pct(1)}  ${pct(2)}  ${pct(3)}   ${avg(fin).toFixed(1).padStart(5)}   ${avg(rows.map(a => a.falls)).toFixed(2)}  ${shots.toFixed(1).padStart(5)}  ${(100 * hits / (shots || 1)).toFixed(0).padStart(3)}   ${avg(rows.map(a => a.knockoffs)).toFixed(2).padStart(6)}       ${avg(legT).toFixed(0)}`,
  );
}
