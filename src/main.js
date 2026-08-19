import { Game } from './game/game.js'
import { SceneView } from './render/Scene.js'
import { makeHud, updateHud } from './ui/hud.js'
import { Inspector } from './ui/Inspector.js'
import { AimPointer } from './ui/AimPointer.js'
import { Intro } from './ui/Intro.js'
import { Attract } from './ui/Attract.js'
import { LangPick } from './ui/LangPick.js'
import { Comms } from './ui/Comms.js'
import { Ground } from './ui/Ground.js'
import { Victory } from './ui/Victory.js'
import { Lab } from './ui/Lab.js'
import { StartGate } from './ui/StartGate.js'
import { AUDIO } from './audio/index.js'

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
// 손으로 하는 조준 — 발사대(또는 예측선)를 짚고 끌면 조준이 손끝을 따라온다.
// 각이 바뀌면 패널의 각도 숫자도 그 자리에서 같이 바뀌어야 한다(_sync).
const aimPointer = new AimPointer(game, view.rig, view.renderer.domElement, () => hud._sync())
// 승리 화면 → 과학연구실. "다음 스테이지" 버튼 하나로 넘어가던 걸 두 화면으로
// 나눴다: 먼저 축하 장면(Victory)이 뜨고, 닫으면 정치자금을 쓰는 연구실(Lab)이
// 뜬다. 연구실의 버튼을 눌러야 비로소 다음 침공(=다음 스테이지)이 시작된다.
const lab = new Lab(game, () => game.nextStage())
const victory = new Victory(game, () => lab.open())
window.__game = game; window.__view = view; window.__victory = victory; window.__lab = lab; window.__audio = AUDIO
window.__aim = aimPointer
document.querySelector('.boot')?.remove()

// 두 목소리. 조르그는 요새 **위**에서 타이머로 잡담을 던지고, 지상 관제는
// 지구 **아래**에서 사건이 벌어질 때만 보고한다 — 발사·스윙바이·명중·격파.
// 붙는 자리가 갈려 있어서 둘이 동시에 떠도 겹치지 않는다.
const comms = new Comms(game, view)
const ground = new Ground(game, view)
// 창 두 개도 손잡이를 밖에 내놓는다 — 위의 __game·__view와 같은 이유다:
// 화면을 실제로 띄워 놓고 확인하는 자리(헤드리스 브라우저 검증)에서 이 둘만
// 못 부르면 "저 창이 실제로 뜨는가"를 눈으로 확인할 방법이 없다.
window.__comms = comms; window.__ground = ground

// ─── 소리 ───────────────────────────────────────────────────────
// 사건은 game.addFx가 흘려보내는 큐에서 줍는다(지상 관제와 같은 자리).
// 전황(속도·위험도)은 매 프레임 읽어 음악 레이어를 크로스페이드한다.
// 실제로 컨텍스트가 열리는 건 아래 시작 화면을 누르는 그 순간이다.
AUDIO.bind(game, view)

// 오프닝 — 네 단계다.
// ⓪ 시작: 소리를 열 수 있는 유일한 자리. 브라우저는 사람이 누르기 전에
//    소리를 못 내게 막고, 그 허락은 제스처 핸들러 **안에서** 받아야 한다.
// ① 언어: 무엇으로 읽을지부터 묻는다. 예고편도 튜토리얼도 문장이 있는데,
//    그걸 다 보고 나서야 언어를 고를 수 있으면 그건 고른 게 아니다.
// ② 예고편: **실제 게임을 굴려서** 한 번의 발사가 끝까지 굴러가는 걸 보여 준다.
//    그려 놓은 그림이 아니라 같은 렌더러·같은 HUD·같은 폭발이다.
//    끝나면 판을 리셋하고 로고를 박는다.
// ③ 튜토리얼: 규칙을 한 컷씩, 누르는 사람 속도로.
// ?nointro=1 로 넷 다 끌 수 있다(반복 플레이·자동 검증용).
// 조르그의 첫 워프인은 **튜토리얼을 닫은 뒤에** 시작된다(warpHold). 규칙을
// 읽는 동안 뒤에서 도착이 끝나 버리면, 첫 판에서 제일 먼저 봐야 할 장면을
// 오버레이가 통째로 가린다. 닫고 나서 워프가 끝나면 그때 조준 UI가 떠오른다.
let attract = null

function opening() {
  // 언어를 고르는 동안에도 판은 붙들어 둔다 — 그 사이에 조르그가 도착해
  // 버리면 예고편이 세울 무대가 이미 헝클어져 있다.
  game.warpHold = true
  new LangPick(() => {
    game.warpHold = false
    window.__attract = attract = new Attract(game, view, () => {
      // 예고편이 판을 되돌린 직후다(resetRun). 여기서 잡아 두면 워프인이
      // 한 프레임도 흐르지 않은 채 튜토리얼이 열린다.
      attract = null; game.warpHold = true; hud._sync()
      new Intro(() => { game.warpHold = false }).start()
    }, comms, ground).start()
    hud._sync()
  }).start()
}

if (!params.get('nointro')) {
  // 판은 시작 화면이 떠 있는 동안에도 붙들어 둔다 — 누르기 전에 조르그가
  // 도착해 버리면 예고편이 세울 무대가 이미 헝클어져 있다(언어 화면과 같은 이유).
  game.warpHold = true
  new StartGate(() => {
    // ── 이 두 줄이 제스처 핸들러 안이다 ──
    AUDIO.unlock()
    AUDIO.ui('start')
    opening()
  }).start()
} else {
  // 자동 검증용 경로. 시작 화면이 없으므로 소리를 열 자리도 없다 —
  // 아무 데나 처음 누르는(또는 누르는) 순간 한 번만 열어 준다.
  const once = () => {
    AUDIO.unlock()
    removeEventListener('pointerdown', once)
    removeEventListener('keydown', once)
  }
  addEventListener('pointerdown', once)
  addEventListener('keydown', once)
}

let last = performance.now()
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now
  attract?.frame(dt)                  // 예고편이 카메라를 잡고 있는 동안만
  game.tick(dt); view.render(); updateHud(hud, game); inspector.update(); aimPointer.update()
  comms.update(dt)                    // 예고편 중에도 돈다 — 박자는 예고편이 잡는다
  ground.update(dt)
  AUDIO.frame(dt, game)               // 전황 → 음악 레이어 / 상태가 바뀐 순간의 소리
  // 판을 이긴 순간 축하 장면을 **시간차를 두고** 연다(한 번만).
  // 바로 띄우면 마지막 요새가 터지는 걸 패널이 덮는다 — 패배 화면과 같은 이유다.
  // 닫으면 다음 침공이 온다.
  if (game.won && !game.runOver && !attract) victory.arm(); else if (!game.won) victory.disarm()
  victory.tick()
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
