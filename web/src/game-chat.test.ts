import {expect,it} from "vitest";
import {formatChat,type NativeChat} from "./game-chat";
const packet=(format="#Cstrike_Chat_All",args=["Bot","大家好，准备好了吗？"]):NativeChat=>({id:2,format,args,playerName:"Bot",team:1,alive:true});
it("preserves Chinese, missing native nicknames, player color and literal markup",()=>{
    expect(formatChat(packet())).toEqual({name:"Bot",message:"大家好，准备好了吗？",prefix:"",team:1});
    expect(formatChat(packet("#Cstrike_Chat_All",["","<img onerror=bad>你好"]))).toMatchObject({name:"Bot",message:"<img onerror=bad>你好"});
});
it("keeps dead and spectator chat hidden from living players",()=>{
    for(const format of ["#Cstrike_Chat_AllDead","#Cstrike_Chat_AllSpec","#Cstrike_Chat_CT_Dead","#Cstrike_Chat_Spec"]){
        expect(formatChat(packet(format))).toBeNull();
        expect(formatChat({...packet(format),alive:false})).toBeDefined();
    }
    expect(formatChat(packet("#Cstrike_Chat_CT_Loc",["队友","掩护我","A 点"]))).toMatchObject({prefix:"反恐队内",name:"队友 @ A 点"});
});
it("leaves other native messages alone and removes native color controls",()=>{
    expect(formatChat(packet("#Spec_PlayerItem",["AK-47"])) ).toBeUndefined();
    expect(formatChat(packet("#Cstrike_Chat_All",["Only one field"])) ).toBeUndefined();
    expect(formatChat(packet("#Cstrike_Chat_All",["\x03Bot","\x04稳住"]))).toMatchObject({name:"Bot",message:"稳住"});
});
