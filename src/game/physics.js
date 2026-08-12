import { CFG, R_SCALE, blastRadius, contactDist, radiusOf } from './config.js'
import { cloneBody, makeBody } from './body.js'
import { effDv } from './roles.js'
import { clone, vec } from '../core/vector.js'

// ─── T1-1: N체 가속도 — 태양(원점 고정) + 행성 상호작용 (§4.2) ───
// 전 천체를 한 번에 훑어 평탄 배열에 쓴다. 천체마다의 합산 순서(태양 → j 오름차순)는
// 예전 accelOn과 완전히 같다 — **순서가 바뀌면 부동소수 결과가 바뀐다.** 예측이
// 실제 판과 비트 단위로 같은 궤적을 내야 하므로 이 순서는 성능보다 우선한다.
// (쌍대칭으로 절반을 아낄 수 있지만 그건 합산 순서를 바꾼다 — 하지 않는다.)
function accelAll(bodies, ax, ay) {
  const n = bodies.length
  for (let i = 0; i < n; i++) {
    const bi = bodies[i]
    if (!bi.alive) continue
    let dx = -bi.pos.x, dy = -bi.pos.y
    let d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS, inv = CFG.MU_STAR / (d2 * Math.sqrt(d2))
    let x = dx * inv, y = dy * inv
    for (let j = 0; j < n; j++) if (j !== i && bodies[j].alive) {
      const bj = bodies[j]; dx = bj.pos.x - bi.pos.x; dy = bj.pos.y - bi.pos.y
      d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS; inv = bj.mu / (d2 * Math.sqrt(d2))
      x += dx * inv; y += dy * inv
    }
    ax[i] = x; ay[i] = y
  }
}

// ─── T1-2: KDK 리프프로그 (§4.4). 트레일은 최근 20초 잔상(§14.2) ───
// 가속도 버퍼는 재사용한다 — 예측선 한 번이 수천 스텝을 도는데 스텝마다
// 천체 수만큼 객체를 새로 만들면 그게 곧 프레임 드랍이다(행성이 20개로 늘면서
// 이 비용이 세 배가 됐다). 재귀 호출이 없으므로 모듈 스코프 버퍼로 충분하다.
let _frame = 0
let _ax = new Float64Array(0), _ay = new Float64Array(0)

// stepBodies의 가속도 캐시. KDK에서 스텝 끝 가속도와 다음 스텝 시작 가속도는
// 같은 위치에서 계산되므로 **같은 값**인데, 예전에는 매 스텝 두 번 다 새로 풀었다.
// 캐시를 넘기면 절반이 사라진다 — 예측 루프(수백~수천 스텝 연속 호출)용이다.
// 규약: 캐시는 **하나의 연속된 시뮬 루프 안에서만** 쓴다. 두 stepBodies 호출 사이에
// 천체 위치를 밖에서 바꾸면(충돌 해소·워프·핵 폭풍의 위치 보정 등) 캐시가 거짓이
// 된다 — 그래서 라이브 루프(game.step)에는 넘기지 않는다. 예측 sim에서는 미사일이
// 천체를 못 건드리므로 항상 안전하다. 속도 변경은 무관하다(중력은 위치만의 함수).
export function makeStepCache() { return { ax: null, ay: null, n: -1, valid: false } }

