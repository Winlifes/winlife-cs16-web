import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {expect,it,vi} from "vitest";

function setup(life?:{dead:boolean}){
    const memory=new ArrayBuffer(65536),HEAPU32=new Uint32Array(memory),HEAP32=new Int32Array(memory),HEAP16=new Int16Array(memory),HEAPF32=new Float32Array(memory),HEAPF64=new Float64Array(memory),HEAPU8=new Uint8Array(memory);
    const GOT={HUD_Redraw:{value:10},gEngfuncs:{value:32},HUD_GetPlayerTeam:{value:20},gpActiveSel:{value:1000},g_weaponselect:{value:1004},g_weaponselect_frames:{value:1008}};
    const wallet={money:800};const labels=vi.fn(),serverCommand=vi.fn(),project=vi.fn(()=>{HEAPF32[60024/4]=.2;HEAPF32[60028/4]=.3;return 0;});
    const table=new Map<number,Function>([[10,()=>1],[11,()=>{}],[20,(i:number)=>i===3?2:1],[21,serverCommand],[22,(i:number,p:number)=>{HEAPU32[p/4]=2000;}],[23,()=>8192],[24,(i:number)=>i===2?12288:i===3?16384:0],[25,()=>4000],[26,()=>3],[27,project],[28,()=>2],[29,()=>wallet.money],[30,()=>2500]]);
    if(life){Object.assign(GOT,{_Z9CL_IsDeadv:{value:31},g_iUser1:{value:2800}});table.set(31,()=>life.dead?1:0);}
    const engine=(slot:number,index:number)=>HEAPU32[(32+slot*4)/4]=index;
    engine(19,21);engine(21,22);engine(51,23);engine(53,24);engine(59,25);engine(36,26);
    engine(15,29);engine(74,30);HEAPU8.set(new TextEncoder().encode('maps/de_dust2.bsp\0'),2500);
    engine(86,500);HEAPU32[(500+4)/4]=11;
    engine(82,600);HEAPU32[(600+12*4)/4]=27;
    engine(84,700);HEAPU32[(700+8*4)/4]=28;
    HEAPU8.set(new TextEncoder().encode('Teammate\0'),2000);
    for(const [i,entity] of [[1,8192],[2,12288],[3,16384]]){
        HEAP32[entity/4]=i;HEAP16[(entity+688+58)/2]=3;HEAP32[(entity+688+12)/4]=7;HEAPU32[(entity+2964)/4]=1;
    }
    HEAPF32[(4000+16)/4]=1;
    let allocation=0;
    const get=runInNewContext(readFileSync(new URL("../engine/native-telemetry.js",import.meta.url),"utf8"),{
        GOT,HEAPU32,HEAP32,HEAP16,HEAPF32,HEAPF64,HEAPU8,Module:{winlifeOnHUD:labels},
        _malloc:()=>[58000,60000,61000][allocation++],UTF8ToString:(ptr:number)=>new TextDecoder().decode(HEAPU8.slice(ptr,HEAPU8.indexOf(0,ptr))),
        getWasmTableEntry:(index:number)=>table.get(index),setWasmTableEntry:(index:number,value:Function)=>table.set(index,value),
        addFunction:(callback:Function)=>{table.set(100,callback);return 100;},
    });
    return {native:get(),table,labels,serverCommand,project,wallet,GOT,HEAPU32,HEAP32,HEAP16,HEAPF32,HEAPU8};
}

it("reads live native money, team and map without changing game state",()=>{
    const s=setup();expect(s.native.buyState()).toEqual({team:1,money:800,map:"de_dust2",alive:true});
    expect(new TextDecoder().decode(s.HEAPU8.slice(61000,s.HEAPU8.indexOf(0,61000)))).toBe("cscl_currentmoney");
    s.wallet.money=150;expect(s.native.buyState().money).toBe(150);
    s.wallet.money=-1;expect(s.native.buyState().money).toBeUndefined();
    s.HEAP16[(8192+688+58)/2]=0;expect(s.native.buyState().alive).toBe(false);
});

it("reads the actual native player name and life state for death-report identity",()=>{
    const s=setup();
    expect(s.native.identity()).toEqual({name:"Teammate",team:1,map:"de_dust2",alive:true});
    s.HEAPU8.set(new TextEncoder().encode('(1)中文玩家\0'),2000);
    s.HEAP32[(8192+688+260)/4]=4;
    expect(s.native.identity()).toEqual({name:"(1)中文玩家",team:1,map:"de_dust2",alive:false});
    s.HEAP32[(8192+688+260)/4]=0;s.HEAP16[(8192+688+58)/2]=0;
    expect(s.native.identity().alive).toBe(false);
    expect(s.serverCommand).not.toHaveBeenCalled();
});
it("uses native health and observer state instead of a stale local collision entity",()=>{
    const life={dead:false},s=setup(life);expect(s.native.identity().alive).toBe(true);
    life.dead=true;expect(s.native.identity().alive).toBe(false);expect(s.native.buyState().alive).toBe(false);
    life.dead=false;s.HEAP32[2800/4]=4;expect(s.native.identity().alive).toBe(false);
    s.HEAP32[2800/4]=0;expect(s.native.identity().alive).toBe(true);
});

it("confirms the native wheel selection without synthesizing a firing click",()=>{
    const s=setup();s.HEAPU8.set(new TextEncoder().encode('weapon_knife\0'),3000);
    s.HEAP32[(3000+156)/4]=29;s.HEAPU32[1000/4]=3000;
    expect(s.native.confirmWeapon()).toBe(true);
    expect(s.serverCommand).toHaveBeenCalledExactlyOnceWith(3000);
    expect(s.HEAP32[1004/4]).toBe(29);expect(s.HEAP32[1008/4]).toBe(3);expect(s.HEAPU32[1000/4]).toBe(0);
    expect(s.native.confirmWeapon()).toBe(false);expect(s.serverCommand).toHaveBeenCalledTimes(1);
});

it("projects only current visible teammates and removes wall-obscured, dead or stale labels",()=>{
    const s=setup();s.table.get(10)!(1,0);
    expect(s.labels).toHaveBeenLastCalledWith([{id:2,name:'Teammate',x:expect.closeTo(60),y:expect.closeTo(35)}]);
    // The trace hits the world rather than the teammate.
    s.table.set(28,()=>0); // traceEntity is bound at setup, so use allsolid too.
    s.HEAP32[4000/4]=1;s.table.get(10)!(2,0);expect(s.labels).toHaveBeenLastCalledWith([]);
    s.HEAP32[4000/4]=0;s.HEAP32[(12288+688+12)/4]=6;s.table.get(10)!(3,0);expect(s.labels).toHaveBeenLastCalledWith([]);
    s.HEAP32[(12288+688+12)/4]=7;s.HEAP16[(12288+688+58)/2]=0;s.table.get(10)!(4,0);expect(s.labels).toHaveBeenLastCalledWith([]);
    s.HEAP16[(12288+688+58)/2]=3;s.table.get(10)!(.1,0);expect(s.labels.mock.lastCall![0]).toHaveLength(1);
    s.table.get(10)!(.2,1);expect(s.labels).toHaveBeenLastCalledWith([]);
});
