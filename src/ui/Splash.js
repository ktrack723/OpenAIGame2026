// ─── 오프닝 스플래시 — 6초짜리 예고편 ───────────────────────────
// 튜토리얼(Intro.js)은 규칙을 **가르친다**. 이건 그 앞에 붙어서 규칙을
// 가르치지 않는다 — "이 게임에서 무슨 일이 벌어지는가"를 6초 안에 보여 주고
// 제목을 박고 끝난다. 예고편이지 설명서가 아니다.
//
// 그래서 컷이 짧고(0.75초) 자동으로 넘어간다. 튜토리얼이 손으로 넘기는 것과
// 정반대인데, 의도한 대비다: 여기선 읽을 게 없고 볼 것만 있다.
//
// 자산 0개(인라인 SVG). 아무 데나 누르거나 ESC를 치면 즉시 건너뛴다.
//
// ※ SVG에서 CSS transform 은 transform 속성을 덮어쓴다. 위치용 <g>와
//   애니메이션용 <g>를 반드시 분리한다(Victory.js에서 같은 사고를 냈다).

const CUT = 750      // 컷 하나(ms) — "빠르게빠르게"의 실체
const LOGO = 1700    // 마지막 로고 체류(ms)

const C = {
  cy: '#4fd6f7', rd: '#ff5c6a', am: '#f5b544', gr: '#5ef2a4',
  ink: '#cfe3ef', dim: '#6b8496', earth: '#3b82f6', zorg: '#e879f9',
}

const stars = (n, seed) => Array.from({ length: n }, (_, i) => {
  const x = (i * seed) % 420, y = (i * 61) % 190
  return `<circle cx="${x}" cy="${y}" r=".9" fill="#8fa6bb" opacity="${(0.2 + (i % 4) * 0.15).toFixed(2)}"/>`
}).join('')

const ball = (x, y, r, fill, ring) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>` +
  (ring ? `<circle cx="${x}" cy="${y}" r="${r * 1.24}" fill="none" stroke="${ring}" stroke-width="2" opacity=".8"/>` : '')

const skull = (x, y, s) => `
<g transform="translate(${x},${y}) scale(${s})">
  <circle cx="0" cy="-2" r="13" fill="#fff1f2"/>
  <rect x="-7" y="9" width="14" height="8" rx="3" fill="#fff1f2"/>
  <circle cx="-4.8" cy="-3" r="4" fill="#3a0a11"/><circle cx="4.8" cy="-3" r="4" fill="#3a0a11"/>
