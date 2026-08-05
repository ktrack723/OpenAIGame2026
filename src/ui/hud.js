import { CFG, VIS } from '../game/config.js'

const clamp0 = (n) => Math.max(0, n)
const bar = (full, total, on, off) => on.repeat(clamp0(Math.min(full, total))) + off.repeat(clamp0(total - clamp0(Math.min(full, total))))
const degOf = (rad) => ((rad * 180 / Math.PI + 180) % 360 + 360) % 360 - 180
const meter = (v, max, n = 12) => { const k = Math.round(clamp0(Math.min(1, v / max)) * n); return '█'.repeat(k) + '░'.repeat(n - k) }

export function makeHud(game, view) {
  const el = document.createElement('div')
  el.className = 'hud'
  el.innerHTML = `<div class="hudtop"><h1>PLANETPOOL</h1><button id="fold" class="ghost" title="패널 접기">▾</button></div>
<div class="body">
<p class="sub">핵미사일을 중력 스윙바이로 휘어 조르그 행성을 잡는 우주 당구. 조준 중 시간은 멈춰 있다 — 관측으로 판을 돌려라.</p>
<div class="obj">
  <div class="objhead">작전 목표 — 조르그 행성 격파</div>
  <div class="objname" id="objName">—</div>
  <div class="objhp"><span id="objHp"></span></div>
  <div class="objhint">화면의 <b class="cy">시안 레티클 ◎</b>이 목표다. 화면 밖이면 가장자리 <b class="cy">화살표</b>가 방향을 가리킨다.
  <b class="bl">파란 링 ◉</b>은 지구, <b class="rd">붉은 링</b>은 맞히면 파울.
  발사는 지구 중력권 <b class="bl">바깥 발사대</b>(파란 점선 끝)에서 나간다.
  <b class="cy">느리게 쏠수록 크게 휜다</b> — 스윙바이로 가속해서 때려라.</div>
</div>
<div class="clock" id="clock">
  <div class="clockrow"><span class="clocklabel">작전 시한</span><span class="clockv" id="clockV">—</span></div>
  <div class="clockbar"><i id="clockFill"></i></div>
  <div class="clocknote" id="clockNote"></div>
</div>
<div class="pred" id="pred"></div>
<div class="grid">
<label>각도 <span id="angleV"></span><input id="angle" type="range" min="-180" max="180" step="0.5"></label>
<label>발사 속도 <span id="powerV"></span><input id="power" type="range" min="${CFG.LAUNCH_MIN}" max="${CFG.LAUNCH_MAX}"></label>
</div>
<button id="fire">발사 SPACE</button><button id="wait">관측 4× SHIFT</button><button id="next" hidden>다음 스테이지 ▶</button><button id="new">새 런</button>
<div class="viewrow">
  <span class="vlabel">화면</span>
  <button id="zout" class="ghost" title="축소 ( − )">－</button>
  <button id="zin" class="ghost" title="확대 ( + )">＋</button>
  <button id="zauto" class="ghost" title="목표 자동 프레이밍 ( 0 )">자동</button>
  <button id="zfull" class="ghost" title="성계 전체 ( 9 )">전체</button>
  <span class="zoomv" id="zoomV"></span>
</div>
<div class="hint">두 손가락으로 확대·축소, 한 손가락으로 화면 끌기</div>
<pre id="stats"></pre>
</div>`
  document.body.appendChild(el)
  const toast = document.createElement('div')
  toast.className = 'toast'; toast.hidden = true
  document.body.appendChild(toast)
  el._toast = toast

  const qs = (id) => el.querySelector(id)
  const angle = qs('#angle'), power = qs('#power'), angleV = qs('#angleV'), powerV = qs('#powerV')
  const syncLabels = () => { angleV.textContent = `${(+angle.value).toFixed(0)}°`; powerV.textContent = `${power.value} GU/s` }
  el._setSliders = () => { angle.value = degOf(game.aim).toFixed(1); power.value = game.power; syncLabels() }
  el._setSliders()

  angle.oninput = (e) => { game.aim = (+e.target.value) * Math.PI / 180; syncLabels() }
  power.oninput = (e) => { game.power = +e.target.value; syncLabels() }
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
  })
  addEventListener('keyup', (e) => { if (e.key === 'Shift') game.observing = false })
  return el
}

export function updateHud(el, game) {
  if (el._stageIdx !== game.stageIdx) { el._stageIdx = game.stageIdx; el._setSliders() }
  el.querySelector('#next').hidden = !(game.won && !game.runOver)
  const t = game.target, e = game.earth

  // 목표 패널 — 이름 · HP 게이지 · 지구로부터의 거리/방위
  const dx = t.pos.x - e.pos.x, dy = t.pos.y - e.pos.y
  const dist = Math.hypot(dx, dy), brg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360
  el.querySelector('#objName').textContent = t.alive ? `◎ ${t.name}` : `◎ ${t.name} — 격파 완료`
  el.querySelector('#objHp').textContent =
    `HP ${meter(clamp0(t.hp), t.hpMax)} ${clamp0(t.hp).toFixed(0)}/${t.hpMax.toFixed(0)}   거리 ${dist.toFixed(0)} GU · 방위 ${brg.toFixed(0)}°`

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
      : `${scale}× 진행 중 ▼ · 시간 보너스 +${game.timeBonus}`

  // 예측 결말 — 경로가 화면 밖에서 끝나도 결과를 읽을 수 있게 글로도 적는다
  const predEl = el.querySelector('#pred')
  if (game.canAim) {
    const p = game.predictPath()
    const label = {
      target: ['hit', `목표 명중 — ${game.target.name}`],
      earth: ['bad', '지구 오폭! 각도를 바꿔라'],
      foul: ['bad', `파울 — ${p.hit ? p.hit.name : '중립 행성'} 침범`],
      debris: ['warn', '파편에 소실'],
      sun: ['warn', '태양 소멸 — 근일점이 너무 낮다'],
      lost: ['warn', '유실 — 성계 이탈'],
      timeout: ['warn', `${CFG.MISSILE_TTL}초 내 미도달 (자폭)`],
    }[p.outcome] || ['warn', '—']
    predEl.hidden = false
    predEl.className = `pred ${label[0]}`
    predEl.textContent = `예상 결말 ▸ ${label[1]}`
  } else predEl.hidden = true

  el.querySelector('#stats').textContent =
    `안테 ${game.ante} · 스테이지 ${game.stageIdx + 1} — 섬멸전 (차폐도 B ${game.stage.B.toFixed(1)})
로켓 ${bar(game.rockets, CFG.ROCKETS, '▮', '▯')}  점수 ${game.score} (런 누계 ${game.runScore + game.score})
지구 ${bar(e.hp, CFG.EARTH_HP, '♥', '♡')}  외교 ${bar(game.diplomacy, CFG.DIPLO_MAX, '●', '○')}
상태: ${game.message}`
  const toast = el._toast
  if (game.toastT > 0 && game.toast) { toast.hidden = false; toast.textContent = game.toast }
  else toast.hidden = true
}
