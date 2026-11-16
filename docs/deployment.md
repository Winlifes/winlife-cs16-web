# 部署说明

生产目录建议为 `/opt/winlife-cs16`，包含 `game/`、`public/`、`engine/`、两个 Go 程序和仅管理员可读的 `admin-token`。路径通过 `.env.example` 中的 `CS16_*` 环境变量配置，示例不含真实凭据。

1. 按原生构建和资源说明准备引擎、ReGameDLL、YaPB 及自己提供的游戏数据。
2. 在 `gateway/` 执行 `go build -o ../.runtime/cs16-gateway .` 和 `go build -o ../.runtime/damage-publisher ./cmd/damage-publisher`。
3. 在 `web/` 执行 `npm run build`，将 `dist/` 部署到独立 `public/`。子路径部署如 `/cs/` 使用 `npm run build -- --base=/cs/`。
4. 运行网关与伤害发布器。Linux 可使用 `deploy/systemd/` 模板，创建自己的专用账号、目录和环境文件后启用；使用模板前创建 `public/combat-reports-v1` 并赋予服务账号写权限。macOS 可用用户 LaunchAgent 执行相同程序。
5. HTTPS 反向代理转发到回环网关（通常 27016），保留 WebSocket 升级，并设置 `Cross-Origin-Opener-Policy: same-origin` 与 `Cross-Origin-Embedder-Policy: require-corp`。参考 `deploy/Caddyfile.example`。

管理接口默认仅绑定 127.0.0.1:27017，必须使用令牌。不要把它暴露到外网，也不要将令牌放入静态目录。本机管理示例：

```sh
python3 tools/admin.py --room ROOM_ID --token-file /opt/winlife-cs16/admin-token status
```

网关在根进程管理房间，每房启动独立网关和原生游戏进程。槽位 n 使用 UDP `27100+4n`（原生、回环）、HTTP `27101+4n`（回环）、管理 `27102+4n`（回环）、WebRTC UDP `27103+4n`。最大 1–8 个房间，机器资源不足时减少 `CS16_MAX_ROOMS`。WebSocket 模式只需对外 HTTPS；WebRTC 模式还需放通对应 UDP 并在 NAT 环境配置可达公网地址。

伤害发布器只增量读取各房 `gateway.log`，原子写入派生 JSON。根网关与发布器必须看到同一份房间目录。房间退出会清理资源；原生文件更新应原子替换，避免覆盖房间仍持有的硬链接。

## 静态更新

`web/release-notes.json` 是更新日志来源；构建生成 `release.json` 与嵌入客户端的构建标识。先传全部新哈希资源，再原子切换 HTML 和清单；清单设置 `no-store` 或 `no-cache`，旧哈希资源保留。新旧清单读取失败时不会阻塞游戏。

更新提示不会中断正在进行的比赛。大厅自动提示；比赛中显示小提示，直到整场结算才允许刷新。用户查看更新日志后点“稍后更新”，同一发布在当前页面不重复弹出。
