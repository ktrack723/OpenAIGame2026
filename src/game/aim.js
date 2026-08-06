import { fromAngle } from '../core/vector.js'
import { wrapPi } from '../core/angle.js'
import { CFG, blastRadius, hitRadiusOf } from './config.js'
import { cloneBodies, segCircleEntry, segHitsCircle, stepBodies, stepMissile } from './physics.js'
import { effDv, volatileRadius } from './roles.js'

// ─── 조준 보조 — game.js에서 떼어낸 순수 계산부 ───────────────────
// 상태를 바꾸는 건 scanContact/findIntercept가 game.aim·game.power를 쓰는 것뿐이고,
// 나머지는 전부 판을 복제해 굴려 보기만 한다. game.js는 얇은 래퍼만 남긴다.

const EMPTY_PRED = { pts: [], outcome: null, hit: null }

// ─── 조준 보조 (§14.3 개정) ─────────────────────────────────
// "공을 쳐서 뭔 일이 날지"는 알려주지 않는다. 알려주는 건 딱 두 가지:
//   ① 핵이 어디에 닿는가 (= 어느 살을 치는가)
//   ② 그 결과 공이 어느 방향으로 얼마나 밀려나기 시작하는가
// 그 뒤 판이 어떻게 굴러갈지는 플레이어가 읽어야 한다.
export function predictPath(game) {
  if (!game.canAim) return EMPTY_PRED
  const key = `${game.aim.toFixed(5)}|${game.power}|${game.yieldMt}|${game.stageIdx}|${game.time.toFixed(3)}|${game.rockets}|${game.bodies.length}`
  if (game._predKey === key) return game._pred
  const now = performance.now()
  if (game._pred && now - (game._predAt || 0) < 45) return game._pred
  game._predAt = now

  const sim = cloneBodies(game.bodies)
  const p = game.launchPos()
  const m = { pos: { ...p }, vel: fromAngle(game.aim, game.power), age: 0, pathN: 0, path: [], minSunDist: Infinity, prev: { ...p } }
  // 날아오는 반격탄도 같이 굴린다 — 안 그러면 공중 요격은 순전히 운이 된다
  const foes = game.missiles.filter(f => f.alive).map(f => ({
    pos: { ...f.pos }, vel: { ...f.vel }, yld: f.yld, age: f.age,
    pathN: 0, path: [], minSunDist: Infinity, prev: { ...f.pos },
  }))
  const pts = [{ ...p }]
  let outcome = 'timeout', hit = null
  const steps = Math.round(CFG.MISSILE_TTL / CFG.DT)
  for (let i = 0; i < steps; i++) {
    stepBodies(sim, CFG.DT)
    stepMissile(m, sim, CFG.DT)
    if (i % 6 === 0) pts.push({ x: m.pos.x, y: m.pos.y })
    for (const f of foes) {   // 반격탄도 같은 dt로 굴린다
      if (f.dead) continue
      stepMissile(f, sim, CFG.DT)
      for (const o of sim) {  // 반격탄이 먼저 어딘가에 박히면 요격은 없다
        if (!o.alive) continue
        if (segHitsCircle(f.prev.x, f.prev.y, f.pos.x, f.pos.y, o.pos.x, o.pos.y, hitRadiusOf(o))) { f.dead = true; break }
      }
    }
    // 천체 명중이 요격보다 먼저다 — step()에서도 미사일 루프(contact)가
    // missilePairs()보다 앞에 있으므로 순서를 그대로 맞춘다.
    let bodyHit = null, point = null, bestD = Infinity
    for (const o of sim) {
      if (!o.alive) continue
      const r = hitRadiusOf(o)
      if (!segHitsCircle(m.prev.x, m.prev.y, m.pos.x, m.pos.y, o.pos.x, o.pos.y, r)) continue
      const q = segCircleEntry(m.prev.x, m.prev.y, m.pos.x, m.pos.y, o.pos.x, o.pos.y, r)
      const d = Math.hypot(q.x - m.prev.x, q.y - m.prev.y)
      if (d < bestD) { bestD = d; bodyHit = o; point = q }
    }
    if (bodyHit) {
      pts.push({ x: point.x, y: point.y })
      hit = impactInfo(game, bodyHit, point, sim.find(o => o.isEarth))
      outcome = hit.outcome
      break
    }
    const foe = foes.find(f => !f.dead && Math.hypot(f.pos.x - m.pos.x, f.pos.y - m.pos.y) <= 2 * CFG.MISSILE_HIT_R)
    if (foe) {
      const x = (foe.pos.x + m.pos.x) / 2, y = (foe.pos.y + m.pos.y) / 2
      pts.push({ x, y })
      hit = interceptInfo(game, x, y, game.yieldMt + foe.yld)
      outcome = 'intercept'
      break
    }
    const r = Math.hypot(m.pos.x, m.pos.y)
    if (r < CFG.R_STAR + 8) { outcome = 'sun'; pts.push({ x: m.pos.x, y: m.pos.y }); break }
    if (r > 2.8 * game.aMax) { outcome = 'lost'; pts.push({ x: m.pos.x, y: m.pos.y }); break }
  }
  game._predKey = key
  game._pred = { pts, outcome, hit }
  return game._pred
}

