// 효과음: assets/sfx/manifest.json 에 적힌 mp3가 있으면 그것을 쓰고, 없으면 WebAudio 합성음으로 대신한다.

export class Sfx {
  constructor(settings) {
    this.s = settings; this.ctx = null; this.buf = {}; this.loops = {};
    this.lis = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
    this.last = {};
  }
  /** 첫 사용자 입력에서 호출(브라우저 자동재생 정책) */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.apply();
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, len);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    fetch('assets/sfx/manifest.json').then(r => (r.ok ? r.json() : [])).then((names) => {
      for (const name of Array.isArray(names) ? names : []) {
        fetch(`assets/sfx/${name}.mp3`).then(r => (r.ok ? r.arrayBuffer() : Promise.reject())).then(a => this.ctx.decodeAudioData(a))
          .then(b => { this.buf[name] = b; if (this.loops[name]?.want) this.loop(name, this.loops[name].vol); }).catch(() => {});
      }
    }).catch(() => {});
  }
  apply() { if (this.master) this.master.gain.value = this.s.muted ? 0 : this.s.volume; }
  setListener(cam, right) { const l = this.lis; l.x = cam.x; l.y = cam.y; l.z = cam.z; l.rx = right.x; l.rz = right.z; }

  out(vol, pos) {
    const c = this.ctx, g = c.createGain();
    let v = vol, pan = 0;
    if (pos) {
      const l = this.lis, dx = pos.x - l.x, dy = pos.y - l.y, dz = pos.z - l.z, d = Math.hypot(dx, dy, dz);
      v *= 1 / (1 + (d / 45) ** 2);
      pan = Math.max(-0.8, Math.min(0.8, (dx * l.rx + dz * l.rz) / (d + 1)));
    }
    g.gain.value = v;
    if (pos && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(this.master); }
    else g.connect(this.master);
    return g;
  }
  tone(dst, f0, f1, dur, type = 'sine', vol = 0.3, at = 0) {
    const c = this.ctx, t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dst); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dst, f0, f1, dur, vol = 0.3, type = 'lowpass', at = 0, q = 1) {
    const c = this.ctx, t = c.currentTime + at, n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = this.noiseBuf; n.loop = true;
    f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(dst); n.start(t, Math.random()); n.stop(t + dur + 0.02);
  }

  /** name 재생. o = { vol, rate, pos(월드 좌표), gap(같은 소리 최소 간격 초) } */
  play(name, o = {}) {
    const c = this.ctx;
    if (!c || c.state !== 'running' || this.s.muted) return;
    const now = c.currentTime;
    if (o.gap && now - (this.last[name] || 0) < o.gap) return;
    this.last[name] = now;
    const vol = o.vol ?? 1, dst = this.out(vol, o.pos);
    const b = this.buf[name];
    if (b) {
      const src = c.createBufferSource();
      src.buffer = b; src.playbackRate.value = (o.rate || 1) * (0.96 + Math.random() * 0.08);
      src.connect(dst); src.start();
      return;
    }
    const T = (...a) => this.tone(dst, ...a), N = (...a) => this.noise(dst, ...a);
    const arp = (notes, step, type = 'triangle', v = 0.22, len = 0.16) => notes.forEach((f, i) => T(f, f, len, type, v, i * step));
    switch (name) {
      case 'jump': T(300, 620, 0.13, 'sine', 0.22); break;
      case 'land': N(500, 120, 0.12, 0.3); T(120, 60, 0.1, 'sine', 0.25); break;
      case 'warn': for (let i = 0; i < 4; i++) T(980, 980, 0.045, 'square', 0.12, i * 0.12); break;
      case 'retract': N(320, 70, 0.55, 0.3, 'bandpass', 0, 2); T(90, 50, 0.5, 'sawtooth', 0.08); break;
      case 'extend': N(90, 380, 0.4, 0.22, 'bandpass', 0, 2); T(140, 180, 0.08, 'square', 0.1, 0.38); break;
      case 'shot_basic': N(2400, 500, 0.14, 0.3, 'bandpass', 0, 1.5); T(760, 280, 0.12, 'sine', 0.16); break;
      case 'shot_rapid': N(3600, 900, 0.07, 0.24, 'bandpass', 0, 1.5); T(1100, 520, 0.06, 'sine', 0.12); break;
      case 'shot_heavy': T(200, 55, 0.3, 'sine', 0.45); N(1200, 180, 0.3, 0.35, 'lowpass'); break;
      case 'hit': N(1800, 300, 0.22, 0.45, 'bandpass', 0, 0.8); T(520, 160, 0.16, 'triangle', 0.25); break;
      case 'splash': N(2600, 700, 0.1, 0.16, 'bandpass'); break;
      case 'shield': T(900, 1500, 0.14, 'sine', 0.18); T(1350, 2000, 0.14, 'sine', 0.1, 0.03); break;
      case 'fall': N(5000, 1500, 0.8, 0.3, 'highpass'); T(700, 110, 0.5, 'sawtooth', 0.14); T(160, 50, 0.4, 'sine', 0.3, 0.05); break;
      case 'respawn': arp([523, 784], 0.07, 'sine', 0.18); break;
      case 'stage': arp([523, 659, 784, 1047], 0.075); break;
      case 'finish': arp([523, 659, 784, 1047, 1319, 1568], 0.085, 'triangle', 0.24, 0.3); break;
      case 'coin': arp([1319, 1760], 0.06, 'square', 0.1, 0.1); break;
      case 'buy': arp([784, 988, 1319, 1568], 0.06, 'square', 0.1, 0.14); break;
      case 'upgrade': arp([440, 554, 659, 880, 1109, 1319], 0.055, 'sawtooth', 0.09, 0.2); N(6000, 9000, 0.4, 0.06, 'highpass', 0.2); break;
      case 'equip': T(500, 500, 0.04, 'square', 0.12); T(760, 760, 0.05, 'square', 0.12, 0.07); break;
      case 'click': T(640, 520, 0.04, 'triangle', 0.14); break;
      case 'deny': T(200, 150, 0.14, 'square', 0.12); break;
      case 'count': T(520, 520, 0.11, 'square', 0.14); break;
      case 'go': T(1040, 1040, 0.34, 'square', 0.16); break;
      case 'win': arp([523, 659, 784, 1047, 784, 1047, 1319], 0.11, 'triangle', 0.24, 0.26); break;
      case 'lose': arp([440, 392, 330, 262], 0.16, 'triangle', 0.22, 0.3); break;
      case 'nearmiss': N(2600, 500, 0.18, 0.14, 'bandpass', 0, 3); break;
    }
  }

  /** 반복 재생(용암 배경음·음악). 샘플이 없으면 용암만 합성 잡음으로 대신한다. */
  loop(name, vol = 0.3) {
    const c = this.ctx;
    const L = (this.loops[name] = this.loops[name] || {});
    L.want = true; L.vol = vol;
    if (!c) return;
    const real = !!this.buf[name];
    if (L.node && (L.real || !real)) { L.gain.gain.value = vol; return; }   // 이미 가장 좋은 소스로 재생 중
    if (L.node) { try { L.node.stop(); } catch { /* 이미 멈춤 */ } L.node = null; }
    if (!real && name !== 'lava_loop') return;
    const g = c.createGain(); g.gain.value = vol; g.connect(this.master);
    const src = c.createBufferSource();
    src.loop = true;
    if (real) { src.buffer = this.buf[name]; src.connect(g); }
    else { src.buffer = this.noiseBuf; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 170; src.connect(f).connect(g); }
    src.start();
    L.node = src; L.gain = g; L.real = real;
  }
  setLoop(name, vol) { const L = this.loops[name]; if (L) { L.vol = vol; if (L.gain) L.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.4); } }
}
