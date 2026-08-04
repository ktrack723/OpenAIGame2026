import * as THREE from 'three';

const $ = (s) => document.querySelector(s);
const sceneEl = $('#scene');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050713, 0.025);
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 120);
camera.position.set(0, 17, 21);
camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
sceneEl.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0x5f7dba, 0x090711, 1.35));
const starLight = new THREE.PointLight(0xffc16b, 85, 35, 1.5);
scene.add(starLight);

const starGeo = new THREE.BufferGeometry();
const starPos = [];
for (let i = 0; i < 1500; i++) {
  const r = 22 + Math.random() * 55, a = Math.random() * Math.PI * 2, z = (Math.random() - .5) * 45;
  starPos.push(Math.cos(a) * r, z, Math.sin(a) * r);
}
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9bb8de, size: .055, transparent: true, opacity: .68 })));

const system = new THREE.Group();
system.rotation.x = -.08;
scene.add(system);

const sun = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 5), new THREE.MeshStandardMaterial({ color: 0xff9c25, emissive: 0xff6b0a, emissiveIntensity: 2.8, roughness: .85 }));
system.add(sun);
const sunHalo = new THREE.Mesh(new THREE.SphereGeometry(2.05, 32, 32), new THREE.MeshBasicMaterial({ color: 0xff9d32, transparent: true, opacity: .075, side: THREE.BackSide }));
system.add(sunHalo);

const orbitMaterial = new THREE.LineBasicMaterial({ color: 0x426075, transparent: true, opacity: .3 });
function orbitRing(radius) {
  const pts = Array.from({ length: 129 }, (_, i) => { const a = i / 128 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius); });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), orbitMaterial);
  system.add(line);
}
[4.3, 7.2, 10.2].forEach(orbitRing);

const palette = [0x55ddec, 0xe65f48, 0xc1ad80, 0x7768cc, 0x61b98a];
const planets = [];
function planetTexture(color) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'); const base = `#${color.toString(16).padStart(6,'0')}`;
  x.fillStyle = base; x.fillRect(0,0,256,256);
  for(let i=0;i<22;i++){ x.globalAlpha=.08+Math.random()*.12; x.fillStyle=i%2?'#fff':'#001124'; x.beginPath(); x.ellipse(Math.random()*256,Math.random()*256,25+Math.random()*70,3+Math.random()*12,Math.random()*.3,0,7); x.fill(); }
  return new THREE.CanvasTexture(c);
}
function makePlanet(radius, orbit, speed, phase, color, mass=1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), new THREE.MeshStandardMaterial({ map: planetTexture(color), roughness: .78, metalness: .08 }));
  mesh.castShadow = true;
  const p = { mesh, radius, orbit, speed, phase, mass, velocity: new THREE.Vector3(), launched: false, alive: true, trail: [], trailLine: null, lastHit: -10 };
  mesh.userData.planet = p; planets.push(p); system.add(mesh); return p;
}
makePlanet(.58,4.3,.44,.4,palette[0],1.1);
makePlanet(.76,7.2,-.25,2.5,palette[1],1.45);
makePlanet(.48,10.2,.17,4.2,palette[2],.9);

const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0,1,0),0), hit = new THREE.Vector3();
let selected = null, dragStart = new THREE.Vector3(), dragging = false, running = false;
let score = 0, shots = 5, combo = 0, best = 0, sector = 1, target = 2500, scoreBoost = 1, blastRadius = 1;
const clock = new THREE.Clock();

