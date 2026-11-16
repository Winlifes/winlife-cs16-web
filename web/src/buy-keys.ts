/** Use the same native aliases as mouse purchases, including their close signal. */
export function buyKeyAction(menu:string|undefined,key:string):string|undefined {
    if(!menu)return;
    if(key==="0"||key==="b")return "_erase_frame";
    if(menu==="buy"){
        const slot=/^[1-8]$/.test(key)?`slot${key}`:key==="a"?"autobuy":key==="r"?"rebuy":undefined;
        return slot?`+menu_${slot}; wait; -menu_${slot}`:undefined;
    }
    const category=menu.split("_")[1];
    const count=({pistol:5,shotgun:2,submachinegun:4,rifle:6,machinegun:1,item:menu.endsWith("_ct")?8:6} as Record<string,number>)[category];
    if(/^[1-8]$/.test(key)&&Number(key)<=count)return `_menu_select_slot${key}; wait; _menu_confirmed; wait; wait; _erase_frame`;
    if(key==="enter")return "_menu_confirmed; wait; wait; _erase_frame";
}
