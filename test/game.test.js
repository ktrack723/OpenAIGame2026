import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Game } from '../game/core/game.js'
import { PHASES, DIFFICULTIES } from '../game/core/config.js'
import { CLIENTS } from '../game/data/clients.js'

const TOTAL_TURNS = PHASES.texting.turns + PHASES.talking.turns

/** 준비가 잘 된 한 판을 끝까지 돌린다. */
async function playPrepared(opts = {}) {
  const g = new Game({ seed: opts.seed ?? 11, difficulty: opts.difficulty ?? 'normal' })
  g.chooseClient(opts.clientId ?? 'dohun')
  g.setStyling(opts.styling ?? '가죽 재킷, 별자리 목걸이')
  g.setCoaching(opts.coaching ?? '야식이랑 별 얘기를 꺼내. 상대 말을 끝까지 듣고 되물어. 자랑은 하지 마.')
  g.setSpeech(
    opts.speech ??
      '도훈아. 3년 동안 새벽마다 그 편의점을 지킨 건 너야. 삼각김밥 두 개 남겨둔 것도 너고. 넌 충분히 성실해. 넌 할 수 있어!',
  )
  await g.beginRun()
  let guard = 0
  while (!g.isOver) {
    assert.ok(++guard <= 200, '루프가 끝나지 않는다')
    await g.step()
  }
  const outcome = await g.finish()
  return { g, outcome }
}

test('게임 루프가 사람 없이 끝까지 돈다', async () => {
  const { g, outcome } = await playPrepared()
  assert.equal(g.stage, 'ending')
  assert.equal(g.log.length, TOTAL_TURNS, `총 턴 수가 ${TOTAL_TURNS} 이어야 한다`)
  assert.ok(outcome.ending.id)
  assert.ok(typeof outcome.letter === 'string' && outcome.letter.length > 50, '편지가 비었다')
})

test('단계가 문자 → 대면 → 종료 순으로 넘어간다', async () => {
  const g = new Game({ seed: 3, difficulty: 'normal' })
  g.chooseClient('sera')
  g.setCoaching('커피 얘기를 꺼내')
  g.setSpeech('세라야 넌 할 수 있어. 무대에선 늘 그랬잖아.')
  await g.beginRun()

  assert.equal(g.stage, 'texting')
  for (let i = 0; i < PHASES.texting.turns; i++) await g.step()
  assert.equal(g.stage, 'talking', '문자 단계가 끝나면 대면으로 넘어가야 한다')

  for (let i = 0; i < PHASES.talking.turns; i++) await g.step()
  assert.equal(g.stage, 'ending')
  await assert.rejects(() => g.step(), /대화할 수 없습니다/)
})

test('분위기와 호감은 단계를 넘어 이어진다', async () => {
  const g = new Game({ seed: 8, difficulty: 'normal' })
  g.chooseClient('dohun')
  g.setCoaching('야식 얘기를 꺼내고 상대 말을 들어라')
  g.setSpeech('도훈아 3년을 버틴 건 너야. 넌 할 수 있어!')
  await g.beginRun()
  for (let i = 0; i < PHASES.texting.turns; i++) await g.step()
  const carriedMood = g.state.mood
  const carriedLove = g.state.love
  assert.equal(g.stage, 'talking')
  assert.equal(g.state.mood, carriedMood)
  assert.equal(g.state.love, carriedLove)
  assert.equal(g.turn, 0, '새 단계는 턴이 0부터')
})

test('개입 횟수는 단계별로 제한되고 소진된다', async () => {
  const g = new Game({ seed: 5, difficulty: 'normal' })
  g.chooseClient('dohun')
  g.setCoaching('별 얘기를 꺼내')
  g.setSpeech('도훈아 넌 할 수 있어')
  await g.beginRun()

  assert.equal(g.interventionsLeft, PHASES.texting.interventions)
  assert.equal(g.canIntervene, true)
  assert.equal(g.queueIntervention('별 얘기를 꺼내').ok, true)
  assert.equal(g.canIntervene, false, '예약 후에는 또 못 건다')
  await g.step()
  assert.equal(g.interventionsLeft, 0)
  assert.equal(g.queueIntervention('또 개입').ok, false, '남은 횟수가 없으면 거절해야 한다')

  for (let i = 1; i < PHASES.texting.turns; i++) await g.step()
  assert.equal(g.stage, 'talking')
  assert.equal(g.interventionsLeft, PHASES.talking.interventions, '단계가 바뀌면 개입이 리셋된다')
})

