import { VIS, hitRadiusOf } from '../game/config.js'
import { toDeg180, wrapPi } from '../core/angle.js'
import { AUDIO } from '../audio/index.js'

// ─── 손으로 조준한다 ────────────────────────────────────────────
// 각도 스테퍼(0.1° / 1° / 10°)는 **원하는 각을 지나치지 않는** 대신 느리다.
// 반대편을 겨누려면 ◀◀를 열여덟 번 눌러야 하고, 손가락으로 하는 화면에서는
// 그 열여덟 번이 그대로 열여덟 번의 터치다. 그래서 큐를 직접 잡게 했다:
// **발사대나 예측선을 짚고 지구 둘레로 끌면 조준이 손끝을 따라온다.**
//
// 규칙은 넷뿐이다.
//
//  ① 잡는 자리는 **둘**이다: 발사 고리와 예측선.
//     처음에는 발사대 한 점만 잡게 했는데, 그러면 조준을 아예 못 하는 화면이
//     나온다. 세로 폰에서 패널은 화면의 6할을 덮고, 자동 프레이밍은 그 뒤로
//     내용을 흘려보내도 된다고 본다 — 계측(390×844)에서 **지구가 통째로 패널
//     뒤(지구 y=372, 패널 윗변 313)**였다. 지구에 매달린 물건은 하나도 못 만진다.
//       · 발사 고리 — 손잡이가 도는 원(지구에서 LAUNCH_OFFSET) 둘레 GRAB_PX 안.
//         손잡이 한 점이 아니라 원 전체라 트인 쪽 어디서든 잡힌다.
//       · 예측선 — 이 탄이 날아갈 길. 판을 가로질러 뻗으므로 지구가 가려도
//         거의 언제나 트인 데가 있다. "쏠 선을 잡아 돌린다"는 그림 자체도
//         큐를 잡는 것과 같다. 길이가 긴 표적이라 판정은 얇게(LINE_PX) 준다.
//     쥐는 동안 화면에도 같은 원과 같은 선이 굵게 떠오른다(Scene) — 잡히는
//     자리와 그려지는 자리가 언제나 같아야 한다.
//
//  ② **돌린 만큼 돈다**(상대). 짚은 자리로 각이 튀지 않는다 — 고리 어디를
//     잡아도 그 순간의 각은 그대로고, 손가락이 지구 둘레로 쓴 각만큼만 조준이
//     따라 돈다. 손잡이를 잡았을 때는 잡은 각 = 조준각이라 "손끝을 따라오는"
//     것과 완전히 같게 움직인다. 노브를 돌리는 것과 같은 규칙이다.
//
//  ③ 그래서 **멀리 끌수록 곱게 잡힌다.** 지구에서 60px 떨어진 손가락은 1px에
//     1°씩 돌지만, 400px 밖에서는 1px이 0.14°다. 미세 조정 모드를 따로 둘
//     이유가 없다 — 팔을 뻗는 것이 곧 미세 조정이다.
//
//  ④ **잡기 전에는, 그리고 짚기만 해서는 아무 각도 안 바뀐다.** 판 아무 데나
//     눌러서 그쪽으로 조준이 튀게 하면, 0.1°까지 맞춰 둔 각이 잘못 짚은 한 번에
//     날아간다. 이 게임에서 그건 한 판을 날리는 사고다. 각이 바뀌는 건 고리를
//     잡고 **움직였을 때**뿐이고, 판의 나머지는 지금까지대로 카메라(끌기·핀치)와
//     정보창(짚기)의 것이다.
//
// 눈금은 스테퍼와 같은 0.1°다 — 계기에 뜬 숫자와 실제 각이 다르면 그 계기는
// 거짓말이고, 이 게임의 계기는 거짓말을 하지 않는다.
//
// 카메라와의 조정은 CameraRig.grab 한 자리에서 한다. 이벤트 등록 순서에
// 기대면(나중에 등록한 쪽이 나중에 불린다) 카메라가 이미 패닝을 시작한 뒤가
// 되므로, 리그가 pointerdown마다 **먼저 물어보게** 했다.

