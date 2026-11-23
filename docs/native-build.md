# 原生服务端构建

已验证的平台：macOS ARM64（Apple Silicon）和 Linux AMD64。需要 C/C++ 编译器、CMake、Ninja、Python 3、Git；Linux 另需基础开发工具。使用小于 4 GB 内存的主机时建议 `--jobs 1`。

`native-sources.json` 固定 Xash3D、CS16Client 及 SDK 内的 ReGameDLL/YaPB 提交。`tools/prepare-native.py` 获取递归子模块，并应用原生补丁。若已有不兼容的修改，工具会停止以保留工作目录。源码和产物在被 Git 忽略的 `.native/`。

```sh
python3 tools/prepare-native.py
python3 tools/build-native.py --jobs 2
```

补丁包含：

- Xash3D：Darwin 专用服务器退出时保留映射，按 UDP 端点清理玩家，控制台专属结算暂停；暂停仅停止模拟，继续处理网络和管理命令；不累积暂停时间，不因真人全部断开而释放结算暂停。
- Xash3D 的 `-winlife-gateway` 启动参数启用 UDP 端点匹配。网关为每个浏览器分配独立端口，确保同时进入房间的客户端各自占用一个连接位置。
- ReGameDLL：只观察原生射击编号、TraceAttack 命中部位与 TakeDamage 的真实血量变化；不改变伤害或护甲公式。散弹的原生批量结算按命中权重分摊展示。
- ReGameDLL 购买撤回：记录原生实际扣费及新增装备/弹药，校验库存、使用状态和原生购买条件后退款；单件与套装均只允许撤回一次。换枪掉落的原武器不复制或自动找回。替换 DLL 时应原子替换，已有房间需重建才能载入。
- ReGameDLL 房间模式。生化感染和跑图躲猫猫由游戏服务端判定角色、阶段和胜负。安装带有该补丁的原生库后，网关才在建房菜单展示这两种模式。
- 个人竞技。YaPB 从当前地图的导航图布置出生点，ReGameDLL 在出生时检查碰撞和附近玩家，然后随机选择。没有可用导航点时，会从两边的地图出生点选择。
- 个人竞技的主武器记录保存在玩家当前连接的服务端状态中。成功购买会更新该记录，撤回会恢复购买前的记录，复活时按原生规则配发该武器和弹药。
- YaPB：Apple ARM64 的 libc++ / 部署目标参数。
- YaPB 阵营配额：`yb_winlife_quota_t` / `yb_winlife_quota_ct` 分别指定两边的人机目标，均为 -1 时保留原生自动分配。调整时只增减所需阵营的人机，保留真人优先占位；中场由网关同时更新配额和换边。

完整 SDK 内的素材与资源不属于本仓库发行内容；构建 SDK 可能按上游脚本获取人机导航数据。准备运行时请保留其许可证，不要把得到的资源提交到源码仓库。

如需核对浏览器 ABI，安装支持 wasm32 语法检查的 clang 后运行：

```sh
python3 web/engine/verify_abi.py
```

本项目的浏览器模块为历史公开构建恢复件。固定摘要和原生源的提交不代表已经实现 WASM 的逐字节可复现编译；替换客户端版本时必须重新验证桥接 ABI。
