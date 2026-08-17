// LLM 엔진 — Anthropic Messages API.
//
// 이 게임에는 오프라인 모드가 없다. 의뢰인·상대·심판이 전부 모델이고,
// 호출이 실패하면 그 자리에서 멈춘다. 조용히 대체 판정으로 넘어가지 않는다.
//
// 브라우저에서 직접 부른다:
//   - GitHub Pages 는 정적 호스팅이라 중계 서버가 없다.
//   - 번들러 없이 돌아야 해서 공식 SDK 대신 fetch 를 쓴다. SDK 를 쓰려면 CDN 이나
//     빌드 단계가 필요한데, 둘 다 이 배포 형태에서 깨지기 쉬운 의존성이다.
//   - 대신 Anthropic 이 공식 지원하는 브라우저 직접 호출 헤더를 붙인다.
//
// 키는 사용자가 직접 입력하고 브라우저에만 남는다(localStorage). 공용 기기에서는
// 쓰지 말라고 UI 에 적어 두었다.

import {
  clientSystemPrompt,
  targetSystemPrompt,
  judgeSystemPrompt,
  judgeUserMessage,
  judgeSchema,
  targetSchema,
  historyToMessages,
  prepSchema,
  prepUserMessage,
} from './prompts.js'
import { BALANCE, clamp } from '../core/config.js'

export const DEFAULT_MODEL = 'claude-opus-5'
export const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'

/** 호출 실패를 UI 가 구분할 수 있게 태그를 붙여 던진다. */
export class LlmError extends Error {
  constructor(message, { kind = 'unknown', status = 0, retriable = false } = {}) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
    this.status = status
    this.retriable = retriable
  }
}

/**
 * Messages API 요청 본문.
 *
 * Claude Opus 5 에서 temperature / top_p / top_k / budget_tokens 는 제거되어
 * 넣으면 400 이 난다. thinking 은 기본값(adaptive)에 맡긴다 — 끄면 도구 호출이
 * 평문으로 새는 알려진 실패 모드가 있다. 비용은 effort 로 잡는다.
 */
export function buildRequest({ model, system, messages, schema, maxTokens = 1024 }) {
  return {
    model,
    max_tokens: maxTokens,
    // 시스템 프롬프트는 판 내내 고정이라 캐시 분기점을 걸어둔다.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
    output_config: {
      effort: 'low',
      ...(schema ? { format: { type: 'json_schema', schema } } : {}),
    },
  }
}

