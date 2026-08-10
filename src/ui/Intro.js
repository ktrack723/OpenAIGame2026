import { t } from '../i18n/index.js'
// ─── 오프닝 — 동화책 × 리듬 게임 ────────────────────────────────
// 이 게임은 규칙이 특이하다: 핵은 행성을 부수지 못하고(밀기만 한다),
// 부수는 건 행성끼리의 충돌뿐이며, 성계 밖으로는 아무것도 나가지 못한다.
// 이걸 HUD 문구로 읽히게 하려던 게 지금까지의 방식인데, 첫 판에서
// 플레이어가 읽어야 할 문장이 너무 많았다. 그래서 **보여준다**.
//
// 형식은 리듬 게임의 튜토리얼 컷신을 빌렸다: 컷마다 그림 하나 + 문장 하나,
// 박(BEAT) 표시가 리듬을 잡아 준다. 다만 **넘기는 건 사람이 한다**(아래 참조).
// 그림은 전부 인라인 SVG라 자산이 0개다
// (외부 요청이 막혀 있어도, 오프라인이어도 똑같이 뜬다).
//
// 언제든 건너뛸 수 있다 — 두 번째 판부터는 이게 방해물이므로.

// 컷은 **자동으로 넘어가지 않는다.** 읽는 속도는 사람마다 다르고, 넘어가는
// 타이밍을 기계가 정하면 못 읽은 컷이 반드시 생긴다. 박(BEAT)은 리듬을 보여주는
// 장식으로만 남기고, 진행은 전적으로 누르는 사람이 정한다.
const BEAT = 400          // 한 박(ms) — 박 표시와 컷 전환 애니메이션의 기준
const BEAT_DOTS = 4       // 박 표시 점 개수(한 마디)

// 공통 팔레트 — 본편 HUD와 같은 색을 써야 "같은 게임"으로 읽힌다
const C = {
  cy: '#4fd6f7', rd: '#ff5c6a', am: '#f5b544', ink: '#cfe3ef',
  earth: '#3b82f6', sun: '#ffc861', zorg: '#a21caf', dim: '#6b8496',
}

// ── 조르그 ──────────────────────────────────────────────────────
// 눈 셋에 촉수를 단 자주색 외계인. 마스코트가 있어야 "적이 있다"가
// 정보가 아니라 감정이 된다. 눈은 박에 맞춰 깜빡인다.
const zorg = (scale = 1) => `
<g transform="translate(0,4) scale(${scale})">
  <ellipse cx="0" cy="34" rx="30" ry="16" fill="#2a0a3a"/>
  <path d="M-26 30 q-14 12 -6 24 M-12 34 q-8 16 2 26 M12 34 q8 16 -2 26 M26 30 q14 12 6 24"
        stroke="${C.zorg}" stroke-width="7" fill="none" stroke-linecap="round"/>
  <ellipse cx="0" cy="0" rx="34" ry="38" fill="${C.zorg}"/>
  <ellipse cx="-9" cy="-10" rx="20" ry="22" fill="#c026d3" opacity=".55"/>
  <g class="zeye">
    <ellipse cx="0" cy="-4" rx="13" ry="15" fill="#0b0212"/>
    <ellipse cx="0" cy="-6" rx="6" ry="7" fill="${C.rd}"/>
    <ellipse cx="-19" cy="4" rx="7" ry="8" fill="#0b0212"/>
    <ellipse cx="-19" cy="3" rx="3" ry="3.5" fill="${C.rd}"/>
    <ellipse cx="19" cy="4" rx="7" ry="8" fill="#0b0212"/>
    <ellipse cx="19" cy="3" rx="3" ry="3.5" fill="${C.rd}"/>
  </g>
  <path d="M-14 20 q14 9 28 0" stroke="#3b0a4a" stroke-width="4" fill="none" stroke-linecap="round"/>
</g>`

const planet = (x, y, r, fill, ring) => `
<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>
${ring ? `<ellipse cx="${x}" cy="${y}" rx="${r * 1.8}" ry="${r * 0.5}" fill="none" stroke="${ring}" stroke-width="3" opacity=".8"/>` : ''}`

const skull = (x, y, s) => `
<g transform="translate(${x},${y}) scale(${s})">
  <circle cx="0" cy="-2" r="15" fill="#fff1f2"/>
  <rect x="-8" y="10" width="16" height="9" rx="3" fill="#fff1f2"/>
  <circle cx="-5.5" cy="-3" r="4.5" fill="#3a0a11"/><circle cx="5.5" cy="-3" r="4.5" fill="#3a0a11"/>
  <rect x="-2" y="4" width="4" height="5" rx="1.5" fill="#3a0a11"/>
</g>`

