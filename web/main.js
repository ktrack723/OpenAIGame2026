// 흐름 제어. 화면 하나가 함수 하나다.
//
// 이 게임은 LLM 연결이 전제다. 키가 없거나 호출이 실패하면 대체 판정으로 넘어가지 않고
// 그 자리에 멈춰서 다시 시도할지 묻는다.

import { Game } from '../game/core/game.js'
import { createLlmEngine, verifyKey, DEFAULT_MODEL, LlmError } from '../game/engine/index.js'
import { DIFFICULTIES } from '../game/core/config.js'
import { CLIENTS } from '../game/data/clients.js'
import { createStage } from './three/scene.js'
import { parseAppearance, sameAppearance } from './three/appearance.js'
import {
  $, el, button, panel, thinking, setHud, renderHud,
  dialogueLine, verdictRow, noticeBox, errorBox, debounce,
} from './ui.js'

const KEY_STORE = 'rizz.apiKey'
const MODEL_STORE = 'rizz.model'

const store = {
  get(k, d = '') {
    try {
      return localStorage.getItem(k) ?? d
    } catch {
      return d
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* 시크릿 모드 등 */
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* noop */
    }
  },
}

let stage = null
let game = null
let apiKey = ''
let model = DEFAULT_MODEL
let difficulty = 'normal'
let lastSpec = { client: null, target: null }

// ─────────────────────────────────────────── 3D 연동

/** 의뢰인/상대의 외모 명세를 만들어 무대에 반영한다. 같으면 다시 세우지 않는다. */
function syncActors({ client, styling = '', both = true }) {
  if (!client || !stage) return
  const cSpec = parseAppearance({
    appearanceTags: client.appearance,
    personality: client.personality,
    styling,
    role: 'client',
    seedName: client.name,
  })
  if (!sameAppearance(cSpec, lastSpec.client)) {
    stage.setActor('client', cSpec)
    lastSpec.client = cSpec
  }
  if (both) {
    const tSpec = parseAppearance({
      appearanceTags: [client.target.blurb, client.target.job],
      role: 'target',
      seedName: client.target.name,
    })
    if (!sameAppearance(tSpec, lastSpec.target)) {
      stage.setActor('target', tSpec)
      lastSpec.target = tSpec
    }
  }
}

function previewTag(text) {
  let tag = $('#previewTag')
  if (!text) {
    tag?.remove()
    return
  }
  if (!tag) {
    tag = el('div', { class: 'preview-tag', id: 'previewTag' })
    document.body.append(tag)
  }
  tag.textContent = text
}

// ─────────────────────────────────────────── 화면

function screenKey({ error } = {}) {
  setHud(false)
  previewTag(null)
  const input = el('input', {
    type: 'password',
    id: 'apiKey',
    'data-testid': 'apikey',
    placeholder: 'sk-ant-...',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    value: apiKey,
  })
  const modelInput = el('input', { type: 'text', id: 'modelId', value: model, spellcheck: 'false' })
  const status = el('div', { class: 'hint' })

  async function connect() {
    apiKey = input.value.trim()
    model = modelInput.value.trim() || DEFAULT_MODEL
    if (!apiKey) {
      status.textContent = '키를 넣어야 시작할 수 있습니다.'
      return
    }
    status.replaceChildren(thinking('연결 확인 중'))
    try {
      await verifyKey({ apiKey, model })
      store.set(KEY_STORE, apiKey)
      store.set(MODEL_STORE, model)
      screenTitle()
    } catch (err) {
      status.replaceChildren(
        el('span', { class: 'notice err', text: `연결 실패 — ${err.message}` }),
      )
    }
  }

  panel(
    [
      el('div', { class: 'title-logo', text: 'BISHOUJO RIZZ SIMULATOR 2077' }),
      el('p', { class: 'dim', text: '연애 코칭국 요원 단말기 · 접속 인증' }),
      el('div', { class: 'notice err' },
        el('div', { html: '<strong>이 게임은 LLM 연결이 있어야만 돌아갑니다.</strong>' }),
        el('div', { class: 'tiny', text: '의뢰인·상대·판정이 전부 모델입니다. 오프라인 모드는 없습니다.' }),
      ),
      error ? el('div', { class: 'notice err', text: error }) : null,
      el('label', { for: 'apiKey', text: 'Anthropic API 키' }),
      input,
      el('div', { class: 'hint', text: '키는 이 브라우저에만 저장되고 서버로 보내지 않습니다. 공용 기기에서는 쓰지 마세요.' }),
      el('label', { for: 'modelId', text: '모델' }),
      modelInput,
      status,
      button('접속', { cls: 'primary', onClick: connect, sub: '연결을 확인합니다' }),
      apiKey
        ? button('저장된 키 지우기', {
            cls: 'ghost',
            onClick: () => {
              store.del(KEY_STORE)
              apiKey = ''
              screenKey()
            },
          })
        : null,
      el('p', { class: 'tiny', html: 'API 키는 <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" style="color:var(--cyan)">console.anthropic.com</a> 에서 발급합니다. 호출 비용은 본인 계정에 청구됩니다.' }),
    ],
    { center: true },
  )
}

