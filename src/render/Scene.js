import * as THREE from 'three'
import { CFG, VIS, hitRadiusOf } from '../game/config.js'
import { ROLES, hasRole, volatileRadius } from '../game/roles.js'
import { CameraRig } from './CameraRig.js'
import { Particles } from './Particles.js'
import { Markers } from './Markers.js'
import { Explosions } from './Explosions.js'
import { AimHelper, PRED_TONE } from './AimHelper.js'
import { Orbits } from './Orbits.js'
import { LaserView } from './LaserView.js'
import { Belt } from './Belt.js'
import { Icons } from './Icons.js'

// 분류별 재질 — 분류가 다섯으로 줄었으므로 재질도 다섯이다.
// (용암·해양·독성·생명은 게임 규칙이 없어 없앴다 — Icons.CATEGORY 주석 참고.)
// 색은 곧 규칙이다: 회색 암석 = 규칙 없음, 하늘색 얼음 = 가벼움,
// 흰 금속 = 무거움, 노란 가스 = 터짐, 검은 특이점 = 삼킴.
const MATS = {
  rock: { c: 0x9aa1a8, rough: 0.95, metal: 0.05, emis: 0.00 },
  ice: { c: 0x8be9ff, rough: 0.25, metal: 0.05, emis: 0.06 },
  iron: { c: 0xcbd5e1, rough: 0.30, metal: 0.95, emis: 0.00 },
  gas: { c: 0xffd166, rough: 0.85, metal: 0.00, emis: 0.08 },
  void: { c: 0x120a1e, rough: 1.00, metal: 0.00, emis: 0.00 },
  earth: { c: 0x3b82f6, rough: 0.55, metal: 0.10, emis: 0.08 },
  zorg: { c: 0x4a1240, rough: 0.45, metal: 0.65, emis: 0.30 },   // 조르그 모성
  debris: { c: 0x8b8f96, rough: 1.00, metal: 0.10, emis: 0.00 },
}

