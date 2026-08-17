// 화면 조립. 게임 로직은 전혀 모르고, 넘겨받은 상태를 그리기만 한다.

import {
  C,
  WIDTH,
  line,
  write,
  clear,
  box,
  bar,
  rule,
  wrap,
  center,
  padEnd,
  deltaTag,
  type,
} from './term.js'
import { TOPICS, LANDMINES } from '../data/topics.js'
import { DIFFICULTIES } from '../core/config.js'

const M = C.brightMagenta
const Y = C.brightCyan

function labelOf(id) {
  return TOPICS[id]?.label ?? LANDMINES[id]?.label ?? id
}

export function title() {
  clear()
  line('')
  line(`${M}╔${'═'.repeat(WIDTH - 2)}╗${C.reset}`)
  const t1 = `${C.bold}${C.white}B I S H O U J O   R I Z Z   S I M U L A T O R   2 0 7 7${C.reset}`
  line(`${M}║${C.reset}${center(t1, WIDTH - 2)}${M}║${C.reset}`)
  line(`${M}║${C.reset}${center(`${Y}연애 코칭국 · 요원 단말기${C.reset}`, WIDTH - 2)}${M}║${C.reset}`)
  line(`${M}╚${'═'.repeat(WIDTH - 2)}╝${C.reset}`)
  line('')
  for (const l of wrap(
    '2077년. 남성 위비와 여성 위비가 나라를 점령했고 출생률은 1 아래로 떨어졌다. ' +
      '테크노킹 도람푸 3세의 특별 지시로 정부는 비밀 기관을 하나 세운다. ' +
      '연애 경험이 전무한 시민들이 짝사랑 상대에게 말을 걸고, 제대로 된 대화를 나누도록 돕는 기관이다.',
  )) {
    line(`  ${C.gray}${l}${C.reset}`)
  }
  line('')
  line(`  ${C.white}당신은 그 기관에 새로 배치된 요원이다.${C.reset}`)
  line('')
}

export function difficultyItems() {
  return Object.values(DIFFICULTIES).map((d) => ({
    label: `${d.label}  ${C.gray}[${d.tag}]${C.reset}`,
    hint: d.desc,
    value: d.id,
  }))
}

/** 기획서 1장: 서류철 한 장 */
export function dossierCard(client, dossier, { full = false } = {}) {
  const t = client.target
  line('')
  line(`${M}┌─ ${C.bold}${client.callsign}${C.reset}${M} ${'─'.repeat(WIDTH - 5 - client.callsign.length)}┐${C.reset}`)

  const left = client.portrait
  const right = t.portrait
  const head = [
    `${C.bold}${C.white}${client.name}${C.reset} (${client.age})`,
    `${C.gray}${client.job}${C.reset}`,
    '',
    `${C.brightYellow}▼ 짝사랑 상대${C.reset}`,
    `${C.bold}${C.white}${t.name}${C.reset} (${t.age})`,
    `${C.gray}${t.job}${C.reset}`,
    '',
  ]
  for (let i = 0; i < Math.max(left.length, right.length, head.length); i++) {
    const l = left[i] ?? ' '.repeat(12)
    const r = right[i] ?? ' '.repeat(12)
    const h = head[i] ?? ''
    line(`${M}│${C.reset} ${C.cyan}${padEnd(l, 13)}${C.reset}${C.brightYellow}${padEnd(r, 13)}${C.reset} ${padEnd(h, WIDTH - 30)}${M}│${C.reset}`)
  }
  line(`${M}└${'─'.repeat(WIDTH - 2)}┘${C.reset}`)

  line(`${Y}사연${C.reset}`)
  for (const l of wrap(client.story, WIDTH - 4)) line(`  ${C.gray}${l}${C.reset}`)
  line('')
  line(`${Y}외모${C.reset}   ${client.appearance.join(', ')}`)
  line(`${Y}성격${C.reset}   ${client.personality.join(', ')}`)
  line('')
  line(`${C.brightYellow}${t.name} 관찰 기록${C.reset}  ${C.gray}${t.blurb}${C.reset}`)

  if (full && dossier) {
    line('')
    line(`${Y}파악된 취향${C.reset}`)
    for (const id of dossier.visibleLikes) line(`  ${C.brightGreen}✔${C.reset} ${labelOf(id)}`)
    const unknown = client.target.likes.length - dossier.visibleLikes.length
    if (unknown > 0) {
      line(`  ${C.gray}? 미확인 취향 ${unknown}건 — 대화 중에 알아내야 한다${C.reset}`)
    }
    line(
      `  ${C.brightRed}!${C.reset} ${C.gray}지뢰(싫어하는 것) ${dossier.mines.length}건 — 전부 비공개${C.reset}`,
    )
  }
  line('')
}

