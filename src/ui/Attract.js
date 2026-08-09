import { CFG, hitRadiusOf } from '../game/config.js'
import { LASER_CHARGE, LASER_IDLE, LASER_TRAVEL } from '../game/laser.js'
import { makeGoal } from '../game/objectives.js'
import { cloneBodies, stepBodies, stepMissile } from '../game/physics.js'
import { effDv } from '../game/roles.js'

// ─── 오프닝 예고편 — 한 판의 긴 한 수 ───────────────────────────
// 짧은 컷을 여러 개 이어 붙이지 않는다. **한 번의 발사가 끝까지 굴러가는 것**을
// 처음부터 끝까지 한 호흡으로 보여 준다:
//
//   ① 평화 — 아무 일도 없는 성계. 공들이 제 궤도를 돈다.
//   ② 워프 — 조르그가 들어온다. 카메라가 그리로 옮겨 가고, 저쪽이 한 마디 한다.
//   ③ 광선 — 지구를 겨눠 몇 발 쏜다. 빗나간다. **아직은.**
//   ④ 예측 — 조준 패널 없이 **예측선만.** 지구에서 나간 선이 가스 행성을
//      끼고 휘어 돌아 표적에 꽂히는 게 한 화면에 그려진다. 이 게임이 무엇을
//      계산해 주는지가 이 한 컷에 다 있다.
//   ⑤ 발사 + 스윙바이 — 그 선대로 탄두가 실제로 날아 휘어 돈다.
//   ⑥ 쾅 — 핵이 행성 한 대를 후려치고, 밀려난 그 행성이 굴러가
//      **레이저를 충전 중이던** 조르그 본성을 그대로 들이받는다.
//   → 요새 격파 · 레이저 침묵 → 로고.
//
// **끊는 데가 없다.** ①부터 ⑥까지 판을 다시 세우는 일이 없고, 카메라도 튀지
// 않는다 — 처음부터 끝까지 한 화면이다. 그러면서 행성은 내내 공전한다.
//
// 이 둘을 같이 하려면 순서를 뒤집어야 한다. 궤적 풀이(solveShot)는 **지금 이
// 순간의 좌표**를 놓고 푼 답이라, 몇십 초를 흘려보낸 뒤에 쏘면 더는 맞지 않는다
// (계측: 24초 흘리면 12시드 중 7건, 63초면 1건만 성공). 그래서 무대는 **발사
// 시점**에 맞춰 풀어 두고, 판을 그만큼 **거꾸로 감아** 거기서 ①을 시작한다.
// ①~③ 동안 되감은 만큼을 정확히 되밟으면 ④에 도착했을 때 판은 풀이 그대로다.
// 도약 적분은 시간대칭이라 이 왕복이 정확하다(계측: 복귀오차 8e-13 GU).
//
// 그려 놓은 그림이 아니다. 실제 게임을 굴린다 — 같은 렌더러, 같은 HUD, 같은
// 폭발, 같은 물리. 이 파일이 하는 일은 **판을 세우는 것 하나**다. 세팅이 끝나면
// game.fire() 한 번이 나가고, 그 뒤는 전부 게임이 스스로 굴린다.
//
// 그래서 세팅을 눈대중으로 할 수 없다. 시드는 매일 바뀌고 성계 배치도 매일
// 달라지므로, 스윙바이 궤적과 표적 위치를 **매번 수치로 푼다**(solveShot).
// 글자는 없다 — 화면에 뜨는 문구는 전부 게임이 스스로 띄우는 HUD다.

const PEACE_MS = 1500    // ① 평화
const WARP_MS = 2100     // ② 워프 + 대사
const WARP_LINE_MS = 650 // 워프 뒤 대사가 뜨기까지 (카메라가 옮겨 갈 시간)
const BEAM_MS = 4000     // ③ 광선 몇 발
const BEAM_GAP = 2000    // 그중 두 번째 발사

// ①~③이 흘려보낼 **판 시간**(인게임 초). 이만큼 되감아 두고 그만큼 되밟는다.
// 평화·워프는 빨리 감는다 — 안쪽 행성이 눈에 띄게 돌아 줘야 "살아 있는 성계"로
// 읽힌다(가장 안쪽 궤도가 한 바퀴 60초쯤이니 21초면 3분의 1 바퀴다).
// 광선 구간만 실시간이다. 여기서 빨리 감으면 광선이 순간이동해 버린다.
const ACT_SEC = { peace: 9, warp: 12, beam: 4 }

// 광선의 제물이 무대(지구·스윙바이 천체·큐볼·본성)에서 떨어져 있어야 하는 거리.
// 크게 잡을 이유가 없다 — 제물이 사라지는 건 무대를 풀 때 이미 계산에 들어가
// 있으므로(setUp의 2차 풀이), 여기서는 폭발이 무대를 덮지만 않으면 된다.
const BEAM_SAFE = 220
const BEAM_FAR = 1700    // 제물까지의 상한 — 한 발이 이 막 안에 닿아야 한다
const AIM_MS = 1400      // ④ 예측 컷 — 패널 없이 예측선만 보여 주는 시간
const TAIL_MS = 900      // 요새가 부서진 뒤 여운
// 안전장치 — 장면이 어그러졌을 때만 걸린다. 정상 진행은 요새가 부서지는
// 순간(보통 7~9초)에 끝나므로, 느린 기기에서 잘리지 않게 넉넉히 잡는다.
const CAP_MS = 26000
const LOGO_MS = 1500

// ── 화면 ────────────────────────────────────────────────────────

// 무대를 세울 축 = **화면의 긴 쪽**. 세로 화면에서 궤적을 가로로 눕히면 통째로
// 줌아웃되어 아무것도 안 보인다.
const longAxis = () => innerWidth >= innerHeight ? { x: 1, y: 0 } : { x: 0, y: 1 }
const perp = (u) => ({ x: -u.y, y: u.x })

// (x, y)를 화면 한가운데 놓고 줌을 잡는다. 요구치가 둘이다 —
// reach는 긴 축, radial은 짧은 축. 하나로 잡으면 세로 화면에서 2배 이상
// 확대된 셈이 되어 폭발이 화면을 통째로 태운다.
function look(rig, x, y, reach, radial = 0) {
  const a = Math.max(0.2, innerWidth / Math.max(1, innerHeight))
  rig.frame(x, y, Math.max(a >= 1 ? reach / a : reach, a >= 1 ? radial : radial / a))
}