const GRAB_PX = 44        // 발사 고리에서 이만큼 안쪽/바깥쪽까지 잡힌다(px). 손가락 끝이 대략 이만하다
const LINE_PX = 22        // 예측선은 얇게 — 판을 가로지르는 긴 표적이라 두꺼우면 판을 다 먹는다
const DEAD_PX = 3         // 이만큼은 움직여야 "끈 것"으로 친다(탭과 가른다)
const SNAP_DEG = 0.1      // 스테퍼와 같은 눈금
const TICK_DEG = 2.5      // 이만큼 지날 때마다 딸깍
const TICK_MS = 80        // 다만 이보다 촘촘하게는 안 낸다(빠르게 훑으면 소음이 된다)

const snap = (deg) => Math.round(deg / SNAP_DEG) * SNAP_DEG
// 두 각 사이의 최단 거리(°)
const dDeg = (a, b) => Math.abs(((a - b + 540) % 360) - 180)
// 점과 선분의 거리(화면 좌표)
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const L = dx * dx + dy * dy
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

export class AimPointer {
  // onChange: 각이 바뀌었다고 알릴 자리(HUD의 각도 숫자를 다시 쓴다).
  constructor(game, rig, dom, onChange) {
    this.game = game; this.rig = rig; this.dom = dom
    this.onChange = onChange ?? null
    this.id = null          // 조준을 쥐고 있는 포인터 (null = 아무도 안 쥠)
    this.mouse = null       // 마지막 마우스 자리 — 호버 판정용(손가락은 안 남긴다)
    this.hover = false
    this.moved = false
    this.from = null
    this.tickDeg = 0; this.tickAt = 0
    game.aimGrab = null     // null | 'hover' | 'drag' — 화면(Scene)과 정보창이 읽는다

    rig.grab = (e) => this.tryGrab(e)
    dom.addEventListener('pointermove', (e) => this.onMove(e))
    dom.addEventListener('pointerup', (e) => this.onUp(e))
    dom.addEventListener('pointercancel', (e) => this.onUp(e))
    // 캔버스를 벗어나면 손을 뗀 것으로 친다. 끄는 중에는 포인터 캡처가 걸려
    // 있어서 이게 안 불리고(경계 이벤트가 캡처 대상에 묶인다), 캡처가 없는
    // 환경에서만 여기로 떨어진다 — 그 경우엔 놓는 게 맞다.
    dom.addEventListener('pointerleave', (e) => { this.onUp(e); this.mouse = null; this.setHover(false) })
  }

  // ── 발사 고리는 지금 화면 어디에 있는가 ─────────────────────
  // 지구의 화면 자리와, 거기서 발사대까지의 화면 거리(px). 조준할 수 없는
  // 동안에는 없다 — 화면에 안 그려지는 것을 잡게 두면 그게 거짓말이다.
  // (예고편이 도는 동안도 마찬가지다. 그 화면은 전부 저쪽 몫이다.)
  ring() {
    const g = this.game
    if (!g.canAim || g.bare || g.trailer || g.cinematic) return null
    const e = g.earth, p = g.launchPos()
    const c = this.rig.worldToScreen(e.pos.x, e.pos.y)
    const h = this.rig.worldToScreen(p.x, p.y)
    return { c, r: Math.hypot(h.x - c.x, h.y - c.y) }
  }

  // 이 자리를 눌렀을 때 조준을 잡는가 (발사 고리 또는 예측선).
  // 판정은 월드가 아니라 **화면 좌표**로 한다 — 잡히는 두께는 손가락 크기로
  // 정해져야 하고, 발사대 표식 자체가 줌과 무관하게 같은 크기로 그려진다.
  hits(sx, sy) {
    const g = this.ring()
    if (!g) return false
    // 지구만은 뺀다 — 짚으면 제원이 뜨고 끌면 카메라가 도는, 판 위의 다른 공과
    // 똑같은 물건이어야 한다. 줌아웃하면 고리가 지구 코앞까지 붙는데(140 GU가
    // 30px이 된다), 그때 고리가 지구를 통째로 덮으면 그 둘을 만질 수 없다.
    const d = Math.hypot(sx - g.c.x, sy - g.c.y)
    const rPx = Math.max(hitRadiusOf(this.game.earth) / this.rig.worldPerPx, VIS.MIN_PLANET_PX * 0.5) + 6
    if (d <= rPx) return false
    return Math.abs(d - g.r) <= GRAB_PX || this.onPath(sx, sy)
  }

