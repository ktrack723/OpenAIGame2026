import { CFG, hitRadiusOf } from '../game/config.js'
import { LASER_CHARGE, LASER_IDLE, LASER_TRAVEL } from '../game/laser.js'

// ─── 오프닝 예고편 — 진짜 인게임 푸티지 ─────────────────────────
// 그려 놓은 일러스트가 아니다. **실제 게임을 굴린다.** 같은 렌더러, 같은 HUD,
// 같은 폭발·트레일·충격파, 같은 물리. 이 파일이 하는 일은 연출이 아니라
// **연출가**다: 판을 한 컷씩 세팅하고 카메라를 그 자리에 붙인 뒤, 게임이
// 스스로 돌아가는 걸 보여 준다. 인게임 푸티지를 짜깁기한 예고편과 같은 방식이다.
//
// 글자는 없다. 컷마다 "무슨 일이 벌어지는지"만 보이고, 마지막에 로고가 박힌다.
// (HUD에 뜨는 문구는 게임이 스스로 띄우는 것이다 — 예고편 자막이 아니다.)
//
// 끝나면 game.resetRun()으로 판을 처음부터 다시 세운다 — Game은 객체 정체성을
// 유지하며 리셋되므로 렌더러·HUD·카메라를 다시 이을 필요가 없다.

const LOGO_MS = 1400    // 마지막 로고 체류

// 조준 모드에서 진행 중이면 판은 2×로 흐르고, 탄두가 날 때만 1×로 떨어진다
// (Game.effTimeScale). 아래 컷 길이는 그걸 감안한 **실시간** 밀리초다.
// 태양은 반경 150에 화면을 하얗게 태우므로 컷은 전부 원점에서 멀리 세운다.

// ── 화면 ────────────────────────────────────────────────────────

// HUD 패널은 넓은 화면에서 왼쪽에 붙지만, 좁은 화면(모바일)에서는 화면 아래위로
// **도킹해 절반을 먹는다.** 그러면 예고편이 남은 띠 안에서만 벌어져 아무것도 안
// 보인다. 그 레이아웃에서는 예고편을 **관측 모드**로 돌린다 — 조준 UI가 통째로
// 사라지고 화면 전체가 게임이 된다. 관측 모드도 실제 플레이 화면이다.
const hudDocked = () => {
  const r = document.querySelector('.hud')?.getBoundingClientRect()
  return !!r && r.width > 0 && r.width >= innerWidth * 0.7
}

// 컷을 세울 축 = **화면의 긴 쪽**. 세로 화면에서 공을 가로로 늘어놓으면 셋을 다
// 담느라 통째로 줌아웃되어 아무것도 안 보인다. 긴 축을 따라 세우면 같은 사건이
// 세로 화면에서도 같은 크기로 온다.
const longAxis = () => innerWidth >= innerHeight ? { x: 1, y: 0 } : { x: 0, y: 1 }
const perp = (u) => ({ x: -u.y, y: u.x })

// (x, y)를 화면 한가운데 놓고 줌을 잡는다. 요구치가 둘이다:
//   · reach  — 배치가 뻗은 길이의 절반. 컷을 긴 축에 세우므로 **긴 축** 요구치다.
//   · radial — 폭발처럼 사방으로 퍼지는 것의 반경. 사방이므로 **짧은 축**이 문제다.
// 둘 중 큰 쪽으로 잡는다. 이걸 나누지 않으면 세로 화면에서 폭발이 화면을 통째로
// 태워 아무것도 안 보인다(가로 화면의 종횡비로 맞춘 줌은 세로 화면에서 2배 이상
// 확대된 셈이 된다).
// rig.frame은 halfH(세로 절반)를 받으므로 여기서 종횡비를 풀어 준다.
function look(rig, x, y, reach, radial = 0) {
  const a = Math.max(0.2, innerWidth / Math.max(1, innerHeight))
  const byReach = a >= 1 ? reach / a : reach        // 긴 축 = 가로면 halfW 기준
  const byRadial = a >= 1 ? radial : radial / a     // 짧은 축 = 가로면 세로, 세로면 가로
  rig.frame(x, y, Math.max(byReach, byRadial))
}

// ── 판 세팅 도우미 ──────────────────────────────────────────────

