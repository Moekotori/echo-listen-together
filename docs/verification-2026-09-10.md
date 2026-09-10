# Server feature and diagnostics synchronization — 2026-09-10

## Scope

Synchronized the deployed server source and tests with the repository while retaining the existing one-command Docker deployment flow.

- Personal 128/256/320 kbps routing, bounded current-programme artwork/lyrics/technical metadata and media clocks.
- Programme pause, chat/typing presence, explicit host transfer and reconnect/empty-room lifecycle fixes.
- Bounded binary/control ingress, password-work concurrency, audio rate and receiver-congestion handling.
- Content-free connection/audio diagnostics and on-demand Markdown/JSON server reports.
- Documentation and example configuration now agree with the 60-second fallback reconnect window. Existing configured values remain operator-controlled.

## Verification

- Built a Docker image from the complete candidate source snapshot.
- All 48 Node server tests passed inside a Linux container, including configuration-file permissions, one-command setup, room lifecycle, media metadata, audio routing and abuse guards.
- All 8 Python diagnostic-report tests passed on Linux, including cumulative-counter deduplication, process/connection boundaries, content filtering, collection bounds and retention.
- The initial Windows run passed 47 of 48 Node tests; its only failure was the POSIX `0600` permission assertion. The Linux run verified that assertion successfully.
- Source hashes were compared with the captured deployed-server snapshot. Validation used separate containers and did not restart or replace the live relay.
- No runtime `.env`, credentials, reports, audio, user data or `node_modules` are included in this synchronization.

These checks establish source, protocol and report-tool behavior. They are not physical two-machine listening, two-account Steam acceptance, sustained production capacity or a new client release. Server `forwarded` counters describe submitted sends; client decoding and audible output require client-side evidence.
