// 이 파일에는 이미 t(표적)와 tr(표적 반지름)이라는 지역 변수가 있다.
// 번역 함수는 그 둘과 안 부딪히게 loc으로 받는다.
import { t as loc, nameOf } from '../i18n/index.js'
import * as THREE from 'three'

// 목표와 지구를 한눈에: **이름표 하나와 화면 밖 방향 화살표 하나씩.**
// "조르그 행성이 어딘지 모르겠다"를 없애는 게 이 파일의 유일한 목적이고,
// 그 목적에 필요한 최소가 이 둘이다.
//
// 예전엔 여기서 회전하는 코너 브래킷(레티클)도 같이 그렸는데, 표적 하나에
// 표시가 넷이 붙어 있었다 — 분홍으로 맥동하는 테두리, 해골 배지, 이름표,
// 그리고 레티클. 같은 말을 네 번 하는 것이라 레티클을 걷었다.

const LABEL_H = 26   // 라벨 표시 높이(CSS px) — 줌과 무관하게 일정하게 유지

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
    this.targetArrow = arrowMesh(0x22d3ee); this.earthArrow = arrowMesh(0x60a5fa)
    scene.add(this.targetArrow, this.earthArrow)
    this.names = { target: null, earth: null }
    this.t = 0
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
    arrow.visible = !inside && body.alive
    if (arrow.visible) {
      const cx = Math.max(x0, Math.min(x1, body.pos.x)), cy = Math.max(y0, Math.min(y1, body.pos.y))
      const s = 26 * ppw
      arrow.position.set(cx, cy, 8)
      arrow.scale.set(s, s, 1)
      arrow.rotation.z = Math.atan2(body.pos.y - cy, body.pos.x - cx)
      arrow.material.opacity = 0.6 + 0.35 * Math.sin(this.t * 6)
    }
  }

  // 화면에서 통째로 걷는다 — 판이 열리는 순간과 예고편 도입부는 성계만 보인다.
  hide() {
    for (const o of [this.targetLabel, this.earthLabel, this.targetArrow, this.earthArrow])
      if (o) o.visible = false
  }

  update(game, rig, dt, radiusOfRender) {
    this.t += dt
    if (game.bare) return this.hide()
    for (const o of [this.targetLabel, this.earthLabel, this.targetArrow, this.earthArrow])
      if (o) o.visible = true
    const t = game.target, e = game.earth
    const nAlive = game.aliveTargets
    // 세로 화면에서는 이름표가 화면 폭을 넘긴다. 그때는 "남은 요새 n"을 뺀다 —
    // 같은 숫자가 작전 줄(0/2)에 이미 크게 떠 있다.
    const suffix = game.targets.length > 1 && innerWidth >= 520 ? loc('mark.left', { n: nAlive }) : ''
    const thp = t.hp ?? 3, tmax = t.hpMax ?? 3
    // 본성(◈)은 광선을 쥔 요새다 — 표적이 그놈이면 이름 옆에 박아 둔다
    const home = t === game.homeworld ? loc('mark.home') : ''
    this.setLabel('target', loc('mark.target', { name: nameOf(t), home, hp: thp, hpMax: tmax, suffix }), '#ffc9cf', 'rgba(58,10,17,.92)')
    this.setLabel('earth', loc('mark.earth', { hp: game.earth.hp ?? 3, hpMax: game.earth.hpMax ?? 3 }), '#bfdbfe', 'rgba(23,37,84,.92)')

    const tr = radiusOfRender(t), er = radiusOfRender(e)
    this.place(this.targetLabel, this.targetArrow, t, rig, tr)
    this.place(this.earthLabel, this.earthArrow, e, rig, er)
  }
}
