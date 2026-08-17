// LLM 엔진 테스트.
//
// 핵심 계약이 하나 바뀌었다: 이제 폴백이 없다.
// 호출이 실패하면 게임은 그 자리에서 예외를 올린다. 조용히 대체 판정으로 넘어가면
// "오프라인 모드가 없다"는 약속이 깨진다 — 그래서 그걸 테스트로 못박는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createLlmEngine,
  createFetchTransport,
  buildRequest,
  verifyKey,
  LlmError,
  DEFAULT_MODEL,
} from '../game/engine/index.js'
import { Game } from '../game/core/game.js'
import { PHASES } from '../game/core/config.js'
import {
  judgeSchema,
  targetSchema,
  clientSystemPrompt,
  targetSystemPrompt,
  historyToMessages,
} from '../game/engine/prompts.js'

function makeGame(engine) {
  const g = new Game({ seed: 4, difficulty: 'normal', engine })
  g.chooseClient('dohun')
  g.setStyling('가죽 재킷')
  g.setCoaching('야식 얘기를 꺼내고 상대 말을 들어라')
  g.setSpeech('도훈아 3년을 버틴 건 너야. 넌 할 수 있어!')
  return g
}

/** 스키마 모양으로 역할을 가려 알맞은 가짜 응답을 준다. */
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

// ─────────────────────────────────────────── 정상 경로

test('구조화 출력을 게임 수치로 옮긴다', async () => {
  const g = makeGame(createLlmEngine({ transport: fakeTransport() }))
  await g.beginRun()
  assert.equal(g.prep.llm.speechConfidence, 0.8)
  const e = await g.step()
  assert.equal(e.clientText, '아 저 사실 새벽에 라멘 먹는 거 좋아해요.')
  assert.equal(e.targetText, '죄책감까지가 세트 ㅋㅋ 인정')
  assert.equal(e.topic, 'latenight_food')
})

