import { Rng } from '../core/random.js'
import { CFG, aCeilFor, aFloorFor, aMaxOf, beltRadius, hitRadiusFor, hitRadiusOf, radiusOf } from './config.js'
import { makeBody } from './body.js'
import { TYPE_MU_MUL, effDv } from './roles.js'
import { buildBodyTrack, segHitsCircle, stepMissile, trackFrame } from './physics.js'
import { buildSolarSystem, elementsToState, pickBiome, stablePresim } from './stage.js'

// ─── 지속 성계 ──────────────────────────────────────────────────
// 판이 끝나도 성계를 새로 만들지 않는다. 살아남은 행성은 위치·속도 그대로
// 다음 판으로 넘어가고, 조르그가 본성에서 새 행성을 워프로 보내온다.
// 그래서 "지난 판에 내가 밀어 놓은 궤도"가 다음 판의 판돈이 된다.

const ZORG_NAMES = ['Krath', 'Vorn', 'Zeth', 'Mogul', 'Skarn', 'Dral', 'Ulth', 'Ghaz', 'Rekk', 'Nyx']
let uid = 0
const nextId = () => `z${(uid++).toString(36)}`

// ── 첫 성계: **우리 태양계**. 조르그는 아직 없다 ──
// 판은 늘 같은 자리에서 시작한다 — 수성부터 에리스까지 실제 천체 15개.
// 무작위 성계와 달리 "어디에 뭐가 있는지"를 플레이어가 이미 알고 있으므로
// 첫 판은 규칙을 익히는 데만 쓰면 된다. 궤도 위상(지금 어느 행성이 어디쯤
// 와 있는가)만 시드로 흔들어 판마다 다른 배치가 나오게 한다.
export function createSystem(seed) {
  const rng = new Rng(seed)
  for (let attempt = 0; attempt < 60; attempt++) {
    const built = buildSolarSystem(rng, 1)
    if (!stablePresim(built.bodies, built.aMax)) continue
    return { bodies: built.bodies, earth: built.earth, rng }
  }
  // 위상 추첨이 60번 다 실패해도 판은 열려야 한다 — 마지막 한 벌을 그대로 쓴다
  const built = buildSolarSystem(rng, 1)
  return { bodies: built.bodies, earth: built.earth, rng }
}

// ── 궤도 자리 찾기 ──────────────────────────────────────────────
// 이미 깔린 공들과 궤도가 겹치지 않고, 지금 위치도 충분히 떨어진 자리를 고른다.
// 겹치면 워프하자마자 충돌해서 플레이어가 아무것도 못 한 채 판이 끝난다.
// nearBand: 이 값이 주어지면 "가장 가까운 이웃 궤도가 그 안에 있어야" 통과한다.
//
// 왜 필요한가 — 플레이테스트에서 1스테이지를 810수까지 탐색했는데 **요새에
// 피해를 주는 한 수가 0개**였다. 원인은 요새가 아무도 없는 빈 궤도에 떨어졌기
// 때문이다. 실제 태양계는 목성~토성 사이가 395 GU씩 벌어져 있어서, 그 틈에
// 워프한 요새는 어떤 공으로도 밀어 보낼 수가 없었다(가장 무거운 이웃의
// 최대 Δv가 6~8이고, 궤도 하나를 건너오려면 반 바퀴 이상이 걸린다).
//
// 그래서 요새는 **반드시 어떤 공의 옆자리**에 워프시킨다. 겹치지도 않고
// 외따로 떨어지지도 않은 자리 — 그게 "이 요새는 저 공으로 친다"가 성립하는
// 유일한 배치다. 중립 천체는 이 제약 없이 아무 데나 놓는다.
// rNew — 새로 놓을 공의 **실제** 반지름. 질량에서 뽑지 않고 받아 쓴다:
// 대형 요새는 체력만큼 덩치도 키워 놓았으므로(FORT_HEAVY_R) radiusOf(mu)로
// 다시 계산하면 실제보다 작은 공으로 자리를 잡아, 이웃 궤도에 너무 붙는다.

