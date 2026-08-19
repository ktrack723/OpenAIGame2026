import { CFG, UFO_KINDS, beltRadius } from './config.js'
import { buildGuard, clears, drawLine, offsetLine } from './lane.js'
import { exitVisitors } from './comet.js'
import { makeBody } from './body.js'

// ─── 순회선 — 조르그가 아닌 다른 것 ─────────────────────────────
// 벨트 밖에서 들어와 성계를 가로지르고 나가는 **배**다. 혜성과 같은 자리에
// 서지만(지나가는 큐볼) 하는 짓이 셋 다르다 — 근거와 숫자는 config.UFO_* 에 있다.
//
//   ① 엔진이 있다(b.cruise). 중력에 안 끌리므로 느려도 곧게 지나간다.
//      판 위에서 유일하게 **궤도를 안 도는** 천체다.
//   ② 속이 비었다. 덩치는 목성의 절반인데 질량은 소행성급이라 핵 한 방에
//      크게 밀린다 — 이 게임에서 제일 잘 밀리는 공이다.
//   ③ 저쪽 편이 아니다. 조르그와 다른 종족이고 아무것도 안 쏜다.
//      지나가면서 한 마디씩 던질 뿐이다(ui/Comms.js).
//
// **한 번 튕기면 그냥 공이 된다.** 무엇이 됐든 한 번 건드리는 순간 엔진이
// 죽고(cruise 0) 통행권도 사라진다(pass 0) — game.nudgeVisitor 한 곳에서
// 벌어지는 일이고, 그때부터 이 배는 중력을 받고 벨트에 튕기는, 혜성과 한
// 글자도 다르지 않은 큐볼이다. 그래서 이 물건에 대한 판단은 하나로 환원된다:
// **보낼 것인가, 붙잡을 것인가.**
//
// 자기들끼리는 사이가 좋다 — 무리는 나란한 평행선으로 들어오므로 서로 안
// 부딪히고, 하나가 밀려나도 나머지는 제 갈 길을 간다.

let uid = 0

const LANE = { speed: CFG.UFO_SPEED, b: CFG.UFO_B, lead: CFG.UFO_LEAD }

// 이 판에 오는 형태 — 무리 안에서도 섞인다(같은 종족의 다른 배다).
export const ufoKind = (b) => UFO_KINDS.find(k => k.key === b.ufo) ?? UFO_KINDS[0]

function makeUfo(rng, line, tag) {
  const kind = UFO_KINDS[rng.int(0, UFO_KINDS.length - 1)]
  return makeBody({
    id: `u${(uid++).toString(36)}`,
    // 이름은 혜성 부호(C/…)와 같은 꼴이되 머리글자가 다르다 — 판 위에서
    // 이름만 보고도 "저건 돌이 아니라 배"가 읽힌다.
    name: `V/${tag}`,
    mu: kind.mu,
    radius: CFG.UFO_R * kind.r,
    pos: line.pos, vel: line.vel,
    type: 'ufo',
    hp: CFG.UFO_HP,
    ufo: kind.key,
    visitor: 1, pass: 1, cruise: 1,
  })
}

// ── 한 무리 ─────────────────────────────────────────────────────
// 자리를 못 찾으면 빈 배열. 부르는 쪽은 이번 차례를 거른다.
export function spawnUfos(rng, bodies, earth, aMax, tag, n = 1) {
  const beltR = beltRadius(aMax)
  const span = (2 * beltR + 2 * CFG.UFO_LEAD) / CFG.UFO_SPEED
  const G = buildGuard(bodies, earth, span)
  const rMax = CFG.UFO_R * Math.max(...UFO_KINDS.map(k => k.r))
  let base = null
  for (let i = 0; i < 12; i++) {
    const cand = drawLine(rng, earth, beltR, LANE)
    // cruise=true — 검사도 실제로 날 길과 같은 규칙으로 굴린다(중력 없음).
    if (clears(G, cand, rMax, CFG.UFO_EARTH_CLEAR, true)) { base = cand; break }
  }
  if (!base) return []
  const out = [makeUfo(rng, base, `${tag}-1`)]
  for (let k = 1; k < n; k++) {
    const side = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * CFG.UFO_GAP
    const line = offsetLine(base, side, rng.range(0, CFG.UFO_GAP))
    if (!clears(G, line, rMax, CFG.UFO_EARTH_CLEAR, true)) continue
    out.push(makeUfo(rng, line, `${tag}-${out.length + 1}`))
  }
  return out
}

// ── 판이 부르는 자리 ────────────────────────────────────────────
// 혜성과 같은 구조다(comet.stepComets) — 인게임 초로 재고, 퇴장은 통행권을
// 아직 들고 있는 배만 한다. 다른 것은 하나뿐이다: **큐볼이 모자라다고 더 자주
// 오지 않는다.** 저쪽은 보급이 아니라 손님이라, 판 사정을 봐주지 않는다.
export function stepUfos(game, dt) {
  if (game.won || game.lost || game.doom) return
  if (game.trailer) return
  if (game.stage < CFG.UFO_STAGE) return
  const live = game.bodies.filter(b => b.alive && b.ufo)
  exitVisitors(game, live, CFG.UFO_EXIT)

  game.ufoT += dt
  const wait = game.ufoN ? CFG.UFO_PERIOD : CFG.UFO_FIRST
  if (game.ufoT < wait) return
  game.ufoT = 0
  const room = CFG.UFO_MAX - live.length
  if (room <= 0) return
  const [gLo, gHi] = CFG.UFO_GROUP
  const n = Math.min(room, gLo + game.rng.int(0, gHi - gLo))
  const group = spawnUfos(game.rng, game.bodies, game.earth, game.aMax, `${game.stage}-${game.ufoN + 1}`, n)
  if (!group.length) return
  game.ufoN++
  for (const b of group) game.bodies.push(b)
  game.onUfo(group)
}
