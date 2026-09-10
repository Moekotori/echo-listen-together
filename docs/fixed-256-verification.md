# Fixed 256 kbps rollout

Audio is now a single 256 kbps CBR stream. Quality changes and multi-rendition announcements are rejected. New clients check the fixed-rate capability before joining; older listeners can still decode the base epoch, but older hosts must update before broadcasting.

## Validation

- 49 server tests passed in Linux, including fixed-rate announcements, rejection of alternate rates/quality commands, base-epoch routing, metadata control-byte accounting, rate limits and reconnect lifecycle.
- 8 diagnostic-report tests passed in Linux.
- The production Docker image was built and deployed with zero online users and zero rooms. Source hashes inside the running container were checked against the candidate; a rollback image and source backup were retained.
- Public TLS/protocol checks verified passwords, capacity, host-only audio, private-room isolation and byte-identical relay delivery.
- The production client coordinator and real native processes sustained fixed 256 audio with frequent small media clocks under a simulated 48 KiB/s upstream backlog. This model is not physical network shaping or two-account listening acceptance.
- In a deterministic 512 kbps downstream model, adding a 30 KB control snapshot previously caused 11 audio drops. Separate control-byte accounting reduced these artificial drops to zero without exceeding the existing 64 KiB total ceiling.

ELTA framing overhead included, the host now submits 33,800 bytes/second instead of 93,400 bytes/second for three renditions: approximately 64% less upstream audio traffic, before WebSocket/TLS/TCP overhead. This does not guarantee playback on a connection that cannot sustain 256 kbps plus overhead or has prolonged outages.