// 워프인 궤도의 이심률 폭. 아래의 벽(근점·원점) 계산이 이 상한을 그대로 쓰므로
// 상수로 뺐다 — 예전에는 뽑는 자리에 0.01+0.06이 박혀 있고 벽 쪽에는 1.08이라는
// 마법수가 따로 있어서, 한쪽만 고치면 조용히 어긋났다.
const WARP_E_MIN = 0.01, WARP_E_MAX = 0.07
function freeOrbit(rng, bodies, aMax, rNew, nearBand = 0, band = null) {
  const live = bodies.filter(b => b.alive && b.type !== 'debris')
  const hitNew = hitRadiusFor(rNew)
  // 이웃 하나하나에 대해 "궤도 반경이 이만큼은 벌어져야 한다"를 미리 재 둔다.
  // 예전 규칙은 `26 + rNew × 2.5` — **새로 놓는 공의 크기만** 봤다. 그래서
  // 목성(판정 원 144 GU) 바로 옆 52 GU에 요새를 놓는 수가 통과했고, 그 요새는
  // 플레이어가 손대기도 전에 목성이 쓸고 지나갔다.
  // 그렇다고 판정 원 합을 그대로 요구하면 지구 궤도 대역이 통째로 막힌다
  // (계측: 대역 738 GU 중 빈 자리가 31 GU) — 안쪽 판은 원래 그만큼 빽빽하다.
  // 그래서 **큰 이웃일 때만** 조인다: 판정 원 합의 0.6배와 예전 값 중 큰 쪽.
  // 목성·토성·모함처럼 판정 원이 100 GU를 넘는 것들만 실제로 걸린다.
  const slots = live.map(b => {
    const r = Math.hypot(b.pos.x, b.pos.y)
    return { r, sep: Math.max(26 + rNew * 2.5, (hitNew + hitRadiusOf(b)) * 0.6) }
  })
  // 이웃 후보 = **실제로 밀 수 있는 공**. 세 가지를 뺀다:
  //   · 지구 — 치면 게임 오버라 큐볼이 아니다
  //   · 너무 무거운 공 — 목성·토성은 최대 작약으로도 Δv가 15~19라
  //     "옆에 있다"가 곧 "칠 수 있다"가 되지 못한다(계측: 토성만 옆에 둔 판은
  //     240수 중 1수만 요새에 닿았고, 가벼운 공이 옆에 있는 판은 6수였다).
  //   · **안 밀리는 공** — 특이점(Δv 0)과 금속(Δv 절반)은 μ만 봐서는 안 걸러진다.
  //     그래서 nukeDv가 아니라 effDv로 묻는다(roles.js). 예전에는 특이점 옆에
  //     요새를 세워 놓고 "밀 수 있는 공 옆"이라고 기록했다.
  const cueRadii = live
    .filter(b => !b.isEarth && effDv(b, CFG.YIELD_MAX) >= CFG.FORT_CUE_MIN_DV)
    .map(b => Math.hypot(b.pos.x, b.pos.y))
  // ── 판의 두 벽 안쪽으로 못 박는다 ──────────────────────────
  // 벨트는 장식이 아니라 **판의 벽**이다(physics.beltBounce). 그 바깥은 판 밖이고,
  // 거기 워프해 들어온 적은 첫 프레임부터 벽에 튕기며 굴러 들어온다.
  // 요새 대역은 **지구의 지금 반경**에서 파생되는데(fortBand), 지구는 핵 폭풍에
  // 밀려 바깥으로 나갈 수 있다 — 그러면 대역 상한이 벨트를 넘어선다.
  // (계측: 지구를 1500 GU 밀어낸 판에서 증원 180기 중 2기가 벨트 밖에 떨어졌다.)
  // 안쪽 벽도 같은 이유로 필요하다: 근점이 코로나 안이면 워프하자마자 태양행이다.
  // 둘 다 config의 같은 식을 쓴다 — 태양계를 까는 쪽(stage.js)과 답이 갈리면 안 된다.
  const aCap = aCeilFor(aMax, WARP_E_MAX)
  const aFloor = aFloorFor(WARP_E_MAX)
  const aHi = Math.max(aFloor, Math.min(band ? band[1] : aMax * 0.95, aCap))
  // band = [lo, hi] 가 주어지면 그 반경대 안에서만 자리를 찾는다
  const aLo = Math.max(aFloor, Math.min(band ? band[0] : CFG.A_MIN * 1.15, aHi * 0.92))
  const rWall = beltRadius(aMax) - CFG.BELT_THICK
  for (let tries = 0; tries < 240; tries++) {
    const a = aLo + rng.next() * Math.max(1, aHi - aLo)
    // 궤도 반경이 기존 공들과 최소 이만큼은 벌어져야 서로 안 스친다.
    let ok = true
    for (const s of slots) if (Math.abs(a - s.r) < s.sep) { ok = false; break }
    if (!ok) continue
    // 옆자리 요구 — 밀어서 닿을 수 있는 공이 하나라도 있어야 한다
    if (nearBand > 0) {
      let near = Infinity
      for (const r of cueRadii) near = Math.min(near, Math.abs(a - r))
      if (near > nearBand) continue
    }
    const e = WARP_E_MIN + rng.next() * (WARP_E_MAX - WARP_E_MIN)
    const w = rng.range(0, Math.PI * 2)
    for (let k = 0; k < 24; k++) {
      const nu = rng.range(0, Math.PI * 2)
      const st = elementsToState(a, e, w, nu)
      // 원점 기준으로 잘랐어도 여기서 한 번 더 본다 — 벽 밖은 판 밖이다
      if (Math.hypot(st.pos.x, st.pos.y) > rWall) continue
      let clear = true
      for (const b of live) {
        const d = Math.hypot(st.pos.x - b.pos.x, st.pos.y - b.pos.y)
        // 지구 근처에 떨어뜨리면 첫 수도 두기 전에 지구가 날아간다.
        // ※ hitRadiusFor를 쓴다 — 예전에는 rNew × HIT_R로 직접 곱해 MIN_HIT_R
        //   바닥값을 빠뜨렸고, 작은 요새일수록 이웃에 바짝 붙어 워프했다.
        const need = (b.isEarth ? 5 : 2.6) * (hitRadiusOf(b) + hitNew)
        if (d < need) { clear = false; break }
      }
      if (clear) return { a, e, w, nu, ...st }
    }
  }
  return null
}

