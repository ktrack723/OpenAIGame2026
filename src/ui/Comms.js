import { hitRadiusOf } from '../game/config.js'
import { t, tList, nameOf } from '../i18n/index.js'
import { AUDIO } from '../audio/index.js'

// ─── 조르그 교신 ────────────────────────────────────────────────
// 관측 모드에서 가끔, 살아 있는 조르그 요새 위에 저쪽 얼굴이 뜨고 한 마디
// 던지고 사라진다. 정보는 없다 — **저기 누가 있다**는 것만 알려 준다.
// 조준 모드에서는 안 뜬다: 그 화면은 숫자를 읽는 화면이라 방해가 된다.
//
// 얼굴 셋을 돌려 쓰고 대사 열 줄에서 뽑는다. 같은 얼굴·같은 대사가 연달아
// 나오지 않게만 막는다(연달아 나오면 "돌려 쓴다"가 그대로 들킨다).
//
// ── 단말마 ──
// 요새가 부서지는 순간에는 **따로 만든 창**이 뜬다. 화면이 치지직거리며
// 끊기고, 부서지고 나서도 몇 초 더 남는다 — 통신이 끊긴 뒤에도 마지막 신호가
// 남아 있는 것처럼. 이건 평소 잡담과 성격이 다르므로 대사도 따로 쓴다.
//
// ── 그리고 조르그가 아닌 목소리 ──
// 순회선(ufo.js)도 이 창을 쓴다. 같은 자리, 같은 박자, **다른 색과 다른 얼굴**.
// 저쪽은 성계 스물몇 개를 지나온 행상이라 판에 아무 규칙도 안 걸고, 그래서
// 이 창이 유일하게 "정보가 없는 창"이 된다 — 거기 누가 있다는 것만 말한다.
// 한 가지만 규칙에 닿는다: **한 대 치면 다른 말을 한다**(ufo.hit). 그 순간이
// 곧 저 배가 손님에서 큐볼로 바뀌는 순간이라(physics.nudge), 그 전환을
// 화면에서 말해 주는 자리가 하나는 있어야 한다.

const HOLD = 4.2          // 떠 있는 시간(초)
const DEATH_HOLD = 3.6    // 단말마 — 요새가 이미 없어진 뒤에도 이만큼 남는다
// 다음 교신까지 — **일정 주기 ± 알파**다. 완전 무작위(13~24초)로 뒀더니 언제
// 올지 짐작이 안 돼서 "가끔 뜨는 것" 이상으로 안 읽혔다. 주기를 정해 두고
// 그 언저리에서 흔들면, 자주 오면서도 기계적이지 않다.
const GAP = 7.5, GAP_JITTER = 2.5     // 5~10초
const FIRST = 3.5, FIRST_JITTER = 1.5 // 첫 교신 2~5초

