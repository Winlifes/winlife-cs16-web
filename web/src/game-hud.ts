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

export interface MatchView {id?:string;mode?:string;phase:string;half:number;round:number;scoreA:number;scoreB:number;swapped:boolean;halfRounds:number;target:number;endsAt?:number;winner?:string;}
export function renderMatch(state:MatchView):void {
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
    if(deathmatch&&state.phase==="live")status=`团队死斗 · 先到 ${state.target} 击杀 · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
    if(state.phase==="starting")status="对局即将开始";
    if(state.phase==="halftime")status=`半场结束 · 自动交换 T / CT · ${seconds} 秒后继续`;
    if(state.phase==="finished")status=`${matchResultTitle(state)} · 对局结束`;
    el("match-status").textContent=status;
}

export function matchResultTitle(state:MatchView):string {
    if(state.winner==="draw")return "双方平局";
    if(state.mode==="deathmatch")return `${state.winner==="A"?"恐怖分子 T":"反恐精英 CT"} 获胜`;
    return `队伍 ${state.winner} 获胜`;
}
