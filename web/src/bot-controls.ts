import type {Room} from "./lobby";

export interface BotSettings {count:number;difficulty:number;split?:boolean;t?:number;ct?:number}
export const botDifficulties=["入门","简单","普通","困难","专家"] as const;
export const botTeamSummary=(settings:BotSettings)=>settings.split?`T ${settings.t??0} 个 / CT ${settings.ct??0} 个`:"自动分配阵营";

export function readBotSettings(split:boolean,countText:string,tText:string,ctText:string,difficultyText:string,limit:number,clear=false):BotSettings {
    const integer=(text:string)=>text.trim()?Number(text):NaN;
    const t=clear?0:integer(tText),ct=clear?0:integer(ctText);
    const count=clear?0:split?t+ct:integer(countText),difficulty=integer(difficultyText);
    if(!Number.isInteger(count)||count<0||count>limit||(split&&(!Number.isInteger(t)||!Number.isInteger(ct)||t<0||ct<0)))throw new Error(`人机总数须为 0–${limit}；T、CT 人数须为非负整数。`);
    if(!Number.isInteger(difficulty)||difficulty<0||difficulty>4)throw new Error("请选择有效的人机难度。");
    return {count,difficulty,split,t:split?t:0,ct:split?ct:0};
}
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text="")=>{const el=document.createElement(tag);el.textContent=text;return el;};

export class BotControls {
    private readonly summary=node("p");
    private readonly count=node("input");
    private readonly difficulty=node("select");
    private readonly mode=node("select");
    private readonly t=node("input");
    private readonly ct=node("input");
    private readonly countLabel=node("label","人机总数");
    private readonly tLabel=node("label","T · 恐怖分子人机");
    private readonly ctLabel=node("label","CT · 反恐精英人机");
    private readonly apply=node("button","应用人机设置");
    private readonly clear=node("button","清空人机");
    private readonly status=node("p");
    private dirty=false;
    private pending=false;
    private automaticStatus="";
    private room?:Room;
    private host=false;
    constructor(root:HTMLElement,private readonly save:(settings:BotSettings)=>Promise<Room>){
        root.classList.add("bot-controls");
        const fields=node("div"),difficultyLabel=node("label","人机难度"),modeLabel=node("label","阵营分配"),actions=node("div");
        fields.className="bot-fields";actions.className="bot-actions";this.summary.className="bot-summary";this.status.className="bot-status";
        this.status.setAttribute("role","status");this.status.setAttribute("aria-live","polite");
        for(const [input,label,key] of [[this.count,this.countLabel,"count"],[this.t,this.tLabel,"t"],[this.ct,this.ctLabel,"ct"]] as const){
            input.type="number";input.min="0";input.step="1";input.value="0";input.id=`${root.id}-${key}`;label.htmlFor=input.id;label.append(input);
        }
        this.count.setAttribute("aria-label","人机数量");
        this.mode.id=`${root.id}-mode`;modeLabel.htmlFor=this.mode.id;
        for(const [value,label] of [["auto","自动分配"],["split","分别设置 T / CT"]]){const option=node("option",label);option.value=value;this.mode.append(option);}
        modeLabel.append(this.mode);
        this.difficulty.id=`${root.id}-difficulty`;this.difficulty.setAttribute("aria-label","人机难度");difficultyLabel.htmlFor=this.difficulty.id;
        botDifficulties.forEach((label,index)=>{const option=node("option",label);option.value=String(index);this.difficulty.append(option);});
        this.difficulty.value="2";difficultyLabel.append(this.difficulty);fields.append(modeLabel,difficultyLabel,this.countLabel,this.tLabel,this.ctLabel);this.showMode();
        this.apply.type=this.clear.type="button";this.apply.className="primary";this.apply.onclick=()=>void this.submit(false);this.clear.onclick=()=>void this.submit(true);
        for(const input of [this.count,this.difficulty,this.mode,this.t,this.ct])input.addEventListener("input",()=>{
            if(input===this.mode&&this.mode.value==="split"){const total=Math.max(0,Number(this.count.value)||0);this.t.value=String(Math.floor(total/2));this.ct.value=String(Math.ceil(total/2));}
            this.showMode();this.dirty=true;this.status.textContent="设置尚未应用。";
        });
        actions.append(this.apply,this.clear);
        const note=node("p","仅房主可调整；可分别指定两边的人机数量。真人加入优先占用席位，超出的人机会自动减少；中场换边时两边人机设置一起交换。" );note.className="bot-note";
        root.append(this.summary,fields,actions,this.status,note);
    }
    private showMode():void {const split=this.mode.value==="split";this.countLabel.hidden=split;this.tLabel.hidden=this.ctLabel.hidden=!split;}
    update(room:Room,host:boolean):void {
        const changedRoom=this.room?.id!==room.id;
        if(changedRoom){this.dirty=false;this.status.textContent="";this.automaticStatus="";}
        this.room=room;this.host=host;const settings=room.bots??{count:0,difficulty:2};
        const limit=Math.max(0,room.maxPlayers-room.members.length);this.count.max=this.t.max=this.ct.max=String(limit);
        if(!this.dirty||!host){this.count.value=String(settings.count);this.difficulty.value=String(settings.difficulty);this.mode.value=settings.split?"split":"auto";this.t.value=String(settings.t??0);this.ct.value=String(settings.ct??0);this.showMode();}
        this.summary.textContent=(room.phase==="playing"?`当前 ${room.botCount??0} 个人机 · 目标 ${settings.count} 个`:`开局后添加 ${settings.count} 个人机`)+` · ${botTeamSummary(settings)} · ${botDifficulties[settings.difficulty]}难度`;
        const disabled=!host||room.phase==="starting"||this.pending;
        for(const input of [this.count,this.difficulty,this.mode,this.t,this.ct,this.apply,this.clear])input.disabled=disabled;
        this.apply.textContent=this.pending?"正在应用…":"应用人机设置";
        const automatic=room.botsError||(!host?"由房主设置人机数量、阵营和难度。":room.phase==="starting"?"正在开局，进入游戏后可继续调整。":"");
        if(automatic){this.status.textContent=automatic;this.automaticStatus=automatic;}
        else if(this.automaticStatus){if(this.status.textContent===this.automaticStatus)this.status.textContent="";this.automaticStatus="";}
    }
    private async submit(clear:boolean):Promise<void>{
        if(!this.room||!this.host||this.pending)return;
        let settings:BotSettings;
        try{settings=readBotSettings(this.mode.value==="split",this.count.value,this.t.value,this.ct.value,this.difficulty.value,Number(this.count.max),clear);}
        catch(error){this.status.textContent=(error as Error).message;return;}
        this.pending=true;this.status.textContent="正在应用人机设置…";this.update(this.room,this.host);
        try{const room=await this.save(settings);this.dirty=false;this.update(room,this.host);this.status.textContent=room.botsError||(room.phase==="playing"?(settings.count===0?"已请求清空人机，人数将自动刷新。":"已应用，人机人数将自动刷新。"):"人机设置已保存。");}
        catch(error){this.status.textContent=error instanceof Error?error.message:String(error);}
        finally{this.pending=false;if(this.room)this.update(this.room,this.host);}
    }
}
