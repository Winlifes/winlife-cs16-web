import {availableItems,buyItems,recommendedLoadouts,purchaseCommands,type BuyContext,type BuyItem} from "./buy-catalog";
import {parseBuyUndo,undoMessage,type BuyUndoStatus} from "./buy-undo";
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const node=(tag:string,text="",className="")=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
const dollars=(amount:number)=>`$${amount.toLocaleString("en-US")}`;

export class QuickBuy {
    private visible=false;
    private signature="";
    private timer?:ReturnType<typeof setInterval>;
    private pending=false;
    private generation=0;
    private undo?:BuyUndoStatus;
    private statusAt=0;
    constructor(private readonly context:()=>BuyContext,private readonly command:(text:string)=>void,private readonly resume:()=>void,private readonly nativeShop:()=>void){
        el("shop-presets-tab").onclick=()=>this.tab("presets");el("shop-items-tab").onclick=()=>this.tab("items");el("shop-original").onclick=nativeShop;
        el("shop-undo").onclick=()=>this.undoPurchase();
    }
    receiveLog(line:string):void {const status=parseBuyUndo(line);if(!status)return;this.undo=status;el("shop-undo-status").textContent=undoMessage(status);if(status.code==="ok"){el("shop-status").textContent=undoMessage(status);this.pending=false;}this.refresh();}
    undoPurchase():void {if(this.pending||this.undo?.code!=="ready")return;this.undo=undefined;this.pending=true;el("shop-undo-status").textContent="正在确认撤回…";this.command("winlife_buy_undo");this.refresh();setTimeout(()=>{this.pending=false;this.refresh();},1500);}
    setVisible(visible:boolean):void{
        this.visible=visible;clearInterval(this.timer);
        if(visible){this.generation++;this.pending=false;this.statusAt=0;el("shop-status").textContent="点击单件可连续补齐；一键购买套装后直接返回战斗。";this.refresh();this.timer=setInterval(()=>this.refresh(),250);}
        else this.generation++;
    }
    private tab(tab:"presets"|"items"):void{
        el("shop-presets").hidden=tab!=="presets";el("shop-items").hidden=tab!=="items";
        el("shop-presets-tab").setAttribute("aria-pressed",String(tab==="presets"));el("shop-items-tab").setAttribute("aria-pressed",String(tab==="items"));
    }
    private image(name:string):HTMLImageElement {const img=document.createElement("img");img.src=`${import.meta.env.BASE_URL}ui/loadouts/${name}.png`;img.alt="";img.loading="lazy";return img;}
    private itemButton(item:BuyItem,compact=false):HTMLButtonElement {
        const b=node("button","",compact?"buy-chip":"buy-single") as HTMLButtonElement;b.type="button";b.dataset.buy=item.id;
        b.setAttribute("aria-label",`快捷购买${item.name}${item.price!==undefined?`，参考 ${dollars(item.price)}`:"，按需计费"}`);
        if(!compact&&item.image)b.append(this.image(item.image));
        b.append(node("span",item.name),node("small",item.price===undefined?"按需计费":dollars(item.price)));
        b.onclick=()=>this.single(item.id);return b;
    }
    private refresh():void {
        if(!this.visible)return;const context=this.context();
        el("shop-money").textContent=context.money===undefined?"—":dollars(context.money);
        el("shop-team").textContent=context.team===1?"恐怖分子 · T":context.team===2?"反恐精英 · CT":"等待队伍信息";
        el("shop-map").textContent=context.map||"正在获取地图…";
        const signature=`${context.team}:${context.map}`;
        if(signature!==this.signature){this.signature=signature;this.render(context);}
        const valid=context.alive&&(context.team===1||context.team===2);
        for(const button of document.querySelectorAll<HTMLButtonElement>("#shop [data-buy],#shop [data-loadout]"))button.disabled=!valid||this.pending;
        el("shop-unavailable").hidden=valid;
        el<HTMLButtonElement>("shop-undo").disabled=!valid||this.pending||this.undo?.code!=="ready";
        if(Date.now()-this.statusAt>=1000){this.statusAt=Date.now();this.command("winlife_buy_status");}
    }
    private render(context:BuyContext):void {
        const items=availableItems(context),byId=new Map(items.map(item=>[item.id,item]));
        const grid=el("shop-presets");grid.replaceChildren();
        recommendedLoadouts(context).forEach((loadout,index)=>{
            const card=node("article","","loadout-card"),art=node("div","","loadout-art");art.append(this.image(loadout.image));
            const heading=node("div","","loadout-heading");heading.append(node("h3",loadout.name),node("span",`F${index+1}`,"loadout-key"));
            const chips=node("div","","loadout-items");for(const id of loadout.items){const item=byId.get(id);if(item)chips.append(this.itemButton(item,true));}
            const price=loadout.items.reduce((sum,id)=>sum+(byId.get(id)?.price??0),0);
            const footer=node("div","","loadout-footer");footer.append(node("small",`装备参考 ${dollars(price)}${loadout.items.some(id=>byId.get(id)?.price===undefined)?"＋弹药":""}`));
            const buy=node("button","一键购买套装","primary") as HTMLButtonElement;buy.type="button";buy.dataset.loadout=loadout.id;buy.setAttribute("aria-label",`一键购买${loadout.name}套装`);buy.onclick=()=>this.loadout(index);footer.append(buy);
            card.append(art,heading,node("p",loadout.hint,"loadout-hint"),chips,footer);grid.append(card);
        });
        for(const group of ["weapon","equipment"] as const){const list=el(`shop-${group}-items`);list.replaceChildren(...items.filter(item=>item.group===group).map(item=>this.itemButton(item)));}
    }
    loadout(index:number):void {
        const context=this.context(),loadout=recommendedLoadouts(context)[index];if(!context.alive||this.pending||!loadout)return;
        const commands=purchaseCommands(loadout.items,context);if(!commands.length)return;
        this.pending=true;this.refresh();this.execute(commands);this.resume();
    }
    single(id:string):void {
        const context=this.context(),commands=purchaseCommands([id],context);if(!context.alive||this.pending||!commands.length)return;
        const item=buyItems.find(item=>item.id===id)!;const before=context.money,generation=this.generation;
        this.pending=true;el("shop-status").textContent=`正在购买${item.name}…`;this.refresh();this.execute(commands);
        let attempts=0;
        const confirm=()=>{
            if(!this.visible||this.generation!==generation)return;
            const after=this.context().money;
            if(before!==undefined&&after!==undefined&&after<before){el("shop-status").textContent=`已购买${item.name} · 花费 ${dollars(before-after)} · 剩余 ${dollars(after)}`;this.pending=false;this.refresh();return;}
            if(++attempts<12){setTimeout(confirm,100);return;}
            el("shop-status").textContent=before===undefined||after===undefined?"购买结果请查看游戏内装备与资金。":"本次未确认新增装备：请检查已有装备、弹药、资金或购买条件。";this.pending=false;this.refresh();
        };setTimeout(confirm,100);
    }
    private execute(commands:string[]):void {
        // Only catalog aliases enter the native parser. Never interpolate user text.
        this.command(`alias _winlife_quickbuy "winlife_buy_begin; ${commands.join("; ")}; winlife_buy_end"`);this.command("_winlife_quickbuy");
    }
}
