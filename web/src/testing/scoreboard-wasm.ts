import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {crosshairWasm} from "./crosshair-wasm";

export function scoreboardWasm(install=true){
 let s:ReturnType<typeof crosshairWasm>;
 s=crosshairWasm(false,(name,a)=>{
  const {HEAP32,wasm:{HEAPU8,exports}}=s;
  if(typeof exports[name]==="function")return exports[name](...a);
  switch(name){
   case "strlen":return s.string(a[0]).length;
   case "strdup":return s.text(s.string(a[0]));
   case "memset":HEAPU8.fill(a[1],a[0],a[0]+a[2]);return a[0];
   case "memcpy":case "memmove":HEAPU8.set(HEAPU8.slice(a[1],a[1]+a[2]),a[0]);return a[0];
   case "free":return;
   case "siprintf":{let next=0;const value=s.string(a[1]).replace(/%[ds]/g,token=>{const v=HEAP32[(a[2]>>>2)+next++];return token==="%s"?s.string(v):String(v);});HEAPU8.set(new TextEncoder().encode(value+"\0"),a[0]);return value.length;}
   default:throw Error("Unexpected scoreboard import: "+name);
  }
 });
 const {wasm:{exports,imports,table,HEAPU8,HEAP16,HEAPF64,malloc,add,api},HEAPU32,HEAP32,HEAPF32,hud}=s;
 for(const [name,value]of Object.entries(exports))if(value instanceof WebAssembly.Global&&!s.globals[name])s.globals[name]={value:65536+Number(value.value)};
 const self=6200000;
 HEAP32[(hud+344)>>>2]=100;HEAP32[(hud+10008)>>>2]=0;HEAP32[(hud+56)>>>2]=0;
 for(let i=1;i<256;i++)HEAP16[(hud+8956+i*2)>>>1]=6;
 HEAP32[(hud+8952)>>>2]=12;
 const zero=malloc(24);HEAPF32[(zero+12)>>>2]=0;
 HEAPU32[(self+36)>>>2]=zero;HEAPU32[(self+40)>>>2]=zero;HEAPU32[(self+44)>>>2]=zero;
 const one=malloc(24);HEAPF32[(one+12)>>>2]=1;HEAPU32[(hud+10088)>>>2]=one;HEAPU32[(hud+10092)>>>2]=one;
 const characters:number[][]=[];
 api(26,add((...args:number[])=>{if(!args[2])return 0;characters.push(args);return 6;},"iiiiiii"));
 const roster=[{id:1,name:"Bravo",ping:37,kills:3,deaths:1,hp:72,money:2450},{id:2,name:"Alpha",ping:81,kills:8,deaths:2,hp:99,money:5200}];
 api(21,add((id:number,p:number)=>{
  HEAPU8.fill(0,p,p+32);const row=roster.find(r=>r.id===id);if(!row)return;
  HEAPU32[p>>>2]=s.text(row.name);HEAP16[(p+4)>>>1]=row.ping;HEAPU8[p+6]=id===1?1:0;
 },"vii"));
 api(92,add(()=>s.text("0"),"iii"));
 for(const row of roster){const base=s.globals.g_PlayerExtraInfo.value+row.id*120;HEAP16[base>>>1]=row.kills;HEAP16[(base+2)>>>1]=row.deaths;HEAP32[(base+108)>>>2]=row.hp;HEAP32[(base+112)>>>2]=row.money;}
 const draw=add(exports._ZN14CHudScoreboard4DrawEf,"iif");s.globals._ZN14CHudScoreboard4DrawEf={value:draw};
 for(const [name,sig]of [["_ZN9DrawUtils20DrawHudStringReverseEiiiPKciiifb","iiiiiiiifi"],["_ZN9DrawUtils12HudStringLenEPKcf","iif"]])s.globals[name]={value:add(exports[name],sig)};
 const damage:Record<string,number|undefined>={Bravo:54,Alpha:237};
 if(install){
  const get=runInNewContext(readFileSync(new URL("../../engine/native-telemetry.js",import.meta.url),"utf8"),{
   GOT:s.globals,HEAPU8,HEAPU32,HEAP32,HEAP16,HEAPF32,HEAPF64,Module:{winlifeScoreboardDamage:(name:string)=>damage[name]},
   _malloc:malloc,UTF8ToString:s.string,getWasmTableEntry:(i:number)=>table.get(i),setWasmTableEntry:(i:number,f:Function)=>table.set(i,f),addFunction:add,
  });get();
 }
 return {damage,dimensions:s.dimensions,draw(visible=true){characters.length=0;s.nativeRects.length=0;HEAPU8[self+17]=visible?1:0;table.get(draw)(self,1);return {characters:[...characters],rects:[...s.nativeRects]};}};
}
export function glyphRows(chars:number[][]):Record<number,string>{const rows:Record<number,string>={};for(const [x,y,ch]of [...chars].sort((a,b)=>a[1]-b[1]||a[0]-b[0]))rows[y]=(rows[y]??"")+String.fromCharCode(ch);return rows;}
