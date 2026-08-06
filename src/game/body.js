import { CFG, radiusOf } from './config.js'

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
  return {
    id: spec.id ?? '?',
    name: spec.name ?? '?',
    type: spec.type ?? 'rock',
    mu,
    radius: spec.radius ?? radiusOf(mu),
    pos: { x: spec.pos ? spec.pos.x : 0, y: spec.pos ? spec.pos.y : 0 },
    vel: { x: spec.vel ? spec.vel.x : 0, y: spec.vel ? spec.vel.y : 0 },
    alive: spec.alive ?? true,
    isEarth: !!spec.isEarth,
    isTarget: !!spec.isTarget,
    zorg: !!spec.zorg,
    homeworld: !!spec.homeworld,
    role: spec.role ?? null,
    role2: spec.role2 ?? null,
    mods: spec.mods ?? null,
    ammo: spec.ammo ?? 0,
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