// ─── 접촉각 탐색 (§14.3) ────────────────────────────────────
// 계측 결과 360° 중 뭔가에 닿는 각도가 99칸뿐이고, 그중 67칸이 지구였다.
// 즉 슬라이더를 돌리는 시간의 대부분이 "여긴 아님"을 확인하는 데 쓰인다.
// 기획 의도가 "어느 각도에서 칠 수 있는지는 알려준다"이므로, 그 확인을
// 버튼 한 번으로 대신한다. **어느 공을 어느 살로 칠지는 여전히 플레이어 몫**이다.
// 거친 적분(dt 1/40)으로 훑고, 찾은 각도는 다음 프레임에 정식 예측이 확정한다.
// 한 번 누를 때마다 "다음 선택지"로 간다 — 지금 물고 있는 구간을 먼저 빠져나온
// 다음에 찾는다. 같은 구간 안에서의 미세 조정은 방향키(±0.5~2°)가 맡는다.
export function scanContact(game, dir = 1) {
  if (!game.canAim) return false
  const step = dir * Math.PI / 180
  const ok = (h) => h && h !== 'earth' && h !== 'debris'
  let i = 1
  if (ok(coarseContact(game, game.aim))) {          // 이미 맞고 있으면 그 구간을 통과
    while (i <= 360 && ok(coarseContact(game, game.aim + step * i))) i++
  }
  for (; i <= 360; i++) {
    const ang = game.aim + step * i
    if (!ok(coarseContact(game, ang))) continue
    game.aim = wrapPi(ang)
    game._predKey = null; game._predAt = 0
    return true
  }
  game.setToast('이 발사 속도로는 닿는 각도가 없다 — 속도를 바꿔라')
  return false
}

// ─── 요격각 탐색 ────────────────────────────────────────────
// 요격 창은 각도 1° 미만이라 접촉각 버튼(1° 간격)으로는 그냥 건너뛴다.
// 그래서 "닿는가"를 훑는 대신 **반격탄과의 최소 접근거리를 각도의 함수로 보고
// 그 최소점을 찾는다**. 굵게 72방향 → 절반씩 좁히며 정밀화.
// 발사 속도도 같이 훑는다 — 각도만으로는 대부분의 판에서 해가 없다(계측 2/24).
export function findIntercept(game) {
  if (!game.canAim || !game.missiles.some(f => f.alive)) return false
  const powers = [CFG.LAUNCH_MIN, 24, 30, 36, 42, CFG.LAUNCH_MAX]
  let best = { d: Infinity, a: game.aim, pw: game.power }
  for (const pw of powers) {
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2
      const d = interceptMiss(game, a, pw)
      if (d < best.d) best = { d, a, pw }
    }
  }
  for (let step = 8; step >= 0.2; step /= 2) {   // 최소점 근처를 절반씩 좁힌다
    for (const s of [-step, step]) {
      const a = best.a + s * Math.PI / 180
      const d = interceptMiss(game, a, best.pw)
      if (d < best.d) best = { d, a, pw: best.pw }
    }
  }
  game.aim = wrapPi(best.a)
  game.power = best.pw
  // 거친 적분(dt 1/40)이 "만난다"고 해도 실제 적분(1/120)에선 다를 수 있다.
  // 정식 예측으로 확정한 결과만 플레이어에게 말한다.
  game._predKey = null; game._predAt = 0
  if (predictPath(game).outcome === 'intercept') {
    game.setToast('요격각 확보 — 두 탄두가 만난다')
    return true
  }
  game.setToast(`요격 불가 — 최소 접근 ${best.d.toFixed(0)} GU (이 판에선 안 만난다)`)
  return false
}

