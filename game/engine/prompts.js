// LLM 엔진이 쓰는 프롬프트 조립기.
//
// 기획서대로 세 개의 역할이 돈다:
//   1) 의뢰인 — 플레이어의 코칭/격려/개입을 받아 말한다
//   2) 대상   — 자기 취향을 전부 알고 있고, 가끔 힌트를 흘린다
//   3) 심판   — 의뢰인의 매 발언을 분위기/호감 증감으로 환산한다
//
// 취향 목록은 대상과 심판만 본다. 의뢰인 프롬프트에는 절대 넣지 않는다 —
// 넣는 순간 게임이 사라진다.

import { TOPICS, LANDMINES } from '../data/topics.js'

function labelOf(id) {
  return TOPICS[id]?.label ?? LANDMINES[id]?.label ?? id
}

function confidenceBand(c) {
  if (c >= 0.8) return '아주 높음 — 오늘은 평소의 자신이 아니다. 말끝을 흐리지 않는다.'
  if (c >= 0.6) return '높음 — 긴장은 하지만 하고 싶은 말은 한다.'
  if (c >= 0.4) return '보통 — 가끔 말끝이 흐려진다.'
  if (c >= 0.2) return '낮음 — 자주 머뭇거리고 짧게 답한다.'
  return '바닥 — 거의 말을 못 잇는다.'
}

export function clientSystemPrompt(ctx) {
  const { client, prep, state, phase } = ctx
  const situation =
    phase === 'texting'
      ? '지금은 메신저로 대화 중이다. 문장은 짧고 구어체로. 이모지는 아껴서.'
      : '지금은 직접 마주 앉아 대화 중이다. 말투는 구어체, 가끔 행동 묘사를 괄호로 짧게 덧붙여도 된다.'

  return [
    `너는 ${client.name}(${client.age}), ${client.job}. 지금 ${client.target.name}에게 말을 걸고 있다.`,
    '',
    '## 너에 대해',
    `사연: ${client.story}`,
    `외모: ${client.appearance.join(', ')}`,
    `성격: ${client.personality.join(', ')}`,
    `버릇: ${client.quirk}`,
    `편한 화제: ${client.comfortTopics.map(labelOf).join(', ')}`,
    `어색한 화제: ${client.weakTopics.map(labelOf).join(', ')}`,
    '',
    '## 오늘의 상태',
    `자신감: ${confidenceBand(prep.speech.confidence)}`,
    `현재 분위기 체감: ${state.mood}/100`,
    prep.styling.tags.length ? `지금 입은 것: ${prep.styling.tags.join(', ')}` : '차림새: 평소 그대로',
    '',
    '## 코치가 준 지침',
    prep.coaching.empty ? '(따로 받은 지침이 없다. 알아서 해야 한다.)' : prep.coaching.text,
    '',
    ctx.activeIntervention?.text
      ? `## 방금 귓속말로 들어온 지시\n"${ctx.activeIntervention.text}"\n이번 발언에 이 지시를 반영해라.`
      : '',
    '',
    '## 규칙',
    situation,
    '- 한 번에 1~3문장. 길게 늘어놓지 마라.',
    '- 상대의 마지막 말에 반응한 뒤 이어가라.',
    '- 너는 상대의 취향 목록을 모른다. 코치가 알려준 것과 대화에서 느낀 것만 안다.',
    '- 자신감이 낮으면 실제로 어눌하게 말해라. 잘하는 척하지 마라.',
    '- 대사만 출력한다. 따옴표, 이름표, 설명은 붙이지 않는다.',
  ]
    .filter((l) => l !== '')
    .join('\n')
}

export function targetSystemPrompt(ctx) {
  const { client, dossier, state, phase } = ctx
  const t = client.target
  const hiddenPool = [
    ...dossier.hiddenLikes.filter((id) => !dossier.revealed.has(id)),
    ...dossier.mines.filter((id) => !dossier.revealed.has(id)),
  ]

  return [
    `너는 ${t.name}(${t.age}), ${t.job}. ${t.blurb}`,
    `지금 ${client.name}과(와) ${phase === 'texting' ? '메신저로' : '마주 앉아'} 대화 중이다.`,
    '',
    '## 네가 좋아하는 것 (상대는 모른다)',
    ...t.likes.map((id) => `- ${labelOf(id)}`),
    '',
    '## 네가 싫어하는 것 (상대는 모른다)',
    ...dossier.mines.map((id) => `- ${labelOf(id)}`),
    '',
    '## 지금 기분',
    `분위기 ${state.mood}/100, 호감 ${state.love}/100.`,
    '수치가 낮으면 실제로 시큰둥하게, 높으면 실제로 들뜨게 반응해라. 억지로 친절할 필요 없다.',
    '',
    '## 규칙',
    '- 한 번에 1~2문장. 구어체.',
    '- 좋아하는 화제가 나오면 눈에 띄게 반응하고, 싫어하는 화제가 나오면 눈에 띄게 식어라.',
    '- 네 취향을 대놓고 나열하지 마라. 티가 나게 흘리기만 해라.',
    hiddenPool.length
      ? `- 자연스러운 순간이라면 다음 중 하나를 은근히 흘려도 된다: ${hiddenPool.map(labelOf).join(', ')}. 흘렸다면 reveals 에 그 항목을 적어라.`
      : '- 더 흘릴 것은 없다. reveals 는 항상 "none".',
    '- 흘리지 않았으면 reveals 는 "none".',
  ].join('\n')
}

