import { fromAngle, len } from '../core/vector.js'
import { Rng } from '../core/random.js'
import { CFG, aMaxOf, beltRadius, counterSpeed, escapeSpeed, hitRadiusOf, radiusOf } from './config.js'
import {
  applyNuke, beltBounce, blastWave, elasticBounce, resolveBodyPairs, segCircleEntry,
  segHitsCircle, shatter, stepBodies, stepMissile, updateEncounters,
} from './physics.js'
import { hasRole, roleOf, volatileRadius } from './roles.js'
import { CAUSE_KO, makeGoal } from './objectives.js'
import { bearing } from '../core/angle.js'
import { createSystem, pickHomeworld, reinforce } from './system.js'
import { chargeLeft, makeLaser, stepLaser, LASER_CHARGE } from './laser.js'
import * as Aim from './aim.js'

// 관측 모드 배속 단계 — 화면의 배속 버튼이 이 사이를 돈다
const OBS_SPEEDS = [1, 2, 4, 8]

// 파괴 사유별 점수 (목표 / 중립). 추방은 없앴다 — 벨트가 되돌려 보낸다.
const KILL_SCORE = {
  collision: [120, 40],
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
    // 살아남은 행성이 위치·속도 그대로 다음 판으로 넘어간다.
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
  // 위협 = 반격하는 조르그 요새. 이것만 전멸시키면 판이 끝난다.
  get fortresses() { return this.bodies.filter(b => b.role === 'battery') }
  get aliveFortresses() { return this.bodies.filter(b => b.alive && b.role === 'battery').length }
  // id로 비교한다 — 예측선은 cloneBodies()가 만든 복제본을 넘기므로
  // 참조 비교를 쓰면 "예측에서는 목표가 목표가 아닌" 사고가 난다.
  // 표적 = 반격하는 요새. 규칙이 하나로 통일됐으므로 id 목록이 아니라
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
  // 붙잡혀 되떨어진다 = 자기 지구에 핵을 박는다. 반격탄과 같은 검사다.
  get launchEscape() { return escapeSpeed(this.earth.mu, CFG.LAUNCH_OFFSET) }

  // 비행 중인 아군 탄이 있으면 다음 탄을 못 쏜다 — 탄약이 아니라 **차례**가 자원이다.
  get inFlight() { return this.missiles.some(m => m.alive && !m.hostile) }

  fire() {
    if (this.won || this.lost || !this.earth.alive) return
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
    this.missilePairs()
    resolveBodyPairs(this.bodies, this)
    this.bodyBounds()
    this.tickLaser(dt)
    this.time += dt
    this.warnTime()
    this.checkEnd()
  }

  // ─── 공중 요격 — 탄두끼리 만나면 그 자리에서 동시 기폭 ────────
  // 속도가 30~50 GU/s이고 스텝이 1/120초라 한 스텝 이동이 0.5 GU 미만이다.
  // 터널링이 불가능하므로 점 거리 판정으로 충분하다.
  missilePairs() {
    const live = this.missiles.filter(m => m.alive)
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j]
        if (!a.alive || !b.alive) continue
        if (Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) > 2 * CFG.MISSILE_HIT_R) continue
        this.intercept(a, b)
        return
      }
    }
  }

  intercept(a, b) {
    a.alive = false; b.alive = false
    a.hit = 'missile'; b.hit = 'missile'   // 빗나감 태그를 붙이지 않기 위한 표시
    const x = (a.pos.x + b.pos.x) / 2, y = (a.pos.y + b.pos.y) / 2
    const yld = a.yld + b.yld               // 작약량은 합쳐진다 — 폭풍이 그만큼 넓다
    const wave = blastWave(this.bodies, x, y, yld, null)
    // 연출 크기는 탄두 크기 기준으로 넘긴다. 접촉 거리(2×MISSILE_HIT_R = 90 GU)를
    // 그대로 넘기면 화구 반경이 행성 직격의 4.5배가 되어 성계를 통째로 덮는다.
    this.addFx({ kind: 'nuke', x, y, yld, r: 22, wave: wave.radius, intercept: true })
    const gained = (a.hostile !== b.hostile) ? CFG.INTERCEPT_SCORE : 0   // 반격탄을 잡았을 때만 가산
    this.score += gained
    this.message = `공중 요격 — ${a.yld}+${b.yld}Mt 동시 기폭 · 폭풍 반경 ${wave.radius.toFixed(0)} GU`
      + (gained ? ` (+${gained})` : '')
    this.setToast('공중 요격 — 두 탄두가 함께 터졌다')
    if (wave.pushed.some(p => p.body.isEarth)) this.setToast('경고 — 요격 폭풍이 지구를 밀었다')
  }

  // ─── 조르그 레이저 ─────────────────────────────────────────
  tickLaser(dt) {
    const ev = stepLaser(this.laser, this, dt)
    if (!ev) return
    if (ev.kind === 'charge') {
      this.addFx({ kind: 'laserCharge', x: this.laser.ox, y: this.laser.oy })
      this.setToast(`조르그 레이저 조준! — ${CFG.LASER_CHARGE}초 뒤 발사. 막거나 피해라`)
      this.message = `${ev.src.name} 본성이 지구 예상 위치를 조준했다 — 조준선을 끊어라`
      return
    }
    if (ev.kind === 'abort') {
      this.setToast('본성 파괴 — 레이저 조준 해제')
      return
    }
    // ── 발사 ──
    const L = this.laser
    const hit = ev.hit
    const end = hit ? { x: L.ox + L.ux * hit.t, y: L.oy + L.uy * hit.t }
      : { x: L.ox + L.ux * L.range, y: L.oy + L.uy * L.range }
    this.addFx({ kind: 'laserFire', x: L.ox, y: L.oy, ex: end.x, ey: end.y, hit: !!hit })
    if (!hit) {
      this.message = '조르그 레이저 — 빗나갔다'
      this.setToast('레이저 회피 성공')
      return
    }
    if (hit.body.isEarth) {
      this.addFx({ kind: 'destroy', x: this.earth.pos.x, y: this.earth.pos.y, r: this.earth.radius * 2, earth: true })
      this.earth.alive = false
      this.fail('EARTH_LASER', '조르그 레이저가 지구를 관통했다. 작전 종료.')
      this.setToast('지구 피격 — 게임 오버')
      return
    }
    // 다른 행성이 대신 맞았다 — 그 행성은 광선 방향으로 크게 밀린다.
    // 즉 "막는 것"이 곧 "그 공을 세게 치는 것"이라 당구로 되돌아온다.
    const b = hit.body
    const dv = CFG.LASER_PUSH / b.mu
    b.vel.x += L.ux * dv; b.vel.y += L.uy * dv
    b.hitFlash = 1.0; b.trailFlash = 2.5
    b.scorch = Math.min(3, (b.scorch || 0) + 1)
    this.message = `${b.name}이(가) 레이저를 대신 맞았다 — Δv ${dv.toFixed(1)}로 밀려남`
    this.setToast(`레이저 차단 — ${b.name}`)
  }

  get laserCharging() { return this.laser.state === LASER_CHARGE }
  get laserLeft() { return chargeLeft(this.laser) }

  // 시한이 줄고 있다는 걸 토스트로 못 박는다 (남은 60/30/10초)
  warnTime() {
    if (this.won || this.lost) return
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
    const who = m.hostile ? '반격탄' : '핵'

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
    const gained = m.hostile ? 0 : Math.round(8 * M)
    this.score += gained; this.chainLast = m.chain
    this.message = `${b.name} 타격 — Δv ${push.dv.toFixed(1)} · 방위 ${bearing(push.dx, push.dy).toFixed(0)}°`
      + (hasRole(b, 'armor') ? ' (장갑에 막혀 거의 안 밀렸다)' : gained ? ` (+${gained})` : '')
    // 폭풍이 지구를 정통으로 훑었다면 경고 — 지구가 밀려 태양에 빠지는 사고가 실제로 난다
    if (wave.pushed.some(p => p.body.isEarth)) this.setToast('경고 — 폭풍이 지구를 밀었다')
    // 요새 — 때린 쪽으로 반격탄을 되쏜다. 그 탄도 행성을 미는 큐다.
    if (b.role === 'battery' && b.alive) this.retaliate(b, point, push)
  }

  // ─── 요새의 반격 ─────────────────────────────────────────────
  // 방향은 임펄스의 정반대 = 내가 때린 쪽으로 되나온다. 즉 어느 살을
  // 쳤느냐로 반격탄의 진로까지 내가 정한다 — 적의 미사일을 큐로 쓰는 것.
  retaliate(b, point, push) {
    if ((b.ammo ?? 0) <= 0) { this.setToast(`${b.name} 반격 재고 소진`); return }
    b.ammo--
    const dx = -push.dx, dy = -push.dy
    const off = hitRadiusOf(b) * 1.15
    const p = { x: b.pos.x + dx * off, y: b.pos.y + dy * off }
    const sp = counterSpeed(b, off)
    this.missiles.push({
      pos: p, vel: { x: dx * sp + b.vel.x, y: dy * sp + b.vel.y },
      yld: CFG.BATTERY_YIELD, alive: true, hostile: true, chain: 0, nearMiss: 0, age: 0,
      path: [{ ...p }], pathN: 0, enc: new Map(), bestDeflection: 0,
      encountered: false, minSunDist: Infinity, hit: null, out: null, lastBelt: -99,
    })
    this.addFx({ kind: 'launch', x: p.x, y: p.y, a: Math.atan2(dy, dx), hostile: true })
    this.setToast(`${b.name} 반격! — 되날아오는 탄도 행성을 민다 (${sp.toFixed(0)} GU/s)`)
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
    if (m.hostile) { this.setToast('반격탄 소멸'); return }   // 내 탓이 아니다
    let tag
    // '유실'은 이제 없다 — 벨트가 튕겨 되돌려 보낸다. 남은 실패는 태양/시간뿐이다.
    if (m.out === 'sun') tag = '태양 소멸 — 근일점이 너무 낮다'
    else if (m.encountered && m.bestDeflection < 10) tag = `속도 초과 — 통과만 함 (δ ${m.bestDeflection.toFixed(0)}°)`
    else if (m.bestDeflection < CFG.SWING_DEG) tag = `굴절 부족 — ${m.bestDeflection.toFixed(0)}° / ${CFG.SWING_DEG}° 필요`
    else tag = '타이밍 — 공이 지나갔다'
    this.setToast(tag); this.message = tag
  }

  checkEnd() {
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
    // 시한 초과 — 날아가고 있는 마지막 한 발은 끝까지 보내준다
    if (this.time >= this.stageTime && !this.missiles.some(m => m.alive))
      this.fail('TIME_UP', '작전 실패 — 작전 시한 초과. 조르그가 회랑을 재정비했다. 런 종료')
  }

  fail(reason, msg) {
    if (this.lost) return
    this.lost = true; this.runOver = true; this.failReason = reason; this.message = msg
  }

  setToast(text) { this.toast = text; this.toastT = 1.6 }

  // 조준 가능 = 조준 모드일 것. 관측 모드에서는 조준선도 발사대도 사라진다.
  get canAim() {
    return this.mode === 'aim' && !this.won && !this.lost && this.earth.alive
  }

  // ─── 조준 보조 (aim.js) ─────────────────────────────────────
  // 계산은 전부 aim.js에 있다. 호출부(HUD·렌더러)가 바뀌지 않게 얇게 감싼다.
  predictPath() { return Aim.predictPath(this) }
  scanContact(dir = 1) { return Aim.scanContact(this, dir) }
}
