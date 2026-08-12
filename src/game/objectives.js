import { t } from '../i18n/index.js'
// ─── 작전 목표 ──────────────────────────────────────────────────
// 규칙은 언제나 하나다: **조르그 요새(☠)를 전부 없앤다.**
// 방법은 묻지 않는다 — 행성끼리 처박든, 태양에 떨어뜨리든,
// 태양에 떨어뜨리든, 유폭시키든 전부 인정한다.
// 성계 추방은 없앴다: 바깥은 카이퍼 벨트가 막고 있어서 아무도 못 나간다.

// 파괴 사유(cause: 'collision' | 'sun' | 'blast' | 'laser' | 'burst' | 'shrapnel')의 문구는
// game.recordKill이 msg(`cause.${cause}`)로 직접 만든다 — 문자열로 굳히지 않는
// 그 방식이 맞다(판이 도는 중에 언어를 바꿔도 같이 바뀐다).

// 목표는 판 위의 상태에서 직접 읽는다. 카운터를 따로 굴리면 어긋날 여지가
// 생기는데, "살아있는 요새가 0인가"는 어긋날 수가 없다.
export function makeGoal(fortresses) {
  return {
    // 제목과 규칙은 언어 표에서 그때그때 읽는다 — 문자열로 굳혀 두면
    // 판이 도는 중에 언어를 바꿨을 때 목표만 옛 언어로 남는다.
    get title() { return t('goal.title') },
    total: fortresses.length,
    get done() { return this.total - this.alive },
    alive: fortresses.length,
    need: fortresses.length,
    // 게임이 매 스텝 갱신한다 (살아있는 요새 수)
    update(aliveCount) { this.alive = aliveCount },
    // 숫자만. 제목은 이 값을 띄우는 자리에 이미 붙어 있다 — 예전에는 둘을
    // 한 문자열로 묶어서 패널에 "조르그 요새 섬멸  조르그 요새 섬멸 0/2"가 떴다.
    label() { return `${this.total - this.alive}/${this.total}` },
  }
}
