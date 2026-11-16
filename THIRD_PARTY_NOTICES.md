# Third-party components

This repository publishes the Winlife web shell, gateway and build tools. It does not include commercial game data, engine binaries, server credentials or deployment logs.

| Component | Origin / pin | License and scope |
| --- | --- | --- |
| Web transport / loader integration | [webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs), npm `xash3d-fwgs@1.2.2` | MIT for the wrapper; upstream engine/modules retain their own licenses. Original notice: `licenses/webxash-MIT.txt`. |
| Native engine patches | [FWGS/xash3d-fwgs](https://github.com/FWGS/xash3d-fwgs), `707596f4905689ec224e993fcaa4d4ad66aa67d6` | GPL-3.0-or-later, including `patches/xash3d-winlife.patch`. Copyright FWGS contributors and Winlife contributors. Full text: `licenses/GPL-3.0-or-later.txt`. |
| CS16Client source | [FWGS/cs16-client](https://github.com/FWGS/cs16-client), `f8ecf4962c1878d7d9ad0d329aa7e53fe0addcab` | GPL-2.0-or-later with upstream linking exception; see `licenses/CS16Client.txt`. Source is fetched separately, not relicensed by this repository. |
| ReGameDLL_CS changes | SDK submodule, `29594522d2426af66cf18f9e5a0f4b3aee21bd95` | Upstream MIT license/transition notice in `licenses/ReGameDLL-*`; applies to `patches/regamedll-combat.patch`. Original file notices are preserved. |
| YaPB / Apple build patch | [yapb/yapb](https://github.com/yapb/yapb), `6ed2ef55eab321bdfe0cc995742903b952a95d15` | Upstream UNLICENSE, `licenses/YaPB-UNLICENSE.txt`. Nested dependencies retain their notices. |
| Browser CS modules | Hash-pinned recovery URLs in `native-sources.json` | Optional download to ignored local directories. These artifacts are not committed or redistributed here. The recovered client ABI is fixed; source provenance/build limits are described in `docs/assets.md`. |
| Go / npm dependencies | `gateway/go.sum`, `web/package-lock.json` | Installed via official package registries; each dependency retains its own license. |

Valve game names and game artwork remain their respective owners' property. UI artwork and resource archives are generated locally from operator-provided data and are not part of the MIT source distribution. Upstream resource scripts/assets retain their licenses when acquired separately. The game is an unofficial community deployment and is not affiliated with Valve.

The earlier `Elkhan-Isayev/cs16-web` deployment was a reference for runtime evaluation. Its missing Docker image is not required, and its commercial game archive/custom map is not included here.
