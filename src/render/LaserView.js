import * as THREE from 'three'
import { CFG } from '../game/config.js'

// ─── 조르그 레이저 연출 ─────────────────────────────────────────
// 충전 중에 화면에 뜨는 건 **위험 회랑**이다. 조준점에 표식을 찍는 방식은
// 없앴다 — 그러면 플레이어가 점만 보고 정작 "이 선 위에 있으면 죽는다"는
// 걸 안 읽는다. 위험은 점이 아니라 **경로 전체**에 있으므로 경로에 그린다.
//
// 회랑은 세 겹이다:
//   ① 넓은 위험대 — 흐르는 경고 빗금(공사장 테이프). 여기 걸치면 맞는다.
//   ② 가는 심선 — 정확한 광선 경로.
//   ③ 조준점까지의 구간을 더 진하게 — 지구가 도착할 자리가 어디쯤인지
//      선의 밀도만으로 읽힌다(표식 없이).
// 충전이 찰수록 폭이 좁아지고 색이 주황 → 적색으로 익는다. 발사 순간에는
// 같은 경로 위에 굵은 빔이 번쩍이고 곧 사그라든다.

function quad(color, opacity, blending = THREE.AdditiveBlending) {
  const geo = new THREE.PlaneGeometry(1, 1)
  geo.translate(0.5, 0, 0)          // 원점에서 +x 로 뻗는 단위 사각형
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending,
  }))
  m.visible = false
  return m
}

// 경고 빗금 텍스처 — 공사장 테이프. 이 무늬 하나로 "지나가지 마라"가 읽힌다.
function hazardTexture() {
  const w = 64, h = 32
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d')
  g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, w, h)
  g.strokeStyle = '#ffffff'; g.lineWidth = 12; g.lineCap = 'butt'
  for (let x = -h; x < w + h; x += 32) {   // 45° 빗금
    g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class LaserView {
  constructor(scene, rig) {
    this.scene = scene; this.rig = rig; this.t = 0
    this.hazTex = hazardTexture()
    // ① 위험대 — 빗금이 조준점 쪽으로 흘러간다
    this.band = quad(0xff4d6d, 0.5, THREE.NormalBlending)
    this.band.material.map = this.hazTex
    this.band.material.needsUpdate = true
    this.glow = quad(0xff2d4d, 0.22)            // 위험대 뒤에 깔리는 번짐
    this.aimCore = quad(0xffd7de, 0.7)          // ② 가는 심선
    this.lead = quad(0xff8fa3, 0.5)             // ③ 조준점까지의 구간(더 진하게)
    this.beam = quad(0xff2d4d, 1)               // 발사 빔 (굵게)
    this.beamCore = quad(0xffffff, 1)
    this.parts = [this.glow, this.band, this.lead, this.aimCore, this.beam, this.beamCore]
    for (const o of this.parts) { o.renderOrder = 18; scene.add(o) }
    this.glow.renderOrder = 17

    // 충전 오브 — 본성 위에서 부풀며 밝아진다
    this.orb = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({
      color: 0xff4d6d, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }))
    this.orb.renderOrder = 18; this.orb.visible = false
    scene.add(this.orb)
  }

  place(mesh, ox, oy, ang, len, width, z) {
    mesh.position.set(ox, oy, z)
    mesh.rotation.z = ang
    mesh.scale.set(len, width, 1)
    mesh.visible = true
  }

  hideAll() {
    for (const o of this.parts) o.visible = false
    this.orb.visible = false
  }

  update(game, dt) {
    this.t += dt
    const L = game.laser
    this.hideAll()
    if (!L || game.runOver) return
    const ppw = this.rig.worldPerPx
    const ang = Math.atan2(L.uy, L.ux)

    if (L.state === 'charge') {
      const u = Math.min(1, L.t / CFG.LASER_CHARGE)          // 충전 진행도
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(this.t * (5 + 9 * u)))
      // 색은 충전이 찰수록 주황 → 적색으로 익는다(남은 시간이 색으로 읽힌다)
      const hot = new THREE.Color(0xf59e0b).lerp(new THREE.Color(0xff2d4d), u)
      // 폭도 함께 좁아진다 — 넓고 흐린 경고에서 가늘고 확실한 사선으로
      const bw = Math.max(26 * ppw, 30) * (1.35 - 0.6 * u)

      // ① 위험대 — 사거리 끝까지. 빗금이 조준점 쪽으로 흐른다.
      this.hazTex.repeat.set(L.range / (bw * 2.2), 1)
      this.hazTex.offset.x = -this.t * (0.5 + 1.6 * u)
      this.place(this.band, L.ox, L.oy, ang, L.range, bw, 6.9)
      this.band.material.color.copy(hot)
      this.band.material.opacity = (0.16 + 0.26 * u) * pulse
      this.place(this.glow, L.ox, L.oy, ang, L.range, bw * 1.9, 6.8)
      this.glow.material.color.copy(hot)
      this.glow.material.opacity = (0.05 + 0.13 * u) * pulse

      // ③ 조준점까지의 구간 — 지구가 도달할 자리가 선의 밀도로 읽힌다
      this.place(this.lead, L.ox, L.oy, ang, L.aimDist || L.range, bw * 0.5, 7.05)
      this.lead.material.color.copy(hot)
      this.lead.material.opacity = (0.2 + 0.45 * u) * pulse

      // ② 심선
      this.place(this.aimCore, L.ox, L.oy, ang, L.range, Math.max(0.9 * ppw, 1.2), 7.1)
      this.aimCore.material.opacity = (0.3 + 0.6 * u) * pulse

      // 충전 오브
      this.orb.position.set(L.ox, L.oy, 8)
      this.orb.scale.setScalar(Math.max(6, 26 * ppw) * (0.4 + 1.5 * u * u))
      this.orb.material.color.copy(hot)
      this.orb.material.opacity = 0.35 + 0.6 * pulse
      this.orb.visible = true
      return
    }

    if (L.state === 'flash') {
      const u = Math.min(1, L.t / CFG.LASER_FLASH)
      const fade = Math.pow(1 - u, 1.6)
      const len = L.result ? L.result.t : L.range
      this.place(this.beam, L.ox, L.oy, ang, len, Math.max(16 * ppw, 22) * (0.4 + fade), 7)
      this.beam.material.opacity = fade
      this.place(this.beamCore, L.ox, L.oy, ang, len, Math.max(5 * ppw, 7) * (0.5 + fade), 7.2)
      this.beamCore.material.opacity = fade
    }
  }
}
