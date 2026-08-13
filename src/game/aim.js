import { fromAngle } from '../core/vector.js'
import { wrapPi } from '../core/angle.js'
import { CFG, beltRadius, blastRadius, hitRadiusOf } from './config.js'
import {
  blastPushOn, buildBodyTrack, cloneBodies, makeStepCache, missilePush, segCircleEntry,
  segHitsCircle, stepBodies, stepMissile, sweepMeet, trackFrame, volatilePushOn,
} from './physics.js'
import { SHARD_N, effDv, shardCone, shardReach, volatileRadius } from './roles.js'
import { msg } from '../i18n/index.js'

// ─── 조준 보조 — game.js에서 떼어낸 순수 계산부 ───────────────────
// 상태를 바꾸는 건 scanContact가 game.aim을 쓰는 것뿐이고,
// 나머지는 전부 판을 복제해 굴려 보기만 한다. game.js는 얇은 래퍼만 남긴다.

const EMPTY_PRED = { pts: [], outcome: null, hit: null, nudged: false }

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
  // 시간은 0.25초 단위로 뭉갠다 — 시계가 흐를 때 매 프레임 다시 푸는 걸 막는
  // 장치다. 조준 중에는 시계가 멈춰 있으므로 예측은 항상 정확하고, 시간 진행
  // 버튼을 누르고 있는 동안엔 초당 네 번만 갱신된다.
  //
  // **날고 있는 탄은 그 눈금으로 못 잰다.** 행성은 초당 20 GU로 도는데 탄은
  // 40~56 GU로 날고, 탄끼리의 판정 원은 24 GU밖에 안 된다 — 0.25초를 뭉개면
  // "이 발이 저 탄을 친다"가 통째로 뒤집힌다. 계측: 시간 진행을 놓은 뒤 화면은
  // RELAY를 그리고 있는데 지금 쏘면 안 맞는 판이 나왔다(예측선 끝점이 1641 GU
  // 어긋났고 결말이 relay ↔ timeout으로 갈렸다). 그래서 탄의 자리를 2 GU 눈금으로
  // 키에 넣는다 — 판정 원의 1/12이라 뒤집힐 만큼 낡을 수가 없다.
  //
  // advancing도 키에 든다. 시계가 멎으면 시간 칸이 더는 안 변해서, **놓는 순간의
  // 낡은 그림이 그대로 굳는다** — 그 한 번을 다시 풀게 하는 것이 이 칸이다.
  let fly = ''
  for (const m of game.missiles) {
    if (m.alive) fly += `${Math.round(m.pos.x / 2)},${Math.round(m.pos.y / 2)};`
  }
  const key = `${game.aim.toFixed(5)}|${game.power}|${game.yieldMt}|${game.stage}|${Math.floor(game.time * 4)}|${game.shots}|${game.bodies.length}|${game.advancing ? 1 : 0}|${fly}`
  if (game._predKey === key) return game._pred
  const now = performance.now()
  // 쏠 수 없는 동안(자리가 다 찼거나 시한이 지났다)에는 갱신을 늦춘다. 선은
  // 계속 그린다 — 다음 차례를 재는 데 쓰는 물건이라 지우면 안 된다. 다만 그때의
  // 예측은 **날고 있는 탄까지 같이 굴리므로 두 배로 비싸고**, 쏠 수도 없는
  // 발이라 초당 스무 번씩 다시 풀 이유가 없다.
  const gap = (game.salvoFull || game.pastDeadline) ? 150 : 45
  if (game._pred && now - (game._predAt || 0) < gap) return game._pred
  game._predAt = now

  const sim = cloneBodies(game.bodies), bc = makeStepCache()
  const p = game.launchPos()
  const m = { pos: { ...p }, vel: fromAngle(game.aim, game.power), age: 0, pathN: 0, path: null, minSunDist: Infinity, prev: { ...p } }
  // ── 이미 날고 있는 내 탄두 ──
  // 같이 굴린다. 탄두끼리도 부딪히므로(game.crossFire) **저 탄이 곧 공**이고,
  // 그러면 예측선은 그 사실을 말해야 한다 — 안 그리면 판 위에서 제일 작은 공
  // 하나만 예측이 없는 셈이 되고, "느리게 걸어 두고 빠르게 친다"는 수는
  // 눈대중으로만 시도할 수 있는 물건이 된다.
  // 날고 있는 탄이 없으면 배열이 비어 이 아래는 전부 공짜다.
  const live = game.missiles.filter(x => x.alive).map(x => ({
    id: x.id, yld: x.yld,
    pos: { ...x.pos }, vel: { ...x.vel }, prev: { ...x.pos },
    age: x.age, pathN: 0, path: null, minSunDist: Infinity,
  }))
  const pts = [{ ...p }]
  let outcome = 'timeout', hit = null, nudged = false
  const beltR = beltRadius(game.aMax), beltR2 = beltR * beltR
  const rIn = CFG.R_STAR + 8, rIn2 = rIn * rIn
  const steps = Math.round(CFG.MISSILE_TTL / CFG.DT)
  for (let i = 0; i < steps; i++) {
    if (bodyTurn(i, BODY_EVERY)) stepBodies(sim, CFG.DT * BODY_EVERY, bc)
    stepMissile(m, sim, CFG.DT)
    for (const L of live) stepMissile(L, sim, CFG.DT)
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
    // ── 탄이 탄을 친다 ──
    // 순서는 판과 같다: 천체 판정이 먼저고(위에서 끊었다) 그다음이 탄끼리다
    // (game.step → contact → crossFire). 먼저 결판난 탄은 명단에서 뺀다 —
    // 죽은 탄은 crossFire에 안 넘어가므로 여기서도 없는 탄이어야 한다.
    if (live.length) {
      for (let k = live.length - 1; k >= 0; k--) if (spentProbe(live[k], sim, rIn2, beltR2)) live.splice(k, 1)
      let meet = null, mu = 0
      // 무장 전(총구 앞)에는 서로를 못 친다 — 판과 같은 문턱이다(game.crossFire).
      // 이 발의 나이는 스텝 수가 곧 나이다(m.age), 저 탄의 나이는 같이 굴러간다.
      if (m.age >= CFG.MISSILE_ARM) for (const L of live) {
        if (L.age < CFG.MISSILE_ARM) continue
        const u = sweepMeet(m.prev, m.pos, L.prev, L.pos, CFG.MISSILE_HIT_R)
        if (u >= 0) { meet = L; mu = u; break }
      }
      if (meet) {
        const at = (o) => ({ x: o.prev.x + (o.pos.x - o.prev.x) * mu, y: o.prev.y + (o.pos.y - o.prev.y) * mu })
        const mine = at(m), his = at(meet)
        // 빠른 쪽이 큐다(game.crossFire와 같은 규칙). 이 발이 언제나 나중에
        // 쏜 발이므로 속력이 같으면 이쪽이 큐다.
        if (Math.hypot(m.vel.x, m.vel.y) >= Math.hypot(meet.vel.x, meet.vel.y)) {
          pts.push(mine)
          hit = relayInfo(game, meet, mine, his, game.yieldMt, sim.find(o => o.isEarth))
          outcome = 'relay'
          break
        }
        // 저 탄이 큐 — 이번엔 **이 발이 밀린다.** 선은 여기서 끊기지 않는다:
        // 그 자리에서 꺾여 계속 간다(끊으면 거짓말이다 — 이 발은 살아서 난다).
        // 큐 쪽이 터지며 일으키는 폭풍까지는 안 굴린다. 예측선은 언제나
        // "이 한 발이 어디에 닿는가"까지만 말한다.
        const push = missilePush(his.x, his.y, mine.x, mine.y, meet.yld)
        m.vel.x += push.dx * push.dv; m.vel.y += push.dy * push.dv
        live.splice(live.indexOf(meet), 1)
        pts.push(mine)
        nudged = true
      }
    }
    const r2 = m.pos.x * m.pos.x + m.pos.y * m.pos.y
    if (r2 < rIn2) { outcome = 'sun'; pts.push({ x: m.pos.x, y: m.pos.y }); break }
    // 카이퍼 벨트 = 탄이 끝나는 자리. 공은 튕기지만 탄두는 거기서 터진다
    // (game.beltDetonate) — 예측선도 같은 자리에서 끊겨야 거짓말이 아니다.
    if (r2 >= beltR2) {
      outcome = 'belt'
      const r = Math.sqrt(r2)
      pts.push({ x: m.pos.x / r * beltR, y: m.pos.y / r * beltR })
      break
    }
  }
  game._predKey = key
  game._pred = { pts, outcome, hit, nudged }
  return game._pred
}