export function stepBodies(bodies, dt, cache) {
  const n = bodies.length, h = dt / 2
  let ax, ay
  if (cache) {
    if (cache.n !== n) { cache.ax = new Float64Array(n); cache.ay = new Float64Array(n); cache.n = n; cache.valid = false }
    ax = cache.ax; ay = cache.ay
    if (!cache.valid) accelAll(bodies, ax, ay)
  } else {
    if (_ax.length < n) { _ax = new Float64Array(n); _ay = new Float64Array(n) }
    ax = _ax; ay = _ay
    accelAll(bodies, ax, ay)
  }
  for (let i = 0; i < n; i++) {
    const b = bodies[i]
    if (!b.alive) continue
    b.vel.x += ax[i] * h; b.vel.y += ay[i] * h
  }
  _frame++
  for (let i = 0; i < n; i++) {
    const b = bodies[i]
    if (!b.alive) continue
    b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt
    b.hitFlash = Math.max(0, b.hitFlash - dt); b.trailFlash = Math.max(0, (b.trailFlash || 0) - dt)
    b.bumpFlash = Math.max(0, (b.bumpFlash || 0) - dt)
    // 수명이 있는 천체(= 산탄. body.ttl)는 여기서 꺼진다. **예측도 같은 함수를
    // 쓰기 때문에** 여기여야 한다: bodyBounds에 두면 라이브 판에서만 사라져,
    // 조준 예측이 이미 없어졌을 파편을 "여기서 조기 격발한다"라고 말하게 된다.
    // 예측선이 거짓말을 안 하려면 시간에 대한 규칙도 한 군데에 있어야 한다.
    if (b.ttl > 0 && (b.ttl -= dt) <= 0) { b.alive = false; continue }
    if (b.trail && _frame % 8 === 0 && b.trail.push(clone(b.pos)) > 300) b.trail.shift()
  }
  accelAll(bodies, ax, ay)
  for (let i = 0; i < n; i++) {
    const b = bodies[i]
    if (!b.alive) continue
    b.vel.x += ax[i] * h; b.vel.y += ay[i] * h
  }
  if (cache) cache.valid = true
}

// ─── T1-3: 미사일 중력장 — 행성은 κ, 태양은 κ★ 배율 (§4.3). 예측선과 공용 ───
// κ★는 기획서 원본의 "태양 κ=1"을 노브로 뺀 것. 태양이 미사일을 지나치게
// 빨아들여 행성 곁을 그냥 스쳐 지나가던 문제(R1)를 잡는 용도이며,
// 행성끼리의 상호작용(accelAll)은 여전히 진짜 물리 κ=1이라 세계는 왜곡되지 않는다.
function fieldAccel(px, py, bodies, out) {
  let dx = -px, dy = -py
  let d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS, inv = CFG.KAPPA_STAR * CFG.MU_STAR / (d2 * Math.sqrt(d2))
  out.x = dx * inv; out.y = dy * inv
  for (const b of bodies) if (b.alive) {
    dx = b.pos.x - px; dy = b.pos.y - py
    d2 = dx * dx + dy * dy + CFG.EPS * CFG.EPS; inv = CFG.KAPPA * b.mu / (d2 * Math.sqrt(d2))
    out.x += dx * inv; out.y += dy * inv
  }
}

