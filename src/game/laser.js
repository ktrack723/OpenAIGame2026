import { CFG, hitRadiusOf } from './config.js'
import { cloneBodies, segHitsCircle, stepBodies } from './physics.js'

// ─── 조르그 레이저 ──────────────────────────────────────────────
// 본성이 지구의 **미래 위치**를 계산해 조준선을 고정한 뒤 충전하고 쏜다.
//
// 핵심은 "조준선이 충전 시작에 고정된다"는 것이다. 계속 추적하면 회피가
// 불가능하고, 발사 순간에 정하면 예고가 무의미하다. 고정해 두면 대응이 둘 생긴다:
//   ① 다른 행성을 조준선 위로 밀어 넣어 막는다 (그 행성이 대신 얻어맞고 밀려난다)
//   ② 핵 폭풍으로 지구를 밀어 조준점에서 비켜난다 (지구는 직격하면 안 되니
//      폭풍의 2차 압력을 쓰는 것 — 기존 blastWave가 그대로 대응 수단이 된다)
//
// 지구에 맞으면 게임 오버다.

export const LASER_IDLE = 'idle'
export const LASER_CHARGE = 'charge'
export const LASER_FLASH = 'flash'

export function makeLaser(rng) {
  return {
    state: LASER_IDLE,
    t: 0,
    nextAt: CFG.LASER_FIRST,
    from: null,        // 발사한 본성 (조준 고정 시점의 좌표를 따로 들고 있는다)
    ox: 0, oy: 0,      // 발사점
    ax: 0, ay: 0,      // 조준 목표점 (지구의 미래 위치)
    ux: 0, uy: 0,      // 단위 방향
    range: 0,
    result: null,      // 'earth' | { body } | null
    rng,
  }
}

// 지구를 태양 중력만으로 dt초 뒤까지 굴린다. 행성 섭동은 무시 —
// 9초 앞을 보는 데 필요한 정밀도는 이걸로 충분하고, 무엇보다 싸다.
function earthAfter(earth, seconds) {
  const sim = cloneBodies([earth])
  const dt = 1 / 40, n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) stepBodies(sim, dt)
  return { x: sim[0].pos.x, y: sim[0].pos.y }
}

// 광선이 처음 닿는 천체. 발사점 자신은 제외한다.
function firstHit(bodies, ox, oy, ux, uy, range, skip) {
  let best = null, bestT = Infinity
  for (const b of bodies) {
    if (!b.alive || b === skip || b.type === 'debris') continue
    const r = hitRadiusOf(b)
    // 광선 위 최근접 매개변수
    const px = b.pos.x - ox, py = b.pos.y - oy
    const t = px * ux + py * uy
    if (t < 0 || t > range) continue
    const dx = px - ux * t, dy = py - uy * t
    if (dx * dx + dy * dy > r * r) continue
    // 실제 진입 지점까지 당겨서 비교 (앞에 있는 놈이 먼저 맞는다)
    const back = Math.sqrt(Math.max(0, r * r - (dx * dx + dy * dy)))
    const tt = t - back
    if (tt < bestT) { bestT = tt; best = b }
  }
  return best ? { body: best, t: Math.max(0, bestT) } : null
}

// game이 매 스텝 호출한다. 발사 결과는 game이 처리하도록 이벤트로 돌려준다.
export function stepLaser(L, game, dt) {
  if (game.won || game.lost) return null
  L.t += dt

  if (L.state === LASER_IDLE) {
    if (L.t < L.nextAt) return null
    const src = game.homeworld
    if (!src || !src.alive) { L.nextAt = L.t + 20; return null }   // 본성이 없으면 조용하다
    // 조준선 고정 — 충전이 끝나는 순간의 지구 위치를 겨눈다
    const aim = earthAfter(game.earth, CFG.LASER_CHARGE)
    const dx = aim.x - src.pos.x, dy = aim.y - src.pos.y
    const d = Math.hypot(dx, dy) || 1
    L.state = LASER_CHARGE; L.t = 0
    L.from = src; L.ox = src.pos.x; L.oy = src.pos.y
    L.ax = aim.x; L.ay = aim.y
    L.ux = dx / d; L.uy = dy / d
    L.range = game.aMax * CFG.LASER_RANGE_MUL
    L.result = null
    return { kind: 'charge', src }
  }

  if (L.state === LASER_CHARGE) {
    // 본성이 충전 중에 파괴되면 발사가 취소된다 — 선제 격파가 정당한 대응이 된다
    if (!L.from.alive) { L.state = LASER_IDLE; L.t = 0; L.nextAt = nextPeriod(L); return { kind: 'abort' } }
    // 발사점은 본성을 따라간다(본성도 공전한다). 조준점은 고정.
    L.ox = L.from.pos.x; L.oy = L.from.pos.y
    const dx = L.ax - L.ox, dy = L.ay - L.oy
    const d = Math.hypot(dx, dy) || 1
    L.ux = dx / d; L.uy = dy / d
    if (L.t < CFG.LASER_CHARGE) return null
    // ── 발사 ──
    L.state = LASER_FLASH; L.t = 0
    const hit = firstHit(game.bodies, L.ox, L.oy, L.ux, L.uy, L.range, L.from)
    L.result = hit
    return { kind: 'fire', hit, src: L.from }
  }

  if (L.state === LASER_FLASH && L.t >= CFG.LASER_FLASH) {
    L.state = LASER_IDLE; L.t = 0; L.nextAt = nextPeriod(L)
  }
  return null
}

function nextPeriod(L) {
  return CFG.LASER_PERIOD + (L.rng.next() * 2 - 1) * CFG.LASER_JITTER
}

// 충전 중 남은 시간 (HUD 경고용)
export const chargeLeft = (L) => L.state === LASER_CHARGE ? Math.max(0, CFG.LASER_CHARGE - L.t) : 0
