"""Evidence-based findings and a static runbook; never ingest raw user content."""


def diagnose(report):
    relay = report['relay']; rows = relay['connections']; runtime = report['runtime']
    findings = []

    def add(code, severity, title, evidence, next_step, boundary):
        findings.append(dict(code=code, severity=severity, title=title, evidence=evidence,
                             nextStep=next_step, boundary=boundary))

    for service in ('relay', 'gateway'):
        status = report['collection'].get(service, {})
        if not status or status.get('error') or status.get('exitCode') not in (None, 0) or status.get('timedOut'):
            add(service + '_collection_incomplete', 'warning', service + ' 日志采集不完整',
                '未取得完整、成功的采集结果。', '检查 Docker/Compose 是否可用、容器是否存在，然后重新采集。',
                '采集失败是证据缺口，不能等同于服务故障，也不能据此排除故障。')
        if status.get('byteLimitReached') or status.get('lineLimitPossiblyReached'):
            add(service + '_log_truncated', 'warning', service + ' 日志可能截断',
                '达到行数或字节采集上限。', '在复现后立即采集较短窗口，并结合故障发生的 UTC 时间。',
                '增加查询小时数无法突破 5000 行/8 MiB 上限。')
        state = runtime.get(service, {})
        if state.get('state') and state['state'] != 'running' or state.get('health') == 'unhealthy' or state.get('oomKilled'):
            add(service + '_runtime_fault', 'error', service + ' 存在运行异常',
                f"state={state.get('state')}; health={state.get('health')}; oomKilled={state.get('oomKilled')}",
                '先排查容器退出、健康检查及内存限制；保存报告后再决定是否重启。',
                '状态是采集时的快照；OOM 标志和重启次数不足以确定发生时间或最初原因。')
        if state.get('restarts', 0):
            add(service + '_restarts', 'warning', service + ' 有重启记录',
                f"当前容器累计重启 {state['restarts']} 次。", '对照启动时间与故障时间；检查资源与退出原因。',
                '重启次数是容器生命周期累计值，未必发生在本次查询窗口。')
        for key, label in (('statsStatus', '资源快照'), ('sourceHashStatus', '源码哈希')):
            phase = state.get(key)
            if phase and (phase.get('exitCode') != 0 or phase.get('timedOut') or phase.get('byteLimitReached')):
                add(service + '_' + key, 'warning', service + ' ' + label + '采集失败',
                    '该采集步骤未成功完成。', '检查 Docker exec/stats 的可用性并重新采集。', '缺失值不是 0，也不代表一致或健康。')

    disk = runtime.get('diskSourceSha256', {})
    running = runtime.get('relay', {}).get('containerSourceSha256', {})
    mismatch = [name for name, digest in disk.items() if digest and running.get(name) and digest != running[name]]
    missing = [name for name in disk if not disk[name] or not running.get(name)]
    if mismatch:
        add('source_mismatch', 'warning', '磁盘源码与容器内源码不一致', ', '.join(mismatch),
            '以容器版本排错；核对部署来源和构建时间，确认后再安排构建/部署。',
            '磁盘编辑不会自动进入运行容器；差异本身不能证明它导致音频故障。')
    if missing or not disk:
        add('source_evidence_missing', 'warning', '代码版本证据不完整',
            '一个或多个所检查源码的磁盘/容器哈希不可用。', '补齐哈希采集后再比较版本。',
            '仅比较列出的关键文件，不代表全部源码、依赖或 native 构建一致。')
    if relay.get('omittedByLogger') or relay.get('excludedConnections'):
        add('events_omitted', 'warning', '部分事件或连接摘要被省略',
            f"日志省略={relay['omittedByLogger']}; 连接省略={relay['excludedConnections']}",
            '故障复现后及时采集，并保留客户端同一时段诊断。', '报告中的次数是可见证据，不是所有故障的精确总数。')
    if not relay['parsedEvents']:
        add('no_events', 'warning', '没有可解析的服务端事件', '结构化事件数量为 0。',
            '核对故障时间、查询窗口和运行版本是否具备诊断日志。', '可能是空闲、旧版本、轮转或采集失败，不能报告“没有问题”。')

    counts = relay.get('rejectionReasons', {})
    if counts.get('fixed_audio_quality'):
        add('fixed_audio_quality', 'error', '音质协议请求被拒绝',
            f"fixed_audio_quality={counts['fixed_audio_quality']} 次。",
            '更新房主/听众客户端；开发构建需退出旧进程并重新构建。启动参数应为 bitrate=256000，multiQuality 不为 true；不要再发送 quality 切换请求。',
            '旧日志没有请求类型、实际参数或客户端版本，不能分辨上述哪一项触发；也不能据此断定当前仍故障。')
    for kind, title, action in (
        ('audio_first_packet_timeout', '声明流后没有及时观察到音频', '房主：查 native 编码/写管道、发送计数；听众：查房主输入和服务器转发。'),
        ('audio_stalled', '已出现音频后发生中断', '对齐末次有效音频、暂停/seek/切歌、native 停止及网络断开时间。'),
    ):
        count = relay['eventCounts'].get(kind, 0)
        if count:
            add(kind, 'error', title, f'{kind}={count} 次。', action,
                '事件次数可能包含同一次持续故障的周期报告；需结合角色、流编号和后续 audio_recovered 判断。')
    for key, title, action in (
        ('invalid', '无效音频包', '检查客户端包格式、长度、协议版本与 native 构建是否一致。'),
        ('unauthorized', '音频发送权限或有效流不符', '检查是否由当前房主发送、流是否已启动、转让房主后旧发送是否停止。'),
        ('epochRejected', '音频流编号不匹配', '比较当前房间 epoch 和客户端发送 epoch，关注 seek、切歌、重连与房主转让。'),
        ('rateLimited', '音频发送被限流', '检查发送节奏、重复发送及配置上限；不要直接提高上限掩盖异常。'),
        ('congested', '听众发送队列积压', '检查该听众网络与接收线程；对照网关超时、客户端接收及解码计数。'),
    ):
        affected = sum(r['counters'][key] > 0 for r in rows)
        if affected:
            add(key, 'warning', title, f'{affected} 个保留连接的 {key} 累计计数大于 0。', action,
                '累计计数可能包含查询窗口之前的故障，不是本窗口新增量，不能直接推导丢包率。')
    abnormal = sum(r['closed'] and r.get('closeCode') not in (1000, 1001, 1005) for r in rows)
    if abnormal:
        add('abnormal_close', 'warning', '观察到异常连接关闭', f'{abnormal} 个连接记录。',
            '区分 1006 异常断开、1008 策略拒绝和具体 reason；对照网关和客户端退出/切网时间。',
            '1006 不能单独证明防火墙、TLS、服务器或客户端哪一方有问题；未观察到关闭也不代表连接仍在线。')
    for key, action in (('timeout', '对照上游延迟和连接时间。'), ('upstream_refused', '检查 relay 监听和容器网络。'),
                        ('dns_failure', '检查网关上游解析。'), ('tls_handshake', '检查证书、时间与 TLS 连接。')):
        if report['gateway'].get(key):
            add('gateway_' + key, 'warning', '网关错误：' + key, f"{report['gateway'][key]} 条匹配日志。", action,
                '仅为消息关键词分类；没有连接关联信息，不能直接归因到特定听众。')
    return findings


