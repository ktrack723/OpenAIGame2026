import { Rng } from '../core/random.js'
import { CFG, aMaxOf, contactDist, hitRadiusOf, radiusOf } from './config.js'
import { rolePool } from './roles.js'
import { cloneBodies, stepBodies } from './physics.js'
import { makeGoal, pickGoalSpec } from './objectives.js'

const NAMES = ['Vesta', 'Bront', 'Mir', 'Kappa', 'Oort', 'Faro', 'Nix', 'Teph', 'Ruun', 'Golda']

// §7.2 안테별 파라미터 테이블
export function anteParams(A) {
  return {
    N: Math.min(8, 3 + Math.floor((A + 1) / 2)),
    muHi: 250 + 60 * A,
    Khi: 9 - 0.5 * A,
    sigmaE: 0.02 + 0.012 * A,
    aMax: aMaxOf(A),
  }
}

// STEP 4 — 바이옴 배정 (정규화 반경 존별 확률)
const zoneTable = (x) =>
  x < 0.30 ? [['lava', 55], ['rock', 30], ['toxic', 15]]
  : x < 0.62 ? [['rock', 30], ['ocean', 30], ['toxic', 20], ['lava', 10], ['life', 10]]
  : [['ice', 45], ['gas', 35], ['rock', 15], ['ocean', 5]]
function pickW(rng, table) {
  let u = rng.range(0, 100)
  for (const [t, w] of table) if ((u -= w) <= 0) return t
  return table[0][0]
}
const rayleigh = (rng, s) => Math.min(0.25, s * Math.sqrt(-2 * Math.log(1 - rng.next() + 1e-9)))

// STEP 2 — 상호 힐 반경 간격의 닫힌 해 + 오버플로 해소 (최대 2회)
function placeOrbits(rng, mus, K, aMax) {
  const n = mus.length, axes = new Array(n)
  const build = () => {
    axes[0] = CFG.A_MIN * rng.range(1.0, 1.1)
    for (let i = 0; i < n - 1; i++) {
      const h = Math.cbrt((mus[i] + mus[i + 1]) / (3 * CFG.MU_STAR)), f = K[i] * h / 2
      axes[i + 1] = axes[i] * (1 + f) / (1 - f)
    }
  }
  build()
  // 오버플로 해소 — 연쇄 충돌 목표는 공을 많이 깔아야 해서 6회까지 조인다.
  // 간격 하한도 3.0 힐 반경까지 내렸다: 궤도가 붙을수록 밀어서 만나게 하기 쉽다.
  for (let g = 0; g < 6 && axes[n - 1] > aMax; g++) {
    const kMean = K.reduce((s, k) => s + k, 0) / K.length
    if (kMean > Math.min(...K) + 0.3) for (let i = 0; i < K.length; i++) K[i] = Math.max(3.4, K[i] * 0.9)
    else for (let i = 0; i < n; i++) mus[i] *= 0.85
    build()
  }
  return axes[n - 1] <= aMax ? axes : null
}

// STEP 3 — 궤도 요소 → 상태 벡터 (교과서 공식, 협상 불가)
function elementsToState(a, e, w, nu) {
  const r = a * (1 - e * e) / (1 + e * Math.cos(nu))
  const h = Math.sqrt(CFG.MU_STAR * a * (1 - e * e))
  const phi = w + nu, cp = Math.cos(phi), sp = Math.sin(phi)
  const vr = CFG.MU_STAR / h * e * Math.sin(nu), vt = CFG.MU_STAR / h * (1 + e * Math.cos(nu))
  return { pos: { x: r * cp, y: r * sp }, vel: { x: vr * cp - vt * sp, y: vr * sp + vt * cp } }
}

