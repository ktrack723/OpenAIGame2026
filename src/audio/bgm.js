import { Music } from './music.js'
import { rampParam, EXP_FLOOR } from './engine.js'

// ─── 배경음악 — 곡 **둘**을 판에 따라 갈아 준다 ──────────────────
//
// 효과음은 지금도 파일이 없다 — ZzFX가 그 자리에서 파형을 계산한다(sfx.js).
// 음악만 파일이고, 이제 두 곡이다:
//
//   dorian-gates   (3:32.9) — 1~4스테이지. 규칙을 배우고 요새를 하나씩 지우는 판.
//   starforge-ace  (4:14.1) — 5스테이지부터 끝까지. 초엘리트가 서고 하늘이
//                             검붉어지는 판(TRACK_STAGE는 config가 아니라 부르는
//                             쪽이 정한다 — audio/index.js).
//
// 인터페이스는 Music(Tone.js 관현악)과 한 글자도 다르지 않다:
//   build · start · stop · setIntensity · setTheme · setTrack · duck · unduck · pending
// 그래서 audio/index.js는 지금 소리를 내는 것이 파일인지 악보인지 모르고,
// 알 필요도 없다. music.js를 안 지우고 두는 이유도 그것이다 — 파일을 못
// 받아 오면 그 자리에 악보가 대신 선다(build 아래).
//
// ══ 왜 decodeAudioData가 아니라 <audio>인가 ═══════════════════════
// 두 곡을 합쳐 7분 27초다. AudioBuffer로 통째로 풀면 스테레오 float32로
// 150MB가 넘게 램에 눌러앉는다. 효과음(길어야 2초)은 미리 구워서 들고 있는 게
// 맞지만(sfx.js) 4분짜리 음악은 아니다. <audio>는 받아 가며 재생하므로 첫
// 소리가 빨리 나고 메모리는 몇 MB로 끝난다. 대신 표본을 못 만지는데,
// 음악에는 만질 일이 없다 — 자르고 겹치고 음정을 흔드는 것은 효과음의 일이다.
//
// createMediaElementSource로 우리 그래프에 물리면 그 뒤로는 효과음과 똑같다.
// 볼륨·음소거·탭 전환·더킹이 전부 같은 마스터를 지난다(engine.js). **엘리먼트
// 자체의 volume은 건드리지 않는다** — 그걸 쓰면 음소거 한 번이 두 군데로
// 갈라져서, 어느 쪽이 실제로 소리를 잡고 있는지가 코드에서 안 보이게 된다.
//
// ══ 이음매 ════════════════════════════════════════════════════════
// 두 곡을 재 봤다(MP3 비트스트림의 global_gain을 0.5초 창마다 최댓값으로 —
// 한 눈금이 1.5dB다):
//   · dorian-gates  — 209.0초부터 gain 170 → 151로 3.5초에 걸쳐 −46dB 잦아든다.
//   · starforge-ace — 252.0초부터 gain 186 → 144로 2.5초에 걸쳐 −63dB.
//   · 둘 다 **머리는 첫 프레임부터 제 크기다**(gain 176~181, 램프 없음).
// 즉 두 곡 모두 **스스로 끝난다.** 그래서 이어 붙이는 자리에 "턱" 할 구석이
// 없다. 루프는 브라우저에 그냥 맡기고(el.loop) 이음매에 아무것도 안 건다.
// 페이드아웃을 걸 자리도 없다 — 걸어 봐야 이미 −46dB인 구간을 한 번 더 줄이는
// 것이고, 들리는 데까지 올려 잡으면 그건 곡의 마지막 3초를 우리가 지우는 것이다.
//
// ══ 곡을 바꾸는 자리 ══════════════════════════════════════════════
// 갈아타는 것은 **크로스페이드**다. 끊고 새로 켜면 그건 곡이 바뀐 게 아니라
// 음악이 한 번 죽은 것으로 들린다. 나가는 곡의 문을 닫으면서 들어오는 곡의
// 문을 같이 여는데, 두 램프가 같은 시간(TRACK_FADE)을 쓰므로 총량은 대체로
// 유지된다 — 지수 램프라 중간에 살짝 파이지만 2.4초짜리 곡선에서는 안 들린다.
//
// 나가는 곡은 **세워 두고 머리로 되감는다**(0으로). 판이 5스테이지로 넘어간
// 뒤에 1~4스테이지 곡이 뒤에서 조용히 계속 흐르면 그건 대역폭과 배터리를
// 태우는 것이고, 새 런에서 다시 1스테이지 곡으로 돌아올 때 그 곡이 3분쯤
// 지난 자리에서 이어져 버린다.
//
// ══ 감시 ══════════════════════════════════════════════════════════
// 초에 한 번 **지금 곡의** 재생이 살아 있는지만 본다. iOS는 탭이 뒤로 가면
// 재생을 끊고 돌아와도 스스로 잇지 않는데, 사건(pause·suspend·interruptend)을
// 다 좇는 것보다 여기서 확인하는 편이 싸고 놓치는 경우가 없다.

