// 탑·용암·하늘·계단·사격 통로의 3D 모델. 전부 코드로 만든다(외부 모델 파일 없음).
import * as THREE from 'three';
import { CFG } from '../config.js';
import { RP, toWorld } from '../course.js';

export const COLORS = {
  moving: 0xffa52e,    // 주황 테두리 = 벽으로 들어가는 계단
  fixed: 0xbfe6ff,     // 흰 얼음빛 = 고정 계단
  pad: 0x9dff5a,       // 연두 = 물총 안전 지대
  warn: 0xff3b1f,
  lane: 0x49c6ff,
  fog: 0xa83a16,
};

const canvasTex = (size, draw, opts = {}) => {
  const c = document.createElement('canvas');
  c.width = opts.w || size; c.height = opts.h || size;
  draw(c.getContext('2d'), c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  if (opts.color !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/**
 * 단면(profile: [[반지름, 높이]...], 반시계)을 각도 a0..a1로 휘어 돌린 입체.
 * matOf(변 번호) → 재질 번호, 양 끝 뚜껑은 capMat.
 */
export function arcExtrude(profile, a0, a1, segs, matOf, capMat = 1) {
  const pos = [], nor = [], uv = [], idx = [];
  const geo = new THREE.BufferGeometry();
  const n = profile.length;
  const P = (r, y, a) => pos.push(r * Math.cos(a), y, -r * Math.sin(a));
  let rMin = Infinity, rMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const [r, y] of profile) { rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); }
  for (let e = 0; e < n; e++) {
    const [r0, y0] = profile[e], [r1, y1] = profile[(e + 1) % n];
    const dr = r1 - r0, dy = y1 - y0, len = Math.hypot(dr, dy) || 1;
    const nr = dy / len, ny = -dr / len;
    const base = pos.length / 3, start = idx.length;
    for (let s = 0; s <= segs; s++) {
      const a = a0 + (a1 - a0) * s / segs, u = s / segs;
      P(r0, y0, a); P(r1, y1, a);
      const nx = nr * Math.cos(a), nz = -nr * Math.sin(a);
      nor.push(nx, ny, nz, nx, ny, nz);
      // 윗면(수평 변)은 v=벽 0→바깥 1, 그 밖의 면은 v=아래 0→위 1
      if (Math.abs(dy) < 1e-6) uv.push(u, (r0 - rMin) / (rMax - rMin), u, (r1 - rMin) / (rMax - rMin));
      else uv.push(u, (y0 - yMin) / (yMax - yMin), u, (y1 - yMin) / (yMax - yMin));
    }
    for (let s = 0; s < segs; s++) { const a = base + s * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    geo.addGroup(start, idx.length - start, matOf(e));
  }
  for (const [a, flip] of [[a0, false], [a1, true]]) {
    const base = pos.length / 3, start = idx.length;
    const sx = flip ? -Math.sin(a) : Math.sin(a), sz = flip ? -Math.cos(a) : Math.cos(a);
    for (const [r, y] of profile) {
      P(r, y, a); nor.push(sx, 0, sz);
      uv.push((r - rMin) / (rMax - rMin), (y - yMin) / (yMax - yMin));
    }
    for (let i = 1; i < n - 1; i++) flip ? idx.push(base, base + i + 1, base + i) : idx.push(base, base + i, base + i + 1);
    geo.addGroup(start, idx.length - start, capMat);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

// ── 텍스처 ───────────────────────────────────────────────
function stoneBase(g, w, h, tone = 30) {
  g.fillStyle = `rgb(${tone + 12},${tone + 8},${tone + 16})`;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    const v = tone + rnd() * 34 - 8;
    g.fillStyle = `rgba(${v + 10},${v + 6},${v + 16},${0.25 + rnd() * 0.4})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 5, 1 + rnd() * 5);
  }
}

const padLabel = (course, i) => (i === 0 ? 'START' : i === course.pads.length - 1 ? 'GOAL' : `S${i + 1}`);

/** 발판 윗면: [바탕, 발광 무늬]. u=진행 방향, v=벽(0)→바깥(1). 같은 무늬는 한 번만 그려 함께 쓴다. */
const topCache = {};
const topTextures = (kind, label) => topCache[kind + label] || (topCache[kind + label] = drawTop(kind, label));
function drawTop(kind, label) {
  const S = kind === 'pad' ? 512 : 256;
  const pattern = (g, glow) => {
    const m = S * 0.07;
    g.lineWidth = S * 0.035; g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = glow ? '#fff' : 'rgba(255,255,255,0.5)';
    g.strokeRect(m, m, S - m * 2, S - m * 2);
    if (kind === 'moving') {          // 벽 쪽(캔버스 아래)을 가리키는 화살표 = "벽으로 들어감"
      g.lineWidth = S * 0.05;
      for (const cx of [0.3, 0.7]) for (const cy of [0.4, 0.62]) {
        g.beginPath();
        g.moveTo(S * (cx - 0.11), S * (cy - 0.07)); g.lineTo(S * cx, S * (cy + 0.07)); g.lineTo(S * (cx + 0.11), S * (cy - 0.07));
        g.stroke();
      }
    } else if (kind === 'pad') {
      g.lineWidth = S * 0.02;
      g.beginPath(); g.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(S / 2, S / 2, S * 0.24, 0, Math.PI * 2); g.stroke();
      // 바깥에서 탑을 보는 카메라에서 바로 읽히도록 글자 축을 맞춘다 (윗면 UV는 거울상)
      g.save(); g.setTransform(1, 0, 0, -1, S / 2, S / 2);
      g.fillStyle = glow ? '#fff' : 'rgba(255,255,255,0.75)';
      g.font = `900 ${S * (label.length > 2 ? 0.13 : 0.2)}px system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, 0, 0);
      g.restore();
    } else {
      g.lineWidth = S * 0.02;
      g.beginPath(); g.moveTo(S * 0.3, S * 0.5); g.lineTo(S * 0.7, S * 0.5); g.stroke();
    }
  };
  const map = canvasTex(S, (g) => { stoneBase(g, S, S, kind === 'pad' ? 34 : 28); pattern(g, false); });
  const emis = canvasTex(S, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, S, S); pattern(g, true); });
  return [map, emis];
}

