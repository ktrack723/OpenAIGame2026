import * as THREE from 'three'
import { CFG, hitRadiusOf } from '../game/config.js'
// 상태 이름은 laser.js가 소유한다 — 문자열로 다시 적으면 저쪽에서 한 글자만
// 바뀌어도 판정은 그대로인 채 **그림만 조용히 멎는다**(같은 상수를 game.js와
// Attract.js는 이미 import해 쓰고 있다).
import { LASER_CHARGE, LASER_SPENT, LASER_TRAVEL } from '../game/laser.js'

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
//   ③ 총구의 충전 — 사방에서 빨려 들어와 한 점에 뭉치는 빛(chargeFx).
//
// 비행 중 — 짧고 밝은 탄두 하나가 조준선을 따라 달린다. 그게 전부다.
//
// **포대는 여럿이다.** 살아 있는 요새마다 광선이 하나씩 돌아가므로, 여기 있는
// 오브젝트는 전부 풀에서 빌려 쓴다 — 매 프레임 필요한 만큼만 켜고 나머지는 끈다.
//
// 시한이 끝나면 모성이 와서 사방에 뿌린다(doom). 그때는 탄두가 여럿이므로
// 같은 모양의 막대를 필요한 만큼 빌려 쓴다 — 규칙도 그림도 요새 것과 같다.

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

// ─── 충전 연출 ─────────────────────────────────────────────────
// 에너지가 **밖에서 안으로 모인다.** 총구에서 뭔가가 뿜어져 나가는 그림은
// 발사 순간의 것이고(laserFire), 그 전까지는 반대 방향이어야 "아직 안 쏘았다,
// 지금 모으는 중이다"가 읽힌다.
//
// 세 겹이다.
//   · 살 — 바깥에서 총구로 빨려드는 가는 빗금. 각자 제 위상으로 달려 들어와
//     닿는 순간 다음 바퀴를 시작한다. **이게 움직이는 유일한 것**이다.
//   · 알갱이 — 그 사이를 채우는 입자. 살이 만드는 방향을 흐트러뜨려 준다.
//   · 수축 링 — 이따금 한 겹씩 조여든다. 박자를 만든다.
const SPOKES = 9              // 살 개수
const SPOKE_SPAN = 5.4        // 살이 출발하는 반경 (총구 오브 반경의 배수)
const GRAIN_RATE = 34         // 초당 알갱이 수 (충전 진행도에 비례해 늘어난다)
const RING_GAP = 0.55         // 수축 링 간격(초)

export class LaserView {
  constructor(scene, rig, parts = null) {
    this.scene = scene; this.rig = rig; this.parts = parts
    this.pool = []        // 재사용 막대(회랑·조준선·탄두·살) — 매 프레임 필요한 만큼만
    this.marks = []       // 조준점 마름모
    this.orbs = []        // 총구 오브
    this.used = 0; this.markUsed = 0; this.orbUsed = 0
    this.fxT = new WeakMap()   // 광선 → { grain, ring } 연출 타이머
  }

  // ── 풀 ──
  bolt(color = 0xff2d4d, op = 1) {
    if (this.pool.length <= this.used) {
      const m = quad(color, op)
      m.renderOrder = 18
      this.scene.add(m)
      this.pool.push(m)
    }
    const m = this.pool[this.used++]
    m.material.color.setHex(color)
    m.material.opacity = op
    return m
  }

  mark() {
    if (this.marks.length <= this.markUsed) {
      const grp = new THREE.Group()
      const mk = (r0, r1, seg, op) => new THREE.Mesh(
        new THREE.RingGeometry(r0, r1, seg), new THREE.MeshBasicMaterial({
          color: 0xff4d6d, transparent: true, opacity: op,
          depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        }))
      const ring = mk(0.72, 1, 4, 0.95)     // seg 4 = 마름모
      const dot = mk(0, 0.3, 12, 0.9)
      grp.add(ring, dot)
      grp.renderOrder = 19
      grp.visible = false
      this.scene.add(grp)
      this.marks.push({ grp, ring, dot })
    }
    return this.marks[this.markUsed++]
  }