// ── 컷 목록 ─────────────────────────────────────────────────────
// 규칙 하나에 컷 하나. 이 순서가 곧 이 게임을 배우는 순서다.
// **함수다.** 그림 안에도 글자가 있는데(지구·조르그 요새·밀린다…), 표를
// 모듈이 뜨는 순간 한 번만 읽어 두면 그 글자만 옛 언어로 굳는다 —
// 언어 선택이 오프닝 앞으로 나온 지금은 그게 곧 처음 보는 화면이다.
const panels = () => [
  {
    key: 'intro.1',
    art: `<g>
      <circle cx="60" cy="90" r="34" fill="${C.sun}"/>
      <circle cx="60" cy="90" r="52" fill="none" stroke="${C.sun}" stroke-width="2" opacity=".25"/>
      ${planet(150, 70, 9, '#cbd5e1')}
      ${planet(196, 108, 13, C.earth)}
      ${planet(254, 66, 11, '#ff9c6b')}
      ${planet(300, 112, 22, '#fcd34d', C.am)}
      ${planet(360, 74, 8, '#a5f3fc')}
      <text x="196" y="146" fill="${C.earth}" font-size="13" font-weight="800" text-anchor="middle">${t('intro.earth')}</text>
    </g>`,
  },
  {
    key: 'intro.2',
    art: `<g transform="translate(210,86)">
      <circle r="72" fill="none" stroke="${C.zorg}" stroke-width="3" opacity=".5" class="ripple"/>
      <circle r="52" fill="none" stroke="${C.rd}" stroke-width="2" opacity=".4" class="ripple2"/>
      ${zorg(1.05)}
    </g>`,
  },
  {
    key: 'intro.3',
    art: `<g>
      ${planet(86, 96, 16, C.earth)}
      <text x="86" y="132" fill="${C.earth}" font-size="12" font-weight="800" text-anchor="middle">${t('intro.earth')}</text>
      <line x1="330" y1="88" x2="112" y2="94" stroke="${C.rd}" stroke-width="5" opacity=".85" class="beam"/>
      <line x1="330" y1="88" x2="112" y2="94" stroke="#fff" stroke-width="1.5" opacity=".9" class="beam"/>
      ${planet(346, 88, 21, '#7f1d1d', C.rd)}
      ${skull(346, 86, 0.9)}
      <text x="346" y="132" fill="${C.rd}" font-size="12" font-weight="800" text-anchor="middle">${t('intro.3.foe')}</text>
    </g>`,
  },
  {
    key: 'intro.4',
    art: `<g>
      <g class="mv"><path d="M120 92 l30 0" stroke="${C.cy}" stroke-width="3" opacity=".5"/>
        <path d="M150 86 l18 6 -18 6 z" fill="#f87171"/></g>
      <circle cx="250" cy="92" r="26" fill="#9aa1a8"/>
      <circle cx="226" cy="92" r="13" fill="#fff3cd" opacity=".9" class="pop"/>
      <g class="mv2">
        <path d="M286 92 l52 0" stroke="${C.am}" stroke-width="6" stroke-linecap="round"/>
        <path d="M338 82 l22 10 -22 10 z" fill="${C.am}"/>
      </g>
      <text x="322" y="72" fill="${C.am}" font-size="13" font-weight="800" text-anchor="middle">${t('intro.4.push')}</text>
    </g>`,
  },
  {
    key: 'intro.5',
    art: `<g>
      <circle cx="120" cy="92" r="20" fill="#9aa1a8"/>
      <path d="M146 92 l40 0" stroke="${C.ink}" stroke-width="3" opacity=".45" stroke-dasharray="7 6"/>
      <circle cx="214" cy="92" r="22" fill="#7f1d1d" stroke="${C.rd}" stroke-width="3"/>
      ${skull(214, 90, 0.72)}
      <g class="pop"><path d="M186 92 l-9 -9 M186 92 l-9 9 M192 78 l-4 -12 M192 106 l-4 12"
         stroke="#fff3cd" stroke-width="4" stroke-linecap="round"/></g>
      <g transform="translate(300,92)">
        <rect x="-46" y="-19" width="92" height="38" rx="6" fill="#0b1826" stroke="${C.rd}" stroke-width="2"/>
        <text x="0" y="6" fill="${C.rd}" font-size="16" font-weight="900" text-anchor="middle">${t('intro.5.hp')}</text>
      </g>
    </g>`,
  },
  {
    key: 'intro.6',
    art: `<g>
      <path d="M392 4 a150 150 0 0 0 -150 175" fill="none" stroke="${C.cy}" stroke-width="4" opacity=".65"/>
      <path d="M400 0 a162 162 0 0 0 -162 186" fill="none" stroke="#7dd3fc" stroke-width="14" opacity=".14"/>
      <path d="M110 128 l150 -66" stroke="${C.ink}" stroke-width="3" opacity=".45" stroke-dasharray="7 6"/>
      <g class="pop"><circle cx="276" cy="56" r="15" fill="#e0f2fe" opacity=".8"/></g>
      <path d="M270 66 l-140 78" stroke="${C.cy}" stroke-width="5" stroke-linecap="round"/>
      <path d="M130 144 l24 -4 -8 -22 z" fill="${C.cy}"/>
      ${planet(110, 128, 14, '#9aa1a8')}
      <text x="180" y="176" fill="${C.cy}" font-size="13" font-weight="800" text-anchor="middle">${t('intro.6.note')}</text>
    </g>`,
  },
  {
    key: 'intro.7',
    boom: '',
    final: true,
    art: `<g>
      <g transform="translate(96,90)"><rect x="-52" y="-30" width="104" height="60" rx="7"
         fill="#0b1826" stroke="${C.cy}" stroke-width="2"/>
        <text x="0" y="-4" fill="${C.cy}" font-size="14" font-weight="900" text-anchor="middle">${t('intro.7.aim')}</text>
        <text x="0" y="16" fill="${C.dim}" font-size="11" text-anchor="middle">${t('intro.7.aim.sub')}</text></g>
      <text x="196" y="96" fill="${C.ink}" font-size="22" font-weight="900" text-anchor="middle">⇄</text>
      <g transform="translate(300,90)"><rect x="-52" y="-30" width="104" height="60" rx="7"
         fill="#0b1826" stroke="${C.am}" stroke-width="2"/>
        <text x="0" y="-4" fill="${C.am}" font-size="14" font-weight="900" text-anchor="middle">${t('intro.7.obs')}</text>
        <text x="0" y="16" fill="${C.dim}" font-size="11" text-anchor="middle">${t('intro.7.obs.sub')}</text></g>
    </g>`,
  },
]

