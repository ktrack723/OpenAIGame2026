// LLM 엔진 — Anthropic Messages API.
//
// 기획서의 "두 개의 GPT가 서로 대화하고, 의뢰인의 매 발언이 평가된다"를 그대로 구현한다.
// 의뢰인 / 대상 / 심판 세 역할이 각각 한 번의 호출이다.
//
// 중요한 성질 두 가지:
//   1) 호출이 실패하면 그 턴만 오프라인 엔진으로 대신한다. 게임이 중간에 죽지 않는다.
//   2) transport 를 주입할 수 있어서 네트워크 없이 파싱·폴백 경로를 테스트할 수 있다.

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
import { createLocalEngine } from './local.js'
import { BALANCE, clamp } from '../core/config.js'

export const DEFAULT_MODEL = 'claude-opus-5'

/** SDK 를 지연 로딩한다 — 오프라인 모드에서는 node_modules 가 없어도 게임이 돌아야 한다. */
async function loadSdk() {
  try {
    const mod = await import('@anthropic-ai/sdk')
    return mod.default ?? mod.Anthropic
  } catch {
    throw new Error(
      'LLM 모드에는 Anthropic SDK가 필요합니다. `npm install` 을 한 번 실행하세요.\n' +
        '(키 없이 즐기려면 그냥 `npm start` — 오프라인 엔진으로 돌아갑니다.)',
    )
  }
}

/**
 * 기본 전송 계층. 한 번 호출 = 한 번의 messages.create.
 * 서버측 fallbacks 를 기본으로 켜되, 거부당하면 그 뒤로는 조용히 끈다.
 */
/**
 * Messages API 요청 본문을 만든다. 순수 함수라 테스트에서 모양을 직접 검사한다.
 *
 * 주의: Claude Opus 5 에서는 temperature / top_p / top_k / budget_tokens 가 제거되어
 * 넣으면 400 이 난다. thinking 은 기본이 adaptive 라 굳이 끄지 않는다 —
 * 끄면 도구 호출이 평문으로 새는 알려진 실패 모드가 있다. 대신 effort 로 비용을 잡는다.
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

function createSdkTransport({ apiKey, model, baseURL }) {
  let sdkClient = null
  let useFallbacks = true

  async function ensure() {
    if (!sdkClient) {
      const Anthropic = await loadSdk()
      sdkClient = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })
    }
    return sdkClient
  }

  return async function transport({ system, messages, schema, maxTokens = 1024 }) {
    const client = await ensure()
    const base = buildRequest({ model, system, messages, schema, maxTokens })

    let res
    if (useFallbacks) {
      try {
        res = await client.beta.messages.create({
          ...base,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })
      } catch (err) {
        // 베타 플래그를 못 쓰는 계정/게이트웨이면 한 번만 겪고 영구히 끈다.
        useFallbacks = false
        res = await client.messages.create(base)
      }
    } else {
      res = await client.messages.create(base)
    }

    if (res.stop_reason === 'refusal') {
      const cat = res.stop_details?.category ?? 'unknown'
      throw new Error(`모델이 요청을 거절했습니다 (${cat})`)
    }

    const textBlock = res.content?.find((b) => b.type === 'text')
    const text = textBlock?.text ?? ''
    return { text, json: schema ? safeParse(text) : null, stopReason: res.stop_reason }
  }
}

function safeParse(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // 스키마를 걸었는데도 앞뒤에 뭔가 붙어 나오는 경우가 드물게 있다.
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

function toInt(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

/**
 * @param {object} opts
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {Function} [opts.transport] 테스트/모의용 주입 지점
 * @param {(msg:string)=>void} [opts.onDegrade] 폴백이 일어날 때 알림
 */
export function createLlmEngine(opts = {}) {
  const model = opts.model ?? process.env.RIZZ_MODEL ?? DEFAULT_MODEL
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY
  const transport =
    opts.transport ?? createSdkTransport({ apiKey, model, baseURL: opts.baseURL })
  const local = createLocalEngine()
  const onDegrade = opts.onDegrade ?? (() => {})

  const stats = { calls: 0, failures: 0, degraded: 0 }

  async function call(label, payload) {
    stats.calls++
    try {
      return await transport(payload)
    } catch (err) {
      stats.failures++
      stats.degraded++
      onDegrade(`${label}: ${err.message}`)
      return null
    }
  }

  return {
    id: 'llm',
    label: `Claude (${model})`,
    stats,

    async evaluatePrep(ctx) {
      const res = await call('준비 평가', {
        system:
          '너는 연애 코칭 기관의 준비 단계 심사관이다. 코치가 의뢰인에게 해준 준비를 평가한다. 한국어로 답한다.',
        messages: [{ role: 'user', content: prepUserMessage(ctx) }],
        schema: prepSchema(),
        maxTokens: 800,
      })
      const j = res?.json
      if (!j) return null
      return {
        speechConfidence: clamp(toInt(j.speech_confidence, 50) / 100, 0, 1),
        speechComment: String(j.speech_comment ?? ''),
        coachingFidelity: clamp(toInt(j.coaching_fidelity, 50) / 100, 0, 1),
        coachingComment: String(j.coaching_comment ?? ''),
        stylingComment: String(j.styling_comment ?? ''),
      }
    },

    async clientTurn(ctx) {
      const res = await call('의뢰인 발언', {
        system: clientSystemPrompt(ctx),
        messages: historyToMessages(ctx.history, 'client'),
        maxTokens: 512,
      })
      const text = res?.text?.trim()
      if (!text) return local.clientTurn(ctx)
      return { text, topic: null, tier: null }
    },

    async targetTurn(ctx, utter) {
      const res = await call('대상 반응', {
        system: targetSystemPrompt(ctx),
        messages: historyToMessages([...ctx.history, { who: 'client', text: utter.text }], 'target'),
        schema: targetSchema(ctx),
        maxTokens: 512,
      })
      const j = res?.json
      if (!j?.text) return local.targetTurn(ctx, utter)
      const reveals = j.reveals && j.reveals !== 'none' ? j.reveals : null
      return { text: String(j.text).trim(), topic: null, hintTopic: reveals }
    },

    async judge(ctx, utter) {
      const res = await call('판정', {
        system: judgeSystemPrompt(ctx),
        messages: [{ role: 'user', content: judgeUserMessage(ctx, utter) }],
        schema: judgeSchema(ctx),
        maxTokens: 600,
      })
      const j = res?.json
      if (!j) return local.judge(ctx, utter)

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
