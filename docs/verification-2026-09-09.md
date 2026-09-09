# Verification / 验证记录 — 2026-09-09

Server / 服务端：`04efcbb`。ECHO audio implementation / 客户端音频实现：`f1421b00`，本机工作树含额外 UI 改动 / local checkout also contains UI changes.

| 检查 / Check | 结果 / Result |
| --- | --- |
| Server automated tests / 服务端自动测试 | 7 passed / 7 项通过 |
| Deployed TLS + WebSocket / 已部署服务公网检查 | Passed: password, room capacity, host-only audio, private-room visibility; 20/20 packets unchanged / 密码、容量、房主权限、私密房间均正常，20 包原样转发 |
| Local synthetic relay / 本机合成转发 | 200 clients, 20 rooms, 180 listeners; 18,000/18,000 packets over about 2 seconds / 全部收到 |
| Actual ECHO native audio / 实际原生音频 | Host encoded 997 packets; dropped input frames 0; packet sink failures 0 / 房主编码正常 |
| Actual listener / 实际听众 | 177 decoded packets; rejected 0, concealed 0, sink failures 0 / 实际解码及输出注入通过 |
| Short disconnect / 短期断线 | Identity, room, audio, and muted volume restored / 身份、房间、音频和静音音量恢复 |
| Controls and cleanup / 控制与释放 | Pause, resume, seek, room-list refresh passed; stopping sharing kept local playback; listener leave stopped native receiving / 通过 |

A 0.2-second seek updated the stream epoch in 444 ms in this run. This is one observed control-propagation sample, not measured acoustic synchronization latency.

本次 0.2 秒跳转在 444 ms 内更新流 epoch，仅是单次控制传播记录，不代表两端声音同步延迟。

The native check used isolated Electron processes and synthetic local audio against the deployed server. It did not automate the full desktop UI or verify audio through physical loopback. The local capacity process includes both clients and server (71 MiB RSS in this run), so that value is not a standalone server memory measurement.

原生检查使用独立 Electron 进程和合成本地音频连接已部署服务器；未自动化整个桌面 UI，也未做物理音频回环验证。本机容量进程同时包含客户端和服务端（本次 RSS 71 MiB），不能当作独立服务端内存占用。

These results support the tested short-session behavior. They do not establish sustained 200-user production capacity, peak-hour mainland-China carrier performance, long-running memory stability, or two-account Steam acceptance.

这些结果支持已检查的短时会话行为，不证明公网持续 200 人容量、大陆三网晚高峰、长期内存稳定或 Steam 双账号体验。
