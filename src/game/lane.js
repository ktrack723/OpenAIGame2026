import { CFG, hitRadiusFor, hitRadiusOf } from './config.js'
import { buildBodyTrack, trackFrame } from './physics.js'

// ─── 밖에서 들어오는 손님의 진입선 ──────────────────────────────
// 카이퍼 벨트 밖에서 들어와 성계를 가로지르고 나가는 것이 둘이다 —
// 혜성(comet.js)과 순회선(ufo.js). 둘은 다른 물건이지만 **어디로 들어오는가**를
// 정하는 방법은 하나여야 한다: 답이 갈리면 한쪽만 조용히 지구에 꽂히는 선을
// 뽑게 되고, 그 사고는 판이 수십 번 돈 뒤에야 드러난다.
//
// 여기 있는 것은 그 하나뿐이다 — 선을 긋고(drawLine), 그 선이 안전한지
// 굴려서 확인한다(clears). 무엇이 그 선을 타고 들어오는지는 안 묻는다.

// ── 진입선은 '충격 파라미터'로 짓는다 ──────────────────────────
// 위치와 방향을 따로 뽑으면 태양을 정통으로 지나는 선이 나온다(손님이 제 발로
// 항성에 빠진다). 그래서 **태양에서 직선까지의 거리 b를 직접 고르고**, 그 직선
// 위에서 벨트 밖으로 물러난 자리를 출발점으로 삼는다.
//
//   b   = rE × bRange       태양 ~ 진입선 거리
//   dir = 진행 방향(임의)
//   n   = dir에 직각(좌/우 임의)
//   pos = n̂·b − d̂ir·(벨트 반경 + lead)
//
// 그래서 둘이 계산으로 보증된다:
//   ① 근점이 코로나 밖 — b의 하한이 지구 궤도의 절반 언저리다.
//   ② 반드시 싸움터를 지난다 — b 대역이 요새 대역과 같은 띠다.
// (휘는 정도는 속도가 정한다. 느린 손님은 태양 둘레로 크게 감아 도는데,
//  그것까지 식으로 보증하지 않고 **굴려서** 확인한다 — 아래 clears.)
//
// side/along은 무리로 들어올 때 쓴다: 같은 방향·같은 속도로 나란히 긋는 선이라
// 무리끼리는 서로 안 부딪힌다(평행선은 만나지 않는다).
export function drawLine(rng, earth, beltR, { speed, b: bRange, lead }, side = 0, along = 0) {
  const rE = Math.hypot(earth.pos.x, earth.pos.y) || 700
  const [lo, hi] = bRange
  const b = rE * (lo + rng.next() * (hi - lo)) + side
  const dir = rng.range(0, Math.PI * 2)
  const n = dir + (rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2)
  const back = beltR + lead + along
  return {
    pos: { x: Math.cos(n) * b - Math.cos(dir) * back, y: Math.sin(n) * b - Math.sin(dir) * back },
    vel: { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed },
    dir, b,
  }
}

// 같은 선을 옆으로 밀어 나란한 선을 하나 더 만든다(무리의 둘째·셋째).
// 방향과 속도는 그대로다 — 그래서 무리는 대형을 유지한 채 같이 지나간다.
export function offsetLine(line, side, along) {
  const nx = -Math.sin(line.dir), ny = Math.cos(line.dir)
  return {
    pos: {
      x: line.pos.x + nx * side - Math.cos(line.dir) * along,
      y: line.pos.y + ny * side - Math.sin(line.dir) * along,
    },
    vel: { ...line.vel },
    dir: line.dir, b: line.b + side,
  }
}

// ── 이 선은 지구에 안 꽂히는가 / 태양에 안 빠지는가 ─────────────
// 왜 거르나 — 손님은 **순수한 사건**이어야 한다. 플레이어가 아무것도 안 했는데
// 새 위협이 하늘에서 떨어지면 그건 손님이 아니라 사고다. 게다가 지구의 실효
// 질량은 135뿐이라(EARTH_MU × MU_SCALE) 수십 GU/s로 달려온 손님에 정통으로
// 맞으면 체력만 깎이는 게 아니라 궤도가 통째로 날아간다.
// 태양도 같이 본다: 충격 파라미터는 **지구의 지금 반경**에서 나오므로
// 지구가 안쪽으로 밀린 판에서는 그 띠가 통째로 코로나 쪽으로 내려온다.
//
// 처음엔 등속 직선의 최근접 거리로 쟀다(O(1)이라 공짜다). **안 맞았다** —
// 12시드 계측에서 848기 중 20기(2.4%)가 지구에 그대로 닿았다. 직선 두 개로는
// 두 가지를 놓친다: 혜성은 휘고, 지구는 수십 초 동안 곡선으로 간다.
//
// 그래서 **실제로 굴려 본다.** 판을 한 번 굴려 궤적을 기록해 두고(buildBodyTrack)
// 후보 선 여러 개를 그 위에서 재생한다. 천체 궤적은 후보와 무관하므로 트랙은
// **한 번만** 짓는다: 열두 번 뽑아도 O(n²) 적분은 한 번이다.
const GUARD_DT = 0.5
export function buildGuard(bodies, earth, span) {
  const steps = Math.max(1, Math.round(span / GUARD_DT))
  const track = buildBodyTrack(bodies, GUARD_DT, 1, steps)
  // 표적(요새·투석기)의 자리도 같이 기억해 둔다 — 아래 clears가 그 둘레도 비운다.
  const fi = []
  track.view.forEach((b, i) => { if (b.role === 'battery' || b.role === 'siege') fi.push(i) })
  return { track, steps, ei: track.view.findIndex(b => b.isEarth), fi, earth }
}

