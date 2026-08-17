import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Rng, hashSeed } from '../game/core/rng.js'
import {
  scoreStyling,
  scoreCoaching,
  scoreSpeech,
  scoreIntervention,
  buildDossier,
  matchTopics,
  mineIntent,
  splitTags,
  resolveConfession,
} from '../game/core/scoring.js'
import { LANDMINES } from '../game/data/topics.js'
import { getClient, CLIENTS } from '../game/data/clients.js'
import { DIFFICULTIES } from '../game/core/config.js'
import { dw, wrap, visibleWidth } from '../game/ui/term.js'

// ─────────────────────────────────────────────── 난수

test('같은 시드는 같은 수열을 낸다', () => {
  const a = new Rng('hello')
  const b = new Rng('hello')
  const c = new Rng('world')
  const seqA = Array.from({ length: 20 }, () => a.next())
  const seqB = Array.from({ length: 20 }, () => b.next())
  const seqC = Array.from({ length: 20 }, () => c.next())
  assert.deepEqual(seqA, seqB)
  assert.notDeepEqual(seqA, seqC)
})

test('난수는 [0,1) 범위를 벗어나지 않는다', () => {
  const r = new Rng(7)
  for (let i = 0; i < 5000; i++) {
    const v = r.next()
    assert.ok(v >= 0 && v < 1, `범위 이탈: ${v}`)
  }
})

test('가중치 선택은 가중치 0인 항목을 뽑지 않는다', () => {
  const r = new Rng(3)
  for (let i = 0; i < 300; i++) {
    const picked = r.weighted([
      { key: 'a', weight: 0 },
      { key: 'b', weight: 1 },
    ])
    assert.equal(picked, 'b')
  }
})

test('hashSeed 는 숫자와 문자열을 모두 받는다', () => {
  assert.equal(typeof hashSeed(42), 'number')
  assert.equal(typeof hashSeed('42'), 'number')
  assert.equal(hashSeed('abc'), hashSeed('abc'))
})

// ─────────────────────────────────────────────── 서류철

test('난이도가 공개 취향 수와 지뢰 수를 정한다', () => {
  const client = getClient('dohun')
  for (const [id, d] of Object.entries(DIFFICULTIES)) {
    const dossier = buildDossier(client, id, new Rng(1))
    assert.equal(dossier.mines.length, d.landmines)
    assert.equal(
      dossier.visibleLikes.length + dossier.hiddenLikes.length,
      client.target.likes.length,
      '공개 + 비공개 = 전체',
    )
    assert.ok(dossier.visibleLikes.length >= 1, '최소 하나는 알려준다')
    const overlap = dossier.visibleLikes.filter((x) => dossier.hiddenLikes.includes(x))
    assert.equal(overlap.length, 0, '공개와 비공개는 겹치지 않는다')
  }
})

test('어려울수록 덜 알려준다', () => {
  const client = getClient('sera')
  const easy = buildDossier(client, 'easy', new Rng(1)).visibleLikes.length
  const hard = buildDossier(client, 'hard', new Rng(1)).visibleLikes.length
  assert.ok(easy > hard, `쉬움 ${easy} > 어려움 ${hard}`)
})

test('모든 의뢰인 데이터가 온전하다', () => {
  for (const c of CLIENTS) {
    assert.ok(c.target.likes.length >= 4, `${c.name}: 취향이 너무 적다`)
    assert.ok(c.target.mines.length >= 3, `${c.name}: 지뢰가 3개는 있어야 난이도별로 뽑을 수 있다`)
    assert.equal(new Set(c.target.likes).size, c.target.likes.length, `${c.name}: 취향 중복`)
    assert.ok(c.storyKeywords.length >= 5, `${c.name}: 연설 채점용 키워드 부족`)
    assert.ok(c.portrait.length > 0 && c.target.portrait.length > 0)
  }
})

// ─────────────────────────────────────────────── 텍스트 판정

test('태그 분리는 다양한 구분자를 받는다', () => {
  assert.deepEqual(splitTags('가죽 재킷, 부츠 / 목걸이'), ['가죽 재킷', '부츠', '목걸이'])
  assert.deepEqual(splitTags(''), [])
})

test('화제 매칭이 키워드를 잡는다', () => {
  const hits = matchTopics('강아지 산책 얘기를 해봐')
  assert.ok(
    hits.some((h) => h.id === 'dogs'),
    '강아지 화제를 못 잡았다',
  )
})

test('"자랑하지 마"는 자랑하라는 지시가 아니다', () => {
  assert.equal(mineIntent('자랑은 절대 하지 마', LANDMINES.brag), 'avoid')
  assert.equal(mineIntent('네가 얼마나 대단한지 자랑해', LANDMINES.brag), 'invoke')
  assert.equal(mineIntent('가르치려 들지 말고 들어줘', LANDMINES.lecture), 'avoid')
  assert.equal(mineIntent('강아지 얘기해', LANDMINES.brag), null)
})

