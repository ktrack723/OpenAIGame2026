// 명세 → 3D 캐릭터. 외부 모델 파일 없이 프리미티브만 조립한다.
// 받아올 에셋이 없다는 뜻이고, 무엇보다 외모 태그가 바뀌면 즉시 다시 세울 수 있다.
//
// 구조: root(무대가 위치를 잡는다) → body(캐릭터가 흔들림·점프를 준다)
// 이 둘을 나누지 않으면 캐릭터의 애니메이션이 무대의 배치를 매 프레임 덮어써서
// 두 사람이 같은 자리에 겹쳐 선다.

import * as THREE from 'three'

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.68, metalness: 0.05, ...opts })

const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
const ball = (r, m, seg = 18) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), m)
const tube = (rt, rb, h, m, seg = 12) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m)

function at(mesh, x, y, z) {
  mesh.position.set(x, y, z)
  return mesh
}

// 기본 치수 (키 1.0 기준)
const HIP_Y = 0.6
const TORSO_H = 0.44
const NECK_H = 0.05
const HEAD_R = 0.165

export function buildCharacter(spec) {
  const root = new THREE.Group() // 무대가 옮긴다
  const body = new THREE.Group() // 캐릭터가 흔든다
  root.add(body)

  const disposables = []
  const track = (m) => {
    disposables.push(m)
    return m
  }

  const skinM = track(mat(spec.skin))
  const hairM = track(mat(spec.hair.color, { roughness: 0.9 }))
  const clothM = track(mat(spec.outfit.color))
  const darkM = track(mat('#232630'))
  const metalM = track(mat('#c9ccd4', { metalness: 0.75, roughness: 0.3 }))
  const auraM = track(
    mat(spec.aura, { emissive: new THREE.Color(spec.aura), emissiveIntensity: 0.7, roughness: 0.45 }),
  )

  const O = spec.outfit.type
  const bulky = O === 'hoodie' || O === 'knit'
  const rTop = (0.185 + spec.build * 0.075) * (bulky ? 1.1 : 1) // 어깨
  const rBot = (0.15 + spec.build * 0.04) * (bulky ? 1.08 : 1) // 허리
  const SQUASH = 0.62 // 앞뒤로 납작하게 — 원통이 아니라 사람으로 보이게

  // ── 다리
  const legM = O === 'dress' ? clothM : track(mat('#2b2e3c'))
  const bootsOn = spec.accessories.includes('boots')
  for (const side of [-1, 1]) {
    const leg = at(tube(0.072, 0.062, HIP_Y, legM, 10), side * 0.088, HIP_Y / 2, 0)
    leg.scale.z = 0.9
    body.add(leg)
    const bootH = bootsOn ? 0.16 : 0.065
    const shoeM = bootsOn ? track(mat('#3b2c23')) : darkM
    body.add(at(box(0.125, bootH, 0.21, shoeM), side * 0.088, bootH / 2, 0.026))
  }

  // ── 몸통 (자세: 앞으로 굽음)
  const spine = new THREE.Group()
  spine.position.y = HIP_Y
  spine.rotation.x = spec.posture * 0.26
  body.add(spine)

  const torso = at(tube(rTop, rBot, TORSO_H, clothM, 12), 0, TORSO_H / 2, 0)
  torso.scale.z = SQUASH
  spine.add(torso)
  // 어깨를 둥글게 덮어 팔 이음매를 가린다
  const shoulderCap = at(ball(rTop, clothM, 14), 0, TORSO_H, 0)
  shoulderCap.scale.set(1, 0.55, SQUASH)
  spine.add(shoulderCap)

  const SH_Y = TORSO_H - 0.04 // 어깨 높이

  // 옷 장식
  if (O === 'hoodie') {
    const hood = at(ball(rTop * 0.95, clothM, 14), 0, TORSO_H + 0.02, -rTop * 0.42)
    hood.scale.set(1, 0.8, 0.8)
    spine.add(hood)
    spine.add(at(box(rTop * 1.0, 0.11, 0.03, track(mat(spec.outfit.color, { roughness: 0.85 }))), 0, 0.13, rBot * SQUASH + 0.02))
  }
  if (O === 'shirt' || O === 'suit') {
    for (const side of [-1, 1]) {
      const lapel = at(box(0.075, 0.22, 0.025, darkM), side * 0.055, TORSO_H - 0.14, rTop * SQUASH * 0.92)
      lapel.rotation.z = side * 0.2
      spine.add(lapel)
    }
    if (O === 'suit') {
      spine.add(at(box(0.042, 0.19, 0.02, track(mat('#8d2f3f'))), 0, TORSO_H - 0.17, rTop * SQUASH * 0.95))
    }
  }
  if (O === 'jacket') {
    for (const side of [-1, 1]) {
      spine.add(
        at(box(0.085, TORSO_H * 0.9, 0.03, track(mat(spec.outfit.color, { metalness: 0.2 }))),
          side * rTop * 0.6, TORSO_H * 0.48, rTop * SQUASH * 0.88),
      )
    }
  }
  if (O === 'dress') {
    const skirt = at(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 14, 1, true), clothM), 0, -0.08, 0)
    skirt.material.side = THREE.DoubleSide
    skirt.scale.z = 0.85
    spine.add(skirt)
  }
  if (spec.accessories.includes('apron')) {
    spine.add(at(box(rTop * 1.1, TORSO_H * 0.8, 0.02, track(mat('#e8e3d8'))), 0, TORSO_H * 0.42, rTop * SQUASH * 0.95))
  }
  if (spec.accessories.includes('backpack')) {
    const bag = at(box(rTop * 1.3, TORSO_H * 0.75, 0.13, track(mat('#474a58'))), 0, TORSO_H * 0.55, -rTop * SQUASH - 0.06)
    spine.add(bag)
  }

  // ── 팔 (어깨 안쪽에 붙여 뜬 느낌을 없앤다)
  const arms = []
  const sleeveless = O === 'tank'
  const armM = sleeveless ? skinM : clothM
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * (rTop - 0.012), SH_Y, 0)
    shoulder.add(at(ball(0.058, armM, 12), 0, 0, 0)) // 어깨 관절
    shoulder.add(at(tube(0.05, 0.043, 0.36, armM, 10), 0, -0.19, 0))
    shoulder.add(at(ball(0.05, skinM, 12), 0, -0.37, 0)) // 손
    if (spec.accessories.includes('tattoo') && side === -1) {
      shoulder.add(at(tube(0.052, 0.048, 0.13, track(mat('#3d3556'))), 0, -0.22, 0))
    }
    if (spec.accessories.includes('watch') && side === 1) {
      shoulder.add(at(box(0.055, 0.035, 0.055, metalM), 0, -0.33, 0))
    }
    if (spec.accessories.includes('bandage') && side === 1) {
      shoulder.add(at(box(0.062, 0.045, 0.062, track(mat('#f0ece4'))), 0, -0.37, 0))
    }
    shoulder.rotation.z = side * 0.1
    spine.add(shoulder)
    arms.push(shoulder)
  }

  if (spec.accessories.includes('umbrella')) {
    const u = new THREE.Group()
    u.position.set(rTop + 0.12, SH_Y - 0.34, 0.04)
    u.add(at(tube(0.011, 0.011, 0.46, darkM, 8), 0, 0.12, 0))
    u.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.14, 12), auraM), 0, 0.4, 0))
    spine.add(u)
  }

  // ── 목 / 머리
  const neck = new THREE.Group()
  neck.position.y = TORSO_H
  spine.add(neck)
  neck.add(at(tube(0.047, 0.052, NECK_H + 0.03, skinM, 10), 0, NECK_H / 2, 0))

  const head = new THREE.Group()
  head.position.y = NECK_H + HEAD_R * 0.92
  neck.add(head)

  const skull = ball(HEAD_R, skinM, 22)
  skull.scale.set(1, 1.06, 0.94)
  head.add(skull)

  // 얼굴
  const eyeM = track(mat('#1c1c24'))
  const FZ = HEAD_R * 0.87
  for (const side of [-1, 1]) {
    head.add(at(ball(0.023, eyeM, 10), side * 0.062, 0.005, FZ))
    // 눈썹
    const brow = at(box(0.045, 0.011, 0.012, hairM), side * 0.062, 0.058, FZ * 0.96)
    brow.rotation.z = side * 0.08
    head.add(brow)
    if (spec.darkCircles) {
      head.add(at(box(0.05, 0.012, 0.01, track(mat('#b08c7e'))), side * 0.062, -0.032, FZ * 0.97))
    }
    if (spec.blush) {
      head.add(at(ball(0.026, track(mat('#e88b95')), 8), side * 0.1, -0.028, HEAD_R * 0.66))
    }
  }
  head.add(at(box(0.04, 0.009, 0.012, track(mat('#8a4a52'))), 0, -0.068, FZ * 0.98))
  if (spec.accessories.includes('mask')) {
    const m = at(ball(HEAD_R * 0.82, track(mat('#dfe4ea')), 14), 0, -0.055, HEAD_R * 0.28)
    m.scale.set(1, 0.62, 0.85)
    head.add(m)
  }

  // ── 머리카락: 두피를 덮는 캡 + 스타일별 덧붙임
  const HS = spec.hair.style
  const capR = HEAD_R * 1.045
  const capPhi = HS === 'buzz' ? Math.PI * 0.44 : Math.PI * 0.56
  const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 22, 18, 0, Math.PI * 2, 0, capPhi), hairM)
  cap.scale.set(1, 1.06, 0.94)
  cap.material.side = THREE.DoubleSide
  head.add(cap)
  // 앞머리
  if (HS !== 'buzz') {
    const fringe = at(box(HEAD_R * 1.5, 0.075, 0.05, hairM), 0, HEAD_R * 0.5, HEAD_R * 0.72)
    head.add(fringe)
  }

  if (HS === 'bob' || HS === 'long') {
    const len = HS === 'long' ? 0.36 : 0.17
    for (const side of [-1, 1]) {
      const s = at(box(0.062, len, 0.15, hairM), side * HEAD_R * 0.92, HEAD_R * 0.35 - len / 2, -0.01)
      head.add(s)
    }
    head.add(at(box(HEAD_R * 1.7, len, 0.06, hairM), 0, HEAD_R * 0.35 - len / 2, -HEAD_R * 0.82))
  }
  if (HS === 'ponytail') {
    const tail = at(tube(0.048, 0.028, 0.3, hairM, 10), 0, -0.02, -HEAD_R - 0.06)
    tail.rotation.x = -0.45
    head.add(tail)
  }
  if (HS === 'bun') head.add(at(ball(0.068, hairM, 12), 0, HEAD_R * 0.82, -HEAD_R * 0.55))
  if (HS === 'messy') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      const spike = at(
        new THREE.Mesh(new THREE.ConeGeometry(0.033, 0.1, 6), hairM),
        Math.cos(a) * HEAD_R * 0.62,
        HEAD_R * 0.82,
        Math.sin(a) * HEAD_R * 0.62,
      )
      spike.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6)
      head.add(spike)
    }
  }

  // ── 머리 소품
  if (spec.accessories.includes('glasses')) {
    const gm = track(mat('#2a2a33', { metalness: 0.35, roughness: 0.35 }))
    for (const side of [-1, 1]) {
      head.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.0075, 8, 18), gm), side * 0.062, 0.005, FZ * 0.99))
    }
    head.add(at(box(0.05, 0.008, 0.008, gm), 0, 0.005, FZ))
  }
  if (spec.accessories.includes('headphones')) {
    const arc = at(new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 1.08, 0.018, 8, 22, Math.PI), darkM), 0, 0.02, 0)
    head.add(arc)
    for (const side of [-1, 1]) {
      const cup = at(tube(0.048, 0.048, 0.035, auraM, 14), side * HEAD_R * 1.06, -0.005, 0)
      cup.rotation.z = Math.PI / 2
      head.add(cup)
    }
  }
  if (spec.accessories.includes('hat')) {
    head.add(at(tube(HEAD_R * 0.92, HEAD_R * 0.98, 0.11, clothM, 16), 0, HEAD_R * 0.82, 0))
    head.add(at(tube(HEAD_R * 1.55, HEAD_R * 1.55, 0.014, clothM, 20), 0, HEAD_R * 0.76, 0))
  }
  if (spec.accessories.includes('earring')) {
    for (const side of [-1, 1]) head.add(at(ball(0.014, metalM, 8), side * HEAD_R * 0.96, -0.04, 0))
  }
  if (spec.accessories.includes('scarf')) {
    const sc = at(new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.036, 8, 18), auraM), 0, 0.045, 0)
    sc.scale.z = 0.8
    neck.add(sc)
  }
  if (spec.accessories.includes('necklace')) {
    const n = at(new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 8, 20), metalM), 0, TORSO_H - 0.02, 0.01)
    n.rotation.x = Math.PI / 2
    n.scale.y = SQUASH
    spine.add(n)
    spine.add(at(ball(0.02, auraM, 10), 0, TORSO_H - 0.085, rTop * SQUASH * 0.85))
  }
  if (spec.accessories.includes('badge')) {
    spine.add(at(box(0.003, 0.19, 0.02, darkM), 0, TORSO_H - 0.11, rTop * SQUASH * 0.8))
    spine.add(at(box(0.062, 0.088, 0.008, track(mat('#eef1f5'))), 0, TORSO_H - 0.24, rTop * SQUASH * 0.82))
  }

  root.scale.setScalar(spec.height)

  // ── 애니메이션
  let t = Math.random() * 10
  let leanTarget = 0
  let lean = 0
  let shakeT = 0
  let bounceT = 0
  let reactTimer = 0
  const baseSpineX = spine.rotation.x

  return {
    group: root,
    spec,
    /** 캐릭터 높이(스케일 반영) — 카메라 프레이밍에 쓴다 */
    get topY() {
      return (HIP_Y + TORSO_H + NECK_H + HEAD_R * 2) * spec.height
    },

    update(dt) {
      t += dt
      const breath = Math.sin(t * 1.6) * 0.014
      torso.scale.set(1 + breath * 0.4, 1 + breath, SQUASH * (1 + breath * 0.4))
      head.position.y = NECK_H + HEAD_R * 0.92 + Math.sin(t * 1.6 + 0.4) * 0.006
      arms[0].rotation.x = Math.sin(t * 1.05) * 0.06
      arms[1].rotation.x = Math.sin(t * 1.05 + Math.PI) * 0.06

      if (reactTimer > 0) {
        reactTimer -= dt
        if (reactTimer <= 0) leanTarget = 0
      }
      lean += (leanTarget - lean) * Math.min(1, dt * 4)
      spine.rotation.x = baseSpineX + lean

      // 흔들림·점프는 body 에만 준다. root 는 무대가 쓰는 자리다.
      if (shakeT > 0) {
        shakeT -= dt
        body.position.x = Math.sin(shakeT * 55) * 0.028
        head.rotation.z = Math.sin(shakeT * 38) * 0.1
      } else {
        body.position.x = 0
        head.rotation.z *= 0.85
      }
      body.position.y = bounceT > 0 ? Math.abs(Math.sin((bounceT -= dt) * 11)) * 0.05 : 0
    },

    react(kind) {
      if (kind === 'good') {
        leanTarget = -0.13
        bounceT = 0.55
        reactTimer = 1
      } else if (kind === 'bad') {
        leanTarget = 0.19
        shakeT = 0.4
        reactTimer = 1
      }
    },

    setGaze(x) {
      head.rotation.y = THREE.MathUtils.clamp(x, -0.6, 0.6)
    },

    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
      })
      for (const m of disposables) m.dispose()
    },
  }
}