function screenTitle() {
  setHud(false)
  previewTag(null)
  panel(
    [
      el('div', { class: 'title-logo', text: 'BISHOUJO RIZZ SIMULATOR 2077' }),
      el('p', { class: 'dim', text:
        '2077년. 출생률이 1 아래로 떨어졌고, 정부는 연애 경험이 없는 시민들이 짝사랑 상대에게 ' +
        '말을 걸도록 돕는 비밀 기관을 세웠다. 당신은 그 기관의 신입 요원이다.' }),
      el('p', { class: 'dim', text: '당신은 연애하지 않는다. 남을 연애시킨다.' }),
      button('임무 시작', { cls: 'primary', onClick: screenDifficulty, sub: '난이도를 고릅니다' }),
      button('요원 안내서', { cls: '', onClick: screenHelp }),
      button('접속 정보 변경', { cls: 'ghost', onClick: () => screenKey() }),
    ],
    { center: true },
  )
}

function screenHelp() {
  panel(
    [
      el('h1', { text: '요원 안내서' }),
      el('p', { class: 'dim', text: '두 개의 수치가 있다.' }),
      el('p', {}, el('strong', { text: '분위기' }), ' — 대화가 자연스러웠는가. 취향 적중과 무관하다.'),
      el('p', {}, el('strong', { text: '호감' }), ' — 상대의 취향을 만족시켰는가. 흐름과 무관하다.'),
      el('p', { class: 'dim', text: '분위기는 호감 증감의 배율이 된다. 어색했지만 취향을 맞혔다면 분위기 ▼, 호감 ▲ 가 정상이다.' }),
      el('h2', { text: '이기는 법' }),
      el('p', { class: 'dim', text:
        '1) 공개된 취향은 스타일링과 코칭으로 미리 심는다.\n' +
        '2) 숨은 취향은 대화 중 상대가 흘릴 때만 드러난다.\n' +
        '3) 발견했으면 반드시 개입해서 알려줘야 의뢰인이 쓴다.\n' +
        '4) 같은 얘기를 반복하면 값이 급감한다. 넓게 훑어라.\n' +
        '5) 지뢰는 끝까지 비공개다. 코칭에 "자랑은 하지 마"라고 적어두면 덜 밟는다.',
        style: 'white-space:pre-wrap' }),
      el('h2', { text: '스타일링과 3D' }),
      el('p', { class: 'dim', text: '상담실에서 적는 스타일링 문장이 그대로 의뢰인의 3D 모델에 반영된다. 옷·머리·색·소품을 적으면 바로 보인다.' }),
      button('돌아가기', { cls: 'primary', onClick: screenTitle }),
    ],
    { center: true },
  )
}

