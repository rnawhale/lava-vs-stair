// 화면 UI(DOM): 타이틀·HUD·교대·결과·상점·일시정지·터치 버튼.
import { CFG, gunStats } from './config.js';
import { buy, upgrade, equip } from './save.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const stars = (n) => '★'.repeat(n) + `<s>${'★'.repeat(5 - n)}</s>`;
const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);
const teamCss = (t) => CFG.teams[t].css;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const OUCH = ['앗 뜨거!', '으아악!', '내 엉덩이!', '뜨뜨뜨!', '살려줘~', '다시 다시!'];
const GUN_TAG = { basic: '균형 잡힌 기본기', rapid: '빠르지만 약하고 짧다', heavy: '느리지만 한 방이 세다' };

export class UI {
  /** hooks: { play, online, restart, quit, resume, pause, ready, again, volume(v), mute(), quality(q), shopChanged(), thumb(id, lv) } */
  constructor(root, save, hooks) {
    this.root = root; this.save = save; this.h = hooks;
    root.innerHTML = `
<div class="hud" hidden>
  <div class="top">
    <div class="role-card"><span class="role-ico"></span><div><b class="role-name"></b><small class="role-goal"></small></div></div>
    <div class="clock"><div class="leg-label"></div><div class="time">120</div>
      <div class="scores"><span class="sc t0"><i></i><b>0.0</b></span><span class="vs">:</span><span class="sc t1"><b>0.0</b><i></i></span></div></div>
    <div class="right"><div class="coins"><span class="coin"></span><b>0</b></div>
      <button class="ib mute" aria-label="음소거"></button><button class="ib pause" aria-label="일시정지">Ⅱ</button></div>
  </div>
  <div class="tower-map"><div class="track"></div></div>
  <div class="stage-card"></div>
  <div class="gun-card"><img alt=""><div class="gun-txt"><b></b><small></small></div><div class="cool"><i></i></div></div>
  <div class="feed"></div>
  <div class="banner"></div>
  <div class="hint" hidden></div>
  <div class="inter" hidden></div>
</div>
<div class="tags"></div><div class="pops"></div><div class="arrows"></div>
<div class="cross" hidden><i></i><span></span></div>
<div class="touch" hidden><div class="stick"><div class="knob"></div></div><button class="btn-jump">점프</button><div class="fire-tip">화면을 눌러 조준·발사</div></div>
<div class="title" hidden>
  <img class="logo-img" src="assets/img/logo.webp" alt="Lava VS Stair" onerror="this.hidden=true;this.nextElementSibling.hidden=false">
  <div class="logo" hidden><span class="l1">LAVA</span><span class="l2">VS</span><span class="l3">STAIR</span></div>
  <p class="tagline">용암 위 계단을 오르고, 물총으로 방해하라!</p>
  <div class="menu">
    <button class="big play">▶ 바로 플레이<small>AI 대전 · 로그인 없음</small></button>
    <button class="mid online">👥 친구 초대 대전<small>2~4인 온라인</small></button>
    <button class="mid shop-open">🔫 물총 상점</button>
  </div>
  <div class="title-foot">
    <div class="chip coins"><span class="coin"></span><b>0</b></div>
    <div class="chip ai"></div>
    <button class="chip opt">⚙ 설정</button>
  </div>
  <p class="keys">PC: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 이동 · <kbd>Space</kbd> 점프 · 마우스 조준/발사 &nbsp;|&nbsp; 모바일: 스틱 + 버튼</p>
</div>
<div class="modal" hidden><div class="sheet"></div></div>
<div class="fade"></div>`;
    this.hud = $('.hud', root); this.title = $('.title', root); this.modal = $('.modal', root); this.sheet = $('.sheet', root);
    this.tags = $('.tags', root); this.pops = $('.pops', root); this.banner = $('.banner', root); this.hintEl = $('.hint', root);
    this.cross = $('.cross', root); this.touch = $('.touch', root); this.inter = $('.inter', root); this.feed = $('.feed', root);
    this.arrows = $('.arrows', root); this.fadeEl = $('.fade', root);
    this.tagEls = new Map(); this.dots = new Map(); this.arrowEls = [];
    this.panel = null; this.lockUntil = 0; this.tmp = { x: 0, y: 0, visible: false };
    const click = (sel, fn) => $(sel, root).addEventListener('click', (e) => { e.currentTarget.blur(); this.h.click?.(); fn(e); });
    click('.play', () => this.h.play());
    click('.online', () => this.h.online());
    click('.shop-open', () => this.openShop());
    click('.opt', () => this.openOptions(false));
    click('.pause', () => this.h.pause());
    click('.mute', () => { this.h.mute(); this.syncSound(); });
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal && this.panel?.dismiss) this.closePanel(); });
    this.syncCoins(); this.syncSound();
  }

  // ── 공통 ──
  syncCoins() { for (const b of this.root.querySelectorAll('.coins b')) b.textContent = this.save.coins; }
  syncSound() { $('.mute', this.root).textContent = this.save.settings.muted ? '🔇' : '🔊'; }
  fade() { this.fadeEl.classList.remove('go'); void this.fadeEl.offsetWidth; this.fadeEl.classList.add('go'); }
  showTitle() {
    this.hud.hidden = true; this.title.hidden = false; this.cross.hidden = true; this.touch.hidden = true;
    this.clearWorldUi(); this.closePanel(true);
    const lv = this.save.aiLevel;
    $('.title .ai', this.root).innerHTML = `🤖 AI ${esc(CFG.ai.levels[lv - 1].name)} <span class="stars">${stars(lv)}</span>`;
    this.syncCoins();
  }
  clearWorldUi() {
    this.tags.innerHTML = ''; this.tagEls.clear(); this.pops.innerHTML = ''; this.arrows.innerHTML = ''; this.arrowEls = [];
    this.feed.innerHTML = ''; this.banner.innerHTML = ''; this.hintEl.hidden = true; this.inter.hidden = true;
  }

  // ── 경기 HUD ──
  startMatch(sim, me, isTouch) {
    this.sim = sim; this.me = me;
    this.title.hidden = true; this.hud.hidden = false; this.clearWorldUi(); this.closePanel(true);
    const track = $('.tower-map .track', this.root);
    track.innerHTML = ''; this.dots.clear();
    sim.course.pads.forEach((p, i) => {
      const m = el(`<div class="mark"><span>${['출발', 'S1', 'S2', 'GOAL'][i]}</span></div>`);
      m.style.bottom = (p.thc / sim.course.thEnd) * 100 + '%'; track.append(m);
    });
    for (const a of sim.actors) {
      const tag = el(`<div class="tag${a.p.local ? ' me' : ''}" style="--c:${teamCss(a.p.team)}">${a.p.kind === 'bot' ? '<i class="ai">AI</i>' : ''}<span>${esc(a.p.local ? '나' : a.p.name)}</span><em></em></div>`);
      this.tags.append(tag); this.tagEls.set(a.id, tag);
      const dot = el(`<div class="dot${a.p.local ? ' me' : ''}" style="--c:${teamCss(a.p.team)}">${a.p.kind === 'bot' ? '🤖' : ''}</div>`);
      track.append(dot); this.dots.set(a.id, dot);
    }
    for (const t of [0, 1]) $(`.sc.t${t} i`, this.root).style.background = teamCss(t);
    this.touchMode = isTouch;
    this.roleKey = '';
    this.syncRole(); this.syncCoins();
  }

  syncRole() {
    const me = this.me, sim = this.sim;
    const key = me.role + sim.leg + me.gun.id + me.gun.level;
    if (key === this.roleKey) return;
    this.roleKey = key;
    const climb = me.role === 'climb';
    $('.role-ico', this.root).textContent = climb ? '🧗' : '🔫';
    $('.role-name', this.root).textContent = climb ? '등반 차례' : '방해 차례';
    $('.role-goal', this.root).textContent = climb ? 'GOAL 깃발까지 올라가요' : '물총으로 밀어 떨어뜨려요';
    $('.role-card', this.root).dataset.role = me.role;
    $('.leg-label', this.root).textContent = `${sim.leg + 1}차례 / 2`;
    const g = me.gun, card = $('.gun-card', this.root);
    $('img', card).src = this.h.thumb(g.id, g.level);
    $('b', card).textContent = `${g.name} Lv.${g.level}`;
    $('small', card).textContent = climb ? '방해 차례에 사용' : `간격 ${g.interval}s · 사거리 ${g.range}`;
    card.dataset.role = me.role; card.dataset.gun = g.id;
    this.cross.hidden = climb; this.cross.dataset.gun = g.id;
    document.body.classList.toggle('aiming', !climb);
    this.touch.hidden = !this.touchMode; this.touch.dataset.role = me.role;
  }

  /** 매 프레임: 시계·점수·진행 지도·이름표·조준점 */
  frame(view, input) {
    const sim = this.sim, me = this.me;
    if (!sim || this.hud.hidden) return;
    this.syncRole();
    const timeEl = $('.time', this.root);
    const t = sim.phase === 'leg' ? Math.ceil(sim.phaseT) : sim.phase === 'results' ? 0 : CFG.time.leg;
    if (this._t !== t) { this._t = t; timeEl.textContent = t; timeEl.classList.toggle('low', sim.phase === 'leg' && t <= 10); }
    const s0 = fmt(sim.score(0)), s1 = fmt(sim.score(1));
    if (this._s !== s0 + s1) { this._s = s0 + s1; $('.sc.t0 b', this.root).textContent = s0; $('.sc.t1 b', this.root).textContent = s1; }
    // 진행 지도
    for (const a of sim.actors) {
      const dot = this.dots.get(a.id), on = a.role === 'climb';
      dot.hidden = !on;
      if (on) dot.style.bottom = Math.min(100, Math.max(0, (a.body.th / sim.course.thEnd) * 100)) + '%';
      dot.classList.toggle('down', !a.alive);
    }
    // 단계 카드
    const sc = $('.stage-card', this.root);
    let html;
    if (me.role === 'climb') {
      const st = Math.min(3, me.stageDone + 1), g = me.body.ground;
      const stepNo = me.finished ? CFG.stages[2].steps : g && g.kind === 'step' && g.stage === st ? g.index : 0;
      const n = CFG.stages[st - 1].steps;
      html = me.finished ? '<b>완주!</b><span>도착 지점에서 대기</span>'
        : `<b>S${st}</b><span class="pips">${Array.from({ length: n }, (_, i) => `<i class="${i < stepNo ? 'on' : ''}"></i>`).join('')}</span><span>${stepNo}/${n}</span>`;
    } else {
      html = sim.climbers().map(a => `<span class="row" style="--c:${teamCss(a.p.team)}"><i></i>${esc(a.p.name)} <b>${a.finished ? '완주' : 'S' + Math.min(3, a.stageDone + 1)}</b></span>`).join('');
    }
    if (this._sc !== html) { this._sc = html; sc.innerHTML = html; }
    // 재사용 대기
    const cool = $('.gun-card .cool i', this.root);
    const k = me.role === 'shoot' ? 1 - Math.max(0, me.cool) / me.gun.interval : 1;
    cool.style.transform = `scaleX(${k})`;

    // 이름표
    for (const a of sim.actors) {
      const tag = this.tagEls.get(a.id), v = view.views.get(a.id);
      const show = v.root.visible || !!v.death;
      const p = view.project(v.head, this.tmp);
      if (!show || !p.visible || (a.role === 'climb' && !a.alive && !v.death)) { tag.style.display = 'none'; continue; }
      tag.style.display = '';
      tag.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      const st = a.role === 'climb' && sim.phase === 'leg' ? (a.protectT > 0 ? '🛡' : a.safe ? '안전' : '') : '';
      const em = tag.lastChild; if (em.textContent !== st) em.textContent = st;
    }
    // 조준점
    if (me.role === 'shoot') {
      const m = input.aimNdc();
      const px = m.px ?? view.w / 2, py = m.py ?? view.h / 2;
      this.cross.style.transform = `translate(${px}px, ${py}px)`;
      const far = me.inp.aim && me.inp.aim.dist > me.gun.range;
      this.cross.classList.toggle('far', !!far);
      this.cross.classList.toggle('ready', me.cool <= 0);
      $('span', this.cross).textContent = far ? '사거리 밖' : '';
    }
  }

  /** 화면 밖 대상 방향 화살표. items: [{pos(Vector3), color, label}] */
  setArrows(view, items) {
    while (this.arrowEls.length < items.length) { const a = el('<div class="arrow"><i></i><span></span></div>'); this.arrows.append(a); this.arrowEls.push(a); }
    this.arrowEls.forEach((a, i) => {
      const it = items[i];
      if (!it) { a.style.display = 'none'; return; }
      const p = view.project(it.pos, this.tmp), W = view.w, H = view.h, pad = 46;
      let x = p.x, y = p.y;
      if (!p.visible) { x = W - x; y = H - y; }            // 카메라 뒤쪽이면 뒤집는다
      const inside = p.visible && x > pad && x < W - pad && y > pad + 40 && y < H - pad;
      if (inside) { a.style.display = 'none'; return; }
      const cx = W / 2, cy = H / 2, dx = x - cx, dy = y - cy;
      const k = Math.min((W / 2 - pad) / Math.abs(dx || 1e-6), (H / 2 - pad - 20) / Math.abs(dy || 1e-6));
      a.style.display = '';
      a.style.setProperty('--c', it.color);
      a.style.transform = `translate(${cx + dx * k}px, ${cy + dy * k}px)`;
      a.firstChild.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      a.lastChild.textContent = it.label || '';
    });
  }

  pop(view, pos, text, cls = '') {
    const p = view.project(pos, this.tmp);
    if (!p.visible) return;
    const e = el(`<div class="pop ${cls}">${esc(text)}</div>`);
    e.style.left = p.x + 'px'; e.style.top = p.y + 'px';
    this.pops.append(e);
    setTimeout(() => e.remove(), 1100);
    while (this.pops.children.length > 8) this.pops.firstChild.remove();
  }
  say(text, cls = '', ms = 1500) {
    const e = el(`<div class="say ${cls}">${text}</div>`);
    this.banner.innerHTML = ''; this.banner.append(e);
    clearTimeout(this._say);
    this._say = setTimeout(() => e.remove(), ms);
  }
  note(html) {
    const e = el(`<div class="note">${html}</div>`);
    this.feed.prepend(e);
    setTimeout(() => e.remove(), 3600);
    while (this.feed.children.length > 4) this.feed.lastChild.remove();
  }
  hint(html, ms = 6000) {
    this.hintEl.innerHTML = html; this.hintEl.hidden = false;
    clearTimeout(this._hint);
    if (ms) this._hint = setTimeout(() => { this.hintEl.hidden = true; }, ms);
  }
  hideHint() { this.hintEl.hidden = true; }
  coinFly(n) {
    const target = $('.hud .coins', this.root).getBoundingClientRect();
    for (let i = 0; i < Math.min(12, Math.ceil(n / 5) + 2); i++) {
      const c = el('<div class="fly-coin"></div>');
      c.style.left = innerWidth / 2 + (Math.random() - 0.5) * 120 + 'px'; c.style.top = innerHeight * 0.42 + (Math.random() - 0.5) * 60 + 'px';
      this.root.append(c);
      requestAnimationFrame(() => setTimeout(() => {
        c.style.left = target.left + 12 + 'px'; c.style.top = target.top + 8 + 'px'; c.style.opacity = '0.2'; c.style.transform = 'scale(0.5)';
      }, 60 + i * 55));
      setTimeout(() => { c.remove(); this.syncCoins(); $('.hud .coins', this.root).classList.add('bump'); setTimeout(() => $('.hud .coins', this.root).classList.remove('bump'), 200); }, 760 + i * 55);
    }
  }

  /** 시뮬레이션 이벤트 → 글자 연출 */
  onEvent(e, view) {
    const me = this.me, v = e.a && view.views.get(e.a.id), mine = e.a === me;
    switch (e.type) {
      case 'count': this.say(`<b class="num">${e.n}</b>`, 'count', 900); break;
      case 'stage': {
        const last = e.stage === 3;
        if (mine) this.say(`<b>${last ? '완주!' : `S${e.stage} 완료!`}</b><span class="rw"><i class="coin"></i>+${e.reward}</span>${last ? '<small>전체 완주 · 이번 등반 합계 60 Coins</small>' : `<small>체크포인트 열림 · ${e.points}점</small>`}`, 'stage', 2200);
        else this.note(`<i style="background:${teamCss(e.a.p.team)}"></i>${esc(e.a.p.name)} <b>${last ? '완주!' : `S${e.stage} 통과`}</b>`);
        break;
      }
      case 'fall':
        if (v) this.pop(view, v.head, OUCH[(Math.random() * OUCH.length) | 0], 'ouch');
        if (e.by === me) { this.say(`<b>퐁당!</b><small>${esc(e.a.p.name)} 용암행 🔥</small>`, 'ko', 1500); }
        else if (e.by && this.sim.phase === 'leg') this.note(`<i style="background:${teamCss(e.by.p.team)}"></i>${esc(e.by.p.local ? '나' : e.by.p.name)} ▸ ${esc(mine ? '나' : e.a.p.name)} <b>퐁당</b>`);
        break;
      case 'hit':
        if (v) this.pop(view, v.head, e.by === me ? '명중!' : mine ? '으악!' : '철썩', e.by === me ? 'hitme' : mine ? 'ouch' : '');
        if (e.by === me) { this.cross.classList.remove('hit'); void this.cross.offsetWidth; this.cross.classList.add('hit'); }
        break;
      case 'blocked':
        if (v && (e.s.owner === me || mine)) this.pop(view, v.head, e.reason === 'safe' ? '안전 지대' : e.reason === 'protect' ? '보호 중' : e.reason === 'immune' ? '면역' : '', 'block');
        break;
      case 'nearMiss': if (mine && v) this.pop(view, v.head, '아슬아슬!', 'near'); break;
      case 'hurry': if (e.n <= 5) this.say(`<b class="num">${e.n}</b>`, 'count hurry', 800); else if (e.n === 10) this.say('<b>10초!</b>', 'hurry', 900); break;
    }
  }

  // ── 교대 안내(화면을 막지 않는 카드) ──
  showInter(first) {
    const sim = this.sim, me = this.me, climb = me.role === 'climb';
    const key = this.touchMode
      ? (climb ? '왼쪽 <kbd>스틱</kbd> 이동(오른쪽이 앞) · <kbd>점프</kbd> 버튼' : '화면을 <kbd>눌러</kbd> 조준·발사 · <kbd>스틱</kbd> 이동')
      : (climb ? '<kbd>D</kbd> 앞으로 · <kbd>A</kbd> 뒤로 · <kbd>W</kbd><kbd>S</kbd> 벽 쪽/바깥 · <kbd>Space</kbd> 점프' : '<kbd>마우스</kbd> 조준 · <kbd>클릭</kbd> 발사 · <kbd>A</kbd><kbd>D</kbd> 이동');
    this.inter.innerHTML = `
      <div class="inter-h"><b>${first ? '경기 시작' : '역할 교대!'}</b><span>${sim.leg + 1}차례 — ${climb ? '🧗 우리 팀 등반' : '🔫 우리 팀 방해'}</span></div>
      <div class="inter-k">${key}</div>
      <div class="inter-b"><button class="mid shop-open">🔫 상점</button><button class="mid go ready">준비 완료 ▶</button></div>`;
    this.inter.hidden = false;
    $('.shop-open', this.inter).onclick = () => { this.h.click?.(); this.openShop(); };
    $('.ready', this.inter).onclick = () => { this.h.click?.(); this.h.ready(); };
  }
  hideInter() { this.inter.hidden = true; }

  // ── 모달 ──
  openPanel(name, html, dismiss = true) {
    this.panel = { name, dismiss };
    this.sheet.className = 'sheet ' + name;
    this.sheet.innerHTML = html;
    this.modal.hidden = false;
    this.h.panel?.(name, true);
  }
  closePanel(silent) {
    if (!this.panel) return;
    const name = this.panel.name;
    this.panel = null; this.modal.hidden = true; this.sheet.innerHTML = '';
    if (!silent) this.h.panel?.(name, false);
  }

  openPause() {
    this.openPanel('pause', `
      <h2>일시정지</h2>
      <div class="col">
        <button class="big resume">▶ 계속하기</button>
        <button class="mid restart">↻ 처음부터 다시</button>
        <button class="mid opt">⚙ 소리·화질</button>
        <button class="mid quit">타이틀로</button>
      </div>
      <p class="keys">이동 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · 점프 <kbd>Space</kbd> · 조준/발사 마우스 · 일시정지 <kbd>Esc</kbd></p>`, false);
    $('.resume', this.sheet).onclick = () => { this.h.click?.(); this.h.resume(); };
    $('.restart', this.sheet).onclick = () => { this.h.click?.(); this.h.restart(); };
    $('.quit', this.sheet).onclick = () => { this.h.click?.(); this.h.quit(); };
    $('.opt', this.sheet).onclick = () => { this.h.click?.(); this.openOptions(true); };
  }

  openOptions(fromPause) {
    const s = this.save.settings;
    this.openPanel('options', `
      <header><h2>설정</h2><button class="x" aria-label="닫기">✕</button></header>
      <label class="row">음량 <input type="range" class="vol" min="0" max="100" value="${Math.round(s.volume * 100)}"><span class="volv">${Math.round(s.volume * 100)}</span></label>
      <label class="row">음소거 <input type="checkbox" class="mutec" ${s.muted ? 'checked' : ''}></label>
      <div class="row">화질 <span class="seg">${['auto', 'high', 'low'].map(q => `<button data-q="${q}" class="${s.quality === q ? 'on' : ''}">${{ auto: '자동', high: '높음', low: '낮음' }[q]}</button>`).join('')}</span></div>`, !fromPause);
    const back = () => (fromPause ? this.openPause() : this.closePanel());
    $('.x', this.sheet).onclick = back;
    $('.vol', this.sheet).oninput = (e) => { this.h.volume(e.target.value / 100); $('.volv', this.sheet).textContent = e.target.value; };
    $('.mutec', this.sheet).onchange = () => { this.h.mute(); this.syncSound(); };
    for (const b of this.sheet.querySelectorAll('.seg button')) b.onclick = () => {
      this.h.quality(b.dataset.q);
      for (const o of this.sheet.querySelectorAll('.seg button')) o.classList.toggle('on', o === b);
    };
  }

  // ── 상점 ──
  openShop() {
    if (!this.h.canShop()) { this.say('<small>상점은 대기·교대·결과에서만 열 수 있어요</small>', '', 1400); return; }
    this.openPanel('shop', '');
    this.renderShop();
  }
  renderShop(flash) {
    const s = this.save;
    const bar = (v, max) => `<span class="bar"><i style="width:${Math.round((v / max) * 100)}%"></i></span>`;
    const cards = CFG.gunOrder.map((id) => {
      const g = CFG.guns[id], owned = s.owned[id], lv = s.levels[id], cur = gunStats(id, lv), eq = s.equipped === id;
      const up = owned ? CFG.upgrades[lv + 1] : null, next = up ? gunStats(id, lv + 1) : null;
      let act = '';
      if (!owned) {
        const lack = g.price - s.coins;
        act = `<button class="act buy" data-act="buy" data-id="${id}" ${lack > 0 ? 'disabled' : ''}>
            <b>구매 · <i class="coin"></i>${g.price}</b>
            <small>${lack > 0 ? `${lack} Coins 더 필요` : `구매 후 잔액 ${s.coins - g.price}`}</small></button>`;
      } else {
        act = eq ? '<div class="act on">✓ 장착 중</div>' : `<button class="act equip" data-act="equip" data-id="${id}"><b>장착</b><small>다음 차례부터 사용</small></button>`;
        if (up) {
          const lack = up.cost - s.coins;
          act += `<button class="act up" data-act="up" data-id="${id}" data-lv="${lv}" ${lack > 0 ? 'disabled' : ''}>
            <b>강화 Lv.${lv} → Lv.${lv + 1} · <i class="coin"></i>${up.cost}</b>
            <small>발사 간격 ${cur.interval}s → ${next.interval}s (기본의 ${Math.round(up.intervalMul * 100)}%)${lack > 0 ? ` · ${lack} 더 필요` : ` · 강화 후 잔액 ${s.coins - up.cost}`}</small></button>`;
        } else act += '<div class="act max">★ 최대 레벨</div>';
      }
      return `<article class="gun ${id}${eq ? ' eq' : ''}${owned ? '' : ' locked'}${flash === id ? ' flash' : ''}">
        <div class="pic"><img src="${this.h.thumb(id, lv)}" alt="${esc(g.name)}"><span class="lv">${owned ? `Lv.${lv}` : '미보유'}</span></div>
        <h3>${esc(g.name)}</h3><p class="tagl">${GUN_TAG[id]}</p>
        <dl>
          <dt>밀치기</dt><dd>${bar(g.knock, 24)}<b>${g.knock}</b></dd>
          <dt>연사</dt><dd>${bar(1 / cur.interval, 1 / 0.405)}<b>${cur.interval}s</b></dd>
          <dt>사거리</dt><dd>${bar(g.range, 60)}<b>${g.range}</b></dd>
        </dl>
        <div class="acts">${act}</div></article>`;
    }).join('');
    this.sheet.innerHTML = `
      <header><h2>🔫 물총 상점</h2><div class="chip coins"><span class="coin"></span><b>${s.coins}</b></div><button class="x" aria-label="닫기">✕</button></header>
      <p class="shop-note">Coins는 등반에서 단계를 처음 끝낼 때 얻어요 (S1 10 · S2 20 · S3 30). 장착·강화는 <b>다음 차례</b>부터 적용됩니다.</p>
      <div class="guns">${cards}</div>`;
    $('.x', this.sheet).onclick = () => { this.h.click?.(); this.closePanel(); };
    for (const b of this.sheet.querySelectorAll('button.act')) b.onclick = () => this.trade(b.dataset.act, b.dataset.id, +b.dataset.lv);
  }
  /** 거래 한 건. 잠금 시간 + 상태 확인(save.js)으로 연타해도 한 번만 결제된다. */
  trade(act, id, lv) {
    const now = performance.now();
    if (now < this.lockUntil) return;
    this.lockUntil = now + 450;
    const s = this.save;
    const r = act === 'buy' ? buy(s, id) : act === 'up' ? upgrade(s, id, lv) : equip(s, id);
    if (r.ok && act === 'buy') equip(s, id);
    this.h.shopChanged(r.ok ? act : 'deny', id);
    this.renderShop(r.ok ? id : null);
    this.syncCoins();
  }

  // ── 결과 ──
  showResults(info) {
    const sim = this.sim, me = this.me, res = info.result;
    const mine = me.p.team, won = res.winner === mine, draw = res.winner < 0;
    const rows = [0, 1].map((t) => {
      const members = sim.team(t).map((a) => `
        <tr class="${a.p.local ? 'me' : ''}"><td>${a.p.kind === 'bot' ? '<i class="ai">AI</i>' : ''}${esc(a.p.local ? '나' : a.p.name)}</td>
        <td class="pts">${[1, 2, 3].map(k => `<i class="${a.stageTimes.length >= k ? 'on' : ''}">S${k}</i>`).join('')}</td>
        <td><b>${a.points}</b>점</td><td>${a.stageTimes.length === 3 ? a.stageTimes[2].toFixed(1) + 's' : '-'}</td>
        <td>💦${a.hits}</td><td>🔥${a.falls}</td></tr>`).join('');
      return `<div class="team ${res.winner === t ? 'win' : ''}" style="--c:${teamCss(t)}">
        <div class="team-h"><b>${esc(CFG.teams[t].name)} 팀${t === mine ? ' (우리)' : ''}</b><span class="avg">${fmt(res.scores[t])}<small>점/인</small></span></div>
        <table>${members}</table></div>`;
    }).join('');
    const why = res.by === 'time' ? `동점! 더 빨리 오른 팀 승리 (${res.times[res.winner].toFixed(1)}s vs ${res.times[1 - res.winner].toFixed(1)}s)` : res.by === 'draw' ? '완전 동점' : '팀원당 평균 점수로 비교';
    this.openPanel('results', `
      <div class="res-h ${draw ? 'draw' : won ? 'won' : 'lost'}"><h2>${draw ? '무승부' : won ? '승리!' : '아쉬운 패배'}</h2><p>${why}</p></div>
      <div class="teams">${rows}</div>
      <div class="res-f">
        <div class="earn"><span class="coin"></span>이번 경기 <b>+${info.earned}</b> · 보유 <b>${this.save.coins}</b>${info.best ? ` · <em>최고 기록 ${info.best.toFixed(1)}s!</em>` : ''}</div>
        <div class="next">${info.levelMsg}</div>
      </div>
      <div class="res-b"><button class="big again">한 판 더! ▶</button><button class="mid shop-open">🔫 상점</button><button class="mid quit">타이틀</button></div>`, false);
    $('.again', this.sheet).onclick = () => { this.h.click?.(); this.h.again(); };
    $('.quit', this.sheet).onclick = () => { this.h.click?.(); this.h.quit(); };
    $('.shop-open', this.sheet).onclick = () => { this.h.click?.(); this.resultsInfo = info; this.openShop(); };
    this.resultsInfo = info;
  }
}
