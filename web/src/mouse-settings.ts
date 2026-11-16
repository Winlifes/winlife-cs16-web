export const sensitivityDefault=3;
export const sensitivityKey="winlife.cs16.mouseSensitivity";
type MouseStorage=Pick<Storage,"getItem"|"setItem">;

export function parseSensitivity(raw:unknown):number|undefined {
    if((typeof raw!=="number"&&typeof raw!=="string")||String(raw).trim()==="")return;
    const value=Number(raw);
    if(!Number.isFinite(value)||value<.1||value>10)return;
    return Math.round(value*10)/10;
}

export function mouseConfigEvent(line:string):"waiting"|"ready"|undefined {
    line=line.replace(/\x1b\[[0-9;]*m/g,"");
    if(/Server #\d+/.test(line))return "waiting";
    if(line.includes("execing touch/chooseteam.cfg"))return "ready";
}

export class MousePreference {
    value=sensitivityDefault;
    ready=false;
    persisted=true;
    private storage?:MouseStorage;
    constructor(private readonly command:(text:string)=>void,storage?:MouseStorage){
        try{this.storage=storage??localStorage;this.value=parseSensitivity(this.storage.getItem(sensitivityKey))??sensitivityDefault;}
        catch{this.persisted=false;}
    }
    set(raw:unknown):boolean {
        const value=parseSensitivity(raw);if(value===undefined)return false;
        this.value=value;
        try{if(!this.storage)throw new Error("Storage unavailable");this.storage.setItem(sensitivityKey,value.toFixed(1));this.persisted=true;}
        catch{this.persisted=false;}
        if(this.ready)this.apply();return true;
    }
    nativeReady():void {this.ready=true;this.apply();}
    waiting():void {this.ready=false;}
    private apply():void {this.command(`sensitivity ${this.value.toFixed(1)}`);}
}

export class MouseSettings {
    private readonly preference:MousePreference;
    private readonly slider=document.getElementById("mouse-sensitivity") as HTMLInputElement;
    private readonly number=document.getElementById("mouse-sensitivity-value") as HTMLInputElement;
    private readonly output=document.getElementById("mouse-sensitivity-current")!;
    private readonly status=document.getElementById("mouse-settings-status")!;
    constructor(command:(text:string)=>void){
        this.preference=new MousePreference(command);this.render(true);
        this.slider.addEventListener("input",()=>{this.preference.set(this.slider.value);this.render(true);});
        this.number.addEventListener("input",()=>{
            if(this.preference.set(this.number.value))this.render(false);
            else this.status.textContent="请输入 0.1–10.0 之间的灵敏度。";
        });
        this.number.addEventListener("blur",()=>{const valid=parseSensitivity(this.number.value)!==undefined;this.render(true);if(!valid)this.status.textContent="请输入 0.1–10.0 之间的灵敏度，已保留上次有效设置。";});
        document.getElementById("mouse-reset")!.onclick=()=>{this.preference.set(sensitivityDefault);this.render(true);};
    }
    waiting():void {this.preference.waiting();this.render(false);}
    receiveLog(line:string):void {
        const event=mouseConfigEvent(line);
        if(event==="waiting"){this.waiting();return;}
        if(event!=="ready")return;
        // The client DLL and its cvars are ready here. Do not re-enter the
        // native parser from its print callback; reapply after every map load.
        queueMicrotask(()=>{this.preference.nativeReady();this.render(false);});
    }
    private render(updateNumber:boolean):void {
        const value=this.preference.value.toFixed(1);this.slider.value=value;this.output.textContent=value;
        if(updateNumber)this.number.value=value;
        this.status.textContent=!this.preference.persisted?"本次设置已保留，当前浏览器未允许自动保存。":this.preference.ready?"已生效并自动保存，下次进入继续使用。":"进入游戏后自动应用此设置。";
    }
}
