import * as THREE from 'three'
import { CFG, VIS } from '../game/config.js'

// ─── 폭발 연출 (§14.5) ──────────────────────────────────────────
// 게임 로직이 쌓아둔 fx 큐를 소비해 파티클/링/섬광으로 옮긴다.
// 여기 있는 숫자는 전부 "보이는 크기"일 뿐, 미는 힘·반경 같은 게임 수치가
// 아니다 — 그건 game.js와 config.js에만 있다.

// ─── 두 광선의 색 ───────────────────────────────────────────────
// 요새의 광선과 모성의 난사는 **같은 그림에 다른 색**을 쓴다. 그림이 같은 것은
// 굴러가는 규칙이 같기 때문이고(같은 sweep · 같은 속도 · 닿는 첫 천체는 체력
// 불문 소멸), 색이 갈리는 것은 **지구에게만 규칙이 다르기** 때문이다:
//   · 요새의 광선 → 지구 체력 한 눈금(EARTH_MAX_DMG 1). 세 번까지 버틴다.
//   · 모성의 난사 → 체력을 아예 안 본다. 닿으면 그 자리에서 끝이다(game.tickDoom).
// 같은 색으로 두면 그 차이는 맞아 보기 전에 알 길이 없다.
//
// 새 색을 만들지는 않았다. 판은 이미 이 둘로 편을 갈라 놓았다 — 요새는 장미,
// 모성은 자홍이고(폭발의 capital · Markers의 화살표 · 패배 화면 · Icons의 분류색),
// 난사만 그 표에서 혼자 장미였다.
// (막대 자체는 LaserView가 그린다 — 그래서 표를 내보낸다. 색이 두 군데에
//  적혀 있으면 한쪽만 고쳐지고, 그러면 막대와 착탄이 다른 색이 된다.)
export const LZ_FORT = { core: 0xff2d4d, glow: 0xff4d6d, spark: 0xff6b7f, mist: 0xffd7de, flash: '#ffdde3', warm: '#ffe0e6' }
export const LZ_DOOM = { core: 0xe879f9, glow: 0xf0abfc, spark: 0xf5a3fc, mist: 0xf5d0fe, flash: '#f7dcff', warm: '#f3d5ff' }
export const lzOf = (e) => (e && e.doom ? LZ_DOOM : LZ_FORT)

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
      else if (e.kind === 'shatter') this.shatter(e)
      else if (e.kind === 'shard') this.shard(e)
      else if (e.kind === 'nuke') this.nuke(e)
      else if (e.kind === 'zorgCharge') this.zorgCharge(e)
      else if (e.kind === 'destroy') (e.zorg ? this.destroyZorg(e) : this.destroy(e))
      else if (e.kind === 'comet') this.comet(e)
      else if (e.kind === 'swing') {
        this.parts.shock(e.x, e.y, Math.max(24, (e.r ?? 10) * CFG.SWING_ZONE * 0.5), 0x67e8f9, 0.6)
        this.parts.burst(e.x, e.y, { n: 26, color: 0x67e8f9, speed: 110, size: 8, ttl: 0.7 })
      } else if (e.kind === 'siegeLock') this.siegeLock(e)
      else if (e.kind === 'siegeFire') this.siegeFire(e)
      else if (e.kind === 'siegeNuke') this.siegeNuke(e)
      else if (e.kind === 'siegePush') this.siegePush(e)
      else if (e.kind === 'boost') this.boost(e)
      else if (e.kind === 'earthBurn') this.earthBurn(e)
      else if (e.kind === 'pol') this.pol(e)
      else if (e.kind === 'bump') this.bump(e)
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


  // ─── 투석기의 한 수 ────────────────────────────────────────
  // 셋 다 조르그 것이므로 **주홍**으로 묶는다. 내 핵의 화구는 흰빛에서
  // 호박·주황으로 식지만(nuke), 이쪽은 처음부터 끝까지 붉다 — 화면에 둘이
  // 같이 터져도 어느 쪽이 내 것인지 색 하나로 갈린다.
  //
  // 잠금 — 실로가 열린다. 폭발이 아니라 **예고**이므로 아무것도 안 터진다:
  // 안으로 조여드는 고리 하나와 실로에서 새는 불티뿐이다.
  siegeLock(e) {
    const P = this.parts, R = Math.max(60, (e.r ?? 40) * 1.8)
    P.shock(e.x, e.y, R, 0xff3b1f, 0.7, { thin: true, from: 3.0, to: 0.9, alpha: 0.85 })
    P.shock(e.x, e.y, R, 0xffb03a, 1.0, { thin: true, from: 3.8, to: 1.1, alpha: 0.5, delay: 0.1 })
    P.burst(e.x, e.y, { n: 46, color: 0xff7a3a, speed: 120, size: 10, ttl: 1.2, drag: 0.4 })
  }

  // 발사 — 박격이다. 통에서 뭉툭한 것이 밀려 나가는 그림이라 배기가 **뒤로**
  // 뿜고(e.a의 반대) 고리는 총구 앞으로 퍼진다.
  siegeFire(e) {
    const P = this.parts, R = Math.max(70, (e.r ?? 40) * 2.0)
    const back = (e.a ?? 0) + Math.PI
    P.puff(e.x, e.y, { r0: R * 0.1, r1: R * 0.7, ttl: 0.22, color: 0xffe0c0, alpha: 1 })
    P.shock(e.x, e.y, R, 0xffffff, 0.45, { thin: true, from: 0.12, to: 2.6, alpha: 0.9 })
    P.shock(e.x, e.y, R, 0xff3b1f, 0.9, { from: 0.18, to: 2.2, delay: 0.06 })
    P.burst(e.x, e.y, { n: 150, color: 0xff5a2b, speed: 520, size: 13, ttl: 1.1, spread: 0.7, dir: back })
    P.burst(e.x, e.y, { n: 70, color: 0xffd9c0, speed: 880, size: 8, ttl: 0.5, spread: 0.4, dir: back })
    P.burst(e.x, e.y, { n: 60, color: 0x7a1226, speed: 130, size: 22, ttl: 2.6, spread: 1.1, dir: back, drag: 0.45 })
    P.spikes(e.x, e.y, { n: 12, color: 0xffb03a, speed: 1200, size: 8, ttl: 0.45 })
    this.rig.hit(14)
    this.flash(0.16, '#ffd8c4')
  }

  // 기폭 — 내 핵(nuke)과 **같은 문법, 다른 색**이다. 겹의 구성이 같아야
  // "저것도 핵이다"가 읽히고(임펄스 규칙이 실제로 같다), 색이 달라야
  // "내가 쏜 게 아니다"가 읽힌다. 화구가 식지 않고 검붉게 가라앉는다.
  siegeNuke(e) {
    const yld = e.yld ?? CFG.SIEGE_YIELD ?? 9
    const k = yld / CFG.YIELD_MAX
    const R = Math.max(44, (e.r ?? 20) * 2.4) * (0.85 + 2.2 * k)
    const P = this.parts
    P.puff(e.x, e.y, { r0: R * 0.22, r1: R * 1.1, ttl: 0.18, color: 0xfff0e4, alpha: 1 })
    this.flash(e.earth ? 0.9 : 0.34 + 0.5 * k, e.earth ? '#ffe8e8' : '#ffd9c8')
    this.rig.focus(e.x, e.y, R * 2.2, 1.6)
    P.spikes(e.x, e.y, { n: 18 + Math.round(18 * k), color: 0xffb03a, speed: 780 + 1200 * k, size: 8 + 7 * k, ttl: 0.5 })
    // 화구 — 흰빛이 아주 짧게 스치고 곧바로 붉음으로 넘어간다
    P.puff(e.x, e.y, { r0: R * 0.12, r1: R * 1.3, ttl: 0.6 + 0.5 * k, color: 0xff8a4a, alpha: 1 })
    P.puff(e.x, e.y, { r0: R * 0.10, r1: R * 2.1, ttl: 1.1 + 0.8 * k, color: 0xff2f1c, alpha: 0.92, delay: 0.05 })
    P.puff(e.x, e.y, { r0: R * 0.20, r1: R * 3.2, ttl: 2.1 + 1.2 * k, color: 0x4a0a12, alpha: 0.6, delay: 0.15, drift: 16 })
    P.shock(e.x, e.y, R, 0xffffff, 0.5, { thin: true, from: 0.1, to: 4.0, alpha: 1 })
    P.shock(e.x, e.y, R, 0xff3b1f, 1.0 + 0.6 * k, { from: 0.15, to: 3.1, delay: 0.06 })
    P.shock(e.x, e.y, R, 0xc026d3, 1.5 + 0.7 * k, { thin: true, from: 0.2, to: 5.2, delay: 0.2, alpha: 0.5 })
    P.burst(e.x, e.y, { n: 160 + Math.round(200 * k), color: 0xff5a2b, speed: 340 + 440 * k, size: 16 + 10 * k, ttl: 1.5 + 1.0 * k })
    P.burst(e.x, e.y, { n: 70, color: 0xffe0c0, speed: 620 + 640 * k, size: 9, ttl: 0.6 })
    P.burst(e.x, e.y, { n: 80, color: 0x7a0a1e, speed: 110, size: 22 + 12 * k, ttl: 3.2 + 1.6 * k, drag: 0.45 })
    this.rig.hit(Math.min(VIS.SHAKE_MAX, e.earth ? VIS.SHAKE_MAX * 0.8 : 14 + 26 * k))
  }

  // 밀린 방향 — 폭풍 링과 임펄스 분사. 이 두 겹이 "당구를 쳤다"의 전부다:
  // 어느 공이 어느 쪽으로 굴러가는지가 여기서 눈에 박혀야, 그다음 수십 초를
  // 플레이어가 그 공을 좇으며 보낸다.
  siegePush(e) {
    const P = this.parts
    if (e.wave) P.shock(e.x, e.y, e.wave, 0xff3b1f, 0.85, { thin: true, from: 0.05, to: 1.0, alpha: 0.55, delay: 0.02 })
    if (e.px === undefined) return
    const a = Math.atan2(e.py, e.px)
    P.burst(e.x, e.y, { n: 90, color: 0xffb03a, speed: 420, size: 12, ttl: 0.9, spread: 0.9, dir: a })
    P.shock(e.x, e.y, Math.max(50, (e.r ?? 20) * 2), 0xffb03a, 0.7, { thin: true, from: 0.2, to: 3.0, alpha: 0.7, delay: 0.05 })
  }

  // ─── 요새의 회피 분사 ────────────────────────────────────────
  // 폭발이 아니다 — **밀어내는 힘**이다. 그래서 터지는 그림을 안 쓰고
  // 배기 방향(e.a = 밀린 반대쪽)으로만 길게 뿜는다. 그 꼬리가 곧 "저쪽으로
  // 비켜났다"는 표시라, 어느 쪽으로 궤도가 틀어졌는지가 불꽃만 보고도 읽힌다.
  // 크기와 길이를 함께 올렸다 — 0.4초짜리 불꽃은 빨리 감기로 보면 그냥
  // 지나가 버렸다. 이제 화구가 배기 방향으로 길게 뻗고, 그 자리에 연기가
  // 2초 넘게 남는다.
  boost(e) {
    const P = this.parts, R = Math.max(64, (e.r ?? 24) * 2.6)
    // ① 점화 — 흰 섬광 한 겹
    P.puff(e.x, e.y, { r0: R * 0.08, r1: R * 0.55, ttl: 0.18, color: 0xffffff, alpha: 1 })
    P.puff(e.x, e.y, { r0: R * 0.12, r1: R * 1.15, ttl: 0.8, color: 0xff9ad5, alpha: 0.9, delay: 0.04 })
    // ② 배기 화염 — 세 겹이 시차를 두고 같은 방향으로 뻗는다(길고 좁게)
    P.burst(e.x, e.y, { n: 260, color: 0xff5c9e, speed: 620, size: 17, ttl: 2.0, spread: 0.5, dir: e.a })
    P.burst(e.x, e.y, { n: 150, color: 0xffd7ec, speed: 980, size: 11, ttl: 1.3, spread: 0.3, dir: e.a })
    P.burst(e.x, e.y, { n: 90, color: 0xffffff, speed: 1350, size: 8, ttl: 0.7, spread: 0.18, dir: e.a })
    // ③ 잔염 — 느리고 오래 남아 "여기서 태웠다"가 궤도에 자국으로 남는다
    P.burst(e.x, e.y, { n: 120, color: 0xc0367a, speed: 150, size: 26, ttl: 3.4, spread: 0.9, dir: e.a, drag: 0.4 })
    P.puff(e.x, e.y, { r0: R * 0.3, r1: R * 2.4, ttl: 2.6, color: 0x7a1f4a, alpha: 0.5, delay: 0.2, drift: 14 })
    P.spikes(e.x, e.y, { n: 18, color: 0xffd7ec, speed: 1500, size: 9, ttl: 0.7 })
    // ④ 충격파 두 겹 — 늦은 쪽이 더 크게 번진다
    P.shock(e.x, e.y, R, 0xffffff, 0.5, { thin: true, from: 0.08, to: 2.6, alpha: 0.95 })
    P.shock(e.x, e.y, R, 0xff5c9e, 1.15, { from: 0.14, to: 3.4, delay: 0.1, alpha: 0.7 })
    this.rig.hit(18)
    this.flash(0.26, '#ffe0f0')
    this.rig.focus(e.x, e.y, R * 2.2, 1.8)
  }

  // ─── 지구의 추진 분사 ────────────────────────────────────────
  // 요새의 회피 분사(boost)와 **같은 물건이라는 게 그림으로 읽혀야** 하므로
  // 같은 문법(점화 섬광 + 배기 화염 + 잔염)을 쓴다. 다른 것은 색 하나다.
  //
  // **주황이다.** 둘은 같은 화면에 동시에 뜰 수 있다 — 요새가 내 탄을 피하는
  // 그 순간 지구가 광선을 피한다 — 그래서 누가 태운 불인지가 색 하나로 갈려야
  // 한다. 조르그는 분홍(0xff5c9e), 지구는 주황이다. 관측 바의 추진기 버튼도
  // 같은 주황이라, 누른 버튼의 색이 그대로 화면에서 타오른다.
  //
  // 다른 점 하나 더: `rig.focus`를 안 부른다. 저건 "저기 봐라"라고 카메라를 끌어
  // 당기는 연출인데, 이건 플레이어가 **직접 누른** 버튼이다 — 이미 보고 있다.
  // 관측 중에 카메라가 홱 움직이면 레이저 회랑을 읽던 눈이 끊긴다.
  earthBurn(e) {
    const P = this.parts, R = Math.max(56, (e.r ?? 24) * 2.2)
    P.puff(e.x, e.y, { r0: R * 0.08, r1: R * 0.5, ttl: 0.16, color: 0xffffff, alpha: 1 })
    P.puff(e.x, e.y, { r0: R * 0.12, r1: R * 1.0, ttl: 0.7, color: 0xffb066, alpha: 0.85, delay: 0.04 })
    P.burst(e.x, e.y, { n: 220, color: 0xff7a18, speed: 560, size: 15, ttl: 1.7, spread: 0.5, dir: e.a })
    P.burst(e.x, e.y, { n: 130, color: 0xffdcb0, speed: 900, size: 10, ttl: 1.1, spread: 0.3, dir: e.a })
    P.burst(e.x, e.y, { n: 80, color: 0xffffff, speed: 1250, size: 7, ttl: 0.6, spread: 0.18, dir: e.a })
    P.burst(e.x, e.y, { n: 90, color: 0x8a3d05, speed: 130, size: 22, ttl: 3.0, spread: 0.9, dir: e.a, drag: 0.4 })
    P.spikes(e.x, e.y, { n: 14, color: 0xffdcb0, speed: 1300, size: 8, ttl: 0.6 })
    P.shock(e.x, e.y, R, 0xffffff, 0.45, { thin: true, from: 0.08, to: 2.4, alpha: 0.9 })
    P.shock(e.x, e.y, R, 0xff7a18, 1.0, { from: 0.14, to: 3.0, delay: 0.1, alpha: 0.65 })
    this.rig.hit(10)
    this.flash(0.16, '#ffe0bf')
  }

  // ─── 정치자금 획득 ───────────────────────────────────────────
  // 숫자가 벌어진 **그 자리에서** 떠오른다. 화면 구석의 숫자만 바뀌면 무엇이
  // 돈이 됐는지를 못 잇는다 — 스윙바이한 행성 옆에서 +1이 떠올라야 "저게
  // 돈이구나"가 성립한다.
  //
  // 스프라이트는 캔버스 텍스처다. 파티클(Particles)에는 글자를 그리는 수단이
  // 없고, 여기서 억지로 만들면 파티클이 텍스트 엔진이 된다. 대신 Icons·Markers가
  // 쓰는 그 방식(캔버스 → CanvasTexture)을 그대로, 아주 작게 가져온다.
  pol(e) {
    const sp = this.polSprite(e.n)
    if (!sp) return
    sp.position.set(e.x, e.y, 9)
    sp.material.opacity = 1
    sp.userData.t = 0
    sp.visible = true
    this.parts.shock(e.x, e.y, Math.max(30, (e.r ?? 20) * 1.2), 0xfbbf24, 0.5,
      { thin: true, from: 0.3, to: 1.9, alpha: 0.55 })
  }

  // 숫자별로 텍스처를 한 장씩만 굽고(+1 · +2 뿐이다), 스프라이트는 8장을 돌려 쓴다.
  polSprite(n) {
    this.polTex ??= new Map()
    this.polPool ??= []
    let tex = this.polTex.get(n)
    if (!tex) {
      const S = 128, c = document.createElement('canvas')
      c.width = S; c.height = S / 2
      const g = c.getContext('2d')
      g.font = `800 ${S * 0.36}px system-ui, sans-serif`
      g.textAlign = 'center'; g.textBaseline = 'middle'
      g.lineWidth = 7; g.strokeStyle = 'rgba(6,14,24,.92)'
      g.strokeText(`+${n}`, S / 2, S / 4)
      g.fillStyle = '#fde68a'
      g.fillText(`+${n}`, S / 2, S / 4)
      tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.minFilter = THREE.LinearFilter
      this.polTex.set(n, tex)
    }
    let sp = this.polPool.find((s) => !s.visible)
    if (!sp) {
      if (this.polPool.length >= 8) sp = this.polPool[0]
      else {
        sp = new THREE.Sprite(new THREE.SpriteMaterial({
          transparent: true, depthTest: false, depthWrite: false,
        }))
        sp.renderOrder = 24
        sp.visible = false
        this.polPool.push(sp)
        this.scene?.add(sp)
      }
    }
    sp.material.map = tex
    sp.material.needsUpdate = true
    return sp
  }

  // 떠오르며 사라진다. 실시간으로 움직인다 — 자금은 관측 중(배속 8×)에도
  // 들어오는데 게임 시간으로 재면 그때 8분의 1로 짧아진다.
  stepPol(dt, ppw) {
    if (!this.polPool) return
    for (const sp of this.polPool) {
      if (!sp.visible) continue
      const u = (sp.userData.t += dt) / 1.1
      if (u >= 1) { sp.visible = false; continue }
      sp.position.y += 34 * ppw * dt
      sp.material.opacity = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85
      const k = Math.max(26, 46 * ppw) * (0.75 + 0.35 * Math.min(1, u * 4))
      sp.scale.set(k * 2, k, 1)
    }
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
    const P = this.parts, C = lzOf(e)
    P.shock(e.x, e.y, 120, C.glow, 0.8, { thin: true, from: 2.8, to: 0.15, alpha: 0.9 })
    P.burst(e.x, e.y, { n: 60, color: C.glow, speed: 160, size: 10, ttl: 0.9 })
    this.rig.hit(8)
    this.flash(0.16, C.warm)
  }

  // ─── 레이저 발사 — 총구에서 탄두가 튀어나가는 순간만 ────────
  // 착탄은 별도 이벤트다(laserHit). 광선이 날아가는 데 시간이 걸리므로
  // 예전처럼 발사와 착탄을 한 번에 터뜨리면 거짓말이 된다.
  laserFire(e) {
    const P = this.parts, C = lzOf(e)
    P.puff(e.x, e.y, { r0: 8, r1: 120, ttl: 0.4, color: C.glow, alpha: 1 })
    P.burst(e.x, e.y, { n: 70, color: C.mist, speed: 900, size: 9, ttl: 0.4, spread: 0.5, dir: e.a })
    this.rig.hit(14)
    this.flash(0.32, C.flash)
  }

  // ─── 레이저 착탄 — 여기서 뭔가가 부서진다 ───────────────────
  laserHit(e) {
    const P = this.parts, C = lzOf(e), R = Math.max(120, (e.r ?? 30) * 2.6)
    P.puff(e.x, e.y, { r0: 10, r1: R, ttl: 0.7, color: C.core, alpha: 1 })
    P.shock(e.x, e.y, R, 0xffffff, 0.6, { thin: true, from: 0.08, to: 2.6, alpha: 1 })
    P.shock(e.x, e.y, R, C.glow, 1.1, { from: 0.1, to: 2.0, delay: 0.06 })
    P.burst(e.x, e.y, { n: e.sun ? 120 : 260, color: e.sun ? 0xffb247 : C.spark, speed: 520, size: 16, ttl: 1.6 })
    P.burst(e.x, e.y, { n: 90, color: 0xffffff, speed: 900, size: 9, ttl: 0.6 })
    this.rig.focus(e.x, e.y, 420, 2)
    this.rig.hit(VIS.SHAKE_MAX)
    this.flash(0.85, C.flash)
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

  // ─── 불안정 행성 파열 — 한쪽으로 쏟아진다 ─────────────────────
  // 유폭(volatile)과 **일부러 같은 문법**을 쓰되 방향만 다르다: 저건 사방으로
  // 퍼지는 원이고 이건 한쪽으로 쏟아지는 부채꼴이다. 그림이 그 차이만 말하면
  // 플레이어는 이미 아는 것(유폭) 위에 한 가지만 더 얹어 배운다.
  //
  // 분사 방향(e.a)은 실제 파편이 나가는 방향과 같은 값이다 — 연출이 판보다
  // 먼저 말하고 판이 그대로 따라오므로, 눈이 산탄을 놓치지 않는다.
  shatter(e) {
    const P = this.parts, R = Math.max(70, (e.r ?? 20) * 3.2)
    const cone = e.cone ?? 0.44, a = e.a ?? 0
    this.flash(0.42, '#ecfccb')
    // ① 껍데기가 터지는 순간 — 흰 코어 한 겹만. 원은 여기서 끝난다
    P.puff(e.x, e.y, { r0: R * 0.12, r1: R * 0.7, ttl: 0.22, color: 0xffffff, alpha: 1 })
    P.puff(e.x, e.y, { r0: R * 0.10, r1: R * 1.2, ttl: 0.8, color: 0xa3e635, alpha: 0.8, delay: 0.03 })
    // ② 총구 화염 — 부채꼴 안으로만. 세 겹이 점점 좁고 빠르게 나간다
    P.burst(e.x, e.y, { n: 260, color: 0xbef264, speed: 620, size: 17, ttl: 1.5, spread: cone * 2.2, dir: a })
    P.burst(e.x, e.y, { n: 160, color: 0xecfccb, speed: 1050, size: 11, ttl: 1.0, spread: cone * 1.4, dir: a })
    P.burst(e.x, e.y, { n: 90, color: 0xffffff, speed: 1500, size: 8, ttl: 0.6, spread: cone * 0.7, dir: a })
    // ③ 반동 — 뒤로 뿜는 짧은 연기. "쐈다"는 앞보다 뒤에서 더 잘 읽힌다
    P.burst(e.x, e.y, { n: 70, color: 0x4d7c0f, speed: 170, size: 22, ttl: 2.4, spread: 1.5, dir: a + Math.PI, drag: 0.5 })
    // ④ 충격파는 얇게 한 겹만 — 여기서 링을 두껍게 깔면 유폭으로 읽힌다
    P.shock(e.x, e.y, R, 0xffffff, 0.5, { thin: true, from: 0.08, to: 3.0, alpha: 0.9 })
    P.shock(e.x, e.y, R, 0xa3e635, 1.0, { thin: true, from: 0.12, to: 4.4, delay: 0.1, alpha: 0.5 })
    this.rig.hit(20)
    this.rig.focus(e.x, e.y, Math.max(R * 2.4, (e.reach ?? 0) * 0.6), 1.7)
  }

  // ─── 산탄 한 갈래가 꽂혔다 ───────────────────────────────────
  // 작게. 한 번의 파열에서 일곱 번까지 날 수 있는 소리이자 그림이라, 하나가
  // 크면 정작 그 뒤에 오는 격파 연출이 묻힌다. 그래도 **닿았다는 건 보여야**
  // 한다 — 파편이 소리 없이 사라지면 빗나간 것과 구분이 안 된다.
  shard(e) {
    const P = this.parts, R = Math.max(16, (e.r ?? 6) * 2.2)
    P.puff(e.x, e.y, { r0: R * 0.2, r1: R * 1.1, ttl: 0.24, color: 0xecfccb, alpha: 0.9 })
    P.burst(e.x, e.y, { n: 22, color: 0xbef264, speed: 220, size: 8, ttl: 0.5 })
    P.shock(e.x, e.y, R, 0xa3e635, 0.34, { thin: true, from: 0.15, to: 2.2, alpha: 0.7 })
  }

  // ─── 혜성 도착 — 벨트를 뚫고 들어온다 ────────────────────────
  // 워프가 아니다. 저건 조르그가 보낸 게 아니라 **원래 지나가던 것**이라
  // 도착에도 폭발이 없다: 얼음 벽을 스치고 지나간 파문 한 겹과, 진행 방향으로
  // 길게 끌리는 얼음 가루뿐이다. 화면은 "뭔가 들어왔다"만 말하면 된다.
  comet(e) {
    const P = this.parts, R = Math.max(70, (e.r ?? 30) * 2.4)
    P.shock(e.x, e.y, R, 0xe0f2fe, 0.9, { thin: true, from: 0.2, to: 3.4, alpha: 0.8 })
    P.puff(e.x, e.y, { r0: R * 0.2, r1: R * 1.3, ttl: 0.9, color: 0xbae6fd, alpha: 0.55 })
    P.burst(e.x, e.y, { n: 120, color: 0xdffbff, speed: 240, size: 12, ttl: 1.6, spread: 1.1, dir: e.a })
    P.burst(e.x, e.y, { n: 60, color: 0xffffff, speed: 420, size: 8, ttl: 0.8, spread: 0.6, dir: e.a })
    this.rig.hit(7)
    this.flash(0.12, '#e8f7ff')
  }

  // ─── 조르그의 마지막 0.45초 — 빛기둥 ─────────────────────────
  // **아직 안 터졌다.** 그게 이 연출의 전부다: 몸통이 하얗게 달아오르고
  // (Scene.drawDying), 중심에서 사방으로 빛기둥이 뻗고, 링이 안으로 조여든다.
  // 폭발의 문법(밖으로 퍼지는 화구·충격파)을 여기서는 하나도 안 쓴다 —
  // 써 버리면 0.45초 뒤의 진짜 폭발이 두 번째 폭발로 읽힌다.
  //
  // 색은 조르그의 것이다: 요새는 장미(제 회로 불빛과 같은 색), 모성은 자주.
  zorgCharge(e) {
    const P = this.parts, C = e.capital ? 0xe879f9 : 0xff2b3f
    const R = Math.max(60, (e.r ?? 30) * 1.6)
    // ① 안으로 조여드는 링 둘 — 힘이 모인다(from > to = 수축)
    P.shock(e.x, e.y, R, 0xffffff, 0.40, { thin: true, from: 3.0, to: 0.12, alpha: 1 })
    P.shock(e.x, e.y, R, C, 0.44, { from: 4.2, to: 0.2, alpha: 0.7, delay: 0.06 })
    // ② 빛기둥 — 가는 흰빛이 먼저, 굵은 제 색이 뒤따른다
    P.beams(e.x, e.y, { n: 10, color: 0xffffff, len: R * 5.5, w: R * 0.10, ttl: 0.42, alpha: 0.95 })
    P.beams(e.x, e.y, { n: 12, color: C, len: R * 8.0, w: R * 0.18, ttl: 0.40, delay: 0.09, roll: 0.26 })
    // ③ 코어가 하얗게 달아오른다
    P.puff(e.x, e.y, { r0: R * 0.10, r1: R * 0.78, ttl: 0.45, color: 0xffffff, alpha: 1 })
    // ④ 안으로 빨려드는 가루 — 밖으로 뿜는 게 아니다
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, d = R * (1.3 + Math.random() * 1.8)
      const sp = 220 + Math.random() * 300
      P.spawn(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, -Math.cos(a) * sp, -Math.sin(a) * sp,
        _pc.setHex(Math.random() < 0.4 ? 0xffffff : C), 6 + Math.random() * 6, 0.38, 0.2)
    }
    this.rig.focus(e.x, e.y, R * 3.4, 1.4)
    this.flash(0.12, e.capital ? '#ffe6ff' : '#ffdfe6')
  }

  // ─── 조르그 폭파 — 빛기둥이 판을 가른다 ──────────────────────
  // 일반 행성의 폭발(destroy)과 **의도적으로 다른 문법**을 쓴다:
  //   기둥이 있다 / 색이 장미·자주다 / 파편 대신 금속 조각이 곧게 날아간다.
  // 화면 구석에서 터져도 "저건 조르그였다"가 형태와 색으로 읽혀야 한다.
  destroyZorg(e) {
    const P = this.parts, C = e.capital ? 0xe879f9 : 0xff2b3f
    const R = Math.max(80, (e.r ?? 30) * 3.6)
    this.flash(0.9, e.capital ? '#ffe6ff' : '#ffe0e8')
    // ① 흰 코어가 터진다
    P.puff(e.x, e.y, { r0: R * 0.28, r1: R * 1.35, ttl: 0.24, color: 0xffffff, alpha: 1 })
    P.puff(e.x, e.y, { r0: R * 0.15, r1: R * 2.3, ttl: 1.2, color: C, alpha: 0.95, delay: 0.05 })
    P.puff(e.x, e.y, { r0: R * 0.30, r1: R * 3.6, ttl: 2.6, color: 0x4c1d95, alpha: 0.5, delay: 0.18, drift: 14 })
    // ② 빛기둥 — 사방으로 한 다발, 그리고 십자로 네 갈래가 훨씬 길게
    P.beams(e.x, e.y, { n: 14, color: 0xffffff, len: R * 6.5, w: R * 0.16, ttl: 0.55 })
    P.beams(e.x, e.y, { n: 4, color: C, len: R * 13, w: R * 0.30, ttl: 0.85, delay: 0.04, roll: 0.4 })
    // ③ 충격파 — 흰 링이 먼저, 제 색 링이 크게 뒤따른다
    P.shock(e.x, e.y, R, 0xffffff, 0.5, { thin: true, from: 0.08, to: 4.6, alpha: 1 })
    P.shock(e.x, e.y, R, C, 1.15, { from: 0.12, to: 3.2, delay: 0.07 })
    P.shock(e.x, e.y, R, 0xa855f7, 1.7, { thin: true, from: 0.1, to: 6.0, delay: 0.22, alpha: 0.45 })
    // ④ 파편 — 흙먼지가 아니라 **곧게 날아가는 조각**이다(속도↑ 크기↓ 항력↓)
    P.spikes(e.x, e.y, { n: 40, color: 0xffffff, speed: 2200, size: 11, ttl: 0.9 })
    P.burst(e.x, e.y, { n: 380, color: C, speed: 780, size: 15, ttl: 2.4, drag: 0.5 })
    P.burst(e.x, e.y, { n: 160, color: 0xffffff, speed: 1400, size: 9, ttl: 1.0 })
    this.rig.hit(VIS.SHAKE_MAX)
    this.rig.focus(e.x, e.y, R * 2.6)
  }

  // ─── 행성 폭파 — 핵으로는 절대 볼 수 없는 그림 ───────────────
  // 조르그(destroyZorg)와 갈리는 쪽이다: **흙먼지와 화구.** 기둥도 없고
  // 색도 주황·호박·적갈이다. 그래서 판 위에서 둘은 절대 안 헷갈린다.
  // 흔들림과 섬광을 조금 낮춘 것도 같은 이유다 — 이건 배경 사건이고,
  // 화면을 통째로 태우는 것은 조르그가 부서질 때다.
  destroy(e) {
    const R = Math.max(70, (e.r ?? 30) * 3.6)
    const P = this.parts
    this.flash(e.earth ? 1 : 0.38, e.earth ? '#ffe4e6' : '#fff1d6')
    P.puff(e.x, e.y, { r0: R * 0.3, r1: R * 1.2, ttl: 0.22, color: 0xffffff, alpha: 1 })
    P.puff(e.x, e.y, { r0: R * 0.15, r1: R * 2.2, ttl: 1.3, color: e.earth ? 0x60a5fa : 0xffb347, alpha: 0.95, delay: 0.04 })
    P.puff(e.x, e.y, { r0: R * 0.30, r1: R * 3.4, ttl: 2.6, color: 0x7c2d12, alpha: 0.55, delay: 0.16, drift: 16 })
    P.spikes(e.x, e.y, { n: 24, color: 0xffe6b8, speed: 1500, size: 12, ttl: 0.8 })
    P.shock(e.x, e.y, R, 0xffffff, 0.5, { thin: true, from: 0.08, to: 4.2, alpha: 1 })
    P.shock(e.x, e.y, R, 0xfde68a, 1.1, { from: 0.12, to: 3.0, delay: 0.08 })
    P.burst(e.x, e.y, { n: 460, color: e.earth ? 0x93c5fd : 0xffb347, speed: 560, size: 26, ttl: 3.0, drag: 1.3 })
    P.burst(e.x, e.y, { n: 140, color: 0xffffff, speed: 1100, size: 12, ttl: 1.0 })
    P.burst(e.x, e.y, { n: 140, color: 0xff4d2b, speed: 140, size: 30, ttl: 4.2, drag: 0.4 })
    this.rig.hit(e.earth ? VIS.SHAKE_MAX : VIS.SHAKE_MAX * 0.62)
    this.rig.focus(e.x, e.y, R * 2.5)   // 화면 밖에서 터져도 보이게 붙잡는다
  }
}

const _pc = new THREE.Color()