test('개입은 지목한 화제를 실제로 꺼내게 만든다', async () => {
  const g = new Game({ seed: 21, difficulty: 'hard' })
  g.chooseClient('dohun')
  g.setCoaching('편하게 얘기해')
  g.setSpeech('도훈아 넌 할 수 있어')
  await g.beginRun()
  g.queueIntervention('지금 강아지 얘기를 꺼내')
  const entry = await g.step()
  assert.equal(entry.topic, 'dogs', '개입한 화제가 나와야 개입 기능이 읽힌다')
  assert.equal(entry.intervened, true)
})

test('수치는 0..100 을 벗어나지 않는다', async () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { g } = await playPrepared({ seed })
    for (const e of g.log) {
      assert.ok(e.mood >= 0 && e.mood <= 100, `분위기 이탈 ${e.mood}`)
      assert.ok(e.love >= 0 && e.love <= 100, `호감 이탈 ${e.love}`)
    }
  }
})

test('같은 시드는 같은 판을 만든다', async () => {
  const a = await playPrepared({ seed: 'reproducible' })
  const b = await playPrepared({ seed: 'reproducible' })
  assert.deepEqual(
    a.g.log.map((e) => [e.clientText, e.moodDelta, e.loveDelta]),
    b.g.log.map((e) => [e.clientText, e.moodDelta, e.loveDelta]),
  )
  assert.equal(a.outcome.ending.id, b.outcome.ending.id)
  assert.equal(a.outcome.letter, b.outcome.letter)
})

test('다른 시드는 다른 판을 만든다', async () => {
  const a = await playPrepared({ seed: 'aaa' })
  const b = await playPrepared({ seed: 'bbb' })
  assert.notDeepEqual(
    a.g.log.map((e) => e.clientText),
    b.g.log.map((e) => e.clientText),
  )
})

test('의뢰인을 안 고르고 시작할 수 없다', async () => {
  const g = new Game({ seed: 1 })
  await assert.rejects(() => g.beginRun(), /의뢰인을 먼저/)
  assert.throws(() => g.chooseClient('없는사람'), /알 수 없는 의뢰인/)
})

test('여섯 의뢰인 모두 완주할 수 있다', async () => {
  for (const c of CLIENTS) {
    const { g, outcome } = await playPrepared({ clientId: c.id, seed: `run-${c.id}` })
    assert.equal(g.log.length, TOTAL_TURNS, `${c.name} 진행 실패`)
    assert.ok(outcome.letter.includes(c.name), `${c.name}: 편지에 서명이 없다`)
  }
})

test('난이도 3종 모두 완주할 수 있다', async () => {
  for (const d of Object.keys(DIFFICULTIES)) {
    const { g } = await playPrepared({ difficulty: d, seed: `d-${d}` })
    assert.equal(g.log.length, TOTAL_TURNS)
  }
})

test('발견한 취향은 중복 기록되지 않는다', async () => {
  const { g } = await playPrepared({ seed: 44, difficulty: 'hard' })
  const ids = g.discoveries.map((d) => d.id)
  assert.equal(new Set(ids).size, ids.length, '같은 취향을 두 번 발견하면 안 된다')
  for (const d of g.discoveries) {
    assert.ok(
      g.dossier.likes.includes(d.id) || g.dossier.mines.includes(d.id),
      '취향/지뢰가 아닌 걸 발견했다',
    )
  }
})

test('공개된 취향에는 발굴 보너스가 붙지 않는다', async () => {
  const g = new Game({ seed: 99, difficulty: 'easy' })
  g.chooseClient('dohun')
  g.setCoaching('공개된 취향 얘기를 계속해')
  g.setSpeech('넌 할 수 있어')
  await g.beginRun()
  await g.runPhase()
  for (const d of g.discoveries) {
    assert.ok(
      !g.dossier.visibleLikes.includes(d.id),
      `처음부터 공개돼 있던 ${d.id} 를 "발견"으로 처리하면 안 된다`,
    )
  }
})