// ── 도달 가능성 — 지구에서 핵을 꽂을 수 있는 자리인가 ──────────
// 아무리 멋지게 워프시켜도 맞힐 수 없는 자리면 판이 성립하지 않는다.
//
// 계측 주의: 이 검사가 판 전환 전체 비용을 지배한다. 처음엔 3파워×20각도를
// dt 1/40으로 돌렸다가 판 전환이 평균 3.6초(최대 9.1초) 걸렸다.
// 프로브 수와 적분 해상도를 낮춰 36샷(3파워×12각도)·40초 지평·dt 1/25로 내렸다.
// "한 발이라도 닿는가"만 보면 되므로 이 해상도로 충분하다.
// 각도 12칸은 30° 간격이라 **닿는 자리를 통째로 건너뛰었다** — 계측에서 이
// 검사를 통과한 요새의 30%가 실제로는 직격 각도가 0개였다(48샷 기준).
// 같은 예산(36 → 48샷)에서 각도를 배로 늘리고 속도를 둘로 줄이는 쪽이 낫다:
// 속도는 궤적을 조금 바꾸지만 각도는 아예 다른 방향이다.
const PROBE_ANGLES = 24, PROBE_POWERS = [34, 50]
// 천체는 미사일보다 **성기게** 굴린다. 이 검사의 비용은 stepBodies(O(n²))가
// 8할을 먹는데, 행성은 초당 20 GU 남짓으로 움직이므로 1/6초 간격이면 위치
// 오차가 3 GU 남짓이다 — 판정 반경이 18 GU 이상이라 답이 뒤집히지 않는다.
// (예측선도 같은 수법을 쓴다: aim.js BODY_EVERY.)
const PROBE_BODY_EVERY = 4
// aMax는 **이번 판의 것**을 받는다. 예전에는 안테 8 기준(가장 넓은 판)의 벨트를
// 썼는데, 미사일이 벨트에 닿으면 그 자리에서 터지는 지금은 그게 거짓말이 된다 —
// 지금 판의 벽 밖으로 나가는 궤적을 "닿는 각도"로 세어 버린다.
// 48개 프로브(2파워 × 24각도)는 전부 **같은 판** 위를 난다 — 미사일은 천체를
// 못 밀므로 천체 궤적도 전부 같다. 프로브마다 판을 복제해 다시 적분하는 대신
// 트랙 한 번을 굴려 두고 48번 재생한다(physics.buildBodyTrack — 비트 단위 동일).
// export는 검증 하네스가 전/후 동치를 확인하는 데 쓴다.
//
// ── 지평은 표적까지의 거리를 따라간다 ──
// 40초 고정은 요새가 전부 지구 궤도 언저리에 있을 때(거리 300~900 GU) 잡은
// 값이다. 바깥 대역(FORT_OUTER_BAND)에 서는 요새는 1500 GU 밖이라, 프로브가
// 40초 안에는 **닿을 수 있는 궤적도 다 못 날았다** — 그러면 이 검사는 "못 맞힌다"가
// 아니라 "안 봤다"를 돌려주고, 바깥 요새는 세 번 다 퇴짜를 맞은 뒤 검사를
// 건너뛴 마지막 시도로만 들어온다(= 사실상 검사가 없는 것과 같다).
// 프로브 속도가 34~50 GU/s이므로 직선 거리의 1.8배쯤을 날 시간을 준다.
// 상한은 미사일 수명 — 그보다 오래 나는 탄은 어차피 없다.
const probeHorizon = (earth, target) =>
  Math.min(CFG.MISSILE_TTL, Math.max(40,
    1.8 * Math.hypot(target.pos.x - earth.pos.x, target.pos.y - earth.pos.y) / 50))
