import {BotControls,botDifficulties,type BotSettings} from "./bot-controls";
export interface RoomMember {id:string;nickname:string;joinedAt:string}
export interface Room {id:string;name:string;map:string;maxPlayers:number;phase:"waiting"|"starting"|"playing"|"failed";hostId:string;members:RoomMember[];error?:string;bots?:BotSettings;botCount?:number;botsError?:string}
export interface RoomSession {room:Room;memberId:string;token:string}
export const mapNames:Record<string,string>={de_dust2:"沙漠 II",cs_assault:"仓库突袭",cs_mansion:"豪宅",de_inferno:"炼狱",cs_italy:"意大利"};
export const roomPhase=(room:Room)=>({waiting:"等待开局",starting:"正在开局",playing:"对局中 · 可加入",failed:"等待重新开局"})[room.phase];
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const text=(tag:string,value:string,className="")=>{const node=document.createElement(tag);node.textContent=value;node.className=className;return node;};
export class Lobby {
    session?:RoomSession;
    private launched=false;
    private polling=false;
    private listSignature="";
    private readonly botControls:BotControls[];
    private readonly key=`winlife.cs16.room:${location.pathname}`;
    constructor(private readonly path:(name:string)=>string,private readonly nickname:HTMLInputElement,private readonly launch:(session:RoomSession)=>Promise<void>){
        this.botControls=["room-bots","game-bots"].map(id=>new BotControls(el(id),settings=>this.setBots(settings)));
        el("create-room").onclick=()=>{if(!this.name())return;el<HTMLInputElement>("room-name").value=`${this.name()}的房间`;el<HTMLDialogElement>("create-dialog").showModal();};
        el("create-cancel").onclick=()=>el<HTMLDialogElement>("create-dialog").close();
        el("create-form").onsubmit=event=>{event.preventDefault();void this.action(async()=>{
            const joined=await this.api<RoomSession>("rooms","POST",{name:el<HTMLInputElement>("room-name").value,nickname:this.name(),map:el<HTMLSelectElement>("create-map").value,maxPlayers:Number(el<HTMLSelectElement>("create-capacity").value)});
            el<HTMLDialogElement>("create-dialog").close();this.accept(joined);
        },"create-error");};
        el("refresh-rooms").onclick=()=>void this.refresh();
        el("leave-room").onclick=()=>void this.action(()=>this.leave());
        el("start-room").onclick=()=>void this.action(async()=>{if(!this.session)return;await this.api(`rooms/${this.session.room.id}/start`,"POST",{});await this.refresh();});
        el("invite-room").onclick=()=>void this.action(async()=>{await navigator.clipboard.writeText(location.href);el("invite-room").textContent="已复制房间链接";setTimeout(()=>el("invite-room").textContent="复制房间链接",2500);});
        nickname.addEventListener("change",()=>{if(this.name())localStorage.setItem("winlife.cs16.nickname",this.name());});
        try{const saved=sessionStorage.getItem(this.key);if(saved)this.session=JSON.parse(saved);}catch{sessionStorage.removeItem(this.key);}
        void this.refresh();setInterval(()=>void this.refresh(),2000);
    }
    private name():string {const value=this.nickname.value.trim().replace(/[";\\\r\n]/g,"").slice(0,24);if(!value){this.nickname.focus();el("lobby-error").textContent="请先输入玩家昵称。";}return value;}
    private async api<T>(route:string,method="GET",data?:unknown):Promise<T>{
        const response=await fetch(this.path(route),{method,cache:"no-store",headers:{"Content-Type":"application/json",...(this.session?{"X-CS16-Session":this.session.token}:{})},body:data===undefined?undefined:JSON.stringify(data)});
        const result=await response.json();if(!response.ok)throw new Error(result.error||`操作失败 (${response.status})`);return result;
    }
    private async action(fn:()=>Promise<void>,errorId="lobby-error"):Promise<void>{
        el(errorId).textContent="";const buttons=[...document.querySelectorAll<HTMLButtonElement>("#welcome button,#create-dialog button")];for(const button of buttons)button.disabled=true;
        try{await fn();}catch(error){el(errorId).textContent=error instanceof Error?error.message:String(error);}finally{for(const button of buttons)button.disabled=false;if(this.session)this.renderRoom(this.session.room);}
    }
    private accept(session:RoomSession):void {
        this.session=session;sessionStorage.setItem(this.key,JSON.stringify(session));localStorage.setItem("winlife.cs16.nickname",this.name());
        const url=new URL(location.href);url.searchParams.set("room",session.room.id);history.replaceState(null,"",url);this.renderRoom(session.room);
        if(session.room.phase==="playing")void this.enter();
    }
    private async setBots(settings:BotSettings):Promise<Room>{
        if(!this.session)throw new Error("请先加入房间");
        const room=await this.api<Room>(`rooms/${this.session.room.id}/bots`,"POST",settings);
        this.session.room=room;this.renderRoom(room);return room;
    }
    private clear():void {this.session=undefined;sessionStorage.removeItem(this.key);const url=new URL(location.href);url.searchParams.delete("room");history.replaceState(null,"",url);this.nickname.disabled=false;el("room-browser").hidden=false;el("room-view").hidden=true;}
    async leave():Promise<void>{
        if(this.session)await this.api(`rooms/${this.session.room.id}/leave`,"POST",{});
        this.clear();if(this.launched)location.reload();else await this.refresh();
    }
    async rematch():Promise<void>{
        if(!this.session)throw new Error("请先加入房间");
        await this.api(`rooms/${this.session.room.id}/rematch`,"POST");
    }
    private async enter():Promise<void>{if(this.launched||!this.session)return;this.launched=true;await this.launch(this.session);}
    private async refresh():Promise<void>{
        if(this.polling)return;this.polling=true;
        try{
            if(this.session){
                const response=await fetch(this.path(`rooms/${this.session.room.id}`),{cache:"no-store",headers:{"X-CS16-Session":this.session.token}});
                if(response.status===404){this.clear();if(this.launched)location.reload();return;}
                if(!response.ok)throw new Error("房间状态暂时无法更新");
                const room=await response.json() as Room;
                if(!room.members.some(member=>member.id===this.session!.memberId)){this.clear();if(this.launched)location.reload();return;}
                this.session.room=room;this.renderRoom(room);if(room.phase==="playing")void this.enter();
            }else{
                const result=await this.api<{rooms:Room[];maxRooms:number}>("rooms");this.renderList(result.rooms,result.maxRooms);
            }
        }catch(error){if(!this.launched)el("lobby-error").textContent=error instanceof Error?error.message:String(error);}
        finally{this.polling=false;}
    }
    private renderList(rooms:Room[],maxRooms:number):void{
        el("room-browser").hidden=false;el("room-view").hidden=true;this.nickname.disabled=false;
        el("server-status").textContent=`${rooms.length} 个房间 · ${rooms.reduce((n,r)=>n+r.members.length,0)} 位玩家在线`;
        const invite=new URL(location.href).searchParams.get("room");
        const signature=JSON.stringify({rooms,maxRooms,invite});if(signature===this.listSignature)return;this.listSignature=signature;
        const list=el("rooms-list");list.replaceChildren();
        if(!rooms.length){const empty=text("div","","rooms-empty");empty.append(text("strong","还没有房间"),text("p","创建一个房间，叫上朋友一起开局。"));list.append(empty);}
        for(const room of rooms){
            const row=text("article","","room-row");row.dataset.phase=room.phase;
            const info=text("div","","room-info");info.append(text("strong",room.name),text("small",`${mapNames[room.map]||room.map} · ${room.members.find(p=>p.id===room.hostId)?.nickname||"玩家"} 的房间`));
            const bots=room.phase==="playing"?room.botCount??0:room.bots?.count??0;
            const phase=text("span",roomPhase(room),"room-phase");const count=text("span",`${room.members.length+bots} / ${room.maxPlayers}`,"room-count");
            if(bots)count.append(text("small",`${room.members.length} 真人 · ${bots} 人机`));
            const join=text("button",room.members.length>=room.maxPlayers?"已满":room.id===invite?"加入邀请房间":"加入房间") as HTMLButtonElement;
            join.type="button";join.disabled=room.members.length>=room.maxPlayers;join.onclick=()=>{if(!this.name())return;void this.action(async()=>this.accept(await this.api<RoomSession>(`rooms/${room.id}/join`,"POST",{nickname:this.name()})));};
            row.append(info,phase,count,join);list.append(row);
        }
        el<HTMLButtonElement>("create-room").disabled=rooms.length>=maxRooms;
    }
    private renderRoom(room:Room):void{
        const own=room.members.find(member=>member.id===this.session?.memberId);if(own)this.nickname.value=own.nickname;
        this.nickname.disabled=true;el("room-browser").hidden=true;el("room-view").hidden=false;
        el("server-status").textContent=`${room.name} · ${roomPhase(room)}`;
        el("room-title").textContent=room.name;el("room-map").textContent=`${mapNames[room.map]||room.map} · ${room.map} · ${room.members.length} / ${room.maxPlayers} 人`;
        el("room-phase").textContent=roomPhase(room);
        const members=el("room-members");members.replaceChildren();
        for(const member of room.members){const row=text("li","","room-member");row.append(text("span",member.nickname),text("small",member.id===room.hostId?"房主":member.id===this.session?.memberId?"你":"玩家"));members.append(row);}
        if(room.bots?.count){const row=text("li","","room-member room-bot-member");row.append(text("span",`人机 × ${room.bots.count}`),text("small",`${botDifficulties[room.bots.difficulty]} · 自动分配阵营`));members.append(row);}
        const host=room.hostId===this.session?.memberId;
        for(const controls of this.botControls)controls.update(room,host);
        const button=el<HTMLButtonElement>("start-room");button.hidden=!host||room.phase==="playing";button.disabled=room.phase==="starting";button.textContent=room.phase==="starting"?"正在准备服务端…":room.phase==="failed"?"重新开局":"开始对局";
        el("room-note").textContent=room.error||(room.phase==="playing"?"对局已开始，正在进入战场。其他玩家仍可中途加入。":room.phase==="starting"?"正在准备地图，房间里的玩家将自动进入游戏。":host?"朋友加入后点击开始；也可以先开局，让朋友中途加入。":"等待房主开始对局，开始后会自动进入游戏。");
    }
}
