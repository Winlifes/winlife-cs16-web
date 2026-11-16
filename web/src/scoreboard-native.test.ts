import {expect,it} from "vitest";
import {scoreboardWasm,glyphRows} from "./testing/scoreboard-wasm";

it("keeps all original native glyphs and appends damage on the actual sorted player rows",()=>{
 const baseline=scoreboardWasm(false).draw(),s=scoreboardWasm(),result=s.draw();
 expect(result.characters.slice(0,baseline.characters.length)).toEqual(baseline.characters);
 const original=glyphRows(baseline.characters),extra=glyphRows(result.characters.slice(baseline.characters.length));
 const alpha=Object.entries(original).find(([,line])=>line.includes("Alpha")),bravo=Object.entries(original).find(([,line])=>line.includes("Bravo"));
 expect(alpha).toBeDefined();expect(bravo).toBeDefined();
 expect(extra[Number(alpha![0])]).toBe("237");expect(extra[Number(bravo![0])]).toBe("54");
 expect(Object.values(extra)).toContain("DMG");
});
it("hides with the native scoreboard and displays missing data as unknown",()=>{
 const s=scoreboardWasm();expect(s.draw(false).characters).toEqual([]);
 s.damage.Alpha=undefined;expect(Object.values(glyphRows(s.draw().characters)).some(v=>v.includes("--"))).toBe(true);
});
it("keeps the original board intact when a narrow screen has no room for another column",()=>{
 const baseline=scoreboardWasm(false),s=scoreboardWasm();baseline.dimensions(240,360);s.dimensions(240,360);
 expect(s.draw()).toEqual(baseline.draw());
});
