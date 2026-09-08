# ECHO 一起听服务器

自托管的房间服务与实时 Opus 转发。房主上传一份压缩音频，朋友无需拥有同一首歌。服务器不解码、不转码、不保存音乐文件。需要支持此协议的 ECHO 客户端；本仓库不包含网页版播放器。

## 部署

准备 Docker Compose、Node.js 22+、一条解析到服务器的域名，放行 TCP 80/443。

```sh
git clone https://github.com/Moekotori/echo-listen-together.git
cd echo-listen-together
npm run setup
```

向导生成 `.env`、启动容器、通过 Caddy 自动配置 HTTPS，并打印 ECHO 连接地址及连接码。不会覆盖已有配置。公网健康检查失败会明确报错，不能把容器启动视为可连接。

无需 Node 的手动方式：复制 `.env.example` 为 `.env`，设置 DOMAIN、PUBLIC_URL 和随机 ADMIN_TOKEN，然后运行 `docker compose up -d --build`。更新：`git pull --ff-only` 后重新运行该命令。服务端重启会清空临时房间。

本地开发 / 可信局域网：`npm ci && npm start`，连接 `ws://localhost:8787`。公网使用 wss；明文 ws 无法保护房间密码与邀请凭证。只有公网 IP 时先配置有效 TLS 入口和 PUBLIC_URL，默认向导不会关闭证书验证。

## 容量与内存

`.env`：MAX_USERS=200（包括大厅连接、房主和短期断线保留）、MAX_ROOMS=30、MAX_ROOM_USERS=10。三层上限独立强制执行。单房容量不能超过管理员上限；房主离开会结束节目并让成员离房，空房 60 秒后回收。断线保留 20 秒。

默认音频为 48kHz 双声道 Opus、20ms 包；200 个听众使用 128kbps 时纯音频约 25.6Mbps，非实测承诺。每个慢接收端超过 16KiB 待发音频时断开重连，避免无界缓存和补播旧声音。首版采用 TLS WebSocket 转发，丢包网络会有 TCP 队头阻塞，后续可增加 UDP/QUIC 传输；不得声称严格同拍或已验收大陆晚高峰。

## 管理与隐私

SERVER_PASSWORD 可选，用于限制连接服务器。房间密码经随机盐 scrypt 后仅驻留内存。邀请有效 5 分钟，单次使用，每房最多 32 个；房主可撤销全部邀请。邀请不能突破人数上限。ADMIN_TOKEN 只供管理员通过 `Authorization: Bearer …` 访问 `/admin/status`，不要放进连接码或截图；`/health` 不需认证。

只向明确连接的服务器发送昵称、房间信息、可选曲名和用户明确启用的实时音频。不上传曲库、文件路径、封面、歌词和播放历史。离开后释放会话与缓冲；本程序不记录音频/密码/邀请，不开启访问日志。服务器运营者可以看到经过服务器的数据。只分享有权传输的内容。

## 开发验证

`npm test` 覆盖真实 WebSocket 房间权限、容量、音频转发和重连。GitHub CI 同时检查容器构建。生产线路、200 人容量和 Steam 双账号体验需分别验收。

协议见 [PROTOCOL.md](PROTOCOL.md)。源代码的公开可见性不自动授予再分发许可；项目许可证由维护者决定。第三方依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
