import { AudioEngine } from './engine.js'
import { Sfx } from './sfx.js'
import { Music } from './music.js'

// ─── 소리 담당 ──────────────────────────────────────────────────
// 게임 로직은 소리를 모른다. 화면에 무슨 일이 벌어졌는지만 fx 큐에 흘리고
// (game.addFx), 이쪽이 그걸 주워 듣는다 — 지상 관제(Ground.js)가 같은 큐를
// 듣고 말을 고르는 것과 똑같은 구조다.
//
// 그래서 이 파일이 하는 일은 셋뿐이다:
//   ① 사건 → 효과음   (onFx)
//   ② 전황 → 음악 레이어 (frame)
//   ③ 사람 → 볼륨·음소거 (M 키, 버튼)
//
// UI 소리(버튼·교신·토스트)는 부르는 쪽에서 AUDIO.ui('키')로 직접 친다.
// 눌린 버튼이 무엇인지는 fx 큐에 안 흐르기 때문이다.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// 사건이 몰리는 종류는 억제 창을 넓게 잡는다. 규약은 "같은 소리 30ms"이고
// 그 아래로는 절대 안 내려가지만, 벨트 반사처럼 판마다 수십 번 울리는 것은
// 30ms(초당 33번)로도 여전히 잡음이다.
const GAP = {
  bump: 0.09, bumpSoft: 0.14, belt: 0.13, boost: 0.16, swing: 0.12,
  doomBeam: 0.07, toast: 0.5, laserAlarm: 0.4, uiTick: 0.03,
}

export class AudioSystem {
  constructor() {
    this.engine = new AudioEngine()
    this.sfx = new Sfx(this.engine)
    this.music = new Music(this.engine)
    this.game = null
    this.view = null
    this.booted = false
    this.onMute = null        // 화면이 버튼 라벨을 고치려고 걸어 둔다

    // 이전 프레임의 판 상태 — 가장자리(edge)를 잡는 데 쓴다
    this.prev = {
      mode: null, curtain: null, won: false, over: false, stage: -1,
      timeWarn: 0, toast: null, goalDone: -1, doom: false, charging: false,
    }
    this.alarmT = 0
    this.themeWant = 'void'
    this.themeHold = 0
    this.pollT = 0            // 전황을 다시 읽기까지 (초)
    this.danger = 0

    // 음소거 — M. 오버레이(언어 선택·튜토리얼·승리 화면)가 떠 있어도 먹어야
    // 하므로 HUD의 키 처리에 얹지 않고 여기서 따로 듣는다. HUD 쪽은 개막
    // 중에 키를 통째로 잠그는데, 소리는 그 규칙과 상관이 없다.
    addEventListener('keydown', (e) => {
      if (e.key !== 'm' && e.key !== 'M') return
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // 아직 소리가 열리지 않았으면 끌 것도 없다. 여기서 상태만 뒤집어 두면
      // 시작 화면에서 M을 눌러 본 사람이 **소리 없이 시작하게 된다** —
      // 그 화면의 M 안내는 게임의 키를 알려 주는 것이지 지금 누르라는 게 아니다.
      if (!this.booted) return
      this.toggleMute()
    })
    // 탭이 뒤로 가면 내린다. 사용자가 껐던 상태는 안 건드린다.
    document.addEventListener('visibilitychange', () => {
      this.engine.setHidden(document.hidden)
      if (document.hidden) this.alarmT = 0
    })

    // ── 버튼 ──
    // 누르는 것은 전부 소리가 난다. 화면마다 따로 배선하지 않고 한 자리에서
    // 받는 이유는, 이 게임의 버튼이 여섯 화면에 흩어져 있고(패널·관측 바·
    // 승리·패배·튜토리얼·언어) 그중 셋은 필요할 때 만들어졌다 사라지기
    // 때문이다. 새 버튼이 생겨도 여기 배선을 안 해도 된다.
    // 스테퍼(.stepbtn)만 빼는데, 그건 누르고 있으면 반복되는 물건이라
    // 반복 한 칸마다 소리가 나야 하고 그건 눌린 자리에서만 알 수 있다.
    document.addEventListener('pointerdown', (ev) => {
      const b = ev.target?.closest?.('button')
      if (!b || b.disabled || b.classList.contains('stepbtn')) return
      if (b.id === 'mute') return                       // 토글 자신이 확인음을 낸다
      if (b.classList.contains('lpbtn')) return         // 언어 선택은 키로도 고를 수 있어 제가 낸다
      if (b.classList.contains('firebtn')) this.ui('uiHeavy')
      else if (b.classList.contains('vicbtn') || b.classList.contains('aimbtn')) this.ui('uiHeavy', 0.8)
      else this.ui('uiClick', 0.85)
    }, true)
  }

