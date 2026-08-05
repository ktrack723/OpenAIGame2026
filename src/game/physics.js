import { CFG } from './config.js'
import { angleOf, clone, dot, len, norm, scale, sub, vec } from '../core/vector.js'

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
export function stepBodies(bodies, dt) {
  const acc = bodies.map(() => vec()), h = dt / 2
  bodies.forEach((b, i) => { if (!b.alive) return; accelOn(i, bodies, acc[i]); b.vel.x += acc[i].x * h; b.vel.y += acc[i].y * h })
  bodies.forEach(b => { if (!b.alive) return; b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt; b.hitFlash = Math.max(0, b.hitFlash - dt); if (b.trail.push(clone(b.pos)) > 180) b.trail.shift() })
  bodies.forEach((b, i) => { if (!b.alive) return; accelOn(i, bodies, acc[i]); b.vel.x += acc[i].x * h; b.vel.y += acc[i].y * h })
}
function accelMissile(m, bodies, out) {
  let dx = -m.pos.x, dy = -m.pos.y, d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS
  let inv = CFG.MU_STAR / (d2 * Math.sqrt(d2)); out.x = dx * inv; out.y = dy * inv
  for (const b of bodies) if (b.alive) { dx = b.pos.x - m.pos.x; dy = b.pos.y - m.pos.y; d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS; inv = CFG.KAPPA * b.mu / (d2 * Math.sqrt(d2)); out.x += dx * inv; out.y += dy * inv }
}
export function stepMissile(m, bodies, dt) {
  let n = 1; for (const b of bodies) if (b.alive && len(sub(b.pos, m.pos)) < CFG.SUBSTEP_DIST * b.radius) n = CFG.SUBSTEP_N
  const a = vec(), sd = dt / n
  for (let s = 0; s < n; s++) { accelMissile(m, bodies, a); m.vel.x += a.x * sd / 2; m.vel.y += a.y * sd / 2; m.pos.x += m.vel.x * sd; m.pos.y += m.vel.y * sd; accelMissile(m, bodies, a); m.vel.x += a.x * sd / 2; m.vel.y += a.y * sd / 2 }
  m.age += dt; if (m.path.push(clone(m.pos)) > 900) m.path.shift()
}
export function inspectSwing(m, b) {
  const r = sub(m.pos, b.pos), d = len(r); if (d > CFG.SWING_ZONE * b.radius || m.swingIds.has(b.id)) return false
  const before = angleOf(m.lastVel), after = angleOf(m.vel); let deg = Math.abs((after - before) * 180 / Math.PI); if (deg > 180) deg = 360 - deg
  m.bestDeflection = Math.max(m.bestDeflection, deg); if (d < CFG.NEAR_MISS * b.radius) m.nearMiss++
  if (deg >= CFG.SWING_DEG) { m.chain++; m.swingIds.add(b.id); return true } return false
}
export function impact(m, b) {
  const v = len(m.vel), damage = m.power * (0.5 + 0.5 * Math.min(v / 120, 2)) * (1 + 0.2 * m.chain)
  b.hp -= damage; b.hitFlash = 1; const dir = norm({ x: m.vel.x * .7 + (b.pos.x - m.pos.x) * .3, y: m.vel.y * .7 + (b.pos.y - m.pos.y) * .3 })
  const dv = 75 * m.power / b.mu; b.vel.x += dir.x * dv; b.vel.y += dir.y * dv; return damage
}
export function cloneBodies(bodies) { return bodies.map(b => ({ ...b, pos: clone(b.pos), vel: clone(b.vel), trail: [], })) }
