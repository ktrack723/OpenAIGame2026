import { CFG, beltRadius, radiusOf } from './config.js'
import { buildGuard, clears, drawLine, offsetLine } from './lane.js'
import { makeBody } from './body.js'

// ─── 혜성 — 지나가는 큐볼 ───────────────────────────────────────
// 규칙은 **빼기 하나**뿐이다: 카이퍼 벨트가 안 튕긴다. 밖에서 들어와 성계를
// 가로지르고 반대편으로 나간다. 나머지는 전부 다른 공과 같다 — 중력을 받고,
// 핵에 밀리고, 부딪히면 부서지고(체력 1), 광선에 녹고, 태양에 떨어진다.
//
// **그 빼기는 아무도 안 건드렸을 때만이다.** 궤도가 한 번 비틀리는 순간
// 통행권이 사라지고(game.nudgeVisitor) 그다음부터는 벨트가 이놈도 튕긴다 —
// 즉 밀어서 붙잡아 두면 그 혜성은 이 판의 식구가 된다. 그게 "지나가는 것"과
// "잡은 것"의 차이 전부다.
//
// 왜 있는가는 config의 COMET_* 주석에 있다: 판 도중에 큐볼을 보충하는 유일한
// 경로다. 그래서 이건 선물이 아니라 **기회**다 — 지나가는 동안에만 쓸 수 있다.
//
// 진입선을 어떻게 긋는지는 lane.js에 있다(순회선과 공용이다).

let uid = 0

const LANE = { speed: CFG.COMET_SPEED, b: CFG.COMET_B, lead: CFG.COMET_LEAD }

// 한 기를 짓는다. 자리는 부르는 쪽이 이미 정해서 준다(line).
function makeComet(rng, line, tag) {
  const [muLo, muHi] = CFG.COMET_MU
  const mu = muLo + rng.next() * (muHi - muLo)
  return makeBody({
    id: `c${(uid++).toString(36)}`,
    // 이름은 실제 혜성 부호를 흉내 낸다 — 번역할 게 없고, 판마다 다른 손님이라는 게
    // 이름만 봐도 읽힌다. (nameKey를 주면 다섯 언어 표에 문장을 하나 더 얹어야 하고,
    //  그 문장은 어차피 "혜성" 한 단어다 — 그건 태그(role.comet)가 이미 말한다.)
    name: `C/${tag}`,
    mu,
    // 질량은 그대로 두고 **크기만** 키운다(COMET_R_MUL) — 밀리는 양은 μ만
    // 보므로 안 변하고, 맞히기·처박기만 쉬워진다.
    radius: radiusOf(mu) * CFG.COMET_R_MUL,
    pos: line.pos, vel: line.vel,
    type: 'comet',
    hp: 1,              // 한 번 처박으면 같이 부서진다 — 한 번 쓰는 큐볼이다
    comet: true, visitor: 1, pass: 1,
  })
}

// ── 한 무리 ─────────────────────────────────────────────────────
// 두세 기가 **나란한 선으로** 같이 들어온다. 선이 평행하므로 무리끼리는 서로
// 안 부딪히고, 앞뒤로 조금씩 어긋나 있어서 한 덩어리로 뭉쳐 보이지도 않는다.
// 자리를 못 찾으면 빈 배열. 부르는 쪽은 그냥 이번 차례를 거른다 — 요새와 달리
// 혜성은 **안 와도 판이 성립한다.**
export function spawnComets(rng, bodies, earth, aMax, tag, n = 1) {
  const beltR = beltRadius(aMax)
  // 성계를 가로지르는 데 걸리는 시간 — 검사의 지평이다
  const span = (2 * beltR + 2 * CFG.COMET_LEAD) / CFG.COMET_SPEED
  const G = buildGuard(bodies, earth, span)
  const rMax = radiusOf(CFG.COMET_MU[1]) * CFG.COMET_R_MUL
  let base = null
  for (let i = 0; i < 12; i++) {
    const cand = drawLine(rng, earth, beltR, LANE)
    if (clears(G, cand, rMax, CFG.COMET_EARTH_CLEAR)) { base = cand; break }
  }
  if (!base) return []
  const out = [makeComet(rng, base, `${tag}-1`)]
  // 둘째부터는 기준선을 옆으로 민다. 밀린 선도 **따로 검사한다** — 나란하다고
  // 안전이 딸려 오지 않는다: 지구는 그 사이를 지날 수 있다.
  for (let k = 1; k < n; k++) {
    const side = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * CFG.COMET_GAP
    const line = offsetLine(base, side, rng.range(0, CFG.COMET_GAP))
    if (!clears(G, line, rMax, CFG.COMET_EARTH_CLEAR)) continue
    out.push(makeComet(rng, line, `${tag}-${out.length + 1}`))
  }
  return out
}

// ── 판이 부르는 자리 ────────────────────────────────────────────
// 스폰 시계와 퇴장을 한 곳에서 돌린다. **인게임 초**로 잰다 — 혜성은 판 위의
// 사건이라 관측 배속을 그대로 타야 한다(워프인·추진기 대기가 실시간인 것과
// 반대다. 그쪽은 화면의 사건이고 이쪽은 판의 사건이다).
//
// 퇴장은 **통행권을 아직 들고 있는 손님**만 한다(exitVisitors, ufo.js와 공용).
// 밀려서 붙잡힌 혜성은 이 판의 식구라 나가지 않는다 — 나갈 수도 없다(벨트가
// 튕긴다).
export function exitVisitors(game, live, exitPad) {
  const exitR = game.beltR + exitPad
  for (const b of live) {
    if (!b.pass) continue
    if (Math.hypot(b.pos.x, b.pos.y) < exitR) continue
    if (b.pos.x * b.vel.x + b.pos.y * b.vel.y <= 0) continue
    b.alive = false          // 조용히 나간다. 격파가 아니므로 연출도 문구도 없다
  }
}

export function stepComets(game, dt) {
  if (game.won || game.lost || game.doom) return
  // 예고편은 판을 직접 연출한다 — 그 화면에 손님이 끼어들면 안 된다.
  if (game.trailer) return
  const live = game.bodies.filter(b => b.alive && b.comet)
  exitVisitors(game, live, CFG.COMET_EXIT)

  game.cometT += dt
  const cues = game.bodies.filter(b => b.alive && !b.isEarth && !b.zorg && !b.visitor && b.type !== 'debris').length
  // 굴릴 공이 모자라면 주기가 당겨진다 — 판이 열릴 때 증원을 정하는 것과
  // 같은 문턱(CUE_KEEP)이라 성계를 채우는 두 경로가 같은 질문을 한다.
  const wait = (game.cometN ? CFG.COMET_PERIOD : CFG.COMET_FIRST)
    * (cues < CFG.CUE_KEEP ? CFG.COMET_RUSH : 1)
  if (game.cometT < wait) return
  game.cometT = 0
  const room = CFG.COMET_MAX - live.length
  if (room <= 0) return
  const [gLo, gHi] = CFG.COMET_GROUP
  const n = Math.min(room, gLo + game.rng.int(0, gHi - gLo))
  const group = spawnComets(game.rng, game.bodies, game.earth, game.aMax, `${game.stage}-${game.cometN + 1}`, n)
  if (!group.length) return
  game.cometN++
  for (const b of group) game.bodies.push(b)
  game.onComet(group)
}