// 손님을 시험입자로 굴린다 — 태양 + 그 순간의 천체들, 전부 **진짜 물리**(κ=1).
// (미사일이 아니므로 stepMissile을 쓰면 안 된다: 저건 행성 중력을 120배로 받는다.)
//
// cruise면 중력을 아예 안 준다 — 엔진으로 가는 배는 판의 중력에 안 끌리고
// (physics.stepBodies), 그러니 검사도 같은 규칙으로 해야 한다. 손님이 실제로
// 날 길과 여기서 굴려 보는 길이 갈리면 이 검사는 아무것도 보증하지 않는다.
function guardMiss(G, line, cruise) {
  const { track, steps, ei, fi } = G
  const view = track.view
  let x = line.pos.x, y = line.pos.y, vx = line.vel.x, vy = line.vel.y
  let best = Infinity, peri = Math.hypot(x, y), foe = Infinity
  const kick = (h) => {
    if (cruise) return
    let d2 = x * x + y * y + CFG.EPS * CFG.EPS
    let inv = CFG.MU_STAR / (d2 * Math.sqrt(d2))
    let ax = -x * inv, ay = -y * inv
    for (const b of view) {
      if (!b.alive || b.visitor) continue
      const dx = b.pos.x - x, dy = b.pos.y - y
      d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS
      inv = b.mu / (d2 * Math.sqrt(d2))
      ax += dx * inv; ay += dy * inv
    }
    vx += ax * h; vy += ay * h
  }
  for (let f = 0; f < steps; f++) {
    trackFrame(track, f)
    kick(GUARD_DT / 2)
    x += vx * GUARD_DT; y += vy * GUARD_DT
    kick(GUARD_DT / 2)
    peri = Math.min(peri, Math.hypot(x, y))
    if (ei >= 0) best = Math.min(best, Math.hypot(x - view[ei].pos.x, y - view[ei].pos.y))
    // 표적까지의 **여유**(거리 − 그 표적의 판정 반경). 요새마다 크기가 다르므로
    // 거리로 재면 큰 요새가 더 안전한 것으로 잡힌다.
    for (const j of fi) {
      const b = view[j]
      if (!b.alive) continue
      foe = Math.min(foe, Math.hypot(x - b.pos.x, y - b.pos.y) - hitRadiusOf(b))
    }
  }
  return { earth: best, peri, foe }
}

// ── 이 선을 써도 되는가 ─────────────────────────────────────────
// 셋을 본다: 지구·태양·**조르그 표적**.
//
// 앞의 둘은 "손님이 사고가 되면 안 된다"이고, 셋째는 그 반대다:
// **손님이 판을 대신 풀어 주면 안 된다.** 요새는 체력이 1이라 지나가던 공에
// 한 번 스치면 그대로 부서지는데, 손님이 두세 기씩 판을 가로지르기 시작하면
// 그 일이 저절로 벌어진다 — 계측(6시드 × 무입력 인게임 1200초, 5스테이지):
// 손님을 넣기 전에는 표적 18기가 저절로 부서졌고, 넣은 뒤에는 29기였다.
// 그중 열 기가 손님이 친 것이었고, 여섯 시드 중 다섯에서 **표적이 하나도 안
// 남았다.** 판을 푸는 것은 플레이어여야 한다.
//
// 그래서 진입선은 표적 둘레도 비워서 뽑는다. 이건 손님을 약하게 만드는 게
// 아니다 — 밀어서 요새에 처박는 것은 여전히 되고, 다만 **그 한 수를 플레이어가
// 둬야** 한다. 아무도 안 건드리면 손님은 아무것도 안 하고 지나간다.
// (지나가는 동안 궤도가 휘어 결국 부딪히는 것까지 막지는 못한다. 그건 판이
//  굴러가며 생긴 일이지 하늘에서 떨어진 일이 아니다.)
export function clears(G, line, radius, clear, cruise = false) {
  const rV = hitRadiusFor(radius)
  const need = clear * (hitRadiusOf(G.earth) + rV)
  const { earth: d, peri, foe } = guardMiss(G, line, cruise)
  return d > need && peri > CFG.R_STAR * 1.8 && foe > CFG.VISITOR_FOE_CLEAR * rV
}