test('한 판이 끝까지 돈다', async () => {
  const g = makeGame(createLlmEngine({ transport: fakeTransport() }))
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

test('엔진 없이는 게임이 만들어지지 않는다', () => {
  assert.throws(() => new Game({ seed: 1 }), /LLM 연결 없이는/)
})

// ─────────────────────────────────────────── 폴백이 없다는 계약

test('호출이 실패하면 예외가 올라온다 (대체 판정 없음)', async () => {
  const engine = createLlmEngine({
    transport: async () => {
      throw new LlmError('네트워크 끊김', { kind: 'network', retriable: true })
    },
  })
  const g = makeGame(engine)
  await assert.rejects(() => g.beginRun(), /네트워크 끊김/)
})

test('대화 도중 실패해도 조용히 넘어가지 않는다', async () => {
  let calls = 0
  const engine = createLlmEngine({
    transport: async (payload) => {
      calls++
      if (calls > 2) throw new LlmError('중간에 끊김', { kind: 'server', retriable: true })
      return fakeTransport()(payload)
    },
  })
  const g = makeGame(engine)
  await g.beginRun()
  await assert.rejects(() => g.step(), /중간에 끊김/)
  assert.equal(g.log.length, 0, '실패한 턴이 기록으로 남으면 안 된다')
})

test('응답이 깨지면 예외가 올라온다', async () => {
  const engine = createLlmEngine({
    transport: async ({ schema }) =>
      schema
        ? { text: 'JSON 이 아님', json: null, stopReason: 'end_turn' }
        : { text: '안녕', json: null, stopReason: 'end_turn' },
  })
  const g = makeGame(engine)
  await assert.rejects(() => g.beginRun(), /해석하지 못했습니다/)
})

test('의뢰인이 빈 대사를 내면 예외가 올라온다', async () => {
  const engine = createLlmEngine({
    transport: async (p) => (p.schema ? fakeTransport()(p) : { text: '   ', json: null, stopReason: 'end_turn' }),
  })
  const g = makeGame(engine)
  await g.beginRun()
  await assert.rejects(() => g.step(), /아무 말도 하지 못했습니다/)
})

test('판정 수치는 허용 범위로 잘린다', async () => {
  const engine = createLlmEngine({
    transport: async ({ schema }) => {
      if (!schema) return { text: '안녕', json: null, stopReason: 'end_turn' }
      const props = Object.keys(schema.properties)
      if (props.includes('mood_delta')) {
        return {
          text: '',
          json: { mood_delta: 9999, love_delta: -9999, touched_preference: 'none', hit_landmine: 'none', reason: '극단값' },
          stopReason: 'end_turn',
        }
      }
      if (props.includes('reveals')) return { text: '', json: { text: '음', reveals: 'none' }, stopReason: 'end_turn' }
      return { text: '', json: { speech_confidence: 50, speech_comment: '', coaching_fidelity: 50, coaching_comment: '', styling_comment: '' }, stopReason: 'end_turn' }
    },
  })
  const g = makeGame(engine)
  await g.beginRun()
  const e = await g.step()
  assert.ok(e.moodDelta <= 14 && e.moodDelta >= -14)
  assert.ok(e.loveDelta <= 14 && e.loveDelta >= -14)
})

// ─────────────────────────────────────────── HTTP 전송 계층

function fakeFetch(handler) {
  return async (url, init) => handler({ url, init, body: JSON.parse(init.body) })
}
const okJson = (obj) => ({
  ok: true,
  status: 200,
  json: async () => ({
    content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
    stop_reason: 'end_turn',
  }),
})

test('브라우저 직접 호출 헤더와 인증 헤더를 보낸다', async () => {
  let seen = null
  const transport = createFetchTransport({
    apiKey: 'sk-ant-test',
    model: DEFAULT_MODEL,
    fetchImpl: fakeFetch((req) => {
      seen = req
      return okJson('안녕')
    }),
  })
  await transport({ system: 's', messages: [{ role: 'user', content: 'x' }] })

  assert.match(seen.url, /api\.anthropic\.com\/v1\/messages$/)
  assert.equal(seen.init.headers['x-api-key'], 'sk-ant-test')
  assert.equal(seen.init.headers['anthropic-version'], '2023-06-01')
  assert.equal(seen.init.headers['anthropic-dangerous-direct-browser-access'], 'true')
  assert.equal(seen.body.model, DEFAULT_MODEL)
})

test('키가 없으면 호출조차 하지 않는다', async () => {
  let called = false
  const transport = createFetchTransport({
    apiKey: '',
    model: DEFAULT_MODEL,
    fetchImpl: fakeFetch(() => {
      called = true
      return okJson('x')
    }),
  })
  await assert.rejects(() => transport({ system: 's', messages: [] }), /API 키가 없습니다/)
  assert.equal(called, false)
})

test('HTTP 오류를 종류별로 구분한다', async () => {
  const mk = (status, message = 'boom') =>
    createFetchTransport({
      apiKey: 'k',
      model: DEFAULT_MODEL,
      fetchImpl: async () => ({
        ok: false,
        status,
        statusText: 'ERR',
        json: async () => ({ error: { message } }),
      }),
    })

  for (const [status, kind, retriable] of [
    [401, 'auth', false],
    [403, 'auth', false],
    [429, 'rate_limit', true],
    [500, 'server', true],
    [400, 'request', false],
  ]) {
    const err = await mk(status).call(null, { system: 's', messages: [] }).catch((e) => e)
    assert.ok(err instanceof LlmError, `${status}: LlmError 여야 한다`)
    assert.equal(err.kind, kind, `${status} → ${kind}`)
    assert.equal(err.retriable, retriable, `${status} 재시도 가능 여부`)
    assert.match(err.message, /boom/)
  }
})

test('네트워크 자체가 실패하면 network 로 분류한다', async () => {
  const transport = createFetchTransport({
    apiKey: 'k',
    model: DEFAULT_MODEL,
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch')
    },
  })
  const err = await transport({ system: 's', messages: [] }).catch((e) => e)
  assert.equal(err.kind, 'network')
  assert.equal(err.retriable, true)
})

test('모델이 거절하면 refusal 로 던진다', async () => {
  const transport = createFetchTransport({
    apiKey: 'k',
    model: DEFAULT_MODEL,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ content: [], stop_reason: 'refusal', stop_details: { category: 'cyber' } }),
    }),
  })
  const err = await transport({ system: 's', messages: [] }).catch((e) => e)
  assert.equal(err.kind, 'refusal')
  assert.match(err.message, /cyber/)
})

