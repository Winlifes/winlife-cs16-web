# Winlife CS 1.6 Web

[![CI](https://github.com/Winlifes/winlife-cs16-web/actions/workflows/ci.yml/badge.svg)](https://github.com/Winlifes/winlife-cs16-web/actions/workflows/ci.yml)

中文 CS 1.6 浏览器联机平台：WebGL/WASM 客户端，Go 房间网关，原生 Xash3D + ReGameDLL + YaPB 服务端。支持 macOS Apple Silicon 和 Linux AMD64 服务端构建。

这是兼容引擎的 WebAssembly 版本，游戏逻辑与射击判定由原生服务端执行。仓库提供平台源码与原生补丁；运行游戏需要部署者自行提供合法游戏数据。

## 功能

- 昵称登录、自动保存昵称；建立/加入房间，开局后仍可加入；每房独立进程，2–16 人配置。
- WebRTC 无序零重传数据通道，或适合公网反向代理的 WebSocket 通道；网关对接本机 UDP 原生服务器。
- 中文队伍选择、快捷商店、推荐购买套装、人机数量和难度、鼠标灵敏度。
- 买错装备可撤回上次购买（含整笔套装），由原生服务端按实际扣费退款；仅限购买区、购买时间内且装备未使用或转移。
- FPS、原生延迟、中文公屏、队友名字、固定 CSS 像素准星。
- 死亡/小局结束的双向伤害统计：玩家、武器、身体部位、枪数与伤害；散弹另列弹丸数。
- MR15 比分与自动换边；整场结束进入结算，房主手动继续或成员退出；原生 Tab 计分板保留原有字段，并增加 DMG 整场累计伤害列。
- 结算后房主退出将解散房间，其他成员自动返回大厅；普通成员退出不影响房间。
- 更新日志、每版本一次的更新说明、新版本检测；对局中只轻提示，结算后再刷新。

## 开发与检查

需要 Node.js 24+、Go 1.25.1+、Python 3。网页的原生 ABI 测试需要固定版本的 CS WASM 模块（不会下载地图、模型、音效等游戏素材）。

```sh
cd web
npm ci --ignore-scripts
cd ..
# 使用自己已有的固定版本模块，或按 docs/assets.md 从已记录镜像验证下载：
node tools/prepare-browser.mjs --download-verified
cd web
npm run typecheck
npm test
npm run build
cd ../gateway
go test -race -timeout 60s ./...
go build -o ../.runtime/cs16-gateway .
go build -o ../.runtime/damage-publisher ./cmd/damage-publisher
```

原生客户端存在严格 SHA256 / 加载器检查。升级 `xash3d-fwgs` 或 CS WASM 前，应重新核对 `web/engine/native-telemetry.js` 的函数表与结构布局；请勿直接跳过摘要检查。武器价格测试使用带来源和摘要的固定常量快照。

## 运行一套本地服务

完整步骤见 [原生构建](docs/native-build.md)、[游戏资源](docs/assets.md) 和 [部署](docs/deployment.md)。以下命令不会使用任何作者的私有服务器或凭据：

```sh
python3 tools/prepare-native.py
python3 tools/build-native.py --jobs 2
# --data 目录下必须有自己的 valve/ 和 cstrike/；需要 Pillow 和中文字体。
python3 tools/prepare-game.py --data /path/to/your/game-data
cd web && npm run build && cd ..
# 先按上面的 Go 命令构建 .runtime 中的两个程序
python3 tools/serve-local.py
# 在另一个终端启动开发网页（默认代理本机 27016 网关）：
cd web && npm run dev
```

浏览器访问 `http://127.0.0.1:5174/`。默认后端仅监听回环；局域网/公网需配置 HTTPS、跨源隔离响应头与 WebSocket 转发，示例在 `deploy/`。部署时网关与伤害发布器都要运行。

默认地图配置为 `de_dust2`、`de_inferno`、`cs_assault`、`cs_italy`、`cs_mansion`。请提供实际使用的地图；`cs_mansion` 是自定义地图，仓库不提供。调整地图列表时同步修改网关 `allowedMaps` 与网页选择项。

## 目录

| 路径 | 内容 |
| --- | --- |
| `web/` | TypeScript 界面、网络传输、原生 HUD 桥、版本提示及测试 |
| `gateway/` | Go 多房间管理、WebRTC/WebSocket UDP 网关、比赛状态机、战斗日志发布器 |
| `patches/` | 原生暂停/连接释放、伤害观察、Apple ARM64 构建补丁 |
| `tools/` | 固定源码准备、构建、本地资源准备与运行工具 |
| `deploy/` | 服务配置、Caddy 与 systemd 模板 |
| `native-sources.json` | 上游提交和浏览器模块摘要 |

## 发布与维护

更新 `web/release-notes.json` 的版本、日期与更新条目后构建。构建自动生成 `release.json`，内容摘要标识发布；局域网和公网的同一份源码共享相同标识。先上传新 JS/CSS，再原子替换 HTML 和版本清单；不要只发布清单。保留旧哈希资源以支持已打开的页面。

浏览器每分钟及重新获得焦点时检查更新。大厅会显示弹窗，对局中仅显示提示，结算时再提供刷新按钮；从不自动重载正在进行的对局。首次安装此功能之前打开的旧页面，仍需手动刷新一次。

不要把 `.runtime/`、游戏数据、管理令牌、SSH 密钥、`.env` 或私人日志提交到 Git。更新原生 DLL/网关前，先等待房间退出；静态网页可以在保留旧资源的前提下单独更新。

## 许可证

平台原创代码为 MIT；原生补丁和第三方组件遵循各自上游许可证，详见 [第三方说明](THIRD_PARTY_NOTICES.md)。仓库不含商业游戏素材、WASM/原生二进制、游戏资源下载包或私人部署资料。
