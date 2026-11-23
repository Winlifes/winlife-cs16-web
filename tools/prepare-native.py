#!/usr/bin/env python3
"""Fetch fixed open-source revisions and apply the published native patches."""
import argparse
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--destination', type=pathlib.Path, default=ROOT / '.native/sources')
parser.add_argument('--jobs', type=int, default=4)
args = parser.parse_args()
pins = json.loads((ROOT / 'native-sources.json').read_text())

def run(command, cwd=None):
    subprocess.run(command, cwd=cwd, check=True)

def clone(name, pin, patch=None):
    target = args.destination.resolve() / name
    if not target.exists():
        run(['git', 'clone', pin['origin'], str(target)])
    if patch and subprocess.check_output(['git','rev-parse','HEAD'],cwd=target,text=True).strip()==pin['commit']:
        if subprocess.run(['git','apply','--reverse','--check',str(ROOT/'patches'/patch)],cwd=target,capture_output=True).returncode==0:
            print(f'Already prepared: {target}')
            return target
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all'], cwd=target).strip():
        raise RuntimeError(f'Existing modified checkout: {target}; keep it or choose another destination')
    run(['git', 'checkout', '--detach', pin['commit']], target)
    run(['git', 'submodule', 'update', '--init', '--recursive', '--jobs', str(args.jobs)], target)
    return target

engine = clone('xash3d', pins['xash3d-arm64'], 'xash3d-winlife.patch')
sdk = clone('cs16-sdk', pins['cs16-sdk'])
for name in ['ReGameDLL_CS', 'yapb']:
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=sdk / '3rdparty' / name, text=True).strip()
    assert actual == pins['cs16-sdk-20261113/3rdparty/' + name]['commit'], (name, actual)
for repo, patch in [(engine, 'xash3d-winlife.patch'), (sdk / '3rdparty/ReGameDLL_CS', 'regamedll-combat.patch'), (sdk / '3rdparty/ReGameDLL_CS', 'regamedll-buy-undo.patch'), (sdk / '3rdparty/ReGameDLL_CS', 'regamedll-party.patch'), (sdk / '3rdparty/yapb', 'yapb-apple-arm64.patch'), (sdk / '3rdparty/yapb', 'yapb-team-quota.patch')]:
    # The newer patch adds context beside the combat includes. Check it first
    # on prepared trees, so overlapping context does not reapply the old patch.
    if patch in ('regamedll-combat.patch', 'regamedll-buy-undo.patch') and subprocess.run(['git', 'apply', '--ignore-space-change', '--reverse', '--check', str(ROOT / 'patches/regamedll-party.patch')], cwd=repo, capture_output=True).returncode == 0:
        continue
    if patch == 'regamedll-combat.patch' and subprocess.run(['git', 'apply', '--reverse', '--check', str(ROOT / 'patches/regamedll-buy-undo.patch')], cwd=repo, capture_output=True).returncode == 0:
        continue
    file = str(ROOT / 'patches' / patch)
    # Idempotent: do not overwrite a modified tree or apply a patch twice.
    apply = ['git', 'apply']
    if patch == 'regamedll-party.patch':
        apply.append('--ignore-space-change')
    reverse = subprocess.run([*apply, '--reverse', '--check', file], cwd=repo, capture_output=True)
    if reverse.returncode == 0:
        continue
    run([*apply, '--check', file], repo)
    run([*apply, file], repo)
print('Pinned native sources prepared. Read docs/native-build.md before compiling.')
