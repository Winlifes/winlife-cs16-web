import {expect,it} from "vitest";
import {ReleaseNotices,isReleaseManifest,type ReleaseManifest} from "./releases";
const release=(buildId="a".repeat(20),version="0.1.7"):ReleaseManifest=>({schema:1,current:{buildId,version,date:"2026-11-16",title:"更新",changes:["改进"]},versions:[{version,date:"2026-11-16",title:"更新",changes:["改进"]}]});
it("shows current notes once per build and respects a persisted acknowledgement",()=>{
 const loaded=release(),state=new ReleaseNotices(loaded,null);
 expect(state.automatic(true)).toBe(loaded.current);state.acknowledge(loaded.current);
 expect(state.automatic(true)).toBeUndefined();
 expect(new ReleaseNotices(loaded,loaded.current.buildId).automatic(true)).toBeUndefined();
});
it("defers automatic dialogs in a match and offers the update at settlement",()=>{
 const state=new ReleaseNotices(release(),"a".repeat(20)),next=release("b".repeat(20),"0.1.8");
 state.receive(next);expect(state.pending).toBe(true);expect(state.automatic(false)).toBeUndefined();
 expect(state.automatic(true)).toBe(next.current);state.acknowledge(next.current);
 expect(state.automatic(true)).toBeUndefined();expect(state.pending).toBe(true); // reading notes never reloads
 state.receive(release("c".repeat(20),"0.1.9"));expect(state.automatic(true)?.version).toBe("0.1.9");
});
it("detects changed builds even when the version string is unchanged and clears a rolled back notice",()=>{
 const state=new ReleaseNotices(release(),null);state.receive(release("b".repeat(20)));expect(state.pending).toBe(true);
 state.receive(release());expect(state.pending).toBe(false);
});
it("ignores broken manifests without losing the last valid update",()=>{
 const state=new ReleaseNotices(release(),null);state.receive(release("b".repeat(20),"0.1.8"));
 for(const v of [null,"<html>",{}, {...release(),current:{...release().current,buildId:"bad"}},{...release(),versions:[]}]){expect(isReleaseManifest(v)).toBe(false);expect(state.receive(v)).toBe(false);}
 expect(state.latest.current.version).toBe("0.1.8");
});
