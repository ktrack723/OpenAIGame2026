import { CFG, VIS } from '../game/config.js'
import { ROLES } from '../game/roles.js'
import { bearing, toDeg180 } from '../core/angle.js'

const hex = (n) => '#' + n.toString(16).padStart(6, '0')
const clamp0 = (n) => Math.max(0, n)
const bar = (full, total, on, off) => on.repeat(clamp0(Math.min(full, total))) + off.repeat(clamp0(total - clamp0(Math.min(full, total))))
const dirOf = (x, y) => bearing(x, y).toFixed(0)

// ─── 스테퍼 ─────────────────────────────────────────────────────
// 슬라이더는 모바일에서 정밀 조작이 안 된다(트랙 1px이 0.5°가 넘는다).
// 굵은 버튼 넷으로 굵게/미세하게 나누고, 누르고 있으면 가속 반복시킨다.
function stepper(id, label, unit) {
  return `<div class="step" id="${id}">
  <span class="steplabel">${label}</span>
  <button class="stepbtn big" data-d="-2" aria-label="${label} 크게 감소">◀◀</button>
  <button class="stepbtn" data-d="-1" aria-label="${label} 감소">◀</button>
  <span class="stepval" id="${id}V">—</span>
  <button class="stepbtn" data-d="1" aria-label="${label} 증가">▶</button>
  <button class="stepbtn big" data-d="2" aria-label="${label} 크게 증가">▶▶</button>
  <span class="stepunit">${unit}</span>
</div>`
}

// ─── 누르고 있으면 흐르는 조작 ──────────────────────────────────
// 예전엔 한 번 누르면 1°씩 딱딱 끊어 움직였다(가속 반복). 각도를 30° 옮기려면
// 서른 번을 눌러야 했고, 누르고 있어도 "톡 톡 톡" 계단처럼 움직여서
// 원하는 각을 지나치기 일쑤였다.
//
// 이제 **시간 진행 버튼과 같은 방식**이다: 누르고 있는 동안 값이 연속으로
// 흐르고, 오래 누를수록 빨라진다. 처음 0.35초는 느리게(정밀 조정) 가다가
// 최대 속도까지 매끄럽게 올라간다. 짧게 톡 누르면 최소 단위 한 칸만 움직인다.
//
// rate: [시작 속도, 최대 속도] (초당 단위). ramp: 최대까지 걸리는 시간(초).
function holdRamp(btn, apply, { slow, fast, ramp = 1.1, tap }) {
  let raf = null, t0 = 0, last = 0, moved = 0
  const stop = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = null
    // 거의 안 움직였으면 "톡 누른 것"으로 보고 한 칸을 확실히 준다
    if (moved < tap * 0.75) apply(tap - moved)
    moved = 0
  }
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now
    const held = (now - t0) / 1000
    // 부드러운 가속 — ease-in 이라 처음엔 정밀하고 나중엔 시원하다
    const k = Math.min(1, held / ramp)
    const rate = slow + (fast - slow) * k * k
    const d = rate * dt
    apply(d); moved += d
    raf = requestAnimationFrame(frame)
  }
  btn.addEventListener('pointerdown', (e) => {
    if (btn.disabled) return
    e.preventDefault()
    try { btn.setPointerCapture?.(e.pointerId) } catch { /* 무시 */ }
    t0 = last = performance.now(); moved = 0
    raf = requestAnimationFrame(frame)
  })
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, stop)
}

