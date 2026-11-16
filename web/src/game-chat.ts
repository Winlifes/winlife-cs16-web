export interface NativeChat {id:number;format:string;args:string[];playerName:string;team:number;alive:boolean;}
export interface ChatLine {name:string;message:string;prefix:string;team:number;}
const clean=(s:string)=>s.replace(/\x1b\[[0-9;]*m/g,"").replace(/[\x00-\x1f\x7f]/g,"").slice(0,512);

/** undefined: preserve native formatting; null: preserve native dead-chat filtering. */
export function formatChat(packet:NativeChat):ChatLine|null|undefined {
    const {format,args}=packet;
    if(format==="#Cstrike_Name_Change"&&args.length>=2)return {name:"",message:`${clean(args[0])} 将昵称改为 ${clean(args[1])}`,prefix:"系统",team:0};
    const match=/^#Cstrike_Chat_(All|AllDead|AllSpec|T|CT|T_Dead|CT_Dead|Spec|T_Loc|CT_Loc)$/.exec(format);
    if(!match||args.length<2)return;
    const kind=match[1],dead=kind.includes("Dead"),spectator=kind.includes("Spec");
    if((dead||spectator)&&packet.alive)return null;
    const prefix=[dead?"阵亡":"",spectator?"旁观":"",kind.startsWith("CT")?"反恐队内":/^T(?:_|$)/.test(kind)?"匪队队内":""].filter(Boolean).join(" · ");
    const location=kind.endsWith("_Loc")&&args[2]?` @ ${clean(args[2])}`:"";
    return {name:clean(args[0]||packet.playerName)+location,message:clean(args[1]),prefix,team:packet.team};
}

export function createChatRenderer():(packet:NativeChat)=>boolean {
    const entries:{element:HTMLElement;expires:number}[]=[];
    let timer:ReturnType<typeof setTimeout>|undefined;
    const root=document.getElementById("game-chat")!;
    const expire=()=>{
        clearTimeout(timer);
        while(entries.length&&(entries[0].expires<=Date.now()||entries.length>5))entries.shift()!.element.remove();
        root.hidden=!entries.length;
        if(entries.length)timer=setTimeout(expire,Math.max(1,entries[0].expires-Date.now()));
    };
    return packet=>{
        const line=formatChat(packet);if(line===undefined)return false;if(line===null)return true;
        const row=document.createElement("div"),prefix=document.createElement("span"),name=document.createElement("b"),message=document.createElement("span");
        row.className="chat-line";prefix.className="chat-prefix";name.className="chat-name";name.dataset.team=String(line.team);
        prefix.textContent=line.prefix?`[${line.prefix}] `:"";name.textContent=line.name?`${line.name}：`:"";message.textContent=line.message;
        row.append(prefix,name,message);root.append(row);entries.push({element:row,expires:Date.now()+6500});expire();return true;
    };
}
