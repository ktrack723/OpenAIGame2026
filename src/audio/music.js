import * as Tone from 'tone'
import { rampTone } from './engine.js'

// ─── 음악 — 후기 낭만 관현악 왈츠 ───────────────────────────────
//
// 오디오 파일은 한 개도 없다. 아래에 있는 것은 **악보**이고, Tone.js가 그걸
// 연주한다. 그래서 이 파일은 코드라기보다 총보에 가깝다 — 읽을 때도 그렇게
// 읽어야 한다.
//
// ══ 왜 3/4인가 ═══════════════════════════════════════════════════
// 이 게임은 궤도 위를 도는 공을 치는 게임이다. 행진곡(4/4)은 **직선**을
// 그린다 — 한 발 한 발 앞으로 나아가는 리듬이다. 왈츠(3/4)는 **원**을
// 그린다: 1박에 무게가 실리고 2·3박이 그 둘레를 도는 것이, 화면에서
// 행성이 근일점을 지나 다시 멀어지는 것과 같은 모양이다.
// 108 BPM은 한 마디가 1.67초 — 안쪽 궤도 하나가 도는 시간의 3% 남짓이라
// 화면의 움직임과 박이 서로를 방해하지 않는다.
//
// ══ 조성과 골격 ══════════════════════════════════════════════════
// E♭장조. 호른의 조성이다(내림표 계열은 금관이 제일 잘 울린다).
//
// 골격은 여덟 마디: I – vi – IV – V – I – V/vi – vi – V
// 그 뒤 네 마디가 **장3도 위(G장조)로 전조**했다가 네 마디에 걸쳐 돌아온다.
// 전조는 전곡에서 **한 번뿐**이다. 두 번 하면 그건 조바꿈이 아니라 습관이다.
//
// 전조를 준비하는 것은 6마디의 G7(V/vi)이다. 거기서 이미 한 번 울린 G가
// 9마디에서 으뜸화음이 되어 돌아온다 — 처음 듣는 화음이 아니라 **아까 그
// 화음이 왕이 된 것**이라야 전조가 사건으로 들린다.
//
// ══ 정점 ═════════════════════════════════════════════════════════
// 9~12마디는 **2박마다** 화음이 바뀐다. 3박자에 2박 주기를 얹으면
// 헤미올라(2 대 3)가 걸려서, 같은 템포인데 판이 조여드는 것처럼 들린다.
// 그리고 그 네 마디의 화성 진행은 1~4마디와 **같은 골격을 절반 길이로
// 압축한 것**이다(I–vi–IV–V/V–V). 처음 들은 것이 빨라져 돌아온다.
//
// 최고음 G5는 **전곡에서 단 한 번**, 11마디 첫 박에 온다. 그 자리의 화음은
// A7(V/V)이고 G는 그 7음이다 — 가장 높은 음이 가장 불안정한 음이라야
// 정점이 "도착"이 아니라 "터지기 직전"으로 들린다. 그 뒤 여섯 음이
// 순차로 내려오며 도약을 메운다.
//
// ══ 라이트모티프 ═════════════════════════════════════════════════
// 주제 셋(아군·적군·우주)은 **같은 화성 골격 위에** 쓰였다. 그래서 판이
// 어떻게 굴러가든 마디 경계에서 아무 주제로나 갈아탈 수 있고, 갈아탄 순간
// 반주는 한 음도 안 바뀐다 — 바뀐 것은 위에서 노래하는 사람뿐이다.
//
// ══ 음역 ═════════════════════════════════════════════════════════
//   베이스   60–200Hz   근음, 1박 (화음이 바뀌는 박마다 한 번 더)
//   내성     200–800Hz  화음, 2·3박, 디튠 톱니 3보이스
//   주선율   800–1.6kHz 호른(삼각+톱니, 어택 0.15s) + 옥타브 겹침
//   하이 스트링 2–5kHz  주선율 옥타브 겹치기, **정점에서만**
//
// 주선율에 대해 한 마디: 악보상의 음역은 G4–G5(392–784Hz)인데 요구 음역은
// 800Hz–1.6kHz다. 둘은 어긋나지 않는다 — 호른 성부를 **옥타브로 겹치는**
// 것은 관현악의 기본 수법이고, 그 옥타브 겹침(G5–G6 = 784–1568Hz)이 곧
// 800–1.6kHz 대역이다. 하이 스트링은 같은 옥타브 겹침을 톱니로 연주해
// 2kHz 위의 배음만 남긴다(하이패스) — 관현악에서 하이 스트링이 실제로
// 들리는 방식이 그거다: 기음은 묻히고 광택만 남는다.