function screenDifficulty() {
  panel(
    [
      el('h1', { text: '난이도' }),
      el('p', { class: 'dim', text: '대상의 취향을 얼마나 알려줄지 정한다.' }),
      ...Object.values(DIFFICULTIES).map((d) =>
        button(`${d.label} · ${d.tag}`, {
          sub: d.desc,
          cls: d.id === 'normal' ? 'primary' : '',
          onClick: () => {
            difficulty = d.id
            screenScreening()
          },
        }),
      ),
      button('뒤로', { cls: 'ghost', onClick: screenTitle }),
    ],
    { center: true },
  )
}

function screenScreening() {
  setHud(false)
  previewTag(null)
  panel([
    el('h1', { text: '의뢰인 서류철' }),
    el('p', { class: 'dim', text: '도울 사람을 한 명 고른다.' }),
    el(
      'div',
      { class: 'cards' },
      ...CLIENTS.map((c) =>
        el(
          'button',
          { class: 'card', type: 'button', 'data-testid': `client-${c.id}`, onclick: () => screenDossier(c) },
          el('div', { class: 'who' }, `${c.name} (${c.age}) `, el('span', { class: 'arrow', text: '→' }), ` ${c.target.name}`),
          el('div', { class: 'job', text: c.job }),
        ),
      ),
    ),
    button('뒤로', { cls: 'ghost', onClick: screenDifficulty }),
  ])
}

function screenDossier(client) {
  syncActors({ client })
  previewTag(`${client.name} — 서류철`)
  panel([
    el('h1', { text: `${client.name} (${client.age})` }),
    el('p', { class: 'dim', text: client.job }),
    el('div', { class: 'banner' },
      el('div', { class: 'big', text: `${client.name} → ${client.target.name}` }),
      el('div', { class: 'tiny', text: `${client.target.age} · ${client.target.job}` }),
    ),
    el('h2', { text: '사연' }),
    el('p', { class: 'dim', text: client.story }),
    el('h2', { text: '외모' }),
    el('p', { class: 'dim', text: client.appearance.join(', ') }),
    el('h2', { text: '성격' }),
    el('p', { class: 'dim', text: client.personality.join(', ') }),
    el('h2', { text: `${client.target.name} 관찰 기록` }),
    el('p', { class: 'dim', text: client.target.blurb }),
    button('이 사람을 맡는다', { cls: 'primary', 'data-testid': 'take', onClick: () => startConsult(client) }),
    button('다른 서류철', { cls: 'ghost', onClick: screenScreening }),
  ])
}

// ─────────────────────────────────────────── 상담실

function startConsult(client) {
  game = new Game({
    seed: Date.now() % 1e9,
    difficulty,
    engine: createLlmEngine({ apiKey, model }),
  })
  game.chooseClient(client.id)
  game.labelOf = labelOf
  screenStyling()
}

function labelOf(id) {
  // topics.js 의 라벨을 UI 쪽에서도 쓴다
  return labelOf._map?.[id] ?? id
}

function knownList() {
  return game.dossier.visibleLikes.map(labelOf)
}

