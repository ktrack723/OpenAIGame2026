import * as THREE from 'three'
import { CFG, hitRadiusOf } from '../game/config.js'

// ─── 조르그 레이저 연출 ─────────────────────────────────────────
// **단순하게.** 예전엔 흐르는 빗금 + 맥동 + 색 변화 + 번짐을 한꺼번에 얹었더니
// 빨리 감기로 보면 화면이 정신없어서 정작 "어디가 위험한가"가 안 읽혔다.
// 움직이는 것은 하나만 둔다.
//
// 충전 중 — 화면에 뜨는 것은 셋이다.
//   ⓪ 위험 회랑: 총구에서 조준점을 지나 사거리 끝까지 뻗는 **띠**. 폭은
//      지구 판정 지름 그대로다 — 즉 "이 띠 안에 지구가 들어가 있으면 죽는다"가
//      말 그대로 폭으로 그려진다(laser.js가 L.miss > hitRadiusOf(earth)로 재는
//      바로 그 값이다). 얇은 선 하나로는 "선 위"만 위험해 보여서 정작 폭이
//      있다는 게 안 읽혔다. 두껍지 않게, 아주 옅게 깐다.
//   ① 조준선: 그 띠 한가운데를 지나는 가는 선. **정지해 있다.**
//      광선은 조준점에서 멈추지 않고 직진하므로 선도 거기서 안 끊는다.
//   ② 조준점: 마름모 표식. 조르그가 겨눈 한 점이고, 지구를 밀면 지구가
//      여기서 미끄러져 나간다. **색이 두 상태로만 갈린다** — 붉은색이면
//      이대로 맞고, 청록이면 빗나간다. 회피 성공 여부가 색 하나로 끝난다.
//
// 비행 중 — 짧고 밝은 탄두 하나가 조준선을 따라 달린다. 그게 전부다.
//
// 시한이 끝나면 모성이 와서 사방에 뿌린다(doom). 그때는 탄두가 여럿이므로
// 같은 모양의 막대를 필요한 만큼 빌려 쓴다 — 규칙도 그림도 본성 것과 같다.

function quad(color, opacity) {
  const geo = new THREE.PlaneGeometry(1, 1)
  geo.translate(0.5, 0, 0)          // 원점에서 +x 로 뻗는 단위 사각형
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }))
  m.visible = false
  return m
}

// 총구에서 태양 원반에 부딪히기까지의 거리. 안 가로막히면 null.
// 게임 판정(laser.js sweep)과 같은 사실을 그림으로만 반복하는 것이므로
// 여기서 계산해도 규칙이 두 군데로 갈리지 않는다.
function sunBlock(L) {
  const ux = (L.ax - L.ox), uy = (L.ay - L.oy)
  const d = Math.hypot(ux, uy) || 1
  const nx = ux / d, ny = uy / d
  const t = -L.ox * nx - L.oy * ny            // 총구→태양 중심의 진행 방향 성분
  if (t <= 0) return null                     // 태양이 뒤에 있다
  const perp = Math.hypot(-L.ox - nx * t, -L.oy - ny * t)
  if (perp >= CFG.R_STAR) return null
  return Math.max(0, t - Math.sqrt(CFG.R_STAR * CFG.R_STAR - perp * perp))
}

