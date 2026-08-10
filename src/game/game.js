import { fromAngle, len } from '../core/vector.js'
import { Rng } from '../core/random.js'
import { CFG, aMaxOf, beltRadius, escapeSpeed, hitRadiusOf, radiusOf } from './config.js'
import {
  applyNuke, beltBounce, blastWave, elasticBounce, resolveBodyPairs, segCircleEntry,
  segHitsCircle, shatter, stepBodies, stepMissile, updateEncounters,
} from './physics.js'
import { hasRole, roleOf, volatileRadius } from './roles.js'
import { causeText, makeGoal } from './objectives.js'
import { msg, nameOf, t } from '../i18n/index.js'
import { bearing } from '../core/angle.js'
import { createSystem, reinforce } from './system.js'
import { makeBody } from './body.js'
import { chargeLeft, impactLeft, makeDoom, makeLaser, stepDoom, stepLaser, stepSpent, LASER_CHARGE, LASER_SPENT, LASER_TRAVEL } from './laser.js'
import * as Aim from './aim.js'

// 관측 모드 배속 단계 — 화면의 배속 버튼이 이 사이를 돈다
const OBS_SPEEDS = [1, 2, 4, 8]

// 파괴 사유별 점수 (목표 / 중립). 추방은 없앴다 — 벨트가 되돌려 보낸다.
const KILL_SCORE = {
  collision: [120, 40],
  laser: [0, 0],        // 조르그가 제 광선으로 부순 것 — 내 공이 아니다
  absorb: [110, 35],
  sun: [100, 30],
  blast: [80, 25],
}
export class Game {
  constructor(seed) {
    this.bodies = []
    // 같은 쌍이 한 번의 접촉에서 여러 스텝 붙어 있어도 피해는 한 번만 센다
    this.pairCool = new Map()
    this.resetRun(seed)
  }

  // ─── 런을 처음부터 다시 ──────────────────────────────────────
  // **객체 정체성을 유지한다.** 렌더러·HUD·카메라가 전부 이 인스턴스와 이
  // bodies 배열을 붙들고 있으므로, 새 Game을 만들면 그 참조를 전부 다시 이어야
  // 한다. 제자리에서 갈아 끼우면 아무것도 안 건드려도 된다.
  // (오프닝 예고편이 실제 게임을 굴려 보여 준 뒤 판을 되돌리는 데 쓴다.)
  resetRun(seed = this.seed) {
    this.seed = seed >>> 0
    this.stageIdx = 0; this.runScore = 0; this.runOver = false
    this.rng = new Rng(this.seed ^ 0x9e3779b9)
    // ─── 지속 성계 ───
    // 성계는 런 전체에서 하나뿐이다. 판이 끝나도 새로 만들지 않고,
    // 살아남은 행성이 위치·속도·**체력** 그대로 다음 판으로 넘어간다.
    // 체력이 이어지는 건 특히 지구가 그렇다 — 한 판에서 두 번 처박힌 지구는
    // 1/3으로 다음 판을 시작한다. 판마다 리셋되면 "지구를 지킨다"가 한 판짜리
    // 임무가 되어 버리는데, 이 게임의 판돈은 런 전체다.
    // (loadStage는 hp를 건드리지 않는다. 체력을 쓰는 곳은 damage() 하나뿐이다.)
    const sys = createSystem(this.seed)
    this.bodies.length = 0; this.bodies.push(...sys.bodies)   // 배열 정체성 유지
    this.earth = sys.earth
    this.lasers = []          // 살아 있는 포대 하나당 하나 (syncLasers가 명단을 관리한다)
    this.pairCool.clear()
    this.loadStage()
  }

  // 카이퍼 벨트 반경 — 성계의 쿠션. aMax가 안테마다 커지므로 파생값으로 둔다.
  get beltR() { return beltRadius(this.aMax) }

  get ante() { return Math.min(8, 1 + Math.floor(this.stageIdx / 3)) }

  // ─── 작전 시한 (인게임 시간) ───
  // this.time은 step()에서만 누적되고, step()은 effTimeScale()>0일 때만 돈다.
  // → 조준만 하고 있으면 시계가 멈춰 있고, 관측하거나(플레이어가 고른 배속)
  //   조준 중에 시간 진행 버튼을 누르고 있을 때만 줄어든다.
  get stageTime() { return CFG.TIME_BASE + CFG.TIME_PER_ANTE * Math.min(this.ante - 1, 5) }
  get timeLeft() { return Math.max(0, this.stageTime - this.time) }
  get timeBonus() { return Math.round(this.timeLeft * CFG.TIME_BONUS) }

