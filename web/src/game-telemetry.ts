import type {BuyContext} from "./buy-catalog";
export interface NativeRosterPlayer {id:number;name:string;team:number;ping:number;}
export interface NativeIdentity {name:string;team:number;alive:boolean;map:string;}
export interface NativeTelemetry {
    readonly frames:number;
    network():{connected:boolean;latencyMs:number;loss:number};
    confirmWeapon?():boolean;
    team?():number;
    buyState?():BuyContext;
    identity?():NativeIdentity|undefined;
    roster?():NativeRosterPlayer[];
}
export interface TelemetryRuntime {getNativeTelemetry():NativeTelemetry|undefined;}

/** Count native HUD render completions, not browser animation callbacks. */
export class GameTelemetry {
    private timer?:ReturnType<typeof setInterval>;
    private native?:NativeTelemetry;
    private frames=0;
    private time=0;
    private transportReady=false;
    constructor(private readonly runtime:()=>TelemetryRuntime|undefined){}
    connected(ready:boolean):void {
        this.transportReady=ready;
        this.reset();
        if(!ready)document.getElementById("own-ping")!.textContent="—";
    }
    start():void {
        this.reset();
        this.timer=setInterval(()=>this.sample(),500);
        document.getElementById("performance-hud")!.hidden=false;
        document.addEventListener("visibilitychange",()=>this.reset());
    }
    stop():void {clearInterval(this.timer);}
    confirmWeapon():void {this.native?.confirmWeapon?.();}
    team():number|undefined {return this.native?.team?.();}
    buyState():BuyContext|undefined {return this.native?.buyState?.();}
    identity():NativeIdentity|undefined {return this.native?.identity?.();}
    roster():NativeRosterPlayer[]{return this.native?.roster?.()??[];}
    private reset():void {
        this.frames=this.native?.frames??0;this.time=performance.now();
        document.getElementById("own-fps")!.textContent="—";
    }
    private sample():void {
        if(!this.native){
            this.native=this.runtime()?.getNativeTelemetry();
            if(!this.native)return;
            this.reset();return;
        }
        const now=performance.now(),elapsed=now-this.time,frames=this.native.frames;
        document.getElementById("own-fps")!.textContent=document.hidden||elapsed<=0?"—":String(Math.round((frames-this.frames)*1000/elapsed));
        this.frames=frames;this.time=now;
        const network=this.native.network();
        const valid=!document.hidden&&this.transportReady&&network.connected&&Number.isFinite(network.latencyMs)&&network.latencyMs>=0;
        document.getElementById("own-ping")!.textContent=valid?String(Math.round(network.latencyMs)):"—";
        document.getElementById("performance-hud")!.title=valid?`本机游戏帧率 · 游戏连接延迟 · 丢包 ${network.loss}%`:"正在等待游戏连接数据";
    }
}
