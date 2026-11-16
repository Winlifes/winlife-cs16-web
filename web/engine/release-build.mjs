import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {join,relative} from "node:path";

/** Content based ID: LAN and public builds of the same source share one ID. */
export function releaseBuild(root){
 const notes=JSON.parse(readFileSync(join(root,"release-notes.json"),"utf8"));
 if(notes.schema!==1||!Array.isArray(notes.versions)||!notes.versions.length)throw Error("Missing release notes");
 const seen=new Set();
 for(const entry of notes.versions){
  if(!/^\d+\.\d+\.\d+$/.test(entry.version)||seen.has(entry.version)||!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)||!entry.title||!entry.changes?.length||!entry.changes.every(s=>typeof s==="string"&&s.length))throw Error("Invalid release notes");
  seen.add(entry.version);
 }
 const files=["index.html","package.json","package-lock.json","vite.config.ts","release-notes.json","engine/native-telemetry.js","engine/release-build.mjs"];
 const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())walk(p);else if(!/\.test\.|\/testing\//.test(p))files.push(relative(root,p));}};
 walk(join(root,"src"));const hash=createHash("sha256");
 for(const file of files.sort()){hash.update(file);hash.update("\0");hash.update(readFileSync(join(root,file)));hash.update("\0");}
 const manifest={schema:1,current:{...notes.versions[0],buildId:hash.digest("hex").slice(0,20)},versions:notes.versions};
 return {
  manifest,
  plugin:{name:"winlife-release",configureServer(server){server.middlewares.use((req,res,next)=>{
   if(req.url?.split("?")[0]!=="/release.json")return next();
   res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");res.end(JSON.stringify(manifest));
  });},generateBundle(){this.emitFile({type:"asset",fileName:"release.json",source:JSON.stringify(manifest,null,2)+"\n"});}}
 };
}