export function prepSummary(game) {
  const p = game.prep
  const pctOf = (v) => `${Math.round(v * 100)}%`
  const rows = []
  rows.push(
    `${C.brightYellow}스타일링${C.reset}  적중 ${C.brightGreen}${p.styling.matched.map(labelOf).join(', ') || '없음'}${C.reset}`,
  )
  if (p.styling.clashed.length) {
    rows.push(`           ${C.brightRed}지뢰 접촉: ${p.styling.clashed.map(labelOf).join(', ')}${C.reset}`)
  }
  rows.push(`           시작 호감 보정 ${deltaTag(p.styling.loveBonus)}`)
  rows.push('')
  rows.push(`${C.brightYellow}코칭${C.reset}      지시 충실도 ${C.white}${pctOf(p.coaching.fidelity)}${C.reset}`)
  if (p.coaching.topics.length) {
    rows.push(`           지목한 화제: ${p.coaching.topics.map(labelOf).join(', ')}`)
  }
  if (p.coaching.mineWarnings.length) {
    rows.push(`           ${C.brightRed}지뢰를 밟으라고 시켰다: ${p.coaching.mineWarnings.map(labelOf).join(', ')}${C.reset}`)
  }
  rows.push('')
  rows.push(`${C.brightYellow}격려${C.reset}      의뢰인 자신감 ${C.white}${pctOf(p.speech.confidence)}${C.reset}`)
  if (p.speech.notes?.length) rows.push(`           ${C.gray}${p.speech.notes.join(' · ')}${C.reset}`)
  if (p.llm?.speechComment) rows.push(`           ${C.gray}"${p.llm.speechComment}"${C.reset}`)

  box(rows, { title: '준비 완료 보고', color: C.magenta })
  line('')
  line(
    `  ${bar('분위기', game.state.mood, 100, 30, C.brightCyan)}    ${bar('호감', game.state.love, 100, 30, C.brightMagenta)}`,
  )
  line('')
}

export function hud(game) {
  const known = [...game.dossier.revealed]
  const likes = known.filter((id) => game.dossier.likes.includes(id))
  const mines = known.filter((id) => game.dossier.mines.includes(id))
  rule('─')
  line(
    `  ${bar('분위기', game.state.mood, 100, 24, C.brightCyan)}   ${bar('호감', game.state.love, 100, 24, C.brightMagenta)}`,
  )
  const phaseLabel = game.phase?.label ?? ''
  const left = `${phaseLabel}  ${game.turn}/${game.phase?.turns ?? 0}`
  const right = `개입 ${'◆'.repeat(game.interventionsLeft)}${'◇'.repeat(Math.max(0, (game.phase?.interventions ?? 0) - game.interventionsLeft))}`
  line(`  ${C.gray}${padEnd(left, WIDTH - 20)}${right}${C.reset}`)
  if (likes.length || mines.length) {
    const parts = [
      ...likes.map((id) => `${C.brightGreen}+${labelOf(id)}${C.reset}`),
      ...mines.map((id) => `${C.brightRed}!${labelOf(id)}${C.reset}`),
    ]
    line(`  ${C.gray}알아낸 것:${C.reset} ${parts.join('  ')}`)
  }
  rule('─')
}

export async function exchange(game, entry) {
  const c = game.client
  line('')
  await type(entry.clientText, { prefix: `${C.brightCyan}${c.name}${C.reset} ${C.gray}│${C.reset} `, delay: 8 })

  const tags = []
  if (entry.moodDelta !== 0) tags.push(`분위기 ${deltaTag(entry.moodDelta)}`)
  if (entry.loveDelta !== 0) tags.push(`호감 ${deltaTag(entry.loveDelta)}`)
  tags.push(`${C.gray}×${entry.moodMul}${C.reset}`)
  line(`      ${C.gray}└ ${entry.reason}${C.reset}   ${tags.join('  ')}`)

  line('')
  await type(entry.targetText, {
    prefix: `${C.brightYellow}${c.target.name}${C.reset} ${C.gray}│${C.reset} `,
    delay: 8,
  })
}

