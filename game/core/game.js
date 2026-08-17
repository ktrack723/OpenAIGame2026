// 게임 상태 기계. UI 도 자동 플레이 봇도 전부 이 객체 하나를 조작한다.
//
// 단계: screening → consult → texting → talking → ending
// 분위기/호감은 문자 단계에서 대면 단계로 그대로 넘어간다(기획서 4장).

import { CLIENTS, getClient } from '../data/clients.js'
import { TOPICS, LANDMINES } from '../data/topics.js'
import { BALANCE, PHASES, DIFFICULTIES, moodMultiplier, clamp } from './config.js'
import {
  buildDossier,
  scoreStyling,
  scoreCoaching,
  scoreSpeech,
  scoreIntervention,
  resolveConfession,
} from './scoring.js'
import { Rng } from './rng.js'
import { createLocalEngine } from '../engine/local.js'
import { writeLetter } from '../data/letters.js'

export const STAGES = ['screening', 'consult', 'texting', 'talking', 'ending']

export class Game {
  constructor({ seed = 1, difficulty = 'normal', engine = null } = {}) {
    this.seed = seed
    this.rng = new Rng(seed)
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : 'normal'
    this.engine = engine ?? createLocalEngine()

    this.stage = 'screening'
    this.client = null
    this.dossier = null

    this.input = { styling: '', coaching: '', speech: '' }
    this.prep = null

    this.state = { mood: BALANCE.moodStart, love: BALANCE.loveStart }
    this.history = []
    this.log = []
    this.discoveries = []
    this.topicHits = new Map() // 화제별 누적 횟수 — 반복 체감 감소에 쓴다

    this.phase = null
    this.turn = 0
    this.interventionsLeft = 0
    this.pendingIntervention = null
    this.activeIntervention = null
    this.outcome = null
    this.notices = []
  }

  /** 기획서 1장: 서류철 목록. */
  get roster() {
    return CLIENTS
  }

  chooseClient(id) {
    const client = getClient(id)
    if (!client) throw new Error(`알 수 없는 의뢰인: ${id}`)
    this.client = client
    this.dossier = buildDossier(client, this.difficulty, this.rng.fork('dossier'))
    this.stage = 'consult'
    return this
  }

  setStyling(text) {
    this.input.styling = String(text ?? '')
    return this
  }
  setCoaching(text) {
    this.input.coaching = String(text ?? '')
    return this
  }
  setSpeech(text) {
    this.input.speech = String(text ?? '')
    return this
  }

  /** 준비 단계 마감 → 시작 수치 확정 → 문자 단계 개시. */
  async beginRun() {
    if (!this.client) throw new Error('의뢰인을 먼저 선택해야 합니다')

    const styling = scoreStyling(this.input.styling, this.client, this.dossier)
    const coaching = scoreCoaching(this.input.coaching, this.client, this.dossier)
    const speech = scoreSpeech(this.input.speech, this.client)

    this.prep = {
      styling,
      coaching: { ...coaching, text: this.input.coaching },
      speech: { ...speech, text: this.input.speech },
      llm: null,
    }

    // LLM 모드면 준비 평가를 LLM이 덮어쓴다(실패하면 휴리스틱 그대로).
    if (typeof this.engine.evaluatePrep === 'function') {
      const verdict = await this.engine.evaluatePrep(this._ctx())
      if (verdict) {
        this.prep.llm = verdict
        this.prep.speech.confidence = verdict.speechConfidence
        this.prep.speech.moodBonus = Math.round(verdict.speechConfidence * BALANCE.speechMoodBonusMax)
        this.prep.coaching.fidelity = verdict.coachingFidelity
        this.prep.coaching.moodBonus = Math.round(verdict.coachingFidelity * BALANCE.coachingMoodBonusMax)
      }
    }

    this.state.love = clamp(
      BALANCE.loveStart + this.prep.styling.loveBonus,
      BALANCE.loveMin,
      BALANCE.loveMax,
    )
    this.state.mood = clamp(
      BALANCE.moodStart + this.prep.speech.moodBonus + this.prep.coaching.moodBonus,
      BALANCE.moodMin,
      BALANCE.moodMax,
    )

    this._enterPhase('texting')
    return this
  }

  _enterPhase(id) {
    this.phase = PHASES[id]
    this.stage = id
    this.turn = 0
    this.interventionsLeft = this.phase.interventions
    this.pendingIntervention = null
    this.activeIntervention = null
    this.notices.push({ type: 'phase', phase: id, label: this.phase.label })
  }

  get canIntervene() {
    return (
      (this.stage === 'texting' || this.stage === 'talking') &&
      this.interventionsLeft > 0 &&
      !this.pendingIntervention
    )
  }

  /** 다음 발언 하나에 실릴 귓속말을 예약한다. */
  queueIntervention(text) {
    if (!this.canIntervene) return { ok: false, reason: '지금은 개입할 수 없습니다' }
    const scored = scoreIntervention(text, this.client, this.dossier)
    this.pendingIntervention = { ...scored, text: String(text ?? '') }
    this.interventionsLeft--
    return { ok: true, ...scored }
  }

  _ctx() {
    return {
      client: this.client,
      dossier: this.dossier,
      prep: this.prep,
      state: this.state,
      history: this.history,
      phase: this.stage,
      turn: this.turn,
      rng: this.rng,
      activeIntervention: this.activeIntervention,
    }
  }

