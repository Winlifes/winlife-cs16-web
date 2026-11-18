import {afterEach,expect,it,vi} from "vitest";
import {GameUI} from "./game-ui";

afterEach(()=>vi.unstubAllGlobals());
function setup(panel:string,hasTeam=true,settled=false){
    vi.stubGlobal("document",{getElementById:()=>({open:false})});
    vi.stubGlobal("Element",class {});
    const ui=Object.assign(Object.create(GameUI.prototype),{
        active:true,panel,hasTeam,isSettled:settled,selecting:false,
        pause:vi.fn(),enter:vi.fn(),show:vi.fn(),command:vi.fn(),closeNative:vi.fn(),
    });
    const event={key:"Escape",target:null,preventDefault:vi.fn(),stopImmediatePropagation:vi.fn()};
    ui.keydown(event);return {ui,event};
}
it("closes settings and the pause menu on Escape after joining a team",()=>{
    for(const panel of ["pause","mouse","bots","tools","shop","damage","scores","team","native","ready"]){
        const {ui,event}=setup(panel);expect(ui.show).toHaveBeenCalledWith("unlocked");expect(ui.pause).not.toHaveBeenCalled();
        // Browsers reserve Escape to release pointer lock. Recapturing on the
        // same key would immediately reopen pause after keyup.
        expect(ui.enter).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
        if(panel==="team")expect(ui.command).toHaveBeenCalledWith("slot10");
    }
});
it("still opens the pause menu during combat and never escapes a required team choice or settlement",()=>{
    expect(setup("playing").ui.pause).toHaveBeenCalledOnce();
    expect(setup("unlocked").ui.pause).toHaveBeenCalledOnce();
    const initial=setup("bots",false);expect(initial.ui.enter).not.toHaveBeenCalled();expect(initial.ui.pause).toHaveBeenCalledOnce();
    const final=setup("result",true,true);expect(final.ui.enter).not.toHaveBeenCalled();expect(final.ui.show).toHaveBeenCalledWith("result");
});
