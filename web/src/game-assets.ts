const databaseName="winlife-cs16-assets";
const legacyStore="archives";
type ArchiveKind="game"|"maps";

function database():Promise<IDBDatabase> {
    return new Promise((resolve,reject)=>{
        const request=indexedDB.open(databaseName,2);
        let blocked=false;
        request.onupgradeneeded=()=>{
            request.result.createObjectStore("game");
            request.result.createObjectStore("maps");
        };
        request.onblocked=()=>{
            blocked=true;
            reject(new Error("资源缓存正在被其他页面使用"));
        };
        request.onsuccess=()=>{
            const db=request.result;
            db.onversionchange=()=>db.close();
            if(blocked)db.close();
            else resolve(db);
        };
        request.onerror=()=>reject(request.error);
    });
}

function readStoredArchive(db:IDBDatabase,store:string,key:string):Promise<ArrayBuffer|undefined> {
    return new Promise((resolve,reject)=>{
        const request=db.transaction(store).objectStore(store).get(key);
        request.onsuccess=()=>resolve(request.result instanceof ArrayBuffer?request.result:undefined);
        request.onerror=()=>reject(request.error);
    });
}

export async function readArchive(kind:ArchiveKind,digest:string):Promise<ArrayBuffer|undefined> {
    let db:IDBDatabase|undefined;
    let cached:ArrayBuffer|undefined;
    let legacy=false;
    try {
        db=await database();
        cached=await readStoredArchive(db,kind,digest);
        if(!cached&&db.objectStoreNames.contains(legacyStore)){
            cached=await readStoredArchive(db,legacyStore,digest);
            legacy=true;
        }
    } catch {return undefined;} finally {db?.close();}
    if(!cached)return;
    try {await verifyArchive(cached,digest);} catch {return undefined;}
    if(legacy)await saveArchive(kind,digest,cached);
    return cached;
}

export async function saveArchive(kind:ArchiveKind,digest:string,data:ArrayBuffer):Promise<void> {
    let db:IDBDatabase|undefined;
    try {
        db=await database();
        const hasLegacy=db.objectStoreNames.contains(legacyStore);
        const tx=db.transaction(hasLegacy?[kind,legacyStore]:kind,"readwrite");
        await new Promise<void>((resolve,reject)=>{
            tx.oncomplete=()=>resolve();
            tx.onabort=()=>reject(tx.error);
            // Evict only the previous version of this archive.
            const store=tx.objectStore(kind);
            store.clear();
            if(hasLegacy)tx.objectStore(legacyStore).delete(digest);
            store.put(data,digest);
        });
    } catch { /* Browser storage may be full or disabled. */ }
    finally {db?.close();}
}

export async function verifyArchive(data:ArrayBuffer,expected:string):Promise<void> {
    const digest=await crypto.subtle.digest("SHA-256",data);
    const actual=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");
    if(actual!==expected)throw new Error("资源包校验失败，请选择当前版本的游戏资源包");
}
