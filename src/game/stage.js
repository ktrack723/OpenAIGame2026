import { CFG, aMaxOf, beltRadius, contactDist } from './config.js'
import { makeBody } from './body.js'
import { TYPE_MU_MUL } from './roles.js'
import { cloneBodies, stepBodies } from './physics.js'

// 성계 생성 원시함수 모음. 표적 선정·목표 배정은 system.js로 옮겼다 —
// 성계가 판마다 새로 만들어지지 않고 계속 이어지기 때문이다.
//
// ※ 무작위 성계 생성기(anteParams/placeOrbits/buildBodies)는 없앴다.
//   첫 판은 이제 **실제 태양계**로 고정이고(buildSolarSystem), 이후 판은
//   그 성계가 그대로 이어지며 조르그 증원만 워프로 들어온다 — 즉
//   "성계를 통째로 새로 뽑는" 경로 자체가 사라졌다.

// STEP 4 — 바이옴 배정 (정규화 반경 존별 확률)
// 분류는 다섯뿐이고 넷은 규칙을 갖는다(Icons.CATEGORY). 안쪽은 암석·금속,
// 바깥쪽은 얼음·가스가 흔하다 — 실제 태양계의 배치와 같은 감각.
const zoneTable = (x) =>
  x < 0.35 ? [['rock', 60], ['iron', 40]]
  : x < 0.65 ? [['rock', 55], ['iron', 25], ['ice', 20]]
  : [['ice', 50], ['gas', 35], ['rock', 15]]
function pickW(rng, table) {
  let u = rng.range(0, 100)
  for (const [t, w] of table) if ((u -= w) <= 0) return t
  return table[0][0]
}
export const pickBiome = (rng, x) => pickW(rng, zoneTable(x))
// STEP 3 — 궤도 요소 → 상태 벡터 (교과서 공식, 협상 불가)
export function elementsToState(a, e, w, nu) {
  const r = a * (1 - e * e) / (1 + e * Math.cos(nu))
  const h = Math.sqrt(CFG.MU_STAR * a * (1 - e * e))
  const phi = w + nu, cp = Math.cos(phi), sp = Math.sin(phi)
  const vr = CFG.MU_STAR / h * e * Math.sin(nu), vt = CFG.MU_STAR / h * (1 + e * Math.cos(nu))
  return { pos: { x: r * cp, y: r * sp }, vel: { x: vr * cp - vt * sp, y: vr * sp + vt * cp } }
}

// ─── 실제 태양계 ────────────────────────────────────────────────
// 첫 판은 우리 태양계다. 지구가 어디서 출발하는지가 이 게임의 전제이므로,
// 그 출발점이 진짜 태양계면 판 위의 모든 이름이 곧 설명이 된다
// (목성이 크다는 걸 따로 알려줄 필요가 없다).
//
// 다만 실제 수치를 그대로 쓸 수는 없다. 태양계는 반경이 175배(수성 0.39 AU ~
// 에리스 67.9 AU), 질량이 10만 배(히기에이아 ~ 목성) 벌어져 있는데
// 이 판은 반경 5배·질량 50배 안에 다 들어가야 한다. 그래서 **순서와 비율 감각은
// 지키되 거듭제곱으로 압축**한다 — 목성은 여전히 제일 크고 제일 무겁고
// 소행성은 여전히 티끌이지만, 한 화면 안에서 서로 칠 수 있는 거리에 있다.
//
// 반경과 질량은 일부러 따로 압축한다: 반경은 "눈에 보이는 크기"라 실제 반경
// 비율을 따라야 목성이 목성처럼 보이고, 질량은 중력(스윙바이·힐 반경)을
// 좌우하는 게임 수치라 판이 안 터질 만큼만 벌려야 한다.
const SOLAR = [
  // 이름 키(planet.*), 궤도장반경(AU), 질량(지구=1), 반경(지구=1), 이심률, 종류
  { key: 'mercury', au: 0.387, m: 0.0553, r: 0.383, e: 0.206, type: 'iron' },
  { key: 'venus', au: 0.723, m: 0.815, r: 0.949, e: 0.007, type: 'rock' },
  { key: 'earth', au: 1.000, m: 1.000, r: 1.000, e: 0.017, type: 'earth', isEarth: true },
  { key: 'mars', au: 1.524, m: 0.107, r: 0.532, e: 0.093, type: 'rock' },
  { key: 'vesta', au: 2.362, m: 4.35e-5, r: 0.041, e: 0.089, type: 'rock' },
  { key: 'ceres', au: 2.766, m: 1.60e-4, r: 0.074, e: 0.076, type: 'ice' },
  { key: 'hygiea', au: 3.139, m: 1.40e-5, r: 0.034, e: 0.112, type: 'rock' },
  { key: 'jupiter', au: 5.204, m: 317.8, r: 11.21, e: 0.049, type: 'gas' },
  { key: 'saturn', au: 9.583, m: 95.16, r: 9.449, e: 0.057, type: 'gas' },
  { key: 'uranus', au: 19.19, m: 14.54, r: 4.007, e: 0.046, type: 'gas' },
  { key: 'neptune', au: 30.07, m: 17.15, r: 3.883, e: 0.009, type: 'gas' },
  { key: 'pluto', au: 39.48, m: 0.0022, r: 0.187, e: 0.249, type: 'ice' },
  { key: 'haumea', au: 43.13, m: 6.70e-4, r: 0.130, e: 0.191, type: 'ice' },
  { key: 'makemake', au: 45.79, m: 5.20e-4, r: 0.115, e: 0.159, type: 'ice' },
  { key: 'eris', au: 67.86, m: 0.0028, r: 0.183, e: 0.436, type: 'ice' },
]
const SOLAR_P = 0.28      // 궤도: a = aEarth × AU^P
const SOLAR_Q = 0.20      // 질량: μ = EARTH_MU × m^Q
const SOLAR_S = 0.45      // 반경: R = EARTH_R × r^S
const SOLAR_E = 0.5       // 이심률 감쇠 — 명왕성(0.249)·에리스(0.436)를 그대로 쓰면
const SOLAR_E_MAX = 0.13  //   압축된 판에서 궤도 대여섯 개를 가로질러 버린다

