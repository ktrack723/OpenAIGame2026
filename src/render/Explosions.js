import * as THREE from 'three'
import { CFG, VIS } from '../game/config.js'

// ─── 폭발 연출 (§14.5) ──────────────────────────────────────────
// 게임 로직이 쌓아둔 fx 큐를 소비해 파티클/링/섬광으로 옮긴다.
// 여기 있는 숫자는 전부 "보이는 크기"일 뿐, 미는 힘·반경 같은 게임 수치가
// 아니다 — 그건 game.js와 config.js에만 있다.
export class Explosions {
  constructor(parts, rig, flash) {
    this.parts = parts
    this.rig = rig
    this.flash = flash    // (세기, 색) → 전면 섬광
  }

  // 게임 로직이 쌓아둔 연출 이벤트를 소비 (§14.5)
  drain(game) {
    const q = game.fx
    if (!q || !q.length) return
    for (const e of q) {
      if (e.kind === 'launch') {
        const c = 0xbfdbfe
        this.parts.burst(e.x, e.y, { n: 40, color: c, speed: 90, size: 8, ttl: 0.5, spread: 1.4, dir: e.a })
        this.parts.shock(e.x, e.y, 26, c, 0.4)
      } else if (e.kind === 'warp') this.warp(e)
      else if (e.kind === 'laserCharge') this.laserCharge(e)
      else if (e.kind === 'laserFire') this.laserFire(e)
      else if (e.kind === 'laserHit') this.laserHit(e)
      else if (e.kind === 'laserMiss') this.laserMiss(e)
      else if (e.kind === 'volatile') this.volatile(e)
      else if (e.kind === 'absorb') this.absorb(e)
      else if (e.kind === 'nuke') this.nuke(e)
      else if (e.kind === 'destroy') this.destroy(e)
      else if (e.kind === 'swing') {
        this.parts.shock(e.x, e.y, Math.max(24, (e.r ?? 10) * CFG.SWING_ZONE * 0.5), 0x67e8f9, 0.6)
        this.parts.burst(e.x, e.y, { n: 26, color: 0x67e8f9, speed: 110, size: 8, ttl: 0.7 })
      } else if (e.kind === 'bump') this.bump(e)
      else if (e.kind === 'belt') this.belt(e)
      else if (e.kind === 'sun') {
        this.parts.burst(e.x, e.y, { n: 160, color: 0xffa53b, speed: 260, size: 16, ttl: 1.4 })
        this.parts.puff(e.x, e.y, { r0: 8, r1: 130, ttl: 1.0, color: 0xffb247 })
        this.parts.shock(e.x, e.y, 90, 0xfdba74, 0.9)
        this.rig.hit(16)
      }
    }
    q.length = 0
  }

  // ─── 당구 충돌 — 부서지지 않고 튕겼다 ────────────────────────
  // 파괴(destroy)와 확실히 구분되어야 한다: 불꽃은 짧고 희며, 화면을
  // 흔들긴 해도 태우지는 않는다. "쳤다, 아직 살아 있다"가 읽혀야 한다.
  bump(e) {
    const P = this.parts
    const R = Math.max(26, (e.r ?? 20) * 1.5)
    const k = Math.min(1, (e.v ?? 20) / 120)          // 상대속도 = 충돌 세기
    if (e.soft) {   // 스치듯 만난 접촉 — 먼지만 인다
      P.shock(e.x, e.y, R * 0.8, 0xcbd5e1, 0.35, { thin: true, from: 0.2, to: 1.4, alpha: 0.5 })
      P.burst(e.x, e.y, { n: 16, color: 0xcbd5e1, speed: 90, size: 7, ttl: 0.4 })
      return
    }
    P.puff(e.x, e.y, { r0: R * 0.2, r1: R * 0.9, ttl: 0.22, color: 0xffffff, alpha: 0.9 })
    P.shock(e.x, e.y, R, 0xffffff, 0.45, { thin: true, from: 0.1, to: 2.6, alpha: 0.9 })
    P.shock(e.x, e.y, R, 0xfde68a, 0.8 + 0.5 * k, { from: 0.15, to: 2.0, delay: 0.05 })
    P.spikes(e.x, e.y, { n: 10 + Math.round(14 * k), color: 0xfff3cd, speed: 500 + 900 * k, size: 6, ttl: 0.35 })
    P.burst(e.x, e.y, { n: 70 + Math.round(160 * k), color: 0xffd8a8, speed: 240 + 420 * k, size: 11, ttl: 0.9 + 0.6 * k })
    P.burst(e.x, e.y, { n: 40, color: 0xffffff, speed: 420 + 500 * k, size: 7, ttl: 0.45 })
    this.rig.hit(8 + 22 * k)
    this.flash(0.10 + 0.20 * k, '#fff6df')
  }

