import { CFG, VIS } from '../game/config.js'
import { ROLES } from '../game/roles.js'

const hex = (n) => '#' + n.toString(16).padStart(6, '0')

const clamp0 = (n) => Math.max(0, n)
const bar = (full, total, on, off) => on.repeat(clamp0(Math.min(full, total))) + off.repeat(clamp0(total - clamp0(Math.min(full, total))))
const degOf = (rad) => ((rad * 180 / Math.PI + 180) % 360 + 360) % 360 - 180
const dirOf = (x, y) => (((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360).toFixed(0)

export function makeHud(game, view) {
  const el = document.createElement('div')
  el.className = 'hud'
  el.innerHTML = `<div class="hudtop"><h1>PLANETPOOL</h1><button id="fold" class="ghost" title="패널 접기">▾</button></div>
<div class="body">
<p class="sub">핵은 행성을 부수지 못한다. <b class="cy">민다</b>. 부수는 건 행성끼리의 충돌·태양·추방뿐이다. 조준 중 시간은 멈춰 있다.</p>
<div class="obj">
  <div class="objhead" id="goalHead">작전 목표</div>
  <div class="objname" id="objName">—</div>
  <div class="objprog"><i id="goalFill"></i></div>
  <div class="objrule" id="goalRule"></div>
  <div class="objhint">화면의 <b class="cy">시안 레티클 ◎</b>이 조르그, <b class="bl">파란 링 ◉</b>은 지구다.
  <b class="rd">지구에 핵을 박으면 그 자리에서 게임 오버.</b> 흰 링은 자유롭게 써도 되는 <b>큐볼</b>.
  <b class="am">노란 화살표</b> = 핵이 미는 방향, <b>흰 화살표</b> = 맞은 직후 그 공이 출발하는 방향.</div>
</div>
<div class="roles" id="roles" hidden></div>
<div class="clock" id="clock">
  <div class="clockrow"><span class="clocklabel">작전 시한</span><span class="clockv" id="clockV">—</span></div>
  <div class="clockbar"><i id="clockFill"></i></div>
  <div class="clocknote" id="clockNote"></div>
</div>
<div class="pred" id="pred"></div>
<div class="grid">
<label>각도 <span id="angleV"></span><input id="angle" type="range" min="-180" max="180" step="0.5"></label>
<label>발사 속도 <span id="powerV"></span><input id="power" type="range" min="${CFG.LAUNCH_MIN}" max="${CFG.LAUNCH_MAX}"></label>
<label class="wide">작약량 <span id="yieldV"></span><input id="yield" type="range" min="${CFG.YIELD_MIN}" max="${CFG.YIELD_MAX}" step="1"></label>
</div>
<div class="hint yieldnote" id="yieldNote"></div>
<button id="fire">발사 SPACE</button><button id="wait">관측 4× SHIFT</button><button id="next" hidden>다음 스테이지 ▶</button><button id="new">새 런</button>
<div class="viewrow">
  <span class="vlabel">화면</span>
  <button id="zout" class="ghost" title="축소 ( − )">－</button>
  <button id="zin" class="ghost" title="확대 ( + )">＋</button>
  <button id="zauto" class="ghost" title="목표 자동 프레이밍 ( 0 )">자동</button>
  <button id="zfull" class="ghost" title="성계 전체 ( 9 )">전체</button>
  <span class="zoomv" id="zoomV"></span>
</div>
<div class="hint">두 손가락으로 확대·축소, 한 손가락으로 화면 끌기 · 작약량 [ ]</div>
<pre id="stats"></pre>
</div>`
  document.body.appendChild(el)
  const toast = document.createElement('div')
  toast.className = 'toast'; toast.hidden = true
  document.body.appendChild(toast)
  el._toast = toast

  const qs = (id) => el.querySelector(id)
  const angle = qs('#angle'), power = qs('#power'), yieldIn = qs('#yield')
  const angleV = qs('#angleV'), powerV = qs('#powerV'), yieldV = qs('#yieldV')
  const syncLabels = () => {
    angleV.textContent = `${(+angle.value).toFixed(0)}°`
    powerV.textContent = `${power.value} GU/s`
    yieldV.textContent = `${yieldIn.value} Mt`
  }
  el._setSliders = () => {
    angle.value = degOf(game.aim).toFixed(1); power.value = game.power; yieldIn.value = game.yieldMt
    syncLabels()
  }
  el._setSliders()

  angle.oninput = (e) => { game.aim = (+e.target.value) * Math.PI / 180; syncLabels() }
  power.oninput = (e) => { game.power = +e.target.value; syncLabels() }
  yieldIn.oninput = (e) => { game.yieldMt = +e.target.value; syncLabels() }
  qs('#fire').onclick = () => game.fire()
  qs('#next').onclick = () => game.nextStage()
  qs('#new').onclick = () => { location.href = location.pathname + '?seed=' + ((Math.random() * 1e9) | 0) }
  qs('#fold').onclick = () => {
    el.classList.toggle('folded')
    qs('#fold').textContent = el.classList.contains('folded') ? '▸' : '▾'
  }

  // §14.1 카메라 조작 — 아이패드에서 핀치 말고 버튼으로도 확대/축소
  const rig = view.rig
  qs('#zin').onclick = () => rig.zoomBy(VIS.ZOOM_STEP)
  qs('#zout').onclick = () => rig.zoomBy(1 / VIS.ZOOM_STEP)
  qs('#zauto').onclick = () => rig.snapToAuto()
  qs('#zfull').onclick = () => rig.fullView()
  rig.attachHud(el)   // 자동 프레이밍이 패널 뒤로 천체를 숨기지 않게
  rig.snapToAuto()
  el._rig = rig

  const wait = qs('#wait')
  const startWait = () => { game.observing = true }
  const stopWait = () => { game.observing = false }
  wait.onmousedown = startWait; wait.onmouseup = stopWait; wait.onmouseleave = stopWait
  wait.ontouchstart = (e) => { e.preventDefault(); startWait() }
  wait.ontouchend = stopWait; wait.ontouchcancel = stopWait
  addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return
    if (e.code === 'Space') { e.preventDefault(); game.fire() }
    if (e.key === 'Shift') game.observing = true
    if (e.key === '[' || e.key === ']') {   // 작약량 미세 조정 — 슬라이더를 안 만져도 되게
      game.yieldMt = Math.max(CFG.YIELD_MIN, Math.min(CFG.YIELD_MAX, game.yieldMt + (e.key === ']' ? 1 : -1)))
      el._setSliders()
    }
  })
  addEventListener('keyup', (e) => { if (e.key === 'Shift') game.observing = false })
  return el
}

