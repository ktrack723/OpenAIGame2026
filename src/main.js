import { Game } from './game/game.js'
import { SceneView } from './render/Scene.js'
import { makeHud, updateHud } from './ui/hud.js'
import { Inspector } from './ui/Inspector.js'
import { Intro } from './ui/Intro.js'
import { Attract } from './ui/Attract.js'
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

// 오프닝 — 두 단계다.
// ① 예고편(약 8.5초): **실제 게임을 굴려서** 컷 여섯을 보여 준다. 그려 놓은 그림이
//    아니라 같은 렌더러·같은 HUD·같은 폭발이다. 끝나면 판을 리셋하고 로고를 박는다.
// ② 튜토리얼: 규칙을 한 컷씩, 누르는 사람 속도로.
// ?nointro=1 로 둘 다 끌 수 있다(반복 플레이·자동 검증용).
let attract = null
if (!params.get('nointro')) {
  attract = new Attract(game, view, () => { attract = null; hud._sync(); new Intro().start() }).start()
}

let last = performance.now()
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now
  attract?.frame(dt)                  // 예고편이 카메라를 잡고 있는 동안만
  game.tick(dt); view.render(); updateHud(hud, game); inspector.update()
  // 판을 이긴 순간 축하 장면을 연다(한 번만). 닫으면 다음 침공이 온다.
  if (game.won && !game.runOver && !victory.shown && !attract) { victory.shown = true; victory.open() }
  if (!game.won) victory.shown = false
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
