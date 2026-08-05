// 기획서 부록 A — 밸런스 상수표. 모든 숫자는 이 파일에서만 튜닝한다.
export const CFG = {
  DT: 1 / 120, EPS: 3, KAPPA: 60, MU_STAR: 3e5, R_STAR: 40,
  SUBSTEP_DIST: 5, SUBSTEP_N: 4,
  LAUNCH_MIN: 40, LAUNCH_MAX: 140,   // 발사 속도 P_v (§5.1)
  SHELL_P: 10,                        // 표준탄 위력 P (§6.1)
  SWING_ZONE: 6, SWING_DEG: 25, NEAR_MISS: 1.8, CAPTURE_WRAP: 0.75,   // §5.2
  A_MIN: 260,
  EARTH_MU: 300, EARTH_R: 11, EARTH_HP: 3,
  DIPLO_MAX: 3, SUN_BONUS_R: 120,     // 외교 게이지 / 태양 가속 보너스(§9.1)
  ROCKETS: 4,
}
export const radiusOf = (mu) => 1.6 * Math.cbrt(mu)   // T1-9
export const hpOf = (mu) => 12 + mu / 12              // T1-9
export const aMaxOf = (A) => 1150 + 90 * Math.min(A, 6)   // §7.2