export class LaserView {
  constructor(scene, rig) {
    this.scene = scene; this.rig = rig
    this.band = quad(0xff4d6d, 0.10)      // ⓪ 위험 회랑 — 지구 판정 지름만큼의 폭
    this.line = quad(0xff4d6d, 0.34)      // ① 조준선 — 정지, 가늘게
    this.bolt = quad(0xff2d4d, 1)         // 비행 탄두
    this.boltCore = quad(0xffffff, 1)
    this.parts = [this.band, this.line, this.bolt, this.boltCore]
    for (const o of this.parts) { o.renderOrder = 18; scene.add(o) }

    // ② 조준점 — 마름모 하나. 얇은 링을 4각형으로 굽는다.
    this.markGrp = new THREE.Group()
    const mk = (r0, r1, seg, op) => new THREE.Mesh(
      new THREE.RingGeometry(r0, r1, seg), new THREE.MeshBasicMaterial({
        color: 0xff4d6d, transparent: true, opacity: op,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      }))
    this.markRing = mk(0.72, 1, 4, 0.95)     // seg 4 = 마름모
    this.markDot = mk(0, 0.3, 12, 0.9)
    this.markGrp.add(this.markRing, this.markDot)
    this.markGrp.renderOrder = 19
    this.markGrp.visible = false
    scene.add(this.markGrp)

    // 총구 충전 오브 — 커지기만 한다(깜빡이지 않는다)
    this.orb = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({
      color: 0xff4d6d, transparent: true, opacity: 0.5,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    this.orb.renderOrder = 18; this.orb.visible = false
    scene.add(this.orb)
    this.doomBolts = []   // 모성 난사용 막대 풀
  }

  place(mesh, ox, oy, ang, len, width, z) {
    mesh.position.set(ox, oy, z)
    mesh.rotation.z = ang
    mesh.scale.set(len, width, 1)
    mesh.visible = true
  }

  hideAll() {
    for (const o of this.parts) o.visible = false
    for (const o of this.doomBolts) o.visible = false
    this.markGrp.visible = false
    this.orb.visible = false
  }

  // 모성 난사용 막대 — 필요한 만큼만 만들어 두고 재사용한다
  doomBolt(i) {
    while (this.doomBolts.length <= i) {
      const m = quad(0xff2d4d, 1)
      m.renderOrder = 18
      this.scene.add(m)
      this.doomBolts.push(m)
    }
    return this.doomBolts[i]
  }

  // ─── 모성의 난사 ────────────────────────────────────────────
  // 조준도 조준점도 없다. 뻗어 나간 자리를 흐리게 남기고, 머리에 밝은 막대.
  showDoom(D) {
    const ppw = this.rig.worldPerPx
    let i = 0
    for (const b of D.beams) {
      if (b.gone) continue
      const ang = Math.atan2(b.uy, b.ux)
      const trail = this.doomBolt(i++)
      this.place(trail, D.x, D.y, ang, b.head, Math.max(1.6 * ppw, 2.4), 6.9)
      trail.material.color.setHex(0xff2d4d)
      trail.material.opacity = b.dead ? 0.12 : 0.26
      // 막대는 꼬리(back)에서 머리(head)까지. 머리가 박혀 멎은 뒤에는 꼬리만
      // 다가오므로 막대가 앞에서부터 잡아먹히며 짧아진다.
      const lit = b.head - b.back
      if (lit <= 0) continue
      const hx = D.x + b.ux * b.back, hy = D.y + b.uy * b.back
      const head = this.doomBolt(i++)
      this.place(head, hx, hy, ang, lit, Math.max(8 * ppw, 11), 7)
      head.material.color.setHex(0xff2d4d)
      head.material.opacity = 1
      const core = this.doomBolt(i++)
      this.place(core, hx, hy, ang, lit, Math.max(3 * ppw, 4), 7.2)
      core.material.color.setHex(0xffffff)
      core.material.opacity = 1
    }
  }

  update(game) {
    const L = game.laser
    this.hideAll()
    if (game.doom) { this.showDoom(game.doom); return }   // 모성이 왔으면 그것만 그린다
    if (!L) return
    // 판이 끝나면 조준선도 회랑도 걷는다. 다만 **이미 박힌 광선의 꼬리**는
    // 예외다 — 지구를 부순 그 한 발이 화면에서 툭 사라지면 무엇이 지구를
    // 관통했는지가 안 남는다. 0.18초, 마저 들어가는 것만 그린다.
    if (game.runOver && L.state !== 'spent') return
    const ppw = this.rig.worldPerPx

    if (L.state === 'charge') {
      const u = Math.min(1, L.t / CFG.LASER_CHARGE)          // 충전 진행도
      const ang = Math.atan2(L.ay - L.oy, L.ax - L.ox)
      // ① 조준선 — 조준점을 지나 사거리 끝까지. 굵기·색·투명도 모두 고정.
      //   단 **태양에 가로막히면 거기서 끊는다.** 태양은 안 움직이므로 이 절단은
      //   언제나 참이고, 선이 태양 앞에서 멎는 것만으로 "저건 막힌다"가 읽힌다.
      //   (행성은 95초 동안 움직이므로 미리 끊어 주면 거짓말이 된다.)
      const reach = sunBlock(L) ?? L.range
      // ⓪ 위험 회랑 — 지구 판정 지름이 곧 폭이다. 화면에서 최소 3px은 되게.
      const w = Math.max(hitRadiusOf(game.earth) * 2, 3 * ppw)
      this.place(this.band, L.ox, L.oy, ang, reach, w, 6.8)
      this.band.material.opacity = 0.09 + 0.05 * u
      this.place(this.line, L.ox, L.oy, ang, reach, Math.max(1.4 * ppw, 2), 6.9)
      this.line.material.opacity = 0.34
      // ② 조준점 — 유일하게 움직이는 것. 충전이 찰수록 조여든다.
      // 조준점 색은 두 상태뿐이다: 붉은색 = 이대로면 맞는다 / 청록 = 빗나간다.
      // 회피가 먹히는 순간을 색 하나로 못 박는다.
      const tone = L.safe ? 0x4fd6f7 : 0xff4d6d
      this.markRing.material.color.setHex(tone)
      this.markDot.material.color.setHex(tone)
      this.line.material.color.setHex(tone)
      this.band.material.color.setHex(tone)
      const mr = Math.max(9, 22 * ppw) * (1.6 - 0.6 * u)
      this.markGrp.position.set(L.ax, L.ay, 7.2)
      this.markGrp.scale.setScalar(mr)
      this.markGrp.rotation.z = Math.PI / 4
      this.markGrp.visible = true
      this.markRing.material.opacity = 0.55 + 0.4 * u
      this.markDot.material.opacity = 0.35 + 0.55 * u
      // 총구 오브
      this.orb.position.set(L.ox, L.oy, 8)
      this.orb.scale.setScalar(Math.max(5, 20 * ppw) * (0.35 + 0.9 * u))
      this.orb.material.opacity = 0.25 + 0.45 * u
      this.orb.visible = true
      return
    }

    // 'spent' = 머리가 이미 박혔고 꼬리만 남은 구간. 그림은 travel과 같은 규칙을
    // 쓴다 — 다른 건 머리가 안 움직인다는 것뿐이고, 그래서 막대가 짧아진다.
    if (L.state === 'travel' || L.state === 'spent') {
      const spent = L.state === 'spent'
      const ang = Math.atan2(L.uy, L.ux)
      this.line.material.color.setHex(0xff4d6d)
      // 아직 안 지나간 앞쪽이 위험한 자리다 — 회랑을 탄두 앞으로만 깔아 둔다.
      // 이미 박힌 뒤에는 앞쪽이랄 게 없으므로 회랑도 걷는다.
      if (!spent) {
        const w = Math.max(hitRadiusOf(game.earth) * 2, 3 * ppw)
        const hx = L.ox + L.ux * L.head, hy = L.oy + L.uy * L.head
        this.place(this.band, hx, hy, ang, Math.max(0, L.range - L.head), w, 6.8)
        this.band.material.color.setHex(0xff4d6d)
        this.band.material.opacity = 0.11
      }
      // 지나간 자리는 흐릿하게 남겨 "어디서 왔는지"만 남긴다
      this.place(this.line, L.ox, L.oy, ang, L.head, Math.max(1.4 * ppw, 2), 6.9)
      this.line.material.opacity = spent ? 0.14 : 0.22
      // 탄두 — 꼬리(back)에서 머리(head)까지의 막대. 이게 유일하게 움직인다.
      // 머리가 무언가에 박혀 멎어도 꼬리는 같은 속도로 계속 들어오므로,
      // 막대는 그 자리에서 **앞에서부터 잡아먹히며** 짧아지다 사라진다.
      const lit = L.head - L.back
      if (lit <= 0) return
      const bx = L.ox + L.ux * L.back, by = L.oy + L.uy * L.back
      this.place(this.bolt, bx, by, ang, lit, Math.max(9 * ppw, 12), 7)
      this.place(this.boltCore, bx, by, ang, lit, Math.max(3 * ppw, 4), 7.2)
    }
  }
}
