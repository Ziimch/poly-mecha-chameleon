export class GameRoom {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.clients = new Map();
    this.players = new Map();
    this.lastSnapshot = 0;
    this.state.blockConcurrencyWhile(async()=>{ this.state.storage.sql.exec(`CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT, kills INTEGER DEFAULT 0, deaths INTEGER DEFAULT 0, skin TEXT, last_seen INTEGER)`); });
  }
  async fetch(req) {
    if(req.headers.get("Upgrade") !== "websocket") return Response.json({ok:true,room:this.state.id.toString(),players:this.players.size,guestMode:true});
    const pair = new WebSocketPair(); const [client,server] = Object.values(pair);
    server.accept(); const id=crypto.randomUUID(); const url=new URL(req.url);
    this.clients.set(id,server);
    this.players.set(id,{id,name:"Guest",x:0,z:8,r:0,hp:100,maxHp:100,ammo:30,reserve:120,kills:0,deaths:0,skin:"chameleon",team:"A",parts:{head:100,body:150,leftArm:80,rightArm:80,leftLeg:100,rightLeg:100}});
    server.addEventListener("message",e=>this.onMessage(id,e.data));
    server.addEventListener("close",()=>{this.clients.delete(id);this.players.delete(id);this.broadcast({type:"snapshot",players:this.publicPlayers()});});
    this.send(id,{type:"welcome",id,room:url.searchParams.get("room")||"default",mode:url.searchParams.get("mode")||"tdm"});
    this.send(id,{type:"state",hp:100,ammo:30,reserve:120});
    return new Response(null,{status:101,webSocket:client});
  }
  send(id,msg){const s=this.clients.get(id);if(s)try{s.send(JSON.stringify(msg))}catch{}}
  broadcast(msg){const raw=JSON.stringify(msg);for(const s of this.clients.values())try{s.send(raw)}catch{}}
  publicPlayers(){const o={};for(const [id,p] of this.players)o[id]={id,name:p.name,x:p.x,z:p.z,r:p.r,hp:p.hp,skin:p.skin,team:p.team,color:p.team==="A"?0x49d5b1:0xff6b6b,kills:p.kills,deaths:p.deaths};return o}
  onMessage(id,data){
    let m;try{m=JSON.parse(data)}catch{return};const p=this.players.get(id);if(!p)return;
    if(m.type==="join"){p.name=String(m.name||"Guest").slice(0,16);p.room=String(m.room||"default").slice(0,24);p.mode=["tdm","ffa","survival"].includes(m.mode)?m.mode:"tdm";p.team=p.mode==="ffa"?"FFA":(this.players.size%2?"A":"B");this.send(id,{type:"welcome",id,room:p.room,mode:p.mode});this.broadcast({type:"snapshot",players:this.publicPlayers()});return}
    if(m.type==="move"){const nx=Number(m.x),nz=Number(m.z);if(!Number.isFinite(nx)||!Number.isFinite(nz))return;if(Math.abs(nx-p.x)>1.2||Math.abs(nz-p.z)>1.2)return;p.x=Math.max(-36,Math.min(36,nx));p.z=Math.max(-36,Math.min(36,nz));p.r=Number(m.r)||0;this.throttledSnapshot();return}
    if(m.type==="reload"){p.ammo=30;this.send(id,{type:"state",hp:p.hp,ammo:p.ammo,reserve:p.reserve});return}
    if(m.type==="shoot"){this.shoot(id,m);return}
    if(m.type==="grenade"){this.grenade(id,m);return}
    if(m.type==="ability"){this.send(id,{type:"ability",ok:true,ability:m.ability});return}
    if(m.type==="scoreboard"){this.send(id,{type:"scoreboard",players:[...this.players.values()].map(q=>({id:q.id,name:q.name,kills:q.kills,deaths:q.deaths,team:q.team}))});}
  }
  throttledSnapshot(){const n=Date.now();if(n-this.lastSnapshot<50)return;this.lastSnapshot=n;this.broadcast({type:"snapshot",players:this.publicPlayers()})}
  shoot(id,m){
    const p=this.players.get(id);if(!p||p.ammo<=0)return;p.ammo--;
    const ox=Number(m.origin?.x),oz=Number(m.origin?.z),dx=Number(m.dir?.[0]),dz=Number(m.dir?.[2]);if(![ox,oz,dx,dz].every(Number.isFinite))return;
    let best=null,bestDist=999;
    for(const [tid,t] of this.players){if(tid===id||t.hp<=0)continue;if(p.mode==="tdm"&&p.team===t.team)continue;
      const vx=t.x-ox,vz=t.z-oz,proj=vx*dx+vz*dz;if(proj<0||proj>60)continue;const px=ox+dx*proj,pz=oz+dz*proj;const dist=Math.hypot(t.x-px,t.z-pz);if(dist>.75)continue;
      if(proj<bestDist){bestDist=proj;best={id:tid,p:t}}
    }
    if(best){const head=Math.random()<.18;const damage=head?60:25;best.p.hp=Math.max(0,best.p.hp-damage);this.send(id,{type:"hit",target:best.id,damage,headshot:head});this.send(best.id,{type:"hit",target:best.id,damage,headshot:head});if(best.p.hp<=0)this.kill(id,best.id,head)}
    this.send(id,{type:"state",hp:p.hp,ammo:p.ammo,reserve:p.reserve});
  }
  kill(killerId,victimId,headshot){
    const k=this.players.get(killerId),v=this.players.get(victimId);if(!k||!v)return;k.kills++;v.deaths++;this.broadcast({type:"kill",killerName:k.name,victimName:v.name,headshot});
    setTimeout(()=>{if(!this.players.has(victimId))return;v.hp=100;v.ammo=30;v.reserve=120;v.x=(Math.random()-.5)*20;v.z=(Math.random()-.5)*20;this.send(victimId,{type:"respawn",hp:100,x:v.x,z:v.z});this.broadcast({type:"snapshot",players:this.publicPlayers()})},1200);
  }
  grenade(id,m){
    const p=this.players.get(id);if(!p)return;const dx=Number(m.dir?.[0])||0,dz=Number(m.dir?.[2])||1;const x=p.x+dx*6,z=p.z+dz*6;this.broadcast({type:"grenade",x,z});
    for(const [tid,t] of this.players){if(tid===id||t.hp<=0)continue;const d=Math.hypot(t.x-x,t.z-z);if(d<4){t.hp=Math.max(0,t.hp-Math.round(70*(1-d/4)));this.send(tid,{type:"state",hp:t.hp,ammo:t.ammo,reserve:t.reserve})}}
  }
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==="/ws" && request.headers.get("Upgrade")==="websocket"){
      const room=(url.searchParams.get("room")||"default").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,32)||"default";
      const id=env.GAME_ROOMS.idFromName(room);
      return env.GAME_ROOMS.get(id).fetch(request);
    }
    return Response.json({ok:true,game:"Poly Mecha Chameleon FPS",guestMode:true,endpoint:"/ws?room=default&mode=tdm"});
  }
}
