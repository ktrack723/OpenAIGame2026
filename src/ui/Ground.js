import { hitRadiusOf } from '../game/config.js'

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
const SAY = {
  // 요새 격파는 fx가 아니라 **명단을 대조해** 잡는다. destroy 이벤트는 광선이
  // 우리 행성을 녹일 때도 똑같이 나가서, 그걸로는 승패를 구분할 수 없다.
  fortDown: { prio: 6, lines: [
    '요새 소멸 확인. 저 궤도는 이제 비었다.',
    '표적 하나 지웠다. 다음 좌표 넘긴다.',
    '명중 판정 — 조르그 요새, 신호 끊김.',
  ] },
  laserHit: { prio: 4, lines: [
    '행성 하나가 통째로 녹았다. 체력 같은 건 소용없다.',
    '광선이 지나간 자리에 아무것도 안 남았다.',
  ] },
  nuke: { prio: 4, lines: [
    '탄두 기폭. 이제 저 공이 어디로 가는지가 전부다.',
    '쳤다. 밀린 각도 계산 들어간다.',
    '유효타 — 궤도가 바뀌는 게 보인다.',
  ] },
  volatile: { prio: 4, lines: [
    '휘발성 유폭! 반경 안이 통째로 밀렸다.',
    '연쇄 폭발 — 저 근처 궤도는 전부 다시 계산해야 한다.',
  ] },
  swing: { prio: 3, lines: [
    '스윙바이 성사. 중력이 대신 쳐 줬다.',
    '궤도가 꺾인다 — 계산대로다.',
    '가속 확인. 공짜로 얻은 속도다.',
  ] },
  launch: { prio: 2, lines: [
    '탄두 이탈. 여기서부터는 궤도가 알아서 한다.',
    '큐를 놓았다. 남은 건 보는 일뿐이다.',
    '발사 확인 — 손을 떠났다.',
  ] },
  laserCharge: { prio: 3, lines: [
    '조르그 조준선 포착. 대응 시간 시작한다.',
    '충전 신호 잡혔다 — 저쪽이 지구를 겨눈다.',
    '경보. 본성이 광선을 물었다.',
  ] },
  laserMiss: { prio: 3, lines: [
    '광선 소진 — 빗나갔다. 아직 살아 있다.',
    '회피 성공. 지구는 원래 자리에 없었다.',
  ] },
  belt: { prio: 1, lines: [
    '카이퍼 벨트 반사 — 운동량은 그대로 돌아온다.',
    '벨트에 튕겼다. 성계 밖으로는 아무것도 못 나간다.',
  ] },
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
    const s = SAY[e.kind]
    if (!s) return
    if (e.kind === 'laserHit' && e.sun) return    // 태양이 막은 건 아무것도 안 없앤다
    // 예고편이 화면을 잡고 있는 동안(game.cinematic)은 **조르그 광선에 대해
    // 아무 말도 하지 않는다.** ③은 저쪽의 막이다 — 거기서 이쪽이 끼어들어
    // 위력에 감탄하면 정작 보여 주려던 한 방이 해설에 묻힌다.
    // 이쪽 목소리는 ⑤에서 탄두가 나갈 때 처음 들어온다(그때는 cinematic이 꺼진다).
    if (LASER_KINDS.has(e.kind) && this.game.cinematic) return
    this.raise(e.kind, s.prio)
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

  show(kind, prio) {
    const s = SAY[kind]
    const i = this.last[kind] = pick(s.lines, this.last[kind] ?? -1)
    this.face = pick(FACES, this.face)
    this.faceEl.innerHTML = FACES[this.face]
    this.whoEl.textContent = '지구 관제'
    this.lineEl.textContent = s.lines[i]
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
    // 조준 모드에서는 안 뜬다(그 화면은 숫자를 읽는 화면이다). 판이 열리는
    // 순간과 예고편 도입부도 마찬가지 — 그때는 화면에 아무 UI도 없어야 한다.
    const ok = g.mode === 'observe' && !g.bare && !g.doom && !g.runOver && !g.lost
    if (!ok) { this.queued = null; if (this.left > 0) this.close(); return }

    if (down) this.raise('fortDown', SAY.fortDown.prio)
    const q = this.queued
    this.queued = null
    // 앞의 말이 아직 새것이면(FLOOR 안) 더 센 사건만 끊고 들어온다.
    if (q && (this.left <= 0 || q.prio > this.prio || this.left < HOLD - FLOOR)) {
      this.show(q.kind, q.prio)
      return
    }
    if (this.left <= 0) return
    this.left -= dt
    this.place()
    if (this.left <= 0) this.close()
  }
}