// 컷마다 판을 **처음부터 다시** 세운다. 앞 컷의 잔해·폭발·전사자가 다음 컷으로
// 새지 않는다. 예고편은 컷 사이가 점프컷이므로 이래도 자연스럽고, 대신 여섯 컷이
// 언제 봐도 똑같이 나온다.
function board(g, mode) {
  g.resetRun()
  g.stepWarpIns(99)   // 조르그 증원 워프를 즉시 끝내 놓는다 (본성도 여기서 정해진다)
  g.fx.length = 0     // 워프 연출까지는 안 보여 준다
  g.mode = mode       // loadStage가 'aim'으로 되돌려 놓는다 — 매 컷 다시 건다
  g._predKey = null   // 판을 갈아 끼웠으므로 예측 캐시는 버린다
  g.advancing = true
  return g
}

// 큐볼로 쓸 것들 — 살아 있는 태양계 행성. 지구·조르그·잔해는 뺀다.
const cueBalls = (g) => g.bodies.filter(b =>
  b.alive && !b.isEarth && !b.zorg && b.type !== 'debris' && b.role !== 'void')
// 그중 가스 행성이 아니고 체력이 2 이상인 것 = 처박아도 유폭하지도, 한 방에
// 깨지지도 않는 "그냥 공". (성계에는 체력 1짜리 잔챙이도 굴러다닌다 — 그걸
// 큐볼로 쓰면 당구가 아니라 파괴 장면이 된다.)
const solidBalls = (g) => cueBalls(g).filter(b => b.role !== 'volatile' && b.hpMax >= 2)

// 큰 순서로 n개 — 화면에서 "공"으로 읽히려면 어느 정도 크기가 있어야 한다
const biggest = (list, n) => [...list].sort((a, b) => hitRadiusOf(b) - hitRadiusOf(a)).slice(0, n)

// 무대 자리 고르기. 배경 천체가 컷 한복판에 걸치면 무슨 일이 벌어지는지 안
// 읽힌다. 시드는 매일 바뀌므로 자리를 고정할 수 없다 — 주어진 반경들을 한 바퀴씩
// 훑어 **가장 한산한 지점**을 고른다. actors(이번 컷에서 옮길 것들)는 지금 어디에
// 있든 상관없으므로 계산에서 뺀다.
//
// axis/minPerp를 주면 "그 자리에 axis 방향으로 선을 그었을 때 태양에서 minPerp
// 이상 떨어진" 자리만 고른다 — 레이저 진로가 태양에 막히지 않아야 하는 컷용.
function stage(g, radii, actors, { axis, minPerp = 0 } = {}) {
  let best = null, bestD = -1
  for (const r of radii) {
    for (let i = 0; i < 36; i++) {
      const a = i * Math.PI / 18
      const x = Math.cos(a) * r, y = Math.sin(a) * r
      if (axis && Math.abs(x * axis.y - y * axis.x) < minPerp) continue
      let d = Infinity
      for (const b of g.bodies) {
        if (!b.alive || actors.includes(b)) continue
        d = Math.min(d, Math.hypot(b.pos.x - x, b.pos.y - y))
      }
      if (d > bestD) { bestD = d; best = { x, y } }
    }
  }
  return best ?? { x: radii[0], y: 0 }
}

// 무대 좌표계 — P에서 긴 축으로 d, 옆으로 off 만큼 간 자리
const at = (P, u, n, d, off = 0) => [P.x + u.x * d + n.x * off, P.y + u.y * d + n.y * off]

const place = (b, x, y, vx = 0, vy = 0) => {
  b.pos.x = x; b.pos.y = y; b.vel.x = vx; b.vel.y = vy
  b.hp = b.hpMax; b.trailFlash = 0
}

// 조준선이 엉뚱한 데를 겨누고 있으면 화면이 산만하다. 발사각을 이번 컷의
// 무대 쪽으로 돌려 둔다 — 플레이어가 그쪽을 노리고 있는 화면이 된다.
function aimAt(g, x, y) {
  g.aim = Math.atan2(y - g.earth.pos.y, x - g.earth.pos.x)
}

