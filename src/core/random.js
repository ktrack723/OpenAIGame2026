export class Rng {
  s
  constructor(seed) { this.s = seed >>> 0 || 1 }
  next() { this.s ^= this.s << 13; this.s ^= this.s >>> 17; this.s ^= this.s << 5; return (this.s >>> 0) / 4294967296 }
  range(a, b) { return a + (b - a) * this.next() }
  int(a, b) { return Math.floor(this.range(a, b + 1)) }
  pick(xs) { return xs[this.int(0, xs.length - 1)] }
}