function screenStyling() {
  const client = game.client
  syncActors({ client, styling: game.input.styling })
  previewTag('스타일링 — 적는 대로 모델이 바뀝니다')

  const ta = el('textarea', {
    id: 'styling',
    'data-testid': 'styling',
    placeholder: '예)  가죽 재킷, 은색 목걸이, 짧은 머리, 뿔테 안경',
    value: game.input.styling,
  })
  const live = debounce(() => {
    game.setStyling(ta.value)
    syncActors({ client, styling: ta.value, both: false })
  }, 200)
  ta.addEventListener('input', live)

  panel([
    el('h1', { text: '2-1) 스타일링' }),
    el('p', { class: 'dim', text: '상대의 취향에 맞게 꾸민다. 적는 즉시 뒤쪽 모델이 바뀐다.' }),
    el('div', { class: 'banner' },
      el('div', { class: 'tiny', text: '서류철에 적힌 파악된 취향' }),
      el('div', { class: 'big', text: knownList().join(' · ') || '(없음)' }),
      el('div', { class: 'tiny', text: `미확인 ${game.client.target.likes.length - game.dossier.visibleLikes.length}건 · 지뢰 ${game.dossier.mines.length}건은 비공개` }),
    ),
    el('label', { for: 'styling', text: '무엇을 입힐 것인가?' }),
    ta,
    el('div', { class: 'hint', text: '옷 종류·색·머리 모양·소품을 적으면 반영된다. 예: 후드티 / 정장 / 원피스 / 분홍 머리 / 헤드폰 / 안경 / 부츠' }),
    button('다음 — 대화 코칭', { cls: 'primary', 'data-testid': 'to-coaching', onClick: () => {
      game.setStyling(ta.value)
      screenCoaching()
    } }),
    button('뒤로', { cls: 'ghost', onClick: screenScreening }),
  ])
}

function screenCoaching() {
  previewTag(null)
  const ta = el('textarea', {
    id: 'coaching',
    'data-testid': 'coaching',
    placeholder: '예)  야식이랑 별 얘기를 먼저 꺼내. 상대 말을 끝까지 듣고 되물어. 자랑은 하지 마.',
    value: game.input.coaching,
  })
  panel([
    el('h1', { text: '2-2) 대화 코칭' }),
    el('p', { class: 'dim', text: '여기 적은 문장이 그대로 의뢰인의 시스템 프롬프트가 된다.' }),
    el('label', { for: 'coaching', text: '어떻게 대화하라고 할 것인가?' }),
    ta,
    el('div', { class: 'hint', text: '어떤 화제를 꺼낼지 + 어떤 태도로 말할지 둘 다 적는 게 좋다.' }),
    button('다음 — 격려 연설', { cls: 'primary', 'data-testid': 'to-speech', onClick: () => {
      game.setCoaching(ta.value)
      screenSpeech()
    } }),
    button('뒤로', { cls: 'ghost', onClick: screenStyling }),
  ])
}

function screenSpeech() {
  const ta = el('textarea', {
    id: 'speech',
    'data-testid': 'speech',
    placeholder: '사연 속의 구체적인 것을 짚어줄수록 자신감이 올라간다.',
    value: game.input.speech,
  })
  panel([
    el('h1', { text: '2-3) 격려 연설' }),
    el('p', { class: 'dim', text: '멋있을수록, 그리고 이 사람의 사연에 맞닿아 있을수록 좋다.' }),
    el('div', { class: 'banner' }, el('div', { class: 'tiny', text: game.client.story })),
    el('label', { for: 'speech', text: `${game.client.name} 씨에게 무슨 말을 해줄 것인가?` }),
    ta,
    button('내보낸다', { cls: 'primary', 'data-testid': 'begin', onClick: async () => {
      game.setSpeech(ta.value)
      await runBeginRun()
    } }),
    button('뒤로', { cls: 'ghost', onClick: screenCoaching }),
  ])
}

async function runBeginRun() {
  panel([el('h1', { text: '준비 상태 평가' }), thinking('모델이 준비 상태를 보는 중')])
  try {
    await game.beginRun()
    screenPrepSummary()
  } catch (err) {
    panel([el('h1', { text: '준비 상태 평가' }), ...errorBox(err, runBeginRun, screenTitle)])
  }
}

