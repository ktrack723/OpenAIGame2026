import { CFG, hitRadiusOf } from './config.js'
import { cloneBodies, segCircleEntry, segHitsCircle, stepBodies } from './physics.js'

// ─── 조르그 레이저 ──────────────────────────────────────────────
// **포대 하나에 광선 하나.** 살아 있는 조르그 요새는 저마다 이 상태기를 하나씩
// 들고 있고, 그것들이 시차를 두고 돌아가며 지구를 겨눈다(game.syncLasers).
// 주기는 전부 같다 — 다른 것은 시작 시각뿐이다.
//
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
//
// ③ 요격 — 날아가는 광선의 진로에 **내 탄두가 걸려 있으면** 그 자리에서 터지며
//    광선을 막는다. 조준선은 충전 내내 보이므로 "미리 그 선 위에 탄을 걸쳐 둔다"가
//    성립한다 — 회피(지구 밀기)·차폐(행성 밀어넣기)·선제(포대 격파)에 이어 넷째 수다.

export const LASER_IDLE = 'idle'
export const LASER_CHARGE = 'charge'
export const LASER_TRAVEL = 'travel'
// ④ 소진 — 머리가 멎은 뒤 **꼬리가 그 자리까지 들어오는** 동안.
//    광선은 길이 LASER_BOLT짜리 덩어리다. 머리가 행성에 박혔다고 그 뒤에
//    이미 나와 있던 빛까지 같이 사라질 이유는 없다 — 앞에서부터 빨려 들어가며
//    짧아지다가 없어진다. 판정은 이미 끝났고(hit 이벤트는 벌써 나갔다)
//    여기서 도는 것은 꼬리 하나뿐이다.
export const LASER_SPENT = 'spent'

// 조준점을 다시 푸는 간격(인게임 초). 매 스텝 풀면 95초짜리 예측을 초당 120번
// 도는 셈이라 낭비다 — 지구를 민 결과는 0.5초 안에 화면에 뜨면 충분하다.
const AIM_REFRESH = 0.5

