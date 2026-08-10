import { hitRadiusOf } from '../game/config.js'
import { t, tList } from '../i18n/index.js'

// ─── 지상 관제 ──────────────────────────────────────────────────
// 조르그가 요새 위에서 잡담을 던진다면(Comms), 이쪽은 **지구 아래에서 사건에
// 대고 말한다.** 저쪽 대사는 타이머로 오지만 이쪽 대사는 타이머가 없다 —
// 발사·스윙바이·명중·격파처럼 **화면에서 지금 벌어진 일**에만 반응한다.
// 그래야 두 목소리가 성격이 갈린다: 저쪽은 떠들고, 이쪽은 보고한다.
//
// 사건은 game.addFx가 흘려보내는 연출 이벤트를 그대로 주워 듣는다(onFx).
// 렌더러가 매 프레임 fx 큐를 비우므로 큐를 나중에 보는 걸로는 못 잡는다.
//
// 창은 **지구 아래**에 붙는다. 조르그 창은 요새 위에 붙으므로, 지구와 요새가
// 화면에서 가까워져도 둘이 겹치지 않는다.

const HOLD = 3.4          // 떠 있는 시간(초)
const FLOOR = 1.1         // 이 안에 새 사건이 와도 앞의 말을 자르지 않는다(더 센 것만 자른다)
// **어떤 사건이 와도** 한 줄은 이만큼은 떠 있는다. 이게 없으면 사건이 몰릴 때
// (빨리 감기·예고편) 대사가 0.6초 만에 다음 줄에 덮여 한 줄도 못 읽는다.
// 밀린 사건은 버리지 않고 큐에서 기다렸다가 이어서 나온다.
const MIN_SHOW = 1.5

// 얼굴 셋 — 관제 요원. 조르그와 실루엣부터 갈라 둔다: 저쪽은 곤충 머리,
// 이쪽은 헬멧·헤드셋·바이저라 한눈에 "사람 쪽"으로 읽힌다.
const FACES = [
  // 관제사 — 헤드셋에 마이크 붐
  `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M14 30a18 18 0 0 1 36 0v6a18 18 0 0 1-36 0z" fill="#0b1c2e" stroke="#4fd6f7" stroke-width="2"/>
    <path d="M14 32V28a18 18 0 0 1 36 0v4" fill="none" stroke="#4fd6f7" stroke-width="3" stroke-linecap="round"/>
    <rect x="8" y="28" width="8" height="14" rx="3" fill="#0b1c2e" stroke="#4fd6f7" stroke-width="2"/>
    <rect x="48" y="28" width="8" height="14" rx="3" fill="#0b1c2e" stroke="#4fd6f7" stroke-width="2"/>
    <path d="M16 40c2 7 5 10 9 12" fill="none" stroke="#4fd6f7" stroke-width="2" stroke-linecap="round"/>
    <circle cx="26" cy="53" r="2.6" fill="#9fe9ff"/>
    <ellipse cx="26" cy="34" rx="3.4" ry="3.8" fill="#9fe9ff"/>
    <ellipse cx="38" cy="34" rx="3.4" ry="3.8" fill="#9fe9ff"/>
    <path d="M28 43h8" stroke="#4fd6f7" stroke-width="2" stroke-linecap="round"/>
  </svg>`,
  // 사수 — 조준 바이저를 내린 얼굴
  `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M13 26a19 19 0 0 1 38 0v10c0 12-9 20-19 20s-19-8-19-20z" fill="#0b1c2e" stroke="#4fd6f7" stroke-width="2"/>
    <path d="M11 24h42l-2 8H13z" fill="#9fe9ff"/>
    <rect x="27" y="25.5" width="10" height="4" rx="2" fill="#e6fbff"/>
    <path d="M32 34v9" stroke="#4fd6f7" stroke-width="2" opacity=".7"/>
    <path d="M24 47c4 3 12 3 16 0" fill="none" stroke="#4fd6f7" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M32 8v8" stroke="#4fd6f7" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="32" cy="6" r="2.6" fill="#9fe9ff"/>
  </svg>`,
  // 항법사 — 각진 헬멧에 눈 하나가 계기판
  `<svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M32 7l19 9v18c0 13-9 22-19 24-10-2-19-11-19-24V16z" fill="#0b1c2e" stroke="#4fd6f7" stroke-width="2"/>
    <path d="M32 7v50" stroke="#4fd6f7" stroke-width="1.4" opacity=".35"/>
    <circle cx="23" cy="31" r="5.4" fill="none" stroke="#9fe9ff" stroke-width="2"/>
    <path d="M17.6 31h10.8M23 25.6v10.8" stroke="#9fe9ff" stroke-width="1.4"/>
    <ellipse cx="41" cy="31" rx="4.4" ry="4" fill="#9fe9ff"/>
    <path d="M25 44h14" stroke="#4fd6f7" stroke-width="2.2" stroke-linecap="round"/>
  </svg>`,
]