// 선분(직전 위치→현재 위치)이 원과 겹치는지. 점 판정만 하면 빠른 미사일이
// 행성 디스크를 한 스텝에 건너뛰어 "닿고도 통과"가 난다.
export function segHitsCircle(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax, dy = by - ay
  const fx = ax - cx, fy = ay - cy
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? -(fx * dx + fy * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const px = fx + dx * t, py = fy + dy * t
  return px * px + py * py < r * r
}

// 원에 "처음 닿는" 지점 — 폭심이다. 어느 쪽 살을 쳤는지가 곧 임펄스 방향이라
// 스텝 끝 위치(행성 속이나 반대편일 수 있다)를 그대로 쓰면 안 된다.
export function segCircleEntry(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax, dy = by - ay
  const fx = ax - cx, fy = ay - cy
  const a = dx * dx + dy * dy
  if (a < 1e-9) return { x: ax, y: ay }
  const b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r
  const disc = b * b - 4 * a * c
  if (disc < 0) return { x: ax, y: ay }              // 접선급 — 시작점이 가장 가깝다
  const t = (-b - Math.sqrt(disc)) / (2 * a)          // 첫 교점
  if (t <= 0) {                                       // 이미 원 안에서 시작 → 중심 반대편 표면으로 투영
    const l = Math.hypot(fx, fy) || 1
    return { x: cx + fx / l * r, y: cy + fy / l * r }
  }
  const tc = Math.min(1, t)
  return { x: ax + dx * tc, y: ay + dy * tc }
}

// 스텝당 객체를 만들지 않는다 — 예측 한 발이 6천여 스텝 × 천체 수를 돌므로
// 여기서의 할당(직전 위치·가속도 스크래치·근접 판정의 임시 벡터)이 곧 GC다.
// m.prev는 **제자리 갱신**한다: 붙들어 두는 호출부가 없음을 확인했고(모두 스텝
// 직후 읽고 버린다), 새로 생기는 호출부도 참조를 저장하면 안 된다.
const _fa = vec()   // fieldAccel 스크래치 — stepMissile은 재귀·중첩 호출이 없다
export function stepMissile(m, bodies, dt) {
  const pv = m.prev ?? (m.prev = { x: 0, y: 0 })   // 실탄은 prev 없이 생성된다(game.launch)
  pv.x = m.pos.x; pv.y = m.pos.y                    // 스윕 판정용 직전 위치
  let n = 1
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]
    if (!b.alive) continue
    const dx = b.pos.x - m.pos.x, dy = b.pos.y - m.pos.y, R = CFG.SUBSTEP_DIST * b.radius
    if (dx * dx + dy * dy < R * R) { n = CFG.SUBSTEP_N; break }
  }
  const a = _fa, sd = dt / n
  for (let s = 0; s < n; s++) {
    fieldAccel(m.pos.x, m.pos.y, bodies, a)
    m.vel.x += a.x * sd / 2; m.vel.y += a.y * sd / 2
    m.pos.x += m.vel.x * sd; m.pos.y += m.vel.y * sd
    fieldAccel(m.pos.x, m.pos.y, bodies, a)
    m.vel.x += a.x * sd / 2; m.vel.y += a.y * sd / 2
  }
  m.age += dt
  // 태양 가속 보너스 판정용 (§9.1). sqrt(x²+y²)는 hypot과 마지막 ulp에서만 다를
  // 수 있고, 이 값은 반경 450과 비교될 뿐이다.
  m.minSunDist = Math.min(m.minSunDist, Math.sqrt(m.pos.x * m.pos.x + m.pos.y * m.pos.y))
  // 트레일은 최근 ~6초만 (매 4스텝 기록 × 180점). TTL 52초치를 다 남기면
  // 화면이 실오라기로 뒤덮여 정작 공이 안 보인다.
  // 예측 프로브는 path: null로 만들어 기록을 통째로 건너뛴다 — 아무도 안 읽는다.
  if (m.path && ++m.pathN % 4 === 0 && m.path.push(clone(m.pos)) > 180) m.path.shift()
}

// ─── T1-4: 인카운터 트래커 (§5.2/5.4) — 진입/이탈 굴절각, 니어미스, 포획 ───
export function updateEncounters(m, bodies, ev) {
  for (const b of bodies) {
    if (!b.alive || b.type === 'debris') continue
    const dx = m.pos.x - b.pos.x, dy = m.pos.y - b.pos.y, d = Math.hypot(dx, dy)
    const zone = CFG.SWING_ZONE * b.radius
    const enc = m.enc.get(b.id)
    if (d < zone) {
      const ang = Math.atan2(dy, dx)
      if (!enc) m.enc.set(b.id, { vIn: { ...m.vel }, dMin: d, wrap: 0, lastAngle: ang })
      else {
        enc.dMin = Math.min(enc.dMin, d)
        let dA = ang - enc.lastAngle
        while (dA > Math.PI) dA -= 2 * Math.PI
        while (dA < -Math.PI) dA += 2 * Math.PI
        enc.wrap += Math.abs(dA) / (2 * Math.PI); enc.lastAngle = ang
        if (enc.wrap >= CFG.CAPTURE_WRAP) { m.enc.delete(b.id); ev.capture(b); return }   // 포획 → 강제 추락
      }
    } else if (enc) {
      m.encountered = true
      const dot = enc.vIn.x * m.vel.x + enc.vIn.y * m.vel.y
      const den = (Math.hypot(enc.vIn.x, enc.vIn.y) * Math.hypot(m.vel.x, m.vel.y)) || 1
      const deg = Math.acos(Math.max(-1, Math.min(1, dot / den))) * 180 / Math.PI
      m.bestDeflection = Math.max(m.bestDeflection, deg)
      if (enc.dMin < CFG.NEAR_MISS * b.radius) m.nearMiss++
      if (deg >= CFG.SWING_DEG) { m.chain++; ev.swing(b, deg) }
      m.enc.delete(b.id)
    }
  }
}