  loadStage() {
    this.aMax = aMaxOf(this.ante)
    this.fx = []   // 렌더러가 매 프레임 비워가는 연출 이벤트 큐 (§14.5)
    // 잔해만 **제자리에서** 걷어낸다. 배열을 새로 만들면 렌더러가 성계를 통째로
    // 다시 짓고 카메라가 튀어서 판 사이에 화면이 끊긴다 — 이 게임은 성계가
    // 런 내내 하나로 이어지는 게 전제이므로 그 끊김이 거짓말이 된다.
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]
      if (!b.alive || b.type === 'debris') this.bodies.splice(i, 1)
    }
    // 조르그 증원 — 지금 성계에 남은 것을 보고 그만큼만 보낸다.
    // 한꺼번에 뿅 나타나지 않고 **순서대로** 워프해 들어온다(stepWarpIns).
    const { added, fortresses } = reinforce(this.rng, this.bodies, this.earth, this.ante, this.stageIdx)
    // 마릿수가 많으면 간격을 조여 도착 전체를 WARP_SPAN 안에 담는다 —
    // 막이 마지막 한 기까지 기다리므로, 간격이 고정이면 후반 개막이 10초를 넘는다.
    const gap = added.length > 1
      ? Math.min(CFG.WARP_STAGGER, CFG.WARP_SPAN / (added.length - 1))
      : CFG.WARP_STAGGER
    added.forEach((b, i) => { b.alive = false; b.warp = 1; b.warpIn = CFG.WARP_LEAD + i * gap })
    // 스폰이 끝나는 시각 = 마지막 도착 + 그 한 기가 다 나타나는 데 걸리는 시간.
    // 렌더러가 b.warp를 WARP_TIME에 걸쳐 0으로 내리므로, 마지막 warpIn만 보고
    // 막을 걷으면 요새가 아직 반투명한 채로 조작이 열린다.
    this.spawnEnd = added.length ? CFG.WARP_LEAD + (added.length - 1) * gap + CFG.WARP_TIME : 0
    // 개막 동안 카메라가 따라다닐 명단. 도착 순서대로다(카메라가 그 순서로 민다).
    this.arrivals = added
    this.targets = fortresses
    this.goal = makeGoal(fortresses)
    // 포대 명단은 판마다 새로 짠다 — 시차(순번)를 처음부터 다시 세워야 하고,
    // 새 판이 시작하자마자 지난 판의 충전이 이어져 발사되면 안 된다.
    this.lasers.length = 0
    this.syncLasers()

    this.pairCool.clear()
    this.doom = null; this.mothership = null
    this.missiles = []; this.shots = 0; this.score = 0
    this.won = false; this.lost = false; this.failReason = null
    const t = this.target
    this.aim = Math.atan2(t.pos.y - this.earth.pos.y, t.pos.x - this.earth.pos.x)
    this.power = 30; this.yieldMt = CFG.YIELD_DEFAULT
    this.mode = 'aim'; this.advancing = false; this.time = 0; this.paused = false
    this.warpHold = this.warpHold ?? false; this.openT = 0
    this.dodgeT = 0   // 요새 회피 판정 주기 타이머
    this.obsSpeed = 1   // OBS_SPEEDS 인덱스 — 기본 2×
    this.toast = null; this.toastT = 0
    this.winBanked = false; this.timeWarn = 0; this.bonusNote = 0
    this.stage = { roles: this.presentRoles() }
    this.message = added.length
      ? msg('msg.stage.reinforce', { n: fortresses.length, rule: msg('goal.rule') })
      : msg('msg.stage.open', { rule: msg('goal.rule') })
  }

  presentRoles() {
    const set = new Set()
    for (const b of this.bodies) {
      if (!b.alive) continue
      if (b.role) set.add(b.role)
    }
    return [...set]
  }

  nextStage() {
    if (!this.won || this.runOver) return
    this.runScore += this.score; this.stageIdx++; this.loadStage()
  }

  // 목표 행성 — 살아 있는 요새 우선. 카메라/레티클이 물고 있을 대상이다.
  // 요새가 다 죽었으면(=클리어) 마지막 요새를 그대로 들고 있는다.
  get target() {
    return this.targets.find(t => t.alive) || this.targets[0] || this.earth
  }
  // 위협 = 조르그 요새. 이것만 전멸시키면 판이 끝난다.
  get aliveFortresses() { return this.bodies.filter(b => b.alive && b.role === 'battery').length }
  // id로 비교한다 — 예측선은 cloneBodies()가 만든 복제본을 넘기므로
  // 참조 비교를 쓰면 "예측에서는 목표가 목표가 아닌" 사고가 난다.
  // 표적 = 조르그 요새. 규칙이 하나로 통일됐으므로 id 목록이 아니라
  // 성질로 판정한다 — 예측선이 넘기는 복제본에서도 그대로 성립한다.
  isTarget(b) { return b.role === 'battery' }
  get aliveTargets() { return this.aliveFortresses }

  launchPos() {
    const d = CFG.LAUNCH_OFFSET   // 지구 중력권 밖에서 발사 (§4.3 κ 증폭 때문)
    return { x: this.earth.pos.x + Math.cos(this.aim) * d, y: this.earth.pos.y + Math.sin(this.aim) * d }
  }

  // 지구 발사점에서의 κ증폭 탈출속도. 이 아래로 쏘면 탄이 지구 중력에
  // 붙잡혀 되떨어진다 = 자기 지구에 핵을 박는다.
  get launchEscape() { return escapeSpeed(this.earth.mu, CFG.LAUNCH_OFFSET) }

  // 비행 중인 탄이 있으면 다음 탄을 못 쏜다 — 탄약이 아니라 **차례**가 자원이다.
  get inFlight() { return this.missiles.some(m => m.alive) }

  fire() {
    if (this.won || this.lost || this.doom || !this.earth.alive) return
    if (this.warpCurtain) return   // 개막 중 — 아직 내 차례가 아니다
    if (this.inFlight) {
      this.setToast(msg('toast.inflight'))
      return
    }
    if (this.power <= this.launchEscape) {
      this.setToast(msg('toast.slow', { v: this.launchEscape.toFixed(1) }))
      return
    }
    const p = this.launchPos(), v = fromAngle(this.aim, this.power)
    this.missiles.push({
      pos: { ...p }, vel: v, yld: this.yieldMt, alive: true, chain: 0, nearMiss: 0, age: 0, fade: 0,
      path: [{ ...p }], pathN: 0, enc: new Map(), bestDeflection: 0,
      encountered: false, minSunDist: Infinity, hit: null, out: null, lastBelt: -99,
    })
    this.shots++
    this.addFx({ kind: 'launch', x: p.x, y: p.y, a: this.aim })
    this.message = msg('msg.away', { yield: this.yieldMt })
    // 쏘면 자동으로 관측 모드로 넘어간다 — 쏜 뒤엔 보는 게 할 일이다.
    // 언제든 조준 모드를 다시 켜면 미사일이 날아가는 도중에도 판이 멈춘다.
    this.setMode('observe')
  }

  // 연출 이벤트 큐. onFx는 **읽기 전용 방청석**이다 — 지상 관제(Ground)가
  // 발사·명중·격파 같은 순간을 여기서 주워 듣는다. 렌더러가 매 프레임 fx를
  // 비워 버리므로 큐를 나중에 보는 걸로는 못 잡는다.
  addFx(e) { this.onFx?.(e); if (this.fx.length < 96) this.fx.push(e) }

  // ─── 두 가지 모드 ───────────────────────────────────────────
  // **조준 모드** — 판이 멈춘다. 미사일이 날아가는 중이라도 멈춘다.
  //   당구에서 큐를 잡고 서 있는 시간에 해당한다. 재고, 각도를 재고,
  //   다음 수를 생각하는 동안 세계가 흐르면 그건 반사신경 게임이 된다.
  //   다만 **조준 모드에서도 시간을 흘릴 수 있다**(advance) — 조준선을 고정한 채
  //   판이 어떻게 굴러가는지 조금씩 보내 보는 게 이 게임의 핵심 조작이다.
  // **관측 모드** — 판이 흐른다. UI는 전부 사라지고 화면만 남는다.
  //   배속은 플레이어가 고른다(1·2·4·8×). 미사일이 날고 있는 동안에는
  //   제대로 보라고 한 단계 낮춰 준다.
  setMode(m) {
    if (m !== 'aim' && m !== 'observe') return
    if (this.mode === m) return
    this.mode = m
    this.advancing = false
    if (m === 'aim') this._predKey = null   // 멈춘 순간의 판으로 예측을 다시 푼다
  }
  toggleMode() { this.setMode(this.mode === 'aim' ? 'observe' : 'aim') }

  effTimeScale() {
    // 연출이 판을 붙잡고 있는 동안(오프닝 예고편의 도입부)은 아무것도 안 흐른다.
    // 조준 모드로 세우는 것과 다른 이유가 있다 — 조준 모드는 조준 가이드를
    // 같이 켜 버리는데, 그 구간은 화면에 아무 UI도 없어야 한다.
    if (this.paused) return 0
    if (this.lost || this.won) return 0   // 클리어 후에는 시계를 세운다
    if (this.doom) return 1               // 모성이 오는 동안엔 1×로만 흐른다 (조작 불가)
    if (this.mode === 'aim') {
      // 기본은 정지. 진행 버튼(SHIFT)을 누르고 있는 동안만 흐른다.
      if (!this.advancing) return 0
      return this.missiles.some(m => m.alive) ? 1 : 2   // 조준 중 시간 보내기
    }
    // 관측 배속은 플레이어가 고른다(obsSpeed). 미사일이 날 때는 제대로 보라고
    // 한 단계 낮춰 주고, 아무것도 안 날면 고른 배속 그대로 빨리 감는다.
    const s = OBS_SPEEDS[this.obsSpeed] ?? 2
    return this.missiles.some(m => m.alive) ? Math.max(1, s / 2) : s
  }

  // 관측 배속 단계 — 버튼을 누를 때마다 다음 단계로 돈다
  cycleObsSpeed() {
    this.obsSpeed = (this.obsSpeed + 1) % OBS_SPEEDS.length
    return OBS_SPEEDS[this.obsSpeed]
  }
  get obsSpeedLabel() { return `${OBS_SPEEDS[this.obsSpeed]}×` }

  // 순차 워프인 — 실시간으로 돈다. 조준 모드라 판이 멈춰 있어도
  // "조르그가 하나씩 도착하는" 연출은 흘러야 한다.
  // 단 하나 예외가 warpHold다. 튜토리얼이 화면을 덮고 있는 동안 조르그가
  // 들어와 버리면, 규칙 설명을 다 읽고 나왔을 때 이미 도착이 끝나 있다 —
  // 첫 판에서 제일 먼저 봐야 할 장면을 오버레이 뒤에서 놓치는 것이다.
  // 그래서 튜토리얼을 닫는 순간부터 카운트다운이 시작된다.
  get warpPending() { return this.warpHold || this.bodies.some(b => (b.warpIn ?? 0) > 0) }
  stepWarpIns(dtReal) {
    if (this.warpHold) return
    for (const b of this.bodies) {
      if (!(b.warpIn > 0)) continue
      b.warpIn -= dtReal
      if (b.warpIn > 0) continue
      b.warpIn = 0; b.alive = true; b.warp = 1
      this.addFx({ kind: 'warp', x: b.pos.x, y: b.pos.y, r: hitRadiusOf(b), fort: b.role === 'battery' })
      // 포대는 요새가 실제로 **도착한 뒤에** 생긴다. loadStage 시점에는 살아 있는
      // 요새가 0이라(전부 워프 대기 중) 거기서 명단을 짜면 영영 비어 있다.
      if (b.role === 'battery') this.syncLasers()
    }
  }

  // ─── 포대 명단 ───────────────────────────────────────────────
  // 살아 있는 조르그 요새 하나당 광선 하나. 새로 도착한 요새에는 광선을 달아
  // 주고, 부서진 요새의 광선은 걷어낸다.
  //
  // 시차는 **도착 순서**로 준다: 1번은 LASER_FIRST에, 2번은 거기서 SPACING만큼
  // 뒤에, 3번은 또 그만큼 뒤에. 그래서 첫 판은 "한 기가 물고, 다 지나가면 다음
  // 기가 문다"로 읽히고, 요새가 늘어도 겹쳐 쏘지 않는다.
  syncLasers() {
    const forts = this.bodies.filter(b => b.alive && b.role === 'battery')
    // 살아 있는지만이 아니라 **성계에 남아 있는지**까지 본다. 오프닝 예고편은
    // 도착한 요새 중 하나만 남기고 배열에서 통째로 빼내는데(setUp), 그것들은
    // alive인 채로 빠지므로 살아 있는지만 보면 판에 없는 총구가 계속 쏜다.
    const live = new Set(forts)
    // 죽은 포대의 광선은 걷는다. 다만 **아직 화면에 남아 있는 빛**(비행·소진)은
    // 끝까지 보내 준다 — 요새가 부서진 순간에 이미 나가 있던 광선까지 같이
    // 사라지면 그 한 발이 무엇을 관통했는지가 화면에서 지워진다.
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const L = this.lasers[i]
      if (live.has(L.from)) continue
      if (L.state === LASER_TRAVEL || L.state === LASER_SPENT) continue
      this.lasers.splice(i, 1)
    }
    for (const b of forts) {
      if (this.lasers.some(L => L.from === b)) continue
      const idx = this.lasers.length
      this.lasers.push(makeLaser(this.rng, b, CFG.LASER_FIRST + idx * CFG.LASER_SPACING))
    }
  }

  // 지금 살아 있는 포대 수 — 주기를 정하는 값이다(laser.nextPeriod).
  get batteryCount() { return Math.max(1, this.aliveFortresses) }

  // ─── 대표 광선 ───────────────────────────────────────────────
  // HUD 경보와 예고편은 "지금 무엇이 제일 급한가" 하나만 알면 된다. 여럿이
  // 동시에 돌 수 있으므로 그중 하나를 골라 준다: 비행 중 > 충전 중(남은 시간이
  // 짧은 순) > 나머지. 화면에 그리는 쪽(LaserView)은 이걸 안 쓰고 전부 그린다.
  get laser() {
    let best = null, bestRank = -1, bestLeft = Infinity
    for (const L of this.lasers) {
      const rank = L.state === LASER_TRAVEL ? 3 : L.state === LASER_CHARGE ? 2 : L.state === LASER_SPENT ? 1 : 0
      const left = L.state === LASER_CHARGE ? chargeLeft(L) : 0
      if (rank > bestRank || (rank === bestRank && left < bestLeft)) {
        best = L; bestRank = rank; bestLeft = left
      }
    }
    return best
  }

  // ─── 막 ───────────────────────────────────────────────────────
  // 판이 열리고 조르그가 들어오는 동안은 아직 내 차례가 아니다. 조작 패널도,
  // 이름표도, 레티클도 없이 성계만 보여 준다 — 궤도와 카이퍼 벨트까지가 전부다.
  //
  // 막이 걷히는 시점은 **스폰이 전부 끝나고 WARP_SETTLE만큼 더 지난 뒤**다.
  // 예전에는 "워프가 남아 있는 동안, 단 최대 3.2초"였는데 그 규칙은 두 군데서
  // 거짓말을 했다: ① 요새가 넷 이상이면 아직 도착 중인데 막이 걷혔고
  // ② 마지막 한 기가 반투명하게 떠오르는 도중에 패널이 올라왔다.
  // 지금은 한 방향으로만 흐르는 시계 하나(openT)가 개막 전체를 잰다 —
  // 스폰 끝 → 뜸 → 조작 인계. 판마다 같은 박자다(1스테이지도, 5스테이지도).
  //
  // 시계는 stepWarpIns와 **같은 클럭**이다. 벽시계로 재면 프레임이 느린
  // 기기에서 워프가 끝나기도 전에 막이 걷혔다(계측: 워프 잔여 0.2초에 걷힘).
  get openHold() { return (this.spawnEnd ?? 0) + CFG.WARP_SETTLE }
  get warpCurtain() {
    if (this.lost || this.won || this.runOver) return false
    return this.warpHold || this.openT < this.openHold
  }
  // 개막을 즉시 끝낸다 — 오프닝 예고편은 판을 직접 연출하므로 막이 방해가 된다.
  endOpening() { this.openT = this.openHold }
  // 화면에서 UI를 통째로 걷는 구간 — 예고편 도입부(cineBare)와 판이 열리는 순간.
  get bare() { return !!this.cineBare || this.warpCurtain }

  tick(dtFrame) {
    if (this.toastT > 0) this.toastT -= dtFrame
    // 개막 시계. warpHold(튜토리얼이 화면을 덮고 있는 동안)면 멈춘다 —
    // 규칙을 읽는 사이에 스폰이 끝나 버리면 첫 판에서 제일 먼저 봐야 할
    // 장면을 오버레이 뒤에서 놓친다.
    if (!this.warpHold && this.openT < this.openHold) this.openT += dtFrame
    this.stepWarpIns(dtFrame)
    // 이미 박힌 광선의 꼬리는 판이 멈춰 있어도 끝까지 들어간다 — 광선이 지구를
    // 부순 그 순간에도(그때 판이 서 버린다) 빛은 마저 빨려 들어가야 한다.
    const n = this.batteryCount
    for (const L of this.lasers) stepSpent(L, dtFrame, n)
    this.fadeSpentShots(dtFrame)
    let acc = Math.min(0.1, dtFrame) * this.effTimeScale()
    while (acc >= CFG.DT) { this.step(CFG.DT); acc -= CFG.DT }
  }

  step(dt) {
    stepBodies(this.bodies, dt)
    this.stepDodge(dt)
    for (const m of this.missiles) {
      if (!m.alive) continue
      stepMissile(m, this.bodies, dt)
      updateEncounters(m, this.bodies, {
        swing: (b, deg) => {
          this.message = msg('msg.swing', { name: nameOf(b), deg: deg.toFixed(0), chain: m.chain })
          this.addFx({ kind: 'swing', x: b.pos.x, y: b.pos.y, r: b.radius })
        },
        capture: (b) => { this.detonate(m, b, { x: m.pos.x, y: m.pos.y }); this.setToast(msg('toast.capture')) },
      })
      if (m.alive) this.contact(m)
      if (m.alive) this.missileBounds(m)
      if (!m.alive) this.finishShot(m)
    }
    resolveBodyPairs(this.bodies, this)
    this.bodyBounds()
    if (this.doom) this.tickDoom(dt)
    else this.tickLaser(dt)
    this.time += dt
    this.warnTime()
    this.checkEnd()
  }

  // ─── 다 쓴 탄의 궤적 ─────────────────────────────────────────
  // 원래는 빗나간 샷의 궤적을 **판이 끝날 때까지** 흐리게 남겼다(§14.4).
  // 그런데 탄이 무제한이라 한 판에 열댓 발이 나가고, 그 회색 리본이 전부
  // 그대로 쌓여 판 위에 그물이 걸렸다 — 정작 봐야 할 궤도가 그 밑에 깔린다.
  // 이제는 결판난 뒤 잠깐 남았다가 흐려지며 걷힌다.
  //
  // 실시간(dtFrame)으로 센다. 조준 모드는 판을 세우므로 인게임 시계로 재면
  // 마지막 궤적이 화면에 그대로 굳어 버린다 — 그게 지금 고치는 그 증상이다.
  fadeSpentShots(dtFrame) {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i]
      if (m.alive) continue
      m.fade += dtFrame
      if (m.fade >= CFG.SHOT_TRAIL_FADE) this.missiles.splice(i, 1)
    }
  }

  // ─── 요새의 회피 분사 ───────────────────────────────────────
  // 3스테이지부터 조르그 요새는 추진기를 하나씩 달고 온다. **한 판에 한 번**,
  // 제 몸에 꽂힐 궤도로 탄이 들어오는 걸 확인한 순간 쓴다.
  //
  // 왜 일회성인가 — 매번 피하면 그 요새는 못 맞히는 표적이 되고, 그러면
  // 조준 자체가 무의미해진다. 한 번뿐이면 판이 이렇게 읽힌다: **첫 발은 추진기를
  // 빼는 데 쓰고, 두 번째 발로 잡는다.** 탄은 무제한이고 자원은 시간이므로
  // 값은 시한으로 치른다 — 이 게임이 이미 쓰고 있는 화폐 그대로다.
  //
  // 미는 방향은 두 조건이 정한다: 탄의 **진입 방향에 직각**(정면으로 도망가면
  // 그대로 따라잡힌다 — 옆으로 비켜야 빗나간다)이고, 그 두 직각 중
  // **태양 반대쪽**. 안쪽으로 피하면 태양 우물로 떨어져 스스로 죽으므로,
  // 조르그가 고를 수 있는 쪽은 애초에 바깥 하나뿐이다.
  //
  // 위협 판정은 탄을 실제로 굴려 본다(Aim.firstImpact). 매 스텝 돌리기엔
  // 비싸므로 FORT_DODGE_TICK 간격으로만 묻는다 — 앞서 보는 시간이 10초인데
  // 0.3초 늦게 아는 것은 아무 차이도 만들지 않는다.
  //
  // ── 반응 시간 ──
  // 위협을 본 즉시 태우지 않는다. 요새마다 제 몫의 반응 시간(react)이 있고,
  // 그 초만큼 **계속 위협받는 상태로 버텨야** 비로소 분사한다. 그래서 즉발이
  // 아니고, 늦게 알아챈 궤도는 못 피한다 — 스윙바이로 막판에 꺾여 들어오는 탄,
  // 가까이서 쏜 탄, 반응 중에 진로가 새로 물린 탄이 그렇다.
  // 위협이 사라지면 경계도 풀린다(다시 처음부터 센다) — 그 자체가 수가 된다.
  stepDodge(dt) {
    this.dodgeT -= dt
    if (this.dodgeT > 0) return
    const tick = CFG.FORT_DODGE_TICK - this.dodgeT   // 실제로 흐른 시간(밀린 만큼 포함)
    this.dodgeT = CFG.FORT_DODGE_TICK
    // 아직 안 쓴 추진기가 하나도 없으면 물어볼 것도 없다. 한 번의 판정이
    // 1.5ms짜리라 이 두 줄이 곧 "2스테이지까지는 공짜"를 만든다.
    if (!this.bodies.some(b => b.boost && b.alive && b.role === 'battery')) return
    const threatened = new Set()
    for (const m of this.missiles) {
      if (!m.alive) continue
      const hit = Aim.firstImpact(this, m, CFG.FORT_DODGE_LEAD)
      const b = hit?.body
      if (!b || !b.boost || !b.alive || b.role !== 'battery') continue
      threatened.add(b)
      // 반응 시간은 요새마다 다르다. 처음 위협받는 순간에 뽑고, 그 뒤로는
      // 계속 물려 있는 동안만 깎인다.
      if (b.alert == null) {
        b.alert = CFG.FORT_DODGE_REACT + (this.rng.next() * 2 - 1) * CFG.FORT_DODGE_REACT_JITTER
        b.alertMax = b.alert
      }
      b.alert -= tick
      if (b.alert <= 0) this.dodgeBoost(b, hit.vx, hit.vy)
    }
    // 진로에서 벗어난 요새는 경계를 푼다 — 다시 물리면 처음부터 센다
    for (const b of this.bodies) {
      if (b.alert != null && !threatened.has(b)) { b.alert = null; b.alertMax = null }
    }
  }

  dodgeBoost(b, vx, vy) {
    const s = Math.hypot(vx, vy) || 1
    let nx = -vy / s, ny = vx / s                   // 탄의 진입 방향에 직각 (둘 중 하나)
    // 태양에서 멀어지는 쪽을 고른다 — 안쪽 직각이면 뒤집는다
    if (nx * b.pos.x + ny * b.pos.y < 0) { nx = -nx; ny = -ny }
    // 세기는 제 질량에 비례한 추력이다. 질량으로 나누면 결국 Δv는 지금 속도의
    // 일정 비율이 되고, 그래서 무거운 요새도 가벼운 요새와 같은 만큼 궤도가
    // 틀어진다 — 덩치가 곧 무적이 되지 않는다.
    const dv = Math.hypot(b.vel.x, b.vel.y) * CFG.FORT_DODGE_DV
    b.vel.x += nx * dv; b.vel.y += ny * dv
    b.boost = 0
    b.alert = null; b.alertMax = null
    b.trailFlash = 2.0
    this.addFx({ kind: 'boost', x: b.pos.x, y: b.pos.y, r: hitRadiusOf(b), a: Math.atan2(-ny, -nx) })
    this.message = msg('msg.boost', { name: nameOf(b) })
    this.setToast(msg('toast.boost', { name: nameOf(b) }))
  }

  // ─── 조르그 레이저 ─────────────────────────────────────────
  // 닿는 것은 체력과 무관하게 부서진다. 태양과 특이점만 예외로, 막되 안 부서진다
  // — 원래 부술 수 없는 것들이라 여기서만 예외를 만들면 규칙이 어긋난다.
  tickLaser(dt) {
    // 포대가 여럿이므로 명단을 먼저 맞춘다 — 부서진 요새의 광선은 여기서 빠지고,
    // 그러면 남은 포대의 주기가 그만큼 짧아진다(nextPeriod가 마릿수를 본다).
    this.syncLasers()
    const n = this.batteryCount
    for (const L of this.lasers.slice()) this.laserEvent(L, stepLaser(L, this, dt, n))
  }

  laserEvent(L, ev) {
    if (!ev) return
    if (ev.kind === 'charge') {
      this.addFx({ kind: 'laserCharge', x: L.ox, y: L.oy, r: hitRadiusOf(ev.src) })
      this.setToast(msg('toast.laser.charge', { name: nameOf(ev.src), sec: CFG.LASER_CHARGE }))
      this.message = msg('msg.laser.charge', { name: nameOf(ev.src) })
      return
    }
    if (ev.kind === 'abort') {
      this.setToast(msg('toast.laser.abort', { name: nameOf(ev.src) }))
      this.message = msg('msg.laser.abort', { name: nameOf(ev.src) })
      return
    }
    if (ev.kind === 'fire') {
      this.addFx({ kind: 'laserFire', x: L.ox, y: L.oy, a: Math.atan2(L.uy, L.ux) })
      this.message = msg('msg.laser.fire')
      return
    }
    if (ev.kind === 'intercept') {
      // 내 탄두가 광선의 진로를 막았다. 그 자리에서 터지며 광선이 끊긴다 —
      // 폭풍도 그대로 남으므로 "막으면서 동시에 공을 민다"가 성립한다.
      const m = ev.missile
      m.alive = false; m.hit = 'laser'
      const wave = blastWave(this.bodies, ev.x, ev.y, m.yld, null)
      this.addFx({ kind: 'nuke', x: ev.x, y: ev.y, yld: m.yld, r: 22, wave: wave.radius })
      this.addFx({ kind: 'laserMiss', x: ev.x, y: ev.y })
      this.score += CFG.INTERCEPT_SCORE
      this.message = msg('msg.laser.intercept', { yield: m.yld, score: CFG.INTERCEPT_SCORE })
      this.setToast(msg('toast.laser.intercept'))
      if (wave.pushed.some(p => p.body.isEarth)) this.setToast(msg('toast.laser.blastEarth'))
      return
    }
    if (ev.kind === 'expire') {
      this.addFx({ kind: 'laserMiss', x: ev.x, y: ev.y })
      this.message = msg('msg.laser.expire')
      this.setToast(msg('toast.laser.expire'))
      return
    }
    // ── 착탄 ──
    const b = ev.body
    this.addFx({ kind: 'laserHit', x: ev.x, y: ev.y, r: b ? hitRadiusOf(b) : CFG.R_STAR, sun: !b })
    if (!b) {   // 태양이 막았다
      this.message = msg('msg.laser.sun')
      this.setToast(msg('toast.laser.sun'))
      return
    }
    if (b.isEarth) {
      this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 2, earth: true })
      b.alive = false
      this.fail('EARTH_LASER', msg('msg.fail.laser'))
      this.setToast(msg('toast.laser.earth'))
      return
    }
    if (b.role === 'void') {   // 특이점도 막되 안 부서진다
      this.message = msg('msg.laser.void', { name: nameOf(b) })
      this.setToast(msg('toast.laser.void', { name: nameOf(b) }))
      return
    }
    // 체력 불문 파괴. 막아 준 대가가 그 공의 소멸이다.
    this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 1.8, big: true })
    this.message = msg('msg.laser.kill', { name: nameOf(b) })
    this.setToast(msg('toast.laser.kill', { name: nameOf(b) }))
    this.killBody(b, 'laser', { fx: false })
  }

  // 경보는 **대표 광선** 하나만 본다(get laser). 여럿이 동시에 충전 중일 수
  // 있지만, 화면에 띄우는 카운트다운은 제일 급한 하나여야 읽힌다.
  get laserCharging() { return this.laser?.state === LASER_CHARGE }
  get laserFlying() { return this.laser?.state === LASER_TRAVEL }
  get laserLeft() { return this.laser ? chargeLeft(this.laser) : 0 }
  get laserImpactLeft() { return this.laser ? impactLeft(this.laser) : 0 }
  // 조준선에서 지구까지 예상 수직거리 / 지금 이대로면 빗나가는가
  get laserMiss() { return this.laser?.miss ?? 0 }
  get laserSafe() { return !!this.laser?.safe }
  // 지금 충전 중인 포대 수 — 둘 이상이면 경보에 그 사실을 붙인다
  get laserChargingCount() { return this.lasers.filter(L => L.state === LASER_CHARGE).length }

  // 시한이 줄고 있다는 걸 토스트로 못 박는다 (남은 60/30/10초)
  warnTime() {
    if (this.won || this.lost || this.doom) return
    const marks = [60, 30, 10], left = this.timeLeft
    while (this.timeWarn < marks.length && left <= marks[this.timeWarn]) {
      const s = marks[this.timeWarn]
      this.timeWarn++
      this.setToast(msg('toast.timeLeft', { sec: s, bonus: this.timeBonus }))
    }
  }

  // 스윕 판정 — 직전 위치에서 현재 위치까지의 선분이 명중 반경과 겹치면 명중.
  // 여러 천체에 걸치면 "먼저 닿은" 쪽이다: 폭심 위치가 곧 임펄스 방향이라
  // 아무 놈이나 고르면 공이 엉뚱한 데로 굴러간다.
  contact(m) {
    const a = m.prev || m.pos
    let best = null, bestD = Infinity
    for (const b of this.bodies) {
      if (!b.alive) continue
      const r = hitRadiusOf(b)
      if (!segHitsCircle(a.x, a.y, m.pos.x, m.pos.y, b.pos.x, b.pos.y, r)) continue
      const p = segCircleEntry(a.x, a.y, m.pos.x, m.pos.y, b.pos.x, b.pos.y, r)
      const d = Math.hypot(p.x - a.x, p.y - a.y)
      if (d < bestD) { bestD = d; best = { b, p } }
    }
    if (best) this.detonate(m, best.b, best.p)
  }

  // ─── 핵 기폭 — 이 게임의 큐샷 ───────────────────────────────
  detonate(m, b, point) {
    m.alive = false; m.hit = b
    const yld = m.yld

    // 모성 — 핵도 안 통한다. 부술 수 없는 것에는 부술 수 없다고 말해 준다.
    if (b.mothership) {
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius })
      this.message = msg('msg.nuke.mothership', { name: nameOf(b) })
      return
    }

    // 특이점 — 탄두째로 삼킨다. 밀리지도, 터지지도 않는다.
    if (b.role === 'void') {
      this.addFx({ kind: 'absorb', x: point.x, y: point.y, r: b.radius, small: true })
      this.message = msg('msg.nuke.void', { name: nameOf(b) })
      return
    }

    // 휘발성 — 맞는 순간 그 자리에서 유폭. 반경 안이 통째로 밀린다.
    if (b.role === 'volatile') {
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius })
      this.volatileBlast(b)
      return
    }

    if (b.type === 'debris') {
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius })
      blastWave(this.bodies, point.x, point.y, yld, b)
      b.alive = false
      this.message = msg('msg.nuke.debris')
      return
    }

    if (b.isEarth) {   // 요청대로: 지구 오폭 = 즉시 게임오버, 변명 없음
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld: CFG.YIELD_MAX, r: b.radius, earth: true })
      this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius, earth: true })
      b.alive = false
      this.fail('EARTH_LOST', msg('msg.fail.nukeEarth'))
      this.setToast(msg('toast.nukeEarth'))
      return
    }

    // 임펄스: 입사각·속도 무시. 폭심의 상대 위치만 본다.
    const push = applyNuke(b, point.x, point.y, yld)
    const wave = blastWave(this.bodies, point.x, point.y, yld, b)
    this.addFx({
      kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius,
      px: push.dx, py: push.dy, wave: wave.radius, armor: hasRole(b, 'armor'),
    })

    // §9.1 스타일 배율 — 체인/니어미스/태양 가속은 여전히 점수에 얹힌다
    const M = 1 + 0.75 * m.chain + 0.25 * m.nearMiss + (m.minSunDist < CFG.SUN_BONUS_R ? 0.5 : 0)
    const gained = Math.round(8 * M)
    this.score += gained
    this.message = msg('msg.nuke.hit', {
      name: nameOf(b), dv: push.dv.toFixed(1), dir: bearing(push.dx, push.dy).toFixed(0),
      tail: hasRole(b, 'armor') ? msg('msg.nuke.armor') : gained ? msg('msg.nuke.gain', { n: gained }) : '',
    })
    // 폭풍이 지구를 정통으로 훑었다면 경고 — 지구가 밀려 태양에 빠지는 사고가 실제로 난다
    if (wave.pushed.some(p => p.body.isEarth)) this.setToast(msg('toast.blastEarth'))
  }

  // ─── 휘발성 유폭 ─────────────────────────────────────────────
  // 반경은 그 행성의 크기로 고정 — 조준 전에 원으로 그려 줄 수 있어야
  // "여기까지 밀린다"를 계획할 수 있다.
  volatileBlast(b) {
    if (!b.alive) return
    const R = volatileRadius(b)
    this.addFx({ kind: 'volatile', x: b.pos.x, y: b.pos.y, r: b.radius, R })
    for (const o of this.bodies) {
      if (!o.alive || o === b) continue
      let dx = o.pos.x - b.pos.x, dy = o.pos.y - b.pos.y
      const d = Math.hypot(dx, dy)
      if (d > R || d < 1e-6) continue
      const f = 1 - d / R
      const dv = CFG.VOLATILE_IMPULSE * f * f / o.mu * (roleOf(o)?.dvScale ?? 1)
      o.vel.x += dx / d * dv; o.vel.y += dy / d * dv
      o.trailFlash = 2
    }
    this.message = msg('msg.volatile', { name: nameOf(b), r: R.toFixed(0) })
    this.killBody(b, 'blast', { fx: false })
  }

  // ─── 특이점 흡수 ─────────────────────────────────────────────
  absorb(hole, prey) {
    this.addFx({ kind: 'absorb', x: hole.pos.x, y: hole.pos.y, r: hitRadiusOf(hole) })
    if (hole.mu < CFG.VOID_MU_MAX) {   // 삼킨 만큼 자란다 — 판이 점점 위험해진다
      hole.mu = Math.min(CFG.VOID_MU_MAX, hole.mu + prey.mu * CFG.VOID_GROW)
      hole.radius = radiusOf(hole.mu)
    }
    this.message = msg('msg.absorb', {
      prey: nameOf(prey), hole: nameOf(hole), mu: hole.mu.toFixed(0),
      r: hitRadiusOf(hole).toFixed(0), g: (hole.mu / 900).toFixed(2),
    })
    this.killBody(prey, 'absorb', { fx: false, shatterIt: false })
  }

  // ─── 행성끼리의 충돌 = 당구 + 체력 ────────────────────────────
  // 규칙: 부딪히면 **당구공처럼 튕긴다**(운동량 보존). 그리고 체력이 닳는다
  // (상대속도가 빠를수록 1~3). 중립 행성은 체력 3이라 "같은 공을 계속 몰아붙이기"가
  // 되고, 조르그 요새는 1이라 한 번 제대로 처박으면 끝난다.
  // 자연스러운 공전 중의 느린 스침(상대속도 < COLLIDE_DMG_V)은
  // 데미지가 없다: 판이 저 혼자 정리되면 플레이어가 할 일이 사라진다.
  // 반환값 'destroyed' 는 배열이 변했다는 신호(파편 생성) — physics가 그 스텝을 끝낸다.
  onPlanetCollision(a, b) {
    // 특이점 — 상대만 삼킨다. 특이점끼리 만나면 큰 쪽이 작은 쪽을 먹는다.
    if (a.role === 'void' || b.role === 'void') {
      const hole = a.role === 'void' && (b.role !== 'void' || a.mu >= b.mu) ? a : b
      this.absorb(hole, hole === a ? b : a)
      return 'destroyed'
    }
    // 가스 행성 — **세게** 처박히면 그 자리에서 유폭한다. 연쇄를 노릴 자리.
    //
    // 접촉만 하면 무조건 터지게 뒀더니 태양계가 저 혼자 정리돼 버렸다(계측:
    // 플레이어가 손도 대기 전에 목성이 100~360초에 자폭, 4개 중 2개가 900초
    // 안에 소멸). 압축된 판에서는 이웃 궤도끼리 스치는 일이 늘 있는데,
    // 그 정도 접촉으로 목성이 사라지면 판의 지형이 통째로 없어진다.
    // 그래서 문턱을 둔다: 스치는 건 튕기고, 진짜로 처박아야 터진다.
    const vRel0 = Math.hypot(a.vel.x - b.vel.x, a.vel.y - b.vel.y)
    if ((a.role === 'volatile' || b.role === 'volatile') && vRel0 >= CFG.VOLATILE_TRIGGER_V) {
      const vol = a.role === 'volatile' ? a : b, other = vol === a ? b : a
      this.message = msg('msg.collide.volatile', { a: nameOf(vol), b: nameOf(other), v: vRel0.toFixed(0) })
      this.damage(other, 3, 'collision')
      this.volatileBlast(vol)
      return 'destroyed'
    }

    const cx = (a.pos.x + b.pos.x) / 2, cy = (a.pos.y + b.pos.y) / 2
    const vRel = elasticBounce(a, b)   // ← 여기서 실제로 튕긴다
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
    const last = this.pairCool.get(key) ?? -99
    a.bumpFlash = 0.5; b.bumpFlash = 0.5
    // 접촉 판정은 한 번의 충돌에서 여러 스텝 이어질 수 있다 — 쿨다운으로 한 번만 센다
    if (this.time - last < CFG.HIT_COOLDOWN) {
      this.addFx({ kind: 'bump', x: cx, y: cy, r: (hitRadiusOf(a) + hitRadiusOf(b)) * 0.5, v: vRel, soft: true })
      return null
    }
    this.pairCool.set(key, this.time)

    const dmg = vRel < CFG.COLLIDE_DMG_V ? 0 : vRel >= 160 ? 3 : vRel >= 90 ? 2 : 1
    this.addFx({ kind: 'bump', x: cx, y: cy, r: (hitRadiusOf(a) + hitRadiusOf(b)) * 0.5, v: vRel, soft: dmg === 0 })
    if (dmg === 0) {
      this.message = msg('msg.collide.soft', { a: nameOf(a), b: nameOf(b), v: vRel.toFixed(0) })
      return null
    }
    this.message = msg('msg.collide', { a: nameOf(a), b: nameOf(b), v: vRel.toFixed(0), dmg })
    // 둘 다 같은 피해를 받는다. 하나라도 박살나면 그 스텝은 거기서 끝낸다.
    const ka = this.damage(a, dmg, 'collision')
    const kb = this.damage(b, dmg, 'collision')
    return (ka || kb) ? 'destroyed' : null
  }

  // ─── 체력 처리 ───────────────────────────────────────────────
  // 지구도 예외가 아니다. 세 번 처박히면 지구도 끝난다 — 다만 그 전까지는
  // 튕겨 나갈 뿐이라 "스치기만 해도 즉사"하던 예전 규칙보다 훨씬 관대하다.
  damage(b, n, cause) {
    if (!b.alive || b.type === 'debris') return false
    if (b.mothership) return false        // 모성은 부술 수 없다
    b.hp = (b.hp ?? CFG.PLANET_HP) - n
    b.hitFlash = Math.max(b.hitFlash, 0.6)
    b.trailFlash = 2.0
    b.scorch = Math.min(3, (b.scorch || 0) + 1)
    if (b.hp > 0) {
      this.setToast(msg('toast.hp', { name: nameOf(b), hp: b.hp, hpMax: b.hpMax ?? CFG.PLANET_HP, left: b.hp }))
      return false
    }
    if (b.isEarth) {
      this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 2, earth: true })
      b.alive = false
      this.fail('EARTH_LOST', msg('msg.fail.earthCrush'))
      return true
    }
    this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 1.6, big: true })
    this.killBody(b, cause, { fx: false })
    return true
  }

  killBody(b, cause, { fx = true, shatterIt = cause === 'collision' } = {}) {
    if (b.mothership) return          // 모성은 어떤 사유로도 안 죽는다
    if (b.trail) b.trail.length = 0   // 죽은 공의 잔여 트레일은 즉시 지운다
    if (!b.alive) return
    b.alive = false
    if (fx && b.type !== 'debris') this.addFx({ kind: cause === 'sun' ? 'sun' : 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius })
    if (shatterIt) shatter(b, this.bodies, () => this.rng.next())
    this.recordKill(b, cause)
  }

  // 목표 판정에는 파괴 사유가 상관없다 — 요새가 없어졌으면 그걸로 끝이다.
  // 사유는 점수(KILL_SCORE)와 로그 문구에만 쓴다.
  recordKill(b, cause) {
    if (b.type === 'debris') return
    // 모성이 온 뒤의 파괴는 **전과가 아니다.** 저쪽이 제 광선으로 판을 쓸어
    // 내는 중이고, 그 와중에 조르그 요새가 같이 녹아도 그건 내가 부순 게 아니다.
    // 점수·목표 갱신·문구를 전부 건너뛴다 — 이 화면의 문장은 하나뿐이다.
    if (this.doom) return
    const wasFort = b.role === 'battery'
    const [tp, np] = KILL_SCORE[cause] ?? [0, 0]
    const gained = wasFort ? tp : np
    this.score += gained
    const label = { name: nameOf(b), cause: msg('msg.cause', { cause: msg(`cause.${cause}`), gained }) }
    if (wasFort) {
      // 요새 하나가 곧 포대 하나다 — 부수면 그 순번이 통째로 사라진다.
      // (명단 정리는 tickLaser의 syncLasers가 한다. 이미 나가 있는 광선은
      //  거기서도 안 걷는다 — 쏜 뒤에 부순 건 늦은 것이다.)
      this.goal.update(this.aliveFortresses)
      this.message = msg('msg.kill.goal', { ...label, title: msg('goal.title'), count: this.goal.label() })
      this.setToast(msg('toast.fortDown', { count: this.goal.label() }))
    } else {
      this.message = msg('msg.kill', label)
    }
    if (this.aliveFortresses === 0) this.win()
  }

  win() {
    // 모성이 오는 중에는 절대 이기지 않는다. 예전엔 난사가 마지막 요새를
    // 태우는 순간 recordKill → win()이 그대로 걸려서, 성계가 쓸려나가는 와중에
    // 축하 화면이 떴다(그리고 won=true가 되면 시계가 멈춰 연출까지 얼어붙었다).
    if (this.won || this.lost || this.doom) return
    this.won = true
    this.message = msg('msg.win')
    this.setToast(msg('toast.win'))
  }

  missileBounds(m) {   // §7.8
    const r = len(m.pos)
    if (r < CFG.R_STAR + 8) { m.alive = false; m.out = 'sun' }
    else if (m.age > CFG.MISSILE_TTL) { m.alive = false; m.out = 'timeout' }
    else if (r >= this.beltR) {   // 미사일도 쿠션에 튕긴다 — 유실은 이제 없다
      const hit = beltBounce(m, this.beltR)
      if (hit && this.time - (m.lastBelt ?? -99) > CFG.BELT_COOLDOWN) {
        m.lastBelt = this.time
        this.addFx({ kind: 'belt', x: hit.x, y: hit.y, nx: hit.nx, ny: hit.ny, v: hit.speed, missile: true })
      }
    }
  }

  // ─── 성계 경계 ───────────────────────────────────────────────
  // 태양 낙하는 그대로 파괴다(안쪽 벽은 없다 — 태양이 곧 포켓이다).
  // 바깥쪽은 추방 대신 **카이퍼 벨트 쿠션**이다: 박으면 폭발하고, 속력을
  // 그대로 유지한 채 반사각으로 판 안으로 되돌아온다. 잃는 공은 없다.
  bodyBounds() {
    for (const b of this.bodies) {
      if (!b.alive) continue
      const r = len(b.pos)
      if (r < CFG.R_STAR + 15) {
        if (b.isEarth) {
          this.addFx({ kind: 'sun', x: b.pos.x, y: b.pos.y })
          b.alive = false
          this.fail('EARTH_LOST', msg('msg.fail.earthSun'))
          return
        }
        this.killBody(b, 'sun', { shatterIt: false })
      } else if (r >= this.beltR) {
        const hit = beltBounce(b, this.beltR)
        if (!hit) continue
        if (this.time - (b.lastBelt ?? -99) < CFG.BELT_COOLDOWN) continue
        b.lastBelt = this.time
        b.trailFlash = 2.0; b.bumpFlash = 0.6
        this.addFx({ kind: 'belt', x: hit.x, y: hit.y, nx: hit.nx, ny: hit.ny, v: hit.speed, r: hitRadiusOf(b) })
        this.message = msg('msg.belt', { name: nameOf(b), v: hit.speed.toFixed(0) })
        this.setToast(msg('toast.belt', { name: nameOf(b) }))
      }
    }
  }

  // §14.4 실패 피드백 — 빗나간 샷마다 원인 태그 1개
  finishShot(m) {
    if (m.hit) return
    let tag
    // '유실'은 이제 없다 — 벨트가 튕겨 되돌려 보낸다. 남은 실패는 태양/시간뿐이다.
    if (m.out === 'sun') tag = msg('msg.miss.sun')
    else if (m.encountered && m.bestDeflection < 10) tag = msg('msg.miss.fast', { deg: m.bestDeflection.toFixed(0) })
    else if (m.bestDeflection < CFG.SWING_DEG) tag = msg('msg.miss.bend', { deg: m.bestDeflection.toFixed(0), need: CFG.SWING_DEG })
    else tag = msg('msg.miss.timing')
    this.setToast(tag); this.message = tag
  }

  checkEnd() {
    // 모성이 오는 중이면 판정을 멈춘다 — 연출이 끝나야 진짜 종료다.
    // (안 막으면 광선이 지구를 부순 순간 EARTH_LOST로 끝나 버려 난사가 중간에 멎는다.)
    if (this.doom) return
    // 개막 중이면 판정을 미룬다 — 안 그러면 "요새 0기"로 도착하기도 전에
    // 클리어가 나 버린다. 막이 걷혀야 내 차례이므로 뜸까지 통째로 센다.
    if (this.warpPending || this.warpCurtain) return
    this.goal.update(this.aliveFortresses)
    if (this.won && !this.winBanked) {   // 클리어 시점의 남은 시간을 보너스로 정산
      this.winBanked = true
      const b = this.timeBonus
      // 문구는 화면에서 붙인다(tx가 번역한 뒤 꼬리를 잇는다)
      if (b > 0) { this.score += b; this.bonusNote = b }
    }
    if (this.won || this.lost) return
    if (!this.earth.alive) { this.fail('EARTH_LOST', msg('msg.fail.earthLost')); return }
    // 요새가 어떤 이유로든 전멸했으면(연쇄로 같이 터졌든) 그 순간 클리어다
    if (this.aliveFortresses === 0) { this.win(); return }
    // 시한 초과 — 날아가고 있는 마지막 한 발은 끝까지 보내준다.
    // 문장으로 통보하지 않는다. **모성이 온다.**
    if (this.time >= this.stageTime && !this.missiles.some(m => m.alive)) this.summonMothership()
  }

  // ─── 시한 종료 — 조르그 모성 ─────────────────────────────────
  // 시한을 넘기면 판돈을 회수하러 모성이 직접 온다. 지구 반대편 하늘로 워프해
  // 들어와 사방에 광선을 뿌린다. 부술 수도, 막을 수도 없다 — 이건 싸움이 아니라
  // 통보다. 그래서 화면에 남기는 문장도 하나뿐이다: **그들이 왔다…**
  //
  // (예전에는 "작전 시한 초과. 조르그가 회랑을 재정비했다"라는 두 줄짜리 통보로
  //  끝냈다. 진 이유를 글로 읽는 것과 판이 쓸려나가는 걸 보는 것은 다른 일이다.)
  summonMothership() {
    if (this.doom) return
    // 자리: **지구와 같은 쪽 하늘, 궤도 바깥.** 처음엔 지구 정반대편(+π)에
    // 놓았는데 그러면 지구를 향하는 광선이 반드시 태양을 통과해 막혔다 —
    // 마지막 한 발이 매번 항성에 삼켜져 지구가 멀쩡히 살아남았다(계측: 5시드 전부).
    // 살짝만 비틀어(0.4 rad) 궤도선 위에 정확히 겹치지 않게 한다.
    const r = Math.hypot(this.earth.pos.x, this.earth.pos.y) || 400
    const a = Math.atan2(this.earth.pos.y, this.earth.pos.x) + 0.4
    const R = Math.min(this.beltR * 0.8, r * 2.4)
    const ship = makeBody({
      id: 'mothership', nameKey: 'planet.mothership', type: 'zorg',
      mu: CFG.DOOM_MU, radius: CFG.DOOM_R,
      pos: { x: Math.cos(a) * R, y: Math.sin(a) * R }, vel: { x: 0, y: 0 },
      hp: 1, zorg: true, mothership: true, warp: 1,
    })
    this.bodies.push(ship)
    this.mothership = ship
    this.doom = makeDoom(ship.pos.x, ship.pos.y, this.aMax * CFG.LASER_RANGE_MUL, ship)
    this.addFx({ kind: 'warp', x: ship.pos.x, y: ship.pos.y, r: hitRadiusOf(ship), fort: true })
    this.setMode('observe')
    this.message = msg('msg.doom')
    this.setToast(msg('toast.doom'))
  }

  tickDoom(dt) {
    for (const e of stepDoom(this.doom, this, dt)) {
      if (e.kind === 'beam') {
        this.addFx({ kind: 'laserFire', x: this.doom.x, y: this.doom.y, a: e.a })
        continue
      }
      if (e.kind === 'volley') {   // 지구가 아직 살아 있다 → 또 쏜다
        this.addFx({ kind: 'laserCharge', x: this.doom.x, y: this.doom.y })
        continue
      }
      const b = e.body
      this.addFx({ kind: 'laserHit', x: e.x, y: e.y, r: b ? hitRadiusOf(b) : CFG.R_STAR, sun: !b })
      if (!b || b.role === 'void' || b.mothership) continue   // 태양·특이점·모성은 안 부서진다
      if (b.isEarth) {
        this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 2, earth: true })
        b.alive = false
      } else {
        this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 1.8, big: true })
        this.killBody(b, 'laser', { fx: false })
      }
    }
    this.message = msg('msg.doom')
    if (this.doom.done) this.fail('TIME_UP', msg('msg.doom'))
  }

  fail(reason, msg) {
    if (this.lost) return
    this.lost = true; this.runOver = true; this.failReason = reason; this.message = msg
  }

  setToast(text) { this.toast = text; this.toastT = 1.6 }

  // 조준 가능 = 조준 모드일 것. 관측 모드에서는 조준선도 발사대도 사라진다.
  get canAim() {
    return this.mode === 'aim' && !this.won && !this.lost && !this.doom && this.earth.alive
  }

  // ─── 조준 보조 (aim.js) ─────────────────────────────────────
  // 계산은 전부 aim.js에 있다. 호출부(HUD·렌더러)가 바뀌지 않게 얇게 감싼다.
  predictPath() { return Aim.predictPath(this) }
  scanContact(dir = 1) { return Aim.scanContact(this, dir) }
}
