import * as THREE from 'three'
import { CFG, VIS, hitRadiusOf } from '../game/config.js'

// §14.1 카메라 — 탑다운 원근 뷰 + 자동 프레이밍 + 휠/핀치 줌 + 드래그 패닝.
// 세로 화면(아이패드 세로)에서 옆이 잘리던 버그의 원인은 "높이만 맞추는 핏"이었다.
// 여기서는 가로/세로 요구치를 둘 다 계산해 짧은 축 기준으로 맞춘다.
export class CameraRig {
  constructor(game, dom) {
    this.game = game; this.dom = dom
    this.camera = new THREE.PerspectiveCamera(VIS.FOV, 1, 1, VIS.SKY_FAR * 2)
    this.camera.up.set(0, 1, 0)
    this.center = new THREE.Vector2(0, 0)
    this.halfH = game.aMax * VIS.FULL_FIT
    this.auto = true          // 자동 프레이밍 (사용자가 만지면 해제)
    this.shake = 0            // 남은 세기(px 진폭) — hit()가 채우고 update()가 뺀다
    this.shakeT = 0           // 이번 충격이 시작된 뒤 흐른 시간(초)
    this.shakeAx = 1; this.shakeAy = 0   // 이번 충격이 흔드는 축(단위벡터)
    this.aspect = 1
    this.pointers = new Map()
    this.pinch = null
    this.dragged = false
    // 이 손가락을 먼저 가져갈 사람 — 조준 드래그(AimPointer)가 여기에 앉는다.
    // 등록 순서로 정하지 않고 리그가 직접 물어보는 이유는 아래 pointerdown 참조.
    this.grab = null
    this.inset = { l: 0, r: 0, t: 0, b: 0 }       // 프레이밍용(상한을 건 값)
    this.insetFull = { l: 0, r: 0, t: 0, b: 0 }   // 실제로 가려진 영역(px)
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
  // 여기서는 상한을 걸지 않은 insetFull을 쓴다. 프레이밍은 "패널 뒤로 좀 흘려도
  // 된다"지만, 라벨은 흘리면 그냥 안 보인다 — 글자는 트인 곳에만 놓는다.
  visibleRect() {
    const w = this.worldPerPx, i = this.insetFull
    return {
      x0: this.center.x - this.halfW + i.l * w,
      x1: this.center.x + this.halfW - i.r * w,
      y0: this.center.y - this.halfH + i.b * w,
      y1: this.center.y + this.halfH - i.t * w,
    }
  }

  attachHud(el) { this.hud = el }

  // 패널이 어느 변에 붙어 있는지 보고 그만큼을 "못 쓰는 화면"으로 잡는다.
  // 이게 없으면 자동 프레이밍이 지구/목표를 패널 뒤에 숨겨 놓는다.
  //
  // 어느 변인지는 **남는 공간**으로 판단한다. 예전에는 패널의 윗변이 화면
  // 중간보다 아래인지로 봤는데(r.top > H/2), 패널이 커지면서 아래에 도킹된
  // 패널의 윗변이 화면 37% 지점에 오게 됐다 — 그때부터 이 검사가 "위에
  // 붙었다"고 답했고, 카메라는 판을 **패널 뒤로** 밀어 넣었다.
  // (계측: 세로 390×844에서 중심 y가 2041, 도착한 요새 셋 중 하나만 화면에.)
  // 붙어 있는 변에는 틈이 거의 없다 — 그 사실로 판단하면 패널 높이와 무관하다.
  //
  // 상한(MAX_INSET)은 "화면을 다 먹은 셈 치지는 않는다"는 뜻이다. 패널이 62%를
  // 덮는다고 남은 38%에 성계를 다 우겨넣으면, 자동 프레이밍이 판을 2.6배
  // 뒤로 빼서 공이 점이 된다. 절반까지만 인정하고 나머지는 패널 뒤로 흘린다 —
  // 패널은 반투명이고, 정작 봐야 할 것(지구·표적·탄두)은 여전히 트인 쪽에 온다.
  updateInsets() {
    const i = this.inset, f = this.insetFull
    i.l = i.r = i.t = i.b = f.l = f.r = f.t = f.b = 0
    if (!this.hud) return
    const r = this.hud.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const W = innerWidth, H = innerHeight, gap = 10
    const MAX = 0.5
    if (r.width >= W * 0.7) {   // 가로 전체를 차지하는 도킹(태블릿/모바일)
      const above = r.top, below = H - r.bottom
      const HI = H * 0.9   // 화면이 통째로 가려진 셈이 되지 않게(라벨이 갈 곳은 남긴다)
      if (below <= above) f.b = Math.min(HI, H - r.top + gap)
      else f.t = Math.min(HI, r.bottom + gap)
      i.b = Math.min(H * MAX, f.b); i.t = Math.min(H * MAX, f.t)
    } else {
      const left = r.left, right = W - r.right
      const WI = W * 0.9
      if (left <= right) f.l = Math.min(WI, r.right + gap)
      else f.r = Math.min(WI, W - r.left + gap)
      i.l = Math.min(W * MAX, f.l); i.r = Math.min(W * MAX, f.r)
    }
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

  // §14.1 성계 전체 뷰 = a_max × 1.15 (패널에 가린 만큼 보정)
  // 이 버튼 하나만은 상한 없는 insetFull을 쓴다. "전체"라고 써 놓고 바깥 궤도를
  // 패널 뒤에 숨겨 두면 그건 전체가 아니다 — 작아지더라도 다 보이는 쪽이 맞다.
  fullView() {
    this.updateInsets()
    const W = innerWidth, H = innerHeight, i = this.insetFull
    const visW = Math.max(80, W - i.l - i.r)
    const visH = Math.max(80, H - i.t - i.b)
    const R = this.game.aMax * VIS.FULL_FIT
    this.halfH = Math.max(R * (H / visH), R * (W / visW) / this.aspect)
    const wpp = 2 * this.halfH / Math.max(1, H)
    this.center.set(-((i.l + visW / 2) - W / 2) * wpp, ((i.t + visH / 2) - H / 2) * wpp)
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

    // 끌기가 브라우저의 "글 고르기"로 새지 않게 한다 ─────────────
    // 캔버스를 누르고 끌면 브라우저는 그것을 텍스트 선택의 시작으로 읽는다.
    // 판 위에는 글이 없지만 그 위에 얹힌 HUD에는 있어서, 조준하려고 끄는 동안
    // 패널 문구가 통째로 파랗게 잡히고 손을 떼도 남는다. CSS(user-select:none)로
    // 문서 전체를 잠갔고, 여기서 기본 동작 자체를 한 번 더 끊는다 — 잠금을
    // 안 지키는 브라우저가 있어도 이 자리에서 막힌다.
    // 끊는 시점은 **판정보다 앞**이다. locked이든 조준이 이 손가락을 가져가든
    // 선택은 끌기의 첫 프레임에 시작되므로, 그 뒤에 막으면 이미 늦다.
    el.addEventListener('pointerdown', (e) => {
      if (e.cancelable) e.preventDefault()
      // 기본 동작을 끊으면 포커스도 안 옮겨진다. 그대로 두면 방금 누른 HUD
      // 버튼이 계속 포커스를 쥐고 있어서 SPACE가 발사와 그 버튼을 동시에
      // 때린다 — 원래 캔버스를 누르면 풀리던 것이니 손으로 풀어 준다.
      const act = document.activeElement
      if (act && act !== document.body && act.blur) act.blur()
      if (this.locked) return
      // 조준이 이 손가락을 먼저 가져갈 수 있다(발사대를 짚었을 때). 가져갔으면
      // 카메라는 그 손가락을 **아예 못 본 것으로** 친다 — pointers에 넣지 않으니
      // 패닝도, 두 손가락 핀치 계산도 이 손가락을 세지 않는다.
      // 순서를 이벤트 등록 순서에 맡기지 않는 이유가 여기 있다: 나중에 등록한
      // 쪽이 나중에 불리므로, 조준이 자기 차례를 받았을 때는 이미 카메라가
      // 패닝을 시작한 뒤가 된다(끌기 시작한 첫 몇 px이 판을 흔든다).
      if (this.grab?.(e)) return
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
    // 위의 preventDefault가 듣지 않는 경로(합성 마우스 이벤트로 시작하는
    // 선택, 캔버스를 이미지처럼 끌어가기)를 여기서 닫는다.
    el.addEventListener('selectstart', (e) => e.preventDefault())
    el.addEventListener('dragstart', (e) => e.preventDefault())
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
  // ── 화면 흔들림 ──
  // 두 가지를 고쳤다.
  //
  // ① 세기의 단위. 예전에는 진폭을 **월드 좌표(GU)** 그대로 center에 더했다.
  //    화면에서의 크기는 줌에 반비례하므로(worldPerPx) 같은 hit(14)라도 줌인
  //    상태에서는 진폭이 몇 배로 뛰었다. 이제는 px로 재고 쓸 때 환산한다 —
  //    어느 줌에서나 같은 크기로 흔들린다.
  //
  // ② 흔드는 결. 예전에는 매 프레임 Math.random()으로 튕겼다. 60Hz 백색잡음이라
  //    **얇고 밝은 가산 리본(궤적)이 진폭만큼 번졌다** — 레이저가 나가는 순간
  //    (hit(14)) 성계의 트레일이 통째로 두꺼워져 보인 것이 이것이다.
  //    계측: 그 순간 리본 폭·줌·trailFlash는 전부 그대로였고(5.30px → 5.29px),
  //    바뀌는 값은 shake 하나뿐이었다. 진폭 ±14px가 5.5px 리본에 얹히면
  //    잔상 폭이 30px를 넘는다.
  //    지금은 충격마다 축을 하나 정하고 그 축으로 감쇠 진동한다. 눈이 따라갈 수
  //    있는 결이라 번지지 않고 "쿵" 하는 한 방으로 읽힌다.
  hit(strength) {
    this.shake = Math.min(VIS.SHAKE_MAX, this.shake + strength)
    const a = Math.random() * Math.PI * 2
    this.shakeAx = Math.cos(a); this.shakeAy = Math.sin(a)
    this.shakeT = 0
  }

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
    // 감쇠 진동 — 진폭(px)은 빠르게 줄고, 그 위에 SHAKE_HZ의 흔들림이 얹힌다.
    // 진폭을 월드로 환산해 쓰므로 줌과 무관하게 같은 크기로 보인다.
    let sx = 0, sy = 0
    if (this.shake > 0.05) {
      this.shakeT += dt
      this.shake = Math.max(0, this.shake - this.shake * 7 * dt - 2 * dt)
      const s = Math.sin(this.shakeT * VIS.SHAKE_HZ * Math.PI * 2)
        * Math.exp(-this.shakeT * 8) * this.shake * VIS.SHAKE_PX * this.worldPerPx
      sx = this.shakeAx * s; sy = this.shakeAy * s
    } else this.shake = 0
    const dist = this.halfH / Math.tan(VIS.FOV * Math.PI / 360)
    this.camera.aspect = this.aspect
    this.camera.position.set(this.center.x + sx, this.center.y + sy, dist)
    this.camera.lookAt(this.center.x + sx, this.center.y + sy, 0)
    this.camera.near = Math.max(1, dist * 0.02)
    // 원거리면은 **하늘까지** 덮어야 한다. 예전엔 dist*4였는데, 그러면 줌인할수록
    // 같이 당겨져서 제일 뒤 별층이 잘려 나갔다(halfH 600이면 far 6252 < 별층 8563).
    // 은하 원반은 z=-34000에 있으므로 아예 고정 여유를 얹는다.
    // near/far 비가 커져도 2000:1 수준이라 24비트 깊이 버퍼에 무리가 없다.
    this.camera.far = dist * 4 + VIS.SKY_FAR
    this.camera.updateProjectionMatrix()
  }
}
