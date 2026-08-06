import { Rng } from '../core/random.js'
import { CFG, aMaxOf, beltRadius, hitRadiusOf, radiusOf } from './config.js'
import { makeBody } from './body.js'
import { cloneBodies, segHitsCircle, stepBodies, stepMissile } from './physics.js'
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
function freeOrbit(rng, bodies, aMax, mu) {
  const live = bodies.filter(b => b.alive && b.type !== 'debris')
  const radii = live.map(b => Math.hypot(b.pos.x, b.pos.y))
  const rNew = radiusOf(mu)
  for (let tries = 0; tries < 240; tries++) {
    // 안쪽 절반은 태양에 너무 가깝고 바깥은 벨트라 [1.15 A_MIN, 0.95 aMax]
    const a = CFG.A_MIN * 1.15 + rng.next() * (aMax * 0.95 - CFG.A_MIN * 1.15)
    // 궤도 반경이 기존 공들과 최소 이만큼은 벌어져야 서로 안 스친다.
    // 공이 스무 개까지 늘어난 지금 예전의 고정 90 GU로는 빈 궤도가 아예 없다 —
    // 새로 오는 공의 크기에 비례한 값으로 바꿔 촘촘한 성계에도 끼워 넣는다.
    let ok = true
    for (const r of radii) if (Math.abs(a - r) < 26 + rNew * 2.5) { ok = false; break }
    if (!ok) continue
    const e = 0.01 + rng.next() * 0.06
    const w = rng.range(0, Math.PI * 2)
    for (let k = 0; k < 24; k++) {
      const nu = rng.range(0, Math.PI * 2)
      const st = elementsToState(a, e, w, nu)
      let clear = true
      for (const b of live) {
        const d = Math.hypot(st.pos.x - b.pos.x, st.pos.y - b.pos.y)
        // 지구 근처에 떨어뜨리면 첫 수도 두기 전에 지구가 날아간다
        const need = (b.isEarth ? 5 : 2.6) * (hitRadiusOf(b) + rNew * CFG.HIT_R)
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
// 40초 지평·dt 1/40으로 돌렸다가 판 전환이 평균 3.6초(최대 9.1초) 걸렸다.
// 프로브를 줄이고 지평·해상도를 낮춰 24샷/30초/dt 1/25로 내렸다.
// "한 발이라도 닿는가"만 보면 되므로 이 해상도로 충분하다.
const PROBE_ANGLES = 12, PROBE_POWERS = [32, 44, 56]
function reachable(bodies, earth, target) {
  const dt = 1 / 25, steps = Math.round(40 / dt)
  const tIdx = bodies.indexOf(target)
  if (tIdx < 0) return false
  const rMax = beltRadius(aMaxOf(8))
  for (const pw of PROBE_POWERS) {
    for (let ai = 0; ai < PROBE_ANGLES; ai++) {
      const ang = ai / PROBE_ANGLES * Math.PI * 2
      const sim = cloneBodies(bodies)
      const p = { x: earth.pos.x + Math.cos(ang) * CFG.LAUNCH_OFFSET, y: earth.pos.y + Math.sin(ang) * CFG.LAUNCH_OFFSET }
      const m = {
        pos: { ...p }, vel: { x: Math.cos(ang) * pw, y: Math.sin(ang) * pw },
        age: 0, pathN: 0, path: [], minSunDist: Infinity, prev: { ...p },
      }
      for (let i = 0; i < steps; i++) {
        stepBodies(sim, dt)
        stepMissile(m, sim, dt)
        let hit = -1
        for (let k = 0; k < sim.length; k++) {
          if (!sim[k].alive) continue
          if (segHitsCircle(m.prev.x, m.prev.y, m.pos.x, m.pos.y, sim[k].pos.x, sim[k].pos.y, hitRadiusOf(sim[k]))) { hit = k; break }
        }
        if (hit >= 0) { if (hit === tIdx) return true; break }
        const r = Math.hypot(m.pos.x, m.pos.y)
        if (r < CFG.R_STAR + 8 || r > rMax) break
      }
    }
  }
  return false
}

// ── 워프인 한 기 ────────────────────────────────────────────────
function warpBody(rng, bodies, aMax, spec) {
  const mu = spec.mu
  const orb = freeOrbit(rng, bodies, aMax, mu)
  if (!orb) return null
  const b = makeBody({
    id: nextId(),
    name: spec.name,
    mu, radius: radiusOf(mu),
    pos: orb.pos, vel: orb.vel,
    type: spec.type ?? pickBiome(rng, orb.a / aMax),
    hp: CFG.PLANET_HP,
    zorg: true, warp: 1,            // warp: 1 → 0 으로 렌더러가 실시간 감쇠시킨다
  })
  if (spec.role === 'battery') { b.role = 'battery'; b.ammo = CFG.BATTERY_AMMO; b.isTarget = true }
  if (b.role === 'void') { b.mu = Math.max(b.mu, 900); b.radius = radiusOf(b.mu) }
  return b
}

// 조르그 요새로 쓸 종류 — 가스(터짐)·특이점(못 부숨)은 제외한다.
// 가스 요새는 핵 한 방에 제 유폭으로 죽어 표적 구실을 못 하고,
// 특이점 요새는 아예 부술 수가 없어서 판이 성립하지 않는다.
const FORT_TYPES = ['rock', 'iron', 'lava', 'toxic']
// 큐볼로 굴러오는 중립 천체 종류 — 넷 중 셋(금속·가스·특이점)이 여기서 나온다
const NEUTRAL_TYPES = ['rock', 'ice', 'ocean', 'iron', 'gas', 'lava', 'toxic', 'void']

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
  if (room <= fort) neutral = 0

  const added = []
  const muFor = () => 120 + rng.next() * (220 + 60 * ante)

  for (let i = 0; i < fort; i++) {
    const name = `Zorg ${ZORG_NAMES[rng.int(0, ZORG_NAMES.length - 1)]}-${stageIdx + 1}${i ? String.fromCharCode(97 + i) : ''}`
    // 요새는 반격탄을 쏘므로 그 자체가 위협이다 — 이게 반드시 없애야 할 표적.
    // 금속으로 지어진 요새는 잘 안 밀린다(태그가 둘 붙는다) — 종류가 곧 공략법이다.
    const type = FORT_TYPES[rng.int(0, FORT_TYPES.length - 1)]
    let b = null
    const pool2 = bodies.concat(added)
    for (let t = 0; t < 2 && !b; t++) {
      b = warpBody(rng, pool2, aMax, { mu: muFor() * 1.15, name, type, role: 'battery' })
      // 마지막 시도는 검사를 건너뛴다 — 못 찾고 요새를 아예 안 보내는 것보다 낫다
      if (b && t === 0 && !reachable(pool2.concat([b]), earth, b)) b = null
    }
    if (!b) continue
    if (type === 'iron') b.mods = ['armor']   // 금속 요새 — 핵으로는 거의 안 밀린다
    added.push(b)
  }
  for (let i = 0; i < neutral; i++) {
    // 특이점은 안테 6부터만 굴러온다 — 부술 수 없는 공은 늦게 가르친다
    let type = NEUTRAL_TYPES[rng.int(0, NEUTRAL_TYPES.length - 1)]
    if (type === 'void' && stageIdx < 6) type = 'rock'
    const b = warpBody(rng, bodies.concat(added), aMax, {
      mu: muFor(), name: `${ZORG_NAMES[rng.int(0, ZORG_NAMES.length - 1)]}-${stageIdx + 1}x${i}`, type,
    })
    if (b) { b.zorg = false; added.push(b) }   // 중립으로 굴러온 잔챙이 — 큐볼로 쓴다
  }

  for (const b of added) bodies.push(b)
  return { added, fortresses: added.filter(b => b.role === 'battery'), aMax }
}

// 본성 지정 — 살아있는 요새 중 하나가 레이저를 쏜다.
// 본성이 죽으면 다음 요새가 지휘권을 승계한다(레이저가 끊기지 않는다).
export function pickHomeworld(bodies) {
  const forts = bodies.filter(b => b.alive && b.role === 'battery')
  if (!forts.length) return null
  const cur = forts.find(b => b.homeworld)
  if (cur) return cur
  // 가장 무거운 요새가 본성이 된다 — 시각적으로도 제일 크다
  const next = forts.reduce((a, b) => (b.mu > a.mu ? b : a))
  next.homeworld = true
  return next
}
