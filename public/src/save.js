// 저장(같은 브라우저 localStorage)과 상점 거래 규칙. 계정·서버 없이 동작한다.
import { CFG, gunStats } from './config.js';

const KEY = 'lava-vs-stair.save.v1';

export const defaultSave = () => ({
  v: 1,
  coins: 0,
  owned: { basic: true, rapid: false, heavy: false },
  levels: { basic: 0, rapid: 0, heavy: 0 },
  equipped: 'basic',
  aiLevel: 1,
  stats: { matches: 0, wins: 0, best: null, stages: CFG.stages.length },   // best: 완주 최고 기록(stages단계 코스 기준)
  settings: { volume: 0.8, muted: false, music: true, quality: 'auto' },
  tips: {},
  name: '',
});

/** 깨졌거나 조작된 저장값도 규칙에 맞게 바로잡는다 */
export function sanitize(raw) {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const int = (v, lo, hi, fb) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : fb);
  d.coins = int(raw.coins, 0, 999999, 0);
  for (const id of CFG.gunOrder) {
    d.owned[id] = id === 'basic' || !!raw.owned?.[id];
    d.levels[id] = d.owned[id] ? int(raw.levels?.[id], 0, 2, 0) : 0;
  }
  d.equipped = d.owned[raw.equipped] ? raw.equipped : 'basic';
  d.aiLevel = int(raw.aiLevel, 1, 5, 1);
  d.stats.matches = int(raw.stats?.matches, 0, 1e9, 0);
  d.stats.wins = int(raw.stats?.wins, 0, 1e9, 0);
  // 코스 단계 수가 바뀌면 예전 완주 기록은 비교할 수 없으므로 지운다(세 단계 시절 기록이 영영 안 깨지는 일을 막는다)
  d.stats.best = raw.stats?.stages === d.stats.stages && Number.isFinite(raw.stats?.best) && raw.stats.best > 0 ? raw.stats.best : null;
  const s = raw.settings || {};
  d.settings.volume = Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : 0.8;
  d.settings.muted = !!s.muted;
  d.settings.music = s.music !== false;
  d.settings.quality = ['auto', 'high', 'low'].includes(s.quality) ? s.quality : 'auto';
  if (raw.tips && typeof raw.tips === 'object') for (const k of Object.keys(raw.tips).slice(0, 30)) d.tips[k] = true;
  d.name = typeof raw.name === 'string' ? raw.name.slice(0, 10) : '';
  return d;
}

export function loadSave(storage = globalThis.localStorage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY))); } catch { return defaultSave(); }
}
export function persist(save, storage = globalThis.localStorage) {
  try { storage.setItem(KEY, JSON.stringify(save)); return true; } catch { return false; }
}

export const loadoutOf = (save) => ({ id: save.equipped, level: save.levels[save.equipped] });

// ── 거래: 모두 "현재 상태를 확인하고 한 번에 바꾼다". 같은 요청이 두 번 와도 두 번 결제되지 않는다. ──
export function buy(save, id) {
  const g = CFG.guns[id];
  if (!g) return { ok: false, reason: '없는 물총' };
  if (save.owned[id]) return { ok: false, reason: '이미 보유' };
  if (save.coins < g.price) return { ok: false, reason: 'Coins 부족' };
  save.coins -= g.price; save.owned[id] = true; save.levels[id] = 0;
  return { ok: true, spent: g.price };
}
/** expectedLevel: 버튼을 누를 때 화면에 보이던 레벨. 연타로 두 단계가 한꺼번에 결제되는 것을 막는다. */
export function upgrade(save, id, expectedLevel) {
  if (!save.owned[id]) return { ok: false, reason: '미보유' };
  const lv = save.levels[id];
  if (lv !== expectedLevel) return { ok: false, reason: '이미 처리됨' };
  const up = CFG.upgrades[lv + 1];
  if (!up) return { ok: false, reason: '최대 레벨' };
  if (save.coins < up.cost) return { ok: false, reason: 'Coins 부족' };
  save.coins -= up.cost; save.levels[id] = lv + 1;
  return { ok: true, spent: up.cost };
}
export function equip(save, id) {
  if (!save.owned[id]) return { ok: false, reason: '미보유' };
  save.equipped = id;
  return { ok: true };
}
export const statsOf = (save, id) => gunStats(id, save.levels[id]);