// ─── 핵 임펄스 — 이 게임의 큐 (§6.2 개정) ────────────────────────
// 규칙 한 줄: **입사각도 입사속도도 보지 않는다.**
// 방향 = 폭심 → 행성 중심 (= 공의 어느 살을 쳤는가),
// 크기 = 작약량 / 질량. 그래서 조준은 "어디를 맞히느냐" 하나로 환원된다.
export function applyNuke(b, blastX, blastY, yld) {
  let dx = b.pos.x - blastX, dy = b.pos.y - blastY
  const d = Math.hypot(dx, dy) || 1
  dx /= d; dy /= d
  const dv = effDv(b, yld)   // 장갑은 깎이고 특이점은 0 (roles.js)
  b.vel.x += dx * dv; b.vel.y += dy * dv
  b.hitFlash = 0.9; b.trailFlash = 2.0
  b.scorch = Math.min(3, (b.scorch || 0) + 1)   // 핵 맞은 자국이 표면에 남는다
  return { dx, dy, dv }
}

// 폭풍 — 폭심 반경 안의 다른 천체들도 약하게 밀린다. 작약량을 올릴수록
// 넓어지므로, 큰 탄두는 판 전체를 흔들고 지구까지 밀어낼 수 있다.
export function blastWave(bodies, blastX, blastY, yld, skip) {
  const R = blastRadius(yld), out = []
  for (const o of bodies) {
    if (!o.alive || o === skip) continue
    let dx = o.pos.x - blastX, dy = o.pos.y - blastY
    const d = Math.hypot(dx, dy)
    if (d > R || d < 1e-6) continue
    const falloff = 1 - d / R
    const dv = effDv(o, yld) * CFG.BLAST_PUSH * falloff * falloff
    o.vel.x += dx / d * dv; o.vel.y += dy / d * dv
    o.trailFlash = 1.5
    out.push({ body: o, dv })
  }
  return { radius: R, pushed: out }
}

// ─── 파편 생성 (§6.1): n = clamp(4+⌊μ/150⌋, 4, 9), 총질량 55% ───
export function shatter(b, bodies, rnd) {
  b.alive = false
  const n = Math.max(4, Math.min(9, 4 + Math.floor(b.mu / 150)))
  const muF = 0.55 * b.mu / n
  if (muF < 8) return   // 너무 작은 부스러기는 증발 처리
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * 2 * Math.PI + (rnd() - 0.5), sp = 25 + 40 * rnd()
    bodies.push(makeBody({
      id: `${b.id}f${bodies.length}`, nameKey: 'planet.debris', mu: muF, radius: Math.max(2.5 * R_SCALE, radiusOf(muF)),
      pos: { x: b.pos.x + Math.cos(ang) * b.radius * 1.3, y: b.pos.y + Math.sin(ang) * b.radius * 1.3 },
      vel: { x: b.vel.x + Math.cos(ang) * sp, y: b.vel.y + Math.sin(ang) * sp },
      type: 'debris', hp: 1,
    }))
  }
}

