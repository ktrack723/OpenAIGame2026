import { t, onLangChange } from '../i18n/index.js'
import { CFG } from '../game/config.js'
import { buy, rows } from '../game/shop.js'
// ─── 과학연구실 화면 ────────────────────────────────────────────
// 정치자금을 쓰는 자리다. 승리 화면(Victory.js)에서 떼어냈다 — 거긴 "이겼다"는
// 감상이고 여긴 "다음 판을 어떻게 준비할까"라는 판단이라, 성격이 다른 둘을
// 같은 패널에 두면 축하는 서두르게 되고 구매는 대충 지나치게 된다.
//
// 테마는 관제실이 아니라 연구실이다: 청사진 격자, 진열대 위의 시료 플라스크,
// 스캔 중인 홀로그램 도표. 상점 규칙 자체는 game/shop.js 한 벌뿐이고
// (buy·rows), 여기는 그걸 그리고 누른 값을 넘기기만 한다.
//
// 여기서 "다음 침공까지 평화를 즐긴다" 버튼을 누르면 그제서야 다음 판이 열린다
// — 정치자금을 다 쓰기 전에 실수로 판이 넘어가는 일이 없도록, 이 화면이
// 그 버튼의 새 자리다.

const LC = { cy: '#4fd6f7', am: '#f5b544', gr: '#5ef2a4' }

// 시료 플라스크 — 안에서 거품이 올라온다. x는 중심, liq는 액체 색.
const flask = (x, liq, delays) => `
<g transform="translate(${x},0)">
  <path d="M-7 8 L-7 -20 L-13 -34 L13 -34 L7 -20 L7 8 Z" fill="none" stroke="#2c5468" stroke-width="1.6"/>
  <path d="M-6.4 6 L-6.4 -14 Q0 -18 6.4 -14 L6.4 6 Z" fill="${liq}" opacity=".55"/>
  <rect x="-14" y="-38" width="28" height="5" rx="1.5" fill="#0f2536"/>
  ${delays.map((d, i) => `<circle class="labbubble" cx="${-3 + i * 3}" cy="0" r="${1.6 - i * 0.2}"
    fill="${liq}" style="animation-delay:${d}s"/>`).join('')}
</g>`

