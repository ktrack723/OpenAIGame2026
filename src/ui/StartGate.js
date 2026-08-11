// ─── 시작 화면 — 소리가 열리는 자리 ─────────────────────────────
//
// 브라우저는 사람이 무언가를 누르기 전에는 소리를 못 내게 막는다. 그리고 그
// 허락은 **제스처 핸들러 안에서** 받아야 한다 — 나중에 받으려 하면 이미
// 늦었다(iOS 사파리는 특히 그렇다).
//
// 그래서 판 앞에 화면을 하나 더 세운다. 이 화면이 하는 일은 하나뿐이다:
// 누군가 눌렀다는 사실을 만드는 것. 그 손끝에서 AudioContext가 열리고,
// 같은 순간 Tone과 three가 같은 컨텍스트를 받는다(audio/engine.js).
//
// ── 왜 언어 선택보다 앞인가 ──
// 언어 선택 화면(LangPick)에도 누르는 자리는 있다. 거기서 열어도 되기는
// 한다. 그런데 그 화면은 **읽는 화면**이다 — 다섯 언어를 훑어보다가
// 고르는 데 몇 초가 걸리고, 그동안 화면은 조용하다. 소리가 있는 게임인지
// 아닌지를 그 침묵으로 판단해 버리면 그건 우리 손해다.
// 시작 화면은 반대다. 누를 것이 하나뿐이고, 누르는 순간 음악이 시작된다.
//
// ── 글자가 영어인 이유 ──
// 언어를 아직 안 골랐다. 못 읽는 언어로 "시작하려면 누르세요"를 보여 주는
// 건 순환이다(LangPick 주석과 같은 이유). 그래서 여기 있는 글자는
// 로고와 "CLICK TO START" 뿐이고, 나머지는 기호로 말한다.

const MARK = `
<svg viewBox="0 0 120 120" class="sgmark" aria-hidden="true">
  <circle cx="60" cy="60" r="46" fill="none" stroke="#4fd6f7" stroke-width="2.5" opacity=".35"/>
  <circle cx="60" cy="60" r="46" fill="none" stroke="#4fd6f7" stroke-width="2.5"
          stroke-dasharray="20 269" stroke-linecap="round" class="sgtrace"/>
  <circle cx="60" cy="60" r="14" fill="#f5b544" opacity=".18"/>
  <circle cx="60" cy="14" r="9.5" fill="#cfe3ef"/>
  <path d="M74 14 l22 0" stroke="#f5b544" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M96 8 l12 6 -12 6 z" fill="#f5b544"/>
</svg>`

export class StartGate {
  // onStart는 **동기로** 불린다. 그 안에서 AudioContext를 열어야 하기 때문에
  // 여기서 await를 걸거나 다음 프레임으로 미루면 안 된다.
  constructor(onStart) {
    this.onStart = onStart
    this.done = false

    const el = document.createElement('div')
    el.className = 'startgate'
    el.innerHTML = `
<div class="sgbox">
  ${MARK}
  <div class="sgtitle">PLANETPOOL</div>
  <div class="sgcta" id="sgCta">CLICK TO START</div>
  <div class="sgnote">
    <svg viewBox="0 0 26 24" class="sgspk" aria-hidden="true">
      <path d="M3 9.5h4.2L12.6 5v14L7.2 14.5H3z" fill="currentColor"/>
      <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
        <path d="M16.4 9.2a4.7 4.7 0 0 1 0 5.6"/><path d="M19.6 6.6a8.6 8.6 0 0 1 0 10.8"/>
      </g>
    </svg>
    <span class="sgkeys">M</span>
  </div>
</div>`
    document.body.appendChild(el)
    this.el = el

    // pointerdown으로 받는다 — click은 손을 뗄 때 오므로 그만큼 늦고,
    // 무엇보다 모바일에서 300ms 지연이 붙는 경우가 있다.
    // M만 예외다 — 아래 안내가 알려 주는 그 키다. 여기서 "아무 키나"로
    // 먹어 버리면, 소리를 미리 꺼 두려고 M을 누른 사람이 대신 게임을 시작하게 된다.
    // (그리고 소리는 아직 열리지도 않았으니 끌 것도 없다 — audio/index.js 참고.)
    this.onDown = (ev) => { ev.preventDefault(); this.go() }
    this.onKey = (ev) => { if (ev.key === 'm' || ev.key === 'M') return; ev.preventDefault(); this.go() }
    el.addEventListener('pointerdown', this.onDown)
    addEventListener('keydown', this.onKey)
  }

  start() { return this }

  go() {
    if (this.done) return
    this.done = true
    this.el.removeEventListener('pointerdown', this.onDown)
    removeEventListener('keydown', this.onKey)
    // ① 소리부터. 이 호출이 제스처 안에 있어야 한다는 것이 이 화면의 존재 이유다.
    try { this.onStart?.() } catch { /* 소리가 안 열려도 게임은 시작해야 한다 */ }
    // ② 그다음에 화면을 걷는다.
    this.el.classList.add('out')
    setTimeout(() => this.el.remove(), 380)
  }
}
