import {isPartyMode,partyRole} from "./party-mode";

export interface TeammateLabel {id:number;name:string;x:number;y:number;}
const names=new Map<number,HTMLElement>();
export function renderTeammates(labels:TeammateLabel[]):void {
    const container=document.getElementById("teammate-labels")!;
    const visible=new Set<number>();
    for(const label of labels){
        visible.add(label.id);
        let element=names.get(label.id);
        if(!element){element=document.createElement("span");container.append(element);names.set(label.id,element);}
        element.textContent=label.name;
        element.style.left=`${label.x}%`;element.style.top=`${label.y}%`;
    }
    for(const [id,element] of names)if(!visible.has(id)){element.remove();names.delete(id);}
}

export interface IndividualPlayer {id:number;name:string;kills:number;deaths:number;playing:boolean;}
export interface MatchView {id?:string;mode?:string;phase:string;half:number;round:number;scoreA:number;scoreB:number;swapped:boolean;halfRounds:number;target:number;endsAt?:number;winner?:string;players?:IndividualPlayer[];}
export function renderMatch(state:MatchView,team?:number,ownName?:string):void {
    const el=(id:string)=>document.getElementById(id)!;
    el("match-hud").hidden=false;
    el("match-hud").dataset.phase=state.phase;
    const deathmatch=state.mode==="deathmatch";
    el("match-a").textContent=deathmatch?"T · 击杀":`队伍 A · ${state.swapped?"CT":"T"}`;
    el("match-b").textContent=deathmatch?"击杀 · CT":`${state.swapped?"T":"CT"} · 队伍 B`;
    el("match-score-a").textContent=String(state.scoreA);el("match-score-b").textContent=String(state.scoreB);
    let status=state.phase==="warmup"?"等待双方玩家 · 热身不计分":`${state.half===1?"上":"下"}半场 · 第 ${state.round} 回合 · 先到 ${state.target} 分`;
    if(state.mode==="duel"&&state.phase==="live")status=`1v1 单挑 · 第 ${state.round} 局 · 先赢 ${state.target} 局`;
    const seconds=state.endsAt?Math.max(0,Math.ceil((state.endsAt-Date.now())/1000)):0;
    const clock=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
    if(deathmatch&&state.phase==="live")status=`团队死斗 · 先到 ${state.target} 击杀 · ${clock}`;
    if(state.mode==="freeforall"){
        const own=state.players?.find(player=>player.playing&&player.name===ownName);
        el("match-a").textContent="你的击杀";
        el("match-b").textContent="领先击杀";
        el("match-score-a").textContent=String(own?.kills??"—");
        el("match-score-b").textContent=String(state.players?.[0]?.kills??0);
        status=state.phase==="warmup"?"个人竞技 · 等待至少两名玩家":`个人竞技 · 先到 ${state.target} 击杀 · ${clock}`;
    }
    if(state.phase==="starting")status="对局即将开始";
    if(state.phase==="halftime")status=`半场结束 · 自动交换 T / CT · ${seconds} 秒后继续`;
    if(isPartyMode(state.mode)){
        el("match-a").textContent=partyRole(state.mode,state.swapped?2:1);
        el("match-b").textContent=partyRole(state.mode,state.swapped?1:2);
        status=partyStatus(state,team,seconds);
    }
    if(state.phase==="finished")status=`${matchResultTitle(state)} · 对局结束`;
    el("match-status").textContent=status;
}

function partyStatus(state:MatchView,team:number|undefined,seconds:number):string {
    if(state.phase==="warmup"||state.phase==="starting")return state.mode==="hide"?"等待躲藏者和追捕者入队":"等待至少两名玩家入队";
    if(state.phase==="between")return `${seconds} 秒后交换躲藏与追捕角色`;
    const role=partyRole(state.mode,team);
    if(state.phase==="preparing")return `${role} · ${state.mode==="hide"?"躲藏时间":"准备时间"} ${seconds} 秒`;
    return `${role} · 剩余 ${seconds} 秒${state.mode==="hide"?` · 第 ${state.round} / 2 局`:""}`;
}

export function matchResultTitle(state:MatchView):string {
    if(state.mode==="freeforall"){
        return state.winner==="draw"?"并列第一":`${state.players?.[0]?.name??"玩家"} 获胜`;
    }
    if(state.winner==="draw")return "双方平局";
    if(state.mode==="infection")return `${partyRole(state.mode,state.winner==="A"?1:2)}获胜`;
    if(state.mode==="deathmatch")return `${state.winner==="A"?"恐怖分子 T":"反恐精英 CT"} 获胜`;
    return `队伍 ${state.winner} 获胜`;
}
