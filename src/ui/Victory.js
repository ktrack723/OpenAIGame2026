import { t, onLangChange } from '../i18n/index.js'
// ─── 승리 화면 ──────────────────────────────────────────────────
// "다음 스테이지 ▶" 버튼 하나로 넘어가던 걸 축하 장면으로 바꿨다.
// 이 게임의 판돈은 지구이고, 판을 이겼다는 건 인류가 한 번 더 살아남았다는
// 뜻이다. 그 사실을 버튼 라벨이 아니라 그림으로 보여 준다.
//
// 그림은 전부 인라인 SVG(자산 0개). 관제실에서 환호하는 과학자 셋과
// 살아남은 지구, 그리고 창밖으로 물러가는 조르그 잔해.
//
// 여기는 **전멸 축하만** 한다. 정치자금을 쓰는 일(상점)은 별개의 화면
// (Lab.js · 과학연구실 테마)로 떼어냈다 — 하나는 "이겼다"는 감상이고 다른
// 하나는 "다음 판을 어떻게 준비할까"라는 판단이라, 같은 패널에 욱여넣으면
// 둘 다 흐려진다. 버튼을 누르면 onContinue가 그 연구실을 연다.

const C = { cy: '#4fd6f7', am: '#f5b544', gr: '#5ef2a4', ink: '#cfe3ef', dim: '#6b8496' }

// 환호하는 과학자 — 팔을 든 실루엣 셋. 각자 다른 박으로 뛴다.
//
// ※ 위치용 <g>와 애니메이션용 <g>를 **반드시 분리한다.** SVG에서 CSS의
//   transform 은 transform 속성을 덮어쓰기 때문에, 한 요소에 둘을 같이 주면
//   점프 애니메이션이 translate(x,0)을 지워 셋이 전부 x=0으로 겹쳐 버린다.
//   (실제로 그렇게 짰다가 화면 왼쪽 끝에 한 명만 보였다.)
const scientist = (x, cls, coat, skin) => `
<g transform="translate(${x},0)"><g class="${cls}">
  <path d="M-16 62 q0 -34 16 -34 q16 0 16 34 z" fill="${coat}"/>
  <circle cx="0" cy="16" r="11" fill="${skin}"/>
  <path d="M0 6 q-11 -2 -12 6 q12 -5 12 -1 q0 -4 12 1 q-1 -8 -12 -6z" fill="#2b2b33"/>
  <path d="M-13 34 l-13 -22" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
  <path d="M13 34 l13 -22" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>
  <rect x="-9" y="40" width="18" height="3" rx="1.5" fill="#0b1826" opacity=".5"/>
</g></g>`

// 승리 패널을 올리기까지 기다리는 실시간(ms).
// 패배 화면(hud.js의 OVER_DELAY = 2200)과 같은 이유다 — 마지막 요새가 터지는
// 순간에 패널이 덮어 버리면 자기가 **어떻게** 이겼는지를 못 본다. 그동안 판은
// 이미 멈춰 있고(won → effTimeScale 0) 파티클만 실시간으로 돈다.
// 패배보다는 짧게 잡았다: 지구 화구는 크고 오래 남지만 요새 하나가 부서지는
// 건 그보다 빨리 잦아든다.
//
// 1500 → 1900. 조르그는 이제 **두 박자로** 터진다(빛기둥 0.45초 → 폭발).
// 마지막 요새를 부수는 순간 won이 되므로, 예전 값이면 폭발이 채 피기도 전에
// 패널이 덮었다 — 이 게임의 마지막 그림을 패널이 가리는 셈이다.
const OPEN_DELAY = 1900

