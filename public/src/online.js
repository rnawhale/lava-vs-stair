// 온라인 대전: 대기실(방) 관리와 경기 중 상태 복제.
// 구조: 각자 자기 캐릭터만 계산해 20Hz로 알리고, 방장이 경기 진행(시간·교대·점수)과 AI를 맡는다.
// 방장이 나가면 서버가 다음 사람을 방장으로 올리고, 새 방장이 AI와 나간 사람 캐릭터를 이어 받는다.
import { Net } from './net.js';
import { CFG, gunStats } from './config.js';
import { botLoadout } from './ai.js';

const validLo = (lo) => (lo && gunStats(lo.id, lo.level) ? { id: lo.id, level: lo.level } : { id: 'basic', level: 0 });
const lagOf = (net, at, max = 0.5) => (Number.isFinite(at) ? Math.min(max, Math.max(0, (net.now() - at) / 1000)) : 0);

export class Online {
  /** hooks: { lobby(), start(players, opts) → sim, closed(msg), note(html) } */
  constructor(hooks) {
    this.h = hooks; this.net = null; this.sim = null;
    this.fill = true; this.aiLevel = 3; this.loadouts = new Map(); this.readySet = new Set();
    this.teams = new Map();       // id → 0|1: 대기실에서 직접 고른 팀(안 골랐으면 없음)
    this.inMatch = false; this.sendT = 0; this.syncT = 0; this.matches = 0;
    this.directory = { people: [], rooms: [] };
  }
  get connected() { return !!this.net?.visitorId; }
  get active() { return !!(this.net && this.net.id); }
  get isHost() { return !!this.net?.isHost; }
  get id() { return this.net?.id || null; }
  get link() { return `${location.origin}${location.pathname}?room=${this.net.room}`; }

  async enter(name) {
    this.leave();
    const net = this.net = new Net();
    net.on = (m) => this.recv(m);
    net.onClose = () => { this.net = null; this.inMatch = false; this.sim = null; this.h.closed('연결이 끊겼어요'); };
    try { await net.connect(name); }
    catch (e) { net.close(); if (this.net === net) this.net = null; throw e; }
  }
  /** aiLevel: 내가 방을 만들 때 쓸 AI 난이도. 남의 방에 들어가면 방장이 알려 주는 값으로 바뀐다 */
  async join(room, loadout, title, aiLevel = 3) {
    const net = this.net;
    await net.joinRoom(room, title);
    this.fill = true; this.aiLevel = aiLevel; this.inMatch = false; this.sim = null; this.matches = 0;
    this.loadouts = new Map([[net.id, validLo(loadout)]]); this.teams = new Map();
    net.send({ t: 'hello', lo: this.loadouts.get(net.id) });
    this.h.lobby();
  }
  leaveRoom() { this.net?.leaveRoom(); this.sim = null; this.inMatch = false; this.loadouts.clear(); this.teams.clear(); }
  invite(id) { this.net.send({ t: 'invite', to: id }); }
  leave() { if (this.net) this.net.close(); this.net = null; this.sim = null; this.inMatch = false; this.directory = { people: [], rooms: [] }; }

  /** 명단: 사람은 고른 팀으로(안 골랐으면 들어온 번호대로 민트/핑크 번갈아) 가고, 정원이 찬 팀을 고른 사람은 반대 팀으로 간다.
   *  (설정 시) 빈자리는 AI가 채워 teamSize 대 teamSize를 만든다. 같은 정보로 모두가 같은 명단을 계산한다. */
  roster() {
    const T = CFG.teamSize, count = [0, 0];
    const list = [...this.net.peers].map(([id, p]) => ({ id, name: p.name, kind: 'human' }))
      .sort((a, b) => +a.id.slice(1) - +b.id.slice(1))
      .map((p) => {
        let team = this.teams.get(p.id) ?? (+p.id.slice(1) + 1) % 2;
        if (count[team] >= T) team = 1 - team;
        count[team]++;
        return { ...p, team, loadout: this.loadouts.get(p.id) || { id: 'basic', level: 0 } };
      });
    if (this.fill) {
      let n = 0;
      for (const team of [0, 1]) {
        while (count[team] < T) { list.push({ id: 'bot' + n, name: CFG.botNames[n % CFG.botNames.length], kind: 'bot', team, loadout: botLoadout(this.aiLevel, n) }); n++; count[team]++; }
      }
    }
    return list;
  }
  canStart() { const r = this.roster(); return this.isHost && r.some((p) => p.team === 0) && r.some((p) => p.team === 1); }
  sendLobby(to) { this.net.send({ t: 'lobby', fill: this.fill, ai: this.aiLevel, to }); }
  setFill(v) { if (!this.isHost) return; this.fill = !!v; this.sendLobby(); this.h.lobby(); }
  setAi(v) { if (!this.isHost) return; this.aiLevel = v; this.sendLobby(); this.h.lobby(); }
  /** 내 팀 고르기(대기실에서만). 정원 확인은 roster()가 한다 */
  setTeam(t) {
    if (!this.active || (this.inMatch && this.sim?.phase !== 'results')) return;
    this.teams.set(this.id, t ? 1 : 0);
    this.net.send({ t: 'hello', lo: this.loadouts.get(this.id), team: this.teams.get(this.id) });
    this.h.lobby();
  }
  setLoadout(lo) { if (!this.active) return; const v = validLo(lo); this.loadouts.set(this.id, v); this.net.send({ t: 'lo', lo: v }); }