// from = 이 광선을 쏘는 요새. 광선은 그 요새의 것이고, 요새가 죽으면 같이 없어진다.
// nextAt = 첫 조준까지의 대기. 요새마다 다르게 넣어 시차를 만든다.
export function makeLaser(rng, from, nextAt = CFG.LASER_FIRST) {
  return {
    state: LASER_IDLE,
    t: 0,
    nextAt,
    from,              // 발사하는 요새 — 평생 안 바뀐다
    ox: from ? from.pos.x : 0, oy: from ? from.pos.y : 0,   // 총구 (요새를 따라간다)
    ax: 0, ay: 0,      // 조준점 — 매 AIM_REFRESH 초마다 다시 푼다
    ux: 0, uy: 0,      // 발사 방향 (발사 순간 고정)
    aimDist: 0,        // 총구 → 조준점 거리
    head: 0,           // 비행 중 광선 머리가 나아간 거리
    back: 0,           // 꼬리가 나아간 거리 — 머리가 멎어도 이건 계속 간다
    range: 0,
    ghost: null,       // 지구의 **원래 궤도** — 조준점은 이걸 굴려서 잡는다
    miss: 0,           // 광선 중심선에서 지구까지의 예상 수직거리
    safe: false,       // miss가 지구 판정 반경을 넘었나 = 지금 이대로면 사는가
    refresh: 0,        // 조준점 재계산 타이머
    // 조준점을 밖에서 고정한다(오프닝 예고편이 쓴다). 참이면 ax/ay를 그대로
    // 믿고 지구 예측을 건너뛴다 — 빗나감(miss/safe) 계산은 그대로 돈다.
    lockAim: false,
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
  const real = propagate(game.earth, T)       // 지구가 실제로 도달할 자리
  if (!L.lockAim) {
    const lead = propagate(L.ghost, T)        // 조르그가 겨누는 자리 (원래 궤도)
    L.ax = lead.x; L.ay = lead.y
  }
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
// 반환: { body|null, x, y } — body가 null이면 태양에 막힌 것이다.
// 요새의 조준 광선과 모성의 난사가 같은 함수를 쓴다 — 규칙이 갈리면 안 된다.
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
// n = 지금 살아 있는 포대 수. 주기를 여기서 정한다(요새가 줄면 남은 것이 더 자주 쏜다).
export function stepLaser(L, game, dt, n = 1) {
  if (game.won || game.lost) return null
  L.t += dt

  if (L.state === LASER_IDLE) {
    if (L.t < L.nextAt) return null
    const src = L.from
    if (!src || !src.alive) return null    // 죽은 포대는 game이 명단에서 걷어낸다
    L.state = LASER_CHARGE; L.t = 0
    L.ox = src.pos.x; L.oy = src.pos.y
    L.head = 0; L.back = 0; L.refresh = 0
    L.n = n
    L.range = game.aMax * CFG.LASER_RANGE_MUL
    // 지구의 **원래 궤도** 사본. 이제부터 진짜 지구가 이것과 벌어지는 만큼
    // 조르그의 조준이 틀어진다.
    L.ghost = cloneBodies([game.earth])[0]
    solveAim(L, game)
    return { kind: 'charge', src }
  }

  if (L.state === LASER_CHARGE) {
    // 포대가 충전 중에 파괴되면 발사가 취소된다 — 선제 격파가 정당한 대응이 된다
    if (!L.from.alive) { L.state = LASER_IDLE; L.t = 0; L.nextAt = nextPeriod(L, n); return { kind: 'abort', src: L.from } }
    L.ox = L.from.pos.x; L.oy = L.from.pos.y      // 총구는 요새를 따라간다
    stepBodies([L.ghost], dt)                     // 원래 궤도는 계속 돈다
    L.refresh += dt
    if (L.refresh >= AIM_REFRESH) { L.refresh = 0; solveAim(L, game) }
    if (L.t < CFG.LASER_CHARGE) return null
    // ── 발사 ── 여기서 방향이 고정된다. 이후 총구도 조준점도 광선을 못 바꾼다.
    solveAim(L, game)
    const d = L.aimDist || 1
    L.ux = (L.ax - L.ox) / d; L.uy = (L.ay - L.oy) / d
    L.state = LASER_TRAVEL; L.t = 0; L.head = 0; L.back = 0
    return { kind: 'fire', src: L.from }
  }

  if (L.state === LASER_TRAVEL) {
    const h0 = L.head
    L.head = Math.min(L.range, h0 + CFG.LASER_SPEED * dt)
    // 꼬리는 머리보다 LASER_BOLT만큼 뒤에서 따라온다. 총구를 막 떠난 동안은
    // 0에 붙어 있어서(음수가 안 된다) 막대가 총구에서 자라 나오는 것으로 보인다.
    L.back = Math.max(0, L.head - CFG.LASER_BOLT)
    const x0 = L.ox + L.ux * h0, y0 = L.oy + L.uy * h0
    const x1 = L.ox + L.ux * L.head, y1 = L.oy + L.uy * L.head
    // ── 요격 — 천체 판정보다 먼저다. 탄두가 앞을 막고 있으면 거기서 끝난다 ──
    for (const m of game.missiles) {
      if (!m.alive) continue
      if (!segHitsCircle(x0, y0, x1, y1, m.pos.x, m.pos.y, CFG.LASER_INTERCEPT_R)) continue
      spend(L, Math.hypot(m.pos.x - L.ox, m.pos.y - L.oy))
      return { kind: 'intercept', missile: m, x: m.pos.x, y: m.pos.y }
    }
    // 총구가 된 요새는 첫 구간에서만 제외한다(제 몸에서 나가는 중이다)
    const hit = sweep(game, x0, y0, x1, y1, h0 < hitRadiusOf(L.from) * 2 ? L.from : null)
    if (hit) {
      spend(L, Math.hypot(hit.x - L.ox, hit.y - L.oy))
      return { kind: 'hit', body: hit.body, x: hit.x, y: hit.y }
    }
    if (L.head >= L.range) {
      spend(L, L.range)
      return { kind: 'expire', x: x1, y: y1 }
    }
    return null
  }

  return null
}

// ── 소진 — 판정은 끝났고 꼬리만 남았다 ──────────────────────────
// 머리는 박힌 자리에 못 박혀 있고 꼬리만 같은 속도로 다가온다. 둘이 만나면
// 광선이 다 들어간 것이고, 그때 비로소 다음 조준까지의 시계가 돈다.
//
// **실시간으로 돈다**(stepWarpIns와 같은 이유다). 인게임 시계로 돌리면 광선이
// 지구를 부순 바로 그 순간 판이 멈추므로(won/lost → effTimeScale 0) 꼬리가
// 화면에 반쯤 걸린 채로 영영 굳는다 — 마지막 한 발일수록 끝까지 들어가야 한다.
export function stepSpent(L, dtReal, n = 1) {
  if (!L || L.state !== LASER_SPENT) return
  L.back = Math.min(L.head, L.back + CFG.LASER_SPEED * dtReal)
  if (L.back >= L.head) { L.state = LASER_IDLE; L.t = 0; L.nextAt = nextPeriod(L, n) }
}

// 머리를 그 자리에 못 박고 소진 상태로 넘긴다. 다음 조준까지의 시계(nextAt)는
// 꼬리가 다 들어온 뒤에 돌기 시작한다 — 광선이 아직 화면에 있는 동안 다음
// 충전이 시작되면 같은 요새에서 두 줄기가 겹친다.
function spend(L, head) {
  L.head = head
  L.back = Math.min(L.back, head)
  L.state = LASER_SPENT
}

// 주기는 모든 포대가 같다. 다만 **포대 수에 따라 늘어난다** — 여덟 기가 저마다
// 300초로 쏘면 성계는 37초에 한 발을 맞는데, 그건 대응할 수 있는 판이 아니다.
// 요새를 하나 부수면 그만큼 주기가 짧아지지만(남은 놈들이 더 자주 쏜다) 순번
// 자체가 하나 사라지므로 성계가 겪는 박자는 그대로다.
function nextPeriod(L, n = 1) {
  const base = Math.max(CFG.LASER_PERIOD, CFG.LASER_SPACING * Math.max(1, n))
  return base + (L.rng.next() * 2 - 1) * CFG.LASER_JITTER
}

// 충전 중 남은 시간 (HUD 경고용)
export const chargeLeft = (L) => L.state === LASER_CHARGE ? Math.max(0, CFG.LASER_CHARGE - L.t) : 0
// 비행 중 조준점까지 남은 시간 (HUD 경고용)
export const impactLeft = (L) =>
  L.state === LASER_TRAVEL ? Math.max(0, (L.aimDist - L.head) / CFG.LASER_SPEED) : 0

// ─── 조르그 모성의 난사 ─────────────────────────────────────────
// 작전 시한이 끝나면 조르그 **모성**이 판 한가운데로 워프해 들어와 사방에
// 광선을 뿌린다. 이건 플레이어가 이길 수 있는 싸움이 아니다 — 시한을 넘겼다는
// 사실을 문장 하나로 통보하는 대신 **보여 주는** 장치다.
//
// 광선 하나하나는 요새의 것과 똑같이 굴러간다(같은 sweep, 같은 속도, 닿는 첫
// 천체는 체력 불문 소멸). 다만 조준이 없다 — 부채꼴로 하나씩 돌아가며 뿜는다.
export function makeDoom(x, y, range, ship) {
  return { x, y, range, ship, t: 0, warping: true, spawned: 0, volley: 0, beams: [], done: false }
}

// 마지막 한 발의 조준각 — 광선이 날아가는 동안 지구가 이동한 만큼 미리 당긴다.
// (안 당기면 2초 비행 중 지구가 50 GU 옮겨 가 판정 반경 37 GU를 벗어난다 —
//  실제로 네 시드 모두 마지막 발이 빗나가 지구가 살아남았다.)
function doomAimEarth(D, earth) {
  let px = earth.pos.x, py = earth.pos.y
  for (let i = 0; i < 3; i++) {                    // 거리↔비행시간을 두어 번 되풀어 수렴시킨다
    const t = Math.hypot(px - D.x, py - D.y) / CFG.LASER_SPEED
    px = earth.pos.x + earth.vel.x * t
    py = earth.pos.y + earth.vel.y * t
  }
  return Math.atan2(py - D.y, px - D.x)
}

export function stepDoom(D, game, dt) {
  const ev = []
  D.t += dt
  if (D.ship?.alive) { D.x = D.ship.pos.x; D.y = D.ship.pos.y }   // 총구는 모성을 따라간다
  if (D.warping) {                       // 워프인 연출이 끝나기 전엔 안 쏜다
    if (D.t < CFG.DOOM_WARP) return ev
    D.warping = false; D.t = 0
  }
  // 부채꼴로 한 발씩. 황금각으로 돌려서 순서가 규칙적으로 안 보이게 한다.
  // 차례마다 시작 각을 조금씩 틀어 같은 자리만 훑지 않게 한다.
  // **마지막 한 발만은 지구를 겨눈다.** 나머지가 사방으로 흩어지는 난사라면
  // 이 한 발이 마침표다 — 판이 쓸려나가는 걸 보여 준 뒤 판돈을 가져간다.
  while (D.spawned < CFG.DOOM_BEAMS && D.t >= D.spawned * CFG.DOOM_GAP) {
    const last = D.spawned === CFG.DOOM_BEAMS - 1
    const a = last ? doomAimEarth(D, game.earth) : D.spawned * 2.399963 + D.volley * 0.37
    // dead = 머리가 멎었다 / gone = 꼬리까지 다 들어왔다. 요새의 광선과 같은 규칙이다.
    D.beams.push({ ux: Math.cos(a), uy: Math.sin(a), head: 0, back: 0, dead: false, gone: false })
    ev.push({ kind: 'beam', a })
    D.spawned++
  }
  for (const b of D.beams) {
    if (b.gone) continue
    // 머리가 이미 멎었으면 꼬리만 그 자리까지 밀려 들어온다(요새 광선과 같다)
    if (b.dead) {
      b.back = Math.min(b.head, b.back + CFG.LASER_SPEED * dt)
      if (b.back >= b.head) b.gone = true
      continue
    }
    const h0 = b.head
    b.head = Math.min(D.range, h0 + CFG.LASER_SPEED * dt)
    b.back = Math.max(0, b.head - CFG.LASER_BOLT)
    const hit = sweep(game, D.x + b.ux * h0, D.y + b.uy * h0,
      D.x + b.ux * b.head, D.y + b.uy * b.head, D.ship)
    if (hit) {
      b.dead = true
      b.head = Math.hypot(hit.x - D.x, hit.y - D.y)
      b.back = Math.min(b.back, b.head)
      ev.push({ kind: 'hit', body: hit.body, x: hit.x, y: hit.y })
    } else if (b.head >= D.range) b.dead = true
  }
  // ── 한 차례가 끝났다 ──
  // 지구가 아직 살아 있으면 **또 쏜다.** 끝은 시간이 아니라 지구가 정한다.
  // (행성이 대신 막아 준 만큼 더 사는 것 — 다만 결말은 정해져 있다.)
  if (D.spawned >= CFG.DOOM_BEAMS && D.beams.every(b => b.gone)) {
    if (!game.earth.alive || D.volley + 1 >= CFG.DOOM_MAX_VOLLEY) { D.done = true; return ev }
    if (D.t >= CFG.DOOM_BEAMS * CFG.DOOM_GAP + CFG.DOOM_VOLLEY) {
      D.volley++
      D.t = 0; D.spawned = 0; D.beams.length = 0
      ev.push({ kind: 'volley', n: D.volley })
    }
  }
  return ev
}
