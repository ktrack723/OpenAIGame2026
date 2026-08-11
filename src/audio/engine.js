import * as THREE from 'three'
import * as Tone from 'tone'

// ─── 오디오 엔진 — 컨텍스트 하나, 마스터 하나 ───────────────────
//
// 이 게임의 소리는 넷이 나눠 만든다: ZzFX(효과음) · <audio>(배경음악 파일,
// bgm.js) · Tone.js(그 파일을 못 받아 왔을 때의 관현악) · three(공간 오디오,
// 지금은 안 쓰지만 언젠가). **저마다 다른 AudioContext를 만들면** 브라우저마다
// 6~8개인 컨텍스트 상한을 금방 까먹고, 무엇보다 하나만 resume되고 나머지는
// 영영 잠들어 있는 사고가 난다. 그래서 컨텍스트는 우리가 하나 만들어서 나눠 준다.
//
// ── 만드는 자리 ──
// **첫 사용자 제스처 핸들러 안**이다(unlock). 자동재생 정책 때문이기도 하지만,
// 그보다 먼저 만들어 두면 suspended인 채로 앉아 있다가 resume 타이밍을 놓친다.
// 시작 화면의 "CLICK TO START"가 그 제스처다(ui/StartGate.js).
//
// ── 순서 ──
//   ① 네이티브 AudioContext 생성
//   ② THREE.AudioContext.setContext(ctx)   ← THREE.Audio 객체보다 **먼저**
//   ③ Tone.setContext(ctx, true)           ← 옛 컨텍스트는 버린다
//   ④ ctx.resume()                         ← 같은 제스처 안에서
// ②를 ③보다 먼저 두는 데 특별한 이유는 없지만, 순서를 못 박아 두면
// "three가 제 컨텍스트를 만들어 버렸다"가 코드 읽는 것만으로 배제된다.
//
// ── 마스터 ──
//   sfxBus  ─┐
//            ├→ master → compressor → destination
//   musicBus ┘
// 컴프레서는 폭발이 겹치는 순간을 위한 것이다. 이 게임은 한 프레임에
// 충돌·폭발·격파가 같이 터지는 일이 흔한데, 그때 합이 그대로 1.0을 넘으면
// 클리핑이 "지직" 소리로 들린다. 게인을 미리 낮춰서 막을 수도 있지만
// 그러면 조용한 구간이 통째로 안 들린다.

// 모든 gain 변경의 최소 램프 길이(초). 값을 즉시 꽂으면 파형이 끊겨 딸깍거린다.
export const MIN_RAMP = 0.005
// exponentialRampToValueAtTime은 0에 못 간다(0을 주면 예외). 하한을 못 박는다.
export const EXP_FLOOR = 0.0001

// ─── 게인 램프 ──────────────────────────────────────────────────
// 이 파일 밖에서 AudioParam.value에 직접 대입하는 곳은 없어야 한다.
// 지금 값에서 목표까지 최소 5ms에 걸쳐 간다. 둘 다 하한 위에 있으면
// 지수 램프(사람 귀는 게인을 로그로 듣는다), 하나라도 0에 붙으면 선형이다 —
// 지수 램프로는 0에 닿을 수 없기 때문이다.
export function rampParam(param, target, dur = MIN_RAMP, ctx = null) {
  const now = ctx ? ctx.currentTime : (param.context?.currentTime ?? 0)
  const d = Math.max(MIN_RAMP, dur)
  const from = param.value
  param.cancelScheduledValues(now)
  param.setValueAtTime(from, now)
  if (from > EXP_FLOOR && target > EXP_FLOOR) {
    param.exponentialRampToValueAtTime(Math.max(EXP_FLOOR, target), now + d)
  } else {
    param.linearRampToValueAtTime(target, now + d)
  }
  return now + d
}

// Tone의 Param/Signal도 같은 규칙으로 민다. Tone은 제 스케줄러를 쓰므로
// rampTo/exponentialRampTo에 맡기되, 하한과 최소 길이는 여기서 못 박는다.
export function rampTone(param, target, dur = MIN_RAMP) {
  if (!param) return
  const d = Math.max(MIN_RAMP, dur)
  const from = typeof param.value === 'number' ? param.value : 0
  if (from > EXP_FLOOR && target > EXP_FLOOR) param.exponentialRampTo(Math.max(EXP_FLOOR, target), d)
  else param.linearRampTo(target, d)
}

export class AudioEngine {
  constructor() {
    this.ctx = null
    this.ready = false      // 컨텍스트가 살아 있다
    this.failed = false     // 이 브라우저에서는 소리를 못 낸다 — 조용히 포기한다
    this.muted = false
    this.volume = 0.6       // 초기 볼륨 (요구 사양)
    this.hidden = false     // 탭이 뒤로 갔다
  }

