import * as THREE from 'three'
import { CFG } from '../game/config.js'

// ─── 조르그 레이저 연출 ─────────────────────────────────────────
// 충전 중에는 **가는 조준선**이 사거리 끝까지 뻗는다. 이 선이 곧 게임의
// 정보다: 선 위에 행성을 밀어 넣으면 막히고, 지구가 선에서 비켜나면 피한다.
// 발사 순간에는 같은 선 위에 굵은 빔이 번쩍이고 곧 사그라든다.

function quad(color, opacity, blending = THREE.AdditiveBlending) {
  const geo = new THREE.PlaneGeometry(1, 1)
  geo.translate(0.5, 0, 0)          // 원점에서 +x 로 뻗는 단위 사각형
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending,
  }))
  m.visible = false
  return m
}

export class LaserView {
  constructor(scene, rig) {
    this.scene = scene; this.rig = rig; this.t = 0
    this.aimLine = quad(0xff4d6d, 0.5)          // 충전 조준선 (가늘게)
    this.aimCore = quad(0xffd7de, 0.7)          // 그 안쪽 실선
    this.beam = quad(0xff2d4d, 1)               // 발사 빔 (굵게)
    this.beamCore = quad(0xffffff, 1)
    for (const o of [this.aimLine, this.aimCore, this.beam, this.beamCore]) { o.renderOrder = 18; scene.add(o) }

    // 충전 오브 — 본성 위에서 부풀며 밝아진다
    this.orb = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({
      color: 0xff4d6d, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }))
    this.orb.renderOrder = 18; this.orb.visible = false
    // 조준점 표시 — "여기로 온다"
    this.mark = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({
      color: 0xff4d6d, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }))
    this.mark.renderOrder = 18; this.mark.visible = false
    scene.add(this.orb, this.mark)
  }

  place(mesh, ox, oy, ang, len, width, z) {
    mesh.position.set(ox, oy, z)
    mesh.rotation.z = ang
    mesh.scale.set(len, width, 1)
    mesh.visible = true
  }

  hideAll() {
    for (const o of [this.aimLine, this.aimCore, this.beam, this.beamCore, this.orb, this.mark]) o.visible = false
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
      // 조준선은 사거리 끝까지 — 뒤에 뭐가 있는지 보여야 막을 자리를 고른다
      this.place(this.aimLine, L.ox, L.oy, ang, L.range, Math.max(2.2 * ppw, 3), 7)
      this.aimLine.material.opacity = (0.18 + 0.4 * u) * pulse
      this.place(this.aimCore, L.ox, L.oy, ang, L.range, Math.max(0.9 * ppw, 1.2), 7.1)
      this.aimCore.material.opacity = (0.3 + 0.6 * u) * pulse
      // 충전 오브
      this.orb.position.set(L.ox, L.oy, 8)
      this.orb.scale.setScalar(Math.max(6, 26 * ppw) * (0.4 + 1.5 * u * u))
      this.orb.material.opacity = 0.35 + 0.6 * pulse
      this.orb.visible = true
      // 조준점 — 지구가 도달할 그 자리
      this.mark.position.set(L.ax, L.ay, 8)
      this.mark.scale.setScalar(Math.max(16, 34 * ppw) * (1.5 - 0.5 * u))
      this.mark.rotation.z = this.t * 1.4
      this.mark.material.opacity = 0.4 + 0.6 * pulse
      this.mark.visible = true
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
