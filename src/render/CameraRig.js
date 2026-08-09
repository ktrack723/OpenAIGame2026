import * as THREE from 'three'
import { CFG, VIS, hitRadiusOf } from '../game/config.js'

// §14.1 카메라 — 탑다운 원근 뷰 + 자동 프레이밍 + 휠/핀치 줌 + 드래그 패닝.
// 세로 화면(아이패드 세로)에서 옆이 잘리던 버그의 원인은 "높이만 맞추는 핏"이었다.
// 여기서는 가로/세로 요구치를 둘 다 계산해 짧은 축 기준으로 맞춘다.
export class CameraRig {
  constructor(game, dom) {
    this.game = game; this.dom = dom
    this.camera = new THREE.PerspectiveCamera(VIS.FOV, 1, 1, 60000)
    this.camera.up.set(0, 1, 0)
    this.center = new THREE.Vector2(0, 0)
    this.halfH = game.aMax * VIS.FULL_FIT
    this.auto = true          // 자동 프레이밍 (사용자가 만지면 해제)
    this.shake = 0
    this.aspect = 1
    this.pointers = new Map()
    this.pinch = null
    this.dragged = false
    this.inset = { l: 0, r: 0, t: 0, b: 0 }   // HUD가 가리는 영역(px)
    this.hud = null
    this.bindInput()
    this.snapToAuto()
  }

  // ── 화면 ↔ 월드 ─────────────────────────────────────────────
  get halfW() { return this.halfH * this.aspect }
  get worldPerPx() { return (2 * this.halfH) / Math.max(1, innerHeight) }

  screenToWorld(sx, sy) {
    return {
      x: this.center.x + (sx / innerWidth * 2 - 1) * this.halfW,
      y: this.center.y - (sy / innerHeight * 2 - 1) * this.halfH,
    }
  }

  // 위의 역변환 — 월드 좌표 위에 DOM을 얹을 때 쓴다(조르그 교신창).
  worldToScreen(wx, wy) {
    return {
      x: ((wx - this.center.x) / this.halfW + 1) / 2 * innerWidth,
      y: (1 - (wy - this.center.y) / this.halfH) / 2 * innerHeight,
    }
  }

  // HUD 패널에 가려지지 않는 실제 가시 영역 (월드 좌표)
  visibleRect() {
    const w = this.worldPerPx
    return {
      x0: this.center.x - this.halfW + this.inset.l * w,
      x1: this.center.x + this.halfW - this.inset.r * w,
      y0: this.center.y - this.halfH + this.inset.b * w,
      y1: this.center.y + this.halfH - this.inset.t * w,
    }
  }

  attachHud(el) { this.hud = el }

  // 패널이 어느 변에 붙어 있는지 보고 그만큼을 "못 쓰는 화면"으로 잡는다.
  // 이게 없으면 자동 프레이밍이 지구/목표를 패널 뒤에 숨겨 놓는다.
  updateInsets() {
    const i = this.inset
    i.l = i.r = i.t = i.b = 0
    if (!this.hud) return
    const r = this.hud.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const W = innerWidth, H = innerHeight, gap = 10
    if (r.width >= W * 0.7) {   // 가로 전체를 차지하는 도킹(태블릿/모바일)
      if (r.top > H / 2) i.b = Math.min(H * 0.62, H - r.top + gap)
      else i.t = Math.min(H * 0.62, r.bottom + gap)
    } else if (r.left < W / 2) i.l = Math.min(W * 0.62, r.right + gap)
    else i.r = Math.min(W * 0.62, W - r.left + gap)
  }

  // ── 개막 프레이밍: 지금 워프해 들어오는 것들 ────────────────
  // 막이 내려간 동안은 조준선도 발사대도 없다. 그러니 지구와 목표를 잡을
  // 이유도 없다 — 플레이어가 봐야 하는 건 **지금 도착하는 그것**이다.
  //
  // 아직 안 온 것은 프레임에 안 넣는다. 그래서 상자가 한 기씩 도착할 때마다
  // 자라고, 카메라가 그만큼 밀려간다 — "스폰을 따라 이동한다"가 이 한 줄이다.
  // (다 온 뒤에는 상자가 안 변하므로 뜸(WARP_SETTLE) 동안 조용히 멎어 있는다.)
  arrivalPts() {
    const list = this.game.arrivals
    if (!list || !list.length) return null
    const pts = []
    for (const b of list) {
      if (b.warpIn > 0) continue
      pts.push({ x: b.pos.x, y: b.pos.y, r: Math.max(150, hitRadiusOf(b) * 3.4) })
    }
    // 첫 한 기가 닿기 전에는 그 자리를 미리 잡아 둔다 — 빈 상자로 튀지 않게
    if (!pts.length) pts.push({ x: list[0].pos.x, y: list[0].pos.y, r: 260 })
    return pts
  }