export function reachable(bodies, earth, target, aMax) {
  const dt = 1 / 25, steps = Math.round(probeHorizon(earth, target) / dt)
  const tIdx = bodies.indexOf(target)
  if (tIdx < 0) return false
  const rMax = beltRadius(aMax), rMax2 = rMax * rMax
  const rIn = CFG.R_STAR + 8, rIn2 = rIn * rIn
  const track = buildBodyTrack(bodies, dt, PROBE_BODY_EVERY, steps)
  const sim = track.view
  for (const pw of PROBE_POWERS) {
    for (let ai = 0; ai < PROBE_ANGLES; ai++) {
      const ang = ai / PROBE_ANGLES * Math.PI * 2
      trackFrame(track, 0)
      const p = { x: earth.pos.x + Math.cos(ang) * CFG.LAUNCH_OFFSET, y: earth.pos.y + Math.sin(ang) * CFG.LAUNCH_OFFSET }
      const m = {
        pos: { ...p }, vel: { x: Math.cos(ang) * pw, y: Math.sin(ang) * pw },
        age: 0, pathN: 0, path: null, minSunDist: Infinity, prev: { ...p },
      }
      let f = 0
      for (let i = 0; i < steps; i++) {
        if (i % PROBE_BODY_EVERY === (PROBE_BODY_EVERY >> 1)) trackFrame(track, ++f)
        stepMissile(m, sim, dt)
        let hit = -1
        for (let k = 0; k < sim.length; k++) {
          if (!sim[k].alive) continue
          if (segHitsCircle(m.prev.x, m.prev.y, m.pos.x, m.pos.y, sim[k].pos.x, sim[k].pos.y, hitRadiusOf(sim[k]))) { hit = k; break }
        }
        if (hit >= 0) { if (hit === tIdx) return true; break }
        const r2 = m.pos.x * m.pos.x + m.pos.y * m.pos.y
        if (r2 < rIn2 || r2 > rMax2) break
      }
    }
  }
  return false
}

// ── 워프인 한 기 ────────────────────────────────────────────────
// 요새를 놓을 반경대 — 기본은 **지구 궤도 언저리**다.
//
// 왜: 미사일 사거리는 유한하고(속도 26~56 × TTL 52초), 그 사이에 행성이
// 열댓 개나 껴 있어서 먼 표적은 사실상 못 맞힌다. 플레이테스트에서 요새에
// 닿는 각도가 720개 중 0~8개였다 — 표적을 못 맞히면 게임이 시작되지도 않는다.
// 지구 궤도의 0.55~1.6배 대역에 두면 왕복이 짧고, 그 대역의 이웃(수성·금성·
// 화성·소행성대)은 전부 가벼워서 밀어 처박기도 쉽다.
const fortBand = (earth) => {
  const rE = Math.hypot(earth.pos.x, earth.pos.y)
  return [Math.max(CFG.A_MIN * 1.2, rE * CFG.FORT_BAND_LO), rE * CFG.FORT_BAND_HI]
}
// …다만 **전부** 거기 두면 조르그는 언제나 태양 근처에서만 나타난다. 판은
// 벨트까지 깔려 있는데 싸움은 늘 안쪽 3분의 1에서만 벌어졌고, 목성 바깥의
// 열 개 남짓한 공은 한 판 내내 배경이었다. 그래서 일부는 바깥에 세운다
// (CFG.FORT_OUTER_* — 근거는 거기 주석에).
const fortOuterBand = (earth) => {
  const rE = Math.hypot(earth.pos.x, earth.pos.y)
  return [rE * CFG.FORT_OUTER_BAND[0], rE * CFG.FORT_OUTER_BAND[1]]
}

