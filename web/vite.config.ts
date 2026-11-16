import {defineConfig} from "vite";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {releaseBuild} from "./engine/release-build.mjs";
import {createHash} from "node:crypto";

// A narrow loader extension exposes the existing native HUD/NetAPI, without
// rebuilding the WASM binaries or changing their game/network behavior.
const telemetryBridge=readFileSync(new URL("./engine/native-telemetry.js",import.meta.url),"utf8");
const loaderHash="8fe75a79eb45943cce7f3e68832243d21eeb21013bb2b3b52cc509d058f1062b";
const clientHash="3a8b26a14ce562ab3bcfbf2a8f57c2822ae04c2a134caedbb03355003ea5ecf7";
if(createHash("sha256").update(readFileSync(new URL("./public/wasm/client_emscripten_wasm32.wasm",import.meta.url))).digest("hex")!==clientHash)
    throw new Error("CS client changed; verify the crosshair bridge ABI before publishing.");
const nativeTelemetry={name:"winlife-native-telemetry",enforce:"pre" as const,
    transform(code:string,id:string){
        if(!id.split("?")[0].replaceAll("\\","/").endsWith("/xash3d-fwgs/dist/generated/xash.js"))return;
        const marker="return {\n            Module,\n            FS,";
        const tableMarker="moduleExports = relocateExports(instance.exports, memoryBase); updateGOT(moduleExports);";
        if(createHash("sha256").update(code).digest("hex")!==loaderHash||!code.includes(marker)||!code.includes(tableMarker))
            throw new Error("Xash loader changed; review the native telemetry bridge before updating the pinned engine.");
        const extended=code.replace(tableMarker,tableMarker+" if(moduleExports._ZN11CHudSayText4InitEv) Module.winlifeClientTableBase=tableBase;");
        return {code:extended.replace(marker,`return {\n            getNativeTelemetry: ${telemetryBridge},\n            Module,\n            FS,`),map:null};
    },
};

// Development defaults to a local gateway; deployments opt in via environment.
const devTarget=new URL(process.env.CS16_DEV_SERVER||"http://127.0.0.1:27016/");
const prefix=devTarget.pathname.replace(/\/$/,"");
const proxy=Object.fromEntries(["/client-config","/healthz","/datagram","/websocket","/rooms","/combat-reports-v1"].map(route=>[route,{
    target:devTarget.origin,changeOrigin:true,ws:true,rewriteWsOrigin:true,
    headers:{Origin:devTarget.origin},rewrite:(path:string)=>`${prefix}${path}`,
}]));
const release=releaseBuild(fileURLToPath(new URL(".",import.meta.url)));
export default defineConfig({define:{__WINLIFE_RELEASE__:JSON.stringify(release.manifest)},plugins:[nativeTelemetry,release.plugin],optimizeDeps:{exclude:["xash3d-fwgs"]},server:{host:"127.0.0.1",port:5174,strictPort:true,
    headers:{"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp"},proxy,
}});
