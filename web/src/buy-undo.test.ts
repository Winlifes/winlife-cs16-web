import {expect,it} from "vitest";
import {parseBuyUndo,undoMessage} from "./buy-undo";
it("accepts only bounded native refund receipts, including the engine timestamp",()=>{
 expect(parseBuyUndo("[19:00:00] WINLIFE_BUY 1 ready 4790 8")).toEqual({code:"ready",amount:4790,count:8});
 expect(parseBuyUndo("WINLIFE_BUY 1 ok 350 1\n")).toEqual({code:"ok",amount:350,count:1});
 for(const value of ["Player: WINLIFE_BUY 1 ready 999 1","WINLIFE_BUY 2 ready 1 1","WINLIFE_BUY 1 ready -1 1","WINLIFE_BUY 1 ok 999999999999999999 1","WINLIFE_BUY 1 ready 500 999","WINLIFE_BUY 1 unknown 0 0"])expect(parseBuyUndo(value)).toBeUndefined();
});
it("explains the actual refund amount and the native eligibility failure",()=>{
 expect(undoMessage({code:"ok",amount:350,count:1})).toContain("$350");
 expect(undoMessage({code:"ready",amount:4800,count:8})).toContain("套装");
 expect(undoMessage({code:"blocked",amount:650,count:1})).toContain("购买区");
 expect(undoMessage({code:"changed",amount:650,count:1})).toContain("变化");
});
