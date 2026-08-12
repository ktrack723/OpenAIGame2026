import { t } from '../i18n/index.js'
import { AUDIO } from '../audio/index.js'
import { CFG, R_SCALE, contactDist, hitRadiusOf } from '../game/config.js'
import { LASER_CHARGE, LASER_IDLE, LASER_TRAVEL } from '../game/laser.js'
import { makeGoal } from '../game/objectives.js'
import { blastWave, cloneBodies, stepBodies, stepMissile } from '../game/physics.js'
import { effDv } from '../game/roles.js'

// ─── 오프닝 예고편 — 한 판의 긴 한 수 ───────────────────────────
// 짧은 컷을 여러 개 이어 붙이지 않는다. **한 번의 발사가 끝까지 굴러가는 것**을
// 처음부터 끝까지 한 호흡으로 보여 준다:
//
//   ① 평화 — 아무 일도 없는 성계. 공들이 제 궤도를 돈다.
//   ② 워프 — 조르그가 들어온다. 카메라가 그리로 옮겨 가고, 저쪽이 한 마디 한다.
//   ③ 광선 — 한 발 쏜다. **조준은 지구다** — 게임에서 하는 그 계산 그대로,
//      지구가 도달할 자리를 겨눈다. 그런데 그 선 위로 안쪽 궤도의 행성 하나가
//      제 공전 속도로 끼어들어 대신 맞고 통째로 사라진다.
//      즉 지구는 **운으로** 살아남았다. 다음엔 그 운이 없다.
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
// ③ 광선 한 발. 충전(BEAM_CHARGE) → 발사 → 비행 → 소멸이 이 안에 다 들어간다.
const BEAM_MS = 4400
const BEAM_CHARGE = 2.2  // 총구에 빛이 모이는 시간(인게임 초). 게임의 95초를 줄인 것.
// 광선이 실제로 나가는 시각(③ 막 시작 기준, 인게임 초).
// armBeam이 상태기를 돌리려고 판을 한 스텝 밀고, 그 뒤로 BEAM_CHARGE초를 채운다.
const BEAM_FIRE_AT = CFG.DT + BEAM_CHARGE

// ①~③이 흘려보낼 **판 시간**(인게임 초). 이만큼 되감아 두고 그만큼 되밟는다.
// 평화·워프는 빨리 감는다 — 안쪽 행성이 눈에 띄게 돌아 줘야 "살아 있는 성계"로
// 읽힌다(가장 안쪽 궤도가 한 바퀴 60초쯤이니 21초면 3분의 1 바퀴다).
// 광선 구간만 실시간이다. 여기서 빨리 감으면 광선이 순간이동해 버린다.
const ACT_SEC = { peace: 9, warp: 12, beam: 4.4 }

// 광선의 제물이 무대(지구·스윙바이 천체·큐볼·요새)에서 떨어져 있어야 하는 거리.
// 제물은 질량을 0으로 만들어 두므로(setUp) 무대 풀이에 영향을 주지 않는다 —
// 여기서 보는 건 하나뿐이다: 소멸 폭발이 무대를 덮지 않을 것. 그래서 예전
// (220)보다 훨씬 짧아도 된다. 짧아야 하기도 하다: 조준선이 지구를 향하는
// 이상 그 선은 무대를 가로지르는데, 220으로 잡으면 설 자리가 아예 없다.
const BEAM_SAFE = 140
// ④ 예측 컷 — 패널 없이 예측선만. 여기서 지상 관제가 네 마디를 한다.
// 그 네 마디가 이 게임이 존재하는 이유다: **저건 지구를 겨눴다 → 닿으면
// 없어진다 → 핵으로는 안 된다 → 그럼 행성을 던지자.**
// 그림으로만 흘리면 "왜 하필 당구인가"가 안 남는다.
// 읽는 속도로 잡는다. 두 가지가 같이 걸려 있었다:
//   ① 간격이 짧아 한 줄을 다 읽기 전에 다음 줄이 밀고 들어왔다.
//   ② **체류와 간격이 같아서** 한 마디가 끝나는 순간 창이 닫혔다가 다음
//      마디에 다시 열렸다 — 화면에서는 대사가 "나오다 마는" 것으로 보인다.
// 그래서 간격을 늘리고, 체류를 간격보다 **길게** 준다. 창은 네 마디가 끝날
// 때까지 한 번도 닫히지 않고 글자만 바뀐다.
// 이 막은 예측선을 **보여 주는** 시간이기도 하므로 길어도 손해가 아니다.
const AIM_MS = 12000
const IDEA_MS = [200, 3000, 5800, 8600]   // 네 마디가 뜨는 시각(막 시작 기준)
const IDEA_HOLD = 3.4                     // 한 마디가 떠 있는 시간(초) — 간격(2.8)보다 길다
// 요새가 부서진 뒤 여운. 그 순간 저쪽의 단말마와 이쪽의 격파 보고가 **동시에**
// 뜨는데, 900ms면 로고가 그 둘을 1.15초 만에 덮었다(계측) — 이 장면의 마지막
// 소리를 못 듣고 끝나는 셈이다. 격파 보고는 앞줄("탄두 기폭")이 최소 노출
// 시간을 채운 **뒤**에 나오므로, 그 대기(1.5초)까지 더해 잡는다.
const TAIL_MS = 4200
// 안전장치 — 장면이 어그러졌을 때만 걸린다. 정상 진행은 요새가 부서지는
// 순간에 끝나므로(막 넷 18초 + 비행 6~10초), 느린 기기에서 잘리지 않게
// 넉넉히 잡는다.
const CAP_MS = 42000
// 무대를 푸는 데 쓸 수 있는 벽시계 시간(ms). 넘기면 예고편을 접는다.
const SETUP_BUDGET_MS = 2600
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