// ── 컷 ──────────────────────────────────────────────────────────
// { ms, setup(g, rig) } — setup은 판을 세우고 카메라를 잡는다.
// 반환한 함수가 있으면 그 컷이 도는 동안 매 프레임 호출된다(카메라 추적용).

const CUTS = [
  // ① 브레이크 샷 — 공이 공을 치고, 맞은 공이 또 다음 공을 친다. 진짜 탄성 충돌.
  //    속도는 일부러 낮췄다: 90 이상이면 피해 2가 들어가 공이 그냥 깨진다.
  {
    ms: 1500,
    setup(g, rig) {
      const [b, c, a] = biggest(solidBalls(g), 3)
      if (!a || !b || !c) return null
      const u = longAxis(), n = perp(u)
      const P = stage(g, [1100, 1400, 1750], [a, b, c])
      place(c, ...at(P, u, n, hitRadiusOf(b) + hitRadiusOf(c) + 42))
      place(b, ...at(P, u, n, 0))
      place(a, ...at(P, u, n, -(hitRadiusOf(a) + hitRadiusOf(b) + 90), -11), u.x * 82, u.y * 82)
      aimAt(g, P.x, P.y)
      const cam = () => look(rig,
        (a.pos.x + b.pos.x + c.pos.x) / 3, (a.pos.y + b.pos.y + c.pos.y) / 3, 300, 200)
      cam()
      return cam
    },
  },
  // ② 핵 — 탄두가 날아와 공의 한쪽 살을 친다. 진짜 임펄스·폭풍·밀림 화살표.
  {
    ms: 1100,
    setup(g, rig) {
      const t = biggest(solidBalls(g), 1)[0]
      if (!t) return null
      const u = longAxis(), n = perp(u)
      const P = stage(g, [1100, 1400, 1750], [t])
      const [X, Y] = at(P, u, n, 0)
      place(t, X, Y, n.x * 12, n.y * 12)
      const [fx, fy] = at(P, u, n, -430, -150)
      const from = { x: fx, y: fy }
      const dx = X - from.x, dy = Y - from.y
      const d = Math.hypot(dx, dy)
      g.yieldMt = CFG.YIELD_MAX
      g.missiles.push({
        pos: { ...from }, vel: { x: dx / d * 620, y: dy / d * 620 },
        yld: CFG.YIELD_MAX, alive: true, chain: 0, nearMiss: 0, age: 0,
        path: [{ ...from }], pathN: 0, enc: new Map(), bestDeflection: 0,
        encountered: false, minSunDist: Infinity, hit: null, out: null, lastBelt: -99,
      })
      g.addFx({ kind: 'launch', x: from.x, y: from.y, a: Math.atan2(dy, dx) })
      aimAt(g, X, Y)
      // 폭심을 화면 한가운데 두고, 탄두가 들어오는 쪽으로 조금만 물러선다
      const [cx, cy] = at(P, u, n, -70, -25)
      const cam = () => look(rig, cx, cy, 380, 380)
      cam()
      return cam
    },
  },
  // ③ 표적 — 조르그 요새를 공으로 처박는다. 진짜 파괴 + 파편 + 목표 카운터.
  {
    ms: 1050,
    setup(g, rig) {
      const fort = g.bodies.find(x => x.alive && x.role === 'battery')
      const cue = biggest(solidBalls(g), 1)[0]
      if (!fort || !cue) return null
      const u = longAxis(), n = perp(u)
      const P = stage(g, [1150, 1450, 1750], [fort, cue])
      const [X, Y] = at(P, u, n, 0)
      place(cue, ...at(P, u, n, -(hitRadiusOf(cue) + hitRadiusOf(fort) + 150), -12),
        u.x * 105, u.y * 105)
      place(fort, X, Y)
      aimAt(g, X, Y)
      // 요새가 부서지면 카메라를 그 자리에 세운다 — 안 그러면 큐볼을 따라가며
      // 정작 보여 줘야 할 폭발과 파편을 화면 밖에 두고 나간다.
      const cam = () => {
        if (fort.alive) look(rig, (cue.pos.x + X) / 2, (cue.pos.y + Y) / 2, 320, 220)
      }
      cam()
      return cam
    },
  },
  // ④ 유폭 — 가스 행성이 터지며 반경 안이 통째로 밀려난다. 진짜 volatileBlast.
  {
    ms: 900,
    setup(g, rig) {
      const gas = g.bodies.find(x => x.alive && x.role === 'volatile')
      if (!gas) return null
      // 둘레에 가벼운 것들을 깔아 둔다 — 밀려나는 게 보여야 유폭이 유폭으로 읽힌다
      const ring = cueBalls(g).filter(b => b !== gas && b.mu < 30).slice(0, 6)
      const { x: X, y: Y } = stage(g, [1250, 1550, 1850], [gas, ...ring])
      place(gas, X, Y)
      ring.forEach((b, i) => {
        const a = i * (Math.PI * 2 / Math.max(1, ring.length)) + 0.3
        place(b, X + Math.cos(a) * 430, Y + Math.sin(a) * 430)
      })
      aimAt(g, X, Y)
      g.volatileBlast(gas)
      look(rig, X, Y, 700, 560)
      return null
    },
  },
  // ⑤ 레이저 — 본성이 쏜 광선이 **날아가서** 앞을 막은 행성을 관통한다.
  //    충전 95초는 건너뛰고 발사 순간부터 보여 준다.
  {
    ms: 1150,
    setup(g, rig) {
      const src = g.homeworld ?? g.bodies.find(x => x.alive && x.role === 'battery')
      if (!src) return null
      g.homeworld = src
      // 광선은 지구를 겨눈다. 그러니 본성과 지구를 긴 축 위에 세우면 진로가
      // 그대로 긴 축이 된다. 태양(반경 150)이 그 선을 막지 않게 무대는 축에서
      // 700 GU 이상 떨어진 자리만 고른다.
      const u = longAxis(), n = perp(u)
      const P = stage(g, [1500, 1800], [src, g.earth], { axis: u, minPerp: 700 })
      place(src, ...at(P, u, n, -750))
      place(g.earth, ...at(P, u, n, 880), n.x * 6, n.y * 6)
      const L = g.laser
      L.state = LASER_IDLE; L.t = 0; L.nextAt = 0
      g.step(CFG.DT)                        // → charge (원래 궤도 ghost·조준점 계산)
      if (L.state !== LASER_CHARGE) return null
      L.t = CFG.LASER_CHARGE                // 다음 스텝에서 바로 발사
      g.step(CFG.DT)
      if (L.state !== LASER_TRAVEL) return null
      // 충전 토스트("95초 뒤 발사")는 지운다 — 그 95초를 건너뛰었으므로 지금 화면과
      // 어긋난다. 광선은 이미 날아가고 있다.
      g.toast = null; g.toastT = 0
      // 진로가 확정된 **뒤에** 벽을 세운다 — 조준점을 짐작하지 않고 그대로 읽는다.
      const D = 1150
      const wall = biggest(solidBalls(g), 1)[0]
      if (wall) place(wall, L.ox + L.ux * D, L.oy + L.uy * D)
      look(rig, L.ox + L.ux * D * 0.5, L.oy + L.uy * D * 0.5, 660, 200)
      return null
    },
  },
  // ⑥ 모성 — 시한이 끝나면 오는 것. 진짜 워프 + 사방 난사.
  {
    ms: 1300,
    setup(g, rig) {
      g.summonMothership()
      const s = g.mothership
      if (!s) return null
      const cam = () => look(rig, (s.pos.x + g.earth.pos.x) / 2, (s.pos.y + g.earth.pos.y) / 2, 1150, 700)
      cam()
      return cam
    },
  },
]

