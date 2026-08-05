import { CFG, hpOf, radiusOf } from './config.js'
import { clone, len, sub, vec } from '../core/vector.js'

// ─── T1-1: N체 가속도 — 태양(원점 고정) + 행성 상호작용 (§4.2) ───
function accelOn(i, bodies, out) {
  const bi = bodies[i]; let dx = -bi.pos.x, dy = -bi.pos.y
  let d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS, inv = CFG.MU_STAR / (d2 * Math.sqrt(d2))
  out.x = dx * inv; out.y = dy * inv
  for (let j = 0; j < bodies.length; j++) if (j !== i && bodies[j].alive) {
    const bj = bodies[j]; dx = bj.pos.x - bi.pos.x; dy = bj.pos.y - bi.pos.y
    d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS; inv = bj.mu / (d2 * Math.sqrt(d2))
    out.x += dx * inv; out.y += dy * inv
  }
}

// ─── T1-2: KDK 리프프로그 (§4.4). 트레일은 최근 20초 잔상(§14.2) ───
let _frame = 0
export function stepBodies(bodies, dt) {
  const acc = bodies.map(() => vec()), h = dt / 2
  bodies.forEach((b, i) => { if (!b.alive) return; accelOn(i, bodies, acc[i]); b.vel.x += acc[i].x * h; b.vel.y += acc[i].y * h })
  _frame++
  bodies.forEach(b => {
    if (!b.alive) return
    b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt
    b.hitFlash = Math.max(0, b.hitFlash - dt); b.trailFlash = Math.max(0, (b.trailFlash || 0) - dt)
    if (b.trail && _frame % 8 === 0 && b.trail.push(clone(b.pos)) > 300) b.trail.shift()
  })
  bodies.forEach((b, i) => { if (!b.alive) return; accelOn(i, bodies, acc[i]); b.vel.x += acc[i].x * h; b.vel.y += acc[i].y * h })
}

// ─── T1-3: 미사일 중력장 — 행성은 κ, 태양은 κ★ 배율 (§4.3). 예측선과 공용 ───
// κ★는 기획서 원본의 "태양 κ=1"을 노브로 뺀 것. 태양이 미사일을 지나치게
// 빨아들여 행성 곁을 그냥 스쳐 지나가던 문제(R1)를 잡는 용도이며,
// 행성끼리의 상호작용(accelOn)은 여전히 진짜 물리 κ=1이라 세계는 왜곡되지 않는다.
export function fieldAccel(px, py, bodies, out) {
  let dx = -px, dy = -py
  let d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS, inv = CFG.KAPPA_STAR * CFG.MU_STAR / (d2 * Math.sqrt(d2))
  out.x = dx * inv; out.y = dy * inv
  for (const b of bodies) if (b.alive) {
    dx = b.pos.x - px; dy = b.pos.y - py
    d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS; inv = CFG.KAPPA * b.mu / (d2 * Math.sqrt(d2))
    out.x += dx * inv; out.y += dy * inv
  }
}

