// ─── 작전 목표 (행성당구 규칙) ──────────────────────────────────
// 핵미사일은 행성을 부수지 못한다. 미는 것만 한다.
// 행성을 없애는 방법은 셋뿐이다: ① 다른 행성과 충돌 ② 태양 낙하 ③ 성계 추방.
// 안테마다 "어떤 방법으로 없앨 것인가"를 지정해서, 같은 판이 매번 다른 문제가 되게 한다.

// cause: 'collision' | 'sun' | 'exile'
const CAUSE_KO = { collision: '충돌', sun: '항성 처분', exile: '성계 추방' }

export const GOALS = {
  ANYKILL: {
    title: '조르그 말살',
    rule: '방법은 자유 — 충돌·태양·추방 중 아무거나.',
    targets: (need) => need,
    counts: (ev) => ev.isTarget,
  },
  SMASH: {
    title: '충돌 파괴',
    rule: '조르그 행성을 다른 행성에 처박아라. 태양행·추방은 인정 안 된다.',
    targets: (need) => need,
    counts: (ev) => ev.isTarget && ev.cause === 'collision',
  },
  SUNDIVE: {
    title: '항성 처분',
    rule: '조르그 행성을 태양으로 밀어 떨어뜨려라. 부숴 버리면 실패다.',
    targets: (need) => need,
    counts: (ev) => ev.isTarget && ev.cause === 'sun',
  },
  EXILE: {
    title: '성계 추방',
    rule: '조르그 행성을 성계 밖으로 걷어차라. 부숴 버리면 실패다.',
    targets: (need) => need,
    counts: (ev) => ev.isTarget && ev.cause === 'exile',
  },
  CAROM: {
    title: '캐롬 — 방어막 돌파',
    rule: '조르그 행성엔 핵 방어막이 있다. 직격은 무효 — 중립 행성을 큐볼로 삼아 밀어 쳐라.',
    shielded: true,
    targets: (need) => need,
    counts: (ev) => ev.isTarget,
  },
  PILEUP: {
    title: '연쇄 충돌',
    rule: '조르그든 중립이든 상관없다. 행성끼리 부딪혀 터지는 것만 센다.',
    targets: () => 1,
    counts: (ev) => ev.cause === 'collision',
    loose: true,          // 목표 행성을 "잘못된 방법"으로 잃어도 아까울 게 없다
  },
}

// 앞 8스테이지는 고정 순서 — 규칙을 한 번에 하나씩만 가르친다.
const LADDER = [
  { kind: 'ANYKILL', need: 1 },
  { kind: 'SMASH', need: 1 },
  { kind: 'SUNDIVE', need: 1 },
  { kind: 'EXILE', need: 1 },
  { kind: 'CAROM', need: 1 },
  { kind: 'PILEUP', need: 3 },
  { kind: 'SMASH', need: 2 },
  { kind: 'CAROM', need: 2 },
]
const POOL = ['SMASH', 'SUNDIVE', 'EXILE', 'CAROM', 'PILEUP', 'ANYKILL']

// 스테이지 번호 → 목표. 9스테이지부터는 풀에서 뽑고 안테로 요구량을 올린다.
export function pickGoalSpec(rng, stageIdx, ante) {
  if (stageIdx < LADDER.length) return { ...LADDER[stageIdx] }
  const kind = POOL[rng.int(0, POOL.length - 1)]
  const need = kind === 'PILEUP' ? Math.min(6, 2 + Math.floor(ante / 2))
    : Math.min(3, 1 + Math.floor((ante - 3) / 3))
  return { kind, need: Math.max(1, need) }
}

export function makeGoal(spec) {
  const def = GOALS[spec.kind] ?? GOALS.ANYKILL
  const targetCount = def.targets(spec.need)
  return {
    kind: spec.kind,
    need: spec.need,
    done: 0,
    title: def.title,
    rule: def.rule,
    shielded: !!def.shielded,
    targetCount,
    // 판에 깔려야 할 최소 천체 수 — 목표 + 큐볼 + 지구.
    // 연쇄 충돌은 "부딪힐 짝"이 있어야 하므로 요구량만큼 공을 더 깐다.
    minBodies: Math.min(8, (def.loose ? spec.need + 1 : targetCount + 2) + 1),
    // 파괴 이벤트 한 건을 목표에 반영. 카운트에 잡히면 true.
    record(ev) {
      if (this.done >= this.need) return false
      if (!def.counts(ev)) return false
      this.done++
      return true
    },
    // 이 파괴가 목표를 낭비했는지 — "태양에 처넣어야 하는데 부숴 버렸다"
    wasted(ev) { return !def.loose && ev.isTarget && !def.counts(ev) },
    // 남은 재료로 아직 달성 가능한가 (aliveTargets / alivePlanets는 게임이 센다).
    // 충돌은 반드시 짝으로 일어나므로 홀로 남은 공 하나는 재료로 치지 않는다.
    reachable(aliveTargets, alivePlanets) {
      const stock = def.loose ? 2 * Math.floor(alivePlanets / 2) : aliveTargets
      return this.done + stock >= this.need
    },
    label() { return `${this.title} ${this.done}/${this.need}` },
    causeLabel(cause) { return CAUSE_KO[cause] ?? cause },
  }
}
