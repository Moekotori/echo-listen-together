# ECHO Listen protocol 1

## Small media clock updates

`capabilities.mediaClock: true` enables host-only `clock` requests containing
`{epoch, clock}`. The epoch must equal the current active programme. Clock data
uses the existing bounded `mediaAnchors` schema, or null to mark it unavailable.
The server emits `{type: "clock", roomId, epoch, clock}` only to members, using
the shared base epoch. These events never include lyrics,
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
- `stream`: `{epoch,title?}` → true, host only. Positive safe integer epoch identifies current programme; 0 stops. Publish control before audio. Restart with fresh epoch after seek, discontinuity or reconnect. Positive epochs require `bitrate:256000`.

Push: `{type:"room",room:Room|null,reason?}`. Room includes id/name/locked/private/count/maxUsers/hostId/streamEpoch/title/members; members contain id/name/online, never credentials. Host disconnect sets epoch=0 immediately; expiry ends the room. Heartbeat ping every 10s.

Binary audio uses ELTA v1: magic ELTA [0..3], version=1 [4], flags [5], LE header length=36 [6..7], LE epoch u64 [8..15], sequence u32 [16..19], frame timestamp u64 [20..27], sample rate u32=48000 [28..31], payload length u16 [32..33], channels=2 [34], frameMs=20 [35], Opus bytes [36..]. Max payload 1275. Host only; strict room/epoch/format checks. Per host limit 100 packets and 64KiB per second. Relayed only to current members, no history.

Connection code: `echo-listen:` + base64url UTF-8 JSON `{server,roomId?,invitation?}`. It contains no admin token or room password. Treat invite codes as secrets; public discovery must never expose invitations. Steam Lobby metadata carries server/roomId only; password remains required for normal friend joining.

Lobby invalidation: `{type:"rooms-changed"}` is a small additive push event for connected peers outside rooms. Public room create/join/leave/delete changes are coalesced over 400ms. Clients should debounce and fetch `rooms`, with at most one refresh in flight. No private room metadata or notifications about private-only changes are sent. Older clients may ignore this event and continue using manual refresh.

## Connection and initialization cancellation

A resumed connection replaces the previous socket. A pending `create` or `join`
must still belong to that exact socket after password work completes; replacement
or disconnection rejects the old request with `session_changed` without changing
membership. The resumed peer can issue a fresh request normally.

Clients must finish their initial `rooms` refresh before resetting the reconnect
retry budget. If initialization fails after a restored room push, close the socket
and invalidate membership, audio work, metadata and typing just as on an unexpected
disconnect. Only a display-only room identity may remain while reconnecting.
Guest device initialization must check cancellation after each asynchronous native
operation; leaving, changing room or starting personal playback cancels remaining
configuration and guest startup. These rules require no protocol version change.
## Fixed 256 kbps audio

The ELTA packet format remains version 1. `hello.result.capabilities.fixedAudioBitrate` is `256000`; `audioQualities` is false. New clients require this capability before entering rooms.

* `stream {epoch, title?, bitrate:256000, programmeState?}` starts the single base-epoch stream. Positive epochs require this bitrate and reject `multiQuality:true` with `fixed_audio_quality`. Epoch zero still stops or pauses without audio.
* There is no quality-switching operation. `quality` requests return `fixed_audio_quality`, including requests for 256; clients must remove the selector.
* Member snapshots retain `qualities:[256]`, `quality:256` and `preferredQuality:256` for older listeners. All members and media clocks use the base epoch; E+1/E+2 packets are rejected.
* Older listeners can decode the base Opus stream. Older hosts must update before broadcasting; legacy 128 kbps or multi-rendition announcements are explicitly rejected instead of being mislabeled.
* A fixed stream is 50 packets/second with 640-byte CBR Opus payloads. ELTA adds 36 bytes per packet: 33,800 bytes/second before WebSocket/TLS/TCP overhead. The host creates only one encoder.
* The send budget remains 100 packets and 65,536 bytes per second with a bounded burst allowance. Audio backlog is limited to 16 KiB and total queued socket data to 64 KiB for audio admission. Pending control bytes are tracked separately so a lyric snapshot is not mistaken for audio backlog. Sustained congestion still closes slow receivers.

## Room chat

`chat {text}` remains member-only, with at most 500 UTF-16 code units and a 750 ms cooldown. The server derives sender identity from membership and broadcasts `{type:"chat", message:{id,roomId,senderId,name,text,sentAt}}` only to the room, with no chat history or content logging. Optional Steam IDs in hello remain unverified avatar hints rather than authentication.

## Current programme metadata and room controls

`hello.result.capabilities` also advertises `trackMetadata`, `trackArtwork`, `typing`, and `transferHost`.

- `metadata {epoch, track}`: host-only, matching the active base epoch. `track` may contain title/artist/album, technical playback fields, a base64 WebP thumbnail, lyrics, and media-clock anchors. Changed metadata has a 500 ms cooldown; identical updates are no-ops. Thumbnails are at most 4096 decoded bytes and 96 x 96 pixels, with validated lossy WebP headers. Lyrics retain at most 400 lines and 28000 serialized line bytes; media clocks retain at most 32 anchors. See `src/artwork.mjs`, `src/lyrics.mjs` and `src/track-technical.mjs` for field validation. No remote artwork URLs are fetched.
- `typing {roomId, active}`: members only, boolean state without draft text; repeated active notifications are limited to once per two seconds. Other members receive `{type:"typing", presence:{roomId,senderId,active}}`.
- `transferHost {memberId}`: current host only, targeting a different online member. Clears the current stream, metadata and invitations; the new host must explicitly start a fresh programme.

Audio rate budgets replenish continuously, with a bounded two-second burst allowance. A separate connection ingress budget caps binary frames before room routing. Structured diagnostics and reports contain fixed counters and whitelisted reasons, never programme or chat content. A server `forwarded` count measures submitted sends, not client receipt, decoding or audible output.
