#!/usr/bin/env python3
"""Prepare local runtime/browser data from an operator-supplied game installation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser()
p.add_argument('--data', type=Path, required=True, help='Directory containing your valve/ and cstrike/ game data')
p.add_argument('--runtime', type=Path, default=ROOT / '.runtime')
p.add_argument('--sdk', type=Path, default=ROOT / '.native/sources/cs16-sdk')
p.add_argument('--skip-ui', action='store_true', help='Skip artwork/Chinese menu conversion')
a = p.parse_args()
data, runtime, sdk = a.data.resolve(), a.runtime.resolve(), a.sdk.resolve()
assert (data / 'valve').is_dir() and (data / 'cstrike').is_dir(), 'Expected valve/ and cstrike/ beneath --data'
assert not (runtime / 'game/.rooms').exists() or not any((runtime / 'game/.rooms').iterdir()), 'Stop/close rooms before preparing game data'
game = runtime / 'game'; public = ROOT / 'web/public'
media = {'.bsp','.wad','.mdl','.spr','.wav','.mp3','.ogg','.tga','.bmp','.png','.jpg','.pcx','.pak','.pk3','.fnt','.sc','.res','.lst'}
for directory in ['valve','cstrike']:
    for source in (data / directory).rglob('*'):
        if not source.is_file() or source.is_symlink(): continue
        rel = source.relative_to(data)
        if any(x.lower() in {'addons','dlls','cl_dlls','logs','save','demos'} for x in rel.parts): continue
        if source.suffix.lower() not in media and not (source.suffix.lower()=='.txt' and ('resource' in rel.parts or source.name=='titles.txt')): continue
        dest = game / rel; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source,dest)
extras = sdk / '3rdparty/cs16client-extras'
assert (extras / 'touch').is_dir(), 'Prepare the pinned SDK first'
with zipfile.ZipFile(game / 'cstrike/extras.pk3','w',zipfile.ZIP_DEFLATED) as z:
    for source in sorted(extras.rglob('*')):
        if source.is_file(): z.write(source,source.relative_to(extras).as_posix())
npm = ROOT / 'web/node_modules/xash3d-fwgs/dist'
shutil.copy2(npm / 'valve/extras.pk3',game / 'valve/extras.pk3')
conf = sdk / '3rdparty/yapb/cfg/addons/yapb'
shutil.copytree(conf,game / 'cstrike/addons/yapb',dirs_exist_ok=True)
graphs = ROOT / '.native/build/cs16-sdk/graphs/addons/yapb/data/graph'
if graphs.exists(): shutil.copytree(graphs,game / 'cstrike/addons/yapb/data/graph',dirs_exist_ok=True)
for name in ['server.cfg','winlife_map.cfg','game.cfg']: shutil.copy2(ROOT / 'deploy' / name, game / 'cstrike' / name)
for name in ['server.cfg','winlife_map.cfg']:
    with (game / 'cstrike' / name).open('a') as f: f.write('\nyb_language chs\n')
(game / 'cstrike/liblist.gam').write_text('game "Counter-Strike"\nversion "1.6"\ntype "multiplayer_only"\ncldll "1"\nmpentity "info_player_start"\ngamedll_osx "dlls/cs.dylib"\ngamedll_linux "dlls/cs.so"\ngamedll "dlls/cs.dll"\nedicts "2048"\n')
archive = public / 'game-data-v1.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for file in sorted(game.rglob('*')):
        if not file.is_file() or file.suffix.lower() in {'.dylib','.so','.dll'} or file.name in {'server.cfg','winlife_map.cfg','liblist.gam'} or 'addons' in file.relative_to(game).parts: continue
        z.write(file,file.relative_to(game).as_posix())
    z.writestr('cstrike/gameinfo.txt','title "Counter-Strike"\ngamedir "cstrike"\nbasedir "valve"\ngamemode "multiplayer_only"\nstartmap "de_dust2"\ngamedll "dlls/hl.wasm"\nmax_edicts "2048"\n')
sha=hashlib.sha256(archive.read_bytes()).hexdigest()
(public / 'assets-manifest.json').write_text(json.dumps({'browserArchive':{'sha256':sha},'maps':sorted(f.stem for f in (game/'cstrike/maps').glob('*.bsp'))},indent=2)+'\n')
engine=ROOT / '.native/sources/xash3d/build'
suffix='.dylib' if platform.system()=='Darwin' else '.so'
for file in [engine/'engine/xash',engine/('filesystem/filesystem_stdio'+suffix)]:
    assert file.exists(), f'Build native code first: {file}'
    (runtime/'engine').mkdir(parents=True,exist_ok=True);shutil.copy2(file,runtime/'engine'/file.name)
shutil.copy2(engine/('filesystem/filesystem_stdio'+suffix),game/('filesystem_stdio'+suffix))
dlls=game/'cstrike/dlls';dlls.mkdir(exist_ok=True)
build=ROOT/'.native/build/cs16-sdk/3rdparty'
for folder,prefix in [('ReGameDLL_CS/regamedll','cs_'),('yapb','yapb_')]:
    candidates=list((build/folder).glob(prefix+'*'+suffix));assert len(candidates)==1,(folder,candidates)
    shutil.copy2(candidates[0],dlls/candidates[0].name)
token=runtime/'admin-token'
if not token.exists(): token.write_text(secrets.token_hex(32)+'\n');token.chmod(0o600)
if not a.skip_ui:
    env=dict(os.environ,CS16_GAME_DIR=str(game),CS16_SDK_DIR=str(sdk))
    for name in ['prepare-ui.py','prepare-loadouts.py','build-shop-zh.py']: subprocess.run([sys.executable,str(ROOT/'tools'/name)],env=env,check=True)
print(json.dumps({'runtime':str(runtime),'browserArchiveSHA256':sha,'maps':json.loads((public/'assets-manifest.json').read_text())['maps']}))
