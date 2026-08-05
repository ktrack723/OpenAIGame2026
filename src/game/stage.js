import { Rng } from '../core/random.js'
import { fromAngle, vec } from '../core/vector.js'
import { CFG, hpOf, radiusOf } from './config.js'
const types = ['rock','lava','ice','ocean','gas','toxic']
export function makeStage(seed = Date.now()) {
  const rng = new Rng(seed), bodies = [], count = 6
  const earth = body('earth','Earth',300,900,Math.PI*.72,'earth',true); bodies.push(earth)
  for (let i=0;i<count;i++) {
    const a = 290 + i * 185 + rng.range(-35,35), theta = rng.range(0,Math.PI*2), mu = i===2 ? 820 : Math.exp(rng.range(Math.log(120), Math.log(760)))
    bodies.push(body(`p${i}`, rng.pick(['Vesta','Bront','Mir','Kappa','Oort','Faro'])+`-${i+1}`, mu, a, theta, i===count-1?'zork':rng.pick(types)))
  }
  const target = bodies[bodies.length-1]; target.name='Zork Prime'; target.hp *= 1.35; target.hpMax = target.hp
  return { bodies, target, seed }
}
function body(id, name, mu, a, theta, type, isEarth=false) {
  const speed = Math.sqrt(CFG.MU_STAR / a), tangent = fromAngle(theta + Math.PI/2, speed)
  return { id, name, mu, radius: isEarth ? 11 : radiusOf(mu), pos: fromAngle(theta,a), vel: tangent, hp: isEarth?3:hpOf(mu), hpMax: isEarth?3:hpOf(mu), type, isEarth, alive: true, trail: [], hitFlash: 0 }
}
export function launcherPos() { return vec(-1180, -720) }
