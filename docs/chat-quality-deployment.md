# Chat and quality deployment — 2026-09-09

Merged against the live service source before deployment, retaining current artwork, Steam avatar identity, 60-second reconnect retention, monotonic heartbeat and bounded congestion/catch-up handling. Per-listener snapshots share the member/track payload and customize only the quality fields. Multi-rendition token budgets are three times the standard budget, with no audio queue.

Validation: 22 focused tests passed locally and in the candidate Linux container. Public TLS smoke passed two-way chat, room isolation, all three 128/256/320 rendition routes, and the retained artwork capability. The test created and removed one private temporary room. Initial 300ms receive assertions were too short for WAN delivery; bounded 5s event waits passed. This is protocol verification, not a physical audio listening test.

Deployed relay only; gateway, environment and certificate volumes unchanged. Pre-deployment source backup is /opt/echo-listen-chat-20260909T130155Z/backup and previous image is echo-listen-relay:before-chat-20260909T130155Z. Deployment checks source hashes before writing and restores the previous image/source if immediate health fails. Rooms are in memory and do not survive a relay restart.
