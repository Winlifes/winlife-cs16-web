import {expect,it} from "vitest";
import {botTeamSummary,readBotSettings} from "./bot-controls";

it("saves independent sides, including a zero-bot side, within the shared room capacity",()=>{
 expect(readBotSettings(true,"99","0","3","4",3)).toEqual({count:3,difficulty:4,split:true,t:0,ct:3});
 expect(botTeamSummary({count:3,difficulty:4,split:true,t:0,ct:3})).toBe("T 0 个 / CT 3 个");
 for(const [t,ct] of [["1","3"],["-1","2"],["1.5","1"],["","1"],["NaN","0"]])expect(()=>readBotSettings(true,"0",t,ct,"2",3)).toThrow();
});
it("keeps automatic assignment compatible and clears both sides as one operation",()=>{
 expect(readBotSettings(false,"3","","","2",3)).toEqual({count:3,difficulty:2,split:false,t:0,ct:0});
 expect(readBotSettings(true,"99","99","99","1",2,true)).toEqual({count:0,difficulty:1,split:true,t:0,ct:0});
 expect(()=>readBotSettings(false,"","0","0","2",3)).toThrow();
 expect(()=>readBotSettings(true,"0","1","1","5",3)).toThrow();
});