export class Victory {
  constructor(game, onContinue) {
    this.game = game
    this.onContinue = onContinue
    this.shown = false
    this.armedAt = undefined
    const el = document.createElement('div')
    el.className = 'victory'
    el.hidden = true
    el.innerHTML = `
<div class="vicbox">
  <div class="vicart">
    <svg viewBox="0 0 460 210" preserveAspectRatio="xMidYMid meet">
      <!-- 관제실 창 너머의 성계 -->
      <rect x="0" y="0" width="460" height="126" fill="#050d18"/>
      <circle cx="392" cy="30" r="26" fill="${C.am}" opacity=".85"/>
      <circle cx="392" cy="30" r="40" fill="none" stroke="${C.am}" stroke-width="1.5" opacity=".3"/>
      <circle cx="300" cy="66" r="13" fill="#3b82f6"/>
      <circle cx="300" cy="66" r="20" fill="none" stroke="#60a5fa" stroke-width="1.5" opacity=".55" class="vpulse"/>
      <text x="300" y="98" fill="#93c5fd" font-size="11" font-weight="800" text-anchor="middle">${t('vic.earthSafe')}</text>
      <!-- 물러가는 조르그 잔해 -->
      <g opacity=".65" class="vdrift">
        <circle cx="96" cy="40" r="9" fill="#4a1240"/>
        <path d="M78 40 l-26 -8 M80 47 l-24 6" stroke="#7f1d3a" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="140" cy="24" r="5" fill="#3a0f33"/>
      </g>
      <!-- 창틀 -->
      <rect x="0" y="120" width="460" height="8" fill="#12283a"/>
      <rect x="0" y="126" width="460" height="84" fill="#0a1522"/>
      <!-- 콘솔 -->
      <rect x="16" y="176" width="428" height="10" rx="3" fill="#12283a"/>
      <g transform="translate(0,120)">
        ${scientist(110, 'vsci a', '#e8eef5', '#f2c49b')}
        ${scientist(196, 'vsci b', '#dbe7f2', '#c98d63')}
        ${scientist(282, 'vsci c', '#eef3f8', '#8d5f42')}
      </g>
      <!-- 축포 -->
      <g class="vconfetti">
        ${Array.from({ length: 22 }, (_, i) => {
    const x = 40 + (i * 379 / 21), y = 128 + ((i * 37) % 46)
    const col = [C.cy, C.am, C.gr, '#ff8fa3'][i % 4]
    // 회전(속성)과 낙하(CSS)를 같은 요소에 주면 서로 덮어쓴다 — 한 겹 감싼다
    return `<g transform="rotate(${(i * 47) % 90} ${x} ${y})"><rect x="${x}" y="${y}"
      width="4" height="7" rx="1" fill="${col}" style="animation-delay:${(i % 7) * 0.13}s"/></g>`
  }).join('')}
      </g>
    </svg>
  </div>
  <div class="victext">
    <div class="victag" id="vicTag"></div>
    <h2 id="vicTitle"></h2>
    <p id="vicBody"></p>
    <div class="vicstats" id="vicStats"></div>
  </div>
  <button class="vicbtn" id="vicGo">
    <span class="vicbtnt" id="vicGoT"></span>
    <span class="vicbtns" id="vicGoSub"></span>
  </button>
</div>`
    document.body.appendChild(el)
    this.el = el
    el.querySelector('#vicGo').onclick = () => this.close()
    this.onKey = (e) => {
      if (el.hidden) return
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.close() }
    }
    addEventListener('keydown', this.onKey)
    // 언어를 바꿨을 때 **떠 있는 창**도 같이 바뀐다. 그림(SVG)은 한 번 만들고
    // 마는 것이라 통째로 다시 짓고, 숫자가 든 줄은 open()이 어차피 다시 쓴다.
    onLangChange(() => { if (!this.el.hidden) this.open() })
  }

  // 이긴 순간 main 루프가 걸어 둔다. 실제로 뜨는 건 OPEN_DELAY 뒤다.
  arm() { if (this.armedAt === undefined) this.armedAt = performance.now() }
  disarm() { this.armedAt = undefined; this.shown = false }
  tick() {
    if (this.shown || this.armedAt === undefined) return
    if (performance.now() - this.armedAt < OPEN_DELAY) return
    this.shown = true
    this.open()
  }

  open() {
    const g = this.game
    const survivors = g.bodies.filter(b => b.alive && b.type !== 'debris').length
    this.el.querySelector('#vicTag').textContent = t('vic.tag', { stage: g.stage })
    this.el.querySelector('#vicTitle').textContent = t('vic.title')
    this.el.querySelector('#vicBody').textContent = t('vic.body')
    this.el.querySelector('#vicGoT').textContent = t('vic.go')
    this.el.querySelector('#vicGoSub').textContent = t('vic.goSub')
    this.el.querySelector('#vicStats').innerHTML = [
      [t('vic.row.forts'), t('vic.row.forts.v', { n: g.goal.total })],
      [t('vic.row.time'), `${Math.floor(g.timeLeft / 60)}:${String(Math.floor(g.timeLeft % 60)).padStart(2, '0')}`],
      [t('vic.row.alive'), t('vic.row.alive.v', { n: survivors })],
      [t('vic.row.earth'), t('vic.row.earth.v', { hp: g.earth.hp, hpMax: g.earth.hpMax })],
    ].map(([k, v]) => `<div class="vicrow"><span>${k}</span><b>${v}</b></div>`).join('')
    this.el.hidden = false
    this.el.classList.remove('out')
  }

  close() {
    if (this.el.hidden) return
    this.el.classList.add('out')
    setTimeout(() => { this.el.hidden = true; this.el.classList.remove('out') }, 380)
    this.onContinue?.()
  }
}
