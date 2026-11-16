// Obtain only engine modules. This tool never downloads commercial game data.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output=path.join(root,'web/public/wasm');await fs.mkdir(output,{recursive:true});
for(const name of ['xash.wasm','filesystem_stdio.wasm','libref_webgl2.wasm']){
 await fs.copyFile(path.join(root,'web/node_modules/xash3d-fwgs/dist',name),path.join(output,name));
}
const pins=JSON.parse(await fs.readFile(path.join(root,'native-sources.json'),'utf8'));
const targets=['client_emscripten_wasm32.wasm','cs_emscripten_wasm32.wasm','menu_emscripten_wasm32.wasm'];
const option=process.argv.indexOf('--modules');const supplied=option>=0?process.argv[option+1]:undefined;
if(!supplied&&!process.argv.includes('--download-verified'))throw Error('Use --modules /path/to/your/wasm/modules or --download-verified. See docs/assets.md.');
for(let i=0;i<pins.recoveredWasm.length;i++){
 const pin=pins.recoveredWasm[i];let data;
 if(supplied)data=await fs.readFile(path.join(supplied,targets[i]));
 else{const response=await fetch(pin.url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Module download failed: ${response.status}`);data=Buffer.from(await response.arrayBuffer());}
 if(createHash('sha256').update(data).digest('hex')!==pin.sha256)throw Error(`Unexpected module: ${targets[i]}`);
 await fs.writeFile(path.join(output,targets[i]),data);console.log(`Verified ${targets[i]}`);
}
