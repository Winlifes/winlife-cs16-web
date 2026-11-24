import JSZip from "jszip";
import {createLogger, WebSocketClient} from "./core";
import {Xash3DWebRTC} from "./webrtc";
import {WebSocketTransport} from "./websocket-transport";
import {readArchive,saveArchive,verifyArchive} from "./game-assets";
import {GameUI} from "./game-ui";
import {GameTelemetry,type TelemetryRuntime} from "./game-telemetry";
import {renderTeammates,renderMatch} from "./game-hud";
import {Lobby,type RoomSession} from "./lobby";
import {MouseSettings} from "./mouse-settings";
import {DamageReportClient} from "./damage-report";
import {createDamageRenderer} from "./damage-view";
import {renderCrosshair} from "./crosshair";
import {CombatBoardClient} from "./combat-board";
import {ReleaseCenter} from "./release-center";
import {createChatRenderer} from "./game-chat";
import "./style.css";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const base = import.meta.env.BASE_URL;
const path = (name:string) => `${base}${name}`;
const nickname = el<HTMLInputElement>("nickname");
nickname.value = localStorage.getItem("winlife.cs16.nickname") || "";
let xash: Xash3DWebRTC | undefined;
let socket: WebSocketClient;
let joined = false;
let rtcReady = false;
let roomSession:RoomSession|undefined;
let matchPhase="";
const releases=new ReleaseCenter(path("release.json"),()=>!joined||matchPhase==="finished");
releases.start();
const roomPath=(name:string)=>path(`rooms/${roomSession!.room.id}/${name}`);
const channelPath=(name:string)=>`${roomPath(name)}?session=${encodeURIComponent(roomSession!.token)}`;
const gameUI=new GameUI(command=>xash?.Cmd_ExecuteString(command),()=>telemetry.confirmWeapon(),()=>telemetry.team(),()=>void lobby.leave().catch(error=>{el("input-status").textContent=String(error);}),()=>telemetry.buyState(),()=>rtcReady?telemetry.roster():[]);
const telemetry=new GameTelemetry(()=>xash?.em as unknown as TelemetryRuntime|undefined);
const mouseSettings=new MouseSettings(command=>xash?.Cmd_ExecuteString(command));
const damageReports=new DamageReportClient(()=>telemetry.identity(),key=>roomSession?path(`combat-reports-v1/${roomSession.room.id}/${key}.json`):undefined,createDamageRenderer());
const renderChat=createChatRenderer();
const combatBoard=new CombatBoardClient(()=>roomSession&&path(`combat-reports-v1/${roomSession.room.id}/scoreboard.json`),()=>telemetry.roster(),()=>telemetry.identity()?.name??"",()=>!!roomSession&&roomSession.memberId===roomSession.room.hostId,()=>lobby.rematch(),()=>lobby.leave(),finished=>gameUI.settled(finished));
if(import.meta.env.DEV)Object.defineProperty(window,"__winlifeCS",{value:{runtime:()=>xash?.em,command:(c:string)=>xash?.Cmd_ExecuteString(c),identity:()=>telemetry.identity(),room:()=>roomSession?.room.id}});
let assetFile:File|undefined;
el("choose-assets").onclick=()=>el<HTMLInputElement>("asset-file").click();
el<HTMLInputElement>("asset-file").onchange=()=>{
    assetFile=el<HTMLInputElement>("asset-file").files?.[0];
    el("resource-status").textContent=assetFile?`已选择 ${assetFile.name} · ${(assetFile.size/1048576).toFixed(1)} MB`:"已有资源包可跳过大文件下载";
};
const logs: string[] = [];
function print(line: string) {
    console.log("[Xash]", line);
    logs.push(line);
    if (logs.length > 200) logs.shift();
    el("client-log").textContent = logs.slice(-60).join("\n");
    gameUI.receiveLog(line);
    mouseSettings.receiveLog(line);
}
async function refreshHealth() {
    if(!roomSession)return;
    try {
        const h = await fetch(roomPath("healthz"), {cache: "no-store"}).then(r => r.json());
        const e = h.engine;
        const status = e.ready ? `${e.map || "工作站在线"} · ${e.players ?? 0} / ${roomSession.room.maxPlayers} 人` : "服务端正在准备…";
        el("live-status").textContent = `${roomSession.room.name} · ${rtcReady ? "已连接" : "连接恢复中"} · ${status}`;
    } catch {el("server-status").textContent = "暂时无法连接服务器，请检查网络连接";}
}
void refreshHealth();
setInterval(() => void refreshHealth(), 3000);
setInterval(()=>{if(joined&&roomSession)void fetch(roomPath("match"),{cache:"no-store"}).then(r=>r.ok?r.json():undefined).then(state=>{if(state){matchPhase=state.phase;gameUI.battlePhase(state.phase);renderMatch(state,telemetry.team(),telemetry.identity()?.name);combatBoard.match(state);releases.contextChanged();}}).catch(()=>{});},1000);