export function makeHud(game, view) {
  const el = document.createElement('div')
  el.className = 'hud'
  el.innerHTML = `<div class="hudtop"><h1>PLANETPOOL</h1><button id="fold" class="ghost" title="패널 접기">▾</button></div>
<div class="body">

<section class="mod">
  <div class="modhead"><span class="tick"></span><span id="goalHead">OPERATION</span></div>
  <div class="objname" id="objName">—</div>
  <div class="objprog"><i id="goalFill"></i></div>
  <div class="objrule" id="goalRule"></div>
</section>

<section class="mod" id="rolesMod" hidden>
  <div class="modhead"><span class="tick"></span><span>PLANET TAGS</span><span class="clockv" id="tagNote">태그 없음 = 일반 행성</span></div>
  <div class="roles" id="roles"></div>
</section>

<section class="mod alarm" id="laserMod" hidden>
  <div class="modhead"><span class="tick"></span><span>ZORG BEAM</span><span class="clockv" id="laserT">—</span></div>
  <div class="alarmtext" id="laserWhy"></div>
</section>

<section class="mod" id="clock">
  <div class="modhead"><span class="tick"></span><span>CHRONO</span><span class="clockv" id="clockV">—</span></div>
  <div class="clockbar"><i id="clockFill"></i></div>
  <div class="clocknote" id="clockNote"></div>
</section>

<section class="mod firectl">
  <div class="modhead"><span class="tick"></span><span>FIRE CONTROL</span></div>
  ${stepper('angle', '각도', '°')}
  ${stepper('power', '속도', 'GU/s')}
  ${stepper('yield', '작약', 'Mt')}
  <div class="assist">
    <span class="asslabel">탐색</span>
    <button id="findPrev" class="ghost" title="닿는 각도를 반시계로">◀ 접촉각</button>
    <button id="findNext" class="ghost" title="닿는 각도를 시계로">접촉각 ▶</button>
  </div>
  <div class="lcd" id="lcd">
    <div class="lcdscan"></div>
    <div class="lcdline"><b id="lcdTag">READY</b><span id="lcdText">조준 대기</span></div>
    <div class="lcdsub" id="lcdSub"></div>
  </div>
  <button id="fire" class="firebtn"><span class="fkey">SPACE</span><span class="ftext">FIRE</span><i class="fglow"></i></button>
  <div class="btnrow">
    <button id="wait" class="ghost wide" title="누르고 있는 동안만 시간이 흐른다">시간 진행 ▶▶ (SHIFT)</button>
    <button id="toObs" class="ghost wide obs" title="관측 모드 — UI가 사라지고 판이 흐른다">관측 모드 ▶ (TAB)</button>
  </div>
</section>

<section class="mod">
  <div class="modhead"><span class="tick"></span><span>VIEW</span><span class="zoomv" id="zoomV"></span></div>
  <div class="btnrow">
    <button id="zout" class="ghost" title="축소 ( − )">－</button>
    <button id="zin" class="ghost" title="확대 ( + )">＋</button>
    <button id="zauto" class="ghost" title="목표 자동 프레이밍 ( 0 )">자동</button>
    <button id="zfull" class="ghost" title="성계 전체 ( 9 )">전체</button>
    <button id="new" class="ghost">새 런</button>
  </div>
  <div class="hint">TAB 조준/관측 전환 · SHIFT 시간 진행 · S 관측 배속 · ← → 각도 · ↑ ↓ 속도 · [ ] 작약 · F 접촉각<br>
  조준 모드에서는 미사일이 날아가는 중에도 판이 멈춘다 · 행성에 마우스를 올리면(터치는 짚으면) 제원이 뜬다</div>
</section>

<section class="mod">
  <div class="modhead"><span class="tick"></span><span>SYSTEM</span></div>
  <pre id="stats"></pre>
</section>
</div>`
  document.body.appendChild(el)

  const over = document.createElement('div')
  over.className = 'gameover'; over.hidden = true
  over.innerHTML = `<h2>작전 실패</h2><p id="overWhy"></p>
<button id="overNew" class="firebtn"><span class="ftext">새 런 시작</span><i class="fglow"></i></button>`
  document.body.appendChild(over)
  over.querySelector('#overNew').onclick = () => { location.href = location.pathname + '?seed=' + ((Math.random() * 1e9) | 0) }
  el._over = over

  const toast = document.createElement('div')
  toast.className = 'toast'; toast.hidden = true
  document.body.appendChild(toast)
  el._toast = toast

  // ── 관측 모드의 유일한 UI ──────────────────────────────────
  // 관측 중에는 패널이 통째로 사라진다. 남는 건 이 버튼 하나뿐이고,
  // 꼭 필요한 정보(남은 시한 · 레이저 경보)는 버튼 안에 접어 넣는다 —
  // 화면을 비우려고 죽는 이유까지 숨길 수는 없다.
  const obsBar = document.createElement('div')
  obsBar.className = 'obsbar'; obsBar.hidden = true
  obsBar.innerHTML = `
<button class="aimbtn" id="toAim"><span class="aimtitle">◎ 조준 모드</span>
<span class="aimsub" id="obsSub">시간 정지 · TAB / 클릭</span></button>
<button class="spdbtn" id="obsSpd" title="관측 배속 (S)"><span class="spdv" id="obsSpdV">2×</span>
<span class="spdlbl">배속</span></button>`
  document.body.appendChild(obsBar)
  obsBar.querySelector('#toAim').onclick = () => game.setMode('aim')
  obsBar.querySelector('#obsSpd').onclick = (e) => {
    e.stopPropagation()
    game.setToast(`관측 배속 ${game.cycleObsSpeed()}×`)
  }
  el._obsBar = obsBar

  const qs = (id) => el.querySelector(id)

  // ── 스테퍼 배선 ────────────────────────────────────────────
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  // slow/fast = 누르기 시작할 때와 최대로 빨라졌을 때의 **초당** 변화량.
  // 각도는 처음 2°/s로 기어가다 60°/s까지 붙는다 — 정밀 조정과 큰 이동이
  // 같은 버튼 하나에 들어간다. ◀◀/▶▶ 는 그 두 배로 시작한다.
  const CTL = {
    angle: { tap: 0.5, slow: 2, fast: 60, big: 3, get: () => toDeg180(game.aim), set: (v) => { game.aim = v * Math.PI / 180 }, fmt: (v) => v.toFixed(1) },
    power: { tap: 1, slow: 3, fast: 26, big: 2.5, get: () => game.power, set: (v) => { game.power = clamp(v, CFG.LAUNCH_MIN, CFG.LAUNCH_MAX) }, fmt: (v) => v.toFixed(0) },
    yield: { tap: 1, slow: 2, fast: 9, big: 2, get: () => game.yieldMt, set: (v) => { game.yieldMt = clamp(v, CFG.YIELD_MIN, CFG.YIELD_MAX) }, fmt: (v) => v.toFixed(0) },
  }
  el._sync = () => { for (const k in CTL) qs(`#${k}V`).textContent = CTL[k].fmt(CTL[k].get()) }
  for (const k in CTL) {
    const c = CTL[k]
    for (const btn of qs(`#${k}`).querySelectorAll('.stepbtn')) {
      const d = +btn.dataset.d
      const sign = Math.sign(d), mul = Math.abs(d) === 2 ? c.big : 1
      holdRamp(btn, (amount) => {
        if (!game.canAim) return
        c.set(c.get() + amount * sign * mul)
        el._sync()
      }, { slow: c.slow, fast: c.fast, tap: c.tap })
    }
  }
  el._sync()

  qs('#fire').onclick = () => game.fire()
  qs('#findNext').onclick = () => { game.scanContact(1); el._sync() }
  qs('#findPrev').onclick = () => { game.scanContact(-1); el._sync() }
  qs('#toObs').onclick = () => game.setMode('observe')
  qs('#new').onclick = () => { location.href = location.pathname + '?seed=' + ((Math.random() * 1e9) | 0) }
  qs('#fold').onclick = () => {
    el.classList.toggle('folded')
    qs('#fold').textContent = el.classList.contains('folded') ? '▸' : '▾'
  }

  const rig = view.rig
  qs('#zin').onclick = () => rig.zoomBy(VIS.ZOOM_STEP)
  qs('#zout').onclick = () => rig.zoomBy(1 / VIS.ZOOM_STEP)
  qs('#zauto').onclick = () => rig.snapToAuto()
  qs('#zfull').onclick = () => rig.fullView()
  rig.attachHud(el)
  rig.snapToAuto()
  el._rig = rig

  // 시간 진행 홀드 — 조준 모드에서도 시간을 흘릴 수 있게 해 주는 장치.
  // 조준선을 고정한 채 판을 조금씩 굴려 보는 게 이 게임의 핵심 조작이다.
  const wait = qs('#wait')
  const startWait = () => { game.advancing = true; wait.classList.add('on') }
  const stopWait = () => { game.advancing = false; wait.classList.remove('on') }
  wait.onmousedown = startWait; wait.onmouseup = stopWait; wait.onmouseleave = stopWait
  wait.ontouchstart = (e) => { e.preventDefault(); startWait() }
  wait.ontouchend = stopWait; wait.ontouchcancel = stopWait

  addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return
    // TAB — 두 모드를 오간다. 관측 중에도 유일하게 살아 있는 키다.
    if (e.code === 'Tab') { e.preventDefault(); game.toggleMode(); el._sync(); return }
    if (e.key === 'Shift') startWait()
    if (e.key === 's' || e.key === 'S') { game.setToast(`관측 배속 ${game.cycleObsSpeed()}×`); return }
    if (game.mode !== 'aim') {
      // 관측 모드에서는 조작이 전부 잠긴다 — 아무 키나 누르면 조준으로 돌아온다
      if (e.code === 'Space' || e.code === 'Escape') { e.preventDefault(); game.setMode('aim') }
      return
    }
    if (e.code === 'Space') { e.preventDefault(); game.fire() }
    if (!game.canAim) return
    const step = (k, n) => { CTL[k].set(CTL[k].get() + n); el._sync() }
    const fine = e.shiftKey
    if (e.key === 'ArrowLeft') { e.preventDefault(); step('angle', fine ? -0.5 : -2) }
    if (e.key === 'ArrowRight') { e.preventDefault(); step('angle', fine ? 0.5 : 2) }
    if (e.key === 'ArrowUp') { e.preventDefault(); step('power', 1) }
    if (e.key === 'ArrowDown') { e.preventDefault(); step('power', -1) }
    if (e.key === '[') step('yield', -1)
    if (e.key === ']') step('yield', 1)
    if (e.key === 'f' || e.key === 'F') { game.scanContact(e.shiftKey ? -1 : 1); el._sync() }
  })
  addEventListener('keyup', (e) => { if (e.key === 'Shift') stopWait() })
  return el
}

