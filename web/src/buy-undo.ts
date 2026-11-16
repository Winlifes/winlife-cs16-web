export type BuyUndoCode="ready"|"ok"|"empty"|"used"|"blocked"|"changed"|"busy";
export interface BuyUndoStatus {code:BuyUndoCode;amount:number;count:number}
export function parseBuyUndo(line:string):BuyUndoStatus|undefined {
 const match=/^(?:\[\d{2}:\d{2}:\d{2}\]\s*)?WINLIFE_BUY 1 (ready|ok|empty|used|blocked|changed|busy) (\d+) (\d+)\s*$/.exec(line.trim());
 if(!match)return;
 const amount=Number(match[2]),count=Number(match[3]);
 if(!Number.isSafeInteger(amount)||amount>100000||!Number.isSafeInteger(count)||count>128)return;
 return {code:match[1] as BuyUndoCode,amount,count};
}
export const undoMessage=(status:BuyUndoStatus):string=>({
 ready:`可撤回上次购买 · 退款 $${status.amount}${status.count>1?" · 包含本次套装／补给":""}`,
 ok:`已撤回上次购买 · 退回 $${status.amount}`,
 empty:"没有可撤回的购买。",
 used:"已使用、丢弃、换队或跨回合，无法撤回此前购买。",
 blocked:"只能在购买区、购买时间内且存活时撤回。",
 changed:"装备、弹药、生命或资金已发生变化，无法撤回此次购买。",
 busy:"正在处理本次购买…",
})[status.code];