function warpBody(rng, bodies, aMax, spec) {
  const type = spec.type ?? pickBiome(rng, 0.5)
  const mu = spec.mu * (TYPE_MU_MUL[type] ?? 1) * CFG.MU_SCALE   // 얼음은 가볍다 + 전역 배율
  // 덩치는 질량에서 오되, 대형 요새는 거기에 한 겹 더 얹는다(rMul).
  // **체력이 곧 크기**여야 "저건 두 방짜리"가 한눈에 읽힌다.
  const radius = radiusOf(mu) * (spec.rMul ?? 1)
  const find = (zone, near) => zone ? freeOrbit(rng, bodies, aMax, radius, near ? zone.near : 0, zone.band) : null
  // 요새는 ① 제 대역 안에서 ② 밀 수 있는 공 옆자리에 놓는다.
  // 못 찾으면 제약을 푸는데, **푸는 순서가 곧 규칙**이다 — 대역보다 옆자리가 먼저다.
  // 밀 수 있는 공이 하나도 없는 자리에 선 요새는 안쪽이든 바깥이든 플레이어가
  // 손댈 수 없는 표적이고(플레이테스트: 1스테이지 810수 중 요새에 피해를 주는
  // 수가 0개였던 원인이 정확히 이것이다), 그건 "멀어서 어렵다"가 아니라
  // "이 판에는 답이 없다"이다. 반면 안쪽에 설 자리가 없어 바깥에 서는 것은
  // 여전히 성립하는 판이다.
  //   ① 제 대역 + 옆자리  ② 반대 대역 + 옆자리  ③ 제 대역만  ④ 안팎을 합친 대역
  // ④까지가 "지구가 손댈 수 있는 거리"다. 예전에는 여기서 대역을 통째로 놓아
  // 성계 전체를 뒤졌고, 그래서 후반 판의 요새가 지구 궤도의 4.2배 밖에 앉는
  // 일이 있었다(계측: 6스테이지에서 180기 중 18기).
  // ※ 옆자리 폭은 대역이 정한다(zone.near): 바깥은 궤도가 성겨서 안쪽
  //   기준(150)을 그대로 쓰면 통과하는 자리가 아예 없다.
  const orb = (spec.role === 'battery'
    ? find(spec.zone, true) ?? find(spec.alt, true) ?? find(spec.zone, false) ?? find(spec.span, false)
    : null)
    ?? freeOrbit(rng, bodies, aMax, radius)
  if (!orb) return null
  const b = makeBody({
    id: nextId(),
    name: spec.name,
    mu, radius,
    pos: orb.pos, vel: orb.vel,
    type,
    // 조르그가 보낸 것은 체력 1 — 제대로 한 번 처박으면 끝난다
    hp: spec.hp ?? CFG.ZORG_HP,
    // 추진기 — 3스테이지부터 요새에만 하나씩 실린다(횟수 제한 없음).
    // 하는 일은 하나뿐이다: 꽂히는 탄을 알아채면 옆으로 비켜선다.
    boost: spec.boost ?? 0,
    zorg: true, warp: 1,            // warp: 1 → 0 으로 렌더러가 실시간 감쇠시킨다
  })
  if (spec.role === 'battery') { b.role = 'battery'; b.isTarget = true }
  if (b.role === 'void') { b.mu = Math.max(b.mu, 900); b.radius = radiusOf(b.mu) }
  return b
}

// 조르그 요새로 쓸 종류 — 가스(터짐)·특이점(못 부숨)은 제외한다.
// 가스 요새는 핵 한 방에 제 유폭으로 죽어 표적 구실을 못 하고,
// 특이점 요새는 아예 부술 수가 없어서 판이 성립하지 않는다.
const FORT_TYPES = ['rock', 'rock', 'iron']   // 요새는 암석이 기본, 가끔 금속(안 밀리는 표적)
// 큐볼로 굴러오는 중립 천체 종류 — 다섯 태그 중 넷(금속·가스·얼음·특이점)이
// 여기서 나온다. 남은 하나(조르그 요새)는 위의 증원 경로에서만 붙는다.
const NEUTRAL_TYPES = ['rock', 'ice', 'ice', 'iron', 'gas', 'void']

// ── 배역서 ──────────────────────────────────────────────────────
// 요새 한 기와 중립 한 기를 만드는 규칙. 판이 열릴 때(reinforce)와 모함이
// 보충으로 보낼 때(summonFort·summonCue)가 **같은 규칙**을 써야 한다 —
// 갈라 두면 "판이 열릴 때 온 요새"와 "중간에 온 요새"가 다른 물건이 된다.
const muFor = (rng, ante) => 120 + rng.next() * (220 + 60 * ante)
// 요새 질량은 따로 잡는다 — **밀리는 공이어야 한다.**
// 예전엔 중립과 같은 대역(138~460)을 썼는데, μ=422 요새는 3Mt에 Δv가 0.6이라
// 밀어도 제자리였고, 어쩌다 이웃에 닿아도 상대속도가 데미지 문턱(6) 아래라
// 그냥 튕기기만 했다. 가볍게 잡으면 12Mt에서 Δv 28~57이다.
const fortMuFor = (rng, ante) => CFG.FORT_MU_MIN + rng.next() * (CFG.FORT_MU_SPAN + 14 * ante)
const zorgName = (rng, tag) => `Zorg ${ZORG_NAMES[rng.int(0, ZORG_NAMES.length - 1)]}-${tag}`

