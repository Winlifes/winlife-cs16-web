// Independent headless Edge only. Never attach to the user's browser profile.
import fs from "node:fs/promises";
import http from "node:http";
if(process.argv[2]!=="--serve"){
    const action=process.argv[2];let expression="";if(!action)for await(const chunk of process.stdin)expression+=chunk;
    const body=action==="--screenshot"?{screenshot:process.argv[3]}:action==="--viewport"?{viewport:process.argv.slice(3).map(Number)}:action==="--reload"?{reload:true}:{expression};
    const response=await fetch(`http://127.0.0.1:${process.env.WINLIFE_EDGE_PROBE_PORT||9338}/`,{method:"POST",body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));console.log(JSON.stringify(result));process.exit(0);
}
const port=9337,origin=process.env.WINLIFE_EDGE_PAGE||"http://127.0.0.1:5174/";
const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
let page=tabs.find(t=>t.type==="page"&&t.url.startsWith(origin));
if(!page)page=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(origin)}`,{method:"PUT"}).then(r=>r.json());
const ws=new WebSocket(page.webSocketDebuggerUrl),pending=new Map();let next=0;
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
const exceptions=[];
ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.method==="Runtime.exceptionThrown")exceptions.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
await call("Page.enable");await call("Runtime.enable");await call("Network.enable");await call("Network.setCacheDisabled",{cacheDisabled:true});await call("Page.bringToFront");await call("Emulation.setFocusEmulationEnabled",{enabled:true});
http.createServer(async(req,res)=>{try{
    if(req.headers.origin)throw new Error("This local probe accepts command-line clients only");
    let input="";for await(const chunk of req)input+=chunk;const action=JSON.parse(input);
    let output;
    if(action.errors){output=exceptions;
    }else if(action.reload){
        await call("Network.enable");await call("Network.setCacheDisabled",{cacheDisabled:true});await call("Page.reload",{ignoreCache:true});output={reloaded:true};
    }else if(action.screenshot){
        const {data}=await call("Page.captureScreenshot",{format:"png"});await fs.writeFile(action.screenshot,Buffer.from(data,"base64"));output={path:action.screenshot};
    }else if(action.viewport){
        const [width,height,deviceScaleFactor=1]=action.viewport;await call("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor,mobile:false});output={viewport:action.viewport};
    }else{
        const result=await call("Runtime.evaluate",{expression:action.expression,awaitPromise:true,returnByValue:true,userGesture:true});
        if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
        output=result.result.value??result.result.description;
    }
    res.setHeader("Content-Type","application/json");res.end(JSON.stringify(output??null));
}catch(error){res.writeHead(500,{"Content-Type":"application/json"});res.end(JSON.stringify({error:String(error)}));}}).listen(Number(process.env.WINLIFE_EDGE_PROBE_PORT||9338),"127.0.0.1",()=>console.log("Independent Edge probe ready"));
