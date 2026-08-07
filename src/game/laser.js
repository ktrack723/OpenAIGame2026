import { CFG, hitRadiusOf } from './config.js'
import { cloneBodies, segCircleEntry, segHitsCircle, stepBodies } from './physics.js'

// ─── 조르그 레이저 ──────────────────────────────────────────────
// 상태는 셋이다: 조용함 → **충전**(조준점이 보인다) → **비행**(광선이 날아간다).
//
// ① 충전 — 조르그가 조준점 하나를 찍는다.
//    조준점은 "충전이 끝나고 광선이 날아가 닿을 그 순간에 지구가 있을 자리"다.
//    지금 지구가 있는 자리로 선을 긋는 게 아니다 — 그 사이에 지구는 공전해서
//    이미 거기 없다(계측: 충전 95초는 지구 공전의 62%다).
//
//    그리고 조르그의 조준은 **지구가 원래 궤도를 그대로 돈다**는 가정 위에 있다.
//    플레이어가 핵 폭풍으로 지구를 밀면 지구는 그 궤도에서 벗어나는데, 조르그는
//    그 사실을 계산에 넣지 못한다 — 조준점은 "밀리지 않았다면 지구가 있었을
//    자리"에 그대로 박혀 있고, **벗어난 만큼 그대로 조준이 틀어진다.**
//    화면에서는 지구가 그 표식에서 미끄러져 나가는 것으로 읽힌다.
//
// ② 비행 — 광선은 즉발이 아니다. 정해진 속도로 날아간다(빠르지만 시간이 걸린다).
//    조준점에서 멈추지 않고 **그대로 직진**한다. 그러니 조준점이 틀어져 있으면
//    광선은 그 자리를 스쳐 지나가 뒤에 있는 무언가에 박힌다.
//
// 닿는 것은 **체력과 무관하게 부서진다.** 태양과 특이점만 예외로, 광선을 막되
// 부서지지 않는다(원래 부술 수 없는 것들이다). 지구에 닿으면 게임 오버다.

export const LASER_IDLE = 'idle'
export const LASER_CHARGE = 'charge'
export const LASER_TRAVEL = 'travel'

// 조준점을 다시 푸는 간격(인게임 초). 매 스텝 풀면 95초짜리 예측을 초당 120번
// 도는 셈이라 낭비다 — 지구를 민 결과는 0.5초 안에 화면에 뜨면 충분하다.
const AIM_REFRESH = 0.5

export function makeLaser(rng) {
  return {
    state: LASER_IDLE,
    t: 0,
    nextAt: CFG.LASER_FIRST,
    from: null,        // 발사한 본성
    ox: 0, oy: 0,      // 총구 (충전 중엔 본성을 따라가고, 발사 순간 고정된다)
    ax: 0, ay: 0,      // 조준점 — 매 AIM_REFRESH 초마다 다시 푼다
    ux: 0, uy: 0,      // 발사 방향 (발사 순간 고정)
    aimDist: 0,        // 총구 → 조준점 거리
    head: 0,           // 비행 중 광선 머리가 나아간 거리
    range: 0,
    ghost: null,       // 지구의 **원래 궤도** — 조준점은 이걸 굴려서 잡는다
    miss: 0,           // 광선 중심선에서 지구까지의 예상 수직거리
    safe: false,       // miss가 지구 판정 반경을 넘었나 = 지금 이대로면 사는가
    refresh: 0,        // 조준점 재계산 타이머
    rng,
  }
}

// 지구를 태양 중력만으로 seconds초 뒤까지 굴린다. 행성 섭동은 무시 —
// 조르그의 계산도 이 정도이고(그래서 밀면 빗나간다), 무엇보다 싸다.
function propagate(state, seconds) {
  const sim = cloneBodies([state])
  const dt = 1 / 40, n = Math.round(seconds / dt)
  for (let i = 0; i < n; i++) stepBodies(sim, dt)
  return { x: sim[0].pos.x, y: sim[0].pos.y }
}

// 광선이 닿을 때까지 걸리는 시간의 추정값. 충전 95초에 비하면 1초 남짓이라
// 대충 맞아도 되지만, 넣어야 "도달 순간"을 겨눈 게 된다.
const travelGuess = (L, earth) =>
  Math.hypot(earth.pos.x - L.ox, earth.pos.y - L.oy) / CFG.LASER_SPEED

// ─── 조준점 ─────────────────────────────────────────────────────
// 조르그는 **원래 궤도(ghost)**를 굴려서 도달 지점을 계산한다. 진짜 지구가
// 아니라 "밀리지 않았다면 지구가 있었을 자리"를 겨누는 것이다.
//
//   · 안 밀었으면 ghost = 지구라서 정확히 맞는다.
//   · 밀었으면 지구가 원래 궤도에서 벗어난 만큼 그대로 빗나간다.
//
// 진짜 지구의 미래 위치에 이탈량을 더하는 식으로도 같은 오차를 만들 수 있지만,
// 그러면 오차가 두 번 곱해져 조준점이 판 밖(벨트 너머 3000 GU)으로 날아간다 —
// 화면에 안 보이는 조준점은 조준점이 아니다. ghost를 굴리면 조준점은 언제나
// 지구의 원래 궤도 위에 있으므로 항상 판 안이고, 지구가 그 표식에서
// 미끄러지는 것으로 회피가 읽힌다.
function solveAim(L, game) {
  const T = Math.max(0, CFG.LASER_CHARGE - L.t) + travelGuess(L, game.earth)
  const lead = propagate(L.ghost, T)          // 조르그가 겨누는 자리 (원래 궤도)
  const real = propagate(game.earth, T)       // 지구가 실제로 도달할 자리
  L.ax = lead.x; L.ay = lead.y
  const dx = L.ax - L.ox, dy = L.ay - L.oy
  const d = Math.hypot(dx, dy) || 1
  L.aimDist = d
  // 광선은 총구 → 조준점을 잇는 직선이다. 그 선에서 **지구가 실제로 도달할
  // 자리**까지의 수직거리가 곧 빗나가는 양이다. 이 값이 지구 판정 반경을
  // 넘으면 살고, 못 넘으면 죽는다 — 화면에 그대로 보여 줄 수 있는 유일한 숫자.
  const ux = dx / d, uy = dy / d
  const px = real.x - L.ox, py = real.y - L.oy
  const t = px * ux + py * uy
  L.miss = Math.hypot(px - ux * t, py - uy * t)
  L.safe = L.miss > hitRadiusOf(game.earth)
}

