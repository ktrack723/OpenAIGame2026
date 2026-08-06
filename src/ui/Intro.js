// ─── 오프닝 — 동화책 × 리듬 게임 ────────────────────────────────
// 이 게임은 규칙이 특이하다: 핵은 행성을 부수지 못하고(밀기만 한다),
// 부수는 건 행성끼리의 충돌뿐이며, 성계 밖으로는 아무것도 나가지 못한다.
// 이걸 HUD 문구로 읽히게 하려던 게 지금까지의 방식인데, 첫 판에서
// 플레이어가 읽어야 할 문장이 너무 많았다. 그래서 **보여준다**.
//
// 형식은 리듬 게임의 튜토리얼 컷신을 빌렸다: 일정한 박에 맞춰 컷이
// 딱딱 넘어가고, 컷마다 그림 하나 + 문장 하나. 박이 있으면 읽는 속도가
// 강제되고, 강제되면 끝까지 읽는다. 그림은 전부 인라인 SVG라 자산이 0개다
// (외부 요청이 막혀 있어도, 오프라인이어도 똑같이 뜬다).
//
// 언제든 건너뛸 수 있다 — 두 번째 판부터는 이게 방해물이므로.

const BEAT = 400          // 한 박(ms). 컷은 4박마다 넘어간다 → 전체 11초
const PANEL_BEATS = 4
const PANEL_MS = BEAT * PANEL_BEATS

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
const PANELS = [
  {
    tag: '옛날 옛적에',
    line: '태양계는 조용했다. 행성들은 저마다의 궤도를 돌고 있었다.',
    art: `<g>
      <circle cx="60" cy="90" r="34" fill="${C.sun}"/>
      <circle cx="60" cy="90" r="52" fill="none" stroke="${C.sun}" stroke-width="2" opacity=".25"/>
      ${planet(150, 70, 9, '#cbd5e1')}
      ${planet(196, 108, 13, C.earth)}
      ${planet(254, 66, 11, '#ff9c6b')}
      ${planet(300, 112, 22, '#fcd34d', C.am)}
      ${planet(360, 74, 8, '#a5f3fc')}
      <text x="196" y="146" fill="${C.earth}" font-size="13" font-weight="800" text-anchor="middle">지구</text>
    </g>`,
  },
  {
    tag: '그러던 어느 날',
    line: '조르그가 왔다. 워프로, 예고도 없이.',
    boom: '쿠웅',
    art: `<g transform="translate(210,86)">
      <circle r="72" fill="none" stroke="${C.zorg}" stroke-width="3" opacity=".5" class="ripple"/>
      <circle r="52" fill="none" stroke="${C.rd}" stroke-width="2" opacity=".4" class="ripple2"/>
      ${zorg(1.05)}
    </g>`,
  },
  {
    tag: '조르그 요새',
    line: '☠ 표식이 붙은 요새가 지구를 겨눈다. 저걸 전부 부숴야 끝난다.',
    boom: '삐—',
    art: `<g>
      ${planet(86, 96, 16, C.earth)}
      <text x="86" y="132" fill="${C.earth}" font-size="12" font-weight="800" text-anchor="middle">지구</text>
      <line x1="330" y1="88" x2="112" y2="94" stroke="${C.rd}" stroke-width="5" opacity=".85" class="beam"/>
      <line x1="330" y1="88" x2="112" y2="94" stroke="#fff" stroke-width="1.5" opacity=".9" class="beam"/>
      ${planet(346, 88, 21, '#7f1d1d', C.rd)}
      ${skull(346, 86, 0.9)}
      <text x="346" y="132" fill="${C.rd}" font-size="12" font-weight="800" text-anchor="middle">조르그 요새</text>
    </g>`,
  },
  {
    tag: '하지만',
    line: '핵으로는 행성을 부술 수 없다. 핵이 하는 일은 **미는 것**뿐이다.',
    boom: '펑!',
    art: `<g>
      <g class="mv"><path d="M120 92 l30 0" stroke="${C.cy}" stroke-width="3" opacity=".5"/>
        <path d="M150 86 l18 6 -18 6 z" fill="#f87171"/></g>
      <circle cx="250" cy="92" r="26" fill="#9aa1a8"/>
      <circle cx="226" cy="92" r="13" fill="#fff3cd" opacity=".9" class="pop"/>
      <g class="mv2">
        <path d="M286 92 l52 0" stroke="${C.am}" stroke-width="6" stroke-linecap="round"/>
        <path d="M338 82 l22 10 -22 10 z" fill="${C.am}"/>
      </g>
      <text x="322" y="72" fill="${C.am}" font-size="13" font-weight="800" text-anchor="middle">밀린다</text>
    </g>`,
  },
  {
    tag: '그러니까',
    line: '행성으로 행성을 쳐라. 당구처럼. 세 번 처박으면 박살난다.',
    boom: '딱!',
    art: `<g>
      <circle cx="120" cy="92" r="20" fill="#9aa1a8"/>
      <path d="M146 92 l40 0" stroke="${C.ink}" stroke-width="3" opacity=".45" stroke-dasharray="7 6"/>
      <circle cx="214" cy="92" r="22" fill="#7f1d1d" stroke="${C.rd}" stroke-width="3"/>
      ${skull(214, 90, 0.72)}
      <g class="pop"><path d="M186 92 l-9 -9 M186 92 l-9 9 M192 78 l-4 -12 M192 106 l-4 12"
         stroke="#fff3cd" stroke-width="4" stroke-linecap="round"/></g>
      <g transform="translate(300,92)">
        <rect x="-46" y="-19" width="92" height="38" rx="6" fill="#0b1826" stroke="${C.rd}" stroke-width="2"/>
        <text x="0" y="6" fill="${C.rd}" font-size="17" font-weight="900" text-anchor="middle">◆◆◆ ×3</text>
      </g>
    </g>`,
  },
  {
    tag: '걱정 마라',
    line: '성계 둘레는 카이퍼 벨트다. 밖으로 나가는 건 없다 — 튕겨서 돌아온다.',
    boom: '텅!',
    art: `<g>
      <path d="M392 4 a150 150 0 0 0 -150 175" fill="none" stroke="${C.cy}" stroke-width="4" opacity=".65"/>
      <path d="M400 0 a162 162 0 0 0 -162 186" fill="none" stroke="#7dd3fc" stroke-width="14" opacity=".14"/>
      <path d="M110 128 l150 -66" stroke="${C.ink}" stroke-width="3" opacity=".45" stroke-dasharray="7 6"/>
      <g class="pop"><circle cx="276" cy="56" r="15" fill="#e0f2fe" opacity=".8"/></g>
      <path d="M270 66 l-140 78" stroke="${C.cy}" stroke-width="5" stroke-linecap="round"/>
      <path d="M130 144 l24 -4 -8 -22 z" fill="${C.cy}"/>
      ${planet(110, 128, 14, '#9aa1a8')}
      <text x="180" y="176" fill="${C.cy}" font-size="13" font-weight="800" text-anchor="middle">속력 그대로, 방향만 바뀐다</text>
    </g>`,
  },
  {
    tag: '자, 시작이다',
    line: '조준 모드에서는 시간이 멈춘다. 천천히 재고, 쏘고, 관측해라.',
    boom: '',
    final: true,
    art: `<g>
      <g transform="translate(96,90)"><rect x="-52" y="-30" width="104" height="60" rx="7"
         fill="#0b1826" stroke="${C.cy}" stroke-width="2"/>
        <text x="0" y="-4" fill="${C.cy}" font-size="14" font-weight="900" text-anchor="middle">◎ 조준</text>
        <text x="0" y="16" fill="${C.dim}" font-size="11" text-anchor="middle">시간 정지</text></g>
      <text x="196" y="96" fill="${C.ink}" font-size="22" font-weight="900" text-anchor="middle">⇄</text>
      <g transform="translate(300,90)"><rect x="-52" y="-30" width="104" height="60" rx="7"
         fill="#0b1826" stroke="${C.am}" stroke-width="2"/>
        <text x="0" y="-4" fill="${C.am}" font-size="14" font-weight="900" text-anchor="middle">▶ 관측</text>
        <text x="0" y="16" fill="${C.dim}" font-size="11" text-anchor="middle">TAB 전환</text></g>
    </g>`,
  },
]

