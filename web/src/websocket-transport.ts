import {WebSocketClient, type Logger} from "./core";
import type {GameTransport} from "./transport";

/** Per-browser HTTPS game channel for public networks that block UDP. */
export class WebSocketTransport implements GameTransport {
    onReady?: () => void;
    onLost?: () => void;
    onSlow?: () => void;
    onPacket?: (data: unknown) => void;
    private readonly socket: WebSocketClient;
    private resolveReady?: () => void;
    private ready = false;
    constructor(url: string,logger: Logger) {
        this.socket = new WebSocketClient({url,logger,autoReconnect:true,reconnectDelay:1000,binaryType:"arraybuffer"});
        this.socket.on("open",()=>{this.ready=true;this.onReady?.();this.resolveReady?.();this.resolveReady=undefined;});
        this.socket.on("message",event=>{if(typeof event.data!=="string")this.onPacket?.(event.data);});
        this.socket.on("close",()=>{if(this.ready)this.onLost?.();this.ready=false;});
    }
    start():Promise<void>{return new Promise(resolve=>{this.resolveReady=resolve;this.socket.connect();});}
    stop():void{this.ready=false;this.socket.disconnect();}
    send(data:string|ArrayBufferLike|Blob|ArrayBufferView):boolean{return this.socket.send(data);}
    sendEvent(event:string,data:unknown):boolean{return this.socket.sendEvent(event,data);}
}
