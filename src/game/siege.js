import { CFG, hitRadiusOf } from './config.js'
import {
  buildBodyTrack, liveBodies, makeStepCache, segCircleEntry, segHitsCircle,
  stepBodies, stepMissile, trackFrame,
} from './physics.js'

// ─── 조르그 투석기 — 지구에 핵을 쏜다 ──────────────────────────
//
// 5스테이지부터 성계에 한 기 앉는다. 하는 일은 **하나뿐이다: 지구에 핵을
// 쏜다.** 원툴이다.
//
// 요새(광선)와 갈리는 자리가 여기다.
//   · 광선은 **선**이다. 총구에서 조준점까지 곧게 뻗고, 그 선에서 비켜서면
//     끝난다. 판 위의 다른 공은 그 판정에 안 낀다.
//   · 이쪽은 **탄**이다. 플레이어가 쏘는 그 탄과 같은 물건이라 중력에 휘고,
//     길에 걸린 아무 공에나 먼저 꽂힌다. 그래서 **막을 수 있다** —
//     궤적 위에 공 하나를 밀어 넣으면 거기서 터진다.
//
// 상태는 셋이다: 조용함 → **잠금**(궤적 예고가 판 위에 그려진다) → 비행.
//
// ① 잠금 — 각과 속도를 풀어 놓고 기다린다(CFG.SIEGE_LOCK_TIME). 이 구간이
//    곧 대응 시간이다. 대응은 넷이다:
//      · 잠금 중에 투석기를 끊는다 — 발사가 취소된다(요새 광선과 같은 규칙)
//      · 예고된 궤적 위로 공을 하나 민다 — 탄이 거기서 터진다
//      · 지구 추진기로 궤도를 비켜선다 — 저쪽 계산은 잠금 순간에 굳는다
//      · 한 대 맞고(체력 한 눈금) 다음을 준비한다
//
// ② 비행 — **유도가 아니다.** 쏘고 나면 중력이 알아서 하는 멍텅구리이고,
//    그게 이 게임의 조준 규칙 그대로다. 화면에서도 플레이어의 탄과 같은
//    아치를 그린다 — 색만 붉다(Scene.syncLines).
//
// ③ 기폭 — 지구에 닿으면 **체력 한 눈금**이다(game.siegeDetonate). 다른 공에
//    닿으면 내 핵과 한 글자도 다르지 않은 임펄스가 들어간다(applyNuke).
//
// ── 조르그의 계산은 정확하지 않다 ──
// 해를 푸는 시뮬레이션은 **거친 적분**이고(아래 COARSE/FINE), 잠금이 끝나는 그
// 순간의 판을 기준으로 한 번 풀어 그대로 들고 기다린다. 그래서 잠금 중에 판이 바뀌면
// (지구가 밀리거나 길목에 공이 들어오면) 저쪽 계산이 그만큼 틀어진다.
// 그게 이 물건의 대응 셋을 성립시키는 자리다.
//
// ※ 예전에 이놈은 **당구를 쳤다**(중립 행성을 골라 지구에 처박는다).
//   그 물건을 걷어낸 근거는 config.SIEGE_STAGE 주석에 적어 두었다.

export const SIEGE_IDLE = 'idle'
export const SIEGE_LOCK = 'lock'
export const SIEGE_FLY = 'fly'

