import { Game } from './game/game.js'
import { SceneView } from './render/Scene.js'
import { makeHud, updateHud } from './ui/hud.js'
import { Inspector } from './ui/Inspector.js'

// 시드: ?seed= 지정 시 그 값, 아니면 데일리 시드 (고정 dt + 시드 PRNG → 결정론, §4.2)
const params = new URLSearchParams(location.search)
const d = new Date()
const daily = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
const seed = ((+params.get('seed') || daily) >>> 0) || 1

const game = new Game(seed)
const view = new SceneView(document.querySelector('#app'), game)
const hud = makeHud(game, view)
// 천체 정보창 — 마우스를 올리거나 손가락으로 짚으면 그 공의 제원이 뜬다.
// 그리는 반경은 Scene이 소유하므로(카메라 의존) 그 함수를 그대로 빌려준다.
const inspector = new Inspector(game, view.rig, view.renderer.domElement)
inspector.bind((b) => view.renderRadius(b))
window.__game = game; window.__view = view   // 콘솔/자동 검증용 훅
document.querySelector('.boot')?.remove()

let last = performance.now()
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now
  game.tick(dt); view.render(); updateHud(hud, game); inspector.update()
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
