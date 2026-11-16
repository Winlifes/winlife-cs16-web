#!/usr/bin/env python3
"""Check the fixed SDK's wasm32 layouts used by the browser HUD bridge."""
from pathlib import Path
import subprocess
import tempfile
import os

root = Path(__file__).resolve().parents[2]
sdk = Path(os.environ.get("CS16_SDK_DIR",root / ".native/sources/cs16-sdk"))
api = (sdk / "engine/APIProxy.h").read_text().split("typedef struct cl_enginefuncs_s")[1].split("} cl_enginefunc_t")[0]
fields = [line.strip().split()[-1].rstrip(";") for line in api.splitlines() if ";" in line and not line.lstrip().startswith("//")]
for field, slot in {"pfnGetCvarFloat":15,"pfnServerCmd":19,"pfnGetPlayerInfo":21,"GetMaxClients":36,"GetLocalPlayer":51,"GetEntityByIndex":53,"PM_TraceLine":59,"pfnGetLevelName":74,"*pTriAPI":82,"*pEventAPI":84,"*pNetAPI":86}.items():
    assert fields[slot] == field, (field,slot,fields[slot])
source = r'''
typedef unsigned char byte; typedef int qboolean; typedef float vec3_t[3];
struct color24 {byte r,g,b;}; struct colorVec {unsigned r,g,b,a;};
#define PROGS_H
#include "cl_entity.h"
#include "pmtrace.h"
#include "net_api.h"
typedef int HSPRITE; struct wrect_t {int left,right,top,bottom;};
#include "ammo.h"
#define OFFSET(type, field) __builtin_offsetof(type,field)
static_assert(sizeof(cl_entity_t)==3000);
static_assert(OFFSET(cl_entity_t,curstate)==688);
static_assert(OFFSET(cl_entity_t,origin)==2888);
static_assert(OFFSET(cl_entity_t,model)==2964);
static_assert(OFFSET(entity_state_t,solid)==58);
static_assert(OFFSET(entity_state_t,messagenum)==12);
static_assert(OFFSET(entity_state_t,usehull)==200);
static_assert(OFFSET(entity_state_t,iuser1)==260);
static_assert(OFFSET(pmtrace_t,fraction)==16);
static_assert(sizeof(net_status_t)==72);
static_assert(OFFSET(net_status_t,packet_loss)==44);
static_assert(OFFSET(net_status_t,latency)==48);
static_assert(OFFSET(WEAPON,iId)==156);
'''
player_info=(sdk/"engine/cdll_int.h").read_text().split("typedef struct hud_player_info_s",1)[1].split("hud_player_info_t;",1)[0]
source+='\ntypedef unsigned long long uint64;\ntypedef struct hud_player_info_s'+player_info+'hud_player_info_t;\n'
source+='static_assert(OFFSET(hud_player_info_t,name)==0);\nstatic_assert(sizeof(hud_player_info_t)<=40);\n'
with tempfile.TemporaryDirectory(prefix="winlife-cs-abi-") as directory:
    path = Path(directory)/"check.cpp"
    path.write_text(source)
    subprocess.run(["clang","-target","wasm32","-std=c++17","-fsyntax-only",*[argument for folder in ["common","engine","pm_shared","cl_dll/include/hud"] for argument in ["-I",str(sdk/folder)]],str(path)],check=True)
print("GoldSrc wasm32 HUD, network, weapon and entity ABI verified")
