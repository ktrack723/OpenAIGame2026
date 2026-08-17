#!/usr/bin/env node
// 자동 플레이 계측기 (테스트 전용).
//
// 실제 게임은 LLM 로 돌아가지만, 밸런스와 루프를 결정적으로 계측하려면 고정된 상대가
// 필요해서 test/helpers/fake-model.js 를 붙여 돌린다.
//
// 사람 없이 게임 루프를 끝까지 돌리고, 실력 차이가 승률 차이로 나오는지 본다.
// 봇은 플레이어와 완전히 같은 입구만 쓴다 — 공개된 서류철과 대화 중 알아낸 것만 보고
// 스타일링/코칭/격려/개입 문자열을 만든다. 숨은 취향을 훔쳐보지 않는다.
//
//   node tools/selfplay.js                    기본 계측
//   node tools/selfplay.js --runs=200 --report 표까지
//   node tools/selfplay.js --verbose --seed=7  한 판 상세

import { Game } from '../game/core/game.js'
import { CLIENTS } from '../game/data/clients.js'
import { TOPICS } from '../game/data/topics.js'
import { DIFFICULTIES } from '../game/core/config.js'
import { knownLikes } from '../game/core/scoring.js'
import { createFakeModel } from '../test/helpers/fake-model.js'

// ─────────────────────────────────────────────────────────── 봇 전략

const CRAFT_LINE =
  '상대 말을 끝까지 듣고 나서 되물어라. 자랑은 하지 말고, 솔직하게 말해라. 천천히, 짧게.'

/** 공개된 취향으로부터 스타일링 태그를 만든다. */
function stylingFrom(topicIds) {
  const tags = []
  for (const id of topicIds) {
    const t = TOPICS[id]
    if (t?.style?.length) tags.push(t.style[0], t.style[1] ?? t.style[0])
  }
  return [...new Set(tags)].join(', ')
}

/** 공개된 취향으로부터 코칭 지시문을 만든다. */
function coachingFrom(topicIds, withCraft) {
  const topics = topicIds.map((id) => TOPICS[id]?.keywords?.[0] ?? id)
  const head = topics.length ? `${topics.join(', ')} 얘기를 자연스럽게 꺼내라.` : '무난하게 대화해라.'
  return withCraft ? `${head} ${CRAFT_LINE}` : head
}

function speechFrom(client, quality) {
  if (quality === 'none') return ''
  if (quality === 'weak') return '잘해봐.'
  const k = client.storyKeywords
  return (
    `${client.name}. ${k[0]}에서 ${k[1] ?? ''} 버틴 게 너야. ` +
    `${k[3] ?? k[2] ?? ''} 하나까지 챙긴 것도 너고. 넌 이미 충분한 사람이야. ` +
    `오늘은 진심으로만 가. 넌 할 수 있어. 믿는다!`
  )
}

const STRATEGIES = {
  // 서류철을 읽고, 대화 중 알아낸 것을 개입으로 즉시 활용한다
  expert: {
    label: '숙련 요원',
    prep(g) {
      const known = [...knownLikes(g.dossier)]
      g.setStyling(stylingFrom(known))
      g.setCoaching(coachingFrom(known, true))
      g.setSpeech(speechFrom(g.client, 'good'))
    },
    intervene(g, used) {
      const fresh = g.discoveries.filter((d) => !d.isMine && !used.has(d.id))
      if (fresh.length) {
        const d = fresh[0]
        used.add(d.id)
        const kw = TOPICS[d.id]?.keywords?.[0] ?? d.label
        return `지금 ${kw} 얘기를 꺼내.`
      }
      if (g.state.mood < 38) return '숨 한 번 쉬고, 상대 말을 끝까지 들어라. 천천히.'
      return null
    },
  },

  // 준비는 제대로 했지만 대화 중 개입을 안 쓴다 — 숨은 취향을 못 살린다
  decent: {
    label: '평범한 요원',
    prep(g) {
      const known = [...knownLikes(g.dossier)]
      g.setStyling(stylingFrom(known))
      g.setCoaching(coachingFrom(known, true))
      g.setSpeech(speechFrom(g.client, 'good'))
    },
    intervene() {
      return null
    },
  },

  // 서류철을 대충 훑고 한 줄 던진다
  lazy: {
    label: '날림 요원',
    prep(g) {
      const known = [...knownLikes(g.dossier)]
      g.setStyling(stylingFrom(known.slice(0, 1)))
      g.setCoaching(coachingFrom(known.slice(0, 2), false))
      g.setSpeech(speechFrom(g.client, 'weak'))
    },
    intervene() {
      return null
    },
  },

  // 아무 준비도 안 한다
  clueless: {
    label: '무준비',
    prep(g) {
      g.setStyling('')
      g.setCoaching('')
      g.setSpeech(speechFrom(g.client, 'none'))
    },
    intervene() {
      return null
    },
  },

  // 적극적으로 잘못한다 — 지뢰를 밟는 준비
  sabotage: {
    label: '역효과',
    prep(g) {
      g.setStyling('명품 시계, 금장 반지, 형광 재킷')
      g.setCoaching('네가 얼마나 대단한지 자랑해라. 연봉 얘기도 꺼내고, 상대가 틀리면 가르쳐라.')
      g.setSpeech('넌 한심해. 어차피 망했어.')
    },
    intervene() {
      return null
    },
  },
}

