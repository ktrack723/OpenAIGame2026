// 테스트 전용 가짜 모델.
//
// 게임에는 오프라인 모드가 없다 — LLM 연결이 없으면 아예 시작되지 않는다.
// 하지만 게임 루프·밸런스·재현성을 자동으로 검증하려면 결정적인 상대가 필요해서,
// 원래의 오프라인 시뮬레이션을 테스트 더블로만 남겨 두었다.
// 이 파일은 web/ 어디에서도 import 되지 않는다.

import { TOPICS, LANDMINES, FILLER, FILLER_REPLY, ALL_TOPIC_IDS } from '../../game/data/topics.js'
import { BALANCE, clamp } from '../../game/core/config.js'

const TIER_MOOD = { great: 5, ok: 3, flat: 0, bad: -6, mine: -10 }

function render(line, ctx) {
  return String(line)
    .replaceAll('{c}', ctx.client.name)
    .replaceAll('{t}', ctx.client.target.name)
    .replaceAll('{hobby}', ctx.client.hobby)
    .replaceAll('{quirk}', ctx.client.quirk)
}

/** 최근 N턴 안에 쓴 화제인지 */
function usedRecently(ctx, topic, n = 3) {
  if (!topic) return false
  const recent = ctx.history.filter((h) => h.who === 'client').slice(-n)
  return recent.some((h) => h.topic === topic)
}

/**
 * 이번 턴에 의뢰인이 꺼낼 화제의 가중치 표.
 * 의뢰인은 "플레이어가 준 것"(코칭·스타일링·개입)과 "자기 성향"과 "대화 흐름"으로만 움직인다.
 * 숨은 취향을 저절로 아는 일은 없다 — 그게 이 게임의 난이도다.
 */
function topicWeights(ctx) {
  const { client, prep, dossier } = ctx
  const w = new Map()
  const bump = (id, amount) => w.set(id, (w.get(id) ?? 0) + amount)

  // 아무도 시키지 않은 화제의 기본 가중치는 낮게 잡는다.
  // 여기를 높이면 의뢰인이 알아서 숨은 취향까지 얻어걸려서, 코칭도 개입도 의미가 없어진다.
  for (const id of ALL_TOPIC_IDS) {
    let base = 0.05
    if (client.comfortTopics.includes(id)) base = 0.45
    if (client.weakTopics.includes(id)) base *= 0.45
    bump(id, base)
  }

  // 코칭이 지목한 화제
  for (const id of prep.coaching.topics) bump(id, 2.4 * prep.coaching.fidelity)

  // 스타일링이 만든 분위기 — 옷이 화제를 부른다
  for (const id of prep.styling.matched) bump(id, 0.7)

  // 의뢰인이 아는 취향은 "서류철에 처음부터 적혀 있던 것"뿐이다.
  // 대화 중 새로 드러난 취향은 요원(플레이어)만 본다 — 의뢰인은 긴장해서 눈치채지 못한다.
  // 그래서 발견을 살리려면 반드시 개입해서 알려줘야 한다. 여기서 revealed 까지
  // 자동으로 밀어주면 개입 기능 자체가 무의미해진다.
  for (const id of dossier.visibleLikes) bump(id, 0.5)

  // 대화 흐름 따라가기: 상대가 방금 꺼낸 화제
  const lastTarget = [...ctx.history].reverse().find((h) => h.who === 'target')
  if (lastTarget?.topic) bump(lastTarget.topic, 1.6)

  // 개입은 이번 턴을 통째로 지배한다
  if (ctx.activeIntervention?.topic) {
    bump(ctx.activeIntervention.topic, 6 * ctx.activeIntervention.power)
  }

  // 방금 한 얘기 또 하기 방지
  for (const id of [...w.keys()]) {
    if (usedRecently(ctx, id, 3)) w.set(id, w.get(id) * 0.15)
  }

  return [...w.entries()].map(([key, weight]) => ({ key, weight }))
}