// 역할별 외곽 표식 — 점선 링의 조각 수/굵기로 한눈에 구분한다.
// (색은 roles.js가 정한 그 색을 그대로 쓴다 — HUD 범례와 반드시 같아야 한다.)
const ROLE_RING = {
  armor: { n: 8, gap: 0.30, r0: 1.34, r1: 1.62, spin: 0.25 },
  battery: { n: 3, gap: 0.55, r0: 1.34, r1: 1.74, spin: -0.7 },
  void: { n: 40, gap: 0.06, r0: 1.20, r1: 1.34, spin: 1.5 },
  volatile: { n: 5, gap: 0.42, r0: 1.30, r1: 1.66, spin: 0.5 },
  light: { n: 12, gap: 0.5, r0: 1.22, r1: 1.36, spin: 0.9 },
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

// ─── 미사일 형상 ────────────────────────────────────────────────
// 점 하나로는 "무엇이 날아가는지"가 안 읽힌다. 원뿔 노즈 + 원통 동체 +
// 후퇴익 두 장으로 조립해 진행 방향으로 눕힌다(기하는 +x를 향하도록 만든다).
function missileParts() {
  const body = new THREE.CylinderGeometry(0.28, 0.30, 1.5, 14)
  body.rotateZ(-Math.PI / 2); body.translate(-0.15, 0, 0)
  const nose = new THREE.ConeGeometry(0.28, 0.85, 14)
  nose.rotateZ(-Math.PI / 2); nose.translate(1.02, 0, 0)
  // 꼬리날개 — 탑다운에서 실루엣이 보이도록 판면을 화면과 나란히 둔다
  const fin = new THREE.BufferGeometry()
  fin.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.90, 0.22, 0, -0.95, 0.78, 0, -0.28, 0.26, 0,
    -0.90, -0.22, 0, -0.28, -0.26, 0, -0.95, -0.78, 0,
  ]), 3))
  fin.computeVertexNormals()
  return { body, nose, fin }
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
    this.glowTex = glowTexture()
    this.missileGeo = missileParts()
    this.texCache = new Map()

    this.buildStars()
    this.buildSun()

    this.parts = new Particles(this.scene)
    this.markers = new Markers(this.scene)
    this.boom = new Explosions(this.parts, this.rig, (v, c) => this.flash(v, c))
    this.orbits = new Orbits(this.scene)
    this.laserView = new LaserView(this.scene, this.rig)
    this.belt = new Belt(this.scene)          // 성계 쿠션 — 여기서 튕긴다
    this.icons = new Icons(this.scene)        // 카테고리 배지 + 적대(해골) 표식

    // 발사대 마커 — 미사일이 지구가 아니라 여기서 나간다는 걸 못 박는다
    this.pad = new THREE.Mesh(new THREE.RingGeometry(0.62, 1, 24), new THREE.MeshBasicMaterial({
      color: 0x22d3ee, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }))
    this.pad.renderOrder = 14
    this.scene.add(this.pad)

    // ── 예상 피격 표시 ────────────────────────────────────────
    // 발사 버튼 위의 이름표("Zorg Mogul-1을 친다")만으로는 판 위에서 그게
    // **어느 공인지** 못 찾는다 — 공이 스무 개 굴러다니고, 락온 브래킷은
    // 정작 미래의 충돌 지점(빈 우주)에 찍히기 때문이다.
    // 그래서 지금 그 자리에 있는 공 자체를 예측선 색으로 물들인다.
    //   ① 채운 원반 — 공이 통째로 그 색이 된다(가장 먼저 눈에 들어오는 것)
    //   ② 바깥 번짐 — 줌아웃해서 공이 점만 해져도 색 덩어리로 읽힌다
    //   ③ 가는 실선 — 지금 위치와 락온(미래 위치)을 잇는다. 이게 없으면
    //      물든 공과 저쪽의 링이 서로 무관한 두 표시로 보인다.
    const tintMat = (op) => new THREE.MeshBasicMaterial({
      transparent: true, opacity: op, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.tintGlow = new THREE.Mesh(this.discGeo, tintMat(0.14))
    this.tintDisc = new THREE.Mesh(this.discGeo, tintMat(0.34))
    const linkGeo = new THREE.PlaneGeometry(1, 1); linkGeo.translate(0.5, 0, 0)
    this.tintLink = new THREE.Mesh(linkGeo, tintMat(0.22))
    this.tintGlow.renderOrder = 9; this.tintDisc.renderOrder = 11; this.tintLink.renderOrder = 10
    for (const o of [this.tintGlow, this.tintDisc, this.tintLink]) { o.visible = false; this.scene.add(o) }

    // ── 본성 표식 ──
    // 조르그 요새는 겉보기에 다 똑같은데, 그중 하나(본성)만 지구를 겨눠 광선을
    // 충전한다. 그걸 먼저 부수면 충전이 취소되고 지휘권이 다음 요새로 넘어간다
    // (game.recordKill → pickHomeworld) — 즉 **어느 요새를 먼저 치느냐**가 수다.
    // 그런데 화면에 그 구분이 없어서 툴팁을 열기 전엔 알 수가 없었다.
    // 광선과 같은 색으로 두 겹 링을 둘러 "이놈이 쏘는 놈"을 한눈에 박아 둔다.
    // 표적 레티클(붉은색, 반경 2.1배)이 이미 요새마다 붙으므로 색도 자리도
    // 그것과 겹치면 안 된다 — 호박색으로, 그 바깥에서 반대로 돈다.
    this.homeMark = new THREE.Group()
    for (const [r0, r1, n, gap] of [[2.46, 2.66, 3, 0.34], [2.78, 2.86, 12, 0.6]]) {
      const step = Math.PI * 2 / n
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(
          new THREE.RingGeometry(r0, r1, 12, 1, i * step, step * (1 - gap)),
          new THREE.MeshBasicMaterial({
            color: 0xf5b544, transparent: true, opacity: 0.9,
            depthTest: false, depthWrite: false, side: THREE.DoubleSide,
          }))
        m.renderOrder = 14
        this.homeMark.add(m)
      }
    }
    this.homeMark.visible = false
    this.scene.add(this.homeMark)

    this.aim = new AimHelper(this.scene, this.rig, this.discGeo)

    // 전면 섬광 — 핵을 "과장"하는 가장 싼 수단. 폭발 프레임에 화면 전체가 탄다
    this.flashEl = document.createElement('div')
    this.flashEl.className = 'nukeflash'
    document.body.appendChild(this.flashEl)
    this.flashV = 0

    this.bodyFx = new Map()   // b.id → { mesh, halo, ring, hpArc, ... }
    this.missileFx = new Map()
    this.lines = []
    this.lastBodies = null
    this.lastT = performance.now()

    addEventListener('resize', () => this.resize())
    this.resize()
  }

  // ── 그리는 원 = 판정 원. 예외 없다 ─────────────────────────
  // 예전에는 여기에 "화면 최소 지름" 바닥값이 걸려 있어서, 줌아웃하면 작은 공이
  // 판정 반경의 최대 2.2배까지 부풀어 그려졌다(계측: 히기에이아·베스타 ×2.20,
  // 수성 ×1.85). 그 결과 **화면에서는 두 공이 겹쳤는데 실제로는 통과**하는
  // 케이스가 생겼다 — 당구 게임에서 이건 거짓말이다.
  //
  // (판정 자체는 멀쩡했다. 상대속도 1000 GU/s까지 훑어도 놓치는 띠가 0.01 GU
  //  미만이라 터널링은 없다. 문제는 오로지 그림이 판정보다 컸다는 것.)
  //
  // 이제 공은 언제나 판정 반경 그대로 그린다. 대신 너무 작아서 안 보이는 문제는
  // **표식**(markerRadius)이 맡는다 — 속이 빈 링이라 "여기 작은 게 있다"로 읽히지
  // "이만큼이 공이다"로는 안 읽힌다.
  renderRadius(b) { return hitRadiusOf(b) }

  // 찾기용 최소 크기 — 공이 아니라 **표식에만** 적용한다(외곽 링·체력 호·조준 물들임).
  markerRadius(b) {
    const minPx = b.type === 'debris' ? VIS.MIN_DEBRIS_PX : VIS.MIN_PLANET_PX
    return Math.max(hitRadiusOf(b), minPx * 0.5 * this.rig.worldPerPx)
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
    this.aim.tick(dt)
    this.aim.bind(this.game.bodies, (b) => this.renderRadius(b))
    if (this.lastBodies !== this.game.bodies) this.resetStage()
    this.rig.update(dt)
    this.boom.drain(this.game)
    this.syncBodies(dt)
    this.belt.update(this.game.beltR, dt, this.rig.worldPerPx)
    this.icons.update(this.game, this.rig, dt, (b) => this.renderRadius(b))
    this.laserView.update(this.game)
    this.orbits.sync(this.game.bodies, this.game.aMax,
      (b) => b.isEarth ? 0x60a5fa : b.isTarget ? 0x22d3ee : colorOf(b.type))
    this.syncMissiles()
    this.syncLines()
    this.markers.update(this.game, this.rig, dt, (b) => this.renderRadius(b))
    this.pad.visible = this.game.canAim && !this.game.bare
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

  // 화면에 떠 있는 연출(파티클·링·화구·섬광)을 그 자리에서 지운다.
  // 오프닝 예고편의 컷 전환용 — 하드컷이므로 앞 컷의 불꽃을 끌고 가지 않는다.
  clearFx() {
    this.parts.clear()
    this.flashV = 0
  }

  resetStage() {
    this.orbits.dispose()
    for (const fx of this.bodyFx.values()) this.disposeBodyFx(fx)
    this.bodyFx.clear()
    for (const fx of this.missileFx.values()) {
      this.scene.remove(fx.mesh, fx.glow)
      for (const o of fx.mesh.children) o.material.dispose()
      fx.glow.material.dispose()
    }
    this.missileFx.clear()
    this.lastBodies = this.game.bodies
    this.rig.snapToAuto()
  }

  disposeBodyFx(fx) {
    for (const o of [fx.mesh, fx.halo, fx.ring]) {
      this.scene.remove(o); o.material.dispose()
    }
    if (fx.hpArc) { this.scene.remove(fx.hpArc); fx.hpArc.geometry.dispose(); fx.hpArc.material.dispose() }
    if (fx.mod) {
      for (const m of fx.mod.grp.children) { m.geometry.dispose(); m.material.dispose() }
      this.scene.remove(fx.mod.grp)
    }
    if (fx.role) {
      for (const m of fx.role.grp.children) { m.geometry.dispose(); m.material.dispose() }
      this.scene.remove(fx.role.grp)
      for (const o of [fx.role.blast, fx.role.accretion]) {
        if (!o) continue
        this.scene.remove(o); o.geometry.dispose(); o.material.dispose()
      }
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
    // ── 체력 게이지 ──
    // 공은 이제 체력이 다 닳아야 부서진다. "몇 번 남았나"가 판을 읽는 1순위 정보라
    // 공 둘레에 남은 체력만큼 호(arc)를 그린다. 상처 없는 공(hp = hpMax)은 안 그린다 —
    // 스무 개가 전부 완전한 링을 두르면 그게 곧 노이즈이므로, 다친 공만 표시한다.
    const hpArc = new THREE.Mesh(new THREE.RingGeometry(1.30, 1.46, 40, 1, Math.PI / 2, Math.PI * 2), new THREE.MeshBasicMaterial({
      color: 0x4ade80, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    }))
    hpArc.renderOrder = 15
    hpArc.visible = false
    this.scene.add(mesh, halo, ring, hpArc)
    const fx = { mesh, halo, ring, hpArc, hpKey: -1, type: b.type, spin: 0.15 + Math.random() * 0.5, role: null }
    this.bodyFx.set(b.id, fx)
    if (b.role) this.attachRoleFx(fx, b)
    if (b.mods && b.mods.length) this.attachModFx(fx, b, b.mods[0])
    return fx
  }

  // 겹쳐 얹은 성질(mods) 표식 — 주 역할 링보다 안쪽에 한 겹 더 두른다
  attachModFx(fx, b, mod) {
    const def = ROLES[mod], spec = ROLE_RING[mod]
    if (!def || !spec) return
    const grp = new THREE.Group()
    const step = Math.PI * 2 / spec.n
    for (let i = 0; i < spec.n; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(spec.r0 - 0.16, spec.r1 - 0.16, 8, 1, i * step, step * (1 - spec.gap)),
        new THREE.MeshBasicMaterial({
          color: def.color, transparent: true, opacity: 0.8,
          depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        }))
      m.renderOrder = 13
      grp.add(m)
    }
    this.scene.add(grp)
    fx.mod = { grp, spin: -(spec.spin || 0.3) }
  }

  // 역할 표식 — 점선 링 + (휘발성은) 유폭 반경 원.
  // 유폭 반경은 상수라 미리 그려 줄 수 있고, 그래야 연쇄를 계획할 수 있다.
  attachRoleFx(fx, b) {
    const def = ROLES[b.role], spec = ROLE_RING[b.role]
    if (!def || !spec) return
    const grp = new THREE.Group()
    const step = Math.PI * 2 / spec.n
    for (let i = 0; i < spec.n; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(spec.r0, spec.r1, 8, 1, i * step, step * (1 - spec.gap)),
        new THREE.MeshBasicMaterial({
          color: def.color, transparent: true, opacity: 0.85,
          depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        }))
      m.renderOrder = 13
      grp.add(m)
    }
    grp.renderOrder = 13
    this.scene.add(grp)
    fx.role = { grp, spin: spec.spin }
    if (b.role === 'volatile') {   // 유폭 반경 — 여기까지 밀린다
      const vr = new THREE.Mesh(new THREE.RingGeometry(0.99, 1, 96), new THREE.MeshBasicMaterial({
        color: def.color, transparent: true, opacity: 0.22,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      }))
      vr.renderOrder = 2
      this.scene.add(vr)
      fx.role.blast = vr
    }
    if (b.role === 'void') {   // 강착원반 느낌의 안쪽 발광 링
      const acc = new THREE.Mesh(new THREE.RingGeometry(0.99, 1.12, 72), new THREE.MeshBasicMaterial({
        color: 0xc084fc, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      }))
      acc.renderOrder = 13
      this.scene.add(acc)
      fx.role.accretion = acc
    }
  }

  // 성계에서 완전히 빠진 천체(잔해 정리 등)의 연출물을 걷어낸다.
  // 예전에는 판이 바뀔 때 배열째 갈아치우며 통째로 재생성했지만, 이제
  // 성계가 런 내내 이어지므로 사라진 것만 골라 치워야 한다.
  reapMissing() {
    if (this.bodyFx.size <= this.game.bodies.length) return
    const live = new Set(this.game.bodies.map(b => b.id))
    for (const [id, fx] of this.bodyFx) {
      if (live.has(id)) continue
      this.disposeBodyFx(fx)
      this.bodyFx.delete(id)
    }
  }

  syncBodies(dt) {
    const g = this.game
    // 표식 맥동용 시계. 여기서 굴리지 않으면 아래의 Math.sin(this.lockT …)이
    // 전부 NaN이 되어 락온 링·유폭 반경·본성 표식의 맥동이 죽는다.
    this.lockT = (this.lockT ?? 0) + dt
    this.reapMissing()
    // 조준 중이면 "지금 화면의 어느 공을 치는가"도 같이 켠다 —
    // 락온은 미래 위치에 찍히므로, 현재 위치의 그 공도 물어 줘야 눈이 이어진다.
    const aimHit = g.canAim && !g.bare ? g.predictPath().hit : null
    for (const o of [this.tintGlow, this.tintDisc, this.tintLink]) o.visible = false
    // 본성 표식 — 지금 광선을 쥔 요새 하나에만 붙는다(승계되면 따라 옮겨 간다)
    const home = g.homeworld
    this.homeMark.visible = !!home && home.alive && !g.bare
    if (this.homeMark.visible) {
      this.homeMark.position.set(home.pos.x, home.pos.y, 1)
      this.homeMark.scale.setScalar(this.markerRadius(home))
      this.homeMark.rotation.z -= dt * 0.32
      // 충전·비행 중에는 밝게 — "지금 이놈이 쏘고 있다"가 바로 읽힌다
      const lit = g.laserCharging || g.laserFlying
      const pulse = lit ? 0.82 + 0.18 * Math.sin(this.lockT * 4) : 0.55
      for (const m of this.homeMark.children) m.material.opacity = pulse
    }
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
      const r = this.renderRadius(b)          // 공 = 판정 반경 그대로
      const mr = this.markerRadius(b)         // 표식 = 화면에서 안 사라질 최소 크기
      const solid = b.type !== 'debris'
      // 아직 워프해 들어오지 않은 증원은 존재하지 않는 것처럼 취급한다
      const waiting = (b.warpIn ?? 0) > 0
      fx.mesh.visible = b.alive && !waiting
      fx.halo.visible = b.alive && solid && !waiting
      fx.ring.visible = b.alive && solid && !waiting
      // 체력 링은 **여기서** 끈다. 아래 체력 블록은 `if (!b.alive) continue` 뒤에
      // 있어서 죽은 공에는 아예 도달하지 않는다 — 그 탓에 부서진 공의 체력 링만
      // 궤도에 유령처럼 남아 돌고 있었다. 켜는 건 아래, 끄는 건 여기다.
      if (!b.alive || waiting) fx.hpArc.visible = false
      if (fx.mod) {
        fx.mod.grp.visible = b.alive
        if (b.alive) {
          fx.mod.grp.position.set(b.pos.x, b.pos.y, 1)
          fx.mod.grp.scale.setScalar(r)
          fx.mod.grp.rotation.z += fx.mod.spin * dt
        }
      }
      if (fx.role) {
        fx.role.grp.visible = b.alive
        if (fx.role.blast) fx.role.blast.visible = b.alive
        if (fx.role.accretion) fx.role.accretion.visible = b.alive
        if (b.alive) {
          fx.role.grp.position.set(b.pos.x, b.pos.y, 1)
          fx.role.grp.scale.setScalar(r)
          fx.role.grp.rotation.z += fx.role.spin * dt
          if (fx.role.blast) {
            fx.role.blast.position.set(b.pos.x, b.pos.y, -4)
            fx.role.blast.scale.setScalar(volatileRadius(b))
            fx.role.blast.material.opacity = 0.16 + 0.10 * Math.abs(Math.sin(this.lockT * 2))
          }
          if (fx.role.accretion) {
            // 특이점은 삼킬수록 커진다. 구체 반경은 μ^(1/3)이라 완만하게만 자라니,
            // 강착원반을 같이 부풀리고 밝혀서 "지금 얼마나 세졌는지"가 보이게 한다.
            const grow = Math.min(1, Math.max(0, (b.mu - 900) / (CFG.VOID_MU_MAX - 900)))
            fx.role.accretion.position.set(b.pos.x, b.pos.y, 1)
            fx.role.accretion.scale.setScalar(r * (1 + 0.30 * grow))
            fx.role.accretion.material.opacity = 0.55 + 0.45 * grow
            fx.role.accretion.rotation.z -= (2.2 + 3.0 * grow) * dt
          }
        }
      }
      if (!b.alive) continue

      // 워프인 — 게임 시간이 멈춰 있어도 보여야 하므로 실시간 dt로 감쇠시킨다
      let scale = r
      if (b.warp > 0) {
        b.warp = Math.max(0, b.warp - dt / CFG.WARP_TIME)
        const u = 1 - b.warp                       // 0 → 1
        scale = r * (0.05 + 0.95 * (1 - Math.pow(1 - u, 3)))
        fx.mesh.material.emissiveIntensity = 0.6 + 2.5 * b.warp
      } else if (fx.warped !== true) {
        fx.warped = true
        const spec = MATS[b.type] ?? MATS.rock
        fx.mesh.material.emissiveIntensity = spec.emis
      }
      fx.mesh.position.set(b.pos.x, b.pos.y, 0)
      fx.mesh.scale.setScalar(scale)
      fx.mesh.rotation.y += fx.spin * dt

      // 핵을 맞을 때마다 그을음이 남는다(부서지진 않는다) + 히트 플래시 (§14.5)
      const c = fx.mesh.material.color
      if (b.hitFlash > 0) c.setRGB(2.4, 2.4, 2.4)
      else { const k = 1 - Math.min(3, b.scorch || 0) * 0.15; c.setRGB(k, k, k) }

      fx.halo.position.set(b.pos.x, b.pos.y, -3)
      fx.halo.scale.setScalar(b.radius * CFG.SWING_ZONE)

      fx.ring.position.set(b.pos.x, b.pos.y, 0)
      fx.ring.scale.setScalar(mr * 1.22)
      // 목표=시안, 지구=파랑(치면 즉사), 중립=흰색(자유롭게 쓰는 큐볼).
      // 캐롬 스테이지의 목표는 보라색 — "직격이 안 통하는 공"이라는 뜻이다.
      if (b.isEarth) { fx.ring.material.color.setHex(0x60a5fa); fx.ring.material.opacity = 0.9 }
      else if (b.isTarget) {
        fx.ring.material.color.setHex(0xf43f5e)
        fx.ring.material.opacity = 0.7 + 0.25 * Math.abs(Math.sin(performance.now() / 320))
      } else { fx.ring.material.color.setHex(0xe2e8f0); fx.ring.material.opacity = 0.34 }
      // ── 이번 샷이 맞히는 공 — 통째로 예측선 색으로 물들인다 ──
      const targeted = !!aimHit && aimHit.id === b.id
      if (targeted) {
        const tone = PRED_TONE[aimHit.outcome] ?? 0x67e8f9
        const pulse = 0.5 + 0.5 * Math.sin(this.lockT * 5)
        fx.ring.material.color.setHex(tone)
        fx.ring.material.opacity = 1
        fx.ring.scale.setScalar(mr * (1.30 + 0.06 * Math.sin(this.lockT * 5)))
        // ① 공을 덮는 원반 ② 그 바깥 번짐
        this.tintDisc.position.set(b.pos.x, b.pos.y, 1.2)
        this.tintDisc.scale.setScalar(mr)
        this.tintDisc.material.color.setHex(tone)
        this.tintDisc.material.opacity = 0.26 + 0.16 * pulse
        this.tintDisc.visible = true
        this.tintGlow.position.set(b.pos.x, b.pos.y, -2)
        this.tintGlow.scale.setScalar(mr * (2.1 + 0.25 * pulse))
        this.tintGlow.material.color.setHex(tone)
        this.tintGlow.material.opacity = 0.10 + 0.06 * pulse
        this.tintGlow.visible = true
        // ③ 지금 위치 → 락온(미래 위치)을 잇는 실선
        const dx = aimHit.x - b.pos.x, dy = aimHit.y - b.pos.y
        const d = Math.hypot(dx, dy)
        if (d > mr * 0.6) {
          this.tintLink.position.set(b.pos.x, b.pos.y, 1)
          this.tintLink.rotation.z = Math.atan2(dy, dx)
          this.tintLink.scale.set(d, Math.max(1.1 * this.rig.worldPerPx, 1.4), 1)
          this.tintLink.material.color.setHex(tone)
          this.tintLink.material.opacity = 0.18 + 0.12 * pulse
          this.tintLink.visible = true
        }
      }
      // 구체 자체도 그 색으로 달아오르게 — 줌아웃해서 원반이 작아져도 색이 남는다
      if (targeted !== !!fx.tinted) {
        fx.tinted = targeted
        const spec = MATS[b.type] ?? MATS.rock
        fx.mesh.material.emissive.setHex(targeted ? (PRED_TONE[aimHit.outcome] ?? 0x67e8f9) : spec.c)
        fx.mesh.material.emissiveIntensity = targeted ? 0.5 : spec.emis
      }

      // ── 체력 호 — 다친 공만. 남은 칸이 줄면 호가 짧아지고 색이 식는다 ──
      // (여기는 살아 있는 공만 도달한다 — 죽은 공은 위에서 이미 껐다.)
      const hpMax = b.hpMax ?? CFG.PLANET_HP, hp = b.hp ?? hpMax
      const hurt = solid && hp < hpMax
      fx.hpArc.visible = hurt
      if (hurt) {
        if (fx.hpKey !== hp) {   // 호 길이는 정점을 다시 굽는다(체력이 바뀔 때만)
          fx.hpKey = hp
          fx.hpArc.geometry.dispose()
          const frac = Math.max(0, hp) / hpMax
          fx.hpArc.geometry = new THREE.RingGeometry(1.30, 1.46, 40, 1, Math.PI / 2, Math.PI * 2 * frac)
          fx.hpArc.material.color.setHex(hp <= 1 ? 0xff5c6a : 0xfbbf24)
        }
        fx.hpArc.position.set(b.pos.x, b.pos.y, 5)
        fx.hpArc.scale.setScalar(mr)
        // 방금 부딪힌 공은 잠깐 밝게 — 어느 공이 맞았는지 눈이 따라간다
        fx.hpArc.material.opacity = b.bumpFlash > 0 ? 1 : 0.8
      }
    }
  }

  syncMissiles() {
    for (const m of this.game.missiles) {
      let fx = this.missileFx.get(m)
      if (!fx) {
        // 미사일은 커서다 — 행성 뒤로 숨으면 안 되므로 깊이 테스트를 끄고 항상 위에 그린다.
        // (깊이를 쓰지 않으니 트레일을 가리지도 않는다.)
        const tone = 0xf1f5f9
        const mat = (c) => new THREE.MeshBasicMaterial({
          color: c, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        })
        const mesh = new THREE.Group()
        const body = new THREE.Mesh(this.missileGeo.body, mat(tone))
        const nose = new THREE.Mesh(this.missileGeo.nose, mat(0xf87171))
        const fin = new THREE.Mesh(this.missileGeo.fin, mat(0x94a3b8))
        for (const o of [body, nose, fin]) o.renderOrder = 9
        mesh.add(body, nose, fin)
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
      // 화면상 크기 고정 — 줌아웃해도 형상이 읽히게. 다만 예전(11px 기준)에는
      // 미사일이 행성만 하게 그려져서 판을 가렸다. **그림만** 줄인다:
      // 명중 반경(hitRadiusOf)은 그대로다.
      const r = Math.max(2.4, 6.5 * this.rig.worldPerPx)
      const v = Math.hypot(m.vel.x, m.vel.y) || 1
      fx.mesh.visible = true; fx.glow.visible = true
      fx.mesh.position.set(m.pos.x, m.pos.y, r)
      fx.mesh.scale.setScalar(r)
      fx.mesh.rotation.z = Math.atan2(m.vel.y, m.vel.x)   // 진행 방향으로 눕힌다
      // 배기 불꽃은 꼬리에 — 노즈가 아니라 엔진에서 나와야 방향이 읽힌다
      const tx = m.pos.x - m.vel.x / v * r * 1.1, ty = m.pos.y - m.vel.y / v * r * 1.1
      fx.glow.position.set(tx, ty, r)
      fx.glow.scale.setScalar(r * 2.8)
      const travelled = Math.hypot(m.pos.x - fx.lx, m.pos.y - fx.ly)
      this.parts.thrust(fx.lx, fx.ly, tx, ty, -m.vel.x / v, -m.vel.y / v,
        Math.min(10, 2 + travelled / Math.max(1, 5 * this.rig.worldPerPx)))
      fx.lx = m.pos.x; fx.ly = m.pos.y
    }
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
    if (!g.bare && g.earth.alive && g.target.alive)
      this.ribbon([g.earth.pos, g.target.pos], 2, 0x22d3ee, { fade: false, opacity: 0.2, z: -5, tailWidth: 1, depth: true })

    // 궤도 트레일 — 플레이어 임펄스 직후 강조 (P4, §14.2). 공 뒤로 지나간다.
    for (const b of g.bodies) {
      if (!b.alive) continue              // 죽은 행성의 잔상은 남기지 않는다 — 판이 지저분해진다
      if (!b.trail || b.trail.length < 2) continue
      if (b.type === 'debris') continue   // 충돌 한 번에 8~10개가 생긴다 — 궤적까지 그리면 판이 안 보인다
      const hot = b.trailFlash > 0
      // 폭은 픽셀 고정이 아니라 **그 공에 대한 비율**로 묶는다.
      // 레이저 착탄은 터진 자리를 프레임에 붙잡느라(rig.focus) 화면을 확 뒤로
      // 빼는데, 그때 행성은 12px에서 6px로 줄어드는 반면 리본은 5.5px 그대로라
      // 성계가 통째로 트레일 다발로 보였다(계측: 리본/행성 비율 0.45 → 0.86).
      // 기본 화각에서의 비율을 그대로 유지하면 어느 줌에서도 같은 그림이 된다.
      const px = this.renderRadius(b) / this.rig.worldPerPx      // 화면에서의 공 반지름
      const w = Math.max(2, Math.min(hot ? 9 : 5.5, px * (hot ? 0.73 : 0.45)))
      this.ribbon(b.trail, w, hot ? 0xffffff : colorOf(b.type), { opacity: hot ? 1 : 0.75, z: -2, depth: true })
    }

    // 미사일 궤적 — 빗나간 샷은 흐리게 스테이지 끝까지 남긴다 (§14.4)
    for (const m of g.missiles) {
      if (m.path.length < 2) continue
      this.ribbon(m.path, m.alive ? 3.6 : 2.2, m.alive ? 0xffffff : 0x7c8798,
        { opacity: m.alive ? 0.95 : 0.36, z: 1, depth: true })
    }

    // 조준선 + 큐 예측 (§14.3 개정)
    if (g.canAim && !g.bare) {
      const p = g.launchPos()
      this.ribbon([g.earth.pos, p], 2, 0x3b82f6, { fade: false, opacity: 0.35, z: -3, tailWidth: 1, depth: true })
      const pred = g.predictPath()
      if (pred.pts.length > 1) {
        this.ribbon(pred.pts, 2.6, PRED_TONE[pred.outcome] ?? 0x67e8f9, { fade: false, opacity: 0.9, z: 0, tailWidth: 1 })
        // 리드선 — "지금 저기 있는 저 공"과 "맞는 순간 여기 와 있을 자리"를 잇는다
        if (pred.hit) {
          const now = g.bodies.find(b => b.id === pred.hit.id)
          if (now && Math.hypot(now.pos.x - pred.hit.x, now.pos.y - pred.hit.y) > pred.hit.r * 0.4)
            this.ribbon([now.pos, { x: pred.hit.x, y: pred.hit.y }], 1.4, PRED_TONE[pred.outcome] ?? 0x67e8f9,
              { fade: false, opacity: 0.32, z: 0, tailWidth: 1 })
        }
        this.aim.show(pred)
      }
    } else this.aim.hide()
  }

}