export function discoveryNotice(found) {
  line('')
  if (found.isMine) {
    line(`  ${C.brightRed}⚠ 지뢰 포착 — ${found.label}${C.reset}  ${C.gray}(${found.how})${C.reset}`)
    line(`  ${C.gray}이 화제는 앞으로 피해야 한다.${C.reset}`)
  } else {
    line(`  ${C.brightGreen}✦ 취향 포착 — ${found.label}${C.reset}  ${C.gray}(${found.how})${C.reset}`)
    line(`  ${C.gray}개입해서 알려주지 않으면 의뢰인은 이걸 활용하지 못한다.${C.reset}`)
  }
}

export function phaseBanner(phase) {
  line('')
  line(`${M}${'━'.repeat(WIDTH)}${C.reset}`)
  line(`${C.bold}${C.white}${center(phase.label, WIDTH)}${C.reset}`)
  const sub =
    phase.id === 'texting'
      ? `${phase.turns}번의 주고받기 · 개입 ${phase.interventions}회`
      : `${phase.turns}번의 주고받기 · 개입 ${phase.interventions}회 · 분위기와 호감은 그대로 이어진다`
  line(`${C.gray}${center(sub, WIDTH)}${C.reset}`)
  line(`${M}${'━'.repeat(WIDTH)}${C.reset}`)
}

export async function ending(game, outcome) {
  const won = outcome.ending.win
  const col = won ? C.brightGreen : outcome.ending.id === 'pending' ? C.brightYellow : C.brightRed
  line('')
  line(`${col}${'═'.repeat(WIDTH)}${C.reset}`)
  line(`${C.bold}${col}${center(outcome.ending.stamp, WIDTH)}${C.reset}`)
  line(`${col}${'═'.repeat(WIDTH)}${C.reset}`)
  line('')
  line(
    `  최종 분위기 ${C.brightCyan}${outcome.mood}${C.reset}   최종 호감 ${C.brightMagenta}${outcome.love}${C.reset}   ` +
      `판정 점수 ${C.white}${outcome.score}${C.reset} ${C.gray}/ 통과선 ${outcome.threshold}${C.reset}`,
  )
  line(`  ${C.gray}지뢰 ${outcome.stats.mines}회 · 알아낸 취향 ${outcome.stats.discoveries}건 · 총 ${outcome.stats.turns}턴${C.reset}`)
  line('')
  line(`${C.gray}${'┄'.repeat(WIDTH)}${C.reset}`)
  line('')
  for (const l of String(outcome.letter).split('\n')) {
    if (l.trim() === '') line('')
    else for (const w of wrap(l, WIDTH - 6)) line(`   ${C.white}${w}${C.reset}`)
  }
  line('')
  line(`${C.gray}${'┄'.repeat(WIDTH)}${C.reset}`)
}

export function helpPanel() {
  box(
    [
      `${C.brightYellow}이 게임의 요령${C.reset}`,
      '',
      '· 서류철에 공개된 취향은 스타일링과 코칭으로 미리 심어둔다.',
      '· 대화 중 상대가 흘리는 힌트를 놓치지 마라. 숨은 취향은 그때만 드러난다.',
      `· ${C.brightGreen}취향 포착${C.reset} 알림이 뜨면 ${C.bold}개입${C.reset}해서 의뢰인에게 알려줘야 쓸 수 있다.`,
      '  의뢰인은 긴장해서 스스로 눈치채지 못한다.',
      '· 개입 횟수는 문자 1회, 대면 2회뿐이다. 아껴 써라.',
      '· 격려 연설은 의뢰인의 사연을 정확히 짚을수록 자신감이 올라간다.',
      `· ${C.brightRed}지뢰${C.reset}는 처음부터 끝까지 비공개다. 밟으면 크게 깎인다.`,
    ],
    { title: '요원 안내서', color: C.cyan },
  )
}
