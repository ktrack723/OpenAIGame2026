import * as THREE from 'three'
import { CFG, VIS, hitRadiusOf } from '../game/config.js'
import { makeArrow, setArrow } from './Arrow.js'
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

    // 발사대 마커 — 미사일이 지구가 아니라 여기서 나간다는 걸 못 박는다
    this.pad = new THREE.Mesh(new THREE.RingGeometry(0.62, 1, 24), new THREE.MeshBasicMaterial({
      color: 0x22d3ee, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }))
    this.pad.renderOrder = 14
    this.scene.add(this.pad)

    // ── 1차 충돌 하이라이트 ────────────────────────────────────
    // "텍스트를 읽어야 어디 박는지 안다"를 없애는 게 목적. 맞는 순간 그 공이
    // 있을 자리에 락온 브래킷 + 채운 디스크 + 맞는 쪽 반달을 겹쳐 찍는다.
    // 2차·3차 충돌은 일부러 예측하지 않는다 — 그건 플레이어가 읽을 몫이다.
    this.lockDisc = new THREE.Mesh(this.discGeo, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.2, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
    this.lockDisc.renderOrder = 12
    this.lockRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.06, 72), new THREE.MeshBasicMaterial({
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }))
    this.lockRing.renderOrder = 16
    // 맞는 쪽 반달 — 공의 어느 살을 치는지가 곧 밀리는 방향이라 이게 핵심 정보다
    this.lockHemi = new THREE.Mesh(new THREE.RingGeometry(0.98, 1.30, 48, 1, -0.62, 1.24), new THREE.MeshBasicMaterial({
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }))
    this.lockHemi.renderOrder = 16
    this.lockBrackets = new THREE.Group()   // 회전하는 락온 브래킷 4개
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(1.26, 1.54, 20, 1, i * Math.PI / 2 + 0.30, Math.PI / 2 - 0.60),
        new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }))
      m.renderOrder = 16
      this.lockBrackets.add(m)
    }
    this.scene.add(this.lockDisc, this.lockRing, this.lockHemi, this.lockBrackets)
    this.lockT = 0

    // 조준 보조 — 임펄스 방향(노랑) / 타격 직후 공의 진로(흰색) / 폭풍 반경(주황 링)
    this.pushArrow = makeArrow(0xfbbf24, 0.95)
    this.courseArrow = makeArrow(0xffffff, 0.9)
    this.blastRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96), new THREE.MeshBasicMaterial({
      color: 0xf59e0b, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }))
    this.blastRing.renderOrder = 11
    this.blastRing.visible = false
    this.scene.add(this.pushArrow, this.courseArrow, this.blastRing)

    // 전면 섬광 — 핵을 "과장"하는 가장 싼 수단. 폭발 프레임에 화면 전체가 탄다
    this.flashEl = document.createElement('div')
    this.flashEl.className = 'nukeflash'
    document.body.appendChild(this.flashEl)
    this.flashV = 0

    this.bodyFx = new Map()   // b.id → { mesh, halo, ring, trueRing }
    this.missileFx = new Map()
    this.lines = []
    this.lastBodies = null
    this.lastT = performance.now()

    addEventListener('resize', () => this.resize())
    this.resize()
  }

  // ── 렌더 반경 = 명중 반경 ───────────────────────────────────
  // 기하 반지름(§4.1)은 물리용으로 그대로 두되, 화면에는 미사일 명중 반경
  // (b.radius × HIT_R)을 그린다 → "닿았는데 통과"가 원천적으로 사라진다.
  // 화면 최소 지름 바닥값은 줌아웃 시에만 작동하고, 그때는 얇은 링으로 실제 반경을 병기한다.
  renderRadius(b) {
    const hr = hitRadiusOf(b)   // 그리는 원 = 맞는 원
    const minPx = b.type === 'debris' ? VIS.MIN_DEBRIS_PX : VIS.MIN_PLANET_PX
    const minWorld = minPx * 0.5 * this.rig.worldPerPx
    return Math.min(hr * VIS.MAX_INFLATE, Math.max(hr, minWorld))
  }

  // 별 배경 — 성계 "바깥"에만 뿌리면 정작 판 위가 텅 빈다.
  // 원점을 포함한 원반 전체에 면적 균일로 깔고, 깊이를 3층으로 나눠 시차를 준다.
  buildStars() {
    const layers = [
      { n: 700, z: -2200, size: 20, op: 0.95 },
      { n: 700, z: -4200, size: 26, op: 0.75 },
      { n: 700, z: -7000, size: 34, op: 0.55 },
    ]
    const c = new THREE.Color()
    for (const L of layers) {
      const pos = new Float32Array(L.n * 3), col = new Float32Array(L.n * 3)
      for (let i = 0; i < L.n; i++) {
        // sqrt 샘플링 = 원반 면적 균일. 중심(성계 위)에도 별이 깔린다
        const a = Math.random() * Math.PI * 2
        const r = Math.sqrt(Math.random()) * 11000
        pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(a) * r
        pos[i * 3 + 2] = L.z - Math.random() * 600
        const bright = Math.random() < 0.08 ? 0.95 : 0.4 + Math.random() * 0.4
        c.setHSL(0.52 + Math.random() * 0.16, 0.3 + Math.random() * 0.4, bright)
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
      const stars = new THREE.Points(geo, new THREE.PointsMaterial({
        size: L.size, sizeAttenuation: true, vertexColors: true,
        transparent: true, opacity: L.op, depthWrite: false, depthTest: false,
      }))
      stars.frustumCulled = false
      stars.renderOrder = -10
      this.scene.add(stars)
    }
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
    this.lockT += dt
    if (this.lastBodies !== this.game.bodies) this.resetStage()
    this.rig.update(dt)
    this.drainFx()
    this.syncBodies(dt)
    this.syncMissiles()
    this.syncLines()
    this.markers.update(this.game, this.rig, dt, (b) => this.renderRadius(b))
    this.pad.visible = this.game.canAim
    if (this.pad.visible) {
      const p = this.game.launchPos()
      this.pad.position.set(p.x, p.y, 4)
      this.pad.scale.setScalar(Math.max(6, 11 * this.rig.worldPerPx))
    }
    const uScale = (innerHeight * this.renderer.getPixelRatio()) / (2 * Math.tan(VIS.FOV * Math.PI / 360))
    this.parts.update(dt, uScale)
    // 섬광 감쇠 — 터진 프레임에 확 붙었다가 0.35초 안에 빠진다
    if (this.flashV > 0) {
      this.flashV = Math.max(0, this.flashV - dt * 3.2)
      this.flashEl.style.opacity = (this.flashV * this.flashV).toFixed(3)
    } else if (this.flashEl.style.opacity !== '0') this.flashEl.style.opacity = '0'
    this.renderer.render(this.scene, this.camera)
  }

  flash(v, color) {
    if (color) this.flashEl.style.background = color
    this.flashV = Math.min(1, this.flashV + v)
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
    // 조준 중이면 "지금 화면의 어느 공을 치는가"도 같이 켠다 —
    // 락온은 미래 위치에 찍히므로, 현재 위치의 그 공도 물어 줘야 눈이 이어진다.
    const aimHit = g.canAim ? g.predictPath().hit : null
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
      fx.trueRing.visible = b.alive && solid && r > hitRadiusOf(b) * VIS.TRUE_R_HINT
      if (!b.alive) continue

      fx.mesh.position.set(b.pos.x, b.pos.y, 0)
      fx.mesh.scale.setScalar(r)
      fx.mesh.rotation.y += fx.spin * dt

      // 핵을 맞을 때마다 그을음이 남는다(부서지진 않는다) + 히트 플래시 (§14.5)
      const c = fx.mesh.material.color
      if (b.hitFlash > 0) c.setRGB(2.4, 2.4, 2.4)
      else { const k = 1 - Math.min(3, b.scorch || 0) * 0.15; c.setRGB(k, k, k) }

      fx.halo.position.set(b.pos.x, b.pos.y, -3)
      fx.halo.scale.setScalar(b.radius * CFG.SWING_ZONE)

      fx.ring.position.set(b.pos.x, b.pos.y, 0)
      fx.ring.scale.setScalar(r * 1.22)
      // 목표=시안, 지구=파랑(치면 즉사), 중립=흰색(자유롭게 쓰는 큐볼).
      // 캐롬 스테이지의 목표는 보라색 — "직격이 안 통하는 공"이라는 뜻이다.
      if (b.isEarth) { fx.ring.material.color.setHex(0x60a5fa); fx.ring.material.opacity = 0.9 }
      else if (b.isTarget) {
        const shielded = g.goal.shielded
        fx.ring.material.color.setHex(shielded ? 0xa78bfa : 0x22d3ee)
        fx.ring.material.opacity = 0.7 + 0.25 * Math.abs(Math.sin(performance.now() / 320))
      } else { fx.ring.material.color.setHex(0xe2e8f0); fx.ring.material.opacity = 0.34 }
      if (aimHit && aimHit.id === b.id) {   // 이번 샷이 건드릴 공 — 예측선 색으로 물어 준다
        fx.ring.material.color.setHex(PRED_TONE[aimHit.outcome] ?? 0x67e8f9)
        fx.ring.material.opacity = 1
        fx.ring.scale.setScalar(r * (1.30 + 0.06 * Math.sin(this.lockT * 5)))
      }

      if (fx.trueRing.visible) {   // 줌아웃으로 부풀었을 때만 실제 명중 반경을 얇게 병기
        fx.trueRing.position.set(b.pos.x, b.pos.y, 0.2)
        fx.trueRing.scale.setScalar(hitRadiusOf(b))
      }
    }
  }

  syncMissiles() {
    for (const m of this.game.missiles) {
      let fx = this.missileFx.get(m)
      if (!fx) {
        // 미사일은 커서다 — 행성 뒤로 숨으면 안 되므로 깊이 테스트를 끄고 항상 위에 그린다.
        // (깊이를 쓰지 않으니 트레일을 가리지도 않는다.)
        const mesh = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({
          color: 0xfff4d6, transparent: true, depthTest: false, depthWrite: false,
        }))
        mesh.renderOrder = 9
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
      } else if (e.kind === 'nuke') this.nukeFx(e)
      else if (e.kind === 'destroy') this.destroyFx(e)
      else if (e.kind === 'swing') {
        this.parts.shock(e.x, e.y, Math.max(24, (e.r ?? 10) * CFG.SWING_ZONE * 0.5), 0x67e8f9, 0.6)
        this.parts.burst(e.x, e.y, { n: 26, color: 0x67e8f9, speed: 110, size: 8, ttl: 0.7 })
      } else if (e.kind === 'exile') {
        this.parts.puff(e.x, e.y, { r0: 6, r1: 90, ttl: 1.2, color: 0x94a3b8, alpha: 0.8 })
        this.parts.shock(e.x, e.y, 70, 0xcbd5e1, 0.9, { thin: true, to: 2.2 })
        this.parts.burst(e.x, e.y, { n: 70, color: 0xcbd5e1, speed: 180, size: 12, ttl: 1.2 })
        this.rig.hit(8)
      } else if (e.kind === 'sun') {
        this.parts.burst(e.x, e.y, { n: 160, color: 0xffa53b, speed: 260, size: 16, ttl: 1.4 })
        this.parts.puff(e.x, e.y, { r0: 8, r1: 130, ttl: 1.0, color: 0xffb247 })
        this.parts.shock(e.x, e.y, 90, 0xfdba74, 0.9)
        this.rig.hit(16)
      }
    }
    q.length = 0
  }

  // ─── 핵 기폭 (§14.5 개정) ────────────────────────────────────
  // 순서가 전부다: 흰 섬광 → 창살 → 화구 팽창 → 이중 충격파 → 잔불 →
  // 늦게 퍼지는 폭풍 링. 작약량이 이 모든 것의 스케일을 한꺼번에 끌어올린다.
  nukeFx(e) {
    const yld = e.yld ?? CFG.YIELD_DEFAULT
    const k = yld / CFG.YIELD_MAX                    // 0~1 정규화 작약량
    const base = Math.max(26, (e.r ?? 20) * 1.4)     // 표적 크기에 비례한 최소 부피
    const R = base * (0.75 + 1.9 * k)
    const P = this.parts

    if (e.shield) {   // 방어막에 삼켜짐 — 소리만 요란하고 아무 일도 안 난다
      P.puff(e.x, e.y, { r0: 3, r1: R * 0.55, ttl: 0.45, color: 0x67e8f9, alpha: 0.85 })
      P.shock(e.x, e.y, R, 0x22d3ee, 0.55, { thin: true, to: 1.6 })
      P.burst(e.x, e.y, { n: 40, color: 0x67e8f9, speed: 150, size: 8, ttl: 0.5 })
      this.rig.hit(6)
      this.flash(0.12, '#a5f3fc')
      return
    }

    // ① 흰 섬광 — 프레임 하나를 통째로 태운다
    P.puff(e.x, e.y, { r0: R * 0.25, r1: R * 0.9, ttl: 0.16, color: 0xffffff, alpha: 1 })
    this.flash(e.earth ? 1 : 0.25 + 0.55 * k, e.earth ? '#fff5f5' : '#fff8e6')

    // ② 방사 창살 — 폭발이 "찌르고" 나가는 실루엣
    P.spikes(e.x, e.y, { n: 12 + Math.round(14 * k), color: 0xfff3cd, speed: 480 + 900 * k, size: 5 + 6 * k, ttl: 0.35 + 0.3 * k })

    // ③ 화구 — 세 겹이 시차를 두고 부풀며 식는다 (흰 코어 → 주황 → 붉은 연기)
    P.puff(e.x, e.y, { r0: R * 0.12, r1: R * 1.05, ttl: 0.55 + 0.5 * k, color: 0xfff1c4, alpha: 1 })
    P.puff(e.x, e.y, { r0: R * 0.10, r1: R * 1.65, ttl: 0.9 + 0.8 * k, color: 0xff9a3c, alpha: 0.85, delay: 0.05 })
    P.puff(e.x, e.y, { r0: R * 0.20, r1: R * 2.3, ttl: 1.5 + 1.0 * k, color: 0x8f3b1b, alpha: 0.5, delay: 0.14, drift: 12 })

    // ④ 이중 충격파 — 얇은 링이 먼저 튀고, 두꺼운 링이 뒤따른다
    P.shock(e.x, e.y, R, 0xffffff, 0.42, { thin: true, from: 0.1, to: 3.1, alpha: 1 })
    P.shock(e.x, e.y, R, 0xffc879, 0.85 + 0.5 * k, { from: 0.15, to: 2.4, delay: 0.06 })

    // ⑤ 파편·잔불 — 오래 남아 "여기서 뭔가 터졌다"를 유지한다
    P.burst(e.x, e.y, { n: 90 + Math.round(160 * k), color: 0xffc14d, speed: 230 + 320 * k, size: 12 + 8 * k, ttl: 1.1 + 0.8 * k })
    P.burst(e.x, e.y, { n: 50, color: 0xffffff, speed: 420 + 500 * k, size: 7, ttl: 0.5 })
    P.burst(e.x, e.y, { n: 40, color: 0xff5a2b, speed: 90, size: 15 + 10 * k, ttl: 2.2 + 1.4 * k, drag: 0.5 })

    // ⑥ 폭풍 링 — 실제로 주변 천체를 미는 반경 그대로. 보이는 것 = 미는 것
    if (e.wave) P.shock(e.x, e.y, e.wave, 0xfb923c, 0.85, { thin: true, from: 0.05, to: 1.0, alpha: 0.55, delay: 0.02 })

    // ⑦ 임펄스 방향으로 뿜어나가는 분사 — 어느 쪽으로 밀었는지 눈으로 확인시킨다
    if (e.px !== undefined) {
      const a = Math.atan2(e.py, e.px)
      P.burst(e.x, e.y, { n: 60, color: 0xffe9a8, speed: 340 + 380 * k, size: 10, ttl: 0.75, spread: 1.1, dir: a })
    }
    this.rig.hit(Math.min(VIS.SHAKE_MAX, (e.earth ? VIS.SHAKE_MAX : 12 + 30 * k)))
  }

  // ─── 행성 폭파 — 핵으로는 절대 볼 수 없는 그림 ───────────────
  destroyFx(e) {
    const R = Math.max(40, (e.r ?? 30) * 2.2)
    const P = this.parts
    this.flash(e.earth ? 1 : 0.55, e.earth ? '#ffe4e6' : '#fff1d6')
    P.puff(e.x, e.y, { r0: R * 0.3, r1: R * 1.2, ttl: 0.22, color: 0xffffff, alpha: 1 })
    P.puff(e.x, e.y, { r0: R * 0.15, r1: R * 2.2, ttl: 1.3, color: e.earth ? 0x60a5fa : 0xffb347, alpha: 0.95, delay: 0.04 })
    P.puff(e.x, e.y, { r0: R * 0.30, r1: R * 3.4, ttl: 2.6, color: 0x7c2d12, alpha: 0.55, delay: 0.16, drift: 16 })
    P.spikes(e.x, e.y, { n: 26, color: 0xffffff, speed: 1300, size: 9, ttl: 0.6 })
    P.shock(e.x, e.y, R, 0xffffff, 0.5, { thin: true, from: 0.08, to: 4.2, alpha: 1 })
    P.shock(e.x, e.y, R, 0xfde68a, 1.1, { from: 0.12, to: 3.0, delay: 0.08 })
    P.shock(e.x, e.y, R, 0xf97316, 1.6, { thin: true, from: 0.1, to: 5.5, delay: 0.2, alpha: 0.5 })
    P.burst(e.x, e.y, { n: 340, color: e.earth ? 0x93c5fd : 0xffb347, speed: 460, size: 20, ttl: 2.4 })
    P.burst(e.x, e.y, { n: 120, color: 0xffffff, speed: 900, size: 10, ttl: 0.8 })
    P.burst(e.x, e.y, { n: 90, color: 0xff4d2b, speed: 120, size: 22, ttl: 3.4, drag: 0.45 })
    this.rig.hit(VIS.SHAKE_MAX)
    this.rig.focus(e.x, e.y, R * 2.5)   // 화면 밖에서 터져도 보이게 붙잡는다
  }

  // 리본 — THREE.Line의 굵기는 WebGL에서 1px로 고정이라 트레일이 실오라기가 된다.
  // 폭을 가진 삼각형 띠를 직접 만들어 화면상 두께를 확보한다(줌에 따라 같이 커짐).
  // depth:true 를 주면 깊이 테스트를 켜서 **행성 뒤로 지나간다**. 트레일이 공을
  // 덮어 버리면 어느 공이 무슨 색인지 안 보여서, 궤적류는 전부 이쪽을 쓴다.
  // (조준 보조선만 UI 레이어로 항상 위에 그린다.)
  ribbon(pts, widthPx, color, { fade = true, opacity = 1, z = -1, tailWidth = 0.25, depth = false } = {}) {
    const n = pts.length
    if (n < 2) return
    const w = widthPx * this.rig.worldPerPx * 0.5
    const pos = new Float32Array(n * 6), col = new Float32Array(n * 6)
    const c = new THREE.Color(color)
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]
      let tx = b.x - a.x, ty = b.y - a.y
      const l = Math.hypot(tx, ty) || 1
      tx /= l; ty /= l
      const u = n > 1 ? i / (n - 1) : 1            // 0 = 꼬리(오래됨), 1 = 머리(최신)
      const ww = w * (tailWidth + (1 - tailWidth) * u)
      const nx = -ty * ww, ny = tx * ww
      pos[i * 6] = p.x + nx; pos[i * 6 + 1] = p.y + ny; pos[i * 6 + 2] = z
      pos[i * 6 + 3] = p.x - nx; pos[i * 6 + 4] = p.y - ny; pos[i * 6 + 5] = z
      // 가산 합성이라 색을 검게 죽이면 그대로 페이드가 된다
      const k = (fade ? u * u : 1) * opacity
      for (const o of [0, 3]) {
        col[i * 6 + o] = c.r * k; col[i * 6 + o + 1] = c.g * k; col[i * 6 + o + 2] = c.b * k
      }
    }
    const idx = new Uint32Array((n - 1) * 6)
    for (let i = 0; i < n - 1; i++) {
      const o = i * 6, v = i * 2
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2
      idx[o + 3] = v + 1; idx[o + 4] = v + 3; idx[o + 5] = v + 2
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setIndex(new THREE.BufferAttribute(idx, 1))
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthTest: depth, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }))
    mesh.renderOrder = depth ? 3 : 10
    this.lines.push(mesh); this.scene.add(mesh)
  }

  syncLines() {
    for (const l of this.lines) { this.scene.remove(l); l.geometry.dispose(); l.material.dispose() }
    this.lines = []
    const g = this.game

    // 발사 회랑 — 지구에서 목표까지의 직선
    if (g.earth.alive && g.target.alive)
      this.ribbon([g.earth.pos, g.target.pos], 2, 0x22d3ee, { fade: false, opacity: 0.2, z: -5, tailWidth: 1, depth: true })

    // 궤도 트레일 — 플레이어 임펄스 직후 강조 (P4, §14.2). 공 뒤로 지나간다.
    for (const b of g.bodies) {
      if (!b.trail || b.trail.length < 2) continue
      const hot = b.trailFlash > 0
      this.ribbon(b.trail, hot ? 9 : 5.5, hot ? 0xffffff : colorOf(b.type), { opacity: hot ? 1 : 0.75, z: -2, depth: true })
    }

    // 미사일 궤적 — 빗나간 샷은 흐리게 스테이지 끝까지 남긴다 (§14.4)
    for (const m of g.missiles) {
      if (m.path.length < 2) continue
      this.ribbon(m.path, m.alive ? 7 : 4, m.alive ? 0xffffff : 0x7c8798, { opacity: m.alive ? 1 : 0.42, z: 1, depth: true })
    }

    // 조준선 + 큐 예측 (§14.3 개정)
    if (g.canAim) {
      const p = g.launchPos()
      this.ribbon([g.earth.pos, p], 2, 0x3b82f6, { fade: false, opacity: 0.35, z: -3, tailWidth: 1, depth: true })
      const pred = g.predictPath()
      if (pred.pts.length > 1) {
        this.ribbon(pred.pts, 4.5, PRED_TONE[pred.outcome] ?? 0x67e8f9, { fade: false, opacity: 0.85, z: 0, tailWidth: 1 })
        // 리드선 — "지금 저기 있는 저 공"과 "맞는 순간 여기 와 있을 자리"를 잇는다
        if (pred.hit) {
          const now = g.bodies.find(b => b.id === pred.hit.id)
          if (now && Math.hypot(now.pos.x - pred.hit.x, now.pos.y - pred.hit.y) > pred.hit.r * 0.4)
            this.ribbon([now.pos, { x: pred.hit.x, y: pred.hit.y }], 2, PRED_TONE[pred.outcome] ?? 0x67e8f9,
              { fade: false, opacity: 0.3, z: 0, tailWidth: 1 })
        }
        this.markPredEnd(pred)
      }
    } else this.hidePredEnd()
  }

  // ─── 큐 예측: "무슨 일이 날지"가 아니라 "어느 살을 치는지"만 ────
  // 폭심 · 임펄스 방향 · 타격 직후 공의 진로 · 폭풍 반경. 그 뒤 판이 어떻게
  // 굴러갈지는 일부러 안 보여준다 — 그게 이 게임의 문제다.
  markPredEnd(pred) {
    const tone = PRED_TONE[pred.outcome] ?? 0x67e8f9
    if (!this.predEnd) {
      this.predEnd = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, 28), new THREE.MeshBasicMaterial({
        transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      }))
      this.predEnd.renderOrder = 15
      this.scene.add(this.predEnd)
    }
    const end = pred.pts[pred.pts.length - 1]
    this.predEnd.visible = true
    this.predEnd.position.set(end.x, end.y, 5)
    this.predEnd.scale.setScalar(Math.max(7, 11 * this.rig.worldPerPx))
    this.predEnd.material.color.setHex(tone)
    this.predEnd.material.opacity = pred.outcome === 'timeout' ? 0.45 : 0.95

    // ── 1차 충돌 락온 ──────────────────────────────────────────
    const h = pred.hit
    const on = !!h
    this.lockDisc.visible = on; this.lockRing.visible = on
    this.lockHemi.visible = on; this.lockBrackets.visible = on
    if (h) {
      const pulse = 0.5 + 0.5 * Math.sin(this.lockT * 5)
      // 락온 크기는 그 공이 **화면에 그려지는 크기** 그대로여야 한다.
      // 판정 반경만 쓰면 줌아웃 시 락온이 공보다 작아져서 딴 걸 무는 것처럼 보인다.
      const body = this.game.bodies.find(b => b.id === h.id)
      const R = body ? this.renderRadius(body) : h.r
      for (const o of [this.lockDisc, this.lockRing, this.lockHemi, this.lockBrackets]) o.material?.color.setHex(tone)
      this.lockDisc.position.set(h.x, h.y, 4)
      this.lockDisc.scale.setScalar(R)
      this.lockDisc.material.opacity = 0.14 + 0.10 * pulse
      this.lockRing.position.set(h.x, h.y, 5)
      this.lockRing.scale.setScalar(R)
      this.lockRing.material.opacity = 0.75 + 0.25 * pulse
      // 반달은 폭심 쪽(= 중심에서 폭심으로 향하는 각)에 붙인다
      this.lockHemi.position.set(h.x, h.y, 5)
      this.lockHemi.scale.setScalar(R)
      this.lockHemi.rotation.z = Math.atan2(-h.dy, -h.dx)
      this.lockHemi.material.opacity = 0.55 + 0.35 * pulse
      // 브래킷은 락온이 "물었다"는 신호 — 천천히 돌면서 숨을 쉰다
      this.lockBrackets.position.set(h.x, h.y, 5)
      this.lockBrackets.scale.setScalar(R * (1 + 0.06 * pulse))
      this.lockBrackets.rotation.z = -this.lockT * 0.8
      for (const m of this.lockBrackets.children) {
        m.material.color.setHex(tone)
        m.material.opacity = 0.6 + 0.4 * pulse
      }
    }

    const ppw = this.rig.worldPerPx
    const push = h && h.dv > 0
    this.pushArrow.visible = !!push
    this.courseArrow.visible = !!push
    this.blastRing.visible = !!h
    if (h) {
      this.blastRing.position.set(h.px, h.py, 2)
      this.blastRing.scale.setScalar(h.blast)
      this.blastRing.material.opacity = h.outcome === 'earth' ? 0.6 : 0.3
      this.blastRing.material.color.setHex(h.outcome === 'earth' ? 0xf87171 : 0xf59e0b)
    }
    if (push) {
      const R = this.lockRing.scale.x   // 락온과 같은 반경 위에서 화살표를 시작한다
      // 임펄스(노랑): 폭심에서 공의 중심을 뚫고 나가는 방향 — 길이 ∝ Δv
      const len = Math.max(22 * ppw, R * 0.9 + h.dv * 2.5)
      setArrow(this.pushArrow, h.px, h.py, Math.atan2(h.dy, h.dx), len, Math.max(3 * ppw, len * 0.07), 6)
      // 진로(흰색): 원래 궤도 속도 + 임펄스 = 공이 실제로 출발하는 방향.
      // 공의 가장자리에서 뻗어 나가게 해서 "이 공이 저리로 간다"로 읽히게 한다.
      const sp = Math.hypot(h.vx, h.vy) || 1
      const ca = Math.atan2(h.vy, h.vx)
      const cl = Math.max(60 * ppw, sp * 3)
      setArrow(this.courseArrow, h.x + Math.cos(ca) * R, h.y + Math.sin(ca) * R, ca,
        cl, Math.max(3.5 * ppw, cl * 0.07), 7)
    }
  }

  hidePredEnd() {
    if (this.predEnd) this.predEnd.visible = false
    this.lockDisc.visible = false; this.lockRing.visible = false
    this.lockHemi.visible = false; this.lockBrackets.visible = false
    this.pushArrow.visible = false
    this.courseArrow.visible = false
    this.blastRing.visible = false
  }
}

// 경로 색 = 무엇에 닿는가 (결과가 아니라 접촉 대상)
const PRED_TONE = {
  target: 0x4ade80, neutral: 0xe2e8f0, shield: 0xa78bfa, earth: 0xf87171,
  debris: 0x94a3b8, sun: 0xfb923c, lost: 0x94a3b8, timeout: 0x67e8f9,
}
