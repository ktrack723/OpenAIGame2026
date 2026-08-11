import { CFG } from './config.js'

// ─── 상점 ───────────────────────────────────────────────────────
// 판이 끝날 때마다 승리 화면에 붙는다. 파는 것은 넷뿐이고 값은 전부 같다(5).
//
// 왜 값이 하나인가 — 가격이 다르면 "무엇이 더 좋은가"를 가격표가 먼저 말해
// 버린다. 전부 5면 고르는 이유가 **지금 이 런의 사정** 하나로 좁혀진다:
// 지구가 깎였으면 수리, 못 미는 공이 많으면 작약, 사거리가 아쉬우면 속도,
// 레이저에 계속 쫓기면 추진기.
//
// 규칙은 전부 여기 있다. UI(Victory.js)는 목록을 받아 그리고 buy()만 부른다 —
// 상점이 어디에 뜨든(승리 화면이든 다른 데든) 규칙은 한 벌만 존재한다.

// 각 품목: id · 최대치(있으면) · 지금 몇 개인가 · 살 수 있는가 · 사면 무슨 일이 나는가
export const ITEMS = [
  {
    id: 'repair',
    // 지구 체력은 판을 넘어 이어진다(loadStage가 hp를 안 건드린다). 그래서
    // 이 한 칸은 "이번 판을 버티는 것"이 아니라 **런 전체의 여유**를 산다.
    have: (g) => g.earth.hp,
    max: (g) => g.earth.hpMax,
    ok: (g) => g.earth.alive && g.earth.hp < g.earth.hpMax,
    buy: (g) => { g.earth.hp = Math.min(g.earth.hpMax, g.earth.hp + 1) },
  },
  {
    id: 'speed',
    have: (g) => g.buys.speed,
    max: () => CFG.BUY_MAX,
    ok: (g) => g.buys.speed < CFG.BUY_MAX,
    buy: (g) => { g.buys.speed++; g.powerMax = CFG.LAUNCH_MAX + g.buys.speed * CFG.BUY_SPEED_STEP },
  },
  {
    id: 'yield',
    have: (g) => g.buys.yield,
    max: () => CFG.BUY_MAX,
    ok: (g) => g.buys.yield < CFG.BUY_MAX,
    buy: (g) => { g.buys.yield++; g.yieldMax = CFG.YIELD_MAX + g.buys.yield * CFG.BUY_YIELD_STEP },
  },
  {
    id: 'thruster',
    have: (g) => g.thrusters,
    max: () => CFG.THRUST_MAX,
    // **판을 안 가린다.** 지구는 첫 판부터 한 발을 쥐고 시작하므로(THRUST_START)
    // 1스테이지에서 이미 써 버렸을 수 있다 — 그때 진열대에 없으면 "다 쓰면
    // 끝"이 되어 버린다. 쓴 만큼 5원에 되채우는 것이 이 물건의 값이다.
    ok: (g) => g.thrusters < CFG.THRUST_MAX,
    buy: (g) => { g.thrusters++ },
  },
]

// 이번 판의 진열대. show가 없으면 늘 진열한다.
// stageIdx는 **다음 판 기준**으로 본다 — 상점은 판이 끝난 뒤에 열리고,
// 여기서 산 물건은 다음 판에서 쓰기 때문이다.
export const stock = (game) => ITEMS.filter((it) => !it.show || it.show(game))

// 살 수 있는가 — 잔액과 품목 조건 둘 다.
export const canBuy = (game, id) => {
  const it = ITEMS.find((x) => x.id === id)
  if (!it) return false
  return game.pol >= CFG.SHOP_COST && it.ok(game)
}

// 산다. 성공하면 true — 실패는 조용히 false다(UI가 이미 비활성으로 막고 있다).
export const buy = (game, id) => {
  if (!canBuy(game, id)) return false
  const it = ITEMS.find((x) => x.id === id)
  game.pol -= CFG.SHOP_COST
  it.buy(game)
  return true
}

// 화면에 그릴 한 줄치 정보. 왜 못 사는지까지 여기서 정해 준다 —
// 비활성 버튼이 이유를 안 말하면 그건 고장난 버튼처럼 보인다.
export const rows = (game) => stock(game).map((it) => {
  const have = it.have(game), max = it.max(game)
  const full = !it.ok(game)
  const poor = game.pol < CFG.SHOP_COST
  return {
    id: it.id, have, max,
    enabled: !full && !poor,
    // 'full'(더 못 삼) · 'poor'(잔액 부족) · null(살 수 있음)
    why: full ? 'full' : poor ? 'poor' : null,
  }
})
