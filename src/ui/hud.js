import { CFG, VIS, hitRadiusOf } from '../game/config.js'
import { ROLES, roleAim, roleBrief, roleLabel } from '../game/roles.js'
import { bearing, toDeg180 } from '../core/angle.js'
import { defeatArt, defeatTag } from './defeatArt.js'
import { LANGS, getLang, langLabel, onLangChange, setLang, t, tx, nameOf, msg } from '../i18n/index.js'

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
function stepper(id, labelKey, unitKey, steps) {
  const [fine, mid, big] = steps
  const label = t(labelKey), unit = t(unitKey)
  const btn = (d, cls, txt, amt) =>
    `<button class="stepbtn ${cls}" data-d="${d}" title="${label} ${d > 0 ? '+' : '−'}${amt}${unit}"
      aria-label="${t(d > 0 ? 'ui.step.inc' : 'ui.step.dec', { label, amount: amt })}">${txt}</button>`
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
  // ── 패널 구성 ───────────────────────────────────────────────
  // 화면에 남는 것은 **누르는 것과 그 자리에서 읽어야 하는 숫자**뿐이다.
  //
  // 예전 패널은 모듈 여섯 개에 각각 머리표(20px)를 달고, 목표 규칙·시계 설명·
  // 태그 해설·조작 힌트·시스템 덤프를 전부 문단으로 깔았다. 세로 화면에서
  // 내용이 1270px — 패널 높이의 2.9배였다. 발사 버튼을 누르려면 스크롤을
  // 내려야 하는 조준 UI는 조준 UI가 아니다.
  //
  // 그래서 규칙을 하나 세웠다: **설명은 패널에 살지 않는다.**
  //   · 목표 규칙 → 판이 열릴 때 메시지 한 줄로(그 자리에서 읽고 지나간다)
  //   · 태그 해설 → 공을 짚으면 뜨는 정보창(Inspector)에 이미 다 있다
  //   · 천체 제원 → 같은 정보창
  //   · 키보드 힌트 → 데스크톱에서만, 한 줄
  // 남은 숫자는 전부 **칩**이다. 한 줄에 여러 개가 들어가고, 읽는 데 걸리는
  // 시간이 짧고, 무엇보다 세로로 안 자란다.
  el.innerHTML = `<div class="hudtop"><h1>${t('ui.title')}</h1>
  <span class="ante" id="anteChip">A1</span>
  <button id="fold" class="ghost" title="${t('ui.fold')}">▾</button></div>
<div class="body">

<section class="mod op" id="opMod">
  <div class="oprow"><span class="oplabel" id="goalHead">OPERATION</span>
    <span class="opcount" id="goalCount">—</span><span class="clockv" id="clockV">—</span></div>
  <div class="bars"><i class="objprog"><i id="goalFill"></i></i><i class="clockbar"><i id="clockFill"></i></i></div>
  <div class="objname" id="objName">—</div>
</section>

<section class="mod alarm" id="laserMod" hidden>
  <div class="modhead"><span class="tick"></span><span id="laserTitle">${t('alarm.title')}</span><span class="clockv" id="laserT">—</span></div>
  <div class="alarmtext" id="laserWhy"></div>
</section>

<section class="mod firectl">
  ${stepper('angle', 'ui.angle', 'ui.unit.deg', [0.1, 1, 10])}
  ${stepper('power', 'ui.power', 'ui.unit.speed', [1, 5, 10])}
  ${stepper('yield', 'ui.yield', 'ui.unit.mt', [1, 3, 6])}
  <div class="assist">
    <button id="findPrev" class="ghost" title="${t('ui.findPrev.tip')}">${t('ui.findPrev')}</button>
    <button id="findNext" class="ghost" title="${t('ui.findNext.tip')}">${t('ui.findNext')}</button>
  </div>
  <div class="lcd" id="lcd">
    <div class="lcdscan"></div>
    <div class="lcdline"><b id="lcdTag">${t('lcd.ready')}</b><span id="lcdText">${t('lcd.ready.sub')}</span></div>
    <div class="lcdsub" id="lcdSub"></div>
  </div>
  <button id="fire" class="firebtn"><span class="fkey">${t('ui.fire.key')}</span><span class="ftext">${t('ui.fire')}</span><i class="fglow"></i></button>
  <div class="btnrow">
    <button id="wait" class="ghost wide" title="${t('ui.wait.tip')}">${t('ui.wait')}</button>
    <button id="toObs" class="ghost wide obs" title="${t('ui.toObs.tip')}">${t('ui.toObs')}</button>
  </div>
</section>

<section class="mod">
  <div class="chips" id="chips"></div>
  <div class="roles" id="roles" hidden></div>
  <div class="btnrow tools">
    <button id="zout" class="ghost" title="${t('ui.zout.tip')}">${t('ui.zout')}</button>
    <button id="zin" class="ghost" title="${t('ui.zin.tip')}">${t('ui.zin')}</button>
    <button id="zauto" class="ghost" title="${t('ui.zauto.tip')}">${t('ui.zauto')}</button>
    <button id="zfull" class="ghost" title="${t('ui.zfull.tip')}">${t('ui.zfull')}</button>
    <button id="new" class="ghost" title="${t('ui.new.tip')}">${t('ui.new')}</button>
    <button id="lang" class="ghost" title="${t('ui.lang.tip')}">🌐 ${langLabel()}</button>
  </div>
  <div class="msg" id="msg"></div>
  <div class="hint">${t('ui.hint')}</div>
</section>
</div>`
  document.body.appendChild(el)

  const over = document.createElement('div')
  over.className = 'gameover'; over.hidden = true
  over.innerHTML = `<div class="goart" id="overArt"></div>
<div class="gotext"><div class="gotag" id="overTag"></div><h2></h2><p id="overWhy"></p></div>
<button id="overNew" class="firebtn"><span class="ftext">${t('over.new')}</span><i class="fglow"></i></button>`
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
<button class="aimbtn" id="toAim"><span class="aimtitle">${t('ui.aim')}</span>
<span class="aimsub" id="obsSub">${t('ui.aim.sub')}</span></button>
<button class="spdbtn" id="obsSpd" title="${t('ui.speed.tip')}"><span class="spdv" id="obsSpdV">2×</span>
<span class="spdlbl">${t('ui.speed')}</span></button>`
  document.body.appendChild(obsBar)
  obsBar.querySelector('#toAim').onclick = () => game.setMode('aim')
  obsBar.querySelector('#obsSpd').onclick = (e) => {
    e.stopPropagation()
    game.setToast(msg('toast.obsSpeed', { n: game.cycleObsSpeed() }))
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
  // ── 언어 ──────────────────────────────────────────────────
  // 버튼 하나로 돌린다. 다섯 개짜리 목록에 셀렉트를 쓰면 모바일에서 시스템
  // 피커가 화면을 덮는데, 이 패널은 판 위에 떠 있는 물건이라 그게 방해가 된다.
  // **판을 리로드하지 않는다** — 진행 중인 런이 그대로 살아 있어야 한다.
  qs('#lang').onclick = () => {
    const i = LANGS.findIndex(l => l.code === getLang())
    setLang(LANGS[(i + 1) % LANGS.length].code)
  }
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
    if (e.key === 's' || e.key === 'S') { game.setToast(msg('toast.obsSpeed', { n: game.cycleObsSpeed() })); return }
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

  // ── 언어가 바뀌면 ────────────────────────────────────────────
  // 매 프레임 다시 쓰는 것(숫자·예측·칩)은 저절로 따라온다. 문제는 **한 번
  // 만들고 마는 것**이다: 버튼 라벨, 툴팁, 스테퍼 이름표, 관측 바. 그것만
  // 여기서 다시 붙인다 — 패널을 통째로 다시 지으면 배선과 스크롤 위치가
  // 날아가고, 무엇보다 누르고 있던 버튼이 손 밑에서 사라진다.
  const label = (sel, key, tip) => {
    const b = el.querySelector(sel) ?? obsBar.querySelector(sel)
    if (!b) return
    b.textContent = t(key)
    if (tip) b.title = t(tip)
  }
  onLangChange(() => {
    label('#findPrev', 'ui.findPrev', 'ui.findPrev.tip')
    label('#findNext', 'ui.findNext', 'ui.findNext.tip')
    label('#zauto', 'ui.zauto', 'ui.zauto.tip')
    label('#zfull', 'ui.zfull', 'ui.zfull.tip')
    label('#new', 'ui.new', 'ui.new.tip')
    qs('#wait').textContent = t('ui.wait'); qs('#wait').title = t('ui.wait.tip')
    qs('#toObs').textContent = t('ui.toObs'); qs('#toObs').title = t('ui.toObs.tip')
    qs('#fold').title = t('ui.fold')
    qs('#lang').textContent = `🌐 ${langLabel()}`
    qs('#lang').title = t('ui.lang.tip')
    qs('.hint').textContent = t('ui.hint')
    qs('h1').textContent = t('ui.title')
    qs('#laserTitle').textContent = t('alarm.title')
    for (const [id, key, unit] of [['angle', 'ui.angle', 'ui.unit.deg'],
      ['power', 'ui.power', 'ui.unit.speed'], ['yield', 'ui.yield', 'ui.unit.mt']]) {
      qs(`#${id} .steplabel`).textContent = t(key)
      qs(`#${id} .stepunit`).textContent = t(unit)
    }
    obsBar.querySelector('.aimtitle').textContent = t('ui.aim')
    obsBar.querySelector('.spdlbl').textContent = t('ui.speed')
    obsBar.querySelector('#obsSpd').title = t('ui.speed.tip')
    over.querySelector('#overNew .ftext').textContent = t('over.new')
    el._roleKey = null   // 태그 칩을 다시 그리게 한다
    el._chips = null; el._msg = null
  })
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
  const badge = role ? ` [${role.icon}${roleLabel(h.role)}]` : ''
  const name = h ? nameOf(h) : ''
  switch (p.outcome) {
    case 'earth': return ['bad', t('lcd.tag.abort'), t('lcd.abort'), t('lcd.abort.sub')]
    case 'void': return ['warn', t('lcd.tag.void'), `${name}${badge}`, roleAim(h.role)]
    case 'volatile': return ['hit', t('lcd.tag.chain'), `${name}${badge}`,
      t('lcd.chain.sub', { aim: roleAim(h.role), r: h.volatileR.toFixed(0) })]
    case 'debris': return ['warn', t('lcd.tag.debris'), t('lcd.debris'), '']
    case 'sun': return ['warn', t('lcd.tag.solar'), t('lcd.solar'), t('lcd.solar.sub')]
    // '성계 이탈(유실)'은 없다 — 카이퍼 벨트가 튕겨 되돌려 보낸다.
    case 'timeout': return ['warn', t('lcd.tag.noctc'), t('lcd.noctc', { ttl: CFG.MISSILE_TTL }), t('lcd.noctc.sub')]
    case 'target':
    case 'neutral': {
      const tag = t(p.outcome === 'target' ? 'lcd.tag.target' : 'lcd.tag.cue')
      // [2층] 이 접촉이 그 공에 즉시 일으키는 것 — 충격 방향/세기, 진로, 체력.
      // 화면 위 화살표와 같은 이름을 쓴다 — 노란 화살표 = 충격 방향,
      // 흰 화살표 = 바뀐 진로. 숫자는 여기(LCD)에만 둔다.
      //
      // 이름표를 뗐다("충격 방향"·"바뀐 진로"·"체력"). 세로 화면에서 두 줄을
      // 넘겨 뒷부분이 잘렸는데, 잘리는 게 하필 체력이었다. 기호가 이름표를
      // 대신한다: ↗ 임펄스 · → 진로 · ◆ 체력. 화살표 색과 같은 순서다.
      const direct = t('lcd.direct', {
        push: dirOf(h.dx, h.dy), dv: h.dv.toFixed(1),
        course: dirOf(h.vx, h.vy), speed: Math.hypot(h.vx, h.vy).toFixed(0),
        hp: h.hp, hpMax: h.hpMax,
      })
      // [3층] 의도하지 않았을 부작용만. 전부 이 한 발에서 확정적으로 참인 것.
      const warn = [
        h.earthInBlast ? t('lcd.warn.blast') : '',
        h.role === 'armor' ? t('lcd.warn.armor', { pct: (CFG.ARMOR_DV * 100).toFixed(0) }) : '',
        // 저쪽에 아직 카드가 한 장 남았다. 결과를 대신 읽어 주지는 않는다 —
        // "피할 수 있다"까지만 말하고, 정말 피하는지는 쏴 봐야 안다.
        h.boost ? t('lcd.warn.boost') : '',
        h.willEject ? t('lcd.warn.eject', { v: h.vAfter.toFixed(0), esc: h.vEsc.toFixed(0) }) : '',
      ].filter(Boolean).join(' · ')
      return [h.earthInBlast ? 'warn' : 'hit', tag, `${name}${badge} — ${direct}`, warn]
    }
    default: return ['warn', '—', '—', '']
  }
}

