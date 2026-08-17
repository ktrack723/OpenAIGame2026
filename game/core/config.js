// 밸런스 상수 한곳 모음. tools/selfplay.js 가 이 숫자들을 근거로 승률을 계측한다.
// 숫자를 바꿨으면 `npm run balance` 를 다시 돌려서 표를 갱신할 것.

export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: '쉬움',
    tag: 'ROOKIE',
    desc: '취향이 거의 다 공개된다. 지뢰는 하나뿐.',
    visibleLikeRatio: 1.0, // 호감 취향 중 몇 %를 처음부터 보여줄지
    landmines: 1, // 숨겨진 "지뢰"(싫어하는 것) 개수
    confessionThreshold: 62,
  },
  normal: {
    id: 'normal',
    label: '보통',
    tag: 'AGENT',
    desc: '절반은 직접 알아내야 한다. 지뢰 둘.',
    visibleLikeRatio: 0.5,
    landmines: 2,
    confessionThreshold: 76,
  },
  hard: {
    id: 'hard',
    label: '어려움',
    tag: 'LEGEND',
    desc: '거의 아무것도 안 알려준다. 지뢰 셋.',
    // 통과선이 보통보다 낮은 건 봐주는 게 아니다. 공개 취향이 하나뿐이라
    // 도달 가능한 호감 총량 자체가 낮다 — 같은 76을 걸면 사실상 클리어 불가다.
    visibleLikeRatio: 0.25,
    landmines: 3,
    confessionThreshold: 72,
  },
}

export const PHASES = {
  texting: {
    id: 'texting',
    label: '📱 문자 단계',
    turns: 6, // 의뢰인이 말하는 횟수
    interventions: 1, // 기획서: 문자에선 한 번만 개입
  },
  talking: {
    id: 'talking',
    label: '👫 대면 단계',
    turns: 8,
    interventions: 2, // 기획서: 대면에선 두 번
  },
}

export const BALANCE = {
  moodStart: 50,
  moodMin: 0,
  moodMax: 100,

  loveStart: 12,
  loveMin: 0,
  loveMax: 100,

  // 분위기가 호감 증감에 곱해지는 배율. mood 0 → 0.65배, 50 → 0.95배, 100 → 1.25배.
  moodMulMin: 0.65,
  moodMulMax: 1.25,

  // 준비 단계가 시작 수치에 주는 영향
  stylingLoveBonusMax: 14, // 스타일링 점수 만점일 때 시작 호감 보너스
  stylingLoveClashMax: -10, // 지뢰를 밟는 스타일링일 때 페널티
  speechMoodBonusMax: 12, // 격려 연설이 시작 분위기에 주는 보너스
  coachingMoodBonusMax: 6,

  // 판정 기본값 (오프라인 엔진과 LLM 엔진 모두 이 범위로 정규화)
  moodDeltaClamp: 14,
  loveDeltaClamp: 11,

  // 호감이 높을수록 더 올리기 어렵다. gain × (1 - love/softness).
  // 이게 없으면 취향만 반복해서 맞혀도 18턴 안에 100이 찍혀 실력 구간이 사라진다.
  loveCeilingSoftness: 110,

  // 분위기는 가만두면 식는다. 매 턴 중립점 쪽으로 이만큼 흘러내린다.
  // 이게 없으면 한 번 100을 찍고 나서 아무거나 말해도 계속 100이라 게임이 사라진다.
  moodNeutral: 45,
  moodDrift: 2,

  // 같은 취향을 반복해서 건드릴 때의 체감 감소.
  // 1회차는 그대로, 2회차부터 급격히 줄어든다 → "넓게 훑어라"가 정답이 된다.
  // 숨은 취향을 찾아내야만 하는 이유도 여기서 나온다.
  saturation: [1, 0.55, 0.32, 0.18, 0.1],

  // 숨은 취향을 처음 건드렸을 때의 추가 보너스
  discoveryLoveBonus: 3,

  // 대상이 힌트를 흘릴 기본 확률(분위기가 좋을수록 올라간다)
  hintBaseChance: 0.10,
  hintMoodScale: 0.20,

  // 고백 판정: score = love*loveWeight + mood*moodWeight (+ 시드 고정 운)
  confessionLoveWeight: 0.8,
  confessionMoodWeight: 0.2,
  confessionLuck: 5, // ±6 범위의 시드 고정 흔들림
  nearMissBand: 10, // 문턱에서 이만큼 아래면 "보류" 엔딩
}

/** 현재 분위기에 대응하는 호감 배율. */
export function moodMultiplier(mood) {
  const t = clamp(mood, BALANCE.moodMin, BALANCE.moodMax) / BALANCE.moodMax
  return BALANCE.moodMulMin + t * (BALANCE.moodMulMax - BALANCE.moodMulMin)
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v
}

export const ENDINGS = {
  accepted: {
    id: 'accepted',
    win: true,
    title: '고백 성공',
    stamp: 'MISSION COMPLETE',
  },
  pending: {
    id: 'pending',
    win: false,
    title: '보류',
    stamp: 'MISSION INCOMPLETE',
  },
  rejected: {
    id: 'rejected',
    win: false,
    title: '거절',
    stamp: 'MISSION FAILED',
  },
}