// 궤도가 너무 붙은 이웃을 바깥으로 밀어 최소 간격을 확보한다.
// 압축 때문에 해왕성 바깥 천체(명왕성·하우메아·마케마케)가 30 GU 안에
// 몰리는데, 그대로 두면 시작하자마자 서로 부대끼며 먼지만 피운다.
function spreadOrbits(rows, minGap) {
  for (let i = 1; i < rows.length; i++) {
    const need = rows[i - 1].a + minGap(rows[i - 1], rows[i])
    if (rows[i].a < need) rows[i].a = need
  }
}

export function buildSolarSystem(rng, A = 1) {
  const aMax = aMaxOf(A)
  const aEarth = 0.35 * aMax
  const rows = SOLAR.map((s, i) => ({
    ...s,
    a: aEarth * Math.pow(s.au, SOLAR_P),
    // 얼음은 가볍다 — 분류가 곧 질량이다(TYPE_MU_MUL). 반경은 실제 비율 그대로라
    // "덩치는 큰데 잘 밀리는 공"이 자연스럽게 생긴다.
    // MU_SCALE — 판 전체를 가볍게. 핵 한 방에 궤도가 눈에 띄게 바뀌어야
    // "쳤다"는 감각이 생긴다(당구처럼 쾅쾅). 반경은 별개라 그림은 그대로다.
    mu: Math.max(8, CFG.EARTH_MU * (s.isEarth ? 1 : Math.pow(s.m, SOLAR_Q))
      * (TYPE_MU_MUL[s.type] ?? 1) * CFG.MU_SCALE),
    radius: s.isEarth ? CFG.EARTH_R : Math.max(2.2, CFG.EARTH_R * Math.pow(s.r, SOLAR_S)),
    ecc: Math.min(SOLAR_E_MAX, s.e * SOLAR_E),
    idx: i,
  }))
  // 서로 닿을 만큼 붙은 궤도는 벌린다 (판정 원 지름의 2.5배 + 여유)
  spreadOrbits(rows, (p, q) => Math.max(46, (p.radius + q.radius) * CFG.HIT_R * 2.5))
  // 다 벌리고 나서 벨트 안쪽에 들어오게 통째로 눌러 준다
  const limit = beltRadius(aMax) * 0.86
  const outer = rows[rows.length - 1]
  if (outer.a > limit) {
    const k = limit / outer.a
    for (const r of rows) r.a = Math.max(CFG.A_MIN, r.a * k)
  }
  const bodies = rows.map((s) => {
    const w = rng.range(0, Math.PI * 2), nu = rng.range(0, Math.PI * 2)
    const st = elementsToState(s.a, s.ecc, w, nu)
    return makeBody({
      id: `sol${s.idx}`, nameKey: `planet.${s.key}`, mu: s.mu, radius: s.radius,
      pos: st.pos, vel: st.vel, type: s.type, isEarth: !!s.isEarth,
      hp: s.isEarth ? CFG.EARTH_HP : CFG.PLANET_HP,
    })
  })
  return { bodies, earth: bodies.find(b => b.isEarth), aMax }
}

// STEP 6 — 안정성 사전 시뮬: dt=1/40, 태양 낙하/즉시 충돌만 리젝트.
// 예전에는 "100초 안에 한 번이라도 스치면 탈락"이었는데, 공이 열댓 개로
// 늘고 궤도가 촘촘해진 지금 그 기준으로는 아무 성계도 통과하지 못한다.
// 게다가 이제 접촉은 사망이 아니라 **당구 충돌**이라 스쳐도 문제가 없다.
// 남은 요구는 둘뿐이다: ① 태양에 안 빨려들 것 ② 시작하자마자 겹쳐 있지 않을 것.
// (성계 이탈은 카이퍼 벨트가 튕겨 주므로 검사 자체가 무의미해졌다.)
export function stablePresim(bodies, aMax, seconds = 60) {
  const sim = cloneBodies(bodies), dt = 1 / 40, steps = Math.round(seconds / dt)
  for (let i = 0; i < sim.length; i++)
    for (let j = i + 1; j < sim.length; j++)
      if (Math.hypot(sim[i].pos.x - sim[j].pos.x, sim[i].pos.y - sim[j].pos.y) < 1.6 * contactDist(sim[i], sim[j])) return false
  for (let s = 0; s < steps; s++) {
    stepBodies(sim, dt)
    if (s % 5) continue
    for (let i = 0; i < sim.length; i++) {
      const r = Math.hypot(sim[i].pos.x, sim[i].pos.y)
      if (r < CFG.R_STAR + 15 || r > beltRadius(aMax) * 1.05) return false
    }
  }
  return true
}