// 지금 이야기가 벌어지는 것들만 상자에 담아 부드럽게 따라간다.
// 한 호흡짜리 긴 장면이라 카메라가 고정이면 사건이 화면 구석에서 벌어진다.
function follow(rig, cam, pts, dt) {
  const u = longAxis(), n = perp(u)
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
  for (const p of pts) {
    const a = p.x * u.x + p.y * u.y, b = p.x * n.x + p.y * n.y
    a0 = Math.min(a0, a - p.r); a1 = Math.max(a1, a + p.r)
    b0 = Math.min(b0, b - p.r); b1 = Math.max(b1, b + p.r)
  }
  if (!Number.isFinite(a0)) return
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2
  const tx = ca * u.x + cb * n.x, ty = ca * u.y + cb * n.y
  // 하한과 여백을 넉넉히 둔다. 스윙바이 천체(목성)는 표식 링이 판정 원의 두
  // 배라, 너무 당기면 화면이 행성 하나로 꽉 차 정작 휘어 도는 궤적이 안 보인다.
  const reach = Math.max(640, (a1 - a0) / 2 * 1.4)
  const radial = Math.max(490, (b1 - b0) / 2 * 1.4)
  if (cam.x === null) { cam.x = tx; cam.y = ty; cam.reach = reach; cam.radial = radial }
  else {
    const k = 1 - Math.pow(0.02, Math.min(0.12, dt))
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k
    cam.reach += (reach - cam.reach) * k; cam.radial += (radial - cam.radial) * k
  }
  look(rig, cam.x, cam.y, cam.reach, cam.radial)
}

// ── 무대 세우기 ─────────────────────────────────────────────────

const place = (b, x, y, vx = 0, vy = 0) => {
  b.pos.x = x; b.pos.y = y; b.vel.x = vx; b.vel.y = vy
  b.hp = b.hpMax; b.trailFlash = 0; b.scorch = 0
}

// 무대 후보 자리 — 배경 천체에서 먼 순서로. 시드가 매일 바뀌므로 좌표를 못
// 박는다. 반경은 안쪽으로 잡는다: 장면이 ±600 GU를 뻗으므로 카이퍼 벨트(2599)
// 까지는 여유가 있어야 미사일이 벽에 튕기지 않는다.
function stageSpots(g, actors) {
  const out = []
  for (const r of [1150, 1330, 1520]) {
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12
      const x = Math.cos(a) * r, y = Math.sin(a) * r
      let d = Infinity
      for (const b of g.bodies) {
        if (!b.alive || actors.includes(b)) continue
        d = Math.min(d, Math.hypot(b.pos.x - x, b.pos.y - y))
      }
      out.push({ x, y, clear: d })
    }
  }
  return out.sort((p, q) => q.clear - p.clear)
}

// ── 궤적 풀이 ───────────────────────────────────────────────────
// 스윙바이는 사실상 2체 문제다: 무대가 태양에서 1200 GU 밖이라 그 자리의
// 태양 가속은 0.13 GU/s²로 무시할 만하고, 미사일 중력은 천체 쪽만 κ=120으로
// 증폭된다. 그래서 "얼마나 비껴 쏘면 얼마나 휘는가"가 임팩트 파라미터 하나로
// 정해지고, 그 값을 이분법으로 찾는다.

const PROBE_DT = 1 / 60, PROBE_EVERY = 4    // 탐색용 — 거칠어도 근점거리는 1 GU 안쪽
const FINE_DT = CFG.DT, FINE_EVERY = 2      // 확정용 — 실제 게임과 같은 dt

// 미사일 한 발을 굴려 본다. 실제와 같은 적분기·중력이다.
// stop(m, sim, t)이 참을 돌려주면 그 자리에서 멈춘다.
function fly(bodies, pos, vel, seconds, stop, dt = PROBE_DT, every = PROBE_EVERY) {
  const sim = cloneBodies(bodies)
  const m = {
    pos: { ...pos }, vel: { ...vel }, age: 0, pathN: 0, path: [],
    minSunDist: Infinity, prev: { ...pos },
  }
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) {
    if (i % every === (every >> 1)) stepBodies(sim, dt * every)
    stepMissile(m, sim, dt)
    if (stop(m, sim, (i + 1) * dt)) break
  }
  m.sim = sim   // 멈춘 순간의 판 — 그 뒤를 이어서 굴려 볼 수 있게
  return m
}

// 한 발을 쏴 보고 스윙바이 천체와의 만남을 계측한다.
// 반환: { rp, deg, out } — 근점거리, 굴절각(도), 이탈 시점의 상태.
// 굴절각은 게임이 스윙바이를 인정하는 기준(SWING_ZONE 안팎의 속도 방향 차이)과
// 같은 방식으로 잰다. 여기서 25°를 못 넘으면 화면에도 스윙바이가 안 뜬다.
function probeSwing(bodies, jId, pos, vel, seconds, outDist) {
  const zone = { in: null, out: null }
  let rp = Infinity, exit = null
  const m = fly(bodies, pos, vel, seconds, (mm, sim) => {
    const j = sim.find(b => b.id === jId)
    if (!j) return true
    const d = Math.hypot(mm.pos.x - j.pos.x, mm.pos.y - j.pos.y)
    rp = Math.min(rp, d)
    const z = CFG.SWING_ZONE * j.radius
    if (d < z) { if (!zone.in) zone.in = { ...mm.vel } }
    else if (zone.in && !zone.out) zone.out = { ...mm.vel }
    if (zone.out && d > outDist) {
      exit = { x: mm.pos.x, y: mm.pos.y, vx: mm.vel.x, vy: mm.vel.y }
      return true
    }
    return false
  })
  let deg = 0
  if (zone.in && zone.out) {
    const dot = zone.in.x * zone.out.x + zone.in.y * zone.out.y
    const den = (Math.hypot(zone.in.x, zone.in.y) * Math.hypot(zone.out.x, zone.out.y)) || 1
    deg = Math.acos(Math.max(-1, Math.min(1, dot / den))) * 180 / Math.PI
  }
  return { rp, deg, exit, m }
}