// ─── 샷건 (불안정 행성) ─────────────────────────────────────────
// 파편을 **한 방향으로** 뿌린다. 이게 shatter와 다른 전부다: shatter는 공이
// 부서져 사방으로 흩어지는 것(원)이고, 이건 쏘는 것(부채꼴)이다.
//
// 총구 방향 (dirX, dirY)은 부르는 쪽이 준다. 핵이면 폭심 → 행성 중심,
// 충돌이면 때린 공 → 맞은 공 — 둘 다 **핵 임펄스와 같은 벡터**다.
// 그래서 "어느 살을 치면 어디로 밀리나"를 이미 아는 플레이어는 이 총의
// 조준법을 따로 안 배운다. 밀리는 방향이 곧 쏘는 방향이다.
//
// 갈래는 부채꼴을 **고르게 나눠** 앉히고 각자 조금씩만 흔든다. 전부 난수로
// 뽑으면 일곱 발이 한쪽에 뭉치는 판이 나오는데, 그러면 같은 태그가 판마다
// 다른 물건이 된다 — 산탄의 값은 "넓게, 고르게"에 있다.
export function shardBurst(b, bodies, rnd, dirX, dirY) {
  b.alive = false
  const n = CFG.UNSTABLE_SHARDS, cone = CFG.UNSTABLE_CONE
  const muF = Math.max(6, CFG.UNSTABLE_MASS * b.mu / n)
  const rF = Math.max(2.5 * R_SCALE, radiusOf(muF))
  const base = Math.atan2(dirY, dirX)   // (0,0)이면 0 — 폭심이 정중앙인 극단은 +x로 쏜다
  for (let k = 0; k < n; k++) {
    const spread = n === 1 ? 0 : (k / (n - 1) - 0.5) * 2 * cone
    const ang = base + spread + (rnd() - 0.5) * cone * 0.3
    const sp = CFG.UNSTABLE_SPEED * (1 + (rnd() - 0.5) * CFG.UNSTABLE_SPEED_VAR)
    bodies.push(makeBody({
      id: `${b.id}s${bodies.length}`, nameKey: 'planet.debris', mu: muF, radius: rF,
      // 껍데기가 있던 자리에서 출발한다 — 중심에서 뿜으면 공 속에서 태어난 것처럼 보인다
      pos: { x: b.pos.x + Math.cos(ang) * b.radius * 1.15, y: b.pos.y + Math.sin(ang) * b.radius * 1.15 },
      vel: { x: b.vel.x + Math.cos(ang) * sp, y: b.vel.y + Math.sin(ang) * sp },
      type: 'debris', hp: 1, shard: 1, ttl: CFG.SHARD_TTL,
    }))
  }
}

// ─── 당구 충돌 — 운동량 보존 탄성 반사 ──────────────────────────
// 두 공은 서로를 부수지 않는다. 접촉면 법선 방향의 성분만 교환하고 튕긴다
// (반발계수 1 = 속력·운동량·에너지 전부 보존). 부수는 건 체력이 다 닳았을
// 때뿐이다 — 중립 행성은 세 번, 조르그 요새는 한 번(CFG.PLANET_HP / ZORG_HP).
// 반환값은 충돌 상대속도(데미지 판정용).
export function elasticBounce(a, b) {
  let nx = b.pos.x - a.pos.x, ny = b.pos.y - a.pos.y
  let d = Math.hypot(nx, ny)
  if (d < 1e-6) { nx = 1; ny = 0; d = 1 }
  nx /= d; ny /= d
  const rvx = b.vel.x - a.vel.x, rvy = b.vel.y - a.vel.y
  const vRel = Math.hypot(rvx, rvy)
  const vn = rvx * nx + rvy * ny
  if (vn < 0) {   // 서로 다가오는 중일 때만 튕긴다(멀어지는 쌍을 또 치면 붙어버린다)
    const j = -(1 + CFG.BOUNCE_RESTITUTION) * vn / (1 / a.mu + 1 / b.mu)
    a.vel.x -= j * nx / a.mu; a.vel.y -= j * ny / a.mu
    b.vel.x += j * nx / b.mu; b.vel.y += j * ny / b.mu
  }
  // 겹침 해소 — 안 떼어 놓으면 다음 스텝에 다시 접촉으로 잡혀 서로 물고 늘어진다
  const want = contactDist(a, b) * 1.02
  if (d < want) {
    const push = want - d, sa = b.mu / (a.mu + b.mu), sb = a.mu / (a.mu + b.mu)
    a.pos.x -= nx * push * sa; a.pos.y -= ny * push * sa
    b.pos.x += nx * push * sb; b.pos.y += ny * push * sb
  }
  return vRel
}

