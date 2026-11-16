const databaseName="winlife-cs16-assets";

function database():Promise<IDBDatabase> {
    return new Promise((resolve,reject)=>{
        const request=indexedDB.open(databaseName,1);
        request.onupgradeneeded=()=>request.result.createObjectStore("archives");
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>reject(request.error);
    });
}

export async function readArchive(key:string):Promise<ArrayBuffer|undefined> {
    try {
        const db=await database();
        return await new Promise((resolve,reject)=>{
            const tx=db.transaction("archives","readonly");
            const request=tx.objectStore("archives").get(key);
            request.onsuccess=()=>resolve(request.result instanceof ArrayBuffer?request.result:undefined);
            request.onerror=()=>reject(request.error);
            tx.oncomplete=()=>db.close();
        });
    } catch {return undefined;}
}

export async function saveArchive(key:string,data:ArrayBuffer):Promise<void> {
    try {
        const db=await database();
        await new Promise<void>((resolve,reject)=>{
            const tx=db.transaction("archives","readwrite");
            const store=tx.objectStore("archives");
            // Keep one content-addressed version rather than growing disk use.
            store.clear();store.put(data,key);
            tx.oncomplete=()=>{db.close();resolve();};
            tx.onerror=()=>{db.close();reject(tx.error);};
            tx.onabort=()=>{db.close();reject(tx.error);};
        });
    } catch { /* Browser storage may be full/disabled; gameplay can continue. */ }
}

export async function verifyArchive(data:ArrayBuffer,expected:string):Promise<void> {
    const digest=await crypto.subtle.digest("SHA-256",data);
    const actual=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");
    if(actual!==expected)throw new Error("资源包校验失败，请选择当前版本的游戏资源包");
}