// ── 사건별 대사 ──
// 우선순위(prio)가 높은 사건은 낮은 사건을 끊고 들어온다. 같은 프레임에 둘이
// 겹치는 일이 흔하기 때문이다 — 핵 한 방이 요새를 부수면 nuke와 요새 격파가
// 같이 온다. 그럴 때 할 말은 하나뿐이다.
//
// 문장은 언어 표에 있다(gnd.*). 여기 남는 건 **어떤 사건에 입을 여는가**와
// 그 우선순위뿐이다.
//
// ※ 카이퍼 벨트 반사는 뺐다. 벨트는 판마다 수십 번 울리는 배경 규칙인데,
//   그때마다 관제가 "운동량은 그대로다"라고 설명하면 정작 격파·유폭 같은
//   사건에서 할 말이 그 잡음에 묻힌다. 벽에 튕기는 건 화면이 이미 말한다.
const SAY = {
  // 요새 격파는 fx가 아니라 **명단을 대조해** 잡는다. destroy 이벤트는 광선이
  // 우리 행성을 녹일 때도 똑같이 나가서, 그걸로는 승패를 구분할 수 없다.
  fortDown: 6,
  laserHit: 4, nuke: 4, volatile: 4,
  // 벨트 기폭은 명중이 아니다 — 판 밖으로 나간 발이라 할 말이 다르다.
  beltBlast: 3,
  boost: 5,
  swing: 3, laserCharge: 3, laserMiss: 3,
  launch: 2,
}

// 조르그 광선에 대한 반응 — 예고편에서는 이 셋만 입을 다문다.
const LASER_KINDS = new Set(['laserCharge', 'laserHit', 'laserMiss'])

const pick = (arr, not) => {
  let i = Math.floor(Math.random() * arr.length)
  if (arr.length > 1 && i === not) i = (i + 1 + Math.floor(Math.random() * (arr.length - 1))) % arr.length
  return i
}

export class Ground {
  constructor(game, view) {
    this.game = game
    this.view = view
    this.left = 0            // 남은 체류 시간 (0이면 안 떠 있다)
    this.prio = 0            // 지금 떠 있는 말의 우선순위
    this.face = -1
    this.last = {}           // 사건별 마지막 대사 인덱스 — 같은 줄이 연달아 나오지 않게
    this.queued = null
    this.forts = null        // 지난 프레임에 살아 있던 요새 — 사라지면 격파다

    const el = document.createElement('div')
    el.className = 'comms gnd'
    el.hidden = true
    el.innerHTML = `
<div class="commsport"><i class="commsscan"></i><span id="gndFace"></span></div>
<div class="commsbody">
  <div class="commswho"><b>MCC</b><span id="gndWho"></span></div>
  <div class="commsline" id="gndLine"></div>
</div>`
    document.body.appendChild(el)
    this.el = el
    this.faceEl = el.querySelector('#gndFace')
    this.whoEl = el.querySelector('#gndWho')
    this.lineEl = el.querySelector('#gndLine')

    game.onFx = (e) => this.feed(e)
  }

  // game.addFx가 흘려보내는 사건. 여기서는 **고르기만** 하고, 실제로 띄우는 건
  // update()다 — 한 프레임에 여러 사건이 몰리면 그중 제일 센 것만 말해야 한다.
  feed(e) {
    const prio = SAY[e.kind]
    if (!prio) return
    if (e.kind === 'laserHit' && e.sun) return    // 태양이 막은 건 아무것도 안 없앤다
    // 벨트에서 터진 탄두를 'nuke'로 흘리면 관제가 "유효타"라고 보고한다 —
    // 아무것도 안 맞은 발이다. 사건 이름을 갈라 준다.
    if (e.kind === 'nuke' && e.belt) return this.raise('beltBlast', SAY.beltBlast)
    // 예고편이 화면을 잡고 있는 동안(game.cinematic)은 **조르그 광선에 대해
    // 아무 말도 하지 않는다.** ③은 저쪽의 막이다 — 거기서 이쪽이 끼어들어
    // 위력에 감탄하면 정작 보여 주려던 한 방이 해설에 묻힌다.
    // 이쪽 목소리는 ⑤에서 탄두가 나갈 때 처음 들어온다(그때는 cinematic이 꺼진다).
    if (LASER_KINDS.has(e.kind) && this.game.cinematic) return
    // 예고편에서만은 **발사 보고를 안 한다.** ⑤의 발사는 ④ 마지막 대사
    // ("그럼 더 큰 걸 던지죠 — 행성을 박읍시다")가 끝나는 바로 그 순간이라,
    // 여기서 "탄두 이탈"이 들어오면 이 장면의 결론이 말하다 만 것처럼 끊긴다.
    // 발사는 화면이 이미 말하고 있다(발사 연출 · 카메라가 탄두를 문다).
    // 본편에서는 그대로 보고한다 — 거기서는 발사가 그 판의 첫 마디다.
    if (e.kind === 'launch' && this.game.trailer) return
    this.raise(e.kind, prio)
  }

  raise(kind, prio) { if (!this.queued || prio > this.queued.prio) this.queued = { kind, prio } }

  // 이번 프레임에 부서진 조르그 요새 — 지난 프레임의 명단과 대조해 찾는다.
  reaped() {
    const now = new Set(this.game.bodies.filter(b => b.alive && b.role === 'battery').map(b => b.id))
    let gone = false
    for (const id of this.forts ?? []) if (!now.has(id)) { gone = true; break }
    this.forts = now
    return gone
  }

