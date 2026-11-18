import {PointerCapture} from "./pointer-capture";
import {TeamSelection} from "./team-selection";
import {buyKeyAction} from "./buy-keys";
import {QuickBuy} from "./quick-buy";
import {classicBuyCategory,type BuyContext} from "./buy-catalog";

type Panel="team"|"ready"|"pause"|"tools"|"bots"|"mouse"|"damage"|"shop"|"native"|"scores"|"unlocked"|"playing"|"result";
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const releasedCommands=["-attack","-attack2","-reload","-forward","-back","-moveleft","-moveright","-jump","-duck","-use","-showscores"];

export class GameUI {
    private active=false;
    private isSettled=false;
    private panel:Panel="team";
    private hasTeam=false;
    private teamReady=false;
    private selecting=false;
    private currentTeam?:string;
    private generation=0;
    private nativeGeneration=0;
    private buyMenu?:string;
    private hintTimer?:ReturnType<typeof setTimeout>;
    private readonly canvas=el<HTMLCanvasElement>("canvas");
    private readonly pointer:PointerCapture;
    private readonly teams:TeamSelection;
    private readonly shop:QuickBuy;
    private originalBuy=false;
    constructor(private readonly command:(value:string)=>void,private readonly confirmWeapon:()=>void=()=>{},private readonly ownTeam:()=>number|undefined=()=>undefined,leave:()=>void=()=>window.location.reload(),readBuyState:()=>BuyContext|undefined=()=>undefined){
        this.teams=new TeamSelection(command,()=>({team:this.ownTeam(),joined:this.hasTeam}));
        this.pointer=new PointerCapture(this.canvas,captured=>{
            console.info("[Input]",captured?"captured":"released",{focused:document.hasFocus(),panel:this.panel});
            if(captured){this.show("playing");el("hud-hint").hidden=false;clearTimeout(this.hintTimer);this.hintTimer=setTimeout(()=>el("hud-hint").hidden=true,3500);}
            else if(this.panel==="playing")this.show(this.hasTeam?"pause":"team");
        },message=>{el("input-status").textContent=message;el("ready-status").textContent=message;});
        document.querySelectorAll<HTMLButtonElement>("[data-team]").forEach(button=>button.onclick=()=>void this.choose(button.dataset.team!));
        this.shop=new QuickBuy(()=>readBuyState()??{team:this.ownTeam()??0,map:"",alive:false},command,()=>void this.enter(),()=>{
            this.originalBuy=true;this.command("buy");setTimeout(()=>{if(this.panel==="shop")this.originalBuy=false;},1500);
        });
        for(const id of ["resume","start-battle","native-resume","shop-resume","mouse-resume","damage-resume"])el(id).onclick=()=>void this.enter();
        el("native-quick-buy").onclick=()=>this.openShop();
        for(const id of ["team-toggle","ready-team"])el(id).onclick=()=>this.openTeam();
        for(const id of ["team-back","tools-back","native-back","bots-back","mouse-back","damage-back"])el(id).onclick=()=>this.pause();
        el("mouse-toggle").onclick=()=>this.show("mouse");
        el("damage-toggle").onclick=()=>this.show("damage");
        el("bots-toggle").onclick=()=>this.show("bots");
        el("tools-toggle").onclick=()=>this.show("tools");
        el("scores-toggle").onclick=()=>{this.show("scores");this.command("+showscores");};
        el("result-damage").onclick=()=>this.show("damage");
        el("scores-back").onclick=()=>this.pause();
        el("buy-menu").onclick=()=>{el("input-status").textContent="需在购买区且购买时间内才能购买装备。";this.command("buy");};
        el("fullscreen").onclick=()=>void el("game").requestFullscreen().catch(()=>{el("input-status").textContent="当前浏览器未进入全屏，可继续游戏。";});
        el("leave").onclick=leave;
        window.addEventListener("keydown",event=>this.keydown(event),true);
        for(const type of ["keyup","keypress"]){window.addEventListener(type,event=>{
            if(this.active&&this.blocksEngine(event))event.stopImmediatePropagation();
        },true);}
        // Keep menu clicks and typing out of SDL's document/window listeners.
        // Stopping propagation preserves normal input/button default actions.
        for(const type of ["mousedown","mouseup","mousemove","wheel"]){window.addEventListener(type,event=>{
            if(this.active&&this.blocksEngine(event))event.stopImmediatePropagation();
        },{capture:true});}
        this.canvas.addEventListener("contextmenu",event=>event.preventDefault());
        this.canvas.addEventListener("click",event=>{if(this.panel==="unlocked"){event.preventDefault();event.stopImmediatePropagation();void this.enter();}},true);
        window.addEventListener("wheel",event=>{
            if(!this.active||this.panel!=="playing"||!event.deltaY)return;
            event.preventDefault();event.stopImmediatePropagation();
            this.command(event.deltaY>0?"invnext":"invprev");this.confirmWeapon();
        },{capture:true,passive:false});
        window.addEventListener("blur",()=>{if(this.active&&this.panel==="playing")this.pause();});
    }
    settled(finished:boolean):void {
        if(finished===this.isSettled)return;
        this.isSettled=finished;
        if(finished){this.closeNative();this.show("result");}
        else {el("ready-status").textContent="新的一场已开始，点击进入战场。";this.show(this.hasTeam?"ready":"team");}
    }
    begin():void {this.active=true;this.resetConnection();}
    reconnecting():void {if(this.active)this.resetConnection();}
    receiveLog(line:string):void {
        // WASM print callbacks run inside the engine. Do not re-enter its
        // command parser until the current frame/exec has completed.
        queueMicrotask(()=>{if(this.active)this.handleLog(line.replace(/\x1b\[[0-9;]*m/g,""));});
    }
    private resetConnection():void {
        this.teams.reset();
        this.generation++;this.hasTeam=false;this.currentTeam=undefined;this.teamReady=false;
        this.show("team");this.updateTeamButtons();el("team-status").textContent="正在连接服务器，稍后即可选择队伍…";
    }
    private handleLog(line:string):void {
        this.shop.receiveLog(line);
        this.teams.receiveLog(line);
        if(/Server #\d+/.test(line))this.resetConnection();
        if(line.includes("execing touch/chooseteam.cfg")){
            this.teamReady=true;this.updateTeamButtons();this.show("team");
            el("team-status").textContent="点击选择队伍，也可按 1、2、5、6。选队时鼠标保持可见。";
        }
        if(/execing touch\/(?:buy[^/]*|radio[a-z]*|commandmenu)\.cfg/.test(line)){
            this.buyMenu=/execing touch\/(buy[^/]*)\.cfg/.exec(line)?.[1];
            this.nativeGeneration++;
            this.command('alias _menu_off "touch_setclientonly 0; echo WINLIFE_NATIVE_MENU_CLOSED"');
            if(this.buyMenu==="buy"&&!this.originalBuy)this.openShop();
            else this.show("native");
        }
        if(line.includes("WINLIFE_NATIVE_MENU_CLOSED")){
            const generation=this.nativeGeneration;
            setTimeout(()=>{if(this.panel==="native"&&generation===this.nativeGeneration){
                // The purchase click/key is already the player's gesture.
                // Re-enter directly; a browser refusal leaves a small inline
                // resume hint instead of interrupting every purchase with a dialog.
                this.show("unlocked");void this.pointer.enter();
            }},0);
        }
    }
    private blocksEngine(event:Event):boolean {
        if(el<HTMLDialogElement>("release-dialog").open)return true;
        if(this.panel==="playing")return false;
        if(this.panel!=="native")return true;
        return event.target!==this.canvas && event.target instanceof Element && !!event.target.closest("button,input,select,summary");
    }
    private clearControls():void {for(const command of releasedCommands)this.command(command);}
    private show(panel:Panel):void {
        if(this.isSettled&&!["result","damage","scores"].includes(panel))panel="result";
        this.panel=panel;
        if(panel!=="native")this.originalBuy=false;
        document.documentElement.dataset.inputMode=panel==="playing"?"playing":["native","scores","unlocked"].includes(panel)?"native":"menu";
        el("overlay").hidden=["playing","native","scores","unlocked"].includes(panel);
        for(const name of ["team","ready","pause","tools","bots","mouse","damage","shop","result"] as const)el(name).hidden=name!==panel;
        this.shop.setVisible(panel==="shop");
        el("native-menu-hint").hidden=panel!=="native"&&panel!=="unlocked";
        el("native-hint-text").textContent=panel==="unlocked"?"点击画面继续战斗":"选择装备后自动返回战斗";
        el("native-quick-buy").hidden=panel!=="native"||!this.buyMenu;
        el("scoreboard-hint").hidden=panel!=="scores";
        el("hud-hint").hidden=true;
        el("team-back").hidden=!this.hasTeam;
        if(panel!=="playing"){
            this.pointer.release();this.clearControls();
            queueMicrotask(()=>{if(this.panel!==panel)return;
                if(panel==="result"||panel==="damage"){el(panel).scrollTop=0;el(`${panel}-title`).tabIndex=-1;el(`${panel}-title`).focus({preventScroll:true});}
                else if(panel==="native"||panel==="scores"||panel==="unlocked")this.canvas.focus();
                else if(panel==="mouse")el<HTMLInputElement>("mouse-sensitivity").focus();
                else el(panel).querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
            });
        }
    }
    private closeNative():void {
        if(this.panel!=="native"&&this.panel!=="shop")return;
        this.nativeGeneration++;
        this.buyMenu=undefined;
        this.show("ready");
        this.command("_erase_frame");this.command("client_buy_close");this.command("touch_removebutton _menu_*");this.command("touch_setclientonly 0");
    }
    private openShop():void {
        this.show("shop");this.command("touch_removebutton _menu_*");this.command("touch_setclientonly 0");this.command("slot10");
    }
    private pause():void {
        if(this.panel==="team"&&this.hasTeam)this.command("slot10");
        this.closeNative();this.show(this.hasTeam?"pause":"team");
    }
    private openTeam():void {
        this.closeNative();this.show("team");this.teamReady=false;this.updateTeamButtons();
        el("team-status").textContent="正在请求队伍菜单…";this.command("chooseteam");
    }
    private updateTeamButtons():void {
        document.querySelectorAll<HTMLButtonElement>("[data-team]").forEach(button=>button.disabled=this.selecting||!this.teamReady);
    }
    private async choose(team:string):Promise<void> {
        if(this.selecting||!this.teamReady)return;
        const nativeTeam=this.ownTeam();
        const currentTeam=nativeTeam===1||nativeTeam===2?String(nativeTeam):this.currentTeam;
        if(this.hasTeam&&currentTeam===team&&team!=="5"){
            this.currentTeam=team;
            el("ready-status").textContent=team==="1"?"已加入恐怖分子。":team==="2"?"已加入反恐精英。":"已进入旁观模式。";
            this.command("slot10");this.command("touch_setclientonly 0");this.show("ready");return;
        }
        this.selecting=true;this.updateTeamButtons();const generation=this.generation;
        el("team-status").textContent="正在加入队伍…";
        try{
            const selected=await this.teams.choose(team);
            if(generation!==this.generation)return;
            // Close client menu state as well as its touch drawing layer.
            this.command("slot10");this.command("client_buy_close");this.command("touch_removeall");this.command("touch_setclientonly 0");
            this.hasTeam=true;this.currentTeam=selected;
            el("ready-status").textContent=selected==="1"?"已加入恐怖分子。":selected==="2"?"已加入反恐精英。":selected==="6"?"已进入旁观模式。":"已自动分配队伍。";
            this.show("ready");
        } catch(error){if(generation===this.generation)el("team-status").textContent=error instanceof Error?error.message:String(error);}
        finally{this.selecting=false;this.updateTeamButtons();}
    }
    private async enter():Promise<void> {
        if(this.isSettled){this.show("result");return;}
        if(!this.hasTeam){this.show("team");return;}
        this.closeNative();
        this.command("touch_setclientonly 0");
        // Close the page panel even when the browser refuses pointer capture
        // (for example immediately after Escape). A canvas click can retry.
        this.show("unlocked");
        const buttons=["resume","start-battle","native-resume","shop-resume","mouse-resume","damage-resume"].map(id=>el<HTMLButtonElement>(id));
        buttons.forEach(button=>button.disabled=true);
        try{await this.pointer.enter();}finally{buttons.forEach(button=>button.disabled=false);}
    }
    private keydown(event:KeyboardEvent):void {
        if(!this.active)return;
        if(el<HTMLDialogElement>("release-dialog").open){event.stopImmediatePropagation();return;}
        const key=event.key.toLowerCase();
        const editing=event.target instanceof Element&&!!event.target.closest("input,textarea,select");
        if(key==="escape"){
            event.preventDefault();event.stopImmediatePropagation();
            // Holding Escape must dismiss a menu once, not reopen pause on
            // the following auto-repeat events after that menu is hidden.
            if(event.repeat)return;
            if(this.isSettled){this.show("result");return;}
            if(this.hasTeam&&this.panel!=="playing"&&this.panel!=="unlocked"&&!this.selecting){
                if(this.panel==="team")this.command("slot10");
                this.closeNative();this.command("touch_setclientonly 0");this.show("unlocked");
            }else this.pause();
            return;
        }
        if(this.panel==="shop"&&!editing){
            if((event.ctrlKey||event.metaKey)&&key==="z"){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)this.shop.undoPurchase();return;}
            if(key==="b"||key==="0"){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)void this.enter();return;}
            if(key==="a"||key==="r"){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat){this.command('alias _winlife_auto "winlife_buy_begin; '+(key==="a"?"autobuy":"rebuy")+'; winlife_buy_end"');this.command("_winlife_auto");void this.enter();}return;}
            if(/^f[1-4]$/.test(key)){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)this.shop.loadout(Number(key.slice(1))-1);return;}
            if(key==="6"||key==="7"){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)this.shop.single(key==="6"?"primammo":"secammo");return;}
            const category=classicBuyCategory(key);
            if(category){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat){this.command(category);}return;}
        }
        if(this.panel==="native"&&!editing){
            const action=buyKeyAction(this.buyMenu,key);
            if(action){
                event.preventDefault();event.stopImmediatePropagation();
                if(!event.repeat){this.command(`alias _winlife_buykey "${action}"`);this.command("_winlife_buykey");}
                return;
            }
        }
        // Keep gameplay keys in the engine (including M / chooseteam), so
        // typing the same letters in its chat box does not open our menus.
        if(this.blocksEngine(event)){
            event.stopImmediatePropagation();
            if(!editing&&this.panel==="team"&&["1","2","5","6"].includes(key)){
                event.preventDefault();void this.choose(key);
            }
        }
    }
}