  // ── 첫 제스처 안에서. 여기까지는 동기다(자동재생 정책) ──
  unlock() {
    if (this.booted) return true
    if (!this.engine.unlock()) return false
    this.booted = true
    // 나머지는 시간이 걸린다: 리버브 임펄스를 굽고, 효과음 뱅크를 굽고,
    // 그다음 연주를 시작한다. 화면은 그동안 이미 넘어가 있다.
    ;(async () => {
      try {
        await this.music.build()
        this.music.setIntensity(0.2, 0.01)
        this.music.start()
      } catch { /* 음악이 안 서도 효과음은 나야 한다 */ }
      try { await this.sfx.prerender() } catch { /* 개별 재생 시 그때 굽는다 */ }
    })()
    return true
  }

  bind(game, view) {
    this.game = game
    this.view = view
    game.onFxAdd?.((e) => this.onFx(e))
  }

  // ── 볼륨 ──
  get muted() { return this.engine.muted }
  get volume() { return this.engine.volume }
  setVolume(v) { this.engine.setVolume(v) }
  toggleMute() {
    // 끄기 **직전에** 확인음을 낸다 — 끈 뒤에 내면 안 들린다.
    if (!this.engine.muted) this.play('muteOff', { gain: 0.9, priority: 1 })
    const m = this.engine.toggleMute()
    if (!m) this.play('muteOn', { gain: 0.9, priority: 1 })
    this.onMute?.(m)
    return m
  }

  // ── 재생 ──
  play(key, opts = {}) {
    return this.sfx.play(key, { gap: GAP[key] ?? 0, ...opts })
  }
  // UI 소리 — 패닝 없이 가운데서. 화면 위 사건이 아니라 손끝의 사건이다.
  ui(key, gain = 1) { return this.play(key, { gain }) }

  // 화면 좌표로 좌우를 잡는다. THREE.PositionalAudio를 쓰지 않는 이유는
  // 이 게임의 카메라가 2D 직교이고 줌이 계속 변해서, 3D 감쇄를 걸면
  // 같은 사건이 줌에 따라 다른 크기로 들리기 때문이다. 좌우만 준다.
  place(x, y) {
    const rig = this.view?.rig
    if (!rig || typeof rig.worldToScreen !== 'function') return { pan: 0, gain: 1 }
    let s
    try { s = rig.worldToScreen(x, y) } catch { return { pan: 0, gain: 1 } }
    const w = innerWidth || 1, h = innerHeight || 1
    const nx = (s.x / w) * 2 - 1, ny = (s.y / h) * 2 - 1
    const off = Math.max(Math.abs(nx), Math.abs(ny))
    // 화면 밖에서 벌어진 일도 들려야 한다(모함은 늘 궤도 바깥이다).
    // 다만 멀수록 작게 — 안 그러면 안 보이는 폭발이 화면 안 사건을 덮는다.
    const gain = off <= 1 ? 1 : Math.max(0.28, 1 - (off - 1) * 0.42)
    return { pan: Math.max(-0.85, Math.min(0.85, nx * 0.8)), gain }
  }

