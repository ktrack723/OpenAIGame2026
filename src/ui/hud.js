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
  <div class="modhead"><span class="tick"></span><span>SPECIAL BODIES</span></div>
  <div class="roles" id="roles"></div>
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
    <button id="findIc" class="ghost intercept" hidden title="비행 중인 탄과 만나는 각도">✚ 요격각</button>
  </div>
  <div class="lcd" id="lcd">
    <div class="lcdscan"></div>
    <div class="lcdline"><b id="lcdTag">READY</b><span id="lcdText">조준 대기</span></div>
    <div class="lcdsub" id="lcdSub"></div>
  </div>
  <button id="fire" class="firebtn"><span class="fkey">SPACE</span><span class="ftext">FIRE</span><i class="fglow"></i></button>
  <div class="btnrow">
    <button id="wait" class="ghost wide">관측 ▶▶ (SHIFT)</button>
    <button id="next" class="go" hidden>다음 스테이지 ▶</button>
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
  <div class="hint">← → 각도 · ↑ ↓ 속도 · [ ] 작약 · F 접촉각 · SHIFT = 미세</div>
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

  const qs = (id) => el.querySelector(id)

  // ── 스테퍼 배선 ────────────────────────────────────────────
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const CTL = {
    angle: { fine: 1, coarse: 8, get: () => toDeg180(game.aim), set: (v) => { game.aim = v * Math.PI / 180 }, fmt: (v) => v.toFixed(1) },
    power: { fine: 1, coarse: 5, get: () => game.power, set: (v) => { game.power = clamp(v, CFG.LAUNCH_MIN, CFG.LAUNCH_MAX) }, fmt: (v) => v.toFixed(0) },
    yield: { fine: 1, coarse: 3, get: () => game.yieldMt, set: (v) => { game.yieldMt = clamp(v, CFG.YIELD_MIN, CFG.YIELD_MAX) }, fmt: (v) => v.toFixed(0) },
  }
  el._sync = () => { for (const k in CTL) qs(`#${k}V`).textContent = CTL[k].fmt(CTL[k].get()) }
  for (const k in CTL) {
    for (const btn of qs(`#${k}`).querySelectorAll('.stepbtn')) {
      const d = +btn.dataset.d
      const amount = (Math.abs(d) === 2 ? CTL[k].coarse : CTL[k].fine) * Math.sign(d)
      holdRepeat(btn, () => { if (!game.canAim) return; CTL[k].set(CTL[k].get() + amount); el._sync() })
    }
  }
  el._sync()

  qs('#fire').onclick = () => game.fire()
  qs('#findNext').onclick = () => { game.scanContact(1); el._sync() }
  qs('#findPrev').onclick = () => { game.scanContact(-1); el._sync() }
  qs('#findIc').onclick = () => { game.findIntercept(); el._sync() }
  qs('#next').onclick = () => game.nextStage()
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

  const wait = qs('#wait')
  const startWait = () => { game.observing = true; wait.classList.add('on') }
  const stopWait = () => { game.observing = false; wait.classList.remove('on') }
  wait.onmousedown = startWait; wait.onmouseup = stopWait; wait.onmouseleave = stopWait
  wait.ontouchstart = (e) => { e.preventDefault(); startWait() }
  wait.ontouchend = stopWait; wait.ontouchcancel = stopWait

  addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return
    if (e.code === 'Space') { e.preventDefault(); game.fire() }
    if (e.key === 'Shift') startWait()
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

