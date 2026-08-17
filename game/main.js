#!/usr/bin/env node
// BISHOUJO RIZZ SIMULATOR 2077 — 진입점.
//
//   npm start                      오프라인 엔진(키 불필요)
//   ANTHROPIC_API_KEY=... npm start   Claude 가 의뢰인·상대·심판을 맡는다
//   node game/main.js --help

import { Game } from './core/game.js'
import { createEngine, resolveEngineMode } from './engine/index.js'
import { DIFFICULTIES } from './core/config.js'
import * as S from './ui/screens.js'
import {
  C,
  line,
  clear,
  rule,
  menu,
  readKey,
  readParagraph,
  pause,
  setFast,
  box,
} from './ui/term.js'

function arg(name, def = undefined) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return def
  const [, v] = hit.split('=')
  return v ?? true
}

function usage() {
  line(`
${C.bold}BISHOUJO RIZZ SIMULATOR 2077${C.reset}
LLM 기반 연애 코칭 게임 (터미널)

  node game/main.js [옵션]

  --difficulty=easy|normal|hard   난이도를 바로 지정
  --client=<id>                  의뢰인을 바로 지정 (dohun/sera/minhyuk/gahui/taeo/haru)
  --seed=<숫자|문자>              판을 고정한다. 같은 시드면 같은 전개.
  --engine=local|llm|auto         local: 키 없이 동작 / llm: Claude 사용 / auto(기본)
  --fast                         타자기 효과 끄기
  --no-color                     색 끄기
  --help                         이 도움말

  환경변수: ANTHROPIC_API_KEY (llm 모드), RIZZ_MODEL (기본 claude-opus-5)
`)
}

async function chooseClient(game) {
  for (;;) {
    clear()
    line(`${C.bold}${C.brightCyan}의뢰인 서류철${C.reset}  ${C.gray}— 도울 사람을 한 명 고른다${C.reset}`)
    line('')
    const items = game.roster.map((c) => ({
      label: `${c.name} (${c.age}) → ${c.target.name}`,
      hint: `${c.job}`,
      value: c.id,
    }))
    const pick = await menu(items, { footer: '\n↑↓ 이동 · Enter 선택 · 숫자키도 됩니다' })

    const client = game.roster.find((c) => c.id === pick)
    clear()
    S.dossierCard(client, null)
    const ok = await menu(
      [
        { label: '이 사람을 맡는다', value: true },
        { label: '다른 서류철을 본다', value: false },
      ],
      {},
    )
    if (ok) return pick
  }
}

async function consult(game) {
  clear()
  line(`${C.bold}${C.brightCyan}상담실${C.reset}  ${C.gray}— ${game.client.name} 씨와 마주 앉았다${C.reset}`)
  S.dossierCard(game.client, game.dossier, { full: true })
  await pause()

  clear()
  line(`${C.bold}${C.brightCyan}2-1) 스타일링${C.reset}`)
  line(`${C.gray}대상의 취향에 맞게 의뢰인을 꾸민다. 지뢰를 건드리면 역효과다.${C.reset}`)
  line('')
  const styling = await readParagraph('무엇을 입힐 것인가?', {
    hint: '예)  가죽 재킷, 별자리 목걸이, 낡은 헤드폰',
  })
  game.setStyling(styling)

  clear()
  line(`${C.bold}${C.brightCyan}2-2) 대화 코칭${C.reset}`)
  line(`${C.gray}이 지시는 의뢰인의 시스템 프롬프트로 그대로 들어간다.${C.reset}`)
  line(`${C.gray}어떤 화제를 꺼낼지, 어떤 태도로 말할지 적어라.${C.reset}`)
  line('')
  const coaching = await readParagraph('어떻게 대화하라고 할 것인가?', {
    hint: '예)  야식이랑 별 얘기를 먼저 꺼내. 상대 말을 끝까지 듣고 되물어. 자랑은 절대 하지 마.',
  })
  game.setCoaching(coaching)

  clear()
  line(`${C.bold}${C.brightCyan}2-3) 격려 연설${C.reset}`)
  line(`${C.gray}멋있을수록, 그리고 이 사람의 사연에 맞닿아 있을수록 자신감이 올라간다.${C.reset}`)
  line('')
  for (const l of String(game.client.story).split('. ')) {
    if (l.trim()) line(`  ${C.gray}${l.trim()}${C.reset}`)
  }
  line('')
  const speech = await readParagraph(`${game.client.name} 씨에게 무슨 말을 해줄 것인가?`, {
    hint: '사연 속의 구체적인 것을 짚어줄수록 좋다.',
  })
  game.setSpeech(speech)

  clear()
  line(`${C.gray}준비 상태를 평가하는 중…${C.reset}`)
  await game.beginRun()
  clear()
  S.prepSummary(game)
  await pause('대화를 시작하려면 아무 키나…')
}

