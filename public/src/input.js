// 입력: 키보드·마우스·터치를 "화면 기준 축 + 점프 + 발사 + 조준 위치"로 모은다.
export class Input {
  constructor(canvas, touchRoot) {
    this.keys = new Set();
    this.jumpEdge = false;      // 이번에 새로 눌린 점프(한 번 쓰면 지운다)
    this.mouse = { x: 0, y: 0, down: false, seen: false };
    this.stick = { x: 0, y: 0, id: null };
    this.touchAim = { id: null, x: 0, y: 0 };
    this.touchJump = false;
    this.isTouch = false;
    this.onAny = null;          // 첫 입력(오디오 잠금 해제용)
    this.onKey = null;          // Escape 등 메뉴 키
    const kd = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'Space') this.jumpEdge = true;
        this.onKey?.(e.code);
      }
      this.keys.add(e.code);
      this.onAny?.();
    };
    addEventListener('keydown', kd);
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    canvas.addEventListener('mousemove', (e) => this.setMouse(e));
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { this.setMouse(e); this.mouse.down = true; this.onAny?.(); } });
    addEventListener('mouseup', () => { this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas = canvas;
    if (touchRoot) this.bindTouch(touchRoot);
  }
  setMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    this.mouse.px = e.clientX; this.mouse.py = e.clientY; this.mouse.seen = true;
  }

  bindTouch(root) {
    const stickEl = root.querySelector('.stick'), knob = root.querySelector('.knob'), jump = root.querySelector('.btn-jump');
    const R = 52;
    const moveStick = (t) => {
      const b = stickEl.getBoundingClientRect();
      let dx = t.clientX - (b.left + b.width / 2), dy = t.clientY - (b.top + b.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick.x = dx / R; this.stick.y = -dy / R;
    };
    stickEl.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; this.stick.id = t.identifier; moveStick(t); this.onAny?.(); }, { passive: false });
    jump.addEventListener('touchstart', (e) => { e.preventDefault(); this.jumpEdge = true; this.touchJump = true; jump.classList.add('on'); this.onAny?.(); }, { passive: false });
    jump.addEventListener('touchend', (e) => { e.preventDefault(); this.touchJump = false; jump.classList.remove('on'); });
    // 조준: 화면(캔버스)을 누른 곳으로 겨누고 누르는 동안 계속 쏜다
    const aim = (t) => {
      const r = this.canvas.getBoundingClientRect();
      this.touchAim.x = ((t.clientX - r.left) / r.width) * 2 - 1;
      this.touchAim.y = -(((t.clientY - r.top) / r.height) * 2 - 1) + 0.16;   // 손가락에 가리지 않게 살짝 위를 겨눈다
      this.touchAim.px = t.clientX; this.touchAim.py = t.clientY - r.height * 0.08;
    };
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault(); this.isTouch = true;
      const t = e.changedTouches[0];
      if (this.touchAim.id === null) { this.touchAim.id = t.identifier; aim(t); }
      this.onAny?.();
    }, { passive: false });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) moveStick(t);
        else if (t.identifier === this.touchAim.id) aim(t);
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) { this.stick.id = null; this.stick.x = this.stick.y = 0; knob.style.transform = ''; }
        if (t.identifier === this.touchAim.id) this.touchAim.id = null;
      }
    };
    addEventListener('touchend', end); addEventListener('touchcancel', end);
    addEventListener('touchstart', () => { this.isTouch = true; document.body.classList.add('touch'); }, { once: true, passive: true });
  }

  /** 화면 기준 축: x=오른쪽, y=위 */
  axes() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (Math.hypot(this.stick.x, this.stick.y) > 0.18) { x = this.stick.x; y = this.stick.y; }
    return { x, y };
  }

  /** 시뮬레이션 입력으로 바꾼다. 카메라가 늘 탑 바깥에서 보므로 두 역할 모두 오른쪽=진행 방향, 위=탑(벽) 쪽. */
  apply(inp, role) {
    const { x, y } = this.axes();
    inp.fwd = x; inp.out = -y;
    if (role === 'climb') {
      if (this.jumpEdge) inp.jump = true;
      inp.hold = this.keys.has('Space') || this.touchJump;
      inp.fire = false;
    } else {
      inp.fire = this.mouse.down || this.keys.has('Space') || this.touchAim.id !== null;
    }
    this.jumpEdge = false;
  }
  aimNdc() { return this.touchAim.id !== null || (this.isTouch && !this.mouse.seen) ? this.touchAim : this.mouse; }
}