// 무대 하나를 통째로 푼다. 성공하면 배치를, 실패하면 null을 돌려준다.
//   u/n  : 화면의 긴 축과 그 수직
//   P    : 무대 중심 (= 스윙바이 천체가 설 자리)
function solveShot(g, u, n, P, cast) {
  const { swing: J, cue: C, fort: F, earth: E } = cast
  const jr = J.radius
  place(J, P.x, P.y)

  // 근점거리 목표 — 판정 원 바로 바깥. 계측: 여기가 굴절이 가장 크게 나오면서
  // 부딪히지 않는 자리다(목성 기준 근점 133에서 굴절 26~36°, 기준선은 25°).
  const hitJ = hitRadiusOf(J)
  const wantRp = hitJ * 1.2
  // 발사점은 스윙바이 구간(6× 반지름) 바로 바깥에 둔다 — 더 멀리서 쏘면
  // 화면에는 "직선으로 한참 날아가는" 시간만 늘어난다.
  const zone = CFG.SWING_ZONE * jr
  const approach = Math.max(zone * 1.15, hitJ * 1.5 + 70)
  // 큐볼은 **스윙바이 구간 밖**에 세워야 한다. 구간 안에서 터지면 미사일이
  // 구간을 빠져나온 적이 없어 게임이 스윙바이를 인정하지 않는다(=화면에도 안 뜬다).
  const outDist = zone + 90
  const at = (d, off) => ({ x: P.x + u.x * d + n.x * off, y: P.y + u.y * d + n.y * off })

  // 발사 속도 — 실제 조작 범위 안(지구 탈출 15.2 초과, 상한 56).
  // 빠를수록 덜 휘므로 예전에는 느린 쪽을 먼저 골랐는데, 화면에서는 그게
  // "한참 기어가는 탄두"로 보였다. 이제 **빠른 쪽부터** 고른다 — 굴절각이
  // 줄어도 게임이 스윙바이로 인정하는 선(25°)만 넘기면 화면에는 그대로 휘어 돈다.
  for (const v0 of [36, 33, 30, 27, 24]) {
    const launch = (b) => at(-approach, b)
    const vel = { x: u.x * v0, y: u.y * v0 }
    const flightT = (approach + outDist + hitJ * 5) / (v0 * 0.5)

    // 임팩트 파라미터 이분법 — b가 커질수록 근점거리도 커진다(단조)
    let lo = hitJ * 0.4, hi = hitJ * 6
    for (let k = 0; k < 9; k++) {
      const b = (lo + hi) / 2
      const r = probeSwing(g.bodies, J.id, launch(b), vel, flightT, outDist).rp
      if (r < wantRp) lo = b; else hi = b
    }
    const b = (lo + hi) / 2
    const s = probeSwing(g.bodies, J.id, launch(b), vel, flightT, outDist)
    if (!s.exit || s.deg < CFG.SWING_DEG + 2 || s.rp < hitJ * 1.08) continue

    // ── 여기서부터: 스윙바이는 확정됐다. 나온 자리에 표적을 세운다 ──
    const L = launch(b)
    place(E, L.x - u.x * CFG.LAUNCH_OFFSET, L.y - u.y * CFG.LAUNCH_OFFSET)
    const aim = Math.atan2(u.y, u.x)

    // 큐볼을 미사일이 지나갈 자리에 놓는다. 놓고 나면 그 질량이 궤적을 다시
    // 바꾸므로, 실제로 맞을 때까지 자리를 몇 번 고쳐 잡는다.
    let q = { x: s.exit.x, y: s.exit.y }
    let hit = null
    for (let k = 0; k < 5; k++) {
      place(C, q.x, q.y)
      hit = firstContact(g.bodies, C.id, L, { x: u.x * v0, y: u.y * v0 }, flightT * 2.2)
      if (hit.id === C.id) break
      if (!hit.near) return null
      q = { x: q.x + (hit.near.x - hit.near.cx), y: q.y + (hit.near.y - hit.near.cy) }
    }
    if (!hit || hit.id !== C.id) continue

    // ── 밀려난 큐볼이 갈 자리에 요새를 세운다 ──
    // 임펄스 방향은 폭심 → 중심(=어느 살을 쳤는가)이고, 그 뒤 큐볼은 거의
    // 직진한다. 다만 "거의"라서 눈대중으로 놓으면 60 GU짜리 접촉 원을 스친다.
    // 놓고 → 굴려 보고 → 빗나간 만큼 옮기기를 몇 번 돌려 확정한다.
    const runT = 5.2
    let post = impulseOf(C, hit)
    let fx = hit.cx + post.ux * post.w * runT
    let fy = hit.cy + post.uy * post.w * runT
    let ok = false
    for (let k = 0; k < 4 && !ok; k++) {
      if (Math.hypot(fx, fy) > 2150) break                  // 카이퍼 벨트에 너무 붙는다
      place(F, fx, fy)
      // 요새를 놓으면 그 질량이 미사일 궤적도 조금 바꾼다 — 매번 다시 확인한다
      const h2 = firstContact(g.bodies, C.id, L, { x: u.x * v0, y: u.y * v0 }, flightT * 2.2)
      if (h2.id !== C.id) break
      hit = h2
      post = impulseOf(C, hit)
      if (post.w < 24) break                                // 너무 안 밀리면 이야기가 안 된다
      const r = runAfter(h2.sim, C.id, F.id, post, runT * 1.7)
      if (r.hit) { ok = true; break }
      if (r.blocked || !r.at) break                         // 딴 게 진로를 막고 있다
      fx = r.at.x; fy = r.at.y                              // 큐볼이 실제로 간 자리로 옮긴다
    }
    if (!ok) continue

    return { J, C, F, aim, v0, rp: s.rp, deg: s.deg, runT }
  }
  return null
}

// 핵 한 방이 큐볼에 주는 것 — 방향(폭심 → 중심)과 그 직후의 속도.
// 게임의 applyNuke와 같은 규칙이다: 입사각도 입사속도도 보지 않고 어느 살을
// 쳤는지만 본다.
function impulseOf(C, hit) {
  let dx = hit.cx - hit.x, dy = hit.cy - hit.y
  const d = Math.hypot(dx, dy) || 1
  dx /= d; dy /= d
  const dv = effDv(C, CFG.YIELD_MAX)
  const wx = hit.vx + dx * dv, wy = hit.vy + dy * dv
  const w = Math.hypot(wx, wy) || 1
  return { ux: wx / w, uy: wy / w, w }
}

