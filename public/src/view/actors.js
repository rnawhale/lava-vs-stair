// 캐릭터(콩 모양 등반자/사수)와 물총 3종 모델 + 절차적 애니메이션.
import * as THREE from 'three';
import { CFG } from '../config.js';
import { toWorld } from '../course.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, ...o });
const glow = (color) => new THREE.MeshBasicMaterial({ color });
const G = {
  body: new THREE.CapsuleGeometry(1.12, 1.35, 6, 18),
  sphere: new THREE.SphereGeometry(1, 16, 12),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  box: new THREE.BoxGeometry(1, 1, 1),
  torus: new THREE.TorusGeometry(1, 0.22, 8, 20),
  cone: new THREE.ConeGeometry(1, 1, 16),
};
const part = (geo, mat, sx, sy, sz, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z);
  return m;
};
/** z축 방향으로 누운 원통 */
const tube = (mat, r, len, x, y, z) => { const m = part(G.cyl, mat, r, len, r, x, y, z); m.rotation.x = Math.PI / 2; return m; };

// ── 물총 ────────────────────────────────────────────────
// 총구는 +z. 장난감 물총처럼 둥글고 통통하게.
// 레벨 표시(실제 외형): 총열의 빛나는 고리 = 레벨 수, 뒤쪽 점등 핍 2개, Lv.2는 금색 총구 + 금색 지느러미
export function makeGun(id, level = 0) {
  const g = new THREE.Group();
  const white = std(0xf4f7ff, { roughness: 0.3 }), dark = std(0x2f3542, { roughness: 0.5, metalness: 0.3 });
  const gold = std(0xffcf3a, { roughness: 0.25, metalness: 0.75, emissive: 0x8a5a00, emissiveIntensity: 0.6 });
  const mark = glow(0x9ff6ff);
  const tank = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.12, transparent: true, opacity: 0.78, emissive: c, emissiveIntensity: 0.45 });
  const cap = (mat, r, len, x, y, z) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 5, 14), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); return m; };
  let muzzle = 2, ringR = 0.3, ringZ = [1.1], barrels = [0], top = 0.9;
  if (id === 'basic') {                                   // 파랑·흰색의 짧은 물총
    const blue = std(0x2f86ff, { roughness: 0.35 });
    g.add(cap(white, 0.36, 0.9, 0, 0, 0.45), tube(white, 0.22, 0.75, 0, 0, 1.3));
    g.add(tube(level >= 2 ? gold : blue, 0.27, 0.22, 0, 0, 1.74));
    g.add(cap(tank(0x4db4ff), 0.3, 0.42, 0, 0.52, 0.2));                       // 짧은 물통
    const grip = part(G.box, blue, 0.32, 0.8, 0.38, 0, -0.6, 0.02); grip.rotation.x = 0.25; g.add(grip);
    g.add(part(G.box, std(0xff8a3c), 0.12, 0.26, 0.12, 0, -0.42, 0.42), part(G.box, blue, 0.28, 0.2, 0.5, 0, -0.34, 1.0));
    muzzle = 1.9; ringR = 0.3; ringZ = [1.05, 1.36]; top = 0.82;
  } else if (id === 'rapid') {                            // 초록 이중 물통, 쌍총열
    const green = std(0x25c962, { roughness: 0.35 }), lime = std(0xc6ff5a, { emissive: 0x4a7a00, emissiveIntensity: 0.4 });
    barrels = [-0.28, 0.28];
    for (const x of barrels) {
      g.add(tube(dark, 0.16, 1.25, x, 0, 0.95), tube(level >= 2 ? gold : lime, 0.2, 0.18, x, 0, 1.62));
      g.add(cap(tank(0x5df08a), 0.25, 0.75, x, 0.5, 0.1));                     // 이중 물통
    }
    g.add(part(G.box, green, 1.0, 0.5, 0.95, 0, -0.02, 0.2), part(G.box, white, 1.04, 0.12, 0.3, 0, 0.05, 0.56));
    const grip = part(G.box, dark, 0.32, 0.75, 0.36, 0, -0.56, 0); grip.rotation.x = 0.25; g.add(grip);
    muzzle = 1.75; ringR = 0.22; ringZ = [0.95, 1.24]; top = 0.75;
  } else {                                                // 주황색 큰 탱크 물대포
    const orange = std(0xff8a2a, { roughness: 0.35 }), deep = std(0xc85a12, { roughness: 0.4 });
    g.add(tube(dark, 0.4, 1.5, 0, 0, 1.2), part(G.box, orange, 0.92, 0.82, 1.3, 0, 0, 0.15));
    const bell = part(G.cone, level >= 2 ? gold : orange, 0.6, 0.5, 0.6, 0, 0, 2.08); bell.rotation.x = -Math.PI / 2; g.add(bell);
    g.add(cap(tank(0xffa23c), 0.66, 0.85, 0, 1.0, 0.05));                      // 큰 탱크
    for (const z of [-0.4, 0.5]) { const strap = part(G.torus, deep, 0.67, 0.67, 0.67, 0, 1.0, z); strap.scale.z = 0.5; g.add(strap); }
    const grip = part(G.box, dark, 0.36, 0.8, 0.4, 0, -0.72, -0.1); grip.rotation.x = 0.25; g.add(grip);
    g.add(part(G.box, dark, 0.3, 0.28, 0.7, 0, -0.52, 1.0));
    muzzle = 2.35; ringR = 0.48; ringZ = [1.1, 1.5]; top = 1.66;
  }
  for (let i = 0; i < level; i++) for (const x of barrels) g.add(part(G.torus, mark, ringR, ringR, ringR, x, 0, ringZ[i]));
  for (let i = 0; i < 2; i++) g.add(part(G.sphere, i < level ? mark : dark, 0.12, 0.12, 0.12, -0.16 + i * 0.32, id === 'heavy' ? 0.47 : 0.3, -0.36));
  if (level >= 2) {
    const fin = part(G.cone, gold, 0.28, 0.6, 0.28, 0, top + 0.22, 0); fin.scale.x = 0.07; fin.geometry = FIN; g.add(fin);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData = { id, level, muzzle };
  return g;
}
const FIN = new THREE.ConeGeometry(1, 1, 4);

