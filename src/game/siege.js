import { CFG, contactDist, hitRadiusOf } from './config.js'
import { cloneBodies, segCircleEntry, segHitsCircle, stepBodies } from './physics.js'
import { propagate } from './laser.js'
import { effDv } from './roles.js'

// ─── 조르그 투석기 — 저쪽도 당구를 친다 ──────────────────
//
// 5스테이지부터 성계에 한 기 앉는다. 하는 일은 요새(광선)와도
// 다르다: **핵미사일로 중립 행성을 골라 지구에 처박는다.** 플레이어가 판
// 내내 해 온 그 수를 그대로 되돌려 주는 물건이다.
//
// 상태는 넷이다: 조용함 → **잠금**(조준선이 보인다) → **비행** → 기폭.
//
// ① 잠금 — 큐볼 하나를 고르고 그 공의 어느 살을 칠지까지 정한다. 조준선이
//    투석기에서 그 살까지 그려지고, 밀려갈 방향도 같이 보인다(화면 쪽 일).
//    이 구간이 곧 **대응 시간**이다(CFG.SIEGE_LOCK_TIME). 대응은 넷 다 이미 배운 수다:
//      · 큐볼을 먼저 쳐서 치워 놓는다 — 조준이 통째로 무의미해진다
//      · 잠금 중에 투석기를 끊는다 — 발사가 취소된다(요새 광선과 같은 규칙)
//      · 밀려 오는 공을 되친다 — 궤도를 틀면 지구를 스쳐 지나간다
//      · 지구 추진기로 비켜선다 — 회랑이 아니라 궤도를 피하는 것이라 더 쉽다
//
// ② 비행 — **유도탄이다.** 플레이어의 탄두는 쏘고 나면 중력이 알아서 하는
//    멍텅구리인데(그게 이 게임의 조준이다) 이쪽은 목표를 물고 직진한다.
//    그래서 화면에서 곧은 붉은 줄로 플레이어의 흰 아치와 갈린다.
//    다만 유도는 **발사 순간까지만** 한다: 리드를 계산해 쏘고 나면 그 방향
//    그대로 날아간다. 그래서 발사 뒤에 큐볼을 밀어 놓으면 탄이 빗나간다.
//
// ③ 기폭 — 닿은 첫 천체에 플레이어의 핵과 **같은 규칙**으로 임펄스가 들어간다
//    (applyNuke: 방향은 폭심 → 중심, 크기는 작약/질량). 규칙을 갈라 두면
//    "저쪽 핵은 다르다"가 되어 지금까지 배운 조준 감각이 전부 거짓말이 된다.
//
// ── 조르그의 계산은 정확하지 않다 ──
// 표적을 푸는 시뮬레이션은 **태양·지구·큐볼 셋만** 굴린다(solveCarom).
// 요새의 조준이 지구의 원래 궤도만 보는 것과 같은 이유다(laser.solveAim):
// 저쪽 계산에 성계 전체의 섭동까지 넣어 주면 플레이어가 손댈 구석이 없다.
// 그리고 그게 실제로 저쪽 실수가 된다 — 중간에 낀 목성이 큐볼을 채 가면
// 조르그의 완벽한 한 수가 그냥 빗나간다.

export const SIEGE_IDLE = 'idle'
export const SIEGE_LOCK = 'lock'
export const SIEGE_FLY = 'fly'