// STEP 1~5 — 성계 하나 조립. 실패(오버플로) 시 null
function buildBodies(rng, A, minPlanets) {
  const P = anteParams(A)
  const n = Math.max(minPlanets, Math.min(8, P.N + (rng.next() < 0.35 ? 1 : 0)))
  const mus = []
  for (let i = 0; i < n; i++) mus.push(80 * Math.pow(P.muHi / 80, rng.next()))   // 로그 균등
  if (rng.next() < 0.10) { const j = rng.int(0, n - 1); mus[j] = Math.min(2500, mus[j] * 3) }   // 목성형
  const Klo = Math.max(3.6, P.Khi - 2), K = []
  for (let i = 0; i < n - 1; i++) K.push(rng.range(Klo, P.Khi))
  const axes = placeOrbits(rng, mus, K, P.aMax)
  if (!axes) return null
  const elems = axes.map((a, i) => ({ a, mu: mus[i], e: rayleigh(rng, P.sigmaE), w: rng.range(0, Math.PI * 2), nu: rng.range(0, Math.PI * 2) }))
  for (let tries = 0; tries < 10; tries++) {   // 초기 쌍거리 < 3×상호 힐 반경이면 ν 재샘플
    let ok = true
    const st = elems.map(el => elementsToState(el.a, el.e, el.w, el.nu))
    outer: for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const hij = Math.cbrt((elems[i].mu + elems[j].mu) / (3 * CFG.MU_STAR)) * (elems[i].a + elems[j].a) / 2
      if (Math.hypot(st[i].pos.x - st[j].pos.x, st[i].pos.y - st[j].pos.y) < 3 * hij) {
        elems[j].nu = rng.range(0, Math.PI * 2); ok = false; break outer
      }
    }
    if (ok) break
  }
  // STEP 5 — 지구 슬롯: a ≈ 0.42·a_max 에 가장 가까운 궤도를 지구로 치환
  const earthSlot = elems.reduce((bi, el, i) =>
    Math.abs(el.a - 0.42 * P.aMax) < Math.abs(elems[bi].a - 0.42 * P.aMax) ? i : bi, 0)
  const bodies = elems.map((el, i) => {
    const s = elementsToState(el.a, el.e, el.w, el.nu), isE = i === earthSlot
    const mu = isE ? CFG.EARTH_MU : el.mu
    return {
      id: `p${i}`, name: isE ? 'Earth' : `${NAMES[i % NAMES.length]}-${i + 1}`, mu,
      radius: isE ? CFG.EARTH_R : radiusOf(mu), pos: s.pos, vel: s.vel,
      type: isE ? 'earth' : pickW(rng, zoneTable(el.a / P.aMax)),
      isEarth: isE, alive: true, trail: [], hitFlash: 0, trailFlash: 0, scorch: 0,
    }
  })
  return { bodies, earth: bodies[earthSlot], aMax: P.aMax }
}

// STEP 6 — 안정성 사전 시뮬: 100초 dt=1/40, 충돌/이탈/낙하 리젝트
function stablePresim(bodies, aMax) {
  const sim = cloneBodies(bodies), dt = 1 / 40, steps = Math.round(100 / dt)
  for (let s = 0; s < steps; s++) {
    stepBodies(sim, dt)
    if (s % 5) continue
    for (let i = 0; i < sim.length; i++) {
      const r = Math.hypot(sim[i].pos.x, sim[i].pos.y)
      if (r > 2.6 * aMax || r < CFG.R_STAR + 15) return false
      for (let j = i + 1; j < sim.length; j++)
        if (Math.hypot(sim[i].pos.x - sim[j].pos.x, sim[i].pos.y - sim[j].pos.y) < 1.15 * contactDist(sim[i], sim[j])) return false
    }
  }
  return true
}

// 에페메리스 — 행성 궤적 사전 적분 (차폐도·솔버 공용, §7.6)
function ephemeris(bodies, seconds, dt) {
  const sim = cloneBodies(bodies), frames = [sim.map(b => ({ x: b.pos.x, y: b.pos.y }))]
  const steps = Math.round(seconds / dt)
  for (let s = 0; s < steps; s++) { stepBodies(sim, dt); frames.push(sim.map(b => ({ x: b.pos.x, y: b.pos.y }))) }
  return { dt, frames, at(i, t) { return frames[Math.min(frames.length - 1, Math.round(t / dt))][i] } }
}