test('코칭 채점: 금지 지시는 감점이 아니라 회피 목록으로 간다', () => {
  const client = getClient('dohun')
  const dossier = buildDossier(client, 'normal', new Rng(1))
  dossier.mines = ['brag']
  const warn = scoreCoaching('야식 얘기 꺼내고, 자랑은 하지 마.', client, dossier)
  assert.deepEqual(warn.mineWarnings, [], '금지를 지시로 오독하면 안 된다')
  assert.deepEqual(warn.avoidedMines, ['brag'])

  const bad = scoreCoaching('네가 얼마나 대단한지 자랑해라.', client, dossier)
  assert.deepEqual(bad.mineWarnings, ['brag'])
})

test('코칭 채점: 빈 입력은 최저, 구체적 지시는 높게', () => {
  const client = getClient('dohun')
  const dossier = buildDossier(client, 'easy', new Rng(1))
  const empty = scoreCoaching('', client, dossier)
  const good = scoreCoaching(
    `${dossier.visibleLikes.length ? '야식' : ''} 얘기를 꺼내고, 상대 말을 끝까지 들은 뒤 되물어라. 천천히, 솔직하게.`,
    client,
    dossier,
  )
  assert.ok(empty.empty)
  assert.ok(good.fidelity > empty.fidelity, `${good.fidelity} > ${empty.fidelity}`)
})

test('연설 채점: 사연을 짚으면 자신감이 오른다', () => {
  const client = getClient('dohun')
  const generic = scoreSpeech('잘해봐. 화이팅.', client)
  const tailored = scoreSpeech(
    '도훈아. 3년 동안 새벽마다 그 편의점을 지킨 건 너야. 삼각김밥 두 개 남겨둔 것도 너고. 넌 충분히 성실해. 넌 할 수 있어!',
    client,
  )
  assert.ok(tailored.confidence > generic.confidence)
  assert.ok(tailored.relevance > 0)
})

test('연설 채점: 깎아내리면 자신감이 떨어진다', () => {
  const client = getClient('dohun')
  const mean = scoreSpeech('넌 한심해. 어차피 망했어.', client)
  const empty = scoreSpeech('', client)
  assert.ok(mean.confidence <= empty.confidence + 0.05)
})

test('스타일링: 취향 적중은 +, 지뢰는 -', () => {
  const client = getClient('dohun')
  const dossier = buildDossier(client, 'easy', new Rng(1))
  dossier.likes = ['astronomy']
  dossier.mines = ['money']
  const good = scoreStyling('별자리 목걸이', client, dossier)
  const bad = scoreStyling('명품 시계, 금장 반지', client, dossier)
  assert.ok(good.loveBonus > 0, `적중이 +가 아니다: ${good.loveBonus}`)
  assert.ok(bad.loveBonus < 0, `지뢰가 -가 아니다: ${bad.loveBonus}`)
})

test('개입 채점: 화제를 짚으면 강하게, 지뢰를 시키면 역효과', () => {
  const client = getClient('dohun')
  const dossier = buildDossier(client, 'normal', new Rng(1))
  dossier.likes = ['astronomy']
  dossier.mines = ['brag']

  const aimed = scoreIntervention('지금 별 얘기를 꺼내', client, dossier)
  assert.equal(aimed.topic, 'astronomy')
  assert.ok(aimed.power >= 0.9)
  assert.equal(aimed.backfire, false)

  const boom = scoreIntervention('네 연봉이 얼마인지 자랑해', client, dossier)
  assert.equal(boom.backfire, true)

  const guard = scoreIntervention('자랑은 하지 마', client, dossier)
  assert.equal(guard.backfire, false, '경고를 역효과로 처리하면 안 된다')

  assert.equal(scoreIntervention('', client, dossier).power, 0)
})

// ─────────────────────────────────────────────── 고백 판정

test('고백 판정은 호감이 높을수록 잘 통과한다', () => {
  let lowWins = 0
  let highWins = 0
  for (let i = 0; i < 200; i++) {
    if (resolveConfession(20, 50, 'normal', new Rng(i)).ending.win) lowWins++
    if (resolveConfession(95, 95, 'normal', new Rng(i)).ending.win) highWins++
  }
  assert.equal(lowWins, 0, '호감 20으로 통과하면 안 된다')
  assert.equal(highWins, 200, '호감 95면 항상 통과해야 한다')
})

test('고백 판정은 시드가 같으면 같은 결과다', () => {
  const a = resolveConfession(70, 70, 'normal', new Rng(5))
  const b = resolveConfession(70, 70, 'normal', new Rng(5))
  assert.deepEqual(a.ending.id, b.ending.id)
  assert.equal(a.score, b.score)
})

// ─────────────────────────────────────────────── 터미널 폭 계산

test('한글은 두 칸으로 센다', () => {
  assert.equal(dw('abc'), 3)
  assert.equal(dw('가나다'), 6)
  assert.equal(dw('a가'), 3)
})

test('ANSI 코드는 폭에서 제외한다', () => {
  assert.equal(visibleWidth('\x1b[31m빨강\x1b[0m'), 4)
})

test('줄바꿈은 폭 기준으로 자른다', () => {
  const lines = wrap('가'.repeat(60), 20)
  for (const l of lines) assert.ok(visibleWidth(l) <= 20, `너무 김: ${visibleWidth(l)}`)
})
