import {afterEach,expect,it,vi} from "vitest";
import {GameUI} from "./game-ui";

afterEach(()=>vi.unstubAllGlobals());
function setup(panel:string,hasTeam=true,settled=false,repeat=false,keyboard:Partial<KeyboardEvent>={}){
    vi.stubGlobal("document",{getElementById:()=>({open:false})});
    vi.stubGlobal("Element",class {});
    const ui=Object.assign(Object.create(GameUI.prototype),{
        active:true,panel,hasTeam,isSettled:settled,selecting:false,
        pause:vi.fn(),enter:vi.fn(),show:vi.fn(),command:vi.fn(),closeNative:vi.fn(),
    });
    const event={key:"Escape",repeat,target:null,preventDefault:vi.fn(),stopImmediatePropagation:vi.fn(),...keyboard};
    ui.keydown(event);return {ui,event};
}
it("closes settings and the pause menu on Escape after joining a team",()=>{
    for(const panel of ["pause","mouse","bots","tools","shop","props","damage","scores","team","native","ready"]){
        const {ui,event}=setup(panel);expect(ui.show).toHaveBeenCalledWith("unlocked");expect(ui.pause).not.toHaveBeenCalled();
        // Browsers reserve Escape to release pointer lock. Recapturing on the
        // same key would immediately reopen pause after keyup.
        expect(ui.enter).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
        if(panel==="team")expect(ui.command).toHaveBeenCalledWith("slot10");
    }
});
it("does not reopen pause when Escape repeats after closing the shop",()=>{
    for(const panel of ["shop","native","unlocked","pause","playing"]){
        const {ui,event}=setup(panel,true,false,true);
        expect(ui.pause).not.toHaveBeenCalled();expect(ui.show).not.toHaveBeenCalled();expect(ui.closeNative).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();expect(event.stopImmediatePropagation).toHaveBeenCalled();
    }
});
it("clears the native purchase layer and invalidates delayed close callbacks without opening settings",()=>{
    for(const panel of ["shop","native"]){
        const {ui,event}=setup(panel);
        ui.pause.mockClear();ui.show.mockClear();ui.command.mockClear();ui.closeNative=GameUI.prototype["closeNative"];
        ui.panel=panel;ui.nativeGeneration=4;ui.buyMenu="buy_rifle_t";
        ui.keydown(event);
        expect(ui.nativeGeneration).toBe(5);expect(ui.buyMenu).toBeUndefined();
        expect(ui.command).toHaveBeenCalledWith("client_buy_close");
        expect(ui.command).toHaveBeenCalledWith("touch_removebutton _menu_*");
        expect(ui.show).toHaveBeenLastCalledWith("unlocked");expect(ui.pause).not.toHaveBeenCalled();
    }
});
it("still opens the pause menu during combat and never escapes a required team choice or settlement",()=>{
    expect(setup("playing").ui.pause).toHaveBeenCalledOnce();
    expect(setup("unlocked").ui.pause).toHaveBeenCalledOnce();
    const initial=setup("bots",false);expect(initial.ui.enter).not.toHaveBeenCalled();expect(initial.ui.pause).toHaveBeenCalledOnce();
    const final=setup("result",true,true);expect(final.ui.enter).not.toHaveBeenCalled();expect(final.ui.show).toHaveBeenCalledWith("result");
});
it("protects the browser from Ctrl+W while keeping the native crouch-movement key",()=>{
    for(const keyboard of [{key:"w",ctrlKey:true},{key:"W",ctrlKey:true,shiftKey:true}]){
        const game=setup("playing",true,false,false,keyboard);
        expect(game.event.preventDefault).toHaveBeenCalledOnce();
        expect(game.event.stopImmediatePropagation).not.toHaveBeenCalled();
    }
    const ordinary=setup("playing",true,false,false,{key:"w"});
    expect(ordinary.event.preventDefault).not.toHaveBeenCalled();
    const lobby=setup("result",true,true,false,{key:"w",ctrlKey:true});
    expect(lobby.event.preventDefault).not.toHaveBeenCalled();
});
it("consumes close and refresh shortcuts in a match and keeps ordinary menu keys available",()=>{
    for(const keyboard of [{key:"w",metaKey:true},{key:"W",ctrlKey:true,shiftKey:true},{key:"F4",ctrlKey:true},{key:"F5"},{key:"r",ctrlKey:true}]){
        const {event}=setup("pause",true,false,false,keyboard);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    }
    const {event}=setup("native",true,false,false,{key:"F4"});
    expect(event.preventDefault).not.toHaveBeenCalled();
});
