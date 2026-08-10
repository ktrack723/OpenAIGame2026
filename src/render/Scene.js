import * as THREE from 'three'
import { CFG, VIS, hitRadiusOf } from '../game/config.js'
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
// 표면 성질(거칠기·금속성·자체발광)은 종류가 정하고, **색만** 팔레트가 흔든다.
const MATS = {
  rock: { rough: 0.95, metal: 0.05, emis: 0.00 },
  ice: { rough: 0.25, metal: 0.05, emis: 0.06 },
  iron: { rough: 0.30, metal: 0.95, emis: 0.00 },
  gas: { rough: 0.85, metal: 0.00, emis: 0.08 },
  void: { rough: 1.00, metal: 0.00, emis: 0.00 },
  earth: { rough: 0.55, metal: 0.10, emis: 0.08 },
  zorg: { rough: 0.45, metal: 0.65, emis: 0.30 },   // 조르그 모성
  debris: { rough: 1.00, metal: 0.10, emis: 0.00 },
}

// ─── 팔레트 ─────────────────────────────────────────────────────
// 한 종류에 색을 여러 벌 준다. 스무 개가 전부 같은 공이면 성계가 벽지처럼
// 보이는데, 그렇다고 색을 마음대로 흔들면 "색 = 규칙"이 깨진다. 그래서
// **같은 계열 안에서만** 흔든다 — 암석은 회갈색 계열, 얼음은 청록빛 흰색,
// 금속은 강철빛, 가스는 호박·주황·크림. 종류는 여전히 색으로 읽힌다.
//
// **파란색은 지구 하나뿐이다.** 어떤 팔레트도 그 색조로 들어가지 않는다 —
// 얼음이 제일 가까운데, 그래서 하늘색을 빼고 청록~박하 쪽(색상 165~195°)으로만
// 골랐다. 지구는 217°의 진한 파랑이라 작게 줄어들어도 헷갈리지 않는다.
// 무엇을 고르는지는 천체 id로 정해진다(시드가 같으면 매일 같은 성계다).
const PALETTE = {
  rock: [0x9aa1a8, 0xb3a493, 0x8d8478, 0xc2b6a4, 0x7f8a8e, 0xa89a86],
  ice: [0x8be9ff, 0xa8f0e4, 0xd6fbff, 0x7fd4cc, 0xbdf3e8],
  iron: [0xcbd5e1, 0xb6bfcb, 0xd8d0be, 0xa4aeba, 0xe0e4ea],
  gas: [0xffd166, 0xf2a65a, 0xe9c9a0, 0xffb59b, 0xf5e3ae, 0xd9a441],
  void: [0x120a1e],
  earth: [0x3b82f6],       // 이 파랑은 지구 전용이다
  zorg: [0x4a1240],
  debris: [0x8b8f96],
}
// 천체 id → 팔레트 번호. 문자열 해시라 시드가 같으면 매번 같은 색이 나온다.
function paletteIndex(id, type) {
  const p = PALETTE[type] ?? PALETTE.rock
  let h = 2166136261
  for (let i = 0; i < String(id).length; i++) h = Math.imul(h ^ String(id).charCodeAt(i), 16777619)
  return (h >>> 0) % p.length
}
const colorOf = (type, pi = 0) => {
  const p = PALETTE[type] ?? PALETTE.rock
  return p[pi % p.length]
}