/** 옆면 띠: 가운데에 빛나는 줄 */
const bandTextures = (() => {
  let cache;
  return () => cache || (cache = [
    canvasTex(64, (g) => { stoneBase(g, 64, 64, 20); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0, 22, 64, 20); }),
    canvasTex(64, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff'; g.fillRect(0, 24, 64, 16); }),
  ]);
})();

function towerTextures() {
  const S = 1024, rows = 8, cols = 4, bh = S / rows, bw = S / cols;
  const bricks = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) bricks.push({ x: c * bw + (r % 2 ? bw / 2 : 0), y: r * bh, tone: 30 + rnd() * 26, crack: rnd() < 0.2 });
  const crackPaths = bricks.filter(b => b.crack).map(b => {
    const pts = [[b.x + bw * (0.15 + rnd() * 0.2), b.y + bh * (0.2 + rnd() * 0.6)]];
    for (let i = 0; i < 5; i++) pts.push([pts[i][0] + bw * (0.08 + rnd() * 0.1), pts[i][1] + bh * (rnd() - 0.5) * 0.35]);
    return pts;
  });
  const drawCracks = (g, style, width, blur) => {
    g.strokeStyle = style; g.lineWidth = width; g.shadowColor = style; g.shadowBlur = blur; g.lineJoin = 'round';
    for (const pts of crackPaths) for (const ox of [0, -S]) {
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x + ox, y) : g.moveTo(x + ox, y))); g.stroke();
    }
    g.shadowBlur = 0;
  };
  const each = (g, fn) => { for (const b of bricks) for (const ox of [0, -S]) fn(b, b.x + ox, b.y); };
  const map = canvasTex(S, (g) => {
    g.fillStyle = '#08070b'; g.fillRect(0, 0, S, S);
    each(g, (b, x, y) => {
      const t = b.tone;
      const grad = g.createLinearGradient(0, y, 0, y + bh);
      grad.addColorStop(0, `rgb(${t + 18},${t + 12},${t + 30})`); grad.addColorStop(1, `rgb(${t},${t - 4},${t + 12})`);
      g.fillStyle = grad; g.fillRect(x + 5, y + 5, bw - 10, bh - 10);
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + 5, y + 5, bw - 10, 5);
      for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.25})`; g.fillRect(x + 8 + rnd() * (bw - 20), y + 8 + rnd() * (bh - 20), 2 + rnd() * 9, 2 + rnd() * 6); }
    });
    drawCracks(g, '#ff8a2a', 3, 10);
  });
  const emis = canvasTex(S, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, S, S); drawCracks(g, '#ff6a14', 4, 16); drawCracks(g, '#ffd27a', 1.5, 0); });
  const bump = canvasTex(S, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    each(g, (b, x, y) => { g.fillStyle = `rgb(${200 + b.tone},${200 + b.tone},${200 + b.tone})`; g.fillRect(x + 6, y + 6, bw - 12, bh - 12); });
    drawCracks(g, '#222', 4, 0);
  }, { color: false });
  for (const t of [map, emis, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(12, 12); }
  return { map, emis, bump };
}

// ── 셰이더 ───────────────────────────────────────────────
const NOISE = /* glsl */`
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*noise(p); p = p*2.03 + 11.7; a *= 0.5; } return s; }`;

function makeLava(fog) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFog: { value: new THREE.Color(fog.color) }, uDensity: { value: fog.density } },
    vertexShader: /* glsl */`varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