// 이 각도·속도로 쐈을 때 반격탄과 가장 가까워지는 거리 (둘 중 하나가 죽으면 거기까지)
export function interceptMiss(game, ang, pw = game.power) {
  const foeSrc = game.missiles.find(f => f.alive)
  if (!foeSrc) return Infinity
  const sim = cloneBodies(game.bodies)
  const dt = 1 / 40
  const p = { x: game.earth.pos.x + Math.cos(ang) * CFG.LAUNCH_OFFSET, y: game.earth.pos.y + Math.sin(ang) * CFG.LAUNCH_OFFSET }
  const m = { pos: { ...p }, vel: fromAngle(ang, pw), age: 0, pathN: 0, path: [], minSunDist: Infinity, prev: { ...p } }
  const f = { pos: { ...foeSrc.pos }, vel: { ...foeSrc.vel }, age: foeSrc.age, pathN: 0, path: [], minSunDist: Infinity, prev: { ...foeSrc.pos } }
  let min = Infinity
  const steps = Math.round(CFG.MISSILE_TTL / dt)
  const dies = (q) => {
    for (const o of sim) {
      if (!o.alive) continue
      if (segHitsCircle(q.prev.x, q.prev.y, q.pos.x, q.pos.y, o.pos.x, o.pos.y, hitRadiusOf(o))) return true
    }
    const r = Math.hypot(q.pos.x, q.pos.y)
    return r < CFG.R_STAR + 8 || r > 2.8 * game.aMax
  }
  for (let i = 0; i < steps; i++) {
    stepBodies(sim, dt)
    stepMissile(m, sim, dt); stepMissile(f, sim, dt)
    min = Math.min(min, Math.hypot(m.pos.x - f.pos.x, m.pos.y - f.pos.y))
    if (dies(m) || dies(f)) break
  }
  return min
}

// 거친 접촉 판정 — 무엇에 닿는지만 본다(폭심·임펄스는 계산하지 않는다).
// 공중 요격도 유효한 접촉으로 친다 — 반격탄이 날아오는 판에서 요격각을
// 손으로 찾는 건 사실상 불가능하기 때문(계측: 전체 조합의 0.8%).
export function coarseContact(game, ang) {
  const sim = cloneBodies(game.bodies)
  const dt = 1 / 40
  const p = { x: game.earth.pos.x + Math.cos(ang) * CFG.LAUNCH_OFFSET, y: game.earth.pos.y + Math.sin(ang) * CFG.LAUNCH_OFFSET }
  const m = { pos: { ...p }, vel: fromAngle(ang, game.power), age: 0, pathN: 0, path: [], minSunDist: Infinity, prev: { ...p } }
  const foes = game.missiles.filter(f => f.alive).map(f => ({
    pos: { ...f.pos }, vel: { ...f.vel }, age: f.age, pathN: 0, path: [], minSunDist: Infinity, prev: { ...f.pos },
  }))
  const steps = Math.round(CFG.MISSILE_TTL / dt)
  for (let i = 0; i < steps; i++) {
    stepBodies(sim, dt)
    stepMissile(m, sim, dt)
    for (const f of foes) {
      if (f.dead) continue
      stepMissile(f, sim, dt)
      for (const o of sim) {
        if (!o.alive) continue
        if (segHitsCircle(f.prev.x, f.prev.y, f.pos.x, f.pos.y, o.pos.x, o.pos.y, hitRadiusOf(o))) { f.dead = true; break }
      }
    }
    for (const o of sim) {
      if (!o.alive) continue
      if (!segHitsCircle(m.prev.x, m.prev.y, m.pos.x, m.pos.y, o.pos.x, o.pos.y, hitRadiusOf(o))) continue
      if (o.type === 'debris') return 'debris'
      if (o.isEarth) return 'earth'
      return 'body'
    }
    if (foes.some(f => !f.dead && Math.hypot(f.pos.x - m.pos.x, f.pos.y - m.pos.y) <= 2 * CFG.MISSILE_HIT_R)) return 'intercept'
    const r = Math.hypot(m.pos.x, m.pos.y)
    if (r < CFG.R_STAR + 8 || r > 2.8 * game.aMax) return null
  }
  return null
}