// ── 박 ──
const BPM = 108
const BEATS_PER_BAR = 3
const BARS = 16

// ── 화음 사전 ───────────────────────────────────────────────────
// bass  : 근음 (MIDI, 옥타브 2 = 65~117Hz)
// inner : 내성 3음 (MIDI, 208~415Hz — 톱니 배음이 800Hz까지 채운다)
// MIDI 60 = C4. E♭장조: Eb F G Ab Bb C D
const CH = {
  //           bass          inner (3음)
  Eb:  { bass: 39, inner: [58, 63, 67] },   // I      Eb2 / Bb3 Eb4 G4
  Cm:  { bass: 36, inner: [60, 63, 67] },   // vi     C2  / C4  Eb4 G4
  Ab:  { bass: 44, inner: [56, 60, 63] },   // IV     Ab2 / Ab3 C4  Eb4
  Bb:  { bass: 46, inner: [58, 62, 65] },   // V      Bb2 / Bb3 D4  F4
  Bb7: { bass: 46, inner: [58, 62, 68] },   // V7     Bb2 / Bb3 D4  Ab4
  G7:  { bass: 43, inner: [59, 62, 65] },   // V/vi   G2  / B3  D4  F4   ← 부속화음
  F7:  { bass: 41, inner: [57, 60, 63] },   // V/V    F2  / A3  C4  Eb4  ← 부속화음
  // ── 전조 구간 (G장조) ──
  G:   { bass: 43, inner: [59, 62, 67] },   // I  (G)
  Em:  { bass: 40, inner: [59, 64, 67] },   // vi (G)
  C:   { bass: 36, inner: [60, 64, 67] },   // IV (G)
  A7:  { bass: 45, inner: [61, 64, 67] },   // V/V (G) ← 부속화음. 정점이 여기다
  D:   { bass: 38, inner: [57, 62, 66] },   // V  (G)
}

// ── 화성 진행 ───────────────────────────────────────────────────
// 한 마디 한 화음이 원칙. 예외는 9~12마디(정점)뿐이고 거기서는 2박마다 바뀐다.
// b = 마디 안에서 이 화음이 시작하는 박(0-기준), len = 지속 박수.
const HARMONY = [
  [{ b: 0, len: 3, c: 'Eb' }],                              //  1  I
  [{ b: 0, len: 3, c: 'Cm' }],                              //  2  vi
  [{ b: 0, len: 3, c: 'Ab' }],                              //  3  IV
  [{ b: 0, len: 3, c: 'Bb' }],                              //  4  V
  [{ b: 0, len: 3, c: 'Eb' }],                              //  5  I
  [{ b: 0, len: 3, c: 'G7' }],                              //  6  V/vi  ← 전조의 씨앗
  [{ b: 0, len: 3, c: 'Cm' }],                              //  7  vi
  [{ b: 0, len: 3, c: 'Bb7' }],                             //  8  V
  // ── 여기서 장3도 위로 (E♭ → G). 2박마다 화음이 바뀐다 ──
  [{ b: 0, len: 2, c: 'G' }, { b: 2, len: 1, c: 'Em' }],    //  9  I  – vi
  [{ b: 0, len: 1, c: 'Em' }, { b: 1, len: 2, c: 'C' }],    // 10  vi – IV
  [{ b: 0, len: 2, c: 'A7' }, { b: 2, len: 1, c: 'D' }],    // 11  V/V – V   ★정점
  [{ b: 0, len: 1, c: 'D' }, { b: 1, len: 2, c: 'Bb7' }],   // 12  V  – V(E♭)로 회항
  // ── 돌아왔다 ──
  [{ b: 0, len: 3, c: 'Eb' }],                              // 13  I
  [{ b: 0, len: 3, c: 'F7' }],                              // 14  V/V   ← 부속화음
  [{ b: 0, len: 3, c: 'Bb7' }],                             // 15  V
  [{ b: 0, len: 3, c: 'Eb' }],                              // 16  I
]

