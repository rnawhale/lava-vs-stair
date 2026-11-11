// 입자·물줄기·튀김·조준선. 화면을 가리지 않도록 작고 짧게 쓴다.
import * as THREE from 'three';
import { CFG } from '../config.js';

class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */`attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`varying vec4 vC;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, ${additive ? '0.0' : '0.55'}, d) * vC.a; if (a < 0.01) discard;
          gl_FragColor = vec4(vC.rgb, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 10;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, color, alpha = 1, grav = 0, drag = 0, grow = 0) {
    const i = this.i; this.i = (i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.maxLife[i] = life; this.size0[i] = size; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
    this.col[i * 4] = color.r; this.col[i * 4 + 1] = color.g; this.col[i * 4 + 2] = color.b; this.alpha0[i] = alpha;
  }
  update(dt) {
    const { pos, vel, life, maxLife, size, size0, col } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (size[i] !== 0) size[i] = 0; continue; }
      life[i] -= dt;
      const k = Math.max(0, life[i] / maxLife[i]), d = Math.max(0, 1 - this.drag[i] * dt);
      vel[i * 3] *= d; vel[i * 3 + 2] *= d; vel[i * 3 + 1] = vel[i * 3 + 1] * d - this.grav[i] * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] = size0[i] * (1 + this.grow[i] * (1 - k));
      col[i * 4 + 3] = this.alpha0[i] * Math.min(1, k * 2.2);
    }
    this.geo.attributes.position.needsUpdate = this.geo.attributes.aColor.needsUpdate = this.geo.attributes.aSize.needsUpdate = true;
  }
}