  orb() {
    if (this.orbs.length <= this.orbUsed) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({
        color: 0xff4d6d, transparent: true, opacity: 0.5,
        depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      }))
      m.renderOrder = 18; m.visible = false
      this.scene.add(m)
      this.orbs.push(m)
    }
    return this.orbs[this.orbUsed++]
  }

  place(mesh, ox, oy, ang, len, width, z) {
    mesh.position.set(ox, oy, z)
    mesh.rotation.z = ang
    mesh.scale.set(len, width, 1)
    mesh.visible = true
  }

  hideAll() {
    for (const o of this.pool) o.visible = false
    for (const m of this.marks) m.grp.visible = false
    for (const o of this.orbs) o.visible = false
    this.used = 0; this.markUsed = 0; this.orbUsed = 0
  }

  // ─── 모성의 난사 ────────────────────────────────────────────
  // 조준도 조준점도 없다. 움직이는 막대 하나뿐이다.
  //
  // **지나간 자리는 안 남긴다.** 요새의 광선은 한 번에 한두 줄기라 흐린 자취가
  // "어디서 왔는지"를 말해 주지만, 모성은 쉬지 않고 뿜으므로 그 자취가 초당
  // 다섯 줄씩 쌓인다 — 몇 초면 화면이 붉은 선 뭉치가 되고 정작 지금 날아오는
  // 막대가 그 안에 묻힌다. 여기서는 자취를 걷고 막대만 그린다.
  showDoom(D) {
    const ppw = this.rig.worldPerPx
    for (const b of D.beams) {
      if (b.gone) continue
      const ang = Math.atan2(b.uy, b.ux)
      // 막대는 꼬리(back)에서 머리(head)까지. 머리가 박혀 멎은 뒤에는 꼬리만
      // 다가오므로 막대가 앞에서부터 잡아먹히며 짧아진다.
      const lit = b.head - b.back
      if (lit <= 0) continue
      const hx = D.x + b.ux * b.back, hy = D.y + b.uy * b.back
      this.place(this.bolt(0xff2d4d, 1), hx, hy, ang, lit, Math.max(8 * ppw, 11), 7)
      this.place(this.bolt(0xffffff, 1), hx, hy, ang, lit, Math.max(3 * ppw, 4), 7.2)
    }
  }

  update(game, dt = 0) {
    this.hideAll()
    if (game.doom) { this.showDoom(game.doom); return }   // 모성이 왔으면 그것만 그린다
    for (const L of game.lasers ?? []) {
      // 판이 끝나면 조준선도 회랑도 걷는다. 다만 **이미 박힌 광선의 꼬리**는
      // 예외다 — 지구를 부순 그 한 발이 화면에서 툭 사라지면 무엇이 지구를
      // 관통했는지가 안 남는다. 0.18초, 마저 들어가는 것만 그린다.
      if (game.runOver && L.state !== LASER_SPENT) continue
      if (L.state === LASER_CHARGE) this.showCharge(game, L, dt)
      else if (L.state === LASER_TRAVEL || L.state === LASER_SPENT) this.showBolt(game, L)
    }
  }

  showCharge(game, L, dt) {
    const ppw = this.rig.worldPerPx
    const u = Math.min(1, L.t / CFG.LASER_CHARGE)          // 충전 진행도
    const ang = Math.atan2(L.ay - L.oy, L.ax - L.ox)
    // 조준점 색은 두 상태뿐이다: 붉은색 = 이대로면 맞는다 / 청록 = 빗나간다.
    // 회피가 먹히는 순간을 색 하나로 못 박는다.
    const tone = L.safe ? 0x4fd6f7 : 0xff4d6d
    // ① 조준선 — 조준점을 지나 사거리 끝까지. 굵기·색·투명도 모두 고정.
    //   단 **태양에 가로막히면 거기서 끊는다.** 태양은 안 움직이므로 이 절단은
    //   언제나 참이고, 선이 태양 앞에서 멎는 것만으로 "저건 막힌다"가 읽힌다.
    //   (행성은 95초 동안 움직이므로 미리 끊어 주면 거짓말이 된다.)
    const reach = sunBlock(L) ?? L.range
    // ⓪ 위험 회랑 — 지구 판정 지름이 곧 폭이다. 화면에서 최소 3px은 되게.
    const w = Math.max(hitRadiusOf(game.earth) * 2, 3 * ppw)
    this.place(this.bolt(tone, 0.09 + 0.05 * u), L.ox, L.oy, ang, reach, w, 6.8)
    this.place(this.bolt(tone, 0.34), L.ox, L.oy, ang, reach, Math.max(1.4 * ppw, 2), 6.9)
    // ② 조준점 — 충전이 찰수록 조여든다.
    const M = this.mark()
    const mr = Math.max(9, 22 * ppw) * (1.6 - 0.6 * u)
    M.ring.material.color.setHex(tone); M.dot.material.color.setHex(tone)
    M.grp.position.set(L.ax, L.ay, 7.2)
    M.grp.scale.setScalar(mr)
    M.grp.rotation.z = Math.PI / 4
    M.grp.visible = true
    M.ring.material.opacity = 0.55 + 0.4 * u
    M.dot.material.opacity = 0.35 + 0.55 * u
    // ③ 총구 오브 + 모여드는 빛
    const R = Math.max(5, 20 * ppw) * (0.35 + 0.9 * u)
    const O = this.orb()
    O.position.set(L.ox, L.oy, 8)
    O.scale.setScalar(R)
    O.material.opacity = 0.25 + 0.45 * u
    O.visible = true
    this.chargeFx(L, dt, u, R, ppw)
  }

  // 모여드는 빛. 살은 여기서 그리고(막대 풀), 알갱이와 링은 파티클에 맡긴다.
  chargeFx(L, dt, u, R, ppw) {
    const span = R * SPOKE_SPAN
    // ── 살 ── 각자 제 위상으로 안쪽으로 달린다. 위상은 광선마다 따로 돈다.
    let s = this.fxT.get(L)
    if (!s) this.fxT.set(L, s = { p: 0, grain: 0, ring: 0 })
    s.p = (s.p + dt * (0.5 + 0.9 * u)) % 1
    for (let i = 0; i < SPOKES; i++) {
      const a = i * Math.PI * 2 / SPOKES + L.ox * 0.001    // 요새마다 살 배치를 조금 틀어 준다
      // 위상 — 살마다 어긋나게 굴려 한 줄로 안 몰리게 한다
      const k = (s.p + i / SPOKES) % 1
      const near = R * 0.9 + (span - R * 0.9) * k * k       // 안쪽에서 시작해 바깥으로 되감긴다
      const len = (span - near) * 0.28 + R * 0.2
      // 막대는 +x로 뻗으므로 **바깥에서 안쪽을 향해** 놓는다(각 + π)
      const bx = L.ox + Math.cos(a) * (near + len), by = L.oy + Math.sin(a) * (near + len)
      this.place(this.bolt(0xff8fb0, (0.25 + 0.55 * u) * (1 - k)),
        bx, by, a + Math.PI, len, Math.max(1.2 * ppw, 1.6), 7.9)
    }
    if (!this.parts || dt <= 0) return
    // ── 알갱이 ── 원주에서 총구로. ttl을 비행시간에 맞춰 중심에서 꺼지게 한다.
    s.grain += dt * GRAIN_RATE * (0.35 + 1.4 * u)
    const n = Math.floor(s.grain); s.grain -= n
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const d = span * (0.55 + Math.random() * 0.85)
      const ttl = 0.34 + Math.random() * 0.3
      const sp = d / ttl
      this.parts.spawn(L.ox + Math.cos(a) * d, L.oy + Math.sin(a) * d,
        -Math.cos(a) * sp, -Math.sin(a) * sp,
        _pc.setHex(Math.random() < 0.34 ? 0xffffff : 0xff5c9e),
        (4 + Math.random() * 6) * Math.max(1, ppw * 0.7), ttl, 0)
    }
    // ── 수축 링 ── 박자. 충전이 찰수록 자주 온다.
    s.ring -= dt
    if (s.ring <= 0) {
      s.ring = RING_GAP * (1.15 - 0.55 * u)
      this.parts.shock(L.ox, L.oy, span * 0.62, 0xff7da2, 0.42 + 0.2 * u,
        { thin: true, from: 2.0, to: 0.08, alpha: 0.3 + 0.45 * u })
    }
  }

  // 'spent' = 머리가 이미 박혔고 꼬리만 남은 구간. 그림은 travel과 같은 규칙을
  // 쓴다 — 다른 건 머리가 안 움직인다는 것뿐이고, 그래서 막대가 짧아진다.
  showBolt(game, L) {
    const ppw = this.rig.worldPerPx
    const spent = L.state === LASER_SPENT
    const ang = Math.atan2(L.uy, L.ux)
    // 아직 안 지나간 앞쪽이 위험한 자리다 — 회랑을 탄두 앞으로만 깔아 둔다.
    // 이미 박힌 뒤에는 앞쪽이랄 게 없으므로 회랑도 걷는다.
    if (!spent) {
      const w = Math.max(hitRadiusOf(game.earth) * 2, 3 * ppw)
      const hx = L.ox + L.ux * L.head, hy = L.oy + L.uy * L.head
      this.place(this.bolt(0xff4d6d, 0.11), hx, hy, ang, Math.max(0, L.range - L.head), w, 6.8)
    }
    // 지나간 자리는 흐릿하게 남겨 "어디서 왔는지"만 남긴다
    this.place(this.bolt(0xff4d6d, spent ? 0.14 : 0.22), L.ox, L.oy, ang, L.head, Math.max(1.4 * ppw, 2), 6.9)
    // 탄두 — 꼬리(back)에서 머리(head)까지의 막대. 이게 유일하게 움직인다.
    // 머리가 무언가에 박혀 멎어도 꼬리는 같은 속도로 계속 들어오므로,
    // 막대는 그 자리에서 **앞에서부터 잡아먹히며** 짧아지다 사라진다.
    const lit = L.head - L.back
    if (lit <= 0) return
    const bx = L.ox + L.ux * L.back, by = L.oy + L.uy * L.back
    this.place(this.bolt(0xff2d4d, 1), bx, by, ang, lit, Math.max(9 * ppw, 12), 7)
    this.place(this.bolt(0xffffff, 1), bx, by, ang, lit, Math.max(3 * ppw, 4), 7.2)
  }
}

const _pc = new THREE.Color()
