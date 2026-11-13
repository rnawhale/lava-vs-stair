// 온라인 연결: 서버의 방 중계(WebSocket)에 붙어 메시지를 주고받는다. 서버 시계와의 차이도 잰다.
import { CFG, ONLINE_SERVER } from './config.js';

export class Net {
  constructor() {
    this.ws = null; this.id = null; this.hostId = null; this.room = null;
    this.peers = new Map();        // id → { name }
    this.offset = 0; this.rtt = Infinity;
    this.on = () => {};            // (msg) 수신 처리
    this.onClose = () => {};
  }
  get isHost() { return this.id !== null && this.id === this.hostId; }
  /** 서버 시각(ms) 추정 */
  now() { return Date.now() + this.offset; }

  async connect(room, name) {
    // 무료 서버가 쉬고 있으면 먼저 깨운다. 준비 중인 응답은 잠시 기다렸다 다시 확인한다.
    if (ONLINE_SERVER) {
      const signal = AbortSignal.timeout(CFG.online.connectTimeoutMs);
      for (;;) {
        try {
          const res = await fetch(new URL('/health', ONLINE_SERVER), { signal, cache: 'no-store' });
          if (res.ok && (await res.json()).online) break;
        } catch { /* 서버가 켜지는 동안에는 응답이 없거나 준비 화면이 올 수 있다. */ }
        if (signal.aborted) throw new Error('서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.');
        await new Promise((resolve) => setTimeout(resolve, CFG.online.retryMs));
      }
    }
    return new Promise((resolve, reject) => {
      if (ONLINE_SERVER === '') return reject(new Error('친구 대전 서버가 아직 준비되지 않았어요. AI 대전은 바로 이용할 수 있어요.'));
      let done = false;
      const url = new URL('/ws', ONLINE_SERVER || location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = (this.ws = new WebSocket(url));
      const fail = (msg) => {
        if (done) return;
        done = true; clearTimeout(this.connectTimer); clearInterval(this.pinger);
        ws.onopen = ws.onmessage = ws.onclose = null;
        ws.close(); this.ws = null;
        reject(new Error(msg));
      };
      this.connectTimer = setTimeout(() => fail('서버 응답이 늦어요. 잠시 후 다시 시도해 주세요.'), CFG.online.connectTimeoutMs);
      ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', room, name })); this.ping(); };
      ws.onerror = () => fail('대전 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
      ws.onclose = () => { clearTimeout(this.connectTimer); clearInterval(this.pinger); fail('연결이 끊겼어요'); if (this.id) this.onClose(); this.id = null; };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (!m || typeof m !== 'object') return;
        if (m.t === 'pong') {
          const rtt = Date.now() - m.c;
          if (rtt < this.rtt + 15) { this.rtt = Math.min(this.rtt, rtt); this.offset = m.now + rtt / 2 - Date.now(); }  // 왕복이 짧았던 표본을 믿는다
          return;
        }
        if (m.t === 'err') return fail(m.msg);
        if (m.t === 'joined') {
          clearTimeout(this.connectTimer);
          this.id = m.id; this.hostId = m.host; this.room = m.room;
          for (const p of m.peers) this.peers.set(p.id, { name: p.name });
          this.pinger = setInterval(() => this.ping(), 2000);
          done = true; resolve(m);
          return;
        }
        if (m.t === 'peer') this.peers.set(m.id, { name: m.name });
        if (m.t === 'left') { this.peers.delete(m.id); this.hostId = m.host; }
        this.on(m);
      };
    });
  }
  ping() { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'ping', c: Date.now() })); }
  send(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { const ws = this.ws; this.id = null; this.ws = null; clearTimeout(this.connectTimer); clearInterval(this.pinger); if (ws) { ws.onclose = null; ws.close(); } }
}