// 큐볼 자격 — **밀리는 공이어야** 이 수가 성립한다. 요새가 옆자리를 고를 때
// 쓰는 것과 같은 문턱을 쓴다(CFG.FORT_CUE_MIN_DV): 목성·토성처럼 무거운
// 공은 6Mt로는 꿈쩍도 안 하므로 골라도 헛수다.
// 조르그가 제 편(요새·다른 투석기)을 치지는 않는다 — 그건 당구가
// 아니라 자해다. 파편은 공이 아니고, 모성은 아무것도 안 통한다.
//
// 가스(유폭)와 불안정(파열)도 뺀다. 밀리는 대신 **다른 일**을 하는 공이라,
// 이 함수의 답을 받아 "밀면 지구에 닿는다"를 푸는 시뮬레이션(trial)이 그
// 순간 거짓이 된다 — 가스는 반경 안을 통째로 밀어내고 불안정은 일곱 갈래로
// 쪼개진다. 조르그의 계산이 거친 것은 상관없지만(태양·지구·큐볼만 굴린다)
// **애초에 다른 사건이 일어나는 공**을 고르는 것은 거친 게 아니라 틀린 것이다.
function candidates(game, from) {
  const e = game.earth
  const out = []
  for (const b of game.bodies) {
    if (!b.alive || b === from || b.isEarth) continue
    if (b.zorg || b.role === 'battery' || b.role === 'siege') continue
    if (b.type === 'debris' || b.mothership) continue
    if (b.role === 'volatile' || b.role === 'unstable') continue
    if ((b.warpIn ?? 0) > 0) continue
    if (effDv(b, CFG.SIEGE_YIELD) < CFG.FORT_CUE_MIN_DV) continue
    // 지구에서 너무 먼 공은 지평(150초) 안에 못 온다. 굴려 보기 전에 걸러
    // 두면 시뮬레이션을 그만큼 덜 돈다 — 이 함수는 판이 굴러가는 중에 돈다.
    const d = Math.hypot(b.pos.x - e.pos.x, b.pos.y - e.pos.y)
    if (d > game.aMax * 1.25) continue
    out.push({ b, d })
  }
  // 가까운 공부터 본다. 가까우면 도착이 빠르고, 빠르면 플레이어가 되칠 시간이
  // 짧다 — 조르그가 굳이 먼 공을 고를 이유가 없다.
  out.sort((p, q) => p.d - q.d)
  return out
}

// 천체 하나를 태양 중력만으로 seconds초 뒤까지 굴려 **그 상태의 사본**을 준다.
// laser.propagate와 같은 적분기·같은 간격인데 위치만 돌려주는 그쪽과 달리
// 여기서는 속도까지 필요하다(굴린 자리에서 다시 밀어 봐야 하므로).
function advance(body, seconds) {
  const sim = cloneBodies([body])
  const dt = 1 / 40, n = Math.round(Math.max(0, seconds) / dt)
  for (let i = 0; i < n; i++) stepBodies(sim, dt)
  return sim[0]
}

// 잠금이 끝나고 탄이 날아가 꽂히기까지 걸리는 시간(인게임 초).
// **여기가 이 물건의 계산 기준점이다.** 조르그는 "지금 밀면 어떻게 되는가"를
// 묻지 않는다 — 그 답은 62초 뒤에는 남아 있지 않다. 잠금 62초 + 탄의 비행
// 시간을 더한 **그 순간**을 기준으로 풀고, 그 답을 그대로 들고 기다린다.
// ("계산은 끝났다"는 저쪽 대사가 실제로 이 함수를 가리킨다.)
const leadTime = (from, cue) =>
  CFG.SIEGE_LOCK_TIME + Math.hypot(cue.pos.x - from.pos.x, cue.pos.y - from.pos.y) / CFG.SIEGE_SPEED

// ── 한 수를 실제로 굴려 본다 ────────────────────────────────────
// 큐볼을 ang 방향으로 Δv만큼 밀었을 때 지구에 얼마나 가까이 오는가.
// 굴리는 것은 **태양·지구·큐볼 셋뿐**이다(위 주석). 지구도 같이 굴려야
// 한다 — 지구는 공전하므로 "지금 지구가 있는 곳"으로 미는 것은 답이 아니다.
//
// 반환: 최소 접근거리(GU). 접촉거리 아래면 그 수는 실제로 처박힌다.
function trial(cue, earth, ang, dv, horizon) {
  const sim = cloneBodies([cue, earth])
  const c = sim[0], e = sim[1]
  c.vel.x += Math.cos(ang) * dv
  c.vel.y += Math.sin(ang) * dv
  // dt 1/20 — 조르그의 계산은 거칠다. 요새의 조준(1/40)보다도 성긴데,
  // 여기서 재는 것은 "닿나 안 닿나"이고 판정 반경이 50 GU를 넘으므로
  // 이 해상도로 답이 뒤집히지 않는다(궤도 속도 20 GU/s × 1/20 = 1 GU).
  const dt = 1 / 20, n = Math.round(horizon / dt)
  const need = contactDist(cue, earth)
  let best = Infinity
  for (let i = 0; i < n; i++) {
    stepBodies(sim, dt)
    const d = Math.hypot(c.pos.x - e.pos.x, c.pos.y - e.pos.y)
    if (d < best) best = d
    if (d < need) return d          // 처박혔다 — 더 굴려 볼 이유가 없다
    // 태양에 빠졌거나 판 밖으로 나갔으면 그 수는 끝난 것이다
    if (Math.hypot(c.pos.x, c.pos.y) < CFG.R_STAR) break
  }
  return best
}