function pointerWorld(e) {
  pointer.x = e.clientX / innerWidth * 2 - 1; pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera); raycaster.ray.intersectPlane(plane, hit); return hit;
}
function onDown(e) {
  if (!running || shots <= 0) return;
  pointerWorld(e); raycaster.setFromCamera(pointer,camera);
  const objects = raycaster.intersectObjects(planets.filter(p=>p.alive&&!p.launched).map(p=>p.mesh));
  if (!objects.length) return;
  selected = objects[0].object.userData.planet; dragStart.copy(selected.mesh.position); dragging = true;
  renderer.domElement.setPointerCapture?.(e.pointerId); showAim(e);
}
function showAim(e) {
  pointerWorld(e); const dx=e.clientX-(dragStart.clone().project(camera).x*.5+.5)*innerWidth; const dy=e.clientY-(-dragStart.clone().project(camera).y*.5+.5)*innerHeight;
  const power=Math.min(100,Math.hypot(dx,dy)/2.4), guide=$('#aim-guide');
  guide.classList.remove('hidden'); guide.style.left=`${e.clientX}px`;guide.style.top=`${e.clientY}px`;guide.style.transform=`rotate(${Math.atan2(-dy,-dx)}rad)`;guide.querySelector('span').style.width=`${Math.max(40,power*1.35)}px`;
  $('#power-label').textContent=`POWER ${Math.round(power)}%`; $('#power-bar').style.width=`${power}%`;
}
function onMove(e){ if(dragging) showAim(e); }
function onUp(e) {
  if(!dragging||!selected)return; pointerWorld(e);
  const pull=dragStart.clone().sub(hit), power=Math.min(8,pull.length()*1.25);
  if(power>.25){ selected.velocity.copy(pull.normalize().multiplyScalar(power)); selected.launched=true; shots--; combo=0; updateHud(); }
  dragging=false;selected=null;$('#aim-guide').classList.add('hidden');$('#power-bar').style.width='0';
}
renderer.domElement.addEventListener('pointerdown',onDown);renderer.domElement.addEventListener('pointermove',onMove);renderer.domElement.addEventListener('pointerup',onUp);renderer.domElement.addEventListener('pointercancel',onUp);

