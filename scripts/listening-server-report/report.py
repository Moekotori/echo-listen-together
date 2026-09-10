"""Bounded, content-free interpretation of listening relay diagnostic events."""
import collections
import datetime as dt
import json

COUNTERS = ('ingress', 'accepted', 'forwarded', 'invalid', 'unauthorized',
            'epochRejected', 'rateLimited', 'congested')
EVENTS = frozenset(('ready', 'connection_open', 'connection_closed', 'connection_summary',
                   'stream_expected', 'stream_stopped', 'audio_first_packet_timeout',
                   'audio_stalled', 'audio_recovered', 'audio_transport_fault'))
REASONS = frozenset(('connection_closed', 'heartbeat_timeout', 'hello_timeout', 'invalid_audio',
                    'ingress_limit', 'invalid_request', 'control_rate_limit', 'audio_rate_limit',
                    'slow_receiver', 'server_shutdown', 'replaced'))
LIMITS = {'log_lines': 5000, 'connections': 1000, 'timeline': 300}


def timestamp(value):
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            return None
        return parsed.astimezone(dt.timezone.utc).isoformat(timespec='milliseconds')
    except (ValueError, TypeError, OverflowError):
        return None


def event_from_line(line):
    try:
        start = line.index('{')
        raw = json.loads(line[start:])
        if not isinstance(raw, dict) or raw.get('event') not in EVENTS:
            return None
        # Docker timestamps also cover the startup marker, which lacks an app timestamp.
        time = timestamp(raw.get('timestamp')) or timestamp(line[:start].strip())
        if not time:
            return None
        result = {'timestamp': time, 'event': raw['event']}
        for key in (*COUNTERS, 'connection', 'epoch', 'idleMs', 'elapsedMs', 'closeCode', 'omitted'):
            value = raw.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 9007199254740991:
                result[key] = value
        if raw.get('role') in ('host', 'guest', 'none'):
            result['role'] = raw['role']
        if 'reason' in raw:
            result['reason'] = raw['reason'] if raw['reason'] in REASONS else 'unknown'
        return result
    except (ValueError, TypeError, KeyError):
        return None


def summarize(lines):
    events = collections.Counter()
    connections = collections.OrderedDict()
    active = {}
    timeline = collections.deque(maxlen=LIMITS['timeline'])
    run = 0
    parsed = omitted = excluded_connections = 0
    first = last = None
    for line in collections.deque(lines, maxlen=LIMITS['log_lines']):
        event = event_from_line(line)
        if not event:
            continue
        parsed += 1
        first = first or event['timestamp']; last = event['timestamp']
        events[event['event']] += 1
        omitted += event.get('omitted', 0)
        timeline.append(event)
        if event['event'] == 'ready':
            run += 1; active.clear()
        connection = event.get('connection')
        if connection is None:
            continue
        if connection not in active or event['event'] == 'connection_open':
            key = f'{run}:{connection}:{parsed}'
            active[connection] = key
            connections[key] = {'connection': connection, 'run': run, 'roles': [], 'epochs': [],
                                'first': event['timestamp'], 'last': event['timestamp'],
                                'counters': dict.fromkeys(COUNTERS, 0), 'faults': {}, 'closed': False}
            if len(connections) > LIMITS['connections']:
                old_key, old = connections.popitem(last=False)
                if active.get(old['connection']) == old_key:
                    active.pop(old['connection'], None)
                excluded_connections += 1
        row = connections[active[connection]]
        row['last'] = event['timestamp']
        for field, value in (('roles', event.get('role')), ('epochs', event.get('epoch'))):
            if value not in (None, 'none', 0) and value not in row[field]:
                row[field] = (row[field] + [value])[-12:]
        for key in COUNTERS:
            # Snapshots are cumulative: summing them would multiply packet counts.
            row['counters'][key] = max(row['counters'][key], event.get(key, 0))
        if event['event'] in ('audio_first_packet_timeout', 'audio_stalled', 'audio_transport_fault'):
            row['faults'][event['event']] = row['faults'].get(event['event'], 0) + 1
        if event['event'] == 'connection_closed':
            row.update(closed=True, closeCode=event.get('closeCode'), reason=event.get('reason', 'unknown'))
    return {'parsedEvents': parsed, 'firstEvent': first, 'lastEvent': last, 'eventCounts': dict(events),
            'omittedByLogger': omitted, 'excludedConnections': excluded_connections,
            'connections': list(connections.values()), 'timeline': list(timeline)}