function screenPrepSummary() {
  const p = game.prep
  const pctOf = (v) => `${Math.round(v * 100)}%`
  syncActors({ client: game.client, styling: game.input.styling })
  previewTag(null)
  panel([
    el('h1', { text: '준비 완료' }),
    el('h2', { text: '스타일링' }),
    el('p', { class: 'dim', text: `적중: ${p.styling.matched.map(labelOf).join(', ') || '없음'} · 시작 호감 ${p.styling.loveBonus >= 0 ? '+' : ''}${p.styling.loveBonus}` }),
    p.llm?.stylingComment ? el('p', { class: 'tiny', text: `"${p.llm.stylingComment}"` }) : null,
    el('h2', { text: '코칭' }),
    el('p', { class: 'dim', text: `지시 충실도 ${pctOf(p.coaching.fidelity)}` }),
    p.llm?.coachingComment ? el('p', { class: 'tiny', text: `"${p.llm.coachingComment}"` }) : null,
    el('h2', { text: '격려' }),
    el('p', { class: 'dim', text: `의뢰인 자신감 ${pctOf(p.speech.confidence)}` }),
    p.llm?.speechComment ? el('p', { class: 'tiny', text: `"${p.llm.speechComment}"` }) : null,
    button('대화를 시작한다', { cls: 'primary', 'data-testid': 'start-chat', onClick: screenChat }),
  ])
}

// ─────────────────────────────────────────── 대화

let shownNotices = 0
let lastPhaseSeen = null

function screenChat() {
  setHud(true)
  renderHud(game)
  stage.setGauges(game.state.mood, game.state.love)

  if (lastPhaseSeen !== game.stage) {
    lastPhaseSeen = game.stage
    panel([
      el('div', { class: 'banner' },
        el('div', { class: 'big', text: game.phase.label }),
        el('div', { class: 'tiny', text: `${game.phase.turns}번의 주고받기 · 개입 ${game.phase.interventions}회` }),
      ),
      game.stage === 'talking'
        ? el('p', { class: 'dim', text: '분위기와 호감은 문자 단계에서 그대로 이어진다.' })
        : null,
      button('시작', { cls: 'primary', 'data-testid': 'phase-go', onClick: () => turnPrompt() }),
    ])
    return
  }
  turnPrompt()
}

// 클릭 핸들러로 직접 넘기면 첫 인자로 Event 가 들어온다 — 배열이 아니라 터진다.
// 호출부에서 () => turnPrompt() 로 감싸되, 여기서도 방어한다.
function turnPrompt(extra) {
  renderHud(game)
  const nodes = Array.isArray(extra) ? [...extra] : []
  if (game.canIntervene) {
    nodes.push(
      button('귓속말로 개입', {
        cls: '',
        sub: `남은 ${game.interventionsLeft}회 · 화제를 콕 집어주면 반드시 그 얘기를 꺼낸다`,
        onClick: screenIntervene,
      }),
    )
  }
  nodes.push(button('지켜본다', { cls: 'primary', 'data-testid': 'watch', onClick: runStep }))
  panel(nodes)
}

function screenIntervene() {
  const ta = el('textarea', {
    'data-testid': 'whisper',
    placeholder: '예)  지금 강아지 얘기를 꺼내.',
  })
  panel([
    el('h1', { text: '귓속말' }),
    el('p', { class: 'dim', text: '다음 발언 한 번에만 실린다.' }),
    ta,
    button('속삭인다', { cls: 'primary', 'data-testid': 'whisper-go', onClick: () => {
      const r = game.queueIntervention(ta.value)
      turnPrompt(
        r.ok ? [el('div', { class: `notice ${r.backfire ? 'mine' : 'like'}`, text: r.note })] : [],
      )
    } }),
    button('취소', { cls: 'ghost', onClick: () => turnPrompt() }),
  ])
}

