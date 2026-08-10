import { CFG, hitRadiusOf } from '../game/config.js'
import { ROLES, effDv, massClass, modsOf, roleBrief, roleLabel, volatileRadius } from '../game/roles.js'
import { t, nameOf } from '../i18n/index.js'
import { categoryOf, hostileMark } from '../render/Icons.js'

// ─── 천체 정보창 ────────────────────────────────────────────────
// 마우스를 올리거나(데스크톱) 손가락으로 짚으면(모바일) 그 공의 제원이 뜬다.
// 판 위에 공이 스무 개가 깔리면서 "저건 뭐고 몇 대 더 때려야 하나"를
// 색과 링만으로 읽히게 하는 건 불가능해졌다 — 그 답을 여기서 준다.
//
// 좌표 변환은 CameraRig.screenToWorld 하나만 쓴다(카메라가 z=0 평면을
// 겨냥하고 있으므로 그 함수가 곧 정확한 역투영이다).

const fmt = (n, d = 0) => n.toFixed(d)

export class Inspector {
  constructor(game, rig, dom) {
    this.game = game; this.rig = rig
    this.el = document.createElement('div')
    this.el.className = 'inspect'
    this.el.hidden = true
    document.body.appendChild(this.el)
    this.pin = null        // 터치로 고정한 천체 id
    this.hover = null
    this.sx = 0; this.sy = 0

    // 마우스: 움직이는 동안 그 아래 천체를 물어본다.
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return
      this.sx = e.clientX; this.sy = e.clientY
      this.hover = this.pick(e.clientX, e.clientY)
    })
    dom.addEventListener('pointerleave', () => { this.hover = null })
    // 터치/펜: 짚은 자리의 천체를 고정한다. 빈 곳을 짚으면 닫는다.
    // (드래그는 카메라 패닝이므로 rig.dragged가 켜지면 무시한다.)
    dom.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') return
      if (this.rig.dragged) return
      const b = this.pick(e.clientX, e.clientY)
      this.sx = e.clientX; this.sy = e.clientY
      this.pin = b && this.pin !== b.id ? b.id : null
    })
  }

  // 화면 좌표 → 그 자리의 천체. 손가락이 굵으므로 최소 히트 반경을 px로 준다.
  pick(sx, sy) {
    const w = this.rig.screenToWorld(sx, sy)
    const ppw = this.rig.worldPerPx
    const slack = 16 * ppw               // 터치 여유 (판정에는 영향 없음)
    let best = null, bestD = Infinity
    for (const b of this.game.bodies) {
      if (!b.alive) continue
      const d = Math.hypot(b.pos.x - w.x, b.pos.y - w.y)
      const R = Math.max(this.renderRadius ? this.renderRadius(b) : hitRadiusOf(b), 0) + slack
      if (d > R || d > bestD) continue
      bestD = d; best = b
    }
    return best
  }

  bind(renderRadius) { this.renderRadius = renderRadius }

  // 표시할 천체 — 고정(터치)이 우선, 없으면 호버
  current() {
    if (this.pin) {
      const b = this.game.bodies.find(o => o.id === this.pin && o.alive)
      if (b) return b
      this.pin = null
    }
    return this.hover && this.hover.alive ? this.hover : null
  }

  rows(b) {
    const cat = categoryOf(b.type)
    const g = this.game
    const r = Math.hypot(b.pos.x, b.pos.y)
    const v = Math.hypot(b.vel.x, b.vel.y)
    const hostile = b.role === 'battery' || b.role === 'hive'
    const hp = b.hp ?? CFG.PLANET_HP, hpMax = b.hpMax ?? CFG.PLANET_HP
    const pips = '◆'.repeat(Math.max(0, hp)) + '◇'.repeat(Math.max(0, hpMax - hp))
    const out = []
    // 태그 줄 — 다섯 중 붙은 것만. 하나도 없으면 "일반 행성"이라고 못 박는다.
    const tags = []
    if (hostile) { const m = hostileMark(b); tags.push(['foe', `${m.icon} ${m.label}`]) }
    for (const key of [b.role, ...modsOf(b)]) {
      if (!key || key === 'battery' || key === 'hive') continue
      const R = ROLES[key]
      if (R) tags.push(['tag', `${R.icon} ${roleLabel(key)}`])
    }
    out.push(`<div class="ihead"><span class="iicon">${cat.icon}</span><b>${nameOf(b)}</b>`
      + (b.isEarth ? `<span class="ibadge earth">${t('insp.earth')}</span>` : '')
      + '</div>')
    out.push(`<div class="itags">${tags.length
      ? tags.map(([c, t]) => `<span class="ibadge ${c}">${t}</span>`).join('')
      : `<span class="ibadge plain">${t('insp.plain')}</span>`}</div>`)
    // 분류의 메카닉을 한 줄로 못 박는다 — "이 분류가 게임에서 뭘 하는가"
    out.push(`<div class="isub" style="color:${cat.color}">${cat.label} · ${cat.mech}</div>`)
    out.push(`<div class="irow"><span>${t('insp.hp')}</span><b class="${hp <= 1 ? 'crit' : ''}">${pips} ${hp}/${hpMax}</b></div>`)
    // 무게 등급 — 태그와 무관하게 모든 행성이 갖는 성질. 밀 수 있는가에 대한 답.
    const mc = massClass(b)
    out.push(`<div class="irow"><span>${t('insp.mass')}</span><b style="color:${mc.color}">${mc.label}</b></div>`)
    out.push(`<div class="irow"><span>${t('insp.mu')}</span><b>${fmt(b.mu)}</b></div>`)
    out.push(`<div class="irow"><span>${t('insp.radius')}</span><b>${fmt(b.radius, 1)} / ${fmt(hitRadiusOf(b), 1)} GU</b></div>`)
    out.push(`<div class="irow"><span>${t('insp.orbit')}</span><b>${fmt(r)} GU</b></div>`)
    out.push(`<div class="irow"><span>${t('insp.speed')}</span><b>${fmt(v, 1)} GU/s</b></div>`)
    // 이 공을 지금 작약량으로 치면 얼마나 밀리는가 — 조준의 유일한 근거.
    // **반드시 effDv를 쓴다.** 식을 다시 쓰면 태그 감쇠(금속 ×0.5 · 특이점 ×0)가
    // 빠져서, 같은 창 세 줄 아래의 role.armor.brief("임펄스가 50%만 먹는다")와
    // role.void.brief("핵도 안 통하고")를 이 숫자가 부정하게 된다.
    // 예측선(aim.js)·실제 임펄스(physics.js)도 같은 함수를 쓴다.
    const dv = effDv(b, g.yieldMt)
    out.push(`<div class="irow"><span>${t('insp.dv', { yield: g.yieldMt })}</span><b>${fmt(dv, 1)} GU/s</b></div>`)
    for (const key of [b.role, ...modsOf(b)]) {
      const R = ROLES[key]
      if (!R) continue
      const hex = `#${R.color.toString(16).padStart(6, '0')}`
      out.push(`<div class="irole" style="color:${hex}">${R.icon} ${roleLabel(key)} — ${roleBrief(key)}</div>`)
      // 요새의 나머지 설명은 **그 요새가 실제로 그럴 때만** 붙인다.
      // 대형은 2판부터, 추진기는 3판부터 온다 — 1판에서 그 둘을 미리 읽히면
      // 지금 필요한 한 줄("한 번 처박으면 끝난다")이 그 안에 묻힌다.
      if (key === 'battery') {
        if (hpMax > 1) out.push(`<div class="irole" style="color:${hex}">${t('role.battery.heavy')}</div>`)
        if (b.boost > 0) out.push(`<div class="irole" style="color:${hex}">${t('role.battery.boost')}</div>`)
      }
    }
    if (b.role === 'volatile') out.push(`<div class="irow"><span>${t('insp.volatileR')}</span><b>${fmt(volatileRadius(b))} GU</b></div>`)
    out.push(`<div class="ifoot">${b.isEarth
      ? t('insp.foot.earth')
      : hostile ? t('insp.foot.foe', { hp: hpMax }) : t('insp.foot.cue', { hint: mc.hint })}</div>`)
    return out.join('')
  }

  update() {
    // 판이 열리는 순간과 예고편 도입부에는 아무 창도 안 뜬다
    const b = this.game.bare ? null : this.current()
    if (!b) { if (!this.el.hidden) this.el.hidden = true; return }
    if (this.el._id !== b.id || this.el._hp !== b.hp || this.el._yld !== this.game.yieldMt) {
      this.el._id = b.id; this.el._hp = b.hp; this.el._yld = this.game.yieldMt
      this.el.innerHTML = this.rows(b)
    }
    this.el.hidden = false
    this.el.classList.toggle('pinned', !!this.pin)
    // 커서 오른쪽 아래에 붙이되 화면 밖으로 넘치지 않게 접는다
    const w = this.el.offsetWidth || 240, h = this.el.offsetHeight || 180
    const x = this.sx + 18 + w > innerWidth ? this.sx - w - 18 : this.sx + 18
    const y = this.sy + 14 + h > innerHeight ? Math.max(6, this.sy - h - 14) : this.sy + 14
    this.el.style.left = `${Math.max(6, x)}px`
    this.el.style.top = `${y}px`
  }
}