// ─── 카이퍼 벨트 = 당구대 쿠션 ──────────────────────────────────
// 추방은 없다. 벨트에 박으면 반경 방향 성분만 뒤집혀 되돌아온다.
// 속력은 그대로 두므로 "운동량만 유지한 채 방향이 바뀐다"가 정확히 성립한다.
// 반환값 = 충돌 지점(연출용) 또는 null.
export function beltBounce(o, beltR, restitution = CFG.BELT_RESTITUTION) {
  const r = Math.hypot(o.pos.x, o.pos.y)
  if (r < beltR) return null
  const nx = o.pos.x / (r || 1), ny = o.pos.y / (r || 1)
  const speed = Math.hypot(o.vel.x, o.vel.y)
  const vn = o.vel.x * nx + o.vel.y * ny
  if (vn > 0) {   // 바깥으로 향하는 성분만 반사 (안으로 들어오는 중이면 건드리지 않는다)
    o.vel.x -= (1 + restitution) * vn * nx
    o.vel.y -= (1 + restitution) * vn * ny
  }
  // 속력 재정규화 — 반발계수가 1이면 수학적으로 이미 같지만, 부동소수 누적으로
  // 벨트를 여러 번 때린 공이 조용히 빨라지거나 느려지는 걸 원천 차단한다.
  const s2 = Math.hypot(o.vel.x, o.vel.y)
  if (s2 > 1e-9 && speed > 1e-9) { o.vel.x *= speed / s2; o.vel.y *= speed / s2 }
  // 벨트 안쪽으로 살짝 밀어 넣는다 — 밖에 남아 있으면 매 스텝 재판정된다.
  // 눈에 띄는 순간이동이 되지 않게 최소한만 (벨트 반경의 0.2%).
  const back = beltR - Math.max(1.5, beltR * 0.002)
  o.pos.x = nx * back; o.pos.y = ny * back
  return { x: nx * beltR, y: ny * beltR, nx, ny, speed }
}

// ─── T1-7 개정: 행성끼리의 접촉 = 당구 충돌 (+체력 1 소모) ───────
// 접촉이 곧 사망이던 규칙을 없앴다. 접촉은 이제 "쳤다"이고, 체력이 다 닳아야 죽는다.
// 그래서 한 판에 공이 스무 개 굴러다녀도 판이 저절로 정리되지 않는다.
export function resolveBodyPairs(bodies, game) {
  const n = bodies.length
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = bodies[i], b = bodies[j]
    if (!a || !b || !a.alive || !b.alive) continue
    const aD = a.type === 'debris', bD = b.type === 'debris'
    if (aD && bD) continue
    // 제곱 비교 — n=34면 스텝마다 561쌍이라 임시 벡터·hypot이 그대로 GC 압력이다
    const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, cd = contactDist(a, b)
    if (dx * dx + dy * dy >= cd * cd) continue
    if (aD || bD) {
      // 파편은 행성 대기권에서 소멸한다 — **닿는 순간 그 자리에서 끝난다.**
      // 튕겨 나가게 두면 이미 부서진 공의 부스러기가 판을 영영 굴러다닌다.
      const frag = aD ? a : b, hit = aD ? b : a
      frag.alive = false
      // 산탄만 때린다(body.shard 주석). 무엇에 얼마나 꽂혔는지는 게임이 정한다 —
      // 여기서는 "닿았다"까지만 말하고, 배열이 바뀌었으면 그 스텝을 끝낸다.
      if (frag.shard && game.onShardHit(frag, hit) === 'destroyed') return
      continue
    }
    // 파괴가 일어나면 파편 생성으로 배열이 변한다 — 그 스텝은 거기서 끝낸다
    if (game.onPlanetCollision(a, b) === 'destroyed') return
  }
}