export class Intro {
  constructor(onDone) {
    this.onDone = onDone
    this.i = -1
    this.timer = null
    this.done = false

    const el = document.createElement('div')
    el.className = 'intro'
    el.innerHTML = `
<div class="introbox">
  <div class="introtop">
    <span class="introttl">PLANETPOOL</span>
    <span class="introbeat" id="introBeat"></span>
    <button class="introskip" id="introSkip">건너뛰기 ▶▶</button>
  </div>
  <div class="introframe">
    <svg id="introArt" viewBox="0 0 420 190" preserveAspectRatio="xMidYMid meet"></svg>
    <div class="introboom" id="introBoom"></div>
  </div>
  <div class="introtag" id="introTag"></div>
  <div class="introline" id="introLine"></div>
  <div class="introdots" id="introDots"></div>
</div>`
    document.body.appendChild(el)
    this.el = el
    this.art = el.querySelector('#introArt')
    this.boom = el.querySelector('#introBoom')
    this.tag = el.querySelector('#introTag')
    this.line = el.querySelector('#introLine')
    this.beat = el.querySelector('#introBeat')
    el.querySelector('#introDots').innerHTML = PANELS.map(() => '<i></i>').join('')
    this.dots = [...el.querySelectorAll('#introDots i')]

    el.querySelector('#introSkip').onclick = (e) => { e.stopPropagation(); this.finish() }
    // 아무 데나 눌러도, 아무 키나 눌러도 넘어간다 — 두 번째 판부터는 방해물이다
    this.onKey = (e) => {
      if (e.key === 'Escape' || e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.finish() }
      else this.next()
    }
    el.onclick = () => this.next()
    addEventListener('keydown', this.onKey)
  }

