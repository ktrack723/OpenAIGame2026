import * as THREE from 'three'
import { makeArrow, setArrow } from './Arrow.js'
import { bearing } from '../core/angle.js'

// ─── 화살표 옆에 붙는 작은 수치 ─────────────────────────────────
// 화살표만 그리면 "어느 쪽"까지는 읽히는데 "몇 도"가 안 읽힌다. 두 방향
// (충격 방향 / 타격 직후 진로)은 이 게임의 조준 그 자체이므로 숫자로도 박아 둔다.
// 캔버스 스프라이트라 화면 크기 고정 — 줌과 무관하게 같은 크기로 읽힌다.
function tagSprite() {
  const c = document.createElement('canvas')
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false,
  }))
  sp.renderOrder = 18
  sp.userData.c = c
  sp.userData.text = null
  return sp
}
function drawTag(sp, text, color) {
  if (sp.userData.text === text) return
  sp.userData.text = text
  const dpr = 2, fs = 22, pad = 8
  const c = sp.userData.c, g = c.getContext('2d')
  g.font = `800 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`
  const w = Math.ceil(g.measureText(text).width) + pad * 2, h = fs + pad
  c.width = w * dpr; c.height = h * dpr
  g.scale(dpr, dpr)
  g.font = `800 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`
  g.textBaseline = 'middle'
  g.fillStyle = 'rgba(3,8,14,.82)'
  g.beginPath(); g.roundRect(0, 0, w, h, 5); g.fill()
  g.fillStyle = color
  g.fillText(text, pad, h / 2 + 1)
  sp.material.map.dispose()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.minFilter = THREE.LinearFilter
  sp.material.map = t
  sp.material.needsUpdate = true
  sp.userData.px = { w, h }
}

// 경로·락온 색 = 무엇에 닿는가 (결과가 아니라 접촉 대상)
export const PRED_TONE = {
  target: 0x4ade80, neutral: 0xe2e8f0, earth: 0xf87171,
  debris: 0x94a3b8, sun: 0xfb923c, lost: 0x94a3b8, timeout: 0x67e8f9,
  volatile: 0xfb923c, void: 0xa855f7, intercept: 0xf472b6,
}

