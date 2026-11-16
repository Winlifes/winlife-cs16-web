export interface BuyContext {team:number;money?:number;map:string;alive:boolean}
export interface BuyItem {id:string;name:string;command:string;price?:number;image?:string;group:"weapon"|"equipment";team?:number;demolition?:boolean}
export interface Loadout {id:string;name:string;hint:string;image:string;items:string[]}

// Fixed ReGameDLL_CS/dlls/weapontype.h prices and native buy aliases.
// Prices exclude ammo and existing armor discounts; the server charges the real cost.
export const buyItems:readonly BuyItem[]=[
    {id:"ak47",name:"AK-47",command:"ak47",price:2500,image:"ak47",group:"weapon",team:1},
    {id:"m4a1",name:"M4A1",command:"m4a1",price:3100,image:"m4a1",group:"weapon",team:2},
    {id:"galil",name:"Galil",command:"galil",price:2000,image:"galil",group:"weapon",team:1},
    {id:"famas",name:"FAMAS",command:"famas",price:2250,image:"famas",group:"weapon",team:2},
    {id:"mp5",name:"MP5",command:"mp5",price:1500,image:"mp5",group:"weapon"},
    {id:"awp",name:"AWP",command:"awp",price:4750,image:"awp",group:"weapon"},
    {id:"scout",name:"Scout",command:"scout",price:2750,image:"scout",group:"weapon"},
    {id:"deagle",name:"沙漠之鹰",command:"deagle",price:650,image:"deserteagle",group:"weapon"},
    {id:"usp",name:"USP",command:"usp",price:500,image:"usp45",group:"weapon"},
    {id:"glock",name:"Glock 18",command:"glock",price:400,image:"glock18",group:"weapon"},
    {id:"p90",name:"P90",command:"p90",price:2350,image:"p90",group:"weapon"},
    {id:"vest",name:"防弹衣",command:"vest",price:650,image:"kevlar",group:"equipment"},
    {id:"vesthelm",name:"防弹衣＋头盔",command:"vesthelm",price:1000,image:"kevlar_helmet",group:"equipment"},
    {id:"hegren",name:"高爆手雷",command:"hegren",price:300,image:"hegrenade",group:"equipment"},
    {id:"flash",name:"闪光弹",command:"flash",price:200,image:"flashbang",group:"equipment"},
    {id:"sgren",name:"烟雾弹",command:"sgren",price:300,image:"smokegrenade",group:"equipment"},
    {id:"defuser",name:"拆弹器",command:"defuser",price:200,image:"defuser",group:"equipment",team:2,demolition:true},
    {id:"primammo",name:"补满主武器弹药",command:"primammo",group:"equipment"},
    {id:"secammo",name:"补满副武器弹药",command:"secammo",group:"equipment"},
];
export function availableItems(context:BuyContext):BuyItem[]{
    if(context.team!==1&&context.team!==2)return [];
    return buyItems.filter(item=>(!item.team||item.team===context.team)&&(!item.demolition||/^de_/i.test(context.map)));
}
export function recommendedLoadouts(context:BuyContext):Loadout[]{
    if(context.team!==1&&context.team!==2)return [];
    const rifle=context.team===1?"ak47":"m4a1",kit=context.team===2&&/^de_/i.test(context.map)?["defuser"]:[];
    return [
        {id:"pistol",name:"手枪开局",hint:"保留出生手枪，把预算留给护甲。",image:"kevlar",items:["vest"]},
        {id:"economy",name:"经济半起",hint:"沙鹰配护甲，低预算争取关键击杀。",image:"deserteagle",items:["deagle","vest","secammo"]},
        {id:"rifle",name:"主力步枪",hint:"主武器、全甲与道具，一套补齐。",image:rifle,items:[rifle,"vesthelm","primammo",...kit,"hegren","flash"]},
        {id:"sniper",name:"狙击支援",hint:"AWP 控线，沙鹰近身，闪光掩护。",image:"awp",items:["awp","deagle","vesthelm","primammo","secammo",...kit,"flash"]},
    ];
}
export function purchaseCommands(ids:readonly string[],context:BuyContext):string[] {
    const allowed=new Map(availableItems(context).map(item=>[item.id,item.command]));
    return ids.flatMap(id=>allowed.has(id)?[allowed.get(id)!]:[]);
}
export function classicBuyCategory(key:string):string|undefined {
    return ({"1":"showvguimenu 29","2":"showvguimenu 30","3":"showvguimenu 32","4":"showvguimenu 31","5":"showvguimenu 33","8":"showvguimenu 34"} as Record<string,string>)[key];
}
