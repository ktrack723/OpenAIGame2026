import * as THREE from 'three'
import { VIS } from '../game/config.js'

// §14.5 타격감 — 미사일 분사 트레일 / 명중 폭발 / 파괴 산개 / 충격파 링.
// 파티클은 월드 단위 크기라 줌에 따라 같이 커진다(원근 포인트 스케일).
const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor; vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.5, aSize * uScale / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`

const FRAG = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float a = vAlpha * smoothstep(0.25, 0.0, r2);
  gl_FragColor = vec4(vColor * a, a);
}`

export class Particles {
  constructor(scene, max = VIS.PARTICLES) {
    this.max = max; this.head = 0
    this.pos = new Float32Array(max * 3)
    this.col = new Float32Array(max * 3)
    this.size = new Float32Array(max)
    this.alpha = new Float32Array(max)
    this.vx = new Float32Array(max)
    this.vy = new Float32Array(max)
    this.life = new Float32Array(max)
    this.ttl = new Float32Array(max)
    this.size0 = new Float32Array(max)
    this.drag = new Float32Array(max)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1))
    geo.setDrawRange(0, max)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 6
    scene.add(this.points)
    this.geo = geo

    // 충격파 링 풀 (§14.5 명중/파괴 연출)
    this.rings = []
    this.ringGeo = new THREE.RingGeometry(0.82, 1, 64)
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }))
      m.visible = false; m.renderOrder = 7; m.userData.t = 0
      scene.add(m); this.rings.push(m)
    }
  }

  spawn(x, y, vx, vy, color, size, ttl, drag = 1.2) {
    const i = this.head; this.head = (this.head + 1) % this.max
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = 2
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b
    this.vx[i] = vx; this.vy[i] = vy
    this.size[i] = size; this.size0[i] = size
    this.alpha[i] = 1; this.life[i] = ttl; this.ttl[i] = ttl; this.drag[i] = drag
  }

  // 미사일 분사 — 지난 위치와 현 위치 사이를 메워 4× 관측에서도 끊기지 않게.
  // (backX, backY)는 진행 반대 방향 단위벡터: 불꽃이 꼬리로 흘러야 속도가 읽힌다.
  thrust(ax, ay, bx, by, backX, backY, n = 6) {
    const c = _c1, hot = _c2
    hot.setRGB(0.55, 0.85, 1)
    for (let k = 0; k < n; k++) {
      const t = k / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t
      const a = Math.random() * Math.PI * 2, s = 5 + Math.random() * 12
      const j = 26 + Math.random() * 34
      const mix = Math.random()
      c.setRGB(1, 0.5 + 0.45 * mix, 0.2 * mix)
      this.spawn(x, y, Math.cos(a) * s + backX * j, Math.sin(a) * s + backY * j,
        Math.random() < 0.22 ? hot : c, 5 + Math.random() * 7, 0.4 + Math.random() * 0.55, 2.4)
    }
  }

  burst(x, y, { n = 60, color = 0xffd166, speed = 120, size = 5, ttl = 0.9, spread = Math.PI * 2, dir = 0 } = {}) {
    const c = _c1
    for (let k = 0; k < n; k++) {
      const a = dir + (Math.random() - 0.5) * spread
      const s = speed * (0.25 + Math.random() * 0.95)
      c.set(color)
      c.offsetHSL(0, 0, (Math.random() - 0.4) * 0.25)
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, c,
        size * (0.5 + Math.random()), ttl * (0.6 + Math.random() * 0.8), 1.0)
    }
  }

  shock(x, y, r, color = 0x67e8f9, ttl = 0.55) {
    const m = this.rings.find(r0 => !r0.visible) || this.rings[0]
    m.visible = true; m.position.set(x, y, 3)
    m.userData.t = 0; m.userData.ttl = ttl; m.userData.r = r
    m.material.color.set(color)
  }

  update(dt, uScale) {
    this.mat.uniforms.uScale.value = uScale
    const { pos, vx, vy, life, ttl, alpha, size, size0, drag } = this
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) alpha[i] = 0; continue }
      life[i] -= dt
      if (life[i] <= 0) { alpha[i] = 0; continue }
      const k = Math.max(0, 1 - drag[i] * dt)
      vx[i] *= k; vy[i] *= k
      pos[i * 3] += vx[i] * dt; pos[i * 3 + 1] += vy[i] * dt
      const u = life[i] / ttl[i]
      alpha[i] = u * u
      size[i] = size0[i] * (0.35 + 0.65 * u)
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aColor.needsUpdate = true
    this.geo.attributes.aSize.needsUpdate = true
    this.geo.attributes.aAlpha.needsUpdate = true

    for (const m of this.rings) {
      if (!m.visible) continue
      m.userData.t += dt
      const u = m.userData.t / m.userData.ttl
      if (u >= 1) { m.visible = false; continue }
      const s = m.userData.r * (0.25 + 2.4 * u)
      m.scale.set(s, s, 1)
      m.material.opacity = (1 - u) * 0.85
    }
  }
}

const _c1 = new THREE.Color()
const _c2 = new THREE.Color()
