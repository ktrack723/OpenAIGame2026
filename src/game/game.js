import { fromAngle, len } from '../core/vector.js'
import { Rng } from '../core/random.js'
import { CFG, aMaxOf, beltRadius, escapeSpeed, hitRadiusOf } from './config.js'
import {
  applyNuke, beltBounce, blastWave, cloneBodies, elasticBounce, missilePush, resolveBodyPairs,
  segCircleEntry, segHitsCircle, shardBurst, shatter, stepBodies, stepMissile, sweepMeet,
  updateEncounters, volatilePushOn,
} from './physics.js'
import { hasRole, roleOf, shardReach, volatileRadius } from './roles.js'
import { makeGoal } from './objectives.js'
import { msg, nameOf } from '../i18n/index.js'
import { bearing } from '../core/angle.js'
import { createSystem, reinforce, sendCueBall } from './system.js'
import { earthShove } from './aim.js'
import { stepComets } from './comet.js'
import { makeBody } from './body.js'
import { chargeLeft, impactLeft, makeDoom, makeLaser, propagate, stepDoom, stepLaser, stepSpent, LASER_CHARGE, LASER_SPENT, LASER_TRAVEL } from './laser.js'
import {
  abortSiegeGun, makeSiegeGun, makeSiegeShot, siegeLeft, stepSiegeGun, stepSiegeShot, SIEGE_LOCK,
} from './siege.js'
import * as Aim from './aim.js'

// 관측 모드 배속 단계 — 화면의 배속 버튼이 이 사이를 돈다
const OBS_SPEEDS = [1, 2, 4, 8]

// 정치자금이 안 붙는 파괴 사유. **조르그가 제 광선으로 부순 것은 내 공이 아니다** —
// 예전 점수표에서도 laser만 0점이었고, 화폐가 바뀌어도 그 규칙은 그대로다.
const NO_CREDIT = new Set(['laser'])

// 조르그 하나를 부순 값. 등급은 **체력 상한 하나**로 갈린다 — 요새는 전부
// 체력 1이고, 그보다 단단한 것은 대형 요새(2)와 초엘리트뿐이다. 별도의 등급
// 표를 두지 않는 이유는 그 표가 곧 두 번째 진실이 되기 때문이다: 새 조르그가
// 생겼을 때 한쪽만 고치면 값이 조용히 틀어진다. 체력은 이미 화면에 보인다.
const polFor = (b) => ((b.hpMax ?? 1) > 1 ? CFG.POL_FORT_ELITE : CFG.POL_FORT)

export class Game {
  constructor(seed) {
    this.bodies = []
    // 같은 쌍이 한 번의 접촉에서 여러 스텝 붙어 있어도 피해는 한 번만 센다
    this.pairCool = new Map()
    this.resetRun(seed)
  }

  // ─── 런을 처음부터 다시 ──────────────────────────────────────
  // **객체 정체성을 유지한다.** 렌더러·HUD·카메라가 전부 이 인스턴스와 이
  // bodies 배열을 붙들고 있으므로, 새 Game을 만들면 그 참조를 전부 다시 이어야
  // 한다. 제자리에서 갈아 끼우면 아무것도 안 건드려도 된다.
  // (오프닝 예고편이 실제 게임을 굴려 보여 준 뒤 판을 되돌리는 데 쓴다.)
  resetRun(seed = this.seed) {
    this.seed = seed >>> 0
    // 판 번호는 **1부터**다. 이 게임에 난이도 눈금은 이것 하나뿐이다 —
    // 예전에 있던 안테(= 1 + ⌊판/3⌋)는 없앴다(config.STAGE_CAP 주석 참고).
    this.stage = 1; this.runOver = false
    this.rng = new Rng(this.seed ^ 0x9e3779b9)
    // ─── 런 지갑 ───
    // **여기서만 초기화한다.** loadStage()는 이 줄들을 절대 안 건드리므로 판이
    // 바뀌어도 잔액·구매·재고가 그대로 넘어가고, 새 런에서만 0으로 돌아간다.
    // (지구 체력이 판을 넘어가는 것과 같은 규칙이다 — 아래 주석 참고.)
    // 예고편도 끝나면서 resetRun을 부르므로, 트레일러가 번 돈은 자동으로 지워진다.
    this.pol = 0            // 잔액
    this.polEarned = 0      // 총 획득 — 패배 화면이 "이번 런에 얼마나 벌었나"를 말한다
    this.polFlash = 0       // 획득 표시 펄스(실시간 초)
    this.buys = { speed: 0, yield: 0 }
    // 추진기는 **한 발을 쥐고 시작한다.** 상점에서만 얻는 물건이면 첫 판에서는
    // 존재조차 모르는 채로 첫 광선을 맞는데, 이건 레이저에 대한 네 가지 대응
    // 중 하나다 — 한 번은 써 보고 나서 살지 말지를 정하는 게 맞다.
    this.thrusters = CFG.THRUST_START
    // 상한은 **CFG가 아니라 런 상태**다. CFG.YIELD_MAX는 판 생성이 "밀 수 있는
    // 큐볼인가"를 재는 데 쓰므로(system.js), 그걸 올리면 난이도 곡선이 빌드에
    // 따라 흔들린다. 클램프는 HUD 스테퍼 두 곳뿐이라 여기서 주는 편이 싸다.
    this.powerMax = CFG.LAUNCH_MAX
    this.yieldMax = CFG.YIELD_MAX
    // ─── 지속 성계 ───
    // 성계는 런 전체에서 하나뿐이다. 판이 끝나도 새로 만들지 않고,
    // 살아남은 행성이 위치·속도·**체력** 그대로 다음 판으로 넘어간다.
    // 체력이 이어지는 건 특히 지구가 그렇다 — 한 판에서 두 번 처박힌 지구는
    // 1/3으로 다음 판을 시작한다. 판마다 리셋되면 "지구를 지킨다"가 한 판짜리
    // 임무가 되어 버리는데, 이 게임의 판돈은 런 전체다.
    // (loadStage는 hp를 건드리지 않는다. 체력을 쓰는 곳은 damage() 하나뿐이다.)
    const sys = createSystem(this.seed)
    this.bodies.length = 0; this.bodies.push(...sys.bodies)   // 배열 정체성 유지
    this.earth = sys.earth
    this.lasers = []          // 살아 있는 포대 하나당 하나 (syncLasers가 명단을 관리한다)
    this.sieges = []          // 살아 있는 초엘리트 하나당 포 하나 (syncSieges)
    this.foeShots = []        // 초엘리트가 쏜 탄. 내 탄(missiles)과 따로 산다 — 아래 주석
    this.pairCool.clear()
    this.loadStage()
  }

  // 카이퍼 벨트 반경 — 성계의 쿠션. aMax가 판마다 커지므로 파생값으로 둔다.
  get beltR() { return beltRadius(this.aMax) }

  // ─── 작전 시한 (인게임 시간) ───
  // this.time은 step()에서만 누적되고, step()은 effTimeScale()>0일 때만 돈다.
  // → 조준만 하고 있으면 시계가 멈춰 있고, 관측하거나(플레이어가 고른 배속)
  //   조준 중에 시간 진행 버튼을 누르고 있을 때만 줄어든다.
  // 초엘리트가 온 판은 목표가 하나 더 — 그만큼 더 준다.
  // (판이 열릴 때 정해 두고 안 바꾼다. 부순 순간 시계가 줄어들면
  //  "부쉈더니 손해"가 되는데, 그건 이 물건이 주려는 판단이 아니다.)
  // 시한은 **이번 판에 세워진 표적 수**를 센다(TIME_PER_THREAT). 판 번호만 보던
  // 예전 식은 톱니를 만들었다: 요새 마릿수는 두 판에 한 기씩 계단으로 뛰는데
  // 시한은 판마다 고르게 오르니, 마릿수가 뛰는 판(3·5·7·9판)에서만 표적 하나에
  // 주어지는 시간이 뚝 떨어졌다 — 계측한 톱니가 이렇다:
  //   320 · 331 · 228 · 235 · 170 · 174 · 149 · 152 · 134 · 137초
  // 7판이 149초로 그 골짜기 하나였고, 실제로 자동 플레이가 4시드 중 1건만
  // 뚫었다(그 한 건도 시한의 96%를 썼다). 바로 다음 8판은 152초로 더 헐거웠다.
  // 표적 수를 세면 골짜기가 사라진다 — 어려워지는 것은 그대로 두되(판마다
  // 표적 하나당 시간은 계속 줄어든다) **뛰는 판만 벌하지 않는다.**
  get stageTime() {
    const grow = Math.min(this.stage - 1, CFG.STAGE_CAP - 1)
    // 판이 열릴 때 짜인 명단이다(loadStage). 부숴도 안 줄어든다 — 부순 순간
    // 시계가 줄면 "부쉈더니 손해"가 되는데, 그건 이 물건이 주려는 판단이 아니다.
    const threats = this.targets?.length ?? 0
    return CFG.TIME_BASE + CFG.TIME_PER_STAGE * grow + CFG.TIME_PER_THREAT * threats
      + (this.siegeHere ? CFG.SIEGE_TIME : 0)
  }
  get timeLeft() { return Math.max(0, this.stageTime - this.time) }

  // ─── 정치자금 ───────────────────────────────────────────────
  // 버는 곳은 두 군데뿐이다(스윙바이·요새 격파). 그 둘이 여기로 모인다.
  // x·y는 **그 일이 벌어진 자리** — 화면에 "+1"이 거기서 떠오른다.
  addPol(n, x, y) {
    if (n <= 0) return
    this.pol += n; this.polEarned += n
    this.polFlash = 0.9
    this.addFx({ kind: 'pol', x, y, n })
  }