// ── 로고 ────────────────────────────────────────────────────────
// 마크는 이 게임 한 줄 요약이다: **궤도(원) 위의 공을 친다.**
const LOGOMARK = `
<svg viewBox="0 0 120 120" class="slogomark" aria-hidden="true">
  <circle cx="60" cy="60" r="46" fill="none" stroke="#4fd6f7" stroke-width="2.5" opacity=".45"/>
  <circle cx="60" cy="60" r="46" fill="none" stroke="#4fd6f7" stroke-width="2.5"
          stroke-dasharray="18 271" stroke-linecap="round" class="slogotrace"/>
  <circle cx="60" cy="60" r="13" fill="#f5b544" opacity=".16"/>
  <circle cx="60" cy="14" r="9.5" fill="#cfe3ef"/>
  <g class="slogospark">
    <path d="M46 14 l-11 0 M50 5 l-7 -7 M50 23 l-7 7" stroke="#f5b544" stroke-width="3" stroke-linecap="round"/>
  </g>
  <path d="M74 14 l22 0" stroke="#f5b544" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M96 8 l12 6 -12 6 z" fill="#f5b544"/>
</svg>`

export class Attract {
  constructor(game, view, onDone) {
    this.game = game; this.view = view; this.onDone = onDone
    this.i = -1
    this.done = false
    this.timer = null
    this.tick = null      // 이번 컷의 매 프레임 훅(카메라 추적)

    const el = document.createElement('div')
    el.className = 'attract'
    el.innerHTML = `
<div class="attractbar"><i id="attractFill"></i></div>
<div class="attractlogo">
  ${LOGOMARK}
  <div class="slogotitle">PLANETPOOL</div>
  <div class="slogosub">궤도 당구 · ORBITAL BILLIARDS</div>
</div>
<button class="attractskip" id="attractSkip">건너뛰기 (ESC)</button>`
    document.body.appendChild(el)
    this.el = el
    this.fill = el.querySelector('#attractFill')

    el.querySelector('#attractSkip').onclick = (e) => { e.stopPropagation(); this.finish() }
    el.onclick = () => this.finish()
    this.onKey = (e) => { e.preventDefault(); this.finish() }
    addEventListener('keydown', this.onKey)
  }