uniform float uTime; uniform vec3 uFog; uniform float uDensity; varying vec3 vW;
${NOISE}
void main(){
  vec2 p = vW.xz * 0.03;
  float t = uTime * 0.05;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  float n = fbm(p + 2.4*q + vec2(t*0.7, -t*0.4));
  float ridge = 1.0 - abs(2.0*n - 1.0);
  float veins = smoothstep(0.9, 0.995, ridge);
  float hot = smoothstep(0.3, 0.85, n);
  vec3 crust = mix(vec3(0.035, 0.008, 0.008), vec3(0.34, 0.045, 0.006), hot);
  vec3 glow = mix(vec3(1.0, 0.3, 0.03), vec3(1.0, 0.7, 0.2), veins);
  float pulse = 0.6 + 0.4*sin(uTime*0.9 + n*18.0);
  vec3 col = mix(crust, glow*1.25, veins*pulse);
  float d = length(vW.xz);
  col += vec3(1.0, 0.3, 0.04) * 0.1 * smoothstep(120.0, 62.0, d);     // 탑 주변은 더 뜨겁다
  float fd = distance(cameraPosition, vW) * uDensity;
  col = mix(col, uFog, 1.0 - exp(-fd*fd));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(1400, 48), mat);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = CFG.lavaY;
  return mesh;
}

