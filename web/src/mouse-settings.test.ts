import {expect,it} from "vitest";
import {MousePreference,mouseConfigEvent,parseSensitivity,sensitivityKey} from "./mouse-settings";

it("rejects invalid sensitivity values before they can enter the native command parser",()=>{
    for(const raw of [null,undefined,"",NaN,Infinity,-1,0,.01,10.1,"3; quit","1\nsay test",{},true])expect(parseSensitivity(raw)).toBeUndefined();
    expect(parseSensitivity("0.1")).toBe(.1);expect(parseSensitivity("10")).toBe(10);expect(parseSensitivity(2.34)).toBe(2.3);
});
it("saves a personal preference, applies after native initialization and restores after re-entry or map load",()=>{
    const values=new Map([[sensitivityKey,"1.7"]]),commands:string[]=[];
    const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
    const preference=new MousePreference(command=>commands.push(command),storage);
    expect(preference.value).toBe(1.7);expect(commands).toEqual([]);
    preference.nativeReady();expect(commands).toEqual(["sensitivity 1.7"]);
    preference.set(8.5);expect(commands.at(-1)).toBe("sensitivity 8.5");expect(values.get(sensitivityKey)).toBe("8.5");
    expect(preference.set("8.5;quit")).toBe(false);expect(commands).toHaveLength(2);
    preference.waiting();preference.set(2.4);expect(commands).toHaveLength(2);
    preference.nativeReady();expect(commands.at(-1)).toBe("sensitivity 2.4");
    const restored=new MousePreference(command=>commands.push(command),storage);restored.nativeReady();expect(commands.at(-1)).toBe("sensitivity 2.4");
    restored.set(3);expect(commands.at(-1)).toBe("sensitivity 3.0");
});
it("keeps the control usable when browser storage is unavailable",()=>{
    const commands:string[]=[];
    const preference=new MousePreference(command=>commands.push(command),{getItem:()=>{throw new Error("blocked");},setItem:()=>{throw new Error("blocked");}});
    expect(preference.value).toBe(3);preference.nativeReady();preference.set(1.2);
    expect(commands.at(-1)).toBe("sensitivity 1.2");expect(preference.persisted).toBe(false);
});
it("waits for the native client configuration, including colored engine log output",()=>{
    expect(mouseConfigEvent("Server #42")).toBe("waiting");
    expect(mouseConfigEvent("execing \x1b[1;32mtouch/chooseteam.cfg\x1b[0m")).toBe("ready");
    expect(mouseConfigEvent("execing touch/buy.cfg")).toBeUndefined();
    expect(mouseConfigEvent('"sensitivity" is "3"')).toBeUndefined();
});
