import type {NativeRosterPlayer} from "./game-telemetry";
import {matchResultTitle,type MatchView} from "./game-hud";

export interface ScorePlayer {id:number;name:string;team:number;connected:boolean;kills:number;deaths:number;damage:number;}
export interface CombatBoard {version:2;matchId:string;map:string;phase:string;players:ScorePlayer[];}
export function isCombatBoard(v:any):v is CombatBoard {
 return !!v&&v.version===2&&typeof v.matchId==="string"&&typeof v.map==="string"&&typeof v.phase==="string"&&Array.isArray(v.players)&&v.players.length<=128&&v.players.every((p:any)=>
 typeof p.name==="string"&&typeof p.connected==="boolean"&&[p.id,p.team,p.kills,p.deaths,p.damage].every(n=>Number.isSafeInteger(n)&&n>=0));
}
const el=(id:string)=>document.getElementById(id)!;
const node=(tag:string,text:string,cls?:string)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
type DisplayScore=Omit<ScorePlayer,"damage">&{damage?:number};
export function scoreTable(players:DisplayScore[],ownName:string,roster:NativeRosterPlayer[],{result=false,individual=false}={}):HTMLElement {
 const root=node("div","","combat-teams");
 for(const team of individual?[0]:[2,1,3]){
  const list=individual?players:players.filter(p=>team===3?![1,2].includes(p.team):p.team===team).sort((a,b)=>b.kills-a.kills||(b.damage??0)-(a.damage??0)||a.id-b.id);
  if(!list.length)continue;
  const section=node("section","",`combat-team team-${team}`);
  if(!individual)section.append(node("h3",`${team===2?"反恐精英 CT":team===1?"恐怖分子 T":"旁观 / 已离开"} · ${list.length} 人`));
  const table=document.createElement("table"),header=document.createElement("tr");
  if(individual)header.append(node("th","排名"));
  for(const title of ["玩家","击杀","死亡","已造成伤害","延迟 ms"])header.append(node("th",title));
  const head=document.createElement("thead");head.append(header);table.append(head);
  const body=document.createElement("tbody");
  let rank=1;
  for(const [i,player] of list.entries()){
   const own=player.name===ownName&&(!individual||player.connected);
   const row=document.createElement("tr");if(own)row.className="own-player";
   if(individual){
    if(i>0&&player.kills!==list[i-1].kills)rank=i+1;
    row.append(node("td",String(rank)));
   }
   const native=player.connected||!individual?roster.find(p=>p.name===player.name):undefined;
   const ping=native&&native.ping>=0?String(Math.round(native.ping)):"—";
   const left=!player.connected&&(result||individual)?(individual?" · 已离场":" · 已离开"):"";
   for(const value of [`${player.name}${own?"（你）":""}${left}`,player.kills,player.deaths,player.damage??"—",ping])row.append(node("td",String(value)));
   body.append(row);
  }
  table.append(body);section.append(table);root.append(section);
 }
 if(!players.length)root.append(node("p","正在等待服务端战绩…","panel-note"));
 return root;
}

/** Authoritative cumulative damage feeds the native Tab board and final settlement. */
export class CombatBoardClient {
 private board?:CombatBoard;
 private state?:MatchView;
 private timer?:ReturnType<typeof setInterval>;
 private busy=false;
 private signature="";
 constructor(private readonly url:()=>string|undefined,private readonly native:()=>NativeRosterPlayer[],private readonly name:()=>string,
  private readonly host:()=>boolean,private readonly restart:()=>Promise<void>,private readonly leave:()=>Promise<void>,private readonly settled:(finished:boolean)=>void){
  el("result-continue").onclick=()=>void this.action(restart);
  el("result-leave").onclick=()=>void this.action(leave);
 }
 private async action(fn:()=>Promise<void>):Promise<void>{
  if(this.busy)return;this.busy=true;this.render();el("result-error").textContent="";
  try{await fn();}catch(error){el("result-error").textContent=error instanceof Error?error.message:String(error);}
  finally{this.busy=false;this.render();}
 }
 match(state:MatchView):void{this.state=state;this.settled(state.phase==="finished");this.render();}
 damage(name:string):number|undefined {
  if(!this.board||!this.state||this.board.matchId!==this.state.id)return;
  return this.board.players.find(p=>p.name===name)?.damage;
 }
 start():void{if(!this.timer){this.timer=setInterval(()=>void this.read(),1000);void this.read();}}
 stop():void{clearInterval(this.timer);this.timer=undefined;}
 private async read():Promise<void>{
  const url=this.url();if(!url)return;
  try{const response=await fetch(url,{cache:"no-store"});if(response.ok){const value=await response.json();if(isCombatBoard(value))this.board=value;}}
  catch{/* Game input never waits for statistics. */}
  this.render();
 }
 private render():void{
  const native=this.native(),state=this.state,ready=this.board&&(!state?.id||this.board.matchId===state.id);
  const metrics=ready?this.board!.players:[];
  const individual=state?.mode==="freeforall";
  const players=individual?(state?.players??[]).map(player=>({...player,team:0,connected:player.playing,damage:metrics.find(p=>p.id===player.id)?.damage})):metrics;
  const own=this.name();
  const key=JSON.stringify({players,native,own,id:state?.id,individual,phase:state?.phase});
  if(key!==this.signature){this.signature=key;
   if(individual)el("individual-scoreboard-content").replaceChildren(scoreTable(players,own,native,{individual}));
   el("result-scores").replaceChildren(scoreTable(players,own,native,{result:true,individual}));
  }
  if(state?.phase!=="finished")return;
  el("result-title").textContent=matchResultTitle(state);
  el("result-team-score").hidden=individual;
  el("result-score").textContent=`${state.scoreA} : ${state.scoreB}`;
  el("result-map").textContent=`${this.board?.map??""} · 本场已结束`;
  el("result-status").textContent=this.host()?"可继续新的一场；房主退出将解散房间，所有人返回大厅。":"等待房主继续新的一场；房主退出将解散房间，你也可以自行退出。";
  el("result-leave").textContent=this.host()?"退出并解散房间":"退出房间";
  const button=el("result-continue") as HTMLButtonElement;
  button.disabled=this.busy||!this.host();button.hidden=!this.host();
  (el("result-leave") as HTMLButtonElement).disabled=this.busy;
 }
}