export function judgeSystemPrompt(ctx) {
  const { client, dossier } = ctx
  return [
    `너는 연애 코칭 기관의 판정 장치다. ${client.name}의 발언 하나를 읽고 두 수치의 증감을 정한다.`,
    '',
    '## 대상의 취향 (정답지)',
    '좋아함:',
    ...client.target.likes.map((id) => `- ${id}: ${labelOf(id)}`),
    '싫어함(지뢰):',
    ...dossier.mines.map((id) => `- ${id}: ${labelOf(id)}`),
    '',
    '## 판정 기준',
    'mood_delta (-14 ~ 14): 발언이 대화 흐름상 자연스러웠는가.',
    '  상대 말에 제대로 반응했으면 +, 뜬금없거나 같은 얘기 반복이면 -, 말이 끊기면 크게 -.',
    '  취향 적중 여부는 여기서 보지 않는다. 오직 "대화가 되었는가"만 본다.',
    '',
    'love_delta (-14 ~ 14): 발언이 대상의 취향을 만족시켰는가.',
    '  좋아하는 것을 건드렸으면 +7~+12, 지뢰를 밟았으면 -8~-13,',
    '  아무 관련 없으면 -2~+2. 흐름은 여기서 보지 않는다.',
    '',
    'touched_preference: 건드린 "좋아함" 항목의 id. 없으면 "none".',
    'hit_landmine: 밟은 "지뢰" 항목의 id. 없으면 "none".',
    'reason: 한국어 한 문장. 왜 그렇게 줬는지 짧게.',
    '',
    '두 수치는 독립이다. 어색하게 말했지만 취향을 맞혔으면 mood -, love + 가 정상이다.',
  ].join('\n')
}

/** 지금까지의 대화를 Messages API 형식으로. speaker 기준으로 역할을 뒤집는다. */
export function historyToMessages(history, speaker) {
  const msgs = []
  for (const h of history) {
    const role = h.who === speaker ? 'assistant' : 'user'
    const last = msgs[msgs.length - 1]
    if (last && last.role === role) last.content += `\n${h.text}`
    else msgs.push({ role, content: h.text })
  }
  if (msgs.length === 0 || msgs[0].role !== 'user') {
    msgs.unshift({ role: 'user', content: '(대화를 시작한다)' })
  }
  return msgs
}

export function judgeUserMessage(ctx, utter) {
  const recent = ctx.history.slice(-6).map((h) => `${h.who === 'client' ? ctx.client.name : ctx.client.target.name}: ${h.text}`)
  return [
    '## 직전 대화',
    recent.length ? recent.join('\n') : '(아직 없음)',
    '',
    `## 판정할 발언 (${ctx.client.name})`,
    utter.text,
  ].join('\n')
}

/** 심판 구조화 출력 스키마. 취향 id 를 enum 으로 박아 오답을 원천 차단한다. */
export function judgeSchema(ctx) {
  return {
    type: 'object',
    properties: {
      mood_delta: { type: 'integer', description: '-14 ~ 14' },
      love_delta: { type: 'integer', description: '-14 ~ 14' },
      touched_preference: { type: 'string', enum: [...ctx.client.target.likes, 'none'] },
      hit_landmine: { type: 'string', enum: [...ctx.dossier.mines, 'none'] },
      reason: { type: 'string' },
    },
    required: ['mood_delta', 'love_delta', 'touched_preference', 'hit_landmine', 'reason'],
    additionalProperties: false,
  }
}

export function targetSchema(ctx) {
  const pool = [
    ...ctx.dossier.hiddenLikes.filter((id) => !ctx.dossier.revealed.has(id)),
    ...ctx.dossier.mines.filter((id) => !ctx.dossier.revealed.has(id)),
  ]
  return {
    type: 'object',
    properties: {
      text: { type: 'string', description: '대사 1~2문장' },
      reveals: { type: 'string', enum: [...pool, 'none'] },
    },
    required: ['text', 'reveals'],
    additionalProperties: false,
  }
}

/** 준비 단계(스타일링·코칭·격려) 총평 스키마 — LLM 모드에서만 쓴다. */
export function prepSchema() {
  return {
    type: 'object',
    properties: {
      speech_confidence: { type: 'integer', description: '0~100, 격려 연설이 의뢰인에게 준 자신감' },
      speech_comment: { type: 'string', description: '연설에 대한 한국어 한 문장 촌평' },
      coaching_fidelity: { type: 'integer', description: '0~100, 코칭이 실행 가능한 지시인지' },
      coaching_comment: { type: 'string' },
      styling_comment: { type: 'string' },
    },
    required: ['speech_confidence', 'speech_comment', 'coaching_fidelity', 'coaching_comment', 'styling_comment'],
    additionalProperties: false,
  }
}

export function prepUserMessage(ctx) {
  const { client, prep } = ctx
  return [
    `## 의뢰인\n${client.name} — ${client.story}`,
    `성격: ${client.personality.join(', ')}`,
    '',
    `## 코치가 입힌 것\n${prep.styling.tags.join(', ') || '(없음)'}`,
    `## 코치가 준 대화 지침\n${prep.coaching.text || '(없음)'}`,
    `## 코치의 격려 연설\n${prep.speech.text || '(없음)'}`,
    '',
    '연설은 "얼마나 기세가 있는가"와 "의뢰인의 사연에 얼마나 맞닿아 있는가"로 평가한다.',
    '사연과 무관한 일반론이면 낮게, 이 사람의 이야기를 정확히 짚으면 높게.',
    '코칭은 "의뢰인이 실제로 따라할 수 있는 지시인가"로 평가한다.',
  ].join('\n')
}
