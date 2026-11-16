#!/usr/bin/env python3
"""Build native engine/game libraries, without installing or restarting services."""
import argparse
import os
from pathlib import Path
import platform
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
p = argparse.ArgumentParser()
p.add_argument('--jobs', type=int, default=2)
p.add_argument('--sources', type=Path, default=root / '.native/sources')
a = p.parse_args()
def run(cmd, cwd): subprocess.run(cmd, cwd=cwd, check=True)
engine = a.sources.resolve() / 'xash3d'
sdk = a.sources.resolve() / 'cs16-sdk'
run([sys.executable, 'waf', 'configure', '-T', 'release', '-d', '--64bits', '--enable-bundled-deps', '--disable-werror'], engine)
run([sys.executable, 'waf', 'build', '-j' + str(a.jobs)], engine)
args = ['cmake', '-S', str(sdk), '-B', str(root / '.native/build/cs16-sdk'), '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_POLICY_VERSION_MINIMUM=3.5', '-DXASH_64BIT=ON', '-DBUILD_CLIENT=OFF', '-DBUILD_MAINUI=OFF', '-DBUILD_SERVER=ON', '-DYAPB_LTO=OFF']
if platform.system() == 'Darwin':
    if platform.machine() != 'arm64': raise RuntimeError('The macOS recipe targets Apple Silicon')
    args += ['-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0']
run(args, root)
run(['cmake', '--build', str(root / '.native/build/cs16-sdk'), '-j', str(a.jobs)], root)
print('Built binaries are in .native; existing deployments have not been changed.')
