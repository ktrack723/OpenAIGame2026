import { CFG, beltRadius, hitRadiusFor, hitRadiusOf, radiusOf } from './config.js'
import { buildBodyTrack, trackFrame } from './physics.js'
import { makeBody } from './body.js'

// ─── 혜성 — 지나가는 큐볼 ───────────────────────────────────────
// 규칙은 **빼기 하나**뿐이다: 카이퍼 벨트가 안 튕긴다. 밖에서 들어와 성계를
// 가로지르고 반대편으로 나간다. 나머지는 전부 다른 공과 같다 — 중력을 받고,
// 핵에 밀리고, 부딪히면 부서지고(체력 1), 광선에 녹고, 태양에 떨어진다.
//
// 왜 있는가는 config의 COMET_* 주석에 있다: 판 도중에 큐볼을 보충하는 유일한
// 경로다. 그래서 이건 선물이 아니라 **기회**다 — 지나가는 동안에만 쓸 수 있다.

let uid = 0

// ── 진입선은 '충격 파라미터'로 짓는다 ──────────────────────────
// 위치와 방향을 따로 뽑으면 태양을 정통으로 지나는 선이 나온다(혜성이 제 발로
// 항성에 빠진다). 그래서 **태양에서 직선까지의 거리 b를 직접 고르고**, 그 직선
// 위에서 벨트 밖으로 물러난 자리를 출발점으로 삼는다.
//
//   b   = rE × COMET_B          태양 ~ 진입선 거리
//   dir = 진행 방향(임의)
//   n   = dir에 직각(좌/우 임의)
//   pos = n̂·b − d̂ir·(벨트 반경 + LEAD)
//
// 그래서 세 가지가 계산으로 보증된다:
//   ① 근점이 코로나 밖 — b = 0.55 rE 인 최악의 경우에도 ≈330 GU다(R_STAR 195).
//   ② "거의 일자" — 태양 굴절은 tan(θ/2) = μ/(b v²)라 5°(바깥) ~ 15°(안쪽).
//      중력을 안 받게 만든 게 아니라 **빨라서 안 휘는 것**이다.
//   ③ 반드시 싸움터를 지난다 — COMET_B가 요새 대역(0.55~1.6 rE)과 같은 띠다.
function drawLine(rng, earth, beltR) {
  const rE = Math.hypot(earth.pos.x, earth.pos.y) || 700
  const [lo, hi] = CFG.COMET_B
  const b = rE * (lo + rng.next() * (hi - lo))
  const dir = rng.range(0, Math.PI * 2)
  const n = dir + (rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2)
  const back = beltR + CFG.COMET_LEAD
  return {
    pos: { x: Math.cos(n) * b - Math.cos(dir) * back, y: Math.sin(n) * b - Math.sin(dir) * back },
    vel: { x: Math.cos(dir) * CFG.COMET_SPEED, y: Math.sin(dir) * CFG.COMET_SPEED },
  }
}

// ── 이 선은 지구에 안 꽂히는가 / 태양에 안 빠지는가 ─────────────
// 왜 거르나 — 혜성은 **순수한 보급**이어야 한다. 플레이어가 아무것도 안 했는데
// 새 위협이 하늘에서 떨어지면 그건 보급이 아니라 사고다. 게다가 지구의 실효
// 질량은 135뿐이라(EARTH_MU × MU_SCALE) 78 GU/s로 달려온 혜성에 정통으로
// 맞으면 체력만 깎이는 게 아니라 궤도가 통째로 날아간다.
// 태양도 같이 본다: 충격 파라미터는 **지구의 지금 반경**에서 나오므로(COMET_B)
// 지구가 안쪽으로 밀린 판에서는 그 띠가 통째로 코로나 쪽으로 내려온다.
//
// 처음엔 등속 직선의 최근접 거리로 쟀다(O(1)이라 공짜다). **안 맞았다** —
// 12시드 계측에서 848기 중 20기(2.4%)가 지구에 그대로 닿았다. 직선 두 개로는
// 두 가지를 놓친다: 혜성은 5~12° 휘고, 지구는 70초 동안 1400 GU를 곡선으로 간다.
//
// 그래서 **실제로 굴려 본다.** 판을 한 번 굴려 궤적을 기록해 두고(buildBodyTrack —
// reachable()이 프로브 48발에 쓰는 그 물건이다) 후보 선 여러 개를 그 위에서
// 재생한다. 천체 궤적은 후보와 무관하므로 트랙은 **한 번만** 짓는다:
// 12번 뽑아도 O(n²) 적분은 한 번이다.
const GUARD_DT = 0.5
function buildGuard(bodies, earth, span) {
  const steps = Math.max(1, Math.round(span / GUARD_DT))
  const track = buildBodyTrack(bodies, GUARD_DT, 1, steps)
  return { track, steps, ei: track.view.findIndex(b => b.isEarth), earth }
}
// 혜성을 시험입자로 굴린다 — 태양 + 그 순간의 천체들, 전부 **진짜 물리**(κ=1).
// (미사일이 아니므로 stepMissile을 쓰면 안 된다: 저건 행성 중력을 120배로 받는다.)
function guardMiss(G, line) {
  const { track, steps, ei } = G
  const view = track.view
  let x = line.pos.x, y = line.pos.y, vx = line.vel.x, vy = line.vel.y
  let best = Infinity, peri = Math.hypot(x, y)
  const kick = (h) => {
    let d2 = x * x + y * y + CFG.EPS * CFG.EPS
    let inv = CFG.MU_STAR / (d2 * Math.sqrt(d2))
    let ax = -x * inv, ay = -y * inv
    for (const b of view) {
      if (!b.alive || b.comet) continue
      const dx = b.pos.x - x, dy = b.pos.y - y
      d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS
      inv = b.mu / (d2 * Math.sqrt(d2))
      ax += dx * inv; ay += dy * inv
    }
    vx += ax * h; vy += ay * h
  }
  for (let f = 0; f < steps; f++) {
    trackFrame(track, f)
    kick(GUARD_DT / 2)
    x += vx * GUARD_DT; y += vy * GUARD_DT
    kick(GUARD_DT / 2)
    peri = Math.min(peri, Math.hypot(x, y))
    if (ei >= 0) best = Math.min(best, Math.hypot(x - view[ei].pos.x, y - view[ei].pos.y))
  }
  return { earth: best, peri }
}
function clears(G, line, rComet) {
  const need = CFG.COMET_EARTH_CLEAR * (hitRadiusOf(G.earth) + hitRadiusFor(rComet))
  const { earth: d, peri } = guardMiss(G, line)
  return d > need && peri > CFG.R_STAR * 1.8
}