test('스키마를 걸면 본문을 JSON 으로 파싱한다', async () => {
  const transport = createFetchTransport({
    apiKey: 'k',
    model: DEFAULT_MODEL,
    fetchImpl: async () => okJson({ a: 1 }),
  })
  const res = await transport({
    system: 's',
    messages: [],
    schema: { type: 'object', properties: { a: {} }, required: [], additionalProperties: false },
  })
  assert.deepEqual(res.json, { a: 1 })
})

test('verifyKey 는 실제로 한 번 호출한다', async () => {
  let n = 0
  await verifyKey({
    apiKey: 'k',
    fetchImpl: fakeFetch(() => {
      n++
      return okJson('OK')
    }),
  })
  assert.equal(n, 1)
  await assert.rejects(
    () => verifyKey({ apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 401, statusText: 'x', json: async () => ({}) }) }),
    /401/,
  )
})

// ─────────────────────────────────────────── 요청 규격

test('요청 본문이 Claude Opus 5 규격에 맞는다', () => {
  const req = buildRequest({
    model: DEFAULT_MODEL,
    system: '너는 판정 장치다',
    messages: [{ role: 'user', content: '안녕' }],
    schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    maxTokens: 600,
  })
  assert.equal(req.model, 'claude-opus-5')
  assert.equal(req.max_tokens, 600)
  for (const banned of ['temperature', 'top_p', 'top_k']) {
    assert.equal(req[banned], undefined, `${banned} 를 보내면 400 이 난다`)
  }
  assert.equal(req.thinking, undefined, 'thinking 은 기본값(adaptive)에 맡긴다')
  assert.equal(req.output_format, undefined, '구형 파라미터를 쓰면 안 된다')
  assert.equal(req.output_config.format.type, 'json_schema')
  assert.equal(req.output_config.effort, 'low')
  assert.equal(req.system[0].cache_control.type, 'ephemeral')

  const plain = buildRequest({ model: DEFAULT_MODEL, system: 's', messages: [] })
  assert.equal(plain.output_config.format, undefined)
})

test('대화 기록이 화자 기준으로 역할을 뒤집는다', () => {
  const history = [
    { who: 'client', text: '안녕하세요' },
    { who: 'target', text: '네 안녕하세요' },
    { who: 'client', text: '오늘 날씨 좋네요' },
  ]
  const asClient = historyToMessages(history, 'client')
  assert.equal(asClient[0].role, 'user', '첫 메시지는 user 여야 API 가 받는다')
  const asTarget = historyToMessages(history, 'target')
  for (let i = 1; i < asTarget.length; i++) {
    assert.notEqual(asTarget[i].role, asTarget[i - 1].role, '같은 역할 연속 금지')
  }
  assert.equal(historyToMessages([], 'client')[0].role, 'user')
})

// ─────────────────────────────────────────── 프롬프트 정보 격리

test('의뢰인 프롬프트에는 대상의 취향 정답지가 없다', async () => {
  const g = makeGame(createLlmEngine({ transport: fakeTransport() }))
  await g.beginRun()
  const ctx = g._ctx()
  const clientPrompt = clientSystemPrompt(ctx)
  for (const hidden of g.dossier.hiddenLikes) {
    assert.ok(!clientPrompt.includes(hidden), `숨은 취향 ${hidden} 이 새면 게임이 사라진다`)
  }
  for (const mine of g.dossier.mines) {
    assert.ok(!clientPrompt.includes(mine), `지뢰 ${mine} 가 새면 안 된다`)
  }
  assert.ok(targetSystemPrompt(ctx).includes('싫어하는'), '대상은 자기 지뢰를 알아야 한다')
})

test('판정 스키마는 유효한 취향 id 만 허용한다', async () => {
  const g = makeGame(createLlmEngine({ transport: fakeTransport() }))
  await g.beginRun()
  const ctx = g._ctx()
  const js = judgeSchema(ctx)
  assert.equal(js.additionalProperties, false)
  assert.ok(js.properties.touched_preference.enum.includes('none'))
  for (const id of g.client.target.likes) {
    assert.ok(js.properties.touched_preference.enum.includes(id))
  }
  assert.deepEqual(js.required.sort(), Object.keys(js.properties).sort())
  assert.ok(targetSchema(ctx).properties.reveals.enum.includes('none'))
})
