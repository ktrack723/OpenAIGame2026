import { Rng } from '../core/random.js'
import { CFG, aMaxOf, hpOf, radiusOf } from './config.js'
import { cloneBodies, stepBodies } from './physics.js'

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
  for (let g = 0; g < 2 && axes[n - 1] > aMax; g++) {
    const kMean = K.reduce((s, k) => s + k, 0) / K.length
    if (kMean > Math.min(...K) + 0.3) for (let i = 0; i < K.length; i++) K[i] = Math.max(3.6, K[i] * 0.9)
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
function buildBodies(rng, A) {
  const P = anteParams(A)
  const n = Math.min(8, P.N + (rng.next() < 0.35 ? 1 : 0))
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
      hp: isE ? CFG.EARTH_HP : hpOf(mu), hpMax: isE ? CFG.EARTH_HP : hpOf(mu),
      type: isE ? 'earth' : pickW(rng, zoneTable(el.a / P.aMax)),
      isEarth: isE, alive: true, trail: [], hitFlash: 0, trailFlash: 0, textureState: 0,
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
        if (Math.hypot(sim[i].pos.x - sim[j].pos.x, sim[i].pos.y - sim[j].pos.y) < 0.8 * (sim[i].radius + sim[j].radius)) return false
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

// §7.6 솔버 검증(경량 스크리닝) — 스윙바이 ≥1 + 목표 직격 + 무파울 해가 하나라도 있는가.
// 발사 오프셋·파워대역·κ★는 반드시 실제 게임과 같은 값을 써야 한다.
// 아니면 "플레이어가 낼 수 없는 샷"을 기준으로 판을 통과시키게 된다.
const PROBE_PW = [CFG.LAUNCH_MIN, (CFG.LAUNCH_MIN + CFG.LAUNCH_MAX) / 2, CFG.LAUNCH_MAX]
function solvable(eph, bodies, earthIdx, tIdx, aMax) {
  for (const t0 of [0, 5, 10]) for (const pw of PROBE_PW) for (let ai = 0; ai < 12; ai++) {
    if (trySim(eph, bodies, earthIdx, tIdx, aMax, t0, ai / 12 * Math.PI * 2, pw)) return true
  }
  return false
}
function trySim(eph, bodies, earthIdx, tIdx, aMax, t0, ang, pw) {
  const dt = 1 / 30, from = eph.at(earthIdx, t0), off = CFG.LAUNCH_OFFSET
  let x = from.x + Math.cos(ang) * off, y = from.y + Math.sin(ang) * off
  let vx = Math.cos(ang) * pw, vy = Math.sin(ang) * pw
  const enc = new Array(bodies.length).fill(null)
  let swings = 0
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
      const p = eph.at(i, t), d = Math.hypot(x - p.x, y - p.y)
      if (d < bodies[i].radius) return i === tIdx && swings >= 1   // 직격 외 명중 = 파울/지구 피해 → 실패
      if (i === tIdx || i === earthIdx) continue
      if (d < CFG.SWING_ZONE * bodies[i].radius) { if (!enc[i]) enc[i] = { vx, vy } }
      else if (enc[i]) {
        const dot = enc[i].vx * vx + enc[i].vy * vy
        const den = (Math.hypot(enc[i].vx, enc[i].vy) * Math.hypot(vx, vy)) || 1
        if (Math.acos(Math.max(-1, Math.min(1, dot / den))) * 180 / Math.PI >= CFG.SWING_DEG) swings++
        enc[i] = null
      }
    }
  }
  return false
}

function finalize(bodies, earth, tIdx, B, aMax, seed, ante) {
  const target = bodies[tIdx]
  target.name = `Zork ${target.name}`
  return { bodies, earth, target, aMax, B, seed, ante }
}

// §7.9 전체 파이프라인 — 생성 → 안정성(싼 필터) → 차폐도(싼 필터) → 솔버(비싼 필터)
export function makeStage(seed = Date.now(), ante = 1) {
  const rng = new Rng(seed)
  let fallback = null
  for (let attempt = 0; attempt < 25; attempt++) {
    const built = buildBodies(rng, ante)
    if (!built) continue
    const { bodies, earth, aMax } = built
    if (!stablePresim(bodies, aMax)) continue
    const eph = ephemeris(bodies, 12 + CFG.MISSILE_TTL, 1 / 30)   // 솔버가 보는 구간을 전부 덮어야 한다
    const earthIdx = bodies.indexOf(earth)
    let tIdx = -1, tB = Infinity
    for (let i = 0; i < bodies.length; i++) {
      if (i === earthIdx) continue
      const B = occlusion(eph, bodies, earthIdx, i)
      if (B >= 0.6 && B <= 2.5 && Math.abs(B - 1.5) < Math.abs(tB - 1.5)) { tIdx = i; tB = B }
      if (!fallback || Math.abs(B - 1.5) < Math.abs(fallback.B - 1.5)) fallback = { bodies, earth, tIdx: i, B, aMax }
    }
    if (tIdx < 0) continue
    if (attempt < 20 && !solvable(eph, bodies, earthIdx, tIdx, aMax)) continue
    return finalize(bodies, earth, tIdx, tB, aMax, seed, ante)
  }
  if (fallback) return finalize(fallback.bodies, fallback.earth, fallback.tIdx, fallback.B, fallback.aMax, seed, ante)
  // 최후 안전망: 검증 없이 생성해 가장 바깥 행성을 목표로
  for (let i = 0; i < 20; i++) {
    const built = buildBodies(rng, ante)
    if (!built) continue
    const { bodies, earth, aMax } = built
    let tIdx = bodies.length - 1
    if (bodies[tIdx] === earth) tIdx--
    return finalize(bodies, earth, tIdx, 0, aMax, seed, ante)
  }
  throw new Error('스테이지 생성 실패')
}