  start() {
    // 넓은 화면: 조준 모드 — 시간이 흐르되 HUD 패널이 그대로 보이는, 실제 플레이 화면.
    // 좁은 화면: 관측 모드 — 조준 UI가 화면 절반을 먹으므로 통째로 치우고 화면을 준다.
    this.mode = hudDocked() ? 'observe' : 'aim'
    this.game.setMode(this.mode)
    this.next()
    return this
  }

  // 매 프레임 main 루프가 불러 준다.
  frame() {
    if (this.done) return
    // ── 예고편은 끝나지 않는다 ──
    // 컷 중에 마지막 요새가 부서지면 win(), 지구가 레이저에 맞으면 fail()이
    // 걸리는데, 그 순간 effTimeScale이 0이 되어 **남은 컷이 통째로 얼어붙는다.**
    // 여기 판은 어차피 finish()에서 버려지므로 승패 플래그를 매 프레임 지운다.
    const g = this.game
    g.won = false; g.lost = false; g.runOver = false; g.failReason = null
    if (!g.earth.alive) g.earth.alive = true          // 지구가 죽어도 예고편은 계속된다
    if (g.earth.hp <= 0) g.earth.hp = g.earth.hpMax   // 마커에 "체력 0/3"이 뜨지 않게
    g.advancing = true
    this.tick?.()
  }

  next() {
    if (this.done) return
    this.i++
    if (this.i >= CUTS.length) return this.showLogo()
    const cut = CUTS[this.i]
    this.fill.style.width = `${((this.i + 1) / (CUTS.length + 1)) * 100}%`
    let hold = cut.ms
    this.tick = null
    this.view.clearFx()      // 하드컷 — 앞 컷의 불꽃을 끌고 가지 않는다
    try {
      this.tick = cut.setup(board(this.game, this.mode), this.view.rig) ?? null
    } catch {
      this.tick = null; hold = 60      // 세팅이 실패하면 그 컷은 건너뛴다
    }
    this.game.advancing = true          // 컷 세팅 중 멈췄을 수 있다
    this.timer = setTimeout(() => this.next(), hold)
  }

  showLogo() {
    this.tick = null
    this.game.advancing = false          // 로고에서는 판을 세운다
    this.el.classList.add('logo')
    this.fill.style.width = '100%'
    this.timer = setTimeout(() => this.finish(), LOGO_MS)
  }

  finish() {
    if (this.done) return
    this.done = true
    this.tick = null
    clearTimeout(this.timer)
    removeEventListener('keydown', this.onKey)
    this.el.classList.add('out')
    setTimeout(() => this.el.remove(), 420)
    // 판을 처음부터 다시 — 예고편이 헤집어 놓은 성계를 되돌린다.
    this.game.resetRun()
    this.view.rig.snapToAuto()
    this.onDone?.()
  }
}