async function runStep() {
  panel([thinking('대화가 오가는 중')])
  let entry
  try {
    entry = await game.step()
  } catch (err) {
    panel(errorBox(err, runStep, screenTitle))
    return
  }

  stage.setGauges(game.state.mood, game.state.love)
  stage.getActor('client')?.react(entry.loveDelta > 2 ? 'good' : entry.loveDelta < -2 ? 'bad' : 'idle')
  stage.getActor('target')?.react(entry.loveDelta > 2 ? 'good' : entry.loveDelta < -2 ? 'bad' : 'idle')
  renderHud(game)

  const notices = []
  while (shownNotices < game.notices.length) {
    const n = game.notices[shownNotices++]
    if (n.type === 'discovery') notices.push(noticeBox(n, labelOf))
  }

  const body = [
    dialogueLine('client', game.client.name, entry.clientText),
    verdictRow(entry),
    dialogueLine('target', game.client.target.name, entry.targetText),
    ...notices,
  ]

  if (game.isOver) {
    body.push(button('결과를 기다린다', { cls: 'primary', 'data-testid': 'to-ending', onClick: runFinish }))
    panel(body)
    return
  }
  if (game.stage !== lastPhaseSeen) {
    body.push(button('다음 단계로', { cls: 'primary', 'data-testid': 'next-phase', onClick: screenChat }))
    panel(body)
    return
  }
  turnPromptWith(body)
}

function turnPromptWith(body) {
  const nodes = [...body]
  if (game.canIntervene) {
    nodes.push(button('귓속말로 개입', { sub: `남은 ${game.interventionsLeft}회`, onClick: screenIntervene }))
  }
  nodes.push(button('다음', { cls: 'primary', 'data-testid': 'watch', onClick: runStep }))
  panel(nodes)
}

async function runFinish() {
  panel([thinking('며칠 뒤…')])
  let outcome
  try {
    outcome = await game.finish()
  } catch (err) {
    panel(errorBox(err, runFinish, screenTitle))
    return
  }
  setHud(false)
  const cls = outcome.ending.win ? 'win' : outcome.ending.id === 'pending' ? 'mid' : 'lose'
  panel([
    el('div', { class: `stamp ${cls}`, 'data-testid': 'stamp', text: outcome.ending.stamp }),
    el('p', { class: 'dim', text: `최종 분위기 ${outcome.mood} · 호감 ${outcome.love} · 판정 ${outcome.score} / 통과선 ${outcome.threshold}` }),
    el('div', { class: 'letter', text: outcome.letter }),
    button('다른 의뢰인을 맡는다', { cls: 'primary', onClick: () => {
      shownNotices = 0
      lastPhaseSeen = null
      screenScreening()
    } }),
    button('처음으로', { cls: 'ghost', onClick: screenTitle }),
  ])
}

// ─────────────────────────────────────────── 부팅

async function boot() {
  const canvas = $('#stage')
  stage = createStage(canvas)
  const fit = () => stage.resize()
  fit()
  stage.start()
  addEventListener('resize', fit)
  addEventListener('orientationchange', () => setTimeout(fit, 120))

  // 라벨 표를 UI 쪽에 실어둔다
  const { TOPICS, LANDMINES } = await import('../game/data/topics.js')
  labelOf._map = Object.fromEntries(
    [...Object.entries(TOPICS), ...Object.entries(LANDMINES)].map(([id, t]) => [id, t.label]),
  )

  // 배경에 아무도 없으면 허전하니 기본 두 명을 세워둔다
  syncActors({ client: CLIENTS[0] })

  apiKey = store.get(KEY_STORE)
  model = store.get(MODEL_STORE, DEFAULT_MODEL) || DEFAULT_MODEL

  if (!apiKey) {
    screenKey()
    return
  }
  panel([el('h1', { text: '접속 확인' }), thinking('저장된 키로 연결 확인 중')], { center: true })
  try {
    await verifyKey({ apiKey, model })
    screenTitle()
  } catch (err) {
    screenKey({ error: `저장된 키로 연결하지 못했습니다 — ${err.message}` })
  }
}

// 테스트에서 상태를 들여다볼 수 있게 최소한만 노출한다
globalThis.__rizz = {
  get game() {
    return game
  },
  get stage() {
    return stage
  },
  parseAppearance,
  LlmError,
}

boot()