// ─── LCD 문구 — 예측이 무엇을 말해 주는가 ────────────────────────
//
// 규칙은 한 줄이다: **"이 한 발이 어디에 닿고, 그 결과 공이 어디로
// 출발하는가"까지만 말한다.** 그 뒤 판이 어떻게 굴러갈지는 절대 말하지 않는다.
// 그게 이 게임의 문제이기 때문이다.
//
// 그래서 문구는 세 층으로만 나뉜다:
//
//  [1층 · 접촉]   무엇에 닿는가. 항상 표시된다. LCD 태그(TARGET/CUE/VOID…)와
//                 본문이 이 층이다. 아무것에도 안 닿으면 NO CTC.
//  [2층 · 직접 결과] 그 접촉이 **그 공에** 즉시 일으키는 일. 충격 방향(°),
//                 Δv, 남은 체력. 화면에는 같은 값이 노란/흰 화살표 + 수치
//                 라벨로도 나온다(AimHelper). 계산으로 확정되는 값만 넣는다.
//  [3층 · 경고]   플레이어가 **의도하지 않았을 가능성이 높은 부작용**만.
//                 지구가 폭풍 반경에 들어간다, 반격탄이 나온다, 벨트까지 날아간다.
//                 조건은 전부 "지금 이 한 발에서 확정적으로 참"인 것들이라
//                 추측이나 확률은 한 줄도 넣지 않는다.
//
// 넣지 않는 것(의도적):
//   · 2차 충돌 — "이 공이 저 공에 맞는다"는 절대 안 알려준다. 그걸 읽는 게 게임이다.
//   · 판의 승패 예측, 점수 예상, 최적 각도 추천.
//   · 확률·추정치. LCD에 뜨는 숫자는 전부 결정론적 계산 결과다.
const predLineDoc = null   // (위 주석이 곧 명세다)

