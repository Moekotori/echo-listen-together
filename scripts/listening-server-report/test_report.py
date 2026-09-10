import json
from pathlib import Path
import tempfile
import sys
import unittest

from collect import command, gateway_summary, save
from report import event_from_line, markdown, summarize


def event(kind, **fields):
    return json.dumps({'timestamp': '2026-09-10T10:00:00.000Z', 'event': kind, **fields})


class ReportTests(unittest.TestCase):
    def test_external_command_output_is_capped(self):
        output, status = command([sys.executable, '-c', "print('x' * 1000000)"], Path.cwd(), 1024)
        self.assertEqual(len(output), 1024)
        self.assertTrue(status['byteLimitReached'])

    def test_cumulative_counts_are_not_summed(self):
        data = summarize([event('connection_open', connection=1),
                          event('connection_summary', connection=1, accepted=100),
                          event('connection_summary', connection=1, accepted=150),
                          event('connection_closed', connection=1, accepted=150)])
        self.assertEqual(data['connections'][0]['counters']['accepted'], 150)

    def test_restart_and_reused_connection_ids_remain_separate(self):
        lines = [event('connection_summary', connection=1, accepted=900),
                 '2026-09-10T10:01:00.123456789Z {"event":"ready"}',
                 event('connection_open', connection=1), event('connection_summary', connection=1, accepted=10)]
        rows = summarize(lines)['connections']
        self.assertEqual([r['counters']['accepted'] for r in rows], [900, 10])
        self.assertNotEqual(rows[0]['run'], rows[1]['run'])

    def test_content_and_credentials_are_never_exported(self):
        safe = event_from_line(event('connection_closed', connection=1, reason='private secret',
                                     token='secret', ip='1.2.3.4', title='private song', forwarded=50))
        self.assertEqual(safe['reason'], 'unknown')
        self.assertNotIn('secret', json.dumps(safe))
        self.assertNotIn('private song', json.dumps(safe))
        self.assertIsNone(event_from_line('{"event":[]}'))
        self.assertIsNone(event_from_line('malformed record'))

    def test_faults_epochs_and_timeline_are_bounded(self):
        data = summarize(event('audio_stalled', connection=i, epoch=i + 100, role='guest', omitted=1)
                         for i in range(1500))
        self.assertEqual(len(data['connections']), 1000)
        self.assertEqual(len(data['timeline']), 300)
        self.assertEqual(data['excludedConnections'], 500)
        self.assertEqual(data['omittedByLogger'], 1500)

    def test_gateway_errors_are_classified_without_raw_requests(self):
        data = gateway_summary(json.dumps({'level': 'error', 'msg': 'dial tcp private.example: connection refused',
                                          'request': {'uri': '/?token=secret'}}))
        self.assertEqual(data, {'error': 1, 'upstream_refused': 1})

    def test_report_explains_what_forwarding_does_not_prove(self):
        report = {'generatedAt': '2026-09-10', 'hours': 2, 'runtime': {}, 'collection': {}, 'gateway': {},
                  'relay': summarize([event('audio_stalled', connection=1, role='guest', forwarded=50)])}
        text = markdown(report)
        self.assertIn('不能证明客户端收到', text)
        self.assertIn('不是本时间窗口内的精确流量', text)
        self.assertIn('audio_stalled', text)

    def test_retention_does_not_delete_unrelated_files(self):
        report = {'generatedAt': '2026-09-10', 'hours': 2, 'runtime': {}, 'collection': {}, 'gateway': {}, 'relay': summarize([])}
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            unrelated = output / 'keep.md'; unrelated.write_text('keep')
            for i in range(12):
                for suffix in ('.md', '.json'):
                    (output / (f'listen-report-20200101T0000{i:02d}Z-00000000' + suffix)).write_text('old')
            result = save(report, output)
            self.assertTrue(result.exists())
            self.assertEqual(len(list(output.glob('listen-report-*.md'))), 10)
            self.assertTrue(unrelated.exists())


if __name__ == '__main__':
    unittest.main()