// outer = 바깥 대역에 세우는가. 부르는 쪽이 정한다 — 판이 열릴 때(reinforce)는
// **마릿수로** 섞어 안팎이 반드시 함께 오게 하고, 모함이 보충으로 보낼 때는
// 같은 비율로 추첨한다. 규칙 자체(대역·옆자리 폭)는 여기 한 곳에만 둔다.
const canSpawnOuter = (stageIdx) => stageIdx >= CFG.FORT_OUTER_STAGE
function fortSpec(rng, earth, ante, stageIdx, tag, heavy, outer = false) {
  const inner = { band: fortBand(earth), near: CFG.FORT_NEAR_BAND }
  const out = { band: fortOuterBand(earth), near: CFG.FORT_OUTER_NEAR_BAND }
  return {
    name: zorgName(rng, tag),
    // 요새는 반격탄을 쏘므로 그 자체가 위협이다 — 이게 반드시 없애야 할 표적.
    // 금속으로 지어진 요새는 잘 안 밀린다(태그가 둘 붙는다) — 종류가 곧 공략법이다.
    type: FORT_TYPES[rng.int(0, FORT_TYPES.length - 1)],
    role: 'battery',
    // 자리 찾기가 쓰는 세 구역 — 원하는 곳 / 반대쪽 / 둘을 합친 폭 (warpBody 참고)
    zone: outer ? out : inner,
    alt: outer ? inner : out,
    span: { band: [inner.band[0], out.band[1]], near: out.near },
    mu: fortMuFor(rng, ante) * (heavy ? CFG.FORT_HEAVY_MU : 1),
    hp: heavy ? CFG.FORT_HEAVY_HP : CFG.ZORG_HP,
    rMul: heavy ? CFG.FORT_HEAVY_R : 1,
    // 회피 분사는 3스테이지부터. 한 판에 한 번, 요새마다 하나씩.
    boost: stageIdx >= CFG.FORT_DODGE_STAGE ? 1 : 0,
  }
}

function neutralSpec(rng, ante, stageIdx, tag, forceVoid = false) {
  // 특이점은 **3스테이지에 반드시 한 번** 등장시킨다. 추첨에만 맡기면
  // 다섯 태그 중 하나를 끝까지 못 보고 런이 끝난다(계측: 9스테이지까지 0회).
  let type = NEUTRAL_TYPES[rng.int(0, NEUTRAL_TYPES.length - 1)]
  if (forceVoid) type = 'void'
  else if (type === 'void' && stageIdx < 2) type = 'ice'
  return { mu: muFor(rng, ante), name: `${zorgName(rng, tag)}`, type }
}

// 만들어 놓고 붙일 것 — 금속 요새는 장갑 태그를 겹쳐 얹는다.
const dressFort = (b) => { if (b && b.type === 'iron') b.mods = ['armor']; return b }

// ── 요새 한 기를 실제로 세운다 ──────────────────────────────────
// **판이 열릴 때(reinforce)와 모함이 보충할 때(summonFort)가 이 함수 하나를
// 같이 쓴다.** 갈라 두면 "판이 열릴 때 온 요새"와 "중간에 온 요새"가 다른
// 물건이 되는데, 화면에서 둘은 구분되지 않으므로 그건 그냥 규칙이 두 개인 것이다.
//
// 바깥에 세울 요새는 **안쪽이라는 물러설 자리**가 있다. 그래서 바깥 시도는
// 도달 검사를 끝까지 지키고(맞힐 수 없는 자리면 그냥 버린다), 안쪽 시도만
// 마지막에 검사를 건너뛴다 — 요새를 아예 안 보내는 것보다는 낫기 때문이다.
// 그래서 "바깥 요새"는 언제나 **닿을 수 있는** 바깥 요새다(계측: 720발 전수
// 조사에서 한 발도 안 꽂히는 요새가 안팎 모두 0기).
//
// verifyInner — 안쪽 자리까지 도달 검사를 돌릴 것인가. **부르는 쪽의 시간
// 예산이 다르기 때문에** 나뉜다: 판 전환(reinforce)은 어차피 막이 내려가 있어
// 수백 ms를 써도 되지만, 모함의 보충(summonFort)은 판이 굴러가는 중에 프레임
// 안에서 돈다 — 거기서 검사를 다 돌리면 중앙 50ms·최대 173ms짜리 멈칫이
// 생긴다(계측). 안쪽 자리는 원래 가까워서 검사를 통과하는 자리이므로
// (720발 전수조사에서 0기), 여기서 아끼는 것이 잃는 것보다 크다.
function placeFort(rng, pool, earth, aMax, ante, stageIdx, tag, heavy, wantOuter, verifyInner) {
  for (const outer of wantOuter ? [true, false] : [false]) {
    const spec = fortSpec(rng, earth, ante, stageIdx, tag, heavy, outer)
    // 이 시도들에만 검사를 건다(나머지는 그냥 통과). 판 전환은 예산이 넉넉해
    // 바깥 세 번·안쪽 두 번을 다 보고, 프레임 안에서 도는 보충은 바깥 한 번만
    // 본다 — 한 번에 떨어지면 안쪽으로 물리면 되므로 그 한 번이면 충분하다.
    const checks = verifyInner ? (outer ? 3 : 2) : (outer ? 1 : 0)
    for (let t = 0; t < 3; t++) {
      const b = warpBody(rng, pool, aMax, spec)
      if (!b) continue
      if (t >= checks || reachable(pool.concat([b]), earth, b, aMax)) return dressFort(b)
    }
  }
  return null
}

