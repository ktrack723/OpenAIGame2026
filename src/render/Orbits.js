import * as THREE from 'three'
import { CFG, beltRadius } from '../game/config.js'

// ─── 공전궤도 ───────────────────────────────────────────────────
// 매 프레임 적분해서 그리면 N체 × 수천 스텝이라 감당이 안 된다. 대신
// 위치·속도에서 케플러 궤도요소(a, e, ω)를 닫힌 식으로 뽑아 원뿔곡선을
// 그린다. 행성 하나당 20여 번의 부동소수 연산이면 끝이다.
//
// 이건 태양만 고려한 2체 근사라 실제 N체 궤도와 미세하게 다르지만,
// 행성 상호중력은 태양의 0.1~1% 수준이라 눈에 보이는 차이가 없다.
// 무엇보다 **핵으로 밀면 궤도선이 그 자리에서 모양을 바꾼다** — 당구에서
// "공이 어디로 굴러가는가"를 보여주는 선이므로 이 게임엔 필수에 가깝다.
//
// 비용 관리: 지오메트리는 천체마다 하나씩 만들어 두고 제자리 갱신한다.
// 궤도요소가 유의미하게 변했을 때만 정점을 다시 쓰므로, 평상시에는
// GPU 업로드가 아예 일어나지 않는다(중력 섭동은 매우 느리게 변한다).
const SEG = 128

// r·v → (a, e, ω, p). 쌍곡선(e≥1)에서도 p = a(1−e²) 는 양수로 유효하다.
function elements(pos, vel, mu) {
  const rx = pos.x, ry = pos.y, vx = vel.x, vy = vel.y
  const r = Math.hypot(rx, ry) || 1e-6
  const v2 = vx * vx + vy * vy
  const rv = rx * vx + ry * vy
  const c = v2 - mu / r
  const ex = (c * rx - rv * vx) / mu, ey = (c * ry - rv * vy) / mu
  const e = Math.hypot(ex, ey)
  const a = 1 / (2 / r - v2 / mu)          // 비스-비바: e<1이면 양수, 쌍곡선이면 음수
  return { a, e, w: Math.atan2(ey, ex), p: a * (1 - e * e) }
}

export class Orbits {
  constructor(scene) {
    this.scene = scene
    this.map = new Map()   // b.id → { line, arr, attr, key }
  }

  make(color) {
    const arr = new Float32Array(SEG * 3)
    const geo = new THREE.BufferGeometry()
    const attr = new THREE.BufferAttribute(arr, 3)
    attr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', attr)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    // 선 굵기는 WebGL에서 1px 고정 — "얇게"라는 요구엔 오히려 딱 맞고,
    // 리본(삼각형 띠)과 달리 정점이 SEG개뿐이라 훨씬 싸다.
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.22, depthWrite: false,
    }))
    line.frustumCulled = false
    line.renderOrder = 1
    this.scene.add(line)
    return { line, arr, attr, key: '' }
  }

  // 궤도선을 실제 좌표로 채운다. 반환값은 캐시 키(요소가 그대로면 건너뛴다)
  fill(o, pos, vel, rMax) {
    const { a, e, w, p } = elements(pos, vel, CFG.MU_STAR)
    if (!isFinite(p) || p <= 0) return null
    // 요소가 눈에 띄게 변했을 때만 다시 쓴다 — 섭동만으로는 거의 안 변한다
    const key = `${a.toFixed(1)}|${e.toFixed(4)}|${w.toFixed(4)}`
    if (key === o.key) return key
    o.key = key
    // 쌍곡선이면 무한대로 뻗는 가지를 점근선 직전까지만 그린다
    const nuMax = e < 1 ? Math.PI : Math.acos(-1 / e) * 0.97
    const cw = Math.cos(w), sw = Math.sin(w)
    for (let i = 0; i < SEG; i++) {
      const nu = -nuMax + 2 * nuMax * (i / (SEG - 1))
      let r = p / (1 + e * Math.cos(nu))
      if (!(r > 0) || r > rMax) r = rMax          // 화면 밖으로 좌표가 폭주하지 않게
      const cn = Math.cos(nu), sn = Math.sin(nu)
      const x = r * cn, y = r * sn
      o.arr[i * 3] = x * cw - y * sw              // 근점 인수 ω 만큼 회전
      o.arr[i * 3 + 1] = x * sw + y * cw
      o.arr[i * 3 + 2] = -6                       // 트레일(-2)보다 뒤, 행성 뒤로 지나간다
    }
    o.attr.needsUpdate = true
    return key
  }

  // colorOf: (body) → 16진 색. 목표/지구는 호출부가 따로 강조한다.
  sync(bodies, aMax, colorOf) {
    // 성계에서 빠진 천체의 궤도선은 치운다(판이 이어지므로 통째 재생성이 없다)
    if (this.map.size > bodies.length) {
      const live = new Set(bodies.map(b => b.id))
      for (const [id, o] of this.map) {
        if (live.has(id)) continue
        this.scene.remove(o.line); o.line.geometry.dispose(); o.line.material.dispose()
        this.map.delete(id)
      }
    }
    // 궤도선은 카이퍼 벨트에서 끊는다 — 벨트가 판의 벽이므로 그 밖으로 뻗은
    // 선은 거짓말이다(어차피 거기 도달하기 전에 튕긴다).
    const rMax = beltRadius(aMax)
    for (const b of bodies) {
      if (b.type === 'debris') continue            // 파편까지 그리면 판이 실오라기로 덮인다
      let o = this.map.get(b.id)
      if (!o) { o = this.make(colorOf(b)); this.map.set(b.id, o) }
      o.line.visible = b.alive && !((b.warpIn ?? 0) > 0)
      if (!o.line.visible) continue
      this.fill(o, b.pos, b.vel, rMax)
      // 방금 밀린 궤도는 잠깐 밝힌다 — "내가 바꾼 궤도"가 어느 것인지 보여준다
      o.line.material.opacity = b.trailFlash > 0 ? 0.85 : (b.isTarget || b.isEarth ? 0.38 : 0.18)
    }
  }

  dispose() {
    for (const o of this.map.values()) {
      this.scene.remove(o.line)
      o.line.geometry.dispose(); o.line.material.dispose()
    }
    this.map.clear()
  }
}
