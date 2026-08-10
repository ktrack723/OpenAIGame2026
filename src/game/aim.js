import { fromAngle } from '../core/vector.js'
import { wrapPi } from '../core/angle.js'
import { CFG, beltRadius, blastRadius, hitRadiusOf } from './config.js'
import { cloneBodies, segCircleEntry, segHitsCircle, stepBodies, stepMissile } from './physics.js'
import { effDv, volatileRadius } from './roles.js'
import { msg } from '../i18n/index.js'

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
  const pts = [{ ...p }]
  let outcome = 'timeout', hit = null
  const beltR = beltRadius(game.aMax)
  const steps = Math.round(CFG.MISSILE_TTL / CFG.DT)
  for (let i = 0; i < steps; i++) {
    if (bodyTurn(i, BODY_EVERY)) stepBodies(sim, CFG.DT * BODY_EVERY)
    stepMissile(m, sim, CFG.DT)
    if (i % 8 === 0) pts.push({ x: m.pos.x, y: m.pos.y })
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
    const r = Math.hypot(m.pos.x, m.pos.y)
    if (r < CFG.R_STAR + 8) { outcome = 'sun'; pts.push({ x: m.pos.x, y: m.pos.y }); break }
    // 카이퍼 벨트 = 탄이 끝나는 자리. 공은 튕기지만 탄두는 거기서 터진다
    // (game.beltDetonate) — 예측선도 같은 자리에서 끊겨야 거짓말이 아니다.
    if (r >= beltR) {
      outcome = 'belt'
      pts.push({ x: m.pos.x / r * beltR, y: m.pos.y / r * beltR })
      break
    }
  }
  game._predKey = key
  game._pred = { pts, outcome, hit }
  return game._pred
}

// ─── 이 탄은 앞으로 무엇에 꽂히는가 ─────────────────────────────
// 요새의 회피 판정이 쓰는 질의다. **날고 있는** 탄 하나를 앞으로 굴려 보고
// 처음 닿는 천체와 그때까지 걸리는 시간을 돌려준다(안 닿으면 null).
//
// 왜 직선 예측이 아닌가 — 처음엔 상대 좌표계의 최근접점만 풀었다(공짜다).
// 그런데 이 게임에서 탄은 직선으로 안 온다: 중력에 휘고 스윙바이로 꺾인다.
// 계측에서 요새 판정 원 47 GU 안쪽 48 GU까지 스쳐 간 탄을 **끝까지 위협으로
// 못 봤다** — 매 순간의 속도로 그은 직선은 내내 엉뚱한 데를 가리켰기 때문이다.
// 그래서 예측선과 같은 적분기를 쓴다. 대신 해상도를 크게 낮췄다: 답이
// "닿는가/언제"뿐이고 탄은 한 번에 한 발뿐이라(inFlight) 초당 몇 번이면 된다.
// 해상도는 "10초 뒤에 판정 원 30 GU 안으로 들어오는가"를 틀리지 않을 만큼만.
// 처음엔 1/12초로 잡았다가 계측에서 위협을 **5~7초 전에야** 알아봤다 —
// 적분 오차가 10초 동안 쌓여 판정 원을 비껴갔고, 그만큼 회피할 시간이 없었다.
// 1/30초로 조이니 예정대로 10초 전에 잡는다. 탄은 한 번에 한 발뿐이고
// (inFlight) 이 질의는 초당 세 번이라 이 해상도가 프레임을 먹지 않는다.
const THREAT_DT = 1 / 30, THREAT_BODY_EVERY = 5
export function firstImpact(game, m, horizon) {
  const sim = cloneBodies(game.bodies)
  const probe = {
    pos: { ...m.pos }, vel: { ...m.vel }, age: 0, pathN: 0, path: [],
    minSunDist: Infinity, prev: { ...m.pos },
  }
  const steps = Math.round(horizon / THREAT_DT)
  for (let i = 0; i < steps; i++) {
    if (bodyTurn(i, THREAT_BODY_EVERY)) stepBodies(sim, THREAT_DT * THREAT_BODY_EVERY)
    stepMissile(probe, sim, THREAT_DT)
    for (const o of sim) {
      if (!o.alive) continue
      if (!segHitsCircle(probe.prev.x, probe.prev.y, probe.pos.x, probe.pos.y, o.pos.x, o.pos.y, hitRadiusOf(o))) continue
      // 복제본이 아니라 **판 위의 그 공**을 돌려준다 — 부르는 쪽이 밀어야 한다.
      // vx/vy는 **닿는 그 순간의** 상대 진입 속도다. 지금 이 순간의 속도가 아니라
      // 이걸 써야 "타격 지점에 직각"이 참이 된다 — 탄은 오는 동안 휘기 때문에
      // 둘이 크게 다르고, 지금 속도로 직각을 잡으면 엉뚱한 쪽으로 비켜선다.
      return {
        body: game.bodies.find(b => b.id === o.id) ?? null, t: (i + 1) * THREAT_DT,
        vx: probe.vel.x - o.vel.x, vy: probe.vel.y - o.vel.y,
      }
    }
    const r = Math.hypot(probe.pos.x, probe.pos.y)
    if (r < CFG.R_STAR + 8) return null            // 태양에 삼켜진다
    if (r >= beltRadius(game.aMax)) return null    // 벨트에서 기폭 — 더 갈 곳이 없다
  }
  return null
}