def detailed_sections(report):
    findings = report.get('diagnosis') if 'diagnosis' in report else diagnose(report)
    lines = ['## 按证据排列的排查事项', '']
    if not findings:
        lines += ['当前采集未命中已知异常规则；这不是端到端播放通过的结论。', '']
    for item in sorted(findings, key=lambda f: f['severity'] != 'error'):
        lines += [f"### [{item['severity']}] {item['title']}（{item['code']}）", '',
                  '- 证据：' + item['evidence'], '- 下一步：' + item['nextStep'], '- 判断边界：' + item['boundary'], '']
    lines += ['## 排查顺序与恢复验收', '',
              '| 步骤 | 需要观察的证据 | 异常时查哪里 |',
              '| --- | --- | --- |',
              '| 1. 服务可用 | relay/gateway 运行、健康状态、采集成功 | 容器退出、OOM、启动时间、网关上游 |',
              '| 2. 控制请求成功 | 房主建立连接，音频启动请求不再被拒绝 | 客户端构建、固定码率参数、权限及协议能力 |',
              '| 3. 房主音频产生 | 房主新流的 ingress/accepted 随播放增长 | native 编码、管道写入、发送状态；不能只看房间连接成功 |',
              '| 4. 有听众时转发 | 听众对应连接的 forwarded 增长，无持续拥塞 | 房主输入、听众成员状态和网络；独自建房时转发为 0 可正常 |',
              '| 5. 客户端输出 | 听众接收、解码、输出计数增长，并实际听到声音 | native guest/output、音量、设备与采样率 |',
              '| 6. 控制恢复 | 暂停/继续、seek、切歌后恢复，旧 epoch 包不持续干扰 | 对照双方 native 与服务端同一时段的流编号和事件 |', '',
              '修复后用新的短时间窗口采集一次；历史错误不会因为修复而从报告消失。不要用旧累计值判断修复失败。',
              'audio_recovered 仅表示服务器再次观察到接受或转发音频，不证明听众已解码或出声。不得自动重启或自动重建房间来“验证”。', '',
              '## 需要客户端补齐的最小证据', '',
              '- 故障时间与时区、房主/听众角色、最后一次正常播放和首次失败的时间。',
              '- 双方应用版本及构建 SHA/构建时间；版本号相同不能证明二进制相同。',
              '- 发生前的操作：首次共享、暂停/继续、seek、切歌、重连或转让房主。',
              '- 客户端结构化 errorCode、当前 epoch、native 编码/解码/写入失败和接收计数；发送时移除路径、房间/歌曲/成员内容及凭据。',
              '- 当前日志的 connection 是服务器临时编号，不能可靠反查用户或关联另一个连接属于同一房间；需要人工对齐角色和时间，不能猜测。', '',
              '## 采集和复查命令', '', '在服务器项目根目录执行；以下操作只读服务状态并生成本地报告：', '',
              '```sh', 'python3 scripts/listening-server-report/collect.py --hours 1', 'docker compose ps', '```', '',
              '保留生成的同名 .md 和 .json。复现后及时采集，长窗口不能找回轮转/容器删除前的日志。',
              '健康检查只覆盖服务可用性，不能替代有房主和听众的实际出声验证。', '']
    return lines