function predLine(game, p) {
  const h = p.hit
  const role = h && h.role ? ROLES[h.role] : null
  const badge = role ? ` [${role.icon}${role.label}]` : ''
  switch (p.outcome) {
    case 'earth': return ['bad', 'ABORT', '지구 직격 — 즉시 게임 오버', '각도를 바꿔라']
    case 'void': return ['warn', 'VOID', `${h.name}${badge}`, role.aim]
    case 'volatile': return ['hit', 'CHAIN', `${h.name}${badge}`, `${role.aim} · 반경 ${h.volatileR.toFixed(0)} GU`]
    case 'intercept': return ['hit', 'INTCP', `공중 요격 — ${h.yld}Mt 동시 기폭`, `폭풍 반경 ${h.blast.toFixed(0)} GU`]
    case 'debris': return ['warn', 'DEBRIS', '파편에 조기 폭발', '']
    case 'sun': return ['warn', 'SOLAR', '태양 소멸', '근일점이 너무 낮다']
    case 'lost': return ['warn', 'LOST', '성계 이탈 — 유실', '발사 속도 과다']
    case 'timeout': return ['warn', 'NO CTC', `${CFG.MISSILE_TTL}초 내 접촉 없음`, '자폭']
    case 'target':
    case 'neutral': {
      const tag = p.outcome === 'target' ? 'TARGET' : 'CUE'
      // [2층] 이 접촉이 그 공에 즉시 일으키는 것 — 충격 방향/세기, 진로, 체력.
      const direct = [
        `충격 ${dirOf(h.dx, h.dy)}° Δv ${h.dv.toFixed(1)}`,
        `진로 ${dirOf(h.vx, h.vy)}° ${Math.hypot(h.vx, h.vy).toFixed(0)}GU/s`,
        `체력 ${h.hp}/${h.hpMax}`,
      ].join(' · ')
      // [3층] 의도하지 않았을 부작용만. 전부 이 한 발에서 확정적으로 참인 것.
      const warn = [
        h.earthInBlast ? '⚠ 폭풍 반경에 지구가 들어간다' : '',
        h.counter ? `⚠ 반격탄이 되날아온다 (${h.counterSpeed.toFixed(0)} GU/s, 때린 쪽)` : '',
        h.role === 'armor' ? `무겁다 — 임펄스 ${(CFG.ARMOR_DV * 100).toFixed(0)}%만 먹었다` : '',
        h.willEject ? `↩ 벨트까지 날아갔다 되돌아온다 (${h.vAfter.toFixed(0)}>${h.vEsc.toFixed(0)})` : '',
      ].filter(Boolean).join(' · ')
      return [h.earthInBlast ? 'warn' : 'hit', tag,
        `${h.name}${badge} — ${direct}`, warn]
    }
    default: return ['warn', '—', '—', '']
  }
}