/** 이번 턴에 지뢰를 밟을 확률. 자신감·코칭이 낮을수록 올라간다. */
function landmineChance(ctx) {
  const conf = ctx.prep.speech.confidence
  const craft = ctx.prep.coaching.craft
  let p = 0.04 + (1 - conf) * 0.10 - craft * 0.05
  // 코칭에서 "그 얘기 하지 마"라고 명시적으로 막아둔 지뢰가 있으면 그만큼 덜 밟는다
  const avoided = ctx.prep.coaching.avoidedMines ?? []
  if (avoided.length && ctx.dossier.mines.length) {
    p *= 1 - 0.6 * (avoided.length / ctx.dossier.mines.length)
  }
  if (ctx.state.mood < 30) p += 0.05
  // 개입이 걸려 있는 턴에는 의뢰인이 집중한다
  if (ctx.activeIntervention?.topic && !ctx.activeIntervention.backfire) p *= 0.3
  return clamp(p, 0, 0.25)
}

/**
 * 발언의 질. 준비(자신감·코칭)가 주도하고 분위기는 거들기만 한다.
 * 분위기 비중을 크게 잡으면 한 번 식은 판이 회복 불가능해진다 — 실측으로 확인했다.
 */
function pickTier(ctx, topic) {
  const { prep, state } = ctx
  let q =
    0.5 * prep.speech.confidence +
    0.18 * (state.mood / 100) +
    0.32 * prep.coaching.fidelity +
    ctx.rng.float(-0.15, 0.15)

  if (ctx.activeIntervention?.topic === topic && !ctx.activeIntervention.backfire) {
    q += 0.25 * ctx.activeIntervention.power
  }
  if (ctx.client.weakTopics.includes(topic)) q -= 0.2
  if (ctx.client.comfortTopics.includes(topic)) q += 0.1

  // 경계를 높게 잡으면 어중간한 준비가 전부 무의미한 잡담으로 떨어져서
  // "잘함 / 아무것도 아님" 두 칸짜리 게임이 된다. 중간이 존재해야 한다.
  if (q >= 0.62) return 'great'
  if (q >= 0.26) return 'ok'
  if (q >= 0.14) return 'flat'
  return 'bad'
}

