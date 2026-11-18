interface TeamState {team?:number;joined:boolean}
type PendingChoice={accept:(team:string)=>void;cancel:()=>void};
const playingTeam=(team:number|undefined):team is 1|2=>team===1||team===2;

/** TeamInfo is authoritative in both VGUI and classic text menu modes. */
export class TeamSelection {
    private pending?:PendingChoice;
    private lateClass?:string;
    private timedOut=false;
    constructor(private readonly command:(value:string)=>void,private readonly state:()=>TeamState=()=>({joined:false})){}
    reset():void {
        this.pending?.cancel();this.pending=undefined;this.lateClass=undefined;this.timedOut=false;
    }
    receiveLog(line:string):void {
        const match=/execing touch\/chooseteam_(tr|ct)\.cfg/.exec(line.replace(/\x1b\[[0-9;]*m/g,""));
        if(!match)return;
        const team=match[1]==="tr"?"1":"2";
        if(this.pending)this.pending.accept(team);
        else if(this.timedOut)this.lateClass=team;
    }
    async choose(team:string):Promise<string> {
        if(team==="6"){this.command("jointeam 6");return team;}
        const before=this.state();
        // A timed-out menu acknowledgement may have left the native server
        // waiting for joinclass. Re-sending jointeam is then rejected forever.
        const recovery=this.lateClass??(!before.joined&&playingTeam(before.team)?String(before.team):undefined);
        this.lateClass=undefined;this.timedOut=false;
        if(recovery){this.command("joinclass 1");return recovery;}
        let timer:ReturnType<typeof setTimeout>|undefined;
        let poll:ReturnType<typeof setInterval>|undefined;
        let pending:PendingChoice|undefined;
        try{
            return await new Promise<string>((resolve,reject)=>{
                let done=false;
                const accept=(selected:string)=>{
                    if(done||(team!=="5"&&selected!==team))return;
                    done=true;
                    try{this.command("joinclass 1");resolve(selected);}catch(error){reject(error);}
                };
                pending={accept,cancel:()=>{if(!done){done=true;reject(new Error("连接已变化，请重新选择队伍。"));}}};
                this.pending=pending;
                timer=setTimeout(()=>{if(!done){done=true;this.timedOut=true;reject(new Error("服务器尚未确认队伍，请稍后重试。"));}},12000);
                poll=setInterval(()=>{
                    const current=this.state();
                    if(playingTeam(current.team)&&(!before.joined||current.team!==before.team))accept(String(current.team));
                },100);
                this.command(`jointeam ${team}`);
            });
        } finally {clearTimeout(timer);clearInterval(poll);if(this.pending===pending)this.pending=undefined;}
    }
}