// 타격 직후의 판을 이어받아 큐볼을 실제로 굴려 본다 — 요새에 닿는가, 딴 게
// 먼저 막는가, 아니면 어디까지 가는가.
function runAfter(sim, cId, fId, post, seconds) {
  const c = sim.find(b => b.id === cId), f = sim.find(b => b.id === fId)
  if (!c || !f) return { hit: false }
  c.vel.x = post.ux * post.w; c.vel.y = post.uy * post.w
  const dt = 1 / 60, steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) {
    stepBodies(sim, dt)
    if (Math.hypot(c.pos.x - f.pos.x, c.pos.y - f.pos.y) < hitRadiusOf(c) + hitRadiusOf(f))
      return { hit: true, t: (i + 1) * dt }
    for (const o of sim) {
      if (o === c || o === f || !o.alive || o.type === 'debris') continue
      if (Math.hypot(c.pos.x - o.pos.x, c.pos.y - o.pos.y) < hitRadiusOf(c) + hitRadiusOf(o))
        return { hit: false, blocked: true }
    }
  }
  return { hit: false, at: { x: c.pos.x, y: c.pos.y } }
}

// 미사일이 처음 닿는 천체. 아무 데도 안 닿으면 목표 천체에 가장 가까웠던
// 순간(near)을 함께 돌려준다 — 자리를 고쳐 잡는 데 쓴다.
function firstContact(bodies, wantId, pos, vel, seconds) {
  let id = null, cx = 0, cy = 0, hx = 0, hy = 0, vx = 0, vy = 0
  let bestD = Infinity, near = null
  const end = fly(bodies, pos, vel, seconds, (m, sim) => {
    const want = sim.find(o => o.id === wantId)
    if (want && want.alive) {
      const d = Math.hypot(m.pos.x - want.pos.x, m.pos.y - want.pos.y)
      if (d < bestD) { bestD = d; near = { x: m.pos.x, y: m.pos.y, cx: want.pos.x, cy: want.pos.y } }
    }
    for (const o of sim) {
      if (!o.alive || o.type === 'debris') continue
      const r = hitRadiusOf(o)
      if (Math.hypot(m.pos.x - o.pos.x, m.pos.y - o.pos.y) > r) continue
      id = o.id; cx = o.pos.x; cy = o.pos.y
      hx = m.prev.x; hy = m.prev.y; vx = o.vel.x; vy = o.vel.y
      return true
    }
    return Math.hypot(m.pos.x, m.pos.y) < CFG.R_STAR + 8
  }, FINE_DT, FINE_EVERY)
  return { id, cx, cy, x: hx, y: hy, vx, vy, near, sim: end.sim }
}

// ── 판 세팅 ─────────────────────────────────────────────────────

// 배역을 고른다.
//   스윙바이 천체 — 궤적이 화면에서 읽히려면 덩치가 있어야 하고, 너무 크면
//     판정 원(3.4×)이 스윙바이 구간(6×)을 거의 다 먹어 지날 틈이 없다.
//   큐볼 — 핵 한 방에 잘 밀리는 것. 무거우면 이야기가 안 굴러간다.
function castOf(g) {
  const solar = g.bodies.filter(b =>
    b.alive && !b.isEarth && !b.zorg && b.type !== 'debris' && b.role !== 'void')
  const swing = solar.slice().sort((a, b) => b.radius - a.radius)[0]
  // 큐볼의 Δv는 **중간**이어야 한다. 가벼운 얼음은 300~480 GU/s로 튕겨 나가
  // 화면 밖으로 사라지고, 무거운 금속은 40 아래라 굴러가질 않는다.
  const cue = solar.filter(b => b !== swing && b.role !== 'volatile' && b.hpMax >= 2)
    .map(b => ({ b, dv: effDv(b, CFG.YIELD_MAX) }))
    .sort((p, q) => Math.abs(p.dv - 70) - Math.abs(q.dv - 70))[0]?.b
  const fort = g.bodies.find(b => b.alive && b.role === 'battery')
  return (swing && cue && fort) ? { swing, cue, fort, earth: g.earth } : null
}

// 판을 처음부터 다시 세우고 이번 장면을 짠다.
function setUp(g, mode) {
  g.resetRun()
  g.stepWarpIns(1e9)    // 조르그 증원 워프를 즉시 끝내 놓는다(예고편이 직접 연출한다)
  g.fx.length = 0
  g.mode = mode
  g._predKey = null
  g.obsSpeed = 3        // 관측 8× — 처음부터 끝까지. 미사일이 나는 동안엔
                        // 게임이 스스로 4×로 낮춘다(제대로 보라고).
  g.yieldMt = CFG.YIELD_MAX

  const cast = castOf(g)
  if (!cast) return null

  // 요새는 하나만 남긴다. 둘을 두면 이 한 수로 판이 안 끝나 이야기가 잘린다.
  for (let i = g.bodies.length - 1; i >= 0; i--) {
    const b = g.bodies[i]
    if (b.role === 'battery' && b !== cast.fort) g.bodies.splice(i, 1)
  }
  cast.fort.homeworld = true
  g.homeworld = cast.fort
  g.targets = [cast.fort]
  g.goal = makeGoal([cast.fort])

  const u = longAxis(), n = perp(u)
  const actors = [cast.swing, cast.cue, cast.fort, cast.earth]
  for (const P of stageSpots(g, actors).slice(0, 5)) {
    let shot = solveShot(g, u, n, P, cast)
    if (!shot) continue
    // ③에서 광선이 태울 행성을 먼저 고르고, **없는 셈 치고** 무대를 다시 푼다.
    // 사라진 행성은 중력도 같이 사라지는데 미사일에는 그게 κ=120배로 실리므로
    // (§4.3), 있다고 치고 푼 궤적은 ⑤에서 어긋난다 — 계측: 40시드 중 2건이
    // 큐볼을 요새 옆으로 흘려보냈다. 고른 제물은 shot에 실어 ③이 **그것만**
    // 쏘게 한다. 다른 걸 태우면 같은 어긋남이 그대로 돌아온다.
    const doomed = victimsFor(g, cast, shot.F)
    if (doomed.length) {
      for (const b of doomed) b.alive = false
      const again = solveShot(g, u, n, P, cast)
      for (const b of doomed) b.alive = true
      if (!again) continue
      shot = again
    }
    shot.doomed = doomed
    g.aim = shot.aim; g.power = shot.v0
    return shot
  }
  return null
}

