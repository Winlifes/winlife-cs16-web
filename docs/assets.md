# 游戏数据与浏览器模块

源码可以公开；商业游戏数据不随源码发行。地图、模型、纹理、音效、Logo 和由它们转换的网页图片均由部署者自行提供。`.gitignore` 忽略整个生成目录和 ZIP/WASM 文件。

## 浏览器引擎

先在 `web/` 运行 `npm ci --ignore-scripts`，然后：

```sh
node tools/prepare-browser.mjs --modules /path/to/verified/wasm
# 或使用 native-sources.json 记录的恢复来源（仅程序模块，不是游戏素材）：
node tools/prepare-browser.mjs --download-verified
```

引擎、文件系统、WebGL2 渲染器来自固定 npm 包。三个 CS 模块使用记录的 SHA256 校验，任何下载不匹配都会停止。下载端不可用时请提供已有的固定版本模块；不要用未知版本替换而不更新 ABI 检查。上游源码与许可证见 `THIRD_PARTY_NOTICES.md`。

## 本地游戏数据

将自己有权使用的游戏安装整理成含 `valve/`、`cstrike/` 的目录。先完成原生构建，再执行：

```sh
python3 -m pip install Pillow
# Linux 示例：设置实际安装的中文字体路径。
export CS16_FONT=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
python3 tools/prepare-game.py --data /path/to/your/game-data
```

macOS 默认使用系统中文字体。工具按素材扩展名复制本地数据，跳过日志、插件、程序、用户配置和密钥，生成本机 `.runtime/game`、浏览器资源 ZIP、摘要清单和网页图标；管理令牌由本机随机生成，权限为 0600。工具不把这些文件提交 Git。

本机资源的摘要与别人的资源包可能不同，生成后请一起发布资源 ZIP 和 `assets-manifest.json`。可在清单的 `browserArchive.url`、`wasmBaseUrl` 设置自己控制的资源服务；跨源下载需要正确 CORS/CORP 响应头，且摘要必须一致。

部署者也可以将新增地图和所需资源放入独立 ZIP，保留压缩包内的 `cstrike/` 和 `valve/` 目录层级。将文件命名为 `maps-<SHA256>.zip`，放到静态目录，清单中添加 `mapArchive.sha256` 并补齐 `maps` 列表。服务端同时需要相同版本的 BSP，玩家的基础资源缓存可继续使用。

双箱庭院与折角回廊的几何和出生点在 `tools/build-duel-maps.py` 中。该工具使用本地 SDHLT 和 `valve/halflife.wad` 生成 BSP，纹理从游戏安装加载。

中文传统商店转换只修改显示贴图和文字，购买条件和价格由原生服务器校验。人机还需要对应地图的 YaPB 导航数据；SDK 构建时生成的 `graphs/` 会在运行时准备阶段复制。
