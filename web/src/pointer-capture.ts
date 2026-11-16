/** The game engine may request capture, but only the player's Start click owns it. */
export class PointerCapture {
    private readonly nativeRequest: HTMLCanvasElement["requestPointerLock"];
    private pending?: (captured:boolean)=>void;
    private timeout?: ReturnType<typeof setTimeout>;
    private wasCaptured=false;
    constructor(
        private readonly canvas:HTMLCanvasElement,
        private readonly changed:(captured:boolean)=>void,
        private readonly failed:(message:string)=>void,
        private readonly doc:Document=document,
    ) {
        this.nativeRequest=canvas.requestPointerLock.bind(canvas);
        // SDL also schedules requests while a native menu opens. Those must not
        // steal the mouse from the page's team selection or an Esc menu.
        canvas.requestPointerLock=()=>Promise.resolve();
        doc.addEventListener("pointerlockchange",()=>this.sync());
        doc.addEventListener("pointerlockerror",()=>this.reject());
    }
    get captured(){return this.doc.pointerLockElement===this.canvas;}
    enter():Promise<boolean> {
        if(this.captured)return Promise.resolve(true);
        this.finish(false);
        return new Promise(resolve=>{
            this.pending=resolve;
            this.timeout=setTimeout(()=>this.reject(),2000);
            this.canvas.focus();
            try{Promise.resolve(this.nativeRequest()).then(()=>this.sync()).catch(error=>{console.warn("Mouse capture request failed",error);this.reject();});}
            catch(error){console.warn("Mouse capture request failed",error);this.reject();}
        });
    }
    release():void {
        this.finish(false);
        if(this.doc.pointerLockElement)this.doc.exitPointerLock();
    }
    private sync():void {
        if(this.captured){
            if(!this.pending&&!this.wasCaptured){this.doc.exitPointerLock();return;}
            this.finish(true);
            if(!this.wasCaptured){this.wasCaptured=true;this.changed(true);}
        } else if(this.wasCaptured){
            this.wasCaptured=false;
            this.finish(false);
            this.changed(false);
        }
    }
    private reject():void {
        if(!this.pending)return;
        this.finish(false);
        this.failed("鼠标尚未进入游戏，请再点击“进入战场”。");
    }
    private finish(captured:boolean):void {
        clearTimeout(this.timeout);
        this.timeout=undefined;
        const settle=this.pending;this.pending=undefined;settle?.(captured);
    }
}
