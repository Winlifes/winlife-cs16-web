import type {NativeIdentity} from "./game-telemetry";

export interface DamageCounts {damage:number;armor:number;hits:number;shots?:number;}
export interface DamagePart extends DamageCounts {group:number;}
export interface DamageWeapon extends DamageCounts {name:string;parts?:DamagePart[];}
export interface DamageTarget extends DamageCounts {id:number;name:string;weapons:DamageWeapon[];}
export interface DamageReport {
    version:1|2;matchId?:string;roundEnded?:boolean;received?:DamageCounts;attackers?:DamageTarget[];previous?:DamageReport;round:string;map:string;playerId:number;playerName:string;dead:boolean;deathId?:string;
    totals:DamageCounts;weapons?:DamageWeapon[];targets?:DamageTarget[];
}
const counts=(v:any):boolean=>!!v&&[v.damage,v.armor,v.hits].every(n=>Number.isSafeInteger(n)&&n>=0)&&(v.shots===undefined||Number.isSafeInteger(v.shots)&&v.shots>=0);
const weapon=(v:any):v is DamageWeapon=>counts(v)&&typeof v.name==="string"&&(v.parts===undefined||Array.isArray(v.parts)&&v.parts.every((p:any)=>counts(p)&&Number.isInteger(p.group)&&p.group>=0&&p.group<=7));
const targets=(v:any):boolean=>v===undefined||Array.isArray(v)&&v.every((t:any)=>counts(t)&&Number.isSafeInteger(t.id)&&typeof t.name==="string"&&Array.isArray(t.weapons)&&t.weapons.every(weapon));
export function isDamageReport(v:any,previous=false):v is DamageReport {
 return !!v&&[1,2].includes(v.version)&&typeof v.round==="string"&&typeof v.map==="string"&&typeof v.playerName==="string"&&
 Number.isSafeInteger(v.playerId)&&v.playerId>0&&typeof v.dead==="boolean"&&counts(v.totals)&&
 (!v.dead||typeof v.deathId==="string"&&!!v.deathId)&&
 (v.roundEnded===undefined||typeof v.roundEnded==="boolean")&&(v.received===undefined||counts(v.received))&&
 (v.weapons===undefined||Array.isArray(v.weapons)&&v.weapons.every(weapon))&&targets(v.targets)&&targets(v.attackers)&&
 (v.previous===undefined||!previous&&isDamageReport(v.previous,true));
}
export async function playerReportKey(name:string):Promise<string> {
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(name));
    return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,"0")).join("");
}

/** Local life state prevents a delayed previous-round report appearing on respawn. */
export class DamageVisibility {
    private identity="";
    private suppressed=new Set<string>();
    private shownDeath="";
    reset():void {this.identity="";this.suppressed.clear();this.shownDeath="";}
    select(report:DamageReport|undefined,identity:NativeIdentity|undefined):DamageReport|undefined {
        if(!identity||![1,2].includes(identity.team)||!identity.map||!identity.name){this.reset();return;}
        const key=`${identity.map}\0${identity.name}`;
        if(key!==this.identity){this.reset();this.identity=key;}
        const matched=report?.playerName===identity.name&&report.map===identity.map?report:undefined;
        if(matched?.roundEnded)return matched;
        if(identity.alive){
            // Only a real respawn retires a death. The server's report can
            // legitimately arrive before the client's death animation/state.
            if(this.shownDeath)this.suppressed.add(this.shownDeath);
            while(this.suppressed.size>8)this.suppressed.delete(this.suppressed.values().next().value!);
            return;
        }
        if(matched?.dead&&matched.deathId&&!this.suppressed.has(matched.deathId)){this.shownDeath=matched.deathId;return matched;}
    }
}

/** Poll small per-player static reports; no game input or transport is blocked. */
export class DamageReportClient {
    private timer?:ReturnType<typeof setInterval>;
    private ready=false;
    private generation=0;
    private who="";
    private report?:DamageReport;
    private nextRead=0;
    private busy=false;
    private abort?:AbortController;
    private readonly visibility=new DamageVisibility();
    private rendered="";
    private name="";
    private key?:Promise<string>;
    private sampledAlive?:boolean;
    constructor(private readonly identity:()=>NativeIdentity|undefined,private readonly reportURL:(key:string)=>string|undefined,
        private readonly render:(report:DamageReport|undefined,review?:DamageReport)=>void,private readonly request:typeof fetch=fetch){}
    connected(ready:boolean):void {
        this.ready=ready;this.generation++;this.abort?.abort();this.busy=false;this.who="";this.report=undefined;
        this.visibility.reset();this.sampledAlive=undefined;this.nextRead=0;this.publish(undefined);
    }
    start():void {if(!this.timer){this.timer=setInterval(()=>this.tick(),250);this.tick();}}
    stop():void {clearInterval(this.timer);this.timer=undefined;this.connected(false);}
    private publish(report:DamageReport|undefined):void {
        const data=JSON.stringify({report,review:this.report?.previous});
        if(data!==this.rendered){this.rendered=data;if(this.report?.previous)this.render(report,this.report.previous);else this.render(report);}
    }
    private tick():void {
        const identity=this.ready?this.identity():undefined;
        if(!identity||![1,2].includes(identity.team)||!identity.name||!identity.map){this.publish(this.visibility.select(undefined,identity));return;}
        const who=`${identity.map}\0${identity.name}`;
        if(who!==this.who){this.generation++;this.abort?.abort();this.busy=false;this.who=who;this.report=undefined;this.sampledAlive=undefined;this.nextRead=0;}
        if(this.sampledAlive!==undefined&&this.sampledAlive!==identity.alive)this.nextRead=0;
        this.sampledAlive=identity.alive;
        this.publish(this.visibility.select(this.report,identity));
        if(!this.busy&&Date.now()>=this.nextRead){this.nextRead=Date.now()+(identity.alive?1000:500);void this.read(identity);}
    }
    private async read(identity:NativeIdentity):Promise<void> {
        this.busy=true;const generation=this.generation;
        const abort=new AbortController();this.abort=abort;
        const timeout=setTimeout(()=>abort.abort(),2500);
        try{
            if(this.name!==identity.name){this.name=identity.name;this.key=playerReportKey(identity.name);}
            const key=await this.key!;
            if(generation!==this.generation||abort.signal.aborted)return;
            const url=this.reportURL(key);if(!url)return;
            // Browser fetch requires a Window/Worker receiver. Calling a stored
            // native fetch as this.request(...) binds it to this client instead.
            const response=await this.request.call(globalThis,url,{cache:"no-store",signal:abort.signal});
            const value=response.ok?await response.json():undefined;
            if(generation!==this.generation||abort.signal.aborted)return;
            this.report=isDamageReport(value)?value:undefined;
            this.publish(this.visibility.select(this.report,this.ready?this.identity():undefined));
        } catch {
            // A report may not exist yet; combat keeps running during failures.
            if(generation===this.generation){this.report=undefined;this.publish(undefined);}
        } finally {clearTimeout(timeout);if(generation===this.generation)this.busy=false;}
    }
}