// 광선이 이번 구간에서 처음 닿는 것. 태양(원점)과 천체를 함께 본다.
// 반환: { body|null, x, y, stop } — body가 null이면 태양에 막힌 것이다.
function sweep(game, x0, y0, x1, y1, skip) {
  let best = null, bestD = Infinity
  const take = (body, p) => {
    const d = Math.hypot(p.x - x0, p.y - y0)
    if (d < bestD) { bestD = d; best = { body, x: p.x, y: p.y } }
  }
  // 태양 — 막되 부서지지 않는다. 광선은 여기서 끝난다.
  if (segHitsCircle(x0, y0, x1, y1, 0, 0, CFG.R_STAR))
    take(null, segCircleEntry(x0, y0, x1, y1, 0, 0, CFG.R_STAR))
  for (const b of game.bodies) {
    if (!b.alive || b === skip || (b.warpIn ?? 0) > 0) continue
    const r = hitRadiusOf(b)
    if (!segHitsCircle(x0, y0, x1, y1, b.pos.x, b.pos.y, r)) continue
    take(b, segCircleEntry(x0, y0, x1, y1, b.pos.x, b.pos.y, r))
  }
  return best
}

// game이 매 스텝 호출한다. 결과는 game이 처리하도록 이벤트로 돌려준다.
export function stepLaser(L, game, dt) {
  if (game.won || game.lost) return null
  L.t += dt

  if (L.state === LASER_IDLE) {
    if (L.t < L.nextAt) return null
    const src = game.homeworld
    if (!src || !src.alive) { L.nextAt = L.t + 20; return null }   // 본성이 없으면 조용하다
    L.state = LASER_CHARGE; L.t = 0
    L.from = src; L.ox = src.pos.x; L.oy = src.pos.y
    L.head = 0; L.refresh = 0
    L.range = game.aMax * CFG.LASER_RANGE_MUL
    // 지구의 **원래 궤도** 사본. 이제부터 진짜 지구가 이것과 벌어지는 만큼
    // 조르그의 조준이 틀어진다.
    L.ghost = cloneBodies([game.earth])[0]
    solveAim(L, game)
    return { kind: 'charge', src }
  }

  if (L.state === LASER_CHARGE) {
    // 본성이 충전 중에 파괴되면 발사가 취소된다 — 선제 격파가 정당한 대응이 된다
    if (!L.from.alive) { L.state = LASER_IDLE; L.t = 0; L.nextAt = nextPeriod(L); return { kind: 'abort' } }
    L.ox = L.from.pos.x; L.oy = L.from.pos.y      // 총구는 본성을 따라간다
    stepBodies([L.ghost], dt)                     // 원래 궤도는 계속 돈다
    L.refresh += dt
    if (L.refresh >= AIM_REFRESH) { L.refresh = 0; solveAim(L, game) }
    if (L.t < CFG.LASER_CHARGE) return null
    // ── 발사 ── 여기서 방향이 고정된다. 이후 총구도 조준점도 광선을 못 바꾼다.
    solveAim(L, game)
    const d = L.aimDist || 1
    L.ux = (L.ax - L.ox) / d; L.uy = (L.ay - L.oy) / d
    L.state = LASER_TRAVEL; L.t = 0; L.head = 0
    return { kind: 'fire', src: L.from }
  }

  if (L.state === LASER_TRAVEL) {
    const h0 = L.head
    L.head = Math.min(L.range, h0 + CFG.LASER_SPEED * dt)
    const x0 = L.ox + L.ux * h0, y0 = L.oy + L.uy * h0
    const x1 = L.ox + L.ux * L.head, y1 = L.oy + L.uy * L.head
    // 총구가 된 본성은 첫 구간에서만 제외한다(제 몸에서 나가는 중이다)
    const hit = sweep(game, x0, y0, x1, y1, h0 < hitRadiusOf(L.from) * 2 ? L.from : null)
    if (hit) {
      L.state = LASER_IDLE; L.t = 0; L.nextAt = nextPeriod(L)
      L.head = Math.hypot(hit.x - L.ox, hit.y - L.oy)
      return { kind: 'hit', body: hit.body, x: hit.x, y: hit.y }
    }
    if (L.head >= L.range) {
      L.state = LASER_IDLE; L.t = 0; L.nextAt = nextPeriod(L)
      return { kind: 'expire', x: x1, y: y1 }
    }
    return null
  }
  return null
}

function nextPeriod(L) {
  return CFG.LASER_PERIOD + (L.rng.next() * 2 - 1) * CFG.LASER_JITTER
}

// 충전 중 남은 시간 (HUD 경고용)
export const chargeLeft = (L) => L.state === LASER_CHARGE ? Math.max(0, CFG.LASER_CHARGE - L.t) : 0
// 비행 중 조준점까지 남은 시간 (HUD 경고용)
export const impactLeft = (L) =>
  L.state === LASER_TRAVEL ? Math.max(0, (L.aimDist - L.head) / CFG.LASER_SPEED) : 0
