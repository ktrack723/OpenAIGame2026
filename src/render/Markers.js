// 이 파일에는 이미 t(표적)라는 지역 변수가 있다.
// 번역 함수는 그것과 안 부딪히게 loc으로 받는다.
import { t as loc } from '../i18n/index.js'
import { CFG } from '../game/config.js'
import * as THREE from 'three'

// 목표와 지구를 한눈에: **이름표 둘과, 화면 밖으로 나간 것들의 방향 화살표.**
// "조르그 행성이 어딘지 모르겠다"를 없애는 게 이 파일의 유일한 목적이다.
//
// 이름표는 둘뿐이다(지금 물고 있는 표적 하나 + 지구). 요새가 여덟이면
// 이름표도 여덟이 되어 판이 글자로 덮인다.
// 화살표는 **살아 있는 위협 전부**(요새와 모함)에 하나씩 붙는다. 화면 밖에
// 뭐가 몇 개 남았는지는 방향만 있으면 읽히고, 그게 이 게임에서 제일 자주
// 필요한 정보다.
//
// 색으로 편을 가른다: 지구는 파랑, 조르그 요새는 붉은색, 모함은 자주. 예전엔 시안과 하늘색이라
// 화면 가장자리에서 둘이 구분되지 않았다 — 표적 테두리(#f43f5e)와 같은 색을
// 쓰면 화살표가 가리키는 쪽에 뭐가 있는지가 색 하나로 끝난다.
//
// 예전엔 여기서 회전하는 코너 브래킷(레티클)도 같이 그렸는데, 표적 하나에
// 표시가 넷이 붙어 있었다 — 분홍으로 맥동하는 테두리, 해골 배지, 이름표,
// 그리고 레티클. 같은 말을 네 번 하는 것이라 레티클을 걷었다.

const LABEL_H = 26   // 라벨 표시 높이(CSS px) — 줌과 무관하게 일정하게 유지
// 화살표 크기(CSS px). 26이던 것을 절반으로 줄였다 — 요새 여덟 기가 전부
// 화면 밖으로 나가면 그 큰 삼각형들이 가장자리를 두르고 앉아 정작 판을 가렸다.
// 방향을 알리는 데 필요한 건 이만큼이다.
const ARROW_PX = 13
const EARTH_TONE = 0x60a5fa   // 지구 — 파랑(공 테두리와 같은 색)
const FOE_TONE = 0xf43f5e     // 조르그 요새 — 붉은색(표적 테두리와 같은 색)
const HIVE_TONE = 0xe879f9    // 조르그 모함 — 자주(배지와 같은 색). 요새와 갈린다
const HIVE_SCALE = 1.5        // 모함 화살표만 조금 크다 — 저건 다른 물건이다

function labelSprite(text, color, bg) {
  const dpr = Math.min(3, devicePixelRatio || 1)
  const pad = 12, fs = 26
  const c = document.createElement('canvas'), g = c.getContext('2d')
  g.font = `800 ${fs}px Inter, system-ui, Apple SD Gothic Neo, Malgun Gothic, sans-serif`
  const w = Math.ceil(g.measureText(text).width) + pad * 2, h = fs + pad * 2
  c.width = w * dpr; c.height = h * dpr
  g.scale(dpr, dpr)
  g.font = `800 ${fs}px Inter, system-ui, Apple SD Gothic Neo, Malgun Gothic, sans-serif`
  g.textBaseline = 'middle'
  g.fillStyle = bg
  g.beginPath(); g.roundRect(1, 1, w - 2, h - 2, 12); g.fill()
  g.strokeStyle = color; g.lineWidth = 2.5; g.stroke()
  g.fillStyle = color
  g.fillText(text, pad, h / 2 + 1)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }))
  sp.userData.px = { w: w * (LABEL_H / h), h: LABEL_H }   // 캔버스는 고해상도, 표시는 26px 높이로
  sp.renderOrder = 20
  return sp
}

function arrowMesh(color) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    1.0, 0, 0, -0.7, 0.62, 0, -0.35, 0, 0,
    1.0, 0, 0, -0.35, 0, 0, -0.7, -0.62, 0,
  ]), 3))
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  }))
  m.renderOrder = 21
  return m
}

export class Markers {
  constructor(scene) {
    this.scene = scene
    this.targetLabel = null; this.earthLabel = null
    this.earthArrow = arrowMesh(EARTH_TONE)
    scene.add(this.earthArrow)
    this.foeArrows = new Map()   // 요새 id → 화살표 (살아 있는 요새 하나당 하나)
    this.names = { target: null, earth: null }
    this.t = 0
  }

  // 위협 하나의 화살표. 처음 보는 것이면 만들어 두고 그 뒤로는 재사용한다.
  foeArrow(b) {
    let a = this.foeArrows.get(b.id)
    if (!a) {
      a = arrowMesh(b.role === 'hive' ? HIVE_TONE : FOE_TONE)
      a.userData.scale = b.role === 'hive' ? HIVE_SCALE : 1
      this.scene.add(a); this.foeArrows.set(b.id, a)
    }
    return a
  }

  // 성계에서 사라진 요새의 화살표를 걷는다(부서졌거나 다음 판으로 넘어갔거나).
  reap(live) {
    for (const [id, a] of this.foeArrows) {
      if (live.has(id)) continue
      this.scene.remove(a); a.geometry.dispose(); a.material.dispose()
      this.foeArrows.delete(id)
    }
  }