// ── 주제 셋 ─────────────────────────────────────────────────────
// [MIDI, 박수]. MIDI 67 = G4, 79 = G5. 세 주제 모두:
//   · 음역 G4–G5 안
//   · 대부분 순차진행
//   · 6도 이상 도약은 **한 번**(10→11마디, B4→G5), 그 직후 순차 하행으로 메움
//   · 최고음 G5는 전체에서 **한 번**, 11마디
//   · 위의 HARMONY 위에 그대로 얹힌다 (그래서 아무 데서나 갈아탈 수 있다)

// 아군 — 노래하는 주제. 5도(Bb4)에서 시작하는 호른의 부름.
const THEME_ALLY = [
  [[70, 2], [72, 1]],            //  1  Bb4  C5
  [[70, 1], [68, 1], [67, 1]],   //  2  Bb4  Ab4 G4
  [[68, 1], [70, 1], [72, 1]],   //  3  Ab4  Bb4 C5
  [[74, 2], [72, 1]],            //  4  D5   C5
  [[75, 2], [74, 1]],            //  5  Eb5  D5
  [[74, 1], [72, 1], [71, 1]],   //  6  D5   C5  B♮4  ← G7의 이끔음
  [[72, 2], [70, 1]],            //  7  C5   Bb4      ← B♮→C 반음 해결
  [[70, 1], [72, 1], [74, 1]],   //  8  Bb4  C5  D5   ← 전조로 올라가는 계단
  [[74, 2], [76, 1]],            //  9  D5   E5
  [[76, 1], [74, 1], [71, 1]],   // 10  E5   D5  B4
  [[79, 2], [78, 1]],            // 11  ★G5  F#5      ← 최고음. A7의 7음
  [[76, 1], [74, 1], [72, 1]],   // 12  E5   D5  C5   ← 도약을 메우는 하행
  [[70, 1], [72, 1], [70, 1]],   // 13  Bb4  C5  Bb4
  [[69, 2], [70, 1]],            // 14  A♮4  Bb4      ← F7(V/V)의 3음
  [[72, 1], [70, 1], [68, 1]],   // 15  C5   Bb4 Ab4
  [[67, 3]],                     // 16  G4
]

// 적군 — 같은 화성 위의 다른 사람. 아래쪽에 머물고, 반음으로 밀고 올라온다.
const THEME_FOE = [
  [[67, 2], [68, 1]],            //  1  G4   Ab4
  [[67, 1], [68, 1], [70, 1]],   //  2  G4   Ab4 Bb4
  [[72, 2], [70, 1]],            //  3  C5   Bb4
  [[68, 2], [67, 1]],            //  4  Ab4  G4
  [[70, 1], [72, 1], [70, 1]],   //  5  Bb4  C5  Bb4
  [[71, 2], [72, 1]],            //  6  B♮4  C5
  [[72, 1], [70, 1], [68, 1]],   //  7  C5   Bb4 Ab4
  [[67, 2], [70, 1]],            //  8  G4   Bb4
  [[71, 2], [74, 1]],            //  9  B4   D5
  [[76, 1], [74, 1], [71, 1]],   // 10  E5   D5  B4
  [[79, 2], [78, 1]],            // 11  ★G5  F#5
  [[76, 1], [74, 1], [72, 1]],   // 12  E5   D5  C5
  [[70, 1], [68, 1], [67, 1]],   // 13  Bb4  Ab4 G4
  [[69, 2], [70, 1]],            // 14  A♮4  Bb4
  [[68, 2], [67, 1]],            // 15  Ab4  G4
  [[67, 3]],                     // 16  G4
]

// 우주 — 아무 일도 없는 성계. 한 마디에 한 음, 길게. 판이 조용할 때 이게 돈다.
const THEME_VOID = [
  [[70, 3]],                     //  1  Bb4
  [[67, 3]],                     //  2  G4
  [[68, 2], [70, 1]],            //  3  Ab4 Bb4
  [[72, 3]],                     //  4  C5
  [[70, 3]],                     //  5  Bb4
  [[71, 3]],                     //  6  B♮4
  [[72, 3]],                     //  7  C5
  [[74, 2], [72, 1]],            //  8  D5  C5
  [[74, 3]],                     //  9  D5
  [[76, 2], [71, 1]],            // 10  E5  B4
  [[79, 2], [78, 1]],            // 11  ★G5 F#5
  [[76, 1], [74, 2]],            // 12  E5  D5
  [[72, 3]],                     // 13  C5
  [[69, 3]],                     // 14  A♮4
  [[70, 2], [68, 1]],            // 15  Bb4 Ab4
  [[67, 3]],                     // 16  G4
]

