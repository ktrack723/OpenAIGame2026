import * as THREE from 'three'
import { CFG } from '../game/config.js'

// ─── 카이퍼 벨트 ────────────────────────────────────────────────
// 성계를 둘러싼 얼음 파편 고리. 게임적으로는 **당구대의 쿠션**이다:
// 여기 박은 천체는 폭발과 함께 속력을 그대로 유지한 채 반사각으로 되돌아온다
// (physics.beltBounce). 다만 **미사일만은 튕기지 않고 그 자리에서 터진다**
// (game.beltDetonate) — 공에게는 쿠션이고 탄에게는 끝나는 자리다.
// 그래서 이 고리는 장식이 아니라 "판의 벽"이고,
// 벽이라는 게 한눈에 읽혀야 한다 — 안쪽 경계선을 또렷하게 긋고,
// 그 위에 자잘한 얼음 조각을 뿌려 두께를 준다.
export class Belt {
  constructor(scene) {
    this.scene = scene
    this.radius = 0

    // ① 충돌 경계선 — 정확히 이 원에서 튕긴다
    this.edge = new THREE.Mesh(new THREE.RingGeometry(0.997, 1, 256), new THREE.MeshBasicMaterial({
      color: 0x7dd3fc, transparent: true, opacity: 0.5,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }))
    this.edge.renderOrder = 2

    // ② 바깥으로 번지는 띠 — "여기부터는 못 나간다"
    this.band = new THREE.Mesh(new THREE.RingGeometry(1, 1.055, 192), new THREE.MeshBasicMaterial({
      color: 0x38bdf8, transparent: true, opacity: 0.12,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }))
    this.band.renderOrder = 1

    // ③ 얼음 조각 — 벨트가 "물질"로 보이게 하는 최소 장치. 천천히 공전한다.
    const N = 1400
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3)
    const c = new THREE.Color()
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2
      // 단위원 위에 두께를 미리 구워 둔다(경계선 바깥쪽으로 더 두껍게).
      // 스케일 한 번이면 어느 판의 벨트 반경에도 그대로 맞는다.
      const k = 1 + (Math.random() - 0.28) * 0.055
      pos[i * 3] = Math.cos(a) * k; pos[i * 3 + 1] = Math.sin(a) * k; pos[i * 3 + 2] = 0
      c.setHSL(0.52 + Math.random() * 0.08, 0.45, 0.55 + Math.random() * 0.35)
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    this.rocks = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 9, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: 0.85, depthWrite: false, depthTest: false,
    }))
    this.rocks.frustumCulled = false
    this.rocks.renderOrder = 2
    this.t = 0
    scene.add(this.edge, this.band, this.rocks)
  }

  // 반경은 판마다 바뀐다(aMax 증가). 스케일만 갈아끼우면 되므로 재생성은 없다.
  update(beltR, dt, worldPerPx) {
    this.t += dt
    const thick = CFG.BELT_THICK
    for (const o of [this.edge, this.band]) {
      o.position.z = -7
      o.scale.setScalar(beltR)
    }
    this.rocks.scale.setScalar(beltR)
    this.rocks.position.z = -7
    this.rocks.rotation.z = this.t * 0.012            // 아주 느린 공전
    this.rocks.material.size = Math.max(3, 2.2 * worldPerPx)
    this.band.scale.setScalar(beltR + thick * 0.5)
    this.radius = beltR
  }

  dispose() {
    for (const o of [this.edge, this.band, this.rocks]) {
      this.scene.remove(o); o.geometry.dispose(); o.material.dispose()
    }
  }
}