// 예측 = "어느 살을 치는가"까지. 그 뒤 판이 어떻게 굴러갈지는 안 알려준다.
function predLine(game, p) {
  const h = p.hit
  const role = h && h.role ? ROLES[h.role] : null
  const badge = role ? ` [${role.icon} ${role.label}]` : ''
  switch (p.outcome) {
    case 'earth': return ['bad', '지구 직격 — 즉시 게임 오버. 각도를 바꿔라']
    case 'shield': return ['warn', `${h.name} 방어막 — 직격 무효. 중립 행성을 큐볼로 써라`]
    case 'void': return ['warn', `${h.name}${badge} — ${role.aim}`]
    case 'volatile': return ['hit', `${h.name}${badge} — ${role.aim} (반경 ${h.volatileR.toFixed(0)} GU)`]
    case 'debris': return ['warn', '파편에 조기 폭발']
    case 'sun': return ['warn', '태양 소멸 — 근일점이 너무 낮다']
    case 'lost': return ['warn', '유실 — 성계 이탈 (파워 과다)']
    case 'timeout': return ['warn', `${CFG.MISSILE_TTL}초 내 접촉 없음 (자폭)`]
    case 'target':
    case 'neutral': {
      const tag = p.outcome === 'target' ? '◎ 조르그' : '큐볼'
      const note = (h.counter ? ' · 반격탄이 때린 쪽으로 튀어나온다' : '')
        + (h.role === 'armor' ? ' · 장갑에 막혀 거의 안 밀린다' : '')
      const warn = (h.earthInBlast ? ' · ⚠ 폭풍이 지구를 훑는다' : '')
        + (h.willEject ? ` · ⚠ 탈출속도 초과 (${h.vAfter.toFixed(0)}>${h.vEsc.toFixed(0)}) — 성계 밖으로 날아간다` : '')
      return [warn ? 'warn' : 'hit',
        `${tag} ${h.name}${badge} 타격 — ${dirOf(h.dx, h.dy)}° 방향으로 Δv ${h.dv.toFixed(1)}${note}${warn}`]
    }
    default: return ['warn', '—']
  }
}