// 시한 종료(TIME_UP)는 '그들이 왔다…' 한 줄로만 — 설명하지 않는다.
const failWhy = (reason, game) => reason === 'TIME_UP' ? ''
  : reason === 'EARTH_LASER' ? t('over.why.EARTH_LASER', { sec: CFG.LASER_CHARGE })
  : reason === 'EARTH_LOST' ? t('over.why.EARTH_LOST')
  : tx(game.message)

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
  // 관측 바(조준 모드 · 배속)는 **플레이어의 것**이다. 그래서 예고편이 도는
  // 동안에는 안 띄운다 — 누를 수 없는 버튼이 화면 아래에 앉아 있으면 지금
  // 조작할 수 있다는 거짓말이 되고, 무엇보다 그 화면은 전부 저쪽 몫이다.
  // (예고편의 탄두가 나는 구간은 cinematic이 꺼져 있다. 지상 관제가 그때부터
  //  입을 열어야 하기 때문인데, 그 신호를 바 표시에까지 쓰면 둘이 엉킨다.)
  const showBar = observing && !cine && !game.trailer
  if (el._observing !== observing || el._showBar !== showBar) {
    el._observing = observing
    el._showBar = showBar
    el.hidden = observing
    el._obsBar.hidden = !showBar
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
    // 버튼은 시각적으로만 지우는 게 아니라 실제로 잠근다.
    // **언어 버튼만 예외다** — 판을 잠그는 것과 "무슨 말로 보여 줄까"는 상관이
    // 없고, 하필 판이 잠기는 순간(개막·게임 오버)이 문구를 제일 오래 들여다보는
    // 때다. 그때 언어를 못 바꾸면 그게 제일 답답하다.
    for (const btn of el.querySelectorAll('button')) btn.disabled = veil && btn.id !== 'lang'
    // 막이 걷힐 때 전부 다시 열어 버렸으므로, 조준 가능 여부에 따른 잠금은
    // 아래에서 다시 계산하게 한다(안 그러면 발사 불가 상태에서도 버튼이 산다).
    el._aimable = undefined
  }
  if (observing) {
    // 버튼 하나에 접어 넣는 최소 정보: 배속 · 남은 시한 · 레이저 경보
    const left = game.timeLeft
    const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`
    const sub = game.doom
      ? t('ui.obs.doom')
      : game.laserCharging
        ? t('ui.obs.charge', {
          left: game.laserLeft.toFixed(0), miss: game.laserMiss.toFixed(0),
          verdict: t(game.laserSafe ? 'ui.obs.charge.safe' : 'ui.obs.charge.hit'),
        })
      : game.laserFlying
        ? t('ui.obs.fly', { left: game.laserImpactLeft.toFixed(1) })
        : t('ui.obs.run', { scale: game.effTimeScale(), clock })
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
    over.querySelector('h2').textContent = t(doom ? 'over.doom' : 'over.title')
    over.classList.toggle('doom', doom)
    over.querySelector('#overArt').innerHTML = defeatArt(game.failReason)
    over.querySelector('#overTag').textContent = defeatTag(game.failReason)
    const why = failWhy(game.failReason, game), score = game.runScore + game.score
    over.querySelector('#overWhy').textContent =
      why ? t('over.why', { why, score }) : t('over.score', { score })
    el.querySelector('#wait').disabled = true
  }

  const tgt = game.target, e = game.earth, g = game.goal
  const dx = tgt.pos.x - e.pos.x, dy = tgt.pos.y - e.pos.y
  el.querySelector('#anteChip').textContent = t('ui.stage', { ante: game.ante, stage: game.stageIdx + 1 })
  el.querySelector('#goalHead').textContent = g.title
  el.querySelector('#goalCount').textContent = g.label()
  el.querySelector('#objName').textContent =
    t('op.target', { name: nameOf(tgt), dist: Math.hypot(dx, dy).toFixed(0), dir: dirOf(dx, dy) })
  el.querySelector('#goalFill').style.width = `${Math.min(100, g.done / g.need * 100).toFixed(0)}%`

  // 특수 천체 범례 — **아이콘 칩만.** 각 태그가 무슨 짓을 하는지는 공을 짚으면
  // 뜨는 정보창(Inspector)이 이미 한 줄씩 말해 준다. 같은 문장을 패널에도
  // 깔면 세로로 137px을 먹는데, 그 값어치를 하는 건 처음 한 판뿐이다.
  if (el._roleKey !== game.stageIdx) {
    el._roleKey = game.stageIdx
    const list = game.stage.roles ?? []
    const roles = el.querySelector('#roles')
    roles.hidden = !list.length
    roles.innerHTML = list.map(k => {
      const d = ROLES[k]
      return `<span class="rolechip" style="color:${hex(d.color)}" title="${roleBrief(k)}">${d.icon} ${roleLabel(k)}</span>`
    }).join('')
  }

  // ── 조르그 레이저 경보 ──
  // 문구는 상태마다 딱 한 줄씩. 충전 중에는 "무엇을 하면 되는가"만,
  // 비행 중에는 "언제 닿는가"만 말한다 — 읽을 게 많으면 아무것도 안 읽힌다.
  const lm = el.querySelector('#laserMod')
  if (game.laserCharging) {
    lm.hidden = false
    lm.classList.toggle('ok', game.laserSafe)
    // 포대가 여럿이면 동시에 물 수 있다. 카운트다운은 제일 급한 하나만 띄우되,
    // **몇 기가 겨누고 있는지**는 붙여 준다 — 하나를 피해도 끝이 아니다.
    const nCharge = game.laserChargingCount
    el.querySelector('#laserT').textContent = t('alarm.charge.t', { left: game.laserLeft.toFixed(1) })
      + (nCharge > 1 ? t('alarm.multi', { n: nCharge }) : '')
    el.querySelector('#laserWhy').textContent = t(game.laserSafe ? 'alarm.safe' : 'alarm.hit',
      { miss: game.laserMiss.toFixed(0), need: hitRadiusOf(game.earth).toFixed(0) })
  } else if (game.laserFlying) {
    lm.hidden = false
    lm.classList.remove('ok')
    el.querySelector('#laserT').textContent = t('alarm.fly.t', { left: game.laserImpactLeft.toFixed(1) })
    el.querySelector('#laserWhy').textContent = t('alarm.fly', { r: CFG.LASER_INTERCEPT_R })
  } else lm.hidden = true

  const left = game.timeLeft, frac = left / game.stageTime
  const opMod = el.querySelector('#opMod')
  el.querySelector('#clockV').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`
  el.querySelector('#clockFill').style.width = `${Math.max(0, frac * 100).toFixed(1)}%`
  opMod.className = 'mod op' + (frac <= 0.15 ? ' crit' : frac <= 0.4 ? ' warn' : '')

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
      || t('lcd.default', { yield: game.yieldMt, impulse: CFG.NUKE_IMPULSE, blast: (CFG.BLAST_R * game.yieldMt).toFixed(0) })
    fireBtn.classList.toggle('danger', p.outcome === 'earth')
    fireBtn.disabled = game.inFlight || veil
    fireBtn.querySelector('.ftext').textContent = game.inFlight ? t('ui.fire.reload')
      : p.outcome === 'earth' ? t('ui.fire.abort') : t('ui.fire')
  } else {
    lcd.className = 'lcd off'
    el.querySelector('#lcdTag').textContent = t(game.runOver ? 'lcd.dead' : 'lcd.hold')
    el.querySelector('#lcdText').textContent = t(game.runOver ? 'lcd.dead.sub' : 'lcd.hold.sub')
    el.querySelector('#lcdSub').textContent = game.inFlight ? t('lcd.inflight') : ''
    fireBtn.classList.remove('danger')
    fireBtn.querySelector('.ftext').textContent = t('ui.fire')
  }

  // ── 칩 줄 ────────────────────────────────────────────────────
  // 예전 SYSTEM 덤프에서 살아남은 것만. 뺀 것들과 그 이유:
  //   ANTE·STAGE  → 패널 머리의 칩으로 옮겼다
  //   FORTRESS    → 목표 줄이 같은 숫자를 이미 크게 띄운다
  //   TARGET 체력 → 화면의 표적 이름표에 그대로 붙어 있다
  //   HOME        → 화면에서 ◈ 표식이 그 공에 달려 있다
  //   SYSTEM/BELT → 판을 보면 되는 것을 숫자로 다시 말하고 있었다
  const hpBar = (b) => bar(b.hp ?? 0, b.hpMax ?? CFG.PLANET_HP, '◆', '◇')
  const scale = game.effTimeScale()
  const rig = el._rig
  const chips = [
    [t('chip.score'), `${game.runScore + game.score}`, 'hi'],
    [t('chip.shots'), `${game.shots}`, ''],
    [t('chip.earth'), e.alive ? hpBar(e) : t('chip.lost'), e.alive && e.hp <= 1 ? 'crit' : ''],
    [t('chip.time'), scale === 0 ? t('chip.stopped') : t('chip.running', { scale }), scale === 0 ? '' : 'hi'],
    [t('chip.bonus'), `+${game.timeBonus}`, ''],
    [t('chip.zoom'), rig ? `${rig.zoom.toFixed(1)}×${rig.auto ? ' A' : ''}` : '—', ''],
  ].map(([k, v, c]) => `<span class="chip ${c}"><i>${k}</i>${v}</span>`).join('')
  if (el._chips !== chips) { el._chips = chips; el.querySelector('#chips').innerHTML = chips }
  // 시간 보너스는 클리어할 때 메시지 꼬리에 붙는다 — 문장을 게임에서 만들지
  // 않으므로(키만 남긴다) 그 꼬리도 여기서 잇는다.
  const line = tx(game.message) + (game.bonusNote ? t('msg.timeBonus', { n: game.bonusNote }) : '')
  if (el._msg !== line) { el._msg = line; el.querySelector('#msg').textContent = line }

  const toast = el._toast
  if (game.toastT > 0 && game.toast) { toast.hidden = false; toast.textContent = tx(game.toast) }
  else toast.hidden = true
}
