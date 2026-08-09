import { hitRadiusOf } from '../game/config.js'

// ─── 조르그 교신 ────────────────────────────────────────────────
// 관측 모드에서 가끔, 살아 있는 조르그 요새 위에 저쪽 얼굴이 뜨고 한 마디
// 던지고 사라진다. 정보는 없다 — **저기 누가 있다**는 것만 알려 준다.
// 조준 모드에서는 안 뜬다: 그 화면은 숫자를 읽는 화면이라 방해가 된다.
//
// 얼굴 셋을 돌려 쓰고 대사 아홉 줄에서 뽑는다. 같은 얼굴·같은 대사가 연달아
// 나오지 않게만 막는다(연달아 나오면 "돌려 쓴다"가 그대로 들킨다).

const HOLD = 4.2          // 떠 있는 시간(초)
const GAP_MIN = 13, GAP_MAX = 24
const FIRST_MIN = 5, FIRST_MAX = 10

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

const LINES = [
  '그 궤도는 이미 계산이 끝났다.',
  '돌덩이로 요새를 친다고? 해 봐라.',
  '조준선은 지구를 놓지 않는다.',
  '네 태양은 우리 편이 아니다.',
  '요새 하나쯤은 내줄 수 있다.',
  '밀어 봐야 소용없다 — 우리는 원래 자리를 겨눈다.',
  '시간을 세고 있다. 우리도, 너도.',
  '본대가 오면 이 대화도 끝이다.',
  '지구인. 아직 살아 있나.',
]

const pick = (arr, not) => {
  let i = Math.floor(Math.random() * arr.length)
  if (arr.length > 1 && i === not) i = (i + 1 + Math.floor(Math.random() * (arr.length - 1))) % arr.length
  return i
}

export class Comms {
  constructor(game, view) {
    this.game = game
    this.view = view
    this.t = FIRST_MIN + Math.random() * (FIRST_MAX - FIRST_MIN)
    this.left = 0            // 남은 체류 시간 (0이면 안 떠 있다)
    this.face = -1
    this.line = -1
    this.body = null

    const el = document.createElement('div')
    el.className = 'comms'
    el.hidden = true
    el.innerHTML = `
<div class="commsport"><i class="commsscan"></i><span id="commsFace"></span></div>
<div class="commsbody">
  <div class="commswho"><b>ZORG</b><span id="commsWho"></span></div>
  <div class="commsline" id="commsLine"></div>
</div>`
    document.body.appendChild(el)
    this.el = el
    this.faceEl = el.querySelector('#commsFace')
    this.whoEl = el.querySelector('#commsWho')
    this.lineEl = el.querySelector('#commsLine')
  }

  // 지금 말을 걸 수 있는 요새 — 살아 있고 화면 안에 있는 것. 본성 우선.
  speaker() {
    const g = this.game
    const forts = g.bodies.filter(b => b.alive && b.role === 'battery')
    if (!forts.length) return null
    const rig = this.view.rig
    const onScreen = forts.filter(b => {
      const s = rig.worldToScreen(b.pos.x, b.pos.y)
      return s.x > 90 && s.x < innerWidth - 90 && s.y > 120 && s.y < innerHeight - 120
    })
    const pool = onScreen.length ? onScreen : []
    if (!pool.length) return null
    return pool.find(b => b === g.homeworld) ?? pool[0]
  }

  open() {
    const b = this.speaker()
    if (!b) { this.t = 2; return }      // 화면 밖이면 조금 뒤에 다시 본다
    this.body = b
    this.face = pick(FACES, this.face)
    this.line = pick(LINES, this.line)
    this.faceEl.innerHTML = FACES[this.face]
    this.whoEl.textContent = b.name
    this.lineEl.textContent = LINES[this.line]
    this.el.hidden = false
    this.el.classList.remove('out')
    this.el.classList.add('in')
    this.left = HOLD
    this.place()
  }

  close() {
    this.left = 0
    this.body = null
    this.el.classList.remove('in')
    this.el.classList.add('out')
    this.t = GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)
    clearTimeout(this.hideT)
    this.hideT = setTimeout(() => { this.el.hidden = true }, 320)
  }

  // 요새 바로 위에 붙인다. 화면 밖으로 새면 가장자리에서 잡아 둔다.
  place() {
    const b = this.body
    if (!b) return
    const s = this.view.rig.worldToScreen(b.pos.x, b.pos.y)
    // 요새 자신의 이름표(표적 · 체력 …)가 바로 위에 붙으므로 그것까지 넘겨 띄운다
    const lift = hitRadiusOf(b) / Math.max(1e-6, this.view.rig.worldPerPx) + 62
    const w = this.el.offsetWidth || 300, h = this.el.offsetHeight || 84
    const x = Math.max(10, Math.min(innerWidth - w - 10, s.x - w / 2))
    const y = Math.max(10, Math.min(innerHeight - h - 10, s.y - lift - h))
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }

  // 매 프레임 main 루프가 불러 준다. dt는 실시간(초).
  update(dt) {
    const g = this.game
    // 조준 모드·게임 오버·모성 난사 중에는 안 뜬다.
    const ok = g.mode === 'observe' && !g.doom && !g.runOver && !g.won && !g.lost
    if (!ok) { if (this.left > 0) this.close(); return }

    if (this.left > 0) {
      this.left -= dt
      if (!this.body.alive) return this.close()   // 말하던 요새가 부서지면 끊긴다
      this.place()
      if (this.left <= 0) this.close()
      return
    }
    this.t -= dt
    if (this.t <= 0) this.open()
  }
}