  // ─── 사건 → 소리 ───────────────────────────────────────────
  onFx(e) {
    if (!this.engine.ready) return
    const g = this.game
    const p = this.place(e.x, e.y)
    const at = (key, gain = 1, extra = {}) =>
      this.play(key, { gain: gain * p.gain, pan: p.pan, ...extra })

    switch (e.kind) {
      case 'launch':
        at('launch', 1)
        break

      case 'swing':
        at('swing', 0.9)
        break

      // 핵 기폭 — 위력에 따라 크기와 음정이 바뀐다. 큰 탄두일수록 낮게 운다.
      case 'nuke': {
        const y = e.yld ?? 12
        const k = clamp01((y - 1) / 29)                  // 1~30Mt
        if (e.earth) { at('nukeEarth', 1, { priority: 2 }); this.music.duck(0.18, 0.5) }
        else if (e.belt) at('nukeBelt', 0.75 + 0.2 * k)
        else at('nuke', 0.6 + 0.5 * k, { rate: 1.16 - 0.3 * k, priority: 1 })
        break
      }

      case 'destroy':
        if (e.earth) { at('destroyEarth', 1, { priority: 2 }); this.music.duck(0.15, 0.6) }
        else if (e.big) at('destroyBig', 1, { priority: 1 })
        else at('destroy', 0.8)
        break

      case 'volatile':
        at('volatile', 1, { priority: 1 })
        break

      case 'absorb':
        at('absorb', e.small ? 0.6 : 0.95, { rate: e.small ? 1.25 : 1 })
        break

      // 당구공. 상대속도가 곧 세기다 — 스치면 거의 안 들리고 처박으면 딱 소리가 난다.
      case 'bump': {
        const v = e.v ?? 0
        if (e.soft) at('bumpSoft', 0.4 + 0.4 * clamp01(v / 90))
        else at('bump', 0.55 + 0.45 * clamp01(v / 160), { rate: 1.1 - 0.25 * clamp01(v / 180) })
        break
      }

      case 'belt':
        // 탄두가 벨트에 박은 것은 반사가 아니라 기폭이다 — nuke가 따로 온다.
        if (!e.missile) at('belt', 0.5 + 0.4 * clamp01((e.v ?? 0) / 140))
        break

      case 'sun':
        at('sunFall', 1, { priority: 1 })
        break

      case 'warp':
        at(e.fort ? 'warpFort' : 'warp', 1, { priority: 1 })
        break

      case 'hive':
        at('hive', 0.95, { priority: 1 })
        break

      case 'boost':
        at('boost', 0.7)
        break

      case 'laserCharge':
        at('laserCharge', 1, { priority: 1 })
        break

      case 'laserFire':
        // 모성의 난사는 한 발 한 발이 사건이 아니다 — 짧고 마른 소리로 깐다.
        if (g?.doom) at('doomBeam', 0.55)
        else at('laserFire', 1, { priority: 1 })
        break

      case 'laserHit':
        at(e.sun ? 'laserHitSun' : 'laserHit', e.sun ? 0.8 : 1, { priority: e.sun ? 0 : 1 })
        break

      case 'laserMiss':
        at('laserMiss', 0.7)
        break

      default:
        break
    }
  }

