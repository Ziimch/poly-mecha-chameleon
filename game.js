import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.2/build/three.module.js";

const SERVER_URL = String(window.GAME_SERVER_URL || "").trim();
const DIAG = window.GAME_DIAGNOSTICS !== false;

const $ = (id) => document.getElementById(id);
const menu=$("menu"), hud=$("hud"), statusEl=$("status"), diagEl=$("diag"), diagHud=$("diagHud");
const guestName=$("guestName"), roomEl=$("room"), modeEl=$("mode"), play=$("play");
const hpEl=$("hp"), ammoEl=$("ammo"), roomLabel=$("roomLabel"), feedEl=$("feed"), scoreboardEl=$("scoreboard");

let ws=null, myId=null, connected=false, reconnecting=false;
let room="default", mode="tdm", name="Guest";
let ammo=30, reserve=120, hp=100, lastShot=0, fireInterval=130;
let seq=0, lastWsEvent="idle", lastError="", closeCode="", closeReason="";
const players=new Map();
const keys={w:false,a:false,s:false,d:false};
let moveX=0, moveY=0, touchLook={active:false,x:0,y:0};
const clock=new THREE.Clock();

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x79a9c2);
scene.fog=new THREE.Fog(0x79a9c2,35,120);
const camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,.05,250);
camera.position.set(0,1.7,8);
const renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:"high-performance"});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.setSize(innerWidth,innerHeight);
$("game").appendChild(renderer.domElement);

const hemi=new THREE.HemisphereLight(0xffffff,0x334455,1.7); scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffffff,1.8); sun.position.set(8,15,5); scene.add(sun);

function mat(c){return new THREE.MeshStandardMaterial({color:c,roughness:.8,metalness:.05});}
const floor=new THREE.Mesh(new THREE.PlaneGeometry(180,180),mat(0x263c4c)); floor.rotation.x=-Math.PI/2; scene.add(floor);
for(let i=0;i<36;i++){
  const x=(Math.random()-.5)*120,z=(Math.random()-.5)*100;
  const h=2+Math.random()*8,s=2+Math.random()*5;
  const m=new THREE.Mesh(new THREE.BoxGeometry(s,h,s),mat([0x2c7899,0x6d4c88,0x3c8267,0x9a6d3c][i%4]));
  m.position.set(x,h/2,z); scene.add(m);
}

function makePlayer(color=0x55dd77){
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.IcosahedronGeometry(.55,1),mat(color)); body.position.y=1.05; g.add(body);
  const head=new THREE.Mesh(new THREE.IcosahedronGeometry(.38,1),mat(0x8be35c)); head.position.set(0,1.85,0); g.add(head);
  const eyeMat=mat(0xffffff), pupil=mat(0x111111);
  for(const x of [-.13,.13]){
    const e=new THREE.Mesh(new THREE.SphereGeometry(.09,8,8),eyeMat); e.position.set(x,1.9,.34); g.add(e);
    const p=new THREE.Mesh(new THREE.SphereGeometry(.04,6,6),pupil); p.position.set(x,1.9,.415); g.add(p);
  }
  for(const x of [-.35,.35]){
    const arm=new THREE.Mesh(new THREE.BoxGeometry(.18,.75,.18),mat(color)); arm.position.set(x,.98,0); g.add(arm);
  }
  return g;
}
const local=makePlayer(0x39a9ff); local.visible=false; scene.add(local);

function addRemote(p){
  const g=makePlayer(p.color||0xff7b55); scene.add(g); players.set(p.id,{...p,mesh:g});
}
function removeRemote(id){const p=players.get(id); if(p){scene.remove(p.mesh);players.delete(id)}}
function applySnapshot(list){
  const seen=new Set();
  for(const p of list||[]){
    seen.add(p.id);
    if(p.id===myId) continue;
    if(!players.has(p.id)) addRemote(p);
    const r=players.get(p.id); Object.assign(r,p);
    r.mesh.position.set(p.x||0,0,p.z||0); r.mesh.rotation.y=p.ry||0;
  }
  for(const id of [...players.keys()]) if(!seen.has(id)) removeRemote(id);
}
function setDiag(extra=""){
  if(!DIAG) return;
  const lines=[
    `WS: ${lastWsEvent}`,
    `URL: ${SERVER_URL || "(empty)"}`,
    `state: ${ws ? ws.readyState : "none"} (0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED)`,
    closeCode ? `close: ${closeCode} ${closeReason||""}` : "",
    lastError ? `error: ${lastError}` : "",
    extra
  ].filter(Boolean).join("\n");
  diagEl.textContent=lines; diagHud.textContent=lines;
}
function setStatus(t){statusEl.textContent=t; setDiag();}
function safeSend(obj){
  if(!ws || ws.readyState!==WebSocket.OPEN) return false;
  try{ws.send(JSON.stringify(obj));return true}catch(e){lastError=String(e);setDiag();return false}
}

