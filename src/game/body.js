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
    mothership: !!spec.mothership,   // 시한 종료 시 오는 조르그 모성
    // 카이퍼 벨트 밖에서 들어온 손님인가 — 혜성(comet.js)과 순회선(ufo.js).
    // 판을 넘길 때는 지나간 것으로 치고 걷고(loadStage), 성계의 상주 인구를
    // 세는 자리에서도 빠진다(system.js·comet.js의 큐볼 재고).
    visitor: spec.visitor ?? 0,
    // 그중 혜성인가. 종류(type)로 물어도 되지만 이 깃발은 **판 위의 규칙이
    // 아니라 이름표**를 가른다(표식·범례·문구).
    comet: !!spec.comet,
    // 순회선이면 그 형태 키(config.UFO_KINDS의 key), 아니면 0.
    ufo: spec.ufo ?? 0,
    // ── 통행권 ──
    // 카이퍼 벨트를 그냥 지나간다(game.bodyBounds). 손님이 들고 들어오는
    // 것이고, **궤도가 한 번 비틀리면 사라진다**(game.nudgeVisitor) — 그때부터는
    // 다른 공과 한 글자도 다르지 않게 벽에 튕긴다.
    pass: spec.pass ?? 0,
    // ── 엔진 ──
    // 1이면 중력을 안 받는다(physics.stepBodies). 순회선만 그렇다 — 저건 돌이
    // 아니라 배라서, 판의 중력에 안 끌리고 곧게 지나간다. 한 번 얻어맞으면
    // 0이 되고(엔진이 죽는다) 그 순간부터 그냥 공이다.
    cruise: spec.cruise ?? 0,
    // 부서졌지만 아직 안 터진 시간(실시간 초). 조르그만 0보다 크다 —
    // 그동안 몸통이 흰빛으로 달아오르고 사방으로 빛기둥이 뻗는다(game.stepDying).
    dying: spec.dying ?? 0,
    role,
    mods: spec.mods ?? null,
    // 추진기를 달고 있는가. 조르그 요새에만 1로 실린다(3스테이지부터).
    // 횟수 제한은 없다 — 쓴다고 줄지 않는다. 0이 기본이라 나머지 천체는 안 피한다.
    boost: spec.boost ?? 0,
    // 다음 분사까지 남은 대기(실시간 초). 줄어드는 건 이쪽이다 — 연료가 아니라
    // 간격만 든다는 뜻이고, 0이면 언제든 다시 태울 수 있다.
    boostCool: spec.boostCool ?? 0,
    // 산탄인가 — 불안정 행성이 쪼개지며 쏜 파편(physics.shardBurst)에만 1이 실린다.
    // 그냥 잔해(충돌로 생긴 파편)와 **갈라 두는 이유**: 잔해는 예나 지금이나
    // 미사일을 조기 격발시키는 장애물일 뿐인데, 여기에 피해를 얹으면 판이
    // 저 혼자 정리된다(충돌 한 번에 파편이 8~10개씩 생긴다). 산탄만 때린다.
    shard: spec.shard ?? 0,
    // 남은 수명(인게임 초). 0이면 무제한 — 산탄만 유한하다(config.SHARD_TTL).
    ttl: spec.ttl ?? 0,
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