  // ── 첫 제스처 안에서 부른다. **동기다.** ──
  // 여기서 await를 걸면 resume이 제스처 밖으로 밀려나 사파리에서 안 열린다.
  // 컨텍스트를 열고 배선까지만 하고, 시간이 걸리는 일(리버브 임펄스 생성,
  // 효과음 굽기)은 부른 쪽이 이어서 비동기로 한다.
  unlock() {
    if (this.ready || this.failed) return this.ready
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!AC) { this.failed = true; return false }
    let ctx
    try {
      ctx = new AC({ latencyHint: 'interactive' })
    } catch { this.failed = true; return false }
    this.ctx = ctx

    // ① three — **THREE.Audio 객체를 만들기 전에.** 지금 이 게임은 THREE.Audio를
    //    하나도 안 쓰지만, 쓰기 시작하는 순간 이 한 줄이 있고 없고가 갈린다:
    //    three는 제 전역 컨텍스트를 처음 필요할 때 스스로 만들어 버린다.
    try { THREE.AudioContext.setContext(ctx) } catch { /* three가 없어도 소리는 난다 */ }

    // ② Tone — 두 번째 인자가 "옛 컨텍스트를 버려라"다.
    //    (tone.module.js는 import만으로 컨텍스트를 만들지 않게 잘라 두었지만,
    //     Tone이 어딘가에서 하나 만들어 두었더라도 여기서 정리된다.)
    //
    //    lookAhead·updateInterval은 기본값(0.1 / 0.03)보다 넉넉히 잡는다.
    //    Tone의 시계는 워커가 updateInterval마다 메인 스레드를 깨워서 도는데,
    //    이 게임은 폭발이 터지면 한 프레임이 100ms를 넘는 물건이라 기본값이면
    //    그 한 프레임 안에 시계가 서너 번 깬다(계측: 오디오가 프레임당 8ms를
    //    더 먹었다). 우리는 **한 마디를 통째로 미리 예약하므로**(music.js)
    //    150ms 앞을 보는 것으로 충분하고, 늦게 깨어도 노트는 제자리에 난다.
    const opts = { context: ctx, lookAhead: 0.15, updateInterval: 0.05, clockSource: 'worker' }
    try { Tone.setContext(new Tone.Context(opts), true) } catch { Tone.setContext(ctx) }

    // ③ 배선. 소스는 전부 두 버스 중 하나로 들어온다.
    this.compressor = ctx.createDynamicsCompressor()
    this.compressor.threshold.value = -15
    this.compressor.knee.value = 14
    this.compressor.ratio.value = 4
    this.compressor.attack.value = 0.004
    this.compressor.release.value = 0.18
    this.compressor.connect(ctx.destination)

    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : this.volume
    this.master.connect(this.compressor)

    this.sfxBus = ctx.createGain()
    this.sfxBus.gain.value = 0.85
    this.sfxBus.connect(this.master)

    this.musicBus = ctx.createGain()
    this.musicBus.gain.value = 0.75
    this.musicBus.connect(this.master)

    // ④ 같은 제스처 안에서 resume. Tone.start()도 결국 이 resume을 부르지만,
    //    둘 다 불러 둔다 — Tone이 제 상태 플래그를 같이 갱신하기 때문이다.
    try { ctx.resume() } catch { /* 이미 running */ }
    try { Tone.start() } catch { /* 위의 resume으로 충분하다 */ }

    this.ready = true
    return true
  }

  // 사람 귀에 맞춘 목표 게인. 음소거·탭 전환·볼륨이 전부 여기로 모인다.
  target() { return this.muted || this.hidden ? 0 : this.volume }

  applyGain(dur = 0.06) {
    if (!this.ready) return
    rampParam(this.master.gain, this.target(), dur, this.ctx)
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v))
    this.applyGain(0.05)
  }

  setMuted(m) {
    this.muted = !!m
    // 켤 때는 빠르게, 끌 때는 조금 길게 — 끄는 소리가 뚝 끊기면 그게 더 거슬린다.
    this.applyGain(this.muted ? 0.09 : 0.04)
  }

  toggleMute() { this.setMuted(!this.muted); return this.muted }

  // 탭이 뒤로 가면 소리를 내린다. 음소거 상태는 안 건드린다 — 돌아왔을 때
  // 사용자가 껐던 것까지 켜 주면 그건 사용자의 선택을 지운 것이다.
  setHidden(h) {
    this.hidden = !!h
    this.applyGain(0.12)
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0 }
}
