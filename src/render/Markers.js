import * as THREE from 'three'
import { hasRole } from '../game/roles.js'

// 목표/지구를 한눈에: 라벨 + 조준 레티클 + 화면 밖 방향 화살표 + 발사 회랑.
// "조르그 행성이 어딘지 모르겠다"를 없애는 게 이 파일의 유일한 목적이다.

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

// 4개 코너 브래킷 — 회전하며 목표를 물고 있는 조준 레티클
function reticle(color) {
  const grp = new THREE.Group()
  for (let i = 0; i < 4; i++) {
    const geo = new THREE.RingGeometry(0.9, 1, 24, 1, i * Math.PI / 2 + 0.32, Math.PI / 2 - 0.64)
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }))
    m.renderOrder = 19
    grp.add(m)
  }
  return grp
}

export class Markers {
  constructor(scene) {
    this.scene = scene
    this.targetLabel = null; this.earthLabel = null
    this.targetArrow = arrowMesh(0x22d3ee); this.earthArrow = arrowMesh(0x60a5fa)
    this.reticles = []            // 목표가 둘 이상인 안테가 있다 — 전부 물어준다
    this.corridor = null
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
        label.position.set(body.pos.x, body.pos.y + rRender * 2.3 + h * ppw * 0.7, 8)
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

  update(game, rig, dt, radiusOfRender) {
    this.t += dt
    const t = game.target, e = game.earth
    const nAlive = game.aliveTargets
    const suffix = game.targets.length > 1 ? ` (남은 요새 ${nAlive})` : ''
    const thp = t.hp ?? 3, tmax = t.hpMax ?? 3
    // 본성(◈)은 광선을 쥔 요새다 — 표적이 그놈이면 이름 옆에 박아 둔다
    const home = t === game.homeworld ? ' ◈본성' : ''
    this.setLabel('target', `☠ 표적  ${t.name}${home} · 체력 ${thp}/${tmax}${suffix}`, '#ffc9cf', 'rgba(58,10,17,.92)')
    this.setLabel('earth', `◉ 지구 · 발사대 (체력 ${game.earth.hp ?? 3}/${game.earth.hpMax ?? 3})`, '#bfdbfe', 'rgba(23,37,84,.92)')

    const tr = radiusOfRender(t), er = radiusOfRender(e)
    this.place(this.targetLabel, this.targetArrow, t, rig, tr)
    this.place(this.earthLabel, this.earthArrow, e, rig, er)

    // 레티클 — 목표마다 하나씩. 반경의 2.1배에서 천천히 회전 + 맥동
    const tone = 0xf43f5e
    game.targets.forEach((b, i) => {
      if (!this.reticles[i]) { this.reticles[i] = reticle(tone); this.scene.add(this.reticles[i]) }
      const grp = this.reticles[i]
      grp.visible = b.alive
      if (!b.alive) return
      const s = radiusOfRender(b) * (2.1 + 0.16 * Math.sin(this.t * 3))
      grp.position.set(b.pos.x, b.pos.y, 6)
      grp.scale.set(s, s, 1)
      grp.rotation.z = this.t * 0.6
      for (const m of grp.children) {
        m.material.color.setHex(tone)
        m.material.opacity = 0.55 + 0.4 * Math.abs(Math.sin(this.t * 3))
      }
    })
    for (let i = game.targets.length; i < this.reticles.length; i++) this.reticles[i].visible = false
  }
}