  // ── 자동 프레이밍: 태양·지구·목표·비행 중 미사일이 항상 "보이는 영역" 안 ──
  autoFrame() {
    const g = this.game
    let pts = g.warpCurtain ? this.arrivalPts() : null
    if (!pts) {
      pts = [{ x: 0, y: 0, r: CFG.R_STAR * 1.6 }]
      const push = (b, pad) => { if (b && b.alive) pts.push({ x: b.pos.x, y: b.pos.y, r: b.radius * pad }) }
      push(g.earth, CFG.SWING_ZONE)
      push(g.target, CFG.SWING_ZONE + 2)
      if (g.canAim) { const p = g.launchPos(); pts.push({ x: p.x, y: p.y, r: 60 }) }   // 발사대도 화면 안에
      for (const m of g.missiles) if (m.alive) pts.push({ x: m.pos.x, y: m.pos.y, r: 70 })
      // 폭발은 이 게임의 보상이다 — 화면 밖에서 터지면 못 본다. 잠깐 프레임에 붙잡아 둔다.
      if (this.focusPt && this.focusPt.t > 0) pts.push(this.focusPt)
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const p of pts) {
      x0 = Math.min(x0, p.x - p.r); x1 = Math.max(x1, p.x + p.r)
      y0 = Math.min(y0, p.y - p.r); y1 = Math.max(y1, p.y + p.r)
    }
    const W = innerWidth, H = innerHeight
    const visW = Math.max(80, W - this.inset.l - this.inset.r)
    const visH = Math.max(80, H - this.inset.t - this.inset.b)
    // 가로 요구치는 aspect로 나눠 세로 기준으로 환산 — 이게 없으면 세로 화면에서 옆이 잘린다.
    // 여기에 (전체/가시) 비율을 곱해 패널이 먹은 만큼을 보정한다.
    const need = Math.max((y1 - y0) / 2 * (H / visH), (x1 - x0) / 2 * (W / visW) / this.aspect) * VIS.FIT_MARGIN
    const lo = this.game.aMax * 0.10, hi = this.game.aMax * VIS.FULL_FIT
    const h = Math.min(hi, Math.max(lo, need))
    // 콘텐츠 중심이 "가시 영역의 중심"에 오도록 카메라 중심을 밀어준다
    const wpp = 2 * h / Math.max(1, H)
    const ox = (this.inset.l + visW / 2) - W / 2
    const oy = (this.inset.t + visH / 2) - H / 2
    return { cx: (x0 + x1) / 2 - ox * wpp, cy: (y0 + y1) / 2 + oy * wpp, h }
  }

  snapToAuto() {
    this.updateInsets()
    const f = this.autoFrame()
    this.center.set(f.cx, f.cy); this.halfH = f.h; this.auto = true
  }

  fullView() {   // §14.1 성계 전체 뷰 = a_max × 1.15 (패널에 가린 만큼 보정)
    this.updateInsets()
    const W = innerWidth, H = innerHeight
    const visW = Math.max(80, W - this.inset.l - this.inset.r)
    const visH = Math.max(80, H - this.inset.t - this.inset.b)
    const R = this.game.aMax * VIS.FULL_FIT
    this.halfH = Math.max(R * (H / visH), R * (W / visW) / this.aspect)
    const wpp = 2 * this.halfH / Math.max(1, H)
    this.center.set(-((this.inset.l + visW / 2) - W / 2) * wpp, ((this.inset.t + visH / 2) - H / 2) * wpp)
    this.auto = false
  }

  // ── 줌 ──────────────────────────────────────────────────────
  get zoom() { return (this.game.aMax * VIS.FULL_FIT) / this.halfH }

  zoomBy(f, sx = innerWidth / 2, sy = innerHeight / 2) {
    const base = this.game.aMax * VIS.FULL_FIT
    const min = base / VIS.ZOOM_MAX, max = base / VIS.ZOOM_MIN
    const next = Math.min(max, Math.max(min, this.halfH / f))
    if (next === this.halfH) { this.auto = false; return }
    const w = this.screenToWorld(sx, sy), k = next / this.halfH
    this.center.x = w.x + (this.center.x - w.x) * k
    this.center.y = w.y + (this.center.y - w.y) * k
    this.halfH = next; this.auto = false
    this.clampCenter()
  }

  panBy(dxPx, dyPx) {
    const s = this.worldPerPx
    this.center.x -= dxPx * s; this.center.y += dyPx * s
    this.auto = false
    this.clampCenter()
  }

  clampCenter() {
    const lim = this.game.aMax * 1.9
    this.center.x = Math.max(-lim, Math.min(lim, this.center.x))
    this.center.y = Math.max(-lim, Math.min(lim, this.center.y))
  }

