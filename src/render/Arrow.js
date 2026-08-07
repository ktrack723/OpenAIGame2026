import * as THREE from 'three'

// 화살표 하나 = 축(사각형) + 촉(삼각형). 조준 보조에서 "공이 어느 쪽으로
// 밀려나는가"를 한 획으로 보여주는 게 유일한 용도라 최대한 가볍게 만든다.
export function makeArrow(color, opacity = 0.95) {
  const mat = () => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  })
  const shaftGeo = new THREE.PlaneGeometry(1, 1)
  shaftGeo.translate(0.5, 0, 0)                     // 원점에서 +x로 뻗는 단위 축
  const headGeo = new THREE.BufferGeometry()
  headGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0.5, 0, 0, -0.5, 0, 1, 0, 0,
  ]), 3))
  const grp = new THREE.Group()
  const shaft = new THREE.Mesh(shaftGeo, mat())
  const head = new THREE.Mesh(headGeo, mat())
  grp.add(shaft, head)
  grp.userData = { shaft, head }
  grp.renderOrder = 17
  shaft.renderOrder = 17; head.renderOrder = 17
  grp.visible = false
  return grp
}

export function setArrow(grp, x, y, ang, length, width, z = 6) {
  const { shaft, head } = grp.userData
  const headLen = Math.min(length * 0.45, width * 3.2)
  shaft.scale.set(Math.max(0.001, length - headLen), width, 1)
  head.position.set(length - headLen, 0, 0)
  head.scale.set(headLen, width * 3.2, 1)
  grp.position.set(x, y, z)
  grp.rotation.z = ang
}
