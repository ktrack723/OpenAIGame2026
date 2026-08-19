import { t } from '../i18n/index.js'
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
// 남은 여섯 중 다섯은 저마다 **한 줄짜리 메카닉**이 있다(암석만 규칙이 없다).
// 아이콘도 상징 기호(⚙·☣)가 아니라 그 물건 자체를 그린 것으로 바꿨다 —
// 보면 무엇인지 알아야 한다.
// 아이콘과 색만 여기 둔다. 이름·메카닉 한 줄은 언어 표(cat.*)에 있고,
// 쓰는 쪽은 cat.label / cat.mech 로 읽으면 된다(그때 번역된다).
const CAT_STYLE = {
  rock: { icon: '🪨', color: '#cbd5e1' },
  ice: { icon: '🧊', color: '#a5f3fc' },
  iron: { icon: '🔩', color: '#e2e8f0' },
  gas: { icon: '🪐', color: '#fcd34d' },
  shard: { icon: '💥', color: '#bef264' },
  comet: { icon: '☄', color: '#bae6fd' },
  // 순회선 — 조르그가 아닌 다른 종족의 배. 배지 하나로 "저건 편이 다르다"가
  // 읽혀야 하므로 조르그의 붉은 계열과 제일 먼 비취색을 쓴다(roles.visitor와 같은 색).
  ufo: { icon: '◇', color: '#34d399' },
  earth: { icon: '🌍', color: '#93c5fd' },
  zorg: { icon: '👁', color: '#e879f9' },
  siege: { icon: '🚀', color: '#ff8a6a' },
  debris: { icon: '·', color: '#94a3b8' },
  // 산탄은 잔해와 **다른 물건**이다(Scene.shardGeo). 종류(type)는 둘 다 debris라
  // 표에서 갈 수 없으므로 여기 따로 두고 catOf가 b.shard를 보고 고른다.
  shardAmmo: { icon: '➤', color: '#bef264' },
}
export const CATEGORY = Object.fromEntries(Object.entries(CAT_STYLE).map(([k, v]) => [k, {
  ...v, key: k,
  get label() { return t(`cat.${k}`) },
  get mech() { return t(`cat.${k}.mech`) },
}]))
export const HOSTILE = { icon: '☠', color: '#ff5c6a', get label() { return t('cat.hostile') } }
// 투석기도 반드시 부숴야 하지만 요새는 아니다. 표식이 둘로 갈려야
// "저기서 뭐가 날아오는가"를 화면만 보고 답할 수 있다 — 해골은 광선,
// 이 붉은 별표는 **날아오는 공**이다.
export const SIEGE_MARK = { icon: '✷', color: '#ff5a2b', get label() { return t('cat.siege') } }
export const hostileMark = (b) => b.role === 'siege' ? SIEGE_MARK : HOSTILE

export const categoryOf = (type) => CATEGORY[type] ?? CATEGORY.rock
// 천체 하나의 분류. 종류만으로는 못 가르는 자리가 하나 있다 — 잔해와 산탄은
// 둘 다 debris지만 판에서 하는 일이 다르다(하나는 배경, 하나는 날아가는 탄).
export const catOf = (b) => (b && b.shard ? CATEGORY.shardAmmo : categoryOf(b && b.type))

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
  static isHostile(b) { return b.role === 'battery' || b.role === 'siege' }

  update(game, rig, dt, renderRadius) {
    this.t += dt
    // 판이 열리는 순간과 예고편 도입부에는 배지도 해골도 없다 — 성계만 보인다.
    if (game.bare) {
      for (const e of this.sprites.values()) { e.cat.visible = false; if (e.hostile) e.hostile.visible = false }
      return
    }
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
        const m = hostileMark(b)
        e.hostile = this.makeSprite(this.texFor(`h:${m.icon}`, m.icon, m.color, m.color, 'rgba(24,4,30,.92)'), 23)
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
