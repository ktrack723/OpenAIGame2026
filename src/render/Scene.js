import * as THREE from 'three'
import { CFG, VIS } from '../game/config.js'
import { CameraRig } from './CameraRig.js'
import { Particles } from './Particles.js'
import { Markers } from './Markers.js'

// 바이옴별 재질 — 색은 이전과 동일, 거칠기/발광만 3D용으로 추가
const MATS = {
  rock: { c: 0x9aa1a8, rough: 0.95, metal: 0.05, emis: 0.00 },
  lava: { c: 0xff6b35, rough: 0.60, metal: 0.10, emis: 0.55 },
  ice: { c: 0x8be9ff, rough: 0.25, metal: 0.05, emis: 0.06 },
  ocean: { c: 0x2f8fff, rough: 0.30, metal: 0.10, emis: 0.05 },
  gas: { c: 0xffd166, rough: 0.85, metal: 0.00, emis: 0.08 },
  toxic: { c: 0x9bff6a, rough: 0.80, metal: 0.05, emis: 0.16 },
  life: { c: 0x38d878, rough: 0.70, metal: 0.05, emis: 0.10 },
  iron: { c: 0xcbd5e1, rough: 0.35, metal: 0.85, emis: 0.00 },
  earth: { c: 0x3b82f6, rough: 0.55, metal: 0.10, emis: 0.08 },
  debris: { c: 0x8b8f96, rough: 1.00, metal: 0.10, emis: 0.00 },
}
const colorOf = (t) => (MATS[t] ?? MATS.rock).c