  // ── 입력: 휠 / 드래그 / 두 손가락 핀치 ───────────────────────
  // 개막 중에는 전부 막는다. 그 구간의 카메라는 **연출이 몰고 있고**(도착하는
  // 요새를 따라간다), 그 사이에 플레이어가 끌거나 줌하면 자동 프레이밍이
  // 꺼져서 정작 무엇이 왔는지를 놓친다. 화면에서 조작 패널을 걷는 것과 같은
  // 이유다 — 아직 내 차례가 아니다.
  get locked() { return !!this.game.warpCurtain }

  bindInput() {
    const el = this.dom
    el.style.touchAction = 'none'
    el.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (this.locked) return
      this.zoomBy(Math.pow(1.0016, -e.deltaY), e.clientX, e.clientY)
    }, { passive: false })

    el.addEventListener('pointerdown', (e) => {
      if (this.locked) return
      el.setPointerCapture?.(e.pointerId)
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      this.dragged = false
      if (this.pointers.size === 2) this.pinch = this.pinchState()
    })
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId)
      if (!p) return
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX; p.y = e.clientY
      if (Math.abs(dx) + Math.abs(dy) > 2) this.dragged = true
      if (this.pointers.size === 1) this.panBy(dx, dy)
      else if (this.pointers.size === 2 && this.pinch) {
        const now = this.pinchState()
        if (now.d > 0 && this.pinch.d > 0) this.zoomBy(now.d / this.pinch.d, now.x, now.y)
        this.panBy(now.x - this.pinch.x, now.y - this.pinch.y)
        this.pinch = now
      }
    })
    const up = (e) => {
      this.pointers.delete(e.pointerId)
      this.pinch = this.pointers.size === 2 ? this.pinchState() : null
    }
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', up)
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return
      if (this.locked) return
      if (e.key === '+' || e.key === '=') this.zoomBy(VIS.ZOOM_STEP)
      else if (e.key === '-' || e.key === '_') this.zoomBy(1 / VIS.ZOOM_STEP)
      else if (e.key === '0') this.snapToAuto()
      else if (e.key === '9') this.fullView()
    })
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()]
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  // ── 프레임 갱신 ─────────────────────────────────────────────
  hit(strength) { this.shake = Math.min(VIS.SHAKE_MAX, this.shake + strength) }

  // 자동 프레이밍이 잠시 물고 있을 지점 (폭발 지점 등)
  focus(x, y, r = 220, t = 3) { this.focusPt = { x, y, r, t } }

  // 연출용 하드 프레이밍 — 자동 프레이밍을 끄고 지정한 자리를 그대로 잡는다.
  // (오프닝 예고편의 컷 전환처럼 "카메라가 여기를 본다"가 확정이어야 할 때만.)
  //
  // halfH는 "이만큼은 보여야 한다"는 요구치다. HUD 패널이 화면을 덮고 있으면
  // 그만큼 줌을 빼고 중심을 밀어, **가려지지 않는 영역**의 한가운데에 (x,y)가
  // 오게 한다. 이게 없으면 연출 컷이 매번 패널 뒤에서 벌어진다.
  frame(x, y, halfH) {
    this.auto = false
    this.updateInsets()
    const W = innerWidth, H = innerHeight
    const visW = Math.max(80, W - this.inset.l - this.inset.r)
    const visH = Math.max(80, H - this.inset.t - this.inset.b)
    this.halfH = Math.max(120, halfH * Math.max(H / visH, W / visW))
    const wpp = 2 * this.halfH / Math.max(1, H)
    this.center.set(
      x - ((this.inset.l + visW / 2) - W / 2) * wpp,
      y + ((this.inset.t + visH / 2) - H / 2) * wpp,
    )
  }

  update(dt) {
    this.aspect = Math.max(0.2, innerWidth / Math.max(1, innerHeight))
    this.updateInsets()
    if (this.focusPt && this.focusPt.t > 0) this.focusPt.t -= dt
    // 개막이 시작되면 자동 프레이밍을 되돌린다. 지난 판에서 플레이어가 끌어
    // 놓은 카메라를 그대로 두면 새 요새가 화면 밖에서 도착한다.
    if (this.locked) this.auto = true
    if (this.auto) {   // 자동 모드: 목표 프레임으로 부드럽게 수렴 (스윙바이 리드 포함)
      const f = this.autoFrame(), k = 1 - Math.pow(0.002, dt)
      this.center.x += (f.cx - this.center.x) * k
      this.center.y += (f.cy - this.center.y) * k
      this.halfH += (f.h - this.halfH) * k
    }
    this.shake = Math.max(0, this.shake - this.shake * 6 * dt - 2 * dt)
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0
    const sy = this.shake ? (Math.random() - 0.5) * this.shake : 0
    const dist = this.halfH / Math.tan(VIS.FOV * Math.PI / 360)
    this.camera.aspect = this.aspect
    this.camera.position.set(this.center.x + sx, this.center.y + sy, dist)
    this.camera.lookAt(this.center.x + sx, this.center.y + sy, 0)
    this.camera.near = Math.max(1, dist * 0.02)
    this.camera.far = dist * 4
    this.camera.updateProjectionMatrix()
  }
}