// ── 조르그 모함 ─────────────────────────────────────────────────
// 궤도 **바깥**에 앉는다. 요새 대역(지구 궤도 0.55~1.6배)보다 멀어서
// 한 발로 닿기 어렵고, 그래서 "지금 저것부터 칠 것인가"가 판단이 된다.
const hiveBand = (earth) => {
  const rE = Math.hypot(earth.pos.x, earth.pos.y)
  return [rE * CFG.HIVE_BAND[0], rE * CFG.HIVE_BAND[1]]
}

function makeHive(rng, bodies, aMax, earth, stageIdx) {
  const band = hiveBand(earth)
  // 제약을 하나씩 풀며 자리를 찾되, 마지막 폴백은 **대역을 푸는 게 아니라
  // 이웃 간격을 푼다**(rNew를 작게 줘서 요구 간격을 낮춘다). 대역을 풀었더니
  // 모함이 지구 궤도의 3.6배 밖에 앉아 "저기까지 공을 굴려라"가 됐다(계측) —
  // 이웃에 좀 붙는 건 오히려 낫다. 어차피 공을 맞아야 부서지는 물건이다.
  // 그래도 자리가 없으면 이번 판에는 안 온다(다음 판에 다시 시도한다).
  const orb = freeOrbit(rng, bodies, aMax, CFG.HIVE_R, CFG.HIVE_NEAR_BAND, band)
    ?? freeOrbit(rng, bodies, aMax, CFG.HIVE_R, 0, band)
    ?? freeOrbit(rng, bodies, aMax, CFG.HIVE_R, 0, [band[0] * 0.8, band[1] * 1.15])
    ?? freeOrbit(rng, bodies, aMax, CFG.HIVE_R * 0.3, 0, [band[0] * 0.8, band[1] * 1.15])
  if (!orb) return null
  const b = makeBody({
    id: nextId(), name: `Zorg ${ZORG_NAMES[rng.int(0, ZORG_NAMES.length - 1)]} Prime`,
    type: 'hive', mu: CFG.HIVE_MU, radius: CFG.HIVE_R,
    pos: orb.pos, vel: orb.vel, hp: CFG.HIVE_HP,
    zorg: true, warp: 1,
  })
  b.role = 'hive'; b.isTarget = true
  return b
}

// 모함이 한 기 보낸다 — 판이 열릴 때와 같은 규칙으로 만들고, 자리도 같은
// 제약(밀 수 있는 공 옆자리·지구에서 닿는 자리)으로 찾는다.
export function summonFort(rng, bodies, earth, ante, stageIdx, tag) {
  // 안팎 비율은 판이 열릴 때와 같다 — 다만 한 기씩 오므로 마릿수가 아니라 추첨이다.
  const outer = canSpawnOuter(stageIdx) && rng.next() < CFG.FORT_OUTER_FRAC
  // verifyInner=false — 이 경로는 판이 굴러가는 중에 프레임 안에서 돈다(위 주석)
  return placeFort(rng, bodies, earth, aMaxOf(ante), ante, stageIdx, tag, false, outer, false)
}
export function summonCue(rng, bodies, earth, ante, stageIdx, tag) {
  const b = warpBody(rng, bodies, aMaxOf(ante), neutralSpec(rng, ante, stageIdx, tag))
  if (b) b.zorg = false            // 굴러온 잔챙이 — 큐볼로 쓴다
  return b
}