// ── 표적과 방향을 고른다 ────────────────────────────────────────
// 후보 공마다 **지구를 향하는 각 둘레를 부채로 훑는다.** 정확히 지구를 향해
// 미는 것이 정답이 아니기 때문이다: 지구는 공전하므로 앞을 재서 밀어야 하고,
// 그 리드는 거리·질량·궤도에 따라 다르다. 식을 푸는 대신 각을 훑어 직접
// 굴려 보는 이유는 싸고 **틀릴 수 없기** 때문이다.
//
// 그리고 **미래에서** 훑는다. 각과 표적은 지금 자리가 아니라 잠금이 끝나
// 탄이 꽂히는 그 순간의 자리에서 정해진다(leadTime) — 지금 자리에서 풀면
// 62초 뒤에 그 각은 엉뚱한 하늘을 가리킨다(계측: 그렇게 푼 판에서 밀린 공이
// 지구에 닿은 경우가 6시드 중 1건이었다).
//
// 계측 주의: 후보 셋 × 각 아홉 = 스물일곱 번 굴린다. 한 번이 3000스텝 ×
// 천체 둘이고, 그 앞에 후보마다 미래로 한 번씩 굴린다(2700스텝 × 1체).
// 이 함수가 도는 프레임은 **중앙 17ms · 최대 64ms**다(10시드 계측, 36회).
// 프레임 하나를 그만큼 붙잡는 셈인데 이 주기는 200초에 한 번이라 화면에서는
// 안 보인다(판 전환의 자리 찾기도 같은 급의 비용이다 — system.placeFort 주석).
// 후보를 셋으로 자르는 것이 그 예산의 전부라 여기를 늘리려면 다시 재야 한다.
export function solveCarom(game, from) {
  const pool = candidates(game, from).slice(0, 3)
  let best = null
  for (const { b } of pool) {
    const dv = effDv(b, CFG.SIEGE_YIELD)
    // 이 공을 치기로 하면 실제로 밀리는 시각 — 거기까지 둘을 굴려 놓고 푼다.
    const lead = leadTime(from, b)
    const cueF = advance(b, lead)
    const earthF = advance(game.earth, lead)
    // 그 순간 지구를 향하는 각. 여기서 ±SIEGE_ARC를 훑는다.
    const base = Math.atan2(earthF.pos.y - cueF.pos.y, earthF.pos.x - cueF.pos.x)
    for (let i = 0; i < CFG.SIEGE_ARC_N; i++) {
      const u = CFG.SIEGE_ARC_N > 1 ? (i / (CFG.SIEGE_ARC_N - 1)) * 2 - 1 : 0
      const ang = base + u * CFG.SIEGE_ARC
      const miss = trial(cueF, earthF, ang, dv, CFG.SIEGE_SOLVE_HORIZON)
      if (best && miss >= best.miss) continue
      best = { cue: b, ang, miss, hits: miss < contactDist(b, game.earth) }
    }
  }
  // 처박히는 수가 없으면 **가장 가까이 가는 수**를 그대로 쏜다. 조르그가
  // 한 판을 그냥 쉬는 것보다 낫다: 지구 근처로 굴러온 공은 그 자체로 판을
  // 흔들고(폭풍·2차 충돌), 무엇보다 이 물건이 무엇을 하는 놈인지가 보인다.
  return best
}

// 폭심 자리 — 큐볼의 **밀 방향 반대쪽 살**이다. 임펄스 방향은 폭심 → 중심
// 하나로 정해지므로(applyNuke), 저쪽도 우리와 똑같이 "어느 살을 치는가"만
// 고르면 된다. 0.86은 판정 원 안쪽으로 조금 들어간 자리 — 겉면 정확히
// 위에 두면 스치는 궤적에서 판정을 놓친다.
// at = 그 공이 있을 자리(기본은 지금 자리). 탄의 리드를 풀 때는 미래 자리를 준다.
export function caromPoint(cue, ang, at = cue.pos) {
  const r = hitRadiusOf(cue) * 0.86
  return { x: at.x - Math.cos(ang) * r, y: at.y - Math.sin(ang) * r }
}

// from = 이 포를 실은 투석기. 그놈이 죽으면 같이 없어진다(game.syncSieges).
export function makeSiegeGun(rng, from, nextAt = CFG.SIEGE_FIRST) {
  return {
    state: SIEGE_IDLE,
    t: 0,
    nextAt,
    from,
    cue: null,            // 고른 큐볼
    ang: 0,               // 밀 방향 (조르그가 정한 각)
    ax: 0, ay: 0,         // 폭심 — 큐볼의 어느 살인가
    hits: false,          // 이 수가 실제로 처박히는가 (화면이 경고를 가른다)
    refresh: 0,
    rng,
  }
}

