import { fromAngle, len, sub } from '../core/vector.js'
import { Rng } from '../core/random.js'
import { CFG, hitRadiusOf } from './config.js'
import { applyHit, cloneBodies, resolveBodyPairs, segHitsCircle, shatter, stepBodies, stepMissile, updateEncounters } from './physics.js'
import { makeStage } from './stage.js'

export class Game {
  constructor(seed) {
    this.seed = seed >>> 0
    this.stageIdx = 0; this.runScore = 0; this.runOver = false
    this.rng = new Rng(this.seed ^ 0x9e3779b9)
    this.loadStage()
  }

  get ante() { return Math.min(8, 1 + Math.floor(this.stageIdx / 3)) }

  // ─── 작전 시한 (인게임 시간) ───
  // this.time은 step()에서만 누적되고, step()은 effTimeScale()>0일 때만 돈다.
  // → 조준만 하고 있으면 시계가 멈춰 있고, 관측(4×)하거나 미사일이 날 때만 줄어든다.
  get stageTime() { return CFG.TIME_BASE + CFG.TIME_PER_ANTE * Math.min(this.ante - 1, 5) }
  get timeLeft() { return Math.max(0, this.stageTime - this.time) }
  get timeBonus() { return Math.round(this.timeLeft * CFG.TIME_BONUS) }

  loadStage() {
    const s = makeStage((this.seed + this.stageIdx * 7919) >>> 0, this.ante)
    this.stage = s; this.bodies = s.bodies; this.earth = s.earth; this.target = s.target; this.aMax = s.aMax
    this.missiles = []; this.rockets = CFG.ROCKETS; this.diplomacy = 0; this.score = 0; this.chainLast = 0
    this.won = false; this.lost = false; this.failReason = null
    this.aim = Math.atan2(this.target.pos.y - this.earth.pos.y, this.target.pos.x - this.earth.pos.x)
    this.power = 30; this.observing = false; this.time = 0
    this.toast = null; this.toastT = 0
    this.fx = []   // 렌더러가 매 프레임 비워가는 연출 이벤트 큐 (§14.5)
    this.winBanked = false; this.timeWarn = 0
    this.message = `작전 개시 — ${this.target.name} 섬멸 (차폐도 B=${s.B.toFixed(1)}). 시간 정지 중: 관측(SHIFT)으로 판을 돌려라`
  }

  nextStage() {
    if (!this.won || this.runOver) return
    this.runScore += this.score; this.stageIdx++; this.loadStage()
  }

  legal(b) { return b === this.target }   // 섬멸전 LEGAL_HIT = {목표} (§5.3)

  launchPos() {
    const d = CFG.LAUNCH_OFFSET   // 지구 중력권 밖에서 발사 (§4.3 κ 증폭 때문)
    return { x: this.earth.pos.x + Math.cos(this.aim) * d, y: this.earth.pos.y + Math.sin(this.aim) * d }
  }

  fire() {
    if (this.won || this.lost || this.rockets <= 0 || !this.earth.alive) return
    if (this.missiles.some(m => m.alive)) return
    const p = this.launchPos(), v = fromAngle(this.aim, this.power)
    this.missiles.push({
      pos: { ...p }, vel: v, power: CFG.SHELL_P, alive: true, chain: 0, nearMiss: 0, age: 0,
      path: [{ ...p }], pathN: 0, lastVel: { ...v }, enc: new Map(), bestDeflection: 0,
      encountered: false, captured: false, minSunDist: Infinity, foul: false, hit: null, out: null,
    })
    this.rockets--
    this.addFx({ kind: 'launch', x: p.x, y: p.y, a: this.aim })
    this.message = 'MISSILE AWAY — 행성 중력권으로 감아 치세요'
  }

  addFx(e) { if (this.fx.length < 64) this.fx.push(e) }

  // 관제실 모드(§5.1): 조준 중 시간 정지, 관측 홀드 4×, 미사일 비행 중 1×
  effTimeScale() {
    if (this.lost || this.won) return 0   // 클리어 후에는 시계를 세운다
    if (this.missiles.some(m => m.alive)) return this.observing ? 4 : 1
    return this.observing ? 4 : 0
  }

  tick(dtFrame) {
    if (this.toastT > 0) this.toastT -= dtFrame
    let acc = Math.min(0.1, dtFrame) * this.effTimeScale()
    while (acc >= CFG.DT) { this.step(CFG.DT); acc -= CFG.DT }
  }