// §7.5 차폐도 B — 발사점(지구 초기 위치)→목표 회랑을 막는 행성 수의 20초 평균
function occlusion(eph, bodies, earthIdx, tIdx) {
  let sum = 0, samples = 0
  const from = eph.at(earthIdx, 0)
  for (let t = 0; t <= 20; t += 0.5) {
    const tp = eph.at(tIdx, t), dx = tp.x - from.x, dy = tp.y - from.y
    const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, half = bodies[tIdx].radius
    let count = 0
    for (let o = 0; o < bodies.length; o++) {
      if (o === tIdx || o === earthIdx) continue
      const op = eph.at(o, t), px = op.x - from.x, py = op.y - from.y, proj = px * ux + py * uy
      if (proj <= 0 || proj >= L) continue
      // 차단 반경은 기하 반지름이 아니라 중력 쿠션: κ로 SOI가 ~5.1배 확대(§4.3)되므로 3R로 근사
      if (Math.abs(-px * uy + py * ux) < half + 3 * bodies[o].radius) count++
    }
    sum += count; samples++
  }
  return sum / samples
}

// §7.6 솔버 검증(경량 스크리닝) — 개정: 이제 "부술 수 있는가"가 아니라
// **"큐를 댈 수 있는가"** 를 본다. 목표 행성에 핵을 꽂을 수 있는 발사각이
// 하나라도 있으면 통과. (부수는 건 그 뒤 플레이어의 당구 실력 문제다.)
// 발사 오프셋·파워대역·κ★는 반드시 실제 게임과 같은 값을 써야 한다.
const PROBE_PW = [CFG.LAUNCH_MIN, (CFG.LAUNCH_MIN + CFG.LAUNCH_MAX) / 2, CFG.LAUNCH_MAX]
function solvable(eph, bodies, earthIdx, tIdx, aMax) {
  for (const t0 of [0, 5, 10]) for (const pw of PROBE_PW) for (let ai = 0; ai < 16; ai++) {
    if (trySim(eph, bodies, earthIdx, tIdx, aMax, t0, ai / 16 * Math.PI * 2, pw)) return true
  }
  return false
}
function trySim(eph, bodies, earthIdx, tIdx, aMax, t0, ang, pw) {
  const dt = 1 / 30, from = eph.at(earthIdx, t0), off = CFG.LAUNCH_OFFSET
  let x = from.x + Math.cos(ang) * off, y = from.y + Math.sin(ang) * off
  let vx = Math.cos(ang) * pw, vy = Math.sin(ang) * pw
  for (let t = t0; t < t0 + CFG.MISSILE_TTL; t += dt) {
    let d2 = x * x + y * y + CFG.EPS * CFG.EPS, inv = CFG.KAPPA_STAR * CFG.MU_STAR / (d2 * Math.sqrt(d2))
    let ax = -x * inv, ay = -y * inv
    for (let i = 0; i < bodies.length; i++) {
      const p = eph.at(i, t), dx = p.x - x, dy = p.y - y
      d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS; inv = CFG.KAPPA * bodies[i].mu / (d2 * Math.sqrt(d2))
      ax += dx * inv; ay += dy * inv
    }
    vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt
    const rs = Math.hypot(x, y)
    if (rs < CFG.R_STAR + 8 || rs > 2.8 * aMax) return false
    for (let i = 0; i < bodies.length; i++) {
      const p = eph.at(i, t)
      if (Math.hypot(x - p.x, y - p.y) < hitRadiusOf(bodies[i])) return i === tIdx   // 지구 오폭 = 실패
    }
  }
  return false
}

