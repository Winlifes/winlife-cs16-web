# 原生服务端构建

已验证的平台：macOS ARM64（Apple Silicon）和 Linux AMD64。需要 C/C++ 编译器、CMake、Ninja、Python 3、Git；Linux 另需基础开发工具。使用小于 4 GB 内存的主机时建议 `--jobs 1`。

`native-sources.json` 固定 Xash3D、CS16Client 及 SDK 内的 ReGameDLL/YaPB 提交。`tools/prepare-native.py` 获取递归子模块，并应用三个补丁；若已有不兼容的修改，会停止，避免覆盖工作目录。源码和产物在被 Git 忽略的 `.native/`。

```sh
python3 tools/prepare-native.py
python3 tools/build-native.py --jobs 2
```

补丁包含：

- Xash3D：Darwin 专用服务器退出时保留映射，按 UDP 端点清理玩家，控制台专属结算暂停；暂停仅停止模拟，继续处理网络和管理命令；不累积暂停时间，不因真人全部断开而释放结算暂停。
- ReGameDLL：只观察原生射击编号、TraceAttack 命中部位与 TakeDamage 的真实血量变化；不改变伤害或护甲公式。散弹的原生批量结算按命中权重分摊展示。
- YaPB：Apple ARM64 的 libc++ / 部署目标参数。

完整 SDK 内的素材与资源不属于本仓库发行内容；构建 SDK 可能按上游脚本获取人机导航数据。准备运行时请保留其许可证，不要把得到的资源提交到源码仓库。

如需核对浏览器 ABI，安装支持 wasm32 语法检查的 clang 后运行：

```sh
python3 web/engine/verify_abi.py
```

本项目的浏览器模块为历史公开构建恢复件。固定摘要和原生源的提交不代表已经实现 WASM 的逐字节可复现编译；替换客户端版本时必须重新验证桥接 ABI。
