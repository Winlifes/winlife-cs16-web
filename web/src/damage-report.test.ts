import {createHash} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import {DamageReportClient,DamageVisibility,isDamageReport,playerReportKey,type DamageReport} from "./damage-report";
import type {NativeIdentity} from "./game-telemetry";

const identity=(alive=false):NativeIdentity=>({name:"Winlife",map:"de_dust2",team:2,alive});
const report=(deathId="round1:death1"):DamageReport=>({version:1,round:"round1",map:"de_dust2",playerId:1,playerName:"Winlife",dead:true,deathId,
    totals:{damage:100,armor:8,hits:3},weapons:[{name:"ak47",damage:100,armor:8,hits:3}],
    targets:[{id:2,name:"Bot",damage:100,armor:8,hits:3,weapons:[{name:"ak47",damage:100,armor:8,hits:3}]}]});
afterEach(()=>vi.useRealTimers());

it("shows only dead-player reports and suppresses stale data after respawn",()=>{
    const view=new DamageVisibility(),first=report();
    expect(view.select(first,identity())).toBe(first);
    const grenade={...first,totals:{damage:130,armor:8,hits:4}};
    expect(view.select(grenade,identity())).toBe(grenade); // posthumous damage updates the same death
    expect(view.select(grenade,identity(true))).toBeUndefined();
    expect(view.select(first,identity())).toBeUndefined(); // cached previous round
    const next=report("round2:death2");
    expect(view.select(next,identity())).toBe(next);
    expect(view.select({...next,dead:false,deathId:undefined},identity())).toBeUndefined();
    view.reset();expect(view.select(first,identity())).toBe(first);
});
it("isolates native names, maps and spectator state",()=>{
    const view=new DamageVisibility();
    expect(view.select(report(),{...identity(),name:"(1)Winlife"})).toBeUndefined();
    expect(view.select(report(),{...identity(),map:"cs_assault"})).toBeUndefined();
    expect(view.select(report(),{...identity(),team:3})).toBeUndefined();
    expect(view.select(report(),undefined)).toBeUndefined();
    expect(view.select(report(),identity())).toBeDefined();
});
it("does not retire a new death report that arrives before the client death state",()=>{
    const view=new DamageVisibility(),death=report();
    expect(view.select(undefined,identity(true))).toBeUndefined();
    expect(view.select(death,identity(true))).toBeUndefined(); // server already dead, client still alive
    expect(view.select(death,identity())).toBe(death);
    expect(view.select(death,identity(true))).toBeUndefined(); // an actual respawn
    expect(view.select(death,identity())).toBeUndefined();
    const next=report("round2:death2");
    expect(view.select(next,identity(true))).toBeUndefined();
    expect(view.select(next,identity())).toBe(next);
});
it("hashes actual Unicode native names to the same path key as the server",async()=>{
    for(const name of ["Winlife","(1)中文玩家","../unsafe/name","broken\uFFFD"]){
        expect(await playerReportKey(name)).toBe(createHash("sha256").update(name).digest("hex"));
    }
});
it("rejects incomplete or invalid payloads without interpreting page HTML as a report",()=>{
    expect(isDamageReport(report())).toBe(true);
    for(const value of [undefined,"<!doctype html>",{}, {...report(),deathId:undefined},{...report(),totals:{damage:-1,armor:0,hits:0}},
        {...report(),targets:[{id:2,name:"Bot"}]},{...report(),weapons:[{name:"ak47",damage:NaN,armor:0,hits:1}]}]){
        expect(isDamageReport(value)).toBe(false);
    }
});
it("fetches per-player reports without caching and hides a late response after disconnect",async()=>{
    vi.useFakeTimers();
    let finish!:(value:Response)=>void;
    const request=vi.fn<typeof fetch>(()=>new Promise<Response>(resolve=>finish=resolve));
    const render=vi.fn();const current=identity();
    const client=new DamageReportClient(()=>current,key=>`/combat-reports-v1/room/${key}.json`,render,request);
    client.connected(true);client.start();
    // WebCrypto runs outside fake timers.
    await vi.waitFor(()=>expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0][0]).toMatch(/\/combat-reports-v1\/room\/[a-f0-9]{64}\.json$/);
    expect(request.mock.calls[0][1]).toMatchObject({cache:"no-store"});
    client.connected(false);finish(new Response(JSON.stringify(report())));
    await vi.advanceTimersByTimeAsync(250);
    expect(render.mock.calls.some(([r])=>r?.dead)).toBe(false);
    client.stop();
});
it("updates after a death and clears on local respawn even before the next HTTP reply",async()=>{
    vi.useFakeTimers();let current=identity();
    const request=vi.fn(async()=>new Response(JSON.stringify(report()))),render=vi.fn();
    const client=new DamageReportClient(()=>current,key=>`/report/${key}`,render,request);
    client.connected(true);client.start();
    await vi.waitFor(()=>expect(render).toHaveBeenCalledWith(expect.objectContaining({dead:true})));
    current=identity(true);await vi.advanceTimersByTimeAsync(250);
    expect(render).toHaveBeenLastCalledWith(undefined);
    current=identity();await vi.advanceTimersByTimeAsync(1000);
    expect(render).toHaveBeenLastCalledWith(undefined); // old death stays suppressed
    request.mockImplementation(async()=>new Response(JSON.stringify(report("round2:death2"))));
    await vi.advanceTimersByTimeAsync(1000);
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({deathId:"round2:death2"}));
    client.stop();
});
it("calls browser fetch with its global receiver rather than the client instance",async()=>{
    vi.useFakeTimers();
    const request=vi.fn<typeof fetch>(function(this:unknown){
        if(this!==globalThis)throw new TypeError("Illegal invocation");
        return Promise.resolve(new Response(JSON.stringify(report())));
    });
    const render=vi.fn(),client=new DamageReportClient(()=>identity(),key=>`/report/${key}`,render,request);
    client.connected(true);client.start();
    await vi.waitFor(()=>expect(render).toHaveBeenCalledWith(expect.objectContaining({dead:true})));
    client.stop();
});

it("shows a living winner's completed round and hides it on the next round",()=>{
 const view=new DamageVisibility(),ended:DamageReport={...report(),version:2,roundEnded:true,dead:false,deathId:undefined,received:{damage:30,armor:0,hits:2,shots:2}};
 expect(isDamageReport(ended)).toBe(true);
 expect(view.select(ended,identity(true))).toBe(ended);
 const next={...ended,round:"next",roundEnded:false,totals:{damage:0,armor:0,hits:0,shots:0},previous:ended};
 expect(isDamageReport(next)).toBe(true);
 expect(view.select(next,identity(true))).toBeUndefined();
 expect(isDamageReport({...next,previous:{...ended,previous:ended}})).toBe(false);
});