const C = (hex) => new THREE.Color(hex);
const WATER = [C(0x9be3ff), C(0x5cc6ff), C(0xe8fbff)];
const DUST = [C(0x8d8494), C(0x6f6878)];
const FIRE = [C(0xffb020), C(0xff5a10), C(0xffe680)];
const CONFETTI = [C(0xff5fa2), C(0x2fe0c2), C(0xffd23f), C(0x7cc8ff), C(0xb6ff5a), C(0xffffff)];
const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
const pick = (xs) => xs[(Math.random() * xs.length) | 0];

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.soft = new Particles(scene, 1400, false);
    this.add = new Particles(scene, 900, true);
    // 물줄기 덩어리
    this.shotGeo = new THREE.SphereGeometry(1, 12, 8);
    this.shotMats = {};
    for (const id of CFG.gunOrder) {
      this.shotMats[id] = new THREE.MeshStandardMaterial({ color: 0xbfeeff, emissive: id === 'basic' ? 0x2f9cff : id === 'rapid' ? 0x37d6c0 : 0x4fb4ff, emissiveIntensity: 1.5, roughness: 0.1, transparent: true, opacity: 0.92 });
    }
    this.shots = new Map();
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.82, 1, 28);
    this.aims = new Map();
    this.v = new THREE.Vector3();
  }
  setScale(px) { this.soft.mat.uniforms.uScale.value = this.add.mat.uniforms.uScale.value = px; }

  // ── 물 ──
  syncShots(sim, alpha) {
    const seen = new Set();
    for (const s of sim.shots) {
      if (!s.alive) continue;
      seen.add(s);
      let m = this.shots.get(s);
      if (!m) {
        m = new THREE.Mesh(this.shotGeo, this.shotMats[s.gun.id]);
        this.scene.add(m); this.shots.set(s, m);
      }
      const x = s.px + (s.x - s.px) * alpha, y = s.py + (s.y - s.py) * alpha, z = s.pz + (s.z - s.pz) * alpha;
      m.position.set(x, y, z);
      const r = s.gun.radius * 0.8, wob = 1 + Math.sin(s.traveled * 0.9) * 0.12;
      m.scale.set(r * wob, r / wob, r * (s.gun.id === 'heavy' ? 1.5 : 2.6));
      m.lookAt(x + s.vx, y + s.vy, z + s.vz);
      // 뒤로 흩날리는 물방울
      const n = s.gun.id === 'heavy' ? 2 : 1;
      for (let i = 0; i < n; i++) this.soft.emit(x + rnd(r * 0.6), y + rnd(r * 0.6), z + rnd(r * 0.6), s.vx * 0.12 + rnd(2), s.vy * 0.12 + rnd(2), s.vz * 0.12 + rnd(2), 0.28 + Math.random() * 0.2, 0.5 + r * 0.7, pick(WATER), 0.75, 22, 1.5);
    }
    for (const [s, m] of this.shots) if (!seen.has(s)) { this.scene.remove(m); this.shots.delete(s); }
  }

  ring(x, y, z, color, size, life = 0.35) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.position.set(x, y, z); m.renderOrder = 11;
    this.scene.add(m);
    this.rings.push({ m, t: 0, life, size });
  }

  splash(e) {
    const { x, y, z, kind } = e, big = e.gun?.id === 'heavy' ? 1.6 : e.gun?.id === 'rapid' ? 0.75 : 1;
    if (kind === 'steam') {
      for (let i = 0; i < 6; i++) this.soft.emit(x + rnd(1), CFG.lavaY + 0.5, z + rnd(1), rnd(2), 5 + Math.random() * 5, rnd(2), 0.9, 2.2, C(0xffffff), 0.5, -2, 0.8, 1.6);
      return;
    }
    if (kind === 'mist') {
      for (let i = 0; i < 5; i++) this.soft.emit(x, y, z, rnd(5), rnd(4), rnd(5), 0.3, 0.7 * big, pick(WATER), 0.5, 20, 2);
      return;
    }
    const n = (kind === 'hit' ? 26 : kind === 'shield' ? 10 : 12) * big;
    for (let i = 0; i < n; i++) {
      const sp = (kind === 'hit' ? 18 : 11) * (0.4 + Math.random() * 0.8);
      const a = Math.random() * Math.PI * 2, u = Math.random() * 1.4 - 0.3;
      this.soft.emit(x, y, z, Math.cos(a) * sp, u * sp, Math.sin(a) * sp, 0.4 + Math.random() * 0.35, (0.55 + Math.random() * 0.7) * big, pick(WATER), 0.9, 58, 1.2);
    }
    this.ring(x, y, z, kind === 'shield' ? 0xb6ff8a : 0xbfeeff, (kind === 'hit' ? 5 : 2.6) * big, kind === 'hit' ? 0.4 : 0.28);
    if (kind === 'hit') this.ring(x, y, z, 0xffffff, 2.6 * big, 0.22);
  }

  // ── 흙먼지·불·축하 ──
  dust(x, y, z, power = 1) {
    const n = Math.round(5 + power * 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(0.3), sp = 4 + power * 5;
      this.soft.emit(x + Math.cos(a) * 0.7, y + 0.25, z + Math.sin(a) * 0.7, Math.cos(a) * sp, 1.5 + Math.random() * 2, Math.sin(a) * sp, 0.4 + Math.random() * 0.2, 1.2 + power * 0.7, pick(DUST), 0.5, 3, 4, 1.2);
    }
  }
  flame(x, y, z) {
    for (let i = 0; i < 2; i++) this.add.emit(x + rnd(0.5), y + rnd(0.4), z + rnd(0.5), rnd(3), -5 - Math.random() * 7, rnd(3), 0.3 + Math.random() * 0.15, 1.3 + Math.random() * 0.7, pick(FIRE), 0.55, -6, 1);
  }
  lavaBurst(x, y, z) {
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, sp = 6 + Math.random() * 16;
      this.add.emit(x, y + 0.5, z, Math.cos(a) * sp, 14 + Math.random() * 24, Math.sin(a) * sp, 0.7 + Math.random() * 0.6, 1.2 + Math.random() * 1.6, pick(FIRE), 1, 46, 0.4);
    }
    for (let i = 0; i < 8; i++) this.soft.emit(x + rnd(2), y + 1, z + rnd(2), rnd(3), 5 + Math.random() * 6, rnd(3), 1.3, 3.5, C(0x2a1c1c), 0.55, -1, 0.6, 1.5);
    this.ring(x, y + 0.4, z, 0xffa030, 9, 0.5);
  }
  poof(x, y, z) {
    for (let i = 0; i < 16; i++) this.soft.emit(x, y, z, rnd(9), rnd(9), rnd(9), 0.6 + Math.random() * 0.3, 2.6, i % 3 ? C(0x4a4450) : C(0xd8d0e0), 0.7, -2, 3.2, 1.2);
  }
  confetti(x, y, z, n = 46) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 5 + Math.random() * 13;
      this.soft.emit(x, y + 2, z, Math.cos(a) * sp, 16 + Math.random() * 18, Math.sin(a) * sp, 1.2 + Math.random() * 0.8, 0.7 + Math.random() * 0.5, pick(CONFETTI), 1, 30, 1.6);
    }
    this.ring(x, y + 0.3, z, 0xb6ff5a, 12, 0.6);
  }
  sparkle(x, y, z, color = 0xffffff) {
    for (let i = 0; i < 12; i++) this.add.emit(x + rnd(1.5), y + 1 + Math.random() * 4, z + rnd(1.5), rnd(3), 4 + Math.random() * 6, rnd(3), 0.5 + Math.random() * 0.3, 1.1, C(color), 0.9, 0, 1);
  }
  /** 화면 주변을 떠오르는 불티 */
  embers(cam, dt) {
    this._e = (this._e || 0) + dt * 26;
    while (this._e > 1) {
      this._e -= 1;
      const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 110;
      this.add.emit(cam.x + Math.cos(a) * d, CFG.lavaY + Math.random() * 6, cam.z + Math.sin(a) * d, rnd(1.5), 5 + Math.random() * 9, rnd(1.5), 5 + Math.random() * 5, 0.5 + Math.random() * 0.6, pick(FIRE), 0.9, -0.6, 0.05);
    }
  }

  /** AI가 쏘기 직전 보여 주는 조준선 (피할 틈) */
  syncAims(sim, views) {
    for (const a of sim.actors) {
      let o = this.aims.get(a.id);
      const on = a.role === 'shoot' && a.windup > 0 && a.aim;
      if (!on) { if (o) o.line.visible = o.dot.visible = false; continue; }
      if (!o) {
        const col = CFG.guns[a.gun.id].color;
        const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
        const line = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), mat);
        const dot = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
        line.renderOrder = dot.renderOrder = 12;
        this.scene.add(line, dot);
        this.aims.set(a.id, (o = { line, dot, mat }));
      }
      const k = 1 - a.windup / (a.windupMax || 1);
      const from = views.get(a.id).muzzleWorld(this.v), to = a.aim;
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len = Math.hypot(dx, dy, dz);
      o.line.visible = o.dot.visible = true;
      o.line.position.set(from.x + dx / 2, from.y + dy / 2, from.z + dz / 2);
      o.line.scale.set(0.07 + k * 0.07, len, 0.07 + k * 0.07);
      o.line.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, new THREE.Vector3(dx / len, dy / len, dz / len));
      o.mat.opacity = 0.2 + k * 0.55;
      o.mat.color.setHex(CFG.guns[a.gun.id].color);
      o.dot.position.set(to.x, to.y, to.z);
      o.dot.scale.setScalar(2.6 - k * 1.5);
      o.dot.material.color.setHex(CFG.guns[a.gun.id].color);
    }
  }

  update(dt, camera) {
    this.soft.update(dt); this.add.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); continue; }
      r.m.scale.setScalar(0.4 + r.size * (1 - (1 - k) * (1 - k)));
      r.m.material.opacity = 0.9 * (1 - k);
      r.m.quaternion.copy(camera.quaternion);
    }
    for (const o of this.aims.values()) if (o.dot.visible) o.dot.quaternion.copy(camera.quaternion);
  }
  clear() {
    for (const m of this.shots.values()) this.scene.remove(m);
    this.shots.clear();
    for (const o of this.aims.values()) o.line.visible = o.dot.visible = false;
  }
}