// ── 캐릭터 ──────────────────────────────────────────────
let shadowTex;
const blobTexture = () => {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.7)'); grad.addColorStop(0.6, 'rgba(0,0,0,0.38)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return (shadowTex = new THREE.CanvasTexture(c));
};

export class ActorView {
  constructor(actor, scene) {
    this.a = actor; this.scene = scene;
    const team = CFG.teams[actor.p.team], bot = actor.p.kind === 'bot';
    const col = new THREE.Color(team.color);
    const root = (this.root = new THREE.Group());
    const tilt = (this.tilt = new THREE.Group());
    root.add(tilt);
    const bodyMat = std(col, { emissive: col, emissiveIntensity: 0.16 });
    this.body = part(G.body, bodyMat, 1, 1, 1, 0, 2.55, 0);
    this.body.castShadow = true;
    const outline = part(G.body, new THREE.MeshBasicMaterial({ color: 0x0a0810, side: THREE.BackSide }), 1.07, 1.045, 1.07);
    this.body.add(outline);
    const belly = part(G.sphere, std(col.clone().lerp(new THREE.Color(0xffffff), 0.55)), 0.78, 0.9, 0.5, 0, -0.35, 0.74);
    this.body.add(belly);
    // 얼굴: 사람은 흰 눈, AI는 검은 바이저 + 빛나는 눈 + 안테나
    const face = (this.face = new THREE.Group());
    face.position.set(0, 0.62, 0);
    if (bot) {
      face.add(part(G.box, std(0x12141c, { roughness: 0.2, metalness: 0.6 }), 1.55, 0.62, 0.5, 0, 0, 0.84));
      const eye = glow(0x7df9ff);
      this.eyes = [part(G.box, eye, 0.24, 0.3, 0.1, -0.36, 0, 1.1), part(G.box, eye, 0.24, 0.3, 0.1, 0.36, 0, 1.1)];
      face.add(...this.eyes);
      const ant = part(G.cyl, std(0xcfd5e6, { metalness: 0.7 }), 0.06, 0.9, 0.06, 0, 1.75, 0);
      this.bulb = part(G.sphere, glow(0xffe14a), 0.22, 0.22, 0.22, 0, 2.28, 0);
      this.body.add(ant, this.bulb);
    } else {
      const white = std(0xffffff, { roughness: 0.2 }), black = std(0x10131a, { roughness: 0.2 });
      this.eyes = [];
      for (const x of [-0.42, 0.42]) {
        const e = part(G.sphere, white, 0.36, 0.42, 0.3, x, 0, 0.88);
        e.add(part(G.sphere, black, 0.5, 0.52, 0.5, 0, 0, 0.72));
        face.add(e); this.eyes.push(e);
      }
    }
    this.body.add(face);
    const limb = std(col.clone().multiplyScalar(0.55));
    this.feet = [part(G.sphere, limb, 0.5, 0.36, 0.66, -0.52, 0.34, 0.1), part(G.sphere, limb, 0.5, 0.36, 0.66, 0.52, 0.34, 0.1)];
    this.hands = [part(G.sphere, limb, 0.36, 0.36, 0.36, -1.36, 2.3, 0.1), part(G.sphere, limb, 0.36, 0.36, 0.36, 1.36, 2.3, 0.1)];
    for (const m of [...this.feet, ...this.hands]) m.castShadow = true;
    tilt.add(this.body, ...this.feet, ...this.hands);
    this.gunMount = new THREE.Group();
    this.gunMount.position.set(0.62, 2.72, 0.5);
    tilt.add(this.gunMount);
    this.pack = part(G.cyl, std(0x3fa9ff, { transparent: true, opacity: 0.85 }), 0.5, 1.3, 0.5, 0, 2.7, -1.08);
    this.pack.visible = false;
    tilt.add(this.pack);
    // 재등장 보호막
    this.shield = part(G.sphere, new THREE.MeshBasicMaterial({ color: 0xb6ff8a, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }), 3.3, 3.5, 3.3, 0, 2.6, 0);
    root.add(this.shield);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.blob.rotation.x = -Math.PI / 2; this.blob.renderOrder = 2;
    // 내 캐릭터 발밑 고리
    this.ring = null;
    if (actor.p.local) {
      this.ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.85, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
      this.ring.rotation.x = -Math.PI / 2; this.ring.renderOrder = 3;
      scene.add(this.ring);
    }
    scene.add(root, this.blob);
    this.yaw = 0; this.phase = Math.random() * 6; this.squash = 0; this.recoil = 0; this.pop = 1;
    this.hitSpin = 0; this.death = null; this.gunKey = '';
    this.pos = new THREE.Vector3(); this.head = new THREE.Vector3();
  }