function makeSky(fog) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uFog: { value: new THREE.Color(fog.color) }, uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
uniform vec3 uFog; uniform float uTime; varying vec3 vD;
${NOISE}
void main(){
  vec3 d = normalize(vD);
  float h = d.y;
  vec3 top = vec3(0.03, 0.02, 0.09), mid = vec3(0.17, 0.07, 0.26);
  vec3 col = mix(mid, top, smoothstep(0.55, 0.95, h));      // 파노라마 위쪽 하늘색과 이어진다
  // 연기 구름
  vec2 cuv = d.xz / (abs(h) + 0.25);
  float cl = fbm(cuv * 1.6 + uTime * 0.01);
  col = mix(col, vec3(0.2, 0.06, 0.08), smoothstep(0.5, 0.85, cl) * 0.5 * smoothstep(0.0, 0.3, h));
  // 별
  vec2 suv = d.xz / (h + 0.4) * 60.0;
  float st = step(0.9965, hash(floor(suv))) * smoothstep(0.25, 0.6, h);
  col += vec3(0.9, 0.9, 1.0) * st * (0.6 + 0.4*sin(uTime*2.0 + hash(floor(suv))*40.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return mesh;
}

/** 멀리 둘러선 화산 파노라마(생성 이미지). 좌우를 거울 반복해 이음매 없이 한 바퀴 감는다. */
function makeBackdrop() {
  const R = 1500, H = (2 * Math.PI * R / 2) / 3;     // 그림(3:1) 두 장이 한 바퀴
  const tex = new THREE.TextureLoader().load('assets/img/backdrop.webp');
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.MirroredRepeatWrapping; tex.repeat.x = 2;
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, H, 72, 1, true),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  m.position.y = H * 0.5 - H * 0.215;                 // 그림 속 용암 수평선을 실제 용암 높이에 맞춘다
  m.renderOrder = -8;
  return m;
}

// ── 발판 ────────────────────────────────────────────────
function makePlatform(p, label) {
  const kind = p.kind === 'pad' ? 'pad' : p.moving ? 'moving' : 'fixed';
  const color = COLORS[kind];
  const [map, emis] = topTextures(kind, label);
  const [bmap, bemis] = bandTextures();
  const top = new THREE.MeshStandardMaterial({ map, emissiveMap: emis, emissive: color, emissiveIntensity: kind === 'pad' ? 0.55 : 0.9, roughness: 0.85, metalness: 0.05 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x2b2733, roughness: 0.9 });
  const band = new THREE.MeshStandardMaterial({ map: bmap, emissiveMap: bemis, emissive: color, emissiveIntensity: 1.1, roughness: 0.7 });
  const c = 0.25, r0 = p.r0 - 0.6, r1 = p.rFull, B = -p.thick;
  const half = (p.th1 - p.th0) / 2;
  const profile = [[r1 - c, 0], [r0, 0], [r0, B], [r1 - c, B], [r1, B + c], [r1, -c]];
  const geo = arcExtrude(profile, -half, half, p.kind === 'pad' ? 10 : 5, (e) => (e === 0 ? 0 : e === 4 ? 2 : 1), 2);
  const mesh = new THREE.Mesh(geo, [top, stone, band]);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.rotation.y = p.thc; group.position.y = p.top;
  group.add(mesh);
  const out = { p, group, mesh, top, band, color: new THREE.Color(color), kind, warnIcon: null };

  if (p.moving) {
    // 벽의 문틀: 계단이 드나드는 자리
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x15131a, roughness: 0.6, metalness: 0.4 });
    const glowMat = new THREE.MeshBasicMaterial({ color });
    const R = CFG.towerRadius, hA = half + 0.9 / R;
    const frame = new THREE.Mesh(arcExtrude([[R + 0.5, 0.7], [R - 0.3, 0.7], [R - 0.3, B - 0.7], [R + 0.5, B - 0.7]], -hA, hA, 5, () => 0, 0), frameMat);
    const hole = new THREE.Mesh(arcExtrude([[R + 0.56, 0.25], [R + 0.4, 0.25], [R + 0.4, B - 0.25], [R + 0.56, B - 0.25]], -half - 0.25 / R, half + 0.25 / R, 5, () => 0, 0), new THREE.MeshBasicMaterial({ color: 0x050406 }));
    const lip = new THREE.Mesh(arcExtrude([[R + 0.62, 0.95], [R + 0.5, 0.95], [R + 0.5, 0.7], [R + 0.62, 0.7]], -hA, hA, 5, () => 0, 0), glowMat);
    group.add(frame, hole, lip);
    out.lip = glowMat;
    // 접힘 예고 표식: 발판 위에 떠오르는 "!" (모양으로도 알린다)
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: warnIconTex(), depthTest: false, transparent: true }));
    icon.scale.set(3.2, 3.2, 1); icon.position.set(RP, 3.4, 0); icon.visible = false; icon.renderOrder = 20;
    group.add(icon);
    out.warnIcon = icon;
  }
  return out;
}

let _warnTex;
function warnIconTex() {
  return _warnTex || (_warnTex = canvasTex(128, (g) => {
    g.translate(64, 64);
    g.beginPath(); g.moveTo(0, -50); g.lineTo(54, 42); g.lineTo(-54, 42); g.closePath();
    g.fillStyle = '#ff3b1f'; g.strokeStyle = '#fff'; g.lineWidth = 9; g.lineJoin = 'round'; g.stroke(); g.fill();
    g.fillStyle = '#fff'; g.font = '900 70px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 0, 12);
  }));
}

