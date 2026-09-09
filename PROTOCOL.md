# ECHO Listen protocol 1

WebSocket endpoint: PUBLIC_URL + `/v1/socket`. No browser Origin accepted. TLS in production. Max text request 8192 bytes; compression disabled. Request `{id:string,type:string,data:object}`, reply `{id,result}` or `{id,error}`. One control request in flight per connection; 40 requests per 10 seconds. Error codes are stable lowercase identifiers, never arbitrary exception detail.

- `hello`: `{protocol:1,name,password?,resumeToken?}` → `{protocol,peerId,resumeToken,name,limits}`. Complete within 5s. Keep resumeToken private; reconnect within 20s with same server password. Token retained only in process memory.
- `rooms`: `{}` → public room summaries (private rooms excluded).
- `create`: `{name,password?,private?,maxUsers}` → room. Creates and joins atomically.
- `join`: `{roomId,password?,invitation?}` → room. One room per peer.
- `leave`: `{}` → true.
- `invite`: `{}` → `{server,roomId,invitation,expiresAt}`, host only; 5min, single use.
- `revokeInvites`: `{}` → true, host only.
- `stream`: `{epoch,title?}` → true, host only. Positive safe integer epoch identifies current programme; 0 stops. Publish control before audio. Restart with fresh epoch after seek, discontinuity or reconnect.

Push: `{type:"room",room:Room|null,reason?}`. Room includes id/name/locked/private/count/maxUsers/hostId/streamEpoch/title/members; members contain id/name/online, never credentials. Host disconnect sets epoch=0 immediately; expiry ends the room. Heartbeat ping every 10s.

Binary audio uses ELTA v1: magic ELTA [0..3], version=1 [4], flags [5], LE header length=36 [6..7], LE epoch u64 [8..15], sequence u32 [16..19], frame timestamp u64 [20..27], sample rate u32=48000 [28..31], payload length u16 [32..33], channels=2 [34], frameMs=20 [35], Opus bytes [36..]. Max payload 1275. Host only; strict room/epoch/format checks. Per host limit 100 packets and 64KiB per second. Relayed only to current members, no history.

Connection code: `echo-listen:` + base64url UTF-8 JSON `{server,roomId?,invitation?}`. It contains no admin token or room password. Treat invite codes as secrets; public discovery must never expose invitations. Steam Lobby metadata carries server/roomId only; password remains required for normal friend joining.

Lobby invalidation: `{type:"rooms-changed"}` is a small additive push event for connected peers outside rooms. Public room create/join/leave/delete changes are coalesced over 400ms. Clients should debounce and fetch `rooms`, with at most one refresh in flight. No private room metadata or notifications about private-only changes are sent. Older clients may ignore this event and continue using manual refresh.