  start() { this.next(); this.pulse() }

  // 박 표시 — 리듬이 눈에 보여야 "다음 컷이 언제 오는지"가 읽힌다
  pulse() {
    if (this.done) return
    this.beatN = (this.beatN ?? -1) + 1
    this.beat.textContent = '●'.repeat((this.beatN % PANEL_BEATS) + 1)
      + '○'.repeat(PANEL_BEATS - (this.beatN % PANEL_BEATS) - 1)
    this.beat.classList.remove('hit')
    void this.beat.offsetWidth
    this.beat.classList.add('hit')
    this.beatTimer = setTimeout(() => this.pulse(), BEAT)
  }

  next() {
    if (this.done) return
    clearTimeout(this.timer)
    this.i++
    if (this.i >= PANELS.length) { this.finish(); return }
    const p = PANELS[this.i]
    this.art.innerHTML = p.art
    this.tag.textContent = p.tag
    // **강조** 를 굵게 — 규칙의 핵심 단어 하나만 눈에 박히면 된다
    this.line.innerHTML = p.line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    this.boom.textContent = p.boom || ''
    this.boom.hidden = !p.boom
    this.dots.forEach((d, k) => d.classList.toggle('on', k <= this.i))
    // 컷이 바뀔 때마다 애니메이션을 되감는다(class 재부착 트릭)
    const box = this.el.querySelector('.introbox')
    box.classList.remove('snap'); void box.offsetWidth; box.classList.add('snap')
    this.el.classList.toggle('final', !!p.final)
    this.timer = setTimeout(() => this.next(), PANEL_MS)
  }

  finish() {
    if (this.done) return
    this.done = true
    clearTimeout(this.timer); clearTimeout(this.beatTimer)
    removeEventListener('keydown', this.onKey)
    this.el.classList.add('out')
    setTimeout(() => this.el.remove(), 420)
    this.onDone?.()
  }
}
