// 준비 단계(스타일링·코칭·격려)와 최종 고백 판정의 수치화.
//
// 오프라인 엔진에서는 여기 있는 휴리스틱이 그대로 점수가 되고, LLM 엔진에서는 LLM 판정이
// 우선하되 응답이 깨졌을 때 여기로 되돌아온다. 즉 이 파일은 "항상 동작하는 바닥"이다.

import { TOPICS, LANDMINES } from '../data/topics.js'
import { BALANCE, DIFFICULTIES, ENDINGS, clamp } from './config.js'

export function normalizeText(s) {
  return String(s ?? '').toLowerCase()
}

/** 쉼표/줄바꿈/슬래시로 구분된 태그 입력을 배열로. */
export function splitTags(s) {
  return String(s ?? '')
    .split(/[,\n;/·|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * 임의의 텍스트에서 화제 신호를 뽑는다.
 * @returns {{id:string, hits:number, isMine:boolean}[]} 히트 많은 순
 */
export function matchTopics(text) {
  const hay = normalizeText(text)
  if (!hay) return []
  const out = []
  const scan = (dict, isMine) => {
    for (const [id, t] of Object.entries(dict)) {
      const needles = [...(t.keywords ?? []), ...(t.style ?? [])]
      let hits = 0
      for (const n of needles) {
        if (n && hay.includes(normalizeText(n))) hits++
      }
      if (hits > 0) out.push({ id, hits, isMine })
    }
  }
  scan(TOPICS, false)
  scan(LANDMINES, true)
  return out.sort((a, b) => b.hits - a.hits)
}

// "자랑은 하지 마" 는 자랑하라는 지시가 아니다.
// 이걸 구분 못 하면 올바른 코칭이 오히려 감점당한다 — 실제로 밟았던 함정이다.
const NEGATION = /(하지\s*마|하지\s*말|하지\s*않|말고|말아|금지|피해|피하|안\s*돼|안\s*된|하면\s*안|빼|없이|삼가|자제)/

/**
 * 텍스트가 어떤 지뢰 화제를 "시키는지" 아니면 "금지하는지" 판정한다.
 * @returns {'invoke'|'avoid'|null}
 */
export function mineIntent(text, mineDef) {
  const hay = normalizeText(text)
  let found = false
  for (const kw of [...(mineDef.keywords ?? []), ...(mineDef.style ?? [])]) {
    const needle = normalizeText(kw)
    let from = 0
    for (;;) {
      const at = hay.indexOf(needle, from)
      if (at === -1) break
      found = true
      // 키워드 뒤 16자 안에 부정 표현이 있으면 "하지 마라"로 읽는다.
      const after = hay.slice(at + needle.length, at + needle.length + 16)
      const before = hay.slice(Math.max(0, at - 8), at)
      if (NEGATION.test(after) || /절대|굳이|괜히/.test(before)) return 'avoid'
      from = at + needle.length
    }
  }
  return found ? 'invoke' : null
}

/**
 * 난이도에 따라 대상의 취향 중 무엇을 공개할지 정한다.
 * 취향 목록 자체는 의뢰인마다 고정(기획서 1-4)이고, 가려지는 범위만 난이도가 정한다.
 */
export function buildDossier(client, difficultyId, rng) {
  const diff = DIFFICULTIES[difficultyId] ?? DIFFICULTIES.normal
  const likes = client.target.likes.slice()
  const shuffled = rng.shuffle(likes)
  const visibleCount = Math.max(1, Math.round(likes.length * diff.visibleLikeRatio))
  const visibleLikes = shuffled.slice(0, visibleCount)
  const hiddenLikes = shuffled.slice(visibleCount)
  const mines = rng.shuffle(client.target.mines.slice()).slice(0, diff.landmines)
  return {
    difficulty: diff.id,
    likes,
    visibleLikes,
    hiddenLikes,
    mines,
    revealed: new Set(), // 대화 중 플레이어가 알아낸 것들
  }
}

/** 플레이어가 이미 알고 있는(공개 + 대화로 알아낸) 취향 id 집합. */
export function knownLikes(dossier) {
  return new Set([...dossier.visibleLikes, ...[...dossier.revealed].filter((id) => dossier.likes.includes(id))])
}

export function knownMines(dossier) {
  return new Set([...dossier.revealed].filter((id) => dossier.mines.includes(id)))
}

/**
 * 기획서 2-1) 스타일링.
 * 대상의 취향에 닿는 태그는 시작 호감을, 지뢰를 건드리는 태그는 페널티를 준다.
 */
export function scoreStyling(rawTags, client, dossier) {
  const tags = splitTags(rawTags)
  const matched = []
  const clashed = []
  const neutral = []

  for (const tag of tags) {
    const hits = matchTopics(tag)
    const like = hits.find((h) => !h.isMine && dossier.likes.includes(h.id))
    const mine = hits.find((h) => h.isMine && dossier.mines.includes(h.id))
    if (mine) clashed.push({ tag, topic: mine.id })
    else if (like) matched.push({ tag, topic: like.id })
    else neutral.push(tag)
  }

  // 같은 취향을 여러 태그로 중복해서 맞혀도 한 번만 인정한다.
  const uniqueMatched = [...new Set(matched.map((m) => m.topic))]
  const uniqueClashed = [...new Set(clashed.map((m) => m.topic))]

  const hitRatio = client.target.likes.length ? uniqueMatched.length / client.target.likes.length : 0
  const mineRatio = dossier.mines.length ? uniqueClashed.length / dossier.mines.length : 0

  const loveBonus = Math.round(
    hitRatio * BALANCE.stylingLoveBonusMax + mineRatio * BALANCE.stylingLoveClashMax,
  )

  // 화제를 꺼낸 턴에만 조금씩 붙는 잔여 보정.
  // 범위를 넓게 잡으면 '아무 말이나 해도 매 턴 +2' 가 되어 스타일링 하나로 판이 끝난다.
  const resonance = clamp(uniqueMatched.length * 0.35 - uniqueClashed.length * 0.5, -1, 1)

  return {
    tags,
    matched: uniqueMatched,
    clashed: uniqueClashed,
    neutral,
    loveBonus,
    resonance,
    score: clamp(hitRatio - mineRatio, -1, 1),
  }
}

const CRAFT_WORDS = [
  '질문',
  '들어',
  '경청',
  '천천히',
  '짧게',
  '솔직',
  '먼저',
  '눈',
  '웃',
  '리액션',
  '되물',
  '공감',
  '기다',
  '말 끊',
  '자랑하지',
  '이름',
]

/**
 * 기획서 2-2) 코칭.
 * 자유 서술을 그대로 시스템 프롬프트에 넣기 전에, 얼마나 "쓸 만한 지시"인지 계량한다.
 */
export function scoreCoaching(text, client, dossier) {
  const t = normalizeText(text)
  const len = t.trim().length
  if (len === 0) {
    return { fidelity: 0.15, topics: [], mineWarnings: [], avoidedMines: [], craft: 0, moodBonus: 0, empty: true }
  }

  const hits = matchTopics(text)
  const likeHits = hits.filter((h) => !h.isMine && dossier.likes.includes(h.id))

  // 지뢰를 언급했다면 "시킨 것"과 "막은 것"을 갈라 본다.
  const mineHits = []
  const avoided = []
  for (const h of hits) {
    if (!h.isMine || !dossier.mines.includes(h.id)) continue
    if (mineIntent(text, LANDMINES[h.id]) === 'avoid') avoided.push(h.id)
    else mineHits.push(h)
  }

  // 취향을 얼마나 짚었나 (공개/비공개 무관 — 찍어서 맞혀도 인정)
  const topicSignal = clamp(likeHits.length / Math.max(2, client.target.likes.length * 0.6), 0, 1)

  // 대화 기술 지시가 들어있나
  let craftHits = 0
  for (const w of CRAFT_WORDS) if (t.includes(w)) craftHits++
  const craft = clamp(craftHits / 4, 0, 1)

  // 길이: 너무 짧으면 지시가 안 되고, 너무 길면 의뢰인이 다 못 외운다.
  // 한국어는 밀도가 높아서 20자짜리도 충분히 온전한 지시다 — 여기서 후하게 잡지 않으면
  // 멀쩡한 코칭이 전부 0.25로 깔려버린다(실측으로 확인).
  const lengthFit = len < 8 ? 0.3 : len < 18 ? 0.7 : len <= 400 ? 1 : clamp(1 - (len - 400) / 600, 0.4, 1)

  let fidelity = 0.2 + 0.5 * topicSignal + 0.3 * craft
  fidelity *= lengthFit
  // 지뢰를 밟으라고 코칭했으면 깎는다
  fidelity -= mineHits.length * 0.2
  fidelity = clamp(fidelity, 0, 1)

  return {
    fidelity,
    topics: likeHits.map((h) => h.id),
    mineWarnings: mineHits.map((h) => h.id),
    avoidedMines: avoided,
    craft,
    lengthFit,
    moodBonus: Math.round(fidelity * BALANCE.coachingMoodBonusMax),
    empty: false,
  }
}

const HYPE_WORDS = [
  '할 수 있',
  '믿',
  '멋있',
  '괜찮',
  '가자',
  '자신',
  '준비',
  '최고',
  '충분',
  '용기',
  '너는',
  '당신은',
  '넌 ',
  '해낼',
  '숨',
  '괜찮아',
  '잘할',
  '기억',
  '진심',
]

const DEFLATE_WORDS = ['한심', '바보', '멍청', '쓸모없', '포기해', '망했']

/**
 * 기획서 2-3) 격려 연설.
 * "얼마나 멋있는가" + "의뢰인의 사연에 얼마나 맞닿아 있는가" 두 축으로 자신감을 만든다.
 */
export function scoreSpeech(text, client) {
  const raw = String(text ?? '')
  const t = normalizeText(raw)
  const len = raw.trim().length
  if (len === 0) {
    return { confidence: 0.2, relevance: 0, hype: 0, moodBonus: 0, empty: true, notes: ['연설 없음'] }
  }

  // 사연 적합성
  let storyHits = 0
  for (const k of client.storyKeywords) if (t.includes(normalizeText(k))) storyHits++
  const relevance = clamp(storyHits / 3, 0, 1)

  // 기세
  let hypeHits = 0
  for (const w of HYPE_WORDS) if (t.includes(w)) hypeHits++
  const bangs = (raw.match(/[!?]/g) ?? []).length
  const hype = clamp(hypeHits / 4 + Math.min(bangs, 4) / 12, 0, 1)

  let deflate = 0
  for (const w of DEFLATE_WORDS) if (t.includes(w)) deflate++

  const lengthFit = len < 12 ? 0.3 : len < 30 ? 0.65 : len <= 500 ? 1 : clamp(1 - (len - 500) / 800, 0.5, 1)

  let confidence = 0.18 + 0.34 * relevance + 0.34 * hype + 0.14 * lengthFit
  confidence -= deflate * 0.12
  confidence = clamp(confidence, 0, 1)

  const notes = []
  if (relevance >= 0.66) notes.push('사연을 정확히 짚었다')
  else if (relevance === 0) notes.push('사연과 겉돈다')
  if (hype >= 0.66) notes.push('기세가 실렸다')
  if (deflate) notes.push('깎아내리는 말이 섞였다')

  return {
    confidence,
    relevance,
    hype,
    moodBonus: Math.round(confidence * BALANCE.speechMoodBonusMax),
    empty: false,
    notes,
  }
}

/**
 * 개입(귓속말). 어떤 화제로 밀지, 얼마나 강하게 먹힐지, 역효과인지.
 */
export function scoreIntervention(text, client, dossier) {
  const raw = String(text ?? '').trim()
  if (!raw) return { topic: null, power: 0, backfire: false, note: '아무 말도 하지 않았다' }

  const hits = matchTopics(raw)
  // "자랑하지 마" 같은 경고는 역효과가 아니다 — 오히려 좋은 개입이다.
  const mine = hits.find(
    (h) => h.isMine && dossier.mines.includes(h.id) && mineIntent(raw, LANDMINES[h.id]) === 'invoke',
  )
  if (mine) {
    return { topic: mine.id, power: 1, backfire: true, note: `지뢰를 밟으라고 시켰다 (${LANDMINES[mine.id].label})` }
  }

  const like = hits.find((h) => !h.isMine && dossier.likes.includes(h.id))
  const any = hits.find((h) => !h.isMine)
  const topic = like?.id ?? any?.id ?? null

  let craftHits = 0
  const t = normalizeText(raw)
  for (const w of CRAFT_WORDS) if (t.includes(w)) craftHits++

  // 화제를 정확히 짚었으면 강하게, 태도만 지시했으면 중간, 아무 신호 없으면 약하게
  let power = 0.25
  if (like) power = 1
  else if (any) power = 0.6
  if (craftHits > 0) power = clamp(power + 0.2, 0, 1)
  if (raw.length < 6) power *= 0.5

  return {
    topic,
    power: clamp(power, 0, 1),
    backfire: false,
    note: topic ? `"${TOPICS[topic]?.label ?? topic}" 쪽으로 밀었다` : '태도만 다잡았다',
  }
}

/**
 * 기획서 5) 고백 판정. 즉시 결과가 아니라 "편지로 전해 듣는" 확률 판정이다.
 */
export function resolveConfession(love, mood, difficultyId, rng) {
  const diff = DIFFICULTIES[difficultyId] ?? DIFFICULTIES.normal
  const base = love * BALANCE.confessionLoveWeight + mood * BALANCE.confessionMoodWeight
  const luck = rng.float(-BALANCE.confessionLuck, BALANCE.confessionLuck)
  const score = base + luck
  const threshold = diff.confessionThreshold

  let ending
  if (score >= threshold) ending = ENDINGS.accepted
  else if (score >= threshold - BALANCE.nearMissBand) ending = ENDINGS.pending
  else ending = ENDINGS.rejected

  return {
    ending,
    score: Math.round(score * 10) / 10,
    base: Math.round(base * 10) / 10,
    luck: Math.round(luck * 10) / 10,
    threshold,
  }
}
