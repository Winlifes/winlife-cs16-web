import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {availableItems,buyItems,classicBuyCategory,purchaseCommands,recommendedLoadouts,type BuyContext} from "./buy-catalog";
const t:BuyContext={team:1,map:"de_dust2",alive:true,money:800};

it("matches the pinned native ReGameDLL price constants",()=>{
    const {prices}=JSON.parse(readFileSync(new URL("./testing/regamedll-prices.json",import.meta.url),"utf8"));
    const keys:Record<string,string>={ak47:"AK47",m4a1:"M4A1",galil:"GALIL",famas:"FAMAS",mp5:"MP5NAVY",awp:"AWP",scout:"SCOUT",deagle:"DEAGLE",usp:"USP",glock:"GLOCK18",p90:"P90",vest:"KEVLAR",vesthelm:"ASSAULTSUIT",hegren:"HEGRENADE",flash:"FLASHBANG",sgren:"SMOKEGRENADE",defuser:"DEFUSEKIT"};
    for(const item of buyItems)if(item.price!==undefined)expect(item.price,item.id).toBe(prices[keys[item.id]]);
});
it("switches rifles with the actual team and includes kits only on CT demolition maps",()=>{
    expect(recommendedLoadouts(t)[2].items).toEqual(["ak47","vesthelm","primammo","hegren","flash"]);
    const ct={...t,team:2};expect(recommendedLoadouts(ct)[2].items).toEqual(["m4a1","vesthelm","primammo","defuser","hegren","flash"]);
    expect(availableItems({...ct,map:"cs_assault"}).some(i=>i.id==="defuser")).toBe(false);
    expect(recommendedLoadouts({...ct,map:"cs_italy"})[3].items).not.toContain("defuser");
    expect(availableItems({...t,team:3})).toEqual([]);
});
it("emits only valid native aliases in purchase order and preserves B-1-4 category routing",()=>{
    expect(purchaseCommands(["ak47","vesthelm","primammo","hegren","flash"],t)).toEqual(["ak47","vesthelm","primammo","hegren","flash"]);
    expect(purchaseCommands(["m4a1","defuser","ak47;quit","unknown\ncommand"],t)).toEqual([]);
    expect(purchaseCommands(["vest","secammo"],{...t,team:0})).toEqual([]);
    expect(classicBuyCategory("1")).toBe("showvguimenu 29");expect(classicBuyCategory("8")).toBe("showvguimenu 34");expect(classicBuyCategory("9")).toBeUndefined();
});
