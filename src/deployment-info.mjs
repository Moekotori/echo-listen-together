// Only allowlisted public fields enter terminal output; never serialize config.
export function healthUrl(config) {
  return config.publicUrl.replace(/^ws/, 'http') + '/health';
}
export function deploymentInfo(config, status = 'pending') {
  const connectionCode = 'echo-listen:' + Buffer.from(JSON.stringify({ server: config.publicUrl })).toString('base64url');
  const publicStatus = { pending: '尚未验证，请运行下方检查命令', passed: '检查通过（从当前机器访问）', failed: '检查失败：请检查 DNS、证书、防火墙和网关日志' }[status];
  return [
    '', 'ECHO 一起听 · 连接与部署信息', '────────────────────────────────',
    `服务名称：${config.name.replace(/[\r\n\x1b]/g, ' ')}`,
    `连接地址：${config.publicUrl}`,
    `连接码：${connectionCode}`,
    `服务器密码：${config.serverPassword ? '已设置，连接时需填写（请向管理员获取）' : '未设置，ECHO 中留空即可'}`,
    '', '如何加入',
    '1. 打开 ECHO → 一起听歌。',
    '2. 将连接地址或连接码粘贴到“服务器地址或连接码”，填写昵称。',
    '3. 连接后创建或加入房间；房主播放本地歌曲并开启音频共享。',
    '房间密码由房主单独设置，与服务器密码不同。',
    '', '容量与连接',
    `总人数上限：${config.maxUsers} 人 · 房间上限：${config.maxRooms} 个 · 每房上限：${config.maxRoomUsers} 人（含房主）`,
    `断线保留：${config.reconnectMs / 1000} 秒 · 空房回收：${config.emptyRoomMs / 1000} 秒`,
    `公网健康检查：${publicStatus}`,
    `检查地址：${healthUrl(config)}`,
    '容量为配置上限，不代表已完成相同人数的负载验证。',
    '', '管理命令（在部署目录执行）',
    '查看信息并检查连接：docker compose exec relay npm run info',
    '查看容器状态：docker compose ps',
    '查看最近日志：docker compose logs --tail=80 relay gateway',
    '修改 .env 后应用：docker compose up -d',
    '更新代码后重建：docker compose up -d --build',
    `管理员凭据：${config.adminToken ? '已配置，仅保存在 .env；不要分享该文件' : '未配置，管理接口不可用'}`,
    '连接地址供 ECHO 使用；服务不提供网页播放器。',
    '',
  ].join('\n');
}
export async function checkPublicHealth(config) {
  try {
    const response = await fetch(healthUrl(config), { signal: AbortSignal.timeout(5000), redirect: 'error' });
    return response.ok && (await response.json()).protocol === 1;
  } catch { return false; }
}
