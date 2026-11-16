import {ReleaseNotices,isReleaseManifest,type ReleaseManifest,type ReleaseInfo} from "./releases";

const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const text=(tag:string,value:string)=>{const n=document.createElement(tag);n.textContent=value;return n;};
declare const __WINLIFE_RELEASE__:ReleaseManifest;

export class ReleaseCenter {
 private readonly state:ReleaseNotices;
 private readonly dialog=el<HTMLDialogElement>("release-dialog");
 private readonly key=`winlife.cs16.release.seen:${location.pathname}`;
 private busy=false;
 private timer?:ReturnType<typeof setInterval>;
 private abort?:AbortController;
 constructor(private readonly url:string,private readonly safe:()=>boolean){
  let seen:string|null=null;try{seen=localStorage.getItem(this.key);}catch{}
  this.state=new ReleaseNotices(__WINLIFE_RELEASE__,seen);
  document.querySelectorAll("[data-client-version]").forEach(n=>n.textContent=`Web v${this.state.loaded.current.version}`);
  document.querySelectorAll<HTMLButtonElement>("[data-open-release]").forEach(b=>b.onclick=()=>this.open());
  el("release-close").onclick=()=>this.dialog.close();
  el("release-check").onclick=()=>void this.check(true);
  el<HTMLButtonElement>("release-reload").onclick=()=>{if(this.safe()&&this.state.pending)location.reload();};
  this.dialog.addEventListener("close",()=>this.render());
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)void this.check();});
  window.addEventListener("focus",()=>void this.check());
 }
 start():void{if(this.timer)return;this.timer=setInterval(()=>void this.check(),60000);void this.check();}
 stop():void{clearInterval(this.timer);this.timer=undefined;this.abort?.abort();}
 contextChanged():void{this.render();this.offer();}
 private acknowledge(info:ReleaseInfo):void{this.state.acknowledge(info);try{localStorage.setItem(this.key,info.buildId);}catch{}}
 private offer():void{
  if(document.querySelector("dialog[open]"))return;
  if(this.state.automatic(this.safe()))this.open();
 }
 private open():void{
  const manifest=this.state.latest;
  this.acknowledge(this.state.pending?manifest.current:this.state.loaded.current);
  const content=el("release-content");content.replaceChildren();
  for(const entry of manifest.versions){
   const section=text("section","");section.className="release-entry";
   const heading=text("h3",`v${entry.version} · ${entry.title}`);section.append(heading,text("time",entry.date));
   const list=document.createElement("ul");for(const line of entry.changes)list.append(text("li",line));section.append(list);content.append(section);
  }
  this.render();if(!this.dialog.open)this.dialog.showModal();
  this.dialog.scrollTop=0;el("release-title").tabIndex=-1;el("release-title").focus({preventScroll:true});
 }
 private render():void{
  const pending=this.state.pending,safe=this.safe(),latest=this.state.latest.current;
  const label=latest.version===this.state.loaded.current.version?"页面有更新":`发现新版本 v${latest.version}`;
  el("release-title").textContent=pending?"发现更新":"更新日志";
  document.querySelectorAll<HTMLElement>("[data-update-notice]").forEach(n=>{n.hidden=!pending;n.textContent=`${label} · ${safe?"打开更新日志可刷新更新":"本场结束后可刷新更新"}`;});
  document.querySelectorAll<HTMLElement>("[data-open-release]").forEach(n=>n.classList.toggle("has-update",pending));
  el("release-summary").textContent=pending?`当前 Web v${this.state.loaded.current.version}，${label}。${safe?"刷新后加载更新，昵称和资源缓存会保留。":"对局进行中，可先查看日志，结束后再刷新更新。"}`:`当前 Web v${this.state.loaded.current.version} · 已是最新版本`;
  const reload=el<HTMLButtonElement>("release-reload");reload.hidden=!pending;reload.disabled=!safe;
  el("release-close").textContent=pending?"稍后更新":"我知道了";
 }
 private async check(manual=false):Promise<void>{
  if(this.busy)return;this.busy=true;const abort=new AbortController();this.abort=abort;const timeout=setTimeout(()=>abort.abort(),5000);
  try{
   const response=await fetch(`${this.url}?check=${Date.now()}`,{cache:"no-store",signal:abort.signal});
   const value=response.ok?await response.json():undefined;
   if(!isReleaseManifest(value))throw Error("Invalid release manifest");
   this.state.receive(value);this.render();
   if(manual){this.open();}else this.offer();
  }catch{if(manual)el("release-summary").textContent="暂时无法检查更新，仍可查看已有更新日志。";else this.offer();}
  finally{clearTimeout(timeout);this.busy=false;}
 }
}
