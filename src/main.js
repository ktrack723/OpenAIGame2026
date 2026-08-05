import './style.css'
import { Game } from './game/game.js'
import { SceneView } from './render/Scene.js'
import { makeHud, updateHud } from './ui/hud.js'
const game = new Game(20260805)
const view = new SceneView(document.querySelector('#app'), game)
const hud = makeHud(game)
document.querySelector('.boot')?.remove()
let last = performance.now()
function loop(now){ const dt=(now-last)/1000; last=now; game.tick(dt); view.render(); updateHud(hud, game); requestAnimationFrame(loop) }
requestAnimationFrame(loop)
