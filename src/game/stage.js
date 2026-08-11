import { CFG, R_SCALE, aCeilFor, aFloorFor, aMaxOf, beltRadius, contactDist, hitRadiusFor } from './config.js'
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
// 지구 궤도의 **기준**값 = 이 비율 × aMax. 배치가 여기서 밖으로만 움직이므로
// 실제 지구는 이보다 조금 바깥에 앉는다(간격 확보분).
//
// 값은 그대로지만 **뜻이 달라졌다.** 예전에는 궤도를 다 벌린 뒤 전체를 k=0.55로
// 눌렀기 때문에 0.35가 실제로는 0.31로 작동했고(지구 574 GU), 그 압축을
// 걷어낸 지금은 같은 0.35가 지구를 690 GU에 앉힌다. 판이 20% 커진 셈인데,
// 그래도 이 값을 유지한다 — 이유는 둘이다.
//   ① **공 지름으로 재면 판은 오히려 좁아졌다.** 판을 GU로 재는 건 의미가 없고
//      "공 몇 개만큼 떨어져 있나"가 곧 난이도다: 지구 궤도 ÷ 지구 판정 반경이
//      15.4 → 14.2로 줄었다(목성 기준 5.2 → 4.8). 공을 1.3배로 키운 효과가
//      판이 넓어진 것보다 크다.
//   ② 요새를 세울 자리가 넓어진다. 0.28로 내려 예전 반경을 되찾아 보니 요새
//      대역이 707 → 571 GU로 좁아져 빈 궤도를 못 찾는 요새가 늘었고(계측:
//      대역 밖으로 새는 요새가 늘고 큐볼 옆자리 보증이 99% → 93%로 떨어졌다),
//      그 대가가 판이 좁아져 얻는 것보다 컸다.
const SOLAR_A_EARTH = 0.35

// ─── 궤도 배치 ──────────────────────────────────────────────────
// 세 가지를 **동시에** 만족시켜야 한다:
//   ① 순서와 비율 — AU 거듭제곱이 준 자리(a0)보다 안쪽으로는 안 내려간다
//   ② 이웃끼리 안 스침 — 궤도 반경 차가 두 판정 원의 합보다 넉넉히 커야 한다
//   ③ 판 안 — 원점(遠點)이 카이퍼 벨트 안쪽, 근점(近點)이 코로나 바깥
//
// 예전 코드는 ②를 전부 만족시킨 뒤 ③을 맞추려고 **전체를 k배로 눌렀다**.
// 그러면 두 가지가 조용히 망가진다:
//   · ②의 보증이 통째로 깨진다. 간격도 같이 k배가 되므로 "최소 간격을
//     확보한다"는 이 함수의 계약이 끝나고 나면 남아 있지 않다(계측 k=0.55).
//   · 가장 안쪽 궤도가 태양 쪽으로 끌려 내려간다. 공을 키우면 필요 간격이
//     커져 k가 더 작아지므로 **키울수록 수성이 코로나로 내려간다** —
//     반경 1.3배에서 수성이 338 → 270 GU, 근점이 태양 표면의 1.24배였다.
//
// 이제는 ①③을 벽으로 두고 ②의 요구치만 균등하게 양보시킨다: 간격 배율 f를
// 이분 탐색해 **벽을 안 넘는 가장 큰 f**를 찾는다. 자리는 그대로 두고 간격만
// 판이 감당할 만큼 좁히는 것이라 안쪽 궤도가 태양으로 끌려가지 않고,
// 좁힌 결과가 곧 실제로 지켜지는 최소 간격이라 계약도 거짓말이 아니게 된다.
// (f=0이면 a0 그대로이고 a0는 증가열이라 반드시 벽 안이다 — 해는 항상 있다.)
function layoutOrbits(rows, gapOf, aFloor, aCeil) {
  const last = rows.length - 1
  // a0가 이미 벽을 넘는 성계라면(판이 좁아진 경우) 비율만 지키며 눌러 넣는다.
  // 여기서 한 번 눌러 두면 아래 이분 탐색의 전제(f=0은 반드시 통과)가 성립한다.
  if (rows[last].a0 > aCeil) {
    const k = aCeil / rows[last].a0
    for (const r of rows) r.a0 = Math.max(aFloor, r.a0 * k)
  }
  const fit = (f) => {
    let a = rows[0].a = Math.max(aFloor, rows[0].a0)
    for (let i = 1; i <= last; i++) a = rows[i].a = Math.max(rows[i].a0, a + gapOf(rows[i - 1], rows[i]) * f)
    return a
  }
  if (fit(1) <= aCeil) return 1
  let lo = 0, hi = 1
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2
    if (fit(mid) <= aCeil) lo = mid; else hi = mid
  }
  fit(lo)
  return lo
}

export function buildSolarSystem(rng, A = 1) {
  const aMax = aMaxOf(A)
  const aEarth = SOLAR_A_EARTH * aMax
  const rows = SOLAR.map((s, i) => ({
    ...s,
    // a0 = 비율이 준 자리. 배치는 여기서 **밖으로만** 움직인다(layoutOrbits).
    a0: aEarth * Math.pow(s.au, SOLAR_P),
    a: 0,
    // 얼음은 가볍다 — 분류가 곧 질량이다(TYPE_MU_MUL). 반경은 실제 비율 그대로라
    // "덩치는 큰데 잘 밀리는 공"이 자연스럽게 생긴다.
    // MU_SCALE — 판 전체를 가볍게. 핵 한 방에 궤도가 눈에 띄게 바뀌어야
    // "쳤다"는 감각이 생긴다(당구처럼 쾅쾅). 반경은 별개라 그림은 그대로다.
    mu: Math.max(8, CFG.EARTH_MU * (s.isEarth ? 1 : Math.pow(s.m, SOLAR_Q))
      * (TYPE_MU_MUL[s.type] ?? 1) * CFG.MU_SCALE),
    // 반지름 바닥값도 전역 배율을 탄다 — 안 그러면 제일 작은 공만 안 커진다
    radius: s.isEarth ? CFG.EARTH_R : Math.max(2.2 * R_SCALE, CFG.EARTH_R * Math.pow(s.r, SOLAR_S)),
    ecc: Math.min(SOLAR_E_MAX, s.e * SOLAR_E),
    idx: i,
  }))
  // 서로 닿을 만큼 붙은 궤도는 벌린다 — 기준은 **두 공의 판정 원 합**(=접촉
  // 거리)의 2.5배다. 예전에는 (반지름 합 × HIT_R)로 계산해 MIN_HIT_R 바닥값을
  // 빼먹었는데, 소행성대(베스타·세레스·히기에이아)는 실제 판정 원이 23.4인데
  // 11~15로 쳐서 요구 간격이 접촉 거리의 1.2배밖에 안 됐다 — 벌려 놓고도
  // 바로 스치는 자리였다. 46 GU 바닥값은 그 실수를 가리던 반창고라 같이 뺀다.
  const gapOf = (p, q) => (hitRadiusFor(p.radius) + hitRadiusFor(q.radius)) * 2.5
  // 벽은 근점·원점으로 잰다 — 이심률이 SOLAR_E_MAX까지 붙으므로 장반경만
  // 보면 원점이 벨트를 넘거나 근점이 코로나로 들어간다.
  layoutOrbits(rows, gapOf, aFloorFor(SOLAR_E_MAX), aCeilFor(aMax, SOLAR_E_MAX))
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
