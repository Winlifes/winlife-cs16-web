import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {afterEach,expect,it,vi} from "vitest";
import {GameTelemetry} from "./game-telemetry";

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it("observes completed native HUD draws without changing results or arguments",()=>{
    const memory=new ArrayBuffer(4096),HEAPU32=new Uint32Array(memory),HEAP32=new Int32Array(memory),HEAPF64=new Float64Array(memory);
    const redraw=vi.fn(()=>73),status=vi.fn((ptr:number)=>{
        HEAP32[ptr/4]=1;HEAP32[(ptr+44)/4]=2;HEAPF64[(ptr+48)/8]=0;
    });
    const table=new Map<number,Function>([[10,redraw],[11,status]]);
    const GOT:{HUD_Redraw?:{value:number};gEngfuncs?:{value:number}}={};
    const get=runInNewContext(readFileSync(new URL("../engine/native-telemetry.js",import.meta.url),"utf8"),{
        GOT,HEAPU32,HEAP32,HEAPF64,Module:{},_malloc:()=>1024,
        getWasmTableEntry:(index:number)=>table.get(index),setWasmTableEntry:(index:number,value:Function)=>table.set(index,value),
        addFunction:(callback:Function,sig:string)=>{expect(sig).toBe("ifi");table.set(12,callback);return 12;},
    });
    expect(get()).toBeUndefined();
    GOT.HUD_Redraw={value:10};GOT.gEngfuncs={value:32};
    HEAPU32[(32+86*4)/4]=500;HEAPU32[(500+4)/4]=11;
    const telemetry=get();expect(get()).toBe(telemetry);
    expect(table.get(10)!(2.5,1)).toBe(73);
    expect(redraw).toHaveBeenCalledExactlyOnceWith(2.5,1);expect(telemetry.frames).toBe(1);
    expect(telemetry.network()).toEqual({connected:true,latencyMs:0,loss:2});
    redraw.mockImplementationOnce(()=>{throw new Error("native failure");});
    expect(()=>table.get(10)!(3,0)).toThrow("native failure");expect(telemetry.frames).toBe(1);
});

it("counts game draws, preserves zero ping and clears disconnected or hidden samples",()=>{
    vi.useFakeTimers();let now=0;
    const elements=Object.fromEntries(["own-fps","own-ping","performance-hud"].map(id=>[id,{textContent:"—",hidden:true,title:""}]));
    const doc=Object.assign(new EventTarget(),{hidden:false,getElementById:(id:string)=>elements[id]});
    vi.stubGlobal("document",doc);vi.stubGlobal("performance",{now:()=>now});
    const native={frames:0,network:()=>({connected:true,latencyMs:0,loss:0})};
    const hud=new GameTelemetry(()=>({getNativeTelemetry:()=>native}));hud.connected(true);hud.start();
    now=500;vi.advanceTimersByTime(500);
    native.frames=30;now=1000;vi.advanceTimersByTime(500);
    expect(elements["own-fps"].textContent).toBe("60");expect(elements["own-ping"].textContent).toBe("0");
    // Timers/browser callbacks alone must not count as rendered game frames.
    now=1500;vi.advanceTimersByTime(500);expect(elements["own-fps"].textContent).toBe("0");
    hud.connected(false);expect(elements["own-ping"].textContent).toBe("—");
    native.network=()=>({connected:true,latencyMs:23.4,loss:0});hud.connected(true);
    native.frames+=30;now=2000;vi.advanceTimersByTime(500);expect(elements["own-ping"].textContent).toBe("23");
    doc.hidden=true;doc.dispatchEvent(new Event("visibilitychange"));now=2500;vi.advanceTimersByTime(500);
    expect(elements["own-fps"].textContent).toBe("—");expect(elements["own-ping"].textContent).toBe("—");hud.stop();
});