  // ─── 카이퍼 벨트 충돌 — 당구대 쿠션 ──────────────────────────
  // 얼음 벽에 박아 파편이 튀고, 공은 속력 그대로 반사각으로 되돌아간다.
  // 반사 방향이 보이도록 법선 반대쪽으로 파편을 뿜는다.
  belt(e) {
    const P = this.parts
    const k = Math.min(1, (e.v ?? 40) / 160)
    const R = Math.max(e.missile ? 30 : 60, (e.r ?? 20) * 2.2)
    const inward = Math.atan2(-(e.ny ?? 0), -(e.nx ?? 1))    // 성계 안쪽
    P.puff(e.x, e.y, { r0: R * 0.15, r1: R * 0.8, ttl: 0.3, color: 0xe0f2fe, alpha: 0.95 })
    P.shock(e.x, e.y, R, 0xffffff, 0.5, { thin: true, from: 0.08, to: 2.8, alpha: 1 })
    P.shock(e.x, e.y, R, 0x7dd3fc, 0.9 + 0.5 * k, { from: 0.12, to: 2.2, delay: 0.06 })
    // 얼음 파편은 벽에서 안쪽으로 — 되돌아오는 방향이 그대로 보인다
    P.burst(e.x, e.y, { n: 90 + Math.round(220 * k), color: 0xbae6fd, speed: 300 + 520 * k, size: 12, ttl: 1.2, spread: 1.5, dir: inward })
    P.burst(e.x, e.y, { n: 50, color: 0xffffff, speed: 700, size: 8, ttl: 0.5 })
    P.spikes(e.x, e.y, { n: 12, color: 0xe0f2fe, speed: 900 + 700 * k, size: 8, ttl: 0.5 })
    this.rig.hit(e.missile ? 6 : 14 + 20 * k)
    this.flash(e.missile ? 0.08 : 0.18 + 0.25 * k, '#e8f7ff')
    if (!e.missile) this.rig.focus(e.x, e.y, R * 3, 1.6)
  }

  // ─── 워프인 — 조르그 행성계에서 텔레포트 ─────────────────────
  // 밖에서 안으로 조여드는 링 → 흰 섬광 → 밖으로 터지는 고리.
  // "없던 게 생겼다"가 폭발과 구분되어야 해서 색을 보라/청록으로 잡았다.
  warp(e) {
    const P = this.parts, R = Math.max(70, (e.r ?? 30) * 3.2)
    const tone = e.fort ? 0xff5c9e : 0x7dd3fc
    // ① 공간이 찢어지며 좁혀 들어오는 링 (from > to = 수축)
    P.shock(e.x, e.y, R, tone, 0.55, { thin: true, from: 3.4, to: 0.12, alpha: 1 })
    P.shock(e.x, e.y, R, 0xa855f7, 0.75, { from: 4.2, to: 0.2, alpha: 0.6, delay: 0.08 })
    // ② 바깥에서 중심으로 빨려드는 입자
    for (let i = 0; i < 150; i++) {
      const a = Math.random() * Math.PI * 2, d = R * (1.4 + Math.random() * 2.2)
      const sp = 260 + Math.random() * 380
      P.spawn(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, -Math.cos(a) * sp, -Math.sin(a) * sp,
        _pc.setHex(Math.random() < 0.4 ? 0xffffff : tone), 7 + Math.random() * 8, 0.55 + Math.random() * 0.4, 0.15)
    }
    // ③ 도착 섬광 + 밖으로 터지는 고리
    P.puff(e.x, e.y, { r0: R * 0.05, r1: R * 0.8, ttl: 0.3, color: 0xffffff, alpha: 1, delay: 0.42 })
    P.puff(e.x, e.y, { r0: R * 0.3, r1: R * 1.9, ttl: 1.2, color: tone, alpha: 0.7, delay: 0.46 })
    P.shock(e.x, e.y, R, 0xffffff, 0.6, { thin: true, from: 0.05, to: 2.6, alpha: 1, delay: 0.44 })
    P.spikes(e.x, e.y, { n: 20, color: tone, speed: 900, size: 9, ttl: 0.55 })
    P.burst(e.x, e.y, { n: 140, color: tone, speed: 380, size: 13, ttl: 1.1 })
    this.rig.hit(14)
    this.flash(0.3, e.fort ? '#ffe4ef' : '#e6f6ff')
    this.rig.focus(e.x, e.y, R * 2.4, 2.2)
  }