  setGun() {
    const a = this.a, key = a.role === 'shoot' ? `${a.gun.id}${a.gun.level}` : '';
    if (key === this.gunKey) return;
    this.gunKey = key;
    this.gunMount.clear();
    this.pack.visible = !!key;
    if (key) {
      this.gun = makeGun(a.gun.id, a.gun.level);
      this.gunMount.add(this.gun);
      this.pack.material.color.setHex(CFG.guns[a.gun.id].color);
    }
  }

  /** 용암에 빠졌을 때: 엉덩이에 불이 붙어 위로 솟구쳤다가 펑 */
  die(x, y, z) { this.death = { t: 0, x, y, z, spin: (Math.random() - 0.5) * 30 }; }
  land(v) { this.squash = Math.min(0.42, v / 130); }
  onHit() { this.hitSpin = 1; }
  onFire() { this.recoil = 1; }
  onRespawn() { this.pop = 0; this.death = null; }

  /** 총구의 월드 좌표(물줄기 시작점 연출용) */
  muzzleWorld(out) {
    if (!this.gun) return out.copy(this.pos).setY(this.pos.y + 3);
    return this.gun.localToWorld(out.set(0, 0, this.gun.userData.muzzle));
  }

  update(dt, time, alpha, course, fx) {
    const a = this.a, b = a.body, root = this.root;
    this.setGun();
    const th = b.pth + (b.th - b.pth) * alpha, r = b.pr + (b.r - b.pr) * alpha, y = b.py + (b.y - b.py) * alpha;
    const w = toWorld(th, r, y);
    this.pos.set(w.x, w.y, w.z);
    const sn = Math.sin(th), cs = Math.cos(th);

    if (this.death && a.alive) { this.death = null; this.pop = 0; }   // 복귀·역할 교대로 다시 살아났으면 연출 종료
    if (this.death) {                                     // 용암 발사 연출
      const d = this.death; d.t += dt;
      const t = d.t, up = 46 * t - 42 * t * t;          // 엉덩이에 불이 붙어 13 stud쯤 솟구친다
      root.visible = t < 1.0;
      root.position.set(d.x, d.y + Math.max(up, -2) + 0.5, d.z);
      root.rotation.set(t * d.spin * 0.4, t * d.spin, 0);
      const s = t < 0.8 ? 1 : Math.max(0.01, 1 - (t - 0.8) * 5);
      root.scale.setScalar(s);
      this.tilt.rotation.set(0, 0, 0);
      this.hands[0].position.set(-1.5, 3.6 + Math.sin(time * 40) * 0.3, 0.1); this.hands[1].position.set(1.5, 3.6 + Math.cos(time * 40) * 0.3, 0.1);
      if (t < 0.95) fx.flame(root.position.x, root.position.y + 0.6, root.position.z);
      if (!d.poof && t >= 0.95) { d.poof = true; fx.poof(root.position.x, root.position.y + 2, root.position.z); }
      this.blob.visible = false; this.shield.visible = false;
      if (this.ring) this.ring.visible = false;
      this.head.copy(root.position).setY(root.position.y + 5.6);
      return;
    }
    root.visible = a.alive || a.role !== 'climb';
    if (!root.visible) { this.blob.visible = false; if (this.ring) this.ring.visible = false; return; }
    root.position.copy(this.pos);
    this.pop = Math.min(1, this.pop + dt * 3.2);
    const popS = this.pop < 1 ? 1 + Math.sin(this.pop * Math.PI) * 0.25 - (1 - this.pop) * 0.6 : 1;
    root.scale.setScalar(Math.max(0.05, popS));

    // 바라보는 방향
    const speed = Math.hypot(b.vt, b.vr);
    let dx, dz;
    if (a.role === 'shoot' && a.aim) { dx = a.aim.x - w.x; dz = a.aim.z - w.z; }
    else if (speed > 1.5) { dx = b.vt * -sn + b.vr * cs; dz = b.vt * -cs + b.vr * -sn; }
    else if (a.role === 'shoot') { dx = -cs; dz = sn; }
    if (dx !== undefined) {
      const want = Math.atan2(dx, dz);
      let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 14);
    } else if (this.yawInit === undefined) { this.yaw = Math.atan2(-sn, -cs); }
    this.yawInit = 1;
    this.hitSpin = Math.max(0, this.hitSpin - dt * 1.6);
    root.rotation.set(0, this.yaw + this.hitSpin * this.hitSpin * 9, 0);

