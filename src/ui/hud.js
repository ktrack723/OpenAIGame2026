import { CFG, VIS, hitRadiusOf } from '../game/config.js'
import { ROLES } from '../game/roles.js'
import { bearing, toDeg180 } from '../core/angle.js'
import { defeatArt, defeatTag } from './defeatArt.js'

const hex = (n) => '#' + n.toString(16).padStart(6, '0')
const clamp0 = (n) => Math.max(0, n)
const bar = (full, total, on, off) => on.repeat(clamp0(Math.min(full, total))) + off.repeat(clamp0(total - clamp0(Math.min(full, total))))
const dirOf = (x, y) => bearing(x, y).toFixed(0)

// ─── 스테퍼 ─────────────────────────────────────────────────────
// 슬라이더는 모바일에서 정밀 조작이 안 된다(트랙 1px이 0.5°가 넘는다).
// 그래서 버튼이다. **한 번 누르면 한 칸** — 누른 만큼만 정확히 움직이는 게
// 조준에서는 연속 이동보다 낫다(원하는 각을 지나치지 않는다).
// 누르고 있으면 같은 칸이 가속 반복된다.
//
// 칸은 방향마다 셋이다: 미세 / 보통 / 큼. 각도는 0.1° / 1° / 10° —
// 0.1°는 2000 GU 밖에서 3.5 GU를 옮기는 값이라 이 판의 실질 최소 단위다.
function stepper(id, label, unit, steps) {
  const [fine, mid, big] = steps
  const btn = (d, cls, txt, amt) =>
    `<button class="stepbtn ${cls}" data-d="${d}" title="${label} ${d > 0 ? '+' : '−'}${amt}${unit}"
      aria-label="${label} ${d > 0 ? '증가' : '감소'} ${amt}">${txt}</button>`
  return `<div class="step" id="${id}">
  <span class="steplabel">${label}</span>
  ${btn(-3, 'big', '◀◀', big)}${btn(-2, 'mid', '◀', mid)}${btn(-1, 'fine', '‹', fine)}
  <span class="stepval" id="${id}V">—</span>
  ${btn(1, 'fine', '›', fine)}${btn(2, 'mid', '▶', mid)}${btn(3, 'big', '▶▶', big)}
  <span class="stepunit">${unit}</span>
</div>`
}