// 절차적 표면 텍스처 — 자산 0개로 "돌아가는 구체"를 만들기 위한 최소 노이즈
function surfaceTexture(type) {
  const base = new THREE.Color(colorOf(type))
  const c = document.createElement('canvas'); c.width = 256; c.height = 128
  const g = c.getContext('2d')
  g.fillStyle = `#${base.getHexString()}`; g.fillRect(0, 0, 256, 128)
  let s = 0
  for (const ch of type) s = (s * 31 + ch.charCodeAt(0)) >>> 0
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
  if (type === 'gas') {
    for (let y = 0; y < 128; y += 6) {   // 가스행성 = 가로 띠
      const shade = new THREE.Color(colorOf(type))
      shade.offsetHSL(0, 0, (rnd() - 0.5) * 0.3)
      g.globalAlpha = 0.5; g.fillStyle = `#${shade.getHexString()}`
      g.fillRect(0, y, 256, 3 + rnd() * 4)
    }
  } else {
    for (let i = 0; i < 90; i++) {
      const shade = new THREE.Color(colorOf(type))
      shade.offsetHSL((rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.34)
      g.globalAlpha = 0.16 + rnd() * 0.4
      g.fillStyle = `#${shade.getHexString()}`
      g.beginPath()
      g.ellipse(rnd() * 256, rnd() * 128, 4 + rnd() * 26, 3 + rnd() * 16, rnd() * 3.14, 0, 6.29)
      g.fill()
    }
  }
  g.globalAlpha = 1
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  return tex
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.28, 'rgba(255,220,150,.55)')
  grd.addColorStop(1, 'rgba(255,180,80,0)')
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class SceneView {
  constructor(el, game) {
    this.el = el; this.game = game
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x03060f)
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1))
    this.renderer.setSize(innerWidth, innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    el.appendChild(this.renderer.domElement)

    this.rig = new CameraRig(game, this.renderer.domElement)
    this.camera = this.rig.camera

    // 조명: 태양이 실제 광원 → 행성마다 초승달 명암이 생겨 구체로 읽힌다
    this.scene.add(new THREE.AmbientLight(0x8fb4ff, 0.34))
    this.sunLight = new THREE.PointLight(0xffe6b0, 3.2, 0, 0)
    this.sunLight.position.set(0, 0, 0)
    this.scene.add(this.sunLight)
    this.scene.add(new THREE.HemisphereLight(0x3b4a7a, 0x05070f, 0.35))

    this.sphereGeo = new THREE.SphereGeometry(1, 40, 28)
    this.discGeo = new THREE.CircleGeometry(1, 64)
    this.ringGeo = new THREE.RingGeometry(0.9, 1, 64)
    this.thinRingGeo = new THREE.RingGeometry(0.965, 1, 48)
    this.glowTex = glowTexture()
    this.texCache = new Map()

    this.buildStars()
    this.buildSun()

    this.parts = new Particles(this.scene)
    this.markers = new Markers(this.scene)

    this.bodyFx = new Map()   // b.id → { mesh, halo, ring, trueRing }
    this.missileFx = new Map()
    this.lines = []
    this.lastBodies = null
    this.lastT = performance.now()

    addEventListener('resize', () => this.resize())
    this.resize()
  }

  // ── 화면 최소 크기 바닥값 ────────────────────────────────────
  // 판정 반경(R_p = 1.6·μ^(1/3), §4.1)은 그대로 두고 화면 최소 지름만 보장한다.
  // 줌인할수록 부풀림 배율이 1로 수렴 → 가까이 가면 실제 크기 그대로 보인다.
  renderRadius(b) {
    const minPx = b.type === 'debris' ? VIS.MIN_DEBRIS_PX : VIS.MIN_PLANET_PX
    const minWorld = minPx * 0.5 * this.rig.worldPerPx
    return Math.min(b.radius * VIS.MAX_INFLATE, Math.max(b.radius, minWorld))
  }

  buildStars() {
    const n = 900, pos = new Float32Array(n * 3), col = new Float32Array(n * 3)
    const c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 2600 + Math.random() * 5200
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(a) * r
      pos[i * 3 + 2] = -1800 - Math.random() * 2600
      c.setHSL(0.55 + Math.random() * 0.12, 0.35, 0.55 + Math.random() * 0.4)
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 26, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false,
    }))
    stars.frustumCulled = false
    this.scene.add(stars)
  }

  buildSun() {
    const sun = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({ color: 0xffc861 }))
    sun.scale.setScalar(CFG.R_STAR)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0.5,
    }))
    glow.scale.setScalar(CFG.R_STAR * 3.4)
    glow.position.z = -1
    glow.renderOrder = 1
    this.scene.add(sun, glow)
    this.sunMesh = sun; this.sunGlow = glow
  }

  resize() {
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1))
    this.renderer.setSize(innerWidth, innerHeight)
    this.rig.update(0)
  }

  render() {
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.lastT) / 1000); this.lastT = now
    if (this.lastBodies !== this.game.bodies) this.resetStage()
    this.rig.update(dt)
    this.drainFx()
    this.syncBodies(dt)
    this.syncMissiles()
    this.syncLines()
    this.markers.update(this.game, this.rig, dt, (b) => this.renderRadius(b))
    const uScale = (innerHeight * this.renderer.getPixelRatio()) / (2 * Math.tan(VIS.FOV * Math.PI / 360))
    this.parts.update(dt, uScale)
    this.renderer.render(this.scene, this.camera)
  }

  resetStage() {
    for (const fx of this.bodyFx.values()) this.disposeBodyFx(fx)
    this.bodyFx.clear()
    for (const fx of this.missileFx.values()) {
      this.scene.remove(fx.mesh, fx.glow)
      fx.mesh.material.dispose(); fx.glow.material.dispose()
    }
    this.missileFx.clear()
    this.lastBodies = this.game.bodies
    this.rig.snapToAuto()
  }

  disposeBodyFx(fx) {
    for (const o of [fx.mesh, fx.halo, fx.ring, fx.trueRing]) {
      this.scene.remove(o); o.material.dispose()
    }
  }

  texFor(type) {
    if (!this.texCache.has(type)) this.texCache.set(type, surfaceTexture(type))
    return this.texCache.get(type)
  }

  makeBodyFx(b) {
    const spec = MATS[b.type] ?? MATS.rock
    const mesh = new THREE.Mesh(this.sphereGeo, new THREE.MeshStandardMaterial({
      map: this.texFor(b.type), color: 0xffffff,
      roughness: spec.rough, metalness: spec.metal,
      emissive: new THREE.Color(spec.c), emissiveIntensity: spec.emis,
    }))
    mesh.rotation.x = Math.PI / 2 - 0.35   // 극축을 살짝 눕혀 탑다운에서도 자전이 보이게
    // 중력권 헤일로 — §5.2 스윙바이 존 6R_p (SOI 확대율 κ^(2/5)≈5.1× 가 근거).
    // 행성의 "당구 쿠션 범위"를 그대로 그린 것이라 판정과 1:1로 일치한다.
    const halo = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({
      color: spec.c, transparent: true, opacity: 0.07, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }))
    halo.renderOrder = 2
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    }))
    ring.renderOrder = 12
    const trueRing = new THREE.Mesh(this.thinRingGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    }))
    trueRing.renderOrder = 13
    this.scene.add(mesh, halo, ring, trueRing)
    const fx = { mesh, halo, ring, trueRing, type: b.type, spin: 0.15 + Math.random() * 0.5 }
    this.bodyFx.set(b.id, fx)
    return fx
  }

  syncBodies(dt) {
    const g = this.game
    for (const b of g.bodies) {
      let fx = this.bodyFx.get(b.id)
      if (!fx) fx = this.makeBodyFx(b)
      if (fx.type !== b.type) {   // 합성으로 바이옴이 바뀜 → 재질 교체
        const spec = MATS[b.type] ?? MATS.rock
        const mat = fx.mesh.material
        mat.map = this.texFor(b.type)
        mat.roughness = spec.rough; mat.metalness = spec.metal
        mat.emissive.set(spec.c); mat.emissiveIntensity = spec.emis
        mat.needsUpdate = true
        fx.halo.material.color.set(spec.c)
        fx.type = b.type
      }
      const r = this.renderRadius(b)
      const solid = b.type !== 'debris'
      fx.mesh.visible = b.alive
      fx.halo.visible = b.alive && solid
      fx.ring.visible = b.alive && solid
      fx.trueRing.visible = b.alive && solid && r > b.radius * VIS.TRUE_R_HINT
      if (!b.alive) continue

      fx.mesh.position.set(b.pos.x, b.pos.y, 0)
      fx.mesh.scale.setScalar(r)
      fx.mesh.rotation.y += fx.spin * dt

      // 텍스처 데미지 4단계 + 히트 플래시 (§14.5)
      const c = fx.mesh.material.color
      if (b.hitFlash > 0) c.setRGB(2.4, 2.4, 2.4)
      else { const k = 1 - Math.min(3, b.textureState || 0) * 0.17; c.setRGB(k, k, k) }

      fx.halo.position.set(b.pos.x, b.pos.y, -3)
      fx.halo.scale.setScalar(b.radius * CFG.SWING_ZONE)

      fx.ring.position.set(b.pos.x, b.pos.y, 0)
      fx.ring.scale.setScalar(r * 1.22)
      // R6 대응: LEGAL_HIT 아닌 행성은 상시 붉은 외곽선. 목표=시안, 지구=파랑
      if (b === g.target) { fx.ring.material.color.setHex(0x22d3ee); fx.ring.material.opacity = 0.95 }
      else if (b.isEarth) { fx.ring.material.color.setHex(0x60a5fa); fx.ring.material.opacity = 0.85 }
      else { fx.ring.material.color.setHex(0xef4444); fx.ring.material.opacity = 0.45 }

      if (fx.trueRing.visible) {   // 부풀린 상태에서는 실제 판정 반경을 얇게 병기
        fx.trueRing.position.set(b.pos.x, b.pos.y, 0.2)
        fx.trueRing.scale.setScalar(b.radius)
      }
    }
  }

  syncMissiles() {
    for (const m of this.game.missiles) {
      let fx = this.missileFx.get(m)
      if (!fx) {
        const mesh = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({ color: 0xfff4d6 }))
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.glowTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0.85,
        }))
        glow.renderOrder = 5
        this.scene.add(mesh, glow)
        fx = { mesh, glow, lx: m.pos.x, ly: m.pos.y }
        this.missileFx.set(m, fx)
      }
      if (!m.alive) { fx.mesh.visible = false; fx.glow.visible = false; continue }
      const r = Math.max(2.5, 5 * this.rig.worldPerPx)
      fx.mesh.visible = true; fx.glow.visible = true
      fx.mesh.position.set(m.pos.x, m.pos.y, r)
      fx.mesh.scale.setScalar(r)
      fx.glow.position.set(m.pos.x, m.pos.y, r)
      fx.glow.scale.setScalar(r * 5)
      const v = Math.hypot(m.vel.x, m.vel.y) || 1
      const travelled = Math.hypot(m.pos.x - fx.lx, m.pos.y - fx.ly)
      this.parts.thrust(fx.lx, fx.ly, m.pos.x, m.pos.y, -m.vel.x / v, -m.vel.y / v,
        Math.min(16, 3 + travelled / Math.max(1, 3 * this.rig.worldPerPx)))
      fx.lx = m.pos.x; fx.ly = m.pos.y
    }
  }

  // 게임 로직이 쌓아둔 연출 이벤트를 소비 (§14.5)
  drainFx() {
    const q = this.game.fx
    if (!q || !q.length) return
    for (const e of q) {
      if (e.kind === 'launch') {
        this.parts.burst(e.x, e.y, { n: 40, color: 0xbfdbfe, speed: 90, size: 8, ttl: 0.5, spread: 1.4, dir: e.a })
        this.parts.shock(e.x, e.y, 26, 0x93c5fd, 0.4)
      } else if (e.kind === 'hit') {
        this.parts.burst(e.x, e.y, { n: 110, color: e.foul ? 0xef4444 : 0xffd166, speed: 190, size: 13, ttl: 1.0 })
        this.parts.burst(e.x, e.y, { n: 40, color: 0xffffff, speed: 300, size: 7, ttl: 0.45 })
        this.parts.shock(e.x, e.y, Math.max(20, e.r ?? 20), e.foul ? 0xf87171 : 0xfde68a, 0.5)
        this.rig.hit(e.foul ? 8 : 14)
      } else if (e.kind === 'kill') {
        this.parts.burst(e.x, e.y, { n: 220, color: e.color ?? 0xffb347, speed: 300, size: 18, ttl: 1.8 })
        this.parts.burst(e.x, e.y, { n: 90, color: 0xffffff, speed: 460, size: 9, ttl: 0.7 })
        this.parts.shock(e.x, e.y, Math.max(30, e.r ?? 30), 0xffffff, 0.8)
        this.rig.hit(VIS.SHAKE_MAX)
      } else if (e.kind === 'swing') {
        this.parts.shock(e.x, e.y, Math.max(24, (e.r ?? 10) * CFG.SWING_ZONE * 0.5), 0x67e8f9, 0.6)
        this.parts.burst(e.x, e.y, { n: 26, color: 0x67e8f9, speed: 110, size: 8, ttl: 0.7 })
      } else if (e.kind === 'sun') {
        this.parts.burst(e.x, e.y, { n: 120, color: 0xffa53b, speed: 220, size: 14, ttl: 1.2 })
        this.rig.hit(10)
      }
    }
    q.length = 0
  }

  syncLines() {
    for (const l of this.lines) { this.scene.remove(l); l.geometry.dispose(); l.material.dispose() }
    this.lines = []
    const g = this.game
    const add = (pts, color, opacity = 0.55, dashed = false, z = -1) => {
      if (pts.length < 2) return
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, p.y, z)))
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 14, gapSize: 11, depthTest: false })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false })
      const line = new THREE.Line(geo, mat)
      if (dashed) line.computeLineDistances()
      line.renderOrder = 3
      this.lines.push(line); this.scene.add(line)
    }
    // 발사 회랑 — §7.5 차폐도 B를 재는 그 선. "목표가 어느 쪽인지"를 즉시 알려준다
    if (g.earth.alive && g.target.alive)
      add([g.earth.pos, g.target.pos], 0x22d3ee, 0.22, true, -4)
    // 궤도 트레일 — 플레이어 임펄스 직후 강조 (P4, §14.2)
    for (const b of g.bodies) if (b.trail) {
      const hot = b.trailFlash > 0
      add(b.trail, hot ? 0xffffff : colorOf(b.type), hot ? 0.95 : 0.32)
    }
    // 미사일 궤적 — 빗나간 샷은 회색 점선으로 스테이지 끝까지 남긴다 (§14.4)
    for (const m of g.missiles) add(m.path, m.alive ? 0xffffff : 0x64748b, m.alive ? 0.9 : 0.4, !m.alive)
    // 조준선 + 예측선 3초 (§5.1)
    if (g.canAim) {
      const p = g.launchPos()
      add([p, { x: p.x + Math.cos(g.aim) * (50 + g.power), y: p.y + Math.sin(g.aim) * (50 + g.power) }], 0x22d3ee, 0.95)
      add(g.predict(), 0x67e8f9, 0.75, true)
    }
  }
}
