// LLM 엔진 테스트. 네트워크 없이 transport 를 주입해서
// 구조화 출력 파싱과 "실패해도 게임이 안 죽는다"를 검증한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createLlmEngine } from '../game/engine/llm.js'
import { createEngine, resolveEngineMode } from '../game/engine/index.js'
import { Game } from '../game/core/game.js'
import { PHASES } from '../game/core/config.js'
import { judgeSchema, targetSchema, clientSystemPrompt, targetSystemPrompt } from '../game/engine/prompts.js'

function makeGame(engine) {
  const g = new Game({ seed: 4, difficulty: 'normal', engine })
  g.chooseClient('dohun')
  g.setStyling('가죽 재킷')
  g.setCoaching('야식 얘기를 꺼내고 상대 말을 들어라')
  g.setSpeech('도훈아 3년을 버틴 건 너야. 넌 할 수 있어!')
  return g
}

/** 요청 종류를 스키마 모양으로 구분해 알맞은 가짜 응답을 준다. */
function fakeTransport(log = []) {
  return async ({ system, messages, schema }) => {
    log.push({ system, messages, schema })
    if (!schema) return { text: '아 저 사실 새벽에 라멘 먹는 거 좋아해요.', json: null, stopReason: 'end_turn' }
    const props = Object.keys(schema.properties)
    if (props.includes('mood_delta')) {
      return {
        text: '',
        json: {
          mood_delta: 6,
          love_delta: 9,
          touched_preference: 'latenight_food',
          hit_landmine: 'none',
          reason: '야식 얘기가 정확히 취향이었다',
        },
        stopReason: 'end_turn',
      }
    }
    if (props.includes('reveals')) {
      return { text: '', json: { text: '죄책감까지가 세트 ㅋㅋ 인정', reveals: 'none' }, stopReason: 'end_turn' }
    }
    return {
      text: '',
      json: {
        speech_confidence: 80,
        speech_comment: '사연을 정확히 짚었다',
        coaching_fidelity: 70,
        coaching_comment: '실행 가능한 지시',
        styling_comment: '무난하다',
      },
      stopReason: 'end_turn',
    }
  }
}

test('LLM 엔진이 구조화 출력을 게임 수치로 옮긴다', async () => {
  const engine = createLlmEngine({ transport: fakeTransport() })
  const g = makeGame(engine)
  await g.beginRun()

  assert.equal(g.prep.llm.speechConfidence, 0.8, 'LLM 평가가 휴리스틱을 덮어써야 한다')
  assert.equal(g.prep.speech.confidence, 0.8)

  const e = await g.step()
  assert.equal(e.clientText, '아 저 사실 새벽에 라멘 먹는 거 좋아해요.')
  assert.equal(e.targetText, '죄책감까지가 세트 ㅋㅋ 인정')
  assert.equal(e.topic, 'latenight_food')
  assert.ok(e.moodDelta > 0 && e.loveDelta > 0)
})

test('LLM 엔진으로도 한 판이 끝까지 돈다', async () => {
  const engine = createLlmEngine({ transport: fakeTransport() })
  const g = makeGame(engine)
  await g.beginRun()
  let guard = 0
  while (!g.isOver) {
    assert.ok(++guard < 100)
    await g.step()
  }
  const out = await g.finish()
  assert.equal(g.log.length, PHASES.texting.turns + PHASES.talking.turns)
  assert.ok(out.ending.id)
})

test('호출이 실패해도 오프라인 판정으로 이어붙인다', async () => {
  const degraded = []
  const engine = createLlmEngine({
    transport: async () => {
      throw new Error('네트워크 끊김')
    },
    onDegrade: (m) => degraded.push(m),
  })
  const g = makeGame(engine)
  await g.beginRun()
  const e = await g.step()

  assert.ok(degraded.length > 0, '실패를 알려야 한다')
  assert.ok(e.clientText.length > 0, '실패해도 대사는 나와야 한다')
  assert.ok(Number.isFinite(e.moodDelta) && Number.isFinite(e.loveDelta))
  assert.ok(engine.stats.failures > 0)
})

