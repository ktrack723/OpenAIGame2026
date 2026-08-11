// ─── ZzFX — 절차 생성 효과음 ────────────────────────────────────
// 원본: ZzFXMicro v1.3.2, MIT License, Copyright 2019 Frank Force
// https://github.com/KilledByAPixel/ZzFX
//
// 원본과 다른 점은 **두 가지뿐**이고, 둘 다 이 게임의 요구에서 나왔다.
//
// ① 소리를 내지 않는다. 원본 zzfx()는 샘플을 만들자마자 제 AudioContext에
//    물려 재생하는데, 우리는 컨텍스트를 하나로 통일해야 하고(Tone·three와
//    같은 것을 쓴다) 무엇보다 **미리 구워 두었다가 재생**해야 한다.
//    그래서 이 파일은 Float32Array를 돌려주는 데서 끝난다.
//    재생·캐시·라우팅은 sfx.js가 한다.
// ② 샘플 버퍼가 일반 배열이 아니라 Float32Array다. 한 발에 2~4만 샘플이라
//    배열로 만들면 그 자리에서 GC가 돌고, 개막에 40종을 한꺼번에 굽는다.
//
// 파형 계산은 **한 줄도 바꾸지 않았다**. 바꾸면 그 순간 이건 ZzFX가 아니고,
// 인터넷에 널린 ZzFX 파라미터가 이 게임에서만 다른 소리를 낸다.
//
// 샘플레이트는 원본대로 44100 고정이다. 재생 컨텍스트가 48kHz여도 상관없다 —
// AudioBuffer는 제 샘플레이트를 들고 다니고 브라우저가 재생할 때 리샘플한다.
// 오히려 이렇게 해야 기기마다 같은 소리가 난다.

export const ZZFX_RATE = 44100
// 원본의 zzfxV. 인터넷에 돌아다니는 ZzFX 파라미터는 전부 이 0.3을 곱한 소리를
// 기준으로 골라져 있으므로 여기서도 같은 자리에 같은 값을 곱한다 — 안 그러면
// 남의 프리셋을 그대로 붙였을 때 3배 크게 난다. 전체 크기는 믹서에서 잡는다.
const ZZFX_V = 0.3