// ─── 조준 보조 렌더 ─────────────────────────────────────────────
// 락온(맞는 순간 그 공이 있을 자리) + 임펄스/진로/반격탄 화살표 + 폭풍 반경.
// **2차 이후의 충돌은 그리지 않는다** — 판이 어떻게 굴러갈지는 플레이어 몫이다.
export class AimHelper {
  // renderRadius는 Scene이 소유한다(최소 화면 크기 바닥값이 카메라에 의존).
  // 락온 크기를 그 함수로 받아야 "그려진 공"과 락온이 정확히 겹친다.
  constructor(scene, rig, discGeo) {
    this.scene = scene
    this.rig = rig
    this.t = 0
    this.bodies = []
    this.renderRadius = null
    // ── 1차 충돌 하이라이트 ────────────────────────────────────
    // "텍스트를 읽어야 어디 박는지 안다"를 없애는 게 목적. 맞는 순간 그 공이
    // 있을 자리에 락온 브래킷 + 채운 디스크 + 맞는 쪽 반달을 겹쳐 찍는다.
    // 2차·3차 충돌은 일부러 예측하지 않는다 — 그건 플레이어가 읽을 몫이다.
    this.lockDisc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.2, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    this.lockDisc.renderOrder = 12
    this.lockRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.06, 72), new THREE.MeshBasicMaterial({
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }))
    this.lockRing.renderOrder = 16
    // 맞는 쪽 반달 — 공의 어느 살을 치는지가 곧 밀리는 방향이라 이게 핵심 정보다
    this.lockHemi = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.30, 48, 1, -0.62, 1.24), new THREE.MeshBasicMaterial({
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }))
    this.lockHemi.renderOrder = 16
    this.lockBrackets = new THREE.Group()   // 회전하는 락온 브래킷 4개
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(1.26, 1.54, 20, 1, i * Math.PI / 2 + 0.30, Math.PI / 2 - 0.60),
        new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }))
      m.renderOrder = 16
      this.lockBrackets.add(m)
    }
    this.scene.add(this.lockDisc, this.lockRing, this.lockHemi, this.lockBrackets)
    this.t = 0

    // 조준 보조 — 임펄스 방향(노랑) / 타격 직후 공의 진로(흰색)
    //           / 요새 반격탄 진로(붉은색) / 폭풍 반경(주황 링)
    this.pushArrow = makeArrow(0xfbbf24, 0.95)
    this.courseArrow = makeArrow(0xffffff, 0.9)
    this.counterArrow = makeArrow(0xfb7185, 0.95)
    this.scene.add(this.counterArrow)
    this.blastRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96), new THREE.MeshBasicMaterial({
      color: 0xf59e0b, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }))
    this.blastRing.renderOrder = 11
    this.blastRing.visible = false
    // 화살표 옆 수치 — 충격 방향(노랑) / 타격 직후 진로(흰색)
    this.pushTag = tagSprite(); this.courseTag = tagSprite()
    this.pushTag.visible = false; this.courseTag.visible = false
    this.scene.add(this.pushArrow, this.courseArrow, this.blastRing, this.pushTag, this.courseTag)
  }

  tick(dt) { this.t += dt }

  // Scene이 매 프레임 넘겨주는 참조 (락온 반경 = 그려지는 반경)
  bind(bodies, renderRadius) { this.bodies = bodies; this.renderRadius = renderRadius }

  // ─── 큐 예측: "무슨 일이 날지"가 아니라 "어느 살을 치는지"만 ────
  // 폭심 · 임펄스 방향 · 타격 직후 공의 진로 · 폭풍 반경. 그 뒤 판이 어떻게
  // 굴러갈지는 일부러 안 보여준다 — 그게 이 게임의 문제다.
  show(pred) {
    const tone = PRED_TONE[pred.outcome] ?? 0x67e8f9
    if (!this.predEnd) {
      this.predEnd = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, 28), new THREE.MeshBasicMaterial({
        transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      }))
      this.predEnd.renderOrder = 15
      this.scene.add(this.predEnd)
    }
    const end = pred.pts[pred.pts.length - 1]
    this.predEnd.visible = true
    this.predEnd.position.set(end.x, end.y, 5)
    this.predEnd.scale.setScalar(Math.max(7, 11 * this.rig.worldPerPx))
    this.predEnd.material.color.setHex(tone)
    this.predEnd.material.opacity = pred.outcome === 'timeout' ? 0.45 : 0.95

    // ── 1차 충돌 락온 ──────────────────────────────────────────
    const h = pred.hit
    const on = !!h
    this.lockDisc.visible = on; this.lockRing.visible = on
    this.lockHemi.visible = on; this.lockBrackets.visible = on
    if (h) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 5)
      // 락온 크기는 그 공이 **화면에 그려지는 크기** 그대로여야 한다.
      // 판정 반경만 쓰면 줌아웃 시 락온이 공보다 작아져서 딴 걸 무는 것처럼 보인다.
      const body = this.bodies.find(b => b.id === h.id)
      const R = body ? this.renderRadius(body) : h.r
      for (const o of [this.lockDisc, this.lockRing, this.lockHemi, this.lockBrackets]) o.material?.color.setHex(tone)
      this.lockDisc.position.set(h.x, h.y, 4)
      this.lockDisc.scale.setScalar(R)
      this.lockDisc.material.opacity = 0.14 + 0.10 * pulse
      this.lockRing.position.set(h.x, h.y, 5)
      this.lockRing.scale.setScalar(R)
      this.lockRing.material.opacity = 0.75 + 0.25 * pulse
      // 반달은 폭심 쪽(= 중심에서 폭심으로 향하는 각)에 붙인다
      this.lockHemi.position.set(h.x, h.y, 5)
      this.lockHemi.scale.setScalar(R)
      this.lockHemi.rotation.z = Math.atan2(-h.dy, -h.dx)
      this.lockHemi.material.opacity = 0.55 + 0.35 * pulse
      // 브래킷은 락온이 "물었다"는 신호 — 천천히 돌면서 숨을 쉰다
      this.lockBrackets.position.set(h.x, h.y, 5)
      this.lockBrackets.scale.setScalar(R * (1 + 0.06 * pulse))
      this.lockBrackets.rotation.z = -this.t * 0.8
      for (const m of this.lockBrackets.children) {
        m.material.color.setHex(tone)
        m.material.opacity = 0.6 + 0.4 * pulse
      }
    }

    const ppw = this.rig.worldPerPx
    const push = h && h.dv > 0
    this.pushArrow.visible = !!push
    this.courseArrow.visible = !!push
    this.pushTag.visible = !!push
    this.courseTag.visible = !!push
    this.counterArrow.visible = !!(h && h.counter)
    this.blastRing.visible = !!h
    if (h) {
      // 휘발성이면 폭풍이 아니라 유폭 반경을 그린다 — 실제로 밀리는 경계가 그쪽이다
      const useVol = h.volatileR > 0
      this.blastRing.position.set(useVol ? h.x : h.px, useVol ? h.y : h.py, 2)
      this.blastRing.scale.setScalar(useVol ? h.volatileR : h.blast)
      this.blastRing.material.opacity = h.outcome === 'earth' ? 0.6 : useVol ? 0.55 : 0.3
      this.blastRing.material.color.setHex(h.outcome === 'earth' ? 0xf87171 : 0xf59e0b)
    }
    if (h && h.counter) {   // 반격탄은 내가 때린 쪽으로 되나온다 = 임펄스의 정반대
      const ca = Math.atan2(-h.dy, -h.dx)
      const cl = Math.max(70 * ppw, this.lockRing.scale.x * 2.2)
      setArrow(this.counterArrow, h.px, h.py, ca, cl, Math.max(3 * ppw, cl * 0.06), 7)
    }
    if (push) {
      const R = this.lockRing.scale.x   // 락온과 같은 반경 위에서 화살표를 시작한다
      // 임펄스(노랑): 폭심에서 공의 중심을 뚫고 나가는 방향 — 길이 ∝ Δv
      const len = Math.max(22 * ppw, R * 0.9 + h.dv * 2.5)
      setArrow(this.pushArrow, h.px, h.py, Math.atan2(h.dy, h.dx), len, Math.max(3 * ppw, len * 0.07), 6)
      // 진로(흰색): 원래 궤도 속도 + 임펄스 = 공이 실제로 출발하는 방향.
      // 공의 가장자리에서 뻗어 나가게 해서 "이 공이 저리로 간다"로 읽히게 한다.
      const sp = Math.hypot(h.vx, h.vy) || 1
      const ca = Math.atan2(h.vy, h.vx)
      const cl = Math.max(60 * ppw, sp * 3)
      setArrow(this.courseArrow, h.x + Math.cos(ca) * R, h.y + Math.sin(ca) * R, ca,
        cl, Math.max(3.5 * ppw, cl * 0.07), 7)

      // ── 수치 라벨 ──
      // 충격: 핵이 공을 미는 방향 · 진로: 그 결과 공이 실제로 출발하는 방향+속력.
      // 둘이 다른 이유(원래 궤도 속도와 합쳐지기 때문)가 이 게임의 핵심이라
      // 두 값을 나란히 보여 준다.
      const pa = Math.atan2(h.dy, h.dx)
      drawTag(this.pushTag, `충격 ${bearing(h.dx, h.dy).toFixed(0)}° Δv${h.dv.toFixed(1)}`, '#fbbf24')
      drawTag(this.courseTag, `진로 ${bearing(h.vx, h.vy).toFixed(0)}° ${sp.toFixed(0)}GU/s`, '#ffffff')
      const place = (tag, ax, ay, ang, dist) => {
        const px = tag.userData.px
        tag.scale.set(px.w * ppw, px.h * ppw, 1)
        tag.position.set(ax + Math.cos(ang) * dist, ay + Math.sin(ang) * dist + px.h * ppw * 0.9, 9)
      }
      place(this.pushTag, h.px, h.py, pa, Math.max(26 * ppw, R * 0.9 + h.dv * 2.5) * 0.62)
      place(this.courseTag, h.x, h.y, ca, R + cl * 0.55)
    }
  }

  hide() {
    if (this.predEnd) this.predEnd.visible = false
    this.lockDisc.visible = false; this.lockRing.visible = false
    this.lockHemi.visible = false; this.lockBrackets.visible = false
    this.pushArrow.visible = false
    this.courseArrow.visible = false
    this.counterArrow.visible = false
    this.blastRing.visible = false
    this.pushTag.visible = false
    this.courseTag.visible = false
  }
}
