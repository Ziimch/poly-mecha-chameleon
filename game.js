import * as THREE from "three";

const serverURL = window.GAME_SERVER_URL;
let ws, myId=null, started=false, hp=100, weapon="rifle", ammo=30, reserve=120, reloading=false;
let players=new Map(), input={x:0,z:0}, look={yaw:0,pitch:0}, lastShoot=0, grenadeCooldown=0, abilityCooldown=0;
let room="default", mode="tdm", guestName="", showScore=false;
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x7aa6c2);
const camera=new THREE.PerspectiveCamera(70,innerWidth/innerHeight,.05,500);
const renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:"high-performance"});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.setSize(innerWidth,innerHeight); document.body.appendChild(renderer.domElement);
const clock=new THREE.Clock();
const world=new THREE.Group(); scene.add(world);
const playerRoot=new THREE.Group(); world.add(playerRoot); playerRoot.position.set(0,1.1,8);

function mat(c){return new THREE.MeshLambertMaterial({color:c});}
scene.add(new THREE.HemisphereLight(0xbde5ff,0x263344,1.8));
const sun=new THREE.DirectionalLight(0xffffff,1.5); sun.position.set(8,18,5); scene.add(sun);

function makeMap(mapName="arena"){
  while(world.children.length) world.remove(world.children[0]);
  const floor=new THREE.Mesh(new THREE.BoxGeometry(80,.5,80),mat(0x2d3844)); floor.position.y=-.25; world.add(floor);
  const wallMat=mat(mapName==="training"?0x355c5d:0x394a63);
  const blocks=mapName==="training" ? [[0,1,-10,5,2,8],[-12,1,2,4,2,12],[12,1,2,4,2,12],[0,1,12,8,2,4]] :
    [[-14,1,-8,5,2,14],[14,1,-8,5,2,14],[-5,1,7,8,2,4],[8,1,12,5,2,8],[-10,1,14,5,2,6],[0,1,-17,14,2,4]];
  for(const [x,y,z,sx,sy,sz] of blocks){const b=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),wallMat);b.position.set(x,y,z);world.add(b)}
  for(let i=0;i<28;i++){const b=new THREE.Mesh(new THREE.IcosahedronGeometry(.5+Math.random()*1.1,0),mat([0x42d6a4,0xffc857,0xff6b6b,0x8d7aff][i%4]));b.position.set((Math.random()-.5)*65,.7,(Math.random()-.5)*65);world.add(b)}
}
makeMap("arena");

function makeMecha(color=0x49d5b1){
  const g=new THREE.Group(), m=mat(color), dark=mat(0x182331);
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.05,1.15,.7),m);body.position.y=1.35;g.add(body);
  const head=new THREE.Mesh(new THREE.IcosahedronGeometry(.48,0),m);head.position.y=2.25;g.add(head);
  const eye=new THREE.Mesh(new THREE.BoxGeometry(.45,.12,.08),dark);eye.position.set(0,2.25,-.43);g.add(eye);
  for(const s of [-1,1]){const arm=new THREE.Mesh(new THREE.BoxGeometry(.3,.95,.35),m);arm.position.set(s*.75,1.35,0);g.add(arm);const leg=new THREE.Mesh(new THREE.BoxGeometry(.38,1,.42),dark);leg.position.set(s*.3,.5,0);g.add(leg)}
  const tail=new THREE.Mesh(new THREE.TorusGeometry(.28,.08,6,12),m);tail.rotation.x=Math.PI/2;tail.position.set(0,1.4,.5);g.add(tail);
  return g;
}
playerRoot.add(makeMecha(0x49d5b1));

function addOther(id,p){
  const g=makeMecha(p.color||0xff6b6b); g.userData.id=id; g.position.set(p.x||0,0,p.z||0); g.rotation.y=p.r||0; world.add(g);
  players.set(id,{...p,mesh:g});
}
function removeOther(id){const p=players.get(id);if(p){world.remove(p.mesh);players.delete(id)}}

