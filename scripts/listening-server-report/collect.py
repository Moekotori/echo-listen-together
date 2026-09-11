#!/usr/bin/env python3
"""Generate a bounded local report; does not modify or restart relay containers."""
import argparse
import collections
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import uuid

from report import markdown, summarize, timestamp
from troubleshooting import diagnose

SOURCE_FILES = ('src/server.mjs', 'src/relay.mjs', 'src/diagnostics.mjs', 'src/rooms.mjs',
                'src/room-features.mjs', 'src/programme-state.mjs', 'src/transport-policy.mjs')


def command(args, root, limit=262144):
    process = subprocess.Popen(args, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    timed_out = threading.Event()
    def timeout():
        timed_out.set()
        try:
            process.kill()
        except ProcessLookupError:
            pass
    timer = threading.Timer(25, timeout); timer.start()
    data = bytearray()
    try:
        while len(data) < limit:
            chunk = process.stdout.read(min(8192, limit - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        capped = len(data) == limit
        if capped:
            process.kill()
        code = process.wait(timeout=5)
        return data.decode('utf-8', errors='replace'), {'exitCode': code, 'byteLimitReached': capped,
                                                      'timedOut': timed_out.is_set(), 'bytes': len(data)}
    finally:
        timer.cancel()
        if process.poll() is None:
            process.kill(); process.wait()
        process.stdout.close()


def gateway_summary(text):
    counts = collections.Counter()
    for line in text.splitlines()[-5000:]:
        try:
            data = json.loads(line[line.index('{'):])
            if data.get('level') in ('error', 'warn'):
                counts[data['level']] += 1
                # Classify, never copy raw errors, URLs, client IPs or request bodies.
                message = str(data.get('msg', '')) + str(data.get('error', ''))
                for term, code in [('timeout', 'timeout'), ('connection refused', 'upstream_refused'),
                                   ('no such host', 'dns_failure'), ('TLS handshake', 'tls_handshake')]:
                    if term.lower() in message.lower():
                        counts[code] += 1
        except (ValueError, TypeError, AttributeError):
            continue
    return dict(counts)


def safe_quantity(value):
    return value if isinstance(value, str) and re.fullmatch(r'[0-9.kKMGTiB% /]+', value) else None


def collect(root, hours):
    now = dt.datetime.now(dt.timezone.utc)
    since = (now - dt.timedelta(hours=hours)).isoformat()
    report = {'generatedAt': now.isoformat(), 'hours': hours, 'runtime': {}, 'collection': {},
              'relay': summarize([]), 'gateway': {}}
    for service in ('relay', 'gateway'):
        try:
            raw, status = command(['docker', 'compose', 'ps', '-q', service], root)
            container = raw.strip()
            if status['exitCode'] or not re.fullmatch(r'[a-f0-9]{12,64}', container):
                report['collection'][service] = {'error': 'container_unavailable'}
                continue
            # Only request operational fields, never .Config.Env or health command output.
            fields = '[{{json .State.Status}},{{json .State.StartedAt}},{{json .RestartCount}},{{json .Image}},{{json .HostConfig.LogConfig}},{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},{{json .State.OOMKilled}}]'
            raw, inspected = command(['docker', 'inspect', '--format', fields, container], root)
            if inspected['exitCode']:
                raise ValueError('inspect_failed')
            state, started, restarts, image, logging, health, oom = json.loads(raw)
            report['runtime'][service] = {
                'container': container, 'state': state if state in ('running', 'exited', 'restarting', 'paused', 'dead', 'created') else 'unknown',
                'startedAt': timestamp(started), 'restarts': restarts if isinstance(restarts, int) else None,
                'image': image if re.fullmatch(r'sha256:[a-f0-9]{64}', str(image)) else None,
                'health': health if health in ('healthy', 'unhealthy', 'starting') else None, 'oomKilled': oom is True,
                'logDriver': logging.get('Type') if logging.get('Type') in ('json-file', 'local', 'journald', 'none') else 'other',
                'logMaxSize': safe_quantity(logging.get('Config', {}).get('max-size', '').upper()),
                'logMaxFiles': safe_quantity(logging.get('Config', {}).get('max-file', '')),
            }
            raw, status = command(['docker', 'logs', '--timestamps', '--since', since, '--tail', '5000', container], root, 8 * 1024 * 1024)
            status['lineLimitPossiblyReached'] = len(raw.splitlines()) >= 5000
            report['collection'][service] = status
            if service == 'relay':
                report['relay'] = summarize(raw.splitlines())
            else:
                report['gateway'] = gateway_summary(raw)
            raw, stats_status = command(['docker', 'stats', '--no-stream', '--format', '{{json .}}', container], root)
            report['runtime'][service]['statsStatus'] = stats_status
            if stats_status['exitCode'] == 0:
                stats = json.loads(raw)
                report['runtime'][service]['usage'] = {key: safe_quantity(stats.get(key)) for key in ('CPUPerc', 'MemUsage', 'NetIO', 'BlockIO', 'PIDs')}
            if service == 'relay':
                hashes, hash_status = command(['docker', 'exec', container, 'sha256sum', *SOURCE_FILES], root)
                report['runtime'][service]['sourceHashStatus'] = hash_status
                report['runtime'][service]['containerSourceSha256'] = {}
                if hash_status['exitCode'] == 0:
                    for line in hashes.splitlines():
                        match = re.fullmatch(r'([a-f0-9]{64})  (src/[a-z-]+\.mjs)', line)
                        if match and match[2] in SOURCE_FILES:
                            report['runtime'][service]['containerSourceSha256'][match[2]] = match[1]
        except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
            report['collection'].setdefault(service, {})['error'] = 'collection_failed'
    disk = shutil.disk_usage(root)
    report['runtime']['system'] = {'diskFreeBytes': disk.free, 'diskTotalBytes': disk.total}
    if hasattr(os, 'getloadavg'):
        report['runtime']['system']['loadAverage'] = os.getloadavg()
    report['runtime']['diskSourceSha256'] = {}
    for name in SOURCE_FILES:
        try:
            with (root / name).open('rb') as source:
                digest = hashlib.sha256()
                for chunk in iter(lambda: source.read(65536), b''):
                    digest.update(chunk)
                report['runtime']['diskSourceSha256'][name] = digest.hexdigest()
        except OSError:
            report['runtime']['diskSourceSha256'][name] = None
    report['diagnosis'] = diagnose(report)
    return report


def save(report, output):
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    name = 'listen-report-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    for suffix, content in (('.json', json.dumps(report, ensure_ascii=False, indent=2)), ('.md', markdown(report))):
        fd = os.open(output / (name + suffix), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as target:
            target.write(content)
    # Retain ten reports; touch only our strict filenames, not arbitrary directory contents.
    files = sorted(p for p in output.iterdir() if not p.is_symlink() and p.is_file()
                   and re.fullmatch(r'listen-report-\d{8}T\d{6}Z-[a-f0-9]{8}\.(json|md)', p.name))
    modified = {p.stem: p.stat().st_mtime_ns for p in files}
    stems = sorted(modified, key=lambda stem: (stem == name, modified[stem], stem))
    for old in files:
        if old.stem not in stems[-10:]:
            old.unlink()
    return output / (name + '.md')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--hours', type=int, default=2, choices=range(1, 169), metavar='1..168')
    args = parser.parse_args()
    root = args.root.resolve()
    print(save(collect(root, args.hours), root / 'misc' / 'diagnostic-reports'))
