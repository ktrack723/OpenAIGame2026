import * as THREE from 'three'
import { VIS } from '../game/config.js'

// ─── 천체 분류와 그 아이콘 ──────────────────────────────────────
// 색과 텍스처만으로는 "저게 얼음인지 금속인지"가 안 읽힌다 — 특히 줌아웃하면
// 전부 같은 크기의 점이 된다. 그래서 공 위에 **화면 크기 고정** 배지를 하나씩
// 띄운다. 판정에는 아무 영향이 없고, 오직 "저건 뭐냐"에만 답한다.
//
// 적대 표식(해골)은 별도다: 내가 반드시 부숴야 하는 공(조르그 요새)에만 붙고,
// 붉은 배지 + 맥동으로 나머지와 확실히 갈린다.
//
// **규칙이 없는 분류는 없앴다.** 예전엔 용암·해양·독성·생명이 따로 있었는데
// 넷 다 색만 다르고 게임에 아무 영향이 없었다 — 플레이어가 외워야 할 이름만
// 늘리고 판단은 하나도 안 바뀌는 분류는 노이즈다. 전부 암석으로 합쳤다.
// 남은 다섯 중 넷은 저마다 **한 줄짜리 메카닉**이 있다(암석만 규칙이 없다).
// 아이콘도 상징 기호(⚙·☣)가 아니라 그 물건 자체를 그린 것으로 바꿨다 —
// 보면 무엇인지 알아야 한다.
export const CATEGORY = {
  rock: { icon: '🪨', label: '암석 행성', color: '#cbd5e1', mech: '규칙 없음 — 무게대로만 움직인다', desc: '태그 없는 일반 행성. 마음 놓고 큐볼로 써라.' },
  ice: { icon: '🧊', label: '얼음 행성', color: '#a5f3fc', mech: '가볍다 — 같은 크기 대비 질량 절반, 두 배로 밀린다', desc: '가장 좋은 큐볼. 한 방에 멀리 날아간다.' },
  iron: { icon: '🔩', label: '금속 행성', color: '#e2e8f0', mech: '무겁다 — 핵 임펄스가 절반만 먹는다', desc: '밀리긴 한다. 다만 같은 작약으로 절반밖에 안 간다.' },
  gas: { icon: '🪐', label: '가스 행성', color: '#fcd34d', mech: '터진다 — 핵을 맞거나 세게 처박히면 대규모 유폭', desc: '반경 420 GU 이상이 통째로 밀려난다. 판을 뒤집는 수.' },
  void: { icon: '🕳', label: '특이점', color: '#c084fc', mech: '삼킨다 — 닿는 것을 없앤다. 부술 수 없다', desc: '블랙홀·태양과 같은 부류. 여기로 밀어 넣어라.' },
  earth: { icon: '🌍', label: '지구', color: '#93c5fd', mech: '우리 집 — 세 번 처박히면 게임 오버', desc: '발사대이자 지켜야 할 것.' },
  zorg: { icon: '👁', label: '조르그 모성', color: '#e879f9', mech: '부술 수 없다 — 시한이 끝나면 온다', desc: '판돈을 회수하러 직접 온 것.' },
  debris: { icon: '·', label: '파편', color: '#94a3b8', mech: '미사일을 조기 격발시킨다', desc: '충돌 잔해.' },
}
export const HOSTILE = { icon: '☠', label: '조르그 요새', color: '#ff5c6a' }

export const categoryOf = (type) => CATEGORY[type] ?? CATEGORY.rock

// 배지 한 장 굽기 — 원형 칩 위에 글리프. 이모지가 없는 환경에서도
// 폴백 글꼴이 뭔가는 그리므로 최악의 경우에도 "표식이 있다"는 읽힌다.
function badgeTexture(glyph, color, ring, bg) {
  const S = 128
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.42, 0, 6.2832)
  g.fillStyle = bg; g.fill()
  g.lineWidth = 6; g.strokeStyle = ring; g.stroke()
  g.font = `700 ${S * 0.46}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillStyle = color
  g.fillText(glyph, S / 2, S * 0.54)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.minFilter = THREE.LinearFilter
  return t
}

export class Icons {
  constructor(scene) {
    this.scene = scene
    this.cache = new Map()     // key → texture
    this.sprites = new Map()   // body.id → { cat, hostile }
    this.t = 0
  }

  texFor(key, glyph, color, ring, bg) {
    if (!this.cache.has(key)) this.cache.set(key, badgeTexture(glyph, color, ring, bg))
    return this.cache.get(key)
  }

  makeSprite(tex, order) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false,
    }))
    sp.renderOrder = order
    this.scene.add(sp)
    return sp
  }

  // 이 공이 "반드시 부숴야 하는" 표적인가 — 해골이 붙는 조건.
  // 규칙은 game.isTarget과 같아야 한다(요새 = 반격하는 조르그 천체).
  static isHostile(b) { return b.role === 'battery' }

  update(game, rig, dt, renderRadius) {
    this.t += dt
    const ppw = rig.worldPerPx
    const size = VIS.ICON_PX * ppw
    const seen = new Set()
    for (const b of game.bodies) {
      if (!b.alive || b.type === 'debris' || (b.warpIn ?? 0) > 0) continue
      seen.add(b.id)
      let e = this.sprites.get(b.id)
      const cat = categoryOf(b.type)
      if (!e || e.type !== b.type) {
        if (e) { this.scene.remove(e.cat); e.cat.material.dispose() }
        const tex = this.texFor(`c:${b.type}`, cat.icon, cat.color, cat.color + 'aa', 'rgba(3,10,18,.82)')
        e = { cat: this.makeSprite(tex, 22), hostile: e ? e.hostile : null, type: b.type }
        this.sprites.set(b.id, e)
      }
      const hostile = Icons.isHostile(b)
      if (hostile && !e.hostile) {
        e.hostile = this.makeSprite(this.texFor('h:skull', HOSTILE.icon, HOSTILE.color, '#ff5c6a', 'rgba(38,4,8,.92)'), 23)
      } else if (!hostile && e.hostile) {
        this.scene.remove(e.hostile); e.hostile.material.dispose(); e.hostile = null
      }

      const R = renderRadius(b)
      // 배지는 공 오른쪽 위 어깨에 — 공 자체(와 락온 링)를 가리지 않는 자리다
      const off = R + size * 0.55
      e.cat.visible = true
      e.cat.scale.set(size, size, 1)
      e.cat.position.set(b.pos.x + off * 0.72, b.pos.y + off * 0.72, 9)
      if (e.hostile) {
        // 해골은 공 바로 위. 크게, 그리고 숨쉬듯 맥동시켜 시선을 끈다.
        const pulse = 1 + 0.12 * Math.sin(this.t * 4)
        const hs = size * 1.35 * pulse
        e.hostile.visible = true
        e.hostile.scale.set(hs, hs, 1)
        e.hostile.position.set(b.pos.x, b.pos.y + R + hs * 0.62, 9)
      }
    }
    // 죽었거나 사라진 천체의 배지는 숨긴다
    for (const [id, e] of this.sprites) {
      if (seen.has(id)) continue
      e.cat.visible = false
      if (e.hostile) e.hostile.visible = false
    }
  }

  dispose() {
    for (const e of this.sprites.values()) {
      this.scene.remove(e.cat); e.cat.material.dispose()
      if (e.hostile) { this.scene.remove(e.hostile); e.hostile.material.dispose() }
    }
    this.sprites.clear()
  }
}