def markdown(report):
    data = report['relay']; rows = data['connections']
    faults = [r for r in rows if r['faults'] or any(r['counters'][k] for k in COUNTERS[3:])
              or (r['closed'] and r.get('closeCode') not in (1000, 1001, 1005))]
    lines = ['# 一起听歌服务端排错报告', '', f"生成时间（UTC）：{report['generatedAt']}",
             f"请求范围：最近 {report['hours']} 小时；实际日志：{data['firstEvent']} → {data['lastEvent']}", '',
             '## 排查结论与证据边界', '',
             f"- 发现 {len(faults)} 个存在异常证据的连接记录，共读取 {data['parsedEvents']} 条结构化事件。",
             '- 首包超时/断流：服务器在声明的音频流中没有持续观察到有效输入或转发；结合房主/听众角色判断断点。',
             '- invalid / unauthorized / epochRejected / rateLimited：分别表示协议无效、非房主/无有效流、流编号不符、发送限流。',
             '- congested：服务器向该听众发送时出现积压；可能涉及网络或接收端处理速度。',
             '- forwarded 仅表示提交 WebSocket 发送，不能证明客户端收到、解码或扬声器出声。',
             '- 计数为可见连接生命周期的累计最大值，不是本时间窗口内的精确流量；多音质房主会发送多条流，不能直接用房主/听众计数相减算丢包。',
             '- 未出现异常事件不等于没有故障。请结合用户发生时间、音质、客户端 epoch 和解码/拒包/输出计数。', '',
             '## 采集完整性', '', '```json', json.dumps(report['collection'], ensure_ascii=False, indent=2), '```',
             f"日志自身省略事件数：{data['omittedByLogger']}；报告省略连接数：{data['excludedConnections']}。",
             '最多采集每个容器 5000 行/8 MiB，最多保留 1000 个连接及最后 300 条时间线。容器删除或日志轮转前的事件可能已不可用。', '',
             '## 服务、资源与代码版本', '', '```json',
             json.dumps(report['runtime'], ensure_ascii=False, indent=2), '```', '',
             '## 事件统计', '', '```json', json.dumps(data['eventCounts'], ensure_ascii=False, indent=2), '```', '',
             '## 连接汇总（累计计数）', '',
             '| 运行/连接 | 角色 | 最近流编号 | 输入 | 通过 | 转发 | 无效/无权/错流/限流/拥塞 | 异常事件 | 关闭原因 |',
             '| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |']
    for r in rows:
        c = r['counters']
        lines.append(f"| {r['run']}/{r['connection']} | {','.join(r['roles']) or 'none'} | {','.join(map(str, r['epochs'])) or '-'} | {c['ingress']} | {c['accepted']} | {c['forwarded']} | {'/'.join(str(c[k]) for k in COUNTERS[3:])} | {','.join(r['faults']) or '-'} | {r.get('reason', '未观察到关闭')} ({r.get('closeCode', '-')}) |")
    lines.extend(['', '## 最近事件时间线', '', '```jsonl',
                  *[json.dumps(e, ensure_ascii=False) for e in data['timeline']], '```', '',
                  '## 网关摘要', '', '```json', json.dumps(report['gateway'], ensure_ascii=False, indent=2), '```', '',
                  '报告不包含用户 IP、成员身份、房间名、歌曲名、歌词、聊天、密码、票据、环境变量或完整请求 URL。', ''])
    return '\n'.join(lines)
