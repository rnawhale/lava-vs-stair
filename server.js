// Lava VS Stair 서버: 정적 파일 + (온라인 대전용) WebSocket 방 중계.
//   node server.js   →  http://localhost:8787
// AI 대전은 정적 파일만으로 돌아가므로 public/ 을 아무 정적 호스팅에 올려도 된다.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { randomInt } from 'node:crypto';
import { CFG } from './public/src/config.js';

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
    if (path === '/health') {
      res.writeHead(wsLib ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).end(JSON.stringify({ online: !!wsLib }));
      return;
    }
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
const rooms = new Map();        // 방 코드 → { code, title, peers, host, seq, locked }
const visitors = new Map();     // 친구 만나기에 접속한 사람(방·경기 안에서도 같은 연결을 쓴다)
const ROOM_MAX = CFG.teamSize * 2;
let visitorSeq = 0;
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const cast = (room, m, except) => { const s = JSON.stringify(m); for (const [id, p] of room.peers) if (id !== except && p.ws.readyState === 1) p.ws.send(s); };
const clean = (value, max) => String(value || '').replace(/[<>&"'\x00-\x1f]/g, '').trim().slice(0, max);
const directory = () => {
  const m = { t: 'directory',
    people: [...visitors].map(([id, p]) => ({ id, name: p.name, room: p.room })),
    rooms: [...rooms.values()].map((r) => ({ code: r.code, title: r.title, count: r.peers.size, locked: r.locked,
      names: [...r.peers.values()].map((p) => p.name) })),
  };
  for (const p of visitors.values()) send(p.ws, m);
};
const newCode = () => {
  let code;
  do { code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join(''); } while (rooms.has(code));
  return code;
};

const wsLib = await import('ws').catch(() => null);
if (wsLib) {
  const { WebSocketServer } = wsLib;
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  wss.on('connection', (ws) => {
    let room = null, id = null, visitorId = null, budget = 240, last = Date.now(), lastInvite = 0;
    const enter = (name) => {
      if (visitorId) return true;
      name = clean(name, 10) || '손님';
      if ([...visitors.values()].some((p) => p.name === name)) {
        send(ws, { t: 'err', msg: '같은 이름인 친구가 있어요. 다른 별명을 골라 주세요.' }); return false;
      }
      visitorId = 'u' + ++visitorSeq;
      visitors.set(visitorId, { ws, name, room: null });
      return true;
    };
    const leaveRoom = () => {
      if (!room) return;
      room.peers.delete(id);
      if (!room.peers.size) rooms.delete(room.code);
      else {
        if (room.host === id) room.host = room.peers.keys().next().value;
        cast(room, { t: 'left', id, host: room.host });
      }
      room = null; id = null;
      if (visitors.has(visitorId)) visitors.get(visitorId).room = null;
    };
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
      if (m.t === 'enter') {
        if (!enter(m.name)) return;
        send(ws, { t: 'entered', visitorId, name: visitors.get(visitorId).name });
        directory(); return;
      }
      if (m.t === 'create' || m.t === 'join') {
        if (room || !enter(m.name)) return;
        const code = m.t === 'create' ? newCode() : String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        const name = visitors.get(visitorId).name;
        if (code.length < 4) return send(ws, { t: 'err', msg: '방 코드가 올바르지 않아요' });
        let r = rooms.get(code);
        if (!r) {
          if (m.existing) return send(ws, { t: 'err', msg: '이 방은 닫혔어요. 다른 방을 골라 주세요.' });
          if (rooms.size >= 300) return send(ws, { t: 'err', msg: '서버가 붐벼요. 잠시 뒤 다시 시도해 주세요' });
          r = { code, title: clean(m.title, 24) || `${name}의 용암탑`, peers: new Map(), host: null, seq: 0, locked: false };
          rooms.set(code, r);
        }
        if (r.locked) return send(ws, { t: 'err', msg: '경기가 진행 중이에요. 끝난 뒤 다시 들어와 주세요' });
        if (r.peers.size >= ROOM_MAX) return send(ws, { t: 'err', msg: `방이 가득 찼어요 (최대 ${ROOM_MAX}명)` });
        id = 'p' + ++r.seq; room = r;
        r.peers.set(id, { ws, name });
        visitors.get(visitorId).room = code;
        if (!r.host) r.host = id;
        send(ws, { t: 'joined', id, host: r.host, room: code, title: r.title, peers: [...r.peers].map(([pid, p]) => ({ id: pid, name: p.name })), now });
        cast(r, { t: 'peer', id, name }, id);
        directory();
        return;
      }
      if (m.t === 'leave') { leaveRoom(); directory(); return; }
      if (m.t === 'invite') {
        const target = visitors.get(m.to);
        const error = !room || room.locked || room.peers.size >= ROOM_MAX ? '대기 중인 빈 방에서 초대해 주세요.'
          : !target || target.room || m.to === visitorId ? '친구가 다른 곳으로 갔어요. 목록을 다시 확인해 주세요.'
          : now - lastInvite < CFG.online.inviteCooldownMs ? '잠깐만요! 조금 뒤에 다시 초대해 주세요.' : null;
        if (error) return send(ws, { t: 'notice', msg: error });
        lastInvite = now;
        send(target.ws, { t: 'invite', from: visitorId, name: visitors.get(visitorId).name, room: room.code, title: room.title });
        send(ws, { t: 'notice', msg: `${target.name}에게 초대했어요!` });
        return;
      }
      if (!room) return;
      if (m.t === 'lock') { if (id === room.host) { room.locked = !!m.v; directory(); } return; }
      if (!['hello', 'lo', 'lobby', 'start', 'ready', 'st', 'shot', 'ev', 'sync', 'phase'].includes(m.t)) return;
      m.from = id;                                   // 보낸 사람은 서버가 적는다(사칭 방지)
      if (typeof m.to === 'string') { const p = room.peers.get(m.to); if (p) send(p.ws, m); } else cast(room, m, id);
    });
    ws.on('close', () => {
      visitors.delete(visitorId);
      leaveRoom(); directory();
    });
  });
  setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, 30000).unref();
} else {
  console.log('ws 모듈이 없어 온라인 대전은 꺼져 있습니다 (npm install 후 사용 가능). AI 대전은 그대로 됩니다.');
}

server.listen(PORT, () => console.log(`Lava VS Stair → http://localhost:${PORT}`));