// ─── LCD 문구 ───────────────────────────────────────────────────
// 예측 = "어느 살을 치는가"까지. 그 뒤 판이 어떻게 굴러갈지는 안 알려준다.
// [등급, 태그, 본문, 부가] — 태그는 LCD 왼쪽에 박히는 짧은 상태어.
function predLine(game, p) {
  const h = p.hit
  const role = h && h.role ? ROLES[h.role] : null
  const badge = role ? ` [${role.icon}${role.label}]` : ''
  switch (p.outcome) {
    case 'earth': return ['bad', 'ABORT', '지구 직격 — 즉시 게임 오버', '각도를 바꿔라']
    case 'shield': return ['warn', 'BLOCK', `${h.name} 방어막`, '직격 무효 — 중립 행성을 큐볼로']
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
      const sub = [
        h.counter ? '반격탄이 때린 쪽으로 튀어나온다' : '',
        h.role === 'armor' ? '장갑 — 거의 안 밀린다' : '',
        h.earthInBlast ? '⚠ 폭풍이 지구를 훑는다' : '',
        h.willEject ? `⚠ 탈출속도 초과 ${h.vAfter.toFixed(0)}>${h.vEsc.toFixed(0)}` : '',
      ].filter(Boolean).join(' · ')
      return [(h.earthInBlast || h.willEject) ? 'warn' : 'hit', tag,
        `${h.name}${badge} — ${dirOf(h.dx, h.dy)}° Δv ${h.dv.toFixed(1)}`, sub]
    }
    default: return ['warn', '—', '—', '']
  }
}

const FAIL_WHY = {
  EARTH_LOST: '지구를 잃었다. 조르그보다 먼저 인류가 끝났다.',
  TIME_UP: '작전 시한이 끝났다. 조르그가 회랑을 재정비했다.',
  GOAL_LOST: '목표를 채울 표적이 남지 않았다. 요구된 방식으로는 더 이상 불가능하다.',
}

const CTRL_IDS = ['#fire', '#findPrev', '#findNext', '#findIc']

export function updateHud(el, game) {
  if (el._stageIdx !== game.stageIdx) { el._stageIdx = game.stageIdx; el._sync() }
  el.querySelector('#next').hidden = !(game.won && !game.runOver)

  // 요격각 버튼은 비행 중인 탄이 있을 때만
  const foeUp = game.missiles.some(m => m.alive)
  if (el._foeUp !== foeUp) { el._foeUp = foeUp; el.querySelector('#findIc').hidden = !foeUp }

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

  const rig = el._rig
  if (rig) el.querySelector('#zoomV').textContent = `${rig.zoom.toFixed(1)}×${rig.auto ? ' AUTO' : ''}`

  const left = game.timeLeft, frac = left / game.stageTime
  const clock = el.querySelector('#clock')
  el.querySelector('#clockV').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`
  el.querySelector('#clockFill').style.width = `${Math.max(0, frac * 100).toFixed(1)}%`
  clock.className = 'mod' + (frac <= 0.15 ? ' crit' : frac <= 0.4 ? ' warn' : '')
  const scale = game.effTimeScale()
  el.querySelector('#clockNote').textContent = game.won
    ? `정지 — 시간 보너스 +${game.timeBonus} 확정`
    : scale === 0 ? `정지 (조준 중) · 클리어 시 +${game.timeBonus}`
      : game.rockets <= 0 && !game.missiles.some(m => m.alive)
        ? `전탄 소진 — 판이 굴러가는 중 (${scale}×)`
        : `${scale}× 진행 중 ▼ · 시간 보너스 +${game.timeBonus}`

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
    fireBtn.querySelector('.ftext').textContent = p.outcome === 'earth' ? 'ABORT — 지구 직격' : 'FIRE'
  } else {
    lcd.className = 'lcd off'
    el.querySelector('#lcdTag').textContent = game.runOver ? 'DEAD' : 'HOLD'
    el.querySelector('#lcdText').textContent = game.runOver ? '작전 종료' : '발사 불가'
    el.querySelector('#lcdSub').textContent = game.rockets <= 0 ? '로켓 소진' : ''
    fireBtn.classList.remove('danger')
    fireBtn.querySelector('.ftext').textContent = 'FIRE'
  }

  el.querySelector('#stats').textContent =
    `ANTE ${game.ante}   STAGE ${game.stageIdx + 1}
ROCKET ${bar(game.rockets, CFG.ROCKETS, '▮', '▯')}   SCORE ${game.score} (${game.runScore + game.score})
EARTH  ${e.alive ? 'NOMINAL' : 'LOST'}   ZORG ${game.aliveTargets}/${game.targets.length}
> ${game.message}`

  const toast = el._toast
  if (game.toastT > 0 && game.toast) { toast.hidden = false; toast.textContent = game.toast }
  else toast.hidden = true
}