  step(dt) {
    stepBodies(this.bodies, dt)
    for (const m of this.missiles) {
      if (!m.alive) continue
      m.lastVel = { ...m.vel }
      stepMissile(m, this.bodies, dt)
      updateEncounters(m, this.bodies, {
        swing: (b, deg) => {
          this.message = `${b.name} 스윙바이 ${deg.toFixed(0)}°! 체인 x${m.chain}`
          this.addFx({ kind: 'swing', x: b.pos.x, y: b.pos.y, r: b.radius })
        },
        capture: (b) => { this.resolveHit(m, b); this.setToast('포획됨 — 너무 느렸다 (강제 추락)') },   // §5.2
      })
      if (m.alive) this.contact(m)
      if (m.alive) this.missileBounds(m)
      if (!m.alive) this.finishShot(m)
    }
    resolveBodyPairs(this.bodies, this)
    this.bodyBounds()
    this.time += dt
    this.warnTime()
    this.checkEnd()
  }

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
  // 점 판정만 하면 빠른 미사일이 행성을 한 스텝에 건너뛴다.
  contact(m) {
    const a = m.prev || m.pos
    for (const b of this.bodies) {
      if (!b.alive) continue
      if (segHitsCircle(a.x, a.y, m.pos.x, m.pos.y, b.pos.x, b.pos.y, hitRadiusOf(b))) {
        this.resolveHit(m, b); return
      }
    }
  }

  resolveHit(m, b) {
    m.alive = false
    this.addFx({ kind: 'hit', x: m.pos.x, y: m.pos.y, r: b.radius, foul: b.type !== 'debris' && !this.legal(b) })
    if (b.type === 'debris') { m.hit = 'debris'; this.message = '파편 명중 — 미사일 소실 (파울 아님)'; return }
    if (!this.legal(b)) {   // §5.3 파울: 점수 0 + 외교 +1
      m.foul = true; this.diplomacy++
      if (b.isEarth) {
        b.hp -= 1; b.hitFlash = 0.8
        this.message = `지구 오폭! 지구 HP ${Math.max(0, b.hp)} / 외교 ${Math.min(3, this.diplomacy)}/3`
        if (b.hp <= 0) b.alive = false
      } else {
        applyHit(m, b)
        this.message = `파울 — ${b.name} 침범 (점수 0, 외교 ${Math.min(3, this.diplomacy)}/3)`
        if (b.hp <= 0) this.killBody(b)
      }
      this.setToast(`파울 — 조르그령 침범 (외교 ${Math.min(3, this.diplomacy)}/3)`)
      return
    }
    const dmg = applyHit(m, b)
    m.hit = b; this.chainLast = m.chain
    // §9.1 샷 점수 = P × M,  M = 1 + 0.75·체인 + 0.25·니어미스 + 0.5·태양가속
    const M = 1 + 0.75 * m.chain + 0.25 * m.nearMiss + (m.minSunDist < CFG.SUN_BONUS_R ? 0.5 : 0)
    const gained = Math.round(m.power * M)
    this.score += gained
    this.message = `${b.name} 명중 — 데미지 ${dmg.toFixed(1)}, +${gained}점 (배율 ×${M.toFixed(2)})`
    if (b.hp <= 0) this.killBody(b)
  }

  killBody(b) {
    b.alive = false
    this.addFx({ kind: 'kill', x: b.pos.x, y: b.pos.y, r: b.radius })
    shatter(b, this.bodies, () => this.rng.next())
    if (b === this.target) { this.won = true; this.message = '조르그 행성 말살 완료! — 연구비 정산' }
  }

  missileBounds(m) {   // §7.8
    const r = len(m.pos)
    if (r < CFG.R_STAR + 8) { m.alive = false; m.out = 'sun' }
    else if (r > 2.8 * this.aMax) { m.alive = false; m.out = 'lost' }
    else if (m.age > CFG.MISSILE_TTL) { m.alive = false; m.out = 'timeout' }
  }

  bodyBounds() {   // §7.8 항성 처분 / 행성 추방 — 정식 킬
    for (const b of this.bodies) {
      if (!b.alive) continue
      const r = len(b.pos)
      if (r < CFG.R_STAR + 15) {
        b.alive = false
        this.addFx({ kind: 'sun', x: b.pos.x, y: b.pos.y })
        if (b.isEarth) { b.hp = 0; this.message = '지구가 태양으로…' }
        else if (b === this.target) { this.won = true; this.score += 30; this.message = `항성 처분! ${b.name} 태양행 — 스타일 +30점` }
        else if (b.type !== 'debris') { this.score += 10; this.message = `${b.name} 항성 처분 (+10)` }
      } else if (r > 2.6 * this.aMax) {
        b.alive = false
        if (b.isEarth) { b.hp = 0; this.message = '지구 성계 이탈…' }
        else if (b === this.target) { this.won = true; this.score += 15; this.message = `행성 추방! ${b.name} 성계 밖 (+15, 점수 50%)` }
        else if (b.type !== 'debris') { this.score += 5; this.message = `${b.name} 추방 (+5)` }
      }
    }
  }

  // §14.4 실패 피드백 — 빗나간 샷마다 원인 태그 1개
  finishShot(m) {
    if (m.hit && m.hit !== 'debris') return
    if (m.foul) return   // 파울 토스트는 명중 시점에 이미 띄움
    let tag
    if (m.out === 'lost') tag = '유실 — 성계 이탈 (파워 과다)'
    else if (m.out === 'sun') tag = '태양 소멸 — 근일점이 너무 낮다'
    else if (m.hit === 'debris') tag = null
    else if (m.encountered && m.bestDeflection < 10) tag = `속도 초과 — 통과만 함 (δ ${m.bestDeflection.toFixed(0)}°)`
    else if (m.bestDeflection < CFG.SWING_DEG) tag = `굴절 부족 — ${m.bestDeflection.toFixed(0)}° / ${CFG.SWING_DEG}° 필요`
    else tag = '타이밍 — 목표가 지나감'
    if (tag) { this.setToast(tag); this.message = tag }
  }