async function runChat(game) {
  let noticeIdx = 0
  let lastPhase = null

  while (game.stage === 'texting' || game.stage === 'talking') {
    if (lastPhase !== game.stage) {
      lastPhase = game.stage
      clear()
      S.phaseBanner(game.phase)
      await pause()
    }

    clear()
    S.hud(game)

    if (game.canIntervene) {
      line('')
      line(
        `  ${C.brightMagenta}[i]${C.reset} 귓속말로 개입한다 ${C.gray}(남은 ${game.interventionsLeft}회)${C.reset}   ` +
          `${C.gray}[Enter] 그냥 지켜본다${C.reset}`,
      )
      const k = await readKey()
      if (k === 'i' || k === 'I') {
        line('')
        const whisper = await readParagraph('뭐라고 속삭일 것인가?', {
          hint: '화제를 콕 집어주면 의뢰인이 반드시 그 얘기를 꺼낸다.',
        })
        const r = game.queueIntervention(whisper)
        if (r.ok) {
          const tone = r.backfire ? C.brightRed : C.brightGreen
          line(`  ${tone}▸ ${r.note}${C.reset}`)
          await pause()
        }
      }
    }

    const entry = await game.step()
    clear()
    S.hud(game)
    await S.exchange(game, entry)

    while (noticeIdx < game.notices.length) {
      const n = game.notices[noticeIdx++]
      if (n.type === 'discovery') S.discoveryNotice(n)
    }

    line('')
    if (game.stage === 'texting' || game.stage === 'talking') await pause('다음…')
  }
}

async function playOnce({ difficulty, clientId, seed, engineMode }) {
  const engine = createEngine(engineMode, {
    onDegrade: (msg) => line(`${C.gray}(LLM 응답 실패 — 이번 턴은 오프라인 판정으로 대체: ${msg})${C.reset}`),
  })
  const game = new Game({ seed, difficulty, engine })

  const picked = clientId && game.roster.some((c) => c.id === clientId) ? clientId : await chooseClient(game)
  game.chooseClient(picked)

  await consult(game)
  await runChat(game)

  clear()
  line(`${C.gray}며칠 뒤…${C.reset}`)
  const outcome = await game.finish()
  await S.ending(game, outcome)
  return outcome
}

async function main() {
  if (arg('help')) return usage()
  if (arg('fast')) setFast(true)

  const seedArg = arg('seed')
  // --seed=7 은 숫자 7 과 같은 판이어야 한다. 문자열 그대로 두면 해시가 달라진다.
  const seed =
    seedArg === undefined
      ? Math.floor(Date.now() % 1e9)
      : /^\d+$/.test(String(seedArg))
        ? Number(seedArg)
        : seedArg
  const engineMode = resolveEngineMode(arg('engine'))
  let difficulty = arg('difficulty')
  const clientId = arg('client')

  S.title()
  box(
    [
      `엔진   ${engineMode === 'llm' ? `${C.brightGreen}Claude 연결${C.reset}` : `${C.brightYellow}오프라인 시뮬레이션${C.reset}`}`,
      engineMode === 'llm'
        ? `${C.gray}의뢰인·상대·심판을 Claude 가 맡는다.${C.reset}`
        : `${C.gray}ANTHROPIC_API_KEY 를 넣고 npm install 하면 Claude 가 대화를 맡는다.${C.reset}`,
      `시드   ${seed}`,
    ],
    { title: '단말기 상태', color: C.gray },
  )
  line('')

  const first = await menu(
    [
      { label: '임무 시작', value: 'start' },
      { label: '요원 안내서', value: 'help' },
    ],
    { footer: '\n↑↓ 이동 · Enter 선택 · q 종료' },
  )

  if (first === 'help') {
    clear()
    S.helpPanel()
    await pause()
  }

  if (!difficulty || !DIFFICULTIES[difficulty]) {
    clear()
    line(`${C.bold}${C.brightCyan}난이도${C.reset}  ${C.gray}— 대상의 취향을 얼마나 알려줄지 정한다${C.reset}`)
    line('')
    difficulty = await menu(S.difficultyItems(), {})
  }

  for (;;) {
    await playOnce({ difficulty, clientId, seed, engineMode })
    line('')
    const again = await menu(
      [
        { label: '다른 의뢰인을 맡는다', value: 'again' },
        { label: '단말기를 끈다', value: 'quit' },
      ],
      {},
    )
    if (again === 'quit') break
    clear()
  }

  line('')
  line(`${C.gray}연애 코칭국 단말기를 종료합니다.${C.reset}`)
  rule('─')
}

main().catch((err) => {
  line(`\n${C.brightRed}오류: ${err.message}${C.reset}`)
  if (process.env.RIZZ_DEBUG) console.error(err)
  process.exit(1)
})