  setLabel(key, text, color, bg) {
    if (this.names[key] === text) return
    this.names[key] = text
    const old = key === 'target' ? this.targetLabel : this.earthLabel
    if (old) { this.scene.remove(old); old.material.map.dispose(); old.material.dispose() }
    const sp = labelSprite(text, color, bg)
    this.scene.add(sp)
    if (key === 'target') this.targetLabel = sp; else this.earthLabel = sp
  }

  // 화면 밖이면 (HUD에 가리지 않는) 테두리에 화살표, 안이면 라벨을 천체 위에 띄운다
  place(label, arrow, body, rig, rRender) {
    const ppw = rig.worldPerPx, pad = 40 * ppw
    const v = rig.visibleRect()
    const x0 = v.x0 + pad, x1 = v.x1 - pad, y0 = v.y0 + pad, y1 = v.y1 - pad
    const inside = body.pos.x > x0 && body.pos.x < x1 && body.pos.y > y0 && body.pos.y < y1
    if (label) {
      label.visible = inside && body.alive
      if (label.visible) {
        const { w, h } = label.userData.px
        label.scale.set(w * ppw, h * ppw, 1)
        // 이름표는 **화면 안으로 밀어 넣는다.** 공에 그냥 붙여 두면 공이
        // 가장자리에 있을 때 스프라이트 절반이 화면 밖으로 나가 글자가 잘렸다
        // (세로 화면에서는 이름표가 화면보다 넓어 양쪽이 다 잘렸다).
        // 이름표가 보이는 영역보다도 넓으면 밀어 봐야 소용없으니 가운데에 둔다.
        const half = w * ppw / 2 + 8 * ppw   // 8px는 가장자리에 딱 붙지 않게 두는 숨통
        const lx = 2 * half >= v.x1 - v.x0 ? (v.x0 + v.x1) / 2
          : Math.max(v.x0 + half, Math.min(v.x1 - half, body.pos.x))
        // 세로도 같이 가둔다 — 공이 패널 코앞에 있으면 이름표가 패널 뒤로
        // 반쯤 들어가 읽히지 않았다.
        const vpad = h * ppw * 0.6
        const ly = Math.max(v.y0 + vpad, Math.min(v.y1 - vpad, body.pos.y + rRender * 2.3 + h * ppw * 0.7))
        label.position.set(lx, ly, 8)
      }
    }
    arrow.visible = !inside && body.alive && !(body.warpIn > 0)
    if (arrow.visible) {
      const cx = Math.max(x0, Math.min(x1, body.pos.x)), cy = Math.max(y0, Math.min(y1, body.pos.y))
      const s = ARROW_PX * (arrow.userData.scale ?? 1) * ppw
      arrow.position.set(cx, cy, 8)
      arrow.scale.set(s, s, 1)
      arrow.rotation.z = Math.atan2(body.pos.y - cy, body.pos.x - cx)
      arrow.material.opacity = 0.6 + 0.35 * Math.sin(this.t * 6)
    }
  }

  // 화면에서 통째로 걷는다 — 판이 열리는 순간과 예고편 도입부는 성계만 보인다.
  hide() {
    for (const o of [this.targetLabel, this.earthLabel, this.earthArrow]) if (o) o.visible = false
    for (const a of this.foeArrows.values()) a.visible = false
  }

  update(game, rig, dt, radiusOfRender) {
    this.t += dt
    if (game.bare) return this.hide()
    for (const o of [this.targetLabel, this.earthLabel, this.earthArrow]) if (o) o.visible = true
    const t = game.target, e = game.earth
    // ── 이름표는 **체력만** 말한다 ──
    // 예전에는 "☠ 표적 Zorg Mogul-1 · 체력 1/1 (남은 요새 2)"였다. 그 안에서
    // 매 순간 달라지는 값은 체력 하나뿐이고, 나머지는 화면이 이미 말하고 있다:
    // 무엇인가는 해골·이름표 색이, 몇 기 남았는가는 작전 줄(0/2)이, 이름은
    // 공을 짚으면 뜨는 정보창이 말한다. 판 위에 문장이 길게 누워 있으면 정작
    // 그 밑의 공과 궤도가 안 보인다.
    this.setLabel('target', loc('mark.target', {
      hp: t.hp ?? CFG.PLANET_HP, hpMax: t.hpMax ?? CFG.PLANET_HP,
    }), '#ffc9cf', 'rgba(58,10,17,.92)')
    this.setLabel('earth', loc('mark.earth', {
      hp: e.hp ?? CFG.PLANET_HP, hpMax: e.hpMax ?? CFG.PLANET_HP,
    }), '#bfdbfe', 'rgba(23,37,84,.92)')

    // ── 화살표는 살아 있는 요새 전부 ──
    // 이름표는 지금 물고 있는 하나뿐이지만, 화면 밖에 남은 요새가 몇 기이고
    // 어느 쪽에 있는지는 전부 보여 준다. 아직 워프해 들어오지 않은 증원은
    // 아직 성계에 없는 것이므로 세지 않는다(place가 걸러 낸다).
    const forts = game.bodies.filter(b => b.alive && game.isTarget(b))
    this.reap(new Set(forts.map(b => b.id)))
    for (const b of forts) {
      this.place(b === t ? this.targetLabel : null, this.foeArrow(b), b, rig, radiusOfRender(b))
    }
    this.place(this.earthLabel, this.earthArrow, e, rig, radiusOfRender(e))
    // 요새가 하나도 안 남았으면(=클리어) 이름표는 마지막 표적 자리에 그대로 둔다
    if (!forts.includes(t) && this.targetLabel) this.targetLabel.visible = false
  }
}
