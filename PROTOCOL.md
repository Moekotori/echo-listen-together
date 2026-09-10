# ECHO Listen protocol 1

## Small media clock updates

`capabilities.mediaClock: true` enables host-only `clock` requests containing
`{epoch, clock}`. The epoch must equal the current active programme. Clock data
uses the existing bounded `mediaAnchors` schema, or null to mark it unavailable.
The server emits `{type: "clock", roomId, epoch, clock}` only to members, using
each listener's selected rendition epoch. These events never include lyrics,
artwork or member lists. Latest clocks remain in normal room snapshots for late
joiners. Changed updates have a 500 ms cooldown; identical updates are no-ops.
Clients should coalesce updates and leave room for other control commands. Legacy
metadata requests remain supported; upgraded clients throttle that fallback too.

## Programme pause extension

Servers advertise `capabilities.programmeState: true` in `hello`. Supporting hosts
include `programmeState: "playing" | "paused" | "stopped"` in `stream` requests.
Playing requires a positive epoch; paused and stopped require epoch zero. The
server validates host ownership and broadcasts the state in member room snapshots
and join responses. Pausing with the same title retains the existing bounded
track metadata; no audio is relayed at epoch zero. Resuming requires a fresh epoch.
Stopping or host disconnection clears metadata and publishes stopped state.
Requests without the field retain the legacy positive-epoch/zero-epoch behaviour.
Clients must not infer a host pause from packet loss or a legacy zero epoch.

WebSocket endpoint: PUBLIC_URL + `/v1/socket`. No browser Origin accepted. TLS in production. Max text request 8192 bytes (49152 for `metadata`); compression disabled. Request `{id:string,type:string,data:object}`, reply `{id,result}` or `{id,error}`. One control request in flight per connection; 40 requests per 10 seconds. Error codes are stable lowercase identifiers, never arbitrary exception detail.

- `hello`: `{protocol:1,name,password?,resumeToken?}` → `{protocol,peerId,resumeToken,name,limits}`. Complete within 5s. Keep resumeToken private; reconnect within the configured `RECONNECT_SECONDS` (default 60s) with the same server password. Token retained only in process memory.
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
# Room chat and personal quality extensions

The protocol remains version 1. `hello.result.capabilities` advertises `chat: true` and `audioQualities: true`. Older clients may ignore both. Public Steam IDs may be supplied in `hello.data.steamId` (17 digits beginning with `7656119`) and appear only in member snapshots for avatar lookup. They are hints, not authenticated identities.

* `chat {text}`: current members only; non-empty plain text, at most 500 UTF-16 code units and at least 750ms between messages per peer. Sender identity is derived from membership. Replies `true`, broadcasts `{type:"chat", message:{id,roomId,senderId,name,text,sentAt}}` only to that room. No server history or message logging. Errors: `room_required`, `invalid_chat`, `chat_rate_limit`.
* `quality {value}`: selects 128, 256 or 320 for this peer. Replies `true` and sends a personalized room snapshot. The preferred value survives session resume; legacy sources fall back to 128 without erasing that preference.
* `stream {epoch,title,multiQuality:true}`: host declares three renditions, with base epoch E for 128, E+1 for 256, E+2 for 320. Base epoch must be at most `Number.MAX_SAFE_INTEGER-2`. All renditions use the unchanged ELTA v1 header, aligned sequence/timestamps and independent Opus encoders. Without `multiQuality`, only E is accepted and forwarded.
* Detailed room snapshots add `qualities`, `quality`, `preferredQuality`. Each guest's `streamEpoch` is their actual selected epoch; host sees base E. Zero means no active stream. Other guests' selections remain private. Senders must confirm native multi-quality support before declaring it.

The relay validates host membership and every packet, forwarding only the selected rendition. Multi-quality limits are 300 packets / 196608 bytes per one-second window, allowing a bounded burst over the normal 150 packets/second. Single-stream limits remain 100 / 65536. Audio socket buffering stays bounded at 16 KiB; sustained congestion for ten seconds closes the receiver. No second replay queue is created. Standard clients never receive alternative epochs. A rendition switch may rebuffer; seamless or lossless playback is not promised.

## Current programme metadata and room controls

`hello.result.capabilities` also advertises `trackMetadata`, `trackArtwork`, `typing`, and `transferHost`.

- `metadata {epoch, track}`: host-only, matching the active base epoch. `track` may contain title/artist/album, technical playback fields, a base64 WebP thumbnail, lyrics, and media-clock anchors. Changed metadata has a 500 ms cooldown; identical updates are no-ops. Thumbnails are at most 4096 decoded bytes and 96 x 96 pixels, with validated lossy WebP headers. Lyrics retain at most 400 lines and 28000 serialized line bytes; media clocks retain at most 32 anchors. See `src/artwork.mjs`, `src/lyrics.mjs` and `src/track-technical.mjs` for field validation. No remote artwork URLs are fetched.
- `typing {roomId, active}`: members only, boolean state without draft text; repeated active notifications are limited to once per two seconds. Other members receive `{type:"typing", presence:{roomId,senderId,active}}`.
- `transferHost {memberId}`: current host only, targeting a different online member. Clears the current stream, metadata and invitations; the new host must explicitly start a fresh programme.

Audio rate budgets replenish continuously, with a bounded two-second burst allowance. A separate connection ingress budget caps binary frames before room routing. Structured diagnostics and reports contain fixed counters and whitelisted reasons, never programme or chat content. A server `forwarded` count measures submitted sends, not client receipt, decoding or audible output.
