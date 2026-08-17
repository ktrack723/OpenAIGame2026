#!/usr/bin/env node
// 실제 Anthropic API 로 도는 연기 테스트.
//
// 평소 테스트는 전부 모델을 가짜로 바꿔치기 때문에 "요청 규격이 실제로 통과하는가"는
// 검증되지 않는다. 이 스크립트가 그 구멍을 메운다.
//
//   ANTHROPIC_API_KEY=sk-ant-... node tools/live-check.mjs
//
// 키는 반드시 환경변수로 준다. 인자로 주면 셸 히스토리와 프로세스 목록에 남는다.
// 호출은 7회, effort=low, max_tokens 작게 — 몇 센트 수준이다.
//
// 환경변수
//   ANTHROPIC_API_KEY  (필수)
//   RIZZ_MODEL         모델 ID. 기본 claude-opus-5
//   RIZZ_BASE_URL      게이트웨이/프록시를 거칠 때만. 기본 https://api.anthropic.com

import { Game } from '../game/core/game.js'
import { createLlmEngine, verifyKey, DEFAULT_MODEL, LlmError } from '../game/engine/index.js'

const KEY = process.env.ANTHROPIC_API_KEY
const MODEL = process.env.RIZZ_MODEL || DEFAULT_MODEL
// 게이트웨이나 프록시를 거쳐 부를 때만 쓴다. 비워두면 api.anthropic.com.
const BASE = process.env.RIZZ_BASE_URL || undefined

if (!KEY) {
  console.error(`
실제 키가 필요합니다.

  ANTHROPIC_API_KEY=sk-ant-... node tools/live-check.mjs

키는 https://console.anthropic.com/settings/keys 에서 발급합니다.
(인자가 아니라 환경변수로 주세요 — 인자는 셸 히스토리에 남습니다.)
`)
  process.exit(2)
}

let pass = 0
let fail = 0
const results = []

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    results.push(`  \x1b[32m✔\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`)
  } else {
    fail++
    results.push(`  \x1b[31m✘\x1b[0m ${name}${detail ? `  \x1b[31m${detail}\x1b[0m` : ''}`)
  }
}

console.log(`\n실제 API 연기 테스트 — 모델 ${MODEL}${BASE ? ` · ${BASE}` : ''}\n`)

// ── 1) 연결 + 인증
try {
  await verifyKey({ apiKey: KEY, model: MODEL, baseURL: BASE })
  check('연결 · 인증', true)
} catch (err) {
  check('연결 · 인증', false, err.message)
  console.log(results.join('\n'))
  console.log(`\n\x1b[31m여기서 멈춥니다. 키나 모델 접근 권한을 확인하세요.\x1b[0m\n`)
  process.exit(1)
}

// ── 2) 실제 게임 한 판을 두 턴만 돌린다
const calls = []
const engine = createLlmEngine({
  apiKey: KEY,
  model: MODEL,
  baseURL: BASE,
  onCall: (label) => calls.push(label),
})

const game = new Game({ seed: 'live', difficulty: 'normal', engine })
game.chooseClient('dohun')
game.setStyling('가죽 재킷, 별자리 목걸이, 낡은 헤드폰')
game.setCoaching('야식이랑 별 얘기를 먼저 꺼내. 상대 말을 끝까지 듣고 되물어. 자랑은 하지 마.')
game.setSpeech(
  '도훈아. 3년 동안 새벽마다 그 편의점을 지킨 건 너야. 삼각김밥 두 개 남겨둔 것도 너고. ' +
    '넌 충분히 성실한 사람이야. 오늘은 솔직하게 가. 넌 할 수 있어!',
)

// ── 준비 평가 (구조화 출력 #1)
try {
  await game.beginRun()
  const p = game.prep
  check('준비 평가 · 구조화 출력 파싱', Boolean(p.llm), `자신감 ${Math.round(p.speech.confidence * 100)}% · 코칭 ${Math.round(p.coaching.fidelity * 100)}%`)
  check(
    '준비 평가 · 값이 0~1 범위',
    p.speech.confidence >= 0 && p.speech.confidence <= 1 && p.coaching.fidelity >= 0 && p.coaching.fidelity <= 1,
  )
  if (p.llm?.speechComment) console.log(`\n  \x1b[90m모델 촌평: "${p.llm.speechComment}"\x1b[0m\n`)
} catch (err) {
  check('준비 평가', false, `${err.kind ?? '?'} — ${err.message}`)
  console.log(results.join('\n'))
  process.exit(1)
}

// ── 대화 두 턴 (의뢰인 · 판정 · 상대 각 2회)
const likes = new Set(game.client.target.likes)
const mines = new Set(game.dossier.mines)
let turnOk = 0

for (let i = 0; i < 2; i++) {
  if (i === 1) game.queueIntervention('지금 별 얘기를 꺼내.')
  try {
    const e = await game.step()
    turnOk++
    console.log(`  \x1b[36m${game.client.name}\x1b[0m ${e.clientText}`)
    console.log(`    \x1b[90m└ ${e.reason} · 분위기 ${e.moodDelta >= 0 ? '+' : ''}${e.moodDelta} · 호감 ${e.loveDelta >= 0 ? '+' : ''}${e.loveDelta}\x1b[0m`)
    console.log(`  \x1b[33m${game.client.target.name}\x1b[0m ${e.targetText}\n`)

    check(`턴 ${i + 1} · 의뢰인 대사가 비어있지 않다`, e.clientText.trim().length > 0)
    check(`턴 ${i + 1} · 상대 대사가 비어있지 않다`, e.targetText.trim().length > 0)
    // 분위기 변화 = 심판 값(±14) + 중립점 복귀 드리프트(±2)
    check(
      `턴 ${i + 1} · 판정 수치가 정수 범위`,
      Number.isInteger(e.moodDelta) &&
        Number.isInteger(e.loveDelta) &&
        Math.abs(e.moodDelta) <= 16 &&
        Math.abs(e.loveDelta) <= 11,
      `분위기 ${e.moodDelta} / 호감 ${e.loveDelta}`,
    )
    check(
      `턴 ${i + 1} · 심판이 스키마 enum 밖의 값을 내지 않는다`,
      e.topic === null || likes.has(e.topic) || mines.has(e.topic),
      e.topic ? `topic=${e.topic}` : '',
    )
  } catch (err) {
    check(`턴 ${i + 1}`, false, `${err.kind ?? '?'} — ${err.message}`)
    break
  }
}

check('대화 두 턴 완주', turnOk === 2)

// ── 3) 잘못된 키는 확실히 거절되는가
try {
  await verifyKey({ apiKey: 'sk-ant-obviously-invalid', model: MODEL, baseURL: BASE })
  check('잘못된 키를 거절한다', false, '엉터리 키가 통과했다')
} catch (err) {
  check('잘못된 키를 거절한다', err instanceof LlmError && err.kind === 'auth', `kind=${err.kind}`)
}

// ── 결과
console.log(results.join('\n'))
console.log(`\n  호출 ${calls.length}회: ${calls.join(' → ')}`)
console.log(`\n  \x1b[1m${pass} 통과 / ${fail} 실패\x1b[0m\n`)

if (fail > 0) {
  console.log('\x1b[31m실제 API 에서 깨지는 곳이 있습니다. 위의 ✘ 항목을 보세요.\x1b[0m\n')
  process.exit(1)
}
console.log('\x1b[32m요청 규격·구조화 출력·게임 루프가 실제 API 에서 그대로 동작합니다.\x1b[0m\n')
