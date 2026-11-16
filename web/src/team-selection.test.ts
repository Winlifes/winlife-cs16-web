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
    await vi.advanceTimersByTimeAsync(4000);await result;expect(command).toHaveBeenCalledOnce();
});