// 파일 자리. import.meta.url 기준이라 어디에 올려도 따라온다 —
// three·tone을 src/vendor에 두고 importmap으로 거는 것과 같은 이유로
// 절대경로도 CDN도 안 쓴다.
const SRC = {
  dorian: new URL('../../assets/audio/dorian-gates.mp3', import.meta.url).href,
  starforge: new URL('../../assets/audio/starforge-ace.mp3', import.meta.url).href,
}
// 처음 서는 곡. 이 곡만 첫 소리를 못 내면 악보로 물러난다(아래 build) —
// 뒷곡은 아직 필요하지 않으므로 그 성패로 판을 세우지 않는다.
const FIRST_TRACK = 'dorian'

const READY_MS = 9000        // 이 안에 첫 소리를 못 내면 악보로 간다
const POLL_MS = 1000         // 재생이 살아 있는지 보는 주기

const FADE_IN = 0.9          // 음악이 들어오는 데 걸리는 시간 (초)
const FADE_OUT = 0.4         // 나가는 데 (초)
// 곡을 갈아타는 데. 2.4초는 "곡이 바뀌었다"로 읽히면서 "음악이 끊겼다"로는
// 안 들리는 폭이다. 이보다 짧으면 컷이고, 길면 두 곡이 겹쳐 있는 구간이
// 한 마디를 넘어가 화성이 부딪힌다.
const TRACK_FADE = 2.4

// 음악은 게임 **아래에** 깔린다. 이건 이미 마스터링된 파일이라 피크가
// 0dBFS에 붙어 있고 RMS가 −16dBFS다 — 그대로 틀면 폭발도 교신도 전부 그
// 밑으로 들어간다. 그래서 여기서 한 번 눌러 앉힌다.
//
// 값은 재서 정했다. 마스터(0.6)와 musicBus(0.75)를 지나 스피커로 나가는
// 자리에서 음악은 −32dBFS RMS(조용할 때) ~ −30dBFS(다 급할 때)에 선다.
// 같은 자리에서 효과음의 피크는 기폭 −7.8, 격파 −8.8, 발사 −10, 버튼 −13.7,
// 충돌 −27.7이다.
//
// 음악을 RMS로, 효과음을 피크로 재는 것이 저울이 기울어서가 아니다 —
// 연속음과 순간음은 같은 숫자라도 다르게 들린다. 음악을 폭발과 같은 높이에
// 세우면 폭발이 음악에 묻히고, 이 게임에서 폭발은 사건이다.
const LEVEL_MIN = 0.56, LEVEL_MAX = 0.76

// 색 — 조용하면 문 너머에서 들리는 것처럼 어둡게, 급해지면 활짝 연다.
const CUT_MIN = 3000, CUT_MAX = 20000