  // ─── 레이저 충전 개시 — 본성이 달아오른다 ───────────────────
  laserCharge(e) {
    const P = this.parts
    P.shock(e.x, e.y, 120, 0xff4d6d, 0.8, { thin: true, from: 2.8, to: 0.15, alpha: 0.9 })
    P.burst(e.x, e.y, { n: 60, color: 0xff4d6d, speed: 160, size: 10, ttl: 0.9 })
    this.rig.hit(8)
    this.flash(0.16, '#ffe0e6')
  }

  // ─── 레이저 발사 — 총구에서 탄두가 튀어나가는 순간만 ────────
  // 착탄은 별도 이벤트다(laserHit). 광선이 날아가는 데 시간이 걸리므로
  // 예전처럼 발사와 착탄을 한 번에 터뜨리면 거짓말이 된다.
  laserFire(e) {
    const P = this.parts
    P.puff(e.x, e.y, { r0: 8, r1: 120, ttl: 0.4, color: 0xff4d6d, alpha: 1 })
    P.burst(e.x, e.y, { n: 70, color: 0xffd7de, speed: 900, size: 9, ttl: 0.4, spread: 0.5, dir: e.a })
    this.rig.hit(14)
    this.flash(0.32, '#ffdde3')
  }

  // ─── 레이저 착탄 — 여기서 뭔가가 부서진다 ───────────────────
  laserHit(e) {
    const P = this.parts, R = Math.max(120, (e.r ?? 30) * 2.6)
    P.puff(e.x, e.y, { r0: 10, r1: R, ttl: 0.7, color: 0xff2d4d, alpha: 1 })
    P.shock(e.x, e.y, R, 0xffffff, 0.6, { thin: true, from: 0.08, to: 2.6, alpha: 1 })
    P.shock(e.x, e.y, R, 0xff4d6d, 1.1, { from: 0.1, to: 2.0, delay: 0.06 })
    P.burst(e.x, e.y, { n: e.sun ? 120 : 260, color: e.sun ? 0xffb247 : 0xff6b7f, speed: 520, size: 16, ttl: 1.6 })
    P.burst(e.x, e.y, { n: 90, color: 0xffffff, speed: 900, size: 9, ttl: 0.6 })
    this.rig.focus(e.x, e.y, 420, 2)
    this.rig.hit(VIS.SHAKE_MAX)
    this.flash(0.85, '#ffdde3')
  }

  // ─── 레이저 소진 — 아무것도 못 맞히고 성계를 벗어났다 ───────
  // 회피 성공의 신호이므로 조용하고 짧게. 터지지 않는다.
  laserMiss(e) {
    this.parts.puff(e.x, e.y, { r0: 6, r1: 70, ttl: 0.5, color: 0xff8fa3, alpha: 0.6 })
  }

