// 렌더러·카메라·후처리. 시뮬레이션 상태를 읽어 그리기만 한다.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CFG } from '../config.js';
import { RP, toWorld } from '../course.js';
import { buildWorld } from './world.js';
import { ActorView, makeGun } from './actors.js';
import { Fx } from './fx.js';

const lerp = (a, b, k) => a + (b - a) * k;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.08;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 3000);
    this.fx = new Fx(this.scene);
    this.views = new Map();
    this.world = null;
    this.cam = { th: 0, r: 100, y: 30, lx: 0, ly: 20, lz: 0, focusY: CFG.startY, snap: true, shake: 0 };
    this.time = 0;
    this.quality = 'high';
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.ray = new THREE.Raycaster();
    this.v = new THREE.Vector3();
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    this.renderer.shadowMap.enabled = q === 'high';
    if (this.world) this.world.moon.castShadow = q === 'high';
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    const pr = Math.min(devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // 세로 화면에서는 시야를 넓혀 다음 발판이 잘리지 않게 한다
    this.camera.fov = w < h ? 72 : 50;
    this.camera.updateProjectionMatrix();
    this.fx.setScale(h * pr / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))));
    this.w = w; this.h = h;
  }

  /** 새 경기: 월드는 한 번만 만들고 캐릭터만 갈아 끼운다 */
  attach(sim) {
    this.sim = sim;
    if (!this.world) { this.world = buildWorld(this.scene, sim.course); this.setQuality(this.quality); }
    else this.world.plats.forEach((v, i) => { v.p = sim.course.platforms[i]; });
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    for (const a of sim.actors) this.views.set(a.id, new ActorView(a, this.scene));
    this.fx.clear();
    this.cam.snap = true;
  }

  /** 시뮬레이션 이벤트 → 연출 */
  onEvent(e) {
    const v = e.a && this.views.get(e.a.id), fx = this.fx;
    switch (e.type) {
      case 'jump': if (v) fx.dust(v.pos.x, v.pos.y, v.pos.z, 0.25); break;
      case 'land': if (v) { v.land(e.v); fx.dust(v.pos.x, v.pos.y, v.pos.z, Math.min(1.4, e.v / 70)); } break;
      case 'ledge': if (v) { v.land(40); fx.dust(v.pos.x, v.pos.y, v.pos.z, 0.5); } break;
      case 'fall': if (v) { v.die(e.x, e.y, e.z); fx.lavaBurst(e.x, e.y, e.z); if (e.a.p.local) this.cam.shake = 0.5; } break;
      case 'respawn': if (v) { v.onRespawn(); const w = toWorld(e.a.body.th, e.a.body.r, e.a.body.y); fx.sparkle(w.x, w.y, w.z, 0xb6ff8a); if (e.a.p.local) this.cam.snap = true; } break;
      case 'stage': if (v) fx.confetti(v.pos.x, v.pos.y, v.pos.z, e.a.p.local ? 60 : 26); break;
      case 'shot': if (v) v.onFire(); break;
      case 'splash': fx.splash(e); break;
      case 'hit': if (v) { v.onHit(); if (e.a.p.local) this.cam.shake = Math.max(this.cam.shake, 0.25 + e.gun.knock / 60); } break;
      case 'phase': if (e.phase === 'switch' || e.phase === 'countdown') this.cam.snap = true; break;
    }
  }

  /** 화면 좌표(NDC) → 사수가 겨누는 월드 지점. 등반자 몸통 → 계단 면 → 사거리 끝 순. */
  aimPoint(nx, ny, shooter) {
    this.ray.setFromCamera({ x: nx, y: ny }, this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let best = Infinity;
    for (const a of this.sim.actors) {
      if (a.role !== 'climb' || !a.alive) continue;
      const w = toWorld(a.body.th, a.body.r, a.body.y + 2.4);
      const t = (w.x - o.x) * d.x + (w.y - o.y) * d.y + (w.z - o.z) * d.z;
      if (t <= 0 || t > best) continue;
      const px = o.x + d.x * t - w.x, py = o.y + d.y * t - w.y, pz = o.z + d.z * t - w.z;
      if (Math.hypot(px, pz) < 2.2 && Math.abs(py) < 3.4) best = t;
    }
    if (best === Infinity) {
      // 계단 중심 반지름의 원통과 만나는 앞쪽 점
      const A = d.x * d.x + d.z * d.z, B = 2 * (o.x * d.x + o.z * d.z), Cc = o.x * o.x + o.z * o.z - RP * RP;
      const disc = B * B - 4 * A * Cc;
      if (disc > 0 && A > 1e-6) { const t = (-B - Math.sqrt(disc)) / (2 * A); if (t > 0) best = t; }
    }
    if (best === Infinity) best = 75;
    const p = { x: o.x + d.x * best, y: Math.max(CFG.lavaY + 0.5, o.y + d.y * best), z: o.z + d.z * best };
    if (shooter) {
      const s = toWorld(shooter.body.th, shooter.body.r, shooter.body.y + 3);
      p.dist = Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);
    }
    return p;
  }

  /** 상점·HUD용 물총 그림: 실제 3D 모델을 작은 캔버스에 그려 이미지로 만든다(레벨 표시 포함). */
  gunThumb(id, level) {
    const key = id + level;
    this.thumbs = this.thumbs || {};
    if (this.thumbs[key]) return this.thumbs[key];
    if (!this.thumbR) {
      const r = (this.thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }));
      r.setSize(360, 240); r.toneMapping = THREE.ACESFilmicToneMapping;
      const s = (this.thumbScene = new THREE.Scene());
      s.add(new THREE.HemisphereLight(0xffffff, 0x554466, 2.2));
      const d = new THREE.DirectionalLight(0xffffff, 2.4); d.position.set(2, 4, 3); s.add(d);
      this.thumbCam = new THREE.OrthographicCamera(-2.4, 2.4, 1.6, -1.6, 0.1, 50);
      this.thumbCam.position.set(-3, 3, 7); this.thumbCam.lookAt(0, 0, 0);
    }
    const gun = makeGun(id, level);
    // 틀 맞춤은 Lv.0 크기 기준: 레벨 장식이 붙어도 그림 크기가 달라지지 않는다
    const box = new THREE.Box3().setFromObject(makeGun(id, 0)), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    gun.position.sub(c);
    const holder = new THREE.Group();
    holder.add(gun); holder.rotation.y = -Math.PI / 2 + 0.5;
    holder.scale.setScalar(3.3 / Math.max(size.z, size.y * 1.35));      // 세 총 모두 틀에 꽉 차게
    this.thumbScene.add(holder);
    this.thumbR.render(this.thumbScene, this.thumbCam);
    this.thumbScene.remove(holder);
    return (this.thumbs[key] = this.thumbR.domElement.toDataURL('image/png'));
  }

  project(v3, out) {
    this.v.copy(v3).project(this.camera);
    out.x = (this.v.x * 0.5 + 0.5) * this.w; out.y = (-this.v.y * 0.5 + 0.5) * this.h;
    out.visible = this.v.z < 1 && this.v.z > -1;
    return out;
  }

  updateCamera(dt, local, mode) {
    const c = this.cam, cam = this.camera;
    let tth, tr, ty, lx, ly, lz, kT = 9, kR = 5, kY = 5;
    if (mode === 'orbit' || !local) {
      tth = this.time * 0.07 + 1.2; tr = 190; ty = 78;
      lx = 0; ly = 40; lz = 0; kT = kR = kY = 2;
    } else {
      const v = this.views.get(local.id), b = local.body;
      const th = b.pth + (b.th - b.pth) * this.alpha, r = b.pr + (b.r - b.pr) * this.alpha, y = b.py + (b.y - b.py) * this.alpha;
      if (local.role === 'climb') {
        // 높이는 디딘 발판 기준으로 천천히 따라가서 점프마다 화면이 출렁이지 않게 한다
        if (b.ground) c.focusY = lerp(c.focusY, y, damp(7, dt));
        else if (y > c.focusY + 7) c.focusY = lerp(c.focusY, y - 7, damp(6, dt));
        else if (y < c.focusY - 3) c.focusY = lerp(c.focusY, Math.max(y, c.focusY - 14), damp(3, dt));
        const dead = !local.alive;
        const portrait = this.w < this.h;
        // 살짝 뒤쪽 바깥에서 비스듬히: 앞으로 올라갈 계단이 화면 오른쪽에 길게 보인다
        tth = th - 10 / RP; tr = RP + (portrait ? 56 : 43); ty = c.focusY + (portrait ? 24 : 18);
        const ahead = toWorld(th + (portrait ? 5 : 13) / RP, RP, c.focusY + 3.5);
        lx = ahead.x; lz = ahead.z; ly = ahead.y;
        if (dead && v?.death) ly = Math.max(CFG.lavaY + 6, c.focusY - 6);
        else if (y < c.focusY - 4) ly = lerp(ahead.y, y + 3, 0.6);   // 떨어질 때는 아래를 내려다본다
        kT = 7;
      } else {
        tth = th; tr = r + 23; ty = y + 15;
        const look = toWorld(th, RP, y + 6.5);
        lx = look.x; ly = look.y; lz = look.z;
        kT = 12; kR = 8; kY = 8;
      }
    }
    if (c.snap) { c.th = tth; c.r = tr; c.y = ty; c.lx = lx; c.ly = ly; c.lz = lz; c.snap = false; }
    c.th = lerp(c.th, tth, damp(kT, dt)); c.r = lerp(c.r, tr, damp(kR, dt)); c.y = lerp(c.y, ty, damp(kY, dt));
    const kl = damp(8, dt);
    c.lx = lerp(c.lx, lx, kl); c.ly = lerp(c.ly, ly, kl); c.lz = lerp(c.lz, lz, kl);
    const p = toWorld(c.th, c.r, c.y);
    c.shake = Math.max(0, c.shake - dt * 1.8);
    const sh = c.shake * c.shake * 1.6;
    cam.position.set(p.x + (Math.random() - 0.5) * sh, p.y + (Math.random() - 0.5) * sh, p.z + (Math.random() - 0.5) * sh);
    cam.lookAt(c.lx, c.ly, c.lz);
  }

  render(dt, alpha, local, mode) {
    const sim = this.sim;
    if (!sim) return;
    this.time += dt; this.alpha = alpha;
    this.world.update(this.time, dt, sim.phase === 'countdown' || sim.phase === 'switch');
    for (const v of this.views.values()) v.update(dt, this.time, alpha, sim.course, this.fx);
    this.updateCamera(dt, local, mode);
    // 캐릭터가 카메라에 너무 가까우면 숨겨서 화면을 막지 않게 한다
    for (const v of this.views.values()) if (v.root.visible && v.a !== local && v.pos.distanceTo(this.camera.position) < 5) v.root.visible = false;
    this.fx.syncShots(sim, alpha);
    this.fx.syncAims(sim, this.views);
    this.fx.embers(this.camera.position, dt);
    this.fx.update(dt, this.camera);
    // 그림자 영역을 주인공 주변으로
    const f = local ? this.views.get(local.id).pos : this.v.set(0, 30, 0);
    // 달빛은 카메라 오른쪽 뒤 위에서: 탑을 돌아 올라가도 보이는 면이 늘 밝다
    const moon = this.world.moon, lp = toWorld(this.cam.th + 0.55, this.cam.r + 120, f.y + 170);
    moon.target.position.copy(f);
    moon.position.set(lp.x, lp.y, lp.z);
    if (this.quality === 'high') this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