  // ── 대본 한 줄 ──
  // 사건이 아니라 **정해진 대사**를 말한다. 오프닝 예고편이 쓴다: 광선이 행성
  // 하나를 지운 직후, 관제가 무슨 생각을 하다가 어떤 결론에 닿았는지가 이
  // 게임의 전제이므로 그 세 마디는 우연에 맡길 수 없다.
  // 평소 규칙(관측 모드에서만·우선순위)을 통째로 건너뛴다.
  say(line, hold = HOLD) {
    if (!line) return
    this.face = pick(FACES, this.face)
    this.faceEl.innerHTML = FACES[this.face]
    this.whoEl.textContent = t('gnd.who')
    this.lineEl.textContent = line
    this.el.hidden = false
    this.el.classList.remove('out')
    this.el.classList.add('in')
    this.left = hold
    this.prio = 99
    this.forced = true
    this.place()
  }

  show(kind, prio) {
    const lines = tList(`gnd.${kind}`)
    if (!lines.length) return
    const i = this.last[kind] = pick(lines, this.last[kind] ?? -1)
    this.face = pick(FACES, this.face)
    this.faceEl.innerHTML = FACES[this.face]
    this.whoEl.textContent = t('gnd.who')
    this.lineEl.textContent = lines[i]
    this.el.hidden = false
    this.el.classList.remove('out')
    this.el.classList.add('in')
    this.left = HOLD
    this.prio = prio
    this.place()
  }

  close() {
    this.left = 0
    this.prio = 0
    this.forced = false
    this.el.classList.remove('in')
    this.el.classList.add('out')
    clearTimeout(this.hideT)
    this.hideT = setTimeout(() => { this.el.hidden = true }, 320)
  }

  // 지구 **아래**에 붙인다. 조르그 창이 요새 위에 붙으므로 둘이 안 겹친다.
  place() {
    const g = this.game, rig = this.view.rig
    const s = rig.worldToScreen(g.earth.pos.x, g.earth.pos.y)
    const drop = hitRadiusOf(g.earth) / Math.max(1e-6, rig.worldPerPx) + 46
    const w = this.el.offsetWidth || 300, h = this.el.offsetHeight || 84
    const x = Math.max(10, Math.min(innerWidth - w - 10, s.x - w / 2))
    const y = Math.max(10, Math.min(innerHeight - h - 10, s.y + drop))
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }

  update(dt) {
    const g = this.game
    // 명단 대조는 **매 프레임** 한다. 조준 모드에서 부서진 요새를 안 세면,
    // 관측으로 돌아오는 순간 한참 지난 격파를 뒤늦게 보고하게 된다.
    const down = this.reaped()
    // 대본은 모드를 안 본다 — 예고편의 ④는 조준 모드인데, 그 화면에서 하는
    // 말이 곧 이 게임이 시작된 이유다.
    if (this.forced) {
      // 대본이 말하는 동안 들어온 사건은 **버리지 않는다**. 여기서 지워 버리면
      // 대본이 끝난 뒤 한참을 입 닫고 있게 된다 — 사건은 이미 지나갔으므로
      // 다시 오지 않는다. 대본이 끝나면 큐에 남은 그 한마디부터 이어서 말한다.
      // (예고편의 발사만은 애초에 큐에 안 들어온다 — feed 참고.)
      this.left -= dt
      this.place()
      if (this.left <= 0) this.close()
      return
    }
    // 조준 모드에서는 안 뜬다(그 화면은 숫자를 읽는 화면이다). 판이 열리는
    // 순간과 예고편 도입부도 마찬가지 — 그때는 화면에 아무 UI도 없어야 한다.
    const ok = g.mode === 'observe' && !g.bare && !g.doom && !g.runOver && !g.lost
    if (!ok) { this.queued = null; if (this.left > 0) this.close(); return }

    if (down) this.raise('fortDown', SAY.fortDown)
    const q = this.queued
    // ── 한 줄은 최소한 읽을 수 있어야 한다 ──
    // 예전에는 더 센 사건이 오면 **즉시** 앞의 말을 지웠다. 판이 빨리 감기고
    // 있을 때(관측 8×, 예고편) 그 규칙은 대사를 통째로 못 읽게 만든다:
    // 계측(예고편)에서 "탄두 기폭"이 0.6초 만에 "표적 하나 지웠다"에 덮였다.
    // 사건 자체는 버리지 않는다 — 큐에 둔 채 기다렸다가 이어서 말한다.
    const hold = q && this.left > 0 && HOLD - this.left < MIN_SHOW
    if (!hold) {
      this.queued = null
      // 앞의 말이 아직 새것이면(FLOOR 안) 더 센 사건만 끊고 들어온다.
      if (q && (this.left <= 0 || q.prio > this.prio || this.left < HOLD - FLOOR)) {
        this.show(q.kind, q.prio)
        return
      }
    }
    if (this.left <= 0) return
    this.left -= dt
    this.place()
    if (this.left <= 0) this.close()
  }
}