// ── 얼굴 셋 ──
// 실루엣부터 다르게 잡았다: 넓은 머리(지휘관) / 바이저(포격수) / 겹눈(정찰).
const FACES = [
  // 지휘관 — 눈 셋, 이마 능선
  `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M32 6c14 0 21 10 21 21 0 13-9 25-21 31C20 52 11 40 11 27 11 16 18 6 32 6z" fill="#2a0d1c" stroke="#ff5c9e" stroke-width="2"/>
    <path d="M32 7v16" stroke="#ff5c9e" stroke-width="2" opacity=".55"/>
    <ellipse cx="21" cy="30" rx="6" ry="4.2" fill="#ff9ec4"/>
    <ellipse cx="43" cy="30" rx="6" ry="4.2" fill="#ff9ec4"/>
    <ellipse cx="32" cy="21" rx="3.6" ry="2.8" fill="#ffd9e6"/>
    <path d="M25 44h14" stroke="#ff5c9e" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`,
  // 포격수 — 더듬이 둘에 가로로 길게 트인 바이저 하나
  `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M18 4l5 11M46 4l-5 11" stroke="#ff5c9e" stroke-width="2" stroke-linecap="round"/>
    <circle cx="18" cy="4" r="2.6" fill="#ff9ec4"/><circle cx="46" cy="4" r="2.6" fill="#ff9ec4"/>
    <path d="M17 15h30l5 13-8 20-12 10-12-10-8-20z" fill="#2a0d1c" stroke="#ff5c9e" stroke-width="2"/>
    <path d="M19 29h26l-2 7H21z" fill="#ff9ec4"/>
    <rect x="28" y="30.5" width="9" height="3.4" rx="1.7" fill="#ffe6f0"/>
    <path d="M27 45h10" stroke="#ff5c9e" stroke-width="2.2" stroke-linecap="round" opacity=".85"/>
  </svg>`,
  // 정찰 — 겹눈 둘에 아래턱
  `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M32 8c13 0 20 8 20 18s-6 15-6 22-6 8-14 8-14-1-14-8-6-12-6-22S19 8 32 8z" fill="#2a0d1c" stroke="#ff5c9e" stroke-width="2"/>
    <path d="M13 24c4-6 10-8 14-6 3 2 3 8-1 11s-11 2-13-5z" fill="#ff9ec4"/>
    <path d="M51 24c-4-6-10-8-14-6-3 2-3 8 1 11s11 2 13-5z" fill="#ff9ec4"/>
    <path d="M26 46c2 4 10 4 12 0" stroke="#ff5c9e" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path d="M22 52l-4 6M42 52l4 6" stroke="#ff5c9e" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
]



// ── 순회선의 얼굴 셋 ──
// 조르그(모난 곤충)와 정반대로 잡았다: 둥근 두건, 가로로 긴 눈, 늘어진 천.
// 색도 갈린다 — 저쪽은 분홍, 이쪽은 비취색이다(style.css .comms.visitor).
// 셋은 선체 형태(config.UFO_KINDS)와 짝이 맞는다: 원반·방주·고리.
const UFO_FACES = [
  // 원반 — 두건을 쓴 얼굴 하나, 가로로 긴 눈
  `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M32 8c12 0 19 9 19 20 0 12-8 20-19 26-11-6-19-14-19-26 0-11 7-20 19-20z" fill="#062a20" stroke="#34d399" stroke-width="2"/>
    <path d="M14 26c6-7 30-7 36 0" stroke="#6ee7b7" stroke-width="2" fill="none" opacity=".7"/>
    <rect x="19" y="30" width="26" height="6" rx="3" fill="#a7f3d0"/>
    <path d="M27 45h10" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" opacity=".8"/>
  </svg>`,
  // 방주 — 넓은 어깨와 두 겹 두건, 눈이 셋
  `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M32 7c14 0 20 10 20 19 0 6-2 9-2 13 0 8-8 12-18 12s-18-4-18-12c0-4-2-7-2-13C12 17 18 7 32 7z" fill="#062a20" stroke="#34d399" stroke-width="2"/>
    <path d="M13 22c8-8 30-8 38 0" stroke="#6ee7b7" stroke-width="2" fill="none" opacity=".6"/>
    <ellipse cx="23" cy="33" rx="5" ry="3.4" fill="#a7f3d0"/>
    <ellipse cx="41" cy="33" rx="5" ry="3.4" fill="#a7f3d0"/>
    <circle cx="32" cy="25" r="2.4" fill="#ecfdf5"/>
    <path d="M24 46c4 3 12 3 16 0" stroke="#34d399" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`,
  // 고리 — 머리 위로 띠가 하나 떠 있다. 눈은 가늘고 하나뿐
  `<svg viewBox="0 0 64 64" aria-hidden="true">
    <ellipse cx="32" cy="14" rx="17" ry="5" fill="none" stroke="#6ee7b7" stroke-width="2" opacity=".85"/>
    <path d="M32 18c11 0 17 9 17 19s-7 19-17 19-17-9-17-19 6-19 17-19z" fill="#062a20" stroke="#34d399" stroke-width="2"/>
    <path d="M21 35h22" stroke="#a7f3d0" stroke-width="5" stroke-linecap="round"/>
    <path d="M26 47h12" stroke="#34d399" stroke-width="2" stroke-linecap="round" opacity=".75"/>
  </svg>`,
]

// 얼굴 ↔ 선체 형태. UFO_FACES의 순서가 곧 이 표다.
const UFO_KIND_FACE = ['disc', 'ark', 'ring']

const pick = (arr, not) => {
  let i = Math.floor(Math.random() * arr.length)
  if (arr.length > 1 && i === not) i = (i + 1 + Math.floor(Math.random() * (arr.length - 1))) % arr.length
  return i
}

export class Comms {
  constructor(game, view) {
    this.game = game
    this.view = view
    this.t = FIRST + (Math.random() * 2 - 1) * FIRST_JITTER
    this.left = 0            // 남은 체류 시간 (0이면 안 떠 있다)
    this.face = -1
    this.line = -1
    this.dline = -1
    this.uline = -1          // 순회선 잡담
    this.hline = -1          // 순회선이 얻어맞았을 때
    this.body = null
    this.dying = false
    this.visitor = false     // 지금 말하는 쪽이 조르그가 아닌가
    this.forts = new Set()   // 지난 프레임에 살아 있던 요새 — 사라지면 단말마다
    this.free = new Set()    // 아직 통행권을 들고 있던 순회선 — 잃으면 한 마디 한다

    const el = document.createElement('div')
    el.className = 'comms'
    el.hidden = true
    el.innerHTML = `
<div class="commsport"><i class="commsscan"></i><span id="commsFace"></span></div>
<div class="commsbody">
  <div class="commswho"><b id="commsTag">ZORG</b><span id="commsWho"></span></div>
  <div class="commsline" id="commsLine"></div>
</div>`
    document.body.appendChild(el)
    this.el = el
    this.faceEl = el.querySelector('#commsFace')
    this.tagEl = el.querySelector('#commsTag')
    this.whoEl = el.querySelector('#commsWho')
    this.lineEl = el.querySelector('#commsLine')
  }

  // 화면 안에 들어와 있는가. 창은 화자 위에 붙으므로 이 판정이 곧 "가리킬
  // 데가 있는가"다.
  onScreen(b) {
    const s = this.view.rig.worldToScreen(b.pos.x, b.pos.y)
    return s.x > 90 && s.x < innerWidth - 90 && s.y > 120 && s.y < innerHeight - 120
  }

  // 지금 말을 걸 수 있는 조르그 — 살아 있고 화면 안에 있는 것.
  // 요새든 모함이든 저쪽 목소리는 하나다(같은 대사표를 쓴다).
  // any=true면 화면 밖이라도 아무나 잡는다(예고편이 박자를 잡아 부를 때).
  // 창 자체는 place()가 화면 안으로 끌어다 놓으므로 가리키는 데가 없진 않다.
  speaker(any = false) {
    const g = this.game
    const forts = g.bodies.filter(b => b.alive && g.isTarget(b))
    if (!forts.length) return null
    const onScreen = forts.filter(b => this.onScreen(b))
    const pool = onScreen.length ? onScreen : (any ? forts : [])
    if (!pool.length) return null
    return pool[0]
  }

  // 지금 화면 안에 있는 순회선. 저쪽은 **지나가는 중일 때만** 말한다 —
  // 한 대 맞아 통행권을 잃은 배는 이미 판 위의 공이고, 그놈의 마지막 한 마디는
  // 맞는 순간에 이미 나갔다(ufo.hit).
  ufoSpeaker() {
    const live = this.game.bodies.filter(b => b.alive && b.ufo && b.pass)
    if (!live.length) return null
    return live.find(b => this.onScreen(b)) ?? null
  }

  open(line = null, any = false) {
    // 순회선이 화면에 있으면 절반은 저쪽 차례다. 저 손님은 드물게 지나가므로
    // (판당 한두 무리) 이 정도로 몰아 줘야 지나가는 동안 한 마디는 듣는다.
    const u = line ? null : this.ufoSpeaker()
    if (u && Math.random() < 0.5) {
      const lines = tList('ufo.taunt')
      this.show(u, lines[this.uline = pick(lines, this.uline)], false, HOLD, true)
      return
    }
    const b = this.speaker(any)
    if (!b) {
      // 조르그가 화면 밖이어도 순회선이 있으면 그쪽이 말한다.
      if (u) {
        const lines = tList('ufo.taunt')
        this.show(u, lines[this.uline = pick(lines, this.uline)], false, HOLD, true)
        return
      }
      this.t = 2; return      // 화면 밖이면 조금 뒤에 다시 본다
    }
    const lines = tList('zorg.taunt')
    this.show(b, line ?? lines[this.line = pick(lines, this.line)], false, HOLD)
  }

  // 얻어맞은 순회선. 단말마가 아니다 — 저 배는 안 죽었고, 다만 이 판의
  // 공이 됐을 뿐이다. 그래서 창도 평소와 같은 모양이다(끊기지 않는다).
  struck(b) {
    const lines = tList('ufo.hit')
    this.show(b, lines[this.hline = pick(lines, this.hline)], false, HOLD, true)
  }

  // 지금 당장 한 마디 — 예고편이 박자를 잡아 부른다.
  // 대사를 넘기면 그 줄을 그대로 말한다(예고편의 첫 대사처럼 정해진 것이 있다).
  say(line = null) { if (!this.dying) this.open(line, true) }

  // 단말마. 이미 부서진 요새를 화자로 쓰므로 alive 검사를 하지 않는다.
  die(b) {
    // 단말마 — 끊기는 통신이다. 문장이 끝까지 가지 않는다(zorg.death).
    const lines = tList('zorg.death')
    this.show(b, lines[this.dline = pick(lines, this.dline)], true, DEATH_HOLD)
  }

  show(b, line, dying, hold, visitor = false) {
    // ── 교신음 ──
    // 화면은 이미 "치지직"거리고 있다(.commsscan). 소리도 같은 말을 해야 한다:
    // 반송파가 잡히고(잡음), 저쪽 신호가 뚫고 들어온다(두 음).
    // 조르그의 두 음은 증4도다 — 사람이 쓰는 무전에는 없는 음정이라,
    // 얼굴을 보기 전에 소리만으로 어느 쪽인지 갈린다(관제는 완전4도).
    // 단말마는 그 반대다: 음정이 무너지고 잡음만 남는다.
    if (dying) {
      AUDIO.ui('commsDeath')
      AUDIO.sfx.noise({ dur: 0.9, gain: 0.16, band: 1100, q: 0.8, sweep: 0.35, pan: -0.15 })
    } else if (visitor) {
      // 순회선은 회선이 깨끗하다 — 잡음이 짧고 옅다. 조르그의 증4도도,
      // 관제의 완전4도도 아닌 **관제 쪽 음**을 낮게 쓴다: 적의 소리가 아니다.
      AUDIO.sfx.noise({ dur: 0.08, gain: 0.05, band: 2600, q: 1.6, pan: -0.1 })
      AUDIO.ui('commsOpenGnd', 0.7)
    } else {
      AUDIO.ui('commsStatic', 0.8)
      AUDIO.ui('commsOpenZorg')
    }
    this.body = b
    this.dying = dying
    this.visitor = visitor
    // 얼굴은 **말하는 쪽의 표**에서 뽑는다. 순회선은 선체 형태와 얼굴이 짝이
    // 맞으므로(원반·방주·고리) 무작위가 아니라 그 배의 형태로 고른다 —
    // 같은 배가 두 번 말하면 같은 얼굴이 나와야 "저 배에 저 사람이 탔다"가 된다.
    const faces = visitor ? UFO_FACES : FACES
    if (visitor) this.face = Math.max(0, UFO_KIND_FACE.indexOf(b.ufo))
    else this.face = pick(faces, this.face)
    this.faceEl.innerHTML = faces[this.face]
    this.tagEl.textContent = visitor ? t('ufo.who') : 'ZORG'
    this.whoEl.textContent = nameOf(b)
    this.lineEl.textContent = line
    this.el.hidden = false
    this.el.classList.remove('out')
    this.el.classList.toggle('dying', dying)
    this.el.classList.toggle('visitor', visitor)
    this.el.classList.add('in')
    this.left = hold
    this.place()
  }

  close() {
    // 스퀄치 — 회선이 끊기는 소리. 떠 있던 창을 닫을 때만 낸다
    // (close()는 아무것도 안 떠 있어도 불린다).
    if (this.left > 0) AUDIO.ui('commsClose', 0.7)
    this.left = 0
    this.body = null
    this.dying = false
    this.visitor = false
    this.el.classList.remove('in', 'dying', 'visitor')
    this.el.classList.add('out')
    this.t = GAP + (Math.random() * 2 - 1) * GAP_JITTER
    clearTimeout(this.hideT)
    this.hideT = setTimeout(() => { this.el.hidden = true }, 320)
  }

  // 요새 바로 위에 붙인다. 화면 밖으로 새면 가장자리에서 잡아 둔다.
  // 요새가 화면 아래쪽에 있으면 클램프가 하단 관측 바(.obsbar) 위에 얹혀
  // 겹칠 수 있으므로, 떠 있는 관측 바의 실제 위치를 읽어 그 위로는 못
  // 내려가게 막는다(Ground.place()와 같은 이유).
  place() {
    const b = this.body
    if (!b) return
    const s = this.view.rig.worldToScreen(b.pos.x, b.pos.y)
    // 요새 자신의 이름표(표적 · 체력 …)가 바로 위에 붙으므로 그것까지 넘겨 띄운다
    const lift = hitRadiusOf(b) / Math.max(1e-6, this.view.rig.worldPerPx) + 62
    const w = this.el.offsetWidth || 300, h = this.el.offsetHeight || 84
    const bar = document.querySelector('.obsbar')
    const barTop = (bar && !bar.hidden) ? bar.getBoundingClientRect().top : innerHeight
    const maxY = Math.min(innerHeight - h - 10, barTop - h - 10)
    const x = Math.max(10, Math.min(innerWidth - w - 10, s.x - w / 2))
    const y = Math.max(10, Math.min(maxY, s.y - lift - h))
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }

  // 매 프레임 main 루프가 불러 준다. dt는 실시간(초).
  // 이번 프레임에 부서진 요새 — 지난 프레임의 명단과 비교해 찾는다.
  // 게임 쪽에 손대지 않고도 "죽는 순간"을 잡을 수 있는 유일하게 깔끔한 자리다.
  reaped() {
    const g = this.game
    const alive = g.bodies.filter(b => b.alive && g.isTarget(b))
    const now = new Set(alive.map(b => b.id))
    let gone = null
    for (const b of g.bodies) {
      if (g.isTarget(b) && this.forts.has(b.id) && !now.has(b.id)) { gone = b; break }
    }
    this.forts = now
    return gone
  }

  // 이번 프레임에 **통행권을 잃은 순회선**. 요새의 격파를 명단 대조로 잡는 것과
  // 같은 자리다(reaped) — 게임 쪽에 손대지 않고 "그 순간"을 잡는 유일하게
  // 깔끔한 방법이고, 그 순간이 곧 손님이 큐볼로 바뀌는 순간이다.
  struckShip() {
    const g = this.game
    let hit = null
    const now = new Set()
    for (const b of g.bodies) {
      if (!b.ufo || !b.alive) continue
      if (b.pass) { now.add(b.id); continue }
      if (this.free.has(b.id) && !hit) hit = b
    }
    this.free = now
    return hit
  }

  update(dt) {
    const g = this.game
    const dead = this.reaped()
    // 조준 모드·게임 오버·모성 난사 중에는 안 뜬다.
    // 승리(won)는 막지 않는다 — 마지막 요새가 부서지는 그 순간이 곧 승리라,
    // 여기서 막으면 정작 제일 보여 주고 싶은 단말마가 통째로 사라진다.
    // 판이 열리는 순간과 예고편 도입부(bare)에는 화면에 아무 UI도 없어야 한다.
    const ok = g.mode === 'observe' && !g.bare && !g.doom && !g.runOver && !g.lost
    if (!ok) { if (this.left > 0) this.close(); return }

    // 단말마가 최우선 — 잡담 중이었어도 끊고 들어온다.
    if (dead) { this.die(dead); return }
    // 그다음이 얻어맞은 순회선이다. 저것도 지금 벌어진 일이라 잡담을 끊는다 —
    // 다만 단말마와 달리 저 배는 안 죽었다(창이 끊기지 않는다).
    const struck = this.struckShip()
    if (struck) { this.struck(struck); return }

    if (this.left > 0) {
      this.left -= dt
      // 잡담은 화자가 부서지면 끊긴다. 단말마는 그 부서진 화자가 하는 말이라
      // 살아 있는지 묻지 않는다 — 통신이 끊긴 뒤에도 신호는 몇 초 더 남는다.
      if (!this.dying && !this.body.alive) return this.close()
      this.place()
      if (this.left <= 0) this.close()
      return
    }
    if (g.won) return          // 이긴 뒤에는 새 잡담을 시작하지 않는다
    this.t -= dt
    if (this.t <= 0) this.open()
  }
}
