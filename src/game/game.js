import { fromAngle, len } from '../core/vector.js'
import { Rng } from '../core/random.js'
import { CFG, blastRadius, hitRadiusOf, radiusOf } from './config.js'
import {
  applyNuke, blastWave, cloneBodies, resolveBodyPairs, segCircleEntry, segHitsCircle,
  shatter, stepBodies, stepMissile, updateEncounters,
} from './physics.js'
import { effDv, roleOf, volatileRadius } from './roles.js'
import { makeStage } from './stage.js'

// 파괴 사유별 점수 (목표 / 중립)
const KILL_SCORE = {
  collision: [120, 40],
  absorb: [110, 35],
  sun: [100, 30],
  exile: [90, 25],
  blast: [80, 25],
}
const CAUSE_KO = {
  collision: '충돌 파괴', absorb: '특이점 흡수', sun: '항성 처분',
  exile: '성계 추방', blast: '유폭',
}

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
    const s = makeStage((this.seed + this.stageIdx * 7919) >>> 0, this.ante, this.stageIdx)
    this.stage = s; this.bodies = s.bodies; this.earth = s.earth
    this.targets = s.targets; this.aMax = s.aMax; this.goal = s.goal
    this.missiles = []; this.rockets = CFG.ROCKETS; this.score = 0; this.chainLast = 0
    this.won = false; this.lost = false; this.failReason = null
    this.aim = Math.atan2(s.target.pos.y - this.earth.pos.y, s.target.pos.x - this.earth.pos.x)
    this.power = 30; this.yieldMt = CFG.YIELD_DEFAULT
    this.observing = false; this.time = 0
    this.toast = null; this.toastT = 0
    this.fx = []   // 렌더러가 매 프레임 비워가는 연출 이벤트 큐 (§14.5)
    this.winBanked = false; this.timeWarn = 0
    this.message = `작전 개시 — ${this.goal.title}. ${this.goal.rule}`
  }

  nextStage() {
    if (!this.won || this.runOver) return
    this.runScore += this.score; this.stageIdx++; this.loadStage()
  }

  // 목표 행성 — 살아 있는 것 우선. 카메라/레티클이 물고 있을 대상이다.
  get target() { return this.targets.find(t => t.alive) || this.targets[0] }
  // id로 비교한다 — 예측선은 cloneBodies()가 만든 복제본을 넘기므로
  // 참조 비교를 쓰면 "예측에서는 목표가 목표가 아닌" 사고가 난다.
  isTarget(b) { return this.targets.some(t => t.id === b.id) }
  get aliveTargets() { return this.targets.filter(t => t.alive).length }
  // 특이점은 부술 수 없으니 "남은 재료"에서 뺀다 (연쇄 충돌 목표의 달성 가능성 판정용)
  get alivePlanets() {
    return this.bodies.filter(b => b.alive && !b.isEarth && b.type !== 'debris' && b.role !== 'void').length
  }

  launchPos() {
    const d = CFG.LAUNCH_OFFSET   // 지구 중력권 밖에서 발사 (§4.3 κ 증폭 때문)
    return { x: this.earth.pos.x + Math.cos(this.aim) * d, y: this.earth.pos.y + Math.sin(this.aim) * d }
  }

  fire() {
    if (this.won || this.lost || this.rockets <= 0 || !this.earth.alive) return
    if (this.missiles.some(m => m.alive)) return
    const p = this.launchPos(), v = fromAngle(this.aim, this.power)
    this.missiles.push({
      pos: { ...p }, vel: v, yld: this.yieldMt, alive: true, chain: 0, nearMiss: 0, age: 0,
      path: [{ ...p }], pathN: 0, enc: new Map(), bestDeflection: 0,
      encountered: false, minSunDist: Infinity, hit: null, out: null,
    })
    this.rockets--
    this.addFx({ kind: 'launch', x: p.x, y: p.y, a: this.aim })
    this.message = `MISSILE AWAY — ${this.yieldMt}Mt 탄두. 어느 살을 치느냐가 전부다`
  }

  addFx(e) { if (this.fx.length < 96) this.fx.push(e) }

  // 관제실 모드(§5.1): 조준 중 시간 정지, 관측 홀드 4×, 미사일 비행 중 1×.
  // 전탄 소진 후엔 자동 진행 — 당구는 큐를 놓은 뒤가 본편이라 멈춰 있으면 안 된다.
  // ※ 배속은 "실제로 기다리는 시간"만 줄인다. 작전 시한은 인게임 초 단위라
  //    몇 배속으로 보든 소모량이 같다 — 전탄 소진 후 4분을 멍하니 보는 걸
  //    막으려고 배속만 올렸지, 난이도는 건드리지 않았다.
  effTimeScale() {
    if (this.lost || this.won) return 0   // 클리어 후에는 시계를 세운다
    if (this.missiles.some(m => m.alive)) return this.observing ? 4 : 1
    if (this.rockets <= 0) return this.observing ? 8 : 2
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

    if (b.role === 'shield') {   // 방어막 — 임펄스도 폭풍도 없이 통째로 삼킨다
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius, shield: true })
      b.hitFlash = 0.6
      this.message = `${b.name} 방어막이 핵을 삼켰다 — 직격은 무효다`
      this.setToast('방어막 — 중립 행성을 큐볼로 써라')
      return
    }

    // 임펄스: 입사각·속도 무시. 폭심의 상대 위치만 본다.
    const push = applyNuke(b, point.x, point.y, yld)
    const wave = blastWave(this.bodies, point.x, point.y, yld, b)
    this.addFx({
      kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius,
      px: push.dx, py: push.dy, wave: wave.radius, armor: b.role === 'armor',
    })

    // §9.1 스타일 배율 — 체인/니어미스/태양 가속은 여전히 점수에 얹힌다
    const M = 1 + 0.75 * m.chain + 0.25 * m.nearMiss + (m.minSunDist < CFG.SUN_BONUS_R ? 0.5 : 0)
    const gained = m.hostile ? 0 : Math.round(8 * M)
    this.score += gained; this.chainLast = m.chain
    this.message = `${b.name} 타격 — Δv ${push.dv.toFixed(1)} · 방위 ${degOf(push.dx, push.dy)}°`
      + (b.role === 'armor' ? ' (장갑에 막혀 거의 안 밀렸다)' : gained ? ` (+${gained})` : '')
    // 폭풍이 지구를 정통으로 훑었다면 경고 — 지구가 밀려 태양에 빠지는 사고가 실제로 난다
    if (wave.pushed.some(p => p.body.isEarth)) this.setToast('경고 — 폭풍이 지구를 밀었다')
    // 요새 — 때린 쪽으로 반격탄을 되쏜다. 그 탄도 행성을 미는 큐다.
    if (b.role === 'battery') this.retaliate(b, point, push)
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
    this.missiles.push({
      pos: p, vel: { x: dx * CFG.BATTERY_SPEED + b.vel.x, y: dy * CFG.BATTERY_SPEED + b.vel.y },
      yld: CFG.BATTERY_YIELD, alive: true, hostile: true, chain: 0, nearMiss: 0, age: 0,
      path: [{ ...p }], pathN: 0, enc: new Map(), bestDeflection: 0,
      encountered: false, minSunDist: Infinity, hit: null, out: null,
    })
    this.addFx({ kind: 'launch', x: p.x, y: p.y, a: Math.atan2(dy, dx), hostile: true })
    this.setToast(`${b.name} 반격! — 되날아오는 탄도 행성을 민다`)
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

  // ─── 행성끼리의 충돌 = 폭파 (유일한 파괴 수단) ────────────────
  onPlanetCollision(a, b) {
    if (a.isEarth || b.isEarth) {
      const e = a.isEarth ? a : b, o = a.isEarth ? b : a
      this.addFx({ kind: 'destroy', x: e.pos.x, y: e.pos.y, r: e.radius * 2, earth: true })
      e.alive = false; o.alive = false
      this.fail('EARTH_LOST', `${o.name}이(가) 지구에 처박혔다. 작전 종료.`)
      return
    }
    // 특이점 — 상대만 삼킨다. 특이점끼리 만나면 큰 쪽이 작은 쪽을 먹는다.
    if (a.role === 'void' || b.role === 'void') {
      const hole = a.role === 'void' && (b.role !== 'void' || a.mu >= b.mu) ? a : b
      this.absorb(hole, hole === a ? b : a)
      return
    }
    // 휘발성 — 부딪혀도 유폭한다. 연쇄를 노릴 수 있는 자리.
    if (a.role === 'volatile' || b.role === 'volatile') {
      const vol = a.role === 'volatile' ? a : b, other = vol === a ? b : a
      this.message = `${vol.name} ✕ ${other.name} — 충돌 유폭!`
      this.killBody(other, 'collision', { fx: true })
      this.volatileBlast(vol)
      return
    }
    const vRel = Math.hypot(a.vel.x - b.vel.x, a.vel.y - b.vel.y)
    const cx = (a.pos.x + b.pos.x) / 2, cy = (a.pos.y + b.pos.y) / 2
    this.addFx({ kind: 'destroy', x: cx, y: cy, r: (a.radius + b.radius) * 1.1, big: true })
    this.message = `${a.name} ✕ ${b.name} — 정면 충돌, 상대속도 ${vRel.toFixed(0)}`
    this.killBody(a, 'collision', { fx: false })
    this.killBody(b, 'collision', { fx: false })
  }

  killBody(b, cause, { fx = true, shatterIt = cause === 'collision' } = {}) {
    if (!b.alive) return
    b.alive = false
    if (fx && b.type !== 'debris') this.addFx({ kind: cause === 'sun' ? 'sun' : 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius })
    if (shatterIt) shatter(b, this.bodies, () => this.rng.next())
    this.recordKill(b, cause)
  }

  recordKill(b, cause) {
    if (b.type === 'debris') return
    const isTarget = this.isTarget(b)
    const [tp, np] = KILL_SCORE[cause] ?? [0, 0]
    const gained = isTarget ? tp : np
    this.score += gained
    const ev = { body: b, isTarget, cause }
    const counted = this.goal.record(ev)
    const label = `${b.name} — ${CAUSE_KO[cause]} (+${gained})`
    if (counted) {
      this.message = `${label} · 목표 ${this.goal.done}/${this.goal.need}`
      this.setToast(`${CAUSE_KO[cause]} 확인 — ${this.goal.label()}`)
    } else if (this.goal.wasted(ev)) {
      this.message = `${label} — 하지만 요구된 방식이 아니다 (${this.goal.title})`
      this.setToast(`목표를 낭비했다 — ${this.goal.title} 조건 불충족`)
    } else {
      this.message = label
    }
    if (this.goal.done >= this.goal.need) this.win()
  }

  win() {
    if (this.won || this.lost) return
    this.won = true
    this.message = `작전 성공 — ${this.goal.title} 달성. 연구비 정산`
    this.setToast('작전 성공')
  }

  missileBounds(m) {   // §7.8
    const r = len(m.pos)
    if (r < CFG.R_STAR + 8) { m.alive = false; m.out = 'sun' }
    else if (r > 2.8 * this.aMax) { m.alive = false; m.out = 'lost' }
    else if (m.age > CFG.MISSILE_TTL) { m.alive = false; m.out = 'timeout' }
  }

  bodyBounds() {   // §7.8 항성 처분 / 행성 추방 — 정식 파괴 수단 2·3번
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
      } else if (r > 2.6 * this.aMax) {
        if (b.isEarth) {
          b.alive = false
          this.fail('EARTH_LOST', '지구가 성계를 이탈했다. 작전 종료.')
          return
        }
        this.addFx({ kind: 'exile', x: b.pos.x, y: b.pos.y, r: b.radius })
        this.killBody(b, 'exile', { fx: false, shatterIt: false })
      }
    }
  }

  // §14.4 실패 피드백 — 빗나간 샷마다 원인 태그 1개
  finishShot(m) {
    if (m.hit) return
    if (m.hostile) { this.setToast('반격탄 소멸'); return }   // 내 탓이 아니다
    let tag
    if (m.out === 'lost') tag = '유실 — 성계 이탈 (파워 과다)'
    else if (m.out === 'sun') tag = '태양 소멸 — 근일점이 너무 낮다'
    else if (m.encountered && m.bestDeflection < 10) tag = `속도 초과 — 통과만 함 (δ ${m.bestDeflection.toFixed(0)}°)`
    else if (m.bestDeflection < CFG.SWING_DEG) tag = `굴절 부족 — ${m.bestDeflection.toFixed(0)}° / ${CFG.SWING_DEG}° 필요`
    else tag = '타이밍 — 공이 지나갔다'
    this.setToast(tag); this.message = tag
  }

  checkEnd() {
    if (this.won && !this.winBanked) {   // 클리어 시점의 남은 시간을 보너스로 정산
      this.winBanked = true
      const b = this.timeBonus
      if (b > 0) { this.score += b; this.message += ` · 시간 보너스 +${b}` }
    }
    if (this.won || this.lost) return
    if (!this.earth.alive) { this.fail('EARTH_LOST', '작전 실패 — 지구 상실. 런 종료'); return }
    // 재료가 다 떨어졌다 — 남은 시간을 흘려봐야 목표를 채울 수 없다
    if (!this.goal.reachable(this.aliveTargets, this.alivePlanets)) {
      this.fail('GOAL_LOST', `작전 실패 — ${this.goal.title} 조건을 채울 표적이 남지 않았다. 런 종료`)
      return
    }
    // 시한 초과 — 날아가고 있는 마지막 한 발은 끝까지 보내준다
    if (this.time >= this.stageTime && !this.missiles.some(m => m.alive))
      this.fail('TIME_UP', '작전 실패 — 작전 시한 초과. 조르그가 회랑을 재정비했다. 런 종료')
  }

  fail(reason, msg) {
    if (this.lost) return
    this.lost = true; this.runOver = true; this.failReason = reason; this.message = msg
  }

  setToast(text) { this.toast = text; this.toastT = 1.6 }

  get canAim() {
    return !this.won && !this.lost && this.rockets > 0 && this.earth.alive && !this.missiles.some(m => m.alive)
  }

  // ─── 조준 보조 (§14.3 개정) ─────────────────────────────────
  // "공을 쳐서 뭔 일이 날지"는 알려주지 않는다. 알려주는 건 딱 두 가지:
  //   ① 핵이 어디에 닿는가 (= 어느 살을 치는가)
  //   ② 그 결과 공이 어느 방향으로 얼마나 밀려나기 시작하는가
  // 그 뒤 판이 어떻게 굴러갈지는 플레이어가 읽어야 한다.
  predictPath() {
    if (!this.canAim) return EMPTY_PRED
    const key = `${this.aim.toFixed(5)}|${this.power}|${this.yieldMt}|${this.stageIdx}|${this.time.toFixed(3)}|${this.rockets}|${this.bodies.length}`
    if (this._predKey === key) return this._pred
    const now = performance.now()
    if (this._pred && now - (this._predAt || 0) < 45) return this._pred
    this._predAt = now

    const sim = cloneBodies(this.bodies)
    const p = this.launchPos()
    const m = { pos: { ...p }, vel: fromAngle(this.aim, this.power), age: 0, pathN: 0, path: [], minSunDist: Infinity, prev: { ...p } }
    const pts = [{ ...p }]
    let outcome = 'timeout', hit = null
    const steps = Math.round(CFG.MISSILE_TTL / CFG.DT)
    for (let i = 0; i < steps; i++) {
      stepBodies(sim, CFG.DT)
      stepMissile(m, sim, CFG.DT)
      if (i % 6 === 0) pts.push({ x: m.pos.x, y: m.pos.y })
      let bodyHit = null, point = null, bestD = Infinity
      for (const o of sim) {
        if (!o.alive) continue
        const r = hitRadiusOf(o)
        if (!segHitsCircle(m.prev.x, m.prev.y, m.pos.x, m.pos.y, o.pos.x, o.pos.y, r)) continue
        const q = segCircleEntry(m.prev.x, m.prev.y, m.pos.x, m.pos.y, o.pos.x, o.pos.y, r)
        const d = Math.hypot(q.x - m.prev.x, q.y - m.prev.y)
        if (d < bestD) { bestD = d; bodyHit = o; point = q }
      }
      if (bodyHit) {
        pts.push({ x: point.x, y: point.y })
        hit = this.impactInfo(bodyHit, point, sim.find(o => o.isEarth))
        outcome = hit.outcome
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

  // ─── 접촉각 탐색 (§14.3) ────────────────────────────────────
  // 계측 결과 360° 중 뭔가에 닿는 각도가 99칸뿐이고, 그중 67칸이 지구였다.
  // 즉 슬라이더를 돌리는 시간의 대부분이 "여긴 아님"을 확인하는 데 쓰인다.
  // 기획 의도가 "어느 각도에서 칠 수 있는지는 알려준다"이므로, 그 확인을
  // 버튼 한 번으로 대신한다. **어느 공을 어느 살로 칠지는 여전히 플레이어 몫**이다.
  // 거친 적분(dt 1/40)으로 훑고, 찾은 각도는 다음 프레임에 정식 예측이 확정한다.
  // 한 번 누를 때마다 "다음 선택지"로 간다 — 지금 물고 있는 구간을 먼저 빠져나온
  // 다음에 찾는다. 같은 구간 안에서의 미세 조정은 방향키(±0.5~2°)가 맡는다.
  scanContact(dir = 1) {
    if (!this.canAim) return false
    const step = dir * Math.PI / 180
    const ok = (h) => h && h !== 'earth' && h !== 'debris'
    let i = 1
    if (ok(this.coarseContact(this.aim))) {          // 이미 맞고 있으면 그 구간을 통과
      while (i <= 360 && ok(this.coarseContact(this.aim + step * i))) i++
    }
    for (; i <= 360; i++) {
      const ang = this.aim + step * i
      if (!ok(this.coarseContact(ang))) continue
      this.aim = Math.atan2(Math.sin(ang), Math.cos(ang))
      this._predKey = null; this._predAt = 0
      return true
    }
    this.setToast('이 발사 속도로는 닿는 각도가 없다 — 속도를 바꿔라')
    return false
  }

  // 거친 접촉 판정 — 무엇에 닿는지만 본다(폭심·임펄스는 계산하지 않는다)
  coarseContact(ang) {
    const sim = cloneBodies(this.bodies)
    const dt = 1 / 40
    const p = { x: this.earth.pos.x + Math.cos(ang) * CFG.LAUNCH_OFFSET, y: this.earth.pos.y + Math.sin(ang) * CFG.LAUNCH_OFFSET }
    const m = { pos: { ...p }, vel: fromAngle(ang, this.power), age: 0, pathN: 0, path: [], minSunDist: Infinity, prev: { ...p } }
    const steps = Math.round(CFG.MISSILE_TTL / dt)
    for (let i = 0; i < steps; i++) {
      stepBodies(sim, dt)
      stepMissile(m, sim, dt)
      for (const o of sim) {
        if (!o.alive) continue
        if (!segHitsCircle(m.prev.x, m.prev.y, m.pos.x, m.pos.y, o.pos.x, o.pos.y, hitRadiusOf(o))) continue
        if (o.type === 'debris') return 'debris'
        if (o.isEarth) return 'earth'
        return 'body'
      }
      const r = Math.hypot(m.pos.x, m.pos.y)
      if (r < CFG.R_STAR + 8 || r > 2.8 * this.aMax) return null
    }
    return null
  }

  // 충돌 한 건의 "큐 정보" — 폭심, 임펄스 방향, 타격 직후 공의 진로
  impactInfo(o, point, simEarth) {
    const isT = this.isTarget(o)
    const shielded = o.role === 'shield'
    let outcome = 'neutral'
    if (o.type === 'debris') outcome = 'debris'
    else if (o.isEarth) outcome = 'earth'
    else if (o.role === 'void') outcome = 'void'
    else if (shielded) outcome = 'shield'
    else if (o.role === 'volatile') outcome = 'volatile'
    else if (isT) outcome = 'target'
    let dx = o.pos.x - point.x, dy = o.pos.y - point.y
    const d = Math.hypot(dx, dy) || 1
    dx /= d; dy /= d
    const dv = o.type === 'debris' || o.isEarth || shielded || o.role === 'volatile'
      ? 0 : effDv(o, this.yieldMt)
    const R = blastRadius(this.yieldMt)
    // 큰 탄두는 폭풍이 지구까지 닿는다 — 쏘기 전에 그것만은 알려준다
    const earthInBlast = !!simEarth && !o.isEarth &&
      Math.hypot(simEarth.pos.x - point.x, simEarth.pos.y - point.y) < R
    // 때린 직후의 속도가 그 자리의 탈출속도를 넘는지 — "세게 치면 날아간다"는
    // 큐의 세기에 대한 정보지 판의 결말이 아니다. 작약량을 고르는 유일한 근거.
    const vAfter = Math.hypot(o.vel.x + dx * dv, o.vel.y + dy * dv)
    const vEsc = Math.sqrt(2 * CFG.MU_STAR / Math.max(1, Math.hypot(o.pos.x, o.pos.y)))
    return {
      name: o.name, isEarth: o.isEarth, isTarget: isT, type: o.type, id: o.id,
      outcome, x: o.pos.x, y: o.pos.y, r: hitRadiusOf(o),
      px: point.x, py: point.y,            // 폭심 (공의 어느 살인가)
      dx, dy, dv,                          // 임펄스 방향/크기
      vx: o.vel.x + dx * dv, vy: o.vel.y + dy * dv,   // 타격 직후 공의 속도
      blast: R, earthInBlast, vAfter, vEsc, willEject: dv > 0 && vAfter > vEsc,
      role: o.role ?? null,
      // 요새를 치면 임펄스의 정반대로 반격탄이 나온다 — 그것까지가 "이 한 방"의 정보다.
      // 단 방어막에 삼켜지는 샷은 기폭 자체가 없으므로 반격도 없다(detonate가 먼저 리턴).
      counter: o.role === 'battery' && (o.ammo ?? 0) > 0 && !shielded && !o.isEarth && o.type !== 'debris',
      volatileR: o.role === 'volatile' ? volatileRadius(o) : 0,
    }
  }
}

const EMPTY_PRED = { pts: [], outcome: null, hit: null }
const degOf = (x, y) => (((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360).toFixed(0)
