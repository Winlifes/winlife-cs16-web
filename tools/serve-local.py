#!/usr/bin/env python3
"""Run an already prepared local instance; Ctrl+C terminates its children."""
import os
from pathlib import Path
import subprocess
import sys

root=Path(__file__).resolve().parent.parent
runtime=Path(os.environ.get('CS16_RUNTIME',root/'.runtime')).resolve()
public=root/'web/dist'
if not (public/'assets-manifest.json').exists(): raise RuntimeError('Prepare game data and build the web client first; see README.md')
base=dict(os.environ,CS16_ADMIN_TOKEN_FILE=str(runtime/'admin-token'),CS16_ENGINE=str(runtime/'engine/xash'),CS16_GAME_DIR=str(runtime/'game'),CS16_PUBLIC=str(public),CS16_LISTEN='127.0.0.1:27016',CS16_ADMIN_LISTEN='127.0.0.1:27017')
# Disable public interface exposure by default. Deploy TLS proxy separately.
children=[]
try:
    children.append(subprocess.Popen([str(runtime/'damage-publisher'),'-rooms',str(runtime/'game/.rooms'),'-public',str(public)],env=base,cwd=runtime))
    children.append(subprocess.Popen([str(runtime/'cs16-gateway')],env=base,cwd=runtime))
    sys.exit(children[-1].wait())
except KeyboardInterrupt: pass
finally:
    for child in children:
        if child.poll() is None: child.terminate()
    for child in children:
        try: child.wait(timeout=10)
        except subprocess.TimeoutExpired: child.kill()
