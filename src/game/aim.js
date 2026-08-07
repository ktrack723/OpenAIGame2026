import { fromAngle } from '../core/vector.js'
import { wrapPi } from '../core/angle.js'
import { CFG, beltRadius, blastRadius, counterSpeed, escapeSpeed, hitRadiusOf } from './config.js'
import { beltBounce, cloneBodies, segCircleEntry, segHitsCircle, stepBodies, stepMissile } from './physics.js'
import { effDv, volatileRadius } from './roles.js'

// ─── 조준 보조 — game.js에서 떼어낸 순수 계산부 ───────────────────
// 상태를 바꾸는 건 scanContact가 game.aim을 쓰는 것뿐이고,
// 나머지는 전부 판을 복제해 굴려 보기만 한다. game.js는 얇은 래퍼만 남긴다.

const EMPTY_PRED = { pts: [], outcome: null, hit: null }

// ─── 예측 전용 시간 진행 ────────────────────────────────────────
// 미사일은 촘촘하게, 천체는 성기게 굴린다. 행성이 스무 개로 늘면서
// stepBodies(O(n²))가 예측 비용의 8할을 차지하게 됐는데, 정작 행성은
// 초당 20 GU 남짓으로 움직인다 — 1/24초 간격이면 위치 오차가 1 GU 미만이고
// 명중 반경이 10 GU 이상이라 판정이 뒤집히지 않는다. 비용만 5배 아낀다.
// (미사일 자신은 여전히 실제와 같은 dt로 적분하므로 궤적은 거짓말하지 않는다.)
const BODY_EVERY = 5          // 정밀 예측: 미사일 5스텝마다 천체 1스텝
const COARSE_BODY_EVERY = 4   // 거친 탐색: 그보다 더 성기게

// i번째 미사일 스텝에서 천체를 굴려야 하는가. 구간 중앙에서 굴려 편향을 없앤다.
const bodyTurn = (i, every) => i % every === (every >> 1)