    // 몸 애니메이션
    const air = a.role === 'climb' && !b.ground;
    const run = air ? 0 : Math.min(1, speed / 14);
    this.phase += dt * (5 + speed * 0.95);
    const sw = Math.sin(this.phase), cw = Math.cos(this.phase);
    this.squash = Math.max(0, this.squash - dt * 2.6);
    let sy = 1 - this.squash, sxz = 1 + this.squash * 0.55;
    if (air) { const k = THREE.MathUtils.clamp(b.vy / 50, -0.5, 0.6); sy += k * 0.22; sxz -= k * 0.1; }
    const bob = run * Math.abs(sw) * 0.22 + (run < 0.1 && !air ? Math.sin(time * 2.4 + this.phase) * 0.04 : 0);
    this.body.scale.set(sxz, sy, sxz);
    this.body.position.y = 2.55 * sy + bob + (a.finished ? Math.abs(Math.sin(time * 7)) * 0.9 : 0);
    const stagger = b.kbT > 0 || this.hitSpin > 0.3;
    this.tilt.rotation.x = run * 0.2 + (air ? THREE.MathUtils.clamp(-b.vy / 160, -0.25, 0.35) : 0);
    this.tilt.rotation.z = stagger ? Math.sin(time * 34) * 0.32 : 0;
    const fy = this.body.position.y - 2.55;
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1, foot = this.feet[i], hand = this.hands[i], sx = i ? 0.52 : -0.52;
      if (air) {
        foot.position.set(sx, 0.55 + (b.vy > 0 ? 0.25 : -0.05), 0.1 + s * 0.25);
        const flail = b.vy < -34 || stagger;
        hand.position.set(sx * 2.7, fy + (flail ? 3.7 + Math.sin(time * 30 + i * 2) * 0.45 : 3.1 + b.vy * 0.012), 0.1);
      } else {
        foot.position.set(sx, 0.34 + run * Math.max(0, s * sw) * 0.7, 0.1 + run * s * cw * 0.85);
        hand.position.set(sx * 2.62, fy + 2.3 + (a.finished ? 1.6 : 0), 0.1 - run * s * cw * 0.8);
      }
    }
    if (this.bulb) this.bulb.material.color.setHex(Math.sin(time * 6 + this.phase) > 0 ? 0xffe14a : 0x7a6a1a);

    // 사수: 총을 조준점으로, 반동·조준 예고(windup) 떨림
    if (a.role === 'shoot' && this.gun) {
      this.recoil = Math.max(0, this.recoil - dt * 7);
      if (a.aim) { this.gunMount.lookAt(a.aim.x, a.aim.y, a.aim.z); }
      const wu = a.windup > 0 ? 1 - a.windup / (a.windupMax || 1) : 0;
      this.gun.position.set(wu ? (Math.random() - 0.5) * 0.08 * wu : 0, 0, -this.recoil * 0.55);
      this.gun.scale.setScalar(1 + wu * 0.18);
      this.hands[0].position.set(0.25, 2.5, 1.1); this.hands[1].position.set(0.95, 2.45, 0.6);
    }

    // 보호막·그림자·발밑 고리
    const prot = a.role === 'climb' && a.protectT > 0;
    this.shield.visible = prot;
    if (prot) this.shield.material.opacity = a.protectT < 0.6 ? (Math.sin(time * 40) > 0 ? 0.24 : 0.06) : 0.2 + Math.sin(time * 9) * 0.05;
    let gy = null;
    if (a.role === 'climb') { const p = course.groundBelow(th, r, y + 0.3, 0.3); if (p) gy = p.top; }
    else gy = y;
    this.blob.visible = gy !== null;
    if (gy !== null) {
      const h = Math.max(0, y - gy), s = 3.4 * Math.max(0.45, 1 - h / 22);
      this.blob.position.set(w.x, gy + 0.06, w.z); this.blob.scale.set(s, s, 1);
      this.blob.material.opacity = Math.max(0.35, 1 - h / 18);
    }
    if (this.ring) {
      this.ring.visible = gy !== null;
      if (gy !== null) { this.ring.position.set(w.x, gy + 0.09, w.z); this.ring.material.opacity = 0.5 + 0.25 * Math.sin(time * 5); }
    }
    this.head.set(w.x, w.y + 5.7 + (this.bulb ? 0.9 : 0), w.z);
  }

  dispose() {
    this.scene.remove(this.root, this.blob);
    if (this.ring) this.scene.remove(this.ring);
  }
}