// ─── 특수 천체 배정 ─────────────────────────────────────────────
// 판을 풍성하게 만드는 건 규칙의 수가 아니라 규칙끼리의 상호작용이다.
// 목표 위에 얹을 수 있는 건 장갑·요새뿐: 특이점은 부술 수 없고,
// 휘발성은 유폭해 버려서 "충돌로 부숴라" 같은 조건과 충돌한다.
// 목표 위에 얹어도 되는 역할은 요새뿐. 장갑은 "밀어서 처리"를 막아 버리고,
// 특이점은 부술 수 없고, 휘발성은 유폭해서 목표 조건과 충돌한다.
// 단 충돌 파괴 계열 목표에서는 장갑 표적이 정확히 그 주제라 예외로 붙인다.
const TARGET_OK = new Set(['battery'])
function assignRoles(rng, bodies, earth, targets, goal, stageIdx, ante) {
  const pool = rolePool(stageIdx)
  const cand = bodies.filter(b => b !== earth && b.type !== 'debris')
  const isT = (b) => targets.includes(b)

  // 방어막은 캐롬 목표가 표적에 얹는 정식 역할이다 — 범례에도 그렇게 뜬다
  if (goal.shielded) for (const t of targets) setRole(t, 'shield')
  // "밀어선 안 되고 던져야 한다" — 충돌 파괴 목표의 주제 그 자체
  if ((goal.kind === 'SMASH' || goal.kind === 'PILEUP') && pool.includes('armor')) setRole(targets[0], 'armor')

  const want = Math.min(cand.length - 1, 1 + Math.floor(ante * CFG.ROLE_PER_ANTE))
  const shuffle = (arr) => {   // 피셔–예이츠
    for (let i = arr.length - 1; i > 0; i--) { const j = rng.int(0, i); const t = arr[i]; arr[i] = arr[j]; arr[j] = t }
    return arr
  }
  const free = shuffle(cand.filter(b => !b.role))
  // 같은 역할이 판을 뒤덮지 않게 풀을 한 바퀴 다 돌린 뒤에야 중복을 허용한다.
  // 위에서 강제 배정한 역할도 이미 쓴 것으로 친다.
  const used = new Set(cand.filter(b => b.role).map(b => b.role))
  let deck = shuffle(pool.filter(r => !used.has(r)))
  if (!deck.length) deck = shuffle([...pool])
  let placed = cand.length - free.length
  for (const b of free) {
    if (placed >= want) break
    const usable = isT(b) ? deck.filter(r => TARGET_OK.has(r)) : deck
    if (!usable.length) continue
    const role = usable[rng.int(0, usable.length - 1)]
    setRole(b, role)
    deck = deck.filter(r => r !== role)
    if (!deck.length) deck = shuffle([...pool])
    placed++
  }
}
function setRole(b, role) {
  if (!b || b.role) return
  b.role = role
  if (role === 'battery') b.ammo = CFG.BATTERY_AMMO
  if (role === 'void') { b.type = 'void'; b.mu = Math.max(b.mu, 900); b.radius = radiusOf(b.mu) }
  if (role === 'volatile') b.type = 'gas'
  if (role === 'armor') b.type = 'iron'
}

function finalize(bodies, earth, tIdx, B, aMax, seed, ante, goal, extraTargets, rng, stageIdx) {
  const targets = [bodies[tIdx], ...extraTargets]
  targets.forEach((t, i) => { t.name = `Zork ${t.name}`; t.isTarget = true; t.targetNo = i + 1 })
  assignRoles(rng, bodies, earth, targets, goal, stageIdx, ante)
  const roles = [...new Set(bodies.filter(b => b.role).map(b => b.role))]
  return { bodies, earth, target: targets[0], targets, aMax, B, seed, ante, goal, roles }
}

