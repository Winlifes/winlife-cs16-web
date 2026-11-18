import {afterEach,expect,it,vi} from "vitest";
import {TeamSelection} from "./team-selection";
afterEach(()=>vi.useRealTimers());
it("does not send joinclass early on a slow connection",async()=>{
    vi.useFakeTimers();const command=vi.fn();const selection=new TeamSelection(command);
    const chosen=selection.choose("2");await vi.advanceTimersByTimeAsync(1200);
    expect(command.mock.calls).toEqual([["jointeam 2"]]);
    selection.receiveLog("[12:00:01] execing touch/chooseteam_ct.cfg");await chosen;
    expect(command.mock.calls).toEqual([["jointeam 2"],["joinclass 1"]]);
});
it("reports a refused or unacknowledged team instead of pretending it joined",async()=>{
    vi.useFakeTimers();const command=vi.fn();const selection=new TeamSelection(command);
    const result=expect(selection.choose("1")).rejects.toThrow("服务器尚未确认队伍");
    await vi.advanceTimersByTimeAsync(12000);await result;expect(command).toHaveBeenCalledOnce();
});
it("completes classic text menus from the server's TeamInfo without a touch-menu log",async()=>{
    vi.useFakeTimers();let team=0;const command=vi.fn();
    const selection=new TeamSelection(command,()=>({team,joined:false}));
    const chosen=selection.choose("1");await vi.advanceTimersByTimeAsync(4500);
    expect(command.mock.calls).toEqual([["jointeam 1"]]);
    team=1;await vi.advanceTimersByTimeAsync(100);
    await expect(chosen).resolves.toBe("1");
    expect(command.mock.calls).toEqual([["jointeam 1"],["joinclass 1"]]);
});
it("recovers a previously accepted selection instead of sending jointeam into a pending class menu",async()=>{
    const command=vi.fn();const selection=new TeamSelection(command,()=>({team:2,joined:false}));
    await expect(selection.choose("5")).resolves.toBe("2");
    expect(command.mock.calls).toEqual([["joinclass 1"]]);
});
it("completes automatic assignment using whichever side the server selected",async()=>{
    vi.useFakeTimers();let team=3;const command=vi.fn();
    const selection=new TeamSelection(command,()=>({team,joined:false}));
    const chosen=selection.choose("5");team=2;await vi.advanceTimersByTimeAsync(100);
    await expect(chosen).resolves.toBe("2");expect(command.mock.calls).toEqual([["jointeam 5"],["joinclass 1"]]);
});
it("does not treat the old team or a delayed wrong-side menu as a successful change",async()=>{
    vi.useFakeTimers();let team=1;const command=vi.fn();
    const selection=new TeamSelection(command,()=>({team,joined:true}));
    const chosen=selection.choose("2");
    selection.receiveLog("execing touch/chooseteam_tr.cfg");await vi.advanceTimersByTimeAsync(500);
    expect(command.mock.calls).toEqual([["jointeam 2"]]);
    team=2;await vi.advanceTimersByTimeAsync(100);await expect(chosen).resolves.toBe("2");
});
it("keeps a late class acknowledgement usable and cancels stale requests when the connection changes",async()=>{
    vi.useFakeTimers();const command=vi.fn();const selection=new TeamSelection(command);
    const timedOut=expect(selection.choose("1")).rejects.toThrow("服务器尚未确认队伍");
    await vi.advanceTimersByTimeAsync(12000);await timedOut;
    selection.receiveLog("execing \x1b[1;32mtouch/chooseteam_tr.cfg\x1b[0m");
    await expect(selection.choose("5")).resolves.toBe("1");
    const stale=expect(selection.choose("2")).rejects.toThrow("连接已变化");
    selection.reset();await stale;selection.receiveLog("execing touch/chooseteam_ct.cfg");
    await vi.advanceTimersByTimeAsync(13000);
    expect(command.mock.calls).toEqual([["jointeam 1"],["joinclass 1"],["jointeam 2"]]);
});
