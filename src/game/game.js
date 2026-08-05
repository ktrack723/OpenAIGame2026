import { fromAngle, len, sub, vec } from '../core/vector.js'
import { CFG } from './config.js'
import { impact, inspectSwing, stepBodies, stepMissile } from './physics.js'
import { launcherPos, makeStage } from './stage.js'
export class Game {
  bodies; target; missiles = []; aim = -0.2; power = 82; rockets = 4; score = 0; message = '시간을 기다리거나 조준한 뒤 발사하세요'; timeScale = 1; paused = false; won=false; lost=false
  constructor(seed){ const s = makeStage(seed); this.bodies=s.bodies; this.target=s.target }
  fire(){ if(this.rockets<=0 || this.missiles.some(m=>m.alive) || this.won || this.lost) return; const p=launcherPos(), v=fromAngle(this.aim,this.power); this.missiles.push({pos:p,vel:v,power:this.power,alive:true,chain:0,nearMiss:0,age:0,path:[p],lastVel:{...v},swingIds:new Set(),bestDeflection:0}); this.rockets--; this.message='MISSILE AWAY — 행성 중력권으로 감아 치세요' }
  tick(dtFrame){ if(this.paused) return; let acc=Math.min(.08,dtFrame)*this.timeScale; while(acc>=CFG.DT){ stepBodies(this.bodies,CFG.DT); for(const m of this.missiles.filter(x=>x.alive)){ m.lastVel={...m.vel}; stepMissile(m,this.bodies,CFG.DT); for(const b of this.bodies) if(b.alive && inspectSwing(m,b)) this.message=`${b.name} 스윙바이! 체인 x${m.chain}`; this.collide(m); this.bounds(m)} this.checkEnd(); acc-=CFG.DT } }
  collide(m){ for(const b of this.bodies) if(b.alive && len(sub(m.pos,b.pos)) < b.radius){ const dmg=impact(m,b); m.alive=false; const mult=1+.75*m.chain+.25*m.nearMiss; const gained=Math.round(dmg*mult); this.score+=gained; this.message=`${b.name} 명중 ${gained}점 (체인 ${m.chain})`; if(b.hp<=0){ b.alive=false; this.message = b===this.target ? '조르그 행성 말살 완료!' : `${b.name} 파괴됨` } return } }
  bounds(m){ const r=len(m.pos); if(r<CFG.R_STAR+8 || r>CFG.WORLD_LIMIT || m.age>28){ m.alive=false; m.failTag = r>CFG.WORLD_LIMIT ? '유실 — 성계 이탈' : m.bestDeflection<CFG.SWING_DEG ? `굴절 부족 — ${m.bestDeflection.toFixed(0)}° / 25° 필요` : '타이밍 — 목표가 지나감'; this.message=m.failTag } }
  checkEnd(){ if(this.won || this.lost) return; if(!this.target.alive){ this.won=true; this.message='작전 성공: 연구비 정산 완료' } else if(this.rockets<=0 && !this.missiles.some(m=>m.alive)){ this.lost=true; this.message='작전 실패: 로켓 소진' } }
}