  // ─── 핵 기폭 (§14.5 개정) ────────────────────────────────────
  // 순서가 전부다: 흰 섬광 → 창살 → 화구 팽창 → 이중 충격파 → 잔불 →
  // 늦게 퍼지는 폭풍 링. 작약량이 이 모든 것의 스케일을 한꺼번에 끌어올린다.
  nuke(e) {
    const yld = e.yld ?? CFG.YIELD_DEFAULT
    const k = yld / CFG.YIELD_MAX                    // 0~1 정규화 작약량
    const base = Math.max(44, (e.r ?? 20) * 2.4)     // 표적 크기에 비례한 최소 부피
    const R = base * (0.85 + 2.4 * k)
    const P = this.parts

    // ① 흰 섬광 — 프레임 하나를 통째로 태운다
    P.puff(e.x, e.y, { r0: R * 0.25, r1: R * 1.15, ttl: 0.18, color: 0xffffff, alpha: 1 })
    this.flash(e.earth ? 1 : 0.35 + 0.6 * k, e.earth ? '#fff5f5' : '#fff8e6')
    this.rig.focus(e.x, e.y, R * 2.2, 1.6)

    // ② 방사 창살 — 폭발이 "찌르고" 나가는 실루엣
    P.spikes(e.x, e.y, { n: 16 + Math.round(20 * k), color: 0xfff3cd, speed: 700 + 1300 * k, size: 7 + 8 * k, ttl: 0.45 + 0.4 * k })

    // ③ 화구 — 세 겹이 시차를 두고 부풀며 식는다 (흰 코어 → 주황 → 붉은 연기)
    P.puff(e.x, e.y, { r0: R * 0.12, r1: R * 1.35, ttl: 0.7 + 0.6 * k, color: 0xfff1c4, alpha: 1 })
    P.puff(e.x, e.y, { r0: R * 0.10, r1: R * 2.1, ttl: 1.1 + 0.9 * k, color: 0xff9a3c, alpha: 0.9, delay: 0.05 })
    P.puff(e.x, e.y, { r0: R * 0.20, r1: R * 3.1, ttl: 1.9 + 1.2 * k, color: 0x8f3b1b, alpha: 0.55, delay: 0.14, drift: 16 })

    // ④ 이중 충격파 — 얇은 링이 먼저 튀고, 두꺼운 링이 뒤따른다
    P.shock(e.x, e.y, R, 0xffffff, 0.5, { thin: true, from: 0.1, to: 4.0, alpha: 1 })
    P.shock(e.x, e.y, R, 0xffc879, 1.0 + 0.6 * k, { from: 0.15, to: 3.1, delay: 0.06 })
    P.shock(e.x, e.y, R, 0xfb923c, 1.5 + 0.7 * k, { thin: true, from: 0.2, to: 5.0, delay: 0.2, alpha: 0.45 })

    // ⑤ 파편·잔불 — 오래 남아 "여기서 뭔가 터졌다"를 유지한다
    P.burst(e.x, e.y, { n: 150 + Math.round(240 * k), color: 0xffc14d, speed: 320 + 460 * k, size: 16 + 12 * k, ttl: 1.5 + 1.1 * k })
    P.burst(e.x, e.y, { n: 80, color: 0xffffff, speed: 580 + 700 * k, size: 9, ttl: 0.65 })
    P.burst(e.x, e.y, { n: 70, color: 0xff5a2b, speed: 110, size: 20 + 14 * k, ttl: 3.0 + 1.8 * k, drag: 0.45 })

    // ⑥ 폭풍 링 — 실제로 주변 천체를 미는 반경 그대로. 보이는 것 = 미는 것
    if (e.wave) P.shock(e.x, e.y, e.wave, 0xfb923c, 0.85, { thin: true, from: 0.05, to: 1.0, alpha: 0.55, delay: 0.02 })

    // ⑦ 임펄스 방향으로 뿜어나가는 분사 — 어느 쪽으로 밀었는지 눈으로 확인시킨다
    if (e.px !== undefined) {
      const a = Math.atan2(e.py, e.px)
      P.burst(e.x, e.y, { n: 60, color: 0xffe9a8, speed: 340 + 380 * k, size: 10, ttl: 0.75, spread: 1.1, dir: a })
    }
    this.rig.hit(Math.min(VIS.SHAKE_MAX, (e.earth ? VIS.SHAKE_MAX : 12 + 30 * k)))
  }

  // ─── 휘발성 유폭 — 반경 전체가 밀려나는 게 보여야 한다 ────────
  volatile(e) {
    const P = this.parts, R = e.R
    this.flash(0.8, '#fff0d0')
    P.puff(e.x, e.y, { r0: R * 0.08, r1: R * 0.5, ttl: 0.2, color: 0xffffff, alpha: 1 })
    P.puff(e.x, e.y, { r0: R * 0.06, r1: R * 0.95, ttl: 1.1, color: 0xfb923c, alpha: 0.9, delay: 0.03 })
    P.puff(e.x, e.y, { r0: R * 0.20, r1: R * 1.35, ttl: 2.4, color: 0x7c2d12, alpha: 0.5, delay: 0.18, drift: 20 })
    P.spikes(e.x, e.y, { n: 44, color: 0xfff1c1, speed: 2100, size: 13, ttl: 0.9 })
    // 밀려나는 경계 = 실제 유폭 반경. 링이 딱 거기서 멈춘다.
    P.shock(e.x, e.y, R, 0xffffff, 0.55, { thin: true, from: 0.05, to: 1.0, alpha: 1 })
    P.shock(e.x, e.y, R, 0xfdba74, 1.2, { from: 0.05, to: 1.0, delay: 0.08, alpha: 0.8 })
    P.shock(e.x, e.y, R, 0xf97316, 1.9, { thin: true, from: 0.1, to: 1.0, delay: 0.24, alpha: 0.5 })
    P.burst(e.x, e.y, { n: 560, color: 0xffb347, speed: 640, size: 24, ttl: 2.8 })
    P.burst(e.x, e.y, { n: 180, color: 0xffffff, speed: 1400, size: 11, ttl: 1.0 })
    P.burst(e.x, e.y, { n: 120, color: 0xff4d2b, speed: 150, size: 30, ttl: 4.0, drag: 0.36 })
    this.rig.hit(VIS.SHAKE_MAX)
    this.rig.focus(e.x, e.y, R * 1.2)
  }

