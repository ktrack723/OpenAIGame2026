import * as THREE from 'three'
import { Game } from '../game/game.js'
import { CFG } from '../game/config.js'
import { launcherPos } from '../game/stage.js'
const colors = { rock:0x9aa1a8,lava:0xff6b35,ice:0x8be9ff,ocean:0x2f8fff,gas:0xffd166,toxic:0x9bff6a,life:0x38d878,earth:0x3b82f6,zork:0xff3864,debris:0x777777 }
export class SceneView {
  scene=new THREE.Scene(); camera=new THREE.OrthographicCamera(-1500,1500,900,-900,1,10000); renderer=new THREE.WebGLRenderer({antialias:true}); meshes=new Map(); paths=[]; aimLine=new THREE.Line();
  constructor(el, game){ this.el=el; this.game=game; this.renderer.setSize(innerWidth,innerHeight); this.renderer.setPixelRatio(devicePixelRatio); el.appendChild(this.renderer.domElement); this.camera.position.z=1000; this.scene.background=new THREE.Color(0x030712); this.scene.add(new THREE.AmbientLight(0xffffff,.8)); this.addSun(); addEventListener('resize',()=>this.resize()); this.resize() }
  addSun(){ const sun=new THREE.Mesh(new THREE.CircleGeometry(CFG.R_STAR,64), new THREE.MeshBasicMaterial({color:0xffd36b})); this.scene.add(sun); const ring=new THREE.Mesh(new THREE.RingGeometry(CFG.R_STAR+8,CFG.R_STAR+14,64), new THREE.MeshBasicMaterial({color:0xfff2a6,transparent:true,opacity:.35})); this.scene.add(ring) }
  resize(){ const a=innerWidth/innerHeight, h=900; this.camera.left=-h*a; this.camera.right=h*a; this.camera.top=h; this.camera.bottom=-h; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth,innerHeight) }
  render(){ this.syncBodies(); this.syncLines(); this.renderer.render(this.scene,this.camera) }
  syncBodies(){ for(const b of this.game.bodies){ let mesh=this.meshes.get(b.id); if(!mesh){ mesh=new THREE.Mesh(new THREE.CircleGeometry(b.radius,32), new THREE.MeshBasicMaterial({color:colors[b.type]})); this.meshes.set(b.id,mesh); this.scene.add(mesh) } mesh.visible=b.alive; mesh.position.set(b.pos.x,b.pos.y,0); const mat=mesh.material; mat.color.setHex(b.hitFlash>0?0xffffff:colors[b.type]) } }
  syncLines(){ for(const l of this.paths) this.scene.remove(l); this.paths=[]; const add=(pts, color, opacity=.55)=>{ if(pts.length<2) return; const g=new THREE.BufferGeometry().setFromPoints(pts.map(p=>new THREE.Vector3(p.x,p.y,0))); const line=new THREE.Line(g,new THREE.LineBasicMaterial({color,transparent:true,opacity})); this.paths.push(line); this.scene.add(line) }
    for(const b of this.game.bodies) add(b.trail, colors[b.type], .35); for(const m of this.game.missiles) add(m.path, m.alive?0xffffff:0x64748b, m.alive?.9:.45)
    const p=launcherPos(), end={x:p.x+Math.cos(this.game.aim)*this.game.power*7,y:p.y+Math.sin(this.game.aim)*this.game.power*7}; add([p,end],0x22d3ee,.9)
  }
}
