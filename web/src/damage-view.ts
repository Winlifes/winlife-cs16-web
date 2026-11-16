import type {DamageCounts,DamageReport,DamageTarget} from "./damage-report";

const names:Record<string,string>={ak47:"AK-47",m4a1:"M4A1",awp:"AWP",deagle:"沙漠之鹰",usp:"USP",glock18:"Glock 18",grenade:"高爆手雷",hegrenade:"高爆手雷",knife:"匕首",mp5navy:"MP5",galil:"加利尔",famas:"FAMAS",aug:"AUG",sg552:"SG552",scout:"Scout",sg550:"SG550",g3sg1:"G3SG1",m249:"M249",m3:"M3",xm1014:"XM1014",mac10:"MAC-10",tmp:"TMP",ump45:"UMP45",p90:"P90",p228:"P228",elites:"双持贝瑞塔",fiveseven:"Five-seveN",c4:"C4 炸弹"};
export const weaponName=(name:string):string=>names[name]??name;
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
function node(tag:string,text:string,className?:string):HTMLElement {
    const element=document.createElement(tag);element.textContent=text;if(className)element.className=className;return element;
}
const summary=(c:DamageCounts)=>`${c.damage} 伤害 · ${c.shots??c.hits} 枪/次`;
const parts=["全身 / 爆炸","头部","胸部","腹部","左臂","右臂","左腿","右腿"];
function detail(title:string,targets:DamageTarget[],total:DamageCounts):HTMLElement {
 const section=node("section","","damage-direction");section.append(node("h3",`${title} · ${summary(total)}`));
 if(!targets.length){section.append(node("p","本回合暂无记录。","panel-note"));return section;}
 for(const target of targets){
  const card=node("section","","damage-target-detail"),heading=node("h4","");heading.append(node("span",target.name),node("small",summary(target)));card.append(heading);
  const table=document.createElement("table"),head=document.createElement("thead"),header=document.createElement("tr");
  for(const label of ["武器","命中部位","枪 / 次","伤害","护甲"])header.append(node("th",label));head.append(header);table.append(head);
  const body=document.createElement("tbody");
  for(const weapon of target.weapons){
   for(const part of weapon.parts?.length?weapon.parts:[{...weapon,group:0}]){
    const row=document.createElement("tr");
    const shots=`${part.shots??part.hits}${weapon.name==="m3"||weapon.name==="xm1014"?`（${part.hits} 弹丸）`:""}`;
    for(const value of [weaponName(weapon.name),parts[part.group]??"未知",shots,part.damage,part.armor])row.append(node("td",String(value)));body.append(row);
   }
  }
  table.append(body);card.append(table);section.append(card);
 }
 return section;
}
export function createDamageRenderer():(report:DamageReport|undefined,review?:DamageReport)=>void {
 return (report,review)=>{
  const shown=report??review,received=shown?.received??{damage:0,armor:0,hits:0,shots:0};
  el("damage-hud").hidden=!report;
  el<HTMLButtonElement>("damage-toggle").disabled=!shown;
  el("damage-toggle").textContent=shown?`伤害统计 · ${report?"本回合":"上回合"}`:"伤害统计 · 回合结束或死亡后查看";
  el("damage-content").replaceChildren();
  if(!shown){el("damage-summary").textContent="死亡或小局结束后显示造成和受到的伤害，可在下一回合回看。";return;}
  el("damage-summary").textContent=`${report?"本回合":"上回合"} · 造成 ${summary(shown.totals)} · 受到 ${summary(received)}`;
  el("damage-content").append(detail("造成伤害",shown.targets??[],shown.totals),detail("受到伤害",shown.attackers??[],received));
  if(!report)return;
  el("damage-hud-title").textContent=report.roundEnded?"小局结束 · 伤害简报":"本回合 · 伤害简报";
  el("damage-hud-total").textContent=`造成 ${report.totals.damage} / 受到 ${received.damage}`;
  const weapons=el("damage-hud-weapons");weapons.replaceChildren();
  for(const target of (report.targets??[]).slice(0,2)){
   const row=node("div","","damage-target-row");row.append(node("span",`→ ${target.name}`),node("b",`${target.damage} · ${target.shots??target.hits}枪/次`));weapons.append(row);
  }
  const attackers=el("damage-hud-targets");attackers.replaceChildren();
  for(const target of (report.attackers??[]).slice(0,2)){
   const row=node("div","","damage-target-row");row.append(node("span",`← ${target.name}`),node("b",`${target.damage} · ${target.shots??target.hits}枪/次`));attackers.append(row);
  }
 };
}