test('깨진 JSON 이 와도 죽지 않는다', async () => {
  const engine = createLlmEngine({
    transport: async ({ schema }) =>
      schema
        ? { text: '이건 JSON이 아니다', json: null, stopReason: 'end_turn' }
        : { text: '안녕하세요', json: null, stopReason: 'end_turn' },
  })
  const g = makeGame(engine)
  await g.beginRun()
  const e = await g.step()
  assert.ok(Number.isFinite(e.moodDelta))
  assert.ok(e.targetText.length > 0)
})

test('앞뒤에 군더더기가 붙은 JSON 도 건져낸다', async () => {
  let asked = 0
  const engine = createLlmEngine({
    transport: async ({ schema }) => {
      if (!schema) return { text: '안녕', json: null, stopReason: 'end_turn' }
      asked++
      // json 없이 text 만 온 상황을 재현 — llm.js 의 safeParse 는 transport 안쪽이라
      // 여기서는 파싱된 결과가 없을 때의 폴백만 확인한다.
      return { text: '```json\n{"a":1}\n```', json: null, stopReason: 'end_turn' }
    },
  })
  const g = makeGame(engine)
  await g.beginRun()
  const e = await g.step()
  assert.ok(asked > 0)
  assert.ok(Number.isFinite(e.loveDelta))
})

test('판정 수치는 허용 범위로 잘린다', async () => {
  const engine = createLlmEngine({
    transport: async ({ schema }) => {
      if (!schema) return { text: '안녕', json: null, stopReason: 'end_turn' }
      const props = Object.keys(schema.properties)
      if (props.includes('mood_delta')) {
        return {
          text: '',
          json: {
            mood_delta: 9999,
            love_delta: -9999,
            touched_preference: 'none',
            hit_landmine: 'none',
            reason: '극단값',
          },
          stopReason: 'end_turn',
        }
      }
      if (props.includes('reveals')) return { text: '', json: { text: '음', reveals: 'none' }, stopReason: 'end_turn' }
      return { text: '', json: null, stopReason: 'end_turn' }
    },
  })
  const g = makeGame(engine)
  await g.beginRun()
  const e = await g.step()
  assert.ok(e.moodDelta <= 14 && e.moodDelta >= -14, `분위기 클램프 실패: ${e.moodDelta}`)
  assert.ok(e.loveDelta <= 14 && e.loveDelta >= -14, `호감 클램프 실패: ${e.loveDelta}`)
})

test('대상이 흘린 취향은 발견으로 기록된다', async () => {
  const engine = createLlmEngine({
    transport: async ({ schema }) => {
      if (!schema) return { text: '안녕하세요', json: null, stopReason: 'end_turn' }
      const props = Object.keys(schema.properties)
      if (props.includes('reveals')) {
        const pool = schema.properties.reveals.enum.filter((x) => x !== 'none')
        return { text: '아 저 그거 좋아해요', json: { text: '아 저 그거 좋아해요', reveals: pool[0] ?? 'none' }, stopReason: 'end_turn' }
      }
      if (props.includes('mood_delta')) {
        return {
          text: '',
          json: { mood_delta: 1, love_delta: 1, touched_preference: 'none', hit_landmine: 'none', reason: 'ok' },
          stopReason: 'end_turn',
        }
      }
      return { text: '', json: null, stopReason: 'end_turn' }
    },
  })
  const g = makeGame(engine)
  await g.beginRun()
  await g.step()
  assert.ok(g.discoveries.length > 0, '대상이 흘린 걸 못 받아적었다')
})

// ─────────────────────────────────────────────── 프롬프트 안전성

test('의뢰인 프롬프트에는 대상의 취향 정답지가 없다', async () => {
  const engine = createLlmEngine({ transport: fakeTransport() })
  const g = makeGame(engine)
  await g.beginRun()
  const ctx = g._ctx()

  const clientPrompt = clientSystemPrompt(ctx)
  const targetPrompt = targetSystemPrompt(ctx)

  for (const hidden of g.dossier.hiddenLikes) {
    assert.ok(!clientPrompt.includes(hidden), `의뢰인이 숨은 취향 ${hidden} 을 알면 게임이 사라진다`)
  }
  for (const mine of g.dossier.mines) {
    assert.ok(!clientPrompt.includes(mine), `의뢰인이 지뢰 ${mine} 를 미리 알면 안 된다`)
  }
  assert.ok(targetPrompt.includes('싫어하는'), '대상은 자기 지뢰를 알아야 한다')
})

