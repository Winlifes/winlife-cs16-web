import {readFileSync} from "node:fs";
import {expect,it} from "vitest";
import {availableItems,buyItems,classicBuyCategory,purchaseCommands,recommendedLoadouts,type BuyContext} from "./buy-catalog";
const t:BuyContext={team:1,map:"de_dust2",alive:true,money:800};

it("covers every priced shop item in the pinned native ReGameDLL catalog",()=>{
    const {prices}=JSON.parse(readFileSync(new URL("./testing/regamedll-prices.json",import.meta.url),"utf8"));
    const keys:Record<string,string>={mp5:"MP5NAVY",glock:"GLOCK18",elites:"ELITE",vest:"KEVLAR",vesthelm:"ASSAULTSUIT",hegren:"HEGRENADE",flash:"FLASHBANG",sgren:"SMOKEGRENADE",defuser:"DEFUSEKIT",shield:"SHIELDGUN"};
    const actual=buyItems.filter(item=>item.price!==undefined).map(item=>[keys[item.id]??item.id.toUpperCase(),item.price]);
    // A helmet is part of the armor bundle. The ammo buttons buy a variable amount.
    const expected=Object.entries(prices).filter(([key])=>key!=="HELMET"&&!key.startsWith("AMMO_"));
    expect(actual.sort()).toEqual(expected.sort());
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

it("offers the full team-specific arsenal and uses the native aliases for new equipment",()=>{
    const tOnly=["elites","mac10","galil","ak47","sg552","g3sg1"];
    const ctOnly=["fiveseven","tmp","famas","m4a1","aug","sg550","shield"];
    const shared=["glock","usp","p228","deagle","m3","xm1014","mp5","ump45","p90","scout","awp","m249"];
    const ct={...t,team:2};
    expect(availableItems(t).filter(item=>item.group!=="equipment").map(item=>item.id).sort()).toEqual([...shared,...tOnly].sort());
    expect(availableItems(ct).filter(item=>item.group!=="equipment").map(item=>item.id).sort()).toEqual([...shared,...ctOnly.filter(id=>id!=="shield")].sort());
    expect(purchaseCommands(ctOnly,t)).toEqual([]);
    expect(purchaseCommands(tOnly,ct)).toEqual([]);
    expect(purchaseCommands(["fiveseven","nvg","shield"],ct)).toEqual(["fn57","nvgs","shield"]);
});