// 목표 후보 정렬 — 개정: "부딪힐 짝이 가까이 있는가"가 1순위다.
// 규칙이 밀어 치기로 바뀐 뒤로는, 궤도가 이웃과 붙어 있는 행성이라야
// 밀어서 만나게 할 수 있다. 차폐도는 양념으로만 섞는다.
function rankTargets(rng, eph, bodies, earthIdx) {
  const R = bodies.map(b => Math.hypot(b.pos.x, b.pos.y))
  const out = []
  for (let i = 0; i < bodies.length; i++) {
    if (i === earthIdx) continue
    let gap = Infinity
    for (let j = 0; j < bodies.length; j++) {
      if (j === i || j === earthIdx) continue
      gap = Math.min(gap, Math.abs(R[i] - R[j]) / Math.max(1, R[i]))
    }
    if (!isFinite(gap)) gap = 1
    const B = occlusion(eph, bodies, earthIdx, i)
    out.push({ i, B, gap, cost: gap + 0.15 * Math.abs(B - 1.2) })
  }
  out.sort((a, b) => a.cost - b.cost)
  // 상위 3후보 중에서 뽑아 매 판 같은 행성이 지목되지 않게 한다
  const k = Math.min(3, out.length)
  const pickIdx = k > 1 ? rng.int(0, k - 1) : 0
  if (pickIdx > 0) out.unshift(out.splice(pickIdx, 1)[0])
  return out
}

// §7.9 전체 파이프라인 — 생성 → 안정성(싼 필터) → 차폐도(싼 필터) → 솔버(비싼 필터)
export function makeStage(seed = Date.now(), ante = 1, stageIdx = 0) {
  const rng = new Rng(seed)
  const goal = makeGoal(pickGoalSpec(rng, stageIdx, ante))
  const minPlanets = goal.minBodies   // 목표 + 큐볼 + 지구 (objectives.js에서 산정)
  let fallback = null
  for (let attempt = 0; attempt < 25; attempt++) {
    const built = buildBodies(rng, ante, minPlanets)
    if (!built) continue
    const { bodies, earth, aMax } = built
    if (bodies.length < minPlanets) continue
    if (!stablePresim(bodies, aMax)) continue
    const eph = ephemeris(bodies, 12 + CFG.MISSILE_TTL, 1 / 30)   // 솔버가 보는 구간을 전부 덮어야 한다
    const earthIdx = bodies.indexOf(earth)
    const ranked = rankTargets(rng, eph, bodies, earthIdx)
    if (ranked.length < goal.targetCount) continue
    const pick = ranked.slice(0, goal.targetCount)
    const primary = pick[0]
    if (!fallback) fallback = { bodies, earth, pick, aMax }
    // 차폐도 상한만 남긴다 — 규칙이 "밀어 치기"로 바뀐 뒤로는 회랑이 뚫려 있는 게
    // 오히려 정상이고, 판을 거르는 진짜 조건은 "큐를 댈 수 있는가"(solvable)다.
    if (primary.B > 2.8) continue
    if (attempt < 20 && !solvable(eph, bodies, earthIdx, primary.i, aMax)) continue
    return finalize(bodies, earth, primary.i, primary.B, aMax, seed, ante, goal,
      pick.slice(1).map(p => bodies[p.i]), rng, stageIdx)
  }
  if (fallback) {
    return finalize(fallback.bodies, fallback.earth, fallback.pick[0].i, fallback.pick[0].B,
      fallback.aMax, seed, ante, goal, fallback.pick.slice(1).map(p => fallback.bodies[p.i]), rng, stageIdx)
  }
  // 최후 안전망: 검증 없이 생성해 바깥쪽 행성들을 목표로
  for (let i = 0; i < 20; i++) {
    const built = buildBodies(rng, ante, minPlanets)
    if (!built) continue
    const { bodies, earth, aMax } = built
    const idx = bodies.map((b, k) => k).filter(k => bodies[k] !== earth).reverse().slice(0, goal.targetCount)
    return finalize(bodies, earth, idx[0], 0, aMax, seed, ante, goal, idx.slice(1).map(k => bodies[k]), rng, stageIdx)
  }
  throw new Error('스테이지 생성 실패')
}