  // ─── 매 프레임 ──────────────────────────────────────────────
  // main 루프가 불러 준다. 여기서 하는 일은 둘이다: 전황을 읽어 음악 레이어를
  // 크로스페이드하는 것과, 상태가 **바뀐 순간**에만 나는 소리를 잡는 것.
  frame(dt, game = this.game) {
    if (!this.engine.ready || !game) return
    const P = this.prev

    // ── 전황 ──
    // 매 프레임 풀 필요가 없다. 음악 레이어는 1.6초에 걸쳐 크로스페이드되므로
    // 12Hz로 읽어도 화면과 어긋나지 않고, 이 게임은 폭발이 터지면 한 프레임이
    // 100ms를 넘는 물건이라 프레임마다 도는 일은 하나라도 덜어야 한다.
    // (가장자리 판정은 아래에서 **매 프레임** 한다 — 그건 놓치면 안 된다.)
    this.pollT = (this.pollT ?? 0) - dt
    if (this.pollT <= 0) {
      this.pollT = 0.08
      const scale = game.effTimeScale()
      const speed = clamp01((scale - 1) / 7)
      let danger = 0
      const e = game.earth
      if (game.laserCharging) {
        danger = 0.50
        if (game.laserChargingCount > 1) danger = 0.65   // 배열을 훑으므로 물렸을 때만 묻는다
      }
      if (game.laserFlying) danger = Math.max(danger, 0.78)
      if (e && e.alive && (e.hp ?? 3) <= 1) danger = Math.max(danger, 0.60)
      const frac = game.stageTime ? game.timeLeft / game.stageTime : 1
      if (frac <= 0.25) danger = Math.max(danger, 0.55)
      if (frac <= 0.10) danger = Math.max(danger, 0.72)
      danger = Math.max(danger, Math.min(0.42, game.aliveThreats * 0.07))
      if (game.doom) danger = 1
      this.danger = danger
      this.music.setIntensity(clamp01(0.14 + 0.56 * danger + 0.30 * speed))
    }

    // ── 전경 주제 ──
    // 판이 급하면 저쪽 주제가, 내가 큐를 잡고 있으면 이쪽 주제가, 아무 일도
    // 없으면 우주가 앞에 선다. 문턱 근처에서 깜빡이지 않게 0.9초를 버틴다 —
    // 실제 교체는 그다음 마디 경계에서 일어난다(Music.scheduleBar).
    let want
    if (game.doom || game.lost) want = 'foe'
    else if (game.won) want = 'ally'
    else if (game.bare) want = 'void'
    else if ((this.danger ?? 0) >= 0.5) want = 'foe'
    else if (game.mode === 'aim') want = 'ally'
    else want = 'void'
    if (want !== this.themeWant) { this.themeWant = want; this.themeHold = 0 }
    else if (this.music.pending !== want) {
      this.themeHold += dt
      if (this.themeHold >= 0.9) this.music.setTheme(want)
    }

    // ── 충전 경보 ──
    // 조르그가 지구를 물고 있는 동안 계속 운다. 남은 시간이 짧을수록 빨라지고
    // 높아진다 — 화면의 카운트다운을 안 보고 있어도 급한 줄 알아야 한다.
    if (game.laserCharging && !game.bare && !game.doom && !game.runOver) {
      const left = game.laserLeft
      const urg = 1 - clamp01(left / 40)
      this.alarmT -= dt
      if (this.alarmT <= 0) {
        this.alarmT = 1.25 - 0.75 * urg
        this.play('laserAlarm', { gain: 0.45 + 0.4 * urg, rate: 1 + 0.35 * urg, gap: 0.3 })
      }
    } else this.alarmT = 0

    // ── 가장자리 ──
    // **예고편 중에는 판정 소리를 안 낸다.** 예고편은 실제 게임을 굴려서
    // 보여 주는 물건이라(Attract.js), 마지막에 요새가 부서지면 game.won이
    // 정말로 켜진다 — 그대로 두면 예고편의 결정적 한 방 위에 승리 팡파르가
    // 얹힌다. 폭발·광선·교신 같은 **사건의 소리는 그대로 낸다**: 그게
    // 예고편이 보여 주려는 것이고, 저 소리들은 판정이 아니라 화면이다.
    // (상태는 계속 따라간다 — 안 그러면 예고편이 끝난 순간 묵은 가장자리가
    //  한꺼번에 터진다.)
    const quiet = !!game.trailer

    // 모드 전환: 조준 ↔ 관측. 큐를 잡았다 놓았다 하는 그 순간이다.
    if (P.mode !== null && P.mode !== game.mode && !game.bare && !quiet) {
      this.play('uiToggle', { rate: game.mode === 'aim' ? 1 : 0.86 })
    }
    P.mode = game.mode

    // 막이 걷혔다 — 조작이 넘어온다. 판마다 한 번.
    const curtain = !!game.warpCurtain
    if (P.curtain === true && !curtain && !game.runOver && !quiet) {
      this.play('stageOpen', { gain: 0.9, priority: 1 })
    }
    P.curtain = curtain

    // 목표가 한 칸 줄었다. 격파음 위에 얹히는 짧은 확인음이다.
    const done = game.goal?.done ?? -1
    if (P.goalDone >= 0 && done > P.goalDone && !quiet) this.play('goalDown', { gain: 0.8, priority: 1 })
    P.goalDone = done

    // 시한 경고 60/30/10초
    if (game.timeWarn > P.timeWarn && !quiet) {
      this.play('warnTime', { gain: 0.8, rate: 1 + 0.08 * game.timeWarn, priority: 1 })
    }
    P.timeWarn = game.timeWarn

    // 토스트 한 줄. 아주 작게 — 이게 크면 사건 소리를 덮는다.
    // 화면에 안 뜨는 구간(개막·예고편)에서는 소리도 안 난다.
    if (game.toast && game.toast !== P.toast && game.toastT > 0 && !quiet && !game.bare) {
      this.play('toast', { gain: 0.5 })
    }
    P.toast = game.toast

    // 모성이 왔다. 판이 끝나는 소리다.
    if (!P.doom && game.doom) { this.play('doomWarp', { gain: 1, priority: 2 }); this.music.setTheme('foe') }
    P.doom = !!game.doom

    // 승리 / 패배 — 음악을 잠깐 눌러 준다. 마지막 폭발이 화음에 묻히면 안 된다.
    if (!P.won && game.won && !game.runOver && !quiet) {
      this.play('victory', { gain: 1, priority: 2 }); this.music.duck(0.4, 1.0)
    }
    if (P.won && !game.won) this.music.unduck()
    P.won = !!game.won

    if (!P.over && game.runOver && !quiet) { this.play('defeat', { gain: 1, priority: 2 }); this.music.duck(0.22, 1.4) }
    if (P.over && !game.runOver) this.music.unduck()
    P.over = !!game.runOver

    // 판이 바뀌었다(다음 침공) — 눌러 둔 음악을 되돌린다.
    if (P.stage !== game.stageIdx) { if (P.stage >= 0) this.music.unduck(); P.stage = game.stageIdx }
  }
}

// 화면 어디서든 같은 것을 쓴다. 소리는 하나뿐이므로 인스턴스도 하나다.
export const AUDIO = new AudioSystem()
