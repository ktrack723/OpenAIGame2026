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
import { parseAppearance, sameAppearance } from '../web/three/appearance.js'

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
    assert.ok(c.appearance.length >= 3, `${c.name}: 3D 외형에 쓸 외모 태그가 부족하다`)
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

// ─────────────────────────────────────────────── 외모 텍스트 → 3D 명세

test('옷 종류를 문장에서 읽어낸다', () => {
  const of = (styling) => parseAppearance({ styling, seedName: 'x' }).outfit.type
  assert.equal(of('검정 후드티'), 'hoodie')
  assert.equal(of('흰 정장에 넥타이'), 'suit')
  assert.equal(of('빨간 원피스'), 'dress')
  assert.equal(of('가죽 재킷'), 'jacket')
  assert.equal(of('체크 셔츠'), 'shirt')
  assert.equal(of('니트 가디건'), 'knit')
})

test('색 단어가 가까운 명사에 붙는다', () => {
  const a = parseAppearance({ styling: '분홍 머리, 검정 재킷', seedName: 'x' })
  assert.equal(a.hair.color, '#e46ba8', '머리색이 분홍이어야 한다')
  assert.equal(a.outfit.color, '#1b1b20', '옷색이 검정이어야 한다')
})

test('머리 모양을 구분한다', () => {
  const hs = (t) => parseAppearance({ styling: t, seedName: 'x' }).hair.style
  assert.equal(hs('긴 머리'), 'long')
  assert.equal(hs('포니테일'), 'ponytail')
  assert.equal(hs('삭발'), 'buzz')
  assert.equal(hs('부스스한 머리'), 'messy')
  assert.equal(hs('단발'), 'bob')
})

test('소품을 모아 담는다', () => {
  const a = parseAppearance({ styling: '뿔테 안경, 헤드폰, 은 목걸이, 워커 부츠, 우산', seedName: 'x' })
  for (const want of ['glasses', 'headphones', 'necklace', 'boots', 'umbrella']) {
    assert.ok(a.accessories.includes(want), `${want} 를 못 읽었다`)
  }
})

test('체형과 자세가 태그를 따라간다', () => {
  const tall = parseAppearance({ appearanceTags: ['큰 키'], seedName: 'x' })
  const small = parseAppearance({ appearanceTags: ['작은 키'], seedName: 'x' })
  assert.ok(tall.height > small.height)

  const broad = parseAppearance({ appearanceTags: ['넓은 어깨', '근육'], seedName: 'x' })
  const thin = parseAppearance({ appearanceTags: ['마른'], seedName: 'x' })
  assert.ok(broad.build > thin.build)

  const slouch = parseAppearance({ appearanceTags: ['구부정한 어깨'], seedName: 'x' })
  const upright = parseAppearance({ appearanceTags: ['꼿꼿한 자세'], seedName: 'x' })
  assert.ok(slouch.posture > upright.posture)
})

test('서류철 외모와 플레이어 스타일링이 합쳐진다', () => {
  const client = getClient('dohun') // 항상 후드티, 손톱에 접착제 자국, 다크서클
  const base = parseAppearance({ appearanceTags: client.appearance, seedName: client.name })
  assert.equal(base.outfit.type, 'hoodie', '서류철 외모가 반영돼야 한다')
  assert.equal(base.darkCircles, true)

  const styled = parseAppearance({
    appearanceTags: client.appearance,
    styling: '흰 정장',
    seedName: client.name,
  })
  assert.equal(styled.outfit.type, 'suit', '플레이어 스타일링이 서류철을 덮어써야 한다')
})

test('같은 입력은 같은 명세를 낸다', () => {
  const a = parseAppearance({ styling: '가죽 재킷, 헤드폰', seedName: '김도훈' })
  const b = parseAppearance({ styling: '가죽 재킷, 헤드폰', seedName: '김도훈' })
  assert.ok(sameAppearance(a, b))
  const c = parseAppearance({ styling: '흰 정장', seedName: '김도훈' })
  assert.ok(!sameAppearance(a, c))
})

test('빈 입력이어도 온전한 명세가 나온다', () => {
  const a = parseAppearance({})
  assert.ok(a.height > 0 && a.skin && a.hair.style && a.outfit.type)
  assert.ok(Array.isArray(a.accessories))
})
