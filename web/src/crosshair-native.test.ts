import {expect,it} from "vitest";
import {crosshairWasm} from "./testing/crosshair-wasm";

it("fixes actual WASM auto at width 640 and keeps one CSS-pixel bar thickness across HUD scales",()=>{
    const s=crosshairWasm();
    const saved=s.HEAPU32[(s.size+4)>>>2];
    for(const [width,height]of [[1280,720],[1024,576],[853,480],[640,360]]){
        s.dimensions(width,height);s.HEAP32[(s.ammo+60)>>>2]=-1;
        const frame=s.draw();expect(frame).toMatchObject({length:5,thickness:1,gap:4,r:50,g:250,b:50});
        expect(s.HEAP32[(s.ammo+60)>>>2]).toBe(640);
        expect(s.HEAPU32[(s.size+4)>>>2]).toBe(saved);
    }
    expect(s.nativeRects).toHaveLength(0); // no second native crosshair below the overlay
    s.fillOtherHUD();expect(s.nativeRects).toEqual([[10,20,50,2,255,255,255,255]]);
});
it("retains native shooting expansion, recovery, color and explicit small sizing",()=>{
    const s=crosshairWasm();const resting=s.draw()!;
    s.HEAP32[s.globals.g_iShotsFired.value>>>2]=1;
    const fired=s.draw(1.01)!;expect(fired.gap).toBeGreaterThan(resting.gap);expect(fired.alpha).toBeLessThan(resting.alpha);
    let recovered=fired;for(let i=0;i<100;i++)recovered=s.draw(1.02+i*.01)!;
    expect(recovered.gap).toBeCloseTo(resting.gap);expect(recovered.alpha).toBe(1);
    s.HEAPU32[(s.size+4)>>>2]=s.text("small");
    expect(s.draw()).toMatchObject({length:3.125,thickness:1,gap:2.5});
});
it("lets the native HUD hide sniper/zoom/shield/intermission crosshairs",()=>{
    const s=crosshairWasm();expect(s.draw()).toBeDefined();
    s.HEAP32[(s.weapon+156)>>>2]=18;expect(s.draw()).toBeUndefined(); // AWP unscoped
    s.HEAP32[(s.weapon+156)>>>2]=28;s.HEAP32[(s.hud+52)>>>2]=40;expect(s.draw()).toBeUndefined();
    s.HEAP32[(s.hud+52)>>>2]=90;s.HEAP32[s.globals.g_iWeaponFlags.value>>>2]=32;expect(s.draw()).toBeUndefined();
    s.HEAP32[s.globals.g_iWeaponFlags.value>>>2]=0;expect(s.draw(2,1)).toBeUndefined();
});
it("reproduces the pre-fix native bug, making the regression independent of the wrapper",()=>{
    const s=crosshairWasm(false);s.dimensions(640,360);s.HEAP32[(s.ammo+60)>>>2]=-1;s.draw();
    expect(s.HEAP32[(s.ammo+60)>>>2]).toBe(-1);expect(s.nativeRects.some(r=>r[2]<0||r[3]<0)).toBe(true);
});
