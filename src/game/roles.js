import { CFG, nukeDv } from './config.js'

// ─── 행성 태그 — 다섯 ───────────────────────────────────────────
// 태그가 안 붙은 건 전부 **일반 행성**이다. 규칙이 없는 게 규칙이라
// 마음 놓고 큐볼로 쓰면 된다.
//
//   ☠ 조르그 요새 — 부숴야 할 표적. 때리면 반격 미사일이 되날아온다.
//   🔩 금속 행성   — 무겁다. 핵으로 미는 양이 절반으로 깎인다.
//   🪐 가스 행성   — 터진다. 핵을 맞으면 그 자리에서 유폭한다.
//   🧊 얼음 행성   — 가볍다. 질량이 절반이라 두 배로 밀린다(최고의 큐볼).
//   🕳 특이점      — 삼킨다. 블랙홀·태양처럼 닿는 것을 없애 버린다.
//
// 태그는 **행성의 종류가 정한다**(아래 TAG_BY_TYPE). 금속 행성처럼 생긴 게
// 금속 행성이고 가스 행성처럼 생긴 게 터진다 — 보이는 것과 규칙이 어긋나지 않는다.
// 조르그 요새만 예외로, 종류와 무관하게 조르그가 무장시킨 천체다.
export const ROLES = {
  battery: {
    label: '조르그 요새', icon: '☠', color: 0xf43f5e,
    dvScale: 1,
    brief: '☠ 이게 표적이다. 체력 1 — 제대로 한 번 처박으면 끝난다. 때리면 반격 미사일을 되쏜다.',
    aim: '조르그 요새 — 때린 쪽으로 반격 미사일이 튀어나온다 (붉은 화살표)',
  },
  armor: {
    label: '금속 행성', icon: '🔩', color: 0x94a3b8,
    dvScale: CFG.ARMOR_DV,
    brief: `🔩 무겁다. 핵 임펄스가 ${(CFG.ARMOR_DV * 100).toFixed(0)}%만 먹는다 — 밀리긴 하지만 절반이다.`,
    aim: `금속 행성 — 무거워서 밀리는 양이 ${(CFG.ARMOR_DV * 100).toFixed(0)}%다`,
  },
  volatile: {
    label: '가스 행성', icon: '🪐', color: 0xfb923c,
    dvScale: 1,
    brief: '🪐 터진다. 핵을 맞으면 그 자리에서 유폭해 반경 안의 모든 천체를 밀어낸다.',
    aim: '가스 행성 — 맞는 순간 유폭한다 (주황 원 안이 전부 밀린다)',
  },
  light: {
    label: '얼음 행성', icon: '🧊', color: 0x8be9ff,
    dvScale: 1,
    brief: '🧊 가볍다. 질량이 같은 크기 대비 절반이라 핵 한 방에 두 배로 밀린다 — 최고의 큐볼.',
    aim: '얼음 행성 — 가벼워서 크게 밀린다',
  },
  void: {
    label: '특이점', icon: '🕳', color: 0xa855f7,
    dvScale: 0,
    brief: '🕳 삼킨다. 블랙홀·태양과 같은 부류다 — 핵도 안 통하고 부술 수도 없다. 여기로 밀어 넣어라.',
    aim: '특이점 — 핵이 통하지 않는다 (탄두만 소멸)',
  },
}

// 종류 → 태그. 여기 없는 종류는 전부 일반 행성이다.
export const TAG_BY_TYPE = { iron: 'armor', gas: 'volatile', void: 'void', ice: 'light' }

// 종류별 질량 배율 — 얼음은 **가볍다**. 이게 "얼음 행성"의 메카닉 전부다:
// 같은 크기라도 질량이 절반이라 핵 한 방에 두 배로 밀린다(Δv = 임펄스/질량).
// 이 배율이 곧 '얼음' 태그의 내용이다 — 태그가 말로만 있는 게 아니라
// 질량·Δv·무게등급 숫자에 그대로 드러난다.
export const TYPE_MU_MUL = { ice: 0.55 }

// 무게 등급 — 모든 행성이 갖는 성질. "이 공을 밀 수 있는가"를 한 단어로 답한다.
// 기준은 최대 작약(12Mt)으로 얻는 Δv다. 궤도 속도가 13~25 GU/s 대역이므로
// 그와 견줘 읽으면 된다: 60이면 총알처럼 날아가고, 5면 꿈쩍도 안 한다.
export function massClass(b) {
  const dv = nukeDv(CFG.YIELD_MAX, b.mu) * dvScaleOf(b)
  if (dv >= 60) return { key: 'feather', label: '아주 가벼움', hint: '한 방에 총알처럼 날아간다', color: '#7dd3fc' }
  if (dv >= 25) return { key: 'light', label: '가벼움', hint: '큐볼로 쓰기 좋다', color: '#a5f3fc' }
  if (dv >= 10) return { key: 'medium', label: '보통', hint: '큰 작약이면 궤도가 바뀐다', color: '#cbd5e1' }
  return { key: 'heavy', label: '무거움', hint: '핵으로는 거의 못 민다 — 다른 공을 던져라', color: '#f5b544' }
}
// 이 천체에 붙는 태그 하나(없으면 null). 조르그 요새가 최우선 —
// 금속으로 만든 요새라도 플레이어에게 먼저 읽혀야 하는 건 "표적"이다.
export const tagOf = (b) => (b && b.role) ? b.role : null

export const roleOf = (b) => (b && b.role) ? ROLES[b.role] : null

// 요새 위에 금속(장갑) 성질을 겹쳐 얹을 수 있다. 주 태그는 role, 덧붙은 건 mods.
// "이 공에 이 성질이 있는가"는 언제나 이 함수로 묻는다.
export const hasRole = (b, r) => !!b && (b.role === r || (!!b.mods && b.mods.includes(r)))
export const modsOf = (b) => (b && b.mods) ? b.mods : []

// 이 공에 실제로 먹히는 Δv — 금속은 깎이고 특이점은 0이다.
// 겹쳐 얹은 성질(mods)까지 보고 가장 강한 감쇠를 적용한다.
// 예측선과 실제 임펄스가 반드시 같은 함수를 써야 조준이 거짓말을 안 한다.
export function dvScaleOf(b) {
  let s = ROLES[b.role]?.dvScale ?? 1
  for (const m of modsOf(b)) s = Math.min(s, ROLES[m]?.dvScale ?? 1)
  return s
}
export const effDv = (b, yld) => nukeDv(yld, b.mu) * dvScaleOf(b)

// 가스 행성 유폭 반경 — 작약량과 무관하게 그 행성의 크기로 정해진다.
// 상수라서 조준 전에 화면에 원으로 그려 줄 수 있다(= 계획이 가능하다).
export const volatileRadius = (b) => Math.max(CFG.VOLATILE_MIN_R, b.radius * CFG.VOLATILE_R)
