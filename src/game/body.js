import { CFG, radiusOf } from './config.js'
import { TAG_BY_TYPE } from './roles.js'

// ─── 천체의 정본(正本) 형태 ─────────────────────────────────────
// 성계에 놓이는 모든 것은 **반드시 여기를 통해** 만들어진다.
//
// 이건 스타일 규칙이 아니라 성능 규칙이다. 예전엔 stage/system/shatter가
// 각자 다른 순서·다른 필드로 객체 리터럴을 썼는데, 그러면 자바스크립트
// 엔진이 서로 다른 hidden class를 만들어 b.pos.x 같은 접근이 전부
// 메가모픽(딕셔너리 조회)이 된다. 계측: 행성 18개 성계에서 stepBodies가
// 호출당 26µs → 형태를 통일하니 10µs (2.7배). 예측선은 이 함수를 수천 번
// 돌리므로 그대로 프레임 예산이다.
//
// 새 속성이 필요하면 나중에 붙이지 말고 **여기에 기본값과 함께 추가**한다.
export function makeBody(spec = {}) {
  const mu = spec.mu ?? 100
  const hp = spec.hp ?? CFG.PLANET_HP
  const type = spec.type ?? 'rock'
  // 태그는 종류가 정한다 — 금속처럼 생긴 게 금속이고 가스처럼 생긴 게 터진다.
  // (조르그 요새만 예외: 종류와 무관하게 spec.role로 명시된다.)
  // 파편은 태그를 안 받는다 — 잔해에 규칙을 붙이면 판이 읽히지 않는다.
  const role = spec.role ?? (type === 'debris' ? null : TAG_BY_TYPE[type] ?? null)
  return {
    id: spec.id ?? '?',
    name: spec.name ?? '?',
    // 이름이 언어 표에 있는 천체(태양계·파편·모성)는 키를 들고 다닌다.
    // 조르그가 보낸 것은 생성된 고유명이라 키가 없다 — nameOf가 둘을 가른다.
    nameKey: spec.nameKey ?? null,
    type,
    mu,
    radius: spec.radius ?? radiusOf(mu),
    pos: { x: spec.pos ? spec.pos.x : 0, y: spec.pos ? spec.pos.y : 0 },
    vel: { x: spec.vel ? spec.vel.x : 0, y: spec.vel ? spec.vel.y : 0 },
    alive: spec.alive ?? true,
    isEarth: !!spec.isEarth,
    isTarget: !!spec.isTarget,
    zorg: !!spec.zorg,
    mothership: !!spec.mothership,   // 시한 종료 시 오는 조르그 모성 — 부술 수 없다
    role,
    mods: spec.mods ?? null,
    // 추진기를 달고 있는가. 조르그 요새에만 1로 실린다(3스테이지부터).
    // 횟수 제한은 없다 — 쓴다고 줄지 않는다. 0이 기본이라 나머지 천체는 안 피한다.
    boost: spec.boost ?? 0,
    // 다음 분사까지 남은 대기(실시간 초). 줄어드는 건 이쪽이다 — 연료가 아니라
    // 간격만 든다는 뜻이고, 0이면 언제든 다시 태울 수 있다.
    boostCool: spec.boostCool ?? 0,
    hp, hpMax: spec.hpMax ?? hp,
    hitFlash: spec.hitFlash ?? 0,
    trailFlash: spec.trailFlash ?? 0,
    bumpFlash: spec.bumpFlash ?? 0,
    scorch: spec.scorch ?? 0,
    warp: spec.warp ?? 0,
    lastBelt: spec.lastBelt ?? -99,
    trail: spec.trail === null ? null : [],
  }
}

// 예측·사전 시뮬용 복제 — 궤적(trail)은 버린다(예측에선 안 그린다).
export const cloneBody = (b) => makeBody({ ...b, trail: null })