</g>`

// ── 컷 여섯 ─────────────────────────────────────────────────────
// 규칙을 설명하지 않는다. 하나씩 "이런 게 된다"만 보여 준다.
const CUTS = [
  {
    cap: '행성으로 행성을 친다',
    art: `${stars(26, 97)}
      <g class="scue">${ball(70, 100, 20, '#9aa1a8', C.cy)}</g>
      <path d="M96 100 h150" stroke="${C.ink}" stroke-width="3" opacity=".3" stroke-dasharray="8 7"/>
      ${ball(288, 96, 26, '#7d8791')}
      <g class="spop"><path d="M262 96 l-14 -14 M262 96 l-14 14 M270 74 l-6 -18 M270 118 l-6 18"
         stroke="#fff3cd" stroke-width="5" stroke-linecap="round"/></g>
      <g class="sfly"><path d="M320 92 l56 -10" stroke="${C.am}" stroke-width="6" stroke-linecap="round"/>
        <path d="M376 72 l22 10 -22 10 z" fill="${C.am}"/></g>`,
  },
  {
    cap: '핵은 부수지 않는다 — 민다',
    art: `${stars(24, 131)}
      <g class="smissile"><path d="M40 104 l40 0" stroke="${C.cy}" stroke-width="3" opacity=".55"/>
        <path d="M80 97 l20 7 -20 7 z" fill="#f87171"/></g>
      ${ball(190, 100, 30, '#9aa1a8')}
      <g class="sflash"><circle cx="162" cy="100" r="17" fill="#fff3cd"/></g>
      <g class="sfly"><path d="M228 100 l62 0" stroke="${C.am}" stroke-width="7" stroke-linecap="round"/>
        <path d="M290 88 l24 12 -24 12 z" fill="${C.am}"/></g>
      <text x="300" y="72" fill="${C.am}" font-size="15" font-weight="900" text-anchor="middle">밀린다</text>`,
  },
  {
    cap: '☠ 조르그 요새를 처박아라',
    art: `${stars(22, 73)}
      <g class="scue2">${ball(64, 112, 22, '#9aa1a8', C.cy)}</g>
      <path d="M92 108 h120" stroke="${C.ink}" stroke-width="3" opacity=".3" stroke-dasharray="8 7"/>
      <g class="sshake">${ball(268, 96, 30, '#7f1d1d', C.rd)}${skull(268, 94, 1)}</g>
      <g class="spop">${Array.from({ length: 10 }, (_, i) => {
      const a = i * 0.63, d = 46 + (i % 3) * 16
      return `<circle cx="${(268 + Math.cos(a) * d).toFixed(0)}" cy="${(96 + Math.sin(a) * d * 0.8).toFixed(0)}"
        r="${3 + (i % 3)}" fill="${C.rd}" opacity=".85"/>`
    }).join('')}</g>`,
  },
  {
    cap: '가스는 터지고, 특이점은 삼킨다',
    art: `${stars(20, 149)}
      <g transform="translate(120,96)">
        <g class="sboom"><circle r="58" fill="none" stroke="${C.am}" stroke-width="5" opacity=".8"/></g>
        ${ball(0, 0, 24, '#fcd34d', C.am)}
      </g>
      <g transform="translate(310,96)">
        <g class="sspin"><circle r="40" fill="none" stroke="${C.zorg}" stroke-width="4"
           stroke-dasharray="6 10" opacity=".8"/></g>
        <circle r="22" fill="#120a1e"/>
        <circle r="23" fill="none" stroke="#a855f7" stroke-width="2" opacity=".7"/>
      </g>
      <g class="ssuck"><circle cx="252" cy="96" r="7" fill="#cbd5e1"/></g>`,
  },
  {
    cap: '레이저는 피하거나 · 막거나 · 요격한다',
    art: `${stars(22, 89)}
      ${ball(384, 44, 20, '#7f1d1d', C.rd)}
      <g class="sbeam"><path d="M368 52 L60 150" stroke="${C.rd}" stroke-width="7" opacity=".85"/>
        <path d="M368 52 L60 150" stroke="#fff" stroke-width="2"/></g>
      <g class="sdodge">${ball(150, 84, 17, C.earth)}</g>
      <g class="sflash2"><circle cx="214" cy="98" r="15" fill="#fff3cd"/></g>
      <text x="150" y="52" fill="${C.earth}" font-size="13" font-weight="800" text-anchor="middle">지구</text>`,
  },
  {
    cap: '시간이 다하면 모성이 온다',
    art: `${stars(18, 113)}
      <g transform="translate(210,95)">
        <g class="sfan">${Array.from({ length: 10 }, (_, i) => {
      const a = i * 0.628
      return `<path d="M0 0 L${(Math.cos(a) * 300).toFixed(0)} ${(Math.sin(a) * 300).toFixed(0)}"
        stroke="${C.zorg}" stroke-width="3" opacity=".5"/>`
    }).join('')}</g>
        <circle r="62" fill="#1a0620"/>
        <circle r="62" fill="none" stroke="${C.zorg}" stroke-width="2" opacity=".5"/>
        <g class="seye"><ellipse rx="24" ry="18" fill="#2b0a33"/>
          <ellipse rx="11" ry="15" fill="${C.zorg}"/><ellipse rx="4" ry="9" fill="#faf5ff"/></g>
      </g>`,
  },
]

// ── 로고 ────────────────────────────────────────────────────────
// 마크는 이 게임 한 줄 요약이다: **궤도(원) 위의 공을 친다.**
// 얇은 궤도 링 + 그 위의 공 + 맞는 순간의 불꽃 + 밀려나는 방향.
const LOGOMARK = `
<svg viewBox="0 0 120 120" class="slogomark" aria-hidden="true">
  <circle cx="60" cy="60" r="46" fill="none" stroke="${C.cy}" stroke-width="2.5" opacity=".45"/>
  <circle cx="60" cy="60" r="46" fill="none" stroke="${C.cy}" stroke-width="2.5"
          stroke-dasharray="18 271" stroke-linecap="round" class="slogotrace"/>
  <circle cx="60" cy="60" r="13" fill="${C.am}" opacity=".16"/>
  <circle cx="60" cy="14" r="9.5" fill="#cfe3ef"/>
  <g class="slogospark">
    <path d="M46 14 l-11 0 M50 5 l-7 -7 M50 23 l-7 7" stroke="${C.am}" stroke-width="3" stroke-linecap="round"/>
  </g>
  <path d="M74 14 l22 0" stroke="${C.am}" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M96 8 l12 6 -12 6 z" fill="${C.am}"/>
</svg>`

export class Splash {
  constructor(onDone) {
    this.onDone = onDone
    this.i = -1
    this.done = false
    this.timer = null

    const el = document.createElement('div')
    el.className = 'splash'
    el.innerHTML = `
<div class="splashbox">
  <div class="splashframe"><svg id="splashArt" viewBox="0 0 420 190" preserveAspectRatio="xMidYMid meet"></svg></div>
  <div class="splashcap" id="splashCap"></div>
  <div class="splashbar"><i id="splashFill"></i></div>
</div>
<div class="splashlogo">
  ${LOGOMARK}
  <div class="slogotitle">PLANETPOOL</div>
  <div class="slogosub">궤도 당구 · ORBITAL BILLIARDS</div>
</div>
<button class="splashskip" id="splashSkip">건너뛰기 (ESC)</button>`
    document.body.appendChild(el)
    this.el = el
    this.art = el.querySelector('#splashArt')
    this.cap = el.querySelector('#splashCap')
    this.fill = el.querySelector('#splashFill')

    el.querySelector('#splashSkip').onclick = (e) => { e.stopPropagation(); this.finish() }
    el.onclick = () => this.finish()
    this.onKey = (e) => { e.preventDefault(); this.finish() }
    addEventListener('keydown', this.onKey)
  }

  start() { this.next(); return this }

  next() {
    if (this.done) return
    this.i++
    if (this.i >= CUTS.length) return this.showLogo()
    const c = CUTS[this.i]
    this.art.innerHTML = c.art
    this.cap.textContent = c.cap
    this.fill.style.width = `${((this.i + 1) / (CUTS.length + 1)) * 100}%`
    // 컷마다 애니메이션을 되감는다(class 재부착 트릭 — Intro.js와 같은 수법)
    const box = this.el.querySelector('.splashbox')
    box.classList.remove('snap'); void box.offsetWidth; box.classList.add('snap')
    this.timer = setTimeout(() => this.next(), CUT)
  }

  showLogo() {
    this.el.classList.add('logo')
    this.fill.style.width = '100%'
    this.timer = setTimeout(() => this.finish(), LOGO)
  }

  finish() {
    if (this.done) return
    this.done = true
    clearTimeout(this.timer)
    removeEventListener('keydown', this.onKey)
    this.el.classList.add('out')
    setTimeout(() => this.el.remove(), 420)
    this.onDone?.()
  }
}