// 선분(직전 위치→현재 위치)이 원과 겹치는지. 점 판정만 하면 빠른 미사일이
// 행성 디스크를 한 스텝에 건너뛰어 "닿고도 통과"가 난다.
export function segHitsCircle(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax, dy = by - ay
  const fx = ax - cx, fy = ay - cy
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? -(fx * dx + fy * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const px = fx + dx * t, py = fy + dy * t
  return px * px + py * py < r * r
}

export function stepMissile(m, bodies, dt) {
  m.prev = { x: m.pos.x, y: m.pos.y }   // 스윕 판정용 직전 위치
  let n = 1
  for (const b of bodies) if (b.alive && len(sub(b.pos, m.pos)) < CFG.SUBSTEP_DIST * b.radius) { n = CFG.SUBSTEP_N; break }
  const a = vec(), sd = dt / n
  for (let s = 0; s < n; s++) {
    fieldAccel(m.pos.x, m.pos.y, bodies, a)
    m.vel.x += a.x * sd / 2; m.vel.y += a.y * sd / 2
    m.pos.x += m.vel.x * sd; m.pos.y += m.vel.y * sd
    fieldAccel(m.pos.x, m.pos.y, bodies, a)
    m.vel.x += a.x * sd / 2; m.vel.y += a.y * sd / 2
  }
  m.age += dt
  m.minSunDist = Math.min(m.minSunDist, len(m.pos))   // 태양 가속 보너스 판정용 (§9.1)
  if (++m.pathN % 3 === 0 && m.path.push(clone(m.pos)) > 1600) m.path.shift()
}

// ─── T1-4: 인카운터 트래커 (§5.2/5.4) — 진입/이탈 굴절각, 니어미스, 포획 ───
export function updateEncounters(m, bodies, ev) {
  for (const b of bodies) {
    if (!b.alive || b.type === 'debris') continue
    const dx = m.pos.x - b.pos.x, dy = m.pos.y - b.pos.y, d = Math.hypot(dx, dy)
    const zone = CFG.SWING_ZONE * b.radius
    const enc = m.enc.get(b.id)
    if (d < zone) {
      const ang = Math.atan2(dy, dx)
      if (!enc) m.enc.set(b.id, { vIn: { ...m.vel }, dMin: d, wrap: 0, lastAngle: ang })
      else {
        enc.dMin = Math.min(enc.dMin, d)
        let dA = ang - enc.lastAngle
        while (dA > Math.PI) dA -= 2 * Math.PI
        while (dA < -Math.PI) dA += 2 * Math.PI
        enc.wrap += Math.abs(dA) / (2 * Math.PI); enc.lastAngle = ang
        if (enc.wrap >= CFG.CAPTURE_WRAP) { m.enc.delete(b.id); ev.capture(b); return }   // 포획 → 강제 추락
      }
    } else if (enc) {
      m.encountered = true
      const dot = enc.vIn.x * m.vel.x + enc.vIn.y * m.vel.y
      const den = (Math.hypot(enc.vIn.x, enc.vIn.y) * Math.hypot(m.vel.x, m.vel.y)) || 1
      const deg = Math.acos(Math.max(-1, Math.min(1, dot / den))) * 180 / Math.PI
      m.bestDeflection = Math.max(m.bestDeflection, deg)
      if (enc.dMin < CFG.NEAR_MISS * b.radius) m.nearMiss++
      if (deg >= CFG.SWING_DEG) { m.chain++; ev.swing(b, deg) }
      m.enc.delete(b.id)
    }
  }
}

// ─── T1-5/6: 데미지 + 임펄스 (§6.1, §6.2) ───
export function applyHit(m, b) {
  const v = len(m.vel)
  const dmg = m.power * (0.5 + 0.5 * Math.min(v / 120, 2)) * (1 + 0.2 * m.chain)
  b.hp -= dmg; b.hitFlash = 0.6
  b.textureState = Math.max(0, Math.min(3, Math.floor((1 - b.hp / b.hpMax) * 4)))
  let dx = 0.7 * m.vel.x / (v || 1) + 0.3 * (b.pos.x - m.pos.x), dy = 0.7 * m.vel.y / (v || 1) + 0.3 * (b.pos.y - m.pos.y)
  const dl = Math.hypot(dx, dy) || 1
  const dv = 75 * m.power / b.mu
  b.vel.x += dx / dl * dv; b.vel.y += dy / dl * dv
  b.trailFlash = 1.5   // P4: "내가 민 것" 트레일 강조
  return dmg
}

// ─── 파편 생성 (§6.1): n = clamp(4+⌊μ/150⌋, 4, 9), 총질량 55% ───
export function shatter(b, bodies, rnd) {
  b.alive = false
  const n = Math.max(4, Math.min(9, 4 + Math.floor(b.mu / 150)))
  const muF = 0.55 * b.mu / n
  if (muF < 8) return   // 너무 작은 부스러기는 증발 처리
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * 2 * Math.PI + (rnd() - 0.5), sp = 25 + 40 * rnd()
    bodies.push({
      id: `${b.id}f${bodies.length}`, name: '파편', mu: muF, radius: Math.max(2.5, radiusOf(muF)),
      pos: { x: b.pos.x + Math.cos(ang) * b.radius * 1.3, y: b.pos.y + Math.sin(ang) * b.radius * 1.3 },
      vel: { x: b.vel.x + Math.cos(ang) * sp, y: b.vel.y + Math.sin(ang) * sp },
      hp: 5, hpMax: 5, type: 'debris', isEarth: false, alive: true, trail: [], hitFlash: 0, trailFlash: 0, textureState: 0,
    })
  }
}

// ─── T1-7: 행성↔행성 충돌 — 파쇄 문턱 v_shatter (§6.3) + 합성표 (§11) ───
export function resolveBodyPairs(bodies, game) {
  const n = bodies.length
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = bodies[i], b = bodies[j]
    if (!a || !b || !a.alive || !b.alive) continue
    const aD = a.type === 'debris', bD = b.type === 'debris'
    if (aD && bD) continue
    if (len(sub(a.pos, b.pos)) >= 0.9 * (a.radius + b.radius)) continue
    if (aD || bD) {
      const deb = aD ? a : b, pl = aD ? b : a
      if (pl.isEarth) {   // 파편 스침 → 지구 HP −1 (§5.3)
        deb.alive = false; pl.hp -= 1; pl.hitFlash = 0.8
        game.message = `파편이 지구를 스침 — 지구 HP ${Math.max(0, pl.hp)}`
        if (pl.hp <= 0) pl.alive = false
      }
      continue   // 일반 행성은 파편을 그냥 흡수하지 않음 (파편은 미사일 해저드)
    }
    if (a.isEarth || b.isEarth) {
      const e = a.isEarth ? a : b
      e.hp = 0; e.alive = false; game.message = '행성이 지구와 충돌…'
      continue
    }
    collideBodies(a, b, game)
    return   // 한 스텝에 하나의 대형 충돌만 정산 (파편 생성으로 배열이 변함)
  }
}

