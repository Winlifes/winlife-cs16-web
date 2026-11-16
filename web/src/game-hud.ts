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

export interface MatchView {id?:string;phase:string;half:number;round:number;scoreA:number;scoreB:number;swapped:boolean;halfRounds:number;target:number;endsAt?:number;winner?:string;}
export function renderMatch(state:MatchView):void {
    const el=(id:string)=>document.getElementById(id)!;
    el("match-hud").hidden=false;
    el("match-hud").dataset.phase=state.phase;
    el("match-a").textContent=`队伍 A · ${state.swapped?"CT":"T"}`;
    el("match-b").textContent=`${state.swapped?"T":"CT"} · 队伍 B`;
    el("match-score-a").textContent=String(state.scoreA);el("match-score-b").textContent=String(state.scoreB);
    let status=state.phase==="warmup"?"等待双方玩家 · 热身不计分":`${state.half===1?"上":"下"}半场 · 第 ${state.round} 回合 · 先到 ${state.target} 分`;
    const seconds=state.endsAt?Math.max(0,Math.ceil((state.endsAt-Date.now())/1000)):0;
    if(state.phase==="halftime")status=`半场结束 · 自动交换 T / CT · ${seconds} 秒后继续`;
    if(state.phase==="finished")status=`${state.winner==="draw"?"双方平局":`队伍 ${state.winner} 获胜`} · 对局结束`;
    el("match-status").textContent=status;
}
