// Lava VS Stair 서버: 정적 파일 + (온라인 대전용) WebSocket 방 중계.
//   node server.js   →  http://localhost:8787
// AI 대전은 정적 파일만으로 돌아가므로 public/ 을 아무 정적 호스팅에 올려도 된다.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = +process.env.PORT || 8787;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

export const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }   // 경로 탈출 차단
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const type = MIME[extname(file)] || 'application/octet-stream';
    let body = await readFile(file);
    const head = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
    if (/text|json|svg/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      body = gzipSync(body); head['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, head).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
});

// ── 온라인 대전: 방(room) 단위로 메시지를 그대로 전달하는 중계기 ──
// 게임 규칙은 브라우저(방장)가 돌린다. 서버는 방 입장·인원 제한·방장 지정·시계만 맡는다.
const rooms = new Map();        // 방 코드 → { code, peers: Map(id → { ws, name }), host, seq, locked }
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const cast = (room, m, except) => { const s = JSON.stringify(m); for (const [id, p] of room.peers) if (id !== except && p.ws.readyState === 1) p.ws.send(s); };

const wsLib = await import('ws').catch(() => null);
if (wsLib) {
  const { WebSocketServer } = wsLib;
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  wss.on('connection', (ws) => {
    let room = null, id = null, budget = 240, last = Date.now();
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (raw) => {
      const now = Date.now();
      budget = Math.min(240, budget + (now - last) * 0.24); last = now;   // 초당 240건까지
      if (--budget < 0) return;
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
      if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c, now });
      if (m.t === 'join') {
        if (room) return;
        const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        const name = String(m.name || '').replace(/[<>&"']/g, '').trim().slice(0, 10) || '손님';
        if (code.length < 4) return send(ws, { t: 'err', msg: '방 코드가 올바르지 않아요' });
        let r = rooms.get(code);
        if (!r) {
          if (rooms.size >= 300) return send(ws, { t: 'err', msg: '서버가 붐벼요. 잠시 뒤 다시 시도해 주세요' });
          r = { code, peers: new Map(), host: null, seq: 0, locked: false };
          rooms.set(code, r);
        }
        if (r.locked) return send(ws, { t: 'err', msg: '경기가 진행 중이에요. 끝난 뒤 다시 들어와 주세요' });
        if (r.peers.size >= 4) return send(ws, { t: 'err', msg: '방이 가득 찼어요 (최대 4명)' });
        id = 'p' + ++r.seq; room = r;
        r.peers.set(id, { ws, name });
        if (!r.host) r.host = id;
        send(ws, { t: 'joined', id, host: r.host, room: code, peers: [...r.peers].map(([pid, p]) => ({ id: pid, name: p.name })), now });
        cast(r, { t: 'peer', id, name }, id);
        return;
      }
      if (!room) return;
      if (m.t === 'lock') { if (id === room.host) room.locked = !!m.v; return; }
      m.from = id;                                   // 보낸 사람은 서버가 적는다(사칭 방지)
      if (typeof m.to === 'string') { const p = room.peers.get(m.to); if (p) send(p.ws, m); } else cast(room, m, id);
    });
    ws.on('close', () => {
      if (!room) return;
      room.peers.delete(id);
      if (!room.peers.size) { rooms.delete(room.code); return; }
      if (room.host === id) room.host = room.peers.keys().next().value;
      cast(room, { t: 'left', id, host: room.host });
    });
  });
  setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, 30000).unref();
} else {
  console.log('ws 모듈이 없어 온라인 대전은 꺼져 있습니다 (npm install 후 사용 가능). AI 대전은 그대로 됩니다.');
}

server.listen(PORT, () => console.log(`Lava VS Stair → http://localhost:${PORT}`));