// game이 매 스텝 호출한다. 결과는 game이 처리하도록 이벤트로 돌려준다.
export function stepSiegeGun(S, game, dt) {
  if (game.won || game.lost) return null
  const src = S.from
  if (!src || !src.alive) return null       // 죽은 포는 game이 명단에서 걷어낸다
  S.t += dt

  if (S.state === SIEGE_IDLE) {
    if (S.t < S.nextAt) return null
    const sol = solveCarom(game, src)
    if (!sol) {                              // 굴릴 공이 하나도 없다 — 조금 뒤에 다시 본다
      S.t = 0; S.nextAt = CFG.SIEGE_PERIOD * 0.35
      return null
    }
    S.state = SIEGE_LOCK; S.t = 0; S.refresh = 0
    S.cue = sol.cue; S.ang = sol.ang; S.hits = sol.hits
    const p = caromPoint(S.cue, S.ang)
    S.ax = p.x; S.ay = p.y
    return { kind: 'lock', src, cue: S.cue, hits: S.hits }
  }

  if (S.state === SIEGE_LOCK) {
    // 큐볼이 없어졌다(플레이어가 치웠거나 부서졌다) — 조준이 통째로 무의미해진다.
    // **이게 이 물건의 첫째 대응이다.** 다시 고르는 데 온전한 주기를 쓴다.
    if (!S.cue.alive) {
      S.state = SIEGE_IDLE; S.t = 0; S.nextAt = CFG.SIEGE_PERIOD
      return { kind: 'lost', src }
    }
    S.refresh += dt
    if (S.refresh >= CFG.SIEGE_AIM_REFRESH) {
      S.refresh = 0
      // 큐볼은 계속 공전한다 — 폭심은 매번 지금 자리에서 다시 잡는다.
      // 각(ang)은 잠금 순간에 정해진 그대로 둔다: 그게 "조준이 고정된다"이고,
      // 플레이어가 큐볼을 밀면 그만큼 저쪽 계산이 틀어지는 자리다.
      const p = caromPoint(S.cue, S.ang)
      S.ax = p.x; S.ay = p.y
    }
    if (S.t < CFG.SIEGE_LOCK_TIME) return null
    S.state = SIEGE_FLY; S.t = 0
    return { kind: 'fire', src, cue: S.cue, ang: S.ang, ax: S.ax, ay: S.ay }
  }

  // 비행 중 — 탄 자체는 game이 굴린다(stepSiegeShot). 여기서는 다음 주기만 센다.
  if (S.state === SIEGE_FLY) {
    if (S.t < CFG.SIEGE_PERIOD) return null
    S.state = SIEGE_IDLE; S.t = 0; S.nextAt = 0; S.cue = null
    return null
  }
  return null
}

// 발사가 취소됐다 — 잠금 중에 투석기가 부서졌을 때 game이 부른다.
export function abortSiegeGun(S) {
  if (S.state !== SIEGE_LOCK) return false
  S.state = SIEGE_IDLE; S.t = 0; S.nextAt = CFG.SIEGE_PERIOD; S.cue = null
  return true
}

// ─── 탄 ─────────────────────────────────────────────────────────
// 유도는 **발사 순간까지만** 한다. 큐볼이 어디로 갈지 재서 그 앞을 겨눈 뒤
// (리드), 그 방향 그대로 직진한다. 모성의 마지막 한 발이 지구의 이동을 미리
// 당기는 것과 같은 되풀기다(laser.doomAimEarth).
//
// **리드는 속도로 외삽하지 않는다.** 큐볼은 궤도를 도는 물건이라 직선으로
// 늘려 잡으면 굽은 만큼 빗나간다: 비행 10초에 곡률 오차가 ½·a·t² ≈ 30 GU인데
// 소행성의 판정 원이 23.4 GU다(계측: 여섯 시드에서 발사 18발 중 8발만
// 제 표적에 꽂혔다). 그래서 실제 적분기로 굴려서 만나는 자리를 찾는다.
export function makeSiegeShot(S) {
  const src = S.from, cue = S.cue
  const ox = src.pos.x, oy = src.pos.y
  let px = S.ax, py = S.ay
  for (let i = 0; i < 3; i++) {
    const t = Math.hypot(px - ox, py - oy) / CFG.SIEGE_SPEED
    const at = propagate(cue, t)
    const p = caromPoint(cue, S.ang, at)
    px = p.x; py = p.y
  }
  const a = Math.atan2(py - oy, px - ox)
  return {
    pos: { x: ox, y: oy }, prev: { x: ox, y: oy },
    vel: { x: Math.cos(a) * CFG.SIEGE_SPEED, y: Math.sin(a) * CFG.SIEGE_SPEED },
    yld: CFG.SIEGE_YIELD, alive: true, age: 0, fade: 0,
    // 궤적은 플레이어 탄과 같은 모양으로 들고 다닌다(렌더가 같은 리본을 쓴다).
    // 다만 색이 다르다 — 저쪽 탄은 붉다(Scene.syncLines).
    path: [{ x: ox, y: oy }], from: src, cue,
  }
}