  /** "준비 완료": 사람 모두가 누르면 방장이 남은 대기 시간을 줄인다 */
  ready() { if (!this.inMatch) return; if (this.isHost) this.markReady(this.id); else this.net.send({ t: 'ready' }); }
  markReady(id) {
    this.readySet.add(id);
    if (this.sim.actors.filter((a) => a.p.kind === 'human').every((a) => this.readySet.has(a.id))) this.sim.skipWait();
  }

  start() {
    if (!this.canStart()) return;
    this.matches++;
    const msg = { t: 'start', players: this.roster(), firstClimb: this.matches % 2 ? 0 : 1, ai: this.aiLevel, at: this.net.now() };
    this.net.send(msg); this.net.send({ t: 'lock', v: true });
    this.begin(msg);
  }
  begin(msg) {
    if (!Array.isArray(msg.players) || msg.players.length < 2 || msg.players.length > CFG.teamSize * 2) return;
    const players = msg.players.map((p) => ({
      id: String(p?.id).slice(0, 8), name: String(p?.name ?? '').replace(/[<>&"']/g, '').slice(0, 10) || '손님',
      team: p?.team ? 1 : 0, kind: p?.kind === 'bot' ? 'bot' : 'human', loadout: validLo(p?.loadout),
    }));
    for (const p of players) { p.local = p.id === this.id; p.auth = p.local || (this.isHost && p.kind === 'bot'); }
    if (!players.some((p) => p.local) || new Set(players.map((p) => p.id)).size !== players.length) return;
    this.inMatch = true; this.readySet = new Set(); this.sendT = 0; this.syncT = 0;
    this.sim = this.h.start(players, { firstClimb: msg.firstClimb ? 1 : 0, aiLevel: msg.ai | 0, host: this.isHost });   // 방장이 바뀌어도 같은 난이도로 AI를 이어 받는다
    if (!this.isHost) this.sim.phaseT = Math.max(0.5, this.sim.phaseT - lagOf(this.net, msg.at, 2));
  }

  /** 보낸 사람이 그 캐릭터의 권한자인가: 본인이거나, 방장이 맡은 AI·나간 사람 */
  owns(from, actorId) {
    if (typeof actorId !== 'string') return false;
    if (actorId === from) return true;
    const a = this.sim.actor(actorId);
    return !!a && from === this.net.hostId && (a.p.kind === 'bot' || !this.net.peers.has(actorId));
  }

  recv(m) {
    if (m.t === 'directory') { this.directory = m; this.h.directory(); return; }
    if (m.t === 'invite') { this.h.invite(m); return; }
    if (m.t === 'notice') { this.h.notice(m.msg); return; }
    const net = this.net, sim = this.sim, live = this.inMatch && !!sim;
    const fromHost = m.from === net.hostId, lag = lagOf(net, m.at);
    switch (m.t) {
      case 'peer':                                   // 새로 온 사람에게 내 장비·고른 팀(방장이면 대기실 설정도)을 알려 준다
        net.send({ t: 'hello', lo: this.loadouts.get(this.id), team: this.teams.get(this.id), to: m.id });
        if (this.isHost) this.sendLobby(m.id);
        this.h.lobby();
        break;
      case 'left': {
        this.loadouts.delete(m.id); this.teams.delete(m.id);
        if (live) {
          const gone = sim.actor(m.id);
          if (gone) this.h.note(`${gone.p.name} 나감 → AI가 이어서 해요`);
          if (this.isHost) {                         // (새) 방장: 경기 진행과 주인 없는 캐릭터를 맡는다
            sim.host = true;
            for (const a of sim.actors) if (!a.auth && (a.p.kind === 'bot' || !net.peers.has(a.id))) sim.takeOver(a);
          }
        }
        this.h.lobby();
        break;
      }
      case 'hello': case 'lo': {
        const lo = validLo(m.lo);
        this.loadouts.set(m.from, lo);
        if (m.t === 'hello') { if (m.team === 0 || m.team === 1) this.teams.set(m.from, m.team); else this.teams.delete(m.from); }
        if (live) sim.setLoadout(m.from, lo.id, lo.level);     // 차례 중이면 sim이 다음 차례부터 적용한다
        this.h.lobby();
        break;
      }
      case 'lobby': if (fromHost) { this.fill = !!m.fill; if (CFG.ai.levels[m.ai - 1]) this.aiLevel = m.ai; this.h.lobby(); } break;
      case 'start': if (fromHost) this.begin(m); break;
      case 'ready': if (this.isHost && live) this.markReady(m.from); break;
      case 'st': if (live && Array.isArray(m.a)) for (const s of m.a.slice(0, CFG.teamSize * 2)) if (this.owns(m.from, s?.[0])) sim.applyState(s, lag); break;
      case 'shot': if (live && this.owns(m.from, m.id)) sim.addRemoteShot(m, lag); break;
      case 'ev': if (live && this.owns(m.from, m.id)) sim.applyEvent(m); break;
      case 'sync': if (live && fromHost) sim.applySync(m, lag); break;
      case 'phase':
        if (!live || !fromHost) break;
        if (m.phase === 'leg' && (sim.phase === 'countdown' || sim.phase === 'switch')) { sim.startLeg(); sim.phaseT -= lag; sim.clock += lag; }
        else if (sim.phase === 'leg' && ((m.phase === 'switch' && sim.leg === 0) || (m.phase === 'results' && sim.leg === 1))) {
          sim.applyScores(m.st, true);                 // 방장의 공식 기록으로 맞춘 뒤 차례를 끝낸다
          sim.endLeg();
          if (sim.phase === 'switch') sim.phaseT = CFG.time.switch - lag;
        }
        break;
    }
  }

  /** 매 틱 뒤: 내 권한 캐릭터 상태(20Hz), 방장은 경기 시계·점수(4Hz) */
  afterStep(dt) {
    if (!this.inMatch || !this.active) return;
    const sim = this.sim, net = this.net;
    if ((this.sendT += dt) >= 0.05) {
      this.sendT = 0;
      const a = sim.actors.filter((x) => x.auth).map((x) => sim.packState(x));
      if (a.length) net.send({ t: 'st', a, at: net.now() });
    }
    if (this.isHost && (this.syncT += dt) >= 0.25) { this.syncT = 0; net.send({ t: 'sync', at: net.now(), ...sim.packSync() }); }
  }

  /** 내 쪽에서 생긴 사건을 다른 사람에게 알린다(받아서 반영한 사건 e.remote 는 다시 보내지 않는다) */
  onLocalEvent(e) {
    if (!this.inMatch || !this.active || e.remote) return;
    const net = this.net, sim = this.sim, a = e.a;
    switch (e.type) {
      case 'shot': if (a.auth) net.send({ t: 'shot', id: a.id, n: e.s.n, o: [e.s.x, e.s.y, e.s.z], v: [e.s.vx, e.s.vy, e.s.vz], at: net.now() }); break;
      case 'fall': if (a.auth) net.send({ t: 'ev', e: 'fall', id: a.id, x: e.x, y: e.y, z: e.z, by: e.by ? e.by.id : null }); break;
      case 'respawn': if (a.auth) net.send({ t: 'ev', e: 'respawn', id: a.id }); break;
      case 'stage': if (a.auth) net.send({ t: 'ev', e: 'stage', id: a.id, stage: e.stage, time: sim.clock }); break;
      case 'hit': if (a.auth) net.send({ t: 'ev', e: 'hit', id: a.id, by: e.by.id, n: e.s.n, x: e.s.x, y: e.s.y, z: e.s.z }); break;
      case 'blocked': if (a.auth) net.send({ t: 'ev', e: 'blocked', id: a.id, by: e.s.owner.id, n: e.s.n, reason: e.reason, x: e.s.x, y: e.s.y, z: e.s.z }); break;
      case 'phase':
        if (!this.isHost || e.phase === 'countdown') break;
        net.send({ t: 'phase', at: net.now(), ...sim.packSync() });
        if (e.phase === 'results') net.send({ t: 'lock', v: false });
        break;
    }
  }
}