// ZzFX 파라미터 순서 (원본과 동일):
//  0 volume        1 randomness    2 frequency     3 attack      4 sustain
//  5 release       6 shape         7 shapeCurve    8 slide       9 deltaSlide
// 10 pitchJump    11 pitchJumpTime 12 repeatTime  13 noise      14 modulation
// 15 bitCrush     16 delay         17 sustainVolume 18 decay     19 tremolo
// 20 filter
//
// shape: 0 사인 · 1 삼각 · 2 톱니 · 3 탄젠트 · 4 노이즈 · 5 사각(듀티)
export function zzfxSamples(
  volume = 1,
  randomness = 0.05,
  frequency = 220,
  attack = 0,
  sustain = 0,
  release = 0.1,
  shape = 0,
  shapeCurve = 1,
  slide = 0,
  deltaSlide = 0,
  pitchJump = 0,
  pitchJumpTime = 0,
  repeatTime = 0,
  noise = 0,
  modulation = 0,
  bitCrush = 0,
  delay = 0,
  sustainVolume = 1,
  decay = 0,
  tremolo = 0,
  filter = 0,
) {
  const sampleRate = ZZFX_RATE
  const PI2 = Math.PI * 2
  const abs = Math.abs
  const sign = (v) => (v < 0 ? -1 : 1)

  let startSlide = (slide *= (500 * PI2) / sampleRate / sampleRate)
  let startFrequency = (frequency *=
    ((1 + randomness * 2 * Math.random() - randomness) * PI2) / sampleRate)
  let modOffset = 0     // 모듈레이션 오프셋
  let repeat = 0        // 반복 오프셋
  let crush = 0         // 비트크러시 오프셋
  let jump = 1          // 피치 점프 타이머
  let t = 0             // 샘플 시각
  let i = 0             // 샘플 인덱스
  let s = 0             // 샘플 값
  let f                 // 이번 샘플의 주파수

  // 바이쿼드 필터. **부호가 종류다: 양수 = 하이패스, 음수 = 로우패스.**
  // (b0=(1+cos)/2, b1=-(1+cos) 이 RBJ 하이패스 계수다 — 부호가 -1이면
  //  (1-cos) 쪽이 되어 로우패스가 된다.)
  // 그리고 **실제 차단 주파수는 이 값의 2배다**: w에 2가 곱해져 있다.
  // 둘 다 원본 그대로다. 헷갈리기 쉬운 자리라 못 박아 둔다 — 반대로 알고
  // 값을 넣으면 소리가 나긴 나는데 거의 안 들린다(실측: 300Hz 사인에
  // filter=+2000을 걸면 진폭이 0.30 → 0.0016).
  const quality = 2
  const w = (PI2 * abs(filter) * 2) / sampleRate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / 2 / quality
  const a0 = 1 + alpha
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  const b0 = (1 + sign(filter) * cos) / 2 / a0
  const b1 = -(sign(filter) + cos) / a0
  const b2 = b0
  let x2 = 0, x1 = 0, y2 = 0, y1 = 0

  // 샘플레이트 단위로 환산
  const minAttack = 9   // attack이 0일 때 뚝 소리를 막는 최소값
  attack = attack * sampleRate || minAttack
  decay *= sampleRate
  sustain *= sampleRate
  release *= sampleRate
  delay *= sampleRate
  deltaSlide *= (500 * PI2) / sampleRate ** 3
  modulation *= PI2 / sampleRate
  pitchJump *= PI2 / sampleRate
  pitchJumpTime *= sampleRate
  repeatTime = (repeatTime * sampleRate) | 0
  volume *= ZZFX_V

  const length = (attack + decay + sustain + release + delay) | 0
  const b = new Float32Array(Math.max(1, length))

  for (; i < length; b[i++] = s * volume) {
    // bitCrush가 0이면 (x % 0)이 NaN → !NaN이 참이라 매 샘플 계산한다.
    // 원본의 이 성질을 그대로 둔다(안 그러면 파라미터 의미가 달라진다).
    if (!(++crush % ((bitCrush * 100) | 0))) {
      s = shape                                       // 파형
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? shape > 4
                ? (t / PI2 % 1 < shapeCurve / 2) * 2 - 1    // 5 사각(듀티)
                : Math.sin(t ** 3)                          // 4 노이즈
              : Math.max(Math.min(Math.tan(t), 1), -1)      // 3 탄젠트
            : 1 - ((2 * t / PI2) % 2 + 2) % 2               // 2 톱니
          : 1 - 4 * abs(Math.round(t / PI2) - t / PI2)      // 1 삼각
        : Math.sin(t)                                       // 0 사인

      s =
        (repeatTime
          ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime)   // 트레몰로
          : 1) *
        (shape > 4 ? s : sign(s) * abs(s) ** shapeCurve) *             // 곡률
        (i < attack
          ? i / attack                                                 // 어택
          : i < attack + decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume)         // 디케이
            : i < attack + decay + sustain
              ? sustainVolume                                          // 서스테인
              : i < length - delay
                ? ((length - i - delay) / release) * sustainVolume     // 릴리즈
                : 0)                                                   // 릴리즈 이후

      s = delay
        ? s / 2 +
          (delay > i
            ? 0
            : ((i < length - delay ? 1 : (length - i) / delay) *
                b[(i - delay) | 0]) / 2 / volume)                      // 딜레이
        : s

      if (filter) s = y1 = b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1)
    }

    f = (frequency += slide += deltaSlide) * Math.cos(modulation * modOffset++)
    t += f + f * noise * Math.sin(i ** 5)

    if (jump && ++jump > pitchJumpTime) {   // 피치 점프
      frequency += pitchJump
      startFrequency += pitchJump
      jump = 0
    }

    if (repeatTime && !(++repeat % repeatTime)) {   // 반복
      frequency = startFrequency
      slide = startSlide
      jump ||= 1
    }
  }

  return b
}