// 절차적 표면 텍스처 — 자산 0개로 "돌아가는 구체"를 만들기 위한 최소 노이즈.
// 팔레트 번호까지 씨앗에 넣어 무늬도 같이 갈린다(같은 색 두 개가 나와도 무늬가 다르다).
function surfaceTexture(type, pi) {
  const tone = colorOf(type, pi)
  const base = new THREE.Color(tone)
  const c = document.createElement('canvas'); c.width = 256; c.height = 128
  const g = c.getContext('2d')
  g.fillStyle = `#${base.getHexString()}`; g.fillRect(0, 0, 256, 128)
  let s = pi * 2654435761 >>> 0
  for (const ch of type) s = (s * 31 + ch.charCodeAt(0)) >>> 0
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
  if (type === 'gas') {
    for (let y = 0; y < 128; y += 6) {   // 가스행성 = 가로 띠
      const shade = new THREE.Color(tone)
      shade.offsetHSL(0, 0, (rnd() - 0.5) * 0.3)
      g.globalAlpha = 0.5; g.fillStyle = `#${shade.getHexString()}`
      g.fillRect(0, y, 256, 3 + rnd() * 4)
    }
  } else {
    for (let i = 0; i < 90; i++) {
      const shade = new THREE.Color(tone)
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

// ─── 가스 행성 = 위에서 내려다본 토성 ───────────────────────────
// 구체를 판정 반경만큼 채우는 대신 **가운데를 줄이고 고리를 깐다.** 판정
// 반경(=흰 테두리)은 건드리지 않으므로 판 위에서 공이 커지지는 않는다 —
// 같은 자리에 다른 그림이 들어갈 뿐이다. 고리는 얇은 원판 셋이고, 사이가
// 비어 있어(카시니 간극) 한눈에 고리로 읽힌다.
const RING_PX = 2.6                       // 테두리 띠 굵기(화면 px) — 줌과 무관하게 일정
const GAS_CORE = 0.42                     // 구체 반지름 (판정 반경 대비)
const GAS_BANDS = [                       // [안쪽, 바깥쪽, 불투명도]
  [0.56, 0.72, 0.40],                     // 안쪽 희미한 먼지 고리
  [0.77, 0.97, 0.95],                     // 본 고리 — 여기가 제일 밝다
  [1.00, 1.06, 0.55],                     // 카시니 간극 바깥의 얇은 고리
]

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

// ─── 조르그 요새의 생김새 ───────────────────────────────────────
// 요새는 원이 아니라 **포대**다. 그런데 판정은 여전히 원이어야 한다(이 게임의
// 공은 전부 원이고, 그림과 판정이 어긋나면 그게 곧 거짓말이다). 그래서 원은
// 그대로 두고 그 안에 **진짜 입체 구조물**을 세운다.
//
// 예전에는 납작한 원판(접시)과 띠를 공 위에 겹쳐 실루엣만 만들었다. 그건
// 스티커였다 — 어느 각도에서 봐도 같은 두께의 그림이고, 광선이 거기서
// 나가는 것처럼 보이지도 않았다. 이제는 그 자리에 **발사기**가 서 있다:
//
//   ① 프롱 셋 — 몸통에서 뻗어 나와 **한 점으로 모이는** 팔. 그 모이는 자리가
//      곧 광선이 태어나는 곳이다(초점). 셋이라 어느 방향에서 봐도 하나는
//      옆모습으로, 하나는 위에서 보인다 — 즉 3D로 읽힌다.
//   ② 발사구 테 — 프롱이 박혀 있는 두 겹의 고리. 겉면에 딱 맞게 앉아서
//      팔이 허공에서 시작하지 않게 하고, 위에서 보면 그게 곧 포구다.
//   ③ 적도 참호 — 총구 방향을 축으로 몸통을 감는 고리. 데스스타의 그 홈이다.
//   ④ 구슬과 속불 — 프롱 끝의 점화구, 그리고 초점의 속불. 충전이 찰수록
//      달아오르고 커진다. 발사 순간 광선은 정확히 이 자리를 지나간다.
//
// 단위는 **구체 반지름**이다(= 판정 반경. 이 게임은 그리는 원과 판정 원이
// 같다 — renderRadius 주석 참고). 그래서 1.0이 곧 공의 겉면이고, 구조물은
// 그 겉면 **위에** 서야 한다. 안쪽에 지으면 공에 묻혀 안 보인다.
//
// 총구는 +x 지만, 화면은 위에서 내려다보므로 발사구를 정확히 +x(=공의 옆구리
// 실루엣)에 두면 위에서는 선 하나로 보인다. 그래서 총구 방향에서 **카메라
// 쪽으로 살짝 들어 올린** 자리에 앉힌다(TILT) — 데스스타의 그 접시가 정면이
// 아니라 비스듬히 보이는 것과 같다. 초점의 화면 위 위치는 여전히 광선이
// 지나가는 선 위라, 빛은 정확히 이 발사구에서 나가는 것으로 읽힌다.
const FORT_TILT = 40 * Math.PI / 180   // 총구 축 → 카메라 쪽 기울기
const FORT_RIM = 0.5                   // 발사구 테 반지름 (구체 반지름 대비)
const FORT_INNER = 0.26                // 안쪽 테
const FORT_FOCUS = 1.44                // 초점까지의 거리 — 프롱 셋이 여기서 만난다
const FORT_TIP = 0.1                   // 프롱 끝이 초점 둘레에 남기는 틈
const PRONG_ROLL = [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]   // 삼각대
function fortParts() {
  // 프롱 — +x 로 길이 1짜리 테이퍼 기둥(뿌리가 굵고 끝이 가늘다).
  // 길이는 인스턴스마다 scale.x 로 맞춘다.
  const prong = new THREE.CylinderGeometry(0.045, 0.088, 1, 12)
  prong.rotateZ(-Math.PI / 2); prong.translate(0.5, 0, 0)
  // 적도 참호 — 고리 축을 총구 방향(+x)으로 눕힌다. 겉면 바로 위에 얹혀서
  // 위에서 보면 총구와 직각으로 몸통을 가로지르는 홈 한 줄로 읽힌다.
  const trench = new THREE.TorusGeometry(1.005, 0.03, 8, 56)
  trench.rotateY(Math.PI / 2)
  return {
    prong, trench,
    rim: new THREE.TorusGeometry(FORT_RIM, 0.055, 8, 44),
    inner: new THREE.TorusGeometry(FORT_INNER, 0.035, 8, 32),
    bead: new THREE.SphereGeometry(0.075, 10, 8),
    core: new THREE.SphereGeometry(0.14, 16, 12),
  }
}

// ─── 요새 표면의 회로 불빛 ──────────────────────────────────────
// 요새는 행성이 아니라 **기계**다. 그런데 몸통이 그냥 돌덩이 텍스처라
// 위에 얹은 발사기만 기계였다. 그렇다고 몸 전체를 발광시키면 붉은 전구가
// 하나 굴러다니는 꼴이라 표적 표식(붉은 링·해골)과 뒤엉킨다.
//
// 그래서 **부분부분**이다: 짧은 회로 배선 몇 가닥과 그 끝의 점 몇 개만
// 빛난다. 자체발광 지도(emissiveMap)라 검은 데는 아예 안 빛나고, 그려 놓은
// 선만 은은하게 달아오른다. 자전하면 그 불빛이 몸통을 따라 돌아 넘어간다.
function circuitTexture(seed = 1) {
  const W = 256, H = 128
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
  let s = (seed * 2654435761 + 12345) >>> 0
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296)
  g.lineCap = 'square'; g.lineJoin = 'miter'
  for (let i = 0; i < 16; i++) {
    let x = Math.floor(rnd() * W), y = Math.floor(rnd() * H)
    const bright = 0.45 + rnd() * 0.55
    g.strokeStyle = `rgba(255,255,255,${bright.toFixed(2)})`
    g.lineWidth = 1 + Math.floor(rnd() * 2)
    g.beginPath(); g.moveTo(x, y)
    // 두세 마디짜리 짧은 배선 — 직각으로만 꺾인다(그래야 회로로 읽힌다)
    const legs = 2 + Math.floor(rnd() * 2)
    for (let k = 0; k < legs; k++) {
      const len = 8 + rnd() * 22
      if ((k + i) % 2) x += rnd() < 0.5 ? -len : len
      else y += rnd() < 0.5 ? -len : len
      g.lineTo(x, y)
    }
    g.stroke()
    // 배선 끝의 접점 — 여기가 제일 밝다
    g.fillStyle = `rgba(255,255,255,${Math.min(1, bright + 0.35).toFixed(2)})`
    g.fillRect(x - 2, y - 2, 4, 4)
  }
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
    this.ringGeos = new Map()   // 안쪽 반경 비율(%) → 링 지오메트리 (공유)
    this.glowTex = glowTexture()
    this.missileGeo = missileParts()
    this.fortGeo = fortParts()
    this.texCache = new Map()
    this.circuitCache = new Map()   // 요새 표면의 회로 불빛 (팔레트 번호별)

    this.buildStars()
    this.buildSun()

    this.parts = new Particles(this.scene)
    this.markers = new Markers(this.scene)
    this.boom = new Explosions(this.parts, this.rig, (v, c) => this.flash(v, c))
    this.orbits = new Orbits(this.scene)
    this.laserView = new LaserView(this.scene, this.rig, this.parts)
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
    //   ② 가는 실선 — 지금 위치와 락온(미래 위치)을 잇는다. 이게 없으면
    //      물든 공과 저쪽의 링이 서로 무관한 두 표시로 보인다.
    // 예전엔 셋째로 바깥 번짐(2.1배 반경의 흐린 원반)이 있었는데, 그건 원반과
    // 같은 말을 흐리게 반복하는 것이라 뺐다 — 줌아웃 대응은 구체의 자체발광이
    // 이미 하고 있다.
    const tintMat = (op) => new THREE.MeshBasicMaterial({
      transparent: true, opacity: op, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    this.tintDisc = new THREE.Mesh(this.discGeo, tintMat(0.34))
    const linkGeo = new THREE.PlaneGeometry(1, 1); linkGeo.translate(0.5, 0, 0)
    this.tintLink = new THREE.Mesh(linkGeo, tintMat(0.22))
    this.tintDisc.renderOrder = 11; this.tintLink.renderOrder = 10
    for (const o of [this.tintDisc, this.tintLink]) { o.visible = false; this.scene.add(o) }

    // ※ '본성 표식'(호박색 이중 링)은 없앴다. 요새 중 하나만 광선을 쥐던 시절엔
    //   "이놈이 쏘는 놈"을 따로 박아 줘야 했지만, 이제 **요새는 전부 쏜다** —
    //   구분할 것이 없으므로 표식도 없다. 대신 요새 자체가 포대로 생겼다
    //   (fortParts: 초대형 접시 + 적도 참호). 그 접시가 향한 쪽이 곧 총구다.

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
    this.laserView.update(this.game, dt)
    this.orbits.sync(this.game.bodies, this.game.aMax,
      (b) => b.isEarth ? 0x60a5fa : b.isTarget ? 0x22d3ee : this.toneOf(b))
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
    for (const o of [fx.mesh, fx.ring]) {
      this.scene.remove(o); o.material.dispose()
    }
    if (fx.hpArc) { this.scene.remove(fx.hpArc); fx.hpArc.geometry.dispose(); fx.hpArc.material.dispose() }
    if (fx.role) {
      if (fx.role.grp) {
        for (const m of fx.role.grp.children) { m.geometry.dispose(); m.material.dispose() }
        this.scene.remove(fx.role.grp)
      }
      const acc = fx.role.accretion
      if (acc) { this.scene.remove(acc); acc.geometry.dispose(); acc.material.dispose() }
    }
    if (fx.fort) {
      // 지오메트리는 fortGeo가 공유한다 — 여기서 버리는 건 재질 셋뿐이다
      for (const m of [fx.fort.steel, fx.fort.hull, fx.fort.hot, fx.fort.fire]) m.dispose()
      this.scene.remove(fx.fort.grp)
    }
  }

  // 테두리 링 — **화면에서 늘 같은 굵기**여야 한다. 예전엔 반경에 비례하는
  // 띠라 목성 같은 큰 공에서는 두꺼운 회색 벨트가 되어 정작 고리보다 눈에 띄었고,
  // 작은 공에서는 실처럼 사라졌다. 그래서 필요한 안쪽 반경을 매 프레임 구해
  // 백분율로 반올림한 지오메트리를 공유한다(많아야 수십 개, 만들고 나면 재사용).
  ringGeoFor(inner) {
    const k = Math.round(Math.min(0.96, Math.max(0.45, inner)) * 100)
    if (!this.ringGeos.has(k)) this.ringGeos.set(k, new THREE.RingGeometry(k / 100, 1, 64))
    return this.ringGeos.get(k)
  }

  // 링 하나를 바깥 반경 outer에 맞추되 띠 굵기는 RING_PX(화면 픽셀)로 고정한다.
  fitRing(ring, outer) {
    ring.scale.setScalar(outer)
    const geo = this.ringGeoFor(1 - RING_PX * this.rig.worldPerPx / Math.max(1e-6, outer))
    if (ring.geometry !== geo) ring.geometry = geo
  }

  // 그 천체가 실제로 쓰는 색 — 궤도선·트레일이 공과 같은 색이어야 한 몸으로 읽힌다.
  toneOf(b) { return colorOf(b.type, this.bodyFx.get(b.id)?.pi ?? paletteIndex(b.id, b.type)) }

  texFor(type, pi) {
    const key = `${type}:${pi}`
    if (!this.texCache.has(key)) this.texCache.set(key, surfaceTexture(type, pi))
    return this.texCache.get(key)
  }

  circuitFor(pi) {
    if (!this.circuitCache.has(pi)) this.circuitCache.set(pi, circuitTexture(pi + 1))
    return this.circuitCache.get(pi)
  }

  // 이 공이 스스로 내는 빛. 보통은 제 색으로 아주 약하게 깔리고, **조르그
  // 요새만** 붉은 회로가 부분부분 들어온다(circuitTexture).
  // 값을 fx에 적어 두는 이유: 워프인·조준 물들임이 자체발광을 잠깐 덮었다가
  // 되돌리는데, 되돌릴 자리가 한 군데여야 요새의 회로가 그때 꺼지지 않는다.
  emissiveFor(b, pi, spec) {
    return b.role === 'battery'
      ? { tone: 0xff2b3f, base: 0.95, map: this.circuitFor(pi) }
      : { tone: colorOf(b.type, pi), base: spec.emis, map: null }
  }

  makeBodyFx(b) {
    const spec = MATS[b.type] ?? MATS.rock
    const pi = paletteIndex(b.id, b.type)
    const em = this.emissiveFor(b, pi, spec)
    const mesh = new THREE.Mesh(this.sphereGeo, new THREE.MeshStandardMaterial({
      map: this.texFor(b.type, pi), color: 0xffffff,
      roughness: spec.rough, metalness: spec.metal,
      emissiveMap: em.map,
      emissive: new THREE.Color(em.tone), emissiveIntensity: em.base,
    }))
    mesh.rotation.x = Math.PI / 2 - 0.35   // 극축을 살짝 눕혀 탑다운에서도 자전이 보이게
    const ring = new THREE.Mesh(this.ringGeoFor(0.9), new THREE.MeshBasicMaterial({
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
    this.scene.add(mesh, ring, hpArc)
    const fx = {
      mesh, ring, hpArc, hpKey: -1, type: b.type, pi,
      spin: 0.15 + Math.random() * 0.5, role: null, fort: null,
      emisTone: em.tone, emisBase: em.base, phase: Math.random() * 6.28,
    }
    this.bodyFx.set(b.id, fx)
    if (b.role) this.attachRoleFx(fx, b)
    if (b.role === 'battery') this.attachFortFx(fx)
    return fx
  }

  // 요새 위에 세우는 발사기(fortParts 주석 참고).
  // 판정에는 아무 영향이 없다 — 공은 여전히 hitRadiusOf 반경의 원이다.
  attachFortFx(fx) {
    const G = this.fortGeo, grp = new THREE.Group()
    // 구조물 — 어두운 금속. 충전이 차면 색이 아니라 **자체발광**만 올린다.
    const steel = new THREE.MeshStandardMaterial({
      color: 0x3a1622, roughness: 0.34, metalness: 0.92,
      emissive: new THREE.Color(0xff2d4d), emissiveIntensity: 0.1,
    })
    // 선체 — 적도 참호처럼 몸통에 속한 것. 여긴 안 달아오른다(총구만 달아오른다).
    const hull = new THREE.MeshStandardMaterial({
      color: 0x2a2026, roughness: 0.5, metalness: 0.8,
      emissive: new THREE.Color(0x5c0f1c), emissiveIntensity: 0.35,
    })
    // 점화구·속불 — 가산 합성이라 겹칠수록 하얗게 탄다
    const hot = new THREE.MeshBasicMaterial({
      color: 0xff5c9e, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const fire = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    })
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); grp.add(m); return m }
    add(G.trench, hull)
    // 발사구가 앉는 자리 — 총구(+x)에서 카메라 쪽으로 들어 올린 방향 D.
    // (D, U, V)는 정규직교라 D 둘레의 원을 각도 하나로 찍을 수 있다.
    const X = new THREE.Vector3(1, 0, 0)
    const D = new THREE.Vector3(Math.cos(FORT_TILT), 0, Math.sin(FORT_TILT))
    const U = new THREE.Vector3(0, 1, 0)
    const V = new THREE.Vector3().crossVectors(D, U).normalize()
    const Z = new THREE.Vector3(0, 0, 1)
    // 반지름 rad 짜리 고리를 **구체 겉면에 딱 맞게** 앉힌다(중심은 그만큼 안쪽).
    const ringOn = (geo, rad) => {
      const m = add(geo, steel)
      m.position.copy(D).multiplyScalar(Math.sqrt(Math.max(0, 1 - rad * rad)))
      m.quaternion.setFromUnitVectors(Z, D)
      return m
    }
    ringOn(G.rim, FORT_RIM)
    ringOn(G.inner, FORT_INNER)
    // 초점 — 프롱 셋이 만나는 자리. 광선은 정확히 여기를 지나간다.
    const focus = D.clone().multiplyScalar(FORT_FOCUS)
    const beads = []
    for (const th of PRONG_ROLL) {
      // 뿌리는 발사구 테 위, 끝은 초점 바로 앞. 셋이 안쪽으로 모여든다.
      const off = U.clone().multiplyScalar(Math.cos(th) * FORT_RIM)
        .addScaledVector(V, Math.sin(th) * FORT_RIM)
      const base = D.clone().multiplyScalar(Math.sqrt(Math.max(0, 1 - FORT_RIM * FORT_RIM))).add(off)
      const tip = focus.clone().addScaledVector(off.clone().normalize(), FORT_TIP)
      const dir = tip.clone().sub(base)
      const len = dir.length()
      const arm = add(G.prong, steel)
      arm.position.copy(base)
      arm.quaternion.setFromUnitVectors(X, dir.normalize())
      arm.scale.set(len, 1, 1)      // 길이만 늘린다(굵기는 그대로)
      const bead = add(G.bead, hot)
      bead.position.copy(tip)
      beads.push(bead)
    }
    const core = add(G.core, fire)
    core.position.copy(focus)
    core.renderOrder = 9
    this.scene.add(grp)
    fx.fort = { grp, core, beads, steel, hull, hot, fire }
  }

  // 총구가 향하는 쪽 = **언제나 지구**다. 무엇을 하고 있든 그렇다.
  //
  // 예전에는 충전·비행 중일 때 그 광선의 진짜 방향을 따라갔다. 규칙으로는
  // 맞지만(광선은 "지구가 도달할 자리"를 겨눈다), 화면에서는 요새가 빈 하늘을
  // 보고 있는 것처럼 읽히는 순간이 생겼다 — 특히 지구를 밀어 조준을 틀어
  // 놓았을 때. 이 게임에서 요새가 하는 말은 하나뿐이다: **너희 집을 보고 있다.**
  // 그러니 총구는 예외 없이 지구를 향한다. 도착한 그 순간부터.
  // (u는 충전 진행도 — 총구가 얼마나 달아올랐는가.)
  fortAim(b) {
    const e = this.game.earth
    const a = Math.atan2(e.pos.y - b.pos.y, e.pos.x - b.pos.x)
    let u = 0
    for (const L of this.game.lasers ?? []) {
      if (L.from !== b) continue
      if (L.state === 'charge') u = Math.max(u, Math.min(1, L.t / CFG.LASER_CHARGE))
      else if (L.state === 'travel' || L.state === 'spent') u = 1
    }
    return { a, u }
  }

  // 역할에 딸린 **그림**을 붙인다. 예전엔 여기서 태그마다 점선 링을 둘렀는데,
  // 그건 그림이 아니라 UI였다 — 공 스무 개가 저마다 회전하는 파선 고리를 두르면
  // 판 위에 정보가 아니라 무늬만 남는다. 태그는 색·무늬·배지(Icons)가 이미
  // 말하고 있으므로 링은 걷어냈고, 여기 남은 둘은 **그 천체 자체의 생김새**다.
  //   가스 행성 — 위에서 내려다본 고리
  //   특이점    — 강착원반
  // 유폭 반경 원은 조준이 그 공을 물었을 때만 켠다(syncBodies) — 늘 켜 두면
  // 가스 행성 넷이 성계에 커다란 원 넷을 상시로 그린다.
  attachRoleFx(fx, b) {
    if (b.role === 'volatile') {
      const grp = new THREE.Group()
      const tone = colorOf(b.type, fx.pi)
      for (const [r0, r1, o] of GAS_BANDS) {
        const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96), new THREE.MeshBasicMaterial({
          color: tone, transparent: true, opacity: o,
          depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        }))
        m.renderOrder = 3
        grp.add(m)
      }
      this.scene.add(grp)
      // 유폭 반경 원은 여기서 안 그린다 — 조준이 그 공을 물었을 때 AimHelper가
      // 이미 같은 반경에 같은 색으로 그린다(h.volatileR). 여기서도 그리면 같은
      // 자리에 같은 원이 둘 겹친다.
      fx.role = { grp, spin: 0.12 }
      return
    }
    if (b.role === 'void') {   // 강착원반 느낌의 안쪽 발광 링
      const acc = new THREE.Mesh(new THREE.RingGeometry(0.99, 1.12, 72), new THREE.MeshBasicMaterial({
        color: 0xc084fc, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      }))
      acc.renderOrder = 13
      this.scene.add(acc)
      fx.role = { grp: null, spin: 0, accretion: acc }
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
    for (const o of [this.tintDisc, this.tintLink]) o.visible = false
    for (const b of g.bodies) {
      let fx = this.bodyFx.get(b.id)
      if (!fx) fx = this.makeBodyFx(b)
      if (fx.type !== b.type) {   // 합성으로 바이옴이 바뀜 → 재질 교체
        const spec = MATS[b.type] ?? MATS.rock
        fx.pi = paletteIndex(b.id, b.type)
        const mat = fx.mesh.material
        mat.map = this.texFor(b.type, fx.pi)
        mat.roughness = spec.rough; mat.metalness = spec.metal
        const em = this.emissiveFor(b, fx.pi, spec)
        fx.emisTone = em.tone; fx.emisBase = em.base
        mat.emissiveMap = em.map
        mat.emissive.setHex(em.tone); mat.emissiveIntensity = em.base
        mat.needsUpdate = true
        fx.type = b.type
      }
      const r = this.renderRadius(b)          // 공 = 판정 반경 그대로
      const mr = this.markerRadius(b)         // 표식 = 화면에서 안 사라질 최소 크기
      const solid = b.type !== 'debris'
      // 아직 워프해 들어오지 않은 증원은 존재하지 않는 것처럼 취급한다
      const waiting = (b.warpIn ?? 0) > 0
      fx.mesh.visible = b.alive && !waiting
      fx.ring.visible = b.alive && solid && !waiting
      // 체력 링은 **여기서** 끈다. 아래 체력 블록은 `if (!b.alive) continue` 뒤에
      // 있어서 죽은 공에는 아예 도달하지 않는다 — 그 탓에 부서진 공의 체력 링만
      // 궤도에 유령처럼 남아 돌고 있었다. 켜는 건 아래, 끄는 건 여기다.
      if (!b.alive || waiting) fx.hpArc.visible = false
      // ── 요새의 발사기 ──
      // **워프해 들어오는 동안에도 그린다.** 도착하는 그 순간부터 총구는 이미
      // 지구를 향하고 있어야 한다 — 그게 이 요새가 여기 온 이유이기 때문이다.
      // 몸통과 같은 비율로 같이 떠오르므로 도형이 공중에 뜨지 않는다.
      if (fx.fort) {
        const show = b.alive && !waiting
        fx.fort.grp.visible = show
        if (show) {
          const { a, u } = this.fortAim(b)
          const F = fx.fort
          // 워프인 — 몸통(아래 scale)과 같은 곡선으로 같이 자란다
          const grow = b.warp > 0 ? 0.05 + 0.95 * (1 - Math.pow(b.warp, 3)) : 1
          F.grp.position.set(b.pos.x, b.pos.y, 0)
          F.grp.scale.setScalar(r * grow)
          F.grp.rotation.z = a
          // 충전이 찰수록 구조물이 달아오른다 — "지금 물고 있다"가 밝기로 읽힌다
          const beat = 1 + 0.14 * Math.sin(this.lockT * 9)
          F.steel.emissiveIntensity = 0.1 + 1.1 * u
          F.hot.opacity = (0.35 + 0.65 * u) * (u > 0 ? beat : 1)
          F.core.scale.setScalar((0.35 + 1.5 * u) * (u > 0 ? beat : 1))
          F.core.material.opacity = 0.16 + 0.84 * u
        }
      }
      if (fx.role) {
        const show = b.alive && !waiting
        if (fx.role.grp) fx.role.grp.visible = show
        if (fx.role.accretion) fx.role.accretion.visible = show
        if (show) {
          if (fx.role.grp) {   // 가스 행성의 고리 — 판정 반경에 맞춰 깐다
            fx.role.grp.position.set(b.pos.x, b.pos.y, 0)
            fx.role.grp.scale.setScalar(mr)
            fx.role.grp.rotation.z += fx.role.spin * dt
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
        fx.mesh.material.emissiveIntensity = fx.emisBase
      }
      // 요새의 회로 불빛 — 도착이 끝난 뒤로는 여기서 아주 느리게 숨을 쉰다.
      // (자체발광 지도라 선 위만 빛난다. 몸통 전체가 밝아지지는 않는다.)
      if (fx.fort && b.warp <= 0 && !fx.tinted)
        fx.mesh.material.emissiveIntensity = fx.emisBase * (0.7 + 0.3 * Math.sin(this.lockT * 1.7 + fx.phase))
      fx.mesh.position.set(b.pos.x, b.pos.y, 0)
      // 가스 행성은 고리가 판정 반경을 채우므로 구체를 그만큼 줄인다 —
      // 공이 커지는 게 아니라 같은 자리에 다른 그림이 들어가는 것이다.
      fx.mesh.scale.setScalar(b.role === 'volatile' ? scale * GAS_CORE : scale)
      fx.mesh.rotation.y += fx.spin * dt

      // 핵을 맞을 때마다 그을음이 남는다(부서지진 않는다) + 히트 플래시 (§14.5)
      const c = fx.mesh.material.color
      if (b.hitFlash > 0) c.setRGB(2.4, 2.4, 2.4)
      else { const k = 1 - Math.min(3, b.scorch || 0) * 0.15; c.setRGB(k, k, k) }

      fx.ring.position.set(b.pos.x, b.pos.y, 0)
      this.fitRing(fx.ring, mr * 1.22)
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
        this.fitRing(fx.ring, mr * (1.30 + 0.06 * Math.sin(this.lockT * 5)))
        // ① 공을 덮는 원반
        this.tintDisc.position.set(b.pos.x, b.pos.y, 1.2)
        this.tintDisc.scale.setScalar(mr)
        this.tintDisc.material.color.setHex(tone)
        this.tintDisc.material.opacity = 0.26 + 0.16 * pulse
        this.tintDisc.visible = true
        // ② 지금 위치 → 락온(미래 위치)을 잇는 실선
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
        fx.mesh.material.emissive.setHex(targeted ? (PRED_TONE[aimHit.outcome] ?? 0x67e8f9) : fx.emisTone)
        fx.mesh.material.emissiveIntensity = targeted ? 0.5 : fx.emisBase
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
    // 배열에서 걷힌 탄의 메시도 같이 치운다 — 안 두면 판이 끝날 때까지
    // 안 보이는 메시가 씬에 쌓인다(게임 쪽이 다 쓴 탄을 지우기 시작했다).
    if (this.missileFx.size > this.game.missiles.length) {
      const live = new Set(this.game.missiles)
      for (const [m, fx] of this.missileFx) {
        if (live.has(m)) continue
        this.scene.remove(fx.mesh, fx.glow)
        for (const o of fx.mesh.children) o.material.dispose()
        fx.glow.material.dispose()
        this.missileFx.delete(m)
      }
    }
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

    // ※ '발사 회랑'(지구 → 목표를 잇는 옅은 청록 직선)은 없앴다.
    //   그 선은 판을 가로질러 **태양 위를 지나가는 일이 잦았고**, 그러면
    //   "태양에서 행성으로 뭔가 이어져 있다"로 읽혔다(오프닝에서 특히).
    //   정작 그 선이 말하려던 것 — 표적이 어디 있고 얼마나 먼가 — 은 이미
    //   세 군데서 말하고 있다: 표적 이름표, 화면 밖 방향 화살표, 작전 줄의
    //   '1104 GU · 94°'. 같은 말을 네 번째로 하면서 판까지 가리고 있었다.

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
      this.ribbon(b.trail, w, hot ? 0xffffff : this.toneOf(b), { opacity: hot ? 1 : 0.75, z: -2, depth: true })
    }

    // 미사일 궤적 — 결판난 샷은 잠깐 남았다 흐려지며 걷힌다.
    // (걷는 시계는 game.fadeSpentShots가 실시간으로 센다.)
    for (const m of g.missiles) {
      if (m.path.length < 2) continue
      const k = m.alive ? 1 : Math.max(0, 1 - m.fade / CFG.SHOT_TRAIL_FADE)
      if (k <= 0) continue
      this.ribbon(m.path, m.alive ? 3.6 : 2.2, m.alive ? 0xffffff : 0x7c8798,
        { opacity: m.alive ? 0.95 : 0.36 * k, z: 1, depth: true })
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