export class Lab {
  constructor(game, onContinue) {
    this.game = game
    this.onContinue = onContinue
    const el = document.createElement('div')
    el.className = 'lab'
    el.hidden = true
    el.innerHTML = `
<div class="labbox">
  <div class="labart">
    <svg viewBox="0 0 460 210" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="labgrid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#123246" stroke-width="1"/>
        </pattern>
      </defs>
      <!-- 청사진 격자 벽 -->
      <rect x="0" y="0" width="460" height="126" fill="#050d18"/>
      <rect x="0" y="0" width="460" height="126" fill="url(#labgrid)" opacity=".55"/>
      <!-- 스캔 중인 장비 홀로그램 -->
      <g transform="translate(230,62)">
        <circle r="42" fill="none" stroke="${LC.cy}" stroke-width="1.2" opacity=".35"/>
        <circle r="30" fill="none" stroke="${LC.cy}" stroke-width="1" opacity=".5"/>
        <circle r="18" fill="none" stroke="${LC.cy}" stroke-width="1" opacity=".7" class="labring"/>
        <circle cx="0" cy="-42" r="3" fill="${LC.am}"/>
        <circle cx="36" cy="21" r="3" fill="${LC.gr}"/>
        <circle cx="-36" cy="21" r="3" fill="${LC.cy}"/>
        <g class="labscan"><line x1="0" y1="0" x2="0" y2="-42" stroke="${LC.cy}" stroke-width="1.4" opacity=".8"/></g>
      </g>
      <text x="230" y="118" fill="#7dd8f0" font-size="11" font-weight="800" text-anchor="middle">${t('lab.status')}</text>
      <!-- 진단 갠트리 — 작업대 위를 오가며 시료를 훑는다 -->
      <g transform="translate(230,100)"><g class="labgantry">
        <rect x="-3" y="0" width="6" height="18" fill="#12283a"/>
        <rect x="-10" y="16" width="20" height="6" rx="2" fill="${LC.cy}" opacity=".85"/>
      </g></g>
      <!-- 작업대 -->
      <rect x="0" y="120" width="460" height="8" fill="#12283a"/>
      <rect x="0" y="126" width="460" height="84" fill="#0a1522"/>
      <rect x="16" y="176" width="428" height="10" rx="3" fill="#12283a"/>
      <g transform="translate(0,170)">
        ${flask(110, LC.cy, [0, .6, 1.1])}
        ${flask(230, LC.am, [.3, .9, 1.4])}
        ${flask(350, LC.gr, [.15, .75, 1.25])}
      </g>
    </svg>
  </div>
  <div class="labtext">
    <div class="labtag" id="labTag"></div>
    <h2 id="labTitle"></h2>
    <p id="labBody"></p>
    <div class="shop" id="labShop">
      <div class="shophead"><span id="shopTitle"></span><b id="shopBal"></b></div>
      <div class="shoprows" id="shopRows"></div>
    </div>
  </div>
  <button class="labbtn" id="labGo">
    <span class="labbtnt" id="labGoT"></span>
    <span class="labbtns" id="labGoSub"></span>
  </button>
</div>`
    document.body.appendChild(el)
    this.el = el
    el.querySelector('#labGo').onclick = () => this.close()
    // 상점 클릭은 위임으로 받는다 — 진열대가 open()마다 다시 그려지므로
    // 각 버튼에 핸들러를 매다는 것보다 이쪽이 안전하다(언어 전환도 다시 그린다).
    el.querySelector('#shopRows').onclick = (e) => {
      const btn = e.target.closest('button[data-buy]')
      if (!btn || btn.disabled) return
      if (buy(this.game, btn.dataset.buy)) this.renderShop()
    }
    this.onKey = (e) => {
      if (el.hidden) return
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.close() }
    }
    addEventListener('keydown', this.onKey)
    onLangChange(() => { if (!this.el.hidden) this.open() })
  }

  open() {
    this.el.querySelector('#labTag').textContent = t('lab.tag')
    this.el.querySelector('#labTitle').textContent = t('lab.title')
    this.el.querySelector('#labBody').textContent = t('lab.body')
    this.el.querySelector('#labGoT').textContent = t('lab.go')
    this.el.querySelector('#labGoSub').textContent = t('lab.goSub')
    this.renderShop()
    this.el.hidden = false
    this.el.classList.remove('out')
  }

  // 진열대. **게임 상태에서 매번 새로 그린다** — 하나 사면 잔액도 재고도
  // 바뀌므로 부분 갱신할 것이 없고, 언어를 바꾸면 open()이 통째로 다시 부른다.
  renderShop() {
    const g = this.game
    this.el.querySelector('#shopTitle').textContent = t('shop.title')
    this.el.querySelector('#shopBal').textContent = t('shop.balance', { n: g.pol })
    this.el.querySelector('#shopRows').innerHTML = rows(g).map((r) => {
      // 못 사는 이유를 버튼이 직접 말한다. 회색으로만 두면 고장난 버튼이 된다.
      const label = r.why === 'full' ? t('shop.full') : t('shop.cost', { n: CFG.SHOP_COST })
      return `<button class="shopitem" data-buy="${r.id}"${r.enabled ? '' : ' disabled'}>
<span class="shopname">${t(`shop.${r.id}`)}<i>${t(`shop.${r.id}.brief`)}</i></span>
<span class="shopmeta"><b>${r.have}/${r.max}</b><em>${label}</em></span>
</button>`
    }).join('')
  }

  close() {
    if (this.el.hidden) return
    this.el.classList.add('out')
    setTimeout(() => { this.el.hidden = true; this.el.classList.remove('out') }, 380)
    this.onContinue?.()
  }
}