function send(o){if(ws?.readyState===1)ws.send(JSON.stringify(o))}
function connect(){
  document.getElementById("status").textContent="Server: menghubungkan...";
  const u=new URL(serverURL); u.searchParams.set("room",room); u.searchParams.set("mode",mode); ws=new WebSocket(u.toString());
  ws.onopen=()=>{document.getElementById("status").textContent="Server: terhubung";send({type:"join",name:guestName,room,mode})};
  ws.onclose=()=>{document.getElementById("status").textContent="Server: terputus";};
  ws.onerror=()=>{document.getElementById("status").textContent="Server: gagal terhubung"};
  ws.onmessage=e=>handle(JSON.parse(e.data));
}
function handle(m){
  if(m.type==="welcome"){myId=m.id;room=m.room;mode=m.mode;document.getElementById("roomLabel").textContent=room.toUpperCase();document.getElementById("modeLabel").textContent=mode.toUpperCase()}
  if(m.type==="snapshot"){for(const id of [...players.keys()])if(!m.players[id])removeOther(id);for(const [id,p] of Object.entries(m.players)){if(id===myId)continue;let q=players.get(id);if(!q)addOther(id,p);else{Object.assign(q,p);q.mesh.position.lerp(new THREE.Vector3(p.x,0,p.z),.35);q.mesh.rotation.y=p.r||0}}document.getElementById("playerCount").textContent=Object.keys(m.players).length}
  if(m.type==="state"){hp=m.hp;ammo=m.ammo;reserve=m.reserve;updateHUD()}
  if(m.type==="hit"){flashHit(m.headshot); if(m.target===myId)hp=Math.max(0,hp-m.damage)}
  if(m.type==="kill"){feed(`${m.killerName} → ${m.victimName}${m.headshot?" 🎯":""}`)}
  if(m.type==="respawn"){hp=m.hp||100;playerRoot.position.set(m.x||0,1.1,m.z||8);updateHUD()}
  if(m.type==="scoreboard")renderScore(m.players||[]);
  if(m.type==="grenade"){explode(m.x,m.z)}
}
function updateHUD(){document.getElementById("hpText").textContent=`HP ${Math.max(0,hp)}`;document.getElementById("hpFill").style.width=Math.max(0,hp)+"%";document.getElementById("ammo").textContent=`${ammo} / ${reserve}`}
function feed(t){const d=document.createElement("div");d.className="feed";d.textContent=t;document.getElementById("killfeed").prepend(d);setTimeout(()=>d.remove(),4000)}
function flashHit(){const h=document.getElementById("hitmarker");h.classList.add("show");setTimeout(()=>h.classList.remove("show"),100)}
function renderScore(list){const el=document.getElementById("scoreboard");el.classList.remove("hidden");el.innerHTML="<b>Scoreboard</b>"+list.sort((a,b)=>b.kills-a.kills).map(p=>`<div class="score-row ${p.id===myId?"me":""}"><span>${p.name||"Guest"}</span><span>${p.kills} K / ${p.deaths} D</span></div>`).join("")}
function shoot(){if(!started||reloading||ammo<=0)return;const now=performance.now();if(now-lastShoot<120)return;lastShoot=now;ammo--;updateHUD();send({type:"shoot",origin:{x:playerRoot.position.x,y:1.7,z:playerRoot.position.z},dir:camera.getWorldDirection(new THREE.Vector3()).toArray(),weapon})}
function reload(){if(reloading||ammo>=30||reserve<=0)return;reloading=true;setTimeout(()=>{const n=Math.min(30-ammo,reserve);ammo+=n;reserve-=n;reloading=false;send({type:"reload"});updateHUD()},900)}
function grenade(){if(performance.now()<grenadeCooldown)return;grenadeCooldown=performance.now()+3000;const d=camera.getWorldDirection(new THREE.Vector3());send({type:"grenade",origin:{x:playerRoot.position.x,y:1.5,z:playerRoot.position.z},dir:d.toArray()})}
function ability(){if(performance.now()<abilityCooldown)return;abilityCooldown=performance.now()+8000;send({type:"ability",ability:"cloak"})}
function explode(x,z){const s=new THREE.Mesh(new THREE.SphereGeometry(1.2,10,10),mat(0xffa63d));s.position.set(x,.8,z);world.add(s);setTimeout(()=>world.remove(s),180)}

const keys={};addEventListener("keydown",e=>{keys[e.code]=true;if(e.code==="KeyR")reload();if(e.code==="KeyG")grenade();if(e.code==="KeyQ")ability();if(e.code==="Tab"){e.preventDefault();showScore=!showScore;document.getElementById("scoreboard").classList.toggle("hidden",!showScore);if(showScore)send({type:"scoreboard"})}});
addEventListener("keyup",e=>keys[e.code]=false);
renderer.domElement.addEventListener("click",()=>{if(started&&innerWidth>800)renderer.domElement.requestPointerLock()});
addEventListener("mousemove",e=>{if(document.pointerLockElement===renderer.domElement){look.yaw-=e.movementX*.002;look.pitch-=e.movementY*.002;look.pitch=Math.max(-1.3,Math.min(1.3,look.pitch))}});
renderer.domElement.addEventListener("mousedown",e=>{if(e.button===0)shoot()});