export class Intro {
  constructor(onDone) {
    this.onDone = onDone
    this.i = -1
    this.done = false
    this.panels = panels()   // 지금 언어로 굽는다

    const el = document.createElement('div')
    el.className = 'intro'
    el.innerHTML = `
<div class="introbox">
  <div class="introtop">
    <span class="introttl">PLANETPOOL</span>
    <span class="introbeat" id="introBeat"></span>
    <button class="introskip" id="introSkip">${t('intro.skip')}</button>
  </div>
  <div class="introframe">
    <svg id="introArt" viewBox="0 0 420 190" preserveAspectRatio="xMidYMid meet"></svg>
    <div class="introboom" id="introBoom"></div>
  </div>
  <div class="introtag" id="introTag"></div>
  <div class="introline" id="introLine"></div>
  <div class="intronext">${t('intro.next')}</div>
  <div class="introdots" id="introDots"></div>
</div>`
    document.body.appendChild(el)
    this.el = el
    this.art = el.querySelector('#introArt')
    this.boom = el.querySelector('#introBoom')
    this.tag = el.querySelector('#introTag')
    this.line = el.querySelector('#introLine')
    this.beat = el.querySelector('#introBeat')
    el.querySelector('#introDots').innerHTML = this.panels.map(() => '<i></i>').join('')
    this.dots = [...el.querySelectorAll('#introDots i')]

    el.querySelector('#introSkip').onclick = (e) => { e.stopPropagation(); this.finish() }
    // 아무 데나 눌러야 다음 컷으로 간다. ESC는 통째로 건너뛰기.
    this.onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.finish() }
      else { e.preventDefault(); this.next() }
    }
    el.onclick = () => this.next()
    addEventListener('keydown', this.onKey)
  }

  start() { this.next(); this.pulse() }

  // 박 표시 — 리듬이 눈에 보여야 "다음 컷이 언제 오는지"가 읽힌다
  pulse() {
    if (this.done) return
    this.beatN = (this.beatN ?? -1) + 1
    const k = this.beatN % BEAT_DOTS
    this.beat.textContent = '●'.repeat(k + 1) + '○'.repeat(BEAT_DOTS - k - 1)
    this.beat.classList.remove('hit')
    void this.beat.offsetWidth
    this.beat.classList.add('hit')
    this.beatTimer = setTimeout(() => this.pulse(), BEAT)
  }

  next() {
    if (this.done) return
    this.i++
    if (this.i >= this.panels.length) { this.finish(); return }
    const p = this.panels[this.i]
    this.art.innerHTML = p.art
    this.tag.textContent = t(`${p.key}.tag`)
    // **강조** 를 굵게 — 규칙의 핵심 단어 하나만 눈에 박히면 된다
    this.line.innerHTML = t(`${p.key}.line`).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    // boom 키가 없는 컷도 있다(①·⑦). t()는 못 찾으면 키를 그대로 주므로
    // "키가 보이는" 사고를 막으려면 여기서 한 번 걸러야 한다.
    const boomKey = `${p.key}.boom`, boom = t(boomKey)
    this.boom.textContent = boom === boomKey ? '' : boom
    this.boom.hidden = boom === boomKey
    this.dots.forEach((d, k) => d.classList.toggle('on', k <= this.i))
    // 컷이 바뀔 때마다 애니메이션을 되감는다(class 재부착 트릭)
    const box = this.el.querySelector('.introbox')
    box.classList.remove('snap'); void box.offsetWidth; box.classList.add('snap')
    this.el.classList.toggle('final', !!p.final)
  }

  finish() {
    if (this.done) return
    this.done = true
    clearTimeout(this.beatTimer)
    removeEventListener('keydown', this.onKey)
    this.el.classList.add('out')
    setTimeout(() => this.el.remove(), 420)
    this.onDone?.()
  }
}
