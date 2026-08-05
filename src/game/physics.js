import { CFG, blastRadius, contactDist, nukeDv, radiusOf } from './config.js'
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

// 원에 "처음 닿는" 지점 — 폭심이다. 어느 쪽 살을 쳤는지가 곧 임펄스 방향이라
// 스텝 끝 위치(행성 속이나 반대편일 수 있다)를 그대로 쓰면 안 된다.
export function segCircleEntry(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax, dy = by - ay
  const fx = ax - cx, fy = ay - cy
  const a = dx * dx + dy * dy
  if (a < 1e-9) return { x: ax, y: ay }
  const b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r
  const disc = b * b - 4 * a * c
  if (disc < 0) return { x: ax, y: ay }              // 접선급 — 시작점이 가장 가깝다
  const t = (-b - Math.sqrt(disc)) / (2 * a)          // 첫 교점
  if (t <= 0) {                                       // 이미 원 안에서 시작 → 중심 반대편 표면으로 투영
    const l = Math.hypot(fx, fy) || 1
    return { x: cx + fx / l * r, y: cy + fy / l * r }
  }
  const tc = Math.min(1, t)
  return { x: ax + dx * tc, y: ay + dy * tc }
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

// ─── 핵 임펄스 — 이 게임의 큐 (§6.2 개정) ────────────────────────
// 규칙 한 줄: **입사각도 입사속도도 보지 않는다.**
// 방향 = 폭심 → 행성 중심 (= 공의 어느 살을 쳤는가),
// 크기 = 작약량 / 질량. 그래서 조준은 "어디를 맞히느냐" 하나로 환원된다.
export function applyNuke(b, blastX, blastY, yld) {
  let dx = b.pos.x - blastX, dy = b.pos.y - blastY
  const d = Math.hypot(dx, dy) || 1
  dx /= d; dy /= d
  const dv = nukeDv(yld, b.mu)
  b.vel.x += dx * dv; b.vel.y += dy * dv
  b.hitFlash = 0.9; b.trailFlash = 2.0
  b.scorch = Math.min(3, (b.scorch || 0) + 1)   // 핵 맞은 자국이 표면에 남는다
  return { dx, dy, dv }
}

// 폭풍 — 폭심 반경 안의 다른 천체들도 약하게 밀린다. 작약량을 올릴수록
// 넓어지므로, 큰 탄두는 판 전체를 흔들고 지구까지 밀어낼 수 있다.
export function blastWave(bodies, blastX, blastY, yld, skip) {
  const R = blastRadius(yld), out = []
  for (const o of bodies) {
    if (!o.alive || o === skip) continue
    let dx = o.pos.x - blastX, dy = o.pos.y - blastY
    const d = Math.hypot(dx, dy)
    if (d > R || d < 1e-6) continue
    const falloff = 1 - d / R
    const dv = nukeDv(yld, o.mu) * CFG.BLAST_PUSH * falloff * falloff
    o.vel.x += dx / d * dv; o.vel.y += dy / d * dv
    o.trailFlash = 1.5
    out.push({ body: o, dv })
  }
  return { radius: R, pushed: out }
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
      type: 'debris', isEarth: false, alive: true, trail: [], hitFlash: 0, trailFlash: 0, scorch: 0,
    })
  }
}

// ─── T1-7 개정: 행성끼리의 접촉 = 무조건 폭파 ───────────────────
// 핵으로는 못 부순다. 부수는 건 오직 여기다. 규칙을 하나로 못 박아야
// "어느 각도로 밀어야 저 둘이 만나는가"가 게임의 전부가 된다.
export function resolveBodyPairs(bodies, game) {
  const n = bodies.length
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = bodies[i], b = bodies[j]
    if (!a || !b || !a.alive || !b.alive) continue
    const aD = a.type === 'debris', bD = b.type === 'debris'
    if (aD && bD) continue
    if (len(sub(a.pos, b.pos)) >= contactDist(a, b)) continue
    if (aD || bD) {   // 파편은 행성 대기권에서 소멸 — 미사일 해저드일 뿐이다
      (aD ? a : b).alive = false
      continue
    }
    game.onPlanetCollision(a, b)
    return   // 한 스텝에 한 번의 대형 충돌만 정산 (파편 생성으로 배열이 변한다)
  }
}

export function cloneBodies(bodies) { return bodies.map(b => ({ ...b, pos: clone(b.pos), vel: clone(b.vel), trail: null })) }
