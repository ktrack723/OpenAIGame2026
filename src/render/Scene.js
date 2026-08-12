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

// 분류별 재질 — 규칙이 있는 분류만 남겼으므로 재질도 그만큼이다.
// (용암·해양·독성·생명은 게임 규칙이 없어 없앴다 — Icons.CATEGORY 주석 참고.)
// 색은 곧 규칙이다: 회색 암석 = 규칙 없음, 하늘색 얼음 = 가벼움,
// 흰 금속 = 무거움, 노란 가스 = 터짐, 연두 = 쪼개져 쏨, 창백한 혜성 = 지나감.
// 표면 성질(거칠기·금속성·자체발광)은 종류가 정하고, **색만** 팔레트가 흔든다.
const MATS = {
  rock: { rough: 0.95, metal: 0.05, emis: 0.00 },
  ice: { rough: 0.25, metal: 0.05, emis: 0.06 },
  iron: { rough: 0.30, metal: 0.95, emis: 0.00 },
  gas: { rough: 0.85, metal: 0.00, emis: 0.08 },
  // 불안정 — 갈라진 틈에서 속이 빛난다. 자체발광이 제일 높은 이유가
  // 그것이다: "이건 곧 터진다"가 표면 색이 아니라 **틈**으로 읽혀야 한다.
  shard: { rough: 0.55, metal: 0.20, emis: 0.22 },
  // 혜성 — 얼음보다 더 매끈하고 스스로 옅게 빛난다(코마)
  comet: { rough: 0.18, metal: 0.02, emis: 0.30 },
  earth: { rough: 0.55, metal: 0.10, emis: 0.08 },
  zorg: { rough: 0.28, metal: 0.88, emis: 0.30 },   // 조르그 모성 — 검은 강철
  hive: { rough: 0.40, metal: 0.75, emis: 0.10 },   // 조르그 모함 — 회로가 대신 빛난다
  siege: { rough: 0.34, metal: 0.82, emis: 0.10 },  // 초엘리트 — 장갑판
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
  // 연두는 이 종류 하나뿐이다(roles.unstable 주석). 가스의 주황과 한 화면에
  // 서면 "원으로 미는 것"과 "부채꼴로 쏘는 것"이 색만으로 갈린다.
  shard: [0xa3e635, 0xbef264, 0x84cc16, 0xd9f99d, 0x9ccb3b],
  // 혜성 — 얼음 계열보다 더 창백하게. 지구 파랑(217°)과는 여전히 멀다.
  comet: [0xdffbff, 0xc7f4ff, 0xeafcff],
  earth: [0x3b82f6],       // 이 파랑은 지구 전용이다
  // ── 조르그 함대의 세 등급 ──
  // 셋 다 붉은 계열이다(조르그는 붉다). 갈리는 것은 **명도와 채도**다:
  // 모성이 가장 어둡고(거의 검은 강철), 초엘리트가 그 위, 모함이 가장 밝다.
  // 그림에서 셋을 갈라 주는 것은 색이 아니라 실루엣이므로(각자의 구조물)
  // 몸통 색은 같은 계열 안에서 밝기만 벌려 둔다.
  zorg: [0x1c0508],        // 조르그 모성 — 빛을 안 되돌린다
  hive: [0x4e0f1c],        // 조르그 모함 — 셋 중 가장 밝다
  siege: [0x3a0a12],       // 초엘리트 — 그 사이
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
  } else if (type === 'shard') {
    // 불안정 행성 = **금 간 껍데기**. 어두운 판(板) 사이로 밝은 틈이 지나간다.
    // 무늬가 곧 규칙이다 — 이 공은 밀리는 게 아니라 저 선을 따라 쪼개진다.
    const dark = new THREE.Color(tone); dark.offsetHSL(0, -0.15, -0.30)
    g.globalAlpha = 1; g.fillStyle = `#${dark.getHexString()}`; g.fillRect(0, 0, 256, 128)
    const hot = new THREE.Color(tone); hot.offsetHSL(0, 0.1, 0.26)
    for (let i = 0; i < 16; i++) {
      // 세로로 흐르는 균열 한 줄 — 위에서 아래로 몇 번 꺾인다
      let x = rnd() * 256
      g.globalAlpha = 0.35 + rnd() * 0.5
      g.strokeStyle = `#${hot.getHexString()}`
      g.lineWidth = 1 + rnd() * 2.6
      g.beginPath(); g.moveTo(x, 0)
      for (let y = 0; y <= 128; y += 16) { x += (rnd() - 0.5) * 26; g.lineTo(x, y) }
      g.stroke()
    }
    for (let i = 0; i < 40; i++) {       // 판 위의 얼룩 — 균열만 있으면 평평해 보인다
      const shade = new THREE.Color(tone)
      shade.offsetHSL((rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.3)
      g.globalAlpha = 0.10 + rnd() * 0.22
      g.fillStyle = `#${shade.getHexString()}`
      g.beginPath()
      g.ellipse(rnd() * 256, rnd() * 128, 5 + rnd() * 20, 4 + rnd() * 13, rnd() * 3.14, 0, 6.29)
      g.fill()
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

// ─── 조르그 탄두의 형상 ─────────────────────────────────────────
// 내 탄두와 **닮으면 안 된다.** 화면에 두 발이 같이 날고 있을 때 어느 쪽이
// 내 것인지 0.1초 안에 갈려야 하고, 그 판단이 틀리면 플레이어는 자기 탄을
// 피하려 든다.
//
// 갈리는 곳이 셋이다:
//   ① 실루엣 — 내 탄은 뾰족한 창(원뿔 노즈 + 후퇴익)이고, 이쪽은 **뭉툭한
//      말뚝**이다(둥근 탄두 + 굵은 동체 + 십자 안정핀 넷). 유선형이 아니라
//      "던져 놓은 쇠뭉치"로 읽혀야 한다 — 실제로 이건 유도탄이라 공기도
//      중력도 안 읽는다.
//   ② 자세 — 내 탄은 속도 방향으로 눕지만 이쪽은 거기에 **자전**이 붙는다
//      (syncFoeShots). 굴러오는 물건은 조준된 물건과 다르게 보인다.
//   ③ 색 — 아래 FOE_TONE.
function foeMissileParts() {
  // 동체 — 굵고 짧다. 내 탄(0.28 × 1.5)의 두 배 굵기에 3분의 2 길이.
  const body = new THREE.CylinderGeometry(0.5, 0.44, 1.05, 16)
  body.rotateZ(-Math.PI / 2); body.translate(-0.1, 0, 0)
  // 탄두 — 둥글다. 뾰족한 노즈와 정반대의 신호다.
  const head = new THREE.SphereGeometry(0.5, 18, 12)
  head.scale(0.85, 1, 1)
  head.translate(0.5, 0, 0)
  // 안정핀 — 십자로 넷. 탑다운에서 둘은 실루엣으로, 둘은 위에서 보인다.
  const fin = new THREE.BoxGeometry(0.62, 0.86, 0.06)
  fin.translate(-0.5, 0, 0)
  // 허리띠 — 동체를 감는 고리 하나. 이 한 줄이 "손으로 만든 물건"의 표시다.
  const belt = new THREE.TorusGeometry(0.52, 0.075, 8, 24)
  belt.rotateY(Math.PI / 2)
  return { body, head, fin, belt }
}

// 조르그 탄두의 색 — 내 탄은 흰 몸통에 붉은 노즈다(밝다). 이쪽은 그 반대로
// **검은 몸통에 백열 탄두**이고, 배기가 자주색이다. 궤적 리본까지 붉어서
// 화면에서 두 줄이 절대 안 헷갈린다(syncLines).
const FOE_TONE = {
  hull: 0x2a0a12, head: 0xffd9c0, fin: 0x7a1226, belt: 0xff4d2a,
  glow: 0xc026d3, trail: 0xff3b1f,
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
//   ③ 구슬과 속불 — 프롱 끝의 점화구, 그리고 초점의 속불. 충전이 찰수록
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
  // ※ 적도 참호(몸통을 감는 고리)는 없앴다. 데스스타의 그 홈을 흉내 낸
  //   것이었는데, 화면에서는 가스 행성의 고리와 같은 실루엣이 되어 요새가
  //   "고리 달린 행성"으로 읽혔다. 요새를 요새로 읽히게 하는 건 발사기다.
  return {
    prong,
    rim: new THREE.TorusGeometry(FORT_RIM, 0.055, 8, 44),
    inner: new THREE.TorusGeometry(FORT_INNER, 0.035, 8, 32),
    bead: new THREE.SphereGeometry(0.075, 10, 8),
    core: new THREE.SphereGeometry(0.14, 16, 12),
  }
}

// ─── 조르그 함대의 세 기함 ──────────────────────────────────────
// 요새는 발사기 하나로 "저건 포대다"를 말한다(fortParts). 그 위 등급 셋은
// 예전에 **그냥 공이었다** — 모함도, 모성도, 색만 다른 구체였다. 그러면 판에서
// 제일 중요한 물건 셋이 배경의 암석 행성과 실루엣이 같아진다.
//
// 셋 다 붉은 계열을 지키되(조르그는 붉다) **하는 일이 곧 생김새**여야 한다.
// 데스스타가 데스스타로 읽히는 것은 색이 아니라 그 접시 하나 때문이다:
//
//   모함(hive)  — 요새를 실어 나른다 → **격납 아가리**. 열린 만(灣)과 그 안의
//                 워프 문, 적도를 둘러싼 계류 꽂이 여섯. 뭔가가 여기서 나온다.
//   초엘리트(siege) — 핵을 쏜다 → **박격 실로 넷**. 몸에서 비스듬히 뻗은 굵은
//                 통들과 그 아귀의 불. 통은 비어 있고(끝이 열려 있다) 잠금이
//                 찰수록 그 안이 달아오른다.
//   모성(zorg)  — 사방에 광선을 뿌리고 부술 수 없다 → **띠와 가시와 눈**.
//                 적도를 감는 두꺼운 강철 띠, 거기 박힌 가시 열둘(사출구),
//                 그리고 이 판에서 제일 큰 외눈. 아무것도 안 열려 있다.
//
// 단위는 요새와 같다 — **구체 반지름**(= 판정 반경). 1.0이 겉면이고 구조물은
// 그 위에 서야 한다. 판정에는 아무 영향이 없다.
const CAP_TILT = 34 * Math.PI / 180     // 특징면 → 카메라 쪽 기울기(요새의 FORT_TILT와 같은 이유)
// 초엘리트만 기울기가 훨씬 급하다. 34°로 두면 실로 넷이 D 둘레로 벌어져도
// **화면에서는 전부 한쪽에 뭉친다** — D가 거의 옆구리를 향하므로 탑다운
// 투영에서 네 방향이 같은 쪽으로 눌린다(계측용 스크린샷: 통 넷이 왼쪽에
// 한 덩어리로 붙었다). 요새는 프롱 셋이 **한 점으로 모이는** 도형이라 그
// 뭉침이 곧 설계지만, 이쪽은 넷이 넷으로 보여야 발사기 묶음으로 읽힌다.
// 62°면 D가 카메라 쪽을 향해서 넷이 몸통 위에 십자로 퍼진다 —
// 위에서 내려다본 미사일 발사관 묶음이다.
const SIEGE_TILT = 62 * Math.PI / 180
const HIVE_MAW = 0.62                   // 격납 아가리 반지름
const HIVE_PODS = 6                     // 계류 꽂이 수
const SIEGE_SILOS = 4                   // 박격 실로 수
// 실로 굵기·길이. 처음엔 0.17 × 1.15로 잡았는데 그러면 통 넷이 몸통보다
// 부피가 커서 화면에 **통만** 보였다(계측용 스크린샷). 요새의 프롱이 초점까지
// 1.44인데 그건 실처럼 가는 기둥이라 몸을 안 가린다 — 굵은 통은 그만큼
// 짧아야 한다. 0.13 × 0.78이면 통 넷이 실루엣에 얹히고도 몸통이 남는다.
const SIEGE_SILO_R = 0.13               // 실로 굵기
const SIEGE_SILO_L = 0.78               // 실로 길이 (겉면에서부터)
const DOOM_SPIKES = 12                  // 모성의 사출구 수

function capitalParts() {
  // ── 공용 ──
  // 통 하나 — +x 로 길이 1. 인스턴스마다 scale.x 로 길이를 맞춘다.
  // openEnded로 뚫어 둔다: 실로는 **비어 있어야** 뭔가 나올 자리로 읽힌다.
  const tube = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true)
  tube.rotateZ(-Math.PI / 2); tube.translate(0.5, 0, 0)
  // 가시 — 뿌리가 굵고 끝이 뾰족한 원뿔
  const spike = new THREE.ConeGeometry(0.09, 1, 10)
  spike.rotateZ(-Math.PI / 2); spike.translate(0.5, 0, 0)
  // 판 하나 — 장갑판·계류 꽂이로 쓰는 납작한 상자
  const plate = new THREE.BoxGeometry(1, 1, 1)
  return {
    tube, spike, plate,
    // 모함 — 아가리 두 겹과 그 안의 문
    maw: new THREE.TorusGeometry(HIVE_MAW, 0.075, 10, 52),
    mawIn: new THREE.TorusGeometry(HIVE_MAW * 0.62, 0.05, 8, 40),
    gate: new THREE.CircleGeometry(HIVE_MAW * 0.74, 40),
    // 적도를 감는 띠 — 모함은 얇게(계류 레일), 모성은 두껍게(강철 띠)
    rail: new THREE.TorusGeometry(1.0, 0.045, 8, 64),
    girdle: new THREE.TorusGeometry(1.05, 0.15, 12, 72),
    // 초엘리트 — 실로 뿌리를 감는 장갑 목걸이와 아귀의 불
    collar: new THREE.TorusGeometry(0.72, 0.11, 10, 48),
    mouth: new THREE.TorusGeometry(SIEGE_SILO_R * 1.05, 0.045, 8, 24),
    // 모성의 외눈 — 렌즈와 그 테
    lens: new THREE.SphereGeometry(0.34, 20, 14),
    lensRim: new THREE.TorusGeometry(0.40, 0.07, 10, 44),
    // 불덩이 — 실로 아귀·워프 문·눈동자가 같이 쓴다
    ember: new THREE.SphereGeometry(0.14, 14, 10),
  }
}

// 기함 구조물이 쓰는 재질 셋. 요새(attachFortFx)와 같은 삼분법이다:
//   steel — 어두운 금속. 달아오르면 색이 아니라 **자체발광**만 올라간다.
//   hot   — 불붙은 부분(가산 합성이라 겹치면 하얗게 탄다)
//   fire  — 제일 밝은 심지. 깊이 검사를 꺼서 언제나 위에 보인다.
// 등급마다 색만 다르게 준다 — 셋이 나란히 있어도 어느 쪽이 무엇인지 갈려야 한다.
//
// **자체발광의 폭이 요새보다 좁다.** 요새는 실처럼 가는 프롱 셋이라 그게
// 하얗게 타올라도 실루엣이 남지만(attachFortFx: 0.1 → 1.2), 기함의 구조물은
// 띠·통·아가리처럼 면적이 넓어서 같은 폭으로 올리면 **구조물이 통째로 주황
// 덩어리가 되어 형태가 사라진다**(계측용 스크린샷에서 초엘리트가 그랬다).
// 여기서는 0.06 → 0.46까지만 올리고, 달아오르는 일은 hot·fire에 맡긴다 —
// 그쪽은 점이라 타올라도 형태를 안 먹는다.
function capitalMats(steelTone, hotTone, fireTone) {
  return {
    steel: new THREE.MeshStandardMaterial({
      color: steelTone, roughness: 0.30, metalness: 0.94,
      emissive: new THREE.Color(hotTone), emissiveIntensity: 0.06,
    }),
    hot: new THREE.MeshBasicMaterial({
      color: hotTone, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
    fire: new THREE.MeshBasicMaterial({
      color: fireTone, transparent: true, opacity: 0.9,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }),
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

// 색을 안 섞은 글로우 — 태양은 판마다 색이 바뀌므로(ember) 무늬와 색이
// 분리돼 있어야 한다. glowTexture는 호박빛이 구워져 있어서 검붉게 물들이면
// 노랑과 붉음이 섞여 탁해진다.
function whiteGlowTexture(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d')
  const h = size / 2
  const grd = g.createRadialGradient(h, h, 0, h, h, h)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.22, 'rgba(255,255,255,.62)')
  grd.addColorStop(0.55, 'rgba(255,255,255,.16)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd; g.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ─── 태양의 살 ──────────────────────────────────────────────────
// 예전 태양은 **단색 공**이었다(MeshBasicMaterial 0xffc861). 판의 중심이고
// 제일 큰 물건인데 그 위에서 아무 일도 안 일어나서, 화면에서 조명 장치처럼
// 읽혔다 — 여기로 공을 떨어뜨려 처분하는 포켓인데 그게 위험해 보이지 않았다.
//
// 그래서 살을 입힌다. 세 겹이고 각각 하는 일이 하나다:
//   ① 이 텍스처 — **입자(granulation)와 흑점.** 돌아가는 몸통에 무늬가 있다.
//   ② 요동 겹(churnTexture) — 같은 몸 위에서 **반대로 도는** 반투명 한 겹.
//      한 겹만으로는 아무리 잘 그려도 "무늬가 그려진 공"이고, 두 겹이 서로
//      다른 속도로 돌면 그 사이에서 **이글거림**이 생긴다. 셰이더 없이 끓는
//      표면을 만드는 가장 싼 방법이다.
//   ③ 속불 원판(sunCore) — 가운데를 하얗게 태운다. 구체에 리밋 다크닝을
//      텍스처로는 넣을 수 없어서(시선 방향에 따라 달라진다) 카메라를 마주 보는
//      원판 한 장으로 대신한다. 그 결과 가운데는 백열, 가장자리로 갈수록
//      무늬와 흑점이 드러난다 — 실제 태양 사진이 그렇게 보인다.
//
// **색은 안 굽는다.** 회색조로 그리고 색은 재질(material.color)이 준다 —
// 5스테이지에서 태양이 진한 주홍으로 넘어가야 하므로(emberFor), 무늬와 색이
// 한 텍스처에 섞여 있으면 물들일 때 노랑과 붉음이 뒤엉켜 탁해진다.
//
// 크기는 1024×512다. 태양 반경이 195 GU라 기본 줌에서 지름이 300~400px로
// 그려지는데, 적도 기준 절반만 보이므로 가로 1024면 보이는 폭에 512px이
// 실린다 — 흑점의 반음영 줄무늬가 뭉개지지 않는 최소 해상도다.
function sunTexture(seed = 5) {
  const W = 1024, H = 512
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  const rnd = skyRng(seed)
  // 바닥 — 밝은 회색. 여기서 위아래로 흔들어 입자를 만든다.
  g.fillStyle = '#d8d4cf'; g.fillRect(0, 0, W, H)

  // ── 초대류 그물(supergranulation) ──
  // 입자를 그리기 전에 큰 얼룩을 깔아 밝기가 넓게 굽이치게 한다. 이게 없으면
  // 입자가 균일하게 흩뿌려져 사포처럼 보인다.
  g.globalCompositeOperation = 'source-over'
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = rnd() * H
    const r = 60 + rnd() * 150
    const k = rnd() < 0.5 ? -1 : 1
    const a = 0.05 + rnd() * 0.07
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    const v = k > 0 ? 255 : 90
    grd.addColorStop(0, `rgba(${v},${v},${v},${a.toFixed(3)})`)
    grd.addColorStop(1, `rgba(${v},${v},${v},0)`)
    g.fillStyle = grd
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill()
  }

  // ── 입자 ──
  // 실제 태양의 쌀알 무늬는 **밝은 알맹이와 그 사이의 어두운 골**이다. 그래서
  // 알맹이를 밝게 찍고 테두리를 어둡게 두른다 — 그 테두리가 골 노릇을 한다.
  // 2200개는 계측이 아니라 눈으로 정했다: 1600이면 듬성듬성하고 3000을 넘으면
  // 서로 겹쳐 다시 균일해진다(그리고 굽는 데 40ms를 넘긴다).
  for (let i = 0; i < 2200; i++) {
    const x = rnd() * W, y = rnd() * H
    const r = 4 + rnd() * 9
    const b = 226 + rnd() * 29
    g.globalAlpha = 0.30 + rnd() * 0.34
    g.fillStyle = `rgb(${b},${(b * 0.985) | 0},${(b * 0.96) | 0})`
    g.beginPath()
    // 알맹이는 원이 아니라 다각형이다 — 원으로 찍으면 물방울로 보인다
    const n = 5 + ((rnd() * 3) | 0)
    for (let k = 0; k <= n; k++) {
      const a = k / n * 6.2832
      const rr = r * (0.72 + rnd() * 0.5)
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py)
    }
    g.closePath(); g.fill()
    g.globalAlpha = 0.16 + rnd() * 0.2
    g.strokeStyle = 'rgba(70,52,46,1)'
    g.lineWidth = 1 + rnd()
    g.stroke()
  }
  g.globalAlpha = 1

  // ── 흑점 ──
  // 이 텍스처의 목적 그 자체다. 흑점 하나는 세 겹이다:
  //   본영(umbra)   — 거의 검다. 실제로도 주변보다 2000K 차서 새까맣게 보인다.
  //   반음영(penumbra) — 본영을 둘러싼 중간 밝기 띠. **방사형 줄무늬**가 있어야
  //                    한다. 이 줄무늬가 없으면 흑점이 그냥 검은 구멍이 된다.
  //   백반(facula)  — 반음영 바로 밖의 **더 밝은** 테. 흑점을 도려낸 자리처럼
  //                    보이게 하는 대비가 여기서 나온다.
  // 여덟 무리를 찍고, 무리마다 큰 점 하나에 딸린 작은 점 몇 개를 붙인다 —
  // 실제 흑점은 혼자 안 나타난다.
  const spot = (x, y, r, tilt) => {
    // 백반 — 먼저 깔아야 아래에 깔린다
    let grd = g.createRadialGradient(x, y, r * 0.9, x, y, r * 2.1)
    grd.addColorStop(0, 'rgba(255,255,252,.50)')
    grd.addColorStop(1, 'rgba(255,255,252,0)')
    g.fillStyle = grd
    g.beginPath(); g.ellipse(x, y, r * 2.1, r * 1.7, tilt, 0, 6.2832); g.fill()
    // 반음영 + 방사 줄무늬
    grd = g.createRadialGradient(x, y, r * 0.35, x, y, r * 1.25)
    grd.addColorStop(0, 'rgba(96,58,36,.96)')
    grd.addColorStop(0.62, 'rgba(126,80,50,.86)')
    grd.addColorStop(1, 'rgba(150,104,70,0)')
    g.fillStyle = grd
    g.beginPath(); g.ellipse(x, y, r * 1.3, r * 1.05, tilt, 0, 6.2832); g.fill()
    g.save()
    g.translate(x, y); g.rotate(tilt); g.scale(1, 0.8)
    g.globalAlpha = 0.5
    const fil = 26 + ((rnd() * 14) | 0)
    for (let k = 0; k < fil; k++) {
      const a = rnd() * 6.2832
      const r0 = r * (0.42 + rnd() * 0.18), r1 = r * (1.0 + rnd() * 0.3)
      g.strokeStyle = rnd() < 0.5 ? 'rgba(58,32,20,.9)' : 'rgba(212,168,120,.75)'
      g.lineWidth = 0.9 + rnd() * 1.3
      g.beginPath()
      g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
      g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
      g.stroke()
    }
    g.globalAlpha = 1
    g.restore()
    // 본영 — 제일 마지막, 제일 어둡게
    grd = g.createRadialGradient(x, y, 0, x, y, r * 0.56)
    grd.addColorStop(0, 'rgba(16,7,4,1)')
    grd.addColorStop(0.7, 'rgba(26,12,7,.97)')
    grd.addColorStop(1, 'rgba(52,26,14,0)')
    g.fillStyle = grd
    g.beginPath(); g.ellipse(x, y, r * 0.62, r * 0.48, tilt, 0, 6.2832); g.fill()
  }
  for (let i = 0; i < 8; i++) {
    // 위도는 가운데로 몰아 둔다 — 실제 흑점은 적도 ±35° 안에서만 난다.
    // 극(v=0·1) 근처는 텍스처가 심하게 늘어나므로 거기 찍으면 무늬가 뭉개진다.
    const x = rnd() * W
    const y = H * (0.5 + (rnd() - 0.5) * 0.62)
    const R = 20 + rnd() * 34
    const tilt = rnd() * 3.14
    spot(x, y, R, tilt)
    for (let k = 0, n = 1 + ((rnd() * 3) | 0); k < n; k++) {
      spot(x + (rnd() - 0.5) * R * 5, y + (rnd() - 0.5) * R * 2.6, R * (0.22 + rnd() * 0.3), rnd() * 3.14)
    }
  }

  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}

// 요동 겹 — 몸통 위에서 **반대로 도는** 반투명 한 겹. 무늬 자체는 대단할
// 필요가 없다(밝은 실오라기와 어두운 구멍뿐이다). 하는 일은 아래 층과의
// 어긋남으로 이글거림을 만드는 것이고, 그건 두 층이 서로 다르기만 하면 된다.
// 가산 합성이라 겹치는 자리가 하얗게 타므로 **밝은 쪽만** 그린다.
function churnTexture(seed = 13) {
  const W = 512, H = 256
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  const rnd = skyRng(seed)
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, y = rnd() * H
    const r = 8 + rnd() * 46
    const a = 0.05 + rnd() * 0.13
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, `rgba(255,248,232,${a.toFixed(3)})`)
    grd.addColorStop(0.55, `rgba(255,214,150,${(a * 0.4).toFixed(3)})`)
    grd.addColorStop(1, 'rgba(255,180,90,0)')
    g.fillStyle = grd
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill()
  }
  // 채층 실오라기(spicule) — 짧고 밝은 선 몇 가닥. 도는 동안 눈이 이걸 좇는다.
  for (let i = 0; i < 150; i++) {
    const x = rnd() * W, y = rnd() * H
    const a = rnd() * 6.2832, l = 6 + rnd() * 26
    g.strokeStyle = `rgba(255,236,206,${(0.06 + rnd() * 0.14).toFixed(3)})`
    g.lineWidth = 1 + rnd() * 2.4
    g.beginPath(); g.moveTo(x, y)
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  return t
}

// ─── 5스테이지 — 하늘이 넘어간다 ────────────────────────────────
// 초엘리트가 서는 판부터(CFG.SIEGE_STAGE) 판의 색이 통째로 바뀐다. 음악도
// 같은 판에서 갈린다(audio/index.trackFor) — 규칙이 달라지는 판이면 보이는
// 것도 들리는 것도 같이 달라져야 하고, 그 둘이 다른 판에서 바뀌면 그건
// 연출이 아니라 두 개의 사고다.
//
// 값은 **한쪽에서 다른 쪽으로 섞는다**(ember 0 → 1). 판이 넘어가는 순간에
// 툭 바뀌면 로드 사고로 보이므로 실시간 몇 초에 걸쳐 민다.
//
// 태양 — 백금빛 호박(0xffc861)에서 **진한 주홍**으로. 이게 이 판의 첫 신호다:
// 판의 중심에 있는 물건이 색을 바꾸므로 화면 어디를 보고 있어도 눈에 들어온다.
// 흑점은 텍스처에 회색조로 구워져 있어서(sunTexture) 물들일수록 대비가 살아난다.
const SUN_TONE = {
  calm: 0xffc861, ember: 0xff5a1e,          // 몸통
  churnCalm: 0xffd9a0, churnEmber: 0xff7b3a, // 요동 겹
  coreCalm: 0xfff3d0, coreEmber: 0xffb46a,   // 속불
  glowCalm: 0xffc270, glowEmber: 0xff5324,   // 코로나
  lightCalm: 0xffe6b0, lightEmber: 0xff9060,  // 실제 광원
}
// 하늘 뒤편 — 청록·남보라·자홍(평시)에서 **검붉은 피색**(5판부터)으로.
// 성운은 원래 판의 색과 부딪히지 않게 눌러 놓은 물건인데(buildNebulae),
// 5판부터는 반대로 **눈에 띄어야** 한다. 그래서 색만 바꾸는 게 아니라
// 불투명도도 같이 올린다(EMBER_NEB_GAIN) — 위험해 보이는 것은 색이 아니라
// "배경이 앞으로 나왔다"는 사실이다.
const NEB_CALM = [0x2a4a8f, 0x175c6b, 0x4a2a6e, 0x1f3f7a, 0x5c2a55]
const NEB_EMBER = [0xb01c1c, 0x7a0a1e, 0xd4381a, 0x8f1230, 0xe0512a]
const EMBER_NEB_GAIN = 2.05                 // 5판의 성운 불투명도 배율
const SKY_CALM = 0x03060f, SKY_EMBER = 0x100307   // 씬 배경(가장 뒤)
const AMB_CALM = 0x8fb4ff, AMB_EMBER = 0xd08a86  // 환경광 — 살짝만 민다
// 넘어가는 데 걸리는 시간(실시간 초). 판이 열리는 막이 그보다 길어서
// (openHold: 스폰 + 뜸) 조작이 넘어올 때는 이미 다 넘어가 있다.
const EMBER_FADE = 3.4
// 색을 섞는 데 쓰는 임시 자리. 프레임마다 THREE.Color를 새로 만들면 그게
// 곧 GC이고, 이 함수는 넘어가는 3.4초 동안 매 프레임 열댓 번 돈다.
const _c2 = new THREE.Color()

// ─── 하늘 ───────────────────────────────────────────────────────
// 배경은 **판보다 훨씬 뒤**에 있는 진짜 3차원 물체다. 그래서 카메라가 움직이면
// 원근만으로 시차가 생긴다 — 별을 화면에 붙여 놓고 손으로 밀어 주는 가짜가
// 아니다. 층을 z로 크게 벌려 두는 것(-900 ~ -34000)이 시차의 전부다:
// 가까운 먼지는 성큼성큼 흐르고, 은하 원반은 거의 붙박여 있는다.
//
// 하늘은 매번 같아야 한다(시드 고정). 판은 날마다 달라지지만 하늘까지 흔들리면
// 스크린샷끼리 비교가 안 되고, 무엇보다 "여기가 어디였지"가 사라진다.
const skyRng = (seed) => {
  let s = (seed * 2654435761 + 1013904223) >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

// 별 하나. 화면에서 2~4px밖에 안 되는 점이라 **심지가 단단해야** 한다 —
// 예쁘게 퍼뜨리면 그 크기에서는 그냥 사라진다. 가운데를 꽉 채우고 바깥에만
// 옅은 무리를 남긴다. 가장자리는 완전히 0이어야 가산 합성에서 네모가 안 보인다.
function softDotTexture(size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d')
  const h = size / 2
  const grd = g.createRadialGradient(h, h, 0, h, h, h)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.30, 'rgba(255,255,255,.92)')
  grd.addColorStop(0.52, 'rgba(255,255,255,.32)')
  grd.addColorStop(0.78, 'rgba(255,255,255,.07)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd; g.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

// 성운 한 조각 — 부드러운 얼룩을 여러 겹 겹쳐 뭉게구름을 만든다.
// 값비싼 노이즈 대신 반투명 원 수십 개면 충분하다: 어차피 화면에서 수천 px로
// 늘어나 흐려지므로, 필요한 건 "가장자리가 균일하지 않다"는 것뿐이다.
function nebulaTexture(seed = 1) {
  const S = 256
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  const rnd = skyRng(seed)
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 46; i++) {
    // 중심 쪽에 몰아 둔다 — 가장자리까지 꽉 차면 사각형 경계가 드러난다
    const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.7) * S * 0.3
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d
    const r = S * (0.06 + rnd() * 0.22)
    const alpha = 0.05 + rnd() * 0.10
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`)
    grd.addColorStop(0.5, `rgba(255,255,255,${(alpha * 0.34).toFixed(3)})`)
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  // 사각 경계를 확실히 지운다 — 큰 스프라이트에서는 이 한 겹이 전부다
  g.globalCompositeOperation = 'destination-in'
  const mask = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  mask.addColorStop(0, 'rgba(255,255,255,1)')
  mask.addColorStop(0.62, 'rgba(255,255,255,.85)')
  mask.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = mask; g.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

// 별빛의 색 — 온도 순서(푸른 거성 → 흰 → 노랑 → 주황 왜성)로 섞는다.
// 실제 하늘이 그렇듯 대부분은 흐릿한 흰빛이고, 눈에 띄는 색은 소수다.
function starHue(u) {
  if (u < 0.10) return [0.60, 0.55]        // 청백 거성 — 드물고 밝다
  if (u < 0.30) return [0.56, 0.28]
  if (u < 0.62) return [0.14, 0.10]        // 흰빛 — 대다수
  if (u < 0.86) return [0.11, 0.42]        // 노랑
  return [0.045, 0.60]                     // 주황 왜성
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
    // (환경광과 태양광은 5스테이지에 같이 물든다 — stepEmber가 참조를 쓴다)
    this.ambient = new THREE.AmbientLight(AMB_CALM, 0.34)
    this.scene.add(this.ambient)
    this.sunLight = new THREE.PointLight(0xffe6b0, 3.2, 0, 0)
    this.sunLight.position.set(0, 0, 0)
    this.scene.add(this.sunLight)
    this.scene.add(new THREE.HemisphereLight(0x3b4a7a, 0x05070f, 0.35))

    this.sphereGeo = new THREE.SphereGeometry(1, 40, 28)
    // 파편 전용 지오메트리 — 매끈한 구체(sphereGeo)는 5~10px 크기에서는 그냥
    // 흐릿한 점으로 뭉개져 배경의 별·벨트 알갱이·폭발 잔광과 구분이 안 갔다.
    // 각진 저폴리(사면체)는 같은 크기에서도 모서리 음영이 또렷해 "쪼개진 조각"으로
    // 읽힌다. 크기 자체는 그대로 판정 반경이다(renderRadius 원칙은 안 건드린다) —
    // 모양만 바꿔서 눈에 띄게 한다.
    this.debrisGeo = new THREE.TetrahedronGeometry(1, 0)
    this.discGeo = new THREE.CircleGeometry(1, 64)
    this.ringGeos = new Map()   // 안쪽 반경 비율(%) → 링 지오메트리 (공유)
    this.glowTex = glowTexture()
    this.softGlowTex = whiteGlowTexture()   // 색을 안 섞은 후광 — 태양이 물들 수 있게
    this.missileGeo = missileParts()
    this.foeGeo = foeMissileParts()
    this.fortGeo = fortParts()
    this.capitalGeo = capitalParts()
    this.texCache = new Map()
    this.circuitCache = new Map()   // 요새 표면의 회로 불빛 (팔레트 번호별)

    // 5스테이지의 검붉은 하늘 — 0이 평시, 1이 다 넘어간 상태.
    // 첫 프레임에 한 번 적용해 두고(applyEmber) 그 뒤로는 바뀔 때만 민다.
    this.ember = -1
    this.emberWant = 0

    this.buildSky()
    this.buildSun()
    this.stepEmber(99)          // 지금 판에 맞는 색으로 즉시 세워 둔다(런 이어받기)

    this.parts = new Particles(this.scene)
    this.markers = new Markers(this.scene)
    this.boom = new Explosions(this.parts, this.rig, (v, c) => this.flash(v, c))
    // 정치자금 숫자 스프라이트는 씬에 직접 붙는다(파티클 풀과 달리 텍스트라
    // Particles가 못 다룬다). 씬 참조만 넘겨 두면 Explosions가 알아서 만든다.
    this.boom.scene = this.scene
    this.orbits = new Orbits(this.scene)
    this.laserView = new LaserView(this.scene, this.rig, this.parts)
    this.belt = new Belt(this.scene)          // 성계 쿠션 — 여기서 튕긴다
    this.icons = new Icons(this.scene)        // 카테고리 배지 + 적대(해골) 표식

    // 발사대 마커 — 미사일이 지구가 아니라 여기서 나간다는 걸 못 박는다.
    // **잡는 물건이기도 하다**(AimPointer): 짚고 끌면 조준선이 손끝을 따라온다.
    // 손이 닿아 있는 동안 이 고리가 커지는 게 그 사실을 말하는 유일한 신호다 —
    // 손가락으로 하는 화면에는 커서도, 툴팁도, 키보드 힌트도 없다.
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
    this.foeFx = new Map()      // 조르그 탄두 — 규칙도 그림도 내 탄과 다르다
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

  // ─── 하늘 ─────────────────────────────────────────────────────
  // 예전에는 같은 반경(11000)에 뿌린 점 세 층이 전부였다. z가 -2200~-7000으로
  // 붙어 있어 시차가 2배 남짓밖에 안 났고, 그래서 "어두운 데 별이 박혀 있다"
  // 이상으로는 안 읽혔다. 지금은 여섯 켜다:
  //
  //   -900   가까운 먼지 — 카메라를 조금만 움직여도 성큼성큼 흐른다
  //   -2400  ┐
  //   -5200  ┤ 앞·중간·뒤 별밭. 층마다 다른 속도로 흘러 깊이가 생긴다
  //   -9800  ┘
  //   -15000 성간 구름(성운) — 색이 여기서 나온다
  //   -34000 은하 원반 — 나선팔·중심 팽대부. 거의 붙박여 있다
  //
  // 시차는 원근 그 자체다. 카메라(z ≈ +1600~4800)에서 가까운 먼지까지는
  // 2500, 은하까지는 36000 — 13배가 넘게 벌어져 있으니 같은 팬에도 앞은
  // 크게, 뒤는 거의 안 움직인다. 화면 좌표로 손대는 데는 한 군데도 없다.
  //
  // 판을 가리지 않는 것이 조건이다. 은하는 원반을 기울여 화면 **한쪽 구석**을
  // 지나가게 두고(중심 팽대부는 판 밖), 성운은 불투명도를 0.2 아래로 눌러
  // 놓았다. 배경이 눈에 띄는 순간 그건 배경이 아니다.
  buildSky() {
    this.sky = []
    this.dotTex = softDotTexture()
    this.buildStarLayers()
    this.buildNebulae()
    this.buildGalaxy()
  }

  // 층별 별밭 — 층마다 반경도 크기도 다르다. 뒤로 갈수록 촘촘하고 잘게.
  //
  // size는 **월드 단위**다(sizeAttenuation). 화면 px = size × scale ÷ 거리 이므로
  // 층이 멀수록 같은 굵기를 내려면 size를 그만큼 키워야 한다 — 뒤 층에 40을
  // 주면 1px로 뭉개져 사라진다. 아래 값은 층마다 보통 별이 2~3px, 밝은 별이
  // 5~6px로 찍히도록 거리에 비례해 잡은 것이다.
  buildStarLayers() {
    const layers = [
      { n: 110, z: -900, r: 3000, size: 22, op: 0.55, tw: 0.30 },   // 가까운 먼지
      { n: 700, z: -2400, r: 7000, size: 38, op: 1.0, tw: 0.16 },
      { n: 820, z: -5200, r: 13000, size: 58, op: 0.88, tw: 0.11 },
      { n: 950, z: -9800, r: 24000, size: 96, op: 0.72, tw: 0.07 },
    ]
    const c = new THREE.Color()
    let seed = 7
    for (const L of layers) {
      const rnd = skyRng(seed++)
      const pos = new Float32Array(L.n * 3), col = new Float32Array(L.n * 3)
      const siz = new Float32Array(L.n)
      for (let i = 0; i < L.n; i++) {
        // sqrt 샘플링 = 원반 면적 균일. 중심(성계 위)에도 별이 깔린다
        const a = rnd() * Math.PI * 2
        const r = Math.sqrt(rnd()) * L.r
        pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(a) * r
        pos[i * 3 + 2] = L.z - rnd() * L.r * 0.06
        // 밝기는 멱분포에 가깝게 — 아주 밝은 몇 개가 하늘의 인상을 만든다
        const u = rnd()
        const bright = u < 0.05 ? 1.0 : u < 0.20 ? 0.74 : 0.40 + rnd() * 0.30
        const [hue, sat] = starHue(rnd())
        c.setHSL(hue, sat, bright)
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
        siz[i] = L.size * (0.6 + rnd() * (u < 0.05 ? 1.6 : 0.7))
      }
      this.addPoints(pos, col, siz, L.op, -12, L.tw)
    }
  }

  // 성간 구름 — 하늘에 색을 넣는 유일한 물건. 청록·남보라·자홍 셋만 쓴다
  // (판의 색과 부딪히지 않는 범위다). 크게, 흐리게, 드문드문.
  buildNebulae() {
    const rnd = skyRng(41)
    const tex = [nebulaTexture(3), nebulaTexture(11), nebulaTexture(29)]
    // 성운은 5스테이지에 검붉게 넘어간다(stepEmber). 그래서 색을 재질에만
    // 두지 않고 **평시색과 5판색을 짝으로** 들고 있는다 — 물들이는 쪽이 그
    // 둘 사이를 섞는다. 여기서 색을 한 벌만 굽고 나중에 곱하면, 청록에 붉음을
    // 곱해 탁한 갈색이 나온다.
    this.nebulae = []
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2
      const d = (0.35 + rnd() * 0.8) * 17000
      const k = i % NEB_CALM.length
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex[i % tex.length], color: NEB_CALM[k],
        transparent: true, opacity: 0.10 + rnd() * 0.09,
        depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      }))
      s.position.set(Math.cos(a) * d, Math.sin(a) * d * 0.72, -15000 - rnd() * 5000)
      s.scale.setScalar(9000 + rnd() * 13000)
      s.renderOrder = -20
      this.scene.add(s)
      // 반짝임(stepSky)은 base를 기준으로 도는데, 5판에서는 그 base 자체가
      // 올라간다 — 그래서 stepEmber가 entry.base를 다시 쓴다.
      const entry = { obj: s, base: s.material.opacity, tw: 0.05, ph: rnd() * 6.283 }
      this.sky.push(entry)
      this.nebulae.push({ entry, calm: NEB_CALM[k], ember: NEB_EMBER[k], op: s.material.opacity })
    }
  }

  // ─── 5스테이지의 하늘 ───────────────────────────────────────
  // **실시간으로 민다.** 판이 넘어가는 그 순간은 막이 내려가 있어 게임 시계가
  // 멈춰 있거나 배속이 걸려 있는데(warpCurtain), 색이 그 시계를 타면 8배속에서
  // 0.4초에 끝나거나 조준 모드에서 영영 안 끝난다.
  stepEmber(dt) {
    const want = (this.game?.stage ?? 1) >= CFG.SIEGE_STAGE ? 1 : 0
    if (this.ember < 0) { this.ember = want; this.applyEmber(); return }   // 첫 프레임
    if (this.ember === want) return
    const step = dt / EMBER_FADE
    this.ember = want > this.ember
      ? Math.min(want, this.ember + step)
      : Math.max(want, this.ember - step)
    this.applyEmber()
  }

  applyEmber() {
    const u = this.ember
    const mix = (a, b, into) => into.set(a).lerp(_c2.set(b), u)
    // 태양 네 겹 + 광원
    mix(SUN_TONE.calm, SUN_TONE.ember, this.sunMesh.material.color)
    mix(SUN_TONE.churnCalm, SUN_TONE.churnEmber, this.sunChurn.material.color)
    mix(SUN_TONE.coreCalm, SUN_TONE.coreEmber, this.sunCore.material.color)
    mix(SUN_TONE.glowCalm, SUN_TONE.glowEmber, this.sunGlow.material.color)
    mix(SUN_TONE.lightCalm, SUN_TONE.lightEmber, this.sunLight.color)
    // 하늘 뒤편
    mix(SKY_CALM, SKY_EMBER, this.scene.background)
    mix(AMB_CALM, AMB_EMBER, this.ambient.color)
    for (const n of this.nebulae ?? []) {
      mix(n.calm, n.ember, n.entry.obj.material.color)
      n.entry.base = n.op * (1 + (EMBER_NEB_GAIN - 1) * u)
    }
  }

  // 은하 원반 — 로그 나선 네 팔 + 중심 팽대부 + 헐로.
  // 통째로 기울여(X축 62°) 원반이 **비스듬히 누워** 보이게 한다. 이 기울기가
  // 없으면 아무리 팔을 잘 그려도 벽에 붙인 그림으로 읽힌다. 기울여 두면
  // 가까운 쪽 팔과 먼 쪽 팔의 거리가 실제로 달라져서, 카메라가 움직일 때
  // 원반 안에서도 시차가 생긴다.
  buildGalaxy() {
    const g = new THREE.Group()
    const rnd = skyRng(97)
    const ARMS = 4, SWEEP = Math.PI * 2.05, R0 = 2600, R1 = 34000
    const N = 5200
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3)
    const siz = new Float32Array(N)
    const c = new THREE.Color()
    for (let i = 0; i < N; i++) {
      const arm = i % ARMS
      // t^0.6 — 중심 쪽이 촘촘하다(실제 은하가 그렇다)
      const t = Math.pow(rnd(), 0.6)
      const th = t * SWEEP + arm * (Math.PI * 2 / ARMS)
      const r = R0 + t * (R1 - R0)
      // 팔의 흐트러짐. 안쪽은 단단하고 바깥으로 갈수록 풀어진다.
      const spread = 0.06 + t * 0.20
      const jt = (rnd() + rnd() + rnd() - 1.5) * spread          // 대략 정규분포
      const jr = (rnd() + rnd() - 1) * r * 0.16
      const a = th + jt
      const rr = r + jr
      pos[i * 3] = Math.cos(a) * rr
      pos[i * 3 + 1] = Math.sin(a) * rr
      pos[i * 3 + 2] = (rnd() + rnd() - 1) * 900                 // 원반 두께
      // 안쪽은 늙어서 노랗고 바깥 팔은 젊어서 푸르다
      const u = rnd()
      const [hue, sat] = t < 0.28 ? [0.10, 0.45] : starHue(u * 0.7)
      c.setHSL(hue, sat, u < 0.05 ? 0.92 : 0.34 + rnd() * 0.28)
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
      // 36000쯤 떨어져 있으므로 화면에서 1.5~3px이 되려면 이 정도가 필요하다
      siz[i] = 150 + rnd() * (u < 0.05 ? 420 : 170)
    }
    g.add(this.makePoints(pos, col, siz, 0.78, -24))

    // 헐로 — 원반 밖에 흩뿌려진 늙은 별. 원반의 경계를 흐려 준다.
    const H = 1100
    const hp = new Float32Array(H * 3), hc = new Float32Array(H * 3), hs = new Float32Array(H)
    for (let i = 0; i < H; i++) {
      const a = rnd() * Math.PI * 2
      const r = Math.pow(rnd(), 0.5) * R1 * 1.25
      hp[i * 3] = Math.cos(a) * r
      hp[i * 3 + 1] = Math.sin(a) * r
      hp[i * 3 + 2] = (rnd() + rnd() - 1) * R1 * 0.22
      c.setHSL(0.09, 0.35, 0.22 + rnd() * 0.20)
      hc[i * 3] = c.r; hc[i * 3 + 1] = c.g; hc[i * 3 + 2] = c.b
      hs[i] = 140 + rnd() * 170
    }
    g.add(this.makePoints(hp, hc, hs, 0.5, -25))

    // 팔의 성간 먼지 — 은하를 은하로 읽히게 하는 건 사실 **점 사이의 빛**이다.
    // 점만 찍으면 아무리 나선을 잘 그려도 흩뿌린 모래로 보인다. 팔을 따라
    // 흐린 얼룩을 앉혀 점들 사이를 메워 준다.
    const haze = [nebulaTexture(5), nebulaTexture(17)]
    for (let i = 0; i < 16; i++) {
      const arm = i % ARMS
      const t = 0.12 + (i / 16) * 0.88
      const th = t * SWEEP + arm * (Math.PI * 2 / ARMS) + (rnd() - 0.5) * 0.16
      const r = R0 + t * (R1 - R0)
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haze[i % haze.length],
        color: t < 0.3 ? 0xffc27a : (i % 3 ? 0x6f9bdd : 0x8d6fd0),
        transparent: true, opacity: 0.13 + rnd() * 0.07,
        depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      }))
      s.position.set(Math.cos(th) * r, Math.sin(th) * r, 0)
      s.scale.setScalar(7000 + t * 15000)
      s.renderOrder = -25
      g.add(s)
    }

    // 중심 팽대부 — 겹친 글로우 두 장.
    for (const [sc, op, tint] of [[17000, 0.26, 0xffd9a2], [31000, 0.14, 0xdb9548]]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: tint, transparent: true, opacity: op,
        depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      }))
      s.scale.setScalar(sc); s.renderOrder = -26
      g.add(s)
    }

    // 원반을 눕히고(64°) 팔이 화면을 비스듬히 가로지르도록 굴린다(-26°).
    // 눕혀 두면 가까운 쪽 팔과 먼 쪽 팔의 거리가 실제로 달라져, 카메라가 움직일
    // 때 **원반 안에서도** 시차가 난다 — 벽에 붙인 그림과 갈리는 지점이 여기다.
    g.rotation.set(THREE.MathUtils.degToRad(64), 0, THREE.MathUtils.degToRad(-26))
    // 중심 팽대부가 판 한가운데 앉으면 태양과 겹친다 — 왼쪽 위로 비껴 둔다.
    // 팔은 화면 안까지 흘러들어오고 팽대부만 프레임 밖에 걸치는 자리다.
    g.position.set(-13000, 14000, -34000)
    this.scene.add(g)
    this.galaxy = g
  }

  // 점구름 하나 만들기 — 별마다 크기가 다르므로 셰이더를 한 줄 손본다
  // (PointsMaterial은 size가 재질 전체에 하나뿐이다).
  makePoints(pos, col, siz, opacity, order) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    const mat = new THREE.PointsMaterial({
      size: 1, sizeAttenuation: true, vertexColors: true, map: this.dotTex,
      transparent: true, opacity, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    })
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'attribute float aSize;\nvoid main() {')
        .replace('gl_PointSize = size;', 'gl_PointSize = aSize;')
    }
    const pts = new THREE.Points(geo, mat)
    pts.frustumCulled = false
    pts.renderOrder = order
    return pts
  }

  addPoints(pos, col, siz, opacity, order, tw) {
    const pts = this.makePoints(pos, col, siz, opacity, order)
    this.scene.add(pts)
    this.sky.push({ obj: pts, base: opacity, tw, ph: Math.random() * 6.283 })
  }

  // 반짝임 — 층마다 위상이 다른 아주 느린 맥동. 별 하나하나가 깜빡이는 게
  // 아니라 하늘 전체가 미세하게 숨 쉰다. 층이 어긋나 있어서 규칙이 안 읽힌다.
  stepSky(dt) {
    if (!this.sky) return
    this.skyT = (this.skyT ?? 0) + dt
    for (const s of this.sky) {
      if (!s.tw) continue
      s.obj.material.opacity = s.base * (1 + Math.sin(this.skyT * 0.55 + s.ph) * s.tw)
    }
  }

  // 태양 — 네 겹. 각각이 하는 일은 sunTexture 주석에 있다.
  buildSun() {
    const R = CFG.R_STAR
    // ① 몸통. 회색조 텍스처 × 재질색이라 색은 판(ember)이 정한다.
    const sun = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({
      map: sunTexture(5), color: SUN_TONE.calm,
    }))
    sun.scale.setScalar(R)
    // 극축을 눕혀 탑다운에서도 자전이 보이게 — 행성과 같은 수법이다.
    sun.rotation.x = Math.PI / 2 - 0.42
    // ② 요동 겹. 아주 조금 크게 씌우고 **반대로** 돌린다(stepSun).
    const churn = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({
      map: churnTexture(13), color: SUN_TONE.churnCalm,
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    churn.scale.setScalar(R * 1.012)
    churn.rotation.x = sun.rotation.x
    churn.renderOrder = 2
    // ③ 속불 — 카메라를 마주 보는 원판. 가운데를 하얗게 태워 리밋 다크닝
    //    대신 쓴다(텍스처로는 시선 방향을 알 수 없다).
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.softGlowTex, color: SUN_TONE.coreCalm,
      transparent: true, opacity: 0.62, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    }))
    core.scale.setScalar(R * 1.86)
    core.position.z = 2
    core.renderOrder = 3
    // ④ 코로나 — 예전에 태양이 있다고 알려 주던 그 후광. 이제는 뒤에서
    //    받쳐 주는 역할만 한다(무늬가 앞에 나왔으므로 조금 눌러 앉힌다).
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.softGlowTex, color: SUN_TONE.glowCalm,
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, opacity: 0.44,
    }))
    glow.scale.setScalar(R * 3.6)
    glow.position.z = -1
    glow.renderOrder = 1
    this.scene.add(sun, churn, core, glow)
    this.sunMesh = sun; this.sunChurn = churn; this.sunCore = core; this.sunGlow = glow
  }

  // 자전 + 맥동. **실시간으로 돈다** — 조준 모드에서 판이 멈춰 있어도 태양은
  // 끓어야 한다. 여기가 멈추면 그 화면은 정지 화면으로 읽힌다.
  //
  // 두 겹의 속도가 다른 것이 이 연출의 전부다: 겉은 느리게 순방향, 요동 겹은
  // 조금 빠르게 역방향. 실제 태양의 차등 자전을 흉내 낸 것이기도 하지만,
  // 노리는 것은 두 무늬가 서로 지나가며 만드는 이글거림이다.
  stepSun(dt) {
    if (!this.sunMesh) return
    this.sunT = (this.sunT ?? 0) + dt
    this.sunMesh.rotation.y += 0.030 * dt
    this.sunChurn.rotation.y -= 0.052 * dt
    // 숨 — 주기가 다른 두 사인을 겹쳐 규칙이 안 읽히게 한다
    const b = Math.sin(this.sunT * 0.9) * 0.5 + Math.sin(this.sunT * 2.3) * 0.5
    this.sunChurn.material.opacity = 0.78 + 0.16 * b
    this.sunCore.material.opacity = 0.60 + 0.07 * b
    this.sunGlow.scale.setScalar(CFG.R_STAR * (3.6 + 0.10 * b))
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
    this.stepSky(dt)
    this.stepSun(dt)
    this.stepEmber(dt)
    this.boom.drain(this.game)
    // 떠오르는 "+1"은 실시간으로 움직인다 — 판이 멈춰 있어도(조준 모드) 끝까지
    // 올라가야 하고, 8배속에서도 같은 속도로 사라져야 읽힌다.
    this.boom.stepPol(dt, this.rig.worldPerPx)
    this.syncBodies(dt)
    this.belt.update(this.game.beltR, dt, this.rig.worldPerPx)
    this.icons.update(this.game, this.rig, dt, (b) => this.renderRadius(b))
    this.laserView.update(this.game, dt)
    this.orbits.sync(this.game.bodies, this.game.aMax,
      (b) => b.isEarth ? 0x60a5fa : b.isTarget ? 0x22d3ee : this.toneOf(b))
    this.syncMissiles()
    this.syncFoeShots(dt)
    this.syncLines()
    this.markers.update(this.game, this.rig, dt, (b) => this.renderRadius(b))
    this.pad.visible = this.game.canAim && !this.game.bare
    if (this.pad.visible) {
      const p = this.game.launchPos()
      const grab = this.game.aimGrab   // null | 'hover' | 'drag'
      this.pad.position.set(p.x, p.y, 4)
      this.pad.scale.setScalar(Math.max(6, 11 * this.rig.worldPerPx)
        * (grab === 'drag' ? 1.5 : grab === 'hover' ? 1.22 : 1))
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
    for (const pool of [this.missileFx, this.foeFx]) {
      for (const fx of pool.values()) {
        this.scene.remove(fx.mesh, fx.glow)
        for (const o of fx.mesh.children) o.material.dispose()
        fx.glow.material.dispose()
      }
      pool.clear()
    }
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
    }
    if (fx.fort) {
      // 지오메트리는 fortGeo가 공유한다 — 여기서 버리는 건 재질 셋뿐이다
      for (const m of [fx.fort.steel, fx.fort.hot, fx.fort.fire]) m.dispose()
      this.scene.remove(fx.fort.grp)
    }
    if (fx.cap) {
      // 같은 규칙 — 지오메트리는 capitalGeo가 공유하므로 재질만 버린다
      for (const m of [fx.cap.mats.steel, fx.cap.mats.hot, fx.cap.mats.fire]) m.dispose()
      this.scene.remove(fx.cap.grp)
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
    // 조르그가 만든 것에는 회로 불빛이 들어온다 — 요새는 붉게, 모함은 자주로.
    // (같은 지도를 쓰되 색만 다르다. 색 하나로 "저건 다른 물건"이 읽힌다.)
    if (b.role === 'battery') return { tone: 0xff2b3f, base: 0.95, map: this.circuitFor(pi) }
    if (b.role === 'hive') return { tone: 0xff2a55, base: 1.05, map: this.circuitFor(pi + 7) }
    // 초엘리트 — 회로가 아니라 **용광로 이음매**처럼 붉게 탄다. 같은 지도를
    // 쓰되 색이 주홍이라 모함(자홍)과 갈린다.
    if (b.role === 'siege') return { tone: 0xff3b1f, base: 1.05, map: this.circuitFor(pi + 13) }
    // 모성 — 부술 수 없는 물건이라 role이 없다. 회로가 제일 어둡게 깔린다:
    // 이놈의 빛은 몸통이 아니라 외눈에서 나온다(attachDoomFx).
    if (b.mothership) return { tone: 0xff1717, base: 0.7, map: this.circuitFor(pi + 21) }
    return { tone: colorOf(b.type, pi), base: spec.emis, map: null }
  }

  makeBodyFx(b) {
    const spec = MATS[b.type] ?? MATS.rock
    const pi = paletteIndex(b.id, b.type)
    const em = this.emissiveFor(b, pi, spec)
    const isDebris = b.type === 'debris'
    // 파편은 구체 텍스처 대신 각진 사면체 + 단색을 쓴다 — 몇 픽셀짜리 크기에서는
    // 표면 무늬가 안 보이므로, 무늬 대신 각(edge) 음영으로 "조각"을 읽힌다.
    const mesh = new THREE.Mesh(isDebris ? this.debrisGeo : this.sphereGeo, new THREE.MeshStandardMaterial(
      isDebris
        ? { color: colorOf(b.type, pi), roughness: spec.rough, metalness: spec.metal, flatShading: true }
        : {
          map: this.texFor(b.type, pi), color: 0xffffff,
          roughness: spec.rough, metalness: spec.metal,
          emissiveMap: em.map,
          emissive: new THREE.Color(em.tone), emissiveIntensity: em.base,
        }
    ))
    if (isDebris) {
      // 조각마다 제각각 기운 자세로 시작한다 — 다 같은 각도면 사면체 여럿이
      // 찍어낸 듯 똑같이 보인다. 굴러가는 동안은 기존 spin이 이어서 돌린다.
      mesh.rotation.set(Math.random() * 6.29, Math.random() * 6.29, Math.random() * 6.29)
    } else {
      mesh.rotation.x = Math.PI / 2 - 0.35   // 극축을 살짝 눕혀 탑다운에서도 자전이 보이게
    }
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
      mesh, ring, hpArc, hpKey: -1, pi, spin: 0.15 + Math.random() * 0.5, role: null, fort: null,
      emisTone: em.tone, emisBase: em.base, phase: Math.random() * 6.28,
    }
    this.bodyFx.set(b.id, fx)
    if (b.role) this.attachRoleFx(fx, b)
    if (b.role === 'battery') this.attachFortFx(fx)
    // 기함 셋 — 저마다 다른 구조물이 선다(capitalParts 주석).
    // 모성은 role이 없다(부술 수 없는 물건이라 태그를 안 붙였다) — mothership으로 묻는다.
    else if (b.role === 'hive') this.attachHiveFx(fx)
    else if (b.role === 'siege') this.attachSiegeFx(fx)
    else if (b.mothership) this.attachDoomFx(fx)
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
    fx.fort = { grp, core, beads, steel, hot, fire }
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

  // ─── 기함 셋의 구조물 ───────────────────────────────────────
  // 셋이 같은 뼈대를 쓴다: 그룹 하나 + 재질 셋(steel·hot·fire) + 달아오르는
  // 값 하나(heat 0~1). 다른 것은 **무엇을 세우느냐**뿐이고, 그게 곧 그 물건이
  // 하는 일이다(capitalParts 주석).
  //
  // (D, U, V)는 특징면이 앉는 정규직교 틀이다. 요새와 같은 수법으로,
  // 특징면을 정확히 +x(공의 옆구리 실루엣)에 두면 탑다운에서 선 하나가 되므로
  // 카메라 쪽으로 살짝 들어 올린 자리에 앉힌다.
  capFrame(tilt = CAP_TILT) {
    const D = new THREE.Vector3(Math.cos(tilt), 0, Math.sin(tilt))
    const U = new THREE.Vector3(0, 1, 0)
    const V = new THREE.Vector3().crossVectors(D, U).normalize()
    return { D, U, V, X: new THREE.Vector3(1, 0, 0), Z: new THREE.Vector3(0, 0, 1) }
  }

  // 반지름 rad 짜리 고리를 축 D 둘레로 **구체 겉면에 딱 맞게** 앉힌다
  // (중심은 그만큼 안쪽 — 안 그러면 고리가 허공에 뜬다).
  ringOnAxis(grp, geo, mat, rad, D, push = 0) {
    const m = new THREE.Mesh(geo, mat)
    m.position.copy(D).multiplyScalar(Math.sqrt(Math.max(0, 1 - rad * rad)) + push)
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), D)
    grp.add(m)
    return m
  }

  // ── 모함 — 격납 아가리 ──
  attachHiveFx(fx) {
    const G = this.capitalGeo, grp = new THREE.Group()
    const M = capitalMats(0x480d1c, 0xff2a55, 0xffd0cf)
    const { D, U, V } = this.capFrame()
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); grp.add(m); return m }
    // 아가리 두 겹 — 겉 테와 안 테. 위에서 보면 이게 곧 격납구다.
    this.ringOnAxis(grp, G.maw, M.steel, HIVE_MAW, D)
    this.ringOnAxis(grp, G.mawIn, M.steel, HIVE_MAW * 0.62, D, 0.06)
    // 워프 문 — 아가리 안쪽을 채우는 원판. 요새를 실어 낼 때 여기가 터진다.
    const gate = this.ringOnAxis(grp, G.gate, M.fire, HIVE_MAW * 0.74, D, 0.05)
    gate.renderOrder = 9
    // 계류 레일 — 적도를 감는 얇은 고리. 탑다운에서 원으로 보인다.
    add(G.rail, M.steel)
    // 계류 꽂이 여섯 — 레일 위에 박힌 블록. **여기에 요새가 물려 있었다**는
    // 그림이고, 아가리와 함께 "실어 나르는 배"를 만드는 나머지 절반이다.
    const pods = []
    for (let i = 0; i < HIVE_PODS; i++) {
      const a = i / HIVE_PODS * Math.PI * 2
      const p = add(G.plate, M.steel)
      p.position.set(Math.cos(a) * 1.02, Math.sin(a) * 1.02, 0)
      p.scale.set(0.34, 0.17, 0.17)
      p.rotation.z = a
      pods.push(p)
      const e = add(G.ember, M.hot)          // 꽂이의 신호등
      e.position.set(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0)
      e.scale.setScalar(0.34)
      pods.push(e)
    }
    this.scene.add(grp)
    fx.cap = { grp, mats: M, hot: [gate], swell: [0.62, 0.42], spin: 0.22 }
  }

  // ── 초엘리트 — 박격 실로 ──
  attachSiegeFx(fx) {
    const G = this.capitalGeo, grp = new THREE.Group()
    const M = capitalMats(0x3a0a10, 0xff3b1f, 0xfff0d6)
    const { D, U, V, X } = this.capFrame(SIEGE_TILT)
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); grp.add(m); return m }
    // 장갑 목걸이 — 실로 뿌리를 감는다. 통들이 허공에서 시작하지 않게 한다.
    this.ringOnAxis(grp, G.collar, M.steel, 0.72, D)
    // 실로 넷 — D 둘레에서 부챗살로 벌어져 나간다. 벌어지는 각(SPLAY)이
    // 있어야 넷이 한 덩어리로 안 보이고, 위에서 봐도 넷으로 읽힌다.
    // 0.95는 대략 44° — 넷이 확실히 갈리면서도 아직 한 묶음으로 보이는 폭이다.
    const SPLAY = 0.95
    const mouths = []
    for (let i = 0; i < SIEGE_SILOS; i++) {
      const th = i / SIEGE_SILOS * Math.PI * 2 + Math.PI / 4
      const off = U.clone().multiplyScalar(Math.cos(th)).addScaledVector(V, Math.sin(th))
      // 뿌리는 목걸이 위, 방향은 D에서 그 방향으로 조금 기울인 것
      const dir = D.clone().addScaledVector(off, SPLAY).normalize()
      const base = D.clone().multiplyScalar(0.69).addScaledVector(off, 0.5)
      const t = add(G.tube, M.steel)
      t.position.copy(base)
      t.quaternion.setFromUnitVectors(X, dir)
      t.scale.set(SIEGE_SILO_L, SIEGE_SILO_R, SIEGE_SILO_R)
      // 아귀 — 통 끝의 테와 그 안의 불. 잠금이 찰수록 여기가 달아오른다.
      const tip = base.clone().addScaledVector(dir, SIEGE_SILO_L)
      const rim = add(G.mouth, M.steel)
      rim.position.copy(tip)
      rim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
      const e = add(G.ember, M.fire)
      e.position.copy(tip.clone().addScaledVector(dir, -0.06))
      e.renderOrder = 9
      mouths.push(e)
    }
    // 장갑판 여섯 — 적도를 두른 두꺼운 판. 체력 3이 덩치만이 아니라
    // **껍데기**로도 보이게 한다.
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2
      const p = add(G.plate, M.steel)
      p.position.set(Math.cos(a) * 0.97, Math.sin(a) * 0.97, 0)
      p.scale.set(0.2, 0.46, 0.2)
      p.rotation.z = a
    }
    this.scene.add(grp)
    fx.cap = { grp, mats: M, hot: mouths, swell: [0.5, 1.0], spin: 0 }
  }

  // ── 모성 — 띠와 가시와 눈 ──
  attachDoomFx(fx) {
    const G = this.capitalGeo, grp = new THREE.Group()
    const M = capitalMats(0x140306, 0xff1717, 0xff6a4a)
    const { D, X } = this.capFrame()
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); grp.add(m); return m }
    // 강철 띠 — 두껍다. 가스 행성의 고리와 갈리는 것은 두께와 아래의 이빨이다.
    add(G.girdle, M.steel)
    // 사출구 열둘 — 띠에 박혀 사방으로 뻗은 가시. **광선이 사방으로 나가는
    // 물건**이라 총구가 하나일 수 없다. 길이를 번갈아 줘서 톱니로 읽히게 한다.
    for (let i = 0; i < DOOM_SPIKES; i++) {
      const a = i / DOOM_SPIKES * Math.PI * 2
      const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0)
      const s = add(G.spike, M.steel)
      s.position.copy(dir).multiplyScalar(1.0)
      s.quaternion.setFromUnitVectors(X, dir)
      s.scale.set(i % 2 ? 0.42 : 0.66, 1, 1)
      const e = add(G.ember, M.hot)          // 가시 끝의 점화구
      e.position.copy(dir).multiplyScalar(1.0 + (i % 2 ? 0.42 : 0.66))
      e.scale.setScalar(0.3)
    }
    // 외눈 — 이 판에서 제일 큰 렌즈. 부술 수 없는 물건의 얼굴이다.
    const rim = this.ringOnAxis(grp, G.lensRim, M.steel, 0.40, D)
    rim.scale.setScalar(1)
    const lens = add(G.lens, M.fire)
    lens.position.copy(D).multiplyScalar(0.94)
    lens.renderOrder = 9
    this.scene.add(grp)
    // 눈은 **작아야 눈이다.** 0.98로 뒀더니 렌즈 반경 0.34가 그대로 그려져
    // 몸통에서 튀어나온 흰 공이 됐고(가산 합성이라 하얗게 탔다), 그러면
    // 얼굴이 아니라 전구다. 0.62면 몸통에 박힌 렌즈로 읽힌다.
    fx.cap = { grp, mats: M, hot: [lens], swell: [0.62, 0.08], spin: 0.14 }
  }

  // 기함이 얼마나 달아올랐는가(0~1)와 어디를 보고 있는가(각).
  // 값의 출처가 등급마다 다르다 — 그게 곧 그 물건이 무엇을 세는 시계인지다:
  //   모함     — 다음 증원까지. 문이 밝아지면 곧 뭔가 나온다.
  //   초엘리트 — 잠금 진행도. 아귀가 하얗게 타면 곧 쏜다.
  //   모성     — 늘 최대. 이미 쏘고 있다.
  capAim(b) {
    const g = this.game
    const e = g.earth
    if (b.role === 'siege') {
      let u = 0, aim = null
      for (const S of g.sieges ?? []) {
        if (S.from !== b) continue
        if (S.state === 'lock') { u = Math.max(u, Math.min(1, S.t / CFG.SIEGE_LOCK_TIME)); aim = S.cue }
        else if (S.state === 'fly') u = Math.max(u, 1)
      }
      // 물고 있으면 그 공을, 아니면 지구를 본다. 요새의 총구가 예외 없이
      // 지구를 향하는 것과 같은 규칙이되(fortAim), 이놈이 실제로 겨누는
      // 것은 큐볼이므로 물고 있는 동안만 거길 본다.
      const t = aim && aim.alive ? aim : e
      return { a: Math.atan2(t.pos.y - b.pos.y, t.pos.x - b.pos.x), u }
    }
    if (b.role === 'hive') {
      const span = g.hiveSent ? CFG.HIVE_PERIOD : CFG.HIVE_FIRST
      const u = Math.min(1, Math.max(0, (g.hiveT ?? 0) / Math.max(1, span)))
      return { a: null, u: 0.25 + 0.75 * u * u }
    }
    return { a: null, u: 1 }        // 모성
  }

  // 역할에 딸린 **그림**을 붙인다. 예전엔 여기서 태그마다 점선 링을 둘렀는데,
  // 그건 그림이 아니라 UI였다 — 공 스무 개가 저마다 회전하는 파선 고리를 두르면
  // 판 위에 정보가 아니라 무늬만 남는다. 태그는 색·무늬·배지(Icons)가 이미
  // 말하고 있으므로 링은 걷어냈고, 여기 남은 둘은 **그 천체 자체의 생김새**다.
  //   가스 행성 — 위에서 내려다본 고리
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
    if (b.role === 'unstable') {
      // 껍데기를 **갈래 수만큼** 쪼개 둔다. 일곱 조각이면 일곱 발이 나간다 —
      // 세어 보면 알 수 있는 정보를 굳이 글로 안 적어도 되게, 판 위에 그려 둔다.
      // (조각은 판정 원 안쪽에 눕는다. 공이 커지는 게 아니라 무늬가 도는 것이다.)
      const grp = new THREE.Group()
      const n = CFG.UNSTABLE_SHARDS, step = Math.PI * 2 / n, gap = 0.17
      const tone = colorOf(b.type, fx.pi)
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.98, 8, 1, k * step + gap / 2, step - gap), new THREE.MeshBasicMaterial({
          color: tone, transparent: true, opacity: 0.42,
          depthTest: false, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        }))
        m.renderOrder = 3
        grp.add(m)
      }
      this.scene.add(grp)
      // 느리게 돈다 — 가스 고리(0.12)보다 조금 빠르게. 갈라진 것이 아직
      // 붙어 있다는 느낌이라 완전히 멎어 있으면 그냥 무늬로 읽힌다.
      fx.role = { grp, spin: 0.22 }
      return
    }
  }

  // ─── 터지기 직전의 조르그 ────────────────────────────────────
  // 흰빛으로 달아오르고, 부풀고, 떤다. 0.45초짜리 정지 프레임이라
  // (CFG.ZORG_BLAST_LEAD) 값은 전부 그 안에서 다 돌아야 한다.
  // **실시간으로 움직인다** — 여기까지 오면 판은 이미 멈춰 있을 수 있다.
  drawDying(fx, b, r) {
    const u = 1 - b.dying / CFG.ZORG_BLAST_LEAD          // 0 → 1
    const beat = Math.sin(u * 46) * 0.5 + 0.5             // 떨림
    const j = r * 0.05 * (1 - u) * (beat * 2 - 1)
    fx.mesh.visible = true
    fx.mesh.position.set(b.pos.x + j, b.pos.y - j, 0)
    fx.mesh.scale.setScalar(r * (1 + 0.28 * u * u))       // 마지막에 부푼다
    fx.mesh.material.emissiveIntensity = 1 + 9 * u * u
    fx.mesh.material.color.setRGB(1 + 3 * u, 1 + 3 * u, 1 + 3 * u)
    fx.ring.visible = false
    fx.hpArc.visible = false
    // 구조물은 끈다 — 요새의 발사기도, 기함 셋의 몸체도. 빛기둥이 그 자리를
    // 대신하므로 남겨 두면 터지는 중에 총구가 멀쩡히 서 있는 그림이 된다.
    if (fx.fort) fx.fort.grp.visible = false
    if (fx.cap) fx.cap.grp.visible = false
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
      // (천체 종류는 makeBody에서 한 번 정해진 뒤 바뀌지 않는다. 예전엔 여기서
      //  b.type이 바뀐 경우 재질을 갈아 끼웠는데, 그 분기를 켜는 기능이 없어져
      //  한 번도 실행되지 않는 코드로 남아 있었다 — fx.type도 같이 걷었다.)
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
      // ── 기함 셋의 구조물 ──
      // 요새와 같은 규칙이다: **워프해 들어오는 동안에도 그린다.** 도착하는 그
      // 순간부터 이미 그 물건이어야 한다. 몸통과 같은 곡선으로 같이 자란다.
      if (fx.cap) {
        const show = b.alive && !waiting
        fx.cap.grp.visible = show
        if (show) {
          const C = fx.cap
          const { a, u } = this.capAim(b)
          const grow = b.warp > 0 ? 0.05 + 0.95 * (1 - Math.pow(b.warp, 3)) : 1
          C.grp.position.set(b.pos.x, b.pos.y, 0)
          C.grp.scale.setScalar(r * grow)
          // 겨누는 놈은 그쪽을 보고(초엘리트), 아닌 놈은 저 혼자 돈다(모함·모성).
          if (a !== null) C.grp.rotation.z = a
          else C.grp.rotation.z += C.spin * dt
          const beat = 1 + 0.16 * Math.sin(this.lockT * 7.5)
          C.mats.steel.emissiveIntensity = 0.06 + 0.40 * u
          C.mats.hot.opacity = (0.28 + 0.52 * u) * beat
          C.mats.fire.opacity = 0.18 + 0.52 * u
          // 부푸는 폭은 등급마다 다르다(C.swell) — 실로 아귀는 크게 타올라야
          // "곧 쏜다"가 되고, 모성의 눈은 이미 최대라 숨만 쉰다.
          const k = (C.swell[0] + C.swell[1] * u) * beat
          for (const h of C.hot) h.scale.setScalar(k)
        }
      }
      if (fx.role?.grp) {   // 가스 행성의 고리 — 판정 반경에 맞춰 깐다
        const show = b.alive && !waiting
        fx.role.grp.visible = show
        if (show) {
          fx.role.grp.position.set(b.pos.x, b.pos.y, 0)
          fx.role.grp.scale.setScalar(mr)
          fx.role.grp.rotation.z += fx.role.spin * dt
        }
      }
      // ── 부서졌지만 아직 안 터진 조르그 ──
      // 제자리에 얼어붙은 채 흰빛으로 달아오르고 떤다. 그 위로 빛기둥이
      // 뻗는다(Explosions.zorgCharge) — 만화의 '터지기 직전' 정지 프레임이다.
      // (죽은 천체는 stepBodies가 건너뛰므로 위치는 저절로 고정된다.)
      if (!b.alive) {
        if (b.dying > 0) this.drawDying(fx, b, r)
        continue
      }

      // 워프인 — 게임 시간이 멈춰 있어도 보여야 하므로 실시간 dt로 감쇠시킨다
      // 파편은 표식(ring)이 꺼져 있어 판정 반경(r) 그대로 그리면 화면에서
      // 사실상 사라진다 — 대신 markerRadius(mr, MIN_DEBRIS_PX 바닥값)로 그린다.
      let scale = b.type === 'debris' ? mr : r
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
      if ((fx.fort || fx.cap) && b.warp <= 0 && !fx.tinted)
        fx.mesh.material.emissiveIntensity = fx.emisBase * (0.7 + 0.3 * Math.sin(this.lockT * 1.7 + fx.phase))
      fx.mesh.position.set(b.pos.x, b.pos.y, 0)
      // 가스 행성은 고리가 판정 반경을 채우므로 구체를 그만큼 줄인다 —
      // 공이 커지는 게 아니라 같은 자리에 다른 그림이 들어가는 것이다.
      fx.mesh.scale.setScalar(b.role === 'volatile' ? scale * GAS_CORE : scale)
      fx.mesh.rotation.y += fx.spin * dt

      // ── 혜성의 코마 ──
      // 꼬리는 **태양 반대쪽**으로 뻗는다(진행 방향이 아니다 — 실제 혜성이 그렇고,
      // 그 그림 하나로 "저건 궤도를 도는 공이 아니다"가 읽힌다).
      // 트레일(궤적선)과 다른 물건이다: 저건 지나온 길이고 이건 지금 타는 얼음이다.
      if (b.comet) {
        const rr = Math.hypot(b.pos.x, b.pos.y) || 1
        const away = Math.atan2(b.pos.y, b.pos.x)
        // 꼬리 — 태양 반대쪽으로 길게. 항력을 낮게 줘서 멀리까지 흐른다.
        this.parts.burst(b.pos.x, b.pos.y, {
          n: 3, color: 0xbae6fd, speed: 70, size: 15, ttl: 2.4, drag: 0.22,
          spread: 0.55, dir: away,
        })
        // 코마 — 머리를 감싸는 옅은 빛. 꼬리보다 짧고 넓게 퍼진다.
        this.parts.burst(b.pos.x + b.pos.x / rr * scale * 0.6, b.pos.y + b.pos.y / rr * scale * 0.6, {
          n: 2, color: 0xffffff, speed: 30, size: 9, ttl: 1.0, spread: 2.2, drag: 1.4,
        })
      }

      // 핵을 맞을 때마다 그을음이 남는다(부서지진 않는다) + 히트 플래시 (§14.5)
      // 파편은 damage()가 애초에 걸러내 hitFlash·scorch가 절대 안 붙는다 — 여기서
      // 건드리면 늘 k=1이라 파편 고유 색(colorOf)이 매 프레임 흰색으로 덮인다.
      if (b.type !== 'debris') {
        const c = fx.mesh.material.color
        if (b.hitFlash > 0) c.setRGB(2.4, 2.4, 2.4)
        else { const k = 1 - Math.min(3, b.scorch || 0) * 0.15; c.setRGB(k, k, k) }
      }

      fx.ring.position.set(b.pos.x, b.pos.y, 0)
      this.fitRing(fx.ring, mr * 1.22)
      // 표적=로즈(맥동), 지구=파랑(치면 즉사), 중립=흰색(자유롭게 쓰는 큐볼).
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

      // ── 체력 호 — 남은 칸이 줄면 호가 짧아지고 색이 식는다 ──
      // (여기는 살아 있는 공만 도달한다 — 죽은 공은 위에서 이미 껐다.)
      //
      // 다친 공에만 그리던 것을 **대형 요새에는 항상** 그린다. 체력 2짜리 요새는
      // 멀쩡할 때 아무 표시가 없다가 한 대 맞으면 그제야 호가 생겼다 — 즉
      // "저건 두 방짜리"라는 정보가 치기 전에는 화면에 없고, 치고 나서야
      // 나타났다가 부수면 사라진다. 정작 그 정보가 필요한 건 **치기 전**이다.
      // (모든 공으로 넓히지는 않는다. 중립 행성도 체력 3이라 판 전체가 호로
      //  뒤덮이고, 그러면 아무것도 안 두른 것과 같아진다.)
      const hpMax = b.hpMax ?? CFG.PLANET_HP, hp = b.hp ?? hpMax
      const hurt = solid && (hp < hpMax || (b.role === 'battery' && hpMax > 1))
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

  // ─── 조르그 탄두 ────────────────────────────────────────────
  // 내 탄과 **다른 풀**을 쓴다. 지오메트리도 색도 자세도 다르고(foeMissileParts),
  // 무엇보다 배열이 갈려 있어서(game.foeShots) 여기서 섞을 이유가 없다.
  syncFoeShots(dt) {
    const shots = this.game.foeShots ?? []
    if (this.foeFx.size > shots.length) {
      const live = new Set(shots)
      for (const [m, fx] of this.foeFx) {
        if (live.has(m)) continue
        this.scene.remove(fx.mesh, fx.glow)
        for (const o of fx.mesh.children) o.material.dispose()
        fx.glow.material.dispose()
        this.foeFx.delete(m)
      }
    }
    for (const m of shots) {
      let fx = this.foeFx.get(m)
      if (!fx) {
        const mat = (c) => new THREE.MeshBasicMaterial({
          color: c, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        })
        const mesh = new THREE.Group()
        const parts = [
          new THREE.Mesh(this.foeGeo.body, mat(FOE_TONE.hull)),
          new THREE.Mesh(this.foeGeo.head, mat(FOE_TONE.head)),
          new THREE.Mesh(this.foeGeo.belt, mat(FOE_TONE.belt)),
        ]
        // 안정핀 넷 — 같은 판을 90°씩 돌려 십자로 세운다
        for (let i = 0; i < 2; i++) {
          const f = new THREE.Mesh(this.foeGeo.fin, mat(FOE_TONE.fin))
          f.rotation.x = i * Math.PI / 2
          parts.push(f)
        }
        for (const o of parts) o.renderOrder = 9
        mesh.add(...parts)
        mesh.renderOrder = 9
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.glowTex, color: FOE_TONE.glow, transparent: true,
          depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0.9,
        }))
        glow.renderOrder = 5
        this.scene.add(mesh, glow)
        fx = { mesh, glow, lx: m.pos.x, ly: m.pos.y, roll: 0 }
        this.foeFx.set(m, fx)
      }
      if (!m.alive) { fx.mesh.visible = false; fx.glow.visible = false; continue }
      // 내 탄보다 **덩치가 크다**(6.5 → 8.2px). 유도탄이고 작약이 9Mt짜리라
      // 화면에서도 더 무거운 물건으로 보여야 한다.
      const r = Math.max(3.0, 8.2 * this.rig.worldPerPx)
      const v = Math.hypot(m.vel.x, m.vel.y) || 1
      fx.mesh.visible = true; fx.glow.visible = true
      fx.mesh.position.set(m.pos.x, m.pos.y, r)
      fx.mesh.scale.setScalar(r)
      fx.mesh.rotation.z = Math.atan2(m.vel.y, m.vel.x)
      // 진행축을 중심으로 굴린다 — 조준된 물건이 아니라 던져진 물건으로 읽힌다
      fx.roll += 5.2 * dt
      fx.mesh.rotation.x = fx.roll
      const tx = m.pos.x - m.vel.x / v * r * 1.0, ty = m.pos.y - m.vel.y / v * r * 1.0
      fx.glow.position.set(tx, ty, r)
      fx.glow.scale.setScalar(r * 3.2)
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

    // ── 조르그 탄두의 궤적 ──
    // 같은 리본이되 **붉다.** 내 탄이 흰 아치를 그리는 동안 이쪽은 곧은 붉은
    // 줄이라, 화면에 둘이 같이 있어도 어느 쪽이 내 것인지 헷갈릴 자리가 없다.
    for (const m of g.foeShots ?? []) {
      if (m.path.length < 2) continue
      const k = m.alive ? 1 : Math.max(0, 1 - m.fade / CFG.SHOT_TRAIL_FADE)
      if (k <= 0) continue
      this.ribbon(m.path, m.alive ? 4.2 : 2.4, FOE_TONE.trail,
        { opacity: m.alive ? 0.95 : 0.4 * k, z: 1, depth: true })
    }

    // ── 초엘리트의 조준선 ──
    // 잠금 중에는 **어느 공을 어느 살에서 칠 것인가**가 판 위에 그려진다.
    // 요새의 광선 조준선과 같은 구실이지만 말하는 것이 다르다: 광선은
    // "이 선에서 비켜라"이고, 이쪽은 "이 공이 지구로 온다"다. 그래서 선이
    // 둘이다 — 초엘리트에서 폭심까지(탄이 날 길), 그리고 폭심에서 밀려갈
    // 방향으로 뻗은 짧은 화살(공이 갈 쪽).
    for (const S of g.sieges ?? []) {
      if (S.state !== 'lock' || !S.from.alive || !S.cue?.alive) continue
      const u = Math.min(1, S.t / CFG.SIEGE_LOCK_TIME)
      // 잠금이 찰수록 굵고 밝아진다 — 남은 시간을 선 하나로 읽을 수 있다.
      this.ribbon([S.from.pos, { x: S.ax, y: S.ay }], 1.4 + 2.2 * u, FOE_TONE.trail,
        { fade: false, opacity: 0.30 + 0.5 * u, z: -1, tailWidth: 1, depth: true })
      // 밀려갈 방향 — 폭심에서 그 방향으로 판정 원 두 개 길이만큼.
      const L = hitRadiusOf(S.cue) * 2.2
      this.ribbon([
        { x: S.ax, y: S.ay },
        { x: S.ax + Math.cos(S.ang) * L, y: S.ay + Math.sin(S.ang) * L },
      ], 2.6 + 2.6 * u, 0xffb03a, { fade: true, opacity: 0.45 + 0.45 * u, z: 0, tailWidth: 1 })
    }

    // 조준선 + 큐 예측 (§14.3 개정)
    if (g.canAim && !g.bare) {
      const p = g.launchPos()
      // 조준선(지구 → 발사대). 손이 손잡이에 닿아 있는 동안에는 굵고 밝게 —
      // 지금 무엇을 쥐고 있는지가 이 선 하나로 읽혀야 한다.
      const grab = g.aimGrab
      this.ribbon([g.earth.pos, p], grab ? 3.2 : 2, 0x3b82f6,
        { fade: false, opacity: grab ? 0.75 : 0.35, z: -3, tailWidth: 1, depth: true })
      // 발사 고리 — 손잡이가 도는 원이자 **잡히는 자리 그 자체**다(AimPointer는
      // 이 원 둘레를 판정면으로 쓴다). 그리는 원과 잡히는 원이 같아야 거짓말이
      // 아니다. 손이 닿아 있는 동안에만 뜬다 — 평소에도 떠 있으면 궤도선과
      // 섞여서 지구가 저 원을 도는 걸로 읽힌다.
      if (grab) {
        const e = g.earth.pos, R = CFG.LAUNCH_OFFSET, ring = []
        for (let i = 0; i <= 72; i++) {
          const a = i / 72 * Math.PI * 2
          ring.push({ x: e.x + Math.cos(a) * R, y: e.y + Math.sin(a) * R })
        }
        this.ribbon(ring, 1.4, 0x3b82f6, { fade: false, opacity: 0.28, z: -3, tailWidth: 1, depth: true })
      }
      const pred = g.predictPath()
      if (pred.pts.length > 1) {
        // 예측선도 잡는 물건이다(AimPointer) — 지구가 패널 뒤로 들어가는 화면에서는
        // 이 선이 유일하게 트인 손잡이다. 손이 닿으면 여기도 같이 굵어진다.
        this.ribbon(pred.pts, grab ? 3.4 : 2.6, PRED_TONE[pred.outcome] ?? 0x67e8f9, { fade: false, opacity: 0.9, z: 0, tailWidth: 1 })
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
