export interface ReleaseNotes {version:string;date:string;title:string;changes:string[];}
export interface ReleaseInfo extends ReleaseNotes {buildId:string;}
export interface ReleaseManifest {schema:1;current:ReleaseInfo;versions:ReleaseNotes[];}
const notes=(v:any):v is ReleaseNotes=>!!v&&typeof v.version==="string"&&/^\d+\.\d+\.\d+$/.test(v.version)&&typeof v.date==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v.date)&&typeof v.title==="string"&&v.title.length>0&&v.title.length<=160&&Array.isArray(v.changes)&&v.changes.length>0&&v.changes.length<=40&&v.changes.every((s:unknown)=>typeof s==="string"&&s.length>0&&s.length<=1000);
export function isReleaseManifest(v:any):v is ReleaseManifest {
 return !!v&&v.schema===1&&notes(v.current)&&typeof v.current.buildId==="string"&&/^[a-f0-9]{20}$/.test(v.current.buildId)&&Array.isArray(v.versions)&&v.versions.length>0&&v.versions.length<=100&&v.versions.every(notes)&&v.versions[0].version===v.current.version;
}
/** Detection and acknowledgement never authorize a reload or interrupt play. */
export class ReleaseNotices {
 latest:ReleaseManifest;
 private offered=new Set<string>();
 constructor(readonly loaded:ReleaseManifest,private seen:string|null){this.latest=loaded;}
 get pending():boolean{return this.latest.current.buildId!==this.loaded.current.buildId;}
 receive(value:unknown):boolean{if(!isReleaseManifest(value))return false;this.latest=value;return true;}
 automatic(safe:boolean):ReleaseInfo|undefined {
  if(!safe)return;
  const info=this.pending?this.latest.current:this.loaded.current;
  if(this.offered.has(info.buildId)||!this.pending&&this.seen===info.buildId)return;
  return info;
 }
 acknowledge(info:ReleaseInfo):void{this.offered.add(info.buildId);this.seen=info.buildId;}
}
