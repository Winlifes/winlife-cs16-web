import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {runInNewContext} from "node:vm";
import type {CrosshairFrame} from "../crosshair";

const binary=readFileSync(new URL("../../public/wasm/client_emscripten_wasm32.wasm",import.meta.url));
if(createHash("sha256").update(binary).digest("hex")!=="3a8b26a14ce562ab3bcfbf2a8f57c2822ae04c2a134caedbb03355003ea5ecf7")throw new Error("Unverified CS WASM");
const module=new WebAssembly.Module(binary);
const types:Record<string,number>={i:127,f:125,v:0};
function typed(fn:Function,signature:string):Function {
    const params=[...signature.slice(1)].map(s=>types[s]),result=signature[0]==="v"?[]:[types[signature[0]]];
    const type=[1,96,params.length,...params,result.length,...result];
    const bytes=new Uint8Array([0,97,115,109,1,0,0,0,1,type.length,...type,2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0]);
    return new WebAssembly.Instance(new WebAssembly.Module(bytes),{e:{f:fn}}).exports.f as Function;
}

/** Execute the shipped CS client, with only engine drawing/libc supplied by this harness. */
export function crosshairWasm(install=true){
    const memory=new WebAssembly.Memory({initial:256}),table=new WebAssembly.Table({initial:65536,element:"anyfunc"});
    const HEAPU8=new Uint8Array(memory.buffer),HEAPU32=new Uint32Array(memory.buffer),HEAP32=new Int32Array(memory.buffer),HEAP16=new Int16Array(memory.buffer),HEAPF32=new Float32Array(memory.buffer),HEAPF64=new Float64Array(memory.buffer);
    const string=(p:number,n=1024)=>{let end=p;while(HEAPU8[end]&&end<p+n)end++;return new TextDecoder().decode(HEAPU8.subarray(p,end));};
    const imports:Record<string,Record<string,any>>={};
    for(const d of WebAssembly.Module.imports(module)){
        const group=imports[d.module]??={};
        if(d.kind==="memory")group[d.name]=memory;
        else if(d.kind==="table")group[d.name]=table;
        else if(d.kind==="global")group[d.name]=new WebAssembly.Global({value:"i32",mutable:d.module.startsWith("GOT.")||d.name==="__stack_pointer"},d.name==="__memory_base"?65536:d.name==="__stack_pointer"?15000000:0);
        else group[d.name]=(...a:number[])=>{
            switch(d.name){
                case "strcmp":return string(a[0]).localeCompare(string(a[1]));
                case "strcasecmp":return string(a[0]).toLowerCase().localeCompare(string(a[1]).toLowerCase());
                case "strncmp":return string(a[0],a[2]).localeCompare(string(a[1],a[2]));
                case "strtol":return parseInt(string(a[0]),a[2])||0;
                case "strncpy":{const data=HEAPU8.slice(a[1],a[1]+a[2]);HEAPU8.set(data,a[0]);return a[0];}
                case "sscanf":{const values=string(a[0]).split(/\s+/).map(Number);values.forEach((n,i)=>HEAP32[HEAPU32[(a[2]>>>2)+i]>>>2]=n);return values.length;}
                default:throw new Error(`Unexpected native import: ${d.name}`);
            }
        };
    }
    const instance=new WebAssembly.Instance(module,imports),exports=instance.exports as Record<string,any>;
    for(const [name,value]of Object.entries(imports["GOT.mem"]))if(exports[name] instanceof WebAssembly.Global)value.value=65536+exports[name].value;
    const engine=3000000,hud=4000000,ammo=6000000,weapon=6100000;
    imports["GOT.mem"].gEngfuncs.value=engine;imports["GOT.mem"].gHUD.value=hud;
    let heap=8000000,index=60000;
    const malloc=(n:number)=>{const p=heap;heap+=Math.ceil(n/8)*8;return p;};
    const text=(s:string)=>{const p=malloc(new TextEncoder().encode(s).length+1);HEAPU8.set(new TextEncoder().encode(s+"\0"),p);return p;};
    const add=(fn:Function,sig:string)=>{const i=index++;table.set(i,typed(fn,sig));return i;};
    const globals:Record<string,any>={};
    for(const [name,value]of Object.entries(imports["GOT.mem"]))globals[name]=value;
    const nativeRects:number[][]=[];let frame:CrosshairFrame|undefined;
    const fill=add((...a:number[])=>nativeRects.push(a),"viiiiiiii");
    const blend=add((...a:number[])=>nativeRects.push(a),"viiiiiiii");
    const api=(slot:number,ptr:number)=>HEAPU32[(engine+slot*4)>>>2]=ptr;
    api(11,fill);api(130,blend);
    api(12,add((p:number)=>{HEAP32[(p+4)>>>2]=HEAP32[(hud+8940)>>>2];HEAP32[(p+8)>>>2]=HEAP32[(hud+8944)>>>2];return 1;},"ii"));
    const status=malloc(8);api(86,status);HEAPU32[(status+4)>>>2]=add(()=>{},"vi");
    const draw=add(exports._ZN8CHudAmmo4DrawEf,"iif");
    globals._ZN8CHudAmmo4DrawEf={value:draw};
    const redraw=add((time:number)=>table.get(draw)(ammo,time),"ifi");globals.HUD_Redraw={value:redraw};
    function cvar(offset:number,value:number,s:string){const p=malloc(24);HEAPU32[(p+4)>>>2]=text(s);HEAPF32[(p+12)>>>2]=value;HEAPU32[(ammo+offset)>>>2]=p;return p;}
    cvar(76,0,"50 250 50");cvar(80,1,"1");const size=cvar(84,0,"auto");cvar(88,1,"1");cvar(124,0,"0");
    HEAPU32[(ammo+16)>>>2]=weapon;HEAP32[(weapon+156)>>>2]=28; // AK-47
    HEAP32[(ammo+28)>>>2]=255;
    HEAP32[(hud+10000)>>>2]=-2147483648;HEAP32[(hud+52)>>>2]=90;HEAP32[(hud+48)>>>2]=1;
    HEAP32[globals.g_iPlayerFlags.value>>>2]=512;
    const dimensions=(width:number,height:number)=>{HEAP32[(hud+8940)>>>2]=width;HEAP32[(hud+8944)>>>2]=height;};
    dimensions(1280,720);
    if(install){
        const get=runInNewContext(readFileSync(new URL("../../engine/native-telemetry.js",import.meta.url),"utf8"),{
            GOT:globals,HEAPU8,HEAPU32,HEAP32,HEAP16,HEAPF32,HEAPF64,Module:{winlifeOnCrosshair:(value:CrosshairFrame|undefined)=>frame=value},
            _malloc:malloc,UTF8ToString:string,getWasmTableEntry:(i:number)=>table.get(i),setWasmTableEntry:(i:number,f:Function)=>table.set(i,f),addFunction:add,
        });
        get();
    }
    return {HEAPU32,HEAP32,HEAPF32,globals,ammo,hud,weapon,size,text,string,nativeRects,dimensions,
        draw:(time=1,intermission=0):CrosshairFrame|undefined=>{frame=undefined;table.get(redraw)(time,intermission);return frame;},
        fillOtherHUD:()=>table.get(fill)(10,20,50,2,255,255,255,255),
    };
}