// ── 해를 푸는 두 해상도 ─────────────────────────────────────────
// 훑는 자리가 마흔넷이라(속도 넷 × 각 열하나) 한 벌로 다 풀면 프레임 하나를
// 통째로 먹는다(계측: 중앙 110ms · 최대 171ms). 그래서 두 벌로 나눈다.
//   · 훑기(coarse) — 성긴 적분으로 **순위만** 매긴다. 여기서 필요한 답은
//     "어느 각·어느 속도가 제일 가까이 가는가" 하나다.
//   · 다듬기(fine) — 이긴 자리 둘레만 촘촘한 적분으로 다시 본다. 실제로 쏠
//     각이므로 여기서는 궤적도, 길에 걸리는 공도 정확해야 한다.
// 천체 박자는 두 벌이 **같다**(1/12초). 그래야 트랙 하나를 둘이 나눠 쓴다 —
// 트랙을 두 번 지으면 아낀 시간이 도로 나간다(buildBodyTrack이 O(n²)다).
// 훑기는 **지구 말고는 아무것도 안 본다**(collide=false). 길에 걸리는 공을
// 여기서까지 세면 스텝마다 천체 수만큼 스윕 판정이 붙는데, 훑기의 답은 순위
// 하나뿐이라 그 값을 살 이유가 없다. 막혔는지는 다듬기가 정확히 본다.
const FINE = { dt: 1 / 36, every: 3, steps: Math.round(CFG.SIEGE_TTL * 36), collide: true }
const COARSE = { dt: 1 / 12, every: 1, steps: Math.round(CFG.SIEGE_TTL * 12), collide: false }
// 잠금이 끝나는 순간까지 판을 미리 굴리는 해상도. **아주 성기게** 잡는다 —
// 여기서 필요한 것은 62초 뒤의 천체 자리뿐이고, 궤도 속도가 20 GU/s대라
// 1/8초 눈금에서도 오차가 판정 원의 몇십 분의 일이다. 이 한 줄이 O(n²)를
// 1240번 도느냐 496번 도느냐를 가른다.
const LEAD_DT = 1 / 8
// 최근접을 이만큼 지나 멀어졌으면 그 각은 끝난 것으로 친다(fly의 조기 종료).
// 지구 판정 원(48.6)의 열 배 남짓 — 되돌아와 다시 가까워지는 궤적은 34초
// 안에서는 나오지 않는다.
const RECEDE = 500

// 총구 — 제 판정 원 밖에서 쏜다. 안에서 쏘면 첫 스텝에 제 몸에 꽂힌다
// (플레이어가 지구에서 LAUNCH_OFFSET만큼 떨어져 쏘는 것과 같은 이유다).
export function muzzle(from, ang) {
  const d = hitRadiusOf(from) + 26
  return { x: from.pos.x + Math.cos(ang) * d, y: from.pos.y + Math.sin(ang) * d }
}

// 이 탄이 저 공에 걸리는가. **조르그 것은 안 친다** — 저쪽이 제 요새에 핵을
// 박는 그림은 아무리 굴러가도 설명이 안 된다. 해를 푸는 쪽과 실제로 나는
// 탄이 반드시 같은 함수를 봐야 한다: 갈라 두면 저쪽이 "막힌다"고 판단한 길로
// 탄이 그냥 지나가거나 그 반대가 된다.
export const blocks = (b, from) =>
  b.alive && b !== from && !b.zorg && !b.mothership && !(b.warpIn > 0)