// 주제 — 곡마다 노래하는 사람을 바꿀 수는 없다. Music은 주제 셋을 같은
// 화성 위에 얹어 두고 마디 경계에서 갈아탔지만(music.js), 파일로 할 수 있는
// 것은 색뿐이다. 그래서 아주 조금만 민다: 적이 앞에 서면 반 발 다가오고,
// 아무 일도 없으면 반 발 물러난다. 이보다 크게 움직이면 연출이 아니라
// 고장으로 들린다.
const TILT = {
  foe: { level: +0.035, bright: +0.35 },     // bright = 차단 주파수를 옥타브로 민다
  ally: { level: 0, bright: 0 },
  void: { level: -0.035, bright: -0.35 },
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

export class Bgm {
  constructor(engine) {
    this.engine = engine
    this.built = false        // 소리를 낼 준비가 **다 됐다**. 도중에 실패하면 안 선다.
    this.building = false
    this.running = false
    this.theme = 'void'
    this.intensity = -1       // 아직 아무도 안 정했다
    this.track = FIRST_TRACK
    this.tracks = new Map()   // 이름 → { el, node, gate, resuming }
    this.timer = null
    this.fallback = null      // 파일을 못 받아 왔다 — Tone.js 악보가 대신 선다
  }

  // index.js가 이걸 보고 같은 주제를 매 프레임 다시 예약하지 않는다.
  // Music은 마디 경계까지 기다리느라 예약(pending)과 지금(theme)이 갈리지만,
  // 이쪽은 기다릴 마디가 없어서 둘이 같은 값이다.
  get pending() { return this.fallback ? this.fallback.pending : this.theme }
  // 지금 소리를 내고 있는 곡. 부르는 쪽이 같은 곡을 두 번 걸지 않게 본다.
  get playing() { return this.fallback ? null : this.track }
  get cur() { return this.tracks.get(this.track) ?? null }

  // ── 준비 ──
  // engine.unlock() 뒤에, **첫 제스처와 같은 틱에서** 불러야 한다.
  // 첫 await 전까지가 그 제스처 안이고, <audio>의 재생 허락은 거기서 딴다.
  async build() {
    if (this.built || this.building || !this.engine.ready) return this.built
    this.building = true

    // ── 여기부터 첫 await 전까지가 제스처 안이다 ──
    // <audio>의 재생 허락은 AudioContext의 허락과 **따로 논다**. 컨텍스트를
    // 열어 뒀어도 이 재생이 손끝에서 시작되지 않으면 iOS 사파리는 거절한다.
    // 그래서 **두 곡 다** 만들자마자 재생을 걸어 자격부터 딴 뒤, 지금 틀 곡이
    // 아니면 머리로 되감아 세워 둔다. 5스테이지에 가서야 뒷곡을 만들면 그때는
    // 이미 제스처 밖이라 iOS에서 그 곡이 영영 안 울린다.
    let ok = false
    try {
      for (const name of Object.keys(SRC)) this.makeTrack(name)
      // 공용 뒷단 — 색·전황·더킹은 곡이 바뀌어도 그대로 이어져야 한다.
      // (곡마다 따로 두면 갈아타는 순간 필터가 초기값으로 되돌아가 하늘이
      //  급한데 음악만 문을 닫는 그림이 나온다.)
      const ctx = this.engine.ctx
      this.color = ctx.createBiquadFilter()
      this.color.type = 'lowpass'
      this.color.frequency.value = CUT_MIN
      this.color.Q.value = 0.7
      this.level = ctx.createGain()
      this.level.gain.value = LEVEL_MIN
      this.out = ctx.createGain()
      this.out.gain.value = 1                   // 더킹이 잡는 손잡이 (Music.out과 같은 자리)
      for (const tr of this.tracks.values()) tr.gate.connect(this.color)
      this.color.connect(this.level)
      this.level.connect(this.out)
      this.out.connect(this.engine.musicBus)

      for (const tr of this.tracks.values()) this.play(tr)
      // 판이 서는지는 **첫 곡**으로만 판단한다. 뒷곡은 5스테이지까지 시간이
      // 한참 있으므로 여기서 기다릴 이유가 없고, 기다리면 개막이 그만큼 늦다.
      ok = await this.canPlay(this.tracks.get(FIRST_TRACK).el)
    } catch { ok = false }

    // 파일이 없거나(배포 사고) 이 브라우저가 못 읽는다 — 악보로 간다.
    // 둘 다 실패하면 음악 없이 효과음만 나는 것이고, 그건 이 게임이 원래
    // 있던 자리라 아무것도 안 망가진다.
    if (!ok) {
      this.teardown()
      try {
        const m = new Music(this.engine)
        await m.build()
        if (m.built) this.fallback = m
      } catch { /* 음악이 안 서도 효과음은 나야 한다 */ }
    }

    this.built = ok || !!this.fallback
    this.building = false
    return this.built
  }

  // 곡 하나 — 엘리먼트와 제 문(gate) 하나. 문 뒤는 전부 공용이다:
  //
  //   <audio> → gate(이 곡의 들고남) → color(밝기) → level(전황) → out(더킹) → musicBus
  //
  // 같은 출처의 파일이라 CORS는 필요 없다. 다른 출처에서 가져오면
  // createMediaElementSource는 **소리 없이** 무음을 흘린다(브라우저 규약).
  makeTrack(name) {
    const ctx = this.engine.ctx
    const el = new Audio()
    el.src = SRC[name]
    el.loop = true          // 루프는 브라우저가 돈다. 이음매는 곡이 스스로 만든다(위)
    el.preload = 'auto'
    el.playsInline = true   // iOS — 음악에 전체 화면을 뺏기지 않는다
    const node = ctx.createMediaElementSource(el)
    const gate = ctx.createGain()
    gate.gain.value = EXP_FLOOR              // start() / setTrack()이 연다
    node.connect(gate)
    const tr = { name, el, node, gate, resuming: false }
    this.tracks.set(name, tr)
    return tr
  }

  // 첫 소리를 낼 수 있는가. canplay(버퍼가 찼다) · error(못 읽는다) ·
  // 시간초과 셋 중 먼저 오는 것으로 끝낸다 — 느린 회선에서 게임이 음악을
  // 기다리며 서 있으면 안 된다.
  canPlay(el) {
    return new Promise((resolve) => {
      if (el.readyState >= 3) return resolve(true)      // HAVE_FUTURE_DATA
      let done = false
      const fin = (v) => {
        if (done) return
        done = true
        clearTimeout(t)
        el.removeEventListener('canplay', okFn)
        el.removeEventListener('playing', okFn)
        el.removeEventListener('error', badFn)
        resolve(v)
      }
      const okFn = () => fin(true)
      const badFn = () => fin(false)
      const t = setTimeout(() => fin(el.readyState >= 3), READY_MS)
      el.addEventListener('canplay', okFn)
      el.addEventListener('playing', okFn)
      el.addEventListener('error', badFn)
    })
  }

  start() {
    if (this.fallback) return this.fallback.start()
    const tr = this.cur
    if (!this.built || this.running || !tr) return
    this.running = true
    // 자격을 딸 때 흘러간 만큼(대개 1초 안쪽) 되감는다. 곡의 머리부터
    // 시작해야 판의 첫 순간과 곡의 첫 순간이 같이 선다.
    this.rewind(tr)
    this.play(tr)
    // 문을 연다. 여기서 게인을 즉시 꽂으면 딸깍거리고(engine.js의 규약),
    // 무엇보다 음악이 **켜진** 것처럼 들린다 — 들어와야 한다.
    rampParam(tr.gate.gain, 1, FADE_IN, this.engine.ctx)
    this.timer = setInterval(() => this.watch(), POLL_MS)
  }

  stop() {
    if (this.fallback) return this.fallback.stop()
    if (!this.running) return
    this.running = false
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
    // 끊지 않고 내린다. 음악이 뚝 멎는 것은 그 자체로 사건처럼 들린다.
    for (const tr of this.tracks.values()) rampParam(tr.gate.gain, EXP_FLOOR, FADE_OUT, this.engine.ctx)
    setTimeout(() => {
      if (this.running) return
      for (const tr of this.tracks.values()) { try { tr.el.pause() } catch { /* 이미 멈춤 */ } }
    }, FADE_OUT * 1000 + 50)
  }

  // ─── 곡 교체 ────────────────────────────────────────────────
  // 판이 5스테이지로 넘어가면 부르는 쪽이 이걸 건다(audio/index.js).
  // 크로스페이드다 — 나가는 곡과 들어오는 곡이 같은 시간을 쓴다.
  setTrack(name) {
    if (this.fallback) return this.fallback.setTrack?.(name)
    if (!SRC[name] || name === this.track) return
    const next = this.tracks.get(name)
    if (!next) return
    const prev = this.cur
    this.track = name
    // 아직 음악이 시작되지 않았으면(개막 전) 이름만 갈아 둔다 — start()가
    // 그 곡으로 문을 연다. 여기서 램프를 걸면 시작 전에 문이 열려 버린다.
    if (!this.running) return
    const ctx = this.engine.ctx
    this.rewind(next)
    this.play(next)
    rampParam(next.gate.gain, 1, TRACK_FADE, ctx)
    if (!prev || prev === next) return
    rampParam(prev.gate.gain, EXP_FLOOR, TRACK_FADE, ctx)
    // 다 빠진 뒤에 세우고 머리로 되감는다. 뒤에서 조용히 계속 흐르면
    // 대역폭과 배터리를 태우고, 새 런에서 그 곡으로 돌아올 때 3분쯤 지난
    // 자리에서 이어진다.
    clearTimeout(prev.parkT)
    prev.parkT = setTimeout(() => {
      if (this.track === prev.name) return       // 그새 다시 이 곡으로 돌아왔다
      try { prev.el.pause() } catch { /* 이미 멈춤 */ }
      this.rewind(prev)
    }, TRACK_FADE * 1000 + 120)
  }

  rewind(tr) { try { tr.el.currentTime = 0 } catch { /* 아직 못 되감는다 — 몇 초는 그냥 준다 */ } }

  // ── 감시 ──
  // 초에 한 번, **지금 곡의** 재생이 아직 살아 있는지만 본다. 루프도 이음매도
  // 브라우저가 도는 마당에 이쪽이 할 일은 이것뿐이다.
  watch() {
    const tr = this.cur
    if (!tr || !this.running) return
    if (tr.el.paused) this.play(tr)
  }

  // play()는 거절당할 수 있다(자동재생 정책). 거절은 예외가 아니라 대답이므로
  // 조용히 받아 두고, 다음 감시 때(1초 뒤) 다시 두드린다.
  play(tr) {
    if (!tr || tr.resuming) return
    const el = tr.el
    let p
    try { p = el.play() } catch { return }
    if (p && typeof p.then === 'function') {
      tr.resuming = true
      p.then(() => {
        tr.resuming = false
        // 지금 틀 곡이 아니면 자격만 딴 것이다 — 머리에 세워 둔다.
        if (!this.running || this.track !== tr.name) {
          try { el.pause() } catch { /* 곧 다시 건다 */ }
          this.rewind(tr)
        }
      }, () => { tr.resuming = false })
    }
  }

  // ─── 전황 ───────────────────────────────────────────────────
  // 스템이 하나뿐이라 Music처럼 성부를 크로스페이드할 수는 없다. 대신 두
  // 축으로 민다: **크기**와 **밝기**. 급해지면 음악이 한 발 앞으로 나오면서
  // 고역이 열리고, 조용해지면 물러나며 닫힌다. 폭 자체는 좁게 잡는다 —
  // 음악이 전황을 설명하려 들면 그건 효과음이 할 말을 뺏는 것이다.
  setIntensity(v, dur = 1.6) {
    if (this.fallback) return this.fallback.setIntensity(v, dur)
    const x = clamp01(v)
    if (this.intensity >= 0 && Math.abs(x - this.intensity) < 0.02) return
    this.intensity = x
    this.apply(dur)
  }

  // 주제 교체. Music은 마디 경계까지 기다렸다 갈아탔지만 여기엔 마디가
  // 없다 — 대신 1.6초에 걸쳐 민다. 그 정도면 "바뀌었다"가 아니라
  // "그랬던 것 같다"로 들린다.
  setTheme(name) {
    if (this.fallback) return this.fallback.setTheme(name)
    if (!TILT[name] || name === this.theme) return
    this.theme = name
    this.apply(1.6)
  }

  apply(dur = 1.6) {
    if (!this.level || !this.color) return
    const x = this.intensity < 0 ? 0.2 : this.intensity
    const tilt = TILT[this.theme] ?? TILT.void
    const ctx = this.engine.ctx
    const level = clamp01(LEVEL_MIN + (LEVEL_MAX - LEVEL_MIN) * x + tilt.level)
    // 차단 주파수는 로그로 민다 — 귀는 게인도 음정도 로그로 듣는다(engine.js).
    const cut = CUT_MIN * Math.pow(CUT_MAX / CUT_MIN, x) * Math.pow(2, tilt.bright)
    rampParam(this.level.gain, level, dur, ctx)
    rampParam(this.color.frequency, Math.max(200, Math.min(CUT_MAX, cut)), dur, ctx)
  }

  // 판 전체를 잠깐 죽인다(지구 오폭·승리·패배) — 정지가 아니라 감쇄다.
  duck(level = 0.25, dur = 0.8) {
    if (this.fallback) return this.fallback.duck(level, dur)
    if (!this.out) return
    rampParam(this.out.gain, Math.max(EXP_FLOOR, level), dur, this.engine.ctx)
  }

  unduck(dur = 1.2) {
    if (this.fallback) return this.fallback.unduck(dur)
    if (!this.out) return
    rampParam(this.out.gain, 1, dur, this.engine.ctx)
  }

  // 파일 쪽을 통째로 접는다. 악보에 자리를 넘기기 전에 부른다 —
  // 반쯤 물린 엘리먼트가 남아 있으면 나중에 혼자 깨어나 악보 위에서 운다.
  teardown() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
    this.running = false
    for (const tr of this.tracks.values()) {
      clearTimeout(tr.parkT)
      try { tr.el.pause(); tr.el.removeAttribute('src'); tr.el.load() } catch { /* 이미 죽었다 */ }
      for (const n of [tr.node, tr.gate]) { try { n?.disconnect() } catch { /* 이미 끊김 */ } }
    }
    this.tracks.clear()
    for (const n of [this.color, this.level, this.out]) {
      try { n?.disconnect() } catch { /* 이미 끊김 */ }
    }
    this.color = this.level = this.out = null
  }
}