const FAIL_WHY = {
  EARTH_LOST: '지구를 잃었다. 조르그보다 먼저 인류가 끝났다.',
  TIME_UP: '작전 시한이 끝났다. 조르그가 회랑을 재정비했다.',
  EARTH_LASER: `조르그 레이저가 지구를 관통했다. ${CFG.LASER_CHARGE}초의 조준 시간 안에 선을 끊었어야 했다.`,
}

const CTRL_IDS = ['#fire', '#findPrev', '#findNext']

export function updateHud(el, game) {
  if (el._stageIdx !== game.stageIdx) { el._stageIdx = game.stageIdx; el._sync() }

  // ── 모드 전환 — 관측 중에는 패널을 통째로 감추고 버튼 하나만 남긴다 ──
  const observing = game.mode === 'observe' && !game.runOver
  if (el._observing !== observing) {
    el._observing = observing
    el.hidden = observing
    el._obsBar.hidden = !observing
  }
  if (observing) {
    // 버튼 하나에 접어 넣는 최소 정보: 배속 · 남은 시한 · 레이저 경보
    const left = game.timeLeft
    const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`
    const sub = game.laserCharging
      ? `⚠ 조르그 레이저 T-${game.laserLeft.toFixed(0)}s — 지금 조준하라`
      : `${game.effTimeScale()}× 진행 중 · 잔여 ${clock}`
    const bar = el._obsBar, btn = bar.querySelector('#toAim')
    if (btn._sub !== sub) { btn._sub = sub; bar.querySelector('#obsSub').textContent = sub }
    btn.classList.toggle('alarm', !!game.laserCharging)
    const spd = game.obsSpeedLabel
    if (bar._spd !== spd) { bar._spd = spd; bar.querySelector('#obsSpdV').textContent = spd }
    return   // 패널이 숨겨져 있으므로 나머지 갱신은 통째로 건너뛴다
  }

  const aimable = game.canAim
  if (el._aimable !== aimable) {
    el._aimable = aimable
    for (const id of CTRL_IDS) el.querySelector(id).disabled = !aimable
    for (const b of el.querySelectorAll('.stepbtn')) b.disabled = !aimable
    el.classList.toggle('locked', !aimable)
  }

  const over = el._over
  if (over.hidden === game.runOver) {
    over.hidden = !game.runOver
    if (game.runOver) {
      over.querySelector('#overWhy').textContent =
        `${FAIL_WHY[game.failReason] ?? game.message}  ·  최종 점수 ${game.runScore + game.score}`
      el.querySelector('#wait').disabled = true
    }
  }

  const t = game.target, e = game.earth, g = game.goal
  const dx = t.pos.x - e.pos.x, dy = t.pos.y - e.pos.y
  el.querySelector('#goalHead').textContent = `안테 ${game.ante} · ${g.title}`
  el.querySelector('#objName').textContent =
    `${g.label()}  ▸ ◎ ${t.name} · ${Math.hypot(dx, dy).toFixed(0)} GU · ${dirOf(dx, dy)}°`
  el.querySelector('#goalFill').style.width = `${Math.min(100, g.done / g.need * 100).toFixed(0)}%`
  el.querySelector('#goalRule').textContent = g.rule

  // 특수 천체 범례 — 이 판에 실제로 깔린 것만. 색은 화면의 점선 링과 같다.
  if (el._roleKey !== game.stageIdx) {
    el._roleKey = game.stageIdx
    const list = game.stage.roles ?? []
    el.querySelector('#rolesMod').hidden = !list.length
    el.querySelector('#roles').innerHTML = list.map(k => {
      const d = ROLES[k]
      return `<div class="rolerow"><b style="color:${hex(d.color)}">${d.icon} ${d.label}</b><span>${d.brief}</span></div>`
    }).join('')
  }

  // ── 조르그 레이저 경보 ──
  const lm = el.querySelector('#laserMod')
  if (game.laserCharging) {
    lm.hidden = false
    el.querySelector('#laserT').textContent = `T-${game.laserLeft.toFixed(1)}s`
    el.querySelector('#laserWhy').textContent =
      `${game.homeworld ? game.homeworld.name : '본성'}이 지구의 예상 위치를 계산해 발사 "방향"을 고정했다. `
      + '대응 넷: ① 행성을 선 위로 밀어 막는다 ② 폭풍으로 지구를 비킨다 '
      + '③ 본성을 옆으로 민다(총구가 밀리면 광선이 통째로 평행이동해 빗나간다) ④ 본성을 부순다.'
  } else lm.hidden = true

  const rig = el._rig
  if (rig) el.querySelector('#zoomV').textContent = `${rig.zoom.toFixed(1)}×${rig.auto ? ' AUTO' : ''}`

  const left = game.timeLeft, frac = left / game.stageTime
  const clock = el.querySelector('#clock')
  el.querySelector('#clockV').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`
  el.querySelector('#clockFill').style.width = `${Math.max(0, frac * 100).toFixed(1)}%`
  clock.className = 'mod' + (frac <= 0.15 ? ' crit' : frac <= 0.4 ? ' warn' : '')
  const scale = game.effTimeScale()
  const flying = game.missiles.some(m => m.alive)
  el.querySelector('#clockNote').textContent = game.won
    ? `정지 — 시간 보너스 +${game.timeBonus} 확정`
    : scale === 0
      ? `■ 정지 (조준 모드${flying ? ' — 미사일도 멈춰 있다' : ''}) · 클리어 시 +${game.timeBonus}`
      : `▶ ${scale}× 진행 중 · 시간 보너스 +${game.timeBonus}`

  // ── LCD — 발사 버튼 바로 위, 눌리는 자리에서 결과를 읽는다 ──
  const lcd = el.querySelector('#lcd')
  const fireBtn = el.querySelector('#fire')
  if (game.canAim) {
    const p = game.predictPath()
    const [cls, tag, text, sub] = predLine(game, p)
    lcd.className = `lcd ${cls}`
    el.querySelector('#lcdTag').textContent = tag
    el.querySelector('#lcdText').textContent = text
    el.querySelector('#lcdSub').textContent = sub
      || `작약 ${game.yieldMt}Mt · Δv=${CFG.NUKE_IMPULSE}×${game.yieldMt}/질량 · 폭풍 ${(CFG.BLAST_R * game.yieldMt).toFixed(0)} GU`
    fireBtn.classList.toggle('danger', p.outcome === 'earth')
    fireBtn.disabled = game.inFlight
    fireBtn.querySelector('.ftext').textContent = game.inFlight ? '재장전 대기 — 비행 중'
      : p.outcome === 'earth' ? 'ABORT — 지구 직격' : 'FIRE'
  } else {
    lcd.className = 'lcd off'
    el.querySelector('#lcdTag').textContent = game.runOver ? 'DEAD' : 'HOLD'
    el.querySelector('#lcdText').textContent = game.runOver ? '작전 종료' : '발사 불가'
    el.querySelector('#lcdSub').textContent = game.inFlight ? '탄이 비행 중 — 결판난 뒤에 다음 탄' : ''
    fireBtn.classList.remove('danger')
    fireBtn.querySelector('.ftext').textContent = 'FIRE'
  }

  const hpBar = (b) => bar(b.hp ?? 0, b.hpMax ?? CFG.PLANET_HP, '◆', '◇')
  el.querySelector('#stats').textContent =
    `ANTE ${game.ante}   STAGE ${game.stageIdx + 1}
SHOTS ${game.shots} (무제한 · 동시 1발)   SCORE ${game.score} (${game.runScore + game.score})
EARTH  ${e.alive ? hpBar(e) : 'LOST'}   TARGET ${t.alive ? hpBar(t) : '—'}
FORTRESS ${game.aliveFortresses}/${g.total}   HOME ${game.homeworld ? game.homeworld.name : '—'}
SYSTEM ${game.bodies.filter(b => b.alive && b.type !== 'debris').length} bodies   BELT R=${game.beltR.toFixed(0)}
> ${game.message}`

  const toast = el._toast
  if (game.toastT > 0 && game.toast) { toast.hidden = false; toast.textContent = game.toast }
  else toast.hidden = true
}