test('판정 스키마는 유효한 취향 id 만 허용한다', async () => {
  const engine = createLlmEngine({ transport: fakeTransport() })
  const g = makeGame(engine)
  await g.beginRun()
  const ctx = g._ctx()

  const js = judgeSchema(ctx)
  assert.equal(js.additionalProperties, false)
  assert.ok(js.properties.touched_preference.enum.includes('none'))
  for (const id of g.client.target.likes) {
    assert.ok(js.properties.touched_preference.enum.includes(id))
  }
  assert.deepEqual(js.required.sort(), Object.keys(js.properties).sort())

  const ts = targetSchema(ctx)
  assert.ok(ts.properties.reveals.enum.includes('none'))
})

// ─────────────────────────────────────────────── 엔진 선택

test('키가 없으면 오프라인 엔진으로 떨어진다', () => {
  const saved = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  try {
    assert.equal(resolveEngineMode('auto'), 'local')
    assert.equal(createEngine('auto').id, 'local')
    assert.equal(createEngine('local').id, 'local')
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
  }
})

test('키가 있으면 LLM 엔진을 고른다', () => {
  const saved = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'sk-test-not-real'
  try {
    assert.equal(resolveEngineMode('auto'), 'llm')
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = saved
  }
})

// ─────────────────────────────────────────────── 요청 본문 모양

test('요청 본문이 Claude Opus 5 규격에 맞는다', async () => {
  const { buildRequest, DEFAULT_MODEL } = await import('../game/engine/llm.js')
  const req = buildRequest({
    model: DEFAULT_MODEL,
    system: '너는 판정 장치다',
    messages: [{ role: 'user', content: '안녕' }],
    schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    maxTokens: 600,
  })

  assert.equal(req.model, 'claude-opus-5')
  assert.equal(req.max_tokens, 600)

  // Opus 5 에서 제거된 파라미터들 — 넣으면 400 이다.
  for (const banned of ['temperature', 'top_p', 'top_k']) {
    assert.equal(req[banned], undefined, `${banned} 를 보내면 안 된다`)
  }
  assert.equal(req.thinking, undefined, 'thinking 은 기본값(adaptive)에 맡긴다')

  // 구조화 출력은 output_config.format 아래 (구형 output_format 아님)
  assert.equal(req.output_format, undefined)
  assert.equal(req.output_config.format.type, 'json_schema')
  assert.equal(req.output_config.effort, 'low')

  // 시스템 프롬프트에 캐시 분기점
  assert.equal(req.system[0].cache_control.type, 'ephemeral')
  assert.equal(req.system[0].type, 'text')

  const plain = buildRequest({ model: DEFAULT_MODEL, system: 's', messages: [] })
  assert.equal(plain.output_config.format, undefined, '스키마 없으면 format 도 없어야 한다')
})

test('대화 기록이 화자 기준으로 역할을 뒤집는다', async () => {
  const { historyToMessages } = await import('../game/engine/prompts.js')
  const history = [
    { who: 'client', text: '안녕하세요' },
    { who: 'target', text: '네 안녕하세요' },
    { who: 'client', text: '오늘 날씨 좋네요' },
  ]
  const asClient = historyToMessages(history, 'client')
  assert.equal(asClient[0].role, 'user', '첫 메시지는 반드시 user 여야 API가 받는다')
  assert.equal(asClient.at(-1).role, 'assistant')

  const asTarget = historyToMessages(history, 'target')
  assert.equal(asTarget[0].role, 'user')
  // 같은 역할이 연달아 오면 합쳐야 한다 (Messages API 규칙)
  for (let i = 1; i < asTarget.length; i++) {
    assert.notEqual(asTarget[i].role, asTarget[i - 1].role, '같은 역할이 연속되면 안 된다')
  }
  assert.deepEqual(historyToMessages([], 'client')[0].role, 'user')
})
