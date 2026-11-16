// Bounded integration check. Creates and cleans up only its own test rooms.
// A2S packets traverse a real WebSocket and native UDP engine; they are not full players.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base=(process.argv[2]||'http://127.0.0.1:27316').replace(/\/$/,'');
const output=process.argv[3];
const sessions=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={base,at:new Date().toISOString(),checks:[]};
async function req(path,body,token,status=200){
  const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{'X-CS16-Session':token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;
}
async function wait(fn,description){const until=Date.now()+35000;while(Date.now()<until){if(await fn())return;await sleep(1000);}throw Error('Timed out: '+description);}
async function datagramInfo(session){
  const url=new URL(base+'/rooms/'+session.room.id+'/datagram');url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('session',session.token);
  const ws=new WebSocket(url);ws.binaryType='arraybuffer';const request=Buffer.concat([Buffer.from([255,255,255,255,84]),Buffer.from('Source Engine Query\0')]);
  try{return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{clearInterval(retry);reject(Error('Native A2S datagram timeout'));},15000);
    const retry=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(request);},1500);
    const finish=(error,value)=>{clearTimeout(timer);clearInterval(retry);error?reject(error):resolve(value);};
    ws.onopen=()=>ws.send(request);ws.onerror=()=>finish(Error('WebSocket failed'));
    ws.onmessage=event=>{const b=Buffer.from(event.data);if(b[4]===65){ws.send(Buffer.concat([request,b.subarray(5,9)]));return;}if(b[4]!==73)return;let offset=6;const str=()=>{const end=b.indexOf(0,offset);const s=b.toString('utf8',offset,end);offset=end+1;return s;};const name=str(),map=str();str();str();offset+=2;finish(null,{name,map,players:b[offset],maxPlayers:b[offset+1]});};
  });}finally{ws.close();}
}
try{
  const a=await req('/rooms',{nickname:'Room-Smoke-A',name:'验收房间 A',map:'de_dust2',maxPlayers:2});sessions.push(a);
  const b=await req('/rooms',{nickname:'Room-Smoke-B',name:'验收房间 B',map:'de_inferno',maxPlayers:6});sessions.push(b);
  const guest=await req('/rooms/'+a.room.id+'/join',{nickname:'Room-Smoke-Guest'});sessions.push(guest);
  await req('/rooms/'+a.room.id+'/join',{nickname:'Room-Smoke-Full'},undefined,409);
  await req('/rooms/'+a.room.id+'/start',{},guest.token,403);
  report.checks.push('waiting-room join; atomic room seat reservation; host-only start');
  await Promise.all([a,b].map(x=>req('/rooms/'+x.room.id+'/start',{},x.token)));
  await wait(async()=>{for(const x of [a,b]){const r=await req('/rooms/'+x.room.id,undefined,x.token);assert.notEqual(r.phase,'failed',r.error);if(r.phase!=='playing')return false;}return true;},'two room workers');
  const late=await req('/rooms/'+b.room.id+'/join',{nickname:'Room-Smoke-Late'});sessions.push(late);assert.equal(late.room.phase,'playing');
  report.checks.push('join in-progress room without restarting native match');
  const infos=[];for(const x of [a,b]){await sleep(3500);const info=await datagramInfo(x);assert.equal(info.map,x.room.map);assert.equal(info.maxPlayers,Math.max(4,x.room.maxPlayers));infos.push({...info,roomLimit:x.room.maxPlayers});}
  report.native=infos;report.checks.push('two real native engines, different maps/capacities; WebSocket to UDP routing');
  const matchA=await req('/rooms/'+a.room.id+'/match'),matchB=await req('/rooms/'+b.room.id+'/match');assert.equal(matchA.scoreA,0);assert.equal(matchB.scoreB,0);
  if(process.env.CS16_TEST_ADMIN_TOKEN_FILE&&process.env.CS16_TEST_ADMIN_URL){
    const token=(await readFile(process.env.CS16_TEST_ADMIN_TOKEN_FILE,'utf8')).trim();
    const res=await fetch(process.env.CS16_TEST_ADMIN_URL+'/?room='+a.room.id,{method:'POST',headers:{'Content-Type':'application/json','X-CS16-Admin':token},body:JSON.stringify({command:'changelevel cs_italy'})});assert.equal(res.status,200);
    await wait(async()=>{const ha=await req('/rooms/'+a.room.id+'/healthz'),hb=await req('/rooms/'+b.room.id+'/healthz');return ha.engine.ready&&hb.engine.ready&&ha.engine.map==='cs_italy'&&hb.engine.map==='de_inferno';},'isolated map change');
    await wait(async()=>((await req('/rooms/'+a.room.id)).map==='cs_italy'),'lobby live map');
    report.checks.push('room A changes map; room B remains on original map; lobby map refreshed');
  }
  const list=await req('/rooms');assert(!JSON.stringify(list).includes(a.token));assert(!JSON.stringify(list).includes(b.token));
  await req('/rooms/'+a.room.id+'/leave',{},guest.token);await req('/rooms/'+a.room.id+'/leave',{},a.token);await req('/rooms/'+a.room.id,undefined,undefined,404);
  await wait(async()=>Boolean((await req('/rooms/'+b.room.id+'/healthz')).engine.ready),'room B survived room A removal');
  report.checks.push('empty room removed; unrelated room remains playable; no session tokens in public lists');
  report.ok=true;console.log(JSON.stringify(report,null,2));if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
}finally{
  for(const session of sessions){try{await fetch(base+'/rooms/'+session.room.id+'/leave',{method:'POST',headers:{'Content-Type':'application/json','X-CS16-Session':session.token},body:'{}'});}catch{}}
}
