import {afterEach,expect,it,vi} from "vitest";
import {PointerCapture} from "./pointer-capture";

function setup(){
    const doc=Object.assign(new EventTarget(),{pointerLockElement:null as unknown,exitPointerLock:vi.fn(()=>{
        doc.pointerLockElement=null;doc.dispatchEvent(new Event("pointerlockchange"));
    })});
    const native=vi.fn(async()=>{doc.pointerLockElement=canvas;doc.dispatchEvent(new Event("pointerlockchange"));});
    const canvas={requestPointerLock:native,focus:vi.fn()};
    const changed=vi.fn(),failed=vi.fn();
    const control=new PointerCapture(canvas as unknown as HTMLCanvasElement,changed,failed,doc as unknown as Document);
    return {doc,canvas,native,control,changed,failed};
}
afterEach(()=>vi.useRealTimers());
it("keeps engine requests out of the team menu and requires an explicit Start",async()=>{
    const s=setup();
    await s.canvas.requestPointerLock();
    expect(s.native).not.toHaveBeenCalled();expect(s.control.captured).toBe(false);
    expect(await s.control.enter()).toBe(true);
    expect(s.native).toHaveBeenCalledOnce();expect(s.changed).toHaveBeenLastCalledWith(true);
});
it("releases capture on Esc and does not let the engine recapture it",async()=>{
    const s=setup();await s.control.enter();
    s.doc.exitPointerLock();await s.canvas.requestPointerLock();
    expect(s.control.captured).toBe(false);expect(s.native).toHaveBeenCalledOnce();
    expect(s.changed).toHaveBeenLastCalledWith(false);
    expect(await s.control.enter()).toBe(true);
});
it("leaves a usable menu if the browser rejects capture",async()=>{
    const s=setup();s.native.mockRejectedValueOnce(new Error("denied"));
    expect(await s.control.enter()).toBe(false);expect(s.failed).toHaveBeenCalledOnce();expect(s.control.captured).toBe(false);
});
it("does not leave the Start button pending when capture never completes",async()=>{
    vi.useFakeTimers();const s=setup();s.native.mockImplementationOnce(async()=>{});
    const entered=s.control.enter();await vi.advanceTimersByTimeAsync(2000);
    expect(await entered).toBe(false);expect(s.failed).toHaveBeenCalledOnce();
});