  /** 한 번의 주고받기: 의뢰인 발언 → 판정 → 상대 반응. */
  async step() {
    if (this.stage !== 'texting' && this.stage !== 'talking') {
      throw new Error(`지금 단계에서는 대화할 수 없습니다: ${this.stage}`)
    }

    this.activeIntervention = this.pendingIntervention
    this.pendingIntervention = null

    const ctx = this._ctx()
    const utter = await this.engine.clientTurn(ctx)
    const verdict = await this.engine.judge(ctx, utter)

    const topic = utter.topic ?? verdict.topic ?? null

    // 분위기는 방치하면 중립점으로 돌아간다 — 양쪽 모두.
    // 위에서 내려오는 건 "들뜬 공기는 유지해야 한다", 아래에서 올라오는 건
    // "어색한 침묵도 언젠가는 지나간다". 후자가 없으면 한 번 무너진 판이
    // 영영 회복 못 하는 죽음의 나선이 된다.
    const moodBefore = this.state.mood
    const gap = BALANCE.moodNeutral - moodBefore
    const drift = Math.sign(gap) * Math.min(BALANCE.moodDrift, Math.abs(gap))
    this.state.mood = clamp(moodBefore + drift + verdict.moodDelta, BALANCE.moodMin, BALANCE.moodMax)

    // 같은 취향을 또 건드리면 값이 급격히 준다. 엔진과 무관하게 여기서 한 번만 적용한다.
    let raw = verdict.loveDeltaRaw
    if (topic && raw > 0) {
      const seen = this.topicHits.get(topic) ?? 0
      raw *= BALANCE.saturation[Math.min(seen, BALANCE.saturation.length - 1)]
    }
    // 호감 총량은 "몇 가지 취향을 건드렸나"로 자연스럽게 묶인다(위의 saturation).
    // 여기에 현재 호감 기준의 전역 감쇠까지 걸면 후반 행동이 전부 무의미해져서
    // 숨은 취향을 찾아낸 보람이 사라진다 — 실측으로 확인하고 걷어냈다.
    if (topic) this.topicHits.set(topic, (this.topicHits.get(topic) ?? 0) + 1)

    // 분위기는 호감 증감의 배율이다(기획서 Common-1).
    // 그 발언이 만든 분위기 변화까지 반영되도록 전후 평균으로 곱한다.
    const mul = moodMultiplier((moodBefore + this.state.mood) / 2)
    const loveDelta = clamp(
      Math.round(raw * mul),
      -BALANCE.loveDeltaClamp,
      BALANCE.loveDeltaClamp,
    )
    const loveBefore = this.state.love
    this.state.love = clamp(loveBefore + loveDelta, BALANCE.loveMin, BALANCE.loveMax)
    this.history.push({ who: 'client', text: utter.text, topic, tier: utter.tier })

    if (verdict.discovered) this._reveal(verdict.discovered, '반응으로 알아냄')

    const reply = await this.engine.targetTurn(this._ctx(), utter)
    this.history.push({ who: 'target', text: reply.text, topic: reply.topic ?? null })
    if (reply.hintTopic) this._reveal(reply.hintTopic, '흘린 말에서 포착')

    const entry = {
      phase: this.stage,
      turn: this.turn + 1,
      clientText: utter.text,
      targetText: reply.text,
      topic,
      tier: utter.tier,
      moodDelta: this.state.mood - moodBefore,
      loveDelta,
      moodMul: Math.round(mul * 100) / 100,
      reason: verdict.reason,
      mood: this.state.mood,
      love: this.state.love,
      intervened: Boolean(this.activeIntervention),
    }
    this.log.push(entry)

    this.turn++
    this.activeIntervention = null

    if (this.turn >= this.phase.turns) {
      if (this.stage === 'texting') this._enterPhase('talking')
      else this.stage = 'ending'
    }

    return entry
  }

  _reveal(id, how) {
    if (!id || this.dossier.revealed.has(id)) return
    if (!this.dossier.likes.includes(id) && !this.dossier.mines.includes(id)) return
    this.dossier.revealed.add(id)
    const isMine = this.dossier.mines.includes(id)
    const label = (isMine ? LANDMINES[id] : TOPICS[id])?.label ?? id
    const found = { id, label, isMine, how }
    this.discoveries.push(found)
    this.notices.push({ type: 'discovery', ...found })
    return found
  }

  /** 남은 턴을 한 번에 소화한다(자동 플레이용). */
  async runPhase(onStep) {
    while (this.stage === 'texting' || this.stage === 'talking') {
      const before = this.stage
      const entry = await this.step()
      if (onStep) await onStep(entry, this)
      if (this.stage !== before) return
    }
  }

  /** 기획서 5장: 고백은 나중에 일어나고, 결과는 편지로 온다. */
  async finish() {
    if (this.outcome) return this.outcome
    const verdict = resolveConfession(
      this.state.love,
      this.state.mood,
      this.difficulty,
      this.rng.fork('confession'),
    )
    this.outcome = {
      ...verdict,
      mood: this.state.mood,
      love: this.state.love,
      letter: writeLetter(this, verdict),
      stats: this._summary(),
    }
    this.stage = 'ending'
    return this.outcome
  }

  _summary() {
    const hits = this.log.filter((e) => e.loveDelta >= 6).length
    const mines = this.log.filter((e) => e.tier === 'mine').length
    const best = this.log.reduce((a, b) => (b.loveDelta > (a?.loveDelta ?? -Infinity) ? b : a), null)
    const worst = this.log.reduce((a, b) => (b.loveDelta < (a?.loveDelta ?? Infinity) ? b : a), null)
    return {
      turns: this.log.length,
      hits,
      mines,
      discoveries: this.discoveries.length,
      best,
      worst,
      finalMood: this.state.mood,
      finalLove: this.state.love,
    }
  }

  get isOver() {
    return this.stage === 'ending'
  }
}
