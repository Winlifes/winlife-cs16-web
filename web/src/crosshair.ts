export interface CrosshairFrame {gap:number;length:number;thickness:number;r:number;g:number;b:number;alpha:number;}

/** CSS pixels keep the bars independent of canvas, viewport and HUD scaling. */
export function renderCrosshair(frame:CrosshairFrame|undefined):void {
    const element=document.getElementById("crosshair-hud")!;
    const valid=frame&&[frame.gap,frame.length,frame.thickness,frame.r,frame.g,frame.b,frame.alpha].every(Number.isFinite)&&
        frame.gap>=0&&frame.gap<=100&&frame.length>0&&frame.length<=30&&frame.thickness>0&&frame.thickness<=10;
    element.hidden=!valid;
    if(!valid)return;
    const values:Record<string,string>={"--crosshair-gap":`${frame.gap}px`,"--crosshair-length":`${frame.length}px`,"--crosshair-thickness":`${frame.thickness}px`,
        "--crosshair-color":`rgba(${frame.r},${frame.g},${frame.b},${Math.max(0,Math.min(1,frame.alpha))})`};
    for(const [name,value]of Object.entries(values))if(element.style.getPropertyValue(name)!==value)element.style.setProperty(name,value);
}