function collideBodies(a, b, game) {
  const rnd = () => game.rng.next()
  const vRel = Math.hypot(a.vel.x - b.vel.x, a.vel.y - b.vel.y)
  const vShatter = 2.5 * Math.sqrt(2 * (a.mu + b.mu) / (a.radius + b.radius))
  const wasTarget = a === game.target || b === game.target
  if (vRel >= vShatter) {
    game.message = `${a.name} ✕ ${b.name} — 고속 충돌 개박살 (v ${vRel.toFixed(0)} ≥ 문턱 ${vShatter.toFixed(0)})`
    shatter(a, game.bodies, rnd); shatter(b, game.bodies, rnd)
    if (wasTarget) { game.won = true; game.score += 20; game.message += ' — 목표 파괴!' }
    return
  }
  fuse(a, b, game)
}

const pairKey = (a, b) => [a, b].sort().join('+')
const RECIPES = {
  'ice+lava': { type: 'rock', note: '수증기 폭발!', steam: true },
  'lava+ocean': { type: 'rock', note: '온천 행성 (+20)', score: 20 },
  'ocean+toxic': { type: 'life', note: '생명 행성 탄생! (+50)', score: 50 },
  'rock+rock': { type: 'iron', note: '철 행성 — 최고의 당구공 (HP×2)', iron: true },
}

function fuse(a, b, game) {
  const rnd = () => game.rng.next()
  const t1 = a.type, t2 = b.type, key = pairKey(t1, t2)
  const wasTarget = a === game.target || b === game.target
  if (t1 === 'life' || t2 === 'life') {   // 생명 + 아무거나 → 파쇄 강제 + 외교 ("그건 좀…")
    game.diplomacy++
    game.message = `생명 행성이 부서졌다… 외교 ${Math.min(CFG.DIPLO_MAX, game.diplomacy)}/3 ("그건 좀…")`
    shatter(a, game.bodies, rnd); shatter(b, game.bodies, rnd)
    if (wasTarget) { game.won = true; game.score += 20 }
    return
  }
  if (key === 'ice+ice') {   // 얼음+얼음 → 혜성 파편 다수
    game.message = '얼음 충돌 — 혜성 파편 산개'
    shatter(a, game.bodies, rnd); shatter(b, game.bodies, rnd)
    if (wasTarget) { game.won = true; game.score += 20 }
    return
  }
  let base = a.mu >= b.mu ? a : b
  if (t1 === 'gas' || t2 === 'gas') base = t1 === 'gas' ? a : b   // 가스 + 아무거나 → 가스가 흡수·성장
  const other = base === a ? b : a
  const mu = a.mu + b.mu
  base.pos = { x: (a.pos.x * a.mu + b.pos.x * b.mu) / mu, y: (a.pos.y * a.mu + b.pos.y * b.mu) / mu }
  base.vel = { x: (a.vel.x * a.mu + b.vel.x * b.mu) / mu, y: (a.vel.y * a.mu + b.vel.y * b.mu) / mu }
  base.mu = mu; base.radius = radiusOf(mu); base.textureState = 0; base.trailFlash = 1.5
  other.alive = false
  const r = RECIPES[key]
  if (r) base.type = r.type
  else if (t1 === 'gas' || t2 === 'gas') base.type = 'gas'
  base.hpMax = hpOf(mu) * (r && r.iron ? 2 : 1); base.hp = base.hpMax
  if (r && r.score) game.score += r.score
  game.message = `합성: ${t1}+${t2} → ${base.type}${r ? ' — ' + r.note : ''}`
  if (r && r.steam) for (const o of game.bodies) {   // 반경 300 전방위 Δv 3
    if (!o.alive || o === base) continue
    const d = sub(o.pos, base.pos), l = len(d)
    if (l > 300 || l === 0) continue
    o.vel.x += d.x / l * 3; o.vel.y += d.y / l * 3; o.trailFlash = 1.5
  }
  if (other === game.target) { game.target = base; game.message += ' — 목표가 합성체가 됐다' }
}

export function cloneBodies(bodies) { return bodies.map(b => ({ ...b, pos: clone(b.pos), vel: clone(b.vel), trail: null })) }