// ③의 두 발이 태울 행성. 총구는 조르그 본성이다.
function victimsFor(g, cast, fort) {
  const keep = [g.earth, fort, cast.swing, cast.cue]
  const out = []
  for (let i = 0; i < 2; i++) {
    const b = pickVictim(g, keep, fort.pos.x, fort.pos.y, out)
    if (!b) break
    out.push(b)
  }
  return out
}

// 조르그가 처음 들어와서 하는 말. 이 한 줄이 판의 전제다 —
// 저쪽이 원하는 건 지구가 아니라 성계 전체고, 지구는 그 앞을 막고 있을 뿐이다.
const WARP_LINE = '네놈만 없으면 태양계는 우리 것이다.'

// 광선 한 발을 **지금 당장** 쏘되, 지구는 비껴 가게 한다.
// 예고편에서 지구가 죽으면 거기서 이야기가 끝난다. 그렇다고 안 쏘면 "저게 뭘
// 하는 물건인지"를 못 보여 준다 — 그래서 쏘고, **곁을 돌던 다른 행성**에
// 맞힌다. 빗나가기만 하면 아무 일도 안 일어나 밋밋하고, 행성 하나가 통째로
// 소멸하면 "닿는 건 체력과 무관하게 없어진다"가 한 방에 읽힌다.
// 손대면 안 되는 것이 지구만은 아니다. **무대에 세운 배우들**(스윙바이 천체·
// 큐볼)도 여기서 죽으면 ⑤⑥이 통째로 사라진다. 그런데 이 셋은 하필 총구 곁에
// 모여 있다 — 표적을 가까이 당길수록 광선이 이들을 스칠 확률이 커진다
// (계측: 안 막았더니 12시드 중 8건이 스윙바이 천체나 큐볼을 먼저 태웠다).
// 그래서 진로가 이들을 비껴가는지까지 보고 고른다.

// 표적을 **광선이 닿을 때 있을 자리**로 겨눈다. 판이 흐르고 있으므로 지금
// 자리를 그대로 쏘면 작은 행성은 판정 반경(수십 GU)만큼 비껴간다.
function leadUnit(b, ox, oy) {
  let t = Math.hypot(b.pos.x - ox, b.pos.y - oy) / CFG.LASER_SPEED
  let px = 0, py = 0
  for (let k = 0; k < 3; k++) {
    px = b.pos.x + b.vel.x * t - ox; py = b.pos.y + b.vel.y * t - oy
    t = Math.hypot(px, py) / CFG.LASER_SPEED
  }
  const d = Math.hypot(px, py) || 1
  return { ux: px / d, uy: py / d, d }
}

// (ox, oy)에서 쏴서 태울 행성 하나. 판을 전혀 건드리지 않는다 — 무대를 풀기
// **전에** "누가 없어질지"를 알아야 하기 때문이다.
// 너무 가까우면 광선이 날아가는 게 안 보이고, 너무 멀면 **날아가는 도중에 이
// 막이 끝난다** — 예전엔 1200 GU 언저리를 골랐는데 그게 인게임 1.4초라 두 발째가
// 닿기 전에 ④로 넘어가 버렸다. 그래서 700 GU 언저리로 당긴다(0.8초). 상한
// 1700 GU는 한 발에 주어진 시간(막 4초를 두 발이 나눠 쓴다)이 정하는 값이다.
// 여유를 넉넉히 잡는다. 이 계산은 **발사 시점의 판**을 놓고 하는데 실제 발사는
// 그보다 4초 앞(③)에서 일어나므로, 그 사이 움직인 만큼 진로가 틀어져 있다.
// 특히 안쪽 궤도의 작은 행성(수성)은 태양 원반을 스치는 각으로 바뀌기 쉬웠다 —
// 그러면 광선이 태양에 삼켜지고 제물은 살아남는다(계측: 40시드 중 2건).
function pickVictim(g, keep, ox, oy, taken = []) {
  const clear = (ux, uy, d) => keep.every(k => {
    if (!k || !k.alive) return true
    const px = k.pos.x - ox, py = k.pos.y - oy
    const along = px * ux + py * uy
    if (along <= 0 || along > d) return true      // 뒤에 있거나 표적보다 멀다
    return Math.abs(ux * py - uy * px) > hitRadiusOf(k) * 2.4
  })
  const cands = []
  for (const b of g.bodies) {
    if (!b.alive || b.type === 'debris' || b.role === 'void') continue
    if (keep.includes(b) || taken.includes(b)) continue
    // 무대에서 떨어진 것만 태운다. 사라진 행성은 중력도 같이 사라진다.
    if (keep.some(k => k.alive && Math.hypot(b.pos.x - k.pos.x, b.pos.y - k.pos.y) < BEAM_SAFE)) continue
    if (Math.hypot(b.pos.x - ox, b.pos.y - oy) < 300) continue
    const { ux, uy, d } = leadUnit(b, ox, oy)
    if (d > BEAM_FAR || !clear(ux, uy, d)) continue
    // 태양 원반을 지나면 거기서 끊긴다 — 그 앞의 행성은 못 맞힌다
    const t = -ox * ux - oy * uy
    if (t > 0 && t < d && Math.hypot(-ox - ux * t, -oy - uy * t) < CFG.R_STAR * 2.5) continue
    cands.push({ b, d })
  }
  cands.sort((p, q) => Math.abs(p.d - 700) - Math.abs(q.d - 700))
  return cands[0]?.b ?? null
}