export function createFakeModel() {
  return {
    id: 'fake',
    label: '테스트용 가짜 모델',

    async clientTurn(ctx) {
      // 개입이 역효과였다면 그 지뢰를 그대로 밟는다
      if (ctx.activeIntervention?.backfire && ctx.activeIntervention.topic) {
        const mine = LANDMINES[ctx.activeIntervention.topic]
        return {
          text: render(ctx.rng.pick(mine.lines.any), ctx),
          topic: mine.id,
          tier: 'mine',
        }
      }

      if (ctx.dossier.mines.length && ctx.rng.chance(landmineChance(ctx))) {
        const avoidedSet = new Set(ctx.prep.coaching.avoidedMines ?? [])
        const pool = ctx.dossier.mines.filter((m) => !avoidedSet.has(m))
        const id = ctx.rng.pick(pool.length ? pool : ctx.dossier.mines)
        const mine = LANDMINES[id]
        return { text: render(ctx.rng.pick(mine.lines.any), ctx), topic: id, tier: 'mine' }
      }

      // 개입이 화제를 지목했으면 그 화제가 확정된다.
      // 가중치만 올리면 "귓속말을 했는데 딴소리를 한다"가 되어 기능이 안 읽힌다.
      const forced = ctx.activeIntervention?.topic
      const topic =
        forced && TOPICS[forced]
          ? forced
          : (ctx.rng.weighted(topicWeights(ctx)) ?? ctx.rng.pick(ALL_TOPIC_IDS))
      const tier = pickTier(ctx, topic)

      if (tier === 'flat' || tier === 'bad') {
        return { text: render(ctx.rng.pick(FILLER[tier]), ctx), topic: null, tier }
      }

      const def = TOPICS[topic]
      const bank = def.lines[tier] ?? def.lines.ok
      return { text: render(ctx.rng.pick(bank), ctx), topic, tier }
    },

    async targetTurn(ctx, utter) {
      let text
      let replyTopic = utter.topic

      if (utter.tier === 'mine') {
        text = ctx.rng.pick(LANDMINES[utter.topic].reply)
        replyTopic = null
      } else if (!utter.topic) {
        text = ctx.rng.pick(FILLER_REPLY[utter.tier] ?? FILLER_REPLY.flat)
        replyTopic = null
      } else {
        const def = TOPICS[utter.topic]
        const liked = ctx.dossier.likes.includes(utter.topic)
        const bank = liked ? def.reply.like : def.reply.neutral
        text = ctx.rng.pick(bank)
        if (!liked) replyTopic = null // 관심 없는 화제는 흐름으로 안 이어진다
      }

      // 힌트 흘리기 — 분위기가 좋을수록 자주 샌다
      let hintTopic = null
      const p = BALANCE.hintBaseChance + (ctx.state.mood / 100) * BALANCE.hintMoodScale
      if (ctx.rng.chance(p)) {
        const candidates = [
          ...ctx.dossier.hiddenLikes.filter((id) => !ctx.dossier.revealed.has(id)),
          ...ctx.dossier.mines.filter((id) => !ctx.dossier.revealed.has(id)),
        ]
        if (candidates.length) {
          hintTopic = ctx.rng.pick(candidates)
          const def = TOPICS[hintTopic] ?? LANDMINES[hintTopic]
          const hintLine = ctx.rng.pick(def.hint ?? [])
          if (hintLine) text = `${text}\n${render(hintLine, ctx)}`
        }
      }

      return { text: render(text, ctx), topic: replyTopic, hintTopic }
    },

    async judge(ctx, utter) {
      const { prep, state, dossier } = ctx
      const lastTarget = [...ctx.history].reverse().find((h) => h.who === 'target')

      // ── 분위기: 흐름이 자연스러웠는가
      let mood = TIER_MOOD[utter.tier] ?? 0
      if (utter.topic && lastTarget?.topic === utter.topic) mood += 3
      else if (utter.topic && lastTarget?.topic && utter.tier !== 'great') mood -= 2
      if (usedRecently(ctx, utter.topic, 3)) mood -= 4
      mood += (prep.speech.confidence - 0.5) * 4

      // ── 호감: 취향을 맞혔는가
      const isLike = utter.topic && dossier.likes.includes(utter.topic)
      const isMine = utter.tier === 'mine'
      let love
      let discovered = null

      if (isMine) {
        love = -9
        if (!dossier.revealed.has(utter.topic)) discovered = utter.topic
      } else if (isLike) {
        love = 5
        // 발굴 보너스는 "서류철에 없던 것을 처음 건드렸을 때"만 붙는다.
        // 공개돼 있던 취향까지 보너스를 주면 처음부터 다 알려주는 쉬움 난이도가
        // 오히려 점수가 잘 나오는 역전이 생긴다.
        const wasKnown =
          dossier.visibleLikes.includes(utter.topic) || dossier.revealed.has(utter.topic)
        if (!wasKnown) {
          love += BALANCE.discoveryLoveBonus
          discovered = utter.topic
        }
      } else if (utter.topic) {
        love = utter.tier === 'great' ? 2 : 1
      } else {
        love = utter.tier === 'bad' ? -2 : 0
      }
      // 스타일링 잔여 보정은 화제를 실제로 꺼낸 턴에만 붙는다
      if (utter.topic) love += prep.styling.resonance

      const reason = buildReason(utter, { isLike, isMine, repeat: usedRecently(ctx, utter.topic, 3) })

      return {
        moodDelta: clamp(Math.round(mood), -BALANCE.moodDeltaClamp, BALANCE.moodDeltaClamp),
        loveDeltaRaw: love,
        reason,
        discovered,
      }
    },
  }
}

function buildReason(utter, flags) {
  if (flags.isMine) return `지뢰를 밟았다 — ${LANDMINES[utter.topic].label}`
  if (flags.isLike && utter.tier === 'great') return `취향 정중앙 — ${TOPICS[utter.topic].label}`
  if (flags.isLike) return `취향에 닿았다 — ${TOPICS[utter.topic].label}`
  if (flags.repeat) return '같은 얘기를 또 했다'
  if (utter.tier === 'bad') return '말이 끊겼다'
  if (utter.tier === 'flat') return '무난했지만 남는 게 없다'
  if (utter.topic) return `${TOPICS[utter.topic].label} 얘기는 나쁘지 않았다`
  return '흘러갔다'
}