interface AssetsManifest {
    browserArchive:{sha256:string;url?:string};
    mapArchive?:{sha256:string};
    wasmBaseUrl?:string;
}
async function archive(manifest:AssetsManifest) {
    const digest=manifest.browserArchive.sha256;
    if(assetFile){
        el("loading-text").textContent="正在校验本地资源包…";
        const data=await assetFile.arrayBuffer();await verifyArchive(data,digest);await saveArchive("game",digest,data);
        el<HTMLProgressElement>("progress").value=.75;
        return JSZip.loadAsync(data);
    }
    const cached=await readArchive("game",digest);
    if(cached){
        el("loading-text").textContent="正在从浏览器缓存加载资源…";
        el<HTMLProgressElement>("progress").value=.75;
        return JSZip.loadAsync(cached);
    }
    const response = await fetch(manifest.browserArchive.url || path(`game-data-v1.zip?sha256=${digest}`));
    if (!response.ok || !response.body) throw new Error(`资源下载失败 (${response.status})`);
    const total = Number(response.headers.get("Content-Length")) || 0;
    const reader = response.body.getReader();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    const downloadStarted = performance.now();
    for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        parts.push(value);
        received += value.length;
        el<HTMLProgressElement>("progress").value = total ? received / total * .75 : 0;
        const speed = received / Math.max((performance.now()-downloadStarted)/1000,.1) / 1048576;
        el("loading-text").textContent = `下载资源 ${(received / 1048576).toFixed(1)}${total ? " / " + (total / 1048576).toFixed(1) : ""} MB · ${speed.toFixed(1)} MB/s`;
    }
    const data=await new Blob(parts).arrayBuffer();await verifyArchive(data,digest);await saveArchive("game",digest,data);
    return JSZip.loadAsync(data);
}
async function chineseMenus():Promise<JSZip>{
    const response=await fetch(path("ui/menus-zh-v1.zip"));
    if(!response.ok)throw new Error(`中文菜单加载失败 (${response.status})`);
    return JSZip.loadAsync(await response.arrayBuffer());
}
async function extraMaps(manifest:AssetsManifest):Promise<JSZip|undefined> {
    const digest=manifest.mapArchive?.sha256;
    if(!digest)return;
    const cached=await readArchive("maps",digest);
    if(cached)return JSZip.loadAsync(cached);
    const response=await fetch(path(`maps-${digest}.zip`));
    if(!response.ok)throw new Error(`新增地图下载失败 (${response.status})`);
    const data=await response.arrayBuffer();await verifyArchive(data,digest);await saveArchive("maps",digest,data);
    return JSZip.loadAsync(data);
}
async function enterRoom(session:RoomSession) {
    if (joined) return;
    roomSession=session;
    gameUI.setMode(session.room.mode);
    const name = session.room.members.find(p=>p.id===session.memberId)!.nickname;
    if (!name) {nickname.focus(); return;}
    joined = true;
    localStorage.setItem("winlife.cs16.nickname", name);
    el("loading").hidden = false;
    try {
        const logger = createLogger({level: "info"});
        const [config,manifest] = await Promise.all([
            fetch(path("client-config")).then(r=>r.json()).catch(()=>({transport:"webrtc"})),
            fetch(path("assets-manifest.json"),{cache:"no-store"}).then(r=>{
                if(!r.ok)throw new Error(`资源清单读取失败 (${r.status})`);
                return r.json() as Promise<AssetsManifest>;
            }),
        ]);
        const wasm = (name:string) => manifest.wasmBaseUrl ? new URL(name,manifest.wasmBaseUrl).href : path(`wasm/${name}`);
        socket = new WebSocketClient({url: channelPath("websocket"), logger, autoReconnect: false});
        xash = new Xash3DWebRTC({
            socket, logger, serverAddress: "127.0.0.1:8080", getUserMedia: async () => undefined,
            transport: config.transport==="websocket" ? new WebSocketTransport(channelPath("datagram"),logger) : undefined,
            canvas: el<HTMLCanvasElement>("canvas"),
            arguments: ["-game", "cstrike", "-windowed", "-console", "-width", "1280", "-height", "720", "-nojoy"],
            libraries: {
                xash: wasm("xash.wasm"), filesystem: wasm("filesystem_stdio.wasm"),
                menu: wasm("menu_emscripten_wasm32.wasm"), server: wasm("cs_emscripten_wasm32.wasm"),
                client: wasm("client_emscripten_wasm32.wasm"), render: {gl4es: wasm("libref_webgl2.wasm")},
            },
            module: {print, printErr: print,...{winlifeScoreboardDamage:(name:string)=>combatBoard.damage(name),winlifeOnHUD:session.room.mode==="freeforall"?undefined:renderTeammates,winlifeOnCrosshair:renderCrosshair,winlifeOnChat:renderChat}},
        });
        xash.onConnected = () => {rtcReady = true; telemetry.connected(true); damageReports.connected(true); mouseSettings.waiting(); gameUI.reconnecting(); xash?.sendEvent("winlife:hello",name); void refreshHealth();};
        xash.onDisconnected = () => {rtcReady = false; renderCrosshair(undefined); telemetry.connected(false); damageReports.connected(false); mouseSettings.waiting(); el("live-status").textContent = "连接中断，正在自动重连…";};
        xash.onSlowConnection = () => {el("loading-text").textContent = "联机通道建立较慢，正在重试…";};
        const [zip,chinese,maps] = await Promise.all([archive(manifest), chineseMenus(), extraMaps(manifest), xash.init()]);
        el("loading-text").textContent = "解压并准备游戏…";
        const fs = xash.em!.FS;
        const files = [zip,maps,chinese].flatMap(part=>Object.values(part?.files??{})).filter(f => !f.dir);
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const path = `/rodir/${file.name}`;
            fs.mkdirTree(path.slice(0, path.lastIndexOf("/")));
            fs.writeFile(path, await file.async("uint8array"));
            if (i % 60 === 0) {el<HTMLProgressElement>("progress").value = .75 + i / files.length * .25; await new Promise(r => setTimeout(r, 0));}
        }
        // The native scoreboard receives each player's ping from svc_pings.
        // Make its unit explicit without changing the engine's measurements.
        const scoreboardLabels = "/rodir/valve/resource/valve_english.txt";
        const labels = new TextDecoder("utf-16le").decode(fs.readFile(scoreboardLabels));
        fs.writeFile(scoreboardLabels, new TextEncoder().encode(
            labels.replace(/("PlayerPing"\s+)"Latency"/, '$1"Ping (ms)"')
        ));
        // The wrapper preloads the CS server module at its default HL alias.
        // Xash appends the target suffix itself; archives made before this fix
        // contain a suffixed name that would be appended a second time.
        fs.writeFile("/rodir/cstrike/gameinfo.txt", new TextEncoder().encode(
            'title "Counter-Strike"\ngamedir "cstrike"\nbasedir "valve"\ngamemode "multiplayer_only"\nstartmap "de_dust2"\ngamedll "dlls/hl.wasm"\nmax_edicts "2048"\n'
        ));
        // The desktop shell owns team selection. Keep engine menu signals for
        // server acknowledgement, without drawing a second touch menu beneath it.
        fs.mkdirTree("/rodir/cstrike/touch");
        for(const menu of ["chooseteam","chooseteam_tr","chooseteam_ct"]){
            fs.writeFile(`/rodir/cstrike/touch/${menu}.cfg`,new TextEncoder().encode('touch_removebutton _menu_*\ntouch_setclientonly 0\n'));
        }
        // Touch_InitConfig is lazy: clearing buttons here would erase the first
        // buy menu after it has been built. An empty desktop profile is enough.
        fs.writeFile("/rodir/cstrike/touch.cfg",new TextEncoder().encode('// Desktop input; no mobile HUD profile.\n'));
        fs.chdir("/rodir");
        el("welcome").hidden = true;
        el("game").hidden = false;
        xash.main();
        gameUI.begin();
        xash.Cmd_ExecuteString(`name "${name}"`);
        xash.Cmd_ExecuteString('bind "v" "+duck"');
        for (const c of ["rate 100000", "cl_updaterate 60", "cl_cmdrate 60", "ex_interp 0.033", "fps_max 100", `hud_scale ${Math.min(window.devicePixelRatio || 1, 2)}`, "net_graph 0", "cl_showfps 0", "touch_enable 0", "voice_enable 0", "hud_fastswitch 1", "volume 0.5", "setinfo _vgui_menus 1"]) xash.Cmd_ExecuteString(c);
        telemetry.start();
        damageReports.start();
        combatBoard.start();
        xash.connectToServer();
    } catch (error) {
        console.error(error);
        el("loading-text").textContent = `加载失败：${String(error)}。刷新页面后可重试。`;
    }
}
const lobby=new Lobby(path,nickname,enterRoom);
el("vote").onclick = () => {const map = el<HTMLSelectElement>("map").value; xash?.sendEvent("winlife:vote", map); el("vote-status").textContent = `已投票：${map}，等待过半玩家同意。`;};
el("console-form").addEventListener("submit", event => {event.preventDefault(); const input = el<HTMLInputElement>("command"); xash?.Cmd_ExecuteString(input.value); input.value = "";});
window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    releases.stop();
    damageReports.stop();
    combatBoard.stop();
    telemetry.stop();
    xash?.close();
});
