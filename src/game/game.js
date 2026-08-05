import { fromAngle, len, sub, vec } from '../core/vector.js'
import { Rng } from '../core/random.js'
import { CFG } from './config.js'
import { applyHit, fieldAccel, resolveBodyPairs, shatter, stepBodies, stepMissile, updateEncounters } from './physics.js'
import { makeStage } from './stage.js'

export class Game {
  constructor(seed) {
    this.seed = seed >>> 0
    this.stageIdx = 0; this.runScore = 0; this.runOver = false
    this.rng = new Rng(this.seed ^ 0x9e3779b9)
    this.loadStage()
  }

  get ante() { return Math.min(8, 1 + Math.floor(this.stageIdx / 3)) }

  loadStage() {
    const s = makeStage((this.seed + this.stageIdx * 7919) >>> 0, this.ante)
    this.stage = s; this.bodies = s.bodies; this.earth = s.earth; this.target = s.target; this.aMax = s.aMax
    this.missiles = []; this.rockets = CFG.ROCKETS; this.diplomacy = 0; this.score = 0; this.chainLast = 0
    this.won = false; this.lost = false; this.failReason = null
    this.aim = Math.atan2(this.target.pos.y - this.earth.pos.y, this.target.pos.x - this.earth.pos.x)
    this.power = 82; this.observing = false; this.time = 0
    this.toast = null; this.toastT = 0
    this.message = `작전 개시 — ${this.target.name} 섬멸 (차폐도 B=${s.B.toFixed(1)}). 시간 정지 중: 관측(SHIFT)으로 판을 돌려라`
  }

  nextStage() {
    if (!this.won || this.runOver) return
    this.runScore += this.score; this.stageIdx++; this.loadStage()
  }

  legal(b) { return b === this.target }   // 섬멸전 LEGAL_HIT = {목표} (§5.3)

  launchPos() {
    const d = this.earth.radius + 8
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
    this.message = 'MISSILE AWAY — 행성 중력권으로 감아 치세요'
  }

  // 관제실 모드(§5.1): 조준 중 시간 정지, 관측 홀드 4×, 미사일 비행 중 1×
  effTimeScale() {
    if (this.lost) return 0
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
        swing: (b, deg) => { this.message = `${b.name} 스윙바이 ${deg.toFixed(0)}°! 체인 x${m.chain}` },
        capture: (b) => { this.resolveHit(m, b); this.setToast('포획됨 — 너무 느렸다 (강제 추락)') },   // §5.2
      })
      if (m.alive) this.contact(m)
      if (m.alive) this.missileBounds(m)
      if (!m.alive) this.finishShot(m)
    }
    resolveBodyPairs(this.bodies, this)
    this.bodyBounds()
    this.time += dt
    this.checkEnd()
  }

  contact(m) {
    for (const b of this.bodies)
      if (b.alive && len(sub(m.pos, b.pos)) < b.radius) { this.resolveHit(m, b); return }
  }

  resolveHit(m, b) {
    m.alive = false
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
    shatter(b, this.bodies, () => this.rng.next())
    if (b === this.target) { this.won = true; this.message = '조르그 행성 말살 완료! — 연구비 정산' }
  }

  missileBounds(m) {   // §7.8
    const r = len(m.pos)
    if (r < CFG.R_STAR + 8) { m.alive = false; m.out = 'sun' }
    else if (r > 2.8 * this.aMax) { m.alive = false; m.out = 'lost' }
    else if (m.age > 45) { m.alive = false; m.out = 'timeout' }
  }

  bodyBounds() {   // §7.8 항성 처분 / 행성 추방 — 정식 킬
    for (const b of this.bodies) {
      if (!b.alive) continue
      const r = len(b.pos)
      if (r < CFG.R_STAR + 15) {
        b.alive = false
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

  checkEnd() {   // §16 실패 3종: 로켓 소진 / 지구 상실 / 외교 3
    if (this.won || this.lost) return
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

  // §5.1 예측선 3초 — "현재 중력장 프리즈" 근사 (의도적으로 부정확)
  predict() {
    if (!this.canAim) return []
    const pts = [], p = this.launchPos(), v = fromAngle(this.aim, this.power), a = vec(), dt = 1 / 60
    for (let i = 0; i < 180; i++) {
      fieldAccel(p.x, p.y, this.bodies, a)
      v.x += a.x * dt; v.y += a.y * dt; p.x += v.x * dt; p.y += v.y * dt
      pts.push({ x: p.x, y: p.y })
      if (Math.hypot(p.x, p.y) < CFG.R_STAR) break
      let hit = false
      for (const b of this.bodies) if (b.alive && b !== this.earth && len(sub(p, b.pos)) < b.radius) { hit = true; break }
      if (hit) break
    }
    return pts
  }
}
