// Inserted into the pinned Emscripten loader by vite.config.ts.
// GoldSrc wasm32 ABI: engine/APIProxy.h (pNetAPI at slot 86),
// common/net_api.h (Status at slot 1, net_status_t is 72 bytes).
// No game memory addresses are hard-coded: the dynamic linker resolves them.
(() => {
    let telemetry;
    return () => {
        if (telemetry) return telemetry;
        const redrawIndex = GOT.HUD_Redraw?.value;
        const engine = GOT.gEngfuncs?.value;
        if (!redrawIndex || !engine) return;
        const netAPI = HEAPU32[(engine + 86 * 4) >>> 2];
        const statusIndex = netAPI && HEAPU32[(netAPI + 4) >>> 2];
        if (!statusIndex) return;
        const redraw = getWasmTableEntry(redrawIndex);
        const status = getWasmTableEntry(statusIndex);
        const buffer = _malloc(72);
        const scratch = _malloc(80);
        const api = slot => {
            const index = HEAPU32[(engine + slot * 4) >>> 2];
            return index ? getWasmTableEntry(index) : undefined;
        };
        const playerInfo = api(21), localPlayer = api(51), entityByIndex = api(53);
        const traceLine = api(59), maxClients = api(36);
        const triangle = HEAPU32[(engine + 82 * 4) >>> 2];
        const project = triangle && getWasmTableEntry(HEAPU32[(triangle + 12 * 4) >>> 2]);
        const events = HEAPU32[(engine + 84 * 4) >>> 2];
        const traceEntity = events && getWasmTableEntry(HEAPU32[(events + 8 * 4) >>> 2]);
        const playerTeam = GOT.HUD_GetPlayerTeam && getWasmTableEntry(GOT.HUD_GetPlayerTeam.value);
        const nativeDead = GOT._Z9CL_IsDeadv?.value && getWasmTableEntry(GOT._Z9CL_IsDeadv.value);
        const isAlive = entity => !!entity && !(GOT.g_iUser1?.value && HEAP32[GOT.g_iUser1.value >>> 2]) &&
            (nativeDead ? !nativeDead() : !!HEAP16[(entity+688+58)>>>1]&&!HEAP32[(entity+688+260)>>>2]);
        // CHudSayText::Init registers private table slot 66 in the pinned WASM.
        // The loader records that module's own table base; unrelated messages
        // and unsupported formats keep their original native handler.
        if (Module.winlifeOnChat && Number.isInteger(Module.winlifeClientTableBase)) {
            const index = Module.winlifeClientTableBase + 66;
            const original = getWasmTableEntry(index);
            if (original) {
                const handler = addFunction((name,size,ptr) => {
                    if (size > 1 && size <= 2048 && ptr > 0 && ptr + size <= HEAPU8.length) {
                        const strings = [];let cursor = ptr + 1;
                        while (cursor < ptr + size && strings.length < 4) {
                            let end = cursor;while (end < ptr + size && HEAPU8[end])end++;
                            if (end === ptr + size)break;
                            strings.push(UTF8ToString(cursor,end-cursor));cursor=end+1;
                        }
                        if (strings.length) {
                            const id = HEAPU8[ptr];let playerName = "";
                            if (id && playerInfo) {
                                playerInfo(id,scratch+40);
                                const value = HEAPU32[(scratch+40)>>>2];
                                if (value)playerName=UTF8ToString(value,128);
                            }
                            if (Module.winlifeOnChat({id,format:strings[0],args:strings.slice(1),playerName,
                                team:playerTeam?.(id)??0,alive:isAlive(localPlayer?.())}) === true)return 1;
                        }
                    }
                    return original(name,size,ptr);
                }, "iiii");
                setWasmTableEntry(index,getWasmTableEntry(handler));
            }
        }
        // Verified with clang -target wasm32 against common/cl_entity.h:
        // sizeof(cl_entity_t)=3000, curstate=688, origin=2888, model=2964.
        const vector = (ptr, values) => values.forEach((value, i) => HEAPF32[(ptr >>> 2) + i] = value);
        const origin = entity => [0, 1, 2].map(i => HEAPF32[((entity + 2888) >>> 2) + i]);
        // The pinned client draws its four legacy crosshair bars first in the
        // virtual CHudAmmo::Draw call. Capture only those calls, leaving its
        // native weapon/spread/color calculation and all other HUD drawing intact.
        // Offsets below are verified against that exact client WASM, not native ARM.
        let crosshairFrame;
        let capture;
        const ammoDrawIndex = GOT._ZN8CHudAmmo4DrawEf?.value;
        const hud = GOT.gHUD?.value;
        const screenInfo = api(12);
        const fillIndex = HEAPU32[(engine + 11 * 4) >>> 2];
        const blendIndex = HEAPU32[(engine + 130 * 4) >>> 2];
        if (Module.winlifeOnCrosshair && ammoDrawIndex && hud && screenInfo && fillIndex && blendIndex) {
            const drawAmmo = getWasmTableEntry(ammoDrawIndex);
            const info = _malloc(532), large = _malloc(6);
            HEAPU8.set([108,97,114,103,101,0], large);
            function intercept(index) {
                const original = getWasmTableEntry(index);
                const hook = addFunction((x,y,w,h,r,g,b,a) => {
                    if (capture && capture.remaining > 0) {
                        capture.remaining--;
                        if (!capture.color) capture.color = {r,g,b,alpha:a / 255};
                        return;
                    }
                    original(x,y,w,h,r,g,b,a);
                }, "viiiiiiii");
                setWasmTableEntry(index, getWasmTableEntry(hook));
            }
            intercept(fillIndex);
            if (blendIndex !== fillIndex) intercept(blendIndex);
            const ammoHook = addFunction((self,time) => {
                const weapon = HEAPU32[(self + 16) >>> 2];
                const id = weapon ? HEAP32[(weapon + 156) >>> 2] : 0;
                const custom = HEAPU32[(self + 124) >>> 2];
                const shield = GOT.g_iWeaponFlags?.value;
                const eligible = weapon && HEAP32[(hud + 10000) >>> 2] < 0 && HEAP32[(hud + 52) >>> 2] > 40 &&
                    ![3,13,18,24].includes(id) && (!shield || !(HEAP32[shield >>> 2] & 32)) &&
                    custom && !HEAPF32[(custom + 12) >>> 2];
                if (!eligible) return drawAmmo(self,time);
                const size = HEAPU32[(self + 84) >>> 2];
                const saved = size && HEAPU32[(size + 4) >>> 2];
                const automatic = saved && /^(auto|0)$/i.test(UTF8ToString(saved,32));
                // Auto must use a stable 640 reference even at virtual width <=640.
                // Restore the cvar's original string before returning to the engine.
                HEAP32[info >>> 2] = 532;
                screenInfo(info);
                const width = HEAP32[(info + 4) >>> 2];
                if (automatic) HEAPU32[(size + 4) >>> 2] = large;
                const previous = capture;
                const current = {remaining:4,color:undefined};
                capture = width > 0 ? current : undefined;
                try {
                    const result = drawAmmo(self,time);
                    if (!current.remaining && current.color) {
                        const base = HEAP32[(self + 60) >>> 2];
                        const gap = HEAPF32[(self + 64) >>> 2];
                        if (base > 0 && Number.isFinite(gap) && gap >= 0) {
                            const scale = 640 / base;
                            crosshairFrame = {gap:gap * scale,length:5 * scale,thickness:1,...current.color};
                        }
                    }
                    return result;
                } finally {
                    capture = previous;
                    if (automatic) HEAPU32[(size + 4) >>> 2] = saved;
                }
            }, "iif");
            setWasmTableEntry(ammoDrawIndex, getWasmTableEntry(ammoHook));
        }
        function teammateLabels() {
            if (!playerInfo || !localPlayer || !entityByIndex || !project || !traceLine || !playerTeam) return [];
            const local = localPlayer();
            if (!local) return [];
            const ownIndex = HEAP32[local >>> 2], team = playerTeam(ownIndex);
            if (team !== 1 && team !== 2) return [];
            // Spectators and dead clients do not get a live teammate overlay.
            if (!isAlive(local)) return [];
            const eye = origin(local);
            eye[2] += HEAP32[(local + 688 + 200) >>> 2] ? 12 : 28;
            vector(scratch, eye);
            const labels = [];
            for (let i = 1; i <= Math.min(maxClients ? maxClients() : 16, 64); i++) {
                if (i === ownIndex || playerTeam(i) !== team) continue;
                const entity = entityByIndex(i);
                if (!entity || !HEAPU32[(entity + 2964) >>> 2] || !HEAP16[(entity + 688 + 58) >>> 1]) continue;
                // Do not leave names at stale, out-of-PVS entity positions.
                if (HEAP32[(entity + 688 + 12) >>> 2] !== HEAP32[(local + 688 + 12) >>> 2]) continue;
                const point = origin(entity), head = HEAP32[(entity + 688 + 200) >>> 2] ? 16 : 32;
                point[2] += head;
                if (Math.hypot(point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]) > 2200) continue;
                vector(scratch + 12, point);
                const trace = traceLine(scratch, scratch + 12, 0, 2, -1);
                if (!trace || HEAP32[trace >>> 2] || HEAP32[(trace + 4) >>> 2]) continue;
                if (HEAPF32[(trace + 16) >>> 2] < .98 && (!traceEntity || traceEntity(trace) !== i)) continue;
                point[2] += 10;
                vector(scratch + 12, point);
                if (project(scratch + 12, scratch + 24)) continue;
                const x = HEAPF32[(scratch + 24) >>> 2], y = HEAPF32[(scratch + 28) >>> 2];
                if (!Number.isFinite(x + y) || Math.abs(x) > .96 || Math.abs(y) > .96) continue;
                playerInfo(i, scratch + 40);
                const name = HEAPU32[(scratch + 40) >>> 2];
                if (name) labels.push({id:i, name:UTF8ToString(name, 128), x:(x + 1) * 50, y:(1 - y) * 50});
            }
            return labels;
        }
        let frames = 0;
        let nextLabels = 0;
        let previousTime = 0;
        let moneyName = 0;
        const observer = addFunction((time, intermission) => {
            crosshairFrame = undefined;
            const result = redraw(time, intermission);
            frames++;
            Module.winlifeOnCrosshair?.(intermission ? undefined : crosshairFrame);
            if (time < previousTime) nextLabels = 0;
            previousTime = time;
            if (Module.winlifeOnHUD && time >= nextLabels) {
                nextLabels = time + .05;
                Module.winlifeOnHUD(intermission ? [] : teammateLabels());
            }
            return result;
        }, "ifi");
        setWasmTableEntry(redrawIndex, getWasmTableEntry(observer));
        telemetry = {
            get frames() { return frames; },
            team() {const entity=localPlayer?.();return entity&&playerTeam?playerTeam(HEAP32[entity >>> 2]):0;},
            identity() {
                const entity=localPlayer?.(),level=api(74)?.();
                if(!entity||!playerInfo||!playerTeam)return;
                const index=HEAP32[entity>>>2];
                playerInfo(index,scratch+40);
                const name=HEAPU32[(scratch+40)>>>2];
                if(!name)return;
                return {
                    name:UTF8ToString(name,128),team:playerTeam(index),
                    alive:isAlive(entity),
                    map:level?UTF8ToString(level,256).replace(/^.*[\\/]/,"").replace(/\.bsp$/i,""):"",
                };
            },
            roster() {
                const players=[];
                if(!playerInfo||!maxClients||!playerTeam)return players;
                for(let i=1;i<=Math.min(32,maxClients());i++){
                    HEAPU8.fill(0,scratch+40,scratch+80);
                    playerInfo(i,scratch+40);
                    const name=HEAPU32[(scratch+40)>>>2];
                    if(name)players.push({id:i,name:UTF8ToString(name,128),team:playerTeam(i),ping:HEAP16[(scratch+44)>>>1]});
                }
                return players;
            },
            buyState() {
                const entity=localPlayer?.(),getMoney=api(15),getLevel=api(74);
                if(!moneyName&&getMoney){const name="cscl_currentmoney";moneyName=_malloc(name.length+1);HEAPU8.set([...name].map(c=>c.charCodeAt(0)).concat(0),moneyName);}
                const value=getMoney?getMoney(moneyName):NaN;
                const level=getLevel?.();
                return {
                    team:entity&&playerTeam?playerTeam(HEAP32[entity >>> 2]):0,
                    money:Number.isFinite(value)&&value>=0?Math.floor(value):undefined,
                    map:level?UTF8ToString(level,256).replace(/^.*[\\/]/,"").replace(/\.bsp$/i,""):"",
                    alive:isAlive(entity),
                };
            },
            confirmWeapon() {
                const selected = GOT.gpActiveSel && HEAPU32[GOT.gpActiveSel.value >>> 2];
                if (!selected || selected === 1 || !GOT.g_weaponselect || !api(19)) return false;
                const id = HEAP32[(selected + 156) >>> 2];
                if (id < 1 || id > 31 || !UTF8ToString(selected, 128).startsWith("weapon_")) return false;
                api(19)(selected);
                HEAP32[GOT.g_weaponselect.value >>> 2] = id;
                if (GOT.g_weaponselect_frames) HEAP32[GOT.g_weaponselect_frames.value >>> 2] = 3;
                if (GOT.gpLastSel) HEAPU32[GOT.gpLastSel.value >>> 2] = selected;
                HEAPU32[GOT.gpActiveSel.value >>> 2] = 0;
                return true;
            },
            network() {
                status(buffer);
                return {
                    connected: !!HEAP32[buffer >>> 2],
                    latencyMs: HEAPF64[(buffer + 48) >>> 3] * 1000,
                    loss: HEAP32[(buffer + 44) >>> 2],
                };
            },
        };
        return telemetry;
    };
})()
