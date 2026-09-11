import unittest

from report import markdown, summarize
from test_report import event
from troubleshooting import diagnose


def report(lines=()):
    digest = 'a' * 64
    return {'generatedAt': '2026-09-11', 'hours': 1,
            'collection': {s: {'exitCode': 0} for s in ('relay', 'gateway')},
            'runtime': {'relay': {'state': 'running', 'health': 'healthy',
                                   'containerSourceSha256': {'src/server.mjs': digest}},
                        'gateway': {'state': 'running'}, 'diskSourceSha256': {'src/server.mjs': digest}},
            'relay': summarize(lines), 'gateway': {}}


class TroubleshootingTests(unittest.TestCase):
    def test_health_does_not_hide_protocol_failure(self):
        data = report([event('control_rejected', connection=1, role='host', reason='fixed_audio_quality')])
        codes = {f['code'] for f in diagnose(data)}
        self.assertIn('fixed_audio_quality', codes)
        self.assertNotIn('relay_runtime_fault', codes)
        self.assertIn('不能分辨', markdown(data))

    def test_snapshot_counts_do_not_create_false_packet_loss_or_current_failure(self):
        data = report([event('connection_summary', connection=1, role='host', accepted=100, forwarded=0)])
        self.assertEqual(diagnose(data), [])
        text = markdown(data)
        self.assertIn('独自建房时转发为 0 可正常', text)
        self.assertIn('这不是端到端播放通过', text)

    def test_missing_logs_and_hashes_are_not_healthy(self):
        data = report()
        data['collection']['relay'] = {'exitCode': 1, 'timedOut': True, 'byteLimitReached': True}
        data['runtime']['relay']['containerSourceSha256'] = {}
        codes = {f['code'] for f in diagnose(data)}
        self.assertTrue({'relay_collection_incomplete', 'relay_log_truncated', 'no_events', 'source_evidence_missing'} <= codes)

    def test_deployment_mismatch_and_oom_are_explicit(self):
        data = report([event('connection_open', connection=1)])
        data['runtime']['relay'].update(oomKilled=True, restarts=2, containerSourceSha256={'src/server.mjs': 'b'*64})
        codes = {f['code'] for f in diagnose(data)}
        self.assertTrue({'source_mismatch', 'relay_runtime_fault', 'relay_restarts'} <= codes)

    def test_recovery_and_fault_times_survive_long_timeline(self):
        data = report([event('audio_stalled', connection=1, role='guest'),
                       event('audio_recovered', connection=1, forwarded=10)] +
                      [event('connection_summary', connection=1, forwarded=20)]*310)
        row = data['relay']['connections'][0]
        self.assertEqual(row['recoveries'], 1)
        self.assertIsNotNone(row['lastRecovery'])
        self.assertIn('audio_stalled', row['faultWindows'])
        self.assertIn('异常连接时间与恢复记录', markdown(data))
        self.assertEqual(row['counters']['forwarded'], 20)

    def test_machine_readable_findings_and_markdown_agree(self):
        data = report([event('audio_transport_fault', connection=1, congested=2, epochRejected=4)])
        data['diagnosis'] = diagnose(data)
        text = markdown(data)
        for item in data['diagnosis']:
            self.assertIn(item['code'], text)
            self.assertIn(item['nextStep'], text)


if __name__ == '__main__':
    unittest.main()