function fireBeamPast(g, keep, want) {
  const L = g.laser
  L.state = LASER_IDLE; L.t = 0; L.nextAt = 0
  g.step(CFG.DT)                                  // → charge (조준점 계산)
  if (L.state !== LASER_CHARGE) return false
  L.t = CFG.LASER_CHARGE
  g.step(CFG.DT)                                  // → travel (진로 확정)
  if (L.state !== LASER_TRAVEL) return false
  g.toast = null; g.toastT = 0

  // 무대를 풀 때 "없는 셈 친" 바로 그 행성을 쏜다. **정해진 제물이 없으면
  // 아무것도 안 태운다** — 즉석에서 고르면 그게 곧 풀이에 없던 소멸이다.
  const b = want?.alive ? want : null
  if (b) {
    const { ux, uy } = leadUnit(b, L.ox, L.oy)
    L.ux = ux; L.uy = uy
    return b
  }

  // 마땅한 표적이 없으면 아무것도 못 맞히는 쪽으로 튼다. 한 바퀴를 훑어
  // 지켜야 할 것들에서 가장 멀리 떨어지는 각을 고른다 — 빈 하늘에 대고 쏘는
  // 셈이지만, 무대를 태우는 것보다는 낫다.
  let best = null, bestClear = -Infinity
  for (let i = 0; i < 72; i++) {
    const a = i * Math.PI / 36
    const ux = Math.cos(a), uy = Math.sin(a)
    let worst = Infinity
    for (const k of keep) {
      if (!k || !k.alive) continue
      const px = k.pos.x - L.ox, py = k.pos.y - L.oy
      const along = px * ux + py * uy
      if (along <= 0) continue
      worst = Math.min(worst, Math.abs(ux * py - uy * px) - hitRadiusOf(k))
    }
    if (worst > bestClear) { bestClear = worst; best = { ux, uy } }
  }
  if (best) { L.ux = best.ux; L.uy = best.uy }
  return true
}

// 판을 거꾸로 감는다. 도약 적분(velocity-Verlet)은 시간대칭이라, 같은 dt로
// 되감았다가 같은 횟수만큼 다시 굴리면 원래 자리로 정확히 돌아온다.
// 그래서 "발사 시점에 맞춰 푼 무대"를 그대로 두고 그 앞의 몇십 초를 만들어
// 낼 수 있다 — ①~③ 동안 행성이 진짜로 공전하는 건 이 되감기 덕이다.
const stepsOf = (sec) => Math.round(sec / CFG.DT)
function rewind(g, steps) {
  for (let i = 0; i < steps; i++) stepBodies(g.bodies, -CFG.DT)
}

// 조르그 본성을 **발사 직전**으로 만든다. 충전 표식과 ZORG BEAM 패널이 뜨고,
// 조준선이 지구를 향해 그어진다 — 그걸 큐볼이 끊는 게 이 장면의 결말이다.
function armLaser(g, left) {
  const L = g.laser
  L.state = LASER_IDLE; L.t = 0; L.nextAt = 0
  g.step(CFG.DT)                                  // → charge (ghost·조준점 계산)
  if (L.state !== LASER_CHARGE) return
  L.t = Math.max(0, CFG.LASER_CHARGE - left)      // 남은 충전 시간을 맞춘다
  g.toast = null; g.toastT = 0                    // "95초 뒤 발사"는 지금 화면과 어긋난다
}

// ── 로고 ────────────────────────────────────────────────────────
// 마크는 이 게임 한 줄 요약이다: **궤도(원) 위의 공을 친다.**
const LOGOMARK = `
<svg viewBox="0 0 120 120" class="slogomark" aria-hidden="true">
  <circle cx="60" cy="60" r="46" fill="none" stroke="#4fd6f7" stroke-width="2.5" opacity=".45"/>
  <circle cx="60" cy="60" r="46" fill="none" stroke="#4fd6f7" stroke-width="2.5"
          stroke-dasharray="18 271" stroke-linecap="round" class="slogotrace"/>
  <circle cx="60" cy="60" r="13" fill="#f5b544" opacity=".16"/>
  <circle cx="60" cy="14" r="9.5" fill="#cfe3ef"/>
  <g class="slogospark">
    <path d="M46 14 l-11 0 M50 5 l-7 -7 M50 23 l-7 7" stroke="#f5b544" stroke-width="3" stroke-linecap="round"/>
  </g>
  <path d="M74 14 l22 0" stroke="#f5b544" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M96 8 l12 6 -12 6 z" fill="#f5b544"/>
</svg>`

export class Attract {
  constructor(game, view, onDone, comms = null) {
    this.game = game; this.view = view; this.onDone = onDone
    this.comms = comms          // 예고편에도 저쪽이 한 마디 한다
    this.done = false
    this.timers = []
    this.shot = null
    this.phase = 'peace'
    this.cam = { x: null, y: 0, reach: 400, radial: 300 }

    const el = document.createElement('div')
    el.className = 'attract'
    el.innerHTML = `
<div class="attractbar"><i id="attractFill"></i></div>
<div class="attractlogo">
  ${LOGOMARK}
  <div class="slogotitle">PLANETPOOL</div>
  <div class="slogosub">궤도 당구 · ORBITAL BILLIARDS</div>
</div>
<button class="attractskip" id="attractSkip">건너뛰기 (ESC)</button>`
    document.body.appendChild(el)
    this.el = el
    this.fill = el.querySelector('#attractFill')

    el.querySelector('#attractSkip').onclick = (e) => { e.stopPropagation(); this.finish() }
    el.onclick = () => this.finish()
    this.onKey = (e) => { e.preventDefault(); this.finish() }
    addEventListener('keydown', this.onKey)
  }

  after(ms, fn) { this.timers.push(setTimeout(fn, ms)) }

  // 한 막을 연다 — 이름, 벽시계 길이, 그동안 흘려보낼 판 시간.
  act(name, ms) {
    this.phase = name
    this.actLeft = Math.round((ACT_SEC[name] ?? 0) / CFG.DT)
    this.actEnd = performance.now() + ms
  }

  // 판을 n스텝 굴린다. 예고편이 직접 굴리는 이유는 **몇 스텝을 밟았는지 세야**
  // 하기 때문이다 — 되감은 만큼을 정확히 되밟아야 ④에서 무대가 풀이 그대로 선다.
  stepBoard(n) {
    const g = this.game
    for (let i = 0; i < n; i++) {
      // 요새가 부서지면 win()이 걸려 판이 얼어붙는다. 이 판은 finish()에서
      // 버려지므로 매 스텝 지운다(frame()이 하는 것과 같은 이유).
      g.won = false; g.lost = false; g.runOver = false; g.failReason = null
      g.step(CFG.DT)
    }
    this.actLeft -= n
  }

