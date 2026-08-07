import { Game } from './game/game.js'
import { SceneView } from './render/Scene.js'
import { makeHud, updateHud } from './ui/hud.js'
import { Inspector } from './ui/Inspector.js'
import { Intro } from './ui/Intro.js'
import { Victory } from './ui/Victory.js'

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
// 승리 화면 — "다음 스테이지" 버튼 대신 축하 장면을 띄우고,
// 버튼을 누르면 그때 다음 침공(=다음 스테이지)이 시작된다.
const victory = new Victory(game, () => game.nextStage())
window.__game = game; window.__view = view; window.__victory = victory
document.querySelector('.boot')?.remove()

// 오프닝 — 목표·규칙·플로우를 박에 맞춰 훑고 지나간다.
// 게임은 뒤에서 이미 조준 모드(시간 정지)로 대기 중이라 따로 멈출 게 없다.
// ?nointro=1 로 끌 수 있다(반복 플레이·자동 검증용).
if (!params.get('nointro')) new Intro().start()

let last = performance.now()
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now
  game.tick(dt); view.render(); updateHud(hud, game); inspector.update()
  // 판을 이긴 순간 축하 장면을 연다(한 번만). 닫으면 다음 침공이 온다.
  if (game.won && !game.runOver && !victory.shown) { victory.shown = true; victory.open() }
  if (!game.won) victory.shown = false
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
