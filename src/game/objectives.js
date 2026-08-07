// ─── 작전 목표 ──────────────────────────────────────────────────
// 규칙은 언제나 하나다: **조르그 요새(☠)를 전부 없앤다.**
// 방법은 묻지 않는다 — 행성끼리 처박든, 태양에 떨어뜨리든,
// 특이점에 먹이든, 유폭시키든 전부 인정한다.
// 성계 추방은 없앴다: 바깥은 카이퍼 벨트가 막고 있어서 아무도 못 나간다.

// cause: 'collision' | 'absorb' | 'sun' | 'blast' | 'laser'
export const CAUSE_KO = {
  collision: '충돌 파괴', absorb: '특이점 흡수', sun: '항성 처분', blast: '유폭',
  laser: '조르그 레이저에 관통',
}

export const GOAL_TITLE = '조르그 요새 섬멸'
export const GOAL_RULE =
  '조르그 요새(☠)를 전부 없애라. 요새는 체력 1 — 제대로 한 번 처박으면 끝난다. 태양·흡수·유폭도 인정된다.'

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