// ── 한 각을 실제로 굴려 본다 ────────────────────────────────────
// 반환: { miss, hitEarth, blocked, pts } — 지구 중심까지의 최근접 거리와,
// 실제로 지구에 꽂혔는지, 도중에 다른 공에 막혔는지, 그리고 그 궤적.
// 궤적은 잠금 중에 화면에 그대로 예고선으로 그린다(Scene.syncLines) —
// 저쪽이 계산한 길과 화면에 뜨는 선이 같은 물건이어야 예고가 거짓말이 아니다.
function fly(track, beltR, from, earth, ang, speed, res) {
  const sim = track.view
  trackFrame(track, 0)
  const p = muzzle(from, ang)
  const m = {
    pos: { ...p }, prev: { ...p }, vel: { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
    age: 0, pathN: 0, path: null, minSunDist: Infinity,
  }
  const pts = [{ ...p }]
  const beltR2 = beltR * beltR
  const rIn2 = (CFG.R_STAR + 8) * (CFG.R_STAR + 8)
  // 탄은 점이다 — 지구의 판정 원 안에 들어오면 꽂힌 것이다(game.contact와 같다).
  const need = hitRadiusOf(earth)
  let miss = Infinity, f = 0
  const { dt, every, steps, collide } = res
  const mark = Math.max(1, Math.round(0.19 / dt))   // 궤적 점 간격(초) — 해상도와 무관하게 같다
  for (let i = 0; i < steps; i++) {
    if (i % every === (every >> 1)) trackFrame(track, ++f)
    stepMissile(m, sim, dt)
    if (i % mark === 0) pts.push({ x: m.pos.x, y: m.pos.y })
    const d = Math.hypot(m.pos.x - earth.pos.x, m.pos.y - earth.pos.y)
    miss = Math.min(miss, d)
    // 최근접을 한참 지나 멀어지는 중이면 그만 굴린다. 이 각의 점수는 이미
    // 정해졌고(miss), 남은 스텝은 전부 헛돈다 — 훑는 자리가 마흔넷이라
    // 이 한 줄이 곧 풀이 시간의 절반이다(계측: 73ms → 40ms).
    if (d > miss + RECEDE) break
    if (collide) {
      for (const o of sim) {
        if (!blocks(o, from)) continue
        const r = hitRadiusOf(o)
        if (!segHitsCircle(m.prev.x, m.prev.y, m.pos.x, m.pos.y, o.pos.x, o.pos.y, r)) continue
        const q = segCircleEntry(m.prev.x, m.prev.y, m.pos.x, m.pos.y, o.pos.x, o.pos.y, r)
        pts.push(q)
        return { miss: o.isEarth ? 0 : miss, hitEarth: !!o.isEarth, blocked: !o.isEarth, pts }
      }
    } else if (d < need) {
      // 훑기는 지구만 본다 — 판정 원 안에 들어온 순간이 곧 명중이다.
      return { miss: 0, hitEarth: true, blocked: false, pts }
    }
    const r2 = m.pos.x * m.pos.x + m.pos.y * m.pos.y
    if (r2 < rIn2 || r2 >= beltR2) break     // 태양에 삼켜졌다 / 벨트에서 터진다
  }
  return { miss, hitEarth: miss < need, blocked: false, pts }
}

// ── 각을 고른다 ─────────────────────────────────────────────────
// 지구를 향하는 각 둘레를 부채로 훑고, 제일 가까이 가는 각을 고른 뒤 그 옆을
// 한 번 더 좁게 훑는다. 정확히 지구를 향해 쏘는 것이 정답이 아니기 때문이다:
// 탄은 중력에 휘고, 지구는 그동안 공전한다. 식을 푸는 대신 굴려 보는 이유는
// 싸고 **틀릴 수 없기** 때문이다(플레이어의 접촉각 탐색과 같은 방법이다).
//
// **미래에서** 훑는다. 각은 지금 자리가 아니라 잠금이 끝나는 그 순간의 자리에서
// 정해진다 — 지금 자리에서 풀면 62초 뒤에 그 각은 엉뚱한 하늘을 가리킨다.
//
// 📐 계측: 훑기 44 + 다듬기 9 = 53번 굴린다. 이 함수가 도는 프레임은
// **중앙 43ms · 최대 88ms**(8시드 48회)이고, 주기가 200초에 한 번이라 화면에서는
// 안 보인다(판 전환의 자리 찾기도 같은 급의 비용이다 — system.placeFort 주석).
export function solveShot(game, from) {
  // ① 잠금이 끝나는 순간의 판을 만든다.
  const future = liveBodies(game.bodies)
  const cache = makeStepCache()
  const n = Math.round(CFG.SIEGE_LOCK_TIME / LEAD_DT)
  for (let i = 0; i < n; i++) stepBodies(future, LEAD_DT, cache)
  const src = future.find(b => b.id === from.id)
  const earth = future.find(b => b.isEarth)
  if (!src || !earth || !earth.alive) return null
  // ② 그 상태에서 천체 궤적을 한 번만 굴려 기록한다 — 각마다 재생한다.
  const track = buildBodyTrack(future, FINE.dt, FINE.every, FINE.steps)
  const trackEarth = track.view.find(b => b.isEarth)
  const base = Math.atan2(earth.pos.y - src.pos.y, earth.pos.x - src.pos.x)

  const half = CFG.SIEGE_ARC, N = CFG.SIEGE_ARC_N
  const step = 2 * half / (N - 1)
  const [sLo, sHi] = CFG.SIEGE_SPEED, sN = CFG.SIEGE_SPEED_N
  // 막힌 길은 뒤로 민다 — 닿기는 하지만 지구가 아닌 데서 끝나는 각이다.
  const scoreOf = (r) => r.miss + (r.blocked ? 4000 : 0)

  // ── ① 훑기: 속도 넷 × 각 열다섯 ──
  // 속도가 곧 비행 시간이고, 비행 시간이 곧 "지구가 그때 어디 있나"다.
  // 그래서 이 둘은 따로 못 푼다 — 각만 훑으면 못 맞히는 판이 3분의 2다
  // (계측: 속도를 44로 못 박으면 명중해가 33%, 넷을 훑으면 67%).
  let bestAng = base, bestSpeed = sLo, bestScore = Infinity
  for (let k = 0; k < sN; k++) {
    const speed = sN > 1 ? sLo + (sHi - sLo) * k / (sN - 1) : sLo
    for (let i = 0; i < N; i++) {
      const ang = base - half + step * i
      const sc = scoreOf(fly(track, game.beltR, src, trackEarth, ang, speed, COARSE))
      if (sc < bestScore) { bestScore = sc; bestAng = ang; bestSpeed = speed }
    }
  }
  // ── ② 다듬기: 이긴 자리의 좌우 한 칸을 여덟으로 쪼갠다 ──
  // 지구의 판정 원이 600 GU 거리에서 4.6°를 덮으므로 성긴 훑기(7.4°)만으로는
  // 스치는 각이 남는다. 여기서부터는 촘촘한 적분이다 — 실제로 쏠 각이므로
  // 궤적도(화면에 그린다) 길에 걸리는 공도 여기서 정해진다.
  let best = null
  const test = (ang) => {
    const r = fly(track, game.beltR, src, trackEarth, ang, bestSpeed, FINE)
    const score = scoreOf(r)
    if (!best || score < best.score) best = { ...r, score, ang }
  }
  test(bestAng)
  for (let i = 1; i <= 4; i++) {
    test(bestAng - step * i / 5)
    test(bestAng + step * i / 5)
  }
  return { ang: best.ang, speed: bestSpeed, hits: best.hitEarth, blocked: best.blocked, path: best.pts }
}

// from = 이 포를 실은 투석기. 그놈이 죽으면 같이 없어진다(game.syncSieges).
export function makeSiegeGun(rng, from, nextAt = CFG.SIEGE_FIRST) {
  return {
    state: SIEGE_IDLE,
    t: 0,
    nextAt,
    from,
    ang: 0,               // 풀어 둔 발사각
    speed: CFG.SIEGE_SPEED[0],
    hits: false,          // 이 해가 실제로 지구에 꽂히는가 (화면이 경고를 가른다)
    path: null,           // 예고 궤적 — 잠금 중에 판 위에 그려진다
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
    const sol = solveShot(game, src)
    if (!sol) {                              // 지구가 없다 — 이 판은 이미 끝났다
      S.t = 0; S.nextAt = CFG.SIEGE_PERIOD * 0.35
      return null
    }
    S.state = SIEGE_LOCK; S.t = 0
    S.ang = sol.ang; S.speed = sol.speed; S.hits = sol.hits; S.path = sol.path
    return { kind: 'lock', src, hits: S.hits }
  }

  if (S.state === SIEGE_LOCK) {
    if (S.t < CFG.SIEGE_LOCK_TIME) return null
    S.state = SIEGE_FLY; S.t = 0; S.path = null
    return { kind: 'fire', src, ang: S.ang, speed: S.speed }
  }

  // 비행 중 — 탄 자체는 game이 굴린다(stepSiegeShot). 여기서는 다음 주기만 센다.
  if (S.state === SIEGE_FLY) {
    if (S.t < CFG.SIEGE_PERIOD) return null
    S.state = SIEGE_IDLE; S.t = 0; S.nextAt = 0
    return null
  }
  return null
}

// 발사가 취소됐다 — 잠금 중에 투석기가 부서졌을 때 game이 부른다.
export function abortSiegeGun(S) {
  if (S.state !== SIEGE_LOCK) return false
  S.state = SIEGE_IDLE; S.t = 0; S.nextAt = CFG.SIEGE_PERIOD; S.path = null
  return true
}

// ─── 탄 ─────────────────────────────────────────────────────────
// **플레이어의 탄과 같은 물건이다.** 같은 적분기(stepMissile)로 날고, 같은
// 궤적 배열을 들고 다니고, 같은 스윕 판정으로 꽂힌다. 다른 것은 셋뿐이다:
// 색(Scene), 지구에 꽂히면 체력을 깎는다는 것(game.siegeDetonate), 그리고
// **내 발사 차례를 안 막는다**는 것(배열이 갈려 있다 — game.foeShots).
export function makeSiegeShot(S) {
  const src = S.from
  const p = muzzle(src, S.ang)
  return {
    pos: { ...p }, prev: { ...p },
    vel: { x: Math.cos(S.ang) * S.speed, y: Math.sin(S.ang) * S.speed },
    yld: CFG.SIEGE_YIELD, alive: true, age: 0, fade: 0,
    path: [{ ...p }], pathN: 0, minSunDist: Infinity, from: src,
  }
}

// 한 스텝. 중력을 받으므로 플레이어의 탄과 같은 함수를 쓴다.
// 닿는 첫 천체에서 결판난다 — 판정도 같은 스윕이다(game.contact).
export function stepSiegeShot(m, game, dt) {
  stepMissile(m, game.bodies, dt)

  let best = null, bestD = Infinity
  for (const b of game.bodies) {
    if (!blocks(b, m.from)) continue
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
