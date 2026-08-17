// 무대. 2077년 어딘가의 네온 골목.
//
// 모바일을 먼저 생각한다: 픽셀비는 2로 묶고, 세로 화면에서는 카메라를 뒤로 빼서
// 두 사람이 전부 들어오게 한다.

import * as THREE from 'three'
import { buildCharacter } from './character.js'

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    // 캔버스를 그대로 읽어 스크린샷/테스트에 쓸 수 있게 남겨 둔다.
    // 이게 없으면 합성 직후 버퍼가 비워져서 drawImage 결과가 새까맣게 나온다.
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = false

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0a0812')
  scene.fog = new THREE.Fog('#0a0812', 3.4, 11)

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60)

  // ── 조명: 차가운 쪽과 따뜻한 쪽을 마주 세우되, 얼굴이 읽히게 정면 필을 넣는다.
  // 네온만 쓰면 분위기는 나오는데 인물이 진흙처럼 뭉개진다.
  scene.add(new THREE.HemisphereLight('#a89ee0', '#33294d', 2.4))
  const keyL = new THREE.PointLight('#4cd6ff', 14, 9, 1.1)
  keyL.position.set(-1.9, 1.9, 1.5)
  scene.add(keyL)
  const keyR = new THREE.PointLight('#ff5fbf', 14, 9, 1.1)
  keyR.position.set(1.9, 1.9, 1.5)
  scene.add(keyR)
  const fill = new THREE.DirectionalLight('#fff4e8', 2.0)
  fill.position.set(0.4, 2.2, 4)
  scene.add(fill)
  const rim = new THREE.DirectionalLight('#9ad6ff', 0.7)
  rim.position.set(-1, 3, -4)
  scene.add(rim)

  // ── 바닥
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: '#141024', roughness: 0.55, metalness: 0.35 }),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const grid = new THREE.GridHelper(40, 40, '#5a2f8f', '#241a3d')
  grid.position.y = 0.005
  grid.material.transparent = true
  grid.material.opacity = 0.5
  scene.add(grid)

  // ── 배경 간판들
  const signs = new THREE.Group()
  const signColors = ['#ff5fbf', '#4cd6ff', '#ffd166', '#7cff9e']
  for (let i = 0; i < 16; i++) {
    const c = signColors[i % signColors.length]
    const w = 0.16 + (i % 4) * 0.1
    const h = 0.5 + ((i * 7) % 9) * 0.14
    const s = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.05),
      new THREE.MeshStandardMaterial({
        color: c,
        emissive: new THREE.Color(c),
        emissiveIntensity: 0.85,
        roughness: 0.5,
      }),
    )
    const side = i % 2 === 0 ? -1 : 1
    s.position.set(side * (2.4 + ((i * 3) % 5) * 0.55), 0.9 + ((i * 5) % 7) * 0.34, -1.6 - ((i * 2) % 6) * 0.9)
    s.userData.phase = i * 1.7
    signs.add(s)
  }
  scene.add(signs)

  // ── 등장인물 두 명
  const slots = {
    client: { x: -0.82, faceTo: 0.35 },
    target: { x: 0.82, faceTo: -0.35 },
  }
  const actors = { client: null, target: null }

  function setActor(role, spec) {
    if (actors[role]) {
      scene.remove(actors[role].group)
      actors[role].dispose()
    }
    const actor = buildCharacter(spec)
    actor.group.position.x = slots[role].x
    actor.group.rotation.y = role === 'client' ? 0.42 : -0.42
    actor.setGaze(slots[role].faceTo)
    scene.add(actor.group)
    actors[role] = actor
    return actor
  }

  // ── 카메라 배치
  //
  // 화면 대부분은 UI 가 덮는다. 그래서 "화면 한가운데"가 아니라 "HUD 와 패널 사이의
  // 빈 띠" 한가운데에 인물이 오도록 맞춘다. 띠가 얇으면(주로 세로 폰) 전신 대신
  // 상반신으로 당겨서 얼굴이 읽히게 한다.
  const aim = new THREE.Vector3(0, 0.05, 0)
  let dist = 4.2
  let fovDeg = 40
  let spread = 0.82 // 두 사람 사이 거리(화면 방향에 따라 달라진다)

  function measureBand() {
    const H = canvas.clientHeight || 1
    const hud = document.getElementById('hud')
    const panel = document.getElementById('panel')
    const hudH = hud && hud.offsetParent !== null ? hud.getBoundingClientRect().height : 0
    const pr = panel ? panel.getBoundingClientRect() : null
    const centered = panel?.classList.contains('center')
    // 가운데 카드형 패널은 화면 중앙을 덮으므로 그 위쪽을 띠로 본다
    const bottom = !pr || pr.height === 0 ? H : centered ? pr.top : pr.top
    const top = hudH
    return { H, top, bottom: Math.max(top + 60, bottom), centered }
  }

  function reframe() {
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    const portrait = h > w
    const { H, top, bottom } = measureBand()
    const bandFrac = Math.max(0.18, Math.min(1, (bottom - top) / H))

    // 세로 화면에서는 둘을 가깝게 세운다. 안 그러면 화면 밖으로 밀린다.
    spread = portrait ? 0.55 : 0.82

    // 띠가 얇으면 전신을 포기하고 상반신만 담는다
    const closeUp = bandFrac < 0.38
    const subjBottom = closeUp ? 0.62 : 0
    const subjTop = 1.62
    const subjCenter = (subjTop + subjBottom) / 2

    fovDeg = portrait ? 46 : 40
    const t = Math.tan((fovDeg / 2) * (Math.PI / 180))
    const aspect = w / h

    // 필요한 반높이/반너비 (여유 12%)
    const needH = ((subjTop - subjBottom) / 2) * 1.12
    const needW = (spread + 0.36) * 1.06

    // 세로는 화면 전체가 아니라 '띠' 안에 들어가야 한다
    dist = Math.max(needH / (t * bandFrac), needW / (t * aspect), 2.4)

    camera.fov = fovDeg
    camera.aspect = aspect
    camera.position.set(camera.position.x, subjCenter + 0.18, dist)

    // 띠 중심이 화면에서 차지하는 위치(0=위, 1=아래). aim 을 낮추면 인물이 위로 올라간다.
    const f = (top + bottom) / 2 / H
    const halfH = dist * t
    aim.set(0, subjCenter - (0.5 - f) * 2 * halfH, 0)

    camera.lookAt(aim)
    camera.updateProjectionMatrix()
  }

  function resize() {
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    renderer.setSize(w, h, false)
    reframe()
  }

  // 패널이 바뀌면 프레이밍을 다시 잡는다
  if (typeof addEventListener === 'function') {
    addEventListener('rizz:panel', () => requestAnimationFrame(reframe))
  }

  // ── 분위기/호감을 조명으로 흘려보낸다
  let mood = 50
  let love = 12
  let moodShown = 50
  let loveShown = 12
  function setGauges(m, l) {
    mood = m
    love = l
  }

  let raf = 0
  let last = performance.now()
  let running = false

  function frame(now) {
    if (!running) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now

    moodShown += (mood - moodShown) * Math.min(1, dt * 2.5)
    loveShown += (love - loveShown) * Math.min(1, dt * 2.5)

    const m01 = moodShown / 100
    const l01 = loveShown / 100
    keyL.intensity = 7 + m01 * 16
    keyR.intensity = 7 + l01 * 18
    scene.fog.near = 3.4 - m01 * 1.1
    grid.material.opacity = 0.22 + m01 * 0.45

    const t = now / 1000
    for (const s of signs.children) {
      s.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(t * 1.3 + s.userData.phase)) * 0.7
    }
    // 분위기가 좋으면 두 사람이 조금 가까워진다
    const gap = spread - l01 * 0.09
    if (actors.client) {
      actors.client.group.position.x = -gap
      actors.client.update(dt)
    }
    if (actors.target) {
      actors.target.group.position.x = gap
      actors.target.update(dt)
    }

    camera.position.x = Math.sin(t * 0.22) * 0.09
    camera.lookAt(aim)

    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }

  return {
    renderer,
    scene,
    camera,
    setActor,
    getActor: (role) => actors[role],
    setGauges,
    resize,
    reframe,
    start() {
      if (running) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(frame)
    },
    stop() {
      running = false
      cancelAnimationFrame(raf)
    },
    /** 테스트/스크린샷용 1프레임 강제 렌더 */
    renderOnce() {
      renderer.render(scene, camera)
    },
    dispose() {
      this.stop()
      for (const role of Object.keys(actors)) actors[role]?.dispose()
      renderer.dispose()
    },
  }
}