function makeFlag(label, color) {
  const g = new THREE.Group();
  const tex = canvasTex(256, (c, w, h) => {
    c.fillStyle = '#' + new THREE.Color(color).getHexString(); c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(0, h - 22, w, 22);
    c.fillStyle = '#10131a'; c.font = `900 ${label.length > 2 ? 62 : 92}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, w / 2, h / 2);
  }, { w: 256, h: 128 });
  // 벽에 걸린 현수막: 바깥을 향한다(로컬 +x가 바깥)
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), new THREE.MeshBasicMaterial({ map: tex }));
  cloth.rotation.y = Math.PI / 2; cloth.position.set(0.5, 12.5, 0);
  const rod = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 9.8), new THREE.MeshStandardMaterial({ color: 0xd9d4e4, roughness: 0.4, metalness: 0.6 }));
  rod.position.set(0.5, 14.9, 0);
  g.add(cloth, rod);
  g.userData.cloth = cloth;
  return g;
}

// ── 사격 통로 ────────────────────────────────────────────
function makeLane(course) {
  const L = course.lane, group = new THREE.Group();
  const SEG = Math.ceil((L.th1 - L.th0) / 0.04), pos = [], nor = [], uv = [], idx = [];
  const T = 1.2;
  // 단면 꼭짓점: 윗면 안/밖, 아랫면 안/밖 — 높이가 변하므로 직접 만든다
  for (let i = 0; i <= SEG; i++) {
    const th = L.th0 + (L.th1 - L.th0) * i / SEG, y = L.yAt(th), c = Math.cos(th), s = -Math.sin(th), u = (th - L.th0) * 10;
    const ring = [[L.r0, y, 0, 1, 0, 0], [L.r1, y, 0, 1, 0, 1], [L.r1, y, 1, 0, 0, 1], [L.r1, y - T, 1, 0, 0, 0.8], [L.r1, y - T, 0, -1, 0, 1], [L.r0, y - T, 0, -1, 0, 0], [L.r0, y - T, -1, 0, 0, 0.8], [L.r0, y, -1, 0, 0, 1]];
    for (const [r, yy, nr, ny, , v] of ring) { pos.push(r * c, yy, r * s); nor.push(nr * c, ny, nr * s); uv.push(u, v); }
    if (i < SEG) for (let f = 0; f < 4; f++) { const a = i * 8 + f * 2, b = a + 8; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const map = canvasTex(256, (g) => {
    g.fillStyle = '#1d2a3c'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(120,170,220,${rnd() * 0.08})`; g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 14, 2); }
    g.fillStyle = '#31506e'; g.fillRect(0, 0, 256, 14); g.fillRect(0, 242, 256, 14);
    g.strokeStyle = 'rgba(160,220,255,0.35)'; g.lineWidth = 5;
    for (let x = 0; x < 256; x += 64) { g.beginPath(); g.moveTo(x + 14, 96); g.lineTo(x + 34, 128); g.lineTo(x + 14, 160); g.stroke(); }
  });
  const emis = canvasTex(256, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#fff'; g.fillRect(0, 16, 256, 7); g.fillRect(0, 233, 256, 7); });
  for (const t of [map, emis]) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; }
  const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, emissiveMap: emis, emissive: COLORS.lane, emissiveIntensity: 0.8, roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide }));
  floor.receiveShadow = true;
  group.add(floor);

  // 난간(안쪽은 낮게: 그 너머로 쏜다)과 기둥
  const railMat = new THREE.MeshBasicMaterial({ color: 0x2f86b8 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x24364d, roughness: 0.5, metalness: 0.6 });
  for (const [r, h] of [[L.r0 + 0.3, 1.3], [L.r1 - 0.3, 2.6]]) {
    const pts = [];
    for (let i = 0; i <= SEG; i++) { const th = L.th0 + (L.th1 - L.th0) * i / SEG, w = toWorld(th, r, L.yAt(th) + h); pts.push(new THREE.Vector3(w.x, w.y, w.z)); }
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), SEG, 0.14, 5), railMat));
  }
  const postGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 6), pillarGeo = new THREE.CylinderGeometry(1.5, 2.1, 1, 10);
  const n = Math.ceil((L.th1 - L.th0) / 0.09);
  const posts = new THREE.InstancedMesh(postGeo, postMat, (n + 1) * 2), M = new THREE.Matrix4();   // 난간 기둥 수백 개를 한 번에 그린다
  group.add(posts);
  for (let i = 0; i <= n; i++) {
    const th = L.th0 + (L.th1 - L.th0) * i / n, y = L.yAt(th);
    [[L.r0 + 0.3, 1.3], [L.r1 - 0.3, 2.6]].forEach(([r, h], k) => {
      const w = toWorld(th, r, y + h / 2);
      posts.setMatrixAt(i * 2 + k, M.makeScale(1, h, 1).setPosition(w.x, w.y, w.z));
    });
    if (i % 4 === 0) {
      // 두 바퀴째는 아래 바퀴 통로 위를 지나므로 용암까지 기둥을 내리지 않고(통로 한가운데를 막는다) 짧은 부양 장치만 단다
      const upper = th - Math.PI * 2 >= L.th0;
      const w = toWorld(th, L.rc, 0), h = upper ? 2.2 : y - T - CFG.lavaY + 3;
      const m = new THREE.Mesh(pillarGeo, upper ? railMat : postMat);
      m.position.set(w.x, y - T - h / 2, w.z); m.scale.y = h; group.add(m);
    }
  }
  return group;
}