// 누르고 있으면 같은 칸이 가속 반복된다(첫 반복 340ms → 최소 45ms).
// 한 번 톡 누르면 정확히 한 칸만 움직인다 — 조준은 그게 맞다.
function holdRepeat(btn, fn) {
  let timer = null, delay = 340
  const stop = () => { clearTimeout(timer); timer = null; delay = 340 }
  const tick = () => { fn(); delay = Math.max(45, delay * 0.72); timer = setTimeout(tick, delay) }
  btn.addEventListener('pointerdown', (e) => {
    if (btn.disabled) return
    e.preventDefault()
    // 포인터 캡처는 있으면 좋고 없어도 그만 — 실패가 반복 시작을 막으면 안 된다
    try { btn.setPointerCapture?.(e.pointerId) } catch { /* 무시 */ }
    fn(); timer = setTimeout(tick, delay)
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
  ${stepper('angle', '각도', '°', [0.1, 1, 10])}
  ${stepper('power', '속도', 'GU/s', [1, 5, 10])}
  ${stepper('yield', '작약', 'Mt', [1, 3, 6])}
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
  <div class="hint">TAB 조준/관측 전환 · SHIFT 시간 진행 · S 관측 배속 · ← → 각도 1°(SHIFT 0.1°) · ↑ ↓ 속도 · [ ] 작약 · F 접촉각<br>
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
  over.innerHTML = `<div class="goart" id="overArt"></div>
<div class="gotext"><div class="gotag" id="overTag"></div><h2>작전 실패</h2><p id="overWhy"></p></div>
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
  // 칸 크기는 stepper() 마크업과 같은 값을 쓴다(data-d 1/2/3 = 미세/보통/큼).
  // 각도만 0.1° 단위로 스냅한다 — 눈금이 어긋나면 미세 조정이 의미를 잃는다.
  const snap = (v, q) => Math.round(v / q) * q
  const CTL = {
    angle: {
      steps: [0.1, 1, 10],
      get: () => toDeg180(game.aim),
      set: (v) => { game.aim = snap(v, 0.1) * Math.PI / 180 },
      fmt: (v) => v.toFixed(1),
    },
    power: {
      steps: [1, 5, 10],
      get: () => game.power,
      set: (v) => { game.power = clamp(Math.round(v), CFG.LAUNCH_MIN, CFG.LAUNCH_MAX) },
      fmt: (v) => v.toFixed(0),
    },
    yield: {
      steps: [1, 3, 6],
      get: () => game.yieldMt,
      set: (v) => { game.yieldMt = clamp(Math.round(v), CFG.YIELD_MIN, CFG.YIELD_MAX) },
      fmt: (v) => v.toFixed(0),
    },
  }
  el._sync = () => { for (const k in CTL) qs(`#${k}V`).textContent = CTL[k].fmt(CTL[k].get()) }
  for (const k in CTL) {
    const c = CTL[k]
    for (const btn of qs(`#${k}`).querySelectorAll('.stepbtn')) {
      const d = +btn.dataset.d
      const amount = c.steps[Math.abs(d) - 1] * Math.sign(d)
      holdRepeat(btn, () => { if (!game.canAim) return; c.set(c.get() + amount); el._sync() })
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
    // 개막 중에는 키도 같이 잠근다. 화면에서 패널을 걷고 버튼을 disabled로
    // 만들어도 키보드는 그대로 살아 있어서, 막 뒤에서 SPACE로 발사하거나
    // SHIFT로 시간을 흘려보낼 수 있었다 — 막이 있으나 마나였다.
    if (game.warpCurtain) return
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
    if (e.key === 'ArrowLeft') { e.preventDefault(); step('angle', fine ? -0.1 : -1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); step('angle', fine ? 0.1 : 1) }
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
//                 지구가 폭풍 반경에 들어간다, 맞은 공이 벨트까지 날아갔다 돌아온다.
//                 조건은 전부 "지금 이 한 발에서 확정적으로 참"인 것들이라
//                 추측이나 확률은 한 줄도 넣지 않는다.
//
// 넣지 않는 것(의도적):
//   · 2차 충돌 — "이 공이 저 공에 맞는다"는 절대 안 알려준다. 그걸 읽는 게 게임이다.
//   · 판의 승패 예측, 점수 예상, 최적 각도 추천.
//   · 확률·추정치. LCD에 뜨는 숫자는 전부 결정론적 계산 결과다.
function predLine(game, p) {
  const h = p.hit
  const role = h && h.role ? ROLES[h.role] : null
  const badge = role ? ` [${role.icon}${role.label}]` : ''
  switch (p.outcome) {
    case 'earth': return ['bad', 'ABORT', '지구 직격 — 즉시 게임 오버', '각도를 바꿔라']
    case 'void': return ['warn', 'VOID', `${h.name}${badge}`, role.aim]
    case 'volatile': return ['hit', 'CHAIN', `${h.name}${badge}`, `${role.aim} · 반경 ${h.volatileR.toFixed(0)} GU`]
    case 'debris': return ['warn', 'DEBRIS', '파편에 조기 폭발', '']
    case 'sun': return ['warn', 'SOLAR', '태양 소멸', '근일점이 너무 낮다']
    // '성계 이탈(유실)'은 없다 — 카이퍼 벨트가 튕겨 되돌려 보낸다.
    case 'timeout': return ['warn', 'NO CTC', `${CFG.MISSILE_TTL}초 내 접촉 없음`, '자폭']
    case 'target':
    case 'neutral': {
      const tag = p.outcome === 'target' ? 'TARGET' : 'CUE'
      // [2층] 이 접촉이 그 공에 즉시 일으키는 것 — 충격 방향/세기, 진로, 체력.
      // 화면 위 화살표와 같은 이름을 쓴다 — 노란 화살표 = 충격 방향,
      // 흰 화살표 = 바뀐 진로. 숫자는 여기(LCD)에만 둔다.
      const direct = [
        `충격 방향 ${dirOf(h.dx, h.dy)}° Δv ${h.dv.toFixed(1)}`,
        `바뀐 진로 ${dirOf(h.vx, h.vy)}° ${Math.hypot(h.vx, h.vy).toFixed(0)}GU/s`,
        `체력 ${h.hp}/${h.hpMax}`,
      ].join(' · ')
      // [3층] 의도하지 않았을 부작용만. 전부 이 한 발에서 확정적으로 참인 것.
      const warn = [
        h.earthInBlast ? '⚠ 폭풍 반경에 지구가 들어간다' : '',
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
  TIME_UP: '',   // 시한 종료는 '그들이 왔다…' 한 줄로만 — 설명하지 않는다
  EARTH_LASER: `조르그 레이저가 지구를 관통했다. ${CFG.LASER_CHARGE}초의 조준 시간 안에 선을 끊었어야 했다.`,
}

// 패배 화면을 올리기까지 기다리는 실시간(ms). 지구 화구가 피었다 잦아드는
// 시간이다 — 이보다 짧으면 자기가 어떻게 죽었는지 못 보고 패널만 본다.
const OVER_DELAY = 2200

const CTRL_IDS = ['#fire', '#findPrev', '#findNext']

export function updateHud(el, game) {
  if (el._stageIdx !== game.stageIdx) { el._stageIdx = game.stageIdx; el._sync() }

  // ── 모드 전환 — 관측 중에는 패널을 통째로 감추고 버튼 하나만 남긴다 ──
  // cinematic: 오프닝 예고편의 "예측선만" 컷. 예측선은 조준 모드에서만 그려지는데
  // (canAim), 그 컷은 조준 패널을 안 보여 주는 게 요점이라 모드는 조준으로 두고
  // 패널과 관측 바를 둘 다 걷어낸다.
  const cine = !!game.cinematic
  const observing = ((game.mode === 'observe' || !!game.doom) && !game.runOver) || cine
  if (el._observing !== observing || el._cine !== cine) {
    el._observing = observing
    el._cine = cine
    el.hidden = observing
    el._obsBar.hidden = !observing || cine
  }

  // ── 조작을 걷어내는 두 순간 — 둘 다 **페이드**다 ──────────────
  // ① 판이 시작될 때: 조르그가 워프해 들어오는 동안은 아직 내 차례가 아니다.
  //    화면이 뜨자마자 패널부터 들이밀면 "무슨 일이 벌어지는지"를 못 본다.
  //    스폰이 **전부** 끝나고 한 박자 더 지난 뒤에 조준 UI가 떠오른다.
  //    판마다 똑같다 — 1스테이지도, 다음 침공도.
  // ② 승부가 갈린 순간: 결과 메시지가 뜨기 **전에** 먼저 조작을 끈다.
  //    이겼는지 졌는지 이미 정해졌는데 버튼이 살아 있으면 거짓말이다.
  const decided = game.runOver || game.won || game.lost
  // 판이 열리는 구간은 game이 재 준다(warpCurtain) — 화면에서 이름표·레티클을
  // 걷는 것도 같은 신호를 쓰므로, 시계가 두 군데 있으면 둘이 어긋난다.
  const veil = decided || game.warpCurtain
  if (el._veil !== veil) {
    el._veil = veil
    el.classList.toggle('veil', veil)
    el._obsBar.classList.toggle('veil', veil)
    // 버튼은 시각적으로만 지우는 게 아니라 실제로 잠근다
    for (const btn of el.querySelectorAll('button')) btn.disabled = veil
    // 막이 걷힐 때 전부 다시 열어 버렸으므로, 조준 가능 여부에 따른 잠금은
    // 아래에서 다시 계산하게 한다(안 그러면 발사 불가 상태에서도 버튼이 산다).
    el._aimable = undefined
  }
  if (observing) {
    // 버튼 하나에 접어 넣는 최소 정보: 배속 · 남은 시한 · 레이저 경보
    const left = game.timeLeft
    const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`
    const sub = game.doom
      ? '그들이 왔다…'
      : game.laserCharging
      ? `⚠ 레이저 T-${game.laserLeft.toFixed(0)}s · 빗나감 ${game.laserMiss.toFixed(0)} GU`
        + (game.laserSafe ? ' — 지금은 산다' : ' — 지금은 맞는다')
      : game.laserFlying
        ? `⚠ 레이저 비행 중 — 도달까지 ${game.laserImpactLeft.toFixed(1)}s`
        : `${game.effTimeScale()}× 진행 중 · 잔여 ${clock}`
    const alarm = game.laserCharging || game.laserFlying || !!game.doom
    const bar = el._obsBar, btn = bar.querySelector('#toAim')
    if (btn._sub !== sub) { btn._sub = sub; bar.querySelector('#obsSub').textContent = sub }
    btn.classList.toggle('alarm', alarm)
    const spd = game.obsSpeedLabel
    if (bar._spd !== spd) { bar._spd = spd; bar.querySelector('#obsSpdV').textContent = spd }
    return   // 패널이 숨겨져 있으므로 나머지 갱신은 통째로 건너뛴다
  }

  const aimable = game.canAim && !veil
  if (el._aimable !== aimable) {
    el._aimable = aimable
    for (const id of CTRL_IDS) el.querySelector(id).disabled = !aimable
    for (const b of el.querySelectorAll('.stepbtn')) b.disabled = !aimable
    el.classList.toggle('locked', !aimable)
  }

  // ── 패배 화면 ──────────────────────────────────────────────
  // **바로 띄우지 않는다.** 지구가 터지는 순간에 패널이 덮어 버리면 플레이어는
  // 자기가 어떻게 죽었는지를 못 본다. 폭발이 피고 화구가 사그라들 시간을 준 뒤에
  // 올린다(OVER_DELAY). 그동안 판은 이미 멈춰 있고 파티클만 실시간으로 돈다.
  const over = el._over
  if (game.runOver && el._overAt === undefined) el._overAt = performance.now()
  if (!game.runOver) { el._overAt = undefined; over.hidden = true }
  else if (over.hidden && performance.now() - el._overAt >= OVER_DELAY) {
    over.hidden = false
    // 시한 종료는 제목부터 다르다 — 설명 없이 그 한 줄만 남긴다.
    const doom = game.failReason === 'TIME_UP'
    over.querySelector('h2').textContent = doom ? '그들이 왔다…' : '작전 실패'
    over.classList.toggle('doom', doom)
    over.querySelector('#overArt').innerHTML = defeatArt(game.failReason)
    over.querySelector('#overTag').textContent = defeatTag(game.failReason)
    const why = FAIL_WHY[game.failReason] ?? game.message
    over.querySelector('#overWhy').textContent =
      why ? `${why}  ·  최종 점수 ${game.runScore + game.score}` : `최종 점수 ${game.runScore + game.score}`
    el.querySelector('#wait').disabled = true
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
  // 문구는 상태마다 딱 한 줄씩. 충전 중에는 "무엇을 하면 되는가"만,
  // 비행 중에는 "언제 닿는가"만 말한다 — 읽을 게 많으면 아무것도 안 읽힌다.
  const lm = el.querySelector('#laserMod')
  if (game.laserCharging) {
    lm.hidden = false
    lm.classList.toggle('ok', game.laserSafe)
    el.querySelector('#laserT').textContent = `T-${game.laserLeft.toFixed(1)}s`
    el.querySelector('#laserWhy').textContent =
      `조준선에서 지구까지 ${game.laserMiss.toFixed(0)} GU — `
      + (game.laserSafe ? '이대로면 빗나간다.' : `아직 맞는다(${hitRadiusOf(game.earth).toFixed(0)} GU 넘겨야 산다).`)
      + ' 조르그는 지구가 원래 궤도를 돈다고 보고 겨눈다 — 폭풍으로 밀면 그만큼 조준이 틀어진다.'
      + ' 행성으로 ◇ 선을 막아도 되고(그 행성은 소멸), 탄두를 선 위에 걸쳐 두면 요격된다.'
  } else if (game.laserFlying) {
    lm.hidden = false
    lm.classList.remove('ok')
    el.querySelector('#laserT').textContent = `착탄 ${game.laserImpactLeft.toFixed(1)}s`
    el.querySelector('#laserWhy').textContent =
      '광선이 날아가는 중이다 — 조준점에서 멈추지 않고 직진한다. '
      + '닿는 첫 천체는 체력과 무관하게 소멸한다(태양·특이점은 막기만 한다). '
      + `진로에 내 탄두가 ${CFG.LASER_INTERCEPT_R} GU 안으로 걸리면 그 자리에서 터지며 광선이 끊긴다.`
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
    fireBtn.disabled = game.inFlight || veil
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
