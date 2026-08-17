// DOM 조립 헬퍼. 화면은 전부 여기서 만들고, 흐름은 main.js 가 잡는다.

export const $ = (sel, root = document) => root.querySelector(sel)

export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v
    else if (k === 'html') node.innerHTML = v
    else if (k === 'text') node.textContent = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  }
  return node
}

// 나머지 옵션(data-testid 등)은 그대로 속성으로 넘긴다.
// 예전에는 알려진 키만 받아서 data-testid 가 조용히 사라졌다 — E2E 가 버튼을 못 찾았다.
export function button(label, { sub, cls = '', onClick, disabled, ...attrs } = {}) {
  return el(
    'button',
    { class: `btn ${cls}`, onclick: onClick, disabled: disabled || undefined, type: 'button', ...attrs },
    el('span', { text: label }),
    sub ? el('span', { class: 'sub', text: sub }) : null,
  )
}

/** 하단(또는 가운데) 패널을 통째로 갈아끼운다. */
export function panel(nodes, { center = false } = {}) {
  const p = $('#panel')
  p.className = center ? 'center' : ''
  p.replaceChildren(...[nodes].flat().filter(Boolean))
  p.scrollTop = 0
  // 패널 높이가 바뀌면 3D 프레이밍도 다시 잡아야 한다(무대가 이 이벤트를 듣는다)
  queueMicrotask(() => dispatchEvent(new CustomEvent('rizz:panel')))
  return p
}

export function thinking(label = '생각하는 중') {
  return el(
    'div',
    { class: 'thinking' },
    el('span', { class: 'dots' }, el('i'), el('i'), el('i')),
    el('span', { text: label }),
  )
}

export function setHud(on) {
  $('#hud').className = on ? 'on' : ''
}

const pct = (v) => `${Math.max(0, Math.min(100, v))}%`

export function renderHud(game) {
  const hud = $('#hud')
  const found = [...game.dossier.revealed]
  const likes = found.filter((id) => game.dossier.likes.includes(id))
  const mines = found.filter((id) => game.dossier.mines.includes(id))

  hud.replaceChildren(
    el(
      'div',
      { class: 'gauges' },
      gauge('분위기', game.state.mood, 'mood'),
      gauge('호감', game.state.love, 'love'),
    ),
    el(
      'div',
      { class: 'hudline' },
      el('span', { text: `${game.phase?.label ?? ''}  ${game.turn}/${game.phase?.turns ?? 0}` }),
      el('span', {
        class: 'pips',
        text: '◆'.repeat(game.interventionsLeft) +
          '◇'.repeat(Math.max(0, (game.phase?.interventions ?? 0) - game.interventionsLeft)),
      }),
    ),
    likes.length || mines.length
      ? el(
          'div',
          { class: 'found' },
          ...likes.map((id) => el('span', { class: 'chip like', text: `+ ${game.labelOf(id)}` })),
          ...mines.map((id) => el('span', { class: 'chip mine', text: `! ${game.labelOf(id)}` })),
        )
      : null,
  )

  function gauge(name, value, kind) {
    return el(
      'div',
      { class: 'gauge' },
      el(
        'div',
        { class: 'lab' },
        el('span', { text: name }),
        el('span', { class: 'val', text: String(Math.round(value)) }),
      ),
      el('div', { class: 'track' }, el('div', { class: `fill ${kind}`, style: `width:${pct(value)}` })),
    )
  }
}

export function dialogueLine(who, name, text) {
  return el(
    'div',
    { class: `line ${who}` },
    el('div', { class: 'name', text: name }),
    el('div', { class: 'bubble', text }),
  )
}

export function verdictRow(entry) {
  const d = (n, label) =>
    el(
      'span',
      {},
      `${label} `,
      el('span', {
        class: `delta ${n >= 0 ? 'up' : 'down'}`,
        text: n >= 0 ? `▲${n}` : `▼${Math.abs(n)}`,
      }),
    )
  return el(
    'div',
    { class: 'verdict' },
    el('span', { text: entry.reason }),
    entry.moodDelta !== 0 ? d(entry.moodDelta, '분위기') : null,
    entry.loveDelta !== 0 ? d(entry.loveDelta, '호감') : null,
    el('span', { text: `×${entry.moodMul}` }),
  )
}

export function noticeBox(found, labelOf) {
  return el('div', { class: `notice ${found.isMine ? 'mine' : 'like'}` },
    found.isMine
      ? `⚠ 지뢰 포착 — ${found.label} (${found.how}) · 앞으로 이 얘기는 피해야 한다.`
      : `✦ 취향 포착 — ${found.label} (${found.how}) · 개입해서 알려주지 않으면 의뢰인은 쓰지 못한다.`,
  )
}

export function errorBox(err, onRetry, onBack) {
  return [
    el('div', { class: 'notice err' },
      el('div', { html: `<strong>모델 연결이 끊겼습니다.</strong>` }),
      el('div', { class: 'tiny', text: err?.message ?? String(err) }),
    ),
    el('p', { class: 'dim', text: '이 게임은 오프라인 모드가 없습니다. 연결이 회복돼야 이어서 진행할 수 있습니다.' }),
    onRetry ? button('다시 시도', { cls: 'primary', onClick: onRetry }) : null,
    onBack ? button('처음으로', { cls: 'ghost', onClick: onBack }) : null,
  ]
}

/** 입력 지연 실행 — 타이핑할 때마다 모델을 다시 세우면 버벅인다. */
export function debounce(fn, ms = 220) {
  let t = 0
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
