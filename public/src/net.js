// 온라인 연결: 서버의 방 중계(WebSocket)에 붙어 메시지를 주고받는다. 서버 시계와의 차이도 잰다.
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

  connect(room, name) {
    return new Promise((resolve, reject) => {
      let done = false;
      const ws = (this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`));
      const fail = (msg) => { if (!done) { done = true; reject(new Error(msg)); } };
      ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', room, name })); this.ping(); };
      ws.onerror = () => fail('온라인 서버에 연결할 수 없어요. node server.js 로 연 주소에서만 됩니다');
      ws.onclose = () => { clearInterval(this.pinger); fail('연결이 끊겼어요'); if (this.id) this.onClose(); this.id = null; };
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
  close() { const ws = this.ws; this.id = null; this.ws = null; clearInterval(this.pinger); if (ws) { ws.onclose = null; ws.close(); } }
}
