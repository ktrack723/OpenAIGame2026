import { CFG } from '../game/config.js'

const clamp0 = (n) => Math.max(0, n)
const bar = (full, total, on, off) => on.repeat(clamp0(Math.min(full, total))) + off.repeat(clamp0(total - clamp0(Math.min(full, total))))
const degOf = (rad) => ((rad * 180 / Math.PI + 180) % 360 + 360) % 360 - 180

export function makeHud(game) {
  const el = document.createElement('div')
  el.className = 'hud'
  el.innerHTML = `<h1>PLANETPOOL</h1>
<p class="sub">핵미사일을 중력 스윙바이로 휘어 조르그 행성을 잡는 우주 당구. 조준 중 시간은 멈춰 있다 — 관측으로 판을 돌려라.</p>
<div class="grid">
<label>각도 <span id="angleV"></span><input id="angle" type="range" min="-180" max="180" step="0.5"></label>
<label>발사 속도 <span id="powerV"></span><input id="power" type="range" min="${CFG.LAUNCH_MIN}" max="${CFG.LAUNCH_MAX}"></label>
</div>
<button id="fire">발사 SPACE</button><button id="wait">관측 4× SHIFT</button><button id="next" hidden>다음 스테이지 ▶</button><button id="new">새 런</button>
<pre id="stats"></pre>`
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
  const wait = qs('#wait')
  const startWait = () => { game.observing = true }
  const stopWait = () => { game.observing = false }
  wait.onmousedown = startWait; wait.onmouseup = stopWait; wait.onmouseleave = stopWait
  wait.ontouchstart = (e) => { e.preventDefault(); startWait() }
  wait.ontouchend = stopWait; wait.ontouchcancel = stopWait
  addEventListener('keydown', (e) => {
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
  el.querySelector('#stats').textContent =
    `안테 ${game.ante} · 스테이지 ${game.stageIdx + 1} — 섬멸전 (차폐도 B ${game.stage.B.toFixed(1)})
목표 ${t.name}: HP ${clamp0(t.hp).toFixed(0)}/${t.hpMax.toFixed(0)}${t.alive ? '' : ' — 격파'}
로켓 ${bar(game.rockets, CFG.ROCKETS, '▮', '▯')}  점수 ${game.score} (런 누계 ${game.runScore + game.score})
지구 ${bar(e.hp, CFG.EARTH_HP, '♥', '♡')}  외교 ${bar(game.diplomacy, CFG.DIPLO_MAX, '●', '○')}
상태: ${game.message}`
  const toast = el._toast
  if (game.toastT > 0 && game.toast) { toast.hidden = false; toast.textContent = game.toast }
  else toast.hidden = true
}