// ─── 접촉각 탐색 (§14.3) ────────────────────────────────────
// 계측 결과 360° 중 뭔가에 닿는 각도가 99칸뿐이고, 그중 67칸이 지구였다.
// 즉 각도를 한 칸씩 돌리는 시간의 대부분이 "여긴 아님"을 확인하는 데 쓰인다.
// 기획 의도가 "어느 각도에서 칠 수 있는지는 알려준다"이므로, 그 확인을
// 버튼 한 번으로 대신한다. **어느 공을 어느 살로 칠지는 여전히 플레이어 몫**이다.
// 거친 적분(dt 1/40)으로 훑고, 찾은 각도는 다음 프레임에 정식 예측이 확정한다.
// 한 번 누를 때마다 "다음 선택지"로 간다 — 지금 물고 있는 구간을 먼저 빠져나온
// 다음에 찾는다. 같은 구간 안에서의 미세 조정은 각도 스테퍼(0.1° / 1° / 10°)가 맡는다.
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
  game.setToast(msg('toast.noAngle'))
  return false
}

// 거친 접촉 판정 — **천체**에 닿는지만 본다(폭심·임펄스는 계산하지 않는다).
// 반환값은 **맞는 천체의 id** (또는 'earth' / 'debris' / null). id를 돌려줘야
// scanContact가 "같은 공인지 다른 공인지"를 알 수 있다.
// 지평은 TTL의 60%로 자른다: 계측상 접촉의 92%가 그 안에 일어나고,
// 나머지는 어차피 굴러가다 만나는 샷이라 "칠 수 있는 각도" 목록에 안 넣는 게 낫다.
const COARSE_HORIZON = 0.6
function coarseContact(game, ang) {
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
    if (r >= beltR) return null            // 벨트에서 기폭 — 이 각도는 아무것에도 안 닿는다
  }
  return null
}

// 충돌 한 건의 "큐 정보" — 폭심, 임펄스 방향, 타격 직후 공의 진로
function impactInfo(game, o, point, simEarth) {
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
  return {
    name: o.name, nameKey: o.nameKey, isEarth: o.isEarth, isTarget: isT, type: o.type, id: o.id,
    outcome, x: o.pos.x, y: o.pos.y, r: hitRadiusOf(o),
    px: point.x, py: point.y,            // 폭심 (공의 어느 살인가)
    dx, dy, dv,                          // 임펄스 방향/크기
    vx: o.vel.x + dx * dv, vy: o.vel.y + dy * dv,   // 타격 직후 공의 속도
    blast: R, earthInBlast, vAfter, vEsc, willEject: dv > 0 && vAfter > vEsc,
    role: o.role ?? null,
    volatileR: o.role === 'volatile' ? volatileRadius(o) : 0,
    // 체력 — 이 한 방으로는 안 부서진다. 몇 번 더 처박아야 하는지가 정보다.
    hp: o.hp ?? CFG.PLANET_HP, hpMax: o.hpMax ?? CFG.PLANET_HP,
    // 아직 안 쓴 회피 분사가 남아 있는가. 예측은 "이 탄이 어디에 닿는가"까지만
    // 말하는데, 요새는 그 계산을 보고 **비켜설 수 있다** — 그러면 예측이 거짓말이
    // 된다. 결과를 대신 예측해 주지는 않되(그건 규칙 위반이다), 저쪽에 아직
    // 카드가 한 장 남아 있다는 사실만은 쏘기 전에 알려 준다.
    boost: o.boost ?? 0,
  }
}
