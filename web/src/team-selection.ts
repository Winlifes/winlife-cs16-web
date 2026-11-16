/** Wait for the server to open the class menu before sending joinclass. */
export class TeamSelection {
    private acknowledge?:()=>void;
    constructor(private readonly command:(value:string)=>void){}
    receiveLog(line:string):void {
        if(/execing touch\/chooseteam_(?:tr|ct)\.cfg/.test(line))this.acknowledge?.();
    }
    async choose(team:string):Promise<void> {
        if(team==="6"){this.command("jointeam 6");return;}
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{
            await new Promise<void>((resolve,reject)=>{
                this.acknowledge=resolve;
                timer=setTimeout(()=>reject(new Error("服务器尚未确认队伍，请重试或选择自动分配。")),4000);
                this.command(`jointeam ${team}`);
            });
            this.command("joinclass 1");
        } finally {clearTimeout(timer);this.acknowledge=undefined;}
    }
}
