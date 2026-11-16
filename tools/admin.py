#!/usr/bin/env python3
"""Call a loopback-only private room console; tokens stay in a local file."""
import argparse
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request

p = argparse.ArgumentParser()
p.add_argument('--room', required=True)
p.add_argument('--url', default='http://127.0.0.1:27017')
p.add_argument('--token-file', type=Path, default=Path(os.environ.get('CS16_ADMIN_TOKEN_FILE', '.runtime/admin-token')))
p.add_argument('command')
a = p.parse_args()
request = urllib.request.Request(a.url + '/command?' + urllib.parse.urlencode({'room': a.room}), data=json.dumps({'command': a.command}).encode(), headers={'Content-Type': 'application/json', 'X-CS16-Admin': a.token_file.read_text().strip()})
with urllib.request.urlopen(request, timeout=5) as response:
    print(response.read().decode())