// ── 한 기 ───────────────────────────────────────────────────────
// 자리를 못 찾으면 null. 부르는 쪽은 그냥 이번 차례를 거른다 — 다음 주기에
// 다시 온다. (요새와 달리 혜성은 **안 와도 판이 성립한다.**)
export function spawnComet(rng, bodies, earth, aMax, tag) {
  const beltR = beltRadius(aMax)
  const [muLo, muHi] = CFG.COMET_MU
  const mu = muLo + rng.next() * (muHi - muLo)
  const radius = radiusOf(mu)
  // 성계를 가로지르는 데 걸리는 시간 — 검사의 지평이다
  const span = (2 * beltR + 2 * CFG.COMET_LEAD) / CFG.COMET_SPEED
  const G = buildGuard(bodies, earth, span)
  let line = null
  for (let i = 0; i < 12; i++) {
    const cand = drawLine(rng, earth, beltR)
    if (clears(G, cand, radius)) { line = cand; break }
  }
  if (!line) return null
  return makeBody({
    id: `c${(uid++).toString(36)}`,
    // 이름은 실제 혜성 부호를 흉내 낸다 — 번역할 게 없고, 판마다 다른 손님이라는 게
    // 이름만 봐도 읽힌다. (nameKey를 주면 다섯 언어 표에 문장을 하나 더 얹어야 하고,
    //  그 문장은 어차피 "혜성" 한 단어다 — 그건 태그(role.comet)가 이미 말한다.)
    name: `C/${tag}`,
    mu, radius,
    pos: line.pos, vel: line.vel,
    type: 'comet',
    hp: 1,              // 한 번 처박으면 같이 부서진다 — 한 번 쓰는 큐볼이다
    comet: true,
  })
}

// ── 판이 부르는 자리 ────────────────────────────────────────────
// 스폰 시계와 퇴장을 한 곳에서 돌린다. **인게임 초**로 잰다 — 혜성은 판 위의
// 사건이라 관측 배속을 그대로 타야 한다(워프인·추진기 대기가 실시간인 것과
// 반대다. 그쪽은 화면의 사건이고 이쪽은 판의 사건이다).
export function stepComets(game, dt) {
  if (game.won || game.lost || game.doom) return
  // 예고편은 판을 직접 연출한다 — 그 화면에 손님이 끼어들면 안 된다.
  if (game.trailer) return
  const live = game.bodies.filter(b => b.alive && b.comet)
  // 퇴장 — 벨트 밖으로 나가고 **바깥으로 향하는 중**일 때만. 들어올 때는 벨트
  // 밖에서 시작하므로 방향을 같이 안 보면 태어나자마자 사라진다.
  const exitR = game.beltR + CFG.COMET_EXIT
  for (const b of live) {
    if (Math.hypot(b.pos.x, b.pos.y) < exitR) continue
    if (b.pos.x * b.vel.x + b.pos.y * b.vel.y <= 0) continue
    b.alive = false          // 조용히 나간다. 격파가 아니므로 연출도 문구도 없다
  }

  game.cometT += dt
  const cues = game.bodies.filter(b => b.alive && !b.isEarth && !b.zorg && !b.comet && b.type !== 'debris').length
  // 굴릴 공이 모자라면 주기가 당겨진다 — 모함이 보충을 결정할 때 쓰는 것과
  // 같은 문턱(HIVE_KEEP_CUE)이라 성계를 채우는 세 경로가 같은 질문을 한다.
  const wait = (game.cometN ? CFG.COMET_PERIOD : CFG.COMET_FIRST)
    * (cues < CFG.HIVE_KEEP_CUE ? CFG.COMET_RUSH : 1)
  if (game.cometT < wait) return
  game.cometT = 0
  if (live.length >= CFG.COMET_MAX) return
  const b = spawnComet(game.rng, game.bodies, game.earth, game.aMax, `${game.stage}-${game.cometN + 1}`)
  if (!b) return
  game.cometN++
  game.bodies.push(b)
  game.onComet(b)
}