// 무대에 세우는 것은 전부 **제 궤도를 도는 상태**로 세운다.
// 예전에는 속도 0으로 놓았다. 그러면 공은 태양을 향해 곧게 떨어지는 돌이 되고,
// 화면에서는 "멈춰 선 행성들 앞에서 벌어지는 일"로 보인다 — 이 게임은 도는 판
// 위에서 도는 공을 치는 게임인데 정작 예고편이 그걸 안 보여 준 것이다.
// 이제 지구도, 가스 행성도, 큐볼도, 요새도 전부 공전한다. 궤적 풀이는 원래부터
// 판을 굴려 가며 계산하므로(probeSwing·firstContact가 stepBodies를 돈다)
// 움직이는 표적이어도 답은 그대로 나온다 — 다만 답이 더 어려워질 뿐이다.
// 방향은 반시계, 성계의 나머지가 도는 쪽과 같다(stage.elementsToState).
function orbitVel(x, y) {
  const r = Math.hypot(x, y) || 1
  const v = Math.sqrt(CFG.MU_STAR / r)
  return { vx: -y / r * v, vy: x / r * v }
}
// 그 원궤도를 따라 sec초 뒤의 자리. 원궤도라 회전 한 번이면 정확하다.
function orbitAt(x, y, sec) {
  const r = Math.hypot(x, y) || 1
  const a = Math.sqrt(CFG.MU_STAR / r) / r * sec
  const c = Math.cos(a), s = Math.sin(a)
  return { x: x * c - y * s, y: x * s + y * c }
}
const place = (b, x, y) => {
  const { vx, vy } = orbitVel(x, y)
  b.pos.x = x; b.pos.y = y; b.vel.x = vx; b.vel.y = vy
  b.hp = b.hpMax; b.trailFlash = 0; b.scorch = 0
}

// 무대 후보 자리 — 배경 천체에서 멀고, **스윙바이 천체가 탄과 같은 쪽으로
// 도는** 자리 순서로. 시드가 매일 바뀌므로 좌표를 못 박는다. 반경은 안쪽으로
// 잡는다: 장면이 ±600 GU를 뻗으므로 카이퍼 벨트(2599)까지는 여유가 있어야
// 미사일이 벽에 튕기지 않는다.
//
// 도는 쪽을 따지는 이유 — 무대가 공전을 시작하면서 굴절각이 상대속도에
// 걸리게 됐다. 탄(36 GU/s)이 마주 오는 행성(14 GU/s)을 스치면 상대속도가
// 50이라 거의 안 휘고, 같은 쪽으로 도는 행성을 뒤에서 따라잡으며 스치면 22라
// 크게 휜다(계측: 같은 자리에서 굴절 19° ↔ 34°). 화면에서도 후자가 낫다 —
// 탄이 행성을 따라잡아 그 뒤를 돌아 나오는 게 스윙바이의 그림이다.
function stageSpots(g, actors, u) {
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
      // 그 자리에서의 공전 방향(반시계 접선)이 발사 축과 얼마나 같은 쪽인가
      const pro = (-y * u.x + x * u.y) / r
      out.push({ x, y, clear: d, score: d + 900 * pro })
    }
  }
  return out.sort((p, q) => q.score - p.score)
}

// ── 궤적 풀이 ───────────────────────────────────────────────────
// 스윙바이는 사실상 2체 문제다: 무대가 태양에서 1200 GU 밖이라 그 자리의
// 태양 가속은 0.13 GU/s²로 무시할 만하고, 미사일 중력은 천체 쪽만 κ=120으로
// 증폭된다. 그래서 "얼마나 비껴 쏘면 얼마나 휘는가"가 임팩트 파라미터 하나로
// 정해지고, 그 값을 이분법으로 찾는다.

const PROBE_DT = 1 / 60, PROBE_EVERY = 4    // 탐색용 — 거칠어도 근점거리는 1 GU 안쪽
const FINE_DT = CFG.DT, FINE_EVERY = 1      // 확정용 — 실제 게임과 완전히 같은 적분

// 예고편이 훑는 발사 속도. 값(36~24)은 **공이 지금의 1/R_SCALE 이던 시절에**
// 잡은 것이다: 이 장면은 판정 원 바로 바깥(hitJ × 1.16)을 스치게 쏘는 것이라,
// 공을 키우면 근점거리와 발사점이 통째로 밖으로 밀려 같은 사다리로는 장면이
// 안 나온다(계측 20시드: 성공 19 → 16, 탐색 시간은 두 배).
//
// 보정은 √R_SCALE **곱하기**다. 굴절각 tan(θ/2) = κμ/(r_p·v²) 만 보면 반대로
// 나눠야 맞을 것 같은데, 실제로 굴려 보면 그쪽이 훨씬 나쁘다(7/20). 느린 탄은
// 커진 스윙바이 구간 안에서 감겨 포획되거나(CAPTURE_WRAP) 멀어진 발사점까지
// 오느라 비행시간 예산에 걸려, 굴절각을 얻기 전에 다른 조건에서 탈락한다.
// 사다리를 넓게 펴는 것도 답이 아니었다 — 앞쪽에서 걸리는 값이 없으면 뒤쪽까지
// 다 훑느라 시간 예산(until)에 먼저 걸린다.
//   ÷√1.3 → 7/20  ·  그대로 → 16/20  ·  [44…24] → 14/20  ·  ×√1.3 → 18/20
const V0_LADDER = [36, 33, 30, 27, 24].map(v => v * Math.sqrt(R_SCALE))

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
function probeSwing(bodies, jId, pos, vel, seconds, outDist, dt = PROBE_DT, every = PROBE_EVERY) {
  const zone = { in: null, out: null }
  let rp = Infinity, exit = null, tExit = 0
  const m = fly(bodies, pos, vel, seconds, (mm, sim, tt) => {
    const j = sim.find(b => b.id === jId)
    if (!j) return true
    const d = Math.hypot(mm.pos.x - j.pos.x, mm.pos.y - j.pos.y)
    rp = Math.min(rp, d)
    const z = CFG.SWING_ZONE * j.radius
    if (d < z) { if (!zone.in) zone.in = { ...mm.vel } }
    else if (zone.in && !zone.out) zone.out = { ...mm.vel }
    if (zone.out && d > outDist) {
      exit = { x: mm.pos.x, y: mm.pos.y, vx: mm.vel.x, vy: mm.vel.y }
      tExit = tt
      return true
    }
    return false
  }, dt, every)
  let deg = 0
  if (zone.in && zone.out) {
    const dot = zone.in.x * zone.out.x + zone.in.y * zone.out.y
    const den = (Math.hypot(zone.in.x, zone.in.y) * Math.hypot(zone.out.x, zone.out.y)) || 1
    deg = Math.acos(Math.max(-1, Math.min(1, dot / den))) * 180 / Math.PI
  }
  return { rp, deg, exit, tExit, m }
}