// ─── 조준 보조 (§14.3 개정) ─────────────────────────────────
// "공을 쳐서 뭔 일이 날지"는 알려주지 않는다. 알려주는 건 딱 두 가지:
//   ① 핵이 어디에 닿는가 (= 어느 살을 치는가)
//   ② 그 결과 공이 어느 방향으로 얼마나 밀려나기 시작하는가
// 그 뒤 판이 어떻게 굴러갈지는 플레이어가 읽어야 한다.
export function predictPath(game) {
  if (!game.canAim) return EMPTY_PRED
  // 시간은 0.25초 단위로 뭉갠다 — 관측 중(시계가 흐를 때) 매 프레임 다시 푸는 걸
  // 막는 장치다. 조준 중에는 시계가 멈춰 있으므로 예측은 항상 정확하고,
  // 시계가 흐르는 동안엔 초당 4번만 갱신된다(예측 1회가 15ms대라 그게 곧 프레임이다).
  const key = `${game.aim.toFixed(5)}|${game.power}|${game.yieldMt}|${game.stageIdx}|${Math.floor(game.time * 4)}|${game.shots}|${game.bodies.length}`
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
  const beltR = beltRadius(game.aMax)
  const steps = Math.round(CFG.MISSILE_TTL / CFG.DT)
  for (let i = 0; i < steps; i++) {
    if (bodyTurn(i, BODY_EVERY)) stepBodies(sim, CFG.DT * BODY_EVERY)
    stepMissile(m, sim, CFG.DT)
    if (i % 8 === 0) pts.push({ x: m.pos.x, y: m.pos.y })
    for (const f of foes) {   // 반격탄도 같은 dt로 굴린다
      if (f.dead) continue
      stepMissile(f, sim, CFG.DT)
      if (Math.hypot(f.pos.x, f.pos.y) >= beltR) beltBounce(f, beltR)
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
    // 카이퍼 벨트 반사 — 실제 판정(game.missileBounds)과 같은 함수를 쓴다.
    // 예측선이 벨트를 무시하면 "쐈더니 딴 데로 튀는" 거짓말이 된다.
    if (r >= beltR) {
      const bp = beltBounce(m, beltR)
      if (bp) { pts.push({ x: bp.x, y: bp.y }); pts.push({ x: m.pos.x, y: m.pos.y }) }
    }
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
// 탐색 해상도 — 1.5°씩 240칸.
//
// ※ 플레이테스트에서 이 버튼이 한 번에 2.4~3.4초씩 화면을 얼렸다(행성 17개).
//   원인은 "지금 맞고 있는 구간을 빠져나온 다음 다시 닿는 각도를 찾는" 방식이었다.
//   공이 열댓 개면 **거의 모든 각도가 뭔가에 닿기 때문에** 그 구간 통과 루프가
//   240칸을 거의 다 돌았고, 한 칸이 곧 52초짜리 시뮬 한 번이었다.
//
//   고쳐 쓴 규칙: **"다음 다른 천체"에서 멈춘다.** 플레이어가 이 버튼에 바라는
//   것도 그것이다("딴 공을 보여줘"). 지금 물고 있는 공과 id가 다른 순간 끝나므로
//   보통 몇 칸 안에 끝나고, 결과적으로 얼음도 사라진다.
const SCAN_DEG = 1.5, SCAN_N = 240
export function scanContact(game, dir = 1) {
  if (!game.canAim) return false
  const step = dir * SCAN_DEG * Math.PI / 180
  const usable = (h) => h && h !== 'earth' && h !== 'debris'
  const cur = coarseContact(game, game.aim)          // 지금 물고 있는 공(없으면 null)
  for (let i = 1; i <= SCAN_N; i++) {
    const ang = game.aim + step * i
    const h = coarseContact(game, ang)
    if (!usable(h)) continue
    if (usable(cur) && h === cur) continue           // 같은 공이면 계속 — 다음 "다른" 공을 찾는다
    game.aim = wrapPi(ang)
    game._predKey = null; game._predAt = 0
    return true
  }
  game.setToast('이 발사 속도로는 닿는 각도가 없다 — 속도를 바꿔라')
  return false
}

// ─── 요격각 탐색은 없앴다 ────────────────────────────────────
// 공중 요격(두 탄두가 만나 동시 기폭)은 **효과로는 그대로 남아 있다** —
// missilePairs()가 여전히 판정하고 작약량도 합쳐진다. 다만 "만나는 각도를
// 대신 찾아 주는" 조준 보조는 제거했다. 각도를 찾아 주는 순간 요격은
// 플레이어가 읽어 낸 수가 아니라 버튼 하나가 되기 때문이다.

// 거친 접촉 판정 — **천체**에 닿는지만 본다(폭심·임펄스는 계산하지 않는다).
// 비행 중인 반격탄은 일부러 무시한다: 요격각을 대신 찾아 주는 건
// 조준 보조라 없앴고, 접촉각 탐색은 "어느 공을 칠 수 있는가"만 답한다.
// 반환값은 **맞는 천체의 id** (또는 'earth' / 'debris' / null). id를 돌려줘야
// scanContact가 "같은 공인지 다른 공인지"를 알 수 있다.
// 지평은 TTL의 60%로 자른다: 계측상 접촉의 92%가 그 안에 일어나고,
// 나머지는 어차피 굴러가다 만나는 샷이라 "칠 수 있는 각도" 목록에 안 넣는 게 낫다.
const COARSE_HORIZON = 0.6
export function coarseContact(game, ang) {
  const sim = cloneBodies(game.bodies)
  const dt = 1 / 32
  const p = { x: game.earth.pos.x + Math.cos(ang) * CFG.LAUNCH_OFFSET, y: game.earth.pos.y + Math.sin(ang) * CFG.LAUNCH_OFFSET }
  const m = { pos: { ...p }, vel: fromAngle(ang, game.power), age: 0, pathN: 0, path: [], minSunDist: Infinity, prev: { ...p } }
  const beltR = beltRadius(game.aMax)
  const steps = Math.round(CFG.MISSILE_TTL * COARSE_HORIZON / dt)
  for (let i = 0; i < steps; i++) {
    if (bodyTurn(i, COARSE_BODY_EVERY)) stepBodies(sim, dt * COARSE_BODY_EVERY)
    stepMissile(m, sim, dt)
    for (const o of sim) {
      if (!o.alive) continue
      if (!segHitsCircle(m.prev.x, m.prev.y, m.pos.x, m.pos.y, o.pos.x, o.pos.y, hitRadiusOf(o))) continue
      if (o.type === 'debris') return 'debris'
      if (o.isEarth) return 'earth'
      return o.id
    }
    const r = Math.hypot(m.pos.x, m.pos.y)
    if (r < CFG.R_STAR + 8) return null
    if (r >= beltR) beltBounce(m, beltR)   // 벨트에 튕겨 되돌아온 뒤에도 계속 훑는다
  }
  return null
}

// 공중 요격 지점 — 미는 대상이 없으므로 화살표 없이 폭풍 반경만 알려준다
export function interceptInfo(game, x, y, yld) {
  return {
    name: '공중 요격', id: null, type: 'missile', role: null,
    isEarth: false, isTarget: false, outcome: 'intercept',
    x, y, px: x, py: y, r: CFG.MISSILE_HIT_R,
    dx: 0, dy: 0, dv: 0, vx: 0, vy: 0,
    blast: blastRadius(yld), yld, earthInBlast: false,
    vAfter: 0, vEsc: 0, willEject: false, counter: false, volatileR: 0,
    counterSpeed: 0, counterEsc: 0, counterEscapes: false,
    hp: 0, hpMax: 0,
  }
}

// 충돌 한 건의 "큐 정보" — 폭심, 임펄스 방향, 타격 직후 공의 진로
export function impactInfo(game, o, point, simEarth) {
  const isT = game.isTarget(o)
  let outcome = 'neutral'
  if (o.type === 'debris') outcome = 'debris'
  else if (o.isEarth) outcome = 'earth'
  else if (o.role === 'void') outcome = 'void'
  else if (o.role === 'volatile') outcome = 'volatile'
  else if (isT) outcome = 'target'
  let dx = o.pos.x - point.x, dy = o.pos.y - point.y
  const d = Math.hypot(dx, dy) || 1
  dx /= d; dy /= d
  const dv = o.type === 'debris' || o.isEarth || o.role === 'volatile'
    ? 0 : effDv(o, game.yieldMt)
  const R = blastRadius(game.yieldMt)
  // 큰 탄두는 폭풍이 지구까지 닿는다 — 쏘기 전에 그것만은 알려준다
  const earthInBlast = !!simEarth && !o.isEarth &&
    Math.hypot(simEarth.pos.x - point.x, simEarth.pos.y - point.y) < R
  // 때린 직후의 속도가 그 자리의 탈출속도를 넘는지 — "세게 치면 날아간다"는
  // 큐의 세기에 대한 정보지 판의 결말이 아니다. 작약량을 고르는 유일한 근거.
  const vAfter = Math.hypot(o.vel.x + dx * dv, o.vel.y + dy * dv)
  const vEsc = Math.sqrt(2 * CFG.MU_STAR / Math.max(1, Math.hypot(o.pos.x, o.pos.y)))
  // 반격탄 제원 — 요새를 벗어날 수 있는 속도인지 함께 계산한다.
  // (탈출속도 미만이면 반격탄이 제 요새 주위를 맴돌다 되떨어진다. counterSpeed가
  //  하한을 그 위로 올려 주므로 esc는 항상 통과하지만, 그 근거를 화면에 보여준다.)
  const cOff = hitRadiusOf(o) * 1.15
  const cSpeed = counterSpeed(o, cOff), cEsc = escapeSpeed(o.mu, cOff)
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
    counter: o.role === 'battery' && (o.ammo ?? 0) > 0 && !o.isEarth && o.type !== 'debris',
    counterSpeed: cSpeed, counterEsc: cEsc, counterEscapes: cSpeed > cEsc,
    volatileR: o.role === 'volatile' ? volatileRadius(o) : 0,
    // 체력 — 이 한 방으로는 안 부서진다. 몇 번 더 처박아야 하는지가 정보다.
    hp: o.hp ?? CFG.PLANET_HP, hpMax: o.hpMax ?? CFG.PLANET_HP,
  }
}
