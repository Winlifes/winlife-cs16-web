#!/usr/bin/env python3
"""Convert the already-installed native CS shop icons to browser PNGs."""
import os
import hashlib
import json
from pathlib import Path
from PIL import Image

here = Path(__file__).resolve().parent.parent
source = Path(os.environ['CS16_GAME_DIR']) / 'cstrike/gfx/vgui'
output = here / 'web/public/ui/loadouts'
output.mkdir(parents=True, exist_ok=True)
names = 'ak47 m4a1 galil famas mp5 awp scout deserteagle usp45 glock18 p90 kevlar kevlar_helmet hegrenade flashbang smokegrenade defuser'.split()
report = {}
for name in names:
    original = source / (name + '.tga')
    target = output / (name + '.png')
    Image.open(original).convert('RGBA').save(target, optimize=True)
    report[name] = {'sourceSHA256': hashlib.sha256(original.read_bytes()).hexdigest(), 'pngSHA256': hashlib.sha256(target.read_bytes()).hexdigest(), 'bytes': target.stat().st_size}
(output / 'sources.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'icons': len(report), 'bytes': sum(i['bytes'] for i in report.values())}))
