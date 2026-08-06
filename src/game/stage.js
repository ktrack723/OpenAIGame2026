import { Rng } from '../core/random.js'
import { CFG, aMaxOf, contactDist, radiusOf } from './config.js'
import { cloneBodies, stepBodies } from './physics.js'

// 성계 생성 원시함수 모음. 표적 선정·목표 배정은 system.js로 옮겼다 —
// 성계가 판마다 새로 만들어지지 않고 계속 이어지기 때문이다.
const NAMES = ['Vesta', 'Bront', 'Mir', 'Kappa', 'Oort', 'Faro', 'Nix', 'Teph', 'Ruun', 'Golda']

// §7.2 안테별 파라미터 테이블
function anteParams(A) {
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
export const pickBiome = (rng, x) => pickW(rng, zoneTable(x))
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
export function elementsToState(a, e, w, nu) {
  const r = a * (1 - e * e) / (1 + e * Math.cos(nu))
  const h = Math.sqrt(CFG.MU_STAR * a * (1 - e * e))
  const phi = w + nu, cp = Math.cos(phi), sp = Math.sin(phi)
  const vr = CFG.MU_STAR / h * e * Math.sin(nu), vt = CFG.MU_STAR / h * (1 + e * Math.cos(nu))
  return { pos: { x: r * cp, y: r * sp }, vel: { x: vr * cp - vt * sp, y: vr * sp + vt * cp } }
}

// STEP 1~5 — 성계 하나 조립. 실패(오버플로) 시 null
export function buildBodies(rng, A, minPlanets) {
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
export function stablePresim(bodies, aMax, seconds = 100) {
  const sim = cloneBodies(bodies), dt = 1 / 40, steps = Math.round(seconds / dt)
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