// 날고 있던 탄이 이 스텝에 결판났는가 — 천체 직격 · 태양 · 벨트 · 자폭 시한.
// 무엇에 닿았는지는 안 묻는다. 여기서 필요한 답은 "그 뒤로도 판 위에 있는가"
// 하나뿐이고, 그 탄이 무엇을 밀었는지는 이 발의 예측이 말할 몫이 아니다.
function spentProbe(L, sim, rIn2, beltR2) {
  if (L.age > CFG.MISSILE_TTL) return true
  const r2 = L.pos.x * L.pos.x + L.pos.y * L.pos.y
  if (r2 < rIn2 || r2 >= beltR2) return true
  for (const o of sim) {
    if (!o.alive) continue
    if (segHitsCircle(L.prev.x, L.prev.y, L.pos.x, L.pos.y, o.pos.x, o.pos.y, hitRadiusOf(o))) return true
  }
  return false
}

// ─── 탄이 탄을 치는 한 건 ────────────────────────────────────────
// impactInfo와 **같은 모양**의 물건을 돌려준다 — 화면(AimHelper)과 LCD가 공을
// 칠 때 쓰던 어휘를 그대로 쓰기 위해서다: 락온 원 · 노란 임펄스 화살표 ·
// 흰 진로 화살표 · 폭풍 원. 다른 것은 맞는 것이 공이 아니라 **내 탄두**라는
// 사실 하나뿐이고, 그래서 체력·산탄·회피처럼 탄두에 없는 칸은 비어 있다.
function relayInfo(game, L, blast, at, yld, simEarth) {
  const push = missilePush(blast.x, blast.y, at.x, at.y, yld)
  const R = blastRadius(yld)
  return {
    name: '', nameKey: 'shot.mine', isEarth: false, isTarget: false, type: 'missile', id: L.id,
    outcome: 'relay', x: at.x, y: at.y, r: CFG.MISSILE_HIT_R,
    px: blast.x, py: blast.y,               // 폭심 = 만나는 순간 이 발이 있는 자리
    dx: push.dx, dy: push.dy, dv: push.dv,  // 저 탄이 밀리는 방향/크기
    vx: L.vel.x + push.dx * push.dv, vy: L.vel.y + push.dy * push.dv,   // 밀린 직후의 진로
    blast: R,
    // 폭풍이 지구를 훑는가 — 공을 칠 때와 같은 경고다. 허공에서 터졌다고
    // 지구가 안 밀리는 게 아니다(game.relay도 같은 폭풍을 터뜨린다).
    earthInBlast: !!simEarth && Math.hypot(simEarth.pos.x - blast.x, simEarth.pos.y - blast.y) < R,
    earthShove: earthShove(game, simEarth, blastPushOn(simEarth, blast.x, blast.y, yld)),
    vAfter: 0, vEsc: 0, willEject: false,
    role: null, volatileR: 0, shards: 0, shardCone: 0, shardReach: 0, earthInCone: false,
    hp: 0, hpMax: 0, boost: 0,
    missile: true,   // 이건 공이 아니라 탄이다 — 리드선이 어디서 찾을지가 갈린다(Scene)
  }
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
// "닿는가/언제"뿐이고 탄은 많아야 두 발이라(CFG.MAX_INFLIGHT) 초당 몇 번이면 된다.
// 해상도는 "10초 뒤에 판정 원 30 GU 안으로 들어오는가"를 틀리지 않을 만큼만.
// 처음엔 1/12초로 잡았다가 계측에서 위협을 **5~7초 전에야** 알아봤다 —
// 적분 오차가 10초 동안 쌓여 판정 원을 비껴갔고, 그만큼 회피할 시간이 없었다.
// 1/30초로 조이니 예정대로 10초 전에 잡는다. 탄은 많아야 두 발이고
// 이 질의는 초당 세 번이라 이 해상도가 프레임을 먹지 않는다.
const THREAT_DT = 1 / 30, THREAT_BODY_EVERY = 5
export function firstImpact(game, m, horizon) {
  // 트랙(buildBodyTrack)을 쓰지 않는 이유: 여기서는 닿는 순간의 **천체 속도**가
  // 필요하다(상대 진입 속도) — 트랙에는 위치뿐이다. 탄은 많아야 두 발이고
  // 이 질의는 초당 몇 번이라, 캐시 넘긴 정직한 적분으로 충분히 싸다.
  // 탄끼리의 충돌은 여기서 안 본다: 요새가 묻는 것은 "저 탄이 내게 꽂히는가"인데,
  // 그 탄이 도중에 밀릴지 말지는 **아직 안 쏜 발**에 달렸다. 저쪽이 알 길이 없다.
  const sim = cloneBodies(game.bodies), bc = makeStepCache()
  const probe = {
    pos: { ...m.pos }, vel: { ...m.vel }, age: 0, pathN: 0, path: null,
    minSunDist: Infinity, prev: { ...m.pos },
  }
  const beltR = beltRadius(game.aMax), beltR2 = beltR * beltR
  const rIn = CFG.R_STAR + 8, rIn2 = rIn * rIn
  const steps = Math.round(horizon / THREAT_DT)
  for (let i = 0; i < steps; i++) {
    if (bodyTurn(i, THREAT_BODY_EVERY)) stepBodies(sim, THREAT_DT * THREAT_BODY_EVERY, bc)
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
    const r2 = probe.pos.x * probe.pos.x + probe.pos.y * probe.pos.y
    if (r2 < rIn2) return null      // 태양에 삼켜진다
    if (r2 >= beltR2) return null   // 벨트에서 기폭 — 더 갈 곳이 없다
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
  // 천체 궤적은 각도와 무관하다(미사일은 천체를 못 민다) — 최대 241번의
  // coarseContact가 전부 같은 궤적 위를 난다. 한 번만 굴려 두고 재생한다.
  // 예전에는 각도마다 판 복제 + 천체 적분 전체를 다시 돌았고, 그게 이 버튼이
  // 화면을 얼리던 비용의 대부분이었다(주석 역사: 2.4~3.4초 → 규칙 수정 → 이제 트랙).
  const track = buildBodyTrack(game.bodies, COARSE_DT, COARSE_BODY_EVERY, COARSE_STEPS)
  const cur = coarseContact(game, game.aim, track)   // 지금 물고 있는 공(없으면 null)
  for (let i = 1; i <= SCAN_N; i++) {
    const ang = game.aim + step * i
    const h = coarseContact(game, ang, track)
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
// 지평은 TTL의 80%다. 예전에는 60%로 잘랐다 — "접촉의 92%가 그 안에 일어난다"는
// 계측 근거였는데, 그건 표적이 전부 지구 궤도 언저리에 있을 때의 이야기다.
// 요새가 바깥 대역(FORT_OUTER_BAND)에도 서는 지금은 1500 GU 밖 표적까지
// 30~40초가 걸리므로, 60%(31초)로 자르면 **바깥 요새는 이 버튼에 아예 안 걸린다** —
// 예측선(TTL 전부)은 맞는다고 그리는데 "다음 공" 버튼은 없는 척하는 셈이라
// 플레이어가 그 표적을 찾을 방법이 사라진다. 42초면 최대 파워로 2300 GU다.
const COARSE_HORIZON = 0.8
const COARSE_DT = 1 / 32
const COARSE_STEPS = Math.round(CFG.MISSILE_TTL * COARSE_HORIZON / COARSE_DT)
// track: buildBodyTrack(game.bodies, COARSE_DT, COARSE_BODY_EVERY, COARSE_STEPS).
// scanContact가 한 번 만들어 최대 241회 재생한다. export는 검증 하네스가
// 각도별 반환 id의 전/후 동치를 확인하는 데 쓴다.
export function coarseContact(game, ang, track) {
  const sim = track.view
  trackFrame(track, 0)                     // 뷰를 판의 현재(0프레임)로 되감는다
  const p = { x: game.earth.pos.x + Math.cos(ang) * CFG.LAUNCH_OFFSET, y: game.earth.pos.y + Math.sin(ang) * CFG.LAUNCH_OFFSET }
  const m = { pos: { ...p }, vel: fromAngle(ang, game.power), age: 0, pathN: 0, path: null, minSunDist: Infinity, prev: { ...p } }
  const beltR = beltRadius(game.aMax), beltR2 = beltR * beltR
  const rIn = CFG.R_STAR + 8, rIn2 = rIn * rIn
  let f = 0
  for (let i = 0; i < COARSE_STEPS; i++) {
    if (bodyTurn(i, COARSE_BODY_EVERY)) trackFrame(track, ++f)
    stepMissile(m, sim, COARSE_DT)
    for (const o of sim) {
      if (!o.alive) continue
      if (!segHitsCircle(m.prev.x, m.prev.y, m.pos.x, m.pos.y, o.pos.x, o.pos.y, hitRadiusOf(o))) continue
      if (o.type === 'debris') return 'debris'
      if (o.isEarth) return 'earth'
      return o.id
    }
    const r2 = m.pos.x * m.pos.x + m.pos.y * m.pos.y
    if (r2 < rIn2) return null
    if (r2 >= beltR2) return null          // 벨트에서 기폭 — 이 각도는 아무것에도 안 닿는다
  }
  return null
}

// ─── 지구가 밀린다면, 밀린 뒤의 궤도 ────────────────────────────
// 핵 폭풍은 지구도 민다(blastWave). 가스 행성의 유폭은 더 넓게 민다.
// 그런데 그 한 번이 이 판을 끝내는 게 아니라 **다음 판을 끝낸다**: 근일점이
// 깎인 지구는 몇 판 뒤에 조용히 태양으로 떨어지고, 화면에는 그 원인이 없다.
// (플레이테스트에서 실제로 그렇게 죽었다 — 1판을 클리어하고 2판 8초 만에.)
//
// 그래서 **지구가 실제로 밀릴 때만** 밀린 뒤의 궤도를 미리 풀어 준다. 규칙은
// 이 게임이 늘 지키던 그대로다: 결과가 아니라 **접촉의 직접 효과**만 말한다.
// 어디로 얼마나 밀리는지, 그래서 근일점이 어디로 내려가는지 — 그 둘이다.
// 밀지 않으면 null이고, 화면에는 아무것도 안 뜬다.
//
// push는 physics의 그 함수들이 돌려준 값 그대로다(blastPushOn/volatilePushOn).
// 실제로 미는 식과 여기서 그리는 식이 갈리면 그게 제일 나쁜 거짓말이 된다.
function earthShove(game, earth, push) {
  if (!earth || !push || push.dv <= 0) return null
  const vx = earth.vel.x + push.dx * push.dv, vy = earth.vel.y + push.dy * push.dv
  const now = game.sunOrbit(earth.pos.x, earth.pos.y, earth.vel.x, earth.vel.y)
  const then = game.sunOrbit(earth.pos.x, earth.pos.y, vx, vy)
  // 궤도가 **실제로 달라질 때만** 말한다. 폭풍의 가장자리는 Δv 0.004 짜리
  // 입김도 지구에 얹는데, 그건 근일점을 1 GU 옮긴다 — 표시하면 매 발마다
  // 경고가 뜨고, 그러면 진짜 위험한 발이 그 소음에 묻힌다. 문턱은 근일점
  // 이동량으로 잡는다(Δv가 아니라): 같은 Δv라도 어느 방향으로 미느냐에 따라
  // 궤도가 흔들리는 정도가 다르고, 플레이어가 잃는 것은 근일점 쪽이다.
  if (then.bound && Math.abs(then.peri - now.peri) < CFG.EARTH_SHOVE_MIN) return null
  // 그 근일점에 **닿기는 하는가**. 묶인 궤도면 언젠가 반드시 지난다(주기 궤도다).
  // 탈출 궤도면 갈리는데, 바깥으로 나가는 중이면 영영 안 닿는다 — 그 근일점은
  // 이미 지나온 가지의 것이다. 계측: Δv 33.9로 바깥으로 민 발은 근일점 215를
  // 예고했지만 지구는 r 406까지도 안 내려갔고, 2287 GU까지 날아가 벨트에 한 번
  // 튕겨 돌아왔다(살아서 궤도만 망가졌다). 그 발에 ☠를 붙이면 거짓말이다.
  const outbound = earth.pos.x * vx + earth.pos.y * vy > 0
  const reachesPeri = then.bound || !outbound
  return {
    dv: push.dv, dx: push.dx, dy: push.dy, radius: push.radius,
    x: earth.pos.x, y: earth.pos.y, vx, vy,
    peri: now.peri, peri2: then.peri, bound: then.bound, reachesPeri,
    // 태양에 닿는 근일점인가 — 이 한 줄이 "이 발로 지구를 잃는다"는 뜻이다.
    // 문턱은 판이 실제로 지구를 삼키는 반경과 같다(game.bodyBounds).
    // **묶인 궤도인지는 묻지 않는다**: 안쪽으로 미는 탈출 궤도도 태양을 먼저
    // 스쳐 지나간다. 실측에서 그 발이 지구를 22초 만에 태양에 넣었다.
    doomed: reachesPeri && then.peri < CFG.R_STAR + 15,
  }
}

// 충돌 한 건의 "큐 정보" — 폭심, 임펄스 방향, 타격 직후 공의 진로
function impactInfo(game, o, point, simEarth) {
  const isT = game.isTarget(o)
  let outcome = 'neutral'
  if (o.type === 'debris') outcome = 'debris'
  else if (o.isEarth) outcome = 'earth'
  else if (o.role === 'volatile') outcome = 'volatile'
  else if (o.role === 'unstable') outcome = 'unstable'
  else if (isT) outcome = 'target'
  let dx = o.pos.x - point.x, dy = o.pos.y - point.y
  const d = Math.hypot(dx, dy) || 1
  dx /= d; dy /= d
  // 터지거나 쪼개지는 공은 **밀리지 않는다** — 그 자리에서 없어진다.
  // Δv를 0으로 두면 임펄스·진로 화살표가 통째로 꺼진다(AimHelper.push).
  // 밀리지 않는 것들 — 파편(그냥 사라진다) · 지구(게임오버) · 불안정(쪼개져 사라진다).
  // **가스는 여기 없다.** 유폭해도 그 공은 남으므로 임펄스를 그대로 받는다(game.detonate).
  const dv = o.type === 'debris' || o.isEarth || o.role === 'unstable'
    ? 0 : effDv(o, game.yieldMt)
  const R = blastRadius(game.yieldMt)
  // 큰 탄두는 폭풍이 지구까지 닿는다 — 쏘기 전에 그것만은 알려준다
  const earthInBlast = !!simEarth && !o.isEarth &&
    Math.hypot(simEarth.pos.x - point.x, simEarth.pos.y - point.y) < R
  // 지구가 밀리는가 — 밀린다면 밀린 뒤의 궤도까지. 미는 경로가 둘이다:
  // 보통은 폭풍(blastWave)이고, 가스 행성을 치면 그 자리의 유폭이다
  // (game.detonate은 가스에 폭풍을 안 쓴다 — 유폭 하나로 대신한다).
  const shove = !simEarth || o.isEarth ? null
    : o.role === 'volatile'
      ? earthShove(game, simEarth, volatilePushOn(simEarth, o, volatileRadius(o)))
      : earthShove(game, simEarth, blastPushOn(simEarth, point.x, point.y, game.yieldMt))
  // 때린 직후의 속도가 그 자리의 탈출속도를 넘는지 — "세게 치면 날아간다"는
  // 큐의 세기에 대한 정보지 판의 결말이 아니다. 작약량을 고르는 유일한 근거.
  const vAfter = Math.hypot(o.vel.x + dx * dv, o.vel.y + dy * dv)
  const vEsc = Math.sqrt(2 * CFG.MU_STAR / Math.max(1, Math.hypot(o.pos.x, o.pos.y)))
  // ── 산탄이 나갈 방향 ──
  // 불안정 행성의 총구는 임펄스와 같은 벡터다(dx, dy) — 즉 **이 한 발이 이미
  // 정한 값**이라 추측이 한 톨도 안 들어간다. 그래서 쏘기 전에 그려 줘도
  // 이 게임의 규칙("결과가 아니라 접촉까지만 말한다")을 안 어긴다: 부채꼴은
  // 결과가 아니라 총구의 방향이다. 그 안에서 무엇이 맞는지는 말하지 않는다.
  const shard = o.role === 'unstable'
  // 지구가 그 부채꼴 안에 서 있는가 — 이것만은 말해 준다. 판을 통째로 잃는
  // 사고이고, 조준 한 번으로 피할 수 있으며, 계산으로 확정되는 사실이다.
  let earthInCone = false
  if (shard && simEarth && !o.isEarth) {
    const ex = simEarth.pos.x - o.pos.x, ey = simEarth.pos.y - o.pos.y
    const dist = Math.hypot(ex, ey)
    if (dist < shardReach()) {
      // 부채꼴 반각 + 지구 판정 원이 그 거리에서 벌리는 각만큼 여유를 둔다
      const half = shardCone() + Math.atan2(hitRadiusOf(simEarth), Math.max(1, dist))
      const off = Math.abs(wrapPi(Math.atan2(ey, ex) - Math.atan2(dy, dx)))
      earthInCone = off <= half
    }
  }
  return {
    name: o.name, nameKey: o.nameKey, isEarth: o.isEarth, isTarget: isT, type: o.type, id: o.id,
    outcome, x: o.pos.x, y: o.pos.y, r: hitRadiusOf(o),
    px: point.x, py: point.y,            // 폭심 (공의 어느 살인가)
    dx, dy, dv,                          // 임펄스 방향/크기
    vx: o.vel.x + dx * dv, vy: o.vel.y + dy * dv,   // 타격 직후 공의 속도
    blast: R, earthInBlast, vAfter, vEsc, willEject: dv > 0 && vAfter > vEsc,
    earthShove: shove,
    role: o.role ?? null,
    volatileR: o.role === 'volatile' ? volatileRadius(o) : 0,
    // 샷건 — 갈래 수 / 부채꼴 반각(rad) / 그리는 사거리. 0이면 이 공은 안 쏜다.
    shards: shard ? SHARD_N : 0,
    shardCone: shard ? shardCone() : 0,
    shardReach: shard ? shardReach() : 0,
    earthInCone,
    // 체력 — 이 한 방으로는 안 부서진다. 몇 번 더 처박아야 하는지가 정보다.
    hp: o.hp ?? CFG.PLANET_HP, hpMax: o.hpMax ?? CFG.PLANET_HP,
    // 아직 안 쓴 회피 분사가 남아 있는가. 예측은 "이 탄이 어디에 닿는가"까지만
    // 말하는데, 요새는 그 계산을 보고 **비켜설 수 있다** — 그러면 예측이 거짓말이
    // 된다. 결과를 대신 예측해 주지는 않되(그건 규칙 위반이다), 저쪽에 아직
    // 카드가 한 장 남아 있다는 사실만은 쏘기 전에 알려 준다.
    boost: o.boost ?? 0,
  }
}
