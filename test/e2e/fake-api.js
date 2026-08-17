// 가짜 Anthropic API.
//
// Playwright 의 page.route 로 api.anthropic.com 을 가로채서 이 응답을 돌려준다.
// 덕분에 fetch 전송 계층 · 구조화 출력 파싱 · 게임 루프 · UI · 3D 가 전부 실제 경로로 돈다.
// 바꿔치는 건 모델 하나뿐이다.

/** 요청 본문을 보고 어떤 역할인지 가려낸다. */
export function classify(body) {
  const system = Array.isArray(body.system) ? body.system.map((s) => s.text).join('\n') : String(body.system ?? '')
  if (system.includes('연결 확인용')) return 'ping'
  if (system.includes('심사관')) return 'prep'
  if (system.includes('판정 장치')) return 'judge'
  if (system.includes('싫어하는 것')) return 'target'
  return 'client'
}

const CLIENT_LINES = [
  '아 저 사실 새벽에 라멘 먹는 거 좋아해요. 낮에 먹는 거랑 다른 음식이에요.',
  '별빛이 몇만 년 전 거라는 게 아직도 안 믿겨요. 과거를 실시간으로 보는 거잖아요.',
  '혹시 강아지 좋아해요? 저 요즘 산책하는 애들 구경하는 게 낙이라서요.',
  '사실 저 지금 좀 긴장했어요. 말해버리는 게 나을 것 같아서 말해요.',
  '비 오는 날은 세상이 볼륨을 줄여주는 느낌이라 좋아요.',
  '커피는 맛보다 그 15분이 좋은 것 같아요. 아무도 저를 안 찾는 시간이라서.',
]
const TARGET_LINES = [
  '헐 저 그거 완전 좋아해요.',
  '그 말 좋다... 메모할게요.',
  '아 네네, 그렇구나.',
  '이런 얘기 하는 사람 오랜만이에요.',
  '음, 저는 잘 몰라서요.',
]

/**
 * 결정적인 가짜 응답. seq 로 매 호출을 조금씩 바꿔서 대화가 반복돼 보이지 않게 한다.
 * @param {object} body 요청 본문
 * @param {number} seq 이 세션에서 몇 번째 호출인지
 * @param {object} [tune] 판정 성향 (승/패 시나리오 강제용)
 */
export function respond(body, seq, tune = {}) {
  const kind = classify(body)
  const schema = body.output_config?.format?.schema

  const text = (t) => ({
    id: `msg_fake_${seq}`,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text: t }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 40 },
  })

  if (kind === 'ping') return text('OK')

  if (kind === 'client') return text(CLIENT_LINES[seq % CLIENT_LINES.length])

  if (kind === 'prep') {
    return text(
      JSON.stringify({
        speech_confidence: tune.confidence ?? 82,
        speech_comment: '사연을 정확히 짚었다.',
        coaching_fidelity: tune.fidelity ?? 74,
        coaching_comment: '실행 가능한 지시다.',
        styling_comment: '취향에 닿는 차림이다.',
      }),
    )
  }

  if (kind === 'target') {
    const pool = (schema?.properties?.reveals?.enum ?? ['none']).filter((x) => x !== 'none')
    // 세 번에 한 번씩 취향을 흘린다
    const reveals = pool.length && seq % 3 === 1 ? pool[0] : 'none'
    return text(JSON.stringify({ text: TARGET_LINES[seq % TARGET_LINES.length], reveals }))
  }

  // judge
  const likes = (schema?.properties?.touched_preference?.enum ?? ['none']).filter((x) => x !== 'none')
  const mines = (schema?.properties?.hit_landmine?.enum ?? ['none']).filter((x) => x !== 'none')

  if (tune.mode === 'lose') {
    return text(
      JSON.stringify({
        mood_delta: -6,
        love_delta: -7,
        touched_preference: 'none',
        hit_landmine: mines.length && seq % 4 === 0 ? mines[0] : 'none',
        reason: '흐름이 끊기고 취향에서도 벗어났다',
      }),
    )
  }

  // 기본: 이기는 쪽. 취향을 골고루 돌아가며 맞힌다.
  const touched = likes.length ? likes[seq % likes.length] : 'none'
  return text(
    JSON.stringify({
      mood_delta: 6,
      love_delta: 10,
      touched_preference: touched,
      hit_landmine: 'none',
      reason: '취향을 정확히 짚었고 흐름도 자연스러웠다',
    }),
  )
}
