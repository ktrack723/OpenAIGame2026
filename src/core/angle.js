// 각도 유틸 — 같은 이름(degOf)이 파일마다 다른 뜻으로 쓰이고 있었다.
// game.js의 degOf(x,y)는 방위각, hud.js의 degOf(rad)는 조준각 표시값이었다.
// 이름으로 뜻이 갈리게 여기 모은다.

// (-π, π] 로 접기 — 조준각을 계속 더하다 보면 몇 바퀴씩 쌓인다
export const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a))

// 라디안 → 조준각 표시용 (-180, 180]
export const toDeg180 = (rad) => ((rad * 180 / Math.PI + 180) % 360 + 360) % 360 - 180

// 벡터 → 표시용 방위각 [0, 360)
export const bearing = (x, y) => ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