export const THEMES = { ally: THEME_ALLY, foe: THEME_FOE, void: THEME_VOID }

// 하이 스트링이 들어오는 마디 — 정점 넷뿐이다(0-기준 8~11 = 9~12마디).
const PEAK_BARS = [8, 9, 10, 11]

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12)

export class Music {
  constructor(engine) {
    this.engine = engine
    this.built = false      // 악단이 **다 서 있다**. 도중에 실패하면 안 선다.
    this.building = false
    this.running = false
    this.bar = 0
    this.theme = 'void'
    this.pending = 'void'
    this.intensity = 0
    this.repeatId = null
  }

  // ── 악단을 짓는다 ──
  // unlock() 뒤에 부른다(컨텍스트가 이미 우리 것으로 통일돼 있어야 한다).
  // 리버브 임펄스를 굽는 데 시간이 걸리므로 비동기다.
  // built는 **맨 끝에서** 세운다. 중간에 실패하면(리버브 임펄스를 못 굽는
  // 브라우저가 있다) 반쯤 지어진 악단으로 연주가 시작돼 첫 마디에서 터진다 —
  // 그럴 바에는 음악이 아예 안 나오고 효과음만 나는 게 낫다.
  async build() {
    if (this.built || this.building || !this.engine.ready) return
    this.building = true

    // 공간 — decay 3.5s, preDelay 0.03s, wet 0.3.
    // 6초로 잡았더니 화성이 마디마다 바뀌는 이 곡에서는 앞 화음이 다음
    // 화음 위에 그대로 얹혀 뭉갰다. 3.5초는 한 마디(1.67초) 두 개 남짓이라
    // 홀이 남되 화성은 안 흐려진다.
    this.reverb = new Tone.Reverb({ decay: 3.5, preDelay: 0.03, wet: 0.3 })
    this.out = new Tone.Gain(1)
    this.reverb.connect(this.out)
    this.out.connect(this.engine.musicBus)

    // ── 베이스 60–200Hz ──
    // 삼각파에 로우패스. 왈츠의 "쿵". 화음이 바뀌는 박마다 근음을 놓는다.
    this.bassSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.012, decay: 0.22, sustain: 0.55, release: 0.30 },
    })
    this.bassFilter = new Tone.Filter({ type: 'lowpass', frequency: 200, Q: 0.7 })
    this.bassGain = new Tone.Gain(0.62)
    this.bassSynth.chain(this.bassFilter, this.bassGain, this.reverb)

    // ── 내성 200–800Hz ──
    // 디튠 톱니 3보이스(fatsawtooth count 3). 왈츠의 "짝짝".
    // 위아래를 필터로 잘라 대역을 못 박는다 — 톱니는 그냥 두면 5kHz까지
    // 올라가서 하이 스트링이 설 자리를 먹는다.
    this.innerSynth = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 12,
      oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
      envelope: { attack: 0.03, decay: 0.28, sustain: 0.35, release: 0.34 },
    })
    this.innerHi = new Tone.Filter({ type: 'highpass', frequency: 190, Q: 0.6 })
    this.innerLo = new Tone.Filter({ type: 'lowpass', frequency: 820, Q: 0.8 })
    this.innerPan = new Tone.Panner(-0.18)
    this.innerGain = new Tone.Gain(0.30)
    this.innerSynth.chain(this.innerHi, this.innerLo, this.innerPan, this.innerGain, this.reverb)

    // ── 주선율: 호른 ──
    // 삼각파 + 톱니 믹스. 삼각이 몸통을, 톱니가 금관의 거친 가장자리를 준다.
    // 어택 0.15초 — 호른은 즉발이 아니다. 이 값이 곧 "이 악기가 무엇인가"다.
    const hornEnv = { attack: 0.15, decay: 0.22, sustain: 0.78, release: 0.38 }
    this.hornTri = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: hornEnv })
    this.hornSaw = new Tone.Synth({ oscillator: { type: 'sawtooth' }, envelope: hornEnv })
    this.hornMix = new Tone.Gain(1)
    this.hornSawTrim = new Tone.Gain(0.34)     // 톱니는 섞는 정도만
    this.hornTri.connect(this.hornMix)
    this.hornSaw.chain(this.hornSawTrim, this.hornMix)
    // 호른의 광택. 2.6kHz 위는 잘라내고 1.1kHz를 들어 올린다 — 주선율이
    // 앉아야 할 대역이 거기다.
    this.hornLo = new Tone.Filter({ type: 'lowpass', frequency: 2600, Q: 0.9 })
    this.hornPeak = new Tone.Filter({ type: 'peaking', frequency: 1100, Q: 1.1, gain: 6 })
    // 옥타브 겹침 — 실제로 800Hz–1.6kHz를 채우는 성부다.
    this.hornOct = new Tone.Synth({ oscillator: { type: 'triangle' }, envelope: hornEnv })
    this.hornOctHi = new Tone.Filter({ type: 'highpass', frequency: 760, Q: 0.7 })
    this.hornOctLo = new Tone.Filter({ type: 'lowpass', frequency: 1700, Q: 0.8 })
    this.hornOctGain = new Tone.Gain(0.42)
    this.melodyPan = new Tone.Panner(0.10)
    this.melodyGain = new Tone.Gain(0.72)
    this.hornMix.chain(this.hornLo, this.hornPeak, this.melodyPan)
    this.hornOct.chain(this.hornOctHi, this.hornOctLo, this.hornOctGain, this.melodyPan)
    this.melodyPan.chain(this.melodyGain, this.reverb)

    // ── 하이 스트링 2–5kHz ──
    // 주선율 옥타브 겹치기를 톱니로. 하이패스 1.9kHz가 기음을 걷어내면
    // 남는 것은 2–5kHz의 광택뿐이다 — 관현악에서 하이 스트링이 실제로
    // 들리는 방식이다. **정점 네 마디에서만** 들어온다.
    this.strings = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 6,
      oscillator: { type: 'fatsawtooth', count: 3, spread: 14 },
      envelope: { attack: 0.22, decay: 0.3, sustain: 0.7, release: 0.6 },
    })
    this.strHi = new Tone.Filter({ type: 'highpass', frequency: 1900, Q: 0.7 })
    this.strLo = new Tone.Filter({ type: 'lowpass', frequency: 5200, Q: 0.7 })
    this.strPan = new Tone.Panner(0.26)
    this.strGain = new Tone.Gain(0.0001)       // 시작은 무음. 정점에서만 올라온다.
    this.strings.chain(this.strHi, this.strLo, this.strPan, this.strGain, this.reverb)

    // ── 시계 ──
    // 노트는 **전부** Transport가 낸다. rAF나 setTimeout으로 노트를 치면
    // 프레임이 흔들리는 만큼 박이 흔들리고, 이 게임은 프레임이 흔들린다
    // (폭발이 터지면 파티클이 수백 개다).
    const T = Tone.getTransport()
    T.bpm.value = BPM
    T.timeSignature = BEATS_PER_BAR

    await this.reverb.ready
    this.built = true
    this.building = false
  }

  start() {
    if (!this.built || this.running) return
    const T = Tone.getTransport()
    this.bar = 0
    // 한 마디에 한 번 깨어나 **그 마디 전체를 미리 예약한다.** 콜백이 받는
    // time은 그 마디가 시작하는 정확한 오디오 시각이고, 노트는 전부 거기서
    // 오프셋으로 잡는다 — 콜백이 언제 실제로 실행되든 소리는 제자리에 난다.
    this.repeatId = T.scheduleRepeat((time) => this.scheduleBar(time), '1m', 0)
    T.start('+0.08')
    this.running = true
  }

  stop() {
    if (!this.running) return
    const T = Tone.getTransport()
    if (this.repeatId !== null) T.clear(this.repeatId)
    this.repeatId = null
    T.stop()
    this.running = false
  }

  // ── 한 마디를 예약한다 ──────────────────────────────────────
  scheduleBar(time) {
    const beat = 60 / BPM
    const i = this.bar % BARS

    // 주제 교체는 **마디 경계에서만**. 판이 급해졌다고 마디 한가운데서
    // 노래하는 사람이 바뀌면 그건 전환이 아니라 사고로 들린다.
    // 세 주제가 같은 화성 위에 있으므로, 여기서 갈아타도 반주는 그대로다.
    if (this.pending !== this.theme) this.theme = this.pending
    const melody = THEMES[this.theme] ?? THEME_VOID

    const segs = HARMONY[i]
    // 화음이 시작하는 박 — 베이스가 여기에 선다. 정점 네 마디에서는
    // 이 자리가 2박마다 오므로 그대로 헤미올라(2 대 3)가 걸린다.
    const onsets = new Set(segs.map(s => s.b))
    onsets.add(0)   // 다운비트는 언제나 짚는다. 안 짚으면 판이 떠 버린다.

    // 어느 박에 어떤 화음이 걸려 있는가
    const chordAt = []
    for (const s of segs) for (let b = s.b; b < s.b + s.len; b++) chordAt[b] = CH[s.c]

    for (let b = 0; b < BEATS_PER_BAR; b++) {
      const ch = chordAt[b] ?? chordAt[0]
      if (!ch) continue
      const at = time + b * beat
      if (onsets.has(b)) {
        // 1박(그리고 화음이 바뀌는 박) — 근음
        this.bassSynth.triggerAttackRelease(hz(ch.bass), beat * 0.86, at)
      } else {
        // 2·3박 — 화음
        this.innerSynth.triggerAttackRelease(ch.inner.map(hz), beat * 0.72, at)
      }
    }

    // 주선율. 마디 안에서 박을 쌓아 가며 놓는다.
    let b = 0
    const peak = PEAK_BARS.includes(i)
    for (const [midi, len] of melody[i]) {
      const at = time + b * beat
      const dur = len * beat * 0.94
      this.hornTri.triggerAttackRelease(hz(midi), dur, at)
      this.hornSaw.triggerAttackRelease(hz(midi), dur, at)
      this.hornOct.triggerAttackRelease(hz(midi + 12), dur, at)
      // 하이 스트링 — 정점에서만. 같은 음을 한 옥타브 위에서 겹친다.
      if (peak) this.strings.triggerAttackRelease(hz(midi + 12), dur, at)
      b += len
    }

    this.bar++
  }

  // ── 전황에 따른 레이어 크로스페이드 ──────────────────────────
  // 템포는 안 건드린다(왈츠는 108이어야 왈츠다). 대신 **누가 얼마나 크게
  // 나오는가**가 바뀐다. 급해지면 내성과 베이스가 두꺼워지고 하이 스트링이
  // 올라오며, 조용하면 주선율만 남는다.
  //
  // 크로스페이드는 1.6초에 걸쳐 지수로 민다 — 게인은 로그로 들리고,
  // 이 정도는 되어야 "바뀌었다"가 아니라 "차오른다"로 들린다.
  setIntensity(v, dur = 1.6) {
    if (!this.built) return
    const x = Math.max(0, Math.min(1, v))
    if (Math.abs(x - this.intensity) < 0.02) return
    this.intensity = x
    rampTone(this.bassGain.gain, 0.52 + 0.34 * x, dur)
    rampTone(this.innerGain.gain, 0.22 + 0.40 * x, dur)
    rampTone(this.melodyGain.gain, 0.78 - 0.14 * x, dur)   // 두꺼워질수록 살짝 물러난다
    rampTone(this.strGain.gain, 0.06 + 0.52 * x, dur)
  }

  // 다음 마디 경계에서 갈아탈 주제를 예약한다.
  setTheme(name) {
    if (THEMES[name]) this.pending = name
  }

  // 판 전체를 잠깐 죽인다(게임오버 화면 등) — 정지가 아니라 감쇄다.
  duck(level = 0.25, dur = 0.8) {
    if (!this.built) return
    rampTone(this.out.gain, Math.max(0.0001, level), dur)
  }

  unduck(dur = 1.2) {
    if (!this.built) return
    rampTone(this.out.gain, 1, dur)
  }
}
