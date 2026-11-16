import type {Room} from "./lobby";

export interface BotSettings {count:number;difficulty:number}
export const botDifficulties=["入门","简单","普通","困难","专家"] as const;
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text="")=>{const el=document.createElement(tag);el.textContent=text;return el;};

export class BotControls {
    private readonly summary=node("p");
    private readonly count=node("input");
    private readonly difficulty=node("select");
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
        const fields=node("div"),countLabel=node("label","人机数量"),difficultyLabel=node("label","人机难度"),actions=node("div");
        fields.className="bot-fields";actions.className="bot-actions";this.summary.className="bot-summary";this.status.className="bot-status";
        this.status.setAttribute("role","status");this.status.setAttribute("aria-live","polite");
        this.count.type="number";this.count.min="0";this.count.step="1";this.count.value="0";this.count.id=`${root.id}-count`;
        this.count.setAttribute("aria-label","人机数量");countLabel.htmlFor=this.count.id;countLabel.append(this.count);
        this.difficulty.id=`${root.id}-difficulty`;this.difficulty.setAttribute("aria-label","人机难度");difficultyLabel.htmlFor=this.difficulty.id;
        botDifficulties.forEach((label,index)=>{const option=node("option",label);option.value=String(index);this.difficulty.append(option);});
        this.difficulty.value="2";difficultyLabel.append(this.difficulty);fields.append(countLabel,difficultyLabel);
        this.apply.type=this.clear.type="button";this.apply.className="primary";this.apply.onclick=()=>void this.submit(false);this.clear.onclick=()=>void this.submit(true);
        for(const input of [this.count,this.difficulty])input.addEventListener("input",()=>{this.dirty=true;this.status.textContent="设置尚未应用。";});
        actions.append(this.apply,this.clear);
        const note=node("p","仅房主可调整；人机自动分配阵营。真人加入优先占用席位，超出的人机会自动减少。" );note.className="bot-note";
        root.append(this.summary,fields,actions,this.status,note);
    }
    update(room:Room,host:boolean):void {
        const changedRoom=this.room?.id!==room.id;
        if(changedRoom){this.dirty=false;this.status.textContent="";this.automaticStatus="";}
        this.room=room;this.host=host;const settings=room.bots??{count:0,difficulty:2};
        const limit=Math.max(0,room.maxPlayers-room.members.length);this.count.max=String(limit);
        if(!this.dirty||!host){this.count.value=String(settings.count);this.difficulty.value=String(settings.difficulty);}
        this.summary.textContent=room.phase==="playing"?`当前 ${room.botCount??0} 个人机 · 目标 ${settings.count} 个 · ${botDifficulties[settings.difficulty]}难度`:`开局后添加 ${settings.count} 个人机 · ${botDifficulties[settings.difficulty]}难度`;
        const disabled=!host||room.phase==="starting"||this.pending;
        this.count.disabled=this.difficulty.disabled=this.apply.disabled=this.clear.disabled=disabled;
        this.apply.textContent=this.pending?"正在应用…":"应用人机设置";
        const automatic=room.botsError||(!host?"房主设置人机数量和难度，你可以查看当前设置。":room.phase==="starting"?"正在开局，进入游戏后可继续调整。":"");
        if(automatic){this.status.textContent=automatic;this.automaticStatus=automatic;}
        else if(this.automaticStatus){if(this.status.textContent===this.automaticStatus)this.status.textContent="";this.automaticStatus="";}
    }
    private async submit(clear:boolean):Promise<void>{
        if(!this.room||!this.host||this.pending)return;
        const count=clear?0:Number(this.count.value),difficulty=Number(this.difficulty.value);
        if((!clear&&!this.count.value.trim())||!Number.isInteger(count)||count<0||count>Number(this.count.max)||!Number.isInteger(difficulty)||difficulty<0||difficulty>4){this.status.textContent=`人机数量须为 0–${this.count.max} 的整数。`;return;}
        this.pending=true;this.status.textContent="正在应用人机设置…";this.update(this.room,this.host);
        try{const room=await this.save({count,difficulty});this.dirty=false;this.update(room,this.host);this.status.textContent=room.botsError||(room.phase==="playing"?(count===0?"已请求清空人机，人数将自动刷新。":"已应用，人机人数将自动刷新。"):"人机设置已保存。");}
        catch(error){this.status.textContent=error instanceof Error?error.message:String(error);}
        finally{this.pending=false;if(this.room)this.update(this.room,this.host);}
    }
}