// ── 조립 ────────────────────────────────────────────────
export function buildWorld(scene, course) {
  const fog = new THREE.FogExp2(COLORS.fog, 0.0021);
  scene.fog = fog;
  scene.background = new THREE.Color(COLORS.fog);
  const sky = makeSky(fog), lava = makeLava(fog);
  scene.add(sky, makeBackdrop(), lava);

  // 조명: 차가운 달빛 + 용암의 붉은 반사광
  scene.add(new THREE.HemisphereLight(0x9fb0ff, 0xff5a1c, 1.6));
  const moon = new THREE.DirectionalLight(0xd6e4ff, 2.8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 420 });
  moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.6;
  scene.add(moon, moon.target);
  const ember = new THREE.DirectionalLight(0xff7a30, 0.9);   // 아래에서 올라오는 열기
  ember.position.set(0, -1, 0);
  scene.add(ember);

  const tt = towerTextures();
  const H = 520;
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(CFG.towerRadius, CFG.towerRadius, H, 128, 1, true),
    new THREE.MeshStandardMaterial({ map: tt.map, emissiveMap: tt.emis, emissive: 0xffffff, emissiveIntensity: 1.4, bumpMap: tt.bump, bumpScale: 2.5, roughness: 0.92, metalness: 0.05 }),
  );
  for (const t of [tt.map, tt.emis, tt.bump]) t.repeat.set(12, H / (2 * Math.PI * CFG.towerRadius / 12));
  tower.position.y = H / 2 - 40; tower.receiveShadow = true; tower.castShadow = true;
  scene.add(tower);
  new THREE.TextureLoader().load('assets/img/wall.webp', (map) => {
    const S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(map.image, 0, 0, S, S);
    const img = g.getImageData(0, 0, S, S), d = img.data;
    for (let i = 0; i < d.length; i += 4) {             // 주황 균열만 남겨 발광 맵으로
      const e = Math.min(1, Math.max(0, (d[i] - d[i + 2] * 1.5 - 30) / 110));
      d[i] *= e; d[i + 1] *= e * 0.75; d[i + 2] *= e * 0.25;
    }
    g.putImageData(img, 0, 0);
    const emis = new THREE.CanvasTexture(c);
    const rep = 10, tile = (2 * Math.PI * CFG.towerRadius) / rep;
    for (const t of [map, emis]) { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.repeat.set(rep, H / tile); t.anisotropy = 8; }
    Object.assign(tower.material, { map, emissiveMap: emis, bumpMap: map, bumpScale: 3.2, emissiveIntensity: 2.4 });
    tower.material.color.setScalar(1.35);
    tower.material.needsUpdate = true;
  });
  // 용암에 잠긴 밑동의 열기
  const heat = canvasTex(64, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,90,20,0)'); gr.addColorStop(0.7, 'rgba(255,90,20,0.35)'); gr.addColorStop(1, 'rgba(255,170,60,0.9)');
    g.clearRect(0, 0, 64, 64); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(CFG.towerRadius + 0.3, CFG.towerRadius + 0.3, 16, 96, 1, true),
    new THREE.MeshBasicMaterial({ map: heat, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  skirt.position.y = CFG.lavaY + 8;
  scene.add(skirt);

  const plats = course.platforms.map((p) => makePlatform(p, p.kind === 'pad' ? padLabel(course, p.padIndex) : ''));
  for (const v of plats) scene.add(v.group);
  const flags = [];
  course.pads.forEach((p, i) => {
    const f = makeFlag(padLabel(course, i), COLORS.pad);
    const w = toWorld(p.thc, CFG.towerRadius, p.top);
    f.position.set(w.x, w.y, w.z); f.rotation.y = p.thc;
    scene.add(f); flags.push(f);
  });
  // 완주 지점의 빛기둥
  const goal = course.pads[course.pads.length - 1], gw = toWorld(goal.thc, goal.r0 + CFG.padRadial / 2, goal.top);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 150, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.set(gw.x, gw.y + 9 + 75, gw.z);          // 머리 위에서 시작해 캐릭터를 가리지 않는다
  scene.add(beam);

  // 출발 게이트(카운트다운 동안 닫힘)
  const p0 = course.pads[0];
  const gate = new THREE.Mesh(
    arcExtrude([[p0.rFull, 7], [p0.r0, 7], [p0.r0, 0], [p0.rFull, 0]], p0.th1 - 0.9 / RP, p0.th1 - 0.6 / RP, 1, () => 0, 0),
    new THREE.MeshBasicMaterial({ color: COLORS.pad, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  gate.position.y = p0.top;
  scene.add(gate);
  scene.add(makeLane(course));

  return {
    moon, plats, gate, flags,
    /** 매 프레임: 계단 위치·경고 연출·셰이더 시간. inView(p): 그 발판이 지금 화면이 비추는 쪽(같은 편·같은 바퀴)에 있는가 */
    update(time, dt, gateClosed, inView) {
      lava.material.uniforms.uTime.value = time;
      sky.material.uniforms.uTime.value = time;
      beam.material.opacity = 0.07 + 0.025 * Math.sin(time * 2);
      gate.material.opacity += ((gateClosed ? 0.14 + 0.05 * Math.sin(time * 6) : 0) - gate.material.opacity) * Math.min(1, dt * 8);
      gate.visible = gate.material.opacity > 0.01;
      for (const v of plats) {
        const p = v.p;
        if (!p.moving) continue;
        const depth = (p.rFull - p.r0 + 0.7) * (1 - p.k);
        let jx = 0, jy = 0;
        const warn = p.state === 'warn';
        if (warn) {                    // 예고: 붉게 깜빡이며 덜덜 떨고 살짝 꺼진다
          const w = p.w || 0;
          jx = Math.sin(time * 70) * 0.13 * (0.4 + w); jy = -0.12 * w + Math.sin(time * 90) * 0.05;
          const blink = Math.sin(time * 34) > 0 ? 1 : 0.25;
          v.top.emissive.setHex(COLORS.warn); v.band.emissive.setHex(COLORS.warn);
          v.top.emissiveIntensity = v.band.emissiveIntensity = 0.8 + 2.4 * blink;
        } else {
          const dim = p.state === 'in' || p.state === 'hidden' ? 0.6 : 1;
          v.top.emissive.copy(v.color); v.band.emissive.copy(v.color);
          v.top.emissiveIntensity = 0.9 * dim; v.band.emissiveIntensity = 1.1 * dim;
        }
        v.mesh.position.set(-depth + jx, jy, 0);
        v.mesh.visible = p.k > 0.01;
        v.warnIcon.visible = warn && inView(p);   // 표식은 가려지지 않게 그리므로, 탑 반대편·다른 바퀴 계단 것은 숨긴다
        if (warn) { const s = 3 + Math.sin(time * 30) * 0.5; v.warnIcon.scale.set(s, s, 1); }
        // 문틀 빛: 곧 나올 때 밝아진다
        const soon = p.state === 'hidden' || p.state === 'ext';
        v.lip.color.setHex(warn ? COLORS.warn : COLORS.moving).multiplyScalar(soon ? 1.6 + Math.sin(time * 20) * 0.4 : warn ? 1.5 : 0.45);
      }
    },
  };
}
