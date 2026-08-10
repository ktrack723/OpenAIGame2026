import { LANGS, getLang, setLang } from '../i18n/index.js'

// ─── 언어 선택 — 판이 열리기 전에 ───────────────────────────────
// 예전에는 언어 버튼이 조준 패널 구석에만 있었다. 그런데 그 패널은
// **예고편과 튜토리얼이 다 끝난 뒤에야** 뜬다 — 즉 처음 오는 사람은
// 자기가 못 읽는 언어로 오프닝 전체를 본 다음에야 언어를 바꿀 수 있었다.
// 그래서 제일 앞으로 끌어냈다. 오프닝보다 먼저 묻는다.
//
// 이 화면에는 **번역할 문장이 없다.** 언어를 못 고른 사람에게 번역된 안내를
// 보여 주는 건 순환이다. 각 언어는 제 이름으로만 적히고(한국어·English·
// 日本語…), 나머지는 기호와 로고뿐이다 — 어느 언어를 쓰든 똑같이 읽힌다.
//
// 브라우저가 짐작한 언어(또는 지난번에 고른 언어)에 미리 커서가 가 있으므로,
// 그대로 맞으면 아무 데나 한 번 누르면 넘어간다.

export class LangPick {
  constructor(onDone) {
    this.onDone = onDone
    this.done = false
    this.i = Math.max(0, LANGS.findIndex(l => l.code === getLang()))

    const el = document.createElement('div')
    el.className = 'langpick'
    el.innerHTML = `
<div class="lpbox">
  <div class="lptop">
    <span class="lpttl">PLANETPOOL</span>
    <span class="lpmark">🌐</span>
  </div>
  <div class="lplist" id="lpList">
    ${LANGS.map((l, k) => `<button class="lpbtn" data-i="${k}" lang="${l.code}">
      <span class="lpname">${l.label}</span><span class="lpcode">${l.code.toUpperCase()}</span>
    </button>`).join('')}
  </div>
  <div class="lphint">▲ ▼ · ENTER</div>
</div>`
    document.body.appendChild(el)
    this.el = el
    this.btns = [...el.querySelectorAll('.lpbtn')]
    for (const b of this.btns) {
      b.onclick = (e) => { e.stopPropagation(); this.choose(+b.dataset.i) }
      b.onpointerenter = () => this.mark(+b.dataset.i)
    }
    // 키보드 — 위아래로 고르고 엔터로 넘어간다. ESC는 지금 언어 그대로.
    this.onKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); this.mark(this.i + 1) }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); this.mark(this.i - 1) }
      else if (e.key === 'Enter' || e.code === 'Space' || e.key === 'Escape') { e.preventDefault(); this.choose(this.i) }
    }
    addEventListener('keydown', this.onKey)
  }

  start() { this.mark(this.i); return this }

  mark(i) {
    this.i = (i + LANGS.length) % LANGS.length
    this.btns.forEach((b, k) => b.classList.toggle('on', k === this.i))
  }

  choose(i) {
    if (this.done) return
    this.done = true
    setLang(LANGS[(i + LANGS.length) % LANGS.length].code)
    removeEventListener('keydown', this.onKey)
    this.el.classList.add('out')
    setTimeout(() => this.el.remove(), 320)
    this.onDone?.()
  }
}