let joyActive=false,joyId=null,joyCenter={x:0,y:0};
const jb=document.getElementById("joyBase"),jk=document.getElementById("joyKnob");
jb.addEventListener("touchstart",e=>{joyActive=true;joyId=e.changedTouches[0].identifier;const r=jb.getBoundingClientRect();joyCenter={x:r.left+r.width/2,y:r.top+r.height/2}},{passive:true});
addEventListener("touchmove",e=>{for(const t of e.changedTouches)if(t.identifier===joyId){let dx=t.clientX-joyCenter.x,dy=t.clientY-joyCenter.y;const max=50,l=Math.hypot(dx,dy)||1;if(l>max){dx=dx/l*max;dy=dy/l*max}input.x=dx/max;input.z=dy/max;jk.style.transform=`translate(${dx}px,${dy}px)`}},{passive:true});
addEventListener("touchend",e=>{for(const t of e.changedTouches)if(t.identifier===joyId){joyActive=false;input.x=input.z=0;jk.style.transform=""}});

const lookArea=document.getElementById("lookArea");let lookTouch=null,lastTX=0,lastTY=0;
lookArea.addEventListener("touchstart",e=>{const t=e.changedTouches[0];lookTouch=t.identifier;lastTX=t.clientX;lastTY=t.clientY},{passive:true});
lookArea.addEventListener("touchmove",e=>{for(const t of e.changedTouches)if(t.identifier===lookTouch){look.yaw-=(t.clientX-lastTX)*.008;look.pitch-=(t.clientY-lastTY)*.008;look.pitch=Math.max(-1.3,Math.min(1.3,look.pitch));lastTX=t.clientX;lastTY=t.clientY}},{passive:true});
document.getElementById("fire").addEventListener("touchstart",e=>{e.preventDefault();shoot()});
document.getElementById("reload").addEventListener("touchstart",e=>{e.preventDefault();reload()});
document.getElementById("grenade").addEventListener("touchstart",e=>{e.preventDefault();grenade()});
document.getElementById("ability").addEventListener("touchstart",e=>{e.preventDefault();ability()});
document.getElementById("scoreBtn").addEventListener("touchstart",e=>{e.preventDefault();showScore=!showScore;document.getElementById("scoreboard").classList.toggle("hidden",!showScore);if(showScore)send({type:"scoreboard"})});
document.getElementById("helpBtn").onclick=()=>document.getElementById("help").classList.toggle("hidden");
document.getElementById("playBtn").onclick=()=>{
  guestName=(document.getElementById("nameInput").value||"Guest-"+Math.floor(1000+Math.random()*9000)).slice(0,16);
  room=document.getElementById("roomInput").value;mode=document.getElementById("modeInput").value;
  localStorage.setItem("pmc_guest_name",guestName);
  document.getElementById("menu").classList.add("hidden");document.getElementById("hud").classList.remove("hidden");started=true;
  connect();
};
document.getElementById("nameInput").value=localStorage.getItem("pmc_guest_name")||"";
addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});

function tick(){
  requestAnimationFrame(tick);const dt=Math.min(clock.getDelta(),.05);
  if(started){
    let x=input.x,z=input.z;
    if(innerWidth>800){x=(keys.KeyD?1:0)-(keys.KeyA?1:0);z=(keys.KeyS?1:0)-(keys.KeyW?1:0);const l=Math.hypot(x,z)||1;x/=l;z/=l}
    const speed=5.2; const fx=Math.sin(look.yaw),fz=Math.cos(look.yaw); const rx=Math.cos(look.yaw),rz=-Math.sin(look.yaw);
    playerRoot.position.x+=(rx*x+fx*z)*speed*dt;playerRoot.position.z+=(rz*x+fz*z)*speed*dt;
    playerRoot.position.x=Math.max(-36,Math.min(36,playerRoot.position.x));playerRoot.position.z=Math.max(-36,Math.min(36,playerRoot.position.z));
    camera.position.set(playerRoot.position.x,playerRoot.position.y+1.0,playerRoot.position.z);
    camera.rotation.set(look.pitch,look.yaw,0,"YXZ");
    if(Math.random()<dt*20)send({type:"move",x:playerRoot.position.x,z:playerRoot.position.z,r:look.yaw});
  }else{camera.position.set(0,8,16);camera.lookAt(0,1,0)}
  renderer.render(scene,camera);
}
tick();
