import { fromAngle, len } from '../core/vector.js'
import { Rng } from '../core/random.js'
import { CFG, aMaxOf, beltRadius, escapeSpeed, hitRadiusOf, radiusOf } from './config.js'
import {
  applyNuke, beltBounce, blastWave, elasticBounce, resolveBodyPairs, segCircleEntry,
  segHitsCircle, shatter, stepBodies, stepMissile, updateEncounters,
} from './physics.js'
import { hasRole, roleOf, volatileRadius } from './roles.js'
import { CAUSE_KO, makeGoal } from './objectives.js'
import { bearing } from '../core/angle.js'
import { createSystem, pickHomeworld, reinforce } from './system.js'
import { makeBody } from './body.js'
import { chargeLeft, impactLeft, makeDoom, makeLaser, stepDoom, stepLaser, LASER_CHARGE, LASER_TRAVEL } from './laser.js'
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
    this.bodies = sys.bodies; this.earth = sys.earth
    this.laser = makeLaser(this.rng)
    // 같은 쌍이 한 번의 접촉에서 여러 스텝 붙어 있어도 피해는 한 번만 센다
    this.pairCool = new Map()
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
    added.forEach((b, i) => { b.alive = false; b.warp = 1; b.warpIn = CFG.WARP_LEAD + i * CFG.WARP_STAGGER })
    this.targets = fortresses
    this.goal = makeGoal(fortresses)
    this.homeworld = pickHomeworld(this.bodies)   // 증원이 도착하면 stepWarpIns가 다시 고른다
    // 레이저는 판이 바뀌어도 이어진다. 다만 새 판 시작 직후 바로 쏘진 않는다.
    this.laser.state = 'idle'; this.laser.t = 0; this.laser.nextAt = CFG.LASER_FIRST

    this.pairCool.clear()
    this.doom = null; this.mothership = null
    this.missiles = []; this.shots = 0; this.score = 0; this.chainLast = 0
    this.won = false; this.lost = false; this.failReason = null
    const t = this.target
    this.aim = Math.atan2(t.pos.y - this.earth.pos.y, t.pos.x - this.earth.pos.x)
    this.power = 30; this.yieldMt = CFG.YIELD_DEFAULT
    this.mode = 'aim'; this.advancing = false; this.time = 0
    this.obsSpeed = 1   // OBS_SPEEDS 인덱스 — 기본 2×
    this.toast = null; this.toastT = 0
    this.winBanked = false; this.timeWarn = 0
    this.stage = { roles: this.presentRoles(), added: added.length }
    this.message = added.length
      ? `조르그 증원 워프 — 요새 ${fortresses.length}기 진입. ${this.goal.rule}`
      : `작전 개시 — ${this.goal.rule}`
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
  get fortresses() { return this.bodies.filter(b => b.role === 'battery') }
  get aliveFortresses() { return this.bodies.filter(b => b.alive && b.role === 'battery').length }
  // id로 비교한다 — 예측선은 cloneBodies()가 만든 복제본을 넘기므로
  // 참조 비교를 쓰면 "예측에서는 목표가 목표가 아닌" 사고가 난다.
  // 표적 = 조르그 요새. 규칙이 하나로 통일됐으므로 id 목록이 아니라
  // 성질로 판정한다 — 예측선이 넘기는 복제본에서도 그대로 성립한다.
  isTarget(b) { return b.role === 'battery' }
  get aliveTargets() { return this.aliveFortresses }
  // 특이점은 부술 수 없으니 "남은 재료"에서 뺀다 (연쇄 충돌 목표의 달성 가능성 판정용)
  get alivePlanets() {
    return this.bodies.filter(b => b.alive && !b.isEarth && b.type !== 'debris' && b.role !== 'void').length
  }

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
    if (this.inFlight) {
      this.setToast('아직 탄이 날고 있다 — 결판난 뒤에 다음 탄을 쏜다')
      return
    }
    if (this.power <= this.launchEscape) {
      this.setToast(`발사 속도 부족 — 지구 탈출속도 ${this.launchEscape.toFixed(1)} 초과 필요`)
      return
    }
    const p = this.launchPos(), v = fromAngle(this.aim, this.power)
    this.missiles.push({
      pos: { ...p }, vel: v, yld: this.yieldMt, alive: true, chain: 0, nearMiss: 0, age: 0,
      path: [{ ...p }], pathN: 0, enc: new Map(), bestDeflection: 0,
      encountered: false, minSunDist: Infinity, hit: null, out: null, lastBelt: -99,
    })
    this.shots++
    this.addFx({ kind: 'launch', x: p.x, y: p.y, a: this.aim })
    this.message = `MISSILE AWAY — ${this.yieldMt}Mt 탄두. 어느 살을 치느냐가 전부다`
    // 쏘면 자동으로 관측 모드로 넘어간다 — 쏜 뒤엔 보는 게 할 일이다.
    // 언제든 조준 모드를 다시 켜면 미사일이 날아가는 도중에도 판이 멈춘다.
    this.setMode('observe')
  }

  addFx(e) { if (this.fx.length < 96) this.fx.push(e) }

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
  get warpPending() { return this.bodies.some(b => (b.warpIn ?? 0) > 0) }
  stepWarpIns(dtReal) {
    for (const b of this.bodies) {
      if (!(b.warpIn > 0)) continue
      b.warpIn -= dtReal
      if (b.warpIn > 0) continue
      b.warpIn = 0; b.alive = true; b.warp = 1
      this.addFx({ kind: 'warp', x: b.pos.x, y: b.pos.y, r: hitRadiusOf(b), fort: b.role === 'battery' })
      // 본성은 요새가 실제로 **도착한 뒤에** 정해진다. 예전엔 loadStage에서
      // 미리 골랐는데, 순차 워프인이 생기면서 그 시점엔 살아 있는 요새가 0이라
      // 본성이 영영 null로 남고 레이저가 한 번도 안 나갔다(계측: 420초 무발사).
      if (b.role === 'battery' && !this.homeworld) this.homeworld = pickHomeworld(this.bodies)
    }
  }

  tick(dtFrame) {
    if (this.toastT > 0) this.toastT -= dtFrame
    this.stepWarpIns(dtFrame)
    let acc = Math.min(0.1, dtFrame) * this.effTimeScale()
    while (acc >= CFG.DT) { this.step(CFG.DT); acc -= CFG.DT }
  }

  step(dt) {
    stepBodies(this.bodies, dt)
    for (const m of this.missiles) {
      if (!m.alive) continue
      stepMissile(m, this.bodies, dt)
      updateEncounters(m, this.bodies, {
        swing: (b, deg) => {
          this.message = `${b.name} 스윙바이 ${deg.toFixed(0)}°! 체인 x${m.chain}`
          this.addFx({ kind: 'swing', x: b.pos.x, y: b.pos.y, r: b.radius })
        },
        capture: (b) => { this.detonate(m, b, { x: m.pos.x, y: m.pos.y }); this.setToast('포획됨 — 너무 느렸다 (강제 추락)') },
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

  // ─── 조르그 레이저 ─────────────────────────────────────────
  // 닿는 것은 체력과 무관하게 부서진다. 태양과 특이점만 예외로, 막되 안 부서진다
  // — 원래 부술 수 없는 것들이라 여기서만 예외를 만들면 규칙이 어긋난다.
  tickLaser(dt) {
    const L = this.laser
    const ev = stepLaser(L, this, dt)
    if (!ev) return
    if (ev.kind === 'charge') {
      this.addFx({ kind: 'laserCharge', x: L.ox, y: L.oy })
      this.setToast(`조르그 레이저 조준 — ${CFG.LASER_CHARGE}초 뒤 발사. 조준점에서 비켜나라`)
      this.message = `${ev.src.name} 본성이 지구의 도달 지점을 겨눴다 — 지구를 밀면 조준점이 틀어진다`
      return
    }
    if (ev.kind === 'abort') {
      this.setToast('본성 파괴 — 레이저 조준 해제')
      this.message = '조르그 레이저 — 충전 중 본성이 파괴되어 발사가 취소됐다'
      return
    }
    if (ev.kind === 'fire') {
      this.addFx({ kind: 'laserFire', x: L.ox, y: L.oy, a: Math.atan2(L.uy, L.ux) })
      this.message = '조르그 레이저 발사 — 직진한다. 조준점이 틀어져 있으면 스쳐 지나간다'
      return
    }
    if (ev.kind === 'expire') {
      this.addFx({ kind: 'laserMiss', x: ev.x, y: ev.y })
      this.message = '조르그 레이저 — 아무것도 맞히지 못하고 성계를 벗어났다'
      this.setToast('레이저 회피 성공')
      return
    }
    // ── 착탄 ──
    const b = ev.body
    this.addFx({ kind: 'laserHit', x: ev.x, y: ev.y, r: b ? hitRadiusOf(b) : CFG.R_STAR, sun: !b })
    if (!b) {   // 태양이 막았다
      this.message = '조르그 레이저가 태양에 삼켜졌다 — 항성은 부술 수 없다'
      this.setToast('태양이 광선을 막았다')
      return
    }
    if (b.isEarth) {
      this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 2, earth: true })
      b.alive = false
      this.fail('EARTH_LASER', '조르그 레이저가 지구를 관통했다. 작전 종료.')
      this.setToast('지구 피격 — 게임 오버')
      return
    }
    if (b.role === 'void') {   // 특이점도 막되 안 부서진다
      this.message = `${b.name}이(가) 레이저를 삼켰다 — 특이점엔 아무것도 안 통한다`
      this.setToast(`특이점이 광선을 막았다 — ${b.name}`)
      return
    }
    // 체력 불문 파괴. 막아 준 대가가 그 공의 소멸이다.
    this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 1.8, big: true })
    this.message = `${b.name}이(가) 레이저에 관통당해 소멸했다 — 체력과 무관하게 부서진다`
    this.setToast(`레이저 차단 — ${b.name} 소멸`)
    this.killBody(b, 'laser', { fx: false })
  }

  get laserCharging() { return this.laser.state === LASER_CHARGE }
  get laserFlying() { return this.laser.state === LASER_TRAVEL }
  get laserLeft() { return chargeLeft(this.laser) }
  get laserImpactLeft() { return impactLeft(this.laser) }
  // 조준선에서 지구까지 예상 수직거리 / 지금 이대로면 빗나가는가
  get laserMiss() { return this.laser.miss ?? 0 }
  get laserSafe() { return !!this.laser.safe }

  // 시한이 줄고 있다는 걸 토스트로 못 박는다 (남은 60/30/10초)
  warnTime() {
    if (this.won || this.lost || this.doom) return
    const marks = [60, 30, 10], left = this.timeLeft
    while (this.timeWarn < marks.length && left <= marks[this.timeWarn]) {
      const s = marks[this.timeWarn]
      this.timeWarn++
      this.setToast(`작전 시한 ${s}초 — 서둘러라 (시간 보너스 ${this.timeBonus})`)
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
    const who = '핵'

    // 모성 — 핵도 안 통한다. 부술 수 없는 것에는 부술 수 없다고 말해 준다.
    if (b.mothership) {
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius })
      this.message = `${b.name}에 ${who}이 통하지 않았다 — 부술 수 없다`
      return
    }

    // 특이점 — 탄두째로 삼킨다. 밀리지도, 터지지도 않는다.
    if (b.role === 'void') {
      this.addFx({ kind: 'absorb', x: point.x, y: point.y, r: b.radius, small: true })
      this.message = `${b.name}이(가) ${who}을 삼켰다 — 특이점엔 아무것도 안 통한다`
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
      this.message = '파편에 격발 — 탄두 조기 폭발'
      return
    }

    if (b.isEarth) {   // 요청대로: 지구 오폭 = 즉시 게임오버, 변명 없음
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld: CFG.YIELD_MAX, r: b.radius, earth: true })
      this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius, earth: true })
      b.alive = false
      this.fail('EARTH_LOST', '지구에 핵을 박았다. 인류 종료 — 작전도 종료.')
      this.setToast('지구 오폭 — 게임 오버')
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
    this.score += gained; this.chainLast = m.chain
    this.message = `${b.name} 타격 — Δv ${push.dv.toFixed(1)} · 방위 ${bearing(push.dx, push.dy).toFixed(0)}°`
      + (hasRole(b, 'armor') ? ' (장갑에 막혀 거의 안 밀렸다)' : gained ? ` (+${gained})` : '')
    // 폭풍이 지구를 정통으로 훑었다면 경고 — 지구가 밀려 태양에 빠지는 사고가 실제로 난다
    if (wave.pushed.some(p => p.body.isEarth)) this.setToast('경고 — 폭풍이 지구를 밀었다')
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
    this.message = `${b.name} 유폭! — 반경 ${R.toFixed(0)} GU 안이 전부 밀렸다`
    this.killBody(b, 'blast', { fx: false })
  }

  // ─── 특이점 흡수 ─────────────────────────────────────────────
  absorb(hole, prey) {
    this.addFx({ kind: 'absorb', x: hole.pos.x, y: hole.pos.y, r: hitRadiusOf(hole) })
    if (hole.mu < CFG.VOID_MU_MAX) {   // 삼킨 만큼 자란다 — 판이 점점 위험해진다
      hole.mu = Math.min(CFG.VOID_MU_MAX, hole.mu + prey.mu * CFG.VOID_GROW)
      hole.radius = radiusOf(hole.mu)
    }
    this.message = `${prey.name}이(가) ${hole.name}에 삼켜졌다 — 특이점 질량 ${hole.mu.toFixed(0)}`
      + ` (반경 ${hitRadiusOf(hole).toFixed(0)}, 중력 ×${(hole.mu / 900).toFixed(2)})`
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
      this.message = `${vol.name} ✕ ${other.name} — 상대속도 ${vRel0.toFixed(0)}, 충돌 유폭!`
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
      this.message = `${a.name} ↔ ${b.name} — 가벼운 접촉(상대속도 ${vRel.toFixed(0)}), 튕겨 나갔다`
      return null
    }
    this.message = `${a.name} ✕ ${b.name} — 충돌! 상대속도 ${vRel.toFixed(0)} · 피해 ${dmg}`
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
      this.setToast(`${b.name} 체력 ${b.hp}/${b.hpMax ?? CFG.PLANET_HP} — ${b.hp}번 더`)
      return false
    }
    if (b.isEarth) {
      this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 2, earth: true })
      b.alive = false
      this.fail('EARTH_LOST', '지구가 세 번 처박혔다. 인류 종료 — 작전도 종료.')
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
    const wasFort = b.role === 'battery'
    const [tp, np] = KILL_SCORE[cause] ?? [0, 0]
    const gained = wasFort ? tp : np
    this.score += gained
    const label = `${b.name} — ${CAUSE_KO[cause]} (+${gained})`
    if (wasFort) {
      // 본성이 죽으면 남은 요새가 지휘권을 승계한다 (레이저가 끊기지 않는다)
      if (b.homeworld) {
        b.homeworld = false
        const next = pickHomeworld(this.bodies)
        if (next) this.setToast(`본성 격파 — ${next.name}이(가) 지휘권을 승계`)
        else this.setToast('조르그 본성 격파 — 레이저 침묵')
        this.homeworld = next
      }
      this.goal.update(this.aliveFortresses)
      this.message = `${label} · ${this.goal.label()}`
      this.setToast(`요새 격파 — ${this.goal.label()}`)
    } else {
      this.message = label
    }
    if (this.aliveFortresses === 0) this.win()
  }

  win() {
    if (this.won || this.lost) return
    this.won = true
    this.message = '작전 성공 — 조르그 요새 전멸. 성계는 그대로 다음 판으로 이어진다'
    this.setToast('작전 성공')
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
          this.fail('EARTH_LOST', '지구가 태양으로 떨어졌다. 작전 종료.')
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
        this.message = `${b.name}이(가) 카이퍼 벨트를 들이받았다 — 속력 ${hit.speed.toFixed(0)} 유지, 반사각으로 복귀`
        this.setToast(`벨트 반사 — ${b.name} (운동량 그대로)`)
      }
    }
  }

  // §14.4 실패 피드백 — 빗나간 샷마다 원인 태그 1개
  finishShot(m) {
    if (m.hit) return
    let tag
    // '유실'은 이제 없다 — 벨트가 튕겨 되돌려 보낸다. 남은 실패는 태양/시간뿐이다.
    if (m.out === 'sun') tag = '태양 소멸 — 근일점이 너무 낮다'
    else if (m.encountered && m.bestDeflection < 10) tag = `속도 초과 — 통과만 함 (δ ${m.bestDeflection.toFixed(0)}°)`
    else if (m.bestDeflection < CFG.SWING_DEG) tag = `굴절 부족 — ${m.bestDeflection.toFixed(0)}° / ${CFG.SWING_DEG}° 필요`
    else tag = '타이밍 — 공이 지나갔다'
    this.setToast(tag); this.message = tag
  }

  checkEnd() {
    // 모성이 오는 중이면 판정을 멈춘다 — 연출이 끝나야 진짜 종료다.
    // (안 막으면 광선이 지구를 부순 순간 EARTH_LOST로 끝나 버려 난사가 중간에 멎는다.)
    if (this.doom) return
    // 증원이 아직 워프 중이면 판정을 미룬다 — 안 그러면 "요새 0기"로
    // 도착하기도 전에 클리어가 나 버린다.
    if (this.warpPending) return
    this.goal.update(this.aliveFortresses)
    if (this.won && !this.winBanked) {   // 클리어 시점의 남은 시간을 보너스로 정산
      this.winBanked = true
      const b = this.timeBonus
      if (b > 0) { this.score += b; this.message += ` · 시간 보너스 +${b}` }
    }
    if (this.won || this.lost) return
    if (!this.earth.alive) { this.fail('EARTH_LOST', '작전 실패 — 지구 상실. 런 종료'); return }
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
      id: 'mothership', name: '조르그 모성', type: 'zorg',
      mu: CFG.DOOM_MU, radius: CFG.DOOM_R,
      pos: { x: Math.cos(a) * R, y: Math.sin(a) * R }, vel: { x: 0, y: 0 },
      hp: 1, zorg: true, mothership: true, warp: 1,
    })
    this.bodies.push(ship)
    this.mothership = ship
    this.doom = makeDoom(ship.pos.x, ship.pos.y, this.aMax * CFG.LASER_RANGE_MUL, ship)
    this.addFx({ kind: 'warp', x: ship.pos.x, y: ship.pos.y, r: hitRadiusOf(ship), fort: true })
    this.setMode('observe')
    this.message = '그들이 왔다…'
    this.setToast('그들이 왔다…')
  }

  tickDoom(dt) {
    for (const e of stepDoom(this.doom, this, dt)) {
      if (e.kind === 'beam') {
        this.addFx({ kind: 'laserFire', x: this.doom.x, y: this.doom.y, a: e.a })
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
    this.message = '그들이 왔다…'
    if (this.doom.done) this.fail('TIME_UP', '그들이 왔다…')
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
