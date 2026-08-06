import { CFG, nukeDv } from './config.js'

// ─── 특수 천체 ──────────────────────────────────────────────────
// 판 위의 공이 전부 똑같으면 "어느 살을 치나"만 남는다. 역할을 붙여서
// 공마다 다른 규칙을 걸고, 그 규칙끼리 부딪히게 만든다.
//
// 규칙은 넷 다 한 줄로 읽혀야 한다 — 조준 중에 읽을 시간은 없으니까.
export const ROLES = {
  armor: {
    label: '장갑', icon: '▣', color: 0x94a3b8,
    dvScale: CFG.ARMOR_DV,
    brief: '핵 임펄스가 거의 안 먹는다. 다른 행성을 던져서 부숴라.',
    aim: '장갑 — 밀리는 양이 15%다',
  },
  battery: {
    label: '요새', icon: '✦', color: 0xf43f5e,
    dvScale: 1,
    brief: '★ 이게 표적이다. 맞으면 반격 미사일을 되쏜다 — 전부 없애야 판이 끝난다.',
    aim: '요새 — 때린 쪽으로 반격 미사일이 튀어나온다 (붉은 화살표)',
  },
  void: {
    label: '특이점', icon: '◍', color: 0xa855f7,
    dvScale: 0,
    brief: '닿는 것을 전부 삼킨다. 핵도 안 통하고 부술 수도 없다 — 여기로 밀어 넣어라.',
    aim: '특이점 — 핵이 통하지 않는다 (탄두만 소멸)',
  },
  volatile: {
    label: '휘발성', icon: '✸', color: 0xfb923c,
    dvScale: 1,
    brief: '핵을 맞으면 그 자리에서 유폭. 반경 안의 모든 천체를 통째로 밀어낸다.',
    aim: '휘발성 — 맞는 순간 유폭한다 (주황 원 안이 전부 밀린다)',
  },
  shield: {
    label: '방어막', icon: '⬡', color: 0xa78bfa,
    dvScale: 0,
    brief: '핵 직격을 통째로 삼킨다 — 임펄스도 폭풍도 없다. 다른 행성을 밀어 쳐라.',
    aim: '방어막 — 직격 무효 (탄두만 소멸, 폭풍도 없다)',
  },
}

export const roleOf = (b) => (b && b.role) ? ROLES[b.role] : null

// 요새 위에 장갑·방어막을 겹쳐 얹을 수 있다. 주 역할은 role, 덧붙은 건 mods.
// "이 공에 이 성질이 있는가"는 언제나 이 함수로 묻는다.
export const hasRole = (b, r) => !!b && (b.role === r || (!!b.mods && b.mods.includes(r)))
export const modsOf = (b) => (b && b.mods) ? b.mods : []

// 이 공에 실제로 먹히는 Δv — 장갑은 깎이고 특이점·방어막은 0이다.
// 겹쳐 얹은 성질(mods)까지 보고 가장 강한 감쇠를 적용한다.
// 예측선과 실제 임펄스가 반드시 같은 함수를 써야 조준이 거짓말을 안 한다.
export function dvScaleOf(b) {
  let s = ROLES[b.role]?.dvScale ?? 1
  for (const m of modsOf(b)) s = Math.min(s, ROLES[m]?.dvScale ?? 1)
  return s
}
export const effDv = (b, yld) => nukeDv(yld, b.mu) * dvScaleOf(b)

// 휘발성 유폭 반경 — 작약량과 무관하게 그 행성의 크기로 정해진다.
// 상수라서 조준 전에 화면에 원으로 그려 줄 수 있다(= 계획이 가능하다).
export const volatileRadius = (b) => Math.max(CFG.VOLATILE_MIN_R, b.radius * CFG.VOLATILE_R)

// 스테이지 번호별로 등장하는 역할 — 한 번에 하나씩만 가르친다
export function rolePool(stageIdx) {
  const pool = ['armor']
  if (stageIdx >= 2) pool.push('volatile')
  if (stageIdx >= 4) pool.push('battery')
  if (stageIdx >= 6) pool.push('void')
  return pool
}