// 무대 하나를 통째로 푼다. 성공하면 배치를, 실패하면 null을 돌려준다.
//   u/n  : 화면의 긴 축과 그 수직
//   P    : 무대 중심 (= 스윙바이 천체가 설 자리)
function solveShot(g, u, n, P, cast, until = Infinity) {
  const { swing: J, cue: C, fort: F, earth: E } = cast
  const jr = J.radius
  place(J, P.x, P.y)
  // 요새는 일단 판 반대편에 세워 둔다. 앞선 시도에서 놓아 둔 자리에 그대로
  // 있으면 그놈이 이번 궤적을 가로막아, 큐볼을 어디에 놓든 탄이 요새에 먼저
  // 박힌다(계측: 큐볼 배치 실패의 대부분이 이거였다).
  place(F, -P.x * 1.3, -P.y * 1.3)

  // 근점거리 목표 — 판정 원 바로 바깥. 계측: 여기가 굴절이 가장 크게 나오면서
  // 부딪히지 않는 자리다(목성 기준 근점 133에서 굴절 26~36°, 기준선은 25°).
  const hitJ = hitRadiusOf(J)
  const wantRp = hitJ * 1.16
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
  for (const v0 of V0_LADDER) {
    // **어느 쪽으로 비껴 쏘는가**도 같이 훑는다. 무대가 공전을 시작하면서
    // 좌우가 더는 대칭이 아니게 됐다 — 행성이 도는 쪽으로 비껴 쏘면 상대속도가
    // 낮아 크게 휘고, 반대쪽은 덜 휜다. 한쪽만 보면 그 차이만큼 답을 놓친다.
    for (const side of [1, -1]) {
      if (performance.now() > until) return null   // 세팅에 쓸 시간이 끝났다
      const launch = (b) => at(-approach, b * side)
      const vel = { x: u.x * v0, y: u.y * v0 }
      // 굴려 보는 지평은 미사일 수명을 넘지 않는다 — 게임이 52초에 자폭시키므로
      // 그 밖의 접촉은 계산해도 일어나지 않는다(그리고 그 헛계산이 세팅 시간의
      // 대부분이었다: 시드당 최대 12.7초 → 1.4초).
      const flightT = (approach + outDist + hitJ * 5) / (v0 * 0.5)
      const chaseT = Math.min(flightT * 2.2, CFG.MISSILE_TTL)

      // 임팩트 파라미터 이분법 — b가 커질수록 근점거리도 커진다(단조)
      let lo = hitJ * 0.4, hi = hitJ * 6
      for (let k = 0; k < 9; k++) {
        const b = (lo + hi) / 2
        const r = probeSwing(g.bodies, J.id, launch(b), vel, flightT, outDist).rp
        if (r < wantRp) lo = b; else hi = b
      }
      // 확정은 **실제와 같은 dt로** 다시 잰다. 이분법은 거친 해상도(1/60·천체는
      // 4스텝마다)로 도는데, 그 오차가 근점거리에서 십수 GU다 — 판정 원 바로
      // 바깥을 노리는 값이라 그 오차가 곧 "탄이 가스 행성에 박힌다"가 된다.
      // 나오는 자리·시각도 여기서 얻은 것을 쓴다(큐볼이 거기 선다).
      const b = (lo + hi) / 2
      const s = probeSwing(g.bodies, J.id, launch(b), vel, flightT, outDist, FINE_DT, FINE_EVERY)
      if (!s.exit || s.deg < CFG.SWING_DEG + 2 || s.rp < hitJ * 1.06) continue

      // ── 여기서부터: 스윙바이는 확정됐다. 나온 자리에 큐볼을 세운다 ──
      const aim = Math.atan2(u.y, u.x)

      // 큐볼을 미사일이 지나갈 자리에 놓는다. 그런데 놓는 순간 판이 바뀐다:
      // 미사일이 받는 행성 중력은 κ=120배라(§4.3) 큐볼 하나가 **들어가는 길까지**
      // 안쪽으로 당긴다. 그러면 근점거리가 줄어 탄이 가스 행성에 그대로 박힌다
      // (계측: 큐볼 배치 실패 40건 중 32건이 이것이었다).
      // 그래서 두 손잡이를 같이 돌린다 — 빗나가면 **큐볼을 옮기고**, 가스 행성에
      // 박히면 **그만큼 더 비껴 쏜다**(비껴 쏘는 양 bb를 키우고 나오는 자리를
      // 다시 잡는다). 발사점이 움직이므로 지구도 매번 같이 옮겨 세운다.
      let bb = b, ss = s, hit = null, L = launch(b)
      let q = { x: ss.exit.x, y: ss.exit.y }
      for (let k = 0; k < 7; k++) {
        L = launch(bb)
        place(E, L.x - u.x * CFG.LAUNCH_OFFSET, L.y - u.y * CFG.LAUNCH_OFFSET)
        place(C, q.x, q.y)
        hit = firstContact(g.bodies, C.id, L, vel, chaseT, ss.tExit)
        if (hit.id === C.id && hit.t > ss.tExit) break
        if (hit.id !== J.id && hit.near) {                  // 그냥 빗나갔다 — 큐볼을 옮긴다
          q = { x: q.x + (hit.near.x - hit.near.cx), y: q.y + (hit.near.y - hit.near.cy) }
          continue
        }
        bb += hitJ * 0.12                                   // 더 비껴 쏜다
        ss = probeSwing(g.bodies, J.id, launch(bb), vel, flightT, outDist, FINE_DT, FINE_EVERY)
        if (!ss.exit || ss.deg < CFG.SWING_DEG + 2) { hit = null; break }
        q = { x: ss.exit.x, y: ss.exit.y }
      }
      if (!hit || hit.id !== C.id || hit.t <= ss.tExit) continue

      // ── 밀려난 큐볼이 갈 자리에 요새를 세운다 ──
      // 임펄스 방향은 폭심 → 중심(=어느 살을 쳤는가)이고, 그 뒤 큐볼은 거의
      // 직진한다. 다만 "거의"라서 눈대중으로 놓으면 60 GU짜리 접촉 원을 스친다.
      // 놓고 → 굴려 보고 → **가장 가까웠던 순간의 어긋남만큼** 옮기기를 몇 번
      // 돌려 확정한다. 요새도 이제 공전하므로 "큐볼이 간 자리"로 옮기는 것만으로는
      // 안 맞는다 — 그 사이 요새 자신이 80 GU쯤 옮겨 가 있기 때문이다.
      // 어긋남으로 고치면 요새가 움직이든 말든 같은 식으로 수렴한다.
      let post = impulseOf(C, hit)
      // 굴러가는 시간 — 길수록 그림이 좋지만(밀린 공이 한참 굴러가 박는다)
      // 요새가 카이퍼 벨트 밖에 서면 그 무대는 통째로 못 쓴다. 그래서 남은
      // 거리에 맞춰 줄인다. 5.2초는 상한일 뿐이다.
      const runT = Math.max(3.4, Math.min(5.2, (2300 - Math.hypot(hit.cx, hit.cy)) / Math.max(1, post.w)))
      // 첫 짐작 — 큐볼이 runT초 뒤에 가 있을 자리에서, 요새 자신이 그동안
      // 공전할 몫만큼 되돌린 자리.
      let aim0 = orbitAt(hit.cx + post.ux * post.w * runT, hit.cy + post.uy * post.w * runT, -runT)
      let fx = aim0.x, fy = aim0.y
      let ok = false
      for (let k = 0; k < 7 && !ok; k++) {
        if (Math.hypot(fx, fy) > 2350) break                  // 카이퍼 벨트에 너무 붙는다
        place(F, fx, fy)
        // 요새를 놓으면 그 질량이 미사일 궤적도 조금 바꾼다 — 매번 다시 확인한다.
        // 어긋났으면 큐볼 자리를 그만큼 고쳐 잡고 다시 본다(여기서 포기하면
        // 요새 하나 놓은 값으로 무대를 통째로 버리는 셈이다).
        const h2 = firstContact(g.bodies, C.id, L, vel, chaseT, ss.tExit)
        if (h2.id !== C.id || h2.t <= ss.tExit) {
          if (!h2.near) break
          q = { x: q.x + (h2.near.x - h2.near.cx), y: q.y + (h2.near.y - h2.near.cy) }
          place(C, q.x, q.y)
          continue
        }
        hit = h2
        post = impulseOf(C, hit)
        if (post.w < 24) break                                // 너무 안 밀리면 이야기가 안 된다
        const r = runAfter(h2.sim, C.id, F.id, post, runT * 1.7, 1 / 60, hit)
        if (r.hit) { ok = true; break }
        if (r.blocked || !r.off) break                        // 딴 게 진로를 막고 있다
        fx += r.off.x; fy += r.off.y                          // 빗나간 만큼 요새를 옮긴다
      }
      if (!ok) continue

      // ── 마지막 확인 — 스윙바이가 **정말로** 서는가 ──
      // 위의 이분법은 탐색용 해상도(1/60, 천체는 4스텝마다)로 푼 값이고, 그때
      // 무대에는 큐볼도 요새도 아직 없었다. 둘을 놓고 나면 그 질량이 진로를
      // 조금 바꾼다 — 굴절이 25° 문턱 아래로 내려가면 화면에 스윙바이가 안 뜬다
      // (계측: 안 보고 넘어갔더니 12시드 중 3건이 굴절 0°로 끝났다).
      // 그래서 확정된 판 위에서 실제와 같은 dt로 한 번 더 굴려 본다.
      const fin = probeSwing(g.bodies, J.id, L, vel, flightT, outDist, FINE_DT, FINE_EVERY)
      if (fin.deg < CFG.SWING_DEG + 2) continue
      // 밀려난 큐볼이 요새에 닿는 것도 실제 dt로 한 번 더 본다. 위의 수렴은
      // 1/60로 돌렸는데, 판은 1/120로 흐른다 — 그 차이가 60 GU짜리 접촉 원을
      // 스치고 지나가게 만들 수 있다(계측: 20시드 중 1건이 요새를 비껴갔다).
      if (!runAfter(cloneBodies(hit.sim), C.id, F.id, post, runT * 1.7, CFG.DT, hit).hit) continue

      return { J, C, F, aim, v0, rp: ss.rp, deg: fin.deg, runT }
    }
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
// 먼저 막는가, 아니면 얼마나 빗나가는가.
// off = **가장 가까웠던 순간**의 (큐볼 − 요새). 요새를 이만큼 옮기면 그 순간에
// 정확히 겹친다 — 둘 다 움직이고 있어도 성립하는 유일하게 단순한 보정이다.
function runAfter(sim, cId, fId, post, seconds, dt = 1 / 60, blast = null) {
  const c = sim.find(b => b.id === cId), f = sim.find(b => b.id === fId)
  if (!c || !f) return { hit: false }
  // 폭풍도 같이 친다 — 요새가 폭심에서 312 GU 안이면(흔하다) 저쪽도 밀린다.
  // 게임이 하는 것과 같은 순서다(detonate: applyNuke → blastWave, 큐볼은 제외).
  if (blast) blastWave(sim, blast.x, blast.y, CFG.YIELD_MAX, c)
  c.vel.x = post.ux * post.w; c.vel.y = post.uy * post.w
  const steps = Math.round(seconds / dt)
  let best = Infinity, off = null
  for (let i = 0; i < steps; i++) {
    stepBodies(sim, dt)
    const dx = c.pos.x - f.pos.x, dy = c.pos.y - f.pos.y
    const d = Math.hypot(dx, dy)
    if (d < best) { best = d; off = { x: dx, y: dy } }
    if (d < hitRadiusOf(c) + hitRadiusOf(f)) return { hit: true, t: (i + 1) * dt }
    for (const o of sim) {
      if (o === c || o === f || !o.alive || o.type === 'debris') continue
      if (Math.hypot(c.pos.x - o.pos.x, c.pos.y - o.pos.y) < hitRadiusOf(c) + hitRadiusOf(o))
        return { hit: false, blocked: true }
    }
  }
  return { hit: false, off }
}

// 미사일이 처음 닿는 천체. 아무 데도 안 닿으면 목표 천체에 가장 가까웠던
// 순간(near)을 함께 돌려준다 — 자리를 고쳐 잡는 데 쓴다.
//
// after — **이 시각 전의 근접은 세지 않는다.** 큐볼 자리를 고쳐 잡는 보정이
// 이걸 보고 움직이는데, 스윙바이 **전**(들어가는 길)의 근접까지 세면 큐볼이
// 그쪽으로 끌려간다. 그러면 탄은 가스 행성을 돌기도 전에 큐볼을 쳐 버려서
// 스윙바이가 통째로 사라진다(계측: 12시드 중 6건이 굴절 0°로 끝났다).
// 큐볼은 언제나 **나오는 길**에 선다.
function firstContact(bodies, wantId, pos, vel, seconds, after = 0) {
  let id = null, cx = 0, cy = 0, hx = 0, hy = 0, vx = 0, vy = 0, at = 0
  let bestD = Infinity, near = null
  const end = fly(bodies, pos, vel, seconds, (m, sim, tt) => {
    const want = sim.find(o => o.id === wantId)
    if (want && want.alive && tt > after) {
      const d = Math.hypot(m.pos.x - want.pos.x, m.pos.y - want.pos.y)
      if (d < bestD) { bestD = d; near = { x: m.pos.x, y: m.pos.y, cx: want.pos.x, cy: want.pos.y } }
    }
    for (const o of sim) {
      if (!o.alive || o.type === 'debris') continue
      const r = hitRadiusOf(o)
      if (Math.hypot(m.pos.x - o.pos.x, m.pos.y - o.pos.y) > r) continue
      id = o.id; cx = o.pos.x; cy = o.pos.y; at = tt
      hx = m.prev.x; hy = m.prev.y; vx = o.vel.x; vy = o.vel.y
      return true
    }
    return Math.hypot(m.pos.x, m.pos.y) < CFG.R_STAR + 8
  }, FINE_DT, FINE_EVERY)
  return { id, cx, cy, x: hx, y: hy, vx, vy, near, t: at, sim: end.sim }
}

// ── 판 세팅 ─────────────────────────────────────────────────────

// 배역을 고른다.
//   스윙바이 천체 — **가스 행성**. 궤적이 화면에서 읽히려면 덩치가 있어야 하고
//     (그래서 제일 큰 놈), 고리가 달려 있어 화면에서 한눈에 구분된다.
//     너무 크면 판정 원(3.4×)이 스윙바이 구간(6×)을 거의 다 먹어 지날 틈이 없다.
//   큐볼 — 핵 한 방에 잘 밀리는 것. 무거우면 이야기가 안 굴러간다.
function castOf(g) {
  const solar = g.bodies.filter(b =>
    b.alive && !b.isEarth && !b.zorg && b.type !== 'debris' && b.role !== 'void')
  const big = (list) => list.slice().sort((a, b) => b.radius - a.radius)[0]
  const swing = big(solar.filter(b => b.role === 'volatile')) ?? big(solar)
  // 큐볼의 Δv는 **중간**이어야 한다. 가벼운 얼음은 300~480 GU/s로 튕겨 나가
  // 화면 밖으로 사라지고, 무거운 금속은 40 아래라 굴러가질 않는다.
  // 큐볼은 **밀려서 굴러가야** 한다 — 맞는 순간 없어지는 것(가스·불안정)은 배역이 안 된다.
  const cue = solar.filter(b => b !== swing && b.role !== 'volatile' && b.role !== 'unstable' && b.hpMax >= 2)
    .map(b => ({ b, dv: effDv(b, CFG.YIELD_MAX) }))
    .sort((p, q) => Math.abs(p.dv - 70) - Math.abs(q.dv - 70))[0]?.b
  const fort = g.bodies.find(b => b.alive && b.role === 'battery')
  return (swing && cue && fort) ? { swing, cue, fort, earth: g.earth } : null
}

// 판을 처음부터 다시 세우고 이번 장면을 짠다.
function setUp(g, mode) {
  g.resetRun()
  g.stepWarpIns(1e9)    // 조르그 증원 워프를 즉시 끝내 놓는다(예고편이 직접 연출한다)
  g.endOpening()        // 개막 막도 같이 걷는다 — 여기서는 예고편이 화면의 주인이다
  g.fx.length = 0
  g.mode = mode
  g._predKey = null
  g.obsSpeed = 3        // 관측 8× — 처음부터 끝까지. 미사일이 나는 동안엔
                        // 게임이 스스로 4×로 낮춘다(제대로 보라고).
  g.yieldMt = CFG.YIELD_MAX

  const cast = castOf(g)
  if (!cast) return null

  // 요새는 하나만 남긴다. 둘을 두면 이 한 수로 판이 안 끝나 이야기가 잘린다.
  // (모함은 4스테이지부터라 예고편(=1판)에는 애초에 없지만, 있으면 같이 걷는다.)
  for (let i = g.bodies.length - 1; i >= 0; i--) {
    const b = g.bodies[i]
    if (b.role === 'hive' || (b.role === 'battery' && b !== cast.fort)) g.bodies.splice(i, 1)
  }
  g.targets = [cast.fort]
  g.goal = makeGoal([cast.fort])

  // ③에서 광선 앞으로 끼어들 행성을 **먼저** 정하고 질량을 지워 둔다.
  // 사라지는 행성은 중력도 같이 사라지는데 미사일에는 그게 κ=120배로 실리므로
  // (§4.3), 있다고 치고 푼 궤적은 ⑤에서 어긋난다. 제물을 시험입자로 만들어
  // 두면 살아 있든 죽든 판이 똑같아서, 무대는 한 번만 풀면 된다.
  // (판은 예고편이 끝나며 resetRun으로 통째로 되돌아간다 — 질량도 같이.)
  const victim = pickInterceptor(g, cast)
  if (!victim) return null
  victim.mu = 1e-3

  const u = longAxis(), n = perp(u)
  const actors = [cast.swing, cast.cue, cast.fort, cast.earth]
  // 세팅에 쓸 수 있는 시간. 이건 **첫 화면이 뜨기 전에** 도는 계산이라
  // 여기서 오래 붙들면 게임이 안 뜬 것처럼 보인다. 시간 안에 답이 안 나오면
  // 예고편을 통째로 건너뛴다(finish) — 못 보여 주는 것보다 안 뜨는 게 나쁘다.
  const until = performance.now() + SETUP_BUDGET_MS
  for (const P of stageSpots(g, actors, u).slice(0, 6)) {
    const shot = solveShot(g, u, n, P, cast, until)
    if (!shot) continue
    // 광선의 길을 풀고 그 위에 제물을 세운다. 못 세우면 이 무대는 못 쓴다 —
    // 조준은 지구이므로 아무도 안 끼어들면 **지구가 맞는다.**
    if (!planBeam(g, cast, victim)) continue
    if (!clearRewind(g, cast, [...actors, victim])) continue
    shot.victim = victim
    g.aim = shot.aim; g.power = shot.v0
    return shot
  }
  return null
}

// ── ③ 광선 — 조준은 지구, 맞는 건 딴 놈 ────────────────────────
// 이 막에서 조르그는 **제대로 조준한다.** 게임에서 하는 그 계산 그대로
// 지구가 도달할 자리를 겨누고 쏜다(laser.solveAim). 예고편이라고 빗맞히지
// 않는다 — 빗나가는 걸 보여 주면 "저건 피할 수 있는 것"이 되어 버린다.
//
// 그런데 지구는 산다. 안쪽 궤도를 도는 작은 행성 하나가 **제 공전 속도로**
// 그 선 위를 가로지르다 대신 맞고 통째로 사라지기 때문이다. 그래서 이 막이
// 남기는 것은 둘이다: 저건 지구를 겨눈다 / 닿으면 체력과 무관하게 없어진다.
// 그리고 지구가 산 것은 **운**이었다는 것까지.

// 끼어들 행성 — 작을수록 좋다. 무대 배우도 아니고, 삼키는 것(특이점)도 아니고,
// 터지는 것(가스)도 아니어야 한다. 어차피 자리는 우리가 정해 옮겨 놓으므로
// 지금 어디 있는지는 보지 않는다.
function pickInterceptor(g, cast) {
  const keep = [cast.earth, cast.fort, cast.swing, cast.cue]
  return g.bodies
    .filter(b => b.alive && b.type !== 'debris' && !keep.includes(b)
      && b.role !== 'void' && b.role !== 'volatile' && b.role !== 'unstable'
      && b.role !== 'battery' && b.role !== 'hive')
    .sort((a, b) => a.radius - b.radius)[0] ?? null
}

// 태양 원반과 다른 천체가 (ox,oy)→거리 d 사이를 막고 있지는 않은가.
// 제물보다 먼저 닿는 것이 있으면 그게 대신 타 버린다(laser.sweep은 첫 놈에서 멈춘다).
function beamClear(sim, ox, oy, ux, uy, d, skipIds) {
  const t = -ox * ux - oy * uy                    // 총구 → 태양의 진행 방향 성분
  if (t > 0 && t < d && Math.hypot(-ox - ux * t, -oy - uy * t) < CFG.R_STAR * 1.6) return false
  for (const b of sim) {
    if (!b.alive || b.type === 'debris' || skipIds.includes(b.id)) continue
    const px = b.pos.x - ox, py = b.pos.y - oy
    const along = px * ux + py * uy
    if (along <= 0 || along > d) continue
    if (Math.abs(ux * py - uy * px) < hitRadiusOf(b) + 30) return false
  }
  return true
}

// 광선의 길을 풀고, 그 길 위에 제물을 세운다.
//
// 순서가 뒤집혀 있다는 데 주의: 무대는 **발사 시점**(⑤가 시작되는 순간)에 맞춰
// 풀려 있고, ③은 그보다 앞선 4.4초다. 그래서 판을 그만큼 되감았다가 발사
// 시각까지 되밟아 총구와 조준점을 잡는다(도약 적분은 시간대칭이라 왕복이
// 정확하다). 거기서 광선이 지날 선을 얻고, 그 선 위의 한 점을 골라
// **제물이 그 순간 거기 도착하도록** 궤도를 거꾸로 돌려 세운다.
function planBeam(g, cast, victim) {
  const sim = cloneBodies(g.bodies)
  for (let i = 0, n = stepsOf(ACT_SEC.beam); i < n; i++) stepBodies(sim, -CFG.DT)
  for (let i = 0, n = Math.round(BEAM_FIRE_AT / CFG.DT); i < n; i++) stepBodies(sim, CFG.DT)
  const F = sim.find(b => b.id === cast.fort.id), E = sim.find(b => b.isEarth)
  if (!F || !E) return null
  const ox = F.pos.x, oy = F.pos.y
  // 조르그의 조준 — 게임이 하는 계산 그대로다(laser.solveAim):
  // 지금 지구까지의 거리로 비행시간을 어림하고, 그만큼 앞선 자리를 겨눈다.
  const A = drift(E, Math.hypot(E.pos.x - ox, E.pos.y - oy) / CFG.LASER_SPEED)
  const dTot = Math.hypot(A.x - ox, A.y - oy) || 1
  const ux = (A.x - ox) / dTot, uy = (A.y - oy) / dTot
  const skip = [cast.fort.id, victim.id]
  const stage = [cast.earth, cast.fort, cast.swing, cast.cue]
    .map(b => sim.find(o => o.id === b.id)).filter(Boolean)
  // 그 선 위 어디에 세울까 — **광선을 가장 크게 가로지르는** 자리다.
  // 비스듬히 스치면 화면에서는 그냥 맞은 것으로 보인다. 직각으로 가로지를수록
  // "딴 행성이 끼어들었다"가 읽힌다.
  //
  // 훑는 구간이 넓은 데는 이유가 있다. 조준선이 지구를 향하는 이상 그 선은
  // **무대를 세로로 관통한다**(지구도 스윙바이 천체도 큐볼도 요새도 그 선
  // 위에 늘어서 있다). 그래서 설 자리는 대개 총구 바로 앞의 짧은 구간뿐이다 —
  // 그보다 멀면 큐볼이나 가스 행성이 먼저 맞는다.
  //
  // 그렇다고 총구 코앞을 고르면 이 막이 하려던 말이 통째로 뒤집힌다. 화면에
  // 남는 건 "조르그가 도착하자마자 **옆에 있던 돌 하나**를 쐈다"이고, 조준이
  // 지구였다는 건 아무 데도 안 남는다(계측: 6시드 중 4시드가 지구까지 거리의
  // 14~19% 지점에서 끝났다). 그래서 **멀수록 크게** 친다 — 광선이 성계를
  // 가로질러 지구 쪽으로 한참 날아가다 끊기면, 끊기기 전까지의 그 선이
  // "저건 지구를 겨눴다"를 대신 말해 준다.
  const flyMax = (ACT_SEC.beam - BEAM_FIRE_AT) * CFG.LASER_SPEED * 0.92
  let best = null
  for (let k = 0; k <= 32; k++) {
    const d = dTot * (0.12 + 0.73 * k / 32)
    // 광선은 ③ 안에서 제물에 닿아야 한다. 막이 끝난 뒤에 닿으면 그 소멸은
    // 예측 컷(④)이 조용히 정리하는 일이 되어 화면에서 통째로 사라진다.
    if (d > flyMax) break
    const qx = ox + ux * d, qy = oy + uy * d
    const rq = Math.hypot(qx, qy)
    if (rq < CFG.R_STAR * 2.2) continue                       // 태양에 너무 붙는다
    if (stage.some(b => Math.hypot(b.pos.x - qx, b.pos.y - qy) < BEAM_SAFE)) continue
    if (!beamClear(sim, ox, oy, ux, uy, d, skip)) continue
    // 제물의 진행 방향(원궤도 접선)과 광선이 이루는 각의 사인 — 직각으로
    // 가로지를수록 "끼어들었다"가 읽힌다. 거리와 곱해 고른다.
    const cross = Math.abs(-qy / rq * uy - qx / rq * ux)
    const score = cross * (0.15 + 1.85 * d / dTot)
    if (!best || score > best.score) best = { x: qx, y: qy, d, score, t: d / CFG.LASER_SPEED }
  }
  if (!best) return null
  // 착탄 순간 그 자리에 있으려면, 무대가 선 시각(=③의 끝)에는 그만큼 더 간
  // 자리에 있어야 한다. 되감기는 이 자리를 궤도를 따라 거꾸로 돌려 준다.
  const p = orbitAt(best.x, best.y, ACT_SEC.beam - BEAM_FIRE_AT - best.t)
  place(victim, p.x, p.y)
  return best
}

// 태양 중력만으로 sec초 뒤까지 굴린다 — 조르그의 조준 계산과 같은 방식이다.
function drift(b, sec) {
  const sim = cloneBodies([b])
  const dt = 1 / 40, n = Math.round(sec / dt)
  for (let i = 0; i < n; i++) stepBodies(sim, dt)
  return { x: sim[0].pos.x, y: sim[0].pos.y }
}

// ①~③ 동안 무대가 딴 공과 부딪히지는 않는가.
// 되감기(stepBodies)는 충돌을 안 보지만 되밟기(game.step)는 본다 — 즉 되감는
// 길에 딴 공이 놓여 있으면 예고편은 그 자리에서 어그러진다. 공전을 시작한
// 지금은 배우들이 25초 동안 궤도를 3분의 1바퀴씩 도므로 미리 걸러야 한다.
// 되감기 순서는 start()와 똑같이 둔다(①에서는 요새가 아직 판에 없다).
function clearRewind(g, cast, watch) {
  const sim = cloneBodies(g.bodies)
  const fort = sim.find(b => b.id === cast.fort.id)
  const eyes = watch.map(b => sim.find(o => o.id === b.id)).filter(Boolean)
  for (const [steps, fortHere] of [
    [stepsOf(ACT_SEC.warp) + stepsOf(ACT_SEC.beam), true],
    [stepsOf(ACT_SEC.peace), false],
  ]) {
    if (fort) fort.alive = fortHere
    for (let i = 0; i < steps; i++) {
      stepBodies(sim, -CFG.DT)
      if (i % 4) continue
      for (const a of eyes) {
        if (!a.alive) continue
        for (const b of sim) {
          if (b === a || !b.alive || b.type === 'debris') continue
          if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < contactDist(a, b) * 1.2) return false
        }
      }
    }
  }
  return true
}

// 조르그가 처음 들어와서 하는 말. 이 한 줄이 판의 전제다 —
// 저쪽이 원하는 건 지구가 아니라 성계 전체고, 지구는 그 앞을 막고 있을 뿐이다.
const warpLine = () => t('zorg.warp')

// 총구를 물린다. 예전에는 여기서 상태기를 두 스텝에 통과시켜 **충전을 건너뛰고**
// 곧장 발사했는데, 그러면 광선이 아무 예고 없이 튀어나온다. 게임에서는 95초에
// 걸쳐 총구에 빛이 모이는 게 이 무기의 절반인데 예고편만 그걸 안 보여 준 것이다.
// 이제 충전 상태로 세워 두고 **남은 시간만 BEAM_CHARGE초로 줄인다** — 같은 연출,
// 같은 상태기, 길이만 다르다.
//
// 조준점은 **건드리지 않는다.** 예전에는 예고편이 조준을 빼앗아 제물 쪽으로
// 끌어다 놓았는데(lockAim), 그러면 요새가 엉뚱한 데를 겨누는 그림이 된다.
// 이제 조준은 게임이 한다 — 지구를 겨눈다. 대신 그 선 위에 딴 행성을 세운다.
function armBeam(g) {
  const L = g.laser
  if (!L) return null
  L.state = LASER_IDLE; L.t = 0; L.nextAt = 0
  g.step(CFG.DT)                                  // → charge (조준점 계산)
  if (L.state !== LASER_CHARGE) return null
  L.t = Math.max(0, CFG.LASER_CHARGE - BEAM_CHARGE)
  // 충전 시계를 95초에서 2.2초로 당겼으니 조준점도 그 자리에서 다시 풀어야
  // 한다 — 안 그러면 다음 갱신까지 "95초 뒤의 지구"를 겨누고 서 있다. 그건
  // 지구 공전의 62%만큼 앞선 자리라, 화면에 한 프레임이라도 나가면 요새가
  // 성계 반대편을 겨눈 그림이 된다(조준 마름모도 위험 회랑도 거기로 간다).
  // **여기서** 끝내 둔다 — 갱신 시계를 넘겨 놓고 한 스텝 더 밀면 상태기가
  // 남은 충전(2.2초)에 맞는 자리로 다시 잡는다. 예고편이 판을 굴리기 전에
  // 이미 옳은 조준점을 들고 있으므로, 밖에서 볼 수 있는 잘못된 상태가 없다.
  //
  // 판을 두 스텝 민 셈이지만 발사 시각(BEAM_FIRE_AT)은 그대로다: L.t를 못
  // 박은 뒤의 스텝은 판과 충전 시계를 **같이** 밀기 때문이다.
  L.refresh = 1e9
  g.step(CFG.DT)
  g.toast = null; g.toastT = 0
  return L
}

// 판을 거꾸로 감는다. 도약 적분(velocity-Verlet)은 시간대칭이라, 같은 dt로
// 되감았다가 같은 횟수만큼 다시 굴리면 원래 자리로 정확히 돌아온다.
// 그래서 "발사 시점에 맞춰 푼 무대"를 그대로 두고 그 앞의 몇십 초를 만들어
// 낼 수 있다 — ①~③ 동안 행성이 진짜로 공전하는 건 이 되감기 덕이다.
const stepsOf = (sec) => Math.round(sec / CFG.DT)
function rewind(g, steps) {
  for (let i = 0; i < steps; i++) stepBodies(g.bodies, -CFG.DT)
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
  constructor(game, view, onDone, comms = null, ground = null) {
    this.game = game; this.view = view; this.onDone = onDone
    this.comms = comms          // 예고편에도 저쪽이 한 마디 한다
    this.ground = ground        // 그리고 이쪽도 — ④에서 결론을 낸다
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
  <div class="slogosub">${t('attract.sub')}</div>
</div>
<button class="attractskip" id="attractSkip">${t('attract.skip')}</button>`
    document.body.appendChild(el)
    this.el = el
    this.fill = el.querySelector('#attractFill')

    el.querySelector('#attractSkip').onclick = (e) => { e.stopPropagation(); this.finish() }
    el.onclick = () => this.finish()
    // M은 안 먹는다 — 예고편을 보다가 소리를 끄고 싶을 수 있고, 그때
    // 아무 키나 예고편을 건너뛰게 두면 소리를 끄는 대신 예고편이 끝난다.
    this.onKey = (e) => { if (e.key === 'm' || e.key === 'M') return; e.preventDefault(); this.finish() }
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
    // 예고편이 도는 내내 켜져 있는 깃발. cinematic은 ⑤에서 꺼지지만(지상 관제가
    // 그때부터 말해야 한다) 관측 바는 끝까지 안 나와야 하므로 신호를 따로 둔다.
    g.trailer = true
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
    // ①은 아무 일도 없는 성계다. 이름표도 레티클도 없이 궤도와 벨트만 남긴다 —
    // 조르그가 들어오기 전까지는 화면에 표적이라는 개념 자체가 없어야 한다.
    g.cineBare = true
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
    g.cineBare = false          // 여기서부터 화면에 이름표와 레티클이 돌아온다
    this.burn()
    this.act('warp', WARP_MS)
    // 게임이 증원을 불러들일 때와 같은 연출이다(stepWarpIns가 하는 그대로).
    z.alive = true; z.warp = 1
    g.addFx({ kind: 'warp', x: z.pos.x, y: z.pos.y, r: hitRadiusOf(z), fort: true })
    g.syncLasers()          // 도착했으니 포대가 하나 생긴다 — ③이 이걸 쏜다
    this.bar(0.1)
    this.after(WARP_LINE_MS, () => this.comms?.say(warpLine()))
    this.after(WARP_MS, () => this.beams())
  }

  // ── ③ 광선 — 지구를 겨누고, 딴 행성이 끼어든다 ──
  beams() {
    if (this.done || this.phase !== 'warp') return
    this.burn()
    this.act('beam', BEAM_MS)
    this.bar(0.18)
    this.volley()
    this.after(BEAM_MS, () => this.predict())
  }

  // 한 발. armBeam은 상태기를 돌리고 조준점을 다시 잡느라 판을 두 스텝 미므로
  // 그만큼 예산에서 뺀다.
  volley() {
    this.beamAt = this.shot.victim      // 카메라가 물고 갈 제물
    if (armBeam(this.game)) this.actLeft = Math.max(0, this.actLeft - 2)
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
    for (let i = 0; i < 4000 && g.laser?.state === LASER_TRAVEL; i++) g.tickLaser(CFG.DT)
    // 예측선은 조준 모드에서만 그려진다(canAim). 조준 패널은 cinematic이 걷어낸다.
    g.setMode('aim')
    g.cinematic = true
    // ③에서 한 발 쏜 뒤로는 **다시 조준하지 않는다.**
    // 예전에는 여기서 본성을 발사 직전 상태로 되돌려 놓았다(armLaser) —
    // 카운트다운이 내내 줄어들다가 큐볼이 요새를 부수는 순간 끊기는 그림을
    // 노린 것이었다. 그런데 화면에 실제로 남는 건 **지구를 가로지르는 위험
    // 회랑과 조준 마름모**였고, ④는 "내 예측선을 읽는" 컷이라 그 붉은 띠가
    // 정작 보여 주려던 선을 덮었다. 한 발이면 충분하다 — 광선이 뭘 하는지는
    // ③에서 이미 봤다.
    // (다음 조준까지의 시계는 인게임 300초 언저리라, 남은 25초 동안 저절로
    //  다시 충전되지도 않는다.)
    this.comms?.close()
    // ── 네 마디 ──
    // ③에서 지구를 겨눈 광선을 봤고, 딴 행성이 대신 맞아 통째로 사라지는 것도
    // 봤다. 여기서 관제가 그 둘을 말로 받고("조준은 우리였다" · "닿으면
    // 없어진다"), 핵으로는 안 된다는 데서 막히고, 그 막힌 자리에서 이 게임을
    // 발명한다. 조준 모드라 평소 규칙으로는 안 뜨므로 Ground.say로 밀어 넣는다.
    const lines = ['gnd.trailer.fear', 'gnd.trailer.hit', 'gnd.trailer.nuke', 'gnd.trailer.idea']
    lines.forEach((k, i) => this.after(IDEA_MS[i], () => this.ground?.say(t(k), IDEA_HOLD)))
    this.bar(0.3)
    this.after(AIM_MS, () => this.launch())
  }

  launch() {
    if (this.done || this.phase !== 'aim') return
    this.phase = 'fly'
    this.game.paused = false      // 여기서부터 판이 흐른다
    // 여기서부터 지상 관제가 조르그 광선에 대해 입을 연다(Ground가 cinematic을 본다).
    // 관측 바는 여전히 안 나온다 — 그건 g.trailer가 끝까지 막는다.
    this.game.cinematic = false
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
    // 지상 관제가 조르그 광선에 대해 말할 수 있는 건 탄두가 나는 동안뿐이다.
    // 나머지 구간은 저쪽(조르그)의 막이라 이쪽이 끼어들면 한 방이 해설에 묻힌다.
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
      // 총구 · 끼어드는 행성 · **지구**를 한 화면에.
      // 지구를 넣으면 화면이 그만큼 물러나지만, 이 막의 요점이 바로 그거다 —
      // 조준선이 어디서 어디로 그어져 있는가. 그게 안 보이면 행성 하나가
      // 그냥 터지는 장면이 되고, "지구를 겨눴다"는 사라진다.
      const h = this.zorg
      if (h && h.alive) pts.push({ x: h.pos.x, y: h.pos.y, r: 240 })
      pts.push({ x: g.earth.pos.x, y: g.earth.pos.y, r: 150 })
      const b = this.beamAt
      // 제물은 판정 원보다 넉넉히 잡는다 — 소멸 폭발이 그보다 훨씬 크게 번져서,
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
    this.game.cineBare = false
    // 모드는 그대로 둔다 — 여기서 조준 모드로 돌리면 로고 뒤로 HUD 패널이
    // 다시 튀어나온다. 배속만 1×로 내려 판을 잔잔하게 만든다.
    this.game.advancing = false
    this.game.obsSpeed = 0
    this.comms?.close()          // 로고 위에 교신창을 얹지 않는다
    AUDIO.ui('logo')             // 예고편의 마침표
    this.el.classList.add('logo')
    this.bar(1)
    this.after(LOGO_MS, () => this.finish())
  }

  finish() {
    if (this.done) return
    this.done = true
    this.game.cinematic = false
    this.game.trailer = false
    this.game.paused = false
    this.game.cineBare = false
    this.comms?.close()
    this.ground?.close()
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
