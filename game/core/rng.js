// 시드 고정 난수. 같은 시드면 같은 판이 나온다 — 자동 플레이 계측과 회귀 테스트가
// 재현 가능해야 해서 Math.random()은 게임 로직 어디에도 쓰지 않는다.

/** 문자열/숫자 시드를 32비트 정수로 뭉갠다. */
export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0
  const s = String(seed ?? '')
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export class Rng {
  constructor(seed = 1) {
    this.seed = hashSeed(seed)
    this._s = this.seed || 1
  }

  /** [0, 1) */
  next() {
    // mulberry32
    this._s = (this._s + 0x6d2b79f5) >>> 0
    let t = this._s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [min, max) 실수 */
  float(min, max) {
    return min + this.next() * (max - min)
  }

  /** [min, max] 정수 */
  int(min, max) {
    return Math.floor(this.float(min, max + 1))
  }

  /** 배열에서 하나 */
  pick(arr) {
    if (!arr || arr.length === 0) return undefined
    return arr[Math.floor(this.next() * arr.length)]
  }

  /** 확률 p로 true */
  chance(p) {
    return this.next() < p
  }

  /** 제자리 섞기(복사본 반환) */
  shuffle(arr) {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  /**
   * 가중치 선택. entries는 [{ key, weight }] 또는 Map 형태의 [key, weight] 쌍.
   * 가중치 합이 0이면 균등 선택으로 떨어진다.
   */
  weighted(entries) {
    const list = entries.map((e) => (Array.isArray(e) ? { key: e[0], weight: e[1] } : e))
    const positive = list.filter((e) => e.weight > 0)
    if (positive.length === 0) return this.pick(list)?.key
    const total = positive.reduce((s, e) => s + e.weight, 0)
    let r = this.next() * total
    for (const e of positive) {
      r -= e.weight
      if (r <= 0) return e.key
    }
    return positive[positive.length - 1].key
  }

  /** 자식 난수기 — 서브시스템이 서로의 난수열을 흔들지 않게 분리한다. */
  fork(tag) {
    return new Rng(hashSeed(`${this.seed}:${tag}:${this._s}`))
  }
}