  // ─── 특이점 흡수 — 밖에서 안으로 빨려 들어간다 ────────────────
  absorb(e) {
    const P = this.parts, R = Math.max(30, (e.r ?? 20) * (e.small ? 1.4 : 2.6))
    // 바깥에서 안으로 조여드는 링 (from > to)
    P.shock(e.x, e.y, R, 0xc084fc, 0.7, { thin: true, from: 2.6, to: 0.05, alpha: 0.95 })
    P.shock(e.x, e.y, R, 0x7e22ce, 1.0, { from: 3.4, to: 0.1, alpha: 0.6, delay: 0.1 })
    P.puff(e.x, e.y, { r0: R * 1.6, r1: R * 0.05, ttl: 0.8, color: 0xa855f7, alpha: 0.9 })
    // 파티클도 바깥 링에서 중심으로 — spawn 위치를 원주에 두고 안쪽 속도를 준다
    for (let i = 0; i < (e.small ? 40 : 140); i++) {
      const a = Math.random() * Math.PI * 2, d = R * (1.2 + Math.random() * 1.6)
      const sp = 120 + Math.random() * 220
      P.spawn(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, -Math.cos(a) * sp, -Math.sin(a) * sp,
        _pc.setHex(Math.random() < 0.3 ? 0xffffff : 0xa855f7), 7 + Math.random() * 7, 0.7 + Math.random() * 0.6, 0.2)
    }
    this.rig.hit(e.small ? 5 : 18)
    if (!e.small) { this.flash(0.3, '#f5e6ff'); this.rig.focus(e.x, e.y, R * 3) }
  }

  // ─── 행성 폭파 — 핵으로는 절대 볼 수 없는 그림 ───────────────
  destroy(e) {
    const R = Math.max(70, (e.r ?? 30) * 3.6)
    const P = this.parts
    this.flash(e.earth ? 1 : 0.55, e.earth ? '#ffe4e6' : '#fff1d6')
    P.puff(e.x, e.y, { r0: R * 0.3, r1: R * 1.2, ttl: 0.22, color: 0xffffff, alpha: 1 })
    P.puff(e.x, e.y, { r0: R * 0.15, r1: R * 2.2, ttl: 1.3, color: e.earth ? 0x60a5fa : 0xffb347, alpha: 0.95, delay: 0.04 })
    P.puff(e.x, e.y, { r0: R * 0.30, r1: R * 3.4, ttl: 2.6, color: 0x7c2d12, alpha: 0.55, delay: 0.16, drift: 16 })
    P.spikes(e.x, e.y, { n: 36, color: 0xffffff, speed: 1900, size: 12, ttl: 0.8 })
    P.shock(e.x, e.y, R, 0xffffff, 0.5, { thin: true, from: 0.08, to: 4.2, alpha: 1 })
    P.shock(e.x, e.y, R, 0xfde68a, 1.1, { from: 0.12, to: 3.0, delay: 0.08 })
    P.shock(e.x, e.y, R, 0xf97316, 1.6, { thin: true, from: 0.1, to: 5.5, delay: 0.2, alpha: 0.5 })
    P.burst(e.x, e.y, { n: 520, color: e.earth ? 0x93c5fd : 0xffb347, speed: 620, size: 26, ttl: 3.0 })
    P.burst(e.x, e.y, { n: 180, color: 0xffffff, speed: 1250, size: 12, ttl: 1.0 })
    P.burst(e.x, e.y, { n: 140, color: 0xff4d2b, speed: 140, size: 30, ttl: 4.2, drag: 0.4 })
    this.rig.hit(VIS.SHAKE_MAX)
    this.rig.focus(e.x, e.y, R * 2.5)   // 화면 밖에서 터져도 보이게 붙잡는다
  }
}

const _pc = new THREE.Color()