  loadStage() {
    this.aMax = aMaxOf(this.stage)
    this.fx = []   // 렌더러가 매 프레임 비워가는 연출 이벤트 큐 (§14.5)
    // 잔해만 **제자리에서** 걷어낸다. 배열을 새로 만들면 렌더러가 성계를 통째로
    // 다시 짓고 카메라가 튀어서 판 사이에 화면이 끊긴다 — 이 게임은 성계가
    // 런 내내 하나로 이어지는 게 전제이므로 그 끊김이 거짓말이 된다.
    // (혜성도 같이 걷는다 — 판을 넘기면 그 손님은 지나간 것이다. 남겨 두면
    //  다음 판의 증원이 "지나가는 공" 옆에 요새를 세우는 일이 생긴다.)
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]
      if (!b.alive || b.type === 'debris' || b.comet) this.bodies.splice(i, 1)
    }
    // 조르그 증원 — 지금 성계에 남은 것을 보고 그만큼만 보낸다.
    // 한꺼번에 뿅 나타나지 않고 **순서대로** 워프해 들어온다(stepWarpIns).
    const { added, fortresses, sieges } = reinforce(this.rng, this.bodies, this.earth, this.stage)
    // 마릿수가 많으면 간격을 조여 도착 전체를 WARP_SPAN 안에 담는다 —
    // 막이 마지막 한 기까지 기다리므로, 간격이 고정이면 후반 개막이 10초를 넘는다.
    const gap = added.length > 1
      ? Math.min(CFG.WARP_STAGGER, CFG.WARP_SPAN / (added.length - 1))
      : CFG.WARP_STAGGER
    added.forEach((b, i) => { b.alive = false; b.warp = 1; b.warpIn = CFG.WARP_LEAD + i * gap })
    // 스폰이 끝나는 시각 = 마지막 도착 + 그 한 기가 다 나타나는 데 걸리는 시간.
    // 렌더러가 b.warp를 WARP_TIME에 걸쳐 0으로 내리므로, 마지막 warpIn만 보고
    // 막을 걷으면 요새가 아직 반투명한 채로 조작이 열린다.
    this.spawnEnd = added.length ? CFG.WARP_LEAD + (added.length - 1) * gap + CFG.WARP_TIME : 0
    // 개막 시계는 **여기서** 0으로 돌린다. 아래쪽(초기화 묶음)에서 돌리면 그
    // 사이에 있는 syncLasers가 지난 판의 openT를 보고 "이미 열린 판"으로 읽는다.
    this.openT = 0
    // 개막 동안 카메라가 따라다닐 명단. 도착 순서대로다(카메라가 그 순서로 민다).
    this.arrivals = added
    // 표적 = 조르그 요새 + 초엘리트. 이것들만 전멸시키면 판이 끝난다.
    this.targets = this.bodies.filter(b => (b.alive || (b.warpIn ?? 0) > 0) && this.isTarget(b))
    this.goal = makeGoal(this.targets)
    this.siegeHere = this.targets.some(b => b.role === 'siege')
    // 혜성 시계 — 판마다 처음부터 센다(첫 방문은 COMET_FIRST 뒤)
    this.cometT = 0; this.cometN = 0
    // 포대 명단은 판마다 새로 짠다 — 시차(순번)를 처음부터 다시 세워야 하고,
    // 새 판이 시작하자마자 지난 판의 충전이 이어져 발사되면 안 된다.
    // 초엘리트의 포와 그 탄도 같은 이유로 같이 비운다: 판이 열리는 순간에
    // 지난 판의 조준이 살아 있으면 개막부터 지구로 공이 굴러온다.
    this.lasers.length = 0
    this.sieges.length = 0
    this.foeShots.length = 0
    this.syncLasers()
    this.syncSieges()

    this.pairCool.clear()
    this.doom = null; this.mothership = null
    this.missiles = []; this.shots = 0
    this.won = false; this.lost = false; this.failReason = null
    const t = this.target
    this.aim = Math.atan2(t.pos.y - this.earth.pos.y, t.pos.x - this.earth.pos.x)
    this.power = 30; this.yieldMt = CFG.YIELD_DEFAULT
    this.mode = 'aim'; this.advancing = false; this.time = 0; this.paused = false
    this.warpHold = this.warpHold ?? false
    this.dodgeT = 0   // 요새 회피 판정 주기 타이머
    this.obsSpeed = 1   // OBS_SPEEDS 인덱스 — 기본 2×
    this.toast = null; this.toastT = 0
    this.timeWarn = 0
    this.stageRoles = this.presentRoles()
    // ── 규칙은 **필요할 때** 알려 준다 ──
    // 예전에는 판마다 같은 문단을 통째로 읽혔다: 체력 1 요새, 2판부터 오는
    // 대형, 3판부터 달려 오는 추진기. 1판에서는 뒤의 둘이 아직 없는데도
    // 그 설명을 먼저 읽는 셈이라, 정작 지금 필요한 한 줄이 그 안에 묻혔다.
    // 이제 기본 규칙 한 줄에 **이번 판에 실제로 있는 것만** 덧붙인다.
    // (문구는 **번역 전 상태로** 이어 붙인다 — msg()는 {키, 값}일 뿐이고
    //  화면에 뜨는 순간에 번역된다. 여기서 문자열로 굳히면 판이 도는 중에
    //  언어를 바꿨을 때 이 줄만 옛 언어로 남는다.)
    let rule = msg('goal.rule')
    const add = (k) => { rule = msg('ui.join', { a: rule, b: msg(k) }) }
    if (fortresses.some(b => (b.hpMax ?? 1) > 1)) add('goal.heavy')
    if (fortresses.some(b => b.boost > 0)) add('goal.boost')
    if (sieges.length) add('goal.siege')
    this.message = added.length
      ? msg('msg.stage.reinforce', { n: fortresses.length, rule })
      : msg('msg.stage.open', { rule })
  }

  // 이 판에 깔린 태그 목록(패널 범례용).
  // **아직 워프해 들어오는 중인 것도 센다** — 이 함수는 loadStage에서 불리는데
  // 그 시점의 증원은 전부 alive=false(도착 대기)라, 살아 있는 것만 세면 방금
  // 도착한 요새·초엘리트의 칩이 범례에서 통째로 빠진다.
  presentRoles() {
    const set = new Set()
    for (const b of this.bodies) {
      if (!b.alive && !(b.warpIn > 0)) continue
      if (b.role) set.add(b.role)
    }
    return [...set]
  }

  nextStage() {
    if (!this.won || this.runOver) return
    // 정산할 것이 없다 — 정치자금은 벌 때 바로 지갑에 들어가고 판을 넘어 그대로 간다.
    this.stage++; this.loadStage()
  }

  // 목표 행성 — 살아 있는 요새 우선. 카메라/레티클이 물고 있을 대상이다.
  // 요새가 다 죽었으면(=클리어) 마지막 요새를 그대로 들고 있는다.
  get target() {
    return this.targets.find(t => t.alive) || this.targets[0] || this.earth
  }
  // 위협 = 조르그 요새 + 초엘리트. 이것들만 전멸시키면 판이 끝난다.
  get aliveFortresses() { return this.bodies.filter(b => b.alive && b.role === 'battery').length }
  get aliveSieges() { return this.bodies.filter(b => b.alive && b.role === 'siege').length }
  get aliveThreats() { return this.aliveFortresses + this.aliveSieges }
  // 아직 도착 안 한 표적 — 워프 중이라 화면에도 없고 alive도 아니지만, 목표
  // 숫자에는 이미 들어가 있다(loadStage의 targets).
  // 승리 판정은 이것까지 봐야 한다(win).
  get warpingThreats() {
    let n = 0
    for (const b of this.bodies) if (!b.alive && (b.warpIn ?? 0) > 0 && this.isTarget(b)) n++
    return n
  }
  // id로 비교한다 — 예측선은 cloneBodies()가 만든 복제본을 넘기므로
  // 참조 비교를 쓰면 "예측에서는 목표가 목표가 아닌" 사고가 난다.
  // 표적 = 조르그 요새. 규칙이 하나로 통일됐으므로 id 목록이 아니라
  // 성질로 판정한다 — 예측선이 넘기는 복제본에서도 그대로 성립한다.
  isTarget(b) { return b.role === 'battery' || b.role === 'siege' }
  get aliveTargets() { return this.aliveThreats }

  launchPos() {
    const d = CFG.LAUNCH_OFFSET   // 지구 중력권 밖에서 발사 (§4.3 κ 증폭 때문)
    return { x: this.earth.pos.x + Math.cos(this.aim) * d, y: this.earth.pos.y + Math.sin(this.aim) * d }
  }

  // 지구 발사점에서의 κ증폭 탈출속도. 이 아래로 쏘면 탄이 지구 중력에
  // 붙잡혀 되떨어진다 = 자기 지구에 핵을 박는다.
  get launchEscape() { return escapeSpeed(this.earth.mu, CFG.LAUNCH_OFFSET) }

  // 탄약이 아니라 **차례**가 자원이다 — 다만 자리가 둘이다(CFG.MAX_INFLIGHT).
  // inFlight = 지금 판 위에 내 탄이 있는가(화면·연출이 묻는 값),
  // salvoFull = 자리가 다 찼는가(발사가 막히는 조건). 둘은 다른 질문이다:
  // 한 발이 날고 있어도 다음 한 발은 쏠 수 있고, 그 두 번째 발로 첫 발을
  // 치는 것이 이 규칙이 열어 준 수다(crossFire).
  get flying() { let n = 0; for (const m of this.missiles) if (m.alive) n++; return n }
  get inFlight() { return this.flying > 0 }
  get salvoFull() { return this.flying >= CFG.MAX_INFLIGHT }

  // ─── 시한이 끝난 뒤 ─────────────────────────────────────────
  // 시한을 넘겨도 **날고 있는 마지막 한 발은 끝까지 보내준다**(checkEnd). 그 유예는
  // "탄이 하나도 안 남았을 때 모성을 부른다"로 적혀 있는데, 자리가 둘이 되면서
  // 거기가 구멍이 됐다: 한 발이 죽기 전에 다음 발을 쏘면 **0이 되는 순간이 영영
  // 안 온다.** 계측에서 아무렇게나 여덟 발을 쏘아 152초를 벌었고, 한 판은 시한을
  // 110초 넘겨서 클리어됐다 — 시계가 판정에서 통째로 빠진 것이다.
  //
  // 그래서 시한이 지나면 **발사가 닫힌다.** 유예는 이미 나간 발의 것이지 새 발의
  // 것이 아니다. 모성이 와 있는 동안(doom)은 예외다 — 저것을 부수는 유일한 길이
  // 공을 던지는 것이라, 거기서 발사를 막으면 마지막 길이 닫힌다.
  get pastDeadline() {
    return !this.doom && !this.won && !this.lost && this.time >= this.stageTime
  }

  fire() {
    // 모성이 와 있어도 쏜다 — 저것을 부수는 유일한 길이 공을 던지는 것이다.
    if (this.won || this.lost || !this.earth.alive) return
    if (this.warpCurtain) return   // 개막 중 — 아직 내 차례가 아니다
    // 순서가 규칙이다. 시한이 먼저다 — 자리가 다 찼는지를 먼저 보면, 마지막
    // 몇 초에 두 발을 걸어 둔 플레이어에게 "하나가 결판나면 다음 발"이라고
    // **거짓말**을 하게 된다(그 다음 발은 영영 없다). 그 순간에 해야 할 말은
    // "시한이 끝났다" 하나뿐이고, 그래야 남은 수(추진기·관측)를 찾는다.
    if (this.pastDeadline) {
      this.setToast(msg('toast.deadline'))
      return
    }
    if (this.salvoFull) {
      this.setToast(msg('toast.salvoFull', { n: CFG.MAX_INFLIGHT }))
      return
    }
    if (this.power <= this.launchEscape) {
      this.setToast(msg('toast.slow', { v: this.launchEscape.toFixed(1) }))
      return
    }
    const p = this.launchPos(), v = fromAngle(this.aim, this.power)
    this.shots++
    this.missiles.push({
      // 탄에도 이름을 붙인다 — 예측선이 "저 탄을 친다"고 말하려면 그 탄을
      // 가리킬 이름이 있어야 한다(aim.predictPath → Scene의 리드선).
      // 천체 id는 z…/c… 라 겹치지 않는다.
      id: `m${this.shots}`,
      pos: { ...p }, vel: v, yld: this.yieldMt, alive: true, chain: 0, nearMiss: 0, age: 0, fade: 0,
      path: [{ ...p }], pathN: 0, enc: new Map(), bestDeflection: 0,
      encountered: false, minSunDist: Infinity, hit: null, out: null, relayed: 0,
    })
    this.addFx({ kind: 'launch', x: p.x, y: p.y, a: this.aim })
    this.message = msg('msg.away', { yield: this.yieldMt })
    // 쏘면 자동으로 관측 모드로 넘어간다 — 쏜 뒤엔 보는 게 할 일이다.
    // 언제든 조준 모드를 다시 켜면 미사일이 날아가는 도중에도 판이 멈춘다.
    this.setMode('observe')
  }

  // 연출 이벤트 큐. onFx는 **읽기 전용 방청석**이다 — 지상 관제(Ground)가
  // 발사·명중·격파 같은 순간을 여기서 주워 듣는다. 렌더러가 매 프레임 fx를
  // 비워 버리므로 큐를 나중에 보는 걸로는 못 잡는다.
  //
  // 방청석이 둘이 되면서(관제 + 소리) 자리를 하나 더 뒀다. onFx는 예전부터
  // 있던 **한 자리짜리 구멍**이라 그대로 두고(거기 앉은 쪽이 바뀌면 안 된다),
  // 새로 듣겠다는 쪽은 onFxAdd로 줄을 선다. 둘 다 큐에 쌓기 **전에** 불린다 —
  // 렌더러가 프레임마다 큐를 비우므로 나중에 보는 걸로는 못 잡는다.
  onFxAdd(fn) {
    (this._fxSubs ??= []).push(fn)
    return () => { const i = this._fxSubs.indexOf(fn); if (i >= 0) this._fxSubs.splice(i, 1) }
  }
  addFx(e) {
    this.onFx?.(e)
    if (this._fxSubs) for (const fn of this._fxSubs) fn(e)
    if (this.fx.length < 96) this.fx.push(e)
  }

  // ─── 두 가지 모드 ───────────────────────────────────────────
  // **조준 모드** — 판이 멈춘다. 미사일이 날아가는 중이라도 멈춘다.
  //   당구에서 큐를 잡고 서 있는 시간에 해당한다. 재고, 각도를 재고,
  //   다음 수를 생각하는 동안 세계가 흐르면 그건 반사신경 게임이 된다.
  //   다만 **조준 모드에서도 시간을 흘릴 수 있다**(advance) — 조준선을 고정한 채
  //   판이 어떻게 굴러가는지 조금씩 보내 보는 게 이 게임의 핵심 조작이다.
  // **관측 모드** — 판이 흐른다. UI는 전부 사라지고 화면만 남는다.
  //   배속은 플레이어가 고른다(1·2·4·8×). 미사일이 날고 있는 동안에는
  //   제대로 보라고 한 단계 낮춰 준다.
  setMode(m) {
    if (m !== 'aim' && m !== 'observe') return
    if (this.mode === m) return
    this.mode = m
    this.advancing = false
    if (m === 'aim') this._predKey = null   // 멈춘 순간의 판으로 예측을 다시 푼다
  }
  toggleMode() { this.setMode(this.mode === 'aim' ? 'observe' : 'aim') }

  effTimeScale() {
    // 연출이 판을 붙잡고 있는 동안(오프닝 예고편의 도입부)은 아무것도 안 흐른다.
    // 조준 모드로 세우는 것과 다른 이유가 있다 — 조준 모드는 조준 가이드를
    // 같이 켜 버리는데, 그 구간은 화면에 아무 UI도 없어야 한다.
    if (this.paused) return 0
    if (this.lost || this.won) return 0   // 클리어 후에는 시계를 세운다
    // ── 모성이 온 뒤 ──
    // **이 판만은 안 멈춘다.** 조준 모드로 들어가도 난사는 계속 온다(느려질 뿐이다).
    // 0으로 두면 조준 모드로 난사를 얼려 놓고 느긋하게 겨눌 수 있는데, 그러면
    // 마지막 장면이 그냥 한 판 더가 된다. 배속을 올리는 것도 막는다 — 저쪽의
    // 시간이다. 진행 버튼(SHIFT)을 누르는 동안에만 제 속도로 흐른다.
    if (this.doom) return this.mode === 'aim' ? (this.advancing ? 1 : CFG.DOOM_AIM_SCALE) : 1
    if (this.mode === 'aim') {
      // 기본은 정지. 진행 버튼(SHIFT)을 누르고 있는 동안만 흐른다.
      if (!this.advancing) return 0
      return this.missiles.some(m => m.alive) ? 1 : 2   // 조준 중 시간 보내기
    }
    // 관측 배속은 플레이어가 고른다(obsSpeed). 미사일이 날 때는 제대로 보라고
    // 한 단계 낮춰 주고, 아무것도 안 날면 고른 배속 그대로 빨리 감는다.
    const s = OBS_SPEEDS[this.obsSpeed] ?? 2
    return this.missiles.some(m => m.alive) ? Math.max(1, s / 2) : s
  }

  // 관측 배속 단계 — 버튼을 누를 때마다 다음 단계로 돈다
  cycleObsSpeed() {
    this.obsSpeed = (this.obsSpeed + 1) % OBS_SPEEDS.length
    return OBS_SPEEDS[this.obsSpeed]
  }
  get obsSpeedLabel() { return `${OBS_SPEEDS[this.obsSpeed]}×` }

  // 순차 워프인 — 실시간으로 돈다. 조준 모드라 판이 멈춰 있어도
  // "조르그가 하나씩 도착하는" 연출은 흘러야 한다.
  // 단 하나 예외가 warpHold다. 튜토리얼이 화면을 덮고 있는 동안 조르그가
  // 들어와 버리면, 규칙 설명을 다 읽고 나왔을 때 이미 도착이 끝나 있다 —
  // 첫 판에서 제일 먼저 봐야 할 장면을 오버레이 뒤에서 놓치는 것이다.
  // 그래서 튜토리얼을 닫는 순간부터 카운트다운이 시작된다.
  get warpPending() { return this.warpHold || this.bodies.some(b => (b.warpIn ?? 0) > 0) }
  // ─── 굴릴 공의 바닥을 판 도중에도 지킨다 ─────────────────────
  // system.sendCueBall이 "지금 모자란가"를 판단하고, 여기서는 **언제 묻는가**만
  // 정한다. 판이 열릴 때 채우는 것만으로는 130초면 바닥을 뚫는다(그쪽 주석의
  // 계측). 굴릴 공이 없으면 남은 표적을 죽일 방법이 아예 없으므로, 그 상태로
  // 시한을 흘려보내는 것은 난이도가 아니라 판이 멈춘 것이다.
  //
  // 워프인은 개막과 같은 연출을 그대로 탄다(warp/warpIn) — 갑자기 생기지 않고
  // 걸어 들어온다. 다만 **개막 시계(spawnEnd)는 안 건드린다**: 저건 "막을 언제
  // 걷는가"라서, 판 도중의 보충이 막을 다시 내리면 조작이 멈춘다.
  stepCueSupply(dt) {
    // 개막 중·판이 끝난 뒤·모성이 온 뒤에는 보내지 않는다 — 그때의 판은
    // 플레이어가 손대는 판이 아니다.
    if (this.won || this.lost || this.doom || this.warpCurtain || this.warpPending) return
    this.cueT = (this.cueT ?? 0) + dt
    if (this.cueT < CFG.CUE_CHECK) return
    this.cueT = 0
    const b = sendCueBall(this.rng, this.bodies, this.earth, this.stage, `${this.stage}c${this.cueN = (this.cueN ?? 0) + 1}`)
    if (!b) return
    b.alive = false; b.warp = 1; b.warpIn = CFG.WARP_LEAD
    this.bodies.push(b)
  }

  stepWarpIns(dtReal) {
    if (this.warpHold) return
    for (const b of this.bodies) {
      if (!(b.warpIn > 0)) continue
      b.warpIn -= dtReal
      if (b.warpIn > 0) continue
      b.warpIn = 0; b.alive = true; b.warp = 1
      this.addFx({ kind: 'warp', x: b.pos.x, y: b.pos.y, r: hitRadiusOf(b), fort: b.role === 'battery' })
      // 포대는 요새가 실제로 **도착한 뒤에** 생긴다. loadStage 시점에는 살아 있는
      // 요새가 0이라(전부 워프 대기 중) 거기서 명단을 짜면 영영 비어 있다.
      if (b.role === 'battery') this.syncLasers()
      // 초엘리트의 포도 같은 이유로 도착 후에 생긴다.
      if (b.role === 'siege') this.syncSieges()
    }
  }

  // 이 판의 **첫 조준까지**(인게임 초). 판이 거듭될수록 당겨진다 —
  // 조르그도 학습한다. 1스테이지만 넉넉하게 두는 건 그 판이 규칙을 배우는
  // 자리이기 때문이고, 4스테이지부터는 하한(LASER_FIRST_MIN)에 붙는다.
  get laserFirst() {
    return Math.max(CFG.LASER_FIRST_MIN, CFG.LASER_FIRST - CFG.LASER_FIRST_DROP * (this.stage - 1))
  }

  // ─── 포대 명단 ───────────────────────────────────────────────
  // 살아 있는 조르그 요새 하나당 광선 하나. 새로 도착한 요새에는 광선을 달아
  // 주고, 부서진 요새의 광선은 걷어낸다.
  //
  // 시차는 **도착 순서**로 준다: 1번은 laserFirst에, 2번은 거기서 SPACING만큼
  // 뒤에, 3번은 또 그만큼 뒤에. 그래서 첫 판은 "한 기가 물고, 다 지나가면 다음
  // 기가 문다"로 읽히고, 요새가 늘어도 겹쳐 쏘지 않는다.
  syncLasers() {
    const forts = this.bodies.filter(b => b.alive && b.role === 'battery')
    // 살아 있는지만이 아니라 **성계에 남아 있는지**까지 본다. 오프닝 예고편은
    // 도착한 요새 중 하나만 남기고 배열에서 통째로 빼내는데(setUp), 그것들은
    // alive인 채로 빠지므로 살아 있는지만 보면 판에 없는 총구가 계속 쏜다.
    const live = new Set(forts)
    // 죽은 포대의 광선은 걷는다. 다만 **아직 화면에 남아 있는 빛**(비행·소진)은
    // 끝까지 보내 준다 — 요새가 부서진 순간에 이미 나가 있던 광선까지 같이
    // 사라지면 그 한 발이 무엇을 관통했는지가 화면에서 지워진다.
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const L = this.lasers[i]
      if (live.has(L.from)) continue
      if (L.state === LASER_TRAVEL || L.state === LASER_SPENT) continue
      this.lasers.splice(i, 1)
    }
    for (const b of forts) {
      if (this.lasers.some(L => L.from === b)) continue
      // 순번은 **판이 열릴 때 도착한 요새**(arrivals)에만 붙인다. 판 도중에
      // 늦게 도착한 요새까지 명단 길이로 순번을 매기면 첫 조준이 판 시한 밖으로
      // 밀려나(예: 여섯째면 +750초) 그 요새는 영영 안 쏜다 — 위협이 아니라 그냥
      // 표적이 되는 것이다. 늦게 온 요새는 시차 한 칸만 두고 곧바로 줄에 선다.
      // (시계로 "개막 중인가"를 물으면 안 된다: 프레임이 느린 기기나 예고편의
      //  endOpening() 때문에 마지막 한 기가 도착하기 전에 막이 걷힐 수 있다.)
      const idx = this.lasers.length
      const wait = this.arrivals?.includes(b)
        ? this.laserFirst + idx * CFG.LASER_SPACING
        : CFG.LASER_SPACING
      // 조준점의 첫 값은 지구다 — 아직 안 쏘는 포대라도 겨누는 데는 하나뿐이다.
      this.lasers.push(makeLaser(this.rng, b, wait, this.earth))
    }
  }

  // 지금 살아 있는 포대 수 — 주기를 정하는 값이다(laser.nextPeriod).
  get batteryCount() { return Math.max(1, this.aliveFortresses) }

  // ─── 초엘리트 명단 ───────────────────────────────────────────
  // 살아 있는 초엘리트 하나당 포 하나. 요새의 광선과 같은 구조다(syncLasers) —
  // 새로 도착한 놈에게 포를 달아 주고, 부서진 놈의 포는 걷어낸다.
  //
  // 다만 **잠금 중에 부서지면 그 발은 취소된다**(abortSiegeGun). 요새의 광선이
  // 충전 중에 격파당하면 발사가 취소되는 것과 같은 규칙이고, 그래서 "선제
  // 격파"가 이쪽에도 정당한 대응이 된다. 이미 나가 있는 탄(foeShots)은
  // 그대로 날아간다 — 쏜 것은 쏜 것이다.
  syncSieges() {
    const live = this.bodies.filter(b => b.alive && b.role === 'siege')
    const set = new Set(live)
    for (let i = this.sieges.length - 1; i >= 0; i--) {
      const S = this.sieges[i]
      if (set.has(S.from)) continue
      if (abortSiegeGun(S)) {
        this.message = msg('msg.siege.abort', { name: nameOf(S.from) })
        this.setToast(msg('toast.siege.abort', { name: nameOf(S.from) }))
      }
      this.sieges.splice(i, 1)
    }
    for (const b of live) {
      if (this.sieges.some(S => S.from === b)) continue
      // 판이 열릴 때 온 놈은 SIEGE_FIRST를 쉬고, 판 도중에 온 놈(다음 판의
      // 첫 기가 개막 전에 들어오는 경우)은 절반만 쉰다 — 요새의 늦은 증원이
      // 시차 한 칸만 두고 줄에 서는 것과 같은 이유다.
      const wait = this.arrivals?.includes(b) ? CFG.SIEGE_FIRST : CFG.SIEGE_FIRST * 0.5
      this.sieges.push(makeSiegeGun(this.rng, b, wait))
    }
  }

  // 지금 잠금 중인 초엘리트의 포 — HUD 경보가 "지금 뭐가 오는가"를 묻는 자리.
  // 여럿일 수 있으므로 남은 시간이 짧은 쪽을 준다.
  get siegeGun() {
    let best = null
    for (const S of this.sieges) {
      if (S.state !== SIEGE_LOCK) continue
      if (!best || siegeLeft(S) < siegeLeft(best)) best = S
    }
    return best
  }
  get siegeLocking() { return !!this.siegeGun }
  get siegeLeft() { const S = this.siegeGun; return S ? siegeLeft(S) : 0 }
  get siegeFlying() { return this.foeShots.some(m => m.alive) }

  // ─── 초엘리트의 한 수 ────────────────────────────────────────
  // 상태기 자체는 siege.js에 있고 여기서는 그 결과를 판에 옮긴다.
  tickSieges(dt) {
    if (this.won || this.lost || this.doom) return
    // 명단을 먼저 맞춘다 — 부서진 초엘리트의 포는 여기서 빠지고, 잠금 중이었다면
    // 그 발이 취소된다(tickLaser가 syncLasers를 먼저 부르는 것과 같은 자리).
    this.syncSieges()
    for (const S of this.sieges.slice()) {
      const ev = stepSiegeGun(S, this, dt)
      if (!ev) continue
      if (ev.kind === 'lock') {
        this.addFx({ kind: 'siegeLock', x: ev.src.pos.x, y: ev.src.pos.y, r: hitRadiusOf(ev.src) })
        this.message = msg('msg.siege.lock', { name: nameOf(ev.src), cue: nameOf(ev.cue) })
        this.setToast(msg(ev.hits ? 'toast.siege.lock' : 'toast.siege.graze', { cue: nameOf(ev.cue) }))
      } else if (ev.kind === 'lost') {
        // 큐볼이 사라졌다 — 플레이어가 조준을 통째로 무의미하게 만든 것이다.
        this.setToast(msg('toast.siege.lost'))
      } else if (ev.kind === 'fire') {
        const m = makeSiegeShot(S)
        this.foeShots.push(m)
        this.addFx({
          kind: 'siegeFire', x: m.pos.x, y: m.pos.y,
          a: Math.atan2(m.vel.y, m.vel.x), r: hitRadiusOf(ev.src),
        })
        this.message = msg('msg.siege.fire', { name: nameOf(ev.src), cue: nameOf(ev.cue) })
      }
    }
  }

  // ─── 초엘리트의 탄 ───────────────────────────────────────────
  // 내 탄(missiles)과 배열을 따로 두는 이유는 규칙이 다르기 때문이다:
  // 이쪽은 중력을 안 받고(유도탄), 마릿수 제한이 없고, 무엇보다
  // **내 발사 차례를 막지 않는다**(flying은 missiles만 센다). 한 배열에
  // 섞으면 조르그가 쏜 탄이 내 재장전을 잠그는 사고가 난다.
  // 탄끼리의 충돌(crossFire)도 내 탄들 사이에서만 본다 — 저쪽 탄을 내 탄으로
  // 쳐서 막는 건 다른 규칙이고(그건 광선 요격이 하는 일이다), 여기서 조용히
  // 딸려 나오면 안 된다.
  stepFoeShots(dt) {
    // 모성이 왔으면 저쪽 탄도 멎는다. 판돈을 회수하러 본대가 직접 온 자리에서
    // 부하가 쏜 탄이 마저 날아와 지구를 한 대 더 때리면, 그 한 대가 난사보다
    // 먼저 판정을 내려(fail) 연출이 중간에 끊긴다.
    if (this.doom) return
    for (const m of this.foeShots) {
      if (!m.alive) continue
      const ev = stepSiegeShot(m, this, dt)
      if (!ev) continue
      m.alive = false
      if (ev.kind === 'hit') this.siegeDetonate(m, ev.body, ev.point)
      else if (ev.kind === 'sun') this.addFx({ kind: 'sun', x: m.pos.x, y: m.pos.y, r: 20 })
      // 판 밖으로 나갔거나 수명이 끝난 탄은 아무 소리 없이 사라진다 —
      // 저쪽 실수를 팡파르로 알려 줄 이유가 없다(화면에 궤적만 남아 흐려진다).
    }
  }

  // 조르그 탄두의 기폭. **임펄스 규칙은 내 핵과 한 글자도 다르지 않다**
  // (applyNuke: 방향 = 폭심 → 중심, 크기 = 작약/질량). 저쪽 핵만 다르게 굴면
  // 판 내내 배운 조준 감각이 그 순간 거짓말이 된다.
  //
  // 다른 것은 둘이다. ① 이 기폭으로는 **정치자금이 안 붙는다.**
  // ② 지구에는 애초에 안 꽂힌다 — 이 탄은 배정된 공에만 무장돼 있다
  // (siege.stepSiegeShot의 지구 제외 주석에 근거가 있다). 지구가 받는 것은
  // 폭풍뿐이고, 그건 0.3배로 눌린 값이라 경고 한 줄로 읽히고 되돌릴 수 있다.
  siegeDetonate(m, b, point) {
    const yld = m.yld
    this.addFx({ kind: 'siegeNuke', x: point.x, y: point.y, yld, r: b.radius })

    // 모성에는 저쪽 핵도 안 통한다 — 그건 공을 던져야만 부서진다.
    if (b.mothership) return
    // 아래 셋은 **내 핵과 같은 분기**다(detonate). 저쪽 핵이라고 가스가 안 터지거나
    // 불안정 행성이 안 쪼개지면, 이 판의 규칙이 쏘는 쪽에 따라 갈리는 것이 된다.
    // (조르그는 이런 공을 큐볼로 고르지 않는다 — siege.candidates가 걸러 낸다.
    //  여기 오는 것은 탄이 표적으로 가는 길에 걸린 공이고, 그건 저쪽 실수다.)
    // 가스는 내 핵과 같다: 밀리고, 터지고, 체력 1을 잃는다(volatileBlast).
    if (b.role === 'volatile') { applyNuke(b, point.x, point.y, yld); this.volatileBlast(b); return }
    if (b.role === 'unstable') { this.shardShot(b, b.pos.x - point.x, b.pos.y - point.y); return }
    if (b.type === 'debris') { blastWave(this.bodies, point.x, point.y, yld, b); b.alive = false; return }

    const push = applyNuke(b, point.x, point.y, yld)
    const wave = blastWave(this.bodies, point.x, point.y, yld, b)
    this.addFx({
      kind: 'siegePush', x: point.x, y: point.y, yld, r: b.radius,
      px: push.dx, py: push.dy, wave: wave.radius,
    })
    this.message = msg('msg.siege.hit', {
      name: nameOf(b), dv: push.dv.toFixed(1), dir: bearing(push.dx, push.dy).toFixed(0),
    })
    if (wave.pushed.some(p => p.body.isEarth)) this.setToast(msg('toast.blastEarth'))
  }

  // ─── 대표 광선 ───────────────────────────────────────────────
  // HUD 경보와 예고편은 "지금 무엇이 제일 급한가" 하나만 알면 된다. 여럿이
  // 동시에 돌 수 있으므로 그중 하나를 골라 준다: 비행 중 > 충전 중(남은 시간이
  // 짧은 순) > 나머지. 화면에 그리는 쪽(LaserView)은 이걸 안 쓰고 전부 그린다.
  get laser() {
    let best = null, bestRank = -1, bestLeft = Infinity
    for (const L of this.lasers) {
      const rank = L.state === LASER_TRAVEL ? 3 : L.state === LASER_CHARGE ? 2 : L.state === LASER_SPENT ? 1 : 0
      const left = L.state === LASER_CHARGE ? chargeLeft(L) : 0
      if (rank > bestRank || (rank === bestRank && left < bestLeft)) {
        best = L; bestRank = rank; bestLeft = left
      }
    }
    return best
  }

  // ─── 막 ───────────────────────────────────────────────────────
  // 판이 열리고 조르그가 들어오는 동안은 아직 내 차례가 아니다. 조작 패널도,
  // 이름표도, 레티클도 없이 성계만 보여 준다 — 궤도와 카이퍼 벨트까지가 전부다.
  //
  // 막이 걷히는 시점은 **스폰이 전부 끝나고 WARP_SETTLE만큼 더 지난 뒤**다.
  // 예전에는 "워프가 남아 있는 동안, 단 최대 3.2초"였는데 그 규칙은 두 군데서
  // 거짓말을 했다: ① 요새가 넷 이상이면 아직 도착 중인데 막이 걷혔고
  // ② 마지막 한 기가 반투명하게 떠오르는 도중에 패널이 올라왔다.
  // 지금은 한 방향으로만 흐르는 시계 하나(openT)가 개막 전체를 잰다 —
  // 스폰 끝 → 뜸 → 조작 인계. 판마다 같은 박자다(1스테이지도, 5스테이지도).
  //
  // 시계는 stepWarpIns와 **같은 클럭**이다. 벽시계로 재면 프레임이 느린
  // 기기에서 워프가 끝나기도 전에 막이 걷혔다(계측: 워프 잔여 0.2초에 걷힘).
  get openHold() { return (this.spawnEnd ?? 0) + CFG.WARP_SETTLE }
  get warpCurtain() {
    if (this.lost || this.won || this.runOver) return false
    return this.warpHold || this.openT < this.openHold
  }
  // 개막을 즉시 끝낸다 — 오프닝 예고편은 판을 직접 연출하므로 막이 방해가 된다.
  endOpening() { this.openT = this.openHold }
  // 화면에서 UI를 통째로 걷는 구간 — 예고편 도입부(cineBare)와 판이 열리는 순간.
  get bare() { return !!this.cineBare || this.warpCurtain }

  tick(dtFrame) {
    if (this.toastT > 0) this.toastT -= dtFrame
    // 정치자금 표시의 펄스. **실시간으로 깎는다** — 자금은 관측 중에 들어오는데
    // 그때 인게임 시계는 배속이 걸려 있어서, 게임 시간으로 재면 8배속에서 번쩍임이
    // 8분의 1로 짧아진다(같은 이유로 토스트도 실시간이다).
    if (this.polFlash > 0) this.polFlash = Math.max(0, this.polFlash - dtFrame)
    // 개막 시계. warpHold(튜토리얼이 화면을 덮고 있는 동안)면 멈춘다 —
    // 규칙을 읽는 사이에 스폰이 끝나 버리면 첫 판에서 제일 먼저 봐야 할
    // 장면을 오버레이 뒤에서 놓친다.
    if (!this.warpHold && this.openT < this.openHold) this.openT += dtFrame
    this.stepWarpIns(dtFrame)
    this.stepDodgeCool(dtFrame)
    this.stepDying(dtFrame)
    // 이미 박힌 광선의 꼬리는 판이 멈춰 있어도 끝까지 들어간다 — 광선이 지구를
    // 부순 그 순간에도(그때 판이 서 버린다) 빛은 마저 빨려 들어가야 한다.
    const n = this.batteryCount
    for (const L of this.lasers) stepSpent(L, dtFrame, n)
    this.fadeSpentShots(dtFrame)
    let acc = Math.min(0.1, dtFrame) * this.effTimeScale()
    while (acc >= CFG.DT) { this.step(CFG.DT); acc -= CFG.DT }
  }

  step(dt) {
    stepBodies(this.bodies, dt)
    this.stepDodge(dt)
    stepComets(this, dt)
    this.stepCueSupply(dt)
    this.tickSieges(dt)
    this.stepFoeShots(dt)
    for (const m of this.missiles) {
      if (!m.alive) continue
      stepMissile(m, this.bodies, dt)
      updateEncounters(m, this.bodies, {
        // updateEncounters는 **인카운터 하나당 정확히 한 번**, 그것도 중력권을
        // 빠져나가는 프레임에 굴절 25°를 넘겼을 때만 부른다. 그래서 여기서 세면
        // 중복이 없다. 같은 행성을 나중에 다시 돌면 그건 새 인카운터이고, 또 준다.
        swing: (b, deg) => {
          this.message = msg('msg.swing', { name: nameOf(b), deg: deg.toFixed(0), chain: m.chain })
          this.addFx({ kind: 'swing', x: b.pos.x, y: b.pos.y, r: b.radius })
          this.addPol(CFG.POL_SWING, b.pos.x, b.pos.y)
        },
        capture: (b) => { this.detonate(m, b, { x: m.pos.x, y: m.pos.y }); this.setToast(msg('toast.capture')) },
      })
      if (m.alive) this.contact(m)
      if (m.alive) this.missileBounds(m)
      if (!m.alive) this.finishShot(m)
    }
    this.crossFire()
    resolveBodyPairs(this.bodies, this)
    this.bodyBounds()
    if (this.doom) this.tickDoom(dt)
    else this.tickLaser(dt)
    this.time += dt
    this.warnTime()
    this.checkEnd()
  }

  // ─── 다 쓴 탄의 궤적 ─────────────────────────────────────────
  // 원래는 빗나간 샷의 궤적을 **판이 끝날 때까지** 흐리게 남겼다(§14.4).
  // 그런데 탄이 무제한이라 한 판에 열댓 발이 나가고, 그 회색 리본이 전부
  // 그대로 쌓여 판 위에 그물이 걸렸다 — 정작 봐야 할 궤도가 그 밑에 깔린다.
  // 이제는 결판난 뒤 잠깐 남았다가 흐려지며 걷힌다.
  //
  // 실시간(dtFrame)으로 센다. 조준 모드는 판을 세우므로 인게임 시계로 재면
  // 마지막 궤적이 화면에 그대로 굳어 버린다 — 그게 지금 고치는 그 증상이다.
  fadeSpentShots(dtFrame) {
    for (const arr of [this.missiles, this.foeShots]) {
      for (let i = arr.length - 1; i >= 0; i--) {
        const m = arr[i]
        if (m.alive) continue
        m.fade += dtFrame
        if (m.fade >= CFG.SHOT_TRAIL_FADE) arr.splice(i, 1)
      }
    }
  }

  // ─── 추진기 재사용 대기 ──────────────────────────────────────
  // **실시간(dtFrame)으로 깎는다.** 인게임 시계로 재면 8× 관측에서 2.5초가
  // 0.3초가 되어 정작 막으려던 연사를 못 막는다(§FORT_DODGE_COOLDOWN).
  // 그래서 이 줄은 step()이 아니라 tick()에 산다 — 배속이 안 닿는 자리다.
  //
  // 조준 모드로 판을 세워 두고 생각하는 동안에도 흐른다. 벽시계 간격이라는 게
  // 그런 뜻이고, 판이 멈춘 동안엔 요새도 아무것도 안 하므로 손해 볼 쪽이 없다.
  stepDodgeCool(dtFrame) {
    for (const b of this.bodies) {
      if (b.boostCool > 0) b.boostCool = Math.max(0, b.boostCool - dtFrame)
    }
  }

  // ─── 요새의 회피 분사 ───────────────────────────────────────
  // 3스테이지부터 조르그 요새는 추진기를 하나씩 달고 온다. 제 몸에 꽂힐 궤도로
  // 탄이 들어오는 걸 확인하면 쓴다 — **횟수 제한은 없다.** 연료가 남았느냐가
  // 아니라 제때 알아챘느냐가 회피의 조건이다.
  //
  // 예전에는 한 판에 한 번뿐이었다("첫 발로 추진기를 빼고 둘째 발로 잡는다").
  // 그 규칙을 걷었으므로 이제 요새를 잡는 방법은 **저쪽이 못 알아채게 치는
  // 것**뿐이다: 반응 시간(6±2.5초) 안에 꽂히는 가까운 발, 막판에 꺾여 들어오는
  // 스윙바이, 분사한 직후의 다시 세는 구간. 판을 읽어야 하는 쪽은 그대로다.
  //
  // 미는 방향은 두 조건이 정한다: 탄의 **진입 방향에 직각**(정면으로 도망가면
  // 그대로 따라잡힌다 — 옆으로 비켜야 빗나간다)이고, 그 두 직각 중
  // **태양 반대쪽**. 안쪽으로 피하면 태양 우물로 떨어져 스스로 죽으므로,
  // 조르그가 고를 수 있는 쪽은 애초에 바깥 하나뿐이다.
  //
  // 위협 판정은 탄을 실제로 굴려 본다(Aim.firstImpact). 매 스텝 돌리기엔
  // 비싸므로 FORT_DODGE_TICK 간격으로만 묻는다 — 앞서 보는 시간이 10초인데
  // 0.3초 늦게 아는 것은 아무 차이도 만들지 않는다.
  //
  // ── 반응 시간 ──
  // 위협을 본 즉시 태우지 않는다. 요새마다 제 몫의 반응 시간(react)이 있고,
  // 그 초만큼 **계속 위협받는 상태로 버텨야** 비로소 분사한다. 그래서 즉발이
  // 아니고, 늦게 알아챈 궤도는 못 피한다 — 스윙바이로 막판에 꺾여 들어오는 탄,
  // 가까이서 쏜 탄, 반응 중에 진로가 새로 물린 탄이 그렇다.
  // 위협이 사라지면 경계도 풀린다(다시 처음부터 센다) — 그 자체가 수가 된다.
  //
  // ── 재사용 대기 ──
  // 반응 시간만으로는 한 군데가 안 막힌다. 반응은 인게임 초라 관측 배속(최대
  // 8×)만큼 짧아지는데, 분사하고도 궤도가 다시 꽂히면 요새는 그 짧아진 간격으로
  // 계속 태운다(계측: 8×에서 최소 0.96초 간격). 그래서 분사와 분사 사이에
  // **실시간** 바닥값을 하나 둔다(FORT_DODGE_COOLDOWN, 위 stepDodgeCool).
  // 횟수는 여전히 무한이다. 막는 것은 총량이 아니라 간격이다.
  stepDodge(dt) {
    this.dodgeT -= dt
    if (this.dodgeT > 0) return
    const tick = CFG.FORT_DODGE_TICK - this.dodgeT   // 실제로 흐른 시간(밀린 만큼 포함)
    this.dodgeT = CFG.FORT_DODGE_TICK
    // 추진기 달린 요새가 하나도 없으면 물어볼 것도 없다. 한 번의 판정이
    // 1.5ms짜리라 이 두 줄이 곧 "2스테이지까지는 공짜"를 만든다.
    if (!this.bodies.some(b => b.boost && b.alive && b.role === 'battery')) return
    // ── 명단부터 짠다: 요새 하나당 **제일 먼저 닿는 탄** 하나 ──
    // 예전에는 탄을 돌며 곧바로 경계를 깎았다. 탄이 한 번에 한 발일 때는 그게
    // 같은 말이었는데, 자리가 둘이 되면서 **같은 요새를 두 발이 물면 경계가 한
    // 틱에 두 번 깎인다** — 반응 시간이 절반이 되어 두 발을 겨눌수록 저쪽이 더
    // 빨리 비켜서는, 아무도 의도한 적 없는 규칙이 생겼다. 경계는 요새의 성질이지
    // 탄의 개수가 아니다. 비켜서는 방향만은 **먼저 닿는 탄** 기준으로 잡는다.
    const threatened = new Map()
    for (const m of this.missiles) {
      if (!m.alive) continue
      const hit = Aim.firstImpact(this, m, CFG.FORT_DODGE_LEAD)
      const b = hit?.body
      if (!b || !b.boost || !b.alive || b.role !== 'battery') continue
      const cur = threatened.get(b)
      if (!cur || hit.t < cur.t) threatened.set(b, hit)
    }
    for (const [b, hit] of threatened) {
      // 반응 시간은 요새마다 다르다. 처음 위협받는 순간에 뽑고, 그 뒤로는
      // 계속 물려 있는 동안만 깎인다.
      if (b.alert == null) {
        b.alert = CFG.FORT_DODGE_REACT + (this.rng.next() * 2 - 1) * CFG.FORT_DODGE_REACT_JITTER
        b.alertMax = b.alert
      }
      b.alert -= tick
      // 대기가 남아 있으면 준비가 끝났어도 안 태운다. 경계는 계속 물고 있으므로
      // (alert는 그대로 깎인다) 대기가 풀리는 순간 바로 분사한다 — **미루는
      // 것이지 처음부터 다시 세는 게 아니다.** 다시 세게 만들면 배속을 올릴수록
      // 요새가 약해지는데, 이건 요새를 깎는 규칙이 아니라 연사만 막는 규칙이다.
      if (b.alert <= 0 && !(b.boostCool > 0)) this.dodgeBoost(b, hit.vx, hit.vy)
    }
    // 진로에서 벗어난 요새는 경계를 푼다 — 다시 물리면 처음부터 센다
    for (const b of this.bodies) {
      if (b.alert != null && !threatened.has(b)) { b.alert = null; b.alertMax = null }
    }
  }

  // ─── 혜성이 왔다 ─────────────────────────────────────────────
  // 워프가 아니다. 저건 조르그가 보낸 게 아니라 **원래 지나가던 것**이라
  // 도착 연출도 다르다: 벨트를 뚫고 들어오는 자리에 얼음 파문 한 겹뿐이다.
  // (comet.js가 이 자리를 부른다.)
  onComet(b) {
    this.addFx({ kind: 'comet', x: b.pos.x, y: b.pos.y, r: hitRadiusOf(b), a: Math.atan2(b.vel.y, b.vel.x) })
    // 범례는 판이 열릴 때 한 번 짜인다 — 판 도중에 온 태그는 여기서 얹어 준다.
    this.stageRoles = this.presentRoles()
    this.message = msg('msg.comet', { name: nameOf(b) })
    this.setToast(msg('toast.comet'))
  }

  // ─── 태양 둘레의 두 이체 궤도 ────────────────────────────────
  // 근일점(peri)을 묻는 곳이 둘이다: 요새의 회피 분사가 자살인지 보는 곳과,
  // 지구의 추진기가 지구를 태양으로 밀어 넣지 않는지 보는 곳. 같은 질문이므로
  // 식도 하나다. bound = 태양에 묶여 있는가.
  //
  // 근일점은 **탈출 궤도에서도 실재한다** — 쌍곡선도 태양을 한 번은 스쳐 지나간다.
  // 처음엔 탈출이면 peri=Infinity 로 넘겼는데, 계측에서 그게 이 게임에서 가장
  // 위험한 거짓말이었다: 가스행성 유폭으로 지구를 Δv 31 로 **안쪽으로** 밀면
  // 궤도는 탈출 궤도가 되지만 그 전에 태양을 먼저 지난다. 실측에서 지구는
  // r 683 → 210 으로 곤두박질쳐 22초 만에 태양에 삼켜졌는데, 예고는
  // "성계 밖으로 밀린다"고 적고 있었다. 나가는 게 아니라 떨어지는 발이었다.
  //
  // 그래서 원뿔곡선 반통경(p = h²/μ)으로 세 종류를 한 식에 담는다:
  // q = p/(1+e) 는 타원·포물선·쌍곡선에서 모두 맞다(타원이면 a(1−e)와 같다).
  sunOrbit(x, y, vx, vy) {
    const r = Math.hypot(x, y) || CFG.EPS
    const inv = 2 / r - (vx * vx + vy * vy) / CFG.MU_STAR   // 1/a — 0 이하면 탈출 궤도다
    const h = x * vy - y * vx
    const p = h * h / CFG.MU_STAR
    const e = Math.sqrt(Math.max(0, 1 - p * inv))
    return { bound: inv > 0, peri: p / (1 + e) }
  }

  // 이 Δv로 밀고도 요새가 살아남는가 — 위 궤도 원소로 답한다.
  // 묶인 궤도이고 근일점이 태양 안전 반경 밖이면 통과. 회피하려다 태양에
  // 처박는 분사만 걸러내는 판정이라 이 두 가지만 본다(원일점이 커지는 것은
  // 회피의 결과이고, 벨트가 공을 되돌려 보낸다).
  // 이미 조건을 어긴 궤도(앞판 충돌로 찌그러진 요새)면 어떤 Δv도 통과 못 하는데,
  // 그때는 호출부의 바닥값(예전 세기)이 그대로 쓰인다 — 예전과 같은 분사다.
  dodgeSafe(b, nx, ny, dv) {
    const o = this.sunOrbit(b.pos.x, b.pos.y, b.vel.x + nx * dv, b.vel.y + ny * dv)
    return o.bound && o.peri >= CFG.FORT_DODGE_PERI_MIN
  }

  dodgeBoost(b, vx, vy) {
    const s = Math.hypot(vx, vy) || 1
    let nx = -vy / s, ny = vx / s                   // 탄의 진입 방향에 직각 (둘 중 하나)
    // 태양에서 멀어지는 쪽을 고른다 — 안쪽 직각이면 뒤집는다
    if (nx * b.pos.x + ny * b.pos.y < 0) { nx = -nx; ny = -ny }
    // 세기는 제 질량을 따라간다 — 무거운 요새일수록 추진기가 크고, 그래서 Δv도
    // 질량에 비례해 커진다(가장 가벼운 요새가 기준 ×1, 대형 요새는 상한 ×3).
    const v = Math.hypot(b.vel.x, b.vel.y)
    const k = Math.min(CFG.FORT_DODGE_MASS_MAX,
      Math.max(CFG.FORT_DODGE_MASS_MIN, b.mu / CFG.FORT_DODGE_MU_REF))
    const base = v * CFG.FORT_DODGE_DV                // 예전 세기 — 안전장치도 이 아래로는 못 깎는다
    let dv = base * k
    // …다만 세진 분사가 요새를 태양으로 밀어 넣어서는 안 된다. 통과할 때까지
    // 세기를 한 단계(0.8배)씩 낮춘다 — 질량 상한이 3배라 다섯 번이면 예전 세기에
    // 닿고, 거기가 바닥이다. 한 번의 분사에 다섯 번 푸는 것은 싸다.
    while (dv > base && !this.dodgeSafe(b, nx, ny, dv)) dv = Math.max(base, dv * 0.8)
    b.vel.x += nx * dv; b.vel.y += ny * dv
    // 추진기는 안 닳는다(횟수 제한 없음). 다만 **연달아는 못 태운다** — 다음
    // 분사까지 실시간으로 이만큼이 든다. 그리고 경계는 처음부터 다시 센다 —
    // 비켜선 직후의 그 몇 초가 다음 탄이 파고들 수 있는 자리다.
    b.boostCool = CFG.FORT_DODGE_COOLDOWN
    b.alert = null; b.alertMax = null
    b.trailFlash = 2.0
    this.addFx({ kind: 'boost', x: b.pos.x, y: b.pos.y, r: hitRadiusOf(b), a: Math.atan2(-ny, -nx) })
    this.message = msg('msg.boost', { name: nameOf(b) })
    this.setToast(msg('toast.boost', { name: nameOf(b) }))
  }

  // ─── 지구의 소모형 추진기 ─────────────────────────────────────
  // **요새가 미사일을 피하는 그 물건을 지구가 받은 것이다.** 규칙도 같다:
  // 한 방의 임펄스, 위협의 진입 방향에 직각, 두 직각 중 태양 반대쪽.
  //
  // 왜 관측 모드에서만인가 — 조준 모드는 시계가 멈춰 있다. 멈춘 판에서 지구를
  // 밀면 그건 회피가 아니라 그냥 배치 변경이고, 무엇보다 **레이저가 언제
  // 꽂히는지를 보면서 누르는 것**이 이 물건의 전부다. 시간이 흐르는 화면에서만
  // 의미가 있다.
  //
  // 되는지 안 되는지는 화면이 즉시 답한다: 조준선이 붉은색(맞는다)에서
  // 청록(빗나간다)으로 바뀐다(laser.js의 L.safe). 토스트로 알릴 필요가 없다 —
  // 애초에 관측 모드에서는 새 토스트가 안 뜬다.
  //
  // **겨눠지고 있을 때만, 그리고 실제로 먹힐 때만 켜진다.** 예전에는 관측
  // 중이면 언제든 태울 수 있었다("미리 비켜서는 것도 수다"). 그런데 위협이
  // 없을 때의 분사는 기준선이 지구의 진로라 방향에 뜻이 없고 — 무엇보다
  // **세 발뿐인 자원을 아무 일도 안 일어나는 화면에서 태워 없앨 수 있었다.**
  //
  // ── 조건은 하나다: 지금 겨눠지고 있는가 ──
  // 예전에는 여기서 **결과를 미리 물었다**: 지금 태우면 광선이 닿는 순간 회랑을
  // 벗어나 있는가(dodgeMiss), 그 값이 판정 반경을 넘을 때만 켰다. 세기가 고정
  // (Δv 2.5)이던 시절에는 그게 유일하게 정직한 방법이었다 — 늦게 누른 분사는
  // 정말로 아무것도 못 했으니까.
  //
  // 그런데 그 게이트가 **버튼을 못 쓰는 버튼**으로 만들었다(계측 20시드 ×
  // 반경 4단 × 충전 잔여 8지점): 충전 잔여 20초까지는 100%로 켜지지만 10초에서
  // 0~14%, 5초에서는 전 반경 0%다. 게다가 안전장치(dodgeSafe)가 세기를 깎다가
  // 0.17까지 내려간 표본이 있었다 — 그런 판에서는 창이 아무리 많이 남아 있어도
  // 버튼이 영영 안 켜진다. "카이퍼 벨트 근처에서 안 먹힌다"가 그 얼굴이다.
  //
  // 이제 게이트를 걷는다. **겨눠지고 있으면 켜진다.** 결과를 보증하는 것은
  // 게이트가 아니라 **세기**다: 분사는 확실히 비켜날 때까지 스스로 커진다
  // (burnDv). 그래서 이 버튼은 "지금 누르면 산다"가 아니라 **"지금 누를 수
  // 있다"**를 뜻하게 됐고, 그건 버튼이 원래 해야 하는 말이다.
  get canThrust() {
    if (!(this.thrusters > 0
      && this.mode === 'observe' && !this.doom && !this.won && !this.lost
      && this.earth.alive && !this.warpCurtain)) return false
    // 이미 나간 빛(TRAVEL)은 조준이 아니라 결과다 — 그때는 태울 데가 없다.
    // 빗나가는 것으로 이미 판정된 광선(safe)도 위협이 아니다(mostUrgentBeam).
    const L = this.mostUrgentBeam()
    return !!L && L.state === LASER_CHARGE
  }

  // ── 실제로 쏠 선 ──
  // 광선은 **(발사 순간의 요새) → (조준점)**을 잇는 직선이다. **지금 화면에
  // 그어져 있는 그 선이 아니다** — 요새는 충전 95초 내내 공전하므로 쏘는
  // 순간에는 이미 다른 자리에 있다. 조준점(L.ax/ay)만은 solveAim이 '도달
  // 순간의 ghost 자리'로 풀어 둔 값이라 다시 굴릴 것이 없다. 움직이는 것은
  // 총구뿐이고, 그래서 여기서 굴리는 것도 총구 하나뿐이다.
  //
  // **회피 방향도 빗나감 예측도 이 선 하나만 본다.** 예전에는 방향(burnDir)만
  // 지금의 총구로 잡고 예측(dodgeMiss)만 미래의 총구로 쟀는데, 그 두 선이
  // 어긋난 각도가 곧 헛분사였다(계측 8시드: 충전 잔여 95초에 42~168°,
  // 70초에 48~165°). 90° 어긋난 직각은 광선을 **따라 도망가는** 방향이라
  // 95초를 밀어도 조준선에서 5 GU밖에 못 비켰고 — 예측은 그 5 GU를 정직하게
  // 답했으므로 **대응할 시간이 제일 많은 구간에서 버튼이 안 켜졌다.**
  // 그게 "조준당했는데 부스터가 활성화되지 않는다"의 정체다.
  beamLine(L) {
    // 이미 나간 빛은 선이 발사 때 고정됐다 — 굴릴 것이 없다.
    if (L.state === LASER_TRAVEL) return { ox: L.ox, oy: L.oy, ux: L.ux, uy: L.uy, dist: L.aimDist }
    const m = L.from ? propagate(L.from, chargeLeft(L)) : { x: L.ox, y: L.oy }
    const dx = L.ax - m.x, dy = L.ay - m.y
    const dist = Math.hypot(dx, dy) || 1
    return { ox: m.x, oy: m.y, ux: dx / dist, uy: dy / dist, dist }
  }

  // ── 분사 방향: **태양 반대쪽** ──
  // 예전에는 쏠 선에 직각으로 밀었다(요새의 회피 분사와 같은 규칙). 그 방향은
  // 광선 하나에는 최적이지만 **광선마다 다르다** — 어느 쪽으로 튈지 플레이어가
  // 미리 못 읽고, 총구가 마침 옆에 있으면 태양 쪽으로 밀리기도 했다.
  //
  // 이제 방향은 하나뿐이다: 태양에서 밖으로. 언제나 정의돼 있고, 언제나 같은
  // 그림이고(불꽃이 안쪽을 향해 뿜는다), 태양 우물에서 멀어지는 쪽이다.
  // 조준선을 가로지르는 성분은 세기가 만든다 — 반경 방향으로 민 궤도는 한
  // 바퀴를 돌지 않아도 진행 방향으로 크게 어긋난다(그게 궤도역학이다).
  burnDir() {
    const e = this.earth
    const r = Math.hypot(e.pos.x, e.pos.y) || 1
    return { nx: e.pos.x / r, ny: e.pos.y / r }
  }

  // ── 세기: 확실히 벗어날 때까지 키운다 ──
  // 예전에는 고정값(EARTH_BURN_DV)에서 시작해 안전할 때까지 **깎았다**. 그래서
  // 궤도가 이미 빠듯한 판에서는 0.17까지 내려가 아무 일도 안 일어났고, 창이
  // 20초 아래로 내려가면 2.5로는 회랑을 못 벗어났다.
  //
  // 방향을 뒤집는다: 기본 세기에서 시작해 **비켜날 때까지 키운다.** 목표는
  // "지구 판정 반경 × EARTH_BURN_CLEAR" — 판정 원 몇 개만큼 확실히 밖이다.
  // 안전장치는 이제 **더 키우지 못하게 막는 상한**이지, 세기를 지우는 장치가
  // 아니다. 기본 세기 아래로는 절대 안 내려간다 — 누른 버튼은 반드시 무언가를
  // 한다. (창이 몇 초밖에 안 남은 순간에는 상한까지 태워도 못 피할 수 있다.
  //  그때도 궤도는 통째로 갈린다 — 다음 광선은 다른 판에서 맞는다.)
  burnDv(L) {
    const { nx, ny } = this.burnDir()
    const need = hitRadiusOf(this.earth) * CFG.EARTH_BURN_CLEAR
    let dv = CFG.EARTH_BURN_DV
    for (let i = 0; i < 16; i++) {
      if (this.missAfter(L, nx, ny, dv) >= need) break
      const next = dv * CFG.EARTH_BURN_STEP
      if (next > CFG.EARTH_BURN_MAX || !this.dodgeSafe(this.earth, nx, ny, next)) break
      dv = next
    }
    return dv
  }

  // ── 분사의 결과를 미리 본다 ──
  // laser.solveAim이 L.miss를 재는 그 계산 그대로다 — 다만 '지금의 지구'가
  // 아니라 **'분사한 지구'**를 굴려서 잰다. 조르그의 조준선은 이미 고정돼
  // 있으므로(ghost 궤도에서 뽑은 ax/ay) 답은 결정론이다: 이 값이 판정 반경을
  // 넘으면 그 분사는 반드시 산다.
  //
  // 이미 날고 있는 광선(TRAVEL)에는 0을 준다. 남은 비행이 1~2초라 Δv 2.5로는
  // 4 GU도 못 비킨다 — 그 순간의 버튼은 재고만 태우는 거짓말이다.
  //
  // 기준선은 beamLine이 준다 — **분사 방향을 잡은 그 선 그대로**다. 총구를
  // 지금 자리에 고정한 채로 재면 일찍 누를수록 답이 크게 틀렸고(계측: T-90에서
  // 예측 619 GU인데 실제로는 10 GU를 비켜 맞았다), 방향만 지금 자리로 잡고
  // 예측만 미래 자리로 재면 이번에는 그 헛분사를 정직하게 재느라 버튼이
  // 안 켜졌다(beamLine 주석). 재는 선과 미는 선은 같은 선이어야 한다.
  //
  // 지구도 **혼자** 굴린다(propagate). 요새를 같은 sim에 넣으면 둘이 서로
  // 끌어당겨서, 조준점을 푸는 세계(solveAim의 propagate — 태양 중력만)와
  // 다른 세계를 보게 된다.
  missAfter(L, nx, ny, dv) {
    if (!L || L.state !== LASER_CHARGE) return 0
    const B = this.beamLine(L)
    const e = cloneBodies([this.earth])[0]
    e.vel.x += nx * dv; e.vel.y += ny * dv
    // 조르그가 겨눈 그 순간까지 굴린다 — 충전 잔여 + 광선 비행 시간.
    // 비행 거리도 쏠 선의 길이(B.dist)다. L.aimDist는 지금 총구에서 잰 값이라
    // 여기 섞으면 또 두 선이 갈린다.
    const p = propagate(e, chargeLeft(L) + B.dist / CFG.LASER_SPEED)
    const px = p.x - B.ox, py = p.y - B.oy
    const t = px * B.ux + py * B.uy
    return Math.hypot(px - B.ux * t, py - B.uy * t)
  }

  // 지금 지구를 가장 임박하게 겨누는 광선. 없으면 null.
  // 충전 중이면 '충전 남은 시간 + 비행 시간', 날고 있으면 '남은 비행 시간'이
  // 곧 급한 정도다. 이미 빗나가는 것으로 판정된 광선(safe)은 위협이 아니다.
  mostUrgentBeam() {
    let best = null, bestT = Infinity
    for (const L of this.lasers) {
      if (L.safe) continue
      let t = Infinity
      if (L.state === LASER_CHARGE) t = chargeLeft(L) + L.aimDist / CFG.LASER_SPEED
      else if (L.state === LASER_TRAVEL) t = impactLeft(L)
      if (t < bestT) { bestT = t; best = L }
    }
    return best
  }

  // ─── 이 버튼을 누르면 지구 궤도가 어떻게 되는가 ──────────────
  // 추진기는 이 게임에서 **지구를 가장 크게 미는 물건**이다. 그런데 그동안
  // 화면에는 "광선을 피한다"만 있고 그 값이 없었다. 계측(6시드 18회): 한 번에
  // 근일점이 평균 56 GU, 최대 91 GU 내려간다. 게다가 누적이다 —
  //   669 → 599 → 543 → 496 GU (세 번)
  // 태양이 지구를 삼키는 반경이 210 GU이므로, 여덟 번이면 다른 무엇과도
  // 상관없이 지구를 잃는다. 그 여덟 번이 화면 어디에도 안 적혀 있었다.
  //
  // 그래서 누르기 전에 밀린 뒤의 궤도를 그대로 돌려준다(폭풍 예고와 **같은
  // 함수**다 — aim.earthShove). 미는 방향·세기도 실제로 누를 때 쓰는 그 둘을
  // 그대로 쓴다(burnDir/burnDv). 셋 중 하나라도 따로 계산하면 그 순간
  // 화면의 선과 실제 결과가 갈린다.
  get burnPreview() {
    if (!this.canThrust) return null
    const L = this.mostUrgentBeam()
    if (!L) return null
    const { nx, ny } = this.burnDir()
    const dv = this.burnDv(L)
    return earthShove(this, this.earth, { dx: nx, dy: ny, dv, radius: 0 })
  }

  earthThrust() {
    if (!this.canThrust) return false
    const e = this.earth
    // 밀 방향의 기준선은 **그 광선이 오는 방향** 하나다. canThrust가 위협이
    // 있을 때만 참이므로 여기서 L은 언제나 있다 — 없으면 누를 수 없는 버튼이다.
    const L = this.mostUrgentBeam()
    if (!L) return false
    // 방향은 태양 반대쪽 하나(burnDir), 세기는 그 광선을 확실히 비켜날 만큼
    // (burnDv). 둘 다 이 함수 하나에서만 정해지므로 버튼과 결과가 안 갈린다.
    const { nx, ny } = this.burnDir()
    const dv = this.burnDv(L)
    e.vel.x += nx * dv; e.vel.y += ny * dv
    e.trailFlash = 2.0
    this.thrusters--
    this.addFx({ kind: 'earthBurn', x: e.pos.x, y: e.pos.y, r: hitRadiusOf(e), a: Math.atan2(-ny, -nx) })
    this.message = msg('msg.earthBurn', { n: this.thrusters, dv: dv.toFixed(1) })
    return true
  }

  // ─── 조르그 레이저 ─────────────────────────────────────────
  // 닿는 것은 체력과 무관하게 부서진다. 태양만 예외로, 막되 안 부서진다
  // — 원래 부술 수 없는 것이라 여기서만 예외를 만들면 규칙이 어긋난다.
  tickLaser(dt) {
    // 포대가 여럿이므로 명단을 먼저 맞춘다 — 부서진 요새의 광선은 여기서 빠지고,
    // 그러면 남은 포대의 주기가 그만큼 짧아진다(nextPeriod가 마릿수를 본다).
    this.syncLasers()
    const n = this.batteryCount
    for (const L of this.lasers.slice()) this.laserEvent(L, stepLaser(L, this, dt, n))
  }

  laserEvent(L, ev) {
    if (!ev) return
    if (ev.kind === 'charge') {
      this.addFx({ kind: 'laserCharge', x: L.ox, y: L.oy, r: hitRadiusOf(ev.src) })
      this.setToast(msg('toast.laser.charge', { name: nameOf(ev.src), sec: CFG.LASER_CHARGE }))
      this.message = msg('msg.laser.charge', { name: nameOf(ev.src) })
      return
    }
    if (ev.kind === 'abort') {
      this.setToast(msg('toast.laser.abort', { name: nameOf(ev.src) }))
      this.message = msg('msg.laser.abort', { name: nameOf(ev.src) })
      return
    }
    if (ev.kind === 'fire') {
      this.addFx({ kind: 'laserFire', x: L.ox, y: L.oy, a: Math.atan2(L.uy, L.ux) })
      this.message = msg('msg.laser.fire')
      return
    }
    if (ev.kind === 'intercept') {
      // 내 탄두가 광선의 진로를 막았다. 그 자리에서 터지며 광선이 끊긴다 —
      // 폭풍도 그대로 남으므로 "막으면서 동시에 공을 민다"가 성립한다.
      const m = ev.missile
      m.alive = false; m.hit = 'laser'
      const wave = blastWave(this.bodies, ev.x, ev.y, m.yld, null)
      this.addFx({ kind: 'nuke', x: ev.x, y: ev.y, yld: m.yld, r: 22, wave: wave.radius })
      this.addFx({ kind: 'laserMiss', x: ev.x, y: ev.y })
      this.message = msg('msg.laser.intercept', { yield: m.yld })
      this.setToast(msg('toast.laser.intercept'))
      if (wave.pushed.some(p => p.body.isEarth)) this.setToast(msg('toast.laser.blastEarth'))
      return
    }
    if (ev.kind === 'expire') {
      this.addFx({ kind: 'laserMiss', x: ev.x, y: ev.y })
      this.message = msg('msg.laser.expire')
      this.setToast(msg('toast.laser.expire'))
      return
    }
    // ── 착탄 ──
    const b = ev.body
    this.addFx({ kind: 'laserHit', x: ev.x, y: ev.y, r: b ? hitRadiusOf(b) : CFG.R_STAR, sun: !b })
    if (!b) {   // 태양이 막았다
      this.message = msg('msg.laser.sun')
      this.setToast(msg('toast.laser.sun'))
      return
    }
    if (b.isEarth) {
      this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 2, earth: true })
      b.alive = false
      this.fail('EARTH_LASER', msg('msg.fail.laser'))
      this.setToast(msg('toast.laser.earth'))
      return
    }
    // 체력 불문 파괴. 막아 준 대가가 그 공의 소멸이다.
    this.blastFx(b)
    this.message = msg('msg.laser.kill', { name: nameOf(b) })
    this.setToast(msg('toast.laser.kill', { name: nameOf(b) }))
    this.killBody(b, 'laser', { fx: false })
  }

  // 경보는 **대표 광선** 하나만 본다(get laser). 여럿이 동시에 충전 중일 수
  // 있지만, 화면에 띄우는 카운트다운은 제일 급한 하나여야 읽힌다.
  get laserCharging() { return this.laser?.state === LASER_CHARGE }
  get laserFlying() { return this.laser?.state === LASER_TRAVEL }
  get laserLeft() { return this.laser ? chargeLeft(this.laser) : 0 }
  get laserImpactLeft() { return this.laser ? impactLeft(this.laser) : 0 }
  // 조준선에서 지구까지 예상 수직거리 / 지금 이대로면 빗나가는가
  get laserMiss() { return this.laser?.miss ?? 0 }
  get laserSafe() { return !!this.laser?.safe }
  // 지금 충전 중인 포대 수 — 둘 이상이면 경보에 그 사실을 붙인다
  get laserChargingCount() { return this.lasers.filter(L => L.state === LASER_CHARGE).length }

  // 시한이 줄고 있다는 걸 토스트로 못 박는다 (남은 60/30/10초)
  warnTime() {
    if (this.won || this.lost || this.doom) return
    const marks = [60, 30, 10], left = this.timeLeft
    while (this.timeWarn < marks.length && left <= marks[this.timeWarn]) {
      const s = marks[this.timeWarn]
      this.timeWarn++
      this.setToast(msg('toast.timeLeft', { sec: s }))
    }
  }

  // 스윕 판정 — 직전 위치에서 현재 위치까지의 선분이 명중 반경과 겹치면 명중.
  // 여러 천체에 걸치면 "먼저 닿은" 쪽이다: 폭심 위치가 곧 임펄스 방향이라
  // 아무 놈이나 고르면 공이 엉뚱한 데로 굴러간다.
  contact(m) {
    const a = m.prev || m.pos
    let best = null, bestD = Infinity
    for (const b of this.bodies) {
      if (!b.alive) continue
      const r = hitRadiusOf(b)
      if (!segHitsCircle(a.x, a.y, m.pos.x, m.pos.y, b.pos.x, b.pos.y, r)) continue
      const p = segCircleEntry(a.x, a.y, m.pos.x, m.pos.y, b.pos.x, b.pos.y, r)
      const d = Math.hypot(p.x - a.x, p.y - a.y)
      if (d < bestD) { bestD = d; best = { b, p } }
    }
    if (best) this.detonate(m, best.b, best.p)
  }

  // ─── 핵 기폭 — 이 게임의 큐샷 ───────────────────────────────
  detonate(m, b, point) {
    m.alive = false; m.hit = b
    const yld = m.yld

    // 모성 — **핵은 안 통한다.** 부술 수는 있게 됐지만(DOOM_HP) 그 길은 공을
    // 던지는 것 하나뿐이다. 다만 폭풍은 그대로 터진다: 모성 옆의 공을 밀어
    // 붙이는 수가 성립해야 "던져서 부순다"가 계획 가능한 일이 된다.
    if (b.mothership) {
      const wave = blastWave(this.bodies, point.x, point.y, yld, b)
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius, wave: wave.radius })
      this.message = msg('msg.nuke.mothership', { name: nameOf(b) })
      return
    }

    // 휘발성 — 맞는 순간 그 자리에서 유폭하고 **없어진다.** 작약량은 안 본다:
    // 1Mt이든 12Mt이든 가스 행성에 핵이 닿으면 한 방이다.
    // (한동안은 체력 1만 닳고 살아남았다. 그러면 이 태그가 "터지는 공"이 아니라
    //  "터지는 시늉을 하는 공"이 된다 — 같은 유폭을 세 번 보고 나서야 없어지므로
    //  한 번의 사건이 세 번으로 흐려지고, 유폭을 노린 한 수의 값도 1/3이 된다.
    //  터지는 것은 한 번뿐이어야 그 한 번이 계획할 값어치를 갖는다.)
    if (b.role === 'volatile') {
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius })
      this.volatileBlast(b)
      return
    }

    // 불안정 — 맞는 순간 쪼개지며 **맞은 반대쪽으로** 파편을 뿌린다.
    // 총구 방향은 임펄스 방향과 같은 벡터다(폭심 → 중심): 이 공을 밀었다면
    // 갔을 그 방향으로 대신 산탄이 나간다. 그래서 조준법이 하나로 유지된다.
    if (b.role === 'unstable') {
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius })
      this.shardShot(b, b.pos.x - point.x, b.pos.y - point.y)
      return
    }

    if (b.type === 'debris') {
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius })
      blastWave(this.bodies, point.x, point.y, yld, b)
      b.alive = false
      this.message = msg('msg.nuke.debris')
      return
    }

    if (b.isEarth) {   // 요청대로: 지구 오폭 = 즉시 게임오버, 변명 없음
      this.addFx({ kind: 'nuke', x: point.x, y: point.y, yld: CFG.YIELD_MAX, r: b.radius, earth: true })
      this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius, earth: true })
      b.alive = false
      this.fail('EARTH_LOST', msg('msg.fail.nukeEarth'))
      this.setToast(msg('toast.nukeEarth'))
      return
    }

    // 임펄스: 입사각·속도 무시. 폭심의 상대 위치만 본다.
    const push = applyNuke(b, point.x, point.y, yld)
    const wave = blastWave(this.bodies, point.x, point.y, yld, b)
    this.addFx({
      kind: 'nuke', x: point.x, y: point.y, yld, r: b.radius,
      px: push.dx, py: push.dy, wave: wave.radius, armor: hasRole(b, 'armor'),
    })

    // 직격 자체에는 값을 안 매긴다. **미는 것은 수단이지 성과가 아니다** —
    // 예전에는 여기서 체인·니어미스·태양 가속을 배율로 얹어 8×M점을 줬는데,
    // 그러면 아무 데나 쏴도 숫자가 오르는 통에 "잘 친 샷"의 정의가 흐려졌다.
    // 지금 값이 붙는 곳은 스윙바이(그 자리에서 1)와 요새 격파(2) 둘뿐이다.
    this.message = msg('msg.nuke.hit', {
      name: nameOf(b), dv: push.dv.toFixed(1), dir: bearing(push.dx, push.dy).toFixed(0),
      tail: hasRole(b, 'armor') ? msg('msg.nuke.armor') : '',
    })
    // 폭풍이 지구를 정통으로 훑었다면 경고 — 지구가 밀려 태양에 빠지는 사고가 실제로 난다
    if (wave.pushed.some(p => p.body.isEarth)) this.setToast(msg('toast.blastEarth'))
  }

  // ─── 탄이 탄을 친다 ─────────────────────────────────────────
  // 두 발이 동시에 날 수 있게 되면서(CFG.MAX_INFLIGHT) 생긴 수다.
  // **탄두도 공이다**: 탄끼리 부딪히면 빠른 쪽이 큐, 느린 쪽이 공이다.
  // 빠른 탄은 그 자리에서 터지고, 느린 탄은 핵에 밀려 진로가 꺾인다.
  // 규칙은 행성을 칠 때와 한 글자도 다르지 않다 — 방향은 폭심 → 맞은 것의
  // 중심, 크기는 작약량 / 질량(physics.missilePush). 새로 배울 것이 없다.
  //
  // 쓰는 법은 당구다: 먼저 **허공에 느린 탄을 하나 걸어 둔다.** 그 자체로는
  // 아무 데도 안 닿는 발이다. 그 탄이 표적 옆을 지날 즈음, 뒤이어 빠른 탄으로
  // 옆구리를 쳐서 꺾어 넣는다. 중력과 스윙바이만으로는 안 나오던 각이
  // 이 한 수로 열린다 — 유도탄을 준 게 아니라 **큐를 하나 더 준 것**이다.
  // (값을 치르고 있다: 두 발이 곧 두 차례이고, 큐로 쓴 탄은 사라진다.)
  //
  // 스텝 안의 **어느 시점에** 만나는지까지 푼다(sweepMeet). 둘 다 초당 수십
  // GU로 날므로 스텝 끝 위치만 비교하면 서로를 통과해 버린다.
  crossFire() {
    if (this.flying < 2) return
    const live = this.missiles.filter(m => m.alive && m.prev)
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j]
        if (!a.alive || !b.alive) continue     // 이 스텝에 이미 큐로 쓰인 탄
        // 총구를 막 떠난 탄은 아직 무장 전이다 — 그 자리에서 붙는 건 오발이다
        // (CFG.MISSILE_ARM). 예측도 같은 문턱을 본다(aim.predictPath).
        if (a.age < CFG.MISSILE_ARM || b.age < CFG.MISSILE_ARM) continue
        const u = sweepMeet(a.prev, a.pos, b.prev, b.pos, CFG.MISSILE_HIT_R)
        if (u < 0) continue
        // 빠른 쪽이 큐다 — 플레이어가 고른 발사 속도가 그대로 역할이 된다
        // ("느리게 걸어 두고 빠르게 친다"). 같으면 나중에 쏜 쪽이 큐다:
        // 뒤에서 따라붙은 발이 앞선 발을 치는 게 이 수의 모양이라 그렇다.
        const sa = Math.hypot(a.vel.x, a.vel.y), sb = Math.hypot(b.vel.x, b.vel.y)
        const aIsCue = sa > sb || (sa === sb && a.age < b.age)
        this.relay(aIsCue ? a : b, aIsCue ? b : a, u)
      }
    }
  }

  // 큐가 된 탄두의 기폭. 폭심은 **만나는 그 순간 큐가 있던 자리**이고, 밀리는
  // 방향은 거기서 공이 된 탄두를 향한다 — applyNuke와 같은 벡터다.
  // 폭풍(blastWave)도 그대로 터진다: 허공에서 터진 핵이라고 주변 공을 안 미는
  // 이유가 없고, 그걸 노리고 두 발을 붙이는 것도 하나의 수다.
  relay(cue, ball, u) {
    const at = (m) => ({ x: m.prev.x + (m.pos.x - m.prev.x) * u, y: m.prev.y + (m.pos.y - m.prev.y) * u })
    const c = at(cue), p = at(ball)
    cue.alive = false; cue.hit = 'relay'
    const push = missilePush(c.x, c.y, p.x, p.y, cue.yld)
    ball.vel.x += push.dx * push.dv; ball.vel.y += push.dy * push.dv
    ball.relayed++
    // 인카운터 기록은 여기서 접는다. 스윙바이는 **중력이 꺾은 각**을 재는 것인데
    // (진입 속도 vIn 과 이탈 속도의 사잇각), 그 사이에 핵으로 한 번 밀면 그 각에
    // 임펄스가 섞여 들어간다 — 행성 곁에서 릴레이한 발이 "스윙바이 40°"로 보고되고
    // 정치자금까지 붙는 셈이다. 밀린 뒤부터 다시 센다: 그 뒤로 중력이 마저 꺾는
    // 만큼은 여전히 진짜 스윙바이다.
    ball.enc.clear()
    const wave = blastWave(this.bodies, c.x, c.y, cue.yld, null)
    this.addFx({
      kind: 'nuke', x: c.x, y: c.y, yld: cue.yld, r: CFG.MISSILE_HIT_R,
      px: push.dx, py: push.dy, wave: wave.radius, cue: true,
    })
    // 한가운데서 터지면 미는 방향이 없다(missilePush) — 그때는 "밀었다"고 하면
    // 안 된다. 탄 하나가 값 없이 사라진 것이고, 판은 그 사실을 그대로 말한다.
    if (push.dv > 0) {
      this.message = msg('msg.nuke.relay', {
        yield: cue.yld, dv: push.dv.toFixed(1), dir: bearing(push.dx, push.dy).toFixed(0),
      })
      this.setToast(msg('toast.relay'))
    } else {
      this.message = msg('msg.nuke.relay.center', { yield: cue.yld })
      this.setToast(msg('toast.relay.center'))
    }
    if (wave.pushed.some(q => q.body.isEarth)) this.setToast(msg('toast.blastEarth'))
  }

  // ─── 휘발성 유폭 ─────────────────────────────────────────────
  // 반경은 그 행성의 크기로 고정 — 조준 전에 원으로 그려 줄 수 있어야
  // "여기까지 밀린다"를 계획할 수 있다.
  // ── 유폭은 자살이 아니다 ──
  // 예전에는 여기서 그 공을 죽였다: 한 번 터지면 가스 행성이 판에서 사라졌다.
  // 그래서 이 태그는 **한 번 쓰고 버리는 폭탄**이었고, 목성·토성처럼 판의 지형을
  // 이루는 덩치가 스치듯 맞은 한 방에 통째로 없어졌다.
  //
  // 이제 유폭이 하는 일은 **미는 것 하나뿐**이다. 그 공 자신은 체력 1을 잃는다 —
  // 체력이 3이니 세 번까지 터뜨릴 수 있고, 세 번째에 비로소 부서진다. 그때의
  // 파괴는 다른 공과 똑같은 경로를 탄다(damage → blastFx). 즉 "터졌다"와
  // "부서졌다"가 서로 다른 사건으로 갈린다.
  volatileBlast(b) {
    if (!b.alive) return
    const R = volatileRadius(b)
    this.addFx({ kind: 'volatile', x: b.pos.x, y: b.pos.y, r: b.radius, R })
    for (const o of this.bodies) {
      if (!o.alive || o === b) continue
      // 식은 physics.volatilePushOn 하나뿐이다 — 조준 화면이 "지구가 이만큼
      // 밀린다"를 미리 보여줄 때(aim.earthShove) 같은 값을 읽어야 한다.
      const p = volatilePushOn(o, b, R)
      if (!p) continue
      o.vel.x += p.dx * p.dv; o.vel.y += p.dy * p.dv
      o.trailFlash = 2
    }
    this.message = msg('msg.volatile', { name: nameOf(b), r: R.toFixed(0) })
    // **제 몸은 남지 않는다.** 유폭은 한 번이고, 그 한 번에 이 공이 없어진다.
    this.killBody(b, 'blast', { fx: false })
  }

  // ─── 불안정 행성 — 쪼개지며 쏜다 ─────────────────────────────
  // 유폭(volatileBlast)과 나란히 읽어야 하는 함수다. 둘 다 "맞으면 그 공이
  // 없어지고 주변이 뒤집힌다"인데, 미치는 자리가 다르다:
  //   가스   — 제자리에서 원. 반경 안이 **전부** 밀린다. 아무도 안 부서진다.
  //   불안정 — 맞은 반대쪽으로 부채꼴. **닿은 것만** 깎인다. 빗나간 갈래는 없다.
  // 그래서 가스는 판을 흔드는 물건이고 이건 **표적을 지우는 물건**이다.
  // 요새 체력이 1이므로 부채꼴 안에 요새가 둘 들어오면 한 발로 둘이 사라진다 —
  // 이 태그의 값은 거기 있고, 그 대가로 방향을 잘못 잡으면 지구가 그 안에 든다.
  shardShot(b, dirX, dirY) {
    if (!b.alive) return
    const a = Math.atan2(dirY, dirX)
    this.addFx({
      kind: 'shatter', x: b.pos.x, y: b.pos.y, r: b.radius, a,
      cone: CFG.UNSTABLE_CONE, reach: shardReach(),
    })
    shardBurst(b, this.bodies, () => this.rng.next(), dirX, dirY)
    this.message = msg('msg.unstable', { name: nameOf(b), n: CFG.UNSTABLE_SHARDS, dir: bearing(dirX, dirY).toFixed(0) })
    // shatterIt=false — 산탄이 이미 이 공의 파편이다. 여기서 잔해까지 더하면
    // 같은 사건이 두 벌의 부스러기를 남긴다.
    this.killBody(b, 'burst', { fx: false, shatterIt: false })
  }

  // 부딪힌 자국. 산탄이 낀 충돌은 당구공 소리가 아니라 **꽂히는 소리**다 —
  // 판정은 같아도(onPlanetCollision) 그림과 소리는 갈려야 한다. 안 그러면
  // 일곱 갈래가 꽂히는 동안 화면에서 "공 일곱 개가 부딪혔다"로 읽힌다.
  hitFx(a, b, x, y, vRel, soft) {
    const s = a.shard ? a : b.shard ? b : null
    if (s) this.addFx({ kind: 'shard', x, y, r: hitRadiusOf(s), v: vRel })
    else this.addFx({ kind: 'bump', x, y, r: (hitRadiusOf(a) + hitRadiusOf(b)) * 0.5, v: vRel, soft })
  }

  // ─── 행성끼리의 충돌 = 당구 + 체력 ────────────────────────────
  // 규칙: 부딪히면 **당구공처럼 튕긴다**(운동량 보존). 그리고 체력이 닳는다
  // (상대속도가 빠를수록 1~3). 중립 행성은 체력 3이라 "같은 공을 계속 몰아붙이기"가
  // 되고, 조르그 요새는 1이라 한 번 제대로 처박으면 끝난다.
  // 자연스러운 공전 중의 느린 스침(상대속도 < COLLIDE_DMG_V)은
  // 데미지가 없다: 판이 저 혼자 정리되면 플레이어가 할 일이 사라진다.
  // 반환값 'destroyed' 는 배열이 변했다는 신호(파편 생성) — physics가 그 스텝을 끝낸다.
  //
  // **산탄도 이 함수를 그대로 지난다**(physics.resolveBodyPairs). 체력 1짜리
  // 공으로 취급되므로 가스 행성에 꽂히면 유폭하고 불안정 행성에 꽂히면 다시
  // 쪼개진다 — 연쇄가 성립하는 이유는 규칙을 따로 안 썼기 때문이다.
  // 산탄이라서 달라지는 것은 **말과 그림 둘뿐**이고(hitFx·아래 message),
  // 판정은 한 글자도 안 갈린다.
  onPlanetCollision(a, b) {
    // 가스 행성 — **세게** 처박히면 그 자리에서 유폭한다. 연쇄를 노릴 자리.
    //
    // 접촉만 하면 무조건 터지게 뒀더니 태양계가 저 혼자 정리돼 버렸다(계측:
    // 플레이어가 손도 대기 전에 목성이 100~360초에 자폭, 4개 중 2개가 900초
    // 안에 소멸). 압축된 판에서는 이웃 궤도끼리 스치는 일이 늘 있는데,
    // 그 정도 접촉으로 목성이 사라지면 판의 지형이 통째로 없어진다.
    // 그래서 문턱을 둔다: 스치는 건 튕기고, 진짜로 처박아야 터진다.
    const vRel0 = Math.hypot(a.vel.x - b.vel.x, a.vel.y - b.vel.y)
    // 쌍의 쿨다운을 **여기서 미리 읽는다.** 아래 당구 판정이 쓰는 것과 같은
    // 창이라야 "한 번의 만남은 한 번"이 두 규칙에서 같은 뜻이 된다 — 유폭이든
    // 파열이든 당구든, 한 번 붙은 쌍은 이 창 안에서 다시 판정되지 않는다.
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
    const last = this.pairCool.get(key) ?? -99
    const cool = (a.isEarth || b.isEarth) ? CFG.EARTH_HIT_COOLDOWN : CFG.HIT_COOLDOWN
    const fresh = this.time - last >= cool
    if (fresh && (a.role === 'volatile' || b.role === 'volatile') && vRel0 >= CFG.VOLATILE_TRIGGER_V) {
      this.pairCool.set(key, this.time)
      const vol = a.role === 'volatile' ? a : b, other = vol === a ? b : a
      this.message = msg('msg.collide.volatile', { a: nameOf(vol), b: nameOf(other), v: vRel0.toFixed(0) })
      // 친 공에게는 **한 대**만 준다. 3이던 시절에는 중립 행성(체력 3)이
      // 가스를 처박는 순간 같이 즉사했다 — 유폭 반경이 크다는 것과 "닿은 공이
      // 죽는다"는 다른 이야기인데 그 둘이 붙어 있었다. 유폭은 여전히 반경
      // 안을 통째로 밀지만(volatileBlast), 미는 것으로 죽는 천체는 없다.
      // (튕기지는 않는다 — 가스는 이 자리에서 사라지므로 튕길 것이 없다.)
      this.damage(other, 1, 'collision')
      this.volatileBlast(vol)
      return 'destroyed'
    }
    // 불안정 행성 — 같은 문턱, 같은 이야기. 다만 사방이 아니라 **때린 공의
    // 반대쪽으로** 쏜다: 공으로 밀어 쳐도 총구는 여전히 "맞은 살의 반대편"이라
    // 핵으로 칠 때와 규칙이 하나로 남는다. 밀어서 쏘는 수가 그래서 성립한다.
    const aU = a.role === 'unstable', bU = b.role === 'unstable'
    if ((aU || bU) && vRel0 >= CFG.UNSTABLE_TRIGGER_V) {
      const uns = aU ? a : b, other = uns === a ? b : a
      this.message = msg('msg.collide.unstable', { a: nameOf(uns), b: nameOf(other), v: vRel0.toFixed(0) })
      // 둘 다 불안정이면 **둘 다** 쪼개진다 — 서로의 반대쪽으로. 한쪽만 터뜨리면
      // 같은 태그가 같은 사건에서 다르게 굴어, 규칙이 조용히 둘이 된다.
      if (aU && bU) this.shardShot(other, other.pos.x - uns.pos.x, other.pos.y - uns.pos.y)
      else this.damage(other, 1, 'collision')
      this.shardShot(uns, uns.pos.x - other.pos.x, uns.pos.y - other.pos.y)
      return 'destroyed'
    }

    const cx = (a.pos.x + b.pos.x) / 2, cy = (a.pos.y + b.pos.y) / 2
    const vRel = elasticBounce(a, b)   // ← 여기서 실제로 튕긴다
    a.bumpFlash = 0.5; b.bumpFlash = 0.5
    // 접촉 판정은 한 번의 충돌에서 여러 스텝 이어질 수 있다 — 쿨다운으로 한 번만 센다

    //
    // **지구만 창이 길다.** 0.7초는 "같은 쌍이 여러 스텝 겹쳐 있다"를 막는 값인데,
    // 반발계수가 1이고 둘이 서로 끌어당기므로 한 번의 스침에서 접촉이 몇 번씩
    // 되풀이된다. 체력 1인 요새에서는 첫 판정에 끝나서 드러나지 않았지만,
    // 체력 3인 지구에서는 **한 번의 만남이 세 대**가 됐다(계측: 10시드 무입력
    // 시뮬에서 한 번의 당구로 지구가 3 → 0으로 죽는 판이 하나. 55초 동안 피해
    // 판정이 다섯 번 났다). 그러면 바로 위에서 눈금을 하나로 자른 것이 무의미해진다.
    // 한 번의 만남은 한 대다 — 나중에 궤도를 한 바퀴 돌아 다시 오는 것은
    // 새로운 만남이고(EARTH_HIT_COOLDOWN보다 한참 길다) 그건 그대로 또 맞는다.
    // (창 자체는 위에서 `fresh`로 이미 읽어 두었다 — 유폭 판정과 같은 창을
    //  써야 "한 번의 만남은 한 번"이 두 규칙에서 같은 뜻이 된다.)
    if (!fresh) {
      this.hitFx(a, b, cx, cy, vRel, true)
      return null
    }
    this.pairCool.set(key, this.time)

    const dmg = vRel < CFG.COLLIDE_DMG_V ? 0 : vRel >= 160 ? 3 : vRel >= 90 ? 2 : 1
    this.hitFx(a, b, cx, cy, vRel, dmg === 0)
    if (dmg === 0) {
      this.message = msg('msg.collide.soft', { a: nameOf(a), b: nameOf(b), v: vRel.toFixed(0) })
      return null
    }
    // 산탄이 꽂힌 것은 "공 둘이 부딪혔다"가 아니다 — 판정은 같아도 사건의
    // 이름은 다르다. 화면에 뜨는 문장도 그렇게 갈라 준다.
    const s = a.shard ? b : b.shard ? a : null
    this.message = s
      ? msg('msg.shard.hit', { name: nameOf(s), v: vRel.toFixed(0), dmg })
      : msg('msg.collide', { a: nameOf(a), b: nameOf(b), v: vRel.toFixed(0), dmg })
    // 둘 다 같은 피해를 받는다. 하나라도 박살나면 그 스텝은 거기서 끝낸다.
    const ka = this.damage(a, dmg, 'collision')
    const kb = this.damage(b, dmg, 'collision')
    return (ka || kb) ? 'destroyed' : null
  }

  // ─── 체력 처리 ───────────────────────────────────────────────
  // 지구도 예외가 아니다. 세 번 처박히면 지구도 끝난다 — 다만 그 전까지는
  // 튕겨 나갈 뿐이라 "스치기만 해도 즉사"하던 예전 규칙보다 훨씬 관대하다.
  //
  // ── 지구는 한 번에 한 대만 맞는다 ──
  // 충돌 피해는 상대속도로 갈린다: 90 넘으면 2, 160 넘으면 3(onPlanetCollision).
  // 그 눈금은 **부수라고 있는 것**이다 — 잘 처박은 한 방이 대형 요새(체력 2)를
  // 그 자리에서 끝내는 것이 플레이어의 보상이므로 그렇게 잡혀 있다.
  // 그런데 같은 눈금이 지구에도 그대로 걸려서, 상대속도 160으로 굴러온 공 하나가
  // **꽉 찬 지구를 그 한 번에 지웠다.** 그건 이 게임이 스스로 적어 둔 규칙과
  // 어긋난다(CFG.PLANET_HP 주석: "지구도 한 번 스쳤다고 끝나지 않는다").
  //
  // 계측으로 드러난 자리이기도 하다. 초엘리트가 가벼운 소행성을 9Mt로 밀면
  // Δv가 117이라 지구에 닿을 때 상대속도가 160을 넘는데, 10시드 무입력
  // 시뮬에서 **첫 한 수에 지구가 3 → 0으로 죽는** 판이 둘 있었다(t≈220).
  // 경고는 62초 있었지만 눈금이 하나도 안 남으므로, 플레이어는 "위험했다"를
  // 배울 기회 없이 런을 잃는다.
  //
  // 그래서 지구만 한 대씩 받는다. 세 번 처박히면 끝나는 것은 그대로이고
  // (EARTH_HP), 그 세 번이 화면에 세 번으로 보이게 된다. 미는 힘·튕김·폭풍은
  // 아무것도 안 바뀐다 — 깎이는 것은 **눈금 하나뿐**이다.
  // (지구에 직접 핵을 박는 것은 여전히 즉시 게임 오버다 — detonate는 체력을
  //  아예 안 거치고 판을 끝낸다. 그건 규칙이 아니라 선언이다.)
  damage(b, n, cause) {
    // 산탄은 **체력 1짜리 공**이라 여기서 안 걸러진다 — 맞으면 그대로 죽는다.
    // 걸러지는 건 장식용 잔해뿐이다: 잔해는 튕기기만 하고 아무 체력도 안 가진다.
    if (!b.alive || (b.type === 'debris' && !b.shard)) return false
    b.hp = (b.hp ?? CFG.PLANET_HP) - (b.isEarth ? Math.min(n, CFG.EARTH_MAX_DMG) : n)
    b.hitFlash = Math.max(b.hitFlash, 0.6)
    b.trailFlash = 2.0
    b.scorch = Math.min(3, (b.scorch || 0) + 1)
    if (b.hp > 0) {
      this.setToast(msg('toast.hp', { name: nameOf(b), hp: b.hp, hpMax: b.hpMax ?? CFG.PLANET_HP, left: b.hp }))
      return false
    }
    if (b.isEarth) {
      this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 2, earth: true })
      b.alive = false
      this.fail('EARTH_LOST', msg('msg.fail.earthCrush'))
      return true
    }
    // 산탄은 **조용히** 없어진다. 판정은 행성과 같아도 총알 하나가 다 쓰인 것을
    // 행성 폭파 연출로 알리면, 일곱 갈래가 꽂히는 동안 화면이 그걸로 덮인다.
    // 꽂혔다는 건 hitFx가 이미 말했다.
    if (b.shard) { this.killBody(b, cause, { fx: false }); return true }
    this.blastFx(b, 1.6)
    this.killBody(b, cause, { fx: false })
    return true
  }

  // ─── 부서지는 그림 ───────────────────────────────────────────
  // **조르그와 행성은 다르게 터진다.** 예전에는 이 fx 하나를 넷이 나눠 쓰고
  // 차이는 big 플래그(소리만) 하나였다 — 화면에서는 목성이 부서지는 것과 요새가
  // 부서지는 것이 같은 주황 화구였다. 이 게임의 유일한 보상이 배경 사건과
  // 구분이 안 됐다는 뜻이다.
  //
  // 이제 조르그는 **두 박자**다: 중심에서 사방으로 빛기둥이 뻗고(예열),
  // ZORG_BLAST_LEAD 뒤에 터진다(stepDying). 행성은 그대로 한 박자다.
  // 발행 자리를 여기 하나로 모아 둔다 — 부르는 곳이 넷이라(damage · laserEvent ·
  // tickDoom · killBody) 갈라 두면 그중 하나만 조용히 옛 그림으로 남는다.
  blastFx(b, rMul = 1.8) {
    if (b.zorg) {
      b.dying = CFG.ZORG_BLAST_LEAD
      this.addFx({
        kind: 'zorgCharge', x: b.pos.x, y: b.pos.y, r: hitRadiusOf(b),
        capital: !!b.mothership,
      })
      return
    }
    this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * rMul })
  }

  // 예열이 끝난 조르그를 터뜨린다. **실시간(dtFrame)으로 센다** — 마지막 요새를
  // 부수면 그 순간 판이 멈추므로(won → effTimeScale 0) 인게임 초로 재면 그
  // 폭발이 영영 안 온다. (워프인·추진기 대기가 실시간인 것과 같은 이유다.)
  stepDying(dtFrame) {
    for (const b of this.bodies) {
      if (!(b.dying > 0)) continue
      b.dying -= dtFrame
      if (b.dying > 0) continue
      b.dying = 0
      this.addFx({
        kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 1.8,
        zorg: true, capital: !!b.mothership,
      })
    }
  }

  // shatterIt 기본값에서 조르그를 뺀다 — **조르그는 파편을 안 남긴다.**
  // 빛기둥과 함께 통째로 증발하는 그림이라 잔해가 남으면 그 그림이 거짓말이 되고,
  // 덤으로 후반 판의 파편 노이즈(충돌 한 번에 예닐곱 개)가 그만큼 준다.
  killBody(b, cause, { fx = true, shatterIt = cause === 'collision' && !b.zorg } = {}) {
    if (b.trail) b.trail.length = 0   // 죽은 공의 잔여 트레일은 즉시 지운다
    if (!b.alive) return
    b.alive = false
    if (fx && b.type !== 'debris') {
      if (cause === 'sun') this.addFx({ kind: 'sun', x: b.pos.x, y: b.pos.y })
      else this.blastFx(b, 1)
    }
    // 파편은 더 쪼개지지 않는다 — 잔해의 잔해는 아무 정보도 아니다.
    if (shatterIt && b.type !== 'debris') shatter(b, this.bodies, () => this.rng.next())
    this.recordKill(b, cause)
    // 모성이 부서지면 난사가 그 자리에서 멎는다. **recordKill 다음이다** —
    // 저쪽이 판을 쓸어내는 동안의 파괴는 전과가 아니라는 규칙(recordKill의
    // doom 가드)을 모성 자신에게도 그대로 적용해야, 격파 문구가 하나로 남는다.
    if (b.mothership) this.doomBroken()
  }

  // 목표 판정에는 파괴 사유가 상관없다 — 요새가 없어졌으면 그걸로 끝이다.
  // 사유는 정치자금 판정(NO_CREDIT)과 로그 문구에만 쓴다.
  recordKill(b, cause) {
    if (b.type === 'debris') return
    // 모성이 온 뒤의 파괴는 **전과가 아니다.** 저쪽이 제 광선으로 판을 쓸어
    // 내는 중이고, 그 와중에 조르그 요새가 같이 녹아도 그건 내가 부순 게 아니다.
    // 자금·목표 갱신·문구를 전부 건너뛴다 — 이 화면의 문장은 하나뿐이다.
    if (this.doom) return
    const wasFort = this.isTarget(b)
    // 일반 조르그 행성이 2, 엘리트 이상(대형 요새·초엘리트)이 3. 중립 행성은 0 —
    // 판을 정리한 것이지 판돈을 회수한 게 아니다.
    if (wasFort && !NO_CREDIT.has(cause)) this.addPol(polFor(b), b.pos.x, b.pos.y)
    const label = { name: nameOf(b), cause: msg(`cause.${cause}`) }
    if (wasFort) {
      // 요새 하나가 곧 포대 하나다 — 부수면 그 순번이 통째로 사라진다.
      // (명단 정리는 tickLaser의 syncLasers가 한다. 이미 나가 있는 광선은
      //  거기서도 안 걷는다 — 쏜 뒤에 부순 건 늦은 것이다.)
      this.goal.update(this.aliveThreats)
      this.message = msg('msg.kill.goal', { ...label, title: msg('goal.title'), count: this.goal.label() })
      // 초엘리트가 부서지는 건 요새 하나가 부서지는 것과 다른 사건이다 —
      // 그 순간부터 지구로 공이 굴러오지 않는다. 그래서 문구를 갈라 준다.
      const down = b.role === 'siege' ? 'toast.siegeDown' : 'toast.fortDown'
      this.setToast(msg(down, { count: this.goal.label() }))
    } else {
      this.message = msg('msg.kill', label)
    }
    if (this.aliveThreats === 0) this.win()
  }

  // force = **모성을 부숴서 판을 되찾은 승리**(doomBroken). 그 한 수는 남은
  // 요새와 무관하게 판을 가져간다 — 시한이 끝난 뒤의 마지막 창에서 저것을
  // 처박았다는 사실 자체가 이 판의 결말이다("모성 격파 — 판을 되찾았다").
  win(force = false) {
    // 모성이 오는 중에는 절대 이기지 않는다. 예전엔 난사가 마지막 요새를
    // 태우는 순간 recordKill → win()이 그대로 걸려서, 성계가 쓸려나가는 와중에
    // 축하 화면이 떴다(그리고 won=true가 되면 시계가 멈춰 연출까지 얼어붙었다).
    if (this.won || this.lost || this.doom) return
    // **워프해 들어오는 중인 표적이 있으면 아직 안 끝났다.** 워프 중인 요새는
    // 도착까지 alive=false로 대기하는데 aliveThreats는 살아 있는 것만 세므로,
    // 그 창 안에서 마지막 요새가 부서지면 위협 0으로 읽혀 클리어가 난다. 그리고
    // won이 서면 checkEnd가 더 안 보므로 그 뒤에 도착한 요새는 **클리어된 판 위에
    // 그대로 선다** — 목표는 5/5인데 판에는 조르그가 살아 있고 시계까지 멎는다.
    // (워프는 판이 열릴 때뿐이지만, 그때도 충돌로 표적이
    //  죽을 수 있다. 목표 숫자에는 이미 들어가 있는 놈이므로 도착할 때까지
    //  기다렸다가 마저 부수는 게 규칙에 맞다.)
    // (모성을 부순 승리는 예외다 — 아래 force. 거기서 막으면 그 판은 이기지도
    //  지지도 못한 채 시한 뒤로 흘러 모성이 **한 번 더** 강림한다.)
    if (!force && this.warpingThreats > 0) return
    this.won = true
    this.message = msg('msg.win')
    this.setToast(msg('toast.win'))
  }

  // ─── 탄의 경계 ───────────────────────────────────────────────
  // 태양 낙하 / 자폭 시한 / **카이퍼 벨트 기폭**.
  // 공과 탄은 벨트에서 서로 다르게 굴러간다: 공은 쿠션에 튕겨 판돈으로
  // 돌아오고, 탄두는 **얼음 벽에 박아 그 자리에서 터진다.**
  // (튕겨 돌려보내던 시절엔 판 밖 둘레를 배회하다 TTL로 자폭하는 발이 흔했고,
  //  그동안 다음 탄을 못 쏘니 차례만 버렸다 — config.js BELT 항목 참고.)
  missileBounds(m) {   // §7.8
    const r = len(m.pos)
    if (r < CFG.R_STAR + 8) { m.alive = false; m.out = 'sun' }
    else if (m.age > CFG.MISSILE_TTL) { m.alive = false; m.out = 'timeout' }
    else if (r >= this.beltR) this.beltDetonate(m)
  }

  // 벨트 기폭 — 탄두가 얼음 벽에 박는다. 폭풍은 그대로 터지므로 벨트 근처의
  // 공은 밀린다(노리고 쓰면 바깥으로 튄 공을 되돌리는 수가 된다).
  beltDetonate(m) {
    const r = len(m.pos) || 1
    const nx = m.pos.x / r, ny = m.pos.y / r
    const x = nx * this.beltR, y = ny * this.beltR
    const speed = Math.hypot(m.vel.x, m.vel.y)
    m.alive = false; m.out = 'belt'
    const wave = blastWave(this.bodies, x, y, m.yld, null)
    this.addFx({ kind: 'belt', x, y, nx, ny, v: speed, missile: true })
    this.addFx({ kind: 'nuke', x, y, yld: m.yld, r: 16, wave: wave.radius, belt: true })
    if (wave.pushed.some(p => p.body.isEarth)) this.setToast(msg('toast.blastEarth'))
  }

  // ─── 성계 경계 ───────────────────────────────────────────────
  // 태양 낙하는 그대로 파괴다(안쪽 벽은 없다 — 태양이 곧 포켓이다).
  // 바깥쪽은 추방 대신 **카이퍼 벨트 쿠션**이다: 박으면 폭발하고, 속력을
  // 그대로 유지한 채 반사각으로 판 안으로 되돌아온다. 잃는 공은 없다.
  //
  // 예외는 파편이다. **장식용 잔해가 판에서 없어지는 자리는 여기 둘뿐이다** —
  // 카이퍼 벨트와 태양. 잔해는 체력이 없고(damage가 거른다) 행성에 닿으면
  // 튕기므로(physics.resolveBodyPairs), 판의 두 끝 말고는 걸릴 데가 없다.
  // 벨트에서 공처럼 튕겨 돌려보내면 잔해가 판이 끝날 때까지 벽을 왕복하며
  // "들이받는" 그림이 남는다 — 그래서 잔해만은 벨트에서 조용히 소멸한다
  // (폭발 연출 없음). 태양도 같다.
  // 산탄에는 셋째 퇴장로가 하나 더 있다: **시간**(config.SHARD_TTL). 안쪽으로
  // 쏜 갈래는 두 끝 어디에도 안 걸린 채 궤도에 얹힐 수 있는데, 샷건은 그
  // 순간의 사건이라 판에 남으면 안 된다. 그 시계는 여기가 아니라 stepBodies에
  // 있다 — 예측선이 같은 함수를 써야 거짓말을 안 한다.
  bodyBounds() {
    for (const b of this.bodies) {
      if (!b.alive) continue
      const r = len(b.pos)
      // ── 혜성만은 벽을 안 느낀다 ──
      // 이 판에서 카이퍼 벨트를 통과하는 유일한 천체다. 들어올 때도 나갈 때도
      // 그냥 지나간다(퇴장 판정은 comet.stepComets). **태양 낙하는 그대로
      // 적용된다** — 예외는 벨트 하나뿐이라는 게 이 태그의 전부다.
      if (b.comet && r >= this.beltR) continue
      if (r < CFG.R_STAR + 15) {
        if (b.isEarth) {
          this.addFx({ kind: 'sun', x: b.pos.x, y: b.pos.y })
          b.alive = false
          this.fail('EARTH_LOST', msg('msg.fail.earthSun'))
          return
        }
        this.killBody(b, 'sun', { shatterIt: false })
      } else if (r >= this.beltR && b.type === 'debris') {
        this.killBody(b, 'belt', { fx: false, shatterIt: false })
      } else if (r >= this.beltR) {
        const hit = beltBounce(b, this.beltR)
        if (!hit) continue
        if (this.time - (b.lastBelt ?? -99) < CFG.BELT_COOLDOWN) continue
        b.lastBelt = this.time
        b.trailFlash = 2.0; b.bumpFlash = 0.6
        // 글자는 안 붙인다. 벨트 반사는 판마다 수십 번 울리는 **배경 규칙**이라
        // 그때마다 "속력 유지, 반사각으로 복귀"를 적으면 정작 명중·격파 같은
        // 사건의 보고가 그 잡음에 묻힌다(지상 관제가 벨트에 입을 다무는 것과
        // 같은 이유다 — Ground.js SAY 주석). 튕기는 건 화면이 이미 말한다:
        // 꼬리가 번쩍이고, 벨트에 파문이 남고, 공이 각도대로 돌아 들어온다.
        this.addFx({ kind: 'belt', x: hit.x, y: hit.y, nx: hit.nx, ny: hit.ny, v: hit.speed, r: hitRadiusOf(b) })
      }
    }
  }

  // §14.4 실패 피드백 — 빗나간 샷마다 원인 태그 1개
  finishShot(m) {
    if (m.hit) return
    let tag
    // 실패는 셋이다: 태양에 삼켜짐 · 벨트에서 기폭 · TTL 자폭(또는 못 꺾임).
    if (m.out === 'sun') tag = msg('msg.miss.sun')
    else if (m.out === 'belt') tag = msg('msg.miss.belt')
    else if (m.encountered && m.bestDeflection < 10) tag = msg('msg.miss.fast', { deg: m.bestDeflection.toFixed(0) })
    else if (m.bestDeflection < CFG.SWING_DEG) tag = msg('msg.miss.bend', { deg: m.bestDeflection.toFixed(0), need: CFG.SWING_DEG })
    else tag = msg('msg.miss.timing')
    this.setToast(tag); this.message = tag
  }

  checkEnd() {
    // 모성이 오는 중이면 판정을 멈춘다 — 연출이 끝나야 진짜 종료다.
    // (안 막으면 광선이 지구를 부순 순간 EARTH_LOST로 끝나 버려 난사가 중간에 멎는다.)
    if (this.doom) return
    // 개막 중이면 판정을 미룬다 — 안 그러면 "요새 0기"로 도착하기도 전에
    // 클리어가 나 버린다. 막이 걷혀야 내 차례이므로 뜸까지 통째로 센다.
    if (this.warpPending || this.warpCurtain) return
    this.goal.update(this.aliveThreats)
    if (this.won || this.lost) return
    if (!this.earth.alive) { this.fail('EARTH_LOST', msg('msg.fail.earthLost')); return }
    // 위협이 어떤 이유로든 전멸했으면(연쇄로 같이 터졌든) 그 순간 클리어다
    if (this.aliveThreats === 0) { this.win(); return }
    // 시한 초과 — 날아가고 있는 마지막 한 발은 끝까지 보내준다.
    // 문장으로 통보하지 않는다. **모성이 온다.**
    if (this.time >= this.stageTime && !this.missiles.some(m => m.alive)) this.summonMothership()
  }

  // ─── 시한 종료 — 조르그 모성 ─────────────────────────────────
  // 시한을 넘기면 판돈을 회수하러 모성이 직접 온다. 지구 반대편 하늘로 워프해
  // 들어와 사방에 광선을 뿌린다. 막을 수는 없다 — 이건 싸움이 아니라 통보다.
  // 그래서 화면에 남기는 문장도 하나뿐이다: **그들이 왔다…**
  //
  // (예전에는 "작전 시한 초과. 조르그가 회랑을 재정비했다"라는 두 줄짜리 통보로
  //  끝냈다. 진 이유를 글로 읽는 것과 판이 쓸려나가는 걸 보는 것은 다른 일이다.)
  //
  // 다만 **길이 하나는 열려 있다.** 모성이 온 뒤에도 조준과 발사는 살아 있고
  // (canAim), 모성에 공을 처박으면 판을 되찾는다(doomBroken). 핵은 안 통하므로
  // 방법은 그것뿐이고, 체력이 10이라 한 번으로는 안 된다 — 여러 번 처박아야 한다.
  // 뜸은 한 박자(DOOM_WARP)뿐이라 그 공은 **이미 날고 있어야 한다.**
  // 대부분의 판은 그래도 진다 — 난사가 시작되면 지구는 2초를 못 버틴다.
  summonMothership() {
    if (this.doom) return
    // 자리: **지구와 같은 쪽 하늘, 궤도 바깥.** 처음엔 지구 정반대편(+π)에
    // 놓았는데 그러면 지구를 향하는 광선이 반드시 태양을 통과해 막혔다 —
    // 마지막 한 발이 매번 항성에 삼켜져 지구가 멀쩡히 살아남았다(계측: 5시드 전부).
    // 살짝만 비틀어(0.4 rad) 궤도선 위에 정확히 겹치지 않게 한다.
    const r = Math.hypot(this.earth.pos.x, this.earth.pos.y) || 400
    const a = Math.atan2(this.earth.pos.y, this.earth.pos.x) + 0.4
    const R = Math.min(this.beltR * 0.8, r * 2.4)
    const ship = makeBody({
      id: 'mothership', nameKey: 'planet.mothership', type: 'zorg',
      mu: CFG.DOOM_MU, radius: CFG.DOOM_R,
      pos: { x: Math.cos(a) * R, y: Math.sin(a) * R }, vel: { x: 0, y: 0 },
      hp: CFG.DOOM_HP, zorg: true, mothership: true, warp: 1,
    })
    this.bodies.push(ship)
    this.mothership = ship
    this.doom = makeDoom(ship.pos.x, ship.pos.y, this.aMax * CFG.LASER_RANGE_MUL, ship)
    this.addFx({ kind: 'warp', x: ship.pos.x, y: ship.pos.y, r: hitRadiusOf(ship), fort: true })
    // 총구가 달아오른다 — 요새가 충전할 때와 **같은 신호**를 쓴다. 저 붉은
    // 수축 링이 곧 "아직 안 쐈다"이고, 그동안이 마지막 한 수의 창이다.
    this.addFx({ kind: 'laserCharge', x: ship.pos.x, y: ship.pos.y, r: hitRadiusOf(ship) })
    this.setMode('observe')
    this.message = msg('msg.doom')
    this.setToast(msg('toast.doom'))
  }

  tickDoom(dt) {
    // 난사 도중에 모성이 부서질 수 있다(doomBroken이 this.doom을 끊는다) —
    // 그래서 이 함수는 지역 변수로 물고 돈다. 안 그러면 그 프레임의 남은
    // 사건에서 this.doom.x가 터진다.
    const D = this.doom
    for (const e of stepDoom(D, this, dt)) {
      if (e.kind === 'beam') {
        this.addFx({ kind: 'laserFire', x: D.x, y: D.y, a: e.a })
        continue
      }
      const b = e.body
      this.addFx({ kind: 'laserHit', x: e.x, y: e.y, r: b ? hitRadiusOf(b) : CFG.R_STAR, sun: !b })
      if (!b || b.mothership) continue   // 태양과 제 몸은 안 부서진다
      if (b.isEarth) {
        this.addFx({ kind: 'destroy', x: b.pos.x, y: b.pos.y, r: b.radius * 2, earth: true })
        b.alive = false
      } else {
        this.blastFx(b)
        this.killBody(b, 'laser', { fx: false })
      }
    }
    if (!this.doom) return   // 이 난사 도중에 모성이 부서졌다(doomBroken)
    this.message = msg('msg.doom')
    if (D.done) this.fail('TIME_UP', msg('msg.doom'))
  }

  // ─── 모성이 부서졌다 ─────────────────────────────────────────
  // 시한을 넘긴 판은 거의 다 진다. 그래도 **길이 하나는 있어야 한다** —
  // 못 부수는 물건이 하늘에 떠서 판을 지우는 동안 아무것도 할 수 없다면,
  // 그건 게임의 마지막 장면이 아니라 로딩 화면이다.
  //
  // 부수는 방법은 하나뿐이다: 공을 던지는 것(핵은 안 통한다 — detonate 참고).
  // 성공하면 난사가 그 자리에서 멎고, 아직 남은 요새가 있어도 판은 이긴 것으로
  // 친다. 모성을 잡은 판에서 요새 두어 기를 더 세라는 것은 규칙이 아니라 벌이다.
  doomBroken() {
    if (!this.doom) return
    this.doom = null                       // 총구가 멎는다(tickDoom이 더 안 돈다)
    this.timeWarn = 3                      // 시한 경고는 이미 다 울렸다
    this.setToast(msg('toast.doomDown'))
    this.message = msg('msg.doomDown')
    this.win(true)
  }

  fail(reason, msg) {
    if (this.lost) return
    this.lost = true; this.runOver = true; this.failReason = reason; this.message = msg
  }

  setToast(text) { this.toast = text; this.toastT = 1.6 }

  // 조준 가능 = 조준 모드일 것. 관측 모드에서는 조준선도 발사대도 사라진다.
  // (모성이 와 있어도 조준은 열려 있다 — 다만 그동안 판이 안 멈춘다.
  //  effTimeScale의 DOOM_AIM_SCALE 참고.)
  get canAim() {
    return this.mode === 'aim' && !this.won && !this.lost && this.earth.alive
  }

  // ─── 조준 보조 (aim.js) ─────────────────────────────────────
  // 계산은 전부 aim.js에 있다. 호출부(HUD·렌더러)가 바뀌지 않게 얇게 감싼다.
  predictPath() { return Aim.predictPath(this) }
  scanContact(dir = 1) { return Aim.scanContact(this, dir) }
}