function burst(pos,color=0x6fe9ef){
  const count=70, geo=new THREE.BufferGeometry(), arr=[];for(let i=0;i<count;i++)arr.push(pos.x+(Math.random()-.5)*1.3,pos.y+(Math.random()-.5)*.5,pos.z+(Math.random()-.5)*1.3);
  geo.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));const mat=new THREE.PointsMaterial({color,size:.13,transparent:true});const pts=new THREE.Points(geo,mat);system.add(pts);
  let life=1;const tick=()=>{life-=.03;pts.scale.multiplyScalar(1.055);mat.opacity=life;if(life>0)requestAnimationFrame(tick);else{system.remove(pts);geo.dispose();mat.dispose();}};tick();
}
function addPoints(p,pos){ combo++; const gained=Math.round(p*(1+(combo-1)*.5)*scoreBoost);score+=gained;best=Math.max(best,gained);updateHud();
  const v=pos.clone().project(camera);const el=document.createElement('span');el.textContent=`+${gained.toLocaleString()}  ×${combo}`;el.style.left=`${(v.x*.5+.5)*innerWidth}px`;el.style.top=`${(-v.y*.5+.5)*innerHeight}px`;$('#floating-texts').append(el);setTimeout(()=>el.remove(),1100);
  if(score>=target)setTimeout(clearSector,700);
}
function physics(dt,t){
  sun.rotation.y+=dt*.16;sun.rotation.z+=dt*.04;sunHalo.scale.setScalar(1+Math.sin(t*2)*.035);
  for(const p of planets){if(!p.alive)continue;p.mesh.rotation.y+=dt*(.3+p.mass*.12);
    if(!p.launched){p.phase+=p.speed*dt;p.mesh.position.set(Math.cos(p.phase)*p.orbit,0,Math.sin(p.phase)*p.orbit);}
    else{const d=p.mesh.position.length(),dir=p.mesh.position.clone().normalize();p.velocity.addScaledVector(dir,-21*dt/Math.max(d*d,1.5));p.mesh.position.addScaledVector(p.velocity,dt);p.trail.push(p.mesh.position.clone());if(p.trail.length>70)p.trail.shift();if(p.trailLine)system.remove(p.trailLine);p.trailLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.trail),new THREE.LineBasicMaterial({color:palette[0],transparent:true,opacity:.45}));system.add(p.trailLine);
      if(d<1.5+p.radius){p.alive=false;p.mesh.visible=false;burst(p.mesh.position,0xffa12f);addPoints(900,p.mesh.position);}
      if(d>18){p.launched=false;p.orbit=Math.min(10.2,Math.max(4.3,d%11));p.phase=Math.atan2(p.mesh.position.z,p.mesh.position.x);p.velocity.set(0,0,0);}
    }}
  for(let i=0;i<planets.length;i++)for(let j=i+1;j<planets.length;j++){const a=planets[i],b=planets[j];if(!a.alive||!b.alive)continue;const dist=a.mesh.position.distanceTo(b.mesh.position);if(dist<(a.radius+b.radius)*blastRadius&&(a.launched||b.launched)&&t-a.lastHit>.55&&t-b.lastHit>.55){a.lastHit=b.lastHit=t;const mid=a.mesh.position.clone().add(b.mesh.position).multiplyScalar(.5);burst(mid);addPoints(600,mid);const striker=a.launched?a:b,other=a.launched?b:a;const n=other.mesh.position.clone().sub(striker.mesh.position).normalize();striker.velocity.reflect(n).multiplyScalar(.78);other.launched=true;other.velocity.copy(n.multiplyScalar(3.5));}}
  if(shots<=0&&!planets.some(p=>p.launched)&&score<target)setTimeout(failSector,500);
}
function updateHud(){ $('#score').textContent=score.toLocaleString();$('#shots').textContent=shots;$('#combo').textContent=combo?`×${combo}`:'—';$('#best').textContent=best.toLocaleString();$('#target').textContent=target.toLocaleString();const pc=Math.min(100,score/target*100);$('#target-percent').textContent=`${Math.floor(pc)}%`;$('#score-progress').style.width=`${pc}%`;}
let resolved=false;
function clearSector(){if(resolved)return;resolved=true;running=false;$('#sector-modal').classList.add('open');}
function failSector(){if(resolved)return;resolved=true;running=false;$('#result-kicker').textContent='RUN TERMINATED';$('#result-title').textContent='중력이 붕괴했습니다';$('#result-copy').textContent='목표 점수에 도달하지 못했습니다. 궤도를 다시 계산하세요.';$('#reward-grid').classList.add('hidden');$('#continue-btn').classList.remove('hidden');$('#sector-modal').classList.add('open');}
function resetWorld(next=false){for(const p of planets){p.alive=true;p.launched=false;p.mesh.visible=true;p.velocity.set(0,0,0);p.trail=[];if(p.trailLine){system.remove(p.trailLine);p.trailLine=null;}}score=0;combo=0;best=0;shots=5+(next?Math.floor(sector/2):0);resolved=false;running=true;updateHud();}
function nextSector(reward){if(reward==='mass')scoreBoost+=.25;if(reward==='shot')shots+=2;if(reward==='radius')blastRadius=1.35;sector=Math.min(5,sector+1);target=Math.round(2500*Math.pow(1.65,sector-1));$('#sector-label').textContent=`SECTOR ${sector} / 5`;$('#sector-modal').classList.remove('open');resetWorld(true);}
$('#start-btn').onclick=()=>{$('#intro').classList.remove('open');running=true;};
$('#reset-btn').onclick=()=>{resetWorld();const t=$('#toast');t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1300);};
$('#continue-btn').onclick=()=>{location.reload();};
document.querySelectorAll('[data-reward]').forEach(b=>b.onclick=()=>nextSector(b.dataset.reward));
let muted=true;$('#sound-btn').onclick=()=>{muted=!muted;$('#sound-btn').innerHTML=`${muted?'◖':'◗'}<span>${muted?'Sound':'On'}</span>`;};
function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.035),t=clock.elapsedTime;if(running)physics(dt,t);system.rotation.y=Math.sin(t*.08)*.035;renderer.render(scene,camera);}animate();updateHud();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