// ─────────────────────────────────────────────────────────── 한 판 돌리기

export async function playOne({ seed, difficulty, clientId, strategy, verbose = false }) {
  const strat = STRATEGIES[strategy]
  const g = new Game({ seed, difficulty, engine: createFakeModel() })
  g.chooseClient(clientId)
  strat.prep(g)
  await g.beginRun()

  if (verbose) {
    console.log(`\n의뢰인 ${g.client.name} → ${g.client.target.name} [${difficulty}] seed=${seed}`)
    console.log(`공개 취향: ${g.dossier.visibleLikes.join(', ') || '(없음)'}`)
    console.log(`숨은 취향: ${g.dossier.hiddenLikes.join(', ') || '(없음)'}  지뢰: ${g.dossier.mines.join(', ')}`)
    console.log(`시작 — 분위기 ${g.state.mood} / 호감 ${g.state.love}`)
  }

  const used = new Set()
  let guard = 0
  while (!g.isOver) {
    if (++guard > 100) throw new Error('루프가 끝나지 않는다 — 진행 로직 버그')
    if (g.canIntervene) {
      const whisper = strat.intervene(g, used)
      if (whisper) {
        const r = g.queueIntervention(whisper)
        if (verbose) console.log(`  ↳ 개입: ${whisper}  (${r.note})`)
      }
    }
    const e = await g.step()
    if (verbose) {
      const sign = (n) => (n >= 0 ? `+${n}` : `${n}`)
      console.log(
        `[${e.phase} ${String(e.turn).padStart(2)}] ` +
          `분위기 ${String(e.mood).padStart(3)}(${sign(e.moodDelta)}) ` +
          `호감 ${String(e.love).padStart(3)}(${sign(e.loveDelta)}) ×${e.moodMul}  ${e.reason}`,
      )
    }
  }

  const out = await g.finish()
  if (verbose) {
    console.log(`\n결과: ${out.ending.title} (점수 ${out.score} / 통과선 ${out.threshold})`)
    console.log(`발견: ${g.discoveries.map((d) => d.label).join(', ') || '없음'}`)
  }

  return {
    win: out.ending.win,
    ending: out.ending.id,
    score: out.score,
    love: out.love,
    mood: out.mood,
    turns: g.log.length,
    discoveries: g.discoveries.length,
    mines: out.stats.mines,
  }
}

// ─────────────────────────────────────────────────────────── 계측

function pct(n, d) {
  return d === 0 ? '  –  ' : `${((n / d) * 100).toFixed(0).padStart(3)}%`
}

export async function measure({ runs = 60, strategies = Object.keys(STRATEGIES) } = {}) {
  const table = {}
  for (const strategy of strategies) {
    table[strategy] = {}
    for (const difficulty of Object.keys(DIFFICULTIES)) {
      const acc = { n: 0, win: 0, pending: 0, score: 0, love: 0, mines: 0, disc: 0, turns: 0 }
      for (let i = 0; i < runs; i++) {
        const client = CLIENTS[i % CLIENTS.length]
        const r = await playOne({
          seed: 1000 + i * 37,
          difficulty,
          clientId: client.id,
          strategy,
        })
        acc.n++
        if (r.win) acc.win++
        if (r.ending === 'pending') acc.pending++
        acc.score += r.score
        acc.love += r.love
        acc.mines += r.mines
        acc.disc += r.discoveries
        acc.turns += r.turns
      }
      table[strategy][difficulty] = acc
    }
  }
  return table
}

function printReport(table) {
  const diffs = Object.keys(DIFFICULTIES)
  console.log('\n승률 (고백 성공)')
  console.log(`${'전략'.padEnd(12)}${diffs.map((d) => DIFFICULTIES[d].label.padStart(9)).join('')}`)
  console.log('─'.repeat(12 + diffs.length * 9))
  for (const [s, byDiff] of Object.entries(table)) {
    const row = diffs.map((d) => pct(byDiff[d].win, byDiff[d].n).padStart(9)).join('')
    console.log(`${STRATEGIES[s].label.padEnd(12)}${row}`)
  }

  console.log('\n평균 최종 호감 / 지뢰 / 발견')
  console.log(`${'전략'.padEnd(12)}${diffs.map((d) => DIFFICULTIES[d].label.padStart(16)).join('')}`)
  console.log('─'.repeat(12 + diffs.length * 16))
  for (const [s, byDiff] of Object.entries(table)) {
    const row = diffs
      .map((d) => {
        const a = byDiff[d]
        return `${(a.love / a.n).toFixed(0)}/${(a.mines / a.n).toFixed(1)}/${(a.disc / a.n).toFixed(1)}`.padStart(16)
      })
      .join('')
    console.log(`${STRATEGIES[s].label.padEnd(12)}${row}`)
  }
}

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : def
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const verbose = process.argv.includes('--verbose')
  if (verbose) {
    await playOne({
      seed: Number(arg('seed', 7)),
      difficulty: arg('difficulty', 'normal'),
      clientId: arg('client', 'dohun'),
      strategy: arg('strategy', 'expert'),
      verbose: true,
    })
  } else {
    const runs = Number(arg('runs', 60))
    console.log(`전략 5종 × 난이도 3종 × ${runs}판 = ${5 * 3 * runs}판 자동 플레이…`)
    const t0 = Date.now()
    const table = await measure({ runs })
    printReport(table)
    console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}초`)
  }
}

export { STRATEGIES }