  // 예측선 위인가. game.predictPath()는 조준 중에 이미 매 프레임 불리는 값이라
  // (HUD·렌더러) 여기서 한 번 더 물어도 캐시가 그대로 돌아온다 — 다시 풀지 않는다.
  onPath(sx, sy) {
    const pts = this.game.predictPath().pts
    if (!pts || pts.length < 2) return false
    let a = this.rig.worldToScreen(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      const b = this.rig.worldToScreen(pts[i].x, pts[i].y)
      if (segDist(sx, sy, a.x, a.y, b.x, b.y) <= LINE_PX) return true
      a = b
    }
    return false
  }

  // 지구에서 이 화면 자리를 본 각(라디안). 지구 한복판에는 각이 없다 —
  // 손가락이 거기까지 들어오면 null을 돌려주고 부르는 쪽이 마지막 각을 지킨다
  // (atan2(0,0)은 0이라, 안 막으면 조준이 0°로 튄다).
  angleAt(sx, sy) {
    const w = this.rig.screenToWorld(sx, sy)
    const e = this.game.earth.pos
    const dx = w.x - e.x, dy = w.y - e.y
    return Math.hypot(dx, dy) < 8 * this.rig.worldPerPx ? null : Math.atan2(dy, dx)
  }

  // ── CameraRig가 pointerdown마다 물어보는 자리 ───────────────
  // 참을 돌려주면 그 손가락은 조준의 것이 되고, 카메라는 아예 못 본 것으로
  // 친다(패닝도, 핀치 계산도 없다).
  tryGrab(e) {
    if (this.id !== null) return false
    if (!this.hits(e.clientX, e.clientY)) return false
    this.id = e.pointerId
    this.moved = false
    this.from = { x: e.clientX, y: e.clientY }
    // 잡은 순간의 조준각과 손가락 각을 기억한다. 조준은 그 뒤로 손가락이
    // **쓴 각만큼만** 돈다(규칙 ②) — 고리 어디를 잡든 잡는 순간엔 안 움직인다.
    this.grabAim = this.game.aim
    this.lastAng = this.angleAt(e.clientX, e.clientY) ?? this.game.aim
    this.turn = 0
    this.tickDeg = toDeg180(this.game.aim); this.tickAt = performance.now()
    // ── 쥐고 있는 동안에는 카메라가 멎는다 ──────────────────────
    // 자동 프레이밍은 발사대도 화면 안에 잡아 둔다(autoFrame). 그래서 각을
    // 돌리면 카메라가 그만큼 미끄러지는데, 끌고 있는 중에는 그게 되돌아온다:
    // 카메라가 밀리면 **손가락 밑의 월드 좌표가 바뀌고**, 각은 그 좌표로 정해지니
    // 손을 멈춰도 각이 혼자 흘러간다(계측: 한 번 끌 때 8.8° 밀렸다).
    // 손이 안 움직이는데 각이 변하면 그건 조준이 아니다. 놓으면 되돌려 준다 —
    // 그때부터는 스테퍼로 각을 바꿀 때와 똑같이 카메라가 따라가면 된다.
    this.autoWas = this.rig.auto
    this.rig.auto = false
    // 아직은 탭이다. 정말 움직였을 때만 드래그로 바꾼다(onMove) — 발사대 옆을
    // 톡 짚었을 뿐인데 그 아래 공의 제원 창이 안 뜨면 그게 더 이상하다.
    this.rig.dragged = false
    try { this.dom.setPointerCapture?.(e.pointerId) } catch { /* 없어도 굴러간다 */ }
    this.sync()
    return true
  }