  // 막이 끝날 때 남은 스텝을 털어 무대를 딱 맞춘다. 정상 진행이면 한두 스텝이다.
  burn() { if (this.actLeft > 0) this.stepBoard(this.actLeft) }

  // ── ① 평화 ──
  // 무대는 **발사 시점**에 맞춰 풀어 두고, 판을 ①~③이 쓸 만큼 되감아 거기서
  // 시작한다. 그래서 ④까지 아무것도 다시 세울 필요가 없다 — 씬이 하나로 이어지고,
  // 그러면서 행성은 내내 공전한다.
  start() {
    const g = this.game
    g.cinematic = true
    this.shot = setUp(g, 'observe')
    if (!this.shot) return this.finish()      // 이 시드로는 장면이 안 나온다 — 조용히 넘어간다
    // 판은 예고편이 직접 굴린다(stepBoard). game.tick은 손을 뗀다.
    g.paused = true
    // ②③ 몫을 먼저 되감는다 — 이때는 요새도 판에 있다.
    rewind(g, stepsOf(ACT_SEC.warp) + stepsOf(ACT_SEC.beam))
    // ① 몫은 요새를 **빼고** 되감는다. ① 동안 조르그는 아직 안 왔으므로 판에도
    // 없는데(stepBodies는 죽은 걸 통째로 건너뛴다), 되감을 때만 넣어 두면 앞뒤가
    // 어긋난다 — 요새는 자기 몫만큼 뒤처져 서고, 큐볼이 그 자리를 스친다.
    this.zorg = this.shot.F
    this.zorg.alive = false
    rewind(g, stepsOf(ACT_SEC.peace))
    for (const b of g.bodies) if (b.trail) b.trail.length = 0   // 거꾸로 그린 꼬리는 버린다
    this.act('peace', PEACE_MS)
    this.bar(0.03)
    this.after(PEACE_MS, () => this.warpIn())
    this.after(CAP_MS, () => this.showLogo())
    return this
  }

  // ── ② 워프 — 조르그가 들어오고, 카메라가 그리로 간다 ──
  warpIn() {
    if (this.done || this.phase !== 'peace') return
    const g = this.game, z = this.zorg
    this.burn()
    this.act('warp', WARP_MS)
    // 게임이 증원을 불러들일 때와 같은 연출이다(stepWarpIns가 하는 그대로).
    z.alive = true; z.warp = 1
    g.addFx({ kind: 'warp', x: z.pos.x, y: z.pos.y, r: hitRadiusOf(z), fort: true })
    g.homeworld = z
    this.bar(0.1)
    this.after(WARP_LINE_MS, () => this.comms?.say(WARP_LINE))
    this.after(WARP_MS, () => this.beams())
  }

  // ── ③ 광선 — 몇 발 쏘고, 지구는 비껴 간다 ──
  beams() {
    if (this.done || this.phase !== 'warp') return
    this.burn()
    this.act('beam', BEAM_MS)
    this.bar(0.18)
    this.volley(0)
    this.after(BEAM_GAP, () => { if (this.phase === 'beam') this.volley(1) })
    this.after(BEAM_MS, () => this.predict())
  }

  // 한 발. fireBeamPast는 상태기를 돌리려고 판을 두 스텝 밀므로 그만큼 예산에서 뺀다.
  volley(i) {
    const s = this.shot
    const keep = [this.game.earth, s.F, s.J, s.C]
    const hit = fireBeamPast(this.game, keep, s.doomed?.[i])
    if (hit) this.actLeft = Math.max(0, this.actLeft - 2)
    this.beamAt = typeof hit === 'object' ? hit : null
  }

  // ── ④ 예측 — 같은 화면, 같은 판. 조준 가이드만 켠다 ──
  predict() {
    if (this.done || this.phase !== 'beam') return
    this.burn()                 // 여기서 판은 풀이가 본 그 자리로 돌아와 있다
    this.phase = 'aim'
    this.actLeft = 0
    const g = this.game
    // 아직 날고 있는 광선이 있으면 여기서 결말을 낸다. armLaser가 곧 상태기를
    // 되돌리므로 그냥 두면 제물이 살아남는데, 무대는 그 둘이 **없다는 전제**로
    // 푼 것이라 살아남으면 ⑤가 어긋난다. tickLaser는 천체를 건드리지 않으니
    // 판은 풀이 그대로 남는다.
    for (let i = 0; i < 4000 && g.laser.state === LASER_TRAVEL; i++) g.tickLaser(CFG.DT)
    // 예측선은 조준 모드에서만 그려진다(canAim). 조준 패널은 cinematic이 걷어낸다.
    g.setMode('aim')
    g.cinematic = true
    // 남은 충전 시간. 장면 전체가 인게임 25초 남짓이므로, 32초를 남겨 두면
    // 카운트다운이 내내 줄어들다가 큐볼이 요새를 부수는 순간 끊긴다.
    armLaser(g, 32)
    this.comms?.close()
    this.bar(0.3)
    this.after(AIM_MS, () => this.launch())
  }

  launch() {
    if (this.done || this.phase !== 'aim') return
    this.phase = 'fly'
    this.game.paused = false      // 여기서부터 판이 흐른다
    this.game.cinematic = false   // 여기서부터는 관측 바를 보여 준다(배속·레이저 카운트다운)
    this.game.fire()              // 진짜 발사 — 게임이 스스로 관측 모드로 넘어간다
    this.bar(0.2)
    // 탄두가 날기 시작한 뒤 저쪽이 한 마디 한다. 발사와 동시에 띄우면 발사
    // 연출과 겹쳐 둘 다 안 읽힌다. (요새가 부서질 때의 단말마는 Comms가
    // 스스로 알아채 끊고 들어온다 — 이 장면의 마지막 소리가 그거다.)
    this.after(700, () => this.comms?.say())
  }

  bar(f) { this.fill.style.width = `${Math.min(100, f * 100)}%` }