function safeParse(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

/** 브라우저에서 직접 부르는 전송 계층. */
export function createFetchTransport({ apiKey, model, baseURL = DEFAULT_BASE_URL, fetchImpl }) {
  const doFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis)
  if (!doFetch) throw new LlmError('이 환경에는 fetch 가 없습니다', { kind: 'env' })

  return async function transport({ system, messages, schema, maxTokens = 1024 }) {
    if (!apiKey) throw new LlmError('API 키가 없습니다', { kind: 'auth' })

    let res
    try {
      res = await doFetch(`${baseURL}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
          // 브라우저에서 직접 호출할 때 Anthropic 이 요구하는 헤더
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(buildRequest({ model, system, messages, schema, maxTokens })),
      })
    } catch (err) {
      throw new LlmError(`네트워크에 닿지 못했습니다 (${err.message})`, {
        kind: 'network',
        retriable: true,
      })
    }

    if (!res.ok) {
      let detail = ''
      try {
        const body = await res.json()
        detail = body?.error?.message ?? ''
      } catch {
        /* 본문이 JSON 이 아닐 수 있다 */
      }
      const kind =
        res.status === 401 || res.status === 403
          ? 'auth'
          : res.status === 429
            ? 'rate_limit'
            : res.status >= 500
              ? 'server'
              : 'request'
      throw new LlmError(
        `${res.status} ${detail || res.statusText || '요청이 거절됐습니다'}`,
        { kind, status: res.status, retriable: res.status === 429 || res.status >= 500 },
      )
    }

    const data = await res.json()

    if (data.stop_reason === 'refusal') {
      throw new LlmError(`모델이 요청을 거절했습니다 (${data.stop_details?.category ?? '분류 없음'})`, {
        kind: 'refusal',
      })
    }

    const text = data.content?.find((b) => b.type === 'text')?.text ?? ''
    return { text, json: schema ? safeParse(text) : null, stopReason: data.stop_reason }
  }
}

function toInt(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

function need(json, label) {
  if (!json) {
    throw new LlmError(`${label}: 모델 응답을 해석하지 못했습니다`, { kind: 'parse', retriable: true })
  }
  return json
}

/**
 * @param {object} opts
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {Function} [opts.transport] 테스트 주입 지점
 * @param {(label:string)=>void} [opts.onCall] 진행 표시용
 */
export function createLlmEngine(opts = {}) {
  const model = opts.model ?? DEFAULT_MODEL
  const transport =
    opts.transport ??
    createFetchTransport({
      apiKey: opts.apiKey,
      model,
      baseURL: opts.baseURL,
      fetchImpl: opts.fetchImpl,
    })
  const onCall = opts.onCall ?? (() => {})
  const stats = { calls: 0, inputTokens: 0, outputTokens: 0 }

  async function call(label, payload) {
    stats.calls++
    onCall(label)
    return transport(payload)
  }

  return {
    id: 'llm',
    label: model,
    model,
    stats,

    async evaluatePrep(ctx) {
      const res = await call('준비 평가', {
        system:
          '너는 연애 코칭 기관의 준비 단계 심사관이다. 코치가 의뢰인에게 해준 준비를 평가한다. 한국어로 답한다.',
        messages: [{ role: 'user', content: prepUserMessage(ctx) }],
        schema: prepSchema(),
        maxTokens: 800,
      })
      const j = need(res.json, '준비 평가')
      return {
        speechConfidence: clamp(toInt(j.speech_confidence, 50) / 100, 0, 1),
        speechComment: String(j.speech_comment ?? ''),
        coachingFidelity: clamp(toInt(j.coaching_fidelity, 50) / 100, 0, 1),
        coachingComment: String(j.coaching_comment ?? ''),
        stylingComment: String(j.styling_comment ?? ''),
      }
    },

    async clientTurn(ctx) {
      const res = await call('의뢰인', {
        system: clientSystemPrompt(ctx),
        messages: historyToMessages(ctx.history, 'client'),
        maxTokens: 512,
      })
      const text = res.text?.trim()
      if (!text) throw new LlmError('의뢰인이 아무 말도 하지 못했습니다', { kind: 'empty', retriable: true })
      return { text, topic: null, tier: null }
    },

    async targetTurn(ctx, utter) {
      const res = await call('상대', {
        system: targetSystemPrompt(ctx),
        messages: historyToMessages([...ctx.history, { who: 'client', text: utter.text }], 'target'),
        schema: targetSchema(ctx),
        maxTokens: 512,
      })
      const j = need(res.json, '상대 반응')
      const text = String(j.text ?? '').trim()
      if (!text) throw new LlmError('상대가 아무 말도 하지 못했습니다', { kind: 'empty', retriable: true })
      return { text, topic: null, hintTopic: j.reveals && j.reveals !== 'none' ? j.reveals : null }
    },

    async judge(ctx, utter) {
      const res = await call('판정', {
        system: judgeSystemPrompt(ctx),
        messages: [{ role: 'user', content: judgeUserMessage(ctx, utter) }],
        schema: judgeSchema(ctx),
        maxTokens: 600,
      })
      const j = need(res.json, '판정')
      const touched = j.touched_preference && j.touched_preference !== 'none' ? j.touched_preference : null
      const mine = j.hit_landmine && j.hit_landmine !== 'none' ? j.hit_landmine : null
      const hitId = mine ?? touched

      return {
        moodDelta: clamp(toInt(j.mood_delta), -BALANCE.moodDeltaClamp, BALANCE.moodDeltaClamp),
        loveDeltaRaw: clamp(toInt(j.love_delta), -BALANCE.loveDeltaClamp, BALANCE.loveDeltaClamp),
        reason: String(j.reason ?? '').trim() || '판정됨',
        discovered: hitId && !ctx.dossier.revealed.has(hitId) ? hitId : null,
        topic: hitId,
      }
    },
  }
}

/** 키가 실제로 통하는지 한 번 확인한다. 게임 시작 전 관문. */
export async function verifyKey({ apiKey, model = DEFAULT_MODEL, baseURL, fetchImpl }) {
  const transport = createFetchTransport({ apiKey, model, baseURL, fetchImpl })
  await transport({
    system: '연결 확인용이다. 정확히 "OK" 한 단어만 답한다.',
    messages: [{ role: 'user', content: 'ping' }],
    maxTokens: 16,
  })
  return true
}
