// 밸런스 회귀 테스트.
//
// "혼자 루프를 돌 수 있는가"와 "깰 수 있는가"를 숫자로 못박아 둔다.
// 밸런스 상수를 건드리면 여기가 먼저 깨진다 — 그때는 `npm run balance` 로
// 표를 다시 뽑아 보고 의도한 변화인지 확인할 것.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { measure, playOne } from '../tools/selfplay.js'

const RUNS = 24

let table
async function getTable() {
  if (!table) table = await measure({ runs: RUNS })
  return table
}

const winRate = (t, strategy, difficulty) => t[strategy][difficulty].win / t[strategy][difficulty].n

test('자동 플레이가 사람 입력 없이 완주한다', async () => {
  const r = await playOne({ seed: 1, difficulty: 'normal', clientId: 'dohun', strategy: 'expert' })
  assert.equal(r.turns, 14)
  assert.ok(['accepted', 'pending', 'rejected'].includes(r.ending))
})

test('게임은 깰 수 있다 — 잘 준비하면 이긴다', async () => {
  const t = await getTable()
  assert.ok(winRate(t, 'expert', 'easy') >= 0.9, `쉬움 숙련 승률 ${winRate(t, 'expert', 'easy')}`)
  assert.ok(winRate(t, 'expert', 'normal') >= 0.8, `보통 숙련 승률 ${winRate(t, 'expert', 'normal')}`)
  assert.ok(winRate(t, 'expert', 'hard') >= 0.4, `어려움 숙련 승률 ${winRate(t, 'expert', 'hard')}`)
})

test('게임은 거저 깨지지 않는다 — 준비 없이는 진다', async () => {
  const t = await getTable()
  for (const d of ['easy', 'normal', 'hard']) {
    assert.ok(winRate(t, 'clueless', d) <= 0.05, `무준비가 ${d} 에서 이기면 안 된다`)
    assert.ok(winRate(t, 'sabotage', d) <= 0.02, `역효과 준비가 ${d} 에서 이기면 안 된다`)
  }
})

test('실력이 승률로 드러난다', async () => {
  const t = await getTable()
  for (const d of ['easy', 'normal', 'hard']) {
    assert.ok(
      winRate(t, 'expert', d) >= winRate(t, 'decent', d),
      `${d}: 숙련이 평범보다 못하다`,
    )
    assert.ok(
      winRate(t, 'decent', d) > winRate(t, 'lazy', d),
      `${d}: 준비를 제대로 한 쪽이 날림보다 나아야 한다`,
    )
    assert.ok(
      t.lazy[d].love / t.lazy[d].n > t.clueless[d].love / t.clueless[d].n,
      `${d}: 조금이라도 준비하면 호감이 더 높아야 한다`,
    )
  }
})

test('개입은 어려운 난이도에서 유의미하다', async () => {
  const t = await getTable()
  // 어려움은 공개 취향이 하나뿐 → 숨은 취향을 개입으로 살리는 게 실력이다.
  assert.ok(
    winRate(t, 'expert', 'hard') - winRate(t, 'decent', 'hard') >= 0.1,
    `개입 유무 격차가 너무 작다: ${winRate(t, 'expert', 'hard')} vs ${winRate(t, 'decent', 'hard')}`,
  )
})

test('난이도가 실제로 어려워진다', async () => {
  const t = await getTable()
  const e = winRate(t, 'decent', 'easy')
  const n = winRate(t, 'decent', 'normal')
  const h = winRate(t, 'decent', 'hard')
  assert.ok(e >= n && n >= h, `난이도 역전: 쉬움 ${e} / 보통 ${n} / 어려움 ${h}`)
  assert.ok(e - h >= 0.3, '난이도 간 격차가 없다')
})

test('지뢰는 준비가 부실할수록 자주 밟는다', async () => {
  const t = await getTable()
  for (const d of ['easy', 'normal', 'hard']) {
    const good = t.expert[d].mines / t.expert[d].n
    const bad = t.sabotage[d].mines / t.sabotage[d].n
    assert.ok(bad > good, `${d}: 역효과 준비가 지뢰를 더 밟아야 한다 (${bad} vs ${good})`)
  }
})