export function updateHud(el, game) {
  if (el._stageIdx !== game.stageIdx) { el._stageIdx = game.stageIdx; el._setSliders() }
  el.querySelector('#next').hidden = !(game.won && !game.runOver)
  const t = game.target, e = game.earth, g = game.goal

  // 목표 패널 — 목표 종류 · 진행도 · 규칙 한 줄
  const dx = t.pos.x - e.pos.x, dy = t.pos.y - e.pos.y
  const dist = Math.hypot(dx, dy)
  el.querySelector('#goalHead').textContent = `안테 ${game.ante} 작전 — ${g.title}`
  el.querySelector('#objName').textContent =
    `${g.label()}   ▸ ◎ ${t.name} · 거리 ${dist.toFixed(0)} GU · 방위 ${(((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360).toFixed(0)}°`
  el.querySelector('#goalFill').style.width = `${Math.min(100, g.done / g.need * 100).toFixed(0)}%`
  el.querySelector('#goalRule').textContent = g.rule

  // 특수 천체 범례 — 이 판에 실제로 깔린 것만. 색은 화면의 점선 링과 같다.
  const rolesEl = el.querySelector('#roles')
  if (el._roleKey !== game.stageIdx) {
    el._roleKey = game.stageIdx
    const list = game.stage.roles ?? []
    rolesEl.hidden = !list.length
    rolesEl.innerHTML = list.map(k => {
      const d = ROLES[k]
      return `<div class="rolerow"><b style="color:${hex(d.color)}">${d.icon} ${d.label}</b><span>${d.brief}</span></div>`
    }).join('')
  }

  const rig = el._rig
  if (rig) el.querySelector('#zoomV').textContent = `${rig.zoom.toFixed(1)}×${rig.auto ? ' 자동' : ''}`

  // 작전 시한 — 인게임 시간. 조준 중엔 안 흐르고 관측(4×)/비행 중에만 줄어든다
  const left = game.timeLeft, frac = left / game.stageTime
  const mm = Math.floor(left / 60), ss = Math.floor(left % 60)
  const clock = el.querySelector('#clock')
  el.querySelector('#clockV').textContent = `${mm}:${String(ss).padStart(2, '0')}`
  el.querySelector('#clockFill').style.width = `${Math.max(0, frac * 100).toFixed(1)}%`
  clock.className = 'clock' + (frac <= 0.15 ? ' crit' : frac <= 0.4 ? ' warn' : '')
  const scale = game.effTimeScale()
  el.querySelector('#clockNote').textContent = game.won
    ? `정지 — 시간 보너스 +${game.timeBonus} 확정`
    : scale === 0 ? `정지 (조준 중) · 클리어 시 시간 보너스 +${game.timeBonus}`
      : game.rockets <= 0 && !game.missiles.some(m => m.alive)
        ? `전탄 소진 — 판이 굴러가는 중 (${scale}×)`
        : `${scale}× 진행 중 ▼ · 시간 보너스 +${game.timeBonus}`

  // 작약량 — 밀어내는 힘과 폭풍 반경이 같이 커진다
  el.querySelector('#yieldNote').textContent =
    `Δv = ${CFG.NUKE_IMPULSE}×${game.yieldMt}/질량 · 폭풍 반경 ${(CFG.BLAST_R * game.yieldMt).toFixed(0)} GU (입사각·속도는 힘에 영향 없음)`

  const predEl = el.querySelector('#pred')
  if (game.canAim) {
    const [cls, text] = predLine(game, game.predictPath())
    predEl.hidden = false
    predEl.className = `pred ${cls}`
    predEl.textContent = `조준 ▸ ${text}`
  } else predEl.hidden = true

  el.querySelector('#stats').textContent =
    `안테 ${game.ante} · 스테이지 ${game.stageIdx + 1}
로켓 ${bar(game.rockets, CFG.ROCKETS, '▮', '▯')}  점수 ${game.score} (런 누계 ${game.runScore + game.score})
지구 ${e.alive ? '정상' : '상실'}  ·  살아있는 조르그 ${game.aliveTargets}/${game.targets.length}
상태: ${game.message}`
  const toast = el._toast
  if (game.toastT > 0 && game.toast) { toast.hidden = false; toast.textContent = game.toast }
  else toast.hidden = true
}