  onMove(e) {
    if (e.pointerType === 'mouse') this.mouse = { x: e.clientX, y: e.clientY }
    if (this.id === null) {
      // 마우스만: 커서가 고리 위에 오면 "잡을 수 있다"고 알려 준다(커서 + 고리 표시).
      if (e.pointerType === 'mouse') this.setHover(this.hits(e.clientX, e.clientY))
      return
    }
    if (e.pointerId !== this.id) return
    if (!this.ring()) { this.release(); return }   // 쥔 채로 판이 넘어갔다
    if (!this.moved) {
      if (Math.abs(e.clientX - this.from.x) + Math.abs(e.clientY - this.from.y) <= DEAD_PX) return
      this.moved = true
      // 이 손가락은 판을 짚은 게 아니다 — 정보창(Inspector)이 이 표식으로
      // 탭과 드래그를 가른다. 카메라가 쓰는 것과 같은 뜻의 같은 깃발이다.
      this.rig.dragged = true
      this.sync()
    }
    this.aimAt(e.clientX, e.clientY)
  }

  onUp(e) {
    if (this.id === null || (e && e.pointerId !== this.id)) return
    this.release()
  }

  // 손가락이 지구 둘레로 쓴 각만큼 조준을 돌린다(규칙 ②).
  // 손잡이를 잡았으면 잡은 각이 곧 조준각이라 "손끝을 그대로 따라오는" 것과
  // 같아지고, 고리의 다른 자리를 잡았으면 그 차이가 끝까지 유지된다.
  aimAt(sx, sy) {
    const ang = this.angleAt(sx, sy)
    if (ang === null) return
    // atan2는 ±180°에서 끊긴다. 그 자리를 지날 때 두 각의 차를 그대로 쓰면
    // 조준이 반대로 한 바퀴 돈다 — 프레임마다의 차를 (-π, π]로 접어서 쌓는다.
    this.turn += wrapPi(ang - this.lastAng)
    this.lastAng = ang
    const deg = snap(toDeg180(this.grabAim + this.turn))
    const rad = deg * Math.PI / 180
    if (rad === this.game.aim) return
    this.game.aim = rad
    this.onChange?.()
    this.click(deg)
  }

  // 딸깍 — 스테퍼가 한 칸에 한 번 내는 그 소리를 끌 때도 낸다. 얼마나 돌렸는지를
  // 손끝이 아니라 귀로 세게 해 주는 장치다. 각으로 한 번, 시간으로 한 번
  // 두 겹으로 성기게 걸러야 훑을 때 소음이 되지 않는다.
  click(deg) {
    const now = performance.now()
    if (dDeg(deg, this.tickDeg) < TICK_DEG || now - this.tickAt < TICK_MS) return
    this.tickDeg = deg; this.tickAt = now
    AUDIO.ui('uiTick', 0.5)
  }

  setHover(on) { if (this.hover !== on) { this.hover = on; this.sync() } }

  release() {
    if (this.id === null) return
    try { this.dom.releasePointerCapture?.(this.id) } catch { /* 무시 */ }
    this.id = null; this.from = null; this.moved = false
    if (this.autoWas) this.rig.auto = true    // 자동 프레이밍을 쥐기 전으로
    this.autoWas = false
    this.sync()
  }

  // 매 프레임 — 손잡이는 손이 가만히 있어도 움직인다(지구가 돌고, 카메라가
  // 그걸 따라간다). 커서 밑에 있던 것이 아직 거기 있는지는 그때마다 다시 묻는다.
  update() {
    if (this.id !== null) return
    this.setHover(!!this.mouse && this.hits(this.mouse.x, this.mouse.y))
  }

  // 지금 상태를 밖에 알린다: 커서(데스크톱)와 game.aimGrab(발사대 표시·정보창).
  sync() {
    const s = this.id !== null ? 'drag' : this.hover ? 'hover' : null
    this.game.aimGrab = s
    this.dom.classList.toggle('grabbing', s === 'drag')
    this.dom.classList.toggle('grab', s === 'hover')
  }
}