// ── 증원 ────────────────────────────────────────────────────────
// 지금 성계에 뭐가 남아 있는지 보고 그만큼만 보낸다. 지난 판에서 판을
// 깨끗이 비웠으면 많이 오고, 중립 행성이 잔뜩 남았으면 적게 온다.
export function reinforce(rng, bodies, earth, ante, stageIdx) {
  const aMax = aMaxOf(ante)
  const live = bodies.filter(b => b.alive && b.type !== 'debris')
  const room = Math.max(0, CFG.SYSTEM_CAP - live.length)

  let fort = Math.round(CFG.REINF_BASE + CFG.REINF_PER_ANTE * ante)
  fort = Math.max(1, Math.min(fort, Math.max(1, room)))
  // 남은 공이 적으면 큐볼로 쓸 중립도 같이 보낸다(조르그 입장에선 소모품이다)
  const cueBalls = live.filter(b => !b.isEarth && !b.zorg).length
  let neutral = Math.min(CFG.REINF_NEUTRAL, Math.max(0, room - fort), cueBalls < 2 ? 2 : 1)
  // 중립은 최소 1기는 보장한다. 예전엔 요새로 자리가 차면 0이 됐는데,
  // 특이점·얼음 같은 태그는 **중립으로만** 굴러오므로 그러면 다섯 태그 중
  // 둘을 끝까지 못 보게 된다(계측: 8스테이지까지 특이점 0회 등장).
  if (room <= fort) neutral = Math.min(1, Math.max(0, room))
  neutral = Math.max(neutral, room > fort ? 1 : 0)

  const added = []

  // ── 난이도 ──
  // 2스테이지부터 **대형 요새**가 섞여 온다. 체력 2라 한 번 처박아서는 안
  // 부서지고 그만큼 크다. 판이 거듭될수록 그 수가 늘어, "이번 판은 지난 판보다
  // 무겁다"가 목표 카운터가 아니라 **공 하나를 더 굴려야 한다**로 나타난다.
  //   판 1: 0기 · 판 2~3: 1기 · 판 4~5: 2기 · 판 6~7: 3기 …
  const heavies = Math.min(fort, Math.floor((stageIdx + 1) / 2))
  // ── 안팎 ──
  // 뒤쪽 몇 기는 **바깥 대역**에 선다(CFG.FORT_OUTER_*). 마릿수로 나누는 것은
  // 추첨과 달리 "이번 판에 바깥 요새가 하나도 안 왔다"가 없기 때문이고,
  // fort - 1로 자르는 것은 **가까운 표적이 언제나 하나는 남게** 하기 위해서다 —
  // 판이 열리자마자 손댈 데가 한 군데도 없으면 그건 난이도가 아니라 벽이다.
  const outers = canSpawnOuter(stageIdx)
    ? Math.min(fort - 1, Math.round(fort * CFG.FORT_OUTER_FRAC))
    : 0

  for (let i = 0; i < fort; i++) {
    const tag = `${stageIdx + 1}${i ? String.fromCharCode(97 + i) : ''}`
    const b = placeFort(rng, bodies.concat(added), earth, aMax, ante, stageIdx, tag,
      i < heavies, i >= fort - outers, true)
    if (b) added.push(b)
  }
  for (let i = 0; i < neutral; i++) {
    const spec = neutralSpec(rng, ante, stageIdx, `${stageIdx + 1}x${i}`, stageIdx === 2 && i === 0)
    const b = warpBody(rng, bodies.concat(added), aMax, spec)
    if (b) { b.zorg = false; added.push(b) }   // 중립으로 굴러온 잔챙이 — 큐볼로 쓴다
  }
  // ── 조르그 모함 ──
  // 안테 5부터, 판에 한 기도 없으면 한 기 온다. 이놈이 살아 있는 동안에는
  // 요새가 계속 다시 차오르므로(game.stepHive), 판을 끝내려면 결국 여기를
  // 끊어야 한다. 자리는 요새 대역 **바깥**이라 한 발로 닿기 어렵다.
  if (ante >= CFG.HIVE_ANTE && !live.some(b => b.role === 'hive')) {
    const h = makeHive(rng, bodies.concat(added), aMax, earth, stageIdx)
    if (h) added.push(h)
  }

  for (const b of added) bodies.push(b)
  return {
    added,
    fortresses: added.filter(b => b.role === 'battery'),
    hives: added.filter(b => b.role === 'hive'),
    aMax,
  }
}