  checkEnd() {   // §16 실패 3종 + 작전 시한 초과
    if (this.won && !this.winBanked) {   // 클리어 시점의 남은 시간을 보너스로 정산
      this.winBanked = true
      const b = this.timeBonus
      if (b > 0) { this.score += b; this.message += ` · 시간 보너스 +${b}` }
    }
    if (this.won || this.lost) return
    // 시한 초과 — 날아가고 있는 마지막 한 발은 끝까지 보내준다
    if (this.time >= this.stageTime && !this.missiles.some(m => m.alive)) {
      this.fail('TIME_UP', '작전 실패 — 작전 시한 초과. 조르그가 회랑을 재정비했다. 런 종료')
      return
    }
    if (!this.earth.alive || this.earth.hp <= 0) { this.fail('EARTH_LOST', '작전 실패 — 지구 상실. 런 종료'); return }
    if (this.diplomacy >= CFG.DIPLO_MAX) { this.fail('DIPLOMATIC_INCIDENT', '작전 실패 — 은하 여론 악화 (외교 3). 런 종료'); return }
    if (!this.target.alive) { this.won = true; return }
    if (this.rockets <= 0 && !this.missiles.some(m => m.alive))
      this.fail('OUT_OF_ROCKETS', '작전 실패 — 로켓 소진. 런 종료')
  }

  fail(reason, msg) { this.lost = true; this.runOver = true; this.failReason = reason; this.message = msg }

  setToast(text) { this.toast = text; this.toastT = 1.2 }

  get canAim() {
    return !this.won && !this.lost && this.rockets > 0 && this.earth.alive && !this.missiles.some(m => m.alive)
  }

  // 예측선 — 행성 이동까지 반영한 풀 시뮬 (기획서 §14.3의 "라플라스의 악마" 수준).
  // 실제 비행과 같은 적분기·같은 dt·같은 순서라 조준 중에는 정확히 그 궤적이 된다.
  // 조준 중에는 시간이 멈춰 있으므로 (조준각, 파워, 판 상태)가 그대로면 캐시가 유효하다.
  predictPath() {
    if (!this.canAim) return { pts: [], outcome: null, hit: null }
    const key = `${this.aim.toFixed(5)}|${this.power}|${this.stageIdx}|${this.time.toFixed(3)}|${this.rockets}|${this.bodies.length}`
    if (this._predKey === key) return this._pred
    // 풀 시뮬은 안테 8에서 ~9ms라 슬라이더를 끄는 동안 매 프레임 돌리면 프레임을 깎는다.
    // 정확도를 낮추는 대신 갱신 빈도를 20fps로 묶는다 — 경로 자체는 실제 비행과 동일하게 유지.
    const now = performance.now()
    if (this._pred && now - (this._predAt || 0) < 45) return this._pred
    this._predAt = now
    const sim = cloneBodies(this.bodies)
    const p = this.launchPos()
    const m = {
      pos: { ...p }, vel: fromAngle(this.aim, this.power), age: 0,
      pathN: 0, path: [], minSunDist: Infinity, prev: { ...p },
    }
    const pts = [{ ...p }]
    let outcome = 'timeout', hit = null
    const steps = Math.round(CFG.MISSILE_TTL / CFG.DT)
    for (let i = 0; i < steps; i++) {
      stepBodies(sim, CFG.DT)
      stepMissile(m, sim, CFG.DT)
      if (i % 6 === 0) pts.push({ x: m.pos.x, y: m.pos.y })
      let b = null
      for (const o of sim) {
        if (!o.alive) continue
        if (segHitsCircle(m.prev.x, m.prev.y, m.pos.x, m.pos.y, o.pos.x, o.pos.y, hitRadiusOf(o))) { b = o; break }
      }
      if (b) {
        pts.push({ x: m.pos.x, y: m.pos.y })
        // 명중 지점의 천체 위치 = "그때 그 행성이 있을 자리". 지금 위치가 아니다.
        hit = { name: b.name, isEarth: b.isEarth, type: b.type, id: b.id, x: b.pos.x, y: b.pos.y, r: hitRadiusOf(b) }
        outcome = b.type === 'debris' ? 'debris' : (b.id === this.target.id ? 'target' : (b.isEarth ? 'earth' : 'foul'))
        break
      }
      const r = Math.hypot(m.pos.x, m.pos.y)
      if (r < CFG.R_STAR + 8) { outcome = 'sun'; pts.push({ x: m.pos.x, y: m.pos.y }); break }
      if (r > 2.8 * this.aMax) { outcome = 'lost'; pts.push({ x: m.pos.x, y: m.pos.y }); break }
    }
    this._predKey = key
    this._pred = { pts, outcome, hit }
    return this._pred
  }
}
