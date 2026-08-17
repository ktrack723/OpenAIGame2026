// 기획서 5장: 대화가 끝나고 며칠 뒤, 의뢰인이 요원에게 보내는 편지.
// 결과만 알리는 게 아니라 "그날 무슨 일이 있었는지"를 되짚어 준다.

import { TOPICS, LANDMINES } from '../data/topics.js'
import { hashSeed } from '../core/rng.js'

function labelOf(id) {
  return TOPICS[id]?.label ?? LANDMINES[id]?.label ?? null
}

const OPENERS = {
  accepted: [
    '요원님께.',
    '요원님, 저 도저히 못 참고 새벽에 씁니다.',
    '요원님. 손이 아직도 떨려서 오타가 있을 겁니다.',
  ],
  pending: ['요원님께.', '요원님, 애매한 소식이라 늦게 씁니다.', '요원님. 뭐라고 써야 할지 사흘을 고민했습니다.'],
  rejected: ['요원님께.', '요원님, 늦게 씁니다. 죄송합니다.', '요원님. 짧게 쓰겠습니다.'],
}

const CLOSERS = {
  accepted: [
    '다음 주에 또 만나기로 했습니다. 이번엔 제가 정한 곳으로 갑니다.\n\n{c} 드림',
    '요원님이 시킨 대로 했더니 되더라고요. 진짜로 되더라고요.\n\n{c} 드림',
    '기관에 정식으로 감사 편지를 넣겠습니다. 양식이 있으면 알려주세요.\n\n{c} 드림',
  ],
  pending: [
    '아직 끝난 건 아니라고 생각하려 합니다. 아마도요.\n\n{c} 드림',
    '다음이 있을지는 모르겠습니다. 그래도 그날은 나쁘지 않았습니다.\n\n{c} 드림',
    '한 번만 더 기회가 오면, 그때는 조금 다르게 해보겠습니다.\n\n{c} 드림',
  ],
  rejected: [
    '그래도 말은 걸어봤습니다. 3년 만에요. 그건 제가 한 겁니다.\n\n{c} 드림',
    '기관에 비용 청구는 하지 말아 주세요. 제 잘못이 큽니다.\n\n{c} 드림',
    '한동안은 좀 쉬겠습니다. 나중에 또 부탁드릴지도 모르겠습니다.\n\n{c} 드림',
  ],
}

const VERDICTS = {
  accepted: [
    '고백했습니다. {t}님이 받아줬습니다.',
    '사흘 뒤에 제가 먼저 연락했고, {t}님이 "기다렸어요" 라고 했습니다.',
    '{t}님 쪽에서 먼저 물어봤습니다. "우리 뭐예요?" 라고요. 그래서 대답했습니다.',
  ],
  pending: [
    '고백했습니다. {t}님이 "조금만 생각해볼게요" 라고 했습니다.',
    '말은 꺼냈는데 끝까지 못 했습니다. {t}님은 눈치챈 것 같았습니다.',
    '{t}님이 답을 미뤘습니다. 싫다는 말은 안 했습니다.',
  ],
  rejected: [
    '고백했습니다. {t}님이 미안하다고 했습니다.',
    '{t}님이 "좋은 분인데" 로 시작하는 문장을 말했습니다. 뒤는 안 들어도 알겠더라고요.',
    '고백은 못 했습니다. 그날 분위기로는 안 될 것 같았습니다.',
  ],
}

function pickBy(arr, n) {
  return arr[Math.abs(n) % arr.length]
}

/**
 * @param {import('../core/game.js').Game} game
 * @param {{ending:{id:string}, score:number, threshold:number}} verdict
 */
export function writeLetter(game, verdict) {
  const id = verdict.ending.id
  const c = game.client
  const t = c.target
  const s = game._summary()
  // 시드 고정이라 같은 판이면 같은 편지가 나온다.
  // 시드는 문자열일 수 있으므로 반드시 숫자로 뭉갠 뒤 더한다 — 그냥 더하면 문자열
  // 연결이 되어 NaN 인덱스가 나온다.
  const pick = hashSeed(game.seed) + s.turns + Math.round(s.finalLove)

  const lines = []
  lines.push(pickBy(OPENERS[id], pick))
  lines.push('')
  lines.push(pickBy(VERDICTS[id], pick + 1).replaceAll('{t}', t.name))
  lines.push('')

  // 가장 좋았던 순간
  if (s.best && s.best.loveDelta > 0) {
    const topic = labelOf(s.best.topic)
    lines.push(
      topic
        ? `${topic} 얘기를 꺼냈을 때 ${t.name}님 표정이 확 달라졌습니다. 그건 확실히 느꼈습니다.`
        : `중간에 한 번, 말이 술술 나오던 순간이 있었습니다. 그때가 제일 좋았습니다.`,
    )
  }

  // 지뢰
  if (s.mines > 0) {
    const mine = game.log.find((e) => e.tier === 'mine')
    const ml = labelOf(mine?.topic)
    lines.push(
      ml
        ? `${ml} 얘기를 꺼낸 건 지금도 후회합니다. 공기가 식는 게 느껴졌습니다.`
        : '중간에 한 번 크게 헛디뎠습니다. 그건 제 잘못입니다.',
    )
  }

  // 알아낸 것
  if (s.discoveries > 0) {
    const found = game.discoveries.filter((d) => !d.isMine).map((d) => d.label)
    if (found.length) {
      lines.push(`${t.name}님이 ${found.join(', ')} 좋아한다는 거, 그날 처음 알았습니다. 기억해 두겠습니다.`)
    }
  }

  // 준비 단계 언급
  if (game.prep?.styling.matched.length) {
    lines.push(`요원님이 골라준 차림새, ${t.name}님이 두 번 쳐다봤습니다.`)
  }
  if (game.prep?.speech.confidence >= 0.65) {
    lines.push('나가기 전에 해주신 말, 대화 내내 머릿속에서 계속 돌았습니다.')
  } else if (game.prep?.speech.empty) {
    lines.push('솔직히 말하면, 나가기 전에 아무 말도 못 들어서 좀 막막했습니다.')
  }

  lines.push('')
  lines.push(`분위기는 끝까지 ${s.finalMood}쯤, 호감은 ${s.finalLove}쯤이었다고 기관에서 알려줬습니다.`)
  if (id === 'accepted') {
    lines.push(`통과선이 ${verdict.threshold}이었다니, 생각보다 아슬아슬했네요.`)
  } else if (id === 'pending') {
    lines.push(`${verdict.threshold}만 넘겼으면 됐다고 하던데, 그 차이가 뭐였을까요.`)
  } else {
    lines.push(`${verdict.threshold}은 넘어야 했다고 합니다. 멀었습니다.`)
  }

  lines.push('')
  lines.push(pickBy(CLOSERS[id], pick + 2).replaceAll('{c}', c.name))

  return lines.join('\n')
}