// 공중 요격 지점 — 미는 대상이 없으므로 화살표 없이 폭풍 반경만 알려준다
export function interceptInfo(game, x, y, yld) {
  return {
    name: '공중 요격', id: null, type: 'missile', role: null,
    isEarth: false, isTarget: false, outcome: 'intercept',
    x, y, px: x, py: y, r: CFG.MISSILE_HIT_R * 2,
    dx: 0, dy: 0, dv: 0, vx: 0, vy: 0,
    blast: blastRadius(yld), yld, earthInBlast: false,
    vAfter: 0, vEsc: 0, willEject: false, counter: false, volatileR: 0,
  }
}

// 충돌 한 건의 "큐 정보" — 폭심, 임펄스 방향, 타격 직후 공의 진로
export function impactInfo(game, o, point, simEarth) {
  const isT = game.isTarget(o)
  const shielded = o.role === 'shield'
  let outcome = 'neutral'
  if (o.type === 'debris') outcome = 'debris'
  else if (o.isEarth) outcome = 'earth'
  else if (o.role === 'void') outcome = 'void'
  else if (shielded) outcome = 'shield'
  else if (o.role === 'volatile') outcome = 'volatile'
  else if (isT) outcome = 'target'
  let dx = o.pos.x - point.x, dy = o.pos.y - point.y
  const d = Math.hypot(dx, dy) || 1
  dx /= d; dy /= d
  const dv = o.type === 'debris' || o.isEarth || shielded || o.role === 'volatile'
    ? 0 : effDv(o, game.yieldMt)
  const R = blastRadius(game.yieldMt)
  // 큰 탄두는 폭풍이 지구까지 닿는다 — 쏘기 전에 그것만은 알려준다
  const earthInBlast = !!simEarth && !o.isEarth &&
    Math.hypot(simEarth.pos.x - point.x, simEarth.pos.y - point.y) < R
  // 때린 직후의 속도가 그 자리의 탈출속도를 넘는지 — "세게 치면 날아간다"는
  // 큐의 세기에 대한 정보지 판의 결말이 아니다. 작약량을 고르는 유일한 근거.
  const vAfter = Math.hypot(o.vel.x + dx * dv, o.vel.y + dy * dv)
  const vEsc = Math.sqrt(2 * CFG.MU_STAR / Math.max(1, Math.hypot(o.pos.x, o.pos.y)))
  return {
    name: o.name, isEarth: o.isEarth, isTarget: isT, type: o.type, id: o.id,
    outcome, x: o.pos.x, y: o.pos.y, r: hitRadiusOf(o),
    px: point.x, py: point.y,            // 폭심 (공의 어느 살인가)
    dx, dy, dv,                          // 임펄스 방향/크기
    vx: o.vel.x + dx * dv, vy: o.vel.y + dy * dv,   // 타격 직후 공의 속도
    blast: R, earthInBlast, vAfter, vEsc, willEject: dv > 0 && vAfter > vEsc,
    role: o.role ?? null,
    // 요새를 치면 임펄스의 정반대로 반격탄이 나온다 — 그것까지가 "이 한 방"의 정보다.
    // 단 방어막에 삼켜지는 샷은 기폭 자체가 없으므로 반격도 없다(detonate가 먼저 리턴).
    counter: o.role === 'battery' && (o.ammo ?? 0) > 0 && !shielded && !o.isEarth && o.type !== 'debris',
    volatileR: o.role === 'volatile' ? volatileRadius(o) : 0,
  }
}
