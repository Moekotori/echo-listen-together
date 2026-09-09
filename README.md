# ECHO 一起听服务器

**简体中文** | [English](README.en.md)

自托管的 ECHO 共听房间与实时 Opus 转发服务。房主共享一份音频，朋友无需拥有同一首歌。服务器不解码、不转码、不保存音乐文件。

需要支持一起听协议的 **ECHO 桌面客户端**。本仓库是服务端，不包含网页播放器。

## 1. 部署前准备

- 一台可以运行 Docker 的 Linux 服务器，安装 Git、Docker Engine 和 Docker Compose 插件（命令为 `docker compose`）。安装方式见 [Docker 官方文档](https://docs.docker.com/engine/install/)。
- 使用下面的自动向导时，主机还需要 **Node.js 22 或更新版本**；不需要先运行 `npm install`。不想安装 Node 可使用第 3 节手动部署。
- 一个公网 IPv4，或已解析到此服务器的域名。例如将 `listen.example.com` 的 A 记录指向服务器 IPv4。
- 云安全组和系统防火墙放行 **TCP 80、443**，且这两个端口未被其他服务占用。不要将内部 8787 端口开放到公网。
- 当前账号能运行 Docker；以下命令均在服务器终端执行。

先检查环境：

```sh
git --version
docker version
docker compose version
node --version
```

## 2. 一键部署（推荐）

```sh
git clone https://github.com/Moekotori/echo-listen-together.git
cd echo-listen-together
npm run setup
```

输入域名或公网 IPv4，例如 `listen.example.com`，**不加 `https://`、端口或路径**。

向导会自动：

1. 生成权限为 `600` 的 `.env` 和随机管理员凭据。
2. 选择域名或 IP 的 Compose 配置，构建并启动 Docker 容器。
3. 使用 Caddy 申请并自动续期可信 HTTPS 证书。
4. 检查公开地址，打印连接地址、连接码、密码说明、容量限制和管理命令。

看到 `公网健康检查：检查通过` 后，再从 ECHO 连接。容器启动不等于公网检查成功；首次证书申请可能需要等待。若失败，按排障章节检查后重新运行信息命令，不要反复删除配置重新申请证书。

**只有 IP 也能部署。** 向导会使用 `compose.ip.yaml` 中的 Caddy 2.11.4 和 Let’s Encrypt 短期 IP 证书。必须保持网关运行、端口可达和数据卷持久化以便自动续期，不需要绕过证书验证。

如果已有 `.env`，向导会停止以避免覆盖配置和凭据。请使用第 6 节的更新命令。

## 3. 不安装 Node：手动 Docker 部署

先克隆并进入仓库，然后复制配置；已有 `.env` 时不要覆盖：

```sh
cp -n .env.example .env
chmod 600 .env
```

编辑 `.env`，域名部署至少修改：

```dotenv
COMPOSE_PROJECT_NAME=echo-listen
COMPOSE_FILE=compose.yaml
DOMAIN=listen.example.com
PUBLIC_URL=wss://listen.example.com
SERVER_NAME=My ECHO Server
```

纯 IP 部署改为：

```dotenv
COMPOSE_FILE=compose.yaml:compose.ip.yaml
DOMAIN=你的公网IPv4
PUBLIC_URL=wss://你的公网IPv4
```

使用密码管理器生成随机管理员令牌，在 `.env` 中替换 `ADMIN_TOKEN` 的占位值。`SERVER_PASSWORD` 是可选的服务器访问密码；留空允许所有知道地址的人连接。不要分享 `.env`，不要将真实密码写进教程、截图或 Git。

```sh
docker compose up -d --build
docker compose ps
docker compose exec relay npm run info
```

`info` 从运行容器读取实际配置，最长用 5 秒检查公开健康接口，保留 TLS 验证；失败时退出码非零。检查通过只代表从执行机器可达。

## 4. 在 ECHO 中一起听歌

1. 打开 ECHO → **一起听歌**。
2. 将部署输出的 `wss://…` 地址或 `echo-listen:…` 连接码粘贴到“服务器地址或连接码”。
3. 填写昵称。服务器未设置访问密码时，将“服务器密码”留空。
4. 连接后创建房间，设置房间名、可选密码、人数上限；隐藏房间不会出现在公开列表。
5. 房主使用原生音频引擎播放本地 PCM 歌曲，点击 **开启音频共享**。当前不支持共享远程来源及 DSD 直通。
6. 朋友连接同一服务器，选择公开房间，或通过房间 ID／邀请连接码加入；不需要有同一份音乐文件。加入会暂停个人播放，队列保留。
7. 听众可以独立调节共听音量。房主停止共享不停止自己的本地播放；房主结束房间会让成员离房。

邀请连接码 **5 分钟有效、仅能使用一次**，房主可以撤销；不要与仅含服务器地址的部署连接码混淆。密码邀请失效后可让房主重新生成。

Steam 邀请需要通过 Steam 启动兼容的 ECHO 客户端，并具备可用的 Steam 集成。服务器部署本身不会配置 Steamworks；状态文案发布和双账号邀请验收是独立步骤。暂不可用时可使用连接码。

## 5. 配置说明

修改 `.env` 后运行 `docker compose up -d` 重新创建受影响的容器；仅 `restart` 不会载入修改后的环境变量。

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `DOMAIN` | `listen.example.com`（模板） | Caddy 的公网域名或 IPv4，不含协议 |
| `PUBLIC_URL` | `wss://listen.example.com`（模板） | 客户端公开连接地址，与证书匹配 |
| `SERVER_NAME` | `ECHO Listening Room`（模板） | 客户端显示的服务器名 |
| `MAX_USERS` | `200` | 总连接用户上限，包含大厅、房主和短期断线保留 |
| `MAX_ROOMS` | `30` | 同时存在的房间上限 |
| `MAX_ROOM_USERS` | `10` | 每房人数上限，包含房主 |
| `RECONNECT_SECONDS` | `20` | 短期断线会话保留时间 |
| `EMPTY_ROOM_SECONDS` | `60` | 遗留空房回收时间；房主主动离开立即结束房间 |
| `SERVER_PASSWORD` | 空 | 连接服务器所需密码，与房间密码不同 |
| `ADMIN_TOKEN` | 向导随机生成 | 管理接口凭据，不用于 ECHO 连接 |
| `HOST` / `PORT` | `0.0.0.0` / `8787` | 容器内部监听，通常无需修改 |

管理员可使用 `Authorization: Bearer …` 访问 `/admin/status` 查看用户、房间和连接数。令牌只通过安全的请求头传入，不要放进 URL。`/health` 是不需认证的健康接口。

## 6. 日常管理与更新

在仓库部署目录执行：

```sh
# 查看连接信息和公开地址检查结果
docker compose exec relay npm run info
# 查看容器状态及最近日志
docker compose ps
docker compose logs --tail=80 relay gateway
# 更新服务端
git pull --ff-only
docker compose up -d --build
# 停止 / 恢复服务
docker compose stop
docker compose start
```

**服务端重启会清空内存中的临时房间和邀请，用户需要重新连接并建房。** 更新前安排空闲时段。不要使用 `docker compose down -v`，它会删除证书数据卷；保留 `.env`、`caddy_data` 和 `caddy_config`。恢复备份时同样需要保护其中的凭据。

## 7. 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| 找不到 `docker compose` | 安装 Docker Compose 插件，确认 Docker daemon 已启动且账号有权限 |
| 80/443 已占用 | 检查已有网站或反向代理；不要直接停掉其他业务。本教程默认 Caddy 独占这两个端口 |
| 容器启动但公网检查失败 | 核对 A 记录、公网 IP、安全组、防火墙和 `docker compose logs --tail=80 gateway`；有错误 AAAA 记录时也要修正 |
| 证书错误 | 确认地址与证书匹配、系统时间正确、80/443 可达；保留数据卷并检查 Caddy 日志，不关闭 TLS 验证 |
| 浏览器打开根地址返回 404 | 正常：没有网页播放器。健康接口是 `/health`，共听使用 ECHO 客户端 |
| 密码不正确 | 区分服务器访问密码、房间密码和管理员令牌；管理员令牌不能用于加入房间 |
| 找不到房间或邀请失效 | 检查是否连接同一服务器；隐藏房间用 ID／邀请加入；请房主重新生成一次性邀请 |
| 能进房但没声音 | 房主需播放支持的本地 PCM 并开启共享；检查听众音量和输出设备，异常时点击重试音频连接 |
| 跨地区卡顿 | 检查实际线路的延迟、丢包和拥塞；标称带宽不能保证大陆晚高峰体验 |

## 8. 验证与容量边界

开发和远端检查需要 Node.js 22+：

```sh
npm ci
npm test
# 针对自己的服务器：创建一个临时私密房间，结束时清理
node scripts/smoke-remote.mjs wss://listen.example.com
# 本机短时合成转发检查，不连接公网
node scripts/smoke-capacity.mjs
```

有服务器访问密码时通过 `SERVER_PASSWORD` 环境变量安全提供，不放进命令参数或 URL。测试使用合成数据，不需要上传私人歌曲。

真实 WebSocket 测试覆盖权限、容量、密码并发、重连接管、房间通知和音频转发。200 客户端脚本为 **20 房、每房 1 房主＋9 听众、约 2 秒**，检查 18,000 个转发包；进程内同时包含测试客户端，内存数字不是独立服务端基准。它不证明公网 200 人或长期运行稳定。

默认音频为 48 kHz 双声道 Opus、20 ms 包。200 路听众按 128 kbps 计算，纯音频约 25.6 Mbps，另需协议开销和余量。慢接收端待发音频超过 16 KiB 会被断开重连，避免无界排队。TLS WebSocket 基于 TCP，丢包会影响实时性；真实三网、晚高峰、长期负载与 Steam 双账号需分别验收。

本轮检查结果见 [2026-09-09 验证记录](docs/verification-2026-09-09.md)，包含实际原生音频与断线恢复结果及验证边界。

## 隐私与开发

只向用户明确连接的服务器发送昵称、房间信息、可选曲名和主动开启共享后的音频；不上传曲库、文件路径、封面、歌词和播放历史。服务器运营者能接触经过服务器的数据。房间密码使用随机盐 scrypt，仅驻留内存；邀请和日志有界；服务不记录音频、密码或邀请，不启用访问日志。只分享有权传输的内容。

本地开发：`npm ci && npm start`，连接 `ws://localhost:8787`。公网必须使用 `wss://`。协议见 [PROTOCOL.md](PROTOCOL.md)，第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。源码公开不自动授予再分发许可；项目许可证由维护者决定。
