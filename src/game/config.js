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

// ─── 렌더 전용 상수 ───────────────────────────────────────────
// 물리 반지름 R_p = 1.6·μ^(1/3) 은 기획서 §4.1 고정값이라 건드리지 않는다.
// "행성이 커 보이게" 하는 건 전부 여기: 중력권 헤일로(§5.2 스윙바이 존 6R_p,
// SOI 확대율 κ^(2/5)≈5.1× 가 근거) + 화면 최소 크기 바닥값 + 3D 구체 셰이딩.
export const VIS = {
  FOV: 42,                    // 탑다운 원근 카메라 — 시점은 위에서, 입체감은 유지 (§14.1)
  MIN_PLANET_PX: 36,          // 행성 최소 화면 지름(px). 판정 반경은 그대로, 보이기만 키운다
  MIN_DEBRIS_PX: 9,
  MAX_INFLATE: 4.0,           // 최소 크기 바닥값이 실제 반경을 넘길 수 있는 최대 배율
  TRUE_R_HINT: 1.6,           // 이 배 이상 부풀면 실제 판정 반경을 얇은 링으로 병기
  ZOOM_MIN: 0.5, ZOOM_MAX: 10, ZOOM_STEP: 1.4,
  FIT_MARGIN: 1.25,           // 자동 프레이밍 여백
  FULL_FIT: 1.15,             // §14.1 성계 전체 뷰 = a_max × 1.15
  SHAKE_MAX: 26,              // 명중 스크린셰이크 최대 진폭(GU)
  PARTICLES: 4200,
}