// 한 스텝. 중력을 안 받으므로 적분이 아니라 그냥 직선이다.
// 닿는 첫 천체에서 결판난다 — 판정은 플레이어 탄과 같은 스윕이다.
export function stepSiegeShot(m, game, dt) {
  m.prev.x = m.pos.x; m.prev.y = m.pos.y
  m.pos.x += m.vel.x * dt
  m.pos.y += m.vel.y * dt
  m.age += dt
  // 궤적 — 직선이라 점을 촘촘히 찍을 이유가 없다. 24 GU마다 한 점이면
  // 리본이 매끈하고(직선이므로) 배열은 몇십 개로 끝난다.
  const last = m.path[m.path.length - 1]
  if (Math.hypot(m.pos.x - last.x, m.pos.y - last.y) > 24) m.path.push({ x: m.pos.x, y: m.pos.y })

  let best = null, bestD = Infinity
  for (const b of game.bodies) {
    if (!b.alive || b === m.from || (b.warpIn ?? 0) > 0) continue
    // 저쪽 탄은 **저쪽 것을 안 친다.** 조르그가 제 요새에 핵을 박는 그림은
    // 아무리 굴러가도 설명이 안 된다.
    if (b !== m.cue && (b.zorg || b.mothership)) continue
    // ── 그리고 **지구도 안 친다.** ──
    // 이건 편의가 아니라 이 물건의 정의다. 조르그가 하는 일은 "지구에 핵을
    // 쏘는 것"이 아니라 "행성을 지구에 처박는 것"이고(핵은 원래 행성을 못
    // 부순다 — 이 게임의 전제), 그래서 이 탄은 배정된 그 공에만 무장돼 있다.
    //
    // 규칙으로 못 박은 이유가 하나 더 있다. 투석기 대역은 지구 궤도
    // 언저리라 탄의 직선 경로에 지구가 걸리는 일이 흔한데, 9Mt가 지구에
    // 직격하면 Δv 15.6이다 — 지구 궤도 속도(21)의 74%다. 계측에서 그 한 방이
    // 근일점을 태양까지 끌어내려 400초 뒤에 판이 끝났고, 화면에는 그 인과가
    // 아무 데도 안 남았다. **원인이 안 보이는 패배는 난이도가 아니다.**
    // (폭풍은 여전히 지구에 닿는다 — 그쪽은 0.3배로 눌린 값이라 경고 한 줄로
    //  읽히고 되돌릴 수 있다. siegeDetonate의 blastWave 참고.)
    if (b.isEarth) continue
    const r = hitRadiusOf(b)
    if (!segHitsCircle(m.prev.x, m.prev.y, m.pos.x, m.pos.y, b.pos.x, b.pos.y, r)) continue
    const p = segCircleEntry(m.prev.x, m.prev.y, m.pos.x, m.pos.y, b.pos.x, b.pos.y, r)
    const d = Math.hypot(p.x - m.prev.x, p.y - m.prev.y)
    if (d < bestD) { bestD = d; best = { b, p } }
  }
  if (best) return { kind: 'hit', body: best.b, point: best.p }
  // 태양에 삼켜졌다 / 판 밖으로 나갔다 / 수명이 끝났다 — 셋 다 그냥 사라진다.
  const r2 = m.pos.x * m.pos.x + m.pos.y * m.pos.y
  if (r2 < CFG.R_STAR * CFG.R_STAR) return { kind: 'sun' }
  if (r2 > game.beltR * game.beltR) return { kind: 'out' }
  if (m.age >= CFG.SIEGE_TTL) return { kind: 'expire' }
  return null
}

// 잠금 중 남은 시간 (HUD 경고용) — 요새 광선의 chargeLeft와 같은 자리다.
export const siegeLeft = (S) => S.state === SIEGE_LOCK ? Math.max(0, CFG.SIEGE_LOCK_TIME - S.t) : 0
