import * as THREE from 'three'
import { CFG } from '../game/config.js'

const colors = {
  rock: 0x9aa1a8, lava: 0xff6b35, ice: 0x8be9ff, ocean: 0x2f8fff, gas: 0xffd166,
  toxic: 0x9bff6a, life: 0x38d878, iron: 0xcbd5e1, earth: 0x3b82f6, debris: 0x8b8f96,
}

export class SceneView {
  constructor(el, game) {
    this.el = el; this.game = game
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x030712)
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(innerWidth, innerHeight)
    this.renderer.setPixelRatio(devicePixelRatio)
    el.appendChild(this.renderer.domElement)
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10000)
    this.camera.position.z = 1000
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const sun = new THREE.Mesh(new THREE.CircleGeometry(CFG.R_STAR, 64), new THREE.MeshBasicMaterial({ color: 0xffd36b }))
    const corona = new THREE.Mesh(new THREE.RingGeometry(CFG.R_STAR + 8, CFG.R_STAR + 14, 64),
      new THREE.MeshBasicMaterial({ color: 0xfff2a6, transparent: true, opacity: 0.35 }))
    this.scene.add(sun, corona)
    this.meshes = new Map(); this.rings = new Map(); this.paths = []
    this.lastBodies = null
    addEventListener('resize', () => this.resize())
    this.resize()
  }

  resize() {   // §14.1 성계 전체 뷰: a_max × 1.15 핏
    const a = innerWidth / innerHeight, h = this.game.aMax * 1.15
    this.camera.left = -h * a; this.camera.right = h * a; this.camera.top = h; this.camera.bottom = -h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(innerWidth, innerHeight)
  }

  render() {
    if (this.lastBodies !== this.game.bodies) this.resetStage()
    this.syncBodies(); this.syncLines()
    this.renderer.render(this.scene, this.camera)
  }

  resetStage() {
    for (const m of this.meshes.values()) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose() }
    for (const r of this.rings.values()) { this.scene.remove(r); r.geometry.dispose(); r.material.dispose() }
    this.meshes.clear(); this.rings.clear()
    this.lastBodies = this.game.bodies
    this.resize()
  }

  syncBodies() {
    const g = this.game
    for (const b of g.bodies) {
      let mesh = this.meshes.get(b.id)
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.CircleGeometry(b.radius, 32), new THREE.MeshBasicMaterial({ color: colors[b.type] ?? 0x9aa1a8 }))
        mesh.userData.r = b.radius
        this.meshes.set(b.id, mesh); this.scene.add(mesh)
      }
      if (mesh.userData.r !== b.radius) {   // 합성/성장으로 반지름 변화
        mesh.geometry.dispose(); mesh.geometry = new THREE.CircleGeometry(b.radius, 32); mesh.userData.r = b.radius
      }
      mesh.visible = b.alive
      mesh.position.set(b.pos.x, b.pos.y, 0)
      const c = new THREE.Color(colors[b.type] ?? 0x9aa1a8)
      if (b.textureState) c.lerp(new THREE.Color(0x000000), Math.min(3, b.textureState) * 0.18)   // 텍스처 데미지 4단계
      if (b.hitFlash > 0) c.set(0xffffff)
      mesh.material.color.copy(c)
      if (b.type !== 'debris') this.syncRing(b)
    }
  }

  // R6 대응: LEGAL_HIT 아닌 행성 상시 붉은 외곽선. 목표=시안, 지구=파랑
  syncRing(b) {
    const g = this.game
    let ring = this.rings.get(b.id)
    if (!ring || ring.userData.r !== b.radius) {
      if (ring) { this.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose() }
      ring = new THREE.Mesh(new THREE.RingGeometry(b.radius + 3, b.radius + 9, 48),
        new THREE.MeshBasicMaterial({ transparent: true }))
      ring.userData.r = b.radius
      this.rings.set(b.id, ring); this.scene.add(ring)
    }
    ring.visible = b.alive
    ring.position.set(b.pos.x, b.pos.y, 0.5)
    if (b === g.target) { ring.material.color.setHex(0x22d3ee); ring.material.opacity = 0.9 }
    else if (b.isEarth) { ring.material.color.setHex(0x3b82f6); ring.material.opacity = 0.8 }
    else { ring.material.color.setHex(0xb91c1c); ring.material.opacity = 0.4 }
  }

  syncLines() {
    for (const l of this.paths) { this.scene.remove(l); l.geometry.dispose(); l.material.dispose() }
    this.paths = []
    const g = this.game
    const add = (pts, color, opacity = 0.55, dashed = false) => {
      if (pts.length < 2) return
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, p.y, 0)))
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 10, gapSize: 8 })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity })
      const line = new THREE.Line(geo, mat)
      if (dashed) line.computeLineDistances()
      this.paths.push(line); this.scene.add(line)
    }
    // 궤도 트레일 — 플레이어 임펄스 직후 강조 (P4, §14.2)
    for (const b of g.bodies) if (b.trail) {
      const hot = b.trailFlash > 0
      add(b.trail, hot ? 0xffffff : (colors[b.type] ?? 0x9aa1a8), hot ? 0.95 : 0.3)
    }
    // 미사일 궤적 — 빗나간 샷은 회색 점선으로 스테이지 끝까지 남긴다 (§14.4)
    for (const m of g.missiles) add(m.path, m.alive ? 0xffffff : 0x64748b, m.alive ? 0.9 : 0.4, !m.alive)
    // 조준선 + 예측선 3초 (§5.1)
    if (g.canAim) {
      const p = g.launchPos()
      add([p, { x: p.x + Math.cos(g.aim) * (50 + g.power), y: p.y + Math.sin(g.aim) * (50 + g.power) }], 0x22d3ee, 0.9)
      add(g.predict(), 0x67e8f9, 0.7, true)
    }
  }
}