// 복제본도 정본 형태로 만든다 — 예측선이 이 배열 위에서 수천 스텝을 도는데,
// 형태가 흐트러지면 그 자리에서 프레임이 무너진다(body.js 주석 참고).
export function cloneBodies(bodies) { return bodies.map(cloneBody) }

// ─── 예측 공용: 천체 궤적 트랙 ──────────────────────────────────
// 예측 안에서 미사일은 천체에 아무 영향도 주지 않는다 — fieldAccel은 단방향이고,
// 예측 sim에서는 충돌 해소도 기폭도 돌지 않는다. 그러므로 같은 판에서 각도·파워만
// 바꿔 가며 수백 발을 굴릴 때 **천체 궤적은 전부 같다.** 발마다 판을 복제해
// 처음부터 다시 적분하는 대신(접촉각 탐색이 정확히 그랬다 — 240각도 × 천체 적분
// 전체), 한 번만 굴려 위치를 기록해 두고 발마다 재생한다.
//
// 기록 스케줄은 소비자 루프와 동일하다: 미사일 스텝 i마다 i % every === every>>1
// 일 때 천체가 dt×every 만큼 굴러간다(aim.js bodyTurn과 같은 규칙). 같은
// stepBodies를 같은 순서로 돌려 기록하므로, 재생된 위치는 발마다 따로 굴렸을
// 때와 비트 단위로 같다 — 답이 달라질 여지가 없다.
export function buildBodyTrack(bodies, dt, every, steps) {
  const view = cloneBodies(bodies), n = view.length
  let frames = 1
  for (let i = 0; i < steps; i++) if (i % every === (every >> 1)) frames++
  const pos = new Float64Array(frames * n * 2)
  const cache = makeStepCache()
  for (let j = 0; j < n; j++) { pos[j * 2] = view[j].pos.x; pos[j * 2 + 1] = view[j].pos.y }
  let f = 0
  for (let i = 0; i < steps; i++) {
    if (i % every !== (every >> 1)) continue
    stepBodies(view, dt * every, cache)
    const base = ++f * n * 2
    for (let j = 0; j < n; j++) { pos[base + j * 2] = view[j].pos.x; pos[base + j * 2 + 1] = view[j].pos.y }
  }
  return { view, pos, n }
}

// f프레임(= 천체 스텝 f회 뒤)의 위치를 뷰에 되쓴다. 재생은 프레임 0부터:
// trackFrame(t, 0) → 스텝 루프에서 bodyTurn마다 trackFrame(t, ++f).
// ※ 트랙에는 **위치만** 있다 — 뷰의 vel은 빌드가 끝난 시점의 값으로 남아 있다.
//   트랙 소비자(coarseContact·reachable)는 천체 속도를 읽지 않으므로 충분하고,
//   속도를 읽어야 하는 예측(firstImpact의 상대 진입속도 등)은 트랙을 쓰면 안 된다.
export function trackFrame(t, f) {
  const base = f * t.n * 2, view = t.view, pos = t.pos
  for (let j = 0; j < t.n; j++) {
    const p = view[j].pos
    p.x = pos[base + j * 2]; p.y = pos[base + j * 2 + 1]
  }
}
