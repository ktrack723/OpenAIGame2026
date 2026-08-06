// ─── 작전 목표 ──────────────────────────────────────────────────
// 규칙은 언제나 하나다: **반격하는 조르그 요새를 전부 없앤다.**
// 방법은 묻지 않는다 — 행성끼리 처박든, 태양에 떨어뜨리든, 성계 밖으로
// 걷어차든, 특이점에 먹이든, 유폭시키든 전부 인정한다.
// "태양행 금지" 같은 조건부 제약은 없앴다. 비위협 조르그 행성은 남겨도 된다.

// cause: 'collision' | 'absorb' | 'sun' | 'exile' | 'blast'
export const CAUSE_KO = {
  collision: '충돌 파괴', absorb: '특이점 흡수', sun: '항성 처분',
  exile: '성계 추방', blast: '유폭',
}

export const GOAL_TITLE = '조르그 요새 섬멸'
export const GOAL_RULE =
  '반격하는 조르그 요새(✦)를 전부 없애라. 방법은 자유 — 충돌·태양·추방·흡수·유폭 다 인정된다.'

// 목표는 판 위의 상태에서 직접 읽는다. 카운터를 따로 굴리면 어긋날 여지가
// 생기는데, "살아있는 요새가 0인가"는 어긋날 수가 없다.
export function makeGoal(fortresses) {
  return {
    title: GOAL_TITLE,
    rule: GOAL_RULE,
    total: fortresses.length,
    ids: fortresses.map(f => f.id),
    get done() { return this.total - this.alive },
    alive: fortresses.length,
    need: fortresses.length,
    // 게임이 매 스텝 갱신한다 (살아있는 요새 수)
    update(aliveCount) { this.alive = aliveCount },
    label() { return `${this.title} ${this.total - this.alive}/${this.total}` },
  }
}
