import { DurableObject } from "cloudflare:workers";

const COLORS = [0x39a9ff,0xff6b5e,0x65d889,0xf6c85f,0xb07cff,0xff8f3d];

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}
function clamp(n,a,b){return Math.max(a,Math.min(b,Number(n)||0));}

export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if(url.pathname==="/health" || url.pathname==="/"){
      return json({
        ok:true,
        game:"Poly Mecha Chameleon FPS",
        version:"2.1",
        guestMode:true,
        websocket:"/ws",
        endpoint:"/ws?room=default&mode=tdm"
      });
    }
    if(url.pathname!=="/ws"){
      return json({ok:false,error:"Not found",hint:"Use /ws for WebSocket or / for health"},404);
    }
    if(request.method!=="GET"){
      return new Response("Expected GET",{status:400});
    }
    const upgrade=request.headers.get("Upgrade");
    if(!upgrade || upgrade.toLowerCase()!=="websocket"){
      return json({
        ok:false,
        error:"WebSocket upgrade required",
        hint:"Open / in a browser to test HTTP health."
      },426);
    }

    const room=(url.searchParams.get("room")||"default").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,32)||"default";
    const id=env.GAME_ROOMS.idFromName(room);
    const stub=env.GAME_ROOMS.get(id);
    return stub.fetch(request);
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    this.ctx=ctx;
    this.env=env;
    this.sessions=new Map();
    for(const ws of this.ctx.getWebSockets()){
      const a=ws.deserializeAttachment();
      if(a?.id) this.sessions.set(ws,a);
    }
  }

  async fetch(request){
    const upgrade=request.headers.get("Upgrade");
    if(!upgrade || upgrade.toLowerCase()!=="websocket"){
      return new Response("Expected WebSocket upgrade",{status:426});
    }

    const url=new URL(request.url);
    const room=(url.searchParams.get("room")||"default").slice(0,32);
    const mode=(url.searchParams.get("mode")||"tdm").slice(0,20);

    const pair=new WebSocketPair();
    const [client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server);

    const id=crypto.randomUUID();
    const p={
      id,name:"Guest",room,mode,color:COLORS[Math.floor(Math.random()*COLORS.length)],
      x:0,z:8,ry:0,hp:100,
      body:{head:100,body:150,leftArm:80,rightArm:80,leftLeg:100,rightLeg:100},
      kills:0,deaths:0,ammo:30,reserve:120
    };
    this.sessions.set(server,p);
    server.serializeAttachment({id});
    server.send(JSON.stringify({type:"welcome",id,hp:100,ammo:30,reserve:120,serverVersion:"2.1"}));
    this.broadcastSnapshot();
    return new Response(null,{status:101,webSocket:client});
  }

  webSocketMessage(ws,message){
    const p=this.sessions.get(ws);
    if(!p) return;
    let m;
    try{m=JSON.parse(message)}catch{return}
    if(m.type==="join"){
      p.name=String(m.name||"Guest").slice(0,16);
      p.room=String(m.room||p.room).slice(0,32);
      p.mode=String(m.mode||p.mode).slice(0,20);
      this.broadcast({type:"state",id:p.id,hp:p.hp,ammo:p.ammo,reserve:p.reserve});
      this.broadcastSnapshot();
      return;
    }
    if(m.type==="move"){
      const dx=clamp(m.x,-90,90), dz=clamp(m.z,-90,90);
      p.x=dx;p.z=dz;p.ry=Number(m.ry)||0;
      this.broadcastSnapshot();
      return;
    }
    if(m.type==="reload"){
      const need=30-p.ammo, n=Math.min(need,p.reserve);
      p.ammo+=n;p.reserve-=n;
      this.sendState(p);return;
    }
    if(m.type==="grenade"){
      this.broadcast({type:"grenade",id:p.id,x:p.x,z:p.z});
      return;
    }
    if(m.type==="shoot"){
      if(p.ammo<=0)return;
      p.ammo--;
      this.sendState(p);
      const hit=this.findHit(p,m.origin,m.dir);
      if(hit){
        const target=hit.player;
        const part=hit.part;
        const damage=part==="head"?60:part==="body"?25:15;
        target.hp=Math.max(0,target.hp-damage);
        if(target.body[part]!=null) target.body[part]=Math.max(0,target.body[part]-damage);
        this.sendTo(target,{type:"state",id:target.id,hp:target.hp,ammo:target.ammo,reserve:target.reserve});
        this.sendTo(p,{type:"hit",targetId:target.id,part,damage});
        if(target.hp<=0){
          p.kills++;target.deaths++;
          this.broadcast({type:"kill",killerId:p.id,killerName:p.name,victimId:target.id,victimName:target.name,part});
          target.hp=100;target.body={head:100,body:150,leftArm:80,rightArm:80,leftLeg:100,rightLeg:100};
          target.x=(Math.random()-.5)*20;target.z=8+Math.random()*15;
          setTimeout(()=>this.sendState(target),150);
        }
        this.broadcastSnapshot();
      }
      return;
    }
  }

  findHit(shooter,origin,dir){
    const ox=Number(origin?.x)||shooter.x, oy=Number(origin?.y)||1.7, oz=Number(origin?.z)||shooter.z;
    let dx=Number(dir?.x)||0,dy=Number(dir?.y)||0,dz=Number(dir?.z)||-1;
    const len=Math.hypot(dx,dy,dz)||1;dx/=len;dy/=len;dz/=len;
    let best=null,bestT=Infinity;
    for(const target of this.sessions.values()){
      if(target.id===shooter.id || target.hp<=0) continue;
      const tx=target.x,tz=target.z;
      const parts=[
        ["head",tx,1.85,tz,.38],
        ["body",tx,1.05,tz,.58],
        ["leftArm",tx-.35,1.0,tz,.28],
        ["rightArm",tx+.35,1.0,tz,.28],
        ["leftLeg",tx-.2,.45,tz,.3],
        ["rightLeg",tx+.2,.45,tz,.3]
      ];
      for(const [part,cx,cy,cz,r] of parts){
        const vx=cx-ox,vy=cy-oy,vz=cz-oz;
        const t=vx*dx+vy*dy+vz*dz;
        if(t<0 || t>45 || t>bestT) continue;
        const px=ox+dx*t,py=oy+dy*t,pz=oz+dz*t;
        const d2=(px-cx)**2+(py-cy)**2+(pz-cz)**2;
        if(d2<=r*r){best={player:target,part};bestT=t;break;}
      }
    }
    return best;
  }

  webSocketClose(ws){
    this.sessions.delete(ws);
    this.broadcastSnapshot();
  }
  webSocketError(ws){
    this.sessions.delete(ws);
    this.broadcastSnapshot();
  }

  sendTo(p,msg){
    for(const [ws,info] of this.sessions){
      if(info.id===p.id){
        try{ws.send(JSON.stringify(msg))}catch{}
      }
    }
  }
  sendState(p){this.sendTo(p,{type:"state",id:p.id,hp:p.hp,ammo:p.ammo,reserve:p.reserve});}
  broadcast(msg){
    const raw=JSON.stringify(msg);
    for(const ws of this.sessions.keys()){try{ws.send(raw)}catch{}}
  }
  broadcastSnapshot(){
    const players=[...this.sessions.values()].map(p=>({
      id:p.id,name:p.name,color:p.color,x:p.x,z:p.z,ry:p.ry,hp:p.hp,kills:p.kills,deaths:p.deaths
    }));
    const scores={};for(const p of this.sessions.values())scores[p.name]=p.kills;
    this.broadcast({type:"snapshot",players,scores});
  }
}
