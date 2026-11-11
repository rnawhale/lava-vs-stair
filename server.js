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

server.listen(PORT, () => console.log(`Lava VS Stair → http://localhost:${PORT}`));