  // 매 프레임 main 루프가 불러 준다.
  frame(dt = 1 / 60) {
    if (this.done) return
    const g = this.game, s = this.shot
    // ── 예고편은 중간에 멈추지 않는다 ──
    // 요새가 부서지면 win()이 걸리고 그 순간 effTimeScale이 0이 되어 남은
    // 여운이 통째로 얼어붙는다. 이 판은 finish()에서 버려지므로 매 프레임 지운다.
    g.won = false; g.lost = false; g.runOver = false; g.failReason = null
    if (!g.earth.alive) g.earth.alive = true
    if (g.earth.hp <= 0) g.earth.hp = g.earth.hpMax
    // 관측 바를 보여 주는 건 탄두가 나는 동안뿐이다(배속·레이저 카운트다운).
    // 나머지 구간은 화면을 통째로 쓴다.
    g.cinematic = !['fly', 'run', 'end'].includes(this.phase)

    // ①~③ — 판을 예고편이 직접 굴린다. 남은 스텝을 막이 끝날 때까지 고르게
    // 나눠 밟으므로, 프레임이 느리든 빠르든 ④에 도착하는 순간의 판은 같다.
    if (this.actLeft > 0) {
      const leftMs = Math.max(50, this.actEnd - performance.now())
      const n = Math.min(this.actLeft, Math.max(1, Math.round(this.actLeft / (leftMs / 1000) * dt)))
      this.stepBoard(n)
    }

    const m = g.missiles.find(x => x.alive)
    const pts = []
    if (this.phase === 'peace') {
      pts.push({ x: 0, y: 0, r: g.aMax * 1.02 })          // 성계 전체
    } else if (this.phase === 'warp') {
      // 조르그가 들어온 자리로 카메라가 옮겨 간다(follow가 부드럽게 민다)
      const z = this.zorg
      if (z) pts.push({ x: z.pos.x, y: z.pos.y, r: 300 })
      else pts.push({ x: 0, y: 0, r: g.aMax * 1.02 })
    } else if (this.phase === 'beam') {
      // 총구에서 표적까지를 한 화면에. 지구를 상자에 넣으면(1000 GU 밖이다)
      // 화면이 통째로 물러나 정작 광선이 실오라기로 보인다 — 광선이 지구를
      // 겨누지 않는 막이므로 굳이 넣지 않는다.
      const h = g.homeworld
      if (h && h.alive) pts.push({ x: h.pos.x, y: h.pos.y, r: 240 })
      const b = this.beamAt
      // 표적은 판정 원보다 넉넉히 잡는다 — 소멸 폭발이 그보다 훨씬 크게 번져서,
      // 딱 맞춰 담으면 정작 터지는 순간에 화면 모서리로 잘려 나간다.
      if (b) pts.push({ x: b.pos.x, y: b.pos.y, r: hitRadiusOf(b) * 3.4 })
      const L = g.laser
      if (L.state === LASER_TRAVEL) {
        pts.push({ x: L.ox + L.ux * L.head, y: L.oy + L.uy * L.head, r: 160 })
      }
    }
    if (pts.length) { follow(this.view.rig, this.cam, pts, dt); return }
    if (!s || this.phase === 'logo') return

    if (this.phase === 'aim') {
      // 예측 컷 — 예측선이 지나갈 자리를 통째로 담는다(발사대 → 스윙바이 → 표적)
      pts.push({ x: g.earth.pos.x, y: g.earth.pos.y, r: 130 })
      pts.push({ x: s.J.pos.x, y: s.J.pos.y, r: hitRadiusOf(s.J) * 1.5 })
      pts.push({ x: s.C.pos.x, y: s.C.pos.y, r: hitRadiusOf(s.C) * 2 })
    } else if (m) {
      // 비행 중 — 탄두와 스윙바이 천체를 물고 간다
      pts.push({ x: m.pos.x, y: m.pos.y, r: 90 })
      pts.push({ x: s.J.pos.x, y: s.J.pos.y, r: hitRadiusOf(s.J) * 1.3 })
      if (s.C.alive) pts.push({ x: s.C.pos.x, y: s.C.pos.y, r: hitRadiusOf(s.C) })
      this.bar(0.2 + 0.5 * Math.min(1, m.age / 20))
    } else if (s.F.alive) {
      // 밀려난 큐볼이 요새로 굴러가는 구간
      if (this.phase === 'fly') { this.phase = 'run'; this.bar(0.72) }
      if (s.C.alive) pts.push({ x: s.C.pos.x, y: s.C.pos.y, r: hitRadiusOf(s.C) * 2.2 })
      pts.push({ x: s.F.pos.x, y: s.F.pos.y, r: hitRadiusOf(s.F) * 3.4 })
      this.runT = (this.runT ?? 0) + dt
      this.bar(0.72 + 0.2 * Math.min(1, this.runT / 2.5))
    } else {
      // 요새가 부서졌다 — 그 자리를 물고 여운을 준다
      if (this.phase !== 'end') {
        this.phase = 'end'; this.bar(0.95)
        this.endAt = { x: s.F.pos.x, y: s.F.pos.y }
        this.after(TAIL_MS, () => this.showLogo())
      }
      pts.push({ x: this.endAt.x, y: this.endAt.y, r: 320 })
    }
    follow(this.view.rig, this.cam, pts, dt)
  }

  showLogo() {
    if (this.done || this.phase === 'logo') return
    this.phase = 'logo'
    this.game.paused = false
    // 모드는 그대로 둔다 — 여기서 조준 모드로 돌리면 로고 뒤로 HUD 패널이
    // 다시 튀어나온다. 배속만 1×로 내려 판을 잔잔하게 만든다.
    this.game.advancing = false
    this.game.obsSpeed = 0
    this.comms?.close()          // 로고 위에 교신창을 얹지 않는다
    this.el.classList.add('logo')
    this.bar(1)
    this.after(LOGO_MS, () => this.finish())
  }

  finish() {
    if (this.done) return
    this.done = true
    this.game.cinematic = false
    this.game.paused = false
    this.comms?.close()
    for (const t of this.timers) clearTimeout(t)
    removeEventListener('keydown', this.onKey)
    this.el.classList.add('out')
    setTimeout(() => this.el.remove(), 420)
    // 판을 처음부터 다시 — 예고편이 헤집어 놓은 성계를 되돌린다.
    this.game.resetRun()
    this.view.clearFx()
    this.view.rig.snapToAuto()
    this.onDone?.()
  }
}
