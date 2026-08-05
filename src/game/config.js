export const CFG = {
  DT: 1 / 120, EPS: 3, KAPPA: 60, MU_STAR: 3e5, R_STAR: 40,
  SUBSTEP_DIST: 5, SUBSTEP_N: 4, MISSILE_MIN: 40, MISSILE_MAX: 140,
  SWING_ZONE: 6, SWING_DEG: 25, NEAR_MISS: 1.8, WORLD_LIMIT: 3200,
}
export const radiusOf = (mu) => 1.6 * Math.cbrt(mu)
export const hpOf = (mu) => 12 + mu / 12