function connect(){
  if(!SERVER_URL){lastError="GAME_SERVER_URL kosong";setStatus("Server: URL kosong");return;}
  if(!/^wss:\/\//i.test(SERVER_URL)){lastError="Gunakan wss:// karena site HTTPS";setStatus("Server: URL salah");return;}
  if(ws && (ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING)) return;

  lastWsEvent="connecting"; lastError=""; closeCode=""; closeReason="";
  setStatus("Server: menghubungkan...");
  let url;
  try{
    const u=new URL(SERVER_URL);
    u.searchParams.set("room",room);
    u.searchParams.set("mode",mode);
    u.searchParams.set("client","v2.1");
    url=u.toString();
  }catch(e){lastError="URL tidak valid: "+e;setStatus("Server: URL tidak valid");setDiag();return;}

  try{ws=new WebSocket(url);}catch(e){lastError=String(e);setStatus("Server: WebSocket gagal dibuat");setDiag();return;}

  ws.onopen=()=>{
    connected=true; lastWsEvent="open"; setStatus("Server: terhubung");
    safeSend({type:"join",name,room,mode,clientVersion:"2.1"});
  };
  ws.onmessage=(ev)=>{
    lastWsEvent="message";
    let m; try{m=JSON.parse(ev.data)}catch{return}
    if(m.type==="welcome"){myId=m.id;hp=m.hp??100;ammo=m.ammo??30;reserve=m.reserve??120;updateHud();setStatus("Server: terhubung");}
    else if(m.type==="snapshot"){applySnapshot(m.players); if(m.scores) updateScore(m.scores);}
    else if(m.type==="state"){if(m.id===myId){hp=m.hp??hp;ammo=m.ammo??ammo;reserve=m.reserve??reserve;updateHud()}}
    else if(m.type==="hit"){addFeed(`Hit ${m.part||"body"} -${m.damage||0}`);}
    else if(m.type==="kill"){addFeed(`${m.killerName||"?"} → ${m.victimName||"?"}`);}
    else if(m.type==="grenade"){addFeed("💥 Grenade");}
    else if(m.type==="error"){lastError=m.message||"server error";setStatus("Server: error");}
    setDiag();
  };
  ws.onerror=()=>{
    connected=false;lastWsEvent="error";lastError="WebSocket error (browser tidak memberi detail)";
    setStatus("Server: WebSocket ERROR");setDiag();
  };
  ws.onclose=(e)=>{
    connected=false;lastWsEvent="close";closeCode=e.code;closeReason=e.reason||"";
    setStatus(`Server: terputus (${e.code})`);setDiag();
  };
}

function updateHud(){hpEl.textContent=`HP ${Math.max(0,Math.round(hp))}`;ammoEl.textContent=`AMMO ${ammo}/${reserve}`;roomLabel.textContent=`ROOM ${room}`;}
function addFeed(t){const d=document.createElement("div");d.className="feedline";d.textContent=t;feedEl.prepend(d);setTimeout(()=>d.remove(),4500);}
function updateScore(scores={}){
  scoreboardEl.innerHTML="<b>SCOREBOARD</b><br>"+Object.entries(scores).map(([n,s])=>`${n}: ${s}`).join("<br>");
}

function shoot(){
  const now=performance.now(); if(now-lastShot<fireInterval)return;
  if(ammo<=0){addFeed("Reload (R)");return}
  lastShot=now;ammo--;updateHud();
  const origin={x:camera.position.x,y:camera.position.y,z:camera.position.z};
  const dir=new THREE.Vector3();camera.getWorldDirection(dir);
  safeSend({type:"shoot",seq:++seq,origin:{x:origin.x,y:origin.y,z:origin.z},dir:{x:dir.x,y:dir.y,z:dir.z}});
}
function reload(){if(ammo>=30||reserve<=0)return;const n=Math.min(30-ammo,reserve);ammo+=n;reserve-=n;updateHud();safeSend({type:"reload"});}
function grenade(){safeSend({type:"grenade",origin:{x:camera.position.x,y:camera.position.y,z:camera.position.z}});addFeed("Grenade thrown");}

function updateMovement(dt){
  let x=(keys.d?1:0)-(keys.a?1:0)+moveX;
  let z=(keys.s?1:0)-(keys.w?1:0)+moveY;
  const len=Math.hypot(x,z);if(len>1){x/=len;z/=len}
  const speed=6;
  const sin=Math.sin(local.rotation.y),cos=Math.cos(local.rotation.y);
  camera.position.x += (x*cos-z*sin)*speed*dt;
  camera.position.z += (z*cos+x*sin)*speed*dt;
  camera.position.x=Math.max(-85,Math.min(85,camera.position.x));
  camera.position.z=Math.max(-85,Math.min(85,camera.position.z));
  local.position.set(camera.position.x,0,camera.position.z);
  if(connected && (x||z)) safeSend({type:"move",x:camera.position.x,z:camera.position.z,ry:local.rotation.y,seq:++seq});
}
function loop(){
  requestAnimationFrame(loop);
  const dt=Math.min(clock.getDelta(),.05);
  updateMovement(dt);
  camera.position.y=1.7;
  local.position.y=0;
  renderer.render(scene,camera);
}
loop();

addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
addEventListener("keydown",e=>{
  if(e.code==="KeyW")keys.w=true;if(e.code==="KeyA")keys.a=true;if(e.code==="KeyS")keys.s=true;if(e.code==="KeyD")keys.d=true;
  if(e.code==="KeyR")reload();if(e.code==="KeyG")grenade();if(e.code==="Tab"){e.preventDefault();scoreboardEl.style.display=scoreboardEl.style.display==="block"?"none":"block";}
});
addEventListener("keyup",e=>{if(e.code==="KeyW")keys.w=false;if(e.code==="KeyA")keys.a=false;if(e.code==="KeyS")keys.s=false;if(e.code==="KeyD")keys.d=false;});
renderer.domElement.addEventListener("click",()=>{if(!matchMedia("(pointer:coarse)").matches){renderer.domElement.requestPointerLock?.()}shoot();});
addEventListener("mousemove",e=>{if(document.pointerLockElement===renderer.domElement){local.rotation.y-=e.movementX*.002;camera.rotation.y=local.rotation.y;camera.rotation.x=Math.max(-1.2,Math.min(1.2,camera.rotation.x-e.movementY*.002));}});
$("fire").addEventListener("touchstart",e=>{e.preventDefault();shoot()},{passive:false});
$("reload").addEventListener("touchstart",e=>{e.preventDefault();reload()},{passive:false});
$("grenade").addEventListener("touchstart",e=>{e.preventDefault();grenade()},{passive:false});

let joyId=null,joyCenter={x:0,y:0};
$("joystick").addEventListener("touchstart",e=>{e.preventDefault();const t=e.changedTouches[0];joyId=t.identifier;const r=$("joystick").getBoundingClientRect();joyCenter={x:r.left+r.width/2,y:r.top+r.height/2};},{passive:false});
$("joystick").addEventListener("touchmove",e=>{e.preventDefault();for(const t of e.changedTouches)if(t.identifier===joyId){let dx=t.clientX-joyCenter.x,dy=t.clientY-joyCenter.y;const m=Math.min(45,Math.hypot(dx,dy)),a=Math.atan2(dy,dx);moveX=Math.cos(a)*m/45;moveY=Math.sin(a)*m/45;$("stick").style.transform=`translate(${moveX*45}px,${moveY*45}px)`;}},{passive:false});
$("joystick").addEventListener("touchend",e=>{for(const t of e.changedTouches)if(t.identifier===joyId){joyId=null;moveX=moveY=0;$("stick").style.transform="translate(0,0)";}});
let lookId=null,lastLX=0,lastLY=0;
$("lookZone").addEventListener("touchstart",e=>{const t=e.changedTouches[0];lookId=t.identifier;lastLX=t.clientX;lastLY=t.clientY;},{passive:true});
$("lookZone").addEventListener("touchmove",e=>{for(const t of e.changedTouches)if(t.identifier===lookId){local.rotation.y-=(t.clientX-lastLX)*.006;camera.rotation.y=local.rotation.y;camera.rotation.x=Math.max(-1.2,Math.min(1.2,camera.rotation.x-(t.clientY-lastLY)*.004));lastLX=t.clientX;lastLY=t.clientY;}},{passive:true});
$("lookZone").addEventListener("touchend",()=>{lookId=null});

$("controls").onclick=()=>{$("help").hidden=false};
$("closeHelp").onclick=()=>{$("help").hidden=true};
guestName.value=localStorage.getItem("pmc_guest")||"Guest";
play.onclick=()=>{
  name=(guestName.value.trim()||"Guest").slice(0,16);localStorage.setItem("pmc_guest",name);
  room=roomEl.value;mode=modeEl.value;roomLabel.textContent=`ROOM ${room}`;
  menu.hidden=true;hud.hidden=false;local.visible=true;
  connect();
};
setDiag("V2.1 ready");
